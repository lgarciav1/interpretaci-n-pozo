/**
 * Dibujo en canvas de «Preparar datos» (0058): mini-gráfico de las tarjetas de curva y gráfico antes/después con su
 * barra de banderas. Usa `ui/` (tokens, colores) y los ticks de `plots/` y `viewer/`; el worker no lo importa
 * (`tests/modules.test.ts` excluye `draw.ts` de la regla de pureza). Colores solo de tokens.
 *
 * Profundidad en el eje horizontal (el panel es ancho y bajo) y valor en el vertical, con la escala de la curva
 * (logarítmica para resistividades). El original va en gris y la preparada (o la vista previa) en el color de la curva.
 */
import { axisFraction, axisTicks, niceRange, type XYAxis } from '../../plots/xy/axes';
import { BASE_TOKENS, canvasFont, type ThemeTokens } from '../../ui';
import { withAlpha } from '../../ui/color';
import { CATEGORICAL } from '../../ui/curves';
import { depthTicks } from '../../viewer/ticks';
import { Quality } from '../../core/preparation/quality';
import type { Zone } from '../../core/well';
import { columnFlags, dominantFlag, minMaxColumns, QUALITY_FLAGS, type FlagKey } from './flags';
import { histogramFraction, type HistogramModel, type MarkerId } from './normalizationView';

/** Color de cada bandera, de los tokens del tema (claro u oscuro). */
export function flagColor(key: FlagKey, theme: ThemeTokens): string {
  const c = theme.color;
  const cat = CATEGORICAL[theme.name];
  switch (key) {
    case 'missing':
      return c.textSubtle;
    case 'excluded':
      return c.error;
    case 'suspect':
      return c.warn;
    case 'interpolated':
      return c.info;
    case 'filtered':
      return cat[3]!;
    case 'shifted':
      return c.accent;
    case 'corrected':
      return c.ok;
    case 'outOfDomain':
      return cat[1]!;
    case 'estimated':
      return c.info;
    case 'unsupported':
      return c.warn;
    case 'normalized':
      return cat[6]!;
  }
}

// ── mini-gráfico de tarjeta ──────────────────────────────────────────────────────────────────────────────────

export interface SparkInput {
  data: ArrayLike<number>;
  quality: ArrayLike<number>;
  color: string;
  log: boolean;
}

/** Curva completa del pozo (profundidad →) y debajo una franja con la bandera dominante por columna. */
export function drawSparkline(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, theme: ThemeTokens, s: SparkInput): void {
  const { width, height } = size;
  const strip = 4;
  const plotH = height - strip - 2;
  const cols = Math.max(1, Math.floor(width));
  const view = s.log ? toLog(s.data) : s.data;
  const env = minMaxColumns(view, 0, view.length, cols);
  const range = finiteRange(env.min, env.max);
  if (range) {
    const span = range.max - range.min || 1;
    const y = (v: number) => 1 + (plotH - 2) * (1 - (v - range.min) / span);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let open = false;
    for (let c = 0; c < cols; c++) {
      const lo = env.min[c]!, hi = env.max[c]!;
      if (!Number.isFinite(lo)) {
        open = false;
        continue;
      }
      const x = c + 0.5;
      if (!open) ctx.moveTo(x, y(hi));
      else ctx.lineTo(x, y(hi));
      ctx.lineTo(x, y(lo));
      open = true;
    }
    ctx.stroke();
  }
  const bits = columnFlags(s.quality, 0, s.quality.length, cols);
  ctx.fillStyle = theme.color.borderSubtle;
  ctx.fillRect(0, height - strip, width, strip);
  for (let c = 0; c < cols; c++) {
    const k = dominantFlag(bits[c]!);
    if (!k) continue;
    ctx.fillStyle = flagColor(k, theme);
    ctx.fillRect(c, height - strip, 1, strip);
  }
}

// ── gráfico antes / después ─────────────────────────────────────────────────────────────────────────────────

