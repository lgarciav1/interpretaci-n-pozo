/**
 * Dibujo en canvas del gráfico x–y (docs/decisiones/0010, D6): marco, grilla, ticks y rótulos de los ejes; puntos,
 * líneas, guías y tendencias (con la capa de la 6b-1: `trendGeometry` recibe los dos mapeos dato→px de este gráfico,
 * `transpose: false`). Sin React: lo usa `XYPlot.tsx` y lo puede usar cualquier gráfico de la fase 7.
 */
import { evalTrend, type TrendCoefficients } from '../../petro/regression';
import { withAlpha } from '../../ui/color';
import { BASE_TOKENS, type ThemeTokens } from '../../ui/tokens';
import { drawTrend, drawTrendLabel, trendGeometry } from '../trend/draw';
import { axisTicks, type XYAxis, type XYMapping } from './axes';

const font = (size: number, weight: number = BASE_TOKENS.weight.regular) => `${weight} ${size}px ${BASE_TOKENS.font.sans}`;

/** Título de un eje con su unidad: «Porosidad φ (v/v)». */
export const axisTitle = (a: XYAxis) => (a.unit ? `${a.label} (${a.unit})` : a.label);

/** Fondo, grilla, ticks, rótulos y títulos de los ejes. */
export function drawFrame(ctx: CanvasRenderingContext2D, m: XYMapping, xAxis: XYAxis, yAxis: XYAxis, theme: ThemeTokens, compact = false): void {
  const r = m.rect;
  const v = theme.viewer;
  ctx.save();
  ctx.fillStyle = v.trackBg;
  ctx.fillRect(r.x, r.y, r.width, r.height);
  const xt = axisTicks(xAxis, r.width, compact ? 44 : 60);
  const yt = axisTicks(yAxis, r.height, compact ? 22 : 34);
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
  ctx.font = font(compact ? 10 : BASE_TOKENS.text.xs);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  let lastRight = -Infinity;
  for (const t of xt) {
    if (!t.label) continue;
    const x = r.x + t.f * r.width;
    const w = ctx.measureText(t.label).width;
    const cx = Math.min(r.x + r.width - w / 2, Math.max(r.x + w / 2, x));
    if (cx - w / 2 < lastRight + 6) continue;
    ctx.fillText(t.label, cx, r.y + r.height + 4);
    lastRight = cx + w / 2;
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  let lastTop = Infinity;
  for (const t of yt) {
    if (!t.label) continue;
    const y = Math.min(r.y + r.height - 5, Math.max(r.y + 5, r.y + (1 - t.f) * r.height));
    if (y > lastTop - 11) continue;
    ctx.fillText(t.label, r.x - 5, y);
    lastTop = y;
  }
  // Títulos.
  ctx.fillStyle = theme.color.textMuted;
  ctx.font = font(compact ? 10 : BASE_TOKENS.text.xs, BASE_TOKENS.weight.medium);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  if (!compact) ctx.fillText(axisTitle(xAxis), r.x + r.width / 2, r.y + r.height + 38);
  if (!compact) {
    ctx.save();
    ctx.translate(14, r.y + r.height / 2);
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
    if (anchor) anchor = [Math.max(r.x + 4, Math.min(anchor[0], r.x + r.width * 0.45)), Math.max(r.y + 40, Math.min(anchor[1], r.y + r.height))];
  } else anchor = [r.x - 4, r.y + 46];
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
      font: font(BASE_TOKENS.text.xs, BASE_TOKENS.weight.medium),
      fontStrong: font(BASE_TOKENS.text.xs, BASE_TOKENS.weight.semibold),
    },
    avoid,
  );
}
