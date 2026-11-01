/**
 * Exponente de saturación n desde el índice de resistividad de corona (docs/decisiones/0053): lector RI–Sw
 * (`src/io/coreRi.ts`), modelo puro del panel (`src/modules/core-calibration/saturation.ts` y las recetas de
 * `model.ts`), ejemplo sintético, y que los datos viajen en guardar/abrir (v6 y v7), snapshots y deshacer.
 */
import { describe, expect, it } from 'vitest';
import { createPointSet, pointNumbers, pointTexts, type PointSet } from '../src/core/pointSets';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { enableProjectInputRevisions } from '../src/core/state/inputRevisions';
import { addPointSet } from '../src/core/state/pointSets';
import { addWell, createProject, getWellEntry, setParam, type Project } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { createWell } from '../src/core/well';
import { buildRiSet, CORE_RI_SET_KIND, parseTable, suggestRiMapping } from '../src/io';
import { applyArchie, applyCementation, applySaturation, archieFits, CALIB_PARAMS, paramValue } from '../src/modules/core-calibration/model';
import { EXAMPLE_N, exampleRiSet } from '../src/modules/core-calibration/riExample';
import { riIncluded, riLine, riPlugGroups, riSaturation, riSets, setRiPlugIncluded } from '../src/modules/core-calibration/saturation';
import { exampleCoreSet } from '../src/modules/core/example';
import { SHARED_PARAMS } from '../src/modules/sharedParams';
import scal from './fixtures/tp-corona-electrica-scal.json';
import { zone } from './helpers';

const W = 'w';
const e = scal.expected;

function project(sets: PointSet[] = []): Project {
  const w = createWell({ id: W, name: 'Pozo', depth: Float64Array.from({ length: 50 }, (_, i) => 7980 + i), curves: [], pointSets: sets });
  return addWell(createProject(), w, [zone('z1', 7980, 8000), zone('z2', 8001, 8029)]);
}

/** Tabla CSV de la cátedra: los 12 plugs con Ro, Rt y Sw (un paso por plug) y el n del laboratorio (negativo). */
const twelvePlugsCsv = () =>
  ['Muestra,Profundidad (m),Ro (ohm.m),Rt (ohm.m),Sw (fraction),n', ...scal.formationFactor.map((f) => `${f.id},${f.depthM},${f.Ro},${f.Rt},${f.Sw},${f.nLab}`)].join('\n');

