/**
 * Exportar figuras (PNG, SVG, PDF) del perfil y de los gráficos x–y. Sin stores ni DOM: recibe el contexto del pozo, los
 * gráficos publicados y un «motor de raster» (en el navegador, un canvas fuera de pantalla; en los tests, uno falso).
 * El dibujo es el de la pantalla (`drawViewerFigure`, `drawXYFigure`) sobre otro contexto 2D; la pantalla no se toca.
 * docs/decisiones/0012-exportacion-de-figuras.md.
 */
import { withSvgPath2D } from '../../io/export/figures/path';
import { SvgContext2D, type TextMeasure } from '../../io/export/figures/svg';
import { framePdfPage, type PdfPageMeta } from '../../io/export/figures/pdfPage';
import { writePdf, type PdfImage, type PdfItem } from '../../io/export/figures/pdf';
import { setPngDpi } from '../../io/export/figures/png';
import {
  CSS_DPI,
  cmToPx,
  fitInto,
  maxDpiFor,
  rasterLimitProblem,
  rasterSize,
  pxToPt,
  ptToPx,
  type Orientation,
} from '../../io/export/figures/sizing';
import { creditsLine, templateById, type FigureTemplateId } from '../../io/export/figures/templates';
import { safeFileName, type ExportFile } from '../../io/export';
import type { XYFigureSource } from '../../plots/xy/figures';
import { drawXYFigure, layoutXYFigure, type XYFigureInput } from '../../plots/xy/figure';
import { drawViewerFigure, layoutViewerFigure } from '../../viewer/figure';
import { buildViewerFigure, fitViewerFigure, type FigureRange, type ViewerFigureContext, type ViewerFigureRequest } from '../../viewer/figureInput';

export type FigureFormat = 'png' | 'svg' | 'pdf';

export const FIGURE_FORMAT_LABEL: Record<FigureFormat, string> = { png: 'PNG', svg: 'SVG', pdf: 'PDF' };

/** Lo que el usuario eligió en la sección «Figuras». */
export interface FigureOptions {
  templateId: FigureTemplateId;
  format: FigureFormat;
  range: FigureRange;
  /** 1:N (perfil). En PDF es la escala deseada: si el tramo no entra en la página se ajusta. */
  verticalScale: number;
  widthCm: number;
  heightCm: number;
  marginCm: number;
  dpi: number;
  /** Ids de pista (null = todas las que tienen algo que mostrar). */
  trackIds: readonly string[] | null;
  title: string;
  orientation: Orientation;
  /** Gráfico x–y a exportar (plantilla de crossplot). */
  xyId: string;
}

/** Motor de raster: dibuja con un contexto 2D real (o falso) y entrega los píxeles. */
export interface RasterBackend {
  measure: TextMeasure;
  /** PNG de `width × height` px CSS multiplicados por `scale`. */
  png(width: number, height: number, scale: number, draw: (ctx: CanvasRenderingContext2D) => void): Promise<Uint8Array>;
  /** Píxeles RGB de la misma imagen (para incrustar en un PDF). */
  rgb(width: number, height: number, scale: number, draw: (ctx: CanvasRenderingContext2D) => void): Promise<PdfImage>;
}

export interface FigureEnv {
  /** Contexto del pozo activo (null sin pozo). */
  viewer: ViewerFigureContext | null;
  /** Gráficos x–y a la vista. */
  xy: readonly XYFigureSource[];
  raster: RasterBackend;
  date: Date;
}

export interface FigureResult {
  file: ExportFile;
  /** Una línea para el aviso («3.300 × 4.100 px · 300 ppp»). */
  detail: string;
}

const MIME: Record<FigureFormat, string> = { png: 'image/png', svg: 'image/svg+xml', pdf: 'application/pdf' };
const nf = (n: number) => n.toLocaleString('es-AR');

/**
 * Resolución con la que se dibuja un PNG: la pedida, o la mayor que respeta los límites del navegador si el tamaño no la
 * admite (la figura del pozo entero a 1:500 mide 6 700 px de alto: a 300 ppp serían más de 20 000). `problem` si ni a
 * 96 ppp entra: ahí no hay resolución que valga y se sugiere bajar la escala, acortar el tramo o exportar SVG.
 */
export function pngResolution(width: number, height: number, wanted: number): { dpi: number; capped: boolean; problem: string | null } {
  const max = maxDpiFor(width, height);
  if (max === 0) {
    const r = rasterSize(width, height, CSS_DPI);
    return { dpi: wanted, capped: false, problem: rasterLimitProblem(r.width, r.height) };
  }
  return wanted <= max ? { dpi: wanted, capped: false, problem: null } : { dpi: max, capped: true, problem: null };
}

