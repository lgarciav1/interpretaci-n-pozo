/** Arreglos de la revisión de la fase 4a (puntos 2–7 y 9). */
import { describe, expect, it, vi } from 'vitest';
import { sanitizeDisplay, type TrackSpec } from '../../src/core/display';
import { addWell, createProject } from '../../src/core/state/project';
import { deserializeProject, serializeProject } from '../../src/core/state/serialize';
import { defaultRoleCatalog } from '../../src/core/roles';
import { createWell, type Curve } from '../../src/core/well';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import { AreaSink, fillBetween } from '../../src/viewer/fills';
import { layoutTracks } from '../../src/viewer/layout';
import type { ViewerOverlay } from '../../src/viewer/overlay';
import { overlayTracks, ViewerRenderer } from '../../src/viewer/render';
import { findCurve, resolveTracks, type ComputedCurve, type ResolvedTrack } from '../../src/viewer/resolve';
import { FRACTION_CACHE_PER_ARRAY, fractionArray, fractionCacheSize } from '../../src/viewer/scale';
import { BUILTIN_LAYOUTS, MODERN_LAYOUTS, overlayTrackId, withOverlayTracks } from '../../src/viewer/templates';
import { viewportLimits, fitAll, showRange } from '../../src/viewer/viewport';
import { THEMES } from '../../src/ui/tokens';

function measured(id: string, role: string | null, values: number[], unit?: string): Curve {
  return { id, mnemonic: id, role, unit: unit ?? (role ? defaultRoleCatalog.unitOf(role) : 'unitless'), data: Float64Array.from(values), origin: { kind: 'measured' } };
}
const depthOf = (n: number) => Float64Array.from({ length: n }, (_, i) => 1000 + i);
const track = (tracks: ResolvedTrack[], id: string) => tracks.find((t) => t.id === id)!;
const resolve = (curves: Curve[], layout: readonly TrackSpec[] = BUILTIN_LAYOUTS.petrophysics, overrides = {}, computed: ComputedCurve[] = []) =>
  resolveTracks(layout, { depth: depthOf(curves[0]!.data.length), curves, computed, catalog: defaultRoleCatalog }, overrides);

/** Áreas de un relleno resuelto, como lo dibuja el visor (fracciones de ancho × muestras). */
function fillAreas(t: ResolvedTrack, index: number) {
  const f = t.fills[index]!;
  const frac = (c: typeof f.a) => Float64Array.from(c.data, (v) => {
    const s = c.axis;
    const u = s.kind === 'log' ? (Math.log10(v) - Math.log10(s.min)) / (Math.log10(s.max) - Math.log10(s.min)) : (v - s.min) / (s.max - s.min);
    return s.reversed ? 1 - u : u;
  });
  const xa = frac(f.a);
  const n = xa.length;
  const y = Float64Array.from({ length: n }, (_, i) => i);
  const xb = f.kind === 'between' ? frac(f.b!) : f.side === 'left' ? 0 : 1;
  const diff = f.kind === 'between' && f.compare === 'value' ? Float64Array.from(f.a.data, (v, i) => v - f.b!.data[i]!) : undefined;
  const aLeft = new AreaSink();
  const bLeft = new AreaSink();
  fillBetween(n, y, xa, xb, aLeft, bLeft, 0, 1, diff);
  return { fill: f, aLeft: aLeft.area, bLeft: bLeft.area };
}

