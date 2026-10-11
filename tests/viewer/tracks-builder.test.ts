/**
 * Pistas armables y plantillas propias (docs/decisiones/0016): recetas puras, catálogo, resolución en modo edición,
 * guardado y compatibilidad con proyectos anteriores.
 */
import { describe, expect, it } from 'vitest';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import type { TrackSpec } from '../../src/core/display';
import { sanitizeDisplay } from '../../src/core/display';
import { addWell, createProject } from '../../src/core/state/project';
import { deserializeProject, serializeProject } from '../../src/core/state/serialize';
import {
  addCurveToTrack,
  addTrack,
  applyTrackTemplate,
  canonicalJson,
  deleteTrackTemplate,
  entryIndexFor,
  expandGroupEntry,
  findTrackTemplate,
  layoutsEqual,
  moveCurveEntry,
  moveTrack,
  removeCurveEntry,
  removeTrack,
  renameTrack,
  renameTrackTemplate,
  reorderCurveEntry,
  resetTrackLayout,
  saveTrackTemplate,
  setTrackWidth,
  showTrack,
  trackTemplatesFor,
  TRACK_WIDTH_RANGE,
  uniqueTrackId,
  updateTrackLayout,
} from '../../src/core/state/tracks';
import { defaultRoleCatalog } from '../../src/core/roles';
import { createWell } from '../../src/core/well';
import { buildTrackCatalog, curveEntryOf, filterCatalog, trackForCurve } from '../../src/viewer/catalog';
import type { ViewerOverlay } from '../../src/viewer/overlay';
import { layoutTracks } from '../../src/viewer/layout';
import { resolveTracks } from '../../src/viewer/resolve';
import { BUILTIN_LAYOUTS, withOverlayTracks } from '../../src/viewer/templates';

const PETRO = BUILTIN_LAYOUTS.petrophysics as TrackSpec[];
const ids = (ts: readonly TrackSpec[]) => ts.map((t) => t.id);
const track = (ts: readonly TrackSpec[], id: string) => ts.find((t) => t.id === id)!;
const sel = (t: TrackSpec) => (t.curves ?? []).map((c) => ('role' in c.select ? c.select.role : 'curveId' in c.select ? `#${c.select.curveId}` : `*${c.select.unassigned}`));

const demo = syntheticWell(200);
const base = () => addWell(createProject('P'), demo.well, demo.zones);