type Drawable = { width: number; height: number; draw: (ctx: CanvasRenderingContext2D) => void; title: string };

/** Dibujo y tamaño de un gráfico x–y para el pedido. En PDF, el título y el pie los pone la página. */
function xyDrawable(o: FigureOptions, env: FigureEnv, pdf: boolean): { drawable: Drawable; meta: PdfPageMeta } {
  const src = env.xy.find((s) => s.id === o.xyId);
  if (!src) throw new Error('El gráfico elegido ya no está a la vista: abrí el panel que lo muestra.');
  const template = templateById(o.templateId);
  const margin = Math.round(cmToPx(o.marginCm));
  const natural = { width: Math.round(cmToPx(o.widthCm)), height: Math.round(cmToPx(o.heightCm)) };
  const credits = creditsLine(env.viewer?.well.name ?? 'sin pozo', env.date);
  const input: XYFigureInput = {
    source: src,
    parts: pdf ? { ...template.parts, title: false, credits: false } : template.parts,
    title: src.title,
    ...(src.colorKey ? { colorKey: src.colorKey } : {}),
    credits,
    margin: pdf ? 0 : margin,
    width: natural.width,
    height: natural.height,
    measure: env.raster.measure,
  };
  const layout = layoutXYFigure(input);
  return {
    drawable: { width: layout.width, height: layout.height, draw: (ctx) => drawXYFigure(ctx, input, layout), title: src.title },
    meta: { title: o.title.trim() || src.title, fields: [], credits },
  };
}

function viewerRequest(o: FigureOptions): ViewerFigureRequest {
  return { template: templateById(o.templateId), range: o.range, verticalScale: o.verticalScale, widthCm: o.widthCm, marginCm: o.marginCm, trackIds: o.trackIds, title: o.title };
}

function fileName(base: string, format: FigureFormat): string {
  return `${safeFileName(base, 'figura')}.${format}`;
}

function toFile(format: FigureFormat, name: string, bytes: Uint8Array, detail: string): FigureResult {
  return { file: { name: fileName(name, format), mime: MIME[format], bytes }, detail };
}

/** Genera la figura pedida. Lanza `Error` con un mensaje en español si no se puede (sin pozo, tramo vacío, imagen enorme…). */
export async function renderFigure(o: FigureOptions, env: FigureEnv): Promise<FigureResult> {
  const template = templateById(o.templateId);
  const isXY = template.subject === 'crossplot';
  if (!isXY && !env.viewer) throw new Error('Cargá un pozo para exportar su perfil.');
  const wellName = env.viewer?.well.name ?? 'figura';

  // ── PDF: una página con texto real y la figura como imagen ───────────────────────────────────────────────────
  if (o.format === 'pdf') return renderPdf(o, env, wellName);

  // ── PNG y SVG: la figura sola ──────────────────────────────────────────────────────────────────────────────
  let drawable: Drawable;
  let base: string;
  if (isXY) {
    drawable = xyDrawable(o, env, false).drawable;
    base = `${wellName}_${drawable.title}`;
  } else {
    const input = buildViewerFigure(viewerRequest(o), env.viewer!);
    const layout = layoutViewerFigure(input);
    drawable = { width: layout.width, height: layout.height, draw: (ctx) => drawViewerFigure(ctx, input, layout), title: input.title };
    base = `${wellName}_perfil_1a${o.verticalScale}`;
  }
  if (o.format === 'svg') {
    const svg = new SvgContext2D({ width: drawable.width, height: drawable.height, measure: env.raster.measure, title: drawable.title });
    withSvgPath2D(() => drawable.draw(svg.asCanvas()));
    const bytes = new TextEncoder().encode(svg.toSvg('#ffffff'));
    return toFile('svg', base, bytes, `${nf(Math.round(drawable.width))} × ${nf(drawable.height)} px · vectorial · ${nf(Math.round(bytes.length / 1024))} kB`);
  }
  const res = pngResolution(drawable.width, drawable.height, o.dpi);
  if (res.problem) throw new Error(res.problem);
  const r = rasterSize(drawable.width, drawable.height, res.dpi);
  const png = setPngDpi(await env.raster.png(drawable.width, drawable.height, r.scale, drawable.draw), res.dpi);
  const capped = res.capped ? ` (bajada de ${o.dpi}: es lo máximo que dibuja el navegador con este tamaño)` : '';
  return toFile('png', base, png, `${nf(r.width)} × ${nf(r.height)} px · ${res.dpi} ppp${capped} · ${nf(Math.round(png.length / 1024))} kB`);
}

