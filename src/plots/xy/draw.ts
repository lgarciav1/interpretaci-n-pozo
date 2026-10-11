/**
 * Dibujo en canvas del gráfico x–y (docs/decisiones/0010, D6): marco, grilla, ticks y rótulos de los ejes; puntos,
 * líneas, guías y tendencias (con la capa de la 6b-1: `trendGeometry` recibe los dos mapeos dato→px de este gráfico,
 * `transpose: false`). Sin React: lo usa `XYPlot.tsx` y lo puede usar cualquier gráfico de la fase 7.
 */
import { evalTrend, type TrendCoefficients } from '../../petro/regression';
import { withAlpha } from '../../ui/color';
import { BASE_TOKENS, scalePx, type ThemeTokens } from '../../ui/tokens';
import { drawTrend, drawTrendLabel, trendGeometry } from '../trend/draw';
import { axisTicks, xyMapping, type XYAxis, type XYMapping } from './axes';
import type { XYBarLayer, XYGuide, XYLineLayer, XYPointLayer, XYTrendLayer } from './layers';

/** `ui`: factor del tamaño de interfaz (1 en las figuras exportadas). */
const font = (size: number, weight: number = BASE_TOKENS.weight.regular, ui = 1) => `${weight} ${scalePx(size, ui)}px ${BASE_TOKENS.font.sans}`;

/** Título de un eje con su unidad: «Porosidad φ (v/v)». */
export const axisTitle = (a: XYAxis) => (a.unit ? `${a.label} (${a.unit})` : a.label);

/**
 * Fondo, grilla, ticks, rótulos y títulos de los ejes. `ui`: factor del tamaño de interfaz para el texto y sus
 * separaciones (en pantalla; las figuras exportadas usan 1).
 */
