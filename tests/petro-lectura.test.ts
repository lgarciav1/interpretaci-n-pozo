/**
 * Lectura automática del pozo (función T): reglas de `src/petro/wellReading.ts` y módulo `well-reading`.
 * No hay resultados de libro que reproducir (son criterios prácticos): cada regla se prueba con un pozo sintético
 * cuyo resultado se razona a mano (muestras de 0,5 m desde 1000 m; la profundidad es el centro de la muestra, así que
 * el tope de la muestra i es 1000 + 0,5·i − 0,25 y la base 1000 + 0,5·i + 0,25), con los bordes de cada umbral, y
 * después se corre sobre el pozo real del TP para verificar invariantes y rendimiento.
 */
import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import { registry } from '../src/modules';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { readWell, WELL_READING_DEFAULTS, type WellReadingParams, type WellReadingSamples } from '../src/petro/wellReading';
import { curve, well, zone } from './helpers';

const N = 80;
const STEP = 0.5;
const D0 = 1000;
const top = (i: number) => D0 + STEP * i - STEP / 2;
const base = (i: number) => D0 + STEP * i + STEP / 2;

interface Row {
  netRes: number;
  netPay: number;
  phi: number;
  sw: number;
  rt: number;
  gas: number;
  washout: number;
  coal: number;
  shale: number;
}
const SHALE: Row = { netRes: 0, netPay: 0, phi: 0.05, sw: 1, rt: 2, gas: 0, washout: 0, coal: 0, shale: 1 };
const PAY: Row = { netRes: 1, netPay: 1, phi: 0.18, sw: 0.32, rt: 30, gas: 0, washout: 0, coal: 0, shale: 0 };
const GAS: Row = { ...PAY, gas: 1 };
const WATER: Row = { netRes: 1, netPay: 0, phi: 0.15, sw: 0.95, rt: 5, gas: 0, washout: 0, coal: 0, shale: 0 };

/** Arma las muestras con capas [desde, hasta] (índices inclusivos) sobre una base de arcilla. */
function build(layers: readonly [number, number, Partial<Row>][], opts: { n?: number; omit?: (keyof Row)[] } = {}): WellReadingSamples {
  const n = opts.n ?? N;
  const rows: Row[] = Array.from({ length: n }, () => ({ ...SHALE }));
  for (const [a, b, r] of layers) for (let i = a; i <= b; i++) Object.assign(rows[i]!, r);
  const col = (k: keyof Row) => (opts.omit?.includes(k) ? undefined : Float64Array.from(rows, (r) => r[k]));
  return {
    depth: Float64Array.from({ length: n }, (_, i) => D0 + STEP * i),
    thickness: new Float64Array(n).fill(STEP),
    phi: col('phi')!,
    sw: col('sw')!,
    netRes: col('netRes')!,
    netPay: col('netPay')!,
    rt: col('rt'),
    gas: col('gas'),
    washout: col('washout'),
    coal: col('coal'),
    shale: col('shale'),
  };
}

const ALL = [{ id: 'z1', name: 'C', start: 0, end: N }];
const P = (o: Partial<WellReadingParams> = {}): WellReadingParams => ({ ...WELL_READING_DEFAULTS, ...o });
const read = (s: WellReadingSamples, o: Partial<WellReadingParams> = {}) => readWell(s, ALL, P(o));