async function renderPdf(o: FigureOptions, env: FigureEnv, wellName: string): Promise<FigureResult> {
  const template = templateById(o.templateId);
  const isXY = template.subject === 'crossplot';
  const page = (meta: PdfPageMeta) => framePdfPage(meta, 'a4', o.orientation, template.pageMarginMm);
  let drawable: Drawable;
  let meta: PdfPageMeta;
  let maxZoom = 1;
  let boxPx: { width: number; height: number };
  let framed;

  if (isXY) {
    const { drawable: d, meta: m } = xyDrawable(o, env, true);
    drawable = d;
    meta = m;
    maxZoom = 1.6;
    framed = page(meta);
    boxPx = { width: ptToPx(framed.figure.width), height: ptToPx(framed.figure.height) };
  } else {
    const ctx = env.viewer!;
    // Encabezado y pie van como texto del PDF; la figura trae solo pistas, zonas y tabla.
    const probe = buildViewerFigure(viewerRequest(o), ctx, { margin: 0, parts: { title: false, wellHeader: false, credits: false } });
    meta = { title: probe.title, subtitle: probe.subtitle ?? '', fields: probe.wellFields.map((f) => `${f.label}: ${f.value}`), credits: probe.credits, scaleText: probe.scaleText };
    framed = page(meta);
    boxPx = { width: ptToPx(framed.figure.width), height: ptToPx(framed.figure.height) };
    const sized = buildViewerFigure(viewerRequest(o), ctx, { margin: 0, tracksWidth: Math.floor(boxPx.width), parts: { title: false, wellHeader: false, credits: false } });
    // Si las pistas no entran a lo ancho (el ancho mínimo de una pista es 104 px), toda la figura se achica con `zoom`: el
    // alto que se le puede dar al perfil crece en la misma proporción y la escala impresa es la de después del achique.
    const zoom = Math.min(1, boxPx.width / layoutViewerFigure(sized).width);
    const { input } = fitViewerFigure(sized, boxPx.height / zoom, zoom);
    const layout = layoutViewerFigure(input);
    meta = { ...meta, subtitle: input.subtitle ?? '', scaleText: input.scaleText };
    framed = page(meta);
    drawable = { width: layout.width, height: layout.height, draw: (c) => drawViewerFigure(c, input, layout), title: input.title };
  }

  const fit = fitInto(drawable.width, drawable.height, boxPx.width, boxPx.height, maxZoom);
  if (fit.zoom <= 0) throw new Error('La página no tiene lugar para la figura.');
  const r = rasterSize(drawable.width * fit.zoom, drawable.height * fit.zoom, o.dpi);
  const problem = rasterLimitProblem(r.width, r.height);
  if (problem) throw new Error(problem);
  // La imagen se dibuja a escala `zoom · dpi/96`: queda de `fit.width × fit.height` px CSS (a `dpi` ppp sobre la página).
  const image = await env.raster.rgb(drawable.width, drawable.height, r.scale * fit.zoom, drawable.draw);
  const w = pxToPt(fit.width);
  const h = pxToPt(fit.height);
  const items: PdfItem[] = [...framed.items, { type: 'image', x: framed.figure.x + (framed.figure.width - w) / 2, y: framed.figure.y, w, h, image }];
  const bytes = writePdf({
    pages: [{ width: framed.width, height: framed.height, items }],
    title: meta.title,
    subject: meta.subtitle ?? '',
    creator: 'Interpretación de pozo',
    created: env.date,
  });
  const base = isXY ? `${wellName}_${drawable.title}` : `${wellName}_perfil`;
  return toFile('pdf', base, bytes, `A4 ${o.orientation === 'portrait' ? 'vertical' : 'horizontal'} · imagen de ${nf(image.width)} × ${nf(image.height)} px · ${nf(Math.round(bytes.length / 1024))} kB`);
}

/** Tamaño (px CSS) de la figura que se generaría en PNG o SVG, sin dibujarla; null en PDF (la página es A4). */
export function figureSize(o: FigureOptions, env: FigureEnv): { width: number; height: number } | null {
  if (o.format === 'pdf') return null;
  const template = templateById(o.templateId);
  if (template.subject === 'crossplot') {
    const { drawable } = xyDrawable(o, env, false);
    return { width: drawable.width, height: drawable.height };
  }
  if (!env.viewer) return null;
  const layout = layoutViewerFigure(buildViewerFigure(viewerRequest(o), env.viewer));
  return { width: layout.width, height: layout.height };
}
