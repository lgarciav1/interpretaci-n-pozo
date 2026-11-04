/**
 * Dibujo en canvas de las distribuciones por zona (docs/decisiones/0066): eje compartido, carriles de cajas por serie
 * y la figura exportable. Sin React. Usa los ticks del gráfico x–y (`axisTicks`) para que la grilla de cada fila y el
 * eje de arriba caigan en el mismo lugar. Convención de la caja: P25–P75, línea de mediana, bigotes P10–P90 con
 * remate y la media como rombo hueco (distinto de la mediana).
 */
import type { DistributionStats } from '../../petro/distribution';
import { ensureContrast, withAlpha } from '../../ui/color';
import { BASE_TOKENS, canvasFont, scalePx, type ThemeTokens } from '../../ui/tokens';
import { axisFraction, axisTicks, fractionValue, type XYAxis } from '../xy/axes';
import { axisTitle } from '../xy/draw';
import { hasBox, type DistributionCell } from './distribution';

/** Medidas en px CSS a tamaño de interfaz 1 (se escalan con `ui`). */
export const DIST_METRICS = {
  /** Margen horizontal dentro del área de las cajas (los rótulos de los extremos del eje entran). */
  padX: 14,
  /** Alto de un carril (una serie). */
  lane: 20,
  /** Alto de la caja dentro del carril. */
  box: 11,
  /** Margen vertical de la fila. */
  padY: 5,
  /** Alto del eje. */
  axis: 26,
} as const;

export interface LaneStyle {
  color: string;
  /** Contorno punteado (otros pozos). */
  dashed?: boolean;
  /** Relleno de la caja (por defecto el color con transparencia). Sirve para colores de zona claros. */
  fill?: string;
}

/**
 * Estilo con el color de una zona: el trazo (bigotes, borde, mediana) se oscurece o aclara hasta leerse sobre el
 * fondo; el relleno conserva el color de la zona, para que la caja se reconozca con su banda del visor.
 */
export function zoneLaneStyle(zoneColor: string, theme: ThemeTokens): LaneStyle {
  return { color: ensureContrast(zoneColor, theme.viewer.trackBg, 3.2), fill: withAlpha(zoneColor, theme.name === 'dark' ? 0.4 : 0.5) };
}

/** Alto de la fila de una zona con `lanes` series (px CSS). */
export const rowHeight = (lanes: number, ui = 1) => scalePx(DIST_METRICS.padY * 2 + Math.max(1, lanes) * DIST_METRICS.lane, ui);

/** Valor → px horizontal dentro de un ancho dado (NaN si no se puede ubicar, p. ej. ≤ 0 en log). */
export function laneX(axis: XYAxis, width: number, ui = 1): (v: number) => number {
  const pad = scalePx(DIST_METRICS.padX, ui);
  const span = Math.max(1, width - 2 * pad);
  return (v: number) => {
    const f = axisFraction(axis, v);
    return Number.isFinite(f) ? pad + f * span : NaN;
  };
}

/**
 * px horizontal → valor (inversa de `laneX`), acotado a los extremos del eje: un arrastre que se sale del área queda en
 * el borde. En log, la interpolación es en décadas.
 */
export function laneValue(axis: XYAxis, width: number, x: number, ui = 1): number {
  const pad = scalePx(DIST_METRICS.padX, ui);
  const span = Math.max(1, width - 2 * pad);
  const f = Math.min(1, Math.max(0, (x - pad) / span));
  return fractionValue(axis, f);
}

/** Fracción del eje de un valor, acotada a [0, 1] (posición de las marcas en CSS); NaN si no se puede ubicar. */
export function laneFraction(axis: XYAxis, v: number): number {
  const f = axisFraction(axis, v);
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : NaN;
}

/** Carril bajo el puntero (−1 si cae en el margen). */
export function laneAt(y: number, lanes: number, ui = 1): number {
  const k = Math.floor((y - scalePx(DIST_METRICS.padY, ui)) / scalePx(DIST_METRICS.lane, ui));
  return k >= 0 && k < lanes ? k : -1;
}

/** Grilla vertical alineada con los ticks del eje. */
function drawGrid(ctx: CanvasRenderingContext2D, axis: XYAxis, x0: number, width: number, top: number, height: number, theme: ThemeTokens, ui: number): void {
  const pad = scalePx(DIST_METRICS.padX, ui);
  const ticks = axisTicks(axis, width - 2 * pad, scalePx(60, ui));
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? theme.viewer.gridMajor : theme.viewer.gridMinor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of ticks) {
      if (t.major !== major) continue;
      const x = Math.round(x0 + pad + t.f * (width - 2 * pad)) + 0.5;
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
    }
    ctx.stroke();
  }
}

