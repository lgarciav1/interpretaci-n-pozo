/**
 * Arrastre de superposiciones (revisión de la fase 4a, punto 1): un plug de corona arrastrable en profundidad y en
 * porosidad, la selección de un tramo, el desplazamiento automático en los bordes, Escape y el teclado. Se prueba el
 * controlador de gestos real (`PointerGestures`) con superposiciones de prueba, sin DOM.
 */
import { describe, expect, it, vi } from 'vitest';
import type { TrackSpec } from '../../src/core/display';
import { defaultRoleCatalog } from '../../src/core/roles';
import type { Curve } from '../../src/core/well';
import { AUTOSCROLL_EDGE, PointerGestures, type GestureHost, type HitResult, type Point } from '../../src/viewer/interaction';
import { layoutTracks, trackAt } from '../../src/viewer/layout';
import type { OverlayHitFrame, OverlayPointer, ViewerOverlay } from '../../src/viewer/overlay';
import { overlayTracks, overlayViewport } from '../../src/viewer/render';
import { resolveTracks } from '../../src/viewer/resolve';
import { showRange, viewportLimits, yOf, type Viewport } from '../../src/viewer/viewport';
import { THEMES } from '../../src/ui/tokens';

const n = 1001;
const depth = Float64Array.from({ length: n }, (_, i) => 1000 + i * 0.5); // 1000–1500 m
const nphi: Curve = { id: 'TNPH', mnemonic: 'TNPH', role: 'NPHI', unit: 'v/v', data: new Float64Array(n).fill(0.2), origin: { kind: 'measured' } };
const layout: TrackSpec[] = [{ id: 'poro', title: 'Porosidad', kind: 'curves', curves: [{ select: { role: 'NPHI' } }] }];
const tracks = resolveTracks(layout, { depth, curves: [nphi], computed: [], catalog: defaultRoleCatalog });
const boxes = layoutTracks(tracks, 300).boxes;

/** Visor de prueba: un viewport, las superposiciones y el controlador, como lo arma WellViewer. */
function setup(overlays: ViewerOverlay[]) {
  const lim = viewportLimits(depth, 400, 0.5);
  const state = { vp: showRange(lim, 400, 1100, 1200) as Viewport, ticks: 0, invalidations: 0 };
  const frame = (): OverlayHitFrame => ({
    theme: THEMES.light,
    viewport: overlayViewport(state.vp),
    tracks: overlayTracks(tracks, boxes),
    data: { wellId: 'w', depth, zones: [], selectedZoneId: null, qc: null, well: {} as never, interpretation: {} as never, computed: [] },
    invalidate: () => state.invalidations++,
  });
  const pointerAt = (p: Point): OverlayPointer => {
    const f = frame();
    const ti = trackAt(boxes, p.x);
    return { x: p.x, y: p.y, depth: f.viewport.depthOf(p.y), track: ti >= 0 ? f.tracks[ti]! : null };
  };
  const host: GestureHost = {
    viewport: () => state.vp,
    limits: () => lim,
    setViewport: (v) => (state.vp = v),
    pointerAt,
    hitAt: (p): HitResult | null => {
      for (const o of overlays) {
        const hit = o.hit?.(frame(), pointerAt(p));
        if (hit) return { overlayId: o.id, hit };
      }
      return null;
    },
    requestTick: () => state.ticks++,
  };
  return { state, gestures: new PointerGestures(host), frame };
}