describe('lector RI–Sw', () => {
  it('reconoce Sw y RI por nombre (inglés y español, Rt/Ro, «Sw fraction pv»)', () => {
    const cases: [string, string][] = [
      ['Water Saturation', 'RI'],
      ['Saturación', 'Índice de resistividad'],
      ['Sw', 'Resistivity Index'],
      ['Sw fraction pv', 'Rt/Ro'],
    ];
    for (const [sw, ri] of cases) {
      const t = parseTable(`Sample,${sw},${ri}\nA,1,1\nA,0.5,4.2\n`, 'ri.csv', { requireDepth: false });
      const map = suggestRiMapping(t);
      expect(map.find((m) => m.name.startsWith(sw.split(' ')[0]!))?.field, sw).toBe('sw');
      expect(map[2]!.field, ri).toBe('ri');
      expect(map[0]!.field).toBe('plug');
      const { set } = buildRiSet(t, map, { id: 'r' });
      expect(set.kind).toBe(CORE_RI_SET_KIND);
      expect([...pointNumbers(set, 'ri')!]).toEqual([1, 4.2]);
    }
  });

  it('Sw en %: se detecta por el máximo y se convierte a fracción', () => {
    const t = parseTable('Plug,Sw,RI\nA,100,1\nA,50,4\nA,30,11\n', 'ri.csv', { requireDepth: false });
    const map = suggestRiMapping(t);
    expect(map[1]!.unit).toBe('%');
    const { set } = buildRiSet(t, map, { id: 'r' });
    expect([...pointNumbers(set, 'sw')!]).toEqual([1, 0.5, 0.3]);
  });

  it('sin RI: lo calcula con Rt/Ro; la columna n negativa del laboratorio se guarda en valor absoluto, sin fallar', () => {
    const t = parseTable(twelvePlugsCsv(), 'ff.csv', { requireDepth: false });
    const map = suggestRiMapping(t);
    expect(map.map((m) => m.field)).toEqual(['plug', 'depth', 'ro', 'rt', 'sw', 'nlab']);
    const r = buildRiSet(t, map, { id: 'r' });
    expect(r.warnings.join(' ')).toMatch(/Rt\/Ro/);
    expect(r.warnings.join(' ')).toMatch(/valor absoluto/);
    expect(riPlugGroups(r.set)).toHaveLength(12);
    expect(Math.min(...pointNumbers(r.set, 'nLab')!)).toBeGreaterThan(0);
    expect(pointNumbers(r.set, 'md')![0]).toBeCloseTo(scal.formationFactor[0]!.depthM, 6);
  });

  it('sin id de plug: una sola muestra; sin Sw o sin RI (ni Rt y Ro): error en español', () => {
    const t = parseTable('Sw,RI\n1,1\n0.5,4\n', 'ri.csv', { requireDepth: false });
    const r = buildRiSet(t, suggestRiMapping(t), { id: 'r', name: 'Ensayo' });
    expect(riPlugGroups(r.set).map((g) => g.plug)).toEqual(['Muestra']);
    expect(new Set(r.set.pointIds).size).toBe(2);
    expect([...r.set.depth]).toEqual([0, 0]);
    const noRi = parseTable('Sw,Rt\n1,1\n0.5,4\n', 'ri.csv', { requireDepth: false });
    expect(() => buildRiSet(noRi, suggestRiMapping(noRi), { id: 'r' })).toThrow(/índice de resistividad/);
    const noSw = parseTable('Plug,RI\nA,1\n', 'ri.csv', { requireDepth: false });
    expect(() => buildRiSet(noSw, suggestRiMapping(noSw), { id: 'r' })).toThrow(/saturación/);
  });

  it('filas sin Sw o RI se descartan con aviso', () => {
    const t = parseTable('Plug,Sw,RI\nA,1,1\nA,,3\nA,0.5,\nA,0.4,6\n', 'ri.csv', { requireDepth: false });
    const r = buildRiSet(t, suggestRiMapping(t), { id: 'r' });
    expect(r.dropped).toBe(2);
    expect(r.set.pointIds).toEqual(['A·01', 'A·02']);
  });
});

describe('modelo del panel: n desde los conjuntos RI–Sw (datos de la cátedra)', () => {
  const pairsSet = (id: string, pairs: number[][], plug: string) =>
    createPointSet({
      id,
      kind: CORE_RI_SET_KIND,
      name: plug,
      depth: new Float64Array(pairs.length),
      pointIds: pairs.map((_, i) => `${plug}·${i + 1}`),
      columns: {
        sw: { label: 'Sw', unit: 'v/v', values: Float64Array.from(pairs, (p) => p[0]!) },
        ri: { label: 'RI', unit: 'unitless', values: Float64Array.from(pairs, (p) => p[1]!) },
        plug: { label: 'Plug', values: pairs.map(() => plug) },
      },
    });

  it('1-6R2 (2 y 4 terminales) y los 586 pares compuestos: el ajuste conjunto por el origen da los n esperados', () => {
    expect(riSaturation(pairsSet('a', scal.riSw_1_6R2.twoTerminal, '1-6R2'), undefined)!.pooled.origin!.n).toBeCloseTo(e.n_1_6R2_twoTerminal_origin, 5);
    expect(riSaturation(pairsSet('b', scal.riSw_1_6R2.fourTerminal, '1-6R2'), undefined)!.pooled.origin!.n).toBeCloseTo(e.n_1_6R2_fourTerminal_origin, 5);
    expect(riSaturation(pairsSet('c', scal.riSwPooled, 'compuesto'), undefined)!.pooled.origin!.n).toBeCloseTo(e.n_pooled_origin, 5);
  });

  it('12 plugs con un paso cada uno (leídos del CSV): media por plug = 2,230010', () => {
    const t = parseTable(twelvePlugsCsv(), 'ff.csv', { requireDepth: false });
    const set = buildRiSet(t, suggestRiMapping(t), { id: 'r' }).set;
    const s = riSaturation(set, undefined)!;
    expect(s.meanPerPlug.count).toBe(12);
    expect(s.meanPerPlug.n).toBeCloseTo(e.n_meanPerSample, 5);
    expect(s.plugs.every((p) => p.fit.count === 1 && Number.isFinite(p.nLab))).toBe(true);
  });

  it('descartar un plug saca todos sus pasos del ajuste (una receta); volver a incluirlo borra las decisiones', () => {
    const set = exampleRiSet('ri');
    const p0 = project([set]);
    const all = riSaturation(set, undefined)!;
    const p1 = setRiPlugIncluded(p0, W, set, 'C2-09', false);
    const dec = getWellEntry(p1, W).interpretation.pointSets['ri'];
    expect(Object.keys(dec!.points)).toHaveLength(9);
    expect(riIncluded(set, dec).filter(Boolean)).toHaveLength(27);
    const less = riSaturation(set, dec)!;
    expect(less.pooled.count).toBe(27);
    expect(less.plugs.find((p) => p.plug === 'C2-09')!.included).toBe(false);
    expect(less.meanPerPlug.count).toBe(3);
    expect(less.pooled.origin!.n).not.toBeCloseTo(all.pooled.origin!.n, 3);
    const p2 = setRiPlugIncluded(p1, W, set, 'C2-09', true);
    expect(getWellEntry(p2, W).interpretation.pointSets['ri']!.points).toEqual({});
    // Deshacer vuelve exactamente al proyecto anterior.
    const back = undo(recordChange(emptyHistory(), p0, 'Descartar', 0), p1)!;
    expect(back.project).toBe(p0);
  });

  it('recta RI = intercept·Sw^−n en dos puntos', () => {
    const l = riLine(2, 1, 0.25, 1);
    expect([...l.x]).toEqual([0.25, 1]);
    expect(l.y[0]).toBeCloseTo(16, 12);
    expect(l.y[1]).toBe(1);
  });
});

