/**
 * Edición de zonas sobre el perfil (fase 4b) con el controlador de gestos real: arrastrar un contacto con vista
 * previa y commit al soltar, Escape cancela, modo «marcar zona», y los bordes como elementos del teclado (targets).
 */
import { describe, expect, it } from 'vitest';
import type { TrackSpec } from '../../src/core/display';
import { defaultRoleCatalog } from '../../src/core/roles';
import type { Curve, Zone } from '../../src/core/well';
import { PointerGestures, type GestureHost, type HitResult, type Point } from '../../src/viewer/interaction';
import { layoutTracks, trackAt } from '../../src/viewer/layout';
import type { OverlayHitFrame, OverlayPointer } from '../../src/viewer/overlay';
import { createZonesOverlay, zoneBoundaries } from '../../src/viewer/overlays/zones';
import { overlayTracks, overlayViewport } from '../../src/viewer/render';
import { resolveTracks } from '../../src/viewer/resolve';
import { showRange, viewportLimits, yOf, type Viewport } from '../../src/viewer/viewport';
import { THEMES } from '../../src/ui/tokens';

const n = 201;
const depth = Float64Array.from({ length: n }, (_, i) => 1000 + i * 0.5); // 1000–1100 m
const gr: Curve = { id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: new Float64Array(n).fill(60), origin: { kind: 'measured' } };
const layout: TrackSpec[] = [{ id: 'depth', title: 'Prof.', kind: 'depth' }, { id: 'c', title: 'Correlación', kind: 'curves', curves: [{ select: { role: 'GR' } }] }];
const tracks = resolveTracks(layout, { depth, curves: [gr], computed: [], catalog: defaultRoleCatalog });
const boxes = layoutTracks(tracks, 400).boxes;
const z = (id: string, top: number, base: number): Zone => ({ id, name: id.toUpperCase(), top, base, color: '#5b8def', kind: 'formation' });

function setup(initial: Zone[]) {
  const state = { zones: initial, marking: false, commits: [] as string[], created: [] as Zone[], invalidations: 0 };
  const overlays = createZonesOverlay({
    edit: {
      current: () => ({ zones: state.zones, depth }),
      marking: () => state.marking,
      commit: (zones, label) => {
        state.zones = zones;
        state.commits.push(label);
      },
      newZone: () => ({ id: 'nueva', name: 'Z1', color: '#e05a6a', lowerId: 'resto' }),
      created: (zz) => state.created.push(zz),
    },
  });
  const lim = viewportLimits(depth, 400, 0.5);
  const vp: { v: Viewport } = { v: showRange(lim, 400, 1000, 1100) };
  const frame = (): OverlayHitFrame => ({
    theme: THEMES.light,
    viewport: overlayViewport(vp.v),
    tracks: overlayTracks(tracks, boxes),
    data: { wellId: 'w', depth, zones: state.zones.map((x) => ({ ...x })), selectedZoneId: null, qc: null, well: {} as never, interpretation: {} as never, computed: [] },
    invalidate: () => state.invalidations++,
  });
  const pointerAt = (p: Point): OverlayPointer => {
    const f = frame();
    const ti = trackAt(boxes, p.x);
    return { x: p.x, y: p.y, depth: f.viewport.depthOf(p.y), track: ti >= 0 ? f.tracks[ti]! : null };
  };
  const host: GestureHost = {
    viewport: () => vp.v,
    limits: () => lim,
    setViewport: (v) => (vp.v = v),
    pointerAt,
    hitAt: (p): HitResult | null => {
      for (const o of [...overlays].reverse()) {
        const hit = o.hit?.(frame(), pointerAt(p));
        if (hit) return { overlayId: o.id, hit };
      }
      return null;
    },
    requestTick: () => {},
  };
  const yAt = (d: number) => yOf(vp.v, d);
  return { state, overlays, gestures: new PointerGestures(host), frame, yAt, x: boxes[1]!.x + 50 };
}