/** Plug de corona: (profundidad, φ). Se arrastra en las dos direcciones con vista previa; ↑/↓ lo mueven. */
function plugOverlay() {
  const plug = { depth: 1150, phi: 0.2 };
  const preview: { current: { depth: number; phi: number } | null } = { current: null };
  const overlay: ViewerOverlay = {
    id: 'test-plug',
    label: 'Plug',
    layer: 'over',
    draw: () => {},
    hit(frame, p) {
      const t = p.track;
      if (!t) return null;
      const x = t.x + t.xOf('NPHI', plug.phi)!;
      if (Math.abs(frame.viewport.yOf(plug.depth) - p.y) > 5 || Math.abs(x - p.x) > 6) return null;
      return {
        label: `Plug ${plug.depth} m`,
        cursor: 'grab',
        drag: {
          move(q) {
            preview.current = { depth: q.depth, phi: t.valueOf('NPHI', q.x - t.x)! };
            frame.invalidate();
          },
          end() {
            if (preview.current) Object.assign(plug, preview.current);
            preview.current = null;
          },
          cancel() {
            preview.current = null;
          },
        },
        nudge(d) {
          plug.depth += d;
        },
      };
    },
  };
  return { plug, preview, overlay };
}

const plugPoint = (vp: Viewport, phi: number, d: number): Point => {
  const t = overlayTracks(tracks, boxes)[0]!;
  return { x: t.x + t.xOf('NPHI', phi)!, y: yOf(vp, d) };
};

