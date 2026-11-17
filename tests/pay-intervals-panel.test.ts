/**
 * Capas de pay (F04), lado interfaz: escritor genérico de libros xlsx, modelo del panel (claves estables, selección,
 * exportación) y persistencia de la selección en `interpretation.moduleState` (deshacer y archivo).
 */
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { sameEngineInputs } from '../src/core/interpretation';
import { addWell, createProject, getWellEntry, setModuleState } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createWell } from '../src/core/well';
import { listXlsxSheets, parseXlsx } from '../src/io';
import { writeWorkbook } from '../src/io/export/xlsx';
import { exportSheets, firstN, intervalKey, payRowsFrom, picksRecipe, readPicks, resolvePicks, summarize, togglePick } from '../src/modules/pay-intervals/model';

const tableRows = [
  { rank: 1, zoneId: 'z2', zone: 'B', top: 7812.4, base: 7818.9, gross: 6.5, net: 6.2, gaps: 1, phi: 0.21, sw: 0.32, k: 150, kh: 930, hphi: 1.3, hphiSh: 0.88, khPct: 75 },
  { rank: 2, zoneId: 'z1', zone: 'A', top: 7700.0, base: 7703.05, gross: 3.05, net: 3.05, gaps: 0, phi: 0.18, sw: 0.4, k: 100, kh: 305, hphi: 0.55, hphiSh: 0.33, khPct: 24.6 },
  { rank: 3, zoneId: 'z2', zone: 'B', top: 7830.0, base: 7831.0, gross: 1, net: 1, gaps: 0, phi: 0.1, sw: 0.6, k: 5, kh: 5, hphi: 0.1, hphiSh: 0.04, khPct: 0.4 },
];

describe('writeWorkbook', () => {
  it('escribe las hojas en orden con encabezado y números legibles por el lector de la app', () => {
    const bytes = writeWorkbook([
      { name: 'Tabla', rows: [['Tope (m)', 'Zona'], [7812.4, 'B'], [NaN, null]], widths: [10] },
      { name: 'Notas', rows: [['Campo', 'Valor']] },
    ]);
    expect(listXlsxSheets(bytes)).toEqual(['Tabla', 'Notas']);
    const t = parseXlsx(bytes, 'x.xlsx', { requireDepth: false });
    expect(t.columns.map((c) => c.name)).toContain('Tope');
    const files = unzipSync(bytes);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<v>7812.4</v>');
    expect(sheet).not.toContain('NaN');
    expect(sheet).toContain('<col min="2" max="2" width="12"'); // ancho por defecto
  });

  it('sanea y desduplica los nombres de hoja y exige al menos una', () => {
    const bytes = writeWorkbook([{ name: 'A/B', rows: [['x']] }, { name: 'a/b', rows: [['y']] }]);
    expect(listXlsxSheets(bytes)).toEqual(['A B', 'a b 2']);
    expect(() => writeWorkbook([])).toThrow(/al menos una hoja/);
  });

  it('una hoja sin filas no lleva <cols> vacío (OOXML inválido)', () => {
    const sheet = strFromU8(unzipSync(writeWorkbook([{ name: 'Vacía', rows: [] }]))['xl/worksheets/sheet1.xml']!);
    expect(sheet).not.toContain('<cols>');
  });

  it('muchas filas (una por muestra) no desbordan la pila al calcular las columnas', () => {
    const rows = Array.from({ length: 300_000 }, (_, i) => [i]);
    expect(() => writeWorkbook([{ name: 'Curvas', rows }])).not.toThrow();
  });
});