describe('recetas de pistas', () => {
  it('agregar pistas: antes de otra o al final, con id único legible', () => {
    const t: TrackSpec = { id: uniqueTrackId(PETRO, 'Caliper'), title: 'Caliper', kind: 'curves', curves: [] };
    expect(t.id).toBe('u-caliper');
    const a = addTrack(PETRO, t, 'sonic');
    expect(ids(a).indexOf('u-caliper')).toBe(ids(a).indexOf('sonic') - 1);
    expect(ids(addTrack(PETRO, t, null)).at(-1)).toBe('u-caliper');
    // id repetido: se le da otro
    const b = addTrack(a, { ...t }, null);
    expect(ids(b).filter((x) => x.startsWith('u-caliper'))).toEqual(['u-caliper', 'u-caliper-2']);
    expect(uniqueTrackId([], 'Densidad · neutrón')).toBe('u-densidad-neutron');
    expect(PETRO).toBe(BUILTIN_LAYOUTS.petrophysics); // nunca muta la de fábrica
  });

  it('mover, quitar, mostrar, ancho y nombre', () => {
    const m = moveTrack(PETRO, 'sonic', 'correlation');
    expect(ids(m).slice(0, 2)).toEqual(['sonic', 'correlation']);
    expect(ids(moveTrack(PETRO, 'correlation', null)).at(-1)).toBe('correlation');
    // a donde ya está: misma lista
    expect(moveTrack(PETRO, 'depth', 'resistivity')).toBe(PETRO);
    expect(moveTrack(PETRO, 'depth', 'depth')).toBe(PETRO);
    expect(() => moveTrack(PETRO, 'nada', null)).toThrow(/No existe la pista/);

    expect(ids(removeTrack(PETRO, 'sonic'))).not.toContain('sonic');
    const withOv = [...PETRO, { id: 'ov:mdt', title: 'Presión', kind: 'overlay', overlayId: 'mdt' } as TrackSpec];
    const hidden = removeTrack(withOv, 'ov:mdt');
    expect(track(hidden, 'ov:mdt').hidden).toBe(true); // las de superposición quedan ocultas
    const shown = showTrack(hidden, 'ov:mdt', 'resistivity');
    expect(track(shown, 'ov:mdt').hidden).toBeUndefined();
    expect(ids(shown).indexOf('ov:mdt')).toBe(ids(shown).indexOf('resistivity') - 1);

    expect(track(setTrackWidth(PETRO, 'sonic', 1.234), 'sonic').width).toBe(1.23);
    expect(track(setTrackWidth(PETRO, 'sonic', 99), 'sonic').width).toBe(TRACK_WIDTH_RANGE.max);
    expect(track(setTrackWidth(PETRO, 'sonic', 0), 'sonic').width).toBe(TRACK_WIDTH_RANGE.min);
    expect(setTrackWidth(PETRO, 'depth', 2)).toBe(PETRO); // ancho fijo
    expect(setTrackWidth(PETRO, 'sonic', 0.8)).toBe(PETRO); // sin cambio
    expect(track(renameTrack(PETRO, 'sonic', '  Acústico '), 'sonic').title).toBe('Acústico');
    expect(renameTrack(PETRO, 'sonic', '   ')).toBe(PETRO);
  });

  it('agregar una curva: arriba por defecto, en una posición, sin duplicar, con sus rellenos sin repetir', () => {
    const a = addCurveToTrack(PETRO, 'sonic', { select: { role: 'GR' }, style: { wrap: true }, fills: [{ kind: 'edge', curve: 'GR', side: 'left', fill: 'shale' }] });
    expect(sel(track(a, 'sonic'))).toEqual(['DT', 'DTS', 'GR']);
    expect(track(a, 'sonic').curves!.at(-1)!.style).toEqual({ wrap: true });
    expect(track(a, 'sonic').fills).toHaveLength(1);
    // otra vez, en la posición 0: se reubica (no se duplica) y el relleno no se repite
    const b = addCurveToTrack(a, 'sonic', { select: { role: 'GR' }, fills: [{ kind: 'edge', curve: 'GR', side: 'left', fill: 'shale' }] }, 0);
    expect(sel(track(b, 'sonic'))).toEqual(['GR', 'DT', 'DTS']);
    expect(track(b, 'sonic').fills).toHaveLength(1);
    // igual que estaba: misma lista
    expect(addCurveToTrack(b, 'sonic', { select: { role: 'GR' } }, 0)).toBe(b);
    expect(() => addCurveToTrack(PETRO, 'depth', { select: { role: 'GR' } })).toThrow(/no acepta curvas/);
    expect(() => addCurveToTrack(PETRO, 'volumetric', { select: { role: 'GR' } })).toThrow(/no acepta curvas/);
  });

  it('reordenar dentro de la pista', () => {
    // Densidad · neutrón: DRHO, PEF, NPHI, RHOB (RHOB arriba). Subir PEF un lugar = después de NPHI.
    const r = reorderCurveEntry(PETRO, 'porosity', 1, 3);
    expect(sel(track(r, 'porosity'))).toEqual(['DRHO', 'NPHI', 'PEF', 'RHOB']);
    expect(sel(track(reorderCurveEntry(PETRO, 'porosity', 3, 0), 'porosity'))).toEqual(['RHOB', 'DRHO', 'PEF', 'NPHI']);
    expect(reorderCurveEntry(PETRO, 'porosity', 1, 1)).toBe(PETRO);
    expect(reorderCurveEntry(PETRO, 'porosity', 1, 2)).toBe(PETRO);
  });

  it('mover una curva entre pistas: los rellenos de una curva viajan; los de dos se copian si quedan las dos', () => {
    // GR sale de Correlación con su arcilla/arena; el derrumbe (BS–CALI) se queda.
    const a = moveCurveEntry(PETRO, 'correlation', 3, 'sonic');
    expect(sel(track(a, 'correlation'))).toEqual(['BS', 'CALI', 'SP']);
    expect(track(a, 'correlation').fills!.map((f) => f.kind)).toEqual(['between']);
    expect(sel(track(a, 'sonic'))).toEqual(['DT', 'DTS', 'GR']);
    expect(track(a, 'sonic').fills!.filter((f) => f.kind === 'edge' && f.curve === 'GR')).toHaveLength(2);
    expect(track(a, 'sonic').curves!.at(-1)!.style).toEqual({ wrap: true });

    // NPHI a una pista con RHOB: el cruce se copia; en el origen queda latente (vuelve si vuelve NPHI).
    const withRhob = addTrack(PETRO, { id: 'u-d', title: 'D', kind: 'curves', curves: [{ select: { role: 'RHOB' } }] }, null);
    const b = moveCurveEntry(withRhob, 'porosity', 2, 'u-d');
    expect(sel(track(b, 'u-d'))).toEqual(['RHOB', 'NPHI']);
    expect(track(b, 'u-d').fills).toEqual([expect.objectContaining({ kind: 'between', a: 'RHOB', b: 'NPHI' })]);
    expect(track(b, 'porosity').fills).toHaveLength(1);
    // mover a una pista sin RHOB: el cruce no se copia
    const c = moveCurveEntry(PETRO, 'porosity', 2, 'sonic');
    expect(track(c, 'sonic').fills ?? []).toHaveLength(0);
    // a la misma pista = reordenar; a una pista que no acepta curvas, error
    expect(sel(track(moveCurveEntry(PETRO, 'porosity', 1, 'porosity', 4), 'porosity'))).toEqual(['DRHO', 'NPHI', 'RHOB', 'PEF']);
    expect(() => moveCurveEntry(PETRO, 'porosity', 1, 'depth')).toThrow(/no acepta curvas/);
  });

  it('quitar una curva se lleva sus rellenos de una curva', () => {
    const a = removeCurveEntry(PETRO, 'correlation', 3);
    expect(sel(track(a, 'correlation'))).toEqual(['BS', 'CALI', 'SP']);
    expect(track(a, 'correlation').fills!.some((f) => f.kind === 'edge')).toBe(false);
    const b = removeCurveEntry(PETRO, 'saturation', 1); // SW con su relleno de hidrocarburo
    expect(track(b, 'saturation').fills).toEqual([]);
    expect(() => removeCurveEntry(PETRO, 'correlation', 9)).toThrow(/no tiene la curva/);
  });

  it('una entrada de grupo se expande en curvas puntuales para mover o quitar una sola', () => {
    const res = track(PETRO, 'resistivity');
    expect(sel(res)).toEqual(['RXO', '*resistivity', 'RS', 'RM', 'RT']);
    const e = expandGroupEntry(PETRO, 'resistivity', 1, ['AT10', 'AT20', 'RS']);
    expect(sel(track(e, 'resistivity'))).toEqual(['RXO', '#AT10', '#AT20', '#RS', 'RS', 'RM', 'RT']);
    const moved = moveCurveEntry(e, 'resistivity', 2, 'sonic');
    expect(sel(track(moved, 'resistivity'))).toEqual(['RXO', '#AT10', '#RS', 'RS', 'RM', 'RT']);
    expect(sel(track(moved, 'sonic'))).toEqual(['DT', 'DTS', '#AT20']);
    expect(expandGroupEntry(PETRO, 'resistivity', 0, ['X'])).toBe(PETRO); // no es grupo
  });

  it('qué entrada puso cada curva dibujada', () => {
    const res = track(PETRO, 'resistivity');
    expect(entryIndexFor(res, { role: 'RT', curveId: 'AT90', origin: 'measured' })).toBe(4);
    expect(entryIndexFor(res, { role: null, curveId: 'AT10', origin: 'measured' })).toBe(1);
    expect(entryIndexFor(track(PETRO, 'computed'), { role: 'VSH', origin: 'computed' })).toBe(0);
    expect(entryIndexFor(track(PETRO, 'computed'), { role: 'PHIT', origin: 'computed' })).toBe(-1); // la tomó el recolector
    const byId: TrackSpec = { id: 'x', title: 'X', kind: 'curves', curves: [{ select: { role: 'GR' } }, { select: { curveId: 'GR2' } }] };
    expect(entryIndexFor(byId, { role: 'GR', curveId: 'GR2', origin: 'measured' })).toBe(1);
  });

  it('comparar pistas sin importar el orden de las claves', () => {
    expect(layoutsEqual([{ id: 'a', title: 'A', kind: 'depth' }], [{ kind: 'depth', title: 'A', id: 'a' }])).toBe(true);
    expect(layoutsEqual([{ id: 'a', title: 'A', kind: 'depth' }], [{ id: 'a', title: 'B', kind: 'depth' }])).toBe(false);
    expect(canonicalJson({ b: 1, a: undefined, c: [{ y: 1, x: 2 }] })).toBe('{"b":1,"c":[{"x":2,"y":1}]}');
  });
});

