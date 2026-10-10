/**
 * Exportación completa (src/app/export/figureRender.ts) con un motor de raster falso: el mismo código que usa la app
 * en el navegador, sin DOM. PNG con su resolución, SVG bien formado, PDF con estructura válida y contenido esperado.
 */
import { describe, expect, it } from 'vitest';
import { SvgContext2D, approximateMeasure, readPngDpi, withSvgPath2D } from '../../src/io/export/figures';
import { renderFigure, figureSize, pngResolution, type FigureEnv, type FigureOptions, type RasterBackend } from '../../src/app/export/figureRender';
import { fitTrend } from '../../src/petro/regression';
import type { XYFigureSource } from '../../src/plots/xy/figures';
import { parsePdf } from './pdfParse';
import { tinyPng, tpFigureContext } from './support';
import { checkXml } from './xml';

/** Raster falso: ejecuta el dibujo sobre el grabador (así se comprueba que no falla) y devuelve píxeles blancos. */
const calls: { kind: string; width: number; height: number; scale: number }[] = [];
const raster: RasterBackend = {
  measure: approximateMeasure,
  async png(width, height, scale, draw) {
    calls.push({ kind: 'png', width, height, scale });
    withSvgPath2D(() => draw(new SvgContext2D({ width, height }).asCanvas()));
    return tinyPng();
  },
  async rgb(width, height, scale, draw) {
    calls.push({ kind: 'rgb', width, height, scale });
    withSvgPath2D(() => draw(new SvgContext2D({ width, height }).asCanvas()));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    return { width: w, height: h, rgb: new Uint8Array(w * h * 3).fill(255) };
  },
};

const phi = [0.05, 0.08, 0.11, 0.14, 0.17, 0.2];
const k = phi.map((p) => 0.02 * Math.exp(50 * p));
const xySource: XYFigureSource = {
  id: 'core-kphi',
  title: 'Crossplot k–φ de los plugs',
  x: { kind: 'linear', min: 0, max: 0.3, label: 'Porosidad φ', unit: 'v/v' },
  y: { kind: 'log', min: 0.01, max: 10000, label: 'Permeabilidad k', unit: 'mD' },
  points: [{ id: 'plugs', name: 'Plugs de corona', x: phi, y: k, color: '#a21caf' }],
  lines: [],
  trends: [{ id: 't1', name: 'Exponencial', coeffs: fitTrend(phi, k, 'exp')!, span: [0.05, 0.2], color: '#1d4ed8', label: ['k = 0,02·e^(50·φ)', 'R² 1,00 · n 6'] }],
  guides: [],
};

const env = (over: Partial<FigureEnv> = {}): FigureEnv => ({ viewer: tpFigureContext(), xy: [xySource], raster, date: new Date(2026, 9, 10), ...over });
const opts = (over: Partial<FigureOptions> = {}): FigureOptions => ({
  templateId: 'profile-full',
  format: 'png',
  range: { kind: 'well' },
  verticalScale: 1000,
  widthCm: 18,
  heightCm: 0,
  marginCm: 0.6,
  dpi: 150,
  trackIds: null,
  title: '',
  orientation: 'portrait',
  xyId: '',
  ...over,
});
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('PNG', () => {
  it('el perfil del TP: resolución declarada en el archivo, nombre con la escala y dibujo a ppp/96', async () => {
    calls.length = 0;
    const { file, detail } = await renderFigure(opts(), env());
    expect(file.name).toBe('pozo_tp_perfiles_perfil_1a1000.png');
    expect(file.mime).toBe('image/png');
    expect(readPngDpi(file.bytes)).toBe(150);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.scale).toBeCloseTo(150 / 96, 9);
    expect(detail).toMatch(/× .* px · 150 ppp/);
  });

  it('si la resolución pedida no entra en los límites del navegador, se baja a la mayor que entra y se avisa (no falla)', async () => {
    calls.length = 0;
    const { file, detail } = await renderFigure(opts({ verticalScale: 500, dpi: 300 }), env());
    const dpi = readPngDpi(file.bytes)!;
    expect(dpi).toBeLessThan(300);
    expect(dpi).toBeGreaterThan(200);
    expect(calls[0]!.height * calls[0]!.scale).toBeLessThanOrEqual(16384);
    expect(detail).toContain(`${dpi} ppp (bajada de 300`);
    expect(pngResolution(700, 1000, 300)).toEqual({ dpi: 300, capped: false, problem: null });
    expect(pngResolution(700, 6692, 300)).toMatchObject({ dpi: 235, capped: true, problem: null });
  });

  it('una imagen que no entra ni a 96 ppp se rechaza ANTES de intentarlo, con la salida sugerida', async () => {
    calls.length = 0;
    await expect(renderFigure(opts({ verticalScale: 100, dpi: 600 }), env())).rejects.toThrow(/no dibuja más de 16\.384 px por lado.*SVG/);
    expect(calls).toHaveLength(0);
    // el mismo pedido a menos resolución o en un tramo corto sí sale
    await expect(renderFigure(opts({ verticalScale: 100, dpi: 150, range: { kind: 'zone', zoneId: tpFigureContext().zones[2]!.id } }), env())).resolves.toBeTruthy();
  });

  it('el tamaño estimado (para el diálogo) coincide con el que se dibuja', async () => {
    calls.length = 0;
    const size = figureSize(opts(), env())!;
    await renderFigure(opts(), env());
    expect(calls[0]).toMatchObject({ width: size.width, height: size.height });
    expect(figureSize(opts({ format: 'pdf' }), env())).toBeNull();
  });
});

