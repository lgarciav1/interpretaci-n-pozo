/** Cortina antes/después del visor (docs/decisiones/0026): alineación del lado «antes» y recorte en el dibujo. */
import { describe, expect, it } from 'vitest';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import type { TrackSpec } from '../../src/core/display';
import { defaultRoleCatalog } from '../../src/core/roles';
import { THEMES } from '../../src/ui/tokens';
import { alignCurtainTracks } from '../../src/viewer/curtain';
import { layoutTracks } from '../../src/viewer/layout';
import { ViewerRenderer } from '../../src/viewer/render';
import { resolveTracks, type ComputedCurve } from '../../src/viewer/resolve';
import { BUILTIN_LAYOUTS } from '../../src/viewer/templates';
import { fitAll, viewportLimits } from '../../src/viewer/viewport';

const depth = Float64Array.from({ length: 4 }, (_, i) => 1000 + i);
const sw = (values: number[]): ComputedCurve => ({ port: 'SW', moduleId: 'sw-archie', label: 'Sw', data: Float64Array.from(values), active: true });
const layout: TrackSpec[] = [
  { id: 'sat', title: 'Saturación', kind: 'curves', curves: [{ select: { role: 'SW' } }], fills: [{ kind: 'edge', curve: 'SW', side: 'right', fill: 'water' }] },
  { id: 'otra', title: 'Otra', kind: 'curves', curves: [{ select: { role: 'PHIE' } }] },
];
const resolve = (computed: ComputedCurve[]) => resolveTracks(layout, { depth, curves: [], computed, catalog: defaultRoleCatalog }, {}, { keepEmpty: true });

describe('alignCurtainTracks', () => {
  it('alinea por id, con null donde el «antes» no tiene la pista', () => {
    const after = resolve([sw([0.2, 0.3, 0.4, 0.5])]);
    const before = resolve([sw([0.6, 0.6, 0.6, 0.6])]).filter((t) => t.id === 'sat');
    const out = alignCurtainTracks(after, before);
    expect(out.map((t) => t?.id ?? null)).toEqual(['sat', null]);
  });

  it('la curva «antes» usa la escala y el estilo de la actual, con sus propios datos; el relleno apunta a ella', () => {
    const after = resolve([sw([0.2, 0.3, 0.4, 0.5])]);
    const before = resolve([sw([0.6, 0.6, 0.6, 0.6])]);
    const forced = { ...before[0]!, curves: before[0]!.curves.map((c) => ({ ...c, axis: { kind: 'linear' as const, min: 0.6, max: 0.61, reversed: false } })) };
    forced.fills = before[0]!.fills.map((f) => ({ ...f, a: forced.curves[0]! }));
    const [t] = alignCurtainTracks(after, [forced]);
    expect(t!.curves[0]!.axis).toBe(after[0]!.curves[0]!.axis);
    expect(t!.curves[0]!.styles).toBe(after[0]!.curves[0]!.styles);
    expect([...t!.curves[0]!.data]).toEqual([0.6, 0.6, 0.6, 0.6]);
    expect(t!.fills[0]!.a).toBe(t!.curves[0]);
    expect(t!.grid).toBe(after[0]!.grid);
  });
});

describe('dibujo con cortina', () => {
  // Canvas de mentira que anota los recortes.
  const rects: number[][] = [];
  const g = globalThis as { Path2D?: unknown };
  g.Path2D ??= class {
    moveTo() {}
    lineTo() {}
    closePath() {}
    rect() {}
  };
  const ctx = new Proxy({}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'rect' ? (...a: number[]) => rects.push(a) : () => {}),
    set: () => true,
  }) as CanvasRenderingContext2D;
  const { well } = syntheticWell(3000);
  const lim = viewportLimits(well.depth.values, 300, well.depth.step);
  const tracks = resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth: well.depth.values, curves: well.curves, computed: [], catalog: defaultRoleCatalog });
  const boxes = layoutTracks(tracks, 1000).boxes;
  const frame = { tracks, boxes, viewport: fitAll(lim, 300), theme: THEMES.light, depth: well.depth.values, width: 1000, overlays: [], data: {} as never };

  it('la pista que cruza la cortina se recorta en dos; las demás, una vez de su lado', () => {
    const i = tracks.findIndex((t) => t.kind === 'curves' && t.curves.length > 0);
    const b = boxes[i]!;
    const x = b.x + b.width / 3;
    rects.length = 0;
    new ViewerRenderer().drawBase(ctx, { ...frame, curtain: { x, before: alignCurtainTracks(tracks, tracks) } });
    const mine = rects.filter((r) => r[0]! >= b.x - 1e-9 && r[0]! < b.x + b.width && r[1] === 0);
    expect(mine).toContainEqual([b.x, 0, x - b.x, 300]);
    expect(mine).toContainEqual([x, 0, b.x + b.width - x, 300]);
  });

  it('el lado «antes» usa buffers propios (mismas claves, otros datos) y sin cortina no quedan', () => {
    const r = new ViewerRenderer();
    r.drawBase(ctx, frame);
    const base = r.bufferCount;
    // Cortina a mitad de una pista con curvas: esa pista se reduce dos veces (antes y después).
    const i = tracks.findIndex((t) => t.kind === 'curves' && t.curves.length > 0);
    const mid = boxes[i]!.x + boxes[i]!.width / 2;
    r.drawBase(ctx, { ...frame, curtain: { x: mid, before: alignCurtainTracks(tracks, tracks) } });
    expect(r.bufferCount).toBeGreaterThan(base);
    r.drawBase(ctx, frame);
    expect(r.bufferCount).toBe(base);
    // Cortina en el borde izquierdo: todo «después», como sin cortina.
    r.drawBase(ctx, { ...frame, curtain: { x: 0, before: alignCurtainTracks(tracks, tracks) } });
    expect(r.bufferCount).toBe(base);
  });
});

describe('estado de la cortina (interfaz, fuera del proyecto)', () => {
  it('se cierra si el snapshot desaparece (deshacer) o es de otro pozo', async () => {
    const { staleUiPatch } = await import('../../src/app/store/uiSync');
    const { addWell, createProject, setActiveWell } = await import('../../src/core/state/project');
    const { createSnapshot } = await import('../../src/core/state/snapshots');
    const demo = syntheticWell(50);
    const base = setActiveWell(addWell(createProject(), demo.well, demo.zones), demo.well.id);
    const { project, snapshot } = createSnapshot(base, demo.well.id, 'S');
    const ui = { editingZoneId: null, activeModuleId: null, zoneMarking: false, snapshotsOpen: false, curtain: { snapshotId: snapshot.id } };
    expect(staleUiPatch(ui, project)).toEqual({});
    expect(staleUiPatch(ui, base)).toEqual({ curtain: null });
    const other = { ...project, snapshots: [{ ...snapshot, wellId: 'otro' }] };
    expect(staleUiPatch(ui, other)).toEqual({ curtain: null });
  });
});