describe('lectura del pozo: fluido y confianza', () => {
  it('tramo con crossover, Sw baja y Rt 6 veces la del acuífero → gas, confianza alta', () => {
    // GAS: 20 muestras (10 m), φ 0,18, Sw 0,32, Rt 30; acuífero: 20 muestras, Rt 5 → Rt/Rt_ref = 30/5 = 6.
    const r = read(build([[10, 29, GAS], [40, 59, WATER]]));
    const c = r.candidates[0]!;
    expect(c.kind).toBe('hydrocarbon');
    expect(c.fluid).toBe('gas');
    expect(c.confidence).toBe('high');
    expect(c.top).toBeCloseTo(top(10), 9);
    expect(c.base).toBeCloseTo(base(29), 9);
    expect(c.h).toBeCloseTo(10, 9);
    expect(c.phi).toBeCloseTo(0.18, 9);
    expect(c.sw).toBeCloseTo(0.32, 9);
    expect(c.rtRatio).toBeCloseTo(6, 9);
    expect(c.refKind).toBe('aquiferZone');
    expect(c.importance).toBeCloseTo(10 * 0.18 * 0.68, 9); // h·φ·Sh = 1,224 m
    expect(c.evidence).toEqual(['Sw baja', 'Rt 6 veces la base acuífera', 'cruce densidad–neutrón']);
    expect(c.text).toBe(
      '1.004,8–1.014,8 m (zona C): 10 m de reservorio con φ 0,18 y Sw 0,32; resistividad 6 veces la de la base acuífera de la zona y cruce densidad–neutrón: probable gas, confianza alta.',
    );
  });

  it('sin crossover, con Sw baja y Rt alta → petróleo, confianza alta', () => {
    const c = read(build([[10, 29, PAY], [40, 59, WATER]])).candidates[0]!;
    expect(c.fluid).toBe('oil');
    expect(c.confidence).toBe('high');
    expect(c.text).toContain('probable petróleo, confianza alta');
  });

  it('gas con una sola evidencia más (sin curva de Rt) → confianza media; solo el crossover → baja', () => {
    const sinRt = read(build([[10, 29, GAS], [40, 59, WATER]], { omit: ['rt'] })).candidates[0]!;
    expect(sinRt.fluid).toBe('gas');
    expect(sinRt.confidence).toBe('medium'); // 2 de 3: crossover + Sw baja
    expect(Number.isNaN(sinRt.rtRatio)).toBe(true);
    const soloCruce = read(build([[10, 29, { ...GAS, sw: 0.55, rt: 6 }], [40, 59, WATER]])).candidates[0]!;
    expect(soloCruce.fluid).toBe('gas');
    expect(soloCruce.confidence).toBe('low'); // 1 de 3: Sw 0,55 no es baja y Rt/Rt_ref = 1,2
  });

  it('petróleo con una sola evidencia → media; sin ninguna (cumple los cortes y nada más) → dudoso, baja', () => {
    const swSola = read(build([[10, 29, { ...PAY, rt: 6 }], [40, 59, WATER]])).candidates[0]!; // Sw baja, Rt/Rt_ref 1,2
    expect([swSola.fluid, swSola.confidence]).toEqual(['oil', 'medium']);
    const nada = read(build([[10, 29, { ...PAY, sw: 0.55, rt: 6 }], [40, 59, WATER]])).candidates[0]!;
    expect([nada.fluid, nada.confidence]).toEqual(['doubtful', 'low']);
    expect(nada.text).toContain('fluido dudoso, confianza baja (solo cumple los cortes de pay)');
  });

  it('los bordes de los umbrales son inclusivos: Rt/Rt_ref = 3 y Sw = 0,4 cuentan', () => {
    const c = read(build([[10, 29, { ...PAY, sw: 0.4, rt: 15 }], [40, 59, WATER]])).candidates[0]!;
    expect(c.rtRatio).toBeCloseTo(3, 9);
    expect(c.confidence).toBe('high');
    const justo = read(build([[10, 29, { ...PAY, sw: 0.4000001, rt: 14.9 }], [40, 59, WATER]])).candidates[0]!;
    expect(justo.fluid).toBe('doubtful');
  });

  it('tramo acuífero → agua; con crossover y Sw alta o Sw intermedia → dudoso', () => {
    const agua = read(build([[10, 29, WATER]])).candidates[0]!;
    expect(agua.kind).toBe('water');
    expect(agua.fluid).toBe('water');
    expect(agua.confidence).toBe('high'); // Sw alta + sin cruce con bandera disponible
    expect(agua.text).toContain('Sw 0,95');
    expect(agua.text).toContain('probable agua, confianza alta');
    const sinBandera = read(build([[10, 29, WATER]], { omit: ['gas'] })).candidates[0]!;
    expect([sinBandera.fluid, sinBandera.confidence]).toEqual(['water', 'medium']);
    const cruce = read(build([[10, 29, { ...WATER, gas: 1 }]])).candidates[0]!;
    expect([cruce.fluid, cruce.confidence]).toEqual(['doubtful', 'low']);
    const trans = read(build([[10, 29, { ...WATER, sw: 0.7 }]])).candidates[0]!;
    expect([trans.fluid, trans.confidence]).toEqual(['doubtful', 'low']);
  });

  it('el carbón vuelve dudoso el fluido (borde inclusivo en 0,1 del espesor)', () => {
    // 20 muestras de pay: 2 con carbón = 0,1 → dudoso; 1 con carbón = 0,05 → sigue siendo gas.
    const layers = (nCoal: number): [number, number, Partial<Row>][] => [[10, 29, GAS], [10, 9 + nCoal, { coal: 1 }], [40, 59, WATER]];
    expect(read(build(layers(2))).candidates[0]!.fluid).toBe('doubtful');
    expect(read(build(layers(2))).candidates[0]!.text).toContain('posible carbón');
    expect(read(build(layers(1))).candidates[0]!.fluid).toBe('gas');
  });

  it('el derrumbe baja la confianza a «baja» desde el 20 % del espesor neto (borde inclusivo)', () => {
    const withWash = (k: number): [number, number, Partial<Row>][] => [[10, 29, GAS], [10, 9 + k, { washout: 1 }], [40, 59, WATER]];
    const limpio = read(build([[10, 29, GAS], [40, 59, WATER]])).candidates[0]!;
    const tres = read(build(withWash(3))).candidates[0]!; // 3/20 = 0,15
    const cuatro = read(build(withWash(4))).candidates[0]!; // 4/20 = 0,20
    expect(limpio.confidence).toBe('high');
    expect(tres.confidence).toBe('high');
    expect(cuatro.washoutFrac).toBeCloseTo(0.2, 9);
    expect(cuatro.confidence).toBe('low');
    expect(cuatro.fluid).toBe('gas'); // el fluido no cambia, solo la confianza
    expect(cuatro.text).toContain('probable gas, confianza baja (derrumbe en el 20 % del tramo)');
    expect(cuatro.evidence).toContain('derrumbe en el 20 % del tramo');
  });

  it('muestras sin dato de bandera (NaN) no cuentan a favor ni en contra', () => {
    const s = build([[10, 29, GAS], [40, 59, WATER]]);
    (s.gas as Float64Array).fill(NaN, 10, 30); // IND_GAS sin dato en todo el tramo
    const c = read(s).candidates[0]!;
    expect(Number.isNaN(c.gasFrac)).toBe(true);
    expect(c.fluid).toBe('oil');
    expect(c.confidence).toBe('high');
  });
});