export interface ChartInput {
  depth: Float64Array;
  /** Ventana de índices [start, end) que se dibuja. */
  start: number;
  end: number;
  original: Float64Array;
  /** Preparada vigente o vista previa (null = solo el original, en el color de la curva). */
  after: Float64Array | null;
  /** Banda calibrada F20, sólo donde hay estimación. */
  lower?: Float64Array;
  upper?: Float64Array;
  /** Banderas de la ventana (de `after` o del original), con «sospechosa» de vista. */
  quality: Uint16Array;
  color: string;
  log: boolean;
  unit: string;
  zones: readonly Zone[];
  /** Tramo de la herramienta (resaltado), en m. */
  selection: { top: number; base: number } | null;
  /** Tramo que se está arrastrando (vista previa del gesto). */
  brush: { top: number; base: number } | null;
  hoverDepth: number | null;
  viewerDepth: number | null;
  /** La vista previa todavía calcula: la preparada se atenúa. */
  stale: boolean;
}

export interface ChartLayout {
  gutter: number;
  zoneTop: number;
  zoneH: number;
  plotTop: number;
  plotH: number;
  axisTop: number;
  laneTop: number;
  laneH: number;
  width: number;
}

const LANE_PX = 12;

/** Medidas del gráfico (las comparte el manejo del puntero). */
export function chartLayout(width: number, height: number, ui: number): ChartLayout {
  const gutter = Math.round(118 * ui);
  const zoneH = Math.round(16 * ui);
  const laneH = Math.round(LANE_PX * ui);
  const lanes = laneH * QUALITY_FLAGS.length;
  const axisH = Math.round(20 * ui);
  const zoneTop = 4;
  const plotTop = zoneTop + zoneH + 4;
  const plotH = Math.max(40, height - plotTop - axisH - lanes - 10);
  const axisTop = plotTop + plotH;
  const laneTop = axisTop + axisH + 2;
  return { gutter, zoneTop, zoneH, plotTop, plotH, axisTop, laneTop, laneH, width };
}

/** Profundidad → x y su inversa sobre la ventana dibujada. */
export function depthScale(input: Pick<ChartInput, 'depth' | 'start' | 'end'>, layout: ChartLayout) {
  const top = input.depth[input.start] ?? 0;
  const base = input.depth[Math.max(input.start, input.end - 1)] ?? top + 1;
  const span = base - top || 1;
  const w = Math.max(1, layout.width - layout.gutter - 8);
  return {
    top,
    base,
    x: (d: number) => layout.gutter + ((d - top) / span) * w,
    depthAt: (x: number) => top + ((x - layout.gutter) / w) * span,
    pxPerM: w / span,
    plotWidth: w,
  };
}

function toLog(data: ArrayLike<number>): Float64Array {
  const out = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    out[i] = v > 0 ? Math.log10(v) : NaN;
  }
  return out;
}

function finiteRange(min: Float64Array, max: Float64Array): { min: number; max: number } | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < min.length; i++) {
    if (min[i]! < lo) lo = min[i]!;
    if (max[i]! > hi) hi = max[i]!;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? { min: lo, max: hi } : null;
}

/** Eje de valores de la ventana (original y preparada juntas). */
export function valueAxis(input: Pick<ChartInput, 'original' | 'after' | 'lower' | 'upper' | 'start' | 'end' | 'log'>): XYAxis | null {
  const series = [input.original.subarray(input.start, input.end), ...(input.after ? [input.after.subarray(input.start, input.end)] : []), ...(input.lower ? [input.lower.subarray(input.start, input.end)] : []), ...(input.upper ? [input.upper.subarray(input.start, input.end)] : [])];
  const r = niceRange(series, input.log ? 'log' : 'linear', { pad: 0.06 });
  return r ? { kind: input.log ? 'log' : 'linear', min: r.min, max: r.max, label: '' } : null;
}

/** Polilínea por columnas (envolvente mín–máx) en [start, end); corta en los huecos. */
function strokeSeries(ctx: CanvasRenderingContext2D, data: Float64Array, start: number, end: number, x0: number, w: number, y: (v: number) => number) {
  const n = end - start;
  if (n <= 0) return;
  if (n <= w * 2) {
    ctx.beginPath();
    let open = false;
    for (let i = start; i < end; i++) {
      const v = data[i]!;
      if (!Number.isFinite(v)) {
        open = false;
        continue;
      }
      const px = x0 + ((i - start + 0.5) / n) * w;
      if (open) ctx.lineTo(px, y(v));
      else ctx.moveTo(px, y(v));
      open = true;
    }
    ctx.stroke();
    return;
  }
  const cols = Math.max(1, Math.floor(w));
  const env = minMaxColumns(data, start, end, cols);
  ctx.beginPath();
  let open = false;
  for (let c = 0; c < cols; c++) {
    const lo = env.min[c]!, hi = env.max[c]!;
    if (!Number.isFinite(lo)) {
      open = false;
      continue;
    }
    const px = x0 + c + 0.5;
    if (open) ctx.lineTo(px, y(hi));
    else ctx.moveTo(px, y(hi));
    ctx.lineTo(px, y(lo));
    open = true;
  }
  ctx.stroke();
}

