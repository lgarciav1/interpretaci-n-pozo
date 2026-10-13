/** Verificación del contrato visual: tabla única, contactos, interacción y mosaicos vectoriales exportados. */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation } from '../src/core/interpretation';
import { createWell } from '../src/core/well';
import type { ReadonlyTableValue } from '../src/core/module';
import type { OverlayHitFrame, ViewerTable } from '../src/viewer/overlay';
import { SvgContext2D, approximateMeasure } from '../src/io/export/figures';
import { THEMES } from '../src/ui/tokens';
import { GRAIN_AXIS, layerAt, layersForFrame, layerTooltip, overlays } from '../src/modules/sed-column/overlay';
import { LITHOLOGY_PATTERNS, PATTERN_REFERENCE } from '../src/modules/sed-column/draw';
import { selectLayer } from '../src/modules/sed-column/selection';

const row = (top: number, base: number, lithology = 'sandstone', width = .66) => ({
  top, base, lithology, width, grain: 'medium', source: 'minerals', belowMinimum: 0,
  quartz: .8, calcite: .1, dolomite: 0, clay: .05, phi: .05, vsh: .1,
});

function frame(tables: readonly ViewerTable[] = []): OverlayHitFrame {
  const depth = new Float64Array([1000, 1001, 1002]);
  const well = createWell({ id: 'sed-test', name: 'Columna', depth, curves: [] });
  return {
    theme: THEMES.light, viewport: { top: 1000, base: 1002, height: 200, pxPerM: 100, yOf: value => (value - 1000) * 100, depthOf: y => 1000 + y / 100 },
    tracks: [{ id: 'ov:sed-column', overlayId: 'sed-column', kind: 'overlay', title: 'Columna', x: 0, width: 250, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null }],
    data: { wellId: well.id, depth, well, interpretation: emptyInterpretation(), computed: [], tables, zones: [], qc: null, selectedZoneId: null },
    invalidate() {},
  };
}

const layerTable = (value: ReadonlyTableValue, active = true): ViewerTable => ({ moduleId: 'sed-column', port: 'SED_COLUMN_LAYERS', active, value });

describe('columna sedimentológica: pista y exportación', () => {
  it('lee la tabla activa del motor, comparte su caché y no recalcula desde las curvas', () => {
    const table = { rows: [row(1000, 1001), row(1001, 1002, 'coal', .5)] };
    const input = frame([layerTable({ rows: [row(0, 1)] }, false), layerTable(table)]);
    expect(layersForFrame(input)).toHaveLength(2);
    expect(layersForFrame(input)).toBe(layersForFrame(input));
    expect(layersForFrame(frame())).toEqual([]);
    expect(layerAt(layersForFrame(input), 1001)?.lithology).toBe('coal');
    expect(layerAt(layersForFrame(input), 1002)?.lithology).toBe('coal');
    expect(layerAt(layersForFrame(input), 1003)).toBeNull();
  });

  it('identifica la procedencia, los volúmenes medios y la estimación de grano en el tooltip', () => {
    const input = frame([layerTable({ rows: [row(1000, 1001)] })]);
    const layer = layersForFrame(input)[0]!;
    expect(layerTooltip(layer)).toContain('Cuarzo 80');
    expect(layerTooltip(layer)).toContain('Inversión mineral');
    expect(layerTooltip(layer)).toContain('no es una descripción de testigo');
    const hit = overlays[0]!.hit!(input, { x: 30, y: 50, depth: 1000.5, track: input.tracks[0]! });
    expect(hit?.range).toEqual({ top: 1000, base: 1001 });
    expect(overlays[0]!.targets!(input)[0]?.hit.key).toBe(hit?.key);
  });

  it('exporta mosaicos vectoriales con tamaño constante y recorta el dibujo visible en ambos temas', () => {
    for (const theme of [THEMES.light, THEMES.dark]) {
      const ctx = new SvgContext2D({ width: 250, height: 200, measure: approximateMeasure });
      const input = frame([layerTable({ rows: [row(999, 1001), row(1001, 1003, 'limestone', .3)] })]);
      overlays[0]!.draw({ ...input, theme, ctx: ctx.asCanvas() });
      const svg = ctx.toSvg(theme.viewer.trackBg);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(svg).toContain('<pattern');
      expect(svg).toContain('patternUnits="userSpaceOnUse"');
      expect(svg).toContain('clipPath');
      expect(svg).toContain('width="12"');
      expect(svg).toContain('width="16"');
    }
  });

  it('la cabecera aporta clases ordinales y la leyenda diferencia tramas verificadas de provisionales', () => {
    expect(GRAIN_AXIS.map(entry => entry.label)).toEqual(['arc', 'lim', 'mf', 'f', 'm', 'g', 'gr']);
    expect(overlays[0]!.track?.unit).toBeUndefined();
    expect(PATTERN_REFERENCE.limestone).toBe('FGDC 627');
    expect(PATTERN_REFERENCE.anhydrite).toBe('SIN VERIFICAR');
    expect(LITHOLOGY_PATTERNS.coal.lines).toBeUndefined();
  });

  it('exportar después de seleccionar una capa produce la misma figura sin foco transitorio', () => {
    const input = frame([layerTable({ rows: [row(1000, 1001), row(1001, 1002, 'limestone')] })]);
    const render = (purpose: 'interactive' | 'export') => {
      const ctx = new SvgContext2D({ width: 250, height: 200, measure: approximateMeasure });
      overlays[0]!.draw({ ...input, ctx: ctx.asCanvas(), purpose, active: { overlayId: 'sed-column', key: 'sed:1000' } });
      return ctx.toSvg(THEMES.light.viewer.trackBg);
    };
    selectLayer(input.data.wellId, null);
    const before = render('export');
    selectLayer(input.data.wellId, 1000);
    expect(render('export')).toBe(before);
    expect(render('interactive')).toContain(THEMES.light.color.accent);
    selectLayer(input.data.wellId, null);
  });
});
