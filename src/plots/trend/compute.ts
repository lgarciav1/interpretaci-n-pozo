/**
 * Ajuste de una tendencia sobre su serie (docs/decisiones/0008-tendencias-y-gradientes.md, D4). Puro.
 *
 * - Tramo → índices por bisección si x es la profundidad; si no, filtro por profundidad y rango de x.
 * - Puntos excluidos: claves → índices UNA vez por lista (caché por identidad de la lista y de la serie).
 * - `fitTrend` es O(n) sin asignaciones: se puede llamar en cada movimiento de un arrastre.
 * - Mano alzada: `trendThroughPoints`; R² no aplica (null).
 * - Pendiente: la del modelo lineal, o la local en el centro del tramo (rotulada así) para los otros.
 * - Gradientes en unidades de campo (`gradientReadings`) solo si x es la profundidad.
 * El resultado de un spec sin cambios se recuerda (caché por identidad de spec, serie y zonas).
 */
import { trendDepthRange, type TrendPoint, type TrendSelection, type TrendSpec } from '../../core/trends';
import { gradientReadings, type GradientReading } from '../../petro/gradients';
import { fitTrend, trendSlopeAt, trendThroughPoints, type TrendCoefficients, type TrendFit, type TrendModel } from '../../petro/regression';
import { lowerBound, upperBound, type ResolvedSeries } from './series';

type ZoneLike = { id: string; top: number; base: number };

export interface TrendSlope {
  /** dy/dx (por unidad de x; en profundidad, por m). */
  value: number;
  /** x donde se evaluó (centro del tramo). */
  at: number;
  /** true si el modelo no es lineal: la pendiente cambia y se informa la del centro del tramo. */
  local: boolean;
}

export interface TrendResult {
  /** Coeficientes a dibujar (ajuste o mano alzada); null si no hay ajuste posible. */
  coeffs: TrendCoefficients | null;
  /** Ajuste (solo modo 'fit'). */
  fit: TrendFit | null;
  /** Tramo de x dibujado sólido (el del ajuste o el de los dos puntos), en unidades de x. */
  span: [number, number] | null;
  /** Tramo de profundidad efectivo (zona o top/base; ±Infinity si abierto). */
  range: { top: number; base: number };
  /** Puntos usados, descartados por dato inválido o fuera de dominio, y excluidos a mano (dentro del tramo). */
  n: number;
  skipped: number;
  excluded: number;
  /** R² (null a mano). */
  r2: number | null;
  slope: TrendSlope | null;
  /** Gradientes en unidades de campo (vacío si x no es la profundidad o no hay pendiente). */
  gradients: GradientReading[];
  /** Por qué no hay ajuste (para el panel), o null. */
  problem: string | null;
}

/** Cambios de una vista previa (arrastre en curso) sobre el spec guardado. */
export interface TrendPreview {
  selection?: TrendSelection;
  manual?: [TrendPoint, TrendPoint];
  model?: TrendModel;
}

// ── puntos excluidos: claves → índices ─────────────────────────────────────────────────────────────────────────

const excludedCache = new WeakMap<readonly string[], WeakMap<ResolvedSeries, Set<number>>>();
const EMPTY = new Set<number>();

export function excludedIndices(keys: readonly string[], s: ResolvedSeries): Set<number> {
  if (keys.length === 0) return EMPTY;
  let bySeries = excludedCache.get(keys);
  if (!bySeries) excludedCache.set(keys, (bySeries = new WeakMap()));
  let set = bySeries.get(s);
  if (!set) {
    set = new Set<number>();
    if (s.indexOfKey) {
      for (const k of keys) {
        const i = s.indexOfKey(k);
        if (i >= 0) set.add(i);
      }
    } else {
      const want = new Set(keys);
      const n = Math.min(s.x.length, s.y.length);
      for (let i = 0; i < n; i++) if (want.has(s.pointKey(i))) set.add(i);
    }
    bySeries.set(s, set);
  }
  return set;
}

/** Índices [start, end) del tramo y filtro de los que quedan afuera (series que no están en profundidad). */
export function selectionWindow(sel: TrendSelection, s: ResolvedSeries, zones: readonly ZoneLike[]): { start: number; end: number; outside?: (i: number) => boolean; range: { top: number; base: number } } {
  const range = trendDepthRange(sel, zones);
  const n = Math.min(s.x.length, s.y.length);
  const xMin = sel.xMin ?? -Infinity;
  const xMax = sel.xMax ?? Infinity;
  if (s.xIsDepth) {
    const lo = Math.max(range.top, xMin);
    const hi = Math.min(range.base, xMax);
    return { start: lowerBound(s.x, lo), end: Math.min(n, upperBound(s.x, hi)), range };
  }
  const d = s.depth;
  const byDepth = !!d && (Number.isFinite(range.top) || Number.isFinite(range.base));
  const byX = Number.isFinite(xMin) || Number.isFinite(xMax);
  if (!byDepth && !byX) return { start: 0, end: n, range };
  const x = s.x;
  return {
    start: 0,
    end: n,
    range,
    outside: (i) => {
      if (byDepth) {
        const di = d![i]!;
        if (!(di >= range.top && di <= range.base)) return true;
      }
      if (byX) {
        const xi = x[i]!;
        if (!(xi >= xMin && xi <= xMax)) return true;
      }
      return false;
    },
  };
}

