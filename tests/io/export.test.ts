import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell } from '../../src/core/engine/engine';
import { emptyInterpretation } from '../../src/core/interpretation';
import { registry } from '../../src/modules';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { parseTable, readWellFile } from '../../src/io';
import {
  buildExportColumns,
  buildExportFile,
  extractSummary,
  sanitizeMnemonic,
  uniqueNames,
  writeCsv,
  writeLas,
  writeSummaryCsv,
  writeXlsx,
  type ExportInput,
  type ExportOutput,
  type ExportSummary,
} from '../../src/io/export';

const tp = readWellFile(csvText, 'pozo_tp_perfiles.csv');
const fixedDate = new Date('2026-10-10T12:00:00Z');

function inputOf(well = tp.well, outputs: ExportOutput[] = [], extra: Partial<ExportInput> = {}): ExportInput {
  return {
    wellName: well.name,
    header: well.header,
    depth: well.depth.values,
    columns: buildExportColumns(well, outputs),
    zones: tp.zones.map((z) => ({ name: z.name, top: z.top, base: z.base, kind: z.kind })),
    generatedAt: fixedDate,
    ...extra,
  };
}

/** Compara dos arreglos con NaN en las mismas posiciones y valores iguales (o cercanos). */
function sameData(a: ArrayLike<number>, b: ArrayLike<number>, digits?: number) {
  expect(b.length).toBe(a.length);
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]!)) expect(Number.isNaN(b[i]!), `muestra ${i}`).toBe(true);
    else if (digits === undefined) expect(b[i], `muestra ${i}`).toBe(a[i]);
    else expect(b[i]!).toBeCloseTo(a[i]!, digits);
  }
}

const computedGr = (data: Float64Array): ExportOutput => ({ moduleId: 'vsh-gr', port: 'VSH', kind: 'curve', active: true, label: 'Volumen de arcilla', unit: 'v/v', value: data });

describe('nombres de columna', () => {
  it('sanea a mnemónicos válidos para LAS', () => {
    expect(sanitizeMnemonic('RT 90')).toBe('RT_90');
    expect(sanitizeMnemonic('Porosidad (efectiva).v/v')).toBe('Porosidad_efectiva_v_v');
    expect(sanitizeMnemonic('  ')).toBe('CURVA');
  });
  it('los repetidos (sin distinguir mayúsculas) reciben sufijo y respetan lo reservado', () => {
    expect(uniqueNames(['GR', 'gr', 'GR', 'DEPT'], ['DEPT'])).toEqual(['GR', 'gr_2', 'GR_3', 'DEPT_2']);
  });
});

describe('LAS', () => {
  const text = writeLas(inputOf());
  it('tiene las secciones y los datos de ~W', () => {
    expect(text).toMatch(/^~VERSION INFORMATION\nVERS\.\s+2\.0 :/);
    expect(text).toMatch(/\nWRAP\.\s+NO :/);
    expect(text).toMatch(/\n~WELL INFORMATION\n/);
    expect(text).toMatch(/\nSTRT\.m\s+7633\.2588 :/);
    expect(text).toMatch(/\nSTOP\.m\s+8518\.5/);
    expect(text).toMatch(/\nNULL\.\s+-999\.25 :/);
    expect(text).toMatch(/\n~CURVE INFORMATION\nDEPT\.m\s+: DEPTH\n/);
    expect(text).toMatch(/\n~A /);
    expect(text.endsWith('\n')).toBe(true);
  });
  it('STEP es el paso del muestreo regular', () => {
    const t = parseTable(text, 'a.las');
    expect(Number(t.header['STEP']!.value)).toBeCloseTo(0.1524, 6);
    expect(t.nullValue).toBe(-999.25);
  });
  it('ida y vuelta con nuestro lector: mismas profundidades, curvas, unidades y nulos', () => {
    const back = readWellFile(text, 'a.las');
    sameData(tp.well.depth.values, back.well.depth.values);
    expect(back.well.curves.map((c) => c.id)).toEqual(tp.well.curves.map((c) => c.id));
    for (const c of tp.well.curves) {
      const b = back.well.curves.find((k) => k.id === c.id)!;
      sameData(c.data, b.data);
      expect(b.unit, c.id).toBe(c.unit);
      expect(b.role, c.id).toBe(c.role);
    }
    expect(back.well.name).toBe(tp.well.name);
  });
  it('un pozo con paso irregular lleva STEP 0', () => {
    const input: ExportInput = { wellName: 'P', depth: Float64Array.of(1, 2, 4), columns: [] };
    expect(writeLas(input)).toMatch(/\nSTEP\.m\s+0 :/);
  });
  it('un encabezado con dos puntos no rompe la lectura', () => {
    const t = writeLas({ wellName: 'Pozo: A.B', header: { COMP: { value: 'YPF: Norte' } }, depth: Float64Array.of(1, 2), columns: [] });
    const back = parseTable(t, 'a.las');
    expect(back.header['WELL']!.value).toBe('Pozo- A.B');
    expect(back.header['COMP']!.value).toBe('YPF- Norte');
  });
});

