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
import { hasBox, MISSING_TEXT, type DistributionCell } from './distribution';
import type { LaneHistogram } from './hist';
import { CORE_MIN_BOX } from './plugs';

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
  /** Alto del área de los histogramas de una fila (vista «Histogramas», todas las series superpuestas). */
  hist: 38,
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

/** Alto de la fila de una zona con `lanes` series (px CSS). En la vista de histogramas las series se superponen. */
export const rowHeight = (lanes: number, ui = 1, view: 'box' | 'hist' = 'box') =>
  scalePx(DIST_METRICS.padY * 2 + (view === 'hist' ? DIST_METRICS.hist + 4 : Math.max(1, lanes) * DIST_METRICS.lane), ui);

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

/** Carril bajo el puntero (−1 si cae en el margen). En la vista de histogramas hay un solo «carril»: la fila. */
export function laneAt(y: number, lanes: number, ui = 1, view: 'box' | 'hist' = 'box'): number {
  if (view === 'hist') return y >= 0 && y <= rowHeight(lanes, ui, 'hist') ? 0 : -1;
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

/** Desplazamiento vertical determinista de un plug (−1…1): separa puntos de igual valor sin azar. */
const jitter = (j: number) => (((j * 7919) % 9) - 4) / 4;

/**
 * Plugs de corona de una zona como puntos sobre el carril. Con pocos plugs (< `CORE_MIN_BOX`) son la marca principal
 * (sin caja); con más, quedan tenues detrás de la caja y muestran la dispersión real del laboratorio.
 */
export function drawPlugDots(ctx: CanvasRenderingContext2D, x: (v: number) => number, yc: number, values: readonly number[], style: LaneStyle, theme: ThemeTokens, ui = 1, spread = scalePx(DIST_METRICS.box, ui) * 0.42): void {
  const few = values.length < CORE_MIN_BOX;
  const r = scalePx(few ? 3.5 : 2, ui);
  ctx.save();
  values.forEach((v, j) => {
    const px = x(v);
    if (!Number.isFinite(px)) return;
    const py = yc + (few ? 0 : jitter(j) * spread);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    if (few) {
      ctx.fillStyle = style.color;
      ctx.fill();
      ctx.lineWidth = Math.max(1, scalePx(1.25, ui));
      ctx.strokeStyle = theme.viewer.trackBg;
      ctx.stroke();
    } else {
      ctx.fillStyle = withAlpha(style.color, theme.name === 'dark' ? 0.55 : 0.45);
      ctx.fill();
    }
  });
  ctx.restore();
}

/** Histogramas de una fila (vista «Histogramas»): todas las series sobre la misma base, la primera rellena. */
export interface RowHistScene {
  edges: ArrayLike<number>;
  /** Una por serie; cada una se escala a su propio pico (`LaneHistogram.peak`). */
  lanes: readonly (LaneHistogram | null)[];
}

/** Mediana (línea) y media (rombo hueco sobre la base) de una serie en la vista de histogramas. */
function drawHistMarks(ctx: CanvasRenderingContext2D, x: (v: number) => number, base: number, h: number, s: DistributionStats, style: LaneStyle, theme: ThemeTokens, ui: number): void {
  const x50 = x(s.p50);
  const xm = x(s.mean);
  ctx.save();
  if (Number.isFinite(x50)) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(1.5, scalePx(2, ui));
    ctx.beginPath();
    ctx.moveTo(Math.round(x50) + 0.5, base);
    ctx.lineTo(Math.round(x50) + 0.5, base - h);
    ctx.stroke();
  }
  if (Number.isFinite(xm)) {
    const r = scalePx(4, ui);
    ctx.beginPath();
    ctx.moveTo(xm, base - r);
    ctx.lineTo(xm + r, base);
    ctx.lineTo(xm, base + r);
    ctx.lineTo(xm - r, base);
    ctx.closePath();
    ctx.fillStyle = theme.viewer.trackBg;
    ctx.fill();
    ctx.lineWidth = Math.max(1.25, scalePx(1.5, ui));
    ctx.strokeStyle = theme.color.text;
    ctx.stroke();
  }
  ctx.restore();
}

/** Contorno escalonado (y relleno) de un histograma sobre la base. */
function drawStairs(ctx: CanvasRenderingContext2D, x: (v: number) => number, base: number, h: number, edges: ArrayLike<number>, hist: LaneHistogram, style: LaneStyle, filled: boolean, theme: ThemeTokens, ui: number): void {
  const k = edges.length - 1;
  const peak = hist.peak;
  if (k < 1 || !(peak > 0)) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x(edges[0]!), base);
  for (let j = 0; j < k; j++) {
    const y = base - (hist.fraction[j]! / peak) * h;
    ctx.lineTo(x(edges[j]!), y);
    ctx.lineTo(x(edges[j + 1]!), y);
  }
  ctx.lineTo(x(edges[k]!), base);
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = style.fill ?? withAlpha(style.color, theme.name === 'dark' ? 0.32 : 0.22);
    ctx.fill();
  }
  ctx.strokeStyle = style.color;
  ctx.lineWidth = Math.max(1, scalePx(filled ? 1.25 : 1.75, ui));
  ctx.lineJoin = 'round';
  if (style.dashed) ctx.setLineDash([scalePx(4, ui), scalePx(2, ui)]);
  ctx.stroke();
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
  /** Vista «Histogramas»: si está, la fila dibuja los histogramas superpuestos en vez de las cajas. */
  hist?: RowHistScene | null;
}

