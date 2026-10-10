/**
 * Puesta en profundidad de los conjuntos de puntos (docs/decisiones/0010, D1): `shiftedDepth` (por conjunto y por
 * corrida o corona), recetas, saneamiento y formato, y el borrado en cascada de las tendencias de un conjunto.
 */
import { describe, expect, it } from 'vitest';
import { createPointSet, depthOrder, isPointSetSeriesKey, listRuns, sanitizePointSetDecisions, shiftedDepth, shiftOf, type PointSet, type PointSetDecisions } from '../src/core/pointSets';
import { addPointSet, removePointSet, setPointSetDepthShift } from '../src/core/state/pointSets';
import { addWell, createProject, getWellEntry, type Project } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { addTrend } from '../src/core/state/trends';
import type { TrendSpec } from '../src/core/trends';
import { createWell } from '../src/core/well';

const W = 'w';

function coreSet(id = 'c1', runs = true): PointSet {
  return createPointSet({
    id,
    kind: 'core',
    name: 'Corona',
    depth: Float64Array.of(1000, 1001, 1002, 1010, 1011),
    pointIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
    columns: {
      phi: { label: 'φ', unit: 'v/v', values: Float64Array.of(0.1, 0.12, 0.15, 0.2, 0.18) },
      ...(runs ? { run: { label: 'Corona', values: ['1', '1', '1', '2', '2'] } } : {}),
    },
  });
}

function project(sets: PointSet[]): Project {
  return addWell(createProject(), createWell({ id: W, name: 'P', depth: Float64Array.from({ length: 40 }, (_, i) => 990 + i), curves: [], pointSets: sets }));
}

const trend = (id: string, provider: string, key: string): TrendSpec => ({ id, name: id, visible: true, series: { provider, key }, model: 'linear', mode: 'fit', selection: { excluded: [] }, extend: false });

describe('shiftedDepth: profundidad corregida', () => {
  it('sin desplazamientos devuelve la misma profundidad (misma identidad)', () => {
    const s = coreSet();
    expect(shiftedDepth(s, undefined)).toBe(s.depth);
    expect(shiftedDepth(s, { points: {} })).toBe(s.depth);
  });

  it('por conjunto: se suma a todos los puntos', () => {
    const s = coreSet('c1', false);
    const d: PointSetDecisions = { points: {}, depthShift: 2.4 };
    expect([...shiftedDepth(s, d)]).toEqual([1002.4, 1003.4, 1004.4, 1012.4, 1013.4]);
    expect(shiftedDepth(s, d)).toBe(shiftedDepth(s, d)); // caché por identidad
    expect(s.depth[0]).toBe(1000); // los datos no se tocan
  });

  it('por corona: el de la corona reemplaza al del conjunto; las demás usan el del conjunto', () => {
    const s = coreSet();
    expect(listRuns(s)).toEqual(['1', '2']);
    const d: PointSetDecisions = { points: {}, depthShift: 1, runShifts: { '2': -3 } };
    expect([...shiftedDepth(s, d)]).toEqual([1001, 1002, 1003, 1007, 1008]);
    expect(shiftOf(d, '1')).toBe(1);
    expect(shiftOf(d, '2')).toBe(-3);
    expect(shiftOf(d, null)).toBe(1);
    expect(shiftOf(undefined, '2')).toBe(0);
  });

  it('coronas que se pisan: el resultado puede no estar ordenado y depthOrder lo ordena (estable)', () => {
    const s = coreSet();
    const z = shiftedDepth(s, { points: {}, runShifts: { '2': -10.5 } });
    expect([...z]).toEqual([1000, 1001, 1002, 999.5, 1000.5]);
    expect(depthOrder(z)).toEqual([3, 0, 4, 1, 2]);
    expect(depthOrder(Float64Array.of(1, 1, 2))).toEqual([0, 1, 2]);
  });
});

