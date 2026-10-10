/** Dimensionado, escala vertical, límites del raster y plantillas (src/io/export/figures/sizing.ts y templates.ts). */
import { describe, expect, it } from 'vitest';
import {
  FIGURE_TEMPLATES,
  RASTER_LIMITS,
  cmToPx,
  creditsLine,
  fitInto,
  formatScale,
  maxDpiFor,
  mmToPt,
  pageContentBox,
  pageSizePt,
  pxPerMeterForScale,
  pxToCm,
  pxToPt,
  rasterLimitProblem,
  rasterSize,
  scaleDenominatorFor,
  templateById,
  templatesFor,
} from '../../src/io/export/figures';

describe('unidades', () => {
  it('2,54 cm = 96 px = 72 pt; 25,4 mm = 72 pt', () => {
    expect(cmToPx(2.54)).toBeCloseTo(96, 9);
    expect(pxToCm(96)).toBeCloseTo(2.54, 9);
    expect(pxToPt(96)).toBeCloseTo(72, 9);
    expect(mmToPt(25.4)).toBeCloseTo(72, 9);
    expect(cmToPx(18)).toBeCloseTo(680.315, 3);
  });

  it('escala vertical a 96 ppp: 1:200 = 18,897 px/m (1 m de pozo = 5 mm de papel); ida y vuelta', () => {
    expect(pxPerMeterForScale(200)).toBeCloseTo(3779.5276 / 200, 4);
    expect(pxPerMeterForScale(500)).toBeCloseTo(7.559, 3);
    // 1 m a 1:200 son 5 mm = 0,5 cm
    expect(pxToCm(pxPerMeterForScale(200))).toBeCloseTo(0.5, 9);
    for (const n of [100, 200, 500, 1000, 3500]) expect(scaleDenominatorFor(pxPerMeterForScale(n))).toBeCloseTo(n, 9);
  });

  it('formatScale: escalas tabuladas exactas y el resto con 2 cifras significativas, con separador de miles es-AR', () => {
    expect(formatScale(200)).toBe('1:200');
    expect(formatScale(1000)).toBe('1:1.000');
    expect(formatScale(3487)).toBe('1:3.500');
    expect(formatScale(137)).toBe('1:140');
  });
});

describe('página y encaje', () => {
  it('A4 en puntos, vertical y horizontal', () => {
    const p = pageSizePt('a4', 'portrait');
    expect(p.width).toBeCloseTo(595.276, 2);
    expect(p.height).toBeCloseTo(841.89, 2);
    expect(pageSizePt('a4', 'landscape')).toEqual({ width: p.height, height: p.width });
  });
  it('zona útil con margen igual en los cuatro lados', () => {
    const b = pageContentBox('a4', 'portrait', 12);
    expect(b.x).toBeCloseTo(mmToPt(12), 9);
    expect(b.width).toBeCloseTo(mmToPt(186), 6);
    expect(b.height).toBeCloseTo(mmToPt(273), 6);
    expect(pageContentBox('a4', 'portrait', 500)).toMatchObject({ width: 0, height: 0 });
  });
  it('fitInto conserva la proporción, no agranda más de maxZoom y tolera lo inválido', () => {
    expect(fitInto(200, 100, 100, 100)).toEqual({ width: 100, height: 50, zoom: 0.5 });
    expect(fitInto(10, 10, 100, 100, 1)).toEqual({ width: 10, height: 10, zoom: 1 });
    expect(fitInto(10, 20, 100, 100, 1.6).zoom).toBeCloseTo(1.6, 9);
    expect(fitInto(0, 10, 100, 100)).toEqual({ width: 0, height: 0, zoom: 0 });
  });
});

