/**
 * Interacción de la superposición de tendencias con el controlador de gestos real (`PointerGestures`), sin DOM
 * (como tests/viewer/interaction.test.ts): elegir un tramo (un solo guardado al soltar), arrastrar una manija,
 * Escape, dibujar a mano, ↑/↓, teclado y excluir una muestra.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { TrendSpec } from '../../src/core/trends';
import type { TrendPatch } from '../../src/core/state/trends';
import { emptyInterpretation } from '../../src/core/interpretation';
import { defaultRoleCatalog } from '../../src/core/roles';
import { createWell, type Curve } from '../../src/core/well';
import { createTrendsOverlays, TRENDS_OVERLAY_ID, type NewTrendInput, type TrendTool } from '../../src/plots/trend/overlay';
import { curveSeriesProvider } from '../../src/plots/trend/series';
import { THEMES } from '../../src/ui/tokens';
import { PointerGestures, type GestureHost, type HitResult, type Point } from '../../src/viewer/interaction';
import { layoutTracks, trackAt } from '../../src/viewer/layout';
import type { OverlayHitFrame, OverlayPointer, ViewerData } from '../../src/viewer/overlay';
import { overlayTracks, overlayViewport } from '../../src/viewer/render';
import { resolveTracks } from '../../src/viewer/resolve';
import { showRange, viewportLimits, yOf, type Viewport } from '../../src/viewer/viewport';
import type { TrackSpec } from '../../src/core/display';

const n = 1001;
const depth = Float64Array.from({ length: n }, (_, i) => 1000 + i * 0.5); // 1000–1500 m
// DT lineal con la profundidad (100 → 50 µs/ft): el ajuste lineal es exacto.
const dt: Curve = { id: 'DT', mnemonic: 'DT', role: 'DT', unit: 'us/ft', data: Float64Array.from(depth, (d) => 100 - (d - 1000) * 0.1), origin: { kind: 'measured' } };
const well = createWell({ id: 'w', name: 'W', depth, curves: [dt] });
const layout: TrackSpec[] = [{ id: 'sonic', title: 'Sónico', kind: 'curves', curves: [{ select: { role: 'DT' } }] }];
const tracks = resolveTracks(layout, { depth, curves: [dt], computed: [], catalog: defaultRoleCatalog });
const boxes = layoutTracks(tracks, 300).boxes;

/** Estado de la «app» de prueba: tendencias guardadas, herramienta, selección y registro de guardados. */
function setup() {
  const app = {
    trends: [] as TrendSpec[],
    tool: null as TrendTool | null,
    selected: null as string | null,
    saves: [] as string[],
    errors: [] as string[],
    finished: 0,
  };
  const overlays = createTrendsOverlays({
    resolve: (data, ref) => (ref.provider === 'curve' ? curveSeriesProvider.resolve({ well: data.well, interpretation: data.interpretation, computed: data.computed, catalog: defaultRoleCatalog }, ref.key) : null),
    edit: {
      trends: () => app.trends,
      tool: () => app.tool,
      selected: () => app.selected,
      select: (id) => (app.selected = id),
      create(input: NewTrendInput) {
        const id = `t${app.trends.length + 1}`;
        app.trends = [...app.trends, { id, name: input.seriesLabel, visible: true, series: input.series, model: input.model, mode: input.mode, selection: input.selection, ...(input.manual ? { manual: input.manual } : {}), extend: false }];
        app.saves.push(input.mode === 'manual' ? 'Dibujar tendencia a mano' : 'Agregar tendencia');
      },
      update(id: string, patch: TrendPatch, label: string) {
        app.trends = app.trends.map((t) => (t.id === id ? ({ ...t, ...patch } as TrendSpec) : t));
        app.saves.push(label);
      },
      togglePoint(id, key, exclude) {
        app.trends = app.trends.map((t) => (t.id === id ? { ...t, selection: { ...t.selection, excluded: exclude ? [...t.selection.excluded, key] : t.selection.excluded.filter((k) => k !== key) } } : t));
        app.saves.push(exclude ? 'Excluir punto de la tendencia' : 'Incluir punto en la tendencia');
      },
      finishTool: () => {
        app.tool = null;
        app.finished++;
      },
      error: (m) => app.errors.push(m),
    },
  });
  const lim = viewportLimits(depth, 400, 0.5);
  const state = { vp: showRange(lim, 400, 1100, 1300) as Viewport, invalidations: 0 };
  const frame = (): OverlayHitFrame => {
    const data: ViewerData = {
      wellId: 'w',
      depth,
      zones: [],
      selectedZoneId: null,
      qc: null,
      well,
      interpretation: { ...emptyInterpretation(), trends: app.trends },
      computed: [],
    };
    return { theme: THEMES.light, viewport: overlayViewport(state.vp), tracks: overlayTracks(tracks, boxes), data, invalidate: () => state.invalidations++, active: null };
  };
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
      // Como WellViewer: las 'over' primero.
      for (const o of [...overlays].reverse()) {
        const hit = o.hit?.(frame(), pointerAt(p));
        if (hit) return { overlayId: o.id, hit };
      }
      return null;
    },
    requestTick: () => {},
  };
  const over = overlays.find((o) => o.id === TRENDS_OVERLAY_ID)!;
  return { app, state, gestures: new PointerGestures(host), frame, over, pointerAt };
}