describe('lectura del pozo: tramos', () => {
  it('fusiona huecos cortos (< 1 m, estricto) y no cuenta el hueco en el espesor neto', () => {
    // Hueco de 1 muestra (0,5 m): se fusiona. Hueco de 2 muestras (1,0 m = mergeGap): NO se fusiona (estricto).
    const unido = read(build([[10, 19, PAY], [21, 30, PAY], [50, 59, WATER]]));
    const hc = unido.candidates.filter((c) => c.kind === 'hydrocarbon');
    expect(hc).toHaveLength(1);
    expect(hc[0]!.h).toBeCloseTo(10, 9); // 20 muestras netas, sin la del hueco
    expect(hc[0]!.base - hc[0]!.top).toBeCloseTo(10.5, 9);
    expect(hc[0]!.top).toBeCloseTo(top(10), 9);
    expect(hc[0]!.base).toBeCloseTo(base(30), 9);
    const separado = read(build([[10, 19, PAY], [22, 31, PAY], [50, 59, WATER]])); // hueco de 2 muestras = 1,0 m
    expect(separado.candidates.filter((c) => c.kind === 'hydrocarbon')).toHaveLength(2);
    // Con un hueco permitido mayor se fusionan.
    expect(read(build([[10, 19, PAY], [22, 31, PAY], [50, 59, WATER]]), { mergeGap: 1.5 }).candidates.filter((c) => c.kind === 'hydrocarbon')).toHaveLength(1);
  });

  it('descarta los tramos de menos espesor neto que el mínimo (borde inclusivo)', () => {
    const s = build([[10, 12, PAY], [40, 59, WATER]]); // 3 muestras = 1,5 m
    expect(read(s, { minThickness: 2 }).candidates.filter((c) => c.kind === 'hydrocarbon')).toHaveLength(0);
    const justo = read(s, { minThickness: 1.5 }).candidates.filter((c) => c.kind === 'hydrocarbon');
    expect(justo).toHaveLength(1);
    expect(justo[0]!.h).toBeCloseTo(1.5, 9);
    // Sin tramos: el resumen lo dice y no hay profundidad a la que saltar.
    const vacio = read(s, { minThickness: 2 });
    expect(vacio.general[0]!.kind).toBe('summary');
    expect(vacio.general[0]!.text).toContain('No se encontraron tramos candidatos');
    expect(Number.isNaN(vacio.general[0]!.top)).toBe(true);
  });

  it('ordena por importancia h·φ·Sh, con el hidrocarburo antes que el agua, y respeta los máximos', () => {
    // A: 8 muestras (4 m) φ 0,18 Sw 0,32 → 4·0,18·0,68 = 0,490;  B: 20 muestras (10 m) φ 0,10 Sw 0,30 → 0,700.
    const s = build(
      [[5, 12, PAY], [20, 39, { ...PAY, phi: 0.1, sw: 0.3 }], [50, 79, WATER]],
    );
    const r = read(s);
    expect(r.candidates.map((c) => [c.rank, c.kind])).toEqual([[1, 'hydrocarbon'], [2, 'hydrocarbon'], [3, 'water']]);
    expect(r.candidates[0]!.importance).toBeCloseTo(0.7, 9);
    expect(r.candidates[1]!.importance).toBeCloseTo(0.4896, 9);
    expect(r.candidates[0]!.top).toBeGreaterThan(r.candidates[1]!.top); // el más importante no es el más somero
    const uno = read(s, { maxCandidates: 1, maxWater: 0 });
    expect(uno.candidates).toHaveLength(1);
    expect(uno.omitted).toBe(2);
    expect(uno.general[0]!.text).toContain('se listan los 1 más importantes');
  });

  it('referencia de resistividad: acuífero de la zona, si no el del pozo, si no arcillas (sin evidencia); sin curva, sin cociente', () => {
    const dosZonas = [
      { id: 'a', name: 'A', start: 0, end: 40 },
      { id: 'b', name: 'B', start: 40, end: 80 },
    ];
    // Zona A: pay con Rt 30; sin acuífero propio. Zona B: acuífero con Rt 10.
    const s = build([[5, 24, PAY], [45, 64, { ...WATER, rt: 10 }]]);
    const r = readWell(s, dosZonas, P());
    const a = r.candidates.find((c) => c.zoneId === 'a')!;
    expect(a.refKind).toBe('aquiferWell');
    expect(a.rtRatio).toBeCloseTo(3, 9);
    expect(a.evidence).toContain('Rt 3 veces el acuífero del pozo');
    // Sin ningún acuífero: la referencia son las arcillas (Rt 2) y no cuenta como evidencia.
    const sh = read(build([[10, 29, PAY]])).candidates[0]!;
    expect(sh.refKind).toBe('shale');
    expect(sh.rtRatio).toBeCloseTo(15, 9);
    expect(sh.evidence).toEqual(['Sw baja']);
    expect(sh.confidence).toBe('medium'); // oil con 1 de 2 evidencias
    expect(sh.text).toContain('resistividad 15 veces la de las arcillas de la zona');
    const sinRt = read(build([[10, 29, PAY]], { omit: ['rt'] })).candidates[0]!;
    expect(sinRt.refKind).toBeNull();
    expect(Number.isNaN(sinRt.rtRatio)).toBe(true);
  });

  it('muestras sin espesor válido no forman tramos', () => {
    const s = build([[10, 29, PAY]]);
    (s.thickness as Float64Array).fill(0, 10, 30);
    expect(read(s).candidates).toHaveLength(0);
  });
});