describe('punto 2: pistas propias de superposiciones y datos del pozo para ellas', () => {
  const mdt: ViewerOverlay = {
    id: 'mdt',
    label: 'Presiones MDT',
    layer: 'over',
    track: { title: 'Presión', scale: { kind: 'linear', min: 3000, max: 5000 }, unit: 'psi', after: 'depth', width: 0.9 },
    draw: () => {},
  };

  it('withOverlayTracks agrega la pista donde la pide; no la duplica; quita las de superposiciones que no existen', () => {
    const layout = withOverlayTracks(BUILTIN_LAYOUTS.petrophysics, [mdt], 'petrophysics');
    const i = layout.findIndex((t) => t.id === overlayTrackId('mdt'));
    expect(layout[i - 1]!.id).toBe('depth');
    expect(layout[i]).toMatchObject({ kind: 'overlay', overlayId: 'mdt', title: 'Presión', unit: 'psi', width: 0.9 });
    expect(withOverlayTracks(layout, [mdt], 'petrophysics').filter((t) => t.overlayId === 'mdt')).toHaveLength(1);
    expect(withOverlayTracks(layout, [], 'petrophysics').some((t) => t.kind === 'overlay')).toBe(false);
    expect(withOverlayTracks(BUILTIN_LAYOUTS.geology, [{ ...mdt, track: { ...mdt.track!, workspaces: ['petrophysics'] } }], 'geology').some((t) => t.kind === 'overlay')).toBe(false);
  });

  it('resolve conserva la pista sin curvas, con su escala; la superposición dibuja en su caja con xOf(null)', () => {
    const layout = withOverlayTracks(BUILTIN_LAYOUTS.petrophysics, [mdt], 'petrophysics');
    const tracks = resolve([measured('GR', 'GR', [50, 60])], layout);
    const t = track(tracks, overlayTrackId('mdt'));
    expect(t.curves).toEqual([]);
    expect(t.grid).toEqual({ kind: 'linear', min: 3000, max: 5000, reversed: false });
    const ot = overlayTracks(tracks, layoutTracks(tracks, 1200).boxes).find((o) => o.overlayId === 'mdt')!;
    expect(ot.xOf(null, 4000)).toBeCloseTo(ot.width / 2, 9);
    expect(ot.valueOf(null, ot.width / 4)).toBeCloseTo(3500, 9);
  });
});

describe('punto 3: relleno de GR — arcilla del borde izquierdo a la curva, arena de la curva al borde derecho', () => {
  it('GR 120 en 0–150: 80 % arcilla y 20 % arena (coherente con IGR/VSH)', () => {
    // Estilo «Moderno» (dos rellenos); el perfil clásico de fábrica tiene solo el de arcilla, con la misma geometría.
    const t = track(resolve([measured('GR', 'GR', [120, 120])], MODERN_LAYOUTS.petrophysics), 'correlation');
    expect(fillAreas(track(resolve([measured('GR', 'GR', [120, 120])]), 'correlation'), 0).bLeft).toBeCloseTo(0.8, 9);
    const shale = fillAreas(t, 0);
    const sand = fillAreas(t, 1);
    expect([shale.fill.side, shale.fill.bLeft]).toEqual(['left', 'shale']);
    expect(shale.bLeft).toBeCloseTo(0.8, 9);
    expect([sand.fill.side, sand.fill.aLeft]).toEqual(['right', 'sand']);
    expect(sand.aLeft).toBeCloseTo(0.2, 9);
  });

  it('geología: el relleno de GR espectral también es arcilla desde la izquierda', () => {
    const spectral = BUILTIN_LAYOUTS.geology.find((t) => t.id === 'spectral')!;
    expect(spectral.fills).toEqual([expect.objectContaining({ kind: 'edge', curve: 'GR', side: 'left', fill: 'shale' })]);
  });
});

describe('punto 4: un override log inválido conserva la escala log', () => {
  const gr = measured('GR', 'GR', [20, 40, 90, 150, 180]);
  const rt = measured('AT90', 'RT', [0.5, 2, 20, 200, 1000]);

  it('GR pasada a log (rol 0–150): queda log con un mínimo válido (década bajo el P1) y la grilla es log', () => {
    const t = track(resolve([gr, rt], BUILTIN_LAYOUTS.petrophysics, { roles: { GR: { scale: 'log' } } }), 'correlation');
    const c = t.curves.find((x) => x.role === 'GR')!;
    expect(c.axis).toEqual({ kind: 'log', min: 10, max: 150, reversed: false });
    expect(c.wrap).toBe(false);
    expect(t.grid).toEqual(c.axis); // GR es la curva de arriba de la pista
  });

  it('RT con min 0: sigue log 0,2–2000 (mínimo del rol) y la grilla coincide', () => {
    const t = track(resolve([gr, rt], BUILTIN_LAYOUTS.petrophysics, { roles: { RT: { min: 0 } } }), 'resistivity');
    expect(t.curves[0]!.axis).toEqual({ kind: 'log', min: 0.2, max: 2000, reversed: false });
    expect(t.grid).toEqual(t.curves[0]!.axis);
  });

  it('la grilla sigue a la escala efectiva: resistividades pasadas a lineal → grilla lineal', () => {
    const t = track(resolve([gr, rt], BUILTIN_LAYOUTS.petrophysics, { roles: { RT: { scale: 'linear', min: 0, max: 50 } } }), 'resistivity');
    expect(t.grid).toEqual({ kind: 'linear', min: 0, max: 50, reversed: false });
  });
});