describe('ejemplo sintético RI–Sw', () => {
  it('rotulado sintético, coherente con el de corona (mismos ids de plug) y recupera n ≈ 2,1', () => {
    const set = exampleRiSet('ri');
    expect(set.synthetic).toBe(true);
    expect(set.name).toMatch(/ejemplo sintético/);
    const logDepth = Float64Array.from({ length: 1969 }, (_, i) => 7900 + i * 0.1524);
    const phie = Float64Array.from(logDepth, (z) => 0.12 + 0.06 * Math.sin(z / 2.9));
    const core = exampleCoreSet('c', { depth: logDepth, phie })!;
    for (const g of riPlugGroups(set)) {
      const i = core.pointIds.indexOf(g.plug);
      expect(i, g.plug).toBeGreaterThanOrEqual(0);
      expect(pointNumbers(set, 'md')![g.idx[0]!]).toBeCloseTo(core.depth[i]!, 6);
    }
    const s = riSaturation(set, undefined)!;
    expect(s.pooled.origin!.n).toBeCloseTo(EXAMPLE_N, 1);
    expect(s.pooled.origin!.r2).toBeGreaterThan(0.98);
    expect(s.plugs).toHaveLength(4);
    expect(pointTexts(set, 'plug')).toHaveLength(36);
  });
});

describe('recetas «Aplicar n» y «Aplicar a, m y n»', () => {
  it('n es el parámetro compartido de los modelos de Sw (clave «n», mismo spec que el catálogo)', () => {
    expect(CALIB_PARAMS.n.storage).toBe('n');
    expect(CALIB_PARAMS.n.spec).toBe(SHARED_PARAMS.n);
  });

  it('«Aplicar n» global o de una zona, redondeado al paso; fuera de rango no escribe', () => {
    const p0 = project([exampleRiSet('ri')]);
    const g = applySaturation(p0, W, 2.2108578, null);
    expect(getWellEntry(g, W).interpretation.params.global).toEqual({ n: 2.21 });
    const z = applySaturation(p0, W, 2.236, 'z2');
    expect(getWellEntry(z, W).interpretation.params.zones['z2']).toEqual({ n: 2.24 });
    expect(paramValue(getWellEntry(z, W).interpretation.params, CALIB_PARAMS.n, 'z1')).toBe(2);
    expect(applySaturation(p0, W, 4.6, null)).toBe(p0);
    expect(applySaturation(p0, W, NaN, null)).toBe(p0);
  });

  it('«Aplicar a, m y n»: una sola receta (un deshacer revierte los tres)', () => {
    let p0 = project([exampleRiSet('ri')]);
    p0 = setParam(p0, W, 'a', 0.81, null);
    const p1 = applyArchie(p0, W, { a: 0.594448, m: 2.219602, n: 2.210858 }, null);
    const g = getWellEntry(p1, W).interpretation.params.global;
    expect(g).toEqual({ a: 0.59, m: 2.22, n: 2.21 });
    const back = undo(recordChange(emptyHistory(), p0, 'Aplicar a, m y n', 0), p1)!;
    expect(getWellEntry(back.project, W).interpretation.params.global).toEqual({ a: 0.81 });
    // Igual que escribir a y m con «Aplicar a y m» y después n.
    expect(applySaturation(applyCementation(p0, W, { a: 0.594448, m: 2.219602 }, null), W, 2.210858, null)).toEqual(p1);
  });

  it('si uno de los tres no cabe en su control, no escribe ninguno', () => {
    const p0 = project([]);
    expect(archieFits({ a: 1, m: 1.9, n: 2.2 })).toBe(true);
    expect(archieFits({ a: 1, m: 1.9, n: 4.5 })).toBe(false);
    expect(applyArchie(p0, W, { a: 1, m: 1.9, n: 4.5 }, null)).toBe(p0);
    expect(applyArchie(p0, W, { a: 3, m: 1.9, n: 2.2 }, 'z1')).toBe(p0);
  });
});