describe('CSV', () => {
  const text = writeCsv(inputOf());
  it('encabezado con unidades, coma y punto decimal; el nulo es vacío', () => {
    const [head, first] = text.split('\n');
    expect(head).toMatch(/^DEPTH \(m\),BS \(in\),CAL \(in\),GR \(gAPI\),SP \(mV\),/);
    expect(first).toMatch(/^7633\.2588,8\.5,9\.033,62\.502,,/); // SP vacío en la primera muestra
  });
  it('ida y vuelta con nuestro lector', () => {
    const back = readWellFile(text, 'a.csv');
    sameData(tp.well.depth.values, back.well.depth.values);
    expect(back.well.curves.map((c) => c.id)).toEqual(tp.well.curves.map((c) => c.id));
    for (const c of tp.well.curves) {
      const b = back.well.curves.find((k) => k.id === c.id)!;
      sameData(c.data, b.data);
      expect(b.unit, c.id).toBe(c.unit);
    }
  });
  it('valor de nulos configurable: -9999 en lugar de vacío', () => {
    const t = writeCsv(inputOf(tp.well, [], { nullValue: -9999 }));
    expect(t.split('\n')[1]).toMatch(/^7633\.2588,8\.5,9\.033,62\.502,-9999,/);
    sameData(tp.well.curves.find((c) => c.id === 'SP')!.data, readWellFile(t, 'a.csv').well.curves.find((c) => c.id === 'SP')!.data);
  });
});

describe('xlsx', () => {
  const calc = new Float64Array(tp.well.depth.values.length).map((_, i) => (i % 7 === 0 ? NaN : (i % 100) / 100));
  const bytes = writeXlsx(inputOf(tp.well, [computedGr(calc)]));
  it('ida y vuelta: curvas medidas y calculada, con la hoja Curvas primera', () => {
    const back = readWellFile(bytes, 'a.xlsx');
    expect(back.well.curves.map((c) => c.id)).toEqual([...tp.well.curves.map((c) => c.id), 'VSH']);
    sameData(tp.well.depth.values, back.well.depth.values);
    for (const c of tp.well.curves) sameData(c.data, back.well.curves.find((k) => k.id === c.id)!.data);
    const vsh = back.well.curves.find((c) => c.id === 'VSH')!;
    sameData(calc, vsh.data);
    expect(vsh.unit).toBe('v/v');
  });
  it('trae las hojas Curvas, Zonas y Encabezado', () => {
    const wb = strFromU8(unzipSync(bytes)['xl/workbook.xml']!);
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['Curvas', 'Zonas', 'Encabezado']);
    const zonas = parseTable(bytes, 'a.xlsx', { sheet: 'Zonas', requireDepth: false });
    expect(zonas.rowCount).toBe(tp.zones.length);
  });
  it('nulos numéricos en lugar de celdas vacías', () => {
    const b = writeXlsx(inputOf(tp.well, [], { nullValue: -999.25 }));
    sameData(tp.well.curves.find((c) => c.id === 'SP')!.data, readWellFile(b, 'a.xlsx').well.curves.find((c) => c.id === 'SP')!.data);
  });
});

