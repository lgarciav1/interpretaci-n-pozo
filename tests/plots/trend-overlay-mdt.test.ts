/**
 * Tendencias sobre la pista propia de presiones MDT (docs/decisiones/0009): herramienta «elegir tramo» sobre una
 * serie dada («Nuevo gradiente»: vale en cualquier pista y pasa nombre, color y extensión) y conversión de unidades
 * cuando la pista está en otra unidad que la serie (serie en psi, pista en bar).
 */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation } from '../../src/core/interpretation';
import { defaultRoleCatalog } from '../../src/core/roles';
import type { TrendSpec } from '../../src/core/trends';
import { conversionCoefficients } from '../../src/core/units';
import { createWell, type Curve } from '../../src/core/well';
import { examplePressureSet } from '../../src/modules/mdt/example';
import { overlays as mdtOverlays } from '../../src/modules/mdt/overlay';
import { mdtSeriesProvider } from '../../src/modules/mdt/series';
import { evaluateTrend } from '../../src/plots/trend/compute';
import { createTrendsOverlays, TRENDS_OVERLAY_ID, type NewTrendInput, type TrendTool } from '../../src/plots/trend/overlay';
import { THEMES } from '../../src/ui/tokens';
import { layoutTracks, trackAt } from '../../src/viewer/layout';
import type { OverlayHitFrame, OverlayPointer, ViewerData } from '../../src/viewer/overlay';
import { overlayTracks, overlayViewport } from '../../src/viewer/render';
import { resolveTracks } from '../../src/viewer/resolve';
import { withOverlayTracks } from '../../src/viewer/templates';
import { showRange, viewportLimits, yOf, type Viewport } from '../../src/viewer/viewport';
import { evalTrend } from '../../src/petro/regression';
import { addWell, createProject, getWellEntry, type Project } from '../../src/core/state/project';

const depth = Float64Array.from({ length: 801 }, (_, i) => 7900 + i * 0.5); // 7900–8300 m
const gr: Curve = { id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: Float64Array.from(depth, () => 60), origin: { kind: 'measured' } };
const set = examplePressureSet('ej');
const well = createWell({ id: 'w', name: 'W', depth, curves: [gr], pointSets: [set] });

function setup(unit: 'psi' | 'bar') {
  const layout = withOverlayTracks([{ id: 'gr', title: 'GR', kind: 'curves', curves: [{ select: { role: 'GR' } }] }], mdtOverlays, 'petrophysics', { well, settings: { mdt: { unit } } });
  const tracks = resolveTracks(layout, { depth, curves: [gr], computed: [], catalog: defaultRoleCatalog });
  const boxes = layoutTracks(tracks, 400).boxes;
  const app = { trends: [] as TrendSpec[], created: [] as NewTrendInput[], tool: null as TrendTool | null };
  const [, over, lines] = createTrendsOverlays({
    resolve: (data, ref) => (ref.provider === 'mdt' ? mdtSeriesProvider.resolve({ well: data.well, interpretation: data.interpretation, computed: [], catalog: defaultRoleCatalog }, ref.key) : null),
    edit: {
      trends: () => app.trends,
      tool: () => app.tool,
      selected: () => null,
      select: () => {},
      create: (input) => {
        app.created.push(input);
        app.trends = [...app.trends, { id: `t${app.trends.length + 1}`, name: input.name ?? '', ...(input.color ? { color: input.color } : {}), visible: true, series: input.series, model: input.model, mode: input.mode, selection: input.selection, extend: input.extend ?? false }];
      },
      update: () => {},
      togglePoint: () => {},
      finishTool: () => (app.tool = null),
    },
  });
  const lim = viewportLimits(depth, 400, 0.5);
  const vp = showRange(lim, 400, 8050, 8250) as Viewport;
  const commits: { label: string; recipe: (p: Project) => Project }[] = [];
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
      commit: (label, recipe) => commits.push({ label, recipe }),
    };
    return { theme: THEMES.light, viewport: overlayViewport(vp), tracks: overlayTracks(tracks, boxes), data, invalidate: () => {}, active: null };
  };
  const at = (x: number, d: number): OverlayPointer => {
    const f = frame();
    const y = yOf(vp, d);
    const ti = trackAt(boxes, x);
    return { x, y, depth: f.viewport.depthOf(y), track: ti >= 0 ? f.tracks[ti]! : null };
  };
  return { app, commits, over: over!, lines: lines!, frame, at, vp, pressureTrack: () => frame().tracks.find((t) => t.overlayId === 'mdt')! };
}

