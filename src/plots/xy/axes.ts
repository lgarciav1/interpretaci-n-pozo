/**
 * Geometría del gráfico x–y (docs/decisiones/0010-datos-de-corona.md, D6). Pura y testeada: ejes lineales o
 * logarítmicos en cada eje (normales o invertidos), mapeo dato ↔ px, ticks «lindos», rango automático, área de
 * dibujo y búsqueda de puntos (el más cercano, los de un rectángulo).
 *
 * Es la base del crossplot k–φ de la corona (6b-3) y del crossplot libre y el histograma de la fase 7: no sabe nada
 * de plugs ni de curvas.
 */
import { scalePx } from '../../ui/tokens';
import { formatNumber } from '../../ui/format';

export type AxisKind = 'linear' | 'log';

export interface XYAxis {
  kind: AxisKind;
  /** Extremos de la escala (min < max; en log, min > 0). */
  min: number;
  max: number;
  /** Rótulo del eje («Porosidad φ»). */
  label: string;
  /** Unidad para el rótulo («v/v», «mD»). */
  unit?: string;
  /** true: el mayor queda a la izquierda (x) o abajo (y). */
  reversed?: boolean;
}

export interface PlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const validAxis = (a: XYAxis): boolean => Number.isFinite(a.min) && Number.isFinite(a.max) && a.max > a.min && (a.kind !== 'log' || a.min > 0);

/** Valor → fracción del eje (0 = min, 1 = max; invertido si `reversed`). Sin acotar. NaN si no se puede ubicar. */
export function axisFraction(a: XYAxis, v: number): number {
  if (!Number.isFinite(v)) return NaN;
  let f: number;
  if (a.kind === 'log') {
    if (!(v > 0)) return NaN;
    f = (Math.log10(v) - Math.log10(a.min)) / (Math.log10(a.max) - Math.log10(a.min));
  } else f = (v - a.min) / (a.max - a.min);
  return a.reversed ? 1 - f : f;
}

/** Fracción → valor (inversa de `axisFraction`). */
export function fractionValue(a: XYAxis, f: number): number {
  const u = a.reversed ? 1 - f : f;
  if (a.kind === 'log') return 10 ** (Math.log10(a.min) + u * (Math.log10(a.max) - Math.log10(a.min)));
  return a.min + u * (a.max - a.min);
}

export interface XYMapping {
  rect: PlotRect;
  /** Dato x → px horizontal (NaN si no se puede ubicar). */
  x(v: number): number;
  /** Dato y → px vertical (y crece hacia arriba). */
  y(v: number): number;
  /** px → dato. */
  xInv(px: number): number;
  yInv(py: number): number;
}

export function xyMapping(xAxis: XYAxis, yAxis: XYAxis, rect: PlotRect): XYMapping {
  return {
    rect,
    x: (v) => rect.x + axisFraction(xAxis, v) * rect.width,
    y: (v) => rect.y + (1 - axisFraction(yAxis, v)) * rect.height,
    xInv: (px) => fractionValue(xAxis, (px - rect.x) / rect.width),
    yInv: (py) => fractionValue(yAxis, 1 - (py - rect.y) / rect.height),
  };
}

// ── ticks ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AxisTick {
  value: number;
  /** Fracción a lo largo del eje (0…1, ya invertida si `reversed`). */
  f: number;
  major: boolean;
  /** Rótulo (solo algunos mayores); null = sin rótulo. */
  label: string | null;
}

const clean = (v: number) => +v.toPrecision(12);