describe('setPointSetDepthShift: recetas', () => {
  it('por conjunto: 0 o undefined lo quitan; mismo valor = mismo proyecto', () => {
    const p0 = project([coreSet()]);
    const p1 = setPointSetDepthShift(p0, W, 'c1', 2.4);
    expect(getWellEntry(p1, W).interpretation.pointSets['c1']).toEqual({ points: {}, depthShift: 2.4 });
    expect(setPointSetDepthShift(p1, W, 'c1', 2.4)).toBe(p1);
    expect(getWellEntry(setPointSetDepthShift(p1, W, 'c1', 0), W).interpretation.pointSets['c1']!.depthShift).toBeUndefined();
  });

  it('por corona: queda en runShifts; 0 es explícito si el conjunto tiene otro valor; undefined vuelve al del conjunto', () => {
    let p = project([coreSet()]);
    p = setPointSetDepthShift(p, W, 'c1', 1.6, '2');
    expect(getWellEntry(p, W).interpretation.pointSets['c1']).toEqual({ points: {}, runShifts: { '2': 1.6 } });
    // 0 sin valor del conjunto: es lo mismo que nada.
    expect(getWellEntry(setPointSetDepthShift(p, W, 'c1', 0, '1'), W).interpretation.pointSets['c1']!.runShifts).toEqual({ '2': 1.6 });
    p = setPointSetDepthShift(p, W, 'c1', 2, undefined);
    p = setPointSetDepthShift(p, W, 'c1', 0, '1');
    const d = getWellEntry(p, W).interpretation.pointSets['c1']!;
    expect(d.runShifts).toEqual({ '1': 0, '2': 1.6 });
    expect([...shiftedDepth(coreSet(), d)]).toEqual([1000, 1001, 1002, 1011.6, 1012.6]);
    p = setPointSetDepthShift(p, W, 'c1', undefined, '1');
    p = setPointSetDepthShift(p, W, 'c1', undefined, '2');
    expect(getWellEntry(p, W).interpretation.pointSets['c1']).toEqual({ points: {}, depthShift: 2 });
    expect(() => setPointSetDepthShift(p, W, 'c1', NaN, '1')).toThrow();
  });

  it('saneamiento: runShifts inválidos se quitan con aviso', () => {
    const warns: string[] = [];
    const d = sanitizePointSetDecisions({ c1: { points: {}, runShifts: { '1': 2.4, '2': 'x', '': 1 } } }, 'P', (m) => warns.push(m));
    expect(d['c1']).toEqual({ points: {}, runShifts: { '1': 2.4 } });
    expect(warns.join()).toMatch(/2 puestas en profundidad por corrida inválidas/);
    expect(sanitizePointSetDecisions({ c1: { points: {}, runShifts: 3 } }, 'P', () => {})['c1']).toEqual({ points: {} });
  });

  it('se guarda y se abre (formato v5) con las puestas por corona', async () => {
    let p = project([coreSet()]);
    p = setPointSetDepthShift(p, W, 'c1', 2.4, '1');
    p = setPointSetDepthShift(p, W, 'c1', -0.5);
    const back = await deserializeProject(await serializeProject(p));
    expect(getWellEntry(back, W).interpretation.pointSets['c1']).toEqual({ points: {}, depthShift: -0.5, runShifts: { '1': 2.4 } });
    expect(getWellEntry(back, W).well.pointSets[0]!.columns['run']).toEqual({ label: 'Corona', values: ['1', '1', '1', '2', '2'] });
  });
});

describe('borrar un conjunto borra sus tendencias (convención `<conjunto>[:…]`)', () => {
  it('quita las tendencias del conjunto (cualquier proveedor menos curvas) y deja las demás', () => {
    let p = project([coreSet('c1'), coreSet('c10')]);
    p = addTrend(p, W, trend('kphi', 'core', 'c1:kphi'));
    p = addTrend(p, W, trend('todo', 'mdt', 'c1'));
    p = addTrend(p, W, trend('otro', 'core', 'c10:kphi')); // prefijo parecido, otro conjunto
    p = addTrend(p, W, trend('curva', 'curve', 'm:c1'));
    p = setPointSetDepthShift(p, W, 'c1', 1);
    const q = removePointSet(p, W, 'c1');
    const e = getWellEntry(q, W);
    expect(e.interpretation.trends.map((t) => t.id)).toEqual(['otro', 'curva']);
    expect(e.interpretation.pointSets['c1']).toBeUndefined();
    expect(e.well.pointSets.map((s) => s.id)).toEqual(['c10']);
    expect(isPointSetSeriesKey('c1:water', 'c1')).toBe(true);
    expect(isPointSetSeriesKey('c10', 'c1')).toBe(false);
  });

  it('sin tendencias ni decisiones no toca la interpretación', () => {
    const p = addPointSet(project([]), W, coreSet('c1'));
    const q = removePointSet(p, W, 'c1');
    expect(getWellEntry(q, W).interpretation).toBe(getWellEntry(p, W).interpretation);
  });
});