describe('lectura del pozo: contactos aparentes y líneas generales', () => {
  it('pay seguido de agua en el mismo reservorio continuo → contacto aparente entre ambos', () => {
    // Pay 10–29 (Sw 0,32) y agua 30–59 (Sw 0,95), sin hueco: el contacto está en la base de la muestra 29 = 1014,75 m.
    const r = read(build([[10, 29, PAY], [30, 59, WATER]]));
    expect(r.contacts).toHaveLength(1);
    expect(r.contacts[0]!.depth).toBeCloseTo(base(29), 9);
    expect(r.contacts[0]!.fluid).toBe('oil');
    expect(r.contacts[0]!.text).toContain('petróleo–agua');
    expect(r.contacts[0]!.text).toContain('la Sw pasa de 0,32 a 0,95');
    const g = r.general.find((l) => l.kind === 'contacts')!;
    expect(g.top).toBeCloseTo(base(29), 9);
    expect(g.text).toContain('Contacto aparente');
    expect(g.text).toContain('presiones MDT');
    // Con crossover en el pay el contacto es gas–agua.
    expect(read(build([[10, 29, GAS], [30, 59, WATER]])).contacts[0]!.text).toContain('gas–agua');
  });

  it('no hay contacto si el agua está arriba, si los separa una arcilla de 1 m o más, o si el salto de Sw es chico', () => {
    expect(read(build([[10, 39, WATER], [40, 59, PAY]])).contacts).toHaveLength(0); // agua sobre pay
    expect(read(build([[10, 29, PAY], [32, 59, WATER]])).contacts).toHaveLength(0); // 2 muestras de arcilla = 1,0 m
    expect(read(build([[10, 29, PAY], [31, 59, WATER]])).contacts).toHaveLength(1); // 1 muestra (0,5 m): sigue continuo
    expect(read(build([[10, 29, { ...PAY, sw: 0.58 }], [30, 59, { ...WATER, sw: 0.85 }]])).contacts).toHaveLength(0); // salto 0,27 < 0,3
    expect(read(build([[10, 29, { ...PAY, sw: 0.58 }], [30, 59, { ...WATER, sw: 0.85 }]]), { contactSwJump: 0.25 }).contacts).toHaveLength(1);
  });

  it('con capas delgadas alternadas informa un solo contacto por zona: el de más agua debajo', () => {
    const r = read(build([[5, 14, PAY], [15, 20, WATER], [21, 30, PAY], [31, 70, WATER]]));
    expect(r.contacts).toHaveLength(1);
    expect(r.contacts[0]!.depth).toBeCloseTo(base(30), 9); // el agua de 20 m (31–70), no la de 3 m (15–20)
  });

  it('resumen: cantidad, zonas, espesor total y el tramo más importante', () => {
    const r = read(build([[10, 29, GAS], [40, 59, WATER]]));
    const g = r.general[0]!;
    expect(g.kind).toBe('summary');
    expect(g.top).toBeCloseTo(top(10), 9);
    expect(g.base).toBeCloseTo(base(29), 9);
    expect(g.text).toBe('Se identificó 1 tramo candidato a hidrocarburo en la zona C (1 de gas), con 10 m de pay neto en total; el más importante es 1.004,8–1.014,8 m, probable gas.');
  });

  it('línea de calidad: confianza baja por derrumbe y evidencia que falta; como mucho 3 líneas', () => {
    const s = build([[10, 29, GAS], [10, 19, { washout: 1 }], [40, 59, WATER]], { omit: ['rt', 'washout'] });
    const sinWash = read(s);
    expect(sinWash.general.at(-1)!.kind).toBe('quality');
    expect(sinWash.general.at(-1)!.text).toBe('Falta la resistividad profunda y el indicador de derrumbe, así que la lectura tiene menos evidencias.');
    const conWash = read(build([[10, 29, GAS], [10, 19, { washout: 1 }], [30, 49, WATER]]));
    const q = conWash.general.find((l) => l.kind === 'quality')!;
    expect(q.text).toContain('1 tramo tiene confianza baja por calidad de dato');
    expect(q.top).toBeCloseTo(top(10), 9);
    expect(conWash.general.length).toBeLessThanOrEqual(3);
  });

  it('es determinista: dos corridas dan exactamente lo mismo', () => {
    const s = build([[5, 14, PAY], [15, 20, WATER], [21, 30, GAS], [31, 70, WATER]]);
    expect(JSON.stringify(read(s))).toBe(JSON.stringify(read(s)));
  });

  it('las zonas se leen por separado (sin cruzar sus límites) y el nombre de la zona sale en el texto', () => {
    const dos = [
      { id: 'a', name: 'A', start: 0, end: 30 },
      { id: 'b', name: 'B', start: 30, end: 80 },
    ];
    const s = build([[10, 49, PAY]]); // un pay continuo que cruza el límite entre zonas
    const r = readWell(s, dos, P());
    expect(r.candidates.map((c) => c.zone)).toEqual(['A', 'B']); // misma importancia: gana el más somero
    expect(r.candidates[0]!.base).toBeCloseTo(base(29), 9); // la zona A termina en la muestra 29
    expect(r.candidates[1]!.top).toBeCloseTo(top(30), 9);
    expect(r.candidates[1]!.text).toContain('(zona B)');
    expect(r.candidates.reduce((sum, c) => sum + c.h, 0)).toBeCloseTo(20, 9);
  });
});