/** Muestras que cuentan como afectadas: excluidas; interpoladas = faltante original estimado (no el remuestreo de una alineación). */
const IS_EXCLUDED = (q: number) => (q & Quality.Excluded) !== 0;
const IS_FILLED = (q: number) => (q & Quality.Interpolated) !== 0 && (q & Quality.OriginallyMissing) !== 0;
const IS_SUSPECT = (q: number) => (q & Quality.Suspect) !== 0;

/** Puntos de las muestras que cumplen `hitOf` (excluidas sobre el original, interpoladas sobre la preparada). */
function markSamples(ctx: CanvasRenderingContext2D, data: Float64Array, quality: Uint16Array, hitOf: (q: number) => boolean, start: number, end: number, x0: number, w: number, y: (v: number) => number, r: number) {
  const n = end - start;
  if (n <= 0) return;
  const step = Math.max(1, Math.floor(n / (w / Math.max(2, r * 2))));
  for (let i = start; i < end; i += step) {
    let hit = -1;
    for (let k = i; k < Math.min(end, i + step); k++) {
      if (hitOf(quality[k - start]!) && Number.isFinite(data[k]!)) {
        hit = k;
        break;
      }
    }
    if (hit < 0) continue;
    const px = x0 + ((hit - start + 0.5) / n) * w;
    ctx.beginPath();
    ctx.arc(px, y(data[hit]!), r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawBeforeAfter(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, theme: ThemeTokens, ui: number, input: ChartInput): void {
  const L = chartLayout(size.width, size.height, ui);
  const S = depthScale(input, L);
  const { start, end } = input;
  const n = end - start;
  const c = theme.color;
  const v = theme.viewer;
  const font = canvasFont(BASE_TOKENS.text.xs, 400, ui);
  const fontStrong = canvasFont(BASE_TOKENS.text.xs, 600, ui);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // Fondo del área de datos y de las franjas.
  ctx.fillStyle = v.trackBg;
  ctx.fillRect(L.gutter, L.plotTop, S.plotWidth, L.plotH);
  if (n <= 1) return;

  // Zonas: franja superior con nombre y separadores tenues en el área de datos.
  for (const z of input.zones) {
    if (z.base < S.top || z.top > S.base) continue;
    const x0 = Math.max(L.gutter, S.x(z.top));
    const x1 = Math.min(L.gutter + S.plotWidth, S.x(z.base));
    if (x1 - x0 < 1) continue;
    ctx.save();
    ctx.globalAlpha = Math.min(0.9, v.zoneAlpha * 3);
    ctx.fillStyle = z.color;
    ctx.fillRect(x0, L.zoneTop, x1 - x0, L.zoneH);
    ctx.globalAlpha = v.zoneAlpha * 0.6;
    ctx.fillRect(x0, L.plotTop, x1 - x0, L.plotH);
    ctx.restore();
    if (x1 - x0 > 24 * ui) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, L.zoneTop, x1 - x0, L.zoneH);
      ctx.clip();
      ctx.fillStyle = c.text;
      ctx.font = fontStrong;
      ctx.fillText(z.name, x0 + 4, L.zoneTop + L.zoneH / 2);
      ctx.restore();
    }
  }
  ctx.font = font;
  ctx.fillStyle = c.textMuted;
  ctx.textAlign = 'right';
  ctx.fillText('Zonas', L.gutter - 8, L.zoneTop + L.zoneH / 2);

  // Grilla de profundidad.
  const ticks = depthTicks(S.top, S.base, S.pxPerM, 64 * ui, 8 * ui);
  ctx.lineWidth = 1;
  ctx.strokeStyle = v.gridMinor;
  ctx.beginPath();
  for (const d of ticks.minor) {
    const x = Math.round(S.x(d)) + 0.5;
    ctx.moveTo(x, L.plotTop);
    ctx.lineTo(x, L.plotTop + L.plotH);
  }
  ctx.stroke();
  ctx.strokeStyle = v.gridMajor;
  ctx.beginPath();
  for (const d of ticks.major) {
    const x = Math.round(S.x(d)) + 0.5;
    ctx.moveTo(x, L.plotTop);
    ctx.lineTo(x, L.plotTop + L.plotH);
  }
  ctx.stroke();

  // Eje de valores.
  const axis = valueAxis(input);
  const yOf = (val: number) => L.plotTop + L.plotH * (1 - axisFraction(axis!, val));
  if (axis) {
    const vt = axisTicks(axis, L.plotH, 22 * ui);
    ctx.strokeStyle = v.gridMinor;
    ctx.beginPath();
    for (const t of vt) {
      if (!t.major) continue;
      const y = Math.round(L.plotTop + L.plotH * (1 - t.f)) + 0.5;
      ctx.moveTo(L.gutter, y);
      ctx.lineTo(L.gutter + S.plotWidth, y);
    }
    ctx.stroke();
    ctx.fillStyle = v.axisText;
    ctx.textAlign = 'right';
    for (const t of vt) {
      if (!t.label) continue;
      const y = L.plotTop + L.plotH * (1 - t.f);
      if (y < L.plotTop + 5 || y > L.plotTop + L.plotH - 5) continue;
      ctx.fillText(t.label, L.gutter - 6, y);
    }
    ctx.save();
    ctx.translate(12 * ui, L.plotTop + L.plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = c.textMuted;
    ctx.fillText(input.unit, 0, 0);
    ctx.restore();
  }

  // Banda de error calibrada: se corta en faltantes y nunca une derrumbes separados.
  if (axis && input.lower && input.upper) {
    ctx.save();
    ctx.fillStyle = withAlpha(input.color, 0.18);
    for (let i = start; i < end; i++) {
      const lo = input.lower[i]!, hi = input.upper[i]!;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      const x0 = L.gutter + ((i - start) / n) * S.plotWidth;
      const y0 = yOf(hi), y1 = yOf(lo);
      ctx.fillRect(x0, y0, Math.max(1, S.plotWidth / n), Math.max(1, y1 - y0));
    }
    ctx.restore();
  }

  // Bandas de muestras afectadas (excluidas e interpoladas).
  const sampleX = (i: number) => L.gutter + ((i - start) / n) * S.plotWidth;
  const band = (hitOf: (q: number) => boolean, color: string) => {
    ctx.fillStyle = color;
    let from = -1;
    for (let i = start; i <= end; i++) {
      const on = i < end && hitOf(input.quality[i - start]!);
      if (on && from < 0) from = i;
      else if (!on && from >= 0) {
        const x0 = sampleX(from);
        ctx.fillRect(x0, L.plotTop, Math.max(1, sampleX(i) - x0), L.plotH);
        from = -1;
      }
    }
  };
  band(IS_EXCLUDED, withAlpha(c.error, theme.name === 'dark' ? 0.16 : 0.1));
  band(IS_FILLED, withAlpha(c.info, theme.name === 'dark' ? 0.16 : 0.1));

  // Tramo de la herramienta y arrastre en curso.
  const range = (r: { top: number; base: number }, dashed: boolean) => {
    const x0 = Math.max(L.gutter, S.x(r.top));
    const x1 = Math.min(L.gutter + S.plotWidth, S.x(r.base));
    if (x1 < L.gutter || x0 > L.gutter + S.plotWidth) return;
    ctx.fillStyle = withAlpha(c.accent, dashed ? 0.14 : 0.08);
    ctx.fillRect(x0, L.plotTop, Math.max(1, x1 - x0), L.plotH);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(Math.round(x0) + 0.5, L.plotTop);
    ctx.lineTo(Math.round(x0) + 0.5, L.plotTop + L.plotH);
    ctx.moveTo(Math.round(x1) - 0.5, L.plotTop);
    ctx.lineTo(Math.round(x1) - 0.5, L.plotTop + L.plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (input.selection) range(input.selection, false);
  if (input.brush) range(input.brush, true);

  // Curvas.
  if (axis) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.gutter, L.plotTop, S.plotWidth, L.plotH);
    ctx.clip();
    const yClamp = (val: number) => yOf(input.log && !(val > 0) ? axis.min : val);
    ctx.lineJoin = 'round';
    if (input.after) {
      ctx.strokeStyle = c.textSubtle;
      ctx.lineWidth = 1.25 * ui;
      strokeSeries(ctx, input.original, start, end, L.gutter, S.plotWidth, yClamp);
      ctx.globalAlpha = input.stale ? 0.45 : 1;
      ctx.strokeStyle = input.color;
      ctx.lineWidth = 1.6 * ui;
      strokeSeries(ctx, input.after, start, end, L.gutter, S.plotWidth, yClamp);
      ctx.globalAlpha = 1;
      // Excluidas: el original que se quita, en rojo (si la curva está corrida, las banderas son del índice destino y
      // no se marcan sobre el original). Interpoladas: los valores estimados, en azul.
      ctx.fillStyle = c.error;
      if (!input.quality.some((q) => (q & Quality.Shifted) !== 0)) markSamples(ctx, input.original, input.quality, IS_EXCLUDED, start, end, L.gutter, S.plotWidth, yClamp, 1.8 * ui);
      ctx.fillStyle = c.info;
      markSamples(ctx, input.after, input.quality, IS_FILLED, start, end, L.gutter, S.plotWidth, yClamp, 1.8 * ui);
    } else {
      ctx.strokeStyle = input.color;
      ctx.lineWidth = 1.6 * ui;
      strokeSeries(ctx, input.original, start, end, L.gutter, S.plotWidth, yClamp);
    }
    ctx.fillStyle = c.warn;
    markSamples(ctx, input.after ?? input.original, input.quality, IS_SUSPECT, start, end, L.gutter, S.plotWidth, yClamp, 2.4 * ui);
    ctx.restore();
  }

  // Marco y eje de profundidad.
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(L.gutter + 0.5, L.plotTop + 0.5, S.plotWidth - 1, L.plotH - 1);
  ctx.fillStyle = v.axisText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const d of ticks.major) {
    const x = S.x(d);
    if (x < L.gutter + 14 || x > L.gutter + S.plotWidth - 14) continue;
    ctx.fillText(d.toLocaleString('es-AR', { minimumFractionDigits: ticks.decimals, maximumFractionDigits: ticks.decimals }), x, L.axisTop + 4);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = c.textMuted;
  ctx.fillText('MD (m)', L.gutter - 8, L.axisTop + 4);

  // Barra de banderas: una fila por bit, en el color de la bandera.
  ctx.textBaseline = 'middle';
  const cols = Math.max(1, Math.floor(S.plotWidth));
  const bits = columnFlags(input.quality, 0, n, cols);
  QUALITY_FLAGS.forEach((f, row) => {
    const y = L.laneTop + row * L.laneH;
    ctx.fillStyle = row % 2 ? v.trackBgAlt : v.trackBg;
    ctx.fillRect(L.gutter, y, S.plotWidth, L.laneH - 1);
    const color = flagColor(f.key, theme);
    ctx.fillStyle = color;
    let any = false;
    let from = -1;
    for (let col = 0; col <= cols; col++) {
      const on = col < cols && (bits[col]! & f.bit) !== 0;
      if (on) any = true;
      if (on && from < 0) from = col;
      else if (!on && from >= 0) {
        ctx.fillRect(L.gutter + from, y + 1, Math.max(1, col - from), L.laneH - 3);
        from = -1;
      }
    }
    ctx.fillStyle = any ? c.text : c.textSubtle;
    ctx.textAlign = 'right';
    ctx.fillText(f.label, L.gutter - 18 * ui, y + L.laneH / 2);
    ctx.fillStyle = any ? color : withAlpha(color, 0.35);
    ctx.fillRect(L.gutter - 13 * ui, y + 1.5, 8 * ui, L.laneH - 4);
  });

  // Cursores: el del panel (puntero) y el del visor.
  const cursor = (d: number | null, dashed: boolean) => {
    if (d === null || d < S.top || d > S.base) return;
    const x = Math.round(S.x(d)) + 0.5;
    ctx.strokeStyle = v.cursor;
    ctx.lineWidth = 1;
    ctx.setLineDash(dashed ? [3, 3] : []);
    ctx.beginPath();
    ctx.moveTo(x, L.plotTop);
    ctx.lineTo(x, L.laneTop + L.laneH * QUALITY_FLAGS.length);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  cursor(input.viewerDepth, true);
  cursor(input.hoverDepth, false);
}

// ── histograma de la normalización (0060) ────────────────────────────────────────────────────────────────────

export interface NormalizationMarker {
  id: MarkerId;
  /** Valor de origen (percentil de la curva antes de normalizar). */
  value: number;
  /** «P5». */
  label: string;
}

export interface NormalizationHistogramInput {
  model: HistogramModel;
  color: string;
  unit: string;
  markers: readonly NormalizationMarker[];
  /** Valores de referencia (a donde va cada marcador), en el mismo orden. */
  references: readonly number[];
  active: MarkerId | null;
  /** Hay vista previa (sin ella solo se dibuja «antes»). */
  hasAfter: boolean;
}

export interface NormalizationLayout {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** Medidas del histograma (las comparte el manejo del puntero). */
export function normalizationLayout(width: number, height: number, ui: number): NormalizationLayout {
  const left = Math.round(36 * ui), right = Math.round(30 * ui), top = Math.round(22 * ui), bottom = Math.round(32 * ui);
  return { left, right, top, bottom, width: Math.max(1, width - left - right), height: Math.max(20, height - top - bottom) };
}

export function drawNormalizationHistogram(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, theme: ThemeTokens, ui: number, input: NormalizationHistogramInput): void {
  const L = normalizationLayout(size.width, size.height, ui);
  const { model } = input;
  const c = theme.color, v = theme.viewer;
  const font = canvasFont(BASE_TOKENS.text.xs, 400, ui), strong = canvasFont(BASE_TOKENS.text.xs, 600, ui);
  const x = (val: number) => L.left + histogramFraction(model, val) * L.width;
  const base = L.top + L.height;
  const after = input.hasAfter ? model.after : null;
  let max = 0;
  for (const s of [model.before, after]) if (s) for (const p of s.percent) max = Math.max(max, p);
  max = niceMax(max || 1);
  const yPct = (p: number) => L.top + L.height * (1 - p / max);
  const yCum = (p: number) => L.top + L.height * (1 - p / 100);
  const bins = model.edges.length - 1;
  ctx.fillStyle = v.trackBg;
  ctx.fillRect(L.left, L.top, L.width, L.height);

  // Grilla horizontal: eje izquierdo (% de muestras por clase) y derecho (frecuencia acumulada, %).
  ctx.font = font;
  ctx.lineWidth = 1;
  ctx.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) {
    const y = Math.round(L.top + (L.height * k) / 4) + 0.5;
    ctx.strokeStyle = v.gridMinor;
    ctx.beginPath();
    ctx.moveTo(L.left, y);
    ctx.lineTo(L.left + L.width, y);
    ctx.stroke();
    ctx.fillStyle = v.axisText;
    ctx.textAlign = 'right';
    ctx.fillText(formatPct(max * (1 - k / 4)), L.left - 5, y);
    ctx.textAlign = 'left';
    ctx.fillText(`${100 - 25 * k}`, L.left + L.width + 5, y);
  }

  // Barras: antes (gris) y después (color de la curva, translúcido, con contorno escalonado).
  const bars = (percent: Float64Array, fill: string, stroke: string | null) => {
    ctx.fillStyle = fill;
    for (let j = 0; j < bins; j++) {
      const p = percent[j]!;
      if (!(p > 0)) continue;
      const x0 = x(model.edges[j]!), x1 = x(model.edges[j + 1]!), y = yPct(p);
      ctx.fillRect(x0 + 0.5, y, Math.max(1, x1 - x0 - 1), base - y);
    }
    if (!stroke) return;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25 * ui;
    ctx.beginPath();
    ctx.moveTo(x(model.edges[0]!), base);
    for (let j = 0; j < bins; j++) {
      const y = yPct(percent[j]!);
      ctx.lineTo(x(model.edges[j]!), y);
      ctx.lineTo(x(model.edges[j + 1]!), y);
    }
    ctx.lineTo(x(model.edges[bins]!), base);
    ctx.stroke();
  };
  bars(model.before.percent, withAlpha(c.textSubtle, theme.name === 'dark' ? 0.5 : 0.38), null);
  if (after) bars(after.percent, withAlpha(input.color, theme.name === 'dark' ? 0.3 : 0.22), input.color);

  // Frecuencia acumulada: antes punteada, después continua.
  const cumulative = (s: HistogramModel['before'], stroke: string, dash: number[]) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.6 * ui;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x(model.edges[0]!), yCum((100 * s.below) / Math.max(1, s.n)));
    for (let j = 0; j < bins; j++) ctx.lineTo(x(model.edges[j + 1]!), yCum(s.cumulative[j]!));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  cumulative(model.before, c.textMuted, [4 * ui, 3 * ui]);
  if (after) cumulative(after, input.color, []);

  // Eje de valores (lineal o log10, como la pista de la curva).
  const axis: XYAxis = { kind: model.log ? 'log' : 'linear', min: model.lo, max: model.hi, label: '' };
  ctx.fillStyle = v.axisText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = v.gridMajor;
  for (const t of axisTicks(axis, L.width, 52 * ui)) {
    const px = Math.round(L.left + t.f * L.width) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, base);
    ctx.lineTo(px, base + (t.major ? 4 : 2));
    ctx.stroke();
    if (t.label) ctx.fillText(t.label, px, base + 5);
  }
  ctx.fillStyle = c.textMuted;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  ctx.fillText(input.unit, size.width - 2, size.height - 1);
  ctx.textAlign = 'left';
  ctx.fillText('% por clase · acumulada %', 2, size.height - 1);

  // Valores de referencia (destino): discontinuas en el color de la curva, con flecha desde el percentil de origen.
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.left, 0, L.width, size.height);
  ctx.clip();
  input.references.forEach((ref, i) => {
    if (!Number.isFinite(ref)) return;
    const rx = x(ref), m = input.markers[i];
    ctx.strokeStyle = input.color;
    ctx.lineWidth = 1.4 * ui;
    ctx.setLineDash([5 * ui, 3 * ui]);
    ctx.beginPath();
    ctx.moveTo(Math.round(rx) + 0.5, L.top);
    ctx.lineTo(Math.round(rx) + 0.5, base);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!m || !Number.isFinite(m.value) || !input.hasAfter) return;
    const sx = x(m.value), y = L.top + (9 + i * 11) * ui;
    if (Math.abs(rx - sx) <= 7 * ui) return;
    ctx.beginPath();
    ctx.moveTo(sx, y);
    ctx.lineTo(rx, y);
    ctx.stroke();
    const dir = rx > sx ? -1 : 1;
    ctx.fillStyle = input.color;
    ctx.beginPath();
    ctx.moveTo(rx, y);
    ctx.lineTo(rx + dir * 6 * ui, y - 3.5 * ui);
    ctx.lineTo(rx + dir * 6 * ui, y + 3.5 * ui);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();

  // Marcadores arrastrables de los percentiles de origen: línea y asa con el rótulo.
  ctx.font = strong;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const tags = input.markers
    .filter((m) => Number.isFinite(m.value))
    .map((m) => {
      const mx = Math.min(L.left + L.width, Math.max(L.left, x(m.value)));
      const w = ctx.measureText(m.label).width + 12 * ui;
      return { m, mx, w, bx: Math.min(size.width - w - 1, Math.max(1, mx - w / 2)) };
    })
    .sort((a, b) => a.mx - b.mx);
  // Asas que se pisarían: se separan hacia afuera (la línea sigue en su valor).
  for (let i = 1; i < tags.length; i++) {
    const a = tags[i - 1]!, b = tags[i]!, overlap = a.bx + a.w + 3 - b.bx;
    if (overlap <= 0) continue;
    a.bx = Math.max(1, a.bx - overlap / 2);
    b.bx = Math.min(size.width - b.w - 1, a.bx + a.w + 3);
  }
  for (const { m, mx, w, bx } of tags) {
    const on = input.active === m.id;
    ctx.strokeStyle = on ? c.accent : c.text;
    ctx.lineWidth = (on ? 2.25 : 1.5) * ui;
    ctx.beginPath();
    ctx.moveTo(Math.round(mx) + 0.5, L.top - 3);
    ctx.lineTo(Math.round(mx) + 0.5, base);
    ctx.stroke();
    const h = 16 * ui;
    ctx.fillStyle = on ? c.accent : c.text;
    roundedRect(ctx, bx, 2, w, h, 4 * ui);
    ctx.fill();
    ctx.fillStyle = on ? c.textOnAccent : c.surface;
    ctx.fillText(m.label, bx + w / 2, 2 + h / 2 + 0.5);
  }
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(L.left + 0.5, L.top + 0.5, L.width - 1, L.height - 1);
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p * (1 + 1e-9)) return m * p;
  return 10 * p;
}

function formatPct(v: number): string {
  return v.toLocaleString('es-AR', { maximumFractionDigits: v < 10 ? 1 : 0 });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