export function drawFrame(ctx: CanvasRenderingContext2D, m: XYMapping, xAxis: XYAxis, yAxis: XYAxis, theme: ThemeTokens, compact = false, ui = 1, y2?: XYAxis): void {
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
  // Eje derecho (acumulada): rótulos sin grilla propia.
  if (y2) {
    ctx.textAlign = 'left';
    let last2 = Infinity;
    for (const t of axisTicks(y2, r.height, px(compact ? 22 : 34))) {
      if (!t.label) continue;
      const y = Math.min(r.y + r.height - px(5), Math.max(r.y + px(5), r.y + (1 - t.f) * r.height));
      if (y > last2 - px(11)) continue;
      ctx.fillText(t.label, r.x + r.width + px(5), y);
      last2 = y;
    }
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
    if (y2) {
      ctx.save();
      ctx.translate(r.x + r.width + px(42), r.y + r.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textBaseline = 'middle';
      ctx.fillText(axisTitle(y2), 0, 0);
      ctx.restore();
    }
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
  bars?: readonly XYBarLayer[];
  /** Eje derecho para las líneas con `y2` (acumulada del histograma). */
  y2?: XYAxis;
}

/** Barras de un histograma: relleno translúcido y contorno escalonado (o solo el contorno). */
export function drawBars(ctx: CanvasRenderingContext2D, m: XYMapping, l: XYBarLayer): void {
  const n = Math.min(l.values.length, l.edges.length - 1);
  const y0 = m.rect.y + m.rect.height;
  ctx.save();
  if (!l.outlineOnly) {
    ctx.fillStyle = withAlpha(l.color, l.fillAlpha ?? 0.35);
    for (let j = 0; j < n; j++) {
      const v = l.values[j]!;
      if (!(v > 0)) continue;
      const xa = m.x(l.edges[j]!);
      const xb = m.x(l.edges[j + 1]!);
      const y = m.y(v);
      if (![xa, xb, y].every(Number.isFinite)) continue;
      // 1 px de aire entre barras vecinas si hay lugar.
      const gap = Math.abs(xb - xa) > 6 ? 0.5 : 0;
      ctx.fillRect(Math.min(xa, xb) + gap, y, Math.abs(xb - xa) - 2 * gap, y0 - y);
    }
  }
  // Contorno escalonado.
  ctx.strokeStyle = l.color;
  ctx.lineWidth = l.outlineOnly ? 1.75 : 1.25;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  let pen = false;
  for (let j = 0; j < n; j++) {
    const xa = m.x(l.edges[j]!);
    const xb = m.x(l.edges[j + 1]!);
    const v = l.values[j]!;
    const y = Number.isFinite(v) ? m.y(Math.max(0, v)) : y0;
    if (!Number.isFinite(xa) || !Number.isFinite(xb)) {
      pen = false;
      continue;
    }
    if (!pen) ctx.moveTo(xa, y0);
    ctx.lineTo(xa, y);
    ctx.lineTo(xb, y);
    pen = true;
    if (j === n - 1) ctx.lineTo(xb, y0);
  }
  ctx.stroke();
  ctx.restore();
}

/** Por encima de esta cantidad, la nube densa se dibuja con cuadraditos en vez de círculos. */
export const DENSE_ARC_LIMIT = 12000;

/** Nube densa: puntos sin halo agrupados por color (un trazado por color). */
export function drawDensePoints(ctx: CanvasRenderingContext2D, m: XYMapping, l: XYPointLayer, theme: ThemeTokens, opts: { only?: (i: number) => boolean; alpha?: number } = {}): void {
  const n = Math.min(l.x.length, l.y.length);
  const r = l.radius ?? 2.2;
  const groups = new Map<string, number[]>();
  const fixed = typeof l.color === 'string' ? l.color : null;
  const only = opts.only;
  for (let i = 0; i < n; i++) {
    if (only && !only(i)) continue;
    const px = m.x(l.x[i]!);
    const py = m.y(l.y[i]!);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const c = fixed ?? (l.color as (i: number) => string)(i);
    let g = groups.get(c);
    if (!g) groups.set(c, (g = []));
    g.push(px, py);
  }
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? l.alpha ?? (theme.name === 'dark' ? 0.8 : 0.72);
  // Con muchos puntos, cuadraditos (un `rect` cuesta una fracción de un `arc`; a 3 px no se distinguen).
  const squares = n > DENSE_ARC_LIMIT;
  const side = r * 1.8;
  for (const [c, g] of groups) {
    ctx.fillStyle = c;
    ctx.beginPath();
    for (let k = 0; k < g.length; k += 2) {
      if (squares) ctx.rect(g[k]! - side / 2, g[k + 1]! - side / 2, side, side);
      else {
        ctx.moveTo(g[k]! + r, g[k + 1]!);
        ctx.arc(g[k]!, g[k + 1]!, r, 0, 2 * Math.PI);
      }
    }
    ctx.fill();
  }
  ctx.restore();
}

/** Caja de un rótulo de guía en px (para el puntero y para esquivar otros rótulos). */
export interface GuideLabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rótulo de una guía en una etiqueta: en una vertical, arriba del área, del lado con más lugar; en una horizontal, a
 * la derecha, encima de la línea. Devuelve la caja dibujada.
 */
export function drawGuideLabel(ctx: CanvasRenderingContext2D, m: XYMapping, g: XYGuide, theme: ThemeTokens, ui = 1, row = 0): GuideLabelBox | null {
  if (!g.label) return null;
  const r = m.rect;
  const px = (n: number) => scalePx(n, ui);
  const lines = g.detail ? [g.label, g.detail] : [g.label];
  ctx.save();
  ctx.font = font(BASE_TOKENS.text.xs, BASE_TOKENS.weight.semibold, ui);
  const w0 = ctx.measureText(lines[0]!).width;
  ctx.font = font(BASE_TOKENS.text.xs, BASE_TOKENS.weight.regular, ui);
  const w1 = lines[1] ? ctx.measureText(lines[1]).width : 0;
  const lh = px(14);
  const w = Math.max(w0, w1) + px(12);
  const h = lines.length * lh + px(4);
  let x: number;
  let y: number;
  if (g.axis === 'x') {
    const lx = m.x(g.value);
    if (!Number.isFinite(lx)) return (ctx.restore(), null);
    const right = lx + px(6) + w <= r.x + r.width;
    x = right ? lx + px(6) : lx - px(6) - w;
    x = Math.max(r.x + 2, Math.min(x, r.x + r.width - w - 2));
    y = r.y + px(6) + row * (h + px(4));
  } else {
    const ly = m.y(g.value);
    if (!Number.isFinite(ly)) return (ctx.restore(), null);
    x = r.x + r.width - w - px(6) - row * (w + px(4));
    y = ly - h - px(4) >= r.y ? ly - h - px(4) : ly + px(4);
  }
  ctx.fillStyle = withAlpha(theme.color.surfaceRaised, 0.94);
  ctx.strokeStyle = withAlpha(g.color, 0.65);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, px(4));
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.color.text;
  ctx.font = font(BASE_TOKENS.text.xs, BASE_TOKENS.weight.semibold, ui);
  ctx.fillText(lines[0]!, x + px(6), y + px(2) + lh / 2);
  if (lines[1]) {
    ctx.fillStyle = theme.color.textMuted;
    ctx.font = font(BASE_TOKENS.text.xs, BASE_TOKENS.weight.regular, ui);
    ctx.fillText(lines[1], x + px(6), y + px(2) + lh * 1.5);
  }
  ctx.restore();
  return { x, y, w, h };
}

/**
 * Extremo visible de una polilínea en px: recorre los tramos desde el comienzo (o el final) y devuelve el primer punto
 * del tramo que entra en el área, recortado al borde (Liang–Barsky). null si no se ve.
 */
export function visibleEnd(m: XYMapping, x: ArrayLike<number>, y: ArrayLike<number>, at: 'start' | 'end'): [number, number] | null {
  const r = m.rect;
  const n = Math.min(x.length, y.length);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([m.x(x[i]!), m.y(y[i]!)]);
  if (at === 'end') pts.reverse();
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k]!;
    const [x1, y1] = pts[k + 1]!;
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    const clip = (p: number, q: number) => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
      return true;
    };
    if (clip(-dx, x0 - r.x) && clip(dx, r.x + r.width - x0) && clip(-dy, y0 - r.y) && clip(dy, r.y + r.height - y0) && t0 <= t1) return [x0 + t0 * dx, y0 + t0 * dy];
  }
  if (pts.length === 1) {
    const [a, b] = pts[0]!;
    if (a >= r.x && a <= r.x + r.width && b >= r.y && b <= r.y + r.height) return [a, b];
  }
  return null;
}

