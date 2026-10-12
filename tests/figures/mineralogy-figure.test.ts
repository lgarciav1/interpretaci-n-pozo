/** Integración de las regiones minerales en exportaciones SVG, con recorte y leyenda. */
import { describe, expect, it } from 'vitest';
import { SvgContext2D, approximateMeasure, templateById, withSvgPath2D } from '../../src/io/export/figures';
import { drawXYFigure, type XYFigureInput, xyLegendEntries } from '../../src/plots/xy/figure';
import { mineralogyTemplateLayers, mineralogyFullRange, templateDef } from '../../src/plots/crossplot/templates';
import { CLAY_REGIONS, MINERALS } from '../../src/petro/mineralogy';
import { sanitizeCrossplot } from '../../src/core/plots';

function mineralFigure(): XYFigureInput {
  const layers = mineralogyTemplateLayers('th-k');
  return {
    source: {
      x: { kind: 'linear', min: 0, max: 6, label: 'Potasio', unit: 'wt%' },
      y: { kind: 'linear', min: 0, max: 30, label: 'Torio', unit: 'ppm' },
      polygons: layers.polygons, lines: layers.lines, points: [], guides: [], trends: [],
    },
    parts: templateById('crossplot-legend').parts,
    title: 'Tipo de arcilla', credits: 'Regiones orientativas SIN VERIFICAR',
    margin: 22, width: 900, height: 600, measure: approximateMeasure,
  };
}

describe('plantillas Geo-2/Geo-3', () => {
  it('las plantillas sobreviven al saneamiento y resuelven los roles medidos', () => {
    for (const id of ['th-k', 'pe-density'] as const) expect(sanitizeCrossplot({ template: id }).template).toBe(id);
    expect(templateDef('th-k')?.x.role).toBe('POTA');
    expect(templateDef('th-k')?.y.role).toBe('THOR');
    expect(templateDef('pe-density')?.x.role).toBe('PEF');
    expect(templateDef('pe-density')?.y.role).toBe('RHOB');
  });

  it('el rango extendido permite ver todos los minerales pesados', () => {
    const range = mineralogyFullRange();
    for (const mineral of MINERALS) {
      expect(mineral.pe).toBeLessThanOrEqual(range.xRange[1]);
      expect(mineral.rho).toBeLessThanOrEqual(range.yRange[1]);
    }
  });

  it('las regiones minerales salen en SVG y en la leyenda con los mismos datos del motor', () => {
    const input = mineralFigure();
    const ctx = new SvgContext2D({ width: 900, height: 600, measure: approximateMeasure });
    withSvgPath2D(() => drawXYFigure(ctx.asCanvas(), input));
    const svg = ctx.toSvg('#ffffff');
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(svg).toContain('clipPath');
    expect(xyLegendEntries(input.source).map((entry) => entry.text)).toEqual(CLAY_REGIONS.map((region) => region.label));
    for (const region of CLAY_REGIONS) expect(svg).toContain(region.label);
    expect(svg).toMatch(/fill-opacity="0\.09"/);
  });
});