describe('arrastre de superposiciones', () => {
  it('xOf y valueOf son inversas (escala invertida de NPHI)', () => {
    const t = overlayTracks(tracks, boxes)[0]!;
    for (const v of [0.45, 0.2, -0.1]) expect(t.valueOf('NPHI', t.xOf('NPHI', v)!)!).toBeCloseTo(v, 9);
    expect(t.xOf(null, 0.45)).toBeCloseTo(0, 9); // escala de la pista (la de su curva de arriba)
    expect(t.valueOf('RT', 10)).toBeNull();
  });

  it('arrastrar un plug lo mueve (profundidad y φ) sin panear; soltar confirma y el clic que sigue no cuenta', () => {
    const { plug, preview, overlay } = plugOverlay();
    const { state, gestures } = setup([overlay]);
    const top0 = state.vp.top;
    const start = plugPoint(state.vp, 0.2, 1150);
    expect(gestures.down(1, start)).toBe('overlay');
    gestures.move(1, { x: start.x + 2, y: start.y + 2 }); // dentro del umbral: todavía es un clic
    expect(preview.current).toBeNull();
    const to = plugPoint(state.vp, 0.3, 1170);
    gestures.move(1, to);
    expect(gestures.dragging).toBe('overlay');
    expect(preview.current!.depth).toBeCloseTo(1170, 6);
    expect(preview.current!.phi).toBeCloseTo(0.3, 6);
    expect(state.invalidations).toBeGreaterThan(0);
    expect(state.vp.top).toBe(top0); // no paneó
    gestures.up(1, to);
    expect(plug.depth).toBeCloseTo(1170, 6);
    expect(plug.phi).toBeCloseTo(0.3, 6);
    expect(gestures.takeClick()).toBe(false);
  });

  it('apretar fuera de un elemento panea', () => {
    const { plug, overlay } = plugOverlay();
    const { state, gestures } = setup([overlay]);
    const top0 = state.vp.top;
    expect(gestures.down(1, { x: 20, y: 300 })).toBe('pan');
    gestures.move(1, { x: 20, y: 260 });
    gestures.up(1, { x: 20, y: 260 });
    expect(state.vp.top).toBeCloseTo(top0 + 40 / state.vp.pxPerM, 9);
    expect(plug.depth).toBe(1150);
  });

  it('cerca del borde la vista se desplaza sola y el elemento sigue al puntero', () => {
    const { preview, overlay } = plugOverlay();
    const { state, gestures } = setup([overlay]);
    const start = plugPoint(state.vp, 0.2, 1150);
    gestures.down(1, start);
    const edge = { x: start.x, y: state.vp.height - AUTOSCROLL_EDGE / 4 };
    gestures.move(1, edge);
    expect(state.ticks).toBe(1);
    const before = preview.current!.depth;
    const top0 = state.vp.top;
    expect(gestures.tick()).toBe(true);
    expect(state.vp.top).toBeGreaterThan(top0);
    expect(preview.current!.depth).toBeGreaterThan(before);
    // lejos del borde no se desplaza
    gestures.move(1, { x: start.x, y: 200 });
    expect(gestures.tick()).toBe(false);
  });

  it('Escape cancela: vuelve todo como estaba y soltar después no confirma', () => {
    const { plug, preview, overlay } = plugOverlay();
    const { state, gestures } = setup([overlay]);
    const start = plugPoint(state.vp, 0.2, 1150);
    gestures.down(1, start);
    gestures.move(1, plugPoint(state.vp, 0.3, 1180));
    expect(gestures.cancel()).toBe(true);
    expect(preview.current).toBeNull();
    gestures.up(1, plugPoint(state.vp, 0.3, 1180));
    expect(plug).toEqual({ depth: 1150, phi: 0.2 });
    expect(gestures.takeClick()).toBe(false);
  });

  it('el elemento arrastrado (o clicado) queda activo: ↑/↓ lo mueven; Escape o un clic afuera lo sueltan', () => {
    const { plug, overlay } = plugOverlay();
    const { state, gestures } = setup([overlay]);
    expect(gestures.nudge(0.5)).toBe(false);
    const start = plugPoint(state.vp, 0.2, 1150);
    gestures.down(1, start);
    gestures.move(1, plugPoint(state.vp, 0.2, 1160));
    gestures.up(1, plugPoint(state.vp, 0.2, 1160));
    expect(gestures.nudge(0.5)).toBe(true);
    expect(plug.depth).toBeCloseTo(1160.5, 6);
    expect(gestures.cancel()).toBe(true);
    expect(gestures.nudge(0.5)).toBe(false);
    // clic sin arrastre sobre el plug → activo; apretar en otro lado → suelto
    const p = plugPoint(state.vp, 0.2, plug.depth);
    gestures.down(2, p);
    gestures.up(2, p);
    expect(gestures.takeClick()).toBe(true);
    gestures.clicked({ overlayId: 'test-plug', hit: overlay.hit!(setup([]).frame(), { ...p, depth: plug.depth, track: overlayTracks(tracks, boxes)[0]! })! });
    expect(gestures.active?.overlayId).toBe('test-plug');
    gestures.down(3, { x: 5, y: 5 });
    expect(gestures.active).toBeNull();
  });

  it('elegir un tramo: una superposición en modo selección devuelve un arrastre en cualquier punto', () => {
    const selection: { top: number; base: number } = { top: NaN, base: NaN };
    const pick: ViewerOverlay = {
      id: 'test-range',
      label: 'Tramo',
      layer: 'over',
      draw: () => {},
      hit: () => ({
        label: 'Arrastrá para elegir un tramo',
        cursor: 'crosshair',
        drag: {
          cursor: 'ns-resize',
          move(p, start) {
            selection.top = Math.min(start.depth, p.depth);
            selection.base = Math.max(start.depth, p.depth);
          },
          end() {},
        },
      }),
    };
    const { state, gestures } = setup([pick]);
    gestures.down(1, { x: 50, y: 200 });
    gestures.move(1, { x: 50, y: 100 });
    gestures.up(1, { x: 50, y: 100 });
    expect(selection.top).toBeCloseTo(state.vp.top + 100 / state.vp.pxPerM, 9);
    expect(selection.base).toBeCloseTo(state.vp.top + 200 / state.vp.pxPerM, 9);
  });

  it('un error en el arrastre de una superposición no rompe el visor', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: ViewerOverlay = {
      id: 'test-bad',
      label: 'Mala',
      layer: 'over',
      draw: () => {},
      hit: () => ({ label: 'x', drag: { move: () => { throw new Error('boom'); }, end: () => { throw new Error('boom'); } } }),
    };
    const { gestures } = setup([bad]);
    gestures.down(1, { x: 10, y: 10 });
    expect(() => gestures.move(1, { x: 10, y: 60 })).not.toThrow();
    expect(() => gestures.up(1, { x: 10, y: 60 })).not.toThrow();
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});