/** Rótulo de una línea guía de plantilla junto a un extremo visible («Sw 50 %», «Arenisca»), sobre el fondo de la pista. */
function drawLineLabel(ctx: CanvasRenderingContext2D, m: XYMapping, l: XYLineLayer, theme: ThemeTokens, ui: number): void {
  if (!l.label) return;
  const p = visibleEnd(m, l.x, l.y, l.labelAt ?? 'end');
  if (!p) return;
  const r = m.rect;
  ctx.save();
  ctx.font = font(10, BASE_TOKENS.weight.semibold, ui);
  const w = ctx.measureText(l.label).width;
  const pad = scalePx(5, ui);
  const h = scalePx(7, ui);
  // Del lado de adentro del área, un poco por encima de la línea.
  const x = p[0] + pad + w > r.x + r.width ? Math.max(r.x + 2, p[0] - pad - w) : p[0] + pad;
  const y = Math.max(r.y + h, Math.min(p[1] - h, r.y + r.height - h));
  // Fondo del color de la pista (no `strokeText`: el grabador SVG de las figuras no lo implementa).
  ctx.fillStyle = withAlpha(theme.viewer.trackBg, 0.85);
  ctx.beginPath();
  ctx.roundRect(x - 2, y - h + 1, w + 4, 2 * h - 2, 3);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = l.color;
  ctx.fillText(l.label, x, y);
  ctx.restore();
}

export function drawXYScene(ctx: CanvasRenderingContext2D, m: XYMapping, xAxis: XYAxis, yAxis: XYAxis, scene: XYScene, theme: ThemeTokens, compact = false, ui = 1): void {
  const { points = [], lines = [], trends = [], guides = [], bars = [], y2 } = scene;
  drawFrame(ctx, m, xAxis, yAxis, theme, compact, ui, y2);
  const r = m.rect;
  const m2 = y2 ? xyMapping(xAxis, y2, r) : m;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  for (const b of bars) drawBars(ctx, m, b);
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
  for (const l of lines) drawDataLine(ctx, l.y2 ? m2 : m, l.x, l.y, l.color, l.width, l.dash);
  const halo = theme.viewer.trackBg;
  for (const l of points) {
    const n = Math.min(l.x.length, l.y.length);
    if (l.dense) {
      drawDensePoints(ctx, m, l, theme);
      continue;
    }
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
  for (const l of lines) drawLineLabel(ctx, l.y2 ? m2 : m, l, theme, ui);
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  // Rótulos de las guías (cutoffs): las verticales se apilan en renglones, las horizontales se corren a la izquierda.
  let xRow = 0;
  let yRow = 0;
  for (const g of guides) {
    if (!g.label) continue;
    const b = drawGuideLabel(ctx, m, g, theme, ui, g.axis === 'x' ? xRow++ : yRow++);
    if (b) boxes.push(b);
  }
  for (const t of trends) {
    const b = drawXYTrend(ctx, m, xAxis, t.coeffs, t.span, { color: t.color, extend: t.extend, label: t.label, emphasis: t.emphasis, ui }, theme, boxes);
    if (b) boxes.push(b);
  }
}
