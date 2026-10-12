/**
 * Dibujo en canvas del perfil radial (docs/decisiones/0020, sección 8). Sin React ni stores, pero usa el sistema de
 * diseño y el gráfico x–y (`ui/`, `plots/`): por eso vive en `draw.ts`, que el worker no importa (como `overlay.ts`);
 * lo puro está en `radial.ts`. lo usan el panel del dock
 * y la figura exportada (con tema claro y factor 1). Arriba, el corte esquemático (pozo, zona lavada, formación virgen)
 * con la sensibilidad radial de cada curva como campanas; abajo, resistividad (log) vs distancia al eje del pozo (log),
 * con las lecturas medidas en su mediana de investigación, las del modelo y el perfil escalonado ajustado. Los dos
 * comparten el eje x: un radio está en la misma columna arriba y abajo.
 */
import { axisFraction, niceRange, plotRectFor, xyMapping, type PlotRect, type XYAxis, type XYMapping } from '../../plots/xy/axes';
import { drawFrame, drawPoint } from '../../plots/xy/draw';
import { fillColor } from '../../ui/curves';
import { ensureContrast, mix, withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { BASE_TOKENS, canvasFont, scalePx, type ThemeTokens } from '../../ui/tokens';
import { RADIAL_RANGE, apparentCurve, corteBands, sensitivityCurve, stepPolyline, type CorteBand, type RadialView } from './radial';

/** Eje radial del gráfico: distancia al eje del pozo, log, rango fijo `RADIAL_RANGE`. */
export const RADIAL_X_AXIS: XYAxis = { kind: 'log', min: RADIAL_RANGE.min, max: RADIAL_RANGE.max, label: 'Distancia al eje del pozo', unit: 'in' };

/** Eje de resistividad: décadas enteras que contienen lecturas, modelo, Rxo y Rt (al menos una década). */
export function resistivityAxis(v: Pick<RadialView, 'readings' | 'fit'> | null): XYAxis {
  const vals: number[] = [];
  if (v) {
    for (const r of v.readings) vals.push(r.observed, r.modelled);
    vals.push(v.fit.rxo, v.fit.rt);
  }
  const r = niceRange([vals], 'log') ?? { min: 1, max: 10 };
  return { kind: 'log', min: r.min, max: r.max, label: 'Resistividad', unit: 'ohm·m' };
}

export interface RadialLayout {
  /** Franja del corte (arriba), con el mismo ancho y la misma x que el gráfico. */
  strip: PlotRect;
  /** Gráfico de resistividad (abajo, con los ejes). */
  plot: PlotRect;
  compact: boolean;
}

/**
 * Reparto del lienzo: corte arriba (28 % del alto útil, entre 38 y 72 px de Compacto) y gráfico debajo, alineados en
 * x. Por debajo de 190 px de alto (Compacto) los ejes van sin títulos.
 */
export function radialLayout(width: number, height: number, ui = 1): RadialLayout {
  const compact = height < scalePx(190, ui);
  const all = plotRectFor(width, height, compact, ui);
  const gap = scalePx(compact ? 4 : 6, ui);
  const stripH = Math.round(Math.min(scalePx(72, ui), Math.max(scalePx(38, ui), all.height * 0.28)));
  const strip = { x: all.x, y: all.y, width: all.width, height: stripH };
  const plot = { x: all.x, y: all.y + stripH + gap, width: all.width, height: Math.max(10, all.height - stripH - gap) };
  return { strip, plot, compact };
}

export interface RadialDrawInput {
  view: RadialView | null;
  /** Color de cada curva por rol (de `curveStyle`, con contraste ya asegurado). */
  colors: Readonly<Record<string, string>>;
  /** Color de Rxo (tiñe la zona lavada). */
  rxoColor: string;
  /** Texto cuando no hay vista (sin curvas, sin pozo). */
  emptyText?: string;
}

export const fmtRes = (v: number): string => (Number.isFinite(v) ? formatNumber(v, { significant: 3, grouping: false }) : '—');
export const fmtIn = (v: number): string => (Number.isFinite(v) ? formatNumber(v, { digits: v < 10 ? 1 : 0 }) : '—');

const BAND_LABEL: Record<CorteBand['kind'], string> = { borehole: 'Pozo', flushed: 'Zona lavada', virgin: 'Formación virgen' };

/** Colores del corte: lodo (azul grisáceo), zona lavada (tinte de Rxo) y formación (arena tenue). */
export function corteColors(theme: ThemeTokens, rxoColor: string): Record<CorteBand['kind'], string> & { mudcake: string } {
  const bg = theme.viewer.trackBg;
  const dark = theme.name === 'dark';
  const mud = fillColor('boundWater', theme.name).color;
  const sand = fillColor('sand', theme.name).color;
  const shale = fillColor('shale', theme.name).color;
  return {
    borehole: mix(bg, mud, dark ? 0.42 : 0.5),
    flushed: mix(bg, rxoColor, dark ? 0.26 : 0.17),
    virgin: mix(bg, sand, dark ? 0.16 : 0.24),
    mudcake: shale,
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Texto sobre una placa translúcida del color del fondo (se lee sobre líneas y rellenos). Sin `strokeText`: el mismo
 * dibujo sirve para el SVG de las figuras. Respeta `textAlign` ('left' | 'center' | 'right') y `textBaseline`
 * ('top' | 'middle') vigentes.
 */
function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, halo: string): void {
  const w = ctx.measureText(text).width;
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 11);
  const h = size * 1.25;
  const left = ctx.textAlign === 'center' ? x - w / 2 : ctx.textAlign === 'right' || ctx.textAlign === 'end' ? x - w : x;
  const top = ctx.textBaseline === 'middle' ? y - h / 2 : y - size * 0.12;
  ctx.fillStyle = withAlpha(halo, 0.82);
  ctx.fillRect(left - 2, top, w + 4, h);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function vline(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number): void {
  const px = Math.round(x) + 0.5;
  ctx.beginPath();
  ctx.moveTo(px, y0);
  ctx.lineTo(px, y1);
  ctx.stroke();
}

/**
 * Banda de incertidumbre del frente (intervalo de di que reproduce las lecturas casi igual): rayado diagonal tenue
 * entre ri mínimo y máximo, con bordes punteados. En el corte (`strip`) un poco más marcada.
 */
function drawUncertainty(ctx: CanvasRenderingContext2D, m: XYMapping, view: RadialView, y0: number, y1: number, theme: ThemeTokens, strip: boolean): void {
  if (!Number.isFinite(view.invasionRadiusLow) || !Number.isFinite(view.invasionRadiusHigh)) return;
  const x0 = m.x(Math.max(view.invasionRadiusLow, view.holeRadius));
  const x1 = m.x(view.invasionRadiusHigh);
  if (!(x1 > x0)) return;
  const ink = theme.color.text;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
  ctx.fillStyle = withAlpha(ink, strip ? 0.07 : 0.045);
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = withAlpha(ink, strip ? 0.22 : 0.14);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const h = y1 - y0;
  for (let x = x0 - h; x < x1; x += 6) {
    ctx.moveTo(x, y1);
    ctx.lineTo(x + h, y0);
  }
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = withAlpha(ink, 0.35);
  ctx.lineWidth = 1;
  ctx.setLineDash([1.5, 2.5]);
  vline(ctx, x0, y0, y1);
  vline(ctx, x1, y0, y1);
  ctx.restore();
}

function drawStrip(ctx: CanvasRenderingContext2D, L: RadialLayout, m: XYMapping, input: RadialDrawInput, theme: ThemeTokens, ui: number): void {
  const s = L.strip;
  const view = input.view;
  const px = (n: number) => scalePx(n, ui);
  const colors = corteColors(theme, input.rxoColor);
  const bands = view ? corteBands(view) : [{ kind: 'virgin' as const, from: RADIAL_X_AXIS.min, to: RADIAL_X_AXIS.max }];
  ctx.save();
  ctx.beginPath();
  ctx.rect(s.x, s.y, s.width, s.height);
  ctx.clip();
  for (const b of bands) {
    const x0 = m.x(b.from);
    const x1 = m.x(b.to);
    ctx.fillStyle = colors[b.kind];
    ctx.fillRect(x0, s.y, x1 - x0, s.height);
  }
  // Campanas de sensibilidad radial: de dónde viene la señal de cada curva.
  const labelH = px(L.compact ? 12 : 14);
  const base = s.y + s.height;
  const top = s.y + labelH + px(2);
  if (view) {
    for (const r of [...view.readings].reverse()) {
      const c = input.colors[r.role] ?? theme.color.textMuted;
      const bell = sensitivityCurve(r.r50);
      const missing = !Number.isFinite(r.observed);
      ctx.beginPath();
      ctx.moveTo(m.x(bell.r[0]!), base);
      for (let i = 0; i < bell.r.length; i++) ctx.lineTo(m.x(bell.r[i]!), base - bell.s[i]! * (base - top));
      ctx.lineTo(m.x(bell.r[bell.r.length - 1]!), base);
      ctx.closePath();
      if (!missing) {
        ctx.fillStyle = withAlpha(c, theme.name === 'dark' ? 0.16 : 0.12);
        ctx.fill();
      }
      ctx.strokeStyle = withAlpha(c, missing ? 0.45 : 0.95);
      ctx.lineWidth = 1.25;
      ctx.setLineDash(missing ? [3, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      // Marca en la mediana (r50).
      const xm = Math.round(m.x(r.r50)) + 0.5;
      ctx.strokeStyle = withAlpha(c, missing ? 0.45 : 0.9);
      ctx.beginPath();
      ctx.moveTo(xm, base);
      ctx.lineTo(xm, base - px(4));
      ctx.stroke();
    }
  }
  // Pared del pozo con revoque, intervalo plausible del frente y frente de invasión.
  if (view) {
    drawUncertainty(ctx, m, view, s.y, base, theme, true);
    const wall = m.x(view.holeRadius);
    ctx.strokeStyle = colors.mudcake;
    ctx.lineWidth = 2;
    vline(ctx, wall, s.y, base);
    if (Number.isFinite(view.invasionRadius) && view.invasionRadius > view.holeRadius) {
      ctx.strokeStyle = withAlpha(theme.color.text, 0.7);
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      vline(ctx, m.x(view.invasionRadius), s.y, base);
      ctx.setLineDash([]);
    }
  }
  // Rótulos de las bandas (si entran).
  ctx.font = canvasFont(L.compact ? 10 : BASE_TOKENS.text.xs, BASE_TOKENS.weight.medium, ui);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (const b of bands) {
    const x0 = m.x(b.from);
    const x1 = m.x(b.to);
    const text = BAND_LABEL[b.kind];
    const w = ctx.measureText(text).width;
    if (x1 - x0 < w + px(8)) continue;
    haloText(ctx, text, x0 + px(4), s.y + px(2), theme.color.textMuted, colors[b.kind]);
  }
  ctx.restore();
  ctx.strokeStyle = theme.viewer.trackBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.width) - 1, Math.round(s.height) - 1);
  // Rótulo en el margen izquierdo, como un eje.
  ctx.fillStyle = theme.viewer.axisText;
  ctx.font = canvasFont(L.compact ? 10 : BASE_TOKENS.text.xs, BASE_TOKENS.weight.regular, ui);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('Corte', s.x - px(5), s.y + s.height / 2);
}

function drawPlot(ctx: CanvasRenderingContext2D, L: RadialLayout, m: XYMapping, yAxis: XYAxis, input: RadialDrawInput, theme: ThemeTokens, ui: number): void {
  const r = L.plot;
  const view = input.view;
  const px = (n: number) => scalePx(n, ui);
  const bg = theme.viewer.trackBg;
  const colors = corteColors(theme, input.rxoColor);
  const bottom = r.y + r.height;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  if (view) {
    // Tinte tenue de las bandas del corte detrás de los datos.
    for (const b of corteBands(view)) {
      if (b.kind === 'virgin') continue;
      const x0 = m.x(b.from);
      const x1 = m.x(b.to);
      ctx.fillStyle = withAlpha(colors[b.kind], b.kind === 'borehole' ? 0.55 : 0.6);
      ctx.fillRect(x0, r.y, x1 - x0, r.height);
    }
    ctx.strokeStyle = colors.mudcake;
    ctx.lineWidth = 1.5;
    vline(ctx, m.x(view.holeRadius), r.y, bottom);
    drawUncertainty(ctx, m, view, r.y, bottom, theme, false);
    if (Number.isFinite(view.invasionRadius) && view.invasionRadius > view.holeRadius) {
      ctx.strokeStyle = withAlpha(theme.color.text, 0.55);
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      vline(ctx, m.x(view.invasionRadius), r.y, bottom);
      ctx.setLineDash([]);
    }
    // Lectura según la profundidad de investigación (guía por donde pasan las lecturas modeladas).
    const app = apparentCurve(view);
    if (app.x.length) {
      ctx.strokeStyle = withAlpha(theme.color.textMuted, 0.8);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      for (let i = 0; i < app.x.length; i++) {
        const x = m.x(app.x[i]!);
        const y = m.y(app.y[i]!);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Perfil escalonado ajustado.
    const step = stepPolyline(view);
    if (step.x.length) {
      ctx.strokeStyle = theme.color.text;
      ctx.lineWidth = 2.25;
      ctx.lineJoin = 'miter';
      ctx.setLineDash(step.dashed ? [6, 4] : []);
      ctx.beginPath();
      step.x.forEach((x, i) => (i === 0 ? ctx.moveTo(m.x(x), m.y(step.y[i]!)) : ctx.lineTo(m.x(x), m.y(step.y[i]!))));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Residuos (medida ↔ modelo), modelo (vacío) y medida (lleno).
    for (const rd of view.readings) {
      if (!Number.isFinite(rd.observed) || !Number.isFinite(rd.modelled)) continue;
      const c = input.colors[rd.role] ?? theme.color.textMuted;
      ctx.strokeStyle = withAlpha(c, 0.6);
      ctx.lineWidth = 1.25;
      vline(ctx, m.x(rd.r50), m.y(rd.observed), m.y(rd.modelled));
    }
    for (const rd of view.readings) {
      if (!Number.isFinite(rd.modelled)) continue;
      drawPoint(ctx, m.x(rd.r50), m.y(rd.modelled), px(3.5), input.colors[rd.role] ?? theme.color.textMuted, 'hollow', bg);
    }
    for (const rd of view.readings) {
      if (!Number.isFinite(rd.observed)) continue;
      drawPoint(ctx, m.x(rd.r50), m.y(rd.observed), px(4.5), input.colors[rd.role] ?? theme.color.textMuted, 'filled', bg);
    }
  }
  ctx.restore();

  // Rótulos (fuera del recorte para no cortarlos en los bordes; se acotan al área).
  ctx.save();
  const placed: Box[] = [];
  const fontLabel = canvasFont(L.compact ? 10 : BASE_TOKENS.text.xs, BASE_TOKENS.weight.semibold, ui);
  const fontValue = canvasFont(L.compact ? 10 : BASE_TOKENS.text.xs, BASE_TOKENS.weight.medium, ui);
  const lh = px(L.compact ? 11 : 13);
  const inside = (b: Box) => b.x >= r.x && b.x + b.w <= r.x + r.width && b.y >= r.y && b.y + b.h <= bottom;
  const place = (text: string, candidates: { x: number; y: number }[], color: string, font: string): boolean => {
    ctx.font = font;
    const w = ctx.measureText(text).width;
    for (const c of candidates) {
      const box = { x: c.x, y: c.y, w, h: lh };
      if (!inside(box) || placed.some((p) => overlaps(p, box))) continue;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      haloText(ctx, text, c.x, c.y, color, bg);
      placed.push(box);
      return true;
    }
    return false;
  };
  if (view) {
    // Puntos medidos como obstáculos.
    for (const rd of view.readings) {
      if (!Number.isFinite(rd.observed)) continue;
      const x = m.x(rd.r50);
      const y = m.y(rd.observed);
      placed.push({ x: x - px(5), y: y - px(5), w: px(10), h: px(10) });
    }
    const fit = view.fit;
    const text = theme.color.text;
    if (Number.isFinite(fit.rt)) {
      const yRt = m.y(fit.rt);
      ctx.font = fontValue;
      const rtText = `Rt ${fmtRes(fit.rt)}`;
      const wRt = ctx.measureText(rtText).width;
      const wallX = m.x(Math.max(view.invasionRadius || 0, view.holeRadius));
      place(
        rtText,
        [
          { x: r.x + r.width - wRt - px(5), y: yRt - lh - px(2) },
          { x: r.x + r.width - wRt - px(5), y: yRt + px(3) },
          { x: wallX + px(5), y: yRt - lh - px(2) },
          { x: wallX + px(5), y: yRt + px(3) },
        ],
        text,
        fontValue,
      );
    }
    if (Number.isFinite(view.invasionRadius)) {
      const wall = m.x(view.holeRadius);
      const front = m.x(Math.max(view.invasionRadius, view.holeRadius));
      if (Number.isFinite(fit.rxo)) {
        const yRxo = m.y(fit.rxo);
        const rxoText = `Rxo ${fmtRes(fit.rxo)}`;
        place(rxoText, [{ x: wall + px(5), y: yRxo - lh - px(2) }, { x: wall + px(5), y: yRxo + px(3) }, { x: front + px(5), y: yRxo - lh - px(2) }, { x: front + px(5), y: yRxo + px(3) }], text, fontValue);
      }
      const range = Number.isFinite(view.invasionRadiusLow) ? ` (${fmtIn(2 * view.invasionRadiusLow)}–${fmtIn(2 * view.invasionRadiusHigh)})` : '';
      const diText = `di ${fmtIn(2 * view.invasionRadius)} in${range}`;
      place(diText, [{ x: front + px(5), y: r.y + px(3) }, { x: front + px(5), y: bottom - lh - px(3) }, { x: r.x + px(5), y: r.y + px(3) }], withAlpha(text, 0.85), fontValue);
    }
    // Nombre de cada curva junto a su lectura medida.
    for (const rd of view.readings) {
      if (!Number.isFinite(rd.observed)) continue;
      const x = m.x(rd.r50);
      const y = m.y(rd.observed);
      const c = input.colors[rd.role] ?? theme.color.textMuted;
      ctx.font = fontLabel;
      const w = ctx.measureText(rd.label).width;
      place(
        rd.label,
        [
          { x: x + px(6), y: y - lh - px(1) },
          { x: x + px(6), y: y + px(2) },
          { x: x - w - px(6), y: y - lh - px(1) },
          { x: x - w - px(6), y: y + px(2) },
          { x: x - w / 2, y: y - lh - px(7) },
          { x: x - w / 2, y: y + px(7) },
        ],
        c,
        fontLabel,
      );
    }
    if (view.status === 'insufficient') centerText(ctx, r, 'Menos de 3 lecturas válidas: sin ajuste', theme, ui);
  } else centerText(ctx, r, input.emptyText ?? 'Sin datos', theme, ui);
  ctx.restore();
  void yAxis;
}

function centerText(ctx: CanvasRenderingContext2D, r: { x: number; y: number; width: number; height: number }, text: string, theme: ThemeTokens, ui: number): void {
  ctx.font = canvasFont(BASE_TOKENS.text.sm, BASE_TOKENS.weight.medium, ui);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  haloText(ctx, text, r.x + r.width / 2, r.y + r.height / 2, theme.color.textMuted, theme.viewer.trackBg);
}

/**
 * Dibuja el perfil radial en (0, 0) con `width × height` px CSS. `ui`: factor del tamaño de interfaz (1 en las figuras).
 * Devuelve el reparto usado (para ubicar elementos del DOM encima, si hiciera falta).
 */
export function drawRadialProfile(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, input: RadialDrawInput, theme: ThemeTokens, ui = 1): RadialLayout {
  const L = radialLayout(size.width, size.height, ui);
  const yAxis = resistivityAxis(input.view);
  const m = xyMapping(RADIAL_X_AXIS, yAxis, L.plot);
  drawFrame(ctx, m, RADIAL_X_AXIS, yAxis, theme, L.compact, ui);
  drawStrip(ctx, L, m, input, theme, ui);
  drawPlot(ctx, L, m, yAxis, input, theme, ui);
  return L;
}

/** Colores de las curvas para el dibujo, con contraste ≥ 3:1 contra el fondo de la pista. */
export function readableColors(colors: Readonly<Record<string, string>>, theme: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, c] of Object.entries(colors)) out[k] = ensureContrast(c, theme.viewer.trackBg, 3);
  return out;
}

/** x en px de un radio sobre el eje radial (para pruebas y para ubicar elementos del DOM). */
export const radialX = (rect: { x: number; width: number }, r: number): number => rect.x + axisFraction(RADIAL_X_AXIS, r) * rect.width;
