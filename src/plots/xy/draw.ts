/**
 * Dibujo en canvas del gráfico x–y (docs/decisiones/0010, D6): marco, grilla, ticks y rótulos de los ejes; puntos,
 * líneas, guías y tendencias (con la capa de la 6b-1: `trendGeometry` recibe los dos mapeos dato→px de este gráfico,
 * `transpose: false`). Sin React: lo usa `XYPlot.tsx` y lo puede usar cualquier gráfico de la fase 7.
 */
import { evalTrend, type TrendCoefficients } from '../../petro/regression';
import { withAlpha } from '../../ui/color';
import { BASE_TOKENS, scalePx, type ThemeTokens } from '../../ui/tokens';
import { drawTrend, drawTrendLabel, trendGeometry } from '../trend/draw';
import { axisTicks, type XYAxis, type XYMapping } from './axes';
import type { XYGuide, XYLineLayer, XYPointLayer, XYTrendLayer } from './layers';

/** `ui`: factor del tamaño de interfaz (1 en las figuras exportadas). */
const font = (size: number, weight: number = BASE_TOKENS.weight.regular, ui = 1) => `${weight} ${scalePx(size, ui)}px ${BASE_TOKENS.font.sans}`;

/** Título de un eje con su unidad: «Porosidad φ (v/v)». */
export const axisTitle = (a: XYAxis) => (a.unit ? `${a.label} (${a.unit})` : a.label);

/**
 * Fondo, grilla, ticks, rótulos y títulos de los ejes. `ui`: factor del tamaño de interfaz para el texto y sus
 * separaciones (en pantalla; las figuras exportadas usan 1).
 */
