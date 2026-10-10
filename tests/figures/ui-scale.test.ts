/**
 * Las figuras exportadas no dependen del tamaño de interfaz (docs/decisiones/0013-tamano-de-interfaz.md): el mismo pedido
 * da exactamente el mismo SVG con Compacto, Normal o Grande. El PNG y el PDF dibujan con las mismas funciones.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SvgContext2D, approximateMeasure, templateById, withSvgPath2D } from '../../src/io/export/figures';
import { fitTrend } from '../../src/petro/regression';
import { drawXYFigure, layoutXYFigure, type XYFigureInput } from '../../src/plots/xy/figure';
import { DEFAULT_UI_SCALE, setUiScale, type UiScale } from '../../src/ui/uiScale';
import { drawViewerFigure, layoutViewerFigure } from '../../src/viewer/figure';
import { buildViewerFigure } from '../../src/viewer/figureInput';
import { tpFigureContext, tpRequest } from './support';

afterEach(() => setUiScale(DEFAULT_UI_SCALE));

const LEVELS: UiScale[] = ['compact', 'normal', 'large'];

function viewerSvg(): string {
  const input = buildViewerFigure(tpRequest({ range: { kind: 'visible', top: 7900, base: 8100 } }), tpFigureContext());
  const layout = layoutViewerFigure(input);
  const c = new SvgContext2D({ width: layout.width, height: layout.height, measure: input.measure, title: input.title });
  withSvgPath2D(() => drawViewerFigure(c.asCanvas(), input, layout));
  return c.toSvg('#ffffff');
}

function xySvg(): string {
  const phi = [0.05, 0.08, 0.11, 0.14, 0.17, 0.2];
  const k = phi.map((p) => 0.02 * Math.exp(50 * p));
  const input: XYFigureInput = {
    source: {
      x: { kind: 'linear', min: 0, max: 0.3, label: 'Porosidad φ', unit: 'v/v' },
      y: { kind: 'log', min: 0.01, max: 10000, label: 'Permeabilidad k', unit: 'mD' },
      points: [{ id: 'plugs', name: 'Plugs', x: phi, y: k, color: '#a21caf' }],
      lines: [],
      trends: [{ id: 't', name: 'Exponencial', coeffs: fitTrend(phi, k, 'exp')!, span: [0.05, 0.2], color: '#1d4ed8', extend: true, label: ['k = 0,02·e^(50·φ)', 'R² 1,00'] }],
      guides: [{ axis: 'x', value: 0.1, color: '#d97706' }],
    },
    parts: templateById('crossplot-legend').parts,
    title: 'Crossplot k–φ',
    credits: 'Pozo X · 10/10/2026',
    margin: 22,
    width: 530,
    height: 416,
    measure: approximateMeasure,
  };
  const layout = layoutXYFigure(input);
  const c = new SvgContext2D({ width: layout.width, height: layout.height, measure: input.measure });
  withSvgPath2D(() => drawXYFigure(c.asCanvas(), input, layout));
  return c.toSvg('#ffffff');
}

describe('figuras y tamaño de interfaz', () => {
  it('el perfil exportado (con zonas y control de calidad) es idéntico en los tres niveles', () => {
    const out = LEVELS.map((level) => {
      setUiScale(level);
      return viewerSvg();
    });
    expect(out[0]!.length).toBeGreaterThan(10_000);
    expect(out[1]).toBe(out[0]);
    expect(out[2]).toBe(out[0]);
    // Rótulos de profundidad con la letra de siempre (11 px), no la de la pantalla.
    expect(out[0]).toContain('font-size="11"');
  });

  it('el gráfico x–y exportado (ejes, puntos, tendencia con etiqueta) es idéntico en los tres niveles', () => {
    const out = LEVELS.map((level) => {
      setUiScale(level);
      return xySvg();
    });
    expect(out[1]).toBe(out[0]);
    expect(out[2]).toBe(out[0]);
  });
});