const t0 = overlayTracks(tracks, boxes)[0]!;
/** Punto sobre la curva DT a una profundidad. */
const onCurve = (vp: Viewport, d: number): Point => ({ x: t0.x + t0.xOf('DT', 100 - (d - 1000) * 0.1)!, y: yOf(vp, d) });

function dragPath(g: PointerGestures, from: Point, to: Point, steps = 6) {
  expect(g.down(1, from)).toBe('overlay');
  for (let k = 1; k <= steps; k++) g.move(1, { x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps });
}

let s: ReturnType<typeof setup>;
beforeEach(() => {
  s = setup();
});

describe('elegir el tramo', () => {
  it('sin herramienta, apretar en la pista panea (no hay tendencias)', () => {
    expect(s.gestures.down(1, onCurve(s.state.vp, 1150))).toBe('pan');
  });

  it('arrastrar crea UNA tendencia al soltar, con el tramo y la curva bajo el puntero; vista previa en vivo', () => {
    s.app.tool = { kind: 'fit' };
    const a = onCurve(s.state.vp, 1120);
    const b = onCurve(s.state.vp, 1180);
    dragPath(s.gestures, a, b);
    expect(s.app.saves).toEqual([]); // nada guardado durante el arrastre
    expect(s.state.invalidations).toBeGreaterThan(3);
    s.gestures.up(1, b);
    expect(s.app.saves).toEqual(['Agregar tendencia']);
    expect(s.app.finished).toBe(1);
    const t = s.app.trends[0]!;
    expect(t.series).toEqual({ provider: 'curve', key: 'm:DT' });
    expect(t.mode).toBe('fit');
    expect(t.selection.top).toBeCloseTo(1120, 6);
    expect(t.selection.base).toBeCloseTo(1180, 6);
  });

  it('Escape durante el arrastre no guarda nada y la herramienta sigue activa', () => {
    s.app.tool = { kind: 'fit' };
    dragPath(s.gestures, onCurve(s.state.vp, 1120), onCurve(s.state.vp, 1180));
    expect(s.gestures.cancel()).toBe(true);
    expect(s.app.saves).toEqual([]);
    expect(s.app.tool).not.toBeNull();
  });

  it('un tramo sin datos suficientes no se guarda y avisa', () => {
    s.app.tool = { kind: 'fit' };
    s.state.vp = showRange(viewportLimits(depth, 400, 0.5), 400, 1120.1, 1122.1) as Viewport; // 200 px/m
    const a = onCurve(s.state.vp, 1120.6);
    dragPath(s.gestures, a, { x: a.x, y: a.y + 6 }); // 0,03 m: ninguna o una muestra
    s.gestures.up(1, { x: a.x, y: a.y + 6 });
    expect(s.app.saves).toEqual([]);
    expect(s.app.errors).toHaveLength(1);
  });

  it('elegir otra vez el tramo de una tendencia existente: un solo «Mover tramo de la tendencia»', () => {
    s.app.tool = { kind: 'fit' };
    dragPath(s.gestures, onCurve(s.state.vp, 1120), onCurve(s.state.vp, 1180));
    s.gestures.up(1, onCurve(s.state.vp, 1180));
    s.app.tool = { kind: 'fit', trendId: 't1' };
    dragPath(s.gestures, onCurve(s.state.vp, 1200), onCurve(s.state.vp, 1250));
    s.gestures.up(1, onCurve(s.state.vp, 1250));
    expect(s.app.saves).toEqual(['Agregar tendencia', 'Mover tramo de la tendencia']);
    expect(s.app.trends).toHaveLength(1);
    expect(s.app.trends[0]!.selection.top).toBeCloseTo(1200, 6);
  });
});