describe('punto 5: derrumbe por VALOR (CALI > BS), aunque cambie la escala de una curva', () => {
  it('CALI 12 in con su escala cambiada a 10–30: en pantalla queda a la izquierda de BS, pero es derrumbe', () => {
    const curves = [measured('CAL', 'CALI', [12, 12]), measured('BS', 'BS', [8.5, 8.5])];
    const t = track(resolve(curves, BUILTIN_LAYOUTS.petrophysics, { curves: { CAL: { min: 10, max: 30 } } }), 'correlation');
    const i = t.fills.findIndex((f) => f.kind === 'between');
    const { fill, aLeft, bLeft } = fillAreas(t, i);
    expect(fill.compare).toBe('value');
    // x_CALI = (12 − 10)/20 = 0,10; x_BS = (8,5 − 6)/10 = 0,25 → 0,15 de ancho, todo derrumbe
    expect(aLeft).toBeCloseTo(0.15, 6);
    expect(bLeft).toBe(0);
    // Por pantalla, el mismo tramo se habría clasificado al revés:
    const screen = resolve(curves, [{ id: 'c', title: 'C', kind: 'curves', curves: [{ select: { role: 'BS' } }, { select: { role: 'CALI' } }], fills: [{ kind: 'between', a: 'BS', b: 'CALI', aLeft: 'washout' }] }], { curves: { CAL: { min: 10, max: 30 } } });
    expect(fillAreas(screen[0]!, 0).aLeft).toBe(0);
    expect(fillAreas(screen[0]!, 0).bLeft).toBeCloseTo(0.15, 6);
  });
});

describe('punto 6: rellenos y superposiciones prefieren la curva calculada activa', () => {
  it('VSH medida + VSH calculada: el relleno y xOf("VSH") usan la calculada', () => {
    const vshFile = measured('VCL', 'VSH', [0.9, 0.9]);
    const computed: ComputedCurve[] = [{ port: 'VSH', moduleId: 'vsh-x', label: 'VSH', data: Float64Array.from([0.3, 0.3]), active: true }];
    const t = track(resolve([vshFile], BUILTIN_LAYOUTS.petrophysics, {}, computed), 'computed');
    expect(t.curves.map((c) => c.key)).toEqual(['m:VCL', 'c:vsh-x:VSH']);
    const fill = t.fills.find((f) => f.a.role === 'VSH')!;
    expect(fill.a.key).toBe('c:vsh-x:VSH');
    expect(findCurve(t.curves, 'VSH')!.origin).toBe('computed');
    expect(findCurve(t.curves, 'm:VCL')!.origin).toBe('measured'); // por clave, la que se pide
    const ot = overlayTracks([t], [{ x: 0, width: 100 }])[0]!;
    expect(ot.xOf('VSH', 0.3)).toBeCloseTo(30, 9);
  });
});

