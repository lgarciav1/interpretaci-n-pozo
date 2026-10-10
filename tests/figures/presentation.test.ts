/**
 * Lo que NO va en una figura: manijas de las tendencias, cursor, animación de carga y zona seleccionada. Las
 * superposiciones del visor dibujan igual que en pantalla, pero en «modo figura» sin los elementos de edición.
 */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation } from '../../src/core/interpretation';
import { defaultRoleCatalog } from '../../src/core/roles';
import type { TrendSpec } from '../../src/core/trends';
import { createWell, type Curve } from '../../src/core/well';
import { SvgContext2D, withSvgPath2D } from '../../src/io/export/figures';
import { createTrendsOverlays } from '../../src/plots/trend/overlay';
import { curveSeriesProvider } from '../../src/plots/trend/series';
import { THEMES } from '../../src/ui/tokens';
import { layoutTracks } from '../../src/viewer/layout';
import type { OverlayFrame, ViewerData } from '../../src/viewer/overlay';
import { overlayTracks, overlayViewport, ViewerRenderer } from '../../src/viewer/render';
import { resolveTracks } from '../../src/viewer/resolve';
import { checkXml } from './xml';

const depth = Float64Array.from({ length: 1001 }, (_, i) => 1000 + i * 0.5);
const dt: Curve = { id: 'DT', mnemonic: 'DT', role: 'DT', unit: 'us/ft', data: Float64Array.from(depth, (d) => 100 - (d - 1000) * 0.1), origin: { kind: 'measured' } };
const well = createWell({ id: 'w', name: 'W', depth, curves: [dt] });
const tracks = resolveTracks([{ id: 'sonic', title: 'Sónico', kind: 'curves', curves: [{ select: { role: 'DT' } }] }], { depth, curves: [dt], computed: [], catalog: defaultRoleCatalog });
const boxes = layoutTracks(tracks, 300).boxes;
const trend: TrendSpec = { id: 't1', name: 'DT', visible: true, series: { provider: 'curve', key: 'm:DT' }, model: 'linear', mode: 'fit', selection: { top: 1150, base: 1250, excluded: [] }, extend: false };
const resolve = (data: Pick<ViewerData, 'well' | 'interpretation' | 'computed'>, ref: { provider: string; key: string }) =>
  ref.provider === 'curve' ? curveSeriesProvider.resolve({ well: data.well, interpretation: data.interpretation, computed: data.computed, catalog: defaultRoleCatalog }, ref.key) : null;

function drawTrends(presentation: boolean): string {
  const overlays = createTrendsOverlays({ resolve, ...(presentation ? { presentation: true } : {}) });
  const c = new SvgContext2D({ width: 300, height: 400 });
  const data: ViewerData = { wellId: 'w', depth, zones: [], selectedZoneId: null, qc: null, well, interpretation: { ...emptyInterpretation(), trends: [trend] }, computed: [] };
  const frame: OverlayFrame = {
    ctx: c.asCanvas(),
    theme: THEMES.light,
    viewport: overlayViewport({ top: 1100, pxPerM: 2, height: 400 }),
    tracks: overlayTracks(tracks, boxes),
    data,
    invalidate: () => {},
    active: null,
  };
  withSvgPath2D(() => {
    for (const o of overlays) o.draw(frame);
  });
  const svg = c.toSvg();
  checkXml(svg);
  return svg;
}

describe('tendencias en modo figura', () => {
  it('en pantalla la tendencia lleva manijas (círculos en los extremos del tramo); en la figura, no', () => {
    const screen = drawTrends(false);
    const figure = drawTrends(true);
    const circles = (s: string) => (s.match(/A3\.25 3\.25/g) ?? []).length;
    expect(circles(screen)).toBeGreaterThanOrEqual(4); // dos manijas, cada una con dos mitades
    expect(circles(figure)).toBe(0);
  });

  it('la línea, el tramo sombreado y la etiqueta con la ecuación se dibujan igual', () => {
    const figure = drawTrends(true);
    const rep = checkXml(figure);
    expect(rep.elements.some((e) => e.name === 'text' && /R²/.test(e.text))).toBe(true);
    expect(rep.elements.filter((e) => e.name === 'path' && e.attrs['stroke-linecap'] === 'round').length).toBeGreaterThan(0);
    expect(rep.elements.some((e) => e.name === 'rect' && e.attrs['fill-opacity'] === '0.05')).toBe(true);
  });
});

describe('el cuerpo del visor no dibuja nada de interacción ni de carga', () => {
  it('drawBase sin `reveal` no escribe el frente de la animación (degradado) y no toca el cursor', () => {
    const c = new SvgContext2D({ width: 300, height: 400 });
    const data: ViewerData = { wellId: 'w', depth, zones: [], selectedZoneId: null, qc: null, well, interpretation: emptyInterpretation(), computed: [] };
    withSvgPath2D(() => new ViewerRenderer().drawBase(c.asCanvas(), { tracks, boxes, viewport: { top: 1000, pxPerM: 0.8, height: 400 }, theme: THEMES.light, depth, width: 300, overlays: [], data }));
    const svg = c.toSvg();
    const rep = checkXml(svg);
    expect(rep.counts.get('linearGradient') ?? 0).toBe(0);
    expect(rep.counts.get('path')!).toBeGreaterThan(3);
  });
});