export function drawFrame(ctx: CanvasRenderingContext2D, m: XYMapping, xAxis: XYAxis, yAxis: XYAxis, theme: ThemeTokens, compact = false, ui = 1): void {
  const r = m.rect;
  const v = theme.viewer;
  const px = (n: number) => scalePx(n, ui);
  ctx.save();
  ctx.fillStyle = v.trackBg;
  ctx.fillRect(r.x, r.y, r.width, r.height);
  const xt = axisTicks(xAxis, r.width, px(compact ? 44 : 60));
  const yt = axisTicks(yAxis, r.height, px(compact ? 22 : 34));
  // Grilla: menores y después mayores.
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? v.gridMajor : v.gridMinor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of xt) {
      if (t.major !== major) continue;
      const x = Math.round(r.x + t.f * r.width) + 0.5;
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.height);
    }
    for (const t of yt) {
      if (t.major !== major) continue;
      const y = Math.round(r.y + (1 - t.f) * r.height) + 0.5;
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.width, y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = v.trackBorder;
  ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.width) - 1, Math.round(r.height) - 1);
  // Rótulos de los ticks.
  ctx.fillStyle = v.axisText;
  ctx.font = font(compact ? 10 : BASE_TOKENS.text.xs, BASE_TOKENS.weight.regular, ui);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  let lastRight = -Infinity;
  for (const t of xt) {
    if (!t.label) continue;
    const x = r.x + t.f * r.width;
    const w = ctx.measureText(t.label).width;
    const cx = Math.min(r.x + r.width - w / 2, Math.max(r.x + w / 2, x));
    if (cx - w / 2 < lastRight + px(6)) continue;
    ctx.fillText(t.label, cx, r.y + r.height + px(4));
    lastRight = cx + w / 2;
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  let lastTop = Infinity;
  for (const t of yt) {
    if (!t.label) continue;
    const y = Math.min(r.y + r.height - px(5), Math.max(r.y + px(5), r.y + (1 - t.f) * r.height));
    if (y > lastTop - px(11)) continue;
    ctx.fillText(t.label, r.x - px(5), y);
    lastTop = y;
  }
  // Títulos.
  ctx.fillStyle = theme.color.textMuted;
  ctx.font = font(compact ? 10 : BASE_TOKENS.text.xs, BASE_TOKENS.weight.medium, ui);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  if (!compact) ctx.fillText(axisTitle(xAxis), r.x + r.width / 2, r.y + r.height + px(38));
  if (!compact) {
    ctx.save();
    ctx.translate(px(14), r.y + r.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(axisTitle(yAxis), 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

export type PointVariant = 'filled' | 'hollow' | 'crossed';

/** Un punto: lleno (con halo), vacío o vacío con × (descartado). */
export function drawPoint(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, variant: PointVariant, halo: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  if (variant === 'filled') {
    ctx.fillStyle = color;
    ctx.strokeStyle = halo;
    ctx.lineWidth = 1.25;
    ctx.fill();
    ctx.stroke();
    return;
  }
  ctx.fillStyle = withAlpha(halo, 0.85);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.fill();
  ctx.stroke();
  if (variant === 'crossed') {
    const d = r * 0.55;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d);
    ctx.lineTo(x - d, y + d);
    ctx.stroke();
  }
}

/** Polilínea de datos (corta en los NaN). */
export function drawDataLine(ctx: CanvasRenderingContext2D, m: XYMapping, x: ArrayLike<number>, y: ArrayLike<number>, color: string, width = 1.5, dash: number[] = []): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash);
  ctx.beginPath();
  let pen = false;
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const px = m.x(x[i]!);
    const py = m.y(y[i]!);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
}

export interface TrendLayerStyle {
  color: string;
  extend?: boolean;
  label?: readonly [string, string];
  emphasis?: boolean;
  dim?: boolean;
  /** Dónde va la etiqueta: arriba a la izquierda del área (por defecto) o junto al tramo. */
  labelAt?: 'corner' | 'line';
  /** Factor del tamaño de interfaz para la etiqueta (por defecto 1, el de las figuras exportadas). */
  ui?: number;
}

/**
 * Tendencia sobre el gráfico (capa de la 6b-1): tramo sólido, extensión punteada hasta los bordes y etiqueta con la
 * ecuación y R². Devuelve la caja de la etiqueta (para que otras la esquiven).
 */
export function drawXYTrend(
  ctx: CanvasRenderingContext2D,
  m: XYMapping,
  xAxis: XYAxis,
  coeffs: TrendCoefficients,
  span: [number, number],
  style: TrendLayerStyle,
  theme: ThemeTokens,
  avoid: { x: number; y: number; w: number; h: number }[] = [],
): { x: number; y: number; w: number; h: number } | null {
  const r = m.rect;
  const ui = style.ui ?? 1;
  const geom = trendGeometry({
    coeffs,
    span,
    visible: [Math.min(xAxis.min, xAxis.max), Math.max(xAxis.min, xAxis.max)],
    extend: !!style.extend,
    mapping: { x: m.x, y: m.y, transpose: false },
    handles: [],
  });
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  drawTrend(ctx, geom, { color: style.color, halo: theme.viewer.trackBg, emphasis: style.emphasis, dim: style.dim });
  ctx.restore();
  if (!style.label) return null;
  // Etiqueta: arriba a la izquierda del área de dibujo (en un crossplot la línea cruza el medio, donde están los
  // puntos); 'line': junto al comienzo del tramo.
  let anchor: [number, number] | null;
  if (style.labelAt === 'line') {
    const xMid = (span[0] + span[1]) / 2;
    anchor = geom.anchor ?? (Number.isFinite(m.x(xMid)) ? [m.x(xMid), m.y(evalTrend(coeffs, xMid))] : null);
    if (anchor) anchor = [Math.max(r.x + 4, Math.min(anchor[0], r.x + r.width * 0.45)), Math.max(r.y + scalePx(40, ui), Math.min(anchor[1], r.y + r.height))];
  } else anchor = [r.x - 4, r.y + scalePx(46, ui)];
  if (!anchor) return null;
  return drawTrendLabel(
    ctx,
    style.label as [string, string],
    anchor,
    { x0: r.x, x1: r.x + r.width, y0: r.y, y1: r.y + r.height },
    {
      color: style.color,
      bg: withAlpha(theme.color.surfaceRaised, 0.94),
      border: style.emphasis ? withAlpha(style.color, 0.7) : theme.color.border,
      ink: theme.color.text,
      muted: theme.color.textMuted,
      font: font(BASE_TOKENS.text.xs, BASE_TOKENS.weight.medium, ui),
      fontStrong: font(BASE_TOKENS.text.xs, BASE_TOKENS.weight.semibold, ui),
      ui,
    },
    avoid,
  );
}

export interface XYScene {
  points?: readonly XYPointLayer[];
  lines?: readonly XYLineLayer[];
  trends?: readonly XYTrendLayer[];
  guides?: readonly XYGuide[];
}

/**
 * Todo lo que se ve de un gráfico x–y, sin lo interactivo (anillo del puntero, rectángulo de selección): marco, guías,
 * líneas, puntos y tendencias con su etiqueta. Lo usan `XYPlot` en pantalla y la exportación de figuras (PNG/SVG/PDF),
 * así lo exportado es lo que se ve. `ui` (factor del tamaño de interfaz) solo agranda el texto en pantalla: las figuras
 * pasan 1 y salen iguales con cualquier tamaño.
 */
export function drawXYScene(ctx: CanvasRenderingContext2D, m: XYMapping, xAxis: XYAxis, yAxis: XYAxis, scene: XYScene, theme: ThemeTokens, compact = false, ui = 1): void {
  const { points = [], lines = [], trends = [], guides = [] } = scene;
  drawFrame(ctx, m, xAxis, yAxis, theme, compact, ui);
  const r = m.rect;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  for (const g of guides) {
    ctx.save();
    ctx.strokeStyle = g.color;
    ctx.lineWidth = g.width ?? 1.25;
    ctx.setLineDash(g.dash ?? [4, 3]);
    ctx.beginPath();
    if (g.axis === 'x') {
      const px = Math.round(m.x(g.value)) + 0.5;
      ctx.moveTo(px, r.y);
      ctx.lineTo(px, r.y + r.height);
    } else {
      const py = Math.round(m.y(g.value)) + 0.5;
      ctx.moveTo(r.x, py);
      ctx.lineTo(r.x + r.width, py);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (const l of lines) drawDataLine(ctx, m, l.x, l.y, l.color, l.width, l.dash);
  const halo = theme.viewer.trackBg;
  for (const l of points) {
    const n = Math.min(l.x.length, l.y.length);
    if (l.cloud) {
      const c = typeof l.color === 'string' ? l.color : null;
      ctx.fillStyle = withAlpha(c ?? theme.color.textMuted, theme.name === 'dark' ? 0.28 : 0.22);
      const s = l.radius ?? 1.6;
      for (let i = 0; i < n; i++) {
        const px = m.x(l.x[i]!);
        const py = m.y(l.y[i]!);
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        if (c === null) ctx.fillStyle = withAlpha((l.color as (i: number) => string)(i), 0.25);
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }
      continue;
    }
    // Vacíos (descartados) primero: los llenos quedan encima.
    for (const pass of [false, true]) {
      for (let i = 0; i < n; i++) {
        const variant = l.variant?.(i) ?? 'filled';
        if ((variant === 'filled') !== pass) continue;
        const px = m.x(l.x[i]!);
        const py = m.y(l.y[i]!);
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        const color = typeof l.color === 'string' ? l.color : l.color(i);
        drawPoint(ctx, px, py, l.radius ?? 4, variant === 'filled' ? color : withAlpha(color, 0.85), variant, halo);
      }
    }
  }
  ctx.restore();
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  for (const t of trends) {
    const b = drawXYTrend(ctx, m, xAxis, t.coeffs, t.span, { color: t.color, extend: t.extend, label: t.label, emphasis: t.emphasis, ui }, theme, boxes);
    if (b) boxes.push(b);
  }
}