describe('manijas, teclado y muestras', () => {
  const fitTrend = (): TrendSpec => ({ id: 't1', name: 'DT', visible: true, series: { provider: 'curve', key: 'm:DT' }, model: 'linear', mode: 'fit', selection: { top: 1150, base: 1250, excluded: [] }, extend: false });

  it('arrastrar la manija de la base mueve el tramo con un solo guardado; Escape la deja como estaba', () => {
    s.app.trends = [fitTrend()];
    const h = onCurve(s.state.vp, 1250);
    const hit = s.over.hit!(s.frame(), s.pointerAt(h));
    expect(hit?.key).toBe('t1:base');
    dragPath(s.gestures, h, onCurve(s.state.vp, 1280));
    expect(s.gestures.cancel()).toBe(true);
    expect(s.app.saves).toEqual([]);
    dragPath(s.gestures, h, onCurve(s.state.vp, 1280));
    s.gestures.up(1, onCurve(s.state.vp, 1280));
    expect(s.app.saves).toEqual(['Mover tramo de la tendencia']);
    expect(s.app.trends[0]!.selection).toMatchObject({ top: 1150, base: expect.closeTo(1280, 6) });
    // Queda activa: ↑/↓ la mueven (un guardado por paso).
    expect(s.gestures.active?.hit.key).toBe('t1:base');
    expect(s.gestures.nudge(-10)).toBe(true);
    expect(s.app.trends[0]!.selection.base).toBeCloseTo(1270, 6);
    expect(s.app.saves.at(-1)).toBe('Mover tramo de la tendencia');
  });

  it('las manijas son elementos del teclado (Tab) con profundidad y nombre', () => {
    s.app.trends = [fitTrend()];
    const targets = s.over.targets!(s.frame());
    expect(targets.map((t) => [t.hit.key, t.depth])).toEqual([
      ['t1:top', 1150],
      ['t1:base', 1250],
    ]);
    expect(targets[0]!.hit.label).toMatch(/Tope del tramo de «DT» · 1\.150,0 m/);
  });

  it('dibujar a mano: dos puntos sobre la pista; los puntos quedan arrastrables', () => {
    s.app.tool = { kind: 'manual' };
    const a = onCurve(s.state.vp, 1120);
    const b = { x: a.x + 40, y: yOf(s.state.vp, 1200) };
    dragPath(s.gestures, a, b);
    s.gestures.up(1, b);
    expect(s.app.saves).toEqual(['Dibujar tendencia a mano']);
    const t = s.app.trends[0]!;
    expect(t.mode).toBe('manual');
    expect(t.manual![0].x).toBeCloseTo(1120, 6);
    expect(t.manual![0].y).toBeCloseTo(88, 6);
    expect(t.manual![1].x).toBeCloseTo(1200, 6);
    const p1 = s.over.hit!(s.frame(), s.pointerAt(b));
    expect(p1?.key).toBe('t1:p1');
    dragPath(s.gestures, b, { x: b.x - 20, y: yOf(s.state.vp, 1220) });
    s.gestures.up(1, { x: b.x - 20, y: yOf(s.state.vp, 1220) });
    expect(s.app.saves.at(-1)).toBe('Mover punto de la tendencia');
    expect(s.app.trends[0]!.manual![1].x).toBeCloseTo(1220, 6);
    expect(s.app.trends[0]!.selection).toMatchObject({ top: expect.closeTo(1120, 6), base: expect.closeTo(1220, 6) });
  });

  it('clic sobre la línea la selecciona; con la tendencia seleccionada, clic en una muestra la excluye y otro la incluye', () => {
    // Zoom para que las muestras estén separadas (0,5 m = 10 px).
    s.state.vp = showRange(viewportLimits(depth, 400, 0.5), 400, 1190, 1210) as Viewport;
    s.app.trends = [fitTrend()];
    const onLine = onCurve(s.state.vp, 1200.25); // entre dos muestras: la más cercana está a 5 px
    let hit = s.over.hit!(s.frame(), s.pointerAt({ x: onLine.x, y: onLine.y }));
    expect(hit?.label).toMatch(/DT = /);
    hit!.activate!();
    expect(s.app.selected).toBe('t1');
    const sample = onCurve(s.state.vp, 1200);
    hit = s.over.hit!(s.frame(), s.pointerAt(sample));
    expect(hit?.label).toMatch(/Clic para excluirla/);
    hit!.activate!();
    expect(s.app.trends[0]!.selection.excluded).toEqual(['1200']);
    expect(s.app.saves.at(-1)).toBe('Excluir punto de la tendencia');
    hit = s.over.hit!(s.frame(), s.pointerAt(sample));
    expect(hit?.label).toMatch(/volver a incluirla/);
    hit!.activate!();
    expect(s.app.trends[0]!.selection.excluded).toEqual([]);
  });

  it('el tooltip muestra ecuación, R², n y el gradiente en unidades de campo', () => {
    s.app.trends = [fitTrend()];
    const hit = s.over.hit!(s.frame(), s.pointerAt(onCurve(s.state.vp, 1200)));
    expect(hit?.label).toMatch(/DT = −0,1·z \+ 200/);
    expect(hit?.label).toMatch(/R² 1,000 · n 201/);
    expect(hit?.label).toMatch(/Gradiente: −0,1 µs\/ft por m/);
    expect(hit?.range).toEqual({ top: 1150, base: 1250 });
  });

  it('una tendencia oculta o de una curva que no existe no se dibuja ni responde', () => {
    s.app.trends = [{ ...fitTrend(), visible: false }, { ...fitTrend(), id: 't2', series: { provider: 'curve', key: 'm:NADA' } }];
    expect(s.over.hit!(s.frame(), s.pointerAt(onCurve(s.state.vp, 1250)))).toBeNull();
    expect(s.over.targets!(s.frame())).toEqual([]);
  });
});

describe('dibujo de puntos excluidos', () => {
  it('marca con × los excluidos aunque el proveedor no tenga indexOfKey (MDT, plugs: es opcional en el contrato)', () => {
    const moves: [number, number][] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'moveTo') return (x: number, y: number) => moves.push([x, y]);
        if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
        return () => {};
      },
      set(target, prop, v) {
        target[prop] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const [, over] = createTrendsOverlays({
      resolve: (data, ref) => {
        const r = curveSeriesProvider.resolve({ well: data.well, interpretation: data.interpretation, computed: data.computed, catalog: defaultRoleCatalog }, ref.key);
        if (!r) return null;
        const { indexOfKey: _sin, ...rest } = r;
        return rest;
      },
    });
    s.app.trends = [{ id: 't1', name: 'DT', visible: true, series: { provider: 'curve', key: 'm:DT' }, model: 'linear', mode: 'fit', selection: { top: 1150, base: 1250, excluded: ['1200'] }, extend: false }];
    over!.draw!({ ...s.frame(), ctx });
    const p = onCurve(s.state.vp, 1200);
    expect(moves.some(([x, y]) => Math.abs(x - (p.x - 3)) < 0.01 && Math.abs(y - (p.y - 3)) < 0.01)).toBe(true);
  });
});