describe('tramo, unidades y nombres', () => {
  const zone = tp.zones[2]!;
  const range = { top: zone.top, base: zone.base };
  const expectedN = Array.from(tp.well.depth.values).filter((d) => d >= zone.top && d <= zone.base).length;

  it('un tramo (zona) exporta solo sus muestras, en los tres formatos', () => {
    for (const [text, name] of [
      [writeLas(inputOf(tp.well, [], { range })), 'a.las'],
      [writeCsv(inputOf(tp.well, [], { range })), 'a.csv'],
      [writeXlsx(inputOf(tp.well, [], { range })), 'a.xlsx'],
    ] as const) {
      const back = readWellFile(text, name);
      expect(back.well.depth.values.length, name).toBe(expectedN);
      expect(back.well.depth.values[0]!).toBeGreaterThanOrEqual(zone.top);
      expect(back.well.depth.values[expectedN - 1]!).toBeLessThanOrEqual(zone.base);
      const gr = tp.well.curves.find((c) => c.id === 'GR')!.data;
      const i0 = Array.from(tp.well.depth.values).findIndex((d) => d >= zone.top);
      sameData(gr.subarray(i0, i0 + expectedN), back.well.curves.find((c) => c.id === 'GR')!.data);
    }
  });
  it('un tramo sin muestras o inválido da error en español', () => {
    expect(() => writeCsv(inputOf(tp.well, [], { range: { top: 1, base: 2 } }))).toThrow(/no tiene muestras/);
    expect(() => writeCsv(inputOf(tp.well, [], { range: { top: 5, base: 2 } }))).toThrow(/inválido/);
  });
  it('selección de curvas: solo las pedidas, en el orden del pozo', () => {
    const cols = buildExportColumns(tp.well, []);
    const ids = ['m:ZDEN', 'm:GR'];
    const back = readWellFile(writeCsv(inputOf(tp.well, [], { selection: ids })), 'a.csv');
    expect(back.well.curves.map((c) => c.id)).toEqual(cols.filter((c) => ids.includes(c.id)).map((c) => c.mnemonic));
  });
  it('profundidad en pies: encabezado, STRT/STEP y vuelta a metros', () => {
    const las = writeLas(inputOf(tp.well, [], { depthUnit: 'ft' }));
    expect(las).toMatch(/\nSTRT\.ft\s+25043\.5/);
    expect(Number(parseTable(las, 'a.las').header['STEP']!.value)).toBeCloseTo(0.1524 / 0.3048, 6);
    const csv = writeCsv(inputOf(tp.well, [], { depthUnit: 'ft' }));
    expect(csv.split('\n')[0]).toMatch(/^DEPTH \(ft\),/);
    for (const [text, name] of [[las, 'a.las'], [csv, 'a.csv'], [writeXlsx(inputOf(tp.well, [], { depthUnit: 'ft' })), 'a.xlsx']] as const) {
      const back = readWellFile(text, name);
      sameData(tp.well.depth.values, back.well.depth.values, 6);
      expect(back.well.depth.sourceUnit, name).toBe('ft');
    }
  });
  it('mnemónicos duplicados o con espacios salen únicos y válidos', () => {
    const d = Float64Array.of(1, 2, 3);
    const mk = (id: string, mnemonic: string, v: number): ExportInput['columns'][number] => ({ id, mnemonic, unit: 'gAPI', data: Float64Array.of(v, v + 1, v + 2), origin: 'measured' });
    const input: ExportInput = { wellName: 'P', depth: d, columns: [mk('a', 'GR', 10), mk('b', 'GR', 20), mk('c', 'RT 90', 30), mk('d', 'DEPT', 40)] };
    const t = parseTable(writeLas(input), 'a.las');
    expect(t.columns.map((c) => c.name)).toEqual(['DEPT', 'GR', 'GR_2', 'RT_90', 'DEPT_2']);
    expect(Array.from(t.columns[2]!.numbers!)).toEqual([20, 21, 22]);
  });
  it('una calculada con el mismo nombre que una medida no la pisa; las alternativas solo si se piden', () => {
    const n = tp.well.depth.values.length;
    const mk = (port: string, moduleId: string, active: boolean): ExportOutput => ({ moduleId, port, kind: 'curve', active, label: port, unit: 'gAPI', value: new Float64Array(n) });
    const outputs = [mk('GR', 'm1', true), mk('VSH', 'm2', true), mk('VSH', 'm3', false)];
    expect(buildExportColumns(tp.well, outputs).filter((c) => c.origin === 'computed').map((c) => c.mnemonic)).toEqual(['GR', 'VSH']);
    const cols = buildExportColumns(tp.well, outputs, { includeAlternatives: true });
    expect(cols.filter((c) => c.origin === 'computed').map((c) => c.mnemonic)).toEqual(['GR', 'VSH', 'VSH_m3']);
    const back = readWellFile(writeCsv(inputOf(tp.well, outputs, { columns: cols })), 'a.csv');
    expect(back.well.curves.filter((c) => c.id.startsWith('GR')).map((c) => c.id)).toEqual(['GR', 'GR_2']);
  });
  it('las calculadas de otro largo (otro pozo) se omiten', () => {
    const bad: ExportOutput = { moduleId: 'm', port: 'VSH', kind: 'curve', active: true, label: 'x', value: new Float64Array(3) };
    expect(buildExportColumns(tp.well, [bad]).every((c) => c.origin === 'measured')).toBe(true);
  });
});