function slopeOf(c: TrendCoefficients, x0: number, x1: number): TrendSlope | null {
  const at = (x0 + x1) / 2;
  const value = c.model === 'linear' ? c.b : trendSlopeAt(c, at);
  return Number.isFinite(value) ? { value, at, local: c.model !== 'linear' } : null;
}

// ── evaluación ─────────────────────────────────────────────────────────────────────────────────────────────────

const resultCache = new WeakMap<TrendSpec, { series: ResolvedSeries; zones: readonly ZoneLike[]; result: TrendResult }>();

/** Ajusta (o traza a mano) una tendencia sobre su serie. Con `preview`, sin caché (arrastre en curso). */
export function evaluateTrend(spec: TrendSpec, s: ResolvedSeries, zones: readonly ZoneLike[], preview?: TrendPreview): TrendResult {
  if (!preview) {
    const hit = resultCache.get(spec);
    if (hit && hit.series === s && hit.zones === zones) return hit.result;
  }
  const selection = preview?.selection ?? spec.selection;
  const manual = preview?.manual ?? spec.manual;
  const model = preview?.model ?? spec.model;
  const win = selectionWindow(selection, s, zones);
  const ex = excludedIndices(selection.excluded, s);
  const outside = win.outside;
  const exclude = ex.size === 0 && !outside ? undefined : (i: number) => ex.has(i) || (outside !== undefined && outside(i));

  let excluded = 0;
  if (ex.size) for (const i of ex) if (i >= win.start && i < win.end && !(outside && outside(i))) excluded++;

  let result: TrendResult;
  if (spec.mode === 'manual') {
    const pts = manual;
    const coeffs = pts ? trendThroughPoints(model, pts[0], pts[1]) : null;
    const x0 = pts ? Math.min(pts[0].x, pts[1].x) : NaN;
    const x1 = pts ? Math.max(pts[0].x, pts[1].x) : NaN;
    // n: puntos válidos de la serie entre los dos puntos (dentro del tramo), para dar contexto.
    let n = 0;
    if (pts && s.xIsDepth) {
      const a = Math.max(win.start, lowerBound(s.x, x0));
      const b = Math.min(win.end, upperBound(s.x, x1));
      for (let i = a; i < b; i++) if (Number.isFinite(s.y[i]!) && !(exclude && exclude(i))) n++;
    }
    const slope = coeffs ? slopeOf(coeffs, x0, x1) : null;
    result = {
      coeffs,
      fit: null,
      span: coeffs ? [x0, x1] : null,
      range: win.range,
      n,
      skipped: 0,
      excluded,
      r2: null,
      slope,
      gradients: slope && s.xIsDepth ? gradientReadings(slope.value, s.yUnit) : [],
      problem: coeffs ? null : 'Los dos puntos no definen una tendencia de este modelo (revisá que sean distintos y válidos para el modelo).',
    };
  } else {
    const fit = win.end - win.start >= 2 ? fitTrend(s.x, s.y, model, { start: win.start, end: win.end, ...(exclude ? { exclude } : {}) }) : null;
    let span: [number, number] | null = null;
    if (fit) {
      const top = s.xIsDepth ? Math.max(win.range.top, selection.xMin ?? -Infinity) : selection.xMin ?? -Infinity;
      const base = s.xIsDepth ? Math.min(win.range.base, selection.xMax ?? Infinity) : selection.xMax ?? Infinity;
      span = [Number.isFinite(top) ? top : fit.xMin, Number.isFinite(base) ? base : fit.xMax];
    }
    const slope = fit && span ? slopeOf(fit, span[0], span[1]) : null;
    result = {
      coeffs: fit ? { model: fit.model, a: fit.a, b: fit.b } : null,
      fit,
      span,
      range: win.range,
      n: fit?.n ?? 0,
      skipped: fit?.skipped ?? 0,
      excluded,
      r2: fit ? fit.r2 : null,
      slope,
      gradients: slope && s.xIsDepth ? gradientReadings(slope.value, s.yUnit) : [],
      problem: fit
        ? null
        : model === 'log' || model === 'power' || model === 'exp'
          ? 'No hay al menos dos puntos válidos en el tramo para este modelo (log y potencial necesitan x > 0; exponencial y potencial, valores > 0).'
          : 'No hay al menos dos puntos válidos en el tramo.',
    };
  }
  if (!preview) resultCache.set(spec, { series: s, zones, result });
  return result;
}