// ===============================================================================================================
describe('módulo well-reading', () => {
  const NN = 80;
  const rowsOf = (r: EngineRunResult, key: string) => (r.outputs.find((o) => o.key === key)!.value as TableValue).rows;

  function runModule(zones: ReturnType<typeof zone>[], layers: [number, number, Partial<Row>][], params: Record<string, number> = {}) {
    const s = build(layers, { n: NN });
    const curves = [
      curve('PHIE', 'PHIE', s.phi),
      curve('SW', 'SW', s.sw),
      curve('NET_RES', 'NET_RES', s.netRes),
      curve('NET_PAY', 'NET_PAY', s.netPay),
      curve('RT', 'RT', s.rt!),
      curve('IND_GAS', 'IND_GAS', s.gas!),
    ];
    const e = new Engine(registry, { checkInputs: true });
    e.setWell(well(curves, NN, D0, STEP));
    return e.run({ ...emptyInterpretation(zones), params: { global: params, zones: {} } });
  }

  it('está registrado con sus tablas y su documentación', () => {
    const m = registry.get('well-reading')!;
    expect(m.category).toBe('summary');
    expect(m.docs.references.length).toBeGreaterThan(0);
    const cols = (m.outputs['reading'] as unknown as { columns: { key: string }[] }).columns.map((c) => c.key);
    for (const k of ['rank', 'top', 'base', 'zoneId', 'zone', 'fluid', 'confidence', 'text', 'evidence']) expect(cols).toContain(k);
  });

  it('publica WELL_READING y WELL_READING_GENERAL con el texto, el fluido y las profundidades', () => {
    // Zonas de 20 m: ZC = muestras 0–39, ZD = 40–79. El gas está en ZC y el acuífero en ZD (referencia «del pozo»).
    const zones = [{ ...zone('zc', D0, D0 + 19.75), kind: 'formation' as const }, { ...zone('zd', D0 + 20, D0 + 39.5), kind: 'formation' as const }];
    const r = runModule(zones, [[10, 29, GAS], [50, 69, WATER]]);
    const rows = rowsOf(r, 'well-reading:WELL_READING');
    expect(rows.map((x) => [x['rank'], x['zoneId'], x['fluid'], x['confidence']])).toEqual([
      [1, 'zc', 'gas', 'high'],
      [2, 'zd', 'water', 'high'],
    ]);
    expect(rows[0]!['top']).toBeCloseTo(top(10), 9);
    expect(rows[0]!['base']).toBeCloseTo(base(29), 9);
    expect(rows[0]!['fluidLabel']).toBe('gas');
    expect(rows[0]!['evidence']).toBe('Sw baja · Rt 6 veces el acuífero del pozo · cruce densidad–neutrón');
    expect(rows[0]!['confidence']).toBe('high');
    expect(String(rows[0]!['text'])).toContain('(zona ZC)');
    const general = rowsOf(r, 'well-reading:WELL_READING_GENERAL');
    expect(general[0]!['kind']).toBe('summary');
    expect(general.map((g) => g['order'])).toEqual(general.map((_, i) => i + 1));
  });

  it('los sellos no se leen; sin zonas se lee el pozo completo; los umbrales son parámetros', () => {
    const sello = [{ ...zone('zs', D0, D0 + 19.75), kind: 'seal' as const }, { ...zone('zd', D0 + 20, D0 + 39.5), kind: 'formation' as const }];
    const r = runModule(sello, [[10, 29, GAS], [50, 69, WATER]]);
    expect(rowsOf(r, 'well-reading:WELL_READING').map((x) => x['zoneId'])).toEqual(['zd']);
    const sinZonas = runModule([], [[10, 29, GAS], [50, 69, WATER]]);
    const rows = rowsOf(sinZonas, 'well-reading:WELL_READING');
    expect(rows[0]!['zoneId']).toBe('');
    expect(String(rows[0]!['text'])).not.toContain('(zona');
    // Gas de 7,5 m y agua de 10 m: con un espesor mínimo de 8 m solo queda el agua.
    const estricto = runModule([], [[10, 24, GAS], [50, 69, WATER]], { 'well-reading.minThickness': 8 });
    expect(rowsOf(estricto, 'well-reading:WELL_READING').map((x) => x['kind'])).toEqual(['water']);
  });
});