describe('sumario por zona', () => {
  const summary: ExportSummary = {
    columns: [
      { key: 'zone', label: 'Zona', kind: 'text' },
      { key: 'gross', label: 'Bruto', unit: 'm' },
      { key: 'phiPay', label: 'φ pay', unit: 'v/v' },
      { key: 'khPay', label: 'kh pay (mD·m)', unit: 'unitless' },
    ],
    rows: [
      { zone: 'A, norte', gross: 12.5, phiPay: 0.123, khPay: 40 },
      { zone: 'Total', gross: 12.5, phiPay: null, khPay: Number.NaN },
    ],
  };
  it('CSV con rótulos y unidades; sin dato vacío; texto con coma entre comillas', () => {
    const t = writeSummaryCsv(summary);
    expect(t.split('\n')).toEqual(['Zona,Bruto (m),φ pay (v/v),kh pay (mD·m)', '"A, norte",12.5,0.123,40', 'Total,12.5,,', '']);
  });
  it('xlsx: hoja Sumario legible con nuestro lector', () => {
    const bytes = writeXlsx(inputOf(tp.well, [], { summary }));
    const t = parseTable(bytes, 'a.xlsx', { sheet: 'Sumario', requireDepth: false });
    expect(t.columns.map((c) => c.name)).toEqual(['Zona', 'Bruto', 'φ pay', 'kh pay']);
    expect(t.columns[0]!.text).toEqual(['A, norte', 'Total']);
    expect(Array.from(t.columns[2]!.numbers!)[0]).toBe(0.123);
  });
  it('extractSummary toma la tabla del puerto ZONE_SUMMARY y devuelve null si no hay', () => {
    const out: ExportOutput = { moduleId: 'zone-summary', port: 'ZONE_SUMMARY', kind: 'table', active: true, label: 'S', value: { rows: summary.rows } };
    expect(extractSummary([out], summary.columns)!.rows).toHaveLength(2);
    expect(extractSummary([], summary.columns)).toBeNull();
    expect(extractSummary(null, summary.columns)).toBeNull();
  });
  it('buildExportFile: LAS/CSV con sumario van en un zip con dos archivos; xlsx es un solo archivo', () => {
    const f = buildExportFile('las', 'Pozo TP', inputOf(tp.well, [], { summary }));
    expect(f.name).toBe('Pozo_TP.zip');
    const files = unzipSync(f.bytes);
    expect(Object.keys(files).sort()).toEqual(['Pozo_TP.las', 'Pozo_TP_sumario.csv']);
    expect(readWellFile(strFromU8(files['Pozo_TP.las']!), 'a.las').well.depth.values).toHaveLength(5810);
    expect(buildExportFile('csv', 'x', inputOf()).name).toBe('x.csv');
    expect(buildExportFile('xlsx', 'x', inputOf(tp.well, [], { summary })).name).toBe('x.xlsx');
  });
});

describe('pozo del TP completo', () => {
  it('las 18 curvas y 5810 muestras sobreviven a LAS, CSV y xlsx', () => {
    for (const [data, name] of [
      [writeLas(inputOf()), 'a.las'],
      [writeCsv(inputOf()), 'a.csv'],
      [writeXlsx(inputOf()), 'a.xlsx'],
    ] as const) {
      const back = readWellFile(data, name);
      expect(back.well.depth.values, name).toHaveLength(5810);
      expect(back.well.curves, name).toHaveLength(18);
      for (const c of tp.well.curves) sameData(c.data, back.well.curves.find((k) => k.id === c.id)!.data);
    }
  });
});

describe('con el motor real sobre el pozo del TP', () => {
  const engine = new Engine(registry, { checkInputs: true });
  const result = (engine.setWell(toEngineWell(tp.well)), engine.run(emptyInterpretation(tp.zones)));
  const spec = Object.values(registry.get('zone-summary')!.outputs).find((o) => o.kind === 'table')!;

  it('las calculadas activas salen con unidad y descripción, y el sumario se reutiliza tal cual', () => {
    const cols = buildExportColumns(tp.well, result.outputs, { moduleName: (id) => registry.get(id)?.name ?? id });
    const computed = cols.filter((c) => c.origin === 'computed');
    expect(computed.length).toBeGreaterThan(5);
    expect(new Set(cols.map((c) => c.id)).size).toBe(cols.length);
    const vsh = computed.find((c) => c.mnemonic === 'VSH');
    expect(vsh?.unit).toBe('v/v');
    expect(vsh?.description).toContain('·');
    const summary = spec.kind === 'table' ? extractSummary(result.outputs, spec.columns) : null;
    expect(summary).not.toBeNull();
    expect(summary!.rows).toHaveLength(tp.zones.length + 1);
    expect(summary!.rows.at(-1)!['zone']).toBe('Total');
    const f = buildExportFile('xlsx', 'tp', inputOf(tp.well, result.outputs, { columns: cols, summary: summary! }));
    const back = parseTable(f.bytes, 'tp.xlsx', { sheet: 'Sumario', requireDepth: false });
    expect(back.columns.map((c) => c.name)[0]).toBe('Zona');
    expect(back.rowCount).toBe(tp.zones.length + 1);
  });
});