describe('tendencias en la pista de presión MDT', () => {
  it('la pista está, en la unidad elegida y con escala según los datos', () => {
    const s = setup('bar');
    const t = s.pressureTrack();
    expect(t.unit).toBe('bar');
    expect(t.scale!.min).toBeGreaterThan(800);
    expect(t.scale!.max).toBeLessThanOrEqual(850);
  });

  it('«Nuevo gradiente»: el arrastre en cualquier pista crea la tendencia sobre la serie dada, con nombre, color y extensión', () => {
    const s = setup('psi');
    s.app.tool = { kind: 'fit', series: { ref: { provider: 'mdt', key: 'ej:water' }, label: 'P', name: 'Gradiente de agua', color: '#1c6fd1', extend: true } };
    // En la pista de GR (x = 20): la serie no depende de la pista.
    const hit = s.over.hit!(s.frame(), s.at(20, 8090))!;
    expect(hit.drag).toBeTruthy();
    hit.drag!.move(s.at(20, 8200), s.at(20, 8090));
    hit.drag!.end(s.at(20, 8235), s.at(20, 8090));
    expect(s.app.created).toHaveLength(1);
    expect(s.app.created[0]).toMatchObject({ series: { provider: 'mdt', key: 'ej:water' }, name: 'Gradiente de agua', color: '#1c6fd1', extend: true, openPanel: false, mode: 'fit', model: 'linear' });
    expect(s.app.created[0]!.selection.top).toBeCloseTo(8090, 6);
    expect(s.app.created[0]!.selection.base).toBeCloseTo(8235, 6);
    expect(s.app.tool).toBeNull();
  });

  it('con la pista en bar, las manijas caen sobre la recta convertida (la serie está en psi), en el borde del tramo elegido y con menos prioridad que los puntos', () => {
    for (const unit of ['psi', 'bar'] as const) {
      const s = setup(unit);
      const spec: TrendSpec = { id: 't1', name: 'Agua', visible: true, series: { provider: 'mdt', key: 'ej:water' }, model: 'linear', mode: 'fit', selection: { top: 8090, base: 8235, excluded: [] }, extend: true };
      s.app.trends = [spec];
      const series = mdtSeriesProvider.resolve({ well, interpretation: { ...emptyInterpretation(), trends: [spec] }, computed: [], catalog: defaultRoleCatalog }, 'ej:water')!;
      const r = evaluateTrend(spec, series, []);
      // La manija va en el borde del tramo elegido (8090 m), en el hueco antes del primer punto de agua (8094,5 m).
      const zTop = spec.selection.top!;
      expect(r.span![0]).toBe(zTop);
      const [a, b] = conversionCoefficients('psi', unit);
      const t = s.pressureTrack();
      const x = t.x + t.xOf(null, evalTrend(r.coeffs!, zTop) * a + b)!;
      expect(x).toBeGreaterThan(t.x + 4);
      expect(x).toBeLessThan(t.x + t.width - 4);
      expect(s.over.hit!(s.frame(), s.at(x, zTop))).toBeNull();
      const hit = s.lines.hit!(s.frame(), s.at(x, zTop));
      expect(hit?.key, unit).toBe('t1:top');
      expect(s.lines.order!).toBeLessThan(mdtOverlays[0]!.order!);
      // y la superposición de tendencias identifica su capa
      expect(s.over.id).toBe(TRENDS_OVERLAY_ID);
    }
  });

  it('clic en un punto (aunque esté sobre su gradiente): lo descarta o lo incluye con una receta por commit', () => {
    const s = setup('psi');
    const spec: TrendSpec = { id: 't1', name: 'Agua', visible: true, series: { provider: 'mdt', key: 'ej:water' }, model: 'linear', mode: 'fit', selection: { top: 8090, base: 8235, excluded: [] }, extend: true };
    s.app.trends = [spec];
    const k = set.pointIds.indexOf('MDT-13');
    const z = set.depth[k]!;
    const p = (set.columns['pressure']!.values as Float64Array)[k]!;
    const t = s.pressureTrack();
    const at = s.at(t.x + t.xOf(null, p)!, z);
    const main = mdtOverlays.find((o) => o.id === 'mdt')!;
    // La línea también está ahí (el punto está sobre su gradiente), pero el punto tiene más prioridad.
    expect(s.lines.hit!(s.frame(), at)?.label).toMatch(/Agua/);
    expect(main.order!).toBeGreaterThan(s.lines.order!);
    const hit = main.hit!(s.frame(), at)!;
    expect(hit.label).toMatch(/MDT-13 · 8\.103,5 m · ejemplo sintético/);
    expect(hit.label).toMatch(/clic para descartarlo/);
    hit.activate!();
    expect(s.commits.map((c) => c.label)).toEqual(['Descartar punto MDT']);
    const p0 = addWell(createProject(), well);
    const p1 = s.commits[0]!.recipe(p0);
    expect(getWellEntry(p1, 'w').interpretation.pointSets['ej']!.points['MDT-13']).toEqual({ status: 'exclude' });
    // Las pruebas malas se proponen descartadas: un clic las incluye (decisión explícita).
    const kb = set.pointIds.indexOf('MDT-17');
    const pb = (set.columns['pressure']!.values as Float64Array)[kb]!;
    const hb = main.hit!(s.frame(), s.at(t.x + t.xOf(null, pb)!, set.depth[kb]!))!;
    expect(hb.label).toMatch(/Propuesta: descartar \(sobrecargada, movilidad baja\)/);
    hb.activate!();
    expect(getWellEntry(s.commits[1]!.recipe(p0), 'w').interpretation.pointSets['ej']!.points['MDT-17']).toEqual({ status: 'include' });
    // Teclado: un elemento por punto dibujable (las pruebas sin presión no).
    expect(main.targets!(s.frame()).length).toBe(set.pointIds.length);
  });
});