describe('límites del raster', () => {
  it('rasterSize: ppp / 96 sobre los px CSS', () => {
    expect(rasterSize(680, 3000, 300)).toEqual({ scale: 3.125, width: 2125, height: 9375 });
    expect(rasterSize(0.1, 0.1, 96)).toMatchObject({ width: 1, height: 1 });
  });
  it('un lado de más de 16 384 px o más de 120 Mpx se rechaza con un mensaje en español que sugiere salidas', () => {
    expect(rasterLimitProblem(2000, 16384)).toBeNull();
    expect(rasterLimitProblem(2000, 16385)).toMatch(/Bajá la resolución.*SVG/);
    expect(rasterLimitProblem(12000, 12000)).toMatch(/millones de píxeles/);
    expect(rasterLimitProblem(RASTER_LIMITS.maxPixels / 10000, 10000)).toBeNull();
  });
  it('maxDpiFor: la mayor resolución que pasa el límite; con ella pasa y 1 ppp más ya no (o 0 si ni a 96 ppp entra)', () => {
    const w = 700;
    const h = 6692; // todo el pozo del TP a 1:500
    const dpi = maxDpiFor(w, h);
    expect(dpi).toBe(235); // el lado mayor manda: 16 384 / 6 692 · 96 = 235,04 (a 300 ppp medirían 20 912 px de alto)
    const ok = rasterSize(w, h, dpi);
    expect(rasterLimitProblem(ok.width, ok.height)).toBeNull();
    const over = rasterSize(w, h, dpi + 2);
    expect(rasterLimitProblem(over.width, over.height)).not.toBeNull();
    expect(maxDpiFor(700, 60000)).toBe(0);
  });
  it('maxDpiFor nunca deja pasar una imagen fuera de los límites (barrido de tamaños)', () => {
    for (const w of [300, 700, 1100, 3000, 9000]) {
      for (const h of [200, 900, 3346, 6692, 15000, 16000]) {
        const dpi = maxDpiFor(w, h);
        if (dpi === 0) {
          const r = rasterSize(w, h, 96);
          expect(rasterLimitProblem(r.width, r.height), `${w}×${h}`).not.toBeNull();
        } else {
          const r = rasterSize(w, h, dpi);
          expect(rasterLimitProblem(r.width, r.height), `${w}×${h} a ${dpi}`).toBeNull();
        }
      }
    }
  });
});

describe('plantillas', () => {
  it('las cuatro del informe, con id único y los datos mínimos', () => {
    expect(FIGURE_TEMPLATES.map((t) => t.id)).toEqual(['profile-full', 'profile-tracks', 'profile-summary', 'crossplot-legend']);
    expect(new Set(FIGURE_TEMPLATES.map((t) => t.label)).size).toBe(4);
    for (const t of FIGURE_TEMPLATES) {
      expect(t.widthCm).toBeGreaterThan(4);
      expect(t.marginCm).toBeGreaterThanOrEqual(0);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.parts.title).toBe(true);
      expect(t.parts.credits).toBe(true);
      if (t.subject === 'profile') expect(t.verticalScale).toBeGreaterThanOrEqual(100);
      else expect(t.heightCm).toBeGreaterThan(4);
    }
  });
  it('cada plantilla pide lo suyo', () => {
    expect(templateById('profile-full').parts).toMatchObject({ wellHeader: true, trackHeaders: true, zoneLegend: true, summary: false });
    expect(templateById('profile-tracks')).toMatchObject({ pickTracks: true, parts: { wellHeader: false, zoneLegend: false } });
    expect(templateById('profile-summary').parts.summary).toBe(true);
    expect(templateById('crossplot-legend')).toMatchObject({ subject: 'crossplot', parts: { legend: true, trackHeaders: false } });
    expect(templatesFor('profile')).toHaveLength(3);
    expect(templatesFor('crossplot')).toHaveLength(1);
    expect(() => templateById('nada' as never)).toThrow(/desconocida/);
  });
  it('créditos: pozo y fecha (es-AR)', () => {
    expect(creditsLine('pozo_tp_perfiles', new Date(2026, 9, 10))).toBe('Pozo pozo_tp_perfiles · 10/10/2026');
  });
});