describe('pistas y plantillas en el proyecto', () => {
  it('updateTrackLayout guarda la lista editada; sin cambios devuelve el mismo proyecto', () => {
    const p = base();
    expect(updateTrackLayout(p, 'petrophysics', PETRO, (t) => t)).toBe(p);
    const q = updateTrackLayout(p, 'petrophysics', PETRO, (t) => moveTrack(t, 'sonic', null));
    expect(ids(q.display.layouts['petrophysics']!).at(-1)).toBe('sonic');
    expect(q.wells).toBe(p.wells);
    expect(resetTrackLayout(q, 'petrophysics').display.layouts).toEqual({});
  });

  it('guardar, reemplazar por nombre, aplicar, renombrar, borrar', () => {
    const mine = moveTrack(PETRO, 'sonic', null);
    let p = saveTrackTemplate(base(), { id: 'tpl-1', name: ' Mi plantilla ', workspace: 'petrophysics', tracks: mine, savedAt: '2026-10-10T00:00:00Z' });
    expect(p.display.trackTemplates).toEqual([{ id: 'tpl-1', name: 'Mi plantilla', workspace: 'petrophysics', tracks: mine, savedAt: '2026-10-10T00:00:00Z' }]);
    // mismo nombre (sin distinguir mayúsculas) y espacio: reemplaza las pistas y conserva el id
    p = saveTrackTemplate(p, { id: 'tpl-2', name: 'MI PLANTILLA', workspace: 'petrophysics', tracks: PETRO });
    expect(p.display.trackTemplates).toHaveLength(1);
    expect(p.display.trackTemplates![0]!.id).toBe('tpl-1');
    expect(p.display.trackTemplates![0]!.tracks).toEqual(PETRO);
    // otro espacio: otra plantilla
    p = saveTrackTemplate(p, { id: 'tpl-3', name: 'Mi plantilla', workspace: 'geology', tracks: BUILTIN_LAYOUTS.geology });
    expect(trackTemplatesFor(p, 'petrophysics').map((t) => t.id)).toEqual(['tpl-1']);
    expect(findTrackTemplate(p, 'geology', 'mi plantilla')?.id).toBe('tpl-3');

    p = saveTrackTemplate(p, { id: 'tpl-1', name: 'Mi plantilla', workspace: 'petrophysics', tracks: mine });
    const applied = applyTrackTemplate(p, 'tpl-1');
    expect(applied.display.layouts['petrophysics']).toEqual(mine);
    expect(applyTrackTemplate(applied, 'tpl-1')).toBe(applied); // ya aplicada
    expect(() => applyTrackTemplate(p, 'nada')).toThrow(/No existe/);

    expect(() => saveTrackTemplate(p, { id: 'x', name: '  ', workspace: 'petrophysics', tracks: mine })).toThrow(/nombre/);
    expect(() => saveTrackTemplate(p, { id: 'x', name: 'Vacía', workspace: 'petrophysics', tracks: [] })).toThrow(/pistas/);

    const r = renameTrackTemplate(p, 'tpl-1', 'Correlación larga');
    expect(findTrackTemplate(r, 'petrophysics', 'correlación larga')?.id).toBe('tpl-1');
    const r2 = saveTrackTemplate(r, { id: 'tpl-4', name: 'Otra', workspace: 'petrophysics', tracks: PETRO });
    expect(() => renameTrackTemplate(r2, 'tpl-4', 'correlación LARGA')).toThrow(/Ya hay/);
    expect(renameTrackTemplate(r2, 'tpl-4', 'Otra')).toBe(r2);

    const d = deleteTrackTemplate(deleteTrackTemplate(deleteTrackTemplate(r2, 'tpl-1'), 'tpl-3'), 'tpl-4');
    expect(d.display.trackTemplates).toBeUndefined(); // sin plantillas, el campo desaparece
    expect(deleteTrackTemplate(d, 'tpl-1')).toBe(d);
  });

  it('se guardan y se abren igual (pistas ocultas y plantillas)', async () => {
    const mine = removeTrack([...moveTrack(PETRO, 'sonic', null), { id: 'ov:mdt', title: 'Presión', kind: 'overlay', overlayId: 'mdt', scale: { kind: 'linear', min: 0, max: 1 } }], 'ov:mdt');
    let p = updateTrackLayout(base(), 'petrophysics', PETRO, () => mine);
    p = saveTrackTemplate(p, { id: 'tpl-1', name: 'Mi plantilla', workspace: 'petrophysics', tracks: mine, savedAt: '2026-10-10T00:00:00Z' });
    const back = await deserializeProject(await serializeProject(p, { codec: 'f64le-b64' }));
    expect(back.display).toEqual(p.display);
    expect(track(back.display.layouts['petrophysics']!, 'ov:mdt').hidden).toBe(true);
  });

  it('un proyecto anterior (v6 sin plantillas, v2 sin display) se abre con los valores por defecto', async () => {
    const text = await serializeProject(base(), { codec: 'f64le-b64' });
    const file = JSON.parse(text);
    delete file.project.display.trackTemplates;
    const v6 = await deserializeProject(JSON.stringify(file));
    expect(v6.display.trackTemplates).toBeUndefined();
    expect(v6.display.layouts).toEqual({});
    const v2 = { ...file, version: 2, project: { ...file.project } };
    delete v2.project.display;
    const old = await deserializeProject(JSON.stringify(v2));
    expect(old.display).toEqual({ layouts: {}, roles: {}, curves: {} });
  });

  it('al abrir, las plantillas inválidas se descartan con aviso y las válidas se conservan', () => {
    const warnings: string[] = [];
    const out = sanitizeDisplay(
      {
        layouts: {},
        roles: {},
        curves: {},
        trackTemplates: [
          { id: 'a', name: 'Buena', workspace: 'petrophysics', tracks: [{ id: 'd', title: 'Prof.', kind: 'depth' }, { id: 'x', title: 'Mala' }], savedAt: '2026-01-01' },
          { id: 'a', name: 'Repetida', workspace: 'petrophysics', tracks: [{ id: 'd', title: 'Prof.', kind: 'depth' }] },
          { id: 'b', name: '', workspace: 'petrophysics', tracks: [] },
          { id: 'c', name: 'Sin pistas válidas', workspace: 'petrophysics', tracks: [{ id: 'x' }] },
          'basura',
        ],
      },
      (m) => warnings.push(m),
    );
    expect(out.trackTemplates).toEqual([{ id: 'a', name: 'Buena', workspace: 'petrophysics', tracks: [{ id: 'd', title: 'Prof.', kind: 'depth' }], savedAt: '2026-01-01' }]);
    expect(warnings.length).toBe(6); // pista mala, id repetido, sin nombre, pista mala + sin pistas, basura
    expect(sanitizeDisplay({ trackTemplates: 'x' }, (m) => warnings.push(m)).trackTemplates).toBeUndefined();
    // `hidden` solo se acepta como true
    expect(sanitizeDisplay({ layouts: { petrophysics: [{ id: 'd', title: 'P', kind: 'depth', hidden: 'sí' }] } }).layouts['petrophysics']![0]!.hidden).toBeUndefined();
  });
});