describe('SVG', () => {
  it('perfil del TP: XML válido, vectorial, con la fuente de los tokens', async () => {
    const { file, detail } = await renderFigure(opts({ format: 'svg', verticalScale: 2000 }), env());
    expect(file.name).toBe('pozo_tp_perfiles_perfil_1a2000.svg');
    expect(file.mime).toBe('image/svg+xml');
    const svg = text(file.bytes);
    const rep = checkXml(svg);
    expect(rep.root).toBe('svg');
    expect(svg).toContain('font-family="&quot;Segoe UI Variable Text&quot;');
    expect(detail).toMatch(/vectorial/);
    expect(rep.elements.some((e) => e.name === 'title' && e.text === 'Registros del pozo pozo_tp_perfiles')).toBe(true);
  });

  it('el gráfico x–y a la vista', async () => {
    const { file } = await renderFigure(opts({ templateId: 'crossplot-legend', format: 'svg', widthCm: 14, heightCm: 11, xyId: 'core-kphi' }), env());
    expect(file.name).toBe('pozo_tp_perfiles_Crossplot_k_de_los_plugs.svg'); // el nombre de archivo no lleva φ ni –
    const rep = checkXml(text(file.bytes));
    expect(rep.elements.some((e) => e.name === 'text' && e.text === 'Porosidad φ (v/v)')).toBe(true);
  });
});