/** Fila en la vista de histogramas: base común, la primera serie rellena y las demás como contorno. */
function drawHistRow(ctx: CanvasRenderingContext2D, x: (v: number) => number, x0: number, y0: number, width: number, height: number, scene: RowScene, hist: RowHistScene, theme: ThemeTokens, ui: number): void {
  const pad = scalePx(DIST_METRICS.padY, ui);
  const base = Math.round(y0 + height - pad - scalePx(3, ui)) + 0.5;
  const h = base - (y0 + pad);
  ctx.strokeStyle = theme.viewer.trackBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, base);
  ctx.lineTo(x0 + width, base);
  ctx.stroke();
  let drawn = 0;
  const firstFilled = scene.cells.findIndex((c, k) => !!hist.lanes[k] && !(c.plugs && (c.stats?.n ?? 0) < CORE_MIN_BOX));
  // Contornos primero, la serie rellena al final no tapa a las otras: se dibuja primero su relleno.
  const order = scene.cells.map((_, k) => k).sort((a, b) => (a === firstFilled ? -1 : b === firstFilled ? 1 : a - b));
  for (const k of order) {
    const c = scene.cells[k]!;
    const style = scene.styles[k] ?? { color: theme.color.accent };
    const lh = hist.lanes[k];
    if (c.plugs && c.stats && c.stats.n > 0 && c.stats.n < CORE_MIN_BOX) {
      drawPlugDots(ctx, x, base - scalePx(5, ui), c.plugs.values, style, theme, ui);
      drawn++;
      continue;
    }
    if (!lh || !c.stats || !(c.stats.n > 0)) continue;
    drawStairs(ctx, x, base, h, hist.edges, lh, style, k === firstFilled, theme, ui);
    drawn++;
  }
  for (const k of order) {
    const c = scene.cells[k]!;
    if (!hist.lanes[k] || !c.stats || !(c.stats.n > 0) || (c.plugs && c.stats.n < CORE_MIN_BOX)) continue;
    drawHistMarks(ctx, x, base, h, c.stats, scene.styles[k] ?? { color: theme.color.accent }, theme, ui);
  }
  const sel = scene.selection;
  if (sel && sel.stats.n > 0 && Number.isFinite(sel.stats.p50)) drawSelectionBox(ctx, x, y0 + pad + scalePx(2, ui), sel.stats, sel.color, theme, ui);
  if (drawn === 0) {
    const c = scene.cells[0];
    ctx.fillStyle = theme.color.textMuted;
    ctx.font = canvasFont(BASE_TOKENS.text.xs, BASE_TOKENS.weight.regular, ui);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(c?.plugs && !c.stats ? MISSING_TEXT[c.missing ?? 'plugs'] : 'sin dato', x0 + scalePx(DIST_METRICS.padX, ui), y0 + height / 2);
  }
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
  if (scene.hist) drawHistRow(ctx, x, x0, y0, width, height, scene, scene.hist, theme, ui);
  else scene.cells.forEach((c, k) => {
    const yc = top + (k + 0.5) * lane;
    if (scene.hover === k) {
      ctx.fillStyle = withAlpha(theme.color.text, theme.name === 'dark' ? 0.08 : 0.05);
      ctx.fillRect(x0, yc - lane / 2, width, lane);
    }
    const style = scene.styles[k] ?? { color: theme.color.accent };
    if (c.plugs && c.stats && c.stats.n > 0) {
      // Plugs: puntos siempre; la caja solo con suficientes plugs (una caja de 3 plugs engaña).
      drawPlugDots(ctx, x, yc, c.plugs.values, style, theme, ui);
      if (c.stats.n >= CORE_MIN_BOX && hasBox(c)) drawBox(ctx, x, yc, c.stats, style, theme, ui);
    } else if (c.stats && hasBox(c)) {
      drawBox(ctx, x, yc, c.stats, style, theme, ui);
      const sel = scene.selection;
      if (sel && sel.lane === k && sel.stats.n > 0 && Number.isFinite(sel.stats.p50)) drawSelectionBox(ctx, x, yc, sel.stats, sel.color, theme, ui);
    } else {
      ctx.fillStyle = theme.color.textMuted;
      ctx.font = canvasFont(BASE_TOKENS.text.xs, BASE_TOKENS.weight.regular, ui);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.plugs ? (c.stats ? 'ningún plug pasa el filtro' : MISSING_TEXT[c.missing ?? 'plugs']) : 'sin dato', x0 + scalePx(DIST_METRICS.padX, ui), yc);
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
  /** Vista «Histogramas»: los histogramas de cada fila (mismo orden que `rows`). */
  hists?: readonly RowHistScene[] | null;
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
  const view = scene.hists ? 'hist' : 'box';
  const natural = rowHeight(lanes, 1, view);
  const free = Math.max(1, height - axisH);
  const k = Math.min(1, free / Math.max(1, scene.rows.length * (natural + 4)));
  const ui = Math.max(0.55, k);
  const rowH = rowHeight(lanes, ui, view);
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
    const hist = scene.hists?.[i];
    drawZoneRow(ctx, plotW, rowH, { axis: scene.axis, cells: scene.cells[i] ?? [], styles: scene.styles[i] ?? [], ...(r.cutoff ? { cutoff: r.cutoff } : {}), ...(hist ? { hist } : {}) }, theme, ui, labelW, y);
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
