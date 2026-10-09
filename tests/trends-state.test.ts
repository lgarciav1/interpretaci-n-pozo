/**
 * Tendencias como parte de la interpretación (docs/decisiones/0008, D2): recetas puras, historial, formato v4 con
 * migración y saneamiento al abrir, y que el motor no recalcule nada cuando solo cambian las tendencias.
 */
import { describe, expect, it } from 'vitest';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { sameEngineInputs } from '../src/core/interpretation';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { addWell, createProject, getWellEntry, setParam } from '../src/core/state/project';
import { deserializeProject, PROJECT_VERSION, serializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { addTrend, duplicateTrend, removeTrend, setTrendRange, setTrendZone, toggleTrendPoint, updateTrend } from '../src/core/state/trends';
import { nextTrendName, sanitizeTrends, trendDepthRange, type TrendSpec } from '../src/core/trends';
import { registry } from '../src/modules';

const demo = syntheticWell();
const W = demo.well.id;
const base = () => addWell(createProject('T'), demo.well, demo.zones);

const spec = (over: Partial<TrendSpec> = {}): TrendSpec => ({
  id: 't1',
  name: 'DT · tendencia',
  visible: true,
  series: { provider: 'curve', key: 'm:DT' },
  model: 'linear',
  mode: 'fit',
  selection: { top: 7700, base: 7800, excluded: [] },
  extend: false,
  ...over,
});

const trends = (p: ReturnType<typeof base>) => getWellEntry(p, W).interpretation.trends;

describe('recetas de tendencias', () => {
  it('agregar, actualizar, duplicar, excluir puntos y borrar; sin cambios = mismo proyecto', () => {
    const p0 = base();
    expect(trends(p0)).toEqual([]);
    const p1 = addTrend(p0, W, spec());
    expect(trends(p1)).toHaveLength(1);
    expect(() => addTrend(p1, W, spec())).toThrow(/Ya hay/);
    // El resto de la interpretación se comparte por referencia.
    const i0 = getWellEntry(p0, W).interpretation;
    const i1 = getWellEntry(p1, W).interpretation;
    expect(i1.params).toBe(i0.params);
    expect(i1.zones).toBe(i0.zones);
    expect(sameEngineInputs(i0, i1)).toBe(true);

    const p2 = updateTrend(p1, W, 't1', { model: 'exp', name: 'Compactación' });
    expect(trends(p2)[0]).toMatchObject({ model: 'exp', name: 'Compactación' });
    expect(updateTrend(p2, W, 't1', { model: 'exp' })).toBe(p2);

    const p3 = setTrendRange(p2, W, 't1', 7900, 7850);
    expect(trends(p3)[0]!.selection).toMatchObject({ top: 7850, base: 7900 });

    const p4 = toggleTrendPoint(p3, W, 't1', '7860.1');
    expect(trends(p4)[0]!.selection.excluded).toEqual(['7860.1']);
    expect(trends(toggleTrendPoint(p4, W, 't1', '7860.1'))[0]!.selection.excluded).toEqual([]);

    const p5 = duplicateTrend(p4, W, 't1', 't2');
    expect(trends(p5).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(trends(p5)[1]!.name).toBe('Compactación (copia)');
    expect(trends(p5)[1]!.selection.excluded).toEqual(['7860.1']);
    expect(trends(p5)[1]!.selection.excluded).not.toBe(trends(p5)[0]!.selection.excluded);

    const p6 = removeTrend(p5, W, 't1');
    expect(trends(p6).map((t) => t.id)).toEqual(['t2']);
    expect(() => removeTrend(p6, W, 'nada')).toThrow(/No existe/);
  });

  it('quitar claves con undefined (color propio, puntos a mano) y exigir dos puntos a mano', () => {
    const p1 = addTrend(base(), W, spec({ color: '#ff0000' }));
    const p2 = updateTrend(p1, W, 't1', { color: undefined });
    expect('color' in trends(p2)[0]!).toBe(false);
    expect(() => updateTrend(p2, W, 't1', { mode: 'manual' })).toThrow(/dos puntos/);
    const p3 = updateTrend(p2, W, 't1', { mode: 'manual', manual: [{ x: 7700, y: 90 }, { x: 7800, y: 80 }] });
    const p4 = updateTrend(p3, W, 't1', { mode: 'fit', manual: undefined });
    expect(trends(p4)[0]!.manual).toBeUndefined();
  });

  it('usar una zona como tramo: el tramo sigue a la zona; si se borra, queda el último', () => {
    const z = demo.zones[2]!;
    const p = setTrendZone(addTrend(base(), W, spec()), W, 't1', z.id);
    const sel = trends(p)[0]!.selection;
    expect(sel.zoneId).toBe(z.id);
    expect(trendDepthRange(sel, [{ ...z, top: z.top + 5 }])).toEqual({ top: z.top + 5, base: z.base });
    expect(trendDepthRange(sel, [])).toEqual({ top: z.top, base: z.base });
    // Elegir otro tramo deja de seguir a la zona.
    expect(trends(setTrendRange(p, W, 't1', 7700, 7710))[0]!.selection.zoneId).toBeUndefined();
  });

  it('el historial deshace un agregado con su etiqueta', () => {
    const p0 = base();
    const p1 = addTrend(p0, W, spec());
    const h = recordChange(emptyHistory(), p0, 'Agregar tendencia', 0);
    const step = undo(h, p1)!;
    expect(step.label).toBe('Agregar tendencia');
    expect(trends(step.project)).toEqual([]);
  });

  it('las tendencias entran en los snapshots', () => {
    const p1 = addTrend(base(), W, spec());
    const { project: p2, snapshot } = createSnapshot(p1, W, 'con tendencia');
    const p3 = restoreSnapshot(removeTrend(p2, W, 't1'), snapshot.id);
    expect(trends(p3)).toEqual([spec()]);
  });

  it('nombres libres', () => {
    expect(nextTrendName([], 'DT')).toBe('DT');
    expect(nextTrendName([spec({ name: 'DT' }), spec({ name: 'DT 2' })], 'DT')).toBe('DT 3');
  });
});

describe('el motor no recalcula por las tendencias', () => {
  it('firma igual: un cambio solo de tendencias sale todo de caché', () => {
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(toEngineWell(demo.well));
    const p0 = base();
    engine.run(getWellEntry(p0, W).interpretation);
    const p1 = addTrend(p0, W, spec());
    const r = engine.run(getWellEntry(p1, W).interpretation);
    expect(r.stats.recomputed).toEqual([]);
    expect(r.stats.reused.length).toBeGreaterThan(5);
    // Un parámetro sí cambia las entradas del motor.
    const p2 = setParam(p1, W, 'grClean', 25);
    expect(sameEngineInputs(getWellEntry(p1, W).interpretation, getWellEntry(p2, W).interpretation)).toBe(false);
  });
});

describe('formato v4', () => {
  it('guarda y abre las tendencias tal cual', async () => {
    const p = addTrend(base(), W, spec({ selection: { top: 7700, base: 7800, excluded: ['7701.2'] }, color: '#e8590c' }));
    const back = await deserializeProject(await serializeProject(p, { codec: 'f64le-b64' }));
    expect(PROJECT_VERSION).toBe(4);
    expect(trends(back)).toEqual(trends(p));
  });

  it('migra un archivo v3 (sin tendencias) en pozos y snapshots', async () => {
    const p = createSnapshot(base(), W, 's').project;
    const file = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    file.version = 3;
    for (const w of file.project.wells) delete w.interpretation.trends;
    for (const s of file.project.snapshots) delete s.interpretation.trends;
    const back = await deserializeProject(JSON.stringify(file));
    expect(trends(back)).toEqual([]);
    expect(back.snapshots[0]!.interpretation.trends).toEqual([]);
  });

  it('al abrir descarta con aviso lo inválido', async () => {
    const p = base();
    const file = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    file.project.wells[0].interpretation.trends = [
      spec(),
      spec({ id: 't1' }), // repetida
      { ...spec({ id: 't3' }), model: 'cuadrática' },
      { ...spec({ id: 't4' }), mode: 'manual' }, // sin puntos
      { ...spec({ id: 't5' }), selection: { top: 'x', excluded: [] } },
      { ...spec({ id: 't6' }), series: null },
      { ...spec({ id: 't7' }), selection: { top: 7800, base: 7700, excluded: ['a', 3] }, color: 'rojo' },
    ];
    const warnings: string[] = [];
    const back = await deserializeProject(JSON.stringify(file), { onWarning: (m) => warnings.push(m) });
    const list = trends(back);
    expect(list.map((t) => t.id)).toEqual(['t1', 't7']);
    expect(list[1]!.selection).toEqual({ top: 7700, base: 7800, excluded: ['a'] });
    expect(list[1]!.color).toBeUndefined();
    expect(warnings.join('\n')).toMatch(/repetida/);
    expect(warnings.join('\n')).toMatch(/cuadrática/);
    expect(warnings.join('\n')).toMatch(/dos puntos/);
    expect(warnings.join('\n')).toMatch(/no numérico/);
    expect(warnings.join('\n')).toMatch(/serie de datos/);
  });

  it('sanitizeTrends tolera ausencia y tipos raros', () => {
    expect(sanitizeTrends(undefined, 'x')).toEqual([]);
    const w: string[] = [];
    expect(sanitizeTrends({}, 'Pozo', (m) => w.push(m))).toEqual([]);
    expect(w[0]).toMatch(/no son una lista/);
  });
});