/** Una caja (P10–P90, P25–P75, mediana y media) centrada en `yc`. */
export function drawBox(ctx: CanvasRenderingContext2D, x: (v: number) => number, yc: number, s: DistributionStats, style: LaneStyle, theme: ThemeTokens, ui = 1): void {
  const bh = scalePx(DIST_METRICS.box, ui);
  const lw = Math.max(1, scalePx(1.25, ui));
  const [x10, x25, x50, x75, x90, xm] = [x(s.p10), x(s.p25), x(s.p50), x(s.p75), x(s.p90), x(s.mean)];
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = lw;
  // Bigotes P10–P90 con remate.
  if (Number.isFinite(x10) && Number.isFinite(x90)) {
    ctx.beginPath();
    ctx.moveTo(x10, yc);
    ctx.lineTo(x25, yc);
    ctx.moveTo(x75, yc);
    ctx.lineTo(x90, yc);
    for (const xe of [x10, x90]) {
      ctx.moveTo(Math.round(xe) + 0.5, yc - bh * 0.32);
      ctx.lineTo(Math.round(xe) + 0.5, yc + bh * 0.32);
    }
    ctx.stroke();
  }
  // Caja P25–P75 (al menos 2 px para que una zona homogénea se vea).
  if (Number.isFinite(x25) && Number.isFinite(x75)) {
    const left = Math.min(x25, x75);
    const w = Math.max(scalePx(2, ui), Math.abs(x75 - x25));
    const bx = w === Math.abs(x75 - x25) ? left : (x25 + x75) / 2 - w / 2;
    ctx.fillStyle = style.fill ?? withAlpha(style.color, theme.name === 'dark' ? 0.3 : 0.2);
    ctx.fillRect(bx, yc - bh / 2, w, bh);
    if (style.dashed) ctx.setLineDash([scalePx(3, ui), scalePx(2, ui)]);
    ctx.strokeRect(Math.round(bx) + 0.5, Math.round(yc - bh / 2) + 0.5, Math.max(1, Math.round(w) - 1), Math.round(bh) - 1);
    ctx.setLineDash([]);
  }
  // Mediana: trazo grueso que sobresale de la caja.
  if (Number.isFinite(x50)) {
    ctx.lineWidth = Math.max(2, scalePx(2.25, ui));
    ctx.beginPath();
    ctx.moveTo(x50, yc - bh / 2 - scalePx(1.5, ui));
    ctx.lineTo(x50, yc + bh / 2 + scalePx(1.5, ui));
    ctx.stroke();
  }
  // Media: rombo hueco (fondo del gráfico) con borde de la serie.
  if (Number.isFinite(xm)) {
    const r = scalePx(4, ui);
    ctx.beginPath();
    ctx.moveTo(xm, yc - r);
    ctx.lineTo(xm + r, yc);
    ctx.lineTo(xm, yc + r);
    ctx.lineTo(xm - r, yc);
    ctx.closePath();
    ctx.fillStyle = theme.viewer.trackBg;
    ctx.fill();
    ctx.lineWidth = Math.max(1.25, scalePx(1.5, ui));
    ctx.strokeStyle = theme.color.text;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Distribución de las muestras seleccionadas (de otra fuente: lazo del crossplot, tramo del visor) como una barra fina
 * dentro de la caja de la zona: P25–P75 rellena, bigotes P10–P90 y la mediana en el color del fondo. Se lee como un
 * «bullet chart»: la caja de la zona queda visible alrededor.
 */
export function drawSelectionBox(ctx: CanvasRenderingContext2D, x: (v: number) => number, yc: number, s: DistributionStats, color: string, theme: ThemeTokens, ui = 1): void {
  const bh = Math.max(3, scalePx(4, ui));
  const [x10, x25, x50, x75, x90] = [x(s.p10), x(s.p25), x(s.p50), x(s.p75), x(s.p90)];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, scalePx(1.5, ui));
  if (Number.isFinite(x10) && Number.isFinite(x90)) {
    ctx.beginPath();
    ctx.moveTo(x10, yc);
    ctx.lineTo(x90, yc);
    ctx.stroke();
  }
  if (Number.isFinite(x25) && Number.isFinite(x75)) {
    const w = Math.max(scalePx(3, ui), Math.abs(x75 - x25));
    const left = w === Math.abs(x75 - x25) ? Math.min(x25, x75) : (x25 + x75) / 2 - w / 2;
    ctx.fillStyle = color;
    ctx.fillRect(left, yc - bh / 2, w, bh);
  }
  if (Number.isFinite(x50)) {
    ctx.strokeStyle = theme.viewer.trackBg;
    ctx.lineWidth = Math.max(1.5, scalePx(1.75, ui));
    ctx.beginPath();
    ctx.moveTo(x50, yc - bh / 2);
    ctx.lineTo(x50, yc + bh / 2);
    ctx.stroke();
  }
  ctx.restore();
}

export interface RowScene {
  axis: XYAxis;
  cells: readonly DistributionCell[];
  styles: readonly LaneStyle[];
  /** Carril resaltado (hover). */
  hover?: number;
  /** Distribución de la selección compartida en el carril `lane` (la interpretación actual). */
  selection?: { lane: number; stats: DistributionStats; color: string } | null;
  /** Solo la figura exportada: cutoff de la zona como línea vertical (en pantalla es una capa DOM arrastrable). */
  cutoff?: { value: number; color: string; dashed?: boolean } | null;
}

/** Fila de una zona: fondo, grilla y un carril por serie (o «sin dato»). Ocupa todo el canvas. */
export function drawZoneRow(ctx: CanvasRenderingContext2D, width: number, height: number, scene: RowScene, theme: ThemeTokens, ui = 1, x0 = 0, y0 = 0): void {
  ctx.save();
  ctx.fillStyle = theme.viewer.trackBg;
  ctx.fillRect(x0, y0, width, height);
  drawGrid(ctx, scene.axis, x0, width, y0, height, theme, ui);
  const lane = scalePx(DIST_METRICS.lane, ui);
  const top = y0 + scalePx(DIST_METRICS.padY, ui);
  const map = laneX(scene.axis, width, ui);
  const x = (v: number) => x0 + map(v);
  scene.cells.forEach((c, k) => {
    const yc = top + (k + 0.5) * lane;
    if (scene.hover === k) {
      ctx.fillStyle = withAlpha(theme.color.text, theme.name === 'dark' ? 0.08 : 0.05);
      ctx.fillRect(x0, yc - lane / 2, width, lane);
    }
    if (c.stats && hasBox(c)) {
      drawBox(ctx, x, yc, c.stats, scene.styles[k] ?? { color: theme.color.accent }, theme, ui);
      const sel = scene.selection;
      if (sel && sel.lane === k && sel.stats.n > 0 && Number.isFinite(sel.stats.p50)) drawSelectionBox(ctx, x, yc, sel.stats, sel.color, theme, ui);
    } else {
      ctx.fillStyle = theme.color.textMuted;
      ctx.font = canvasFont(BASE_TOKENS.text.xs, BASE_TOKENS.weight.regular, ui);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('sin dato', x0 + scalePx(DIST_METRICS.padX, ui), yc);
    }
  });
  const cut = scene.cutoff;
  const xc = cut ? x(cut.value) : NaN;
  if (cut && Number.isFinite(xc)) {
    ctx.strokeStyle = cut.color;
    ctx.lineWidth = Math.max(1.5, scalePx(1.75, ui));
    if (cut.dashed) ctx.setLineDash([scalePx(5, ui), scalePx(3, ui)]);
    ctx.beginPath();
    ctx.moveTo(Math.round(xc) + 0.5, y0);
    ctx.lineTo(Math.round(xc) + 0.5, y0 + height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** Eje compartido: rótulos de los ticks arriba y marcas sobre la línea de base. */
export function drawDistAxis(ctx: CanvasRenderingContext2D, width: number, height: number, axis: XYAxis, theme: ThemeTokens, ui = 1, x0 = 0, y0 = 0): void {
  const pad = scalePx(DIST_METRICS.padX, ui);
  const ticks = axisTicks(axis, width - 2 * pad, scalePx(60, ui));
  const base = y0 + height - 0.5;
  ctx.save();
  ctx.strokeStyle = theme.viewer.trackBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + pad, base);
  ctx.lineTo(x0 + width - pad, base);
  for (const t of ticks) {
    const x = Math.round(x0 + pad + t.f * (width - 2 * pad)) + 0.5;
    const len = scalePx(t.major ? 5 : 3, ui);
    ctx.moveTo(x, base);
    ctx.lineTo(x, base - len);
  }
  ctx.stroke();
  ctx.fillStyle = theme.viewer.axisText;
  ctx.font = canvasFont(BASE_TOKENS.text.xs, BASE_TOKENS.weight.regular, ui);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  let lastRight = -Infinity;
  for (const t of ticks) {
    if (!t.label) continue;
    const w = ctx.measureText(t.label).width;
    const cx = Math.min(x0 + width - w / 2, Math.max(x0 + w / 2, x0 + pad + t.f * (width - 2 * pad)));
    if (cx - w / 2 < lastRight + scalePx(6, ui)) continue;
    ctx.fillText(t.label, cx, base - scalePx(7, ui));
    lastRight = cx + w / 2;
  }
  ctx.restore();
}

// ── figura exportable ────────────────────────────────────────────────────────────────────────────────────────────

export interface FigureRow {
  name: string;
  color: string;
  note?: string;
  /** Cutoff vigente de la zona (línea vertical). */
  cutoff?: { value: number; color: string; dashed?: boolean } | null;
}

export interface DistributionFigureScene {
  axis: XYAxis;
  rows: readonly FigureRow[];
  cells: readonly (readonly DistributionCell[])[];
  styles: readonly (readonly LaneStyle[])[];
}

/**
 * Figura para «Exportar» (tema claro, factor 1): columna de nombres de zona a la izquierda, eje arriba y una fila por
 * zona. Se acomoda al alto disponible achicando las filas (nunca más altas que en pantalla).
 */
export function drawDistributionFigure(ctx: CanvasRenderingContext2D, width: number, height: number, scene: DistributionFigureScene, theme: ThemeTokens): void {
  const labelW = Math.min(170, Math.max(90, width * 0.2));
  const axisH = DIST_METRICS.axis + 16;
  const plotW = width - labelW;
  const lanes = Math.max(1, scene.cells[0]?.length ?? 1);
  const natural = rowHeight(lanes);
  const free = Math.max(1, height - axisH);
  const k = Math.min(1, free / Math.max(1, scene.rows.length * (natural + 4)));
  const ui = Math.max(0.55, k);
  const rowH = rowHeight(lanes, ui);
  const gap = 4 * ui;
  ctx.save();
  // Título del eje sobre los nombres.
  ctx.fillStyle = theme.color.textMuted;
  ctx.font = canvasFont(BASE_TOKENS.text.xs, BASE_TOKENS.weight.medium);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(axisTitle(scene.axis), 0, axisH - 8);
  drawDistAxis(ctx, plotW, DIST_METRICS.axis, scene.axis, theme, 1, labelW, axisH - DIST_METRICS.axis);
  scene.rows.forEach((r, i) => {
    const y = axisH + i * (rowH + gap);
    if (y + rowH > height + 1) return;
    ctx.fillStyle = r.color;
    ctx.fillRect(0, y, 4, rowH);
    ctx.fillStyle = theme.color.text;
    ctx.font = canvasFont(BASE_TOKENS.text.sm, BASE_TOKENS.weight.semibold, ui);
    ctx.textAlign = 'left';
    ctx.textBaseline = r.note ? 'bottom' : 'middle';
    const name = fit(ctx, r.name, labelW - 18);
    ctx.fillText(name, 10, r.note ? y + rowH / 2 + 1 : y + rowH / 2);
    if (r.note) {
      ctx.fillStyle = theme.color.textMuted;
      ctx.font = canvasFont(10, BASE_TOKENS.weight.regular, ui);
      ctx.textBaseline = 'top';
      ctx.fillText(fit(ctx, r.note, labelW - 18), 10, y + rowH / 2 + 2);
    }
    drawZoneRow(ctx, plotW, rowH, { axis: scene.axis, cells: scene.cells[i] ?? [], styles: scene.styles[i] ?? [], ...(r.cutoff ? { cutoff: r.cutoff } : {}) }, theme, ui, labelW, y);
    ctx.strokeStyle = theme.viewer.trackBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(labelW + 0.5, y + 0.5, plotW - 1, rowH - 1);
  });
  ctx.restore();
}

/** Recorta un texto con «…» para que entre en `max` px. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
