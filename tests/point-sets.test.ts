/**
 * Conjuntos de puntos del pozo (docs/decisiones/0009): validación, recetas (deshacer), formato v5 (migración y
 * saneamiento al abrir), ajustes de pistas propias en `display`, pistas propias dinámicas y la conversión de unidades
 * de la capa de tendencias en una pista propia.
 */
import { describe, expect, it } from 'vitest';
import { sameEngineInputs } from '../src/core/interpretation';
import { createPointSet, pointNumbers, pointTexts, sanitizePointSetDecisions, type PointSet } from '../src/core/pointSets';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { addPointSet, removePointSet, renamePointSet, setPointDecision, setPointDecisions, setPointSetDepthShift, setPointSetSetting } from '../src/core/state/pointSets';
import { addWell, createProject, getWellEntry, setOverlaySetting, type Project } from '../src/core/state/project';
import { deserializeProject, PROJECT_VERSION, serializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { sanitizeDisplay } from '../src/core/display';
import { createWell } from '../src/core/well';
import { withOverlayTracks } from '../src/viewer/templates';
import type { ViewerOverlay } from '../src/viewer/overlay';

const W = 'w';

function pressureSet(id = 'mdt1'): PointSet {
  return createPointSet({
    id,
    kind: 'pressure',
    name: 'MDT 1',
    source: 'mdt.xlsx',
    depth: Float64Array.of(1010, 1000, 1020),
    pointIds: ['b', 'a', 'c'],
    columns: {
      pressure: { label: 'P', unit: 'psi', values: Float64Array.of(1465, 1450, NaN) },
      quality: { label: 'Q', values: ['Buena', 'Buena', 'Seca'] },
    },
  });
}

function base(sets: PointSet[] = []): Project {
  const w = createWell({ id: W, name: 'Pozo', depth: Float64Array.from({ length: 50 }, (_, i) => 990 + i), curves: [], pointSets: sets });
  return addWell(createProject(), w);
}

describe('createPointSet', () => {
  it('ordena por profundidad arrastrando ids y columnas', () => {
    const s = pressureSet();
    expect([...s.depth]).toEqual([1000, 1010, 1020]);
    expect(s.pointIds).toEqual(['a', 'b', 'c']);
    expect([...pointNumbers(s, 'pressure')!].slice(0, 2)).toEqual([1450, 1465]);
    expect(pointNumbers(s, 'pressure')![2]).toBeNaN();
    expect(pointTexts(s, 'quality')).toEqual(['Buena', 'Buena', 'Seca']);
    expect(pointNumbers(s, 'quality')).toBeNull();
    expect(pointTexts(s, 'pressure')).toBeNull();
  });

  it('conserva los arrays si ya está ordenado (sin copiar los datos)', () => {
    const depth = Float64Array.of(1, 2, 2, 3); // se admiten profundidades repetidas
    const values = Float64Array.of(4, 5, 6, 7);
    const s = createPointSet({ id: 'x', kind: 'core', name: 'Plugs', depth, pointIds: ['p1', 'p2', 'p3', 'p4'], columns: { phi: { label: 'φ', unit: 'v/v', values } } });
    expect(s.depth).toBe(depth);
    expect(s.columns['phi']!.values).toBe(values);
  });

  it('rechaza en español lo que no cierra', () => {
    const ok = { id: 'x', kind: 'pressure', name: 'X', depth: Float64Array.of(1, 2), pointIds: ['a', 'b'], columns: {} };
    expect(() => createPointSet({ ...ok, id: '' })).toThrow(/no tiene id/);
    expect(() => createPointSet({ ...ok, pointIds: ['a'] })).toThrow(/2 profundidades y 1 ids/);
    expect(() => createPointSet({ ...ok, pointIds: ['a', 'a'] })).toThrow(/dos puntos con el id 'a'/);
    expect(() => createPointSet({ ...ok, depth: Float64Array.of(1, NaN) })).toThrow(/profundidad válida/);
    expect(() => createPointSet({ ...ok, columns: { p: { label: 'P', unit: 'psi', values: Float64Array.of(1) } } })).toThrow(/1 valores y hay 2/);
    expect(() => createPointSet({ ...ok, columns: { p: { label: 'P', values: [1, 2] as unknown as string[] } } })).toThrow(/ni de texto/);
  });

  it('el pozo rechaza ids de conjunto repetidos', () => {
    expect(() => createWell({ id: 'w', name: 'W', depth: Float64Array.of(1, 2), curves: [], pointSets: [pressureSet(), pressureSet()] })).toThrow(/dos conjuntos de puntos/);
  });
});

describe('recetas sobre conjuntos de puntos', () => {
  it('agregar, renombrar y quitar (con sus decisiones)', () => {
    const p0 = base();
    const p1 = addPointSet(p0, W, pressureSet());
    expect(getWellEntry(p1, W).well.pointSets.map((s) => s.id)).toEqual(['mdt1']);
    expect(() => addPointSet(p1, W, pressureSet())).toThrow(/Ya hay un conjunto/);
    const p2 = renamePointSet(p1, W, 'mdt1', '  Corrida 1 ');
    expect(getWellEntry(p2, W).well.pointSets[0]!.name).toBe('Corrida 1');
    expect(renamePointSet(p2, W, 'mdt1', 'Corrida 1')).toBe(p2);
    const p3 = setPointDecision(p2, W, 'mdt1', 'a', { status: 'exclude' });
    const p4 = removePointSet(p3, W, 'mdt1');
    expect(getWellEntry(p4, W).well.pointSets).toEqual([]);
    expect(getWellEntry(p4, W).interpretation.pointSets).toEqual({});
    expect(() => removePointSet(p4, W, 'mdt1')).toThrow(/No existe el conjunto/);
  });

  it('cambiar los puntos conserva las curvas y la profundidad del pozo (el motor no se resincroniza)', () => {
    const p0 = base();
    const p1 = addPointSet(p0, W, pressureSet());
    const w0 = getWellEntry(p0, W).well;
    const w1 = getWellEntry(p1, W).well;
    expect(w1).not.toBe(w0);
    expect(w1.curves).toBe(w0.curves);
    expect(w1.depth).toBe(w0.depth);
    expect(getWellEntry(p1, W).interpretation).toBe(getWellEntry(p0, W).interpretation);
  });

  it('decisiones por punto: parche, borrar, sin cambios = mismo proyecto; no tocan las entradas del motor', () => {
    const p1 = addPointSet(base(), W, pressureSet());
    const p2 = setPointDecision(p1, W, 'mdt1', 'a', { status: 'exclude' });
    expect(getWellEntry(p2, W).interpretation.pointSets['mdt1']).toEqual({ points: { a: { status: 'exclude' } } });
    expect(sameEngineInputs(getWellEntry(p1, W).interpretation, getWellEntry(p2, W).interpretation)).toBe(true);
    expect(setPointDecision(p2, W, 'mdt1', 'a', { status: 'exclude' })).toBe(p2);
    const p3 = setPointDecision(p2, W, 'mdt1', 'a', { tag: 'water' });
    expect(getWellEntry(p3, W).interpretation.pointSets['mdt1']!.points['a']).toEqual({ status: 'exclude', tag: 'water' });
    const p4 = setPointDecision(p3, W, 'mdt1', 'a', { status: undefined, tag: undefined });
    expect(getWellEntry(p4, W).interpretation.pointSets['mdt1']!.points).toEqual({});
    const p5 = setPointDecisions(p3, W, 'mdt1', { a: null, b: { status: 'include' } });
    expect(getWellEntry(p5, W).interpretation.pointSets['mdt1']!.points).toEqual({ b: { status: 'include' } });
    expect(() => setPointDecision(p1, W, 'mdt1', 'zz', { status: 'exclude' })).toThrow(/no tiene el punto 'zz'/);
    expect(() => setPointDecision(p1, W, 'nada', 'a', null)).toThrow(/No existe el conjunto/);
  });

  it('ajustes y puesta en profundidad', () => {
    const p1 = addPointSet(base(), W, pressureSet());
    const p2 = setPointSetSetting(p1, W, 'mdt1', 'minMobility', 0.5);
    expect(getWellEntry(p2, W).interpretation.pointSets['mdt1']!.settings).toEqual({ minMobility: 0.5 });
    expect(setPointSetSetting(p2, W, 'mdt1', 'minMobility', 0.5)).toBe(p2);
    const p3 = setPointSetSetting(p2, W, 'mdt1', 'minMobility', undefined);
    expect(getWellEntry(p3, W).interpretation.pointSets['mdt1']!.settings).toBeUndefined();
    const p4 = setPointSetDepthShift(p3, W, 'mdt1', 1.5);
    expect(getWellEntry(p4, W).interpretation.pointSets['mdt1']!.depthShift).toBe(1.5);
    expect(getWellEntry(setPointSetDepthShift(p4, W, 'mdt1', 0), W).interpretation.pointSets['mdt1']!.depthShift).toBeUndefined();
    expect(() => setPointSetDepthShift(p4, W, 'mdt1', NaN)).toThrow(/número/);
  });

  it('deshacer: el historial vuelve al proyecto anterior (los arrays no se copian)', () => {
    const p0 = addPointSet(base(), W, pressureSet());
    const p1 = setPointDecision(p0, W, 'mdt1', 'a', { status: 'exclude' });
    const h = recordChange(emptyHistory(), p0, 'Descartar punto MDT', 0);
    const back = undo(h, p1)!;
    expect(back.project).toBe(p0);
    expect(back.label).toBe('Descartar punto MDT');
    expect(getWellEntry(back.project, W).well.pointSets[0]!.depth).toBe(getWellEntry(p1, W).well.pointSets[0]!.depth);
  });

  it('snapshots: guardan y restauran las decisiones (no los datos)', () => {
    const p0 = setPointDecision(addPointSet(base(), W, pressureSet()), W, 'mdt1', 'a', { status: 'exclude' });
    const { project: p1, snapshot } = createSnapshot(p0, W, 's');
    expect(snapshot.interpretation.pointSets['mdt1']!.points['a']).toEqual({ status: 'exclude' });
    const p2 = setPointDecision(p1, W, 'mdt1', 'a', null);
    const p3 = restoreSnapshot(p2, snapshot.id);
    expect(getWellEntry(p3, W).interpretation.pointSets['mdt1']!.points['a']).toEqual({ status: 'exclude' });
    expect(getWellEntry(p3, W).well).toBe(getWellEntry(p2, W).well);
  });
});

describe('formato v5', () => {
  it('guarda y abre conjuntos (numéricos y de texto, NaN incluido) y decisiones, exactos', async () => {
    expect(PROJECT_VERSION).toBe(6);
    const p = setPointSetSetting(setPointDecision(addPointSet(base(), W, { ...pressureSet(), synthetic: true }), W, 'mdt1', 'a', { status: 'exclude', tag: 'oil' }), W, 'mdt1', 'minMobility', 2);
    for (const codec of ['f64le-b64', 'auto'] as const) {
      const back = await deserializeProject(await serializeProject(p, { codec }));
      const s = getWellEntry(back, W).well.pointSets[0]!;
      const s0 = getWellEntry(p, W).well.pointSets[0]!;
      expect(s.id).toBe('mdt1');
      expect(s.synthetic).toBe(true);
      expect(s.source).toBe('mdt.xlsx');
      expect([...s.depth]).toEqual([...s0.depth]);
      expect(s.pointIds).toEqual(s0.pointIds);
      expect(Object.is(pointNumbers(s, 'pressure')![2], NaN)).toBe(true);
      expect(s.columns['pressure']).toMatchObject({ unit: 'psi', label: 'P' });
      expect(pointTexts(s, 'quality')).toEqual(['Buena', 'Buena', 'Seca']);
      expect(getWellEntry(back, W).interpretation.pointSets).toEqual(getWellEntry(p, W).interpretation.pointSets);
    }
  });

  it('migra un archivo v4 (sin conjuntos de puntos) en pozos y snapshots', async () => {
    const p = createSnapshot(base(), W, 's').project;
    const file = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    file.version = 4;
    for (const w of file.project.wells) {
      delete w.well.pointSets;
      delete w.interpretation.pointSets;
    }
    for (const s of file.project.snapshots) delete s.interpretation.pointSets;
    const back = await deserializeProject(JSON.stringify(file));
    expect(getWellEntry(back, W).well.pointSets).toEqual([]);
    expect(getWellEntry(back, W).interpretation.pointSets).toEqual({});
    expect(back.snapshots[0]!.interpretation.pointSets).toEqual({});
  });

  it('al abrir descarta con aviso lo inválido sin perder el resto del proyecto', async () => {
    const p = addPointSet(addPointSet(base(), W, pressureSet()), W, pressureSet('mdt2'));
    const file = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    const sets = file.project.wells[0].well.pointSets;
    sets[1].pointIds = ['a', 'a', 'c']; // ids repetidos → se descarta este conjunto
    sets.push({ ...sets[0] }); // repetido → se descarta
    sets[0].columns.raro = { label: 'X', algo: 1 }; // columna inválida → se descarta la columna
    file.project.wells[0].interpretation.pointSets = {
      mdt1: { points: { a: { status: 'tal vez' }, b: { status: 'include', tag: 3 }, c: 'x' }, depthShift: 'dos', settings: { minMobility: 1, f: null } },
      roto: 5,
    };
    const warnings: string[] = [];
    const back = await deserializeProject(JSON.stringify(file), { onWarning: (m) => warnings.push(m) });
    const e = getWellEntry(back, W);
    expect(e.well.pointSets.map((s) => s.id)).toEqual(['mdt1']);
    expect(Object.keys(e.well.pointSets[0]!.columns).sort()).toEqual(['pressure', 'quality']);
    expect(e.interpretation.pointSets).toEqual({ mdt1: { points: { b: { status: 'include' } }, settings: { minMobility: 1 } } });
    const all = warnings.join('\n');
    expect(all).toMatch(/dos puntos con el id 'a'/);
    expect(all).toMatch(/repetido/);
    expect(all).toMatch(/columna 'raro'/);
    expect(all).toMatch(/decisiones inválidas/);
    expect(all).toMatch(/puesta en profundidad/);
    expect(all).toMatch(/'roto'/);
  });

  it('una columna con otro largo, sin unidad o ilegible se descarta sola: el conjunto se conserva', async () => {
    const p = addPointSet(base(), W, pressureSet());
    const file = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    const cols = file.project.wells[0].well.pointSets[0].columns;
    cols.quality.text.pop(); // 2 valores para 3 puntos
    cols.p2 = { ...cols.pressure, unit: '' }; // sin unidad: adimensional
    cols.p3 = { ...cols.pressure, values: { ...cols.pressure.values, codec: 'otro' } }; // ilegible
    const warnings: string[] = [];
    const back = await deserializeProject(JSON.stringify(file), { onWarning: (m) => warnings.push(m) });
    const s = getWellEntry(back, W).well.pointSets[0]!;
    expect(s.pointIds).toEqual(['a', 'b', 'c']);
    expect(Object.keys(s.columns).sort()).toEqual(['p2', 'pressure']);
    expect(s.columns['p2']).toMatchObject({ unit: 'unitless' });
    const all = warnings.join('\n');
    expect(all).toMatch(/columna 'quality' tiene 2 valores y hay 3 puntos; se descarta la columna\./);
    expect(all).toMatch(/columna 'p3' es inválida/);
    expect(all).not.toMatch(/\.;/);
  });

  it('sanitizePointSetDecisions: nulo o vacío → {}', () => {
    expect(sanitizePointSetDecisions(undefined, 'x')).toEqual({});
    expect(sanitizePointSetDecisions([], 'x')).toEqual({});
  });
});

describe('ajustes de pistas propias en display', () => {
  it('receta, saneamiento y guardado', async () => {
    const p0 = base();
    const p1 = setOverlaySetting(p0, 'mdt', 'unit', 'bar');
    expect(p1.display.overlays).toEqual({ mdt: { unit: 'bar' } });
    expect(setOverlaySetting(p1, 'mdt', 'unit', 'bar')).toBe(p1);
    const p2 = setOverlaySetting(p1, 'mdt', 'unit', undefined);
    expect(p2.display.overlays).toBeUndefined();
    expect(getWellEntry(p1, W).interpretation).toBe(getWellEntry(p0, W).interpretation);
    const back = await deserializeProject(await serializeProject(p1, { codec: 'f64le-b64' }));
    expect(back.display.overlays).toEqual({ mdt: { unit: 'bar' } });
    const warn: string[] = [];
    expect(sanitizeDisplay({ overlays: { a: 3, b: { unit: 'psi', x: null, y: [1] } } }, (m) => warn.push(m)).overlays).toEqual({ b: { unit: 'psi' } });
    expect(warn.join()).toMatch(/pista 'a'/);
  });
});

describe('pistas propias con escala según los datos', () => {
  const decl = (resolve?: NonNullable<ViewerOverlay['track']>['resolve']): ViewerOverlay => ({
    id: 'p',
    label: 'P',
    layer: 'over',
    draw: () => {},
    track: { title: 'Presión', scale: { kind: 'linear', min: 0, max: 1 }, unit: 'psi', after: 'b', ...(resolve ? { resolve } : {}) },
  });
  const layout = [
    { id: 'a', title: 'A', kind: 'curves' as const },
    { id: 'b', title: 'B', kind: 'curves' as const },
    { id: 'c', title: 'C', kind: 'curves' as const },
  ];
  const well = getWellEntry(addPointSet(base(), W, pressureSet()), W).well;

  it('sin `resolve` o sin contexto: la escala declarada', () => {
    const out = withOverlayTracks(layout, [decl()], 'petrophysics', { well });
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'ov:p', 'c']);
    expect(out[2]!.scale).toEqual({ kind: 'linear', min: 0, max: 1 });
  });

  it('con `resolve`: escala, unidad y título del pozo y de los ajustes; null oculta la pista', () => {
    const seen: unknown[] = [];
    const o = decl(({ well: w, settings }) => {
      seen.push(settings);
      return w.pointSets.length ? { scale: { kind: 'linear', min: 1400, max: 1500 }, unit: String(settings['unit'] ?? 'psi') } : null;
    });
    const out = withOverlayTracks(layout, [o], 'petrophysics', { well, settings: { p: { unit: 'bar' } } });
    expect(out[2]).toMatchObject({ id: 'ov:p', scale: { kind: 'linear', min: 1400, max: 1500 }, unit: 'bar', title: 'Presión' });
    expect(seen).toEqual([{ unit: 'bar' }]);
    const empty = getWellEntry(base(), W).well;
    expect(withOverlayTracks(layout, [o], 'petrophysics', { well: empty }).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    // una pista guardada en un diseño propio también se actualiza (u oculta)
    const saved = [...layout, { id: 'ov:p', title: 'Vieja', kind: 'overlay' as const, overlayId: 'p', scale: { kind: 'linear' as const, min: 0, max: 1 } }];
    expect(withOverlayTracks(saved, [o], 'petrophysics', { well }).at(-1)).toMatchObject({ title: 'Vieja', scale: { min: 1400, max: 1500 }, unit: 'psi' });
    expect(withOverlayTracks(saved, [o], 'petrophysics', { well: empty }).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('una escala inválida o un error en `resolve` cae en la declarada', () => {
    const bad = decl(() => ({ scale: { kind: 'linear', min: 5, max: 5 } }));
    expect(withOverlayTracks(layout, [bad], 'petrophysics', { well })[2]!.scale).toEqual({ kind: 'linear', min: 0, max: 1 });
    const boom = decl(() => {
      throw new Error('x');
    });
    const err = console.error;
    console.error = () => {};
    try {
      expect(withOverlayTracks(layout, [boom], 'petrophysics', { well })[2]!.scale).toEqual({ kind: 'linear', min: 0, max: 1 });
    } finally {
      console.error = err;
    }
  });
});