describe('PDF', () => {
  it('perfil: una página A4 vertical con texto real, la figura ajustada a la zona útil y el pie con la escala', async () => {
    calls.length = 0;
    const { file, detail } = await renderFigure(opts({ format: 'pdf', verticalScale: 500 }), env());
    expect(file.name).toBe('pozo_tp_perfiles_perfil.pdf');
    expect(file.mime).toBe('application/pdf');
    const pdf = parsePdf(file.bytes);
    expect(pdf.pages).toHaveLength(1);
    const page = pdf.pages[0]!;
    expect(page.mediaBox[2]).toBeCloseTo(595.28, 1);
    expect(page.mediaBox[3]).toBeCloseTo(841.89, 1);
    expect(page.texts[0]).toBe('Registros del pozo pozo_tp_perfiles');
    expect(page.texts[1]).toMatch(/^7633–8519 m · escala vertical 1:4\.400 \(ajustada a la página\)$/);
    expect(page.texts).toContain('Pozo pozo_tp_perfiles · 10/10/2026');
    expect(page.texts).toContain('Escala vertical 1:4.400');
    // la imagen: dentro de los márgenes de 12 mm y a la resolución pedida (px = pt/72·ppp)
    const m = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im1 Do Q/.exec(page.content)!;
    const [w, h, x, y] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
    const margin = (12 / 25.4) * 72;
    expect(x).toBeGreaterThanOrEqual(margin - 0.01);
    expect(x + w).toBeLessThanOrEqual(595.28 - margin + 0.01);
    expect(y).toBeGreaterThanOrEqual(margin);
    expect(y + h).toBeLessThanOrEqual(841.89 - margin);
    const img = page.images[0]!;
    expect(Math.abs(img.width - (w / 72) * 150)).toBeLessThanOrEqual(1);
    expect(Math.abs(img.height - (h / 72) * 150)).toBeLessThanOrEqual(1);
    expect(img.rgb).toHaveLength(img.width * img.height * 3);
    expect(detail).toMatch(/A4 vertical/);
  });

  it('un tramo corto a la escala elegida no se estira: sale a esa escala sin «ajustada»', async () => {
    const zone = tpFigureContext().zones[2]!;
    const { file } = await renderFigure(opts({ format: 'pdf', verticalScale: 1000, range: { kind: 'zone', zoneId: zone.id } }), env());
    const texts = parsePdf(file.bytes).pages[0]!.texts;
    expect(texts).toContain('Escala vertical 1:1.000');
    expect(texts.join('|')).not.toContain('ajustada');
  });

  it('con muchas pistas que no entran a lo ancho, la figura se achica entera, ocupa el alto de la zona útil y la escala dice la impresa', async () => {
    const base = tpFigureContext();
    const sonic = base.tracks.find((t) => t.id === 'sonic')!;
    const many = [...base.tracks.filter((t) => t.kind === 'depth'), ...Array.from({ length: 9 }, (_, i) => ({ ...sonic, id: `s${i}`, title: `Sónico ${i}` }))];
    const { file } = await renderFigure(opts({ format: 'pdf', verticalScale: 1000 }), env({ viewer: { ...base, tracks: many } }));
    const p = parsePdf(file.bytes).pages[0]!;
    const m = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im1 Do Q/.exec(p.content)!;
    const [w, h, , y] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
    const box = (273 / 25.4) * 72;
    // 10 pistas de 104 px + profundidad no entran en 703 px: zoom < 1, y el perfil igual llena el alto disponible
    expect(w).toBeLessThanOrEqual((186 / 25.4) * 72 + 0.01);
    expect(h).toBeGreaterThan(box * 0.9);
    expect(h).toBeLessThanOrEqual(box + 0.01);
    expect(y + h).toBeLessThanOrEqual(841.89 - (12 / 25.4) * 72);
    expect(p.texts[1]).toMatch(/\(ajustada a la página\)$/);
  });

  it('horizontal: la página es apaisada', async () => {
    const { file } = await renderFigure(opts({ format: 'pdf', orientation: 'landscape', verticalScale: 5000 }), env());
    const p = parsePdf(file.bytes).pages[0]!;
    expect(p.mediaBox[2]).toBeGreaterThan(p.mediaBox[3]!);
  });

  it('crossplot: título y pie como texto del PDF, el gráfico como imagen centrada', async () => {
    const { file } = await renderFigure(opts({ templateId: 'crossplot-legend', format: 'pdf', orientation: 'landscape', widthCm: 14, heightCm: 11, xyId: 'core-kphi' }), env());
    const p = parsePdf(file.bytes).pages[0]!;
    expect(p.texts[0]).toBe('Crossplot k–phi de los plugs'); // φ no existe en la codificación del PDF
    expect(p.texts).toContain('Pozo pozo_tp_perfiles · 10/10/2026');
    expect(p.images).toHaveLength(1);
    expect(p.images[0]!.width / p.images[0]!.height).toBeGreaterThan(1);
  });
});

describe('errores en español', () => {
  it('sin pozo', async () => {
    await expect(renderFigure(opts(), env({ viewer: null }))).rejects.toThrow(/Cargá un pozo/);
  });
  it('el gráfico elegido ya no está a la vista', async () => {
    await expect(renderFigure(opts({ templateId: 'crossplot-legend', xyId: 'otro' }), env())).rejects.toThrow(/ya no está a la vista/);
  });
  it('un perfil sin pistas elegidas', async () => {
    await expect(renderFigure(opts({ templateId: 'profile-tracks', trackIds: [] }), env())).rejects.toThrow(/al menos una pista/);
  });
  it('un perfil con tabla que no entra en la página', async () => {
    const ctx = tpFigureContext();
    const summary = { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 80 }, () => ({ a: 1 })) };
    await expect(renderFigure(opts({ templateId: 'profile-summary', format: 'pdf' }), env({ viewer: { ...ctx, summary } }))).rejects.toThrow(/no tiene lugar/);
  });
});