describe('resolución y superposiciones en modo edición', () => {
  const src = { depth: demo.well.depth.values, curves: demo.well.curves, computed: [], catalog: defaultRoleCatalog };

  it('las pistas ocultas no se resuelven; keepEmpty muestra las que se ocultan vacías como latentes', () => {
    const normal = resolveTracks(PETRO, src);
    expect(normal.map((t) => t.id)).not.toContain('saturation');
    const edit = resolveTracks(PETRO, src, {}, { keepEmpty: true });
    expect(edit.filter((t) => t.latent).map((t) => t.id)).toEqual(['saturation', 'permeability', 'flags', 'indicators']);
    const hidden = resolveTracks(PETRO.map((t) => (t.id === 'sonic' ? { ...t, hidden: true } : t)), src);
    expect(hidden.map((t) => t.id)).not.toContain('sonic');
  });

  it('una pista de superposición oculta no vuelve a agregarse sola', () => {
    const ov: ViewerOverlay = { id: 'mdt', label: 'MDT', layer: 'over', draw() {}, track: { title: 'Presión', scale: { kind: 'linear', min: 0, max: 10 }, after: 'depth' } };
    const auto = withOverlayTracks(PETRO, [ov], 'petrophysics');
    expect(ids(auto)).toContain('ov:mdt');
    const hidden = removeTrack(auto, 'ov:mdt');
    const again = withOverlayTracks(hidden, [ov], 'petrophysics');
    expect(again.filter((t) => t.overlayId === 'mdt')).toHaveLength(1);
    expect(resolveTracks(again, src).map((t) => t.id)).not.toContain('ov:mdt');
  });
});