describe('bordes de zona', () => {
  it('un contacto entre contiguas es un solo borde; con hueco, tope y base separados', () => {
    const b = zoneBoundaries([z('a', 1000, 1020), z('b', 1020.5, 1040), z('c', 1060, 1080)], depth);
    expect(b.map((x) => x.key)).toEqual(['t:a', 'c:b', 'b:b', 't:c', 'b:c']);
    expect(b[1]!.label).toContain('Contacto A/B');
  });
});

describe('arrastrar un contacto', () => {
  it('vista previa en vivo, ajuste a la muestra y commit al soltar', () => {
    const { state, gestures, frame, yAt, x } = setup([z('a', 1000, 1020), z('b', 1020.5, 1040)]);
    const y = yAt(1020.5);
    expect(gestures.down(1, { x, y })).toBe('overlay');
    gestures.move(1, { x, y: y - 20 });
    expect(state.invalidations).toBeGreaterThan(0);
    // Durante el arrastre el visor dibuja las zonas de la vista previa; el proyecto todavía no cambió.
    expect(state.commits).toEqual([]);
    gestures.up(1, { x, y: y - 20 });
    expect(state.commits).toEqual(['Mover contacto A/B']);
    const b = state.zones.find((q) => q.id === 'b')!;
    const a = state.zones.find((q) => q.id === 'a')!;
    expect(b.top).toBeLessThan(1020.5);
    expect((b.top - 1000) / 0.5).toBe(Math.round((b.top - 1000) / 0.5)); // sobre una muestra
    expect(b.top - a.base).toBeCloseTo(0.5, 9); // conserva la separación de una muestra
    expect(frame().data.zones).toHaveLength(2);
  });

  it('Escape cancela: no hay commit', () => {
    const { state, gestures, yAt, x } = setup([z('a', 1000, 1020), z('b', 1020.5, 1040)]);
    const y = yAt(1040);
    gestures.down(1, { x, y });
    gestures.move(1, { x, y: y + 30 });
    expect(gestures.cancel()).toBe(true);
    gestures.up(1, { x, y: y + 30 });
    expect(state.commits).toEqual([]);
    expect(state.zones.find((q) => q.id === 'b')!.base).toBe(1040);
  });

  it('lejos de un borde no hay arrastre de zona (se panea)', () => {
    const { gestures, yAt, x } = setup([z('a', 1000, 1020)]);
    expect(gestures.down(1, { x, y: yAt(1010) })).toBe('pan');
  });
});

describe('modo marcar zona', () => {
  it('arrastrar en cualquier punto crea la zona (partiendo la anfitriona)', () => {
    const { state, gestures, yAt, x } = setup([z('a', 1000, 1050)]);
    state.marking = true;
    gestures.down(1, { x, y: yAt(1010) });
    gestures.move(1, { x, y: yAt(1020) });
    gestures.up(1, { x, y: yAt(1020) });
    expect(state.commits).toEqual(['Marcar zona Z1']);
    expect(state.zones.map((q) => q.id)).toEqual(['a', 'nueva', 'resto']);
    expect(state.created[0]).toMatchObject({ id: 'nueva', top: 1010, base: 1020 });
  });
});

describe('teclado', () => {
  it('cada borde es un target con clave y nudge: ↑/↓ lo mueven sin puntero', () => {
    const { state, overlays, gestures, frame } = setup([z('a', 1000, 1020), z('b', 1020.5, 1040)]);
    const tops = overlays.find((o) => o.id === 'zones-tops')!;
    const targets = tops.targets!(frame());
    expect(targets.map((t) => t.hit.key)).toEqual(['t:a', 'c:b', 'b:b']);
    const contact = targets[1]!;
    gestures.focus({ overlayId: tops.id, hit: contact.hit });
    expect(gestures.activeKey).toEqual({ overlayId: 'zones-tops', key: 'c:b' });
    expect(gestures.nudge(1)).toBe(true);
    expect(state.zones.find((q) => q.id === 'b')!.top).toBe(1021.5);
    expect(state.zones.find((q) => q.id === 'a')!.base).toBe(1021);
    // El mismo elemento sigue activo después del commit (lee las zonas al día por su clave).
    gestures.nudge(-0.5);
    expect(state.zones.find((q) => q.id === 'b')!.top).toBe(1021);
    expect(state.commits).toHaveLength(2);
  });
});