/** Paso 1-2-5 × 10ᵏ ≥ `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return clean((m <= 1 + 1e-9 ? 1 : m <= 2 + 1e-9 ? 2 : m <= 5 + 1e-9 ? 5 : 10) * p);
}

const decimalsOf = (step: number) => (step >= 1 ? 0 : Math.min(10, Math.ceil(-Math.log10(step) - 1e-9)));

const SUPERSCRIPT: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const superscript = (n: number) => String(n).replace(/[-0-9]/g, (c) => SUPERSCRIPT[c]!);

/** Rótulo de un valor de eje (coma decimal, separador de miles, signo menos tipográfico). */
export function formatTick(v: number, a: XYAxis, step?: number): string {
  if (a.kind === 'log') {
    // Potencias de 10 muy chicas o muy grandes: «10⁻⁵» en vez de «0,00001» (el rótulo no entra en el margen).
    const e = Math.log10(v);
    if (Math.abs(e - Math.round(e)) < 1e-9 && (e <= -4 || e >= 6)) return `10${superscript(Math.round(e))}`;
    const d = v >= 1 ? 0 : Math.min(10, Math.ceil(-Math.log10(v) - 1e-9));
    return formatNumber(v, { digits: d }).replace(/^-/, '−');
  }
  return formatNumber(Math.abs(v) < 1e-12 ? 0 : v, { digits: decimalsOf(step ?? 1) }).replace(/^-/, '−');
}

/**
 * Ticks de un eje de `lengthPx` píxeles, con al menos `minLabelPx` entre rótulos.
 * - Lineal: mayores cada paso 1-2-5, menores en 5 (o 4, si el paso es 2) partes si quedan a ≥ 6 px.
 * - Log: décadas (mayores) y 2…9 × 10ᵏ (menores). Con pocas décadas se rotulan también 2 y 5; con muchas, una de
 *   cada n décadas.
 */
export function axisTicks(a: XYAxis, lengthPx: number, minLabelPx = 56): AxisTick[] {
  if (!validAxis(a) || !(lengthPx > 0)) return [];
  const out: AxisTick[] = [];
  const push = (value: number, major: boolean, label: string | null) => {
    const f = axisFraction(a, value);
    if (f >= -1e-9 && f <= 1 + 1e-9) out.push({ value, f: Math.min(1, Math.max(0, f)), major, label });
  };
  if (a.kind === 'linear') {
    const span = a.max - a.min;
    const step = niceStep((span * minLabelPx) / lengthPx);
    const k0 = Math.ceil(a.min / step - 1e-9);
    const k1 = Math.floor(a.max / step + 1e-9);
    for (let k = k0; k <= k1; k++) {
      const v = clean(k * step);
      push(v, true, formatTick(v, a, step));
    }
    const m = Math.round(step / 10 ** Math.floor(Math.log10(step) + 1e-9));
    const minor = clean(m === 2 ? step / 4 : step / 5);
    if ((minor / span) * lengthPx >= 6) {
      const j0 = Math.ceil(a.min / minor - 1e-9);
      const j1 = Math.floor(a.max / minor + 1e-9);
      for (let j = j0; j <= j1; j++) {
        const v = clean(j * minor);
        const r = v / step;
        if (Math.abs(r - Math.round(r)) > 1e-6) push(v, false, null);
      }
    }
  } else {
    const lo = Math.log10(a.min);
    const hi = Math.log10(a.max);
    const pxPerDecade = lengthPx / (hi - lo);
    const every = Math.max(1, Math.ceil(minLabelPx / pxPerDecade));
    const labelMid = pxPerDecade >= minLabelPx * 3;
    for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
      for (let m = 1; m <= 9; m++) {
        const v = clean(m * 10 ** e);
        if (v < a.min * (1 - 1e-9) || v > a.max * (1 + 1e-9)) continue;
        const major = m === 1;
        const label = major ? (((e % every) + every) % every === 0 ? formatTick(v, a) : null) : labelMid && (m === 2 || m === 5) ? formatTick(v, a) : null;
        if (!major && pxPerDecade < 18) continue; // menores demasiado juntos
        push(v, major, label);
      }
    }
  }
  return out.sort((p, q) => p.f - q.f);
}