describe('modelo del panel de capas de pay', () => {
  const rows = payRowsFrom(tableRows);

  it('lee la tabla con claves estables (zona + tope y base al centímetro)', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]!.key).toBe('z2|7812.40|7818.90');
    expect(intervalKey('z1', 7700.004, 7703.049)).toBe(rows[1]!.key);
    const s = summarize(rows);
    expect(s.count).toBe(3);
    expect(s.net).toBeCloseTo(10.25, 9);
    expect(s.kh).toBeCloseTo(1240, 9);
    expect(summarize(payRowsFrom(tableRows.map((r) => ({ ...r, k: null, kh: null, khPct: null })))).hasPerm).toBe(false);
  });

  it('elige, alterna y detecta elecciones huérfanas', () => {
    expect(firstN(rows, 2)).toEqual([rows[0]!.key, rows[1]!.key]);
    expect(togglePick(['a'], 'b')).toEqual(['a', 'b']);
    expect(togglePick(['a', 'b'], 'a')).toEqual(['b']);
    const { picked, orphans } = resolvePicks(rows, [rows[2]!.key, 'z9|1.00|2.00']);
    expect(picked.map((r) => r.rank)).toEqual([3]);
    expect(orphans).toBe(1);
  });

  it('exporta con unidades, columna «Elegido» y hoja de punzados por profundidad', () => {
    const sheets = exportSheets(rows, [rows[2]!.key, rows[1]!.key], { wellName: 'TP' });
    expect(sheets.map((s) => s.name)).toEqual(['Capas de pay', 'Punzados sugeridos', 'Notas']);
    const [head, ...body] = sheets[0]!.rows;
    expect(head).toContain('Elegido');
    expect(head).toContain('Tope (m)');
    expect(head).toContain('k·h (mD·m)');
    expect(body.map((r) => r[1])).toEqual(['No', 'Sí', 'Sí']);
    expect(sheets[1]!.rows.slice(1).map((r) => r[3])).toEqual([7700, 7830]); // por profundidad
    // Sin elegidos no hay hoja de punzados.
    expect(exportSheets(rows, [], { wellName: 'TP' }).map((s) => s.name)).toEqual(['Capas de pay', 'Notas']);
  });
});

describe('selección guardada en interpretation.moduleState', () => {
  const n = 20;
  const depth = Float64Array.from({ length: n }, (_, i) => 1000 + i * 0.5);
  const base = addWell(createProject('pay'), createWell({ id: 'w', name: 'W', depth, curves: [] }));

  it('la receta guarda y limpia sin cambiar las entradas del motor', () => {
    const before = getWellEntry(base, 'w').interpretation;
    const p = picksRecipe('w', ['k1', 'k2', 'k1'])(base);
    const after = getWellEntry(p, 'w').interpretation;
    expect(readPicks(after)).toEqual(['k1', 'k2']);
    expect(sameEngineInputs(before, after)).toBe(true);
    const cleared = getWellEntry(picksRecipe('w', [])(p), 'w').interpretation;
    expect(cleared.moduleState).toBeUndefined();
    expect(readPicks(cleared)).toEqual([]);
    expect(setModuleState(base, 'w', 'pay-intervals', undefined)).toBe(base);
    // Repetir la misma selección no cambia el proyecto (no suma un paso de deshacer).
    expect(picksRecipe('w', ['k1', 'k2'])(p)).toBe(p);
    expect(picksRecipe('w', [])(base)).toBe(base);
    expect(picksRecipe('w', ['k2', 'k1'])(p)).not.toBe(p);
  });

  it('se conserva al guardar y abrir el proyecto (v7) y lo inválido de un archivo viejo se descarta', async () => {
    const p = picksRecipe('w', ['z|1.00|2.00'])(base);
    const again = await deserializeProject(await serializeProject(p));
    expect(readPicks(getWellEntry(again, 'w').interpretation)).toEqual(['z|1.00|2.00']);

    const legacy = JSON.parse(await serializeProject(base, { version: 6, codec: 'f64le-b64' }));
    legacy.project.wells[0].interpretation.moduleState = { 'pay-intervals': { picked: ['a'] }, roto: 'ok', otro: { f: '() => 1' } };
    const warnings: string[] = [];
    const opened = await deserializeProject(JSON.stringify(legacy), { onWarning: (m) => warnings.push(m) });
    const i = getWellEntry(opened, 'w').interpretation;
    expect(readPicks(i)).toEqual(['a']);
    expect(Object.keys(i.moduleState ?? {}).sort()).toEqual(['otro', 'pay-intervals', 'roto']);
    expect(warnings).toEqual([]);

    legacy.project.wells[0].interpretation.moduleState = ['no es un objeto'];
    const broken = await deserializeProject(JSON.stringify(legacy), { onWarning: (m) => warnings.push(m) });
    expect(getWellEntry(broken, 'w').interpretation.moduleState).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/estado de módulos/);
  });
});