describe('anchos', () => {
  it('con weightedMin, una pista ancha sigue siendo más ancha aunque las pistas no entren', () => {
    const tracks = [{ width: 1 }, { width: 2 }, { width: 0.5 }, { fixed: 50 }];
    // Entran: proporcional (sin cambios).
    expect(layoutTracks(tracks, 1000, 100, { weightedMin: true }).boxes.map((b) => b.width)).toEqual(layoutTracks(tracks, 1000, 100).boxes.map((b) => b.width));
    // No entran: sin la opción todas quedan en el mínimo; con la opción la de ancho 2 mide el doble.
    expect(layoutTracks(tracks, 200, 100).boxes.map((b) => b.width)).toEqual([100, 100, 100, 50]);
    expect(layoutTracks(tracks, 200, 100, { weightedMin: true }).boxes.map((b) => b.width)).toEqual([100, 200, 100, 50]);
  });
});

describe('catálogo de herramientas y curvas', () => {
  const extra = createWell({
    id: 'w',
    name: 'W',
    depth: demo.well.depth.values,
    curves: [...demo.well.curves, { id: 'AT30', mnemonic: 'AT30', role: null, unit: 'ohm.m', data: new Float64Array(200), description: 'Inducción 30 in', origin: { kind: 'measured', source: 'test' } }],
  });
  const groups = buildTrackCatalog({ roles: defaultRoleCatalog, curves: extra.curves, producible: new Set(['VSH', 'PHIE', 'SW', 'NET_PAY']), computed: new Set(['VSH']) });
  const find = (id: string) => groups.flatMap((g) => g.curves.map((c) => ({ ...c, group: g.id }))).find((c) => c.id === id);

  it('agrupa por herramienta, con colores y escalas de convención, y marca lo que el pozo no tiene', () => {
    expect(groups.map((g) => g.id)).toEqual(['special', 'gr-sp', 'caliper', 'resistivity', 'density-neutron', 'sonic', 'spectral', 'nmr', 'computed', 'flags']);
    expect(find('r:GR')).toMatchObject({ group: 'gr-sp', status: 'present', available: true, mnemonics: ['GR'], style: { wrap: true } });
    expect(find('r:RHOB')).toMatchObject({ group: 'density-neutron', mnemonics: ['ZDEN'] });
    expect(find('r:DTS')).toMatchObject({ group: 'sonic', status: 'missing', available: false });
    expect(find('r:VSH')).toMatchObject({ group: 'computed', status: 'computed', available: true, origin: 'computed' });
    expect(find('r:PHIE')).toMatchObject({ status: 'computable', available: true });
    expect(find('r:PHIT')).toBeUndefined(); // ni medida ni calculable: no se lista
    expect(find('r:NET_PAY')).toMatchObject({ group: 'flags', flag: true });
    // Resistividad sin rol: por mnemónico, en su grupo y con escala log de la pista
    expect(find('c:AT30')).toMatchObject({ group: 'resistivity', select: { curveId: 'AT30' }, trackScale: { kind: 'log', min: 0.2, max: 2000 } });
    // herramientas
    const tools = groups.flatMap((g) => g.tools);
    expect(tools.find((t) => t.id === 'tool:nmr')).toMatchObject({ available: false });
    expect(tools.find((t) => t.id === 'tool:density-neutron')!.track).toMatchObject({ kind: 'curves', fills: [expect.objectContaining({ kind: 'between' })] });
    expect(tools.find((t) => t.id === 'special:depth')).toMatchObject({ available: true, track: { kind: 'depth' } });
  });

  it('una curva suelta lleva su selector, estilo y rellenos propios; en una pista nueva se ve como en la de fábrica', () => {
    const gr = find('r:GR')!;
    expect(curveEntryOf(gr)).toMatchObject({ select: { role: 'GR' }, style: { wrap: true }, fills: [expect.objectContaining({ side: 'left' }), expect.objectContaining({ side: 'right' })] });
    expect(trackForCurve(gr, 'GR')).toMatchObject({ kind: 'curves', curves: [{ select: { role: 'GR' }, style: { wrap: true } }] });
    expect(trackForCurve(find('c:AT30')!, 'AT30').scale).toEqual({ kind: 'log', min: 0.2, max: 2000 });
    expect(trackForCurve(find('r:NET_PAY')!, 'Pay').kind).toBe('flags');
  });

  it('búsqueda sin acentos por nombre, rol, mnemónico o grupo', () => {
    expect(filterCatalog(groups, 'neutron').flatMap((g) => g.curves.map((c) => c.id))).toContain('r:NPHI');
    expect(filterCatalog(groups, 'zden').flatMap((g) => g.curves.map((c) => c.id))).toEqual(['r:RHOB']);
    expect(filterCatalog(groups, 'sonico')[0]!.id).toBe('sonic'); // el grupo entero
    expect(filterCatalog(groups, 'xyz123')).toEqual([]);
    expect(filterCatalog(groups, '  ')).toHaveLength(groups.length);
  });
});