// ── rango automático ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Rango «lindo» que contiene los valores finitos (de varias series). Lineal: margen `pad` (fracción del rango) y
 * extremos múltiplos de un paso 1-2-5; `zero: true` incluye el 0. Log: solo valores > 0, extremos en décadas enteras.
 * null si no hay valores válidos.
 */
export function niceRange(series: readonly ArrayLike<number>[], kind: AxisKind, opts: { pad?: number; zero?: boolean } = {}): { min: number; max: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (let i = 0; i < s.length; i++) {
      const v = s[i]!;
      if (!Number.isFinite(v) || (kind === 'log' && !(v > 0))) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo)) return null;
  if (kind === 'log') {
    const a = Math.floor(Math.log10(lo) + 1e-9);
    let b = Math.ceil(Math.log10(hi) - 1e-9);
    if (b <= a) b = a + 1;
    return { min: clean(10 ** a), max: clean(10 ** b) };
  }
  if (opts.zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  let span = hi - lo;
  if (!(span > 0)) span = Math.abs(hi) > 0 ? Math.abs(hi) * 0.2 : 1;
  const pad = span * (opts.pad ?? 0.05);
  const step = niceStep((span + 2 * pad) / 5);
  const min = opts.zero && lo >= 0 ? 0 : clean(Math.floor((lo - pad) / step) * step);
  const max = opts.zero && hi <= 0 ? 0 : clean(Math.ceil((hi + pad) / step) * step);
  return { min, max: max > min ? max : clean(min + step) };
}

// ── área de dibujo ───────────────────────────────────────────────────────────────────────────────────────────

/** Márgenes del área de dibujo: lugar para los rótulos de ticks y los títulos de los ejes. */
export function plotRectFor(width: number, height: number, compact = false, uiScale = 1, rightAxis = false): PlotRect {
  // Márgenes para rótulos y títulos: siguen al tamaño de interfaz en pantalla (las figuras usan 1). Con eje derecho
  // (`rightAxis`: la acumulada de un histograma) se reserva el lugar de sus rótulos y su título.
  const left = scalePx(compact ? 34 : 56, uiScale);
  const bottom = scalePx(compact ? 24 : 40, uiScale);
  const top = scalePx(compact ? 6 : 10, uiScale);
  const right = scalePx(rightAxis ? (compact ? 30 : 50) : compact ? 8 : 14, uiScale);
  return { x: left, y: top, width: Math.max(10, width - left - right), height: Math.max(10, height - top - bottom) };
}

// ── búsqueda de puntos ───────────────────────────────────────────────────────────────────────────────────────

/** Índice del punto (en px) más cercano a (px, py) dentro de `maxDist`, o −1. Los NaN se ignoran. */
export function nearestPoint(xs: ArrayLike<number>, ys: ArrayLike<number>, px: number, py: number, maxDist: number): number {
  let best = -1;
  let bestD = maxDist;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(xs[i]! - px, ys[i]! - py);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface DataRect {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Rectángulo en datos a partir de dos esquinas en px (ordenado; vale en ejes log e invertidos). */
export function dataRectFromPx(m: XYMapping, x0: number, y0: number, x1: number, y1: number): DataRect {
  const xa = m.xInv(x0);
  const xb = m.xInv(x1);
  const ya = m.yInv(y0);
  const yb = m.yInv(y1);
  return { xMin: Math.min(xa, xb), xMax: Math.max(xa, xb), yMin: Math.min(ya, yb), yMax: Math.max(ya, yb) };
}

export const inDataRect = (r: DataRect, x: number, y: number): boolean => x >= r.xMin && x <= r.xMax && y >= r.yMin && y <= r.yMax;

/** Índices de los puntos dentro del rectángulo. */
export function pointsInRect(r: DataRect, x: ArrayLike<number>, y: ArrayLike<number>): number[] {
  const out: number[] = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (inDataRect(r, x[i]!, y[i]!)) out.push(i);
  return out;
}