describe('persistencia del conjunto RI–Sw', () => {
  const withDecisions = () => setRiPlugIncluded(addPointSet(project(), W, exampleRiSet('ri')), W, exampleRiSet('ri'), 'C1-12', false);

  it('guardar y abrir (v6): datos, rótulo sintético y plug descartado se conservan exactos', async () => {
    const p = withDecisions();
    for (const codec of ['f64le-b64', 'auto'] as const) {
      const back = await deserializeProject(await serializeProject(p, { codec }));
      const s = riSets(getWellEntry(back, W).well.pointSets)[0]!;
      const s0 = getWellEntry(p, W).well.pointSets[0]!;
      expect(s.kind).toBe(CORE_RI_SET_KIND);
      expect(s.synthetic).toBe(true);
      expect(s.pointIds).toEqual(s0.pointIds);
      for (const k of ['sw', 'ri', 'md']) expect([...pointNumbers(s, k)!]).toEqual([...pointNumbers(s0, k)!]);
      expect(pointTexts(s, 'plug')).toEqual(pointTexts(s0, 'plug'));
      expect(getWellEntry(back, W).interpretation.pointSets).toEqual(getWellEntry(p, W).interpretation.pointSets);
      expect(riSaturation(s, getWellEntry(back, W).interpretation.pointSets['ri'])!.pooled.origin!.n).toBe(riSaturation(s0, getWellEntry(p, W).interpretation.pointSets['ri'])!.pooled.origin!.n);
    }
  });

  it('guardar y abrir con revisiones de entrada (v7): el conjunto viaja igual', async () => {
    const p = enableProjectInputRevisions(withDecisions());
    const text = await serializeProject(p);
    expect(JSON.parse(text).version).toBe(7);
    const back = await deserializeProject(text);
    const s = riSets(getWellEntry(back, W).well.pointSets)[0]!;
    expect([...pointNumbers(s, 'ri')!]).toEqual([...pointNumbers(exampleRiSet('x'), 'ri')!]);
    expect(getWellEntry(back, W).interpretation.pointSets['ri']).toEqual(getWellEntry(p, W).interpretation.pointSets['ri']);
  });

  it('snapshot: guarda y restaura los plugs descartados y el n aplicado; los datos no se copian', () => {
    const p0 = applySaturation(withDecisions(), W, 2.15, null);
    const { project: p1, snapshot } = createSnapshot(p0, W, 's');
    const p2 = applySaturation(setRiPlugIncluded(p1, W, exampleRiSet('ri'), 'C1-12', true), W, 2.4, null);
    const p3 = restoreSnapshot(p2, snapshot.id);
    const i = getWellEntry(p3, W).interpretation;
    expect(Object.keys(i.pointSets['ri']!.points)).toHaveLength(9);
    expect(i.params.global['n']).toBe(2.15);
    expect(getWellEntry(p3, W).well).toBe(getWellEntry(p2, W).well);
  });

  it('un proyecto sin datos RI no tiene conjuntos RI y abre igual que antes', async () => {
    const p = project();
    const back = await deserializeProject(await serializeProject(p));
    expect(riSets(getWellEntry(back, W).well.pointSets)).toEqual([]);
    expect(getWellEntry(back, W).interpretation).toEqual(getWellEntry(p, W).interpretation);
  });
});
