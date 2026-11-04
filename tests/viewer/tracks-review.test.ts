/**
 * Correcciones de la revisión de pistas armables (docs/decisiones/0016): acciones de la app sobre el proyecto
 * (expansión de grupos con curvas ocultas, curvas de un recolector, una entrada de historial por gesto), anchos
 * acotados y validación de plantillas al abrir.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import { useProject } from '../../src/app/store/project';
import { createLayoutEditor, materializedLayout } from '../../src/app/tracks/actions';
import { sanitizeDisplay, TRACK_WIDTH_RANGE, type TrackSpec } from '../../src/core/display';
import { defaultRoleCatalog } from '../../src/core/roles';
import { addWell, createProject, setCurveDisplay, type Project } from '../../src/core/state/project';
import { addCurveToTrack, fillKey } from '../../src/core/state/tracks';
import { createWell, type Curve } from '../../src/core/well';
import { layoutTracks } from '../../src/viewer/layout';
import { resolveTracks, type ComputedCurve } from '../../src/viewer/resolve';

const demo = syntheticWell(200);
const n = demo.well.depth.values.length;
const at = (id: string): Curve => ({ id, mnemonic: id, role: null, unit: 'ohm.m', data: new Float64Array(n).fill(10), origin: { kind: 'measured', source: 'test' } });
const well = createWell({ id: 'w', name: 'W', depth: demo.well.depth.values, curves: [...demo.well.curves.filter((c) => !['AT30', 'AT60'].includes(c.id)), at('AT20'), at('AT30'), at('AT60')] });
const vsh: ComputedCurve = { port: 'VSH', moduleId: 'vsh', label: 'VSH', data: new Float64Array(n).fill(0.3), active: true };
const phit: ComputedCurve = { port: 'PHIT', moduleId: 'phit', label: 'PHIT', data: new Float64Array(n).fill(0.2), active: true };
const WS = 'petrophysics' as const;

function editorFor(p: Project, computed: ComputedCurve[] = []) {
  useProject.getState().replace(p);
  const display = p.display;
  const displayed = resolveTracks(
    materializedLayout(p, WS, []),
    { depth: well.depth.values, curves: well.curves, computed, catalog: defaultRoleCatalog },
    { roles: display.roles, ...(display.curves[well.id] ? { curves: display.curves[well.id] } : {}) },
    { keepEmpty: true },
  );
  return { displayed, editor: createLayoutEditor({ workspace: WS, overlays: [], displayed, curves: well.curves }) };
}
const spec = (id: string): TrackSpec => useProject.getState().project.display.layouts[WS]!.find((t) => t.id === id)!;
const sel = (t: TrackSpec) => (t.curves ?? []).map((c) => ('role' in c.select ? c.select.role : 'curveId' in c.select ? `#${c.select.curveId}` : `*${c.select.unassigned}`));

beforeEach(() => useProject.getState().replace(createProject()));

describe('acciones de «Armar pistas»', () => {
  it('al expandir un grupo no se pierden las curvas ocultas (siguen ocultas y se pueden volver a mostrar)', () => {
    const p = setCurveDisplay(addWell(createProject('P'), well), well.id, 'AT30', { hidden: true });
    const { displayed, editor } = editorFor(p);
    const res = displayed.find((t) => t.id === 'resistivity')!;
    expect(res.curves.map((c) => c.name)).not.toContain('AT30');
    expect(res.hidden?.map((h) => h.name)).toEqual(['AT30']);
    editor.removeCurve(res, res.curves.find((c) => c.name === 'AT60')!);
    expect(sel(spec('resistivity'))).toEqual(['RXO', '#AT20', '#AT30', 'RA10', 'RA20', 'RA30', 'RS', 'RM', 'RT']);
    // AT30 sigue oculta y su pista la ofrece para volver a mostrarla
    const after = editorFor(useProject.getState().project).displayed.find((t) => t.id === 'resistivity')!;
    expect(after.hidden?.map((h) => h.name)).toEqual(['AT30']);
    expect(after.curves.map((c) => c.name)).toContain('AT20');
    expect(after.curves.map((c) => c.name)).not.toContain('AT60');
  });

  it('mover una curva que tomó el recolector le da su estilo y sus rellenos de convención', () => {
    const p = addWell(createProject('P'), well);
    // VSH fuera de la pista de Interpretación: la toma el recolector de una plantilla sin VSH.
    const layout = materializedLayout(p, WS, []).map((t) => (t.id === 'computed' ? { ...t, curves: [], fills: [], collect: 'computed' as const } : t));
    const q = { ...p, display: { ...p.display, layouts: { [WS]: layout } } };
    const { displayed, editor } = editorFor(q, [vsh, phit]);
    const comp = displayed.find((t) => t.id === 'computed')!;
    editor.moveCurveToTrack(comp, comp.curves.find((c) => c.role === 'VSH')!, { kind: 'gap', beforeId: null });
    const tracks = useProject.getState().project.display.layouts[WS]!;
    const created = tracks[tracks.length - 1]!;
    expect(sel(created)).toEqual(['VSH']);
    expect(created.fills).toEqual([expect.objectContaining({ kind: 'edge', curve: 'VSH', fill: 'shale' })]);
    // PHIT no tiene estilo ni relleno propio: entra solo con el selector
    editor.moveCurveToTrack(comp, comp.curves.find((c) => c.role === 'PHIT')!, { kind: 'track', trackId: 'sonic' });
    expect(sel(spec('sonic'))).toEqual(['DT', 'DTS', 'PHIT']);
  });

  it('cada gesto es una sola entrada del historial, aunque expanda un grupo antes de mover', () => {
    const p = addWell(createProject('P'), well);
    const { displayed, editor } = editorFor(p);
    const res = displayed.find((t) => t.id === 'resistivity')!;
    editor.moveCurveToTrack(res, res.curves.find((c) => c.name === 'AT30')!, { kind: 'track', trackId: 'sonic' });
    expect(useProject.getState().history.past).toHaveLength(1);
    expect(useProject.getState().undoLabel).toBe('Mover AT30 a Sónico');
    expect(sel(spec('resistivity'))).toEqual(['RXO', '#AT20', '#AT60', 'RA10', 'RA20', 'RA30', 'RS', 'RM', 'RT']);
    expect(sel(spec('sonic'))).toEqual(['DT', 'DTS', '#AT30']);
    useProject.getState().undo();
    expect(useProject.getState().project.display.layouts[WS]).toBeUndefined();
  });
});

describe('rellenos y plantillas', () => {
  it('un relleno equivalente (mismas curvas y lado, otra opacidad) no se duplica', () => {
    const geo: TrackSpec[] = [{ id: 'g', title: 'GR espectral', kind: 'curves', curves: [{ select: { role: 'GR' } }], fills: [{ kind: 'edge', curve: 'GR', side: 'left', fill: 'shale', opacity: 0.3 }] }];
    const out = addCurveToTrack(geo, 'g', { select: { role: 'GR' }, fills: [{ kind: 'edge', curve: 'GR', side: 'left', fill: 'shale', opacity: 0.32 }, { kind: 'edge', curve: 'GR', side: 'right', fill: 'sand' }] });
    expect(out[0]!.fills!.map(fillKey)).toEqual(['edge:GR:left', 'edge:GR:right']);
    expect(fillKey({ kind: 'between', a: 'RHOB', b: 'NPHI' })).toBe(fillKey({ kind: 'between', a: 'NPHI', b: 'RHOB', aLeft: 'gas' }));
  });

  it('al abrir se descartan las plantillas de nombre repetido en un espacio y las fechas inválidas', () => {
    const warnings: string[] = [];
    const tracks = [{ id: 'd', title: 'Prof.', kind: 'depth' }];
    const out = sanitizeDisplay(
      {
        trackTemplates: [
          { id: 'a', name: 'Mía', workspace: 'petrophysics', tracks, savedAt: 'ayer' },
          { id: 'b', name: ' mía ', workspace: 'petrophysics', tracks },
          { id: 'c', name: 'Mía', workspace: 'geology', tracks, savedAt: '2026-10-10T00:00:00Z' },
        ],
      },
      (m) => warnings.push(m),
    );
    expect(out.trackTemplates!.map((t) => [t.id, t.savedAt])).toEqual([
      ['a', undefined],
      ['c', '2026-10-10T00:00:00Z'],
    ]);
    expect(warnings).toHaveLength(2);
  });
});

describe('anchos acotados', () => {
  it('al abrir, un ancho fuera de rango se acota con aviso', () => {
    const warnings: string[] = [];
    const out = sanitizeDisplay({ layouts: { petrophysics: [{ id: 'a', title: 'A', kind: 'curves', width: 1e6 }, { id: 'b', title: 'B', kind: 'curves', width: 0.01 }, { id: 'c', title: 'C', kind: 'curves', width: 1.5 }] } }, (m) => warnings.push(m));
    expect(out.layouts['petrophysics']!.map((t) => t.width)).toEqual([TRACK_WIDTH_RANGE.max, TRACK_WIDTH_RANGE.min, 1.5]);
    expect(warnings).toHaveLength(2);
  });

  it('layoutTracks con weightedMin: igual que antes si todo entra, y el total queda acotado', () => {
    const tracks = [{ width: 1 }, { width: 2.5 }, { width: 0.6 }, { fixed: 76 }];
    for (const available of [800, 1200, 2000]) {
      expect(layoutTracks(tracks, available, 100, { weightedMin: true })).toEqual(layoutTracks(tracks, available, 100));
    }
    const huge = layoutTracks([{ width: 1e6 }, { width: 1 }], 300, 100, { weightedMin: true });
    expect(huge.total).toBeLessThanOrEqual(100 * TRACK_WIDTH_RANGE.max + 100);
  });
});