// ===============================================================================================================
describe('lectura automática sobre el pozo del TP (datos/pozo_tp_perfiles.csv)', () => {
  const { well: tp, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry);
  engine.setWell(toEngineWell(tp));
  const result = engine.run(emptyInterpretation(zones));
  const get = (key: string) => result.outputs.find((o) => o.key === key)!.value;
  const rows = (get('well-reading:WELL_READING') as TableValue).rows;
  const general = (get('well-reading:WELL_READING_GENERAL') as TableValue).rows;
  const zoneOf = (id: string) => zones.find((z) => z.id === id)!;

  it('encuentra tramos coherentes: dentro de su zona, ordenados y con rango válido', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(15); // 12 de hidrocarburo + 3 de agua por defecto
    rows.forEach((x, i) => {
      expect(x['rank']).toBe(i + 1);
      const z = zoneOf(String(x['zoneId']));
      expect(x['top'] as number).toBeGreaterThanOrEqual(z.top - 0.2);
      expect(x['base'] as number).toBeLessThanOrEqual(z.base + 0.2);
      expect(x['base'] as number).toBeGreaterThan(x['top'] as number);
      expect(x['h'] as number).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(x['h'] as number).toBeLessThanOrEqual((x['base'] as number) - (x['top'] as number) + 1e-9);
      expect(['gas', 'oil', 'water', 'doubtful']).toContain(x['fluid']);
      expect(['high', 'medium', 'low']).toContain(x['confidence']);
      expect(x['phi'] as number).toBeGreaterThan(0);
      expect(x['phi'] as number).toBeLessThanOrEqual(0.5);
      expect(x['sw'] as number).toBeGreaterThan(0);
      expect(x['sw'] as number).toBeLessThanOrEqual(1);
      expect(String(x['text'])).toMatch(/^[\d.,]+–[\d.,]+ m \(zona [A-E]\): /);
    });
    const kinds = rows.map((x) => x['kind']);
    expect(kinds.indexOf('water')).toBeGreaterThan(kinds.lastIndexOf('hydrocarbon')); // hidrocarburo antes que agua
    const imp = rows.filter((x) => x['kind'] === 'hydrocarbon').map((x) => x['importance'] as number);
    expect(imp).toEqual([...imp].sort((a, b) => b - a));
  });

  it('la lectura es coherente con los cutoffs: todo tramo de hidrocarburo tiene Sw media bajo el corte de pay (0,6)', () => {
    for (const x of rows.filter((r) => r['kind'] === 'hydrocarbon')) expect(x['sw'] as number).toBeLessThanOrEqual(0.6 + 1e-9);
    for (const x of rows.filter((r) => r['kind'] === 'water')) expect(x['sw'] as number).toBeGreaterThan(0.6);
  });

  it('el pay total leído coincide con el sumario cuando no se recorta nada', () => {
    const all = engine.run({ ...emptyInterpretation(zones), params: { global: { 'well-reading.maxCandidates': 500, 'well-reading.minThickness': 0.1 }, zones: {} } });
    const rs = (all.outputs.find((o) => o.key === 'well-reading:WELL_READING')!.value as TableValue).rows.filter((x) => x['kind'] === 'hydrocarbon');
    const total = rs.reduce((s, x) => s + (x['h'] as number), 0);
    const netPay = get('zone-summary:NET_PAY_TOTAL') as number;
    expect(total).toBeCloseTo(netPay, 6); // con espesor mínimo ≈ 0 cada muestra de pay entra en algún tramo
  });

  it('hay 1–3 líneas generales, la primera es el resumen y todas tienen texto', () => {
    expect(general.length).toBeGreaterThanOrEqual(1);
    expect(general.length).toBeLessThanOrEqual(3);
    expect(general[0]!['kind']).toBe('summary');
    for (const g of general) expect(String(g['text']).length).toBeGreaterThan(20);
  });

  it('rinde: la lectura tarda menos de 20 ms sobre las 5810 muestras (mediana de 7 corridas)', () => {
    const depth = tp.depth.values;
    const n = depth.length;
    const curveOf = (key: string) => get(key) as Float64Array;
    const samples: WellReadingSamples = {
      depth,
      thickness: new Float64Array(n).fill(0.1524),
      phi: curveOf('phie-vsh:PHIE'),
      sw: curveOf('sw-archie:SW'),
      netRes: curveOf('cutoffs:NET_RES'),
      netPay: curveOf('cutoffs:NET_PAY'),
      rt: tp.curves.find((c) => c.mnemonic === 'AT90')!.data,
      gas: curveOf('ind-gas-crossover:IND_GAS'),
      washout: curveOf('ind-washout:IND_WASHOUT'),
      coal: curveOf('ind-coal:IND_COAL'),
      shale: curveOf('ind-shale:IND_SHALE'),
    };
    const intervals = zones.map((z) => {
      let start = 0;
      while (start < n && depth[start]! < z.top) start++;
      let end = start;
      while (end < n && depth[end]! <= z.base) end++;
      return { id: z.id, name: z.name, start, end };
    });
    const times: number[] = [];
    for (let k = 0; k < 7; k++) {
      const t0 = performance.now();
      readWell(samples, intervals, WELL_READING_DEFAULTS);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[3]!).toBeLessThan(20);
  });
});