describe('punto 7: cachés acotadas', () => {
  it('fractionArray recuerda a lo sumo 4 escalas por array (LRU)', () => {
    const data = Float64Array.from([1, 2, 3]);
    const scales = [10, 20, 30, 40, 50, 60].map((max) => ({ kind: 'linear' as const, min: 0, max, reversed: false }));
    const first = fractionArray(data, scales[0]!);
    for (const s of scales) fractionArray(data, s);
    expect(fractionCacheSize(data)).toBe(FRACTION_CACHE_PER_ARRAY);
    expect(fractionArray(data, scales[0]!)).not.toBe(first); // la más vieja se fue
    const recent = fractionArray(data, scales[5]!);
    expect(fractionArray(data, scales[5]!)).toBe(recent);
  });

  it('el dibujante descarta los buffers que un cuadro no usó (escalas viejas)', () => {
    // Canvas y Path2D de mentira: solo interesa la contabilidad de buffers.
    const g = globalThis as { Path2D?: unknown };
    const hadPath = 'Path2D' in g;
    g.Path2D ??= class {
      moveTo() {}
      lineTo() {}
      closePath() {}
      rect() {}
    };
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true }) as CanvasRenderingContext2D;
    const { well } = syntheticWell(3000);
    const r = new ViewerRenderer();
    const lim = viewportLimits(well.depth.values, 300, well.depth.step);
    const frame = (overrides = {}) => {
      const tracks = resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth: well.depth.values, curves: well.curves, computed: [], catalog: defaultRoleCatalog }, overrides);
      return { tracks, boxes: layoutTracks(tracks, 1000).boxes, viewport: fitAll(lim, 300), theme: THEMES.light, depth: well.depth.values, width: 1000, overlays: [], data: {} as never };
    };
    r.drawBase(ctx, frame());
    const base = r.bufferCount;
    expect(base).toBeGreaterThan(0);
    for (const max of [200, 250, 300, 350, 400]) r.drawBase(ctx, frame({ roles: { GR: { max } } }));
    expect(r.bufferCount).toBe(base);
    r.drawBase(ctx, { ...frame(), viewport: showRange(lim, 300, 7700, 7710) }); // muestras directas: sin buffers
    expect(r.bufferCount).toBe(0);
    if (!hadPath) delete g.Path2D;
  });
});

describe('punto 9: display inválido al abrir un proyecto', () => {
  it('sanitizeDisplay descarta lo inválido con avisos y conserva lo válido', () => {
    const warn = vi.fn();
    const out = sanitizeDisplay(
      {
        layouts: {
          petrophysics: [
            { id: 'a', title: 'A', kind: 'curves', curves: [{ select: { role: 'GR' } }, { nada: 1 }, { select: {} }], fills: [{ kind: 'edge', curve: 'GR', side: 'left', fill: 'shale' }, { kind: 'raro' }] },
            { id: 'b', kind: 'curves' },
            { id: 'a', title: 'repetida', kind: 'curves' },
            { id: 'o', title: 'MDT', kind: 'overlay' },
          ],
          geology: 'no es lista',
        },
        roles: { GR: { min: 0, max: 'mucho', color: 'rojo', wrap: true }, RT: 5 },
        curves: { w1: { AT10: { color: '#112233' } } },
      },
      warn,
    );
    expect(out.layouts['petrophysics']!.map((t) => t.id)).toEqual(['a']);
    expect(out.layouts['petrophysics']![0]!.curves).toEqual([{ select: { role: 'GR' } }]);
    expect(out.layouts['petrophysics']![0]!.fills).toHaveLength(1);
    expect(out.layouts['geology']).toBeUndefined();
    expect(out.roles).toEqual({ GR: { min: 0, wrap: true } });
    expect(out.curves).toEqual({ w1: { AT10: { color: '#112233' } } });
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(7);
  });

  it('un proyecto con una pista sin select se abre igual (sin esa curva) y avisa', async () => {
    const demo = syntheticWell(100);
    const p = addWell(createProject('P'), demo.well, demo.zones);
    const file = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    file.project.display.layouts = { petrophysics: [{ id: 't', title: 'T', kind: 'curves', curves: [{ style: { color: '#ff0000' } }, { select: { role: 'GR' } }] }] };
    const warnings: string[] = [];
    const back = await deserializeProject(JSON.stringify(file), { onWarning: (m) => warnings.push(m) });
    expect(back.display.layouts['petrophysics']![0]!.curves).toEqual([{ select: { role: 'GR' } }]);
    expect(warnings).toHaveLength(1);
    // y el visor la resuelve sin romperse
    const w = createWell({ id: 'x', name: 'X', depth: Float64Array.from([1, 2]), curves: [measured('GR', 'GR', [1, 2])] });
    expect(() => resolveTracks(back.display.layouts['petrophysics']!, { depth: w.depth.values, curves: w.curves, computed: [], catalog: defaultRoleCatalog })).not.toThrow();
  });
});
