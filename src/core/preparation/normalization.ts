/**
 * Normalización de curvas (docs/decisiones/0060; Clase 8, slides 9–10). PURO: sin UI. La usan el evaluador del motor
 * (etapa después de la alineación) y el panel (marcadores del histograma y vista «antes»).
 *
 * - Dos puntos: x' = y_lo + (x − x_lo)·g, g = (y_hi − y_lo)/(x_hi − x_lo).
 * - Desplazamiento: x' = x + (y − x_p).  Escala: x' = x·g, g = y/x_p.
 * Los x son percentiles (definición 7 de Hyndman y Fan, 1996) de las muestras de origen del intervalo de referencia.
 */
import { BUILTIN_ROLES } from '../roles';
import { convert, getUnit } from '../units';
import { Quality } from './quality';
import type { CurveNormalization } from './state';

/** Mínimo de muestras de origen: con 50, P5 y P95 quedan apoyados en al menos dos mediciones más allá (0060). */
export const MIN_NORMALIZATION_SAMPLES = 50;

/** Dominio físico de un rol en la unidad de la curva; `strictMin`: el mínimo no se admite (cantidades positivas). */
export interface PhysicalDomain { min: number | null; max: number | null; strictMin: boolean }

/** En la unidad canónica de cada rol. Roles sin entrada no tienen dominio declarado (SP, TEMP, DRHO…). */
export const NORMALIZATION_DOMAINS: Readonly<Record<string, PhysicalDomain>> = Object.freeze({
  GR: { min: 0, max: null, strictMin: false },
  CGR: { min: 0, max: null, strictMin: false },
  URAN: { min: 0, max: null, strictMin: false },
  THOR: { min: 0, max: null, strictMin: false },
  POTA: { min: 0, max: 100, strictMin: false },
  NPHI: { min: -0.15, max: 1, strictMin: false },
  PHIT_NMR: { min: 0, max: 1, strictMin: false },
  PHIE_NMR: { min: 0, max: 1, strictMin: false },
  BVI_NMR: { min: 0, max: 1, strictMin: false },
  RHOB: { min: 1, max: 5, strictMin: false },
  PEF: { min: 0, max: null, strictMin: true },
  DT: { min: 0, max: null, strictMin: true },
  DTS: { min: 0, max: null, strictMin: true },
  CALI: { min: 0, max: null, strictMin: true },
  BS: { min: 0, max: null, strictMin: true },
  RT: { min: 0, max: null, strictMin: true },
  RM: { min: 0, max: null, strictMin: true },
  RS: { min: 0, max: null, strictMin: true },
  RXO: { min: 0, max: null, strictMin: true },
  RA10: { min: 0, max: null, strictMin: true },
  RA20: { min: 0, max: null, strictMin: true },
  RA30: { min: 0, max: null, strictMin: true },
});

/** Dominio del rol convertido a la unidad de la curva (null si el rol no declara dominio o la unidad no convierte). */
export function normalizationDomain(role: string | null, unit: string): PhysicalDomain | null {
  const d = role ? NORMALIZATION_DOMAINS[role] : undefined;
  const canonical = BUILTIN_ROLES.find((r) => r.id === role)?.unit;
  if (!d || !canonical || getUnit(unit)?.dimension !== getUnit(canonical)?.dimension) return null;
  const to = (v: number | null) => (v === null ? null : convert(v, canonical, unit));
  return { min: to(d.min), max: to(d.max), strictMin: d.strictMin };
}

export function outsideDomain(value: number, domain: PhysicalDomain | null): boolean {
  if (!domain) return false;
  if (domain.min !== null && (domain.strictMin ? value <= domain.min : value < domain.min)) return true;
  return domain.max !== null && value > domain.max;
}

/** Percentil p ∈ [0, 100] de los primeros `n` valores YA ORDENADOS (definición 7: h = (n − 1)·p/100). */
export function percentileSorted(sorted: ArrayLike<number>, p: number, n = sorted.length): number {
  if (!(n > 0) || !(p >= 0 && p <= 100)) return NaN;
  const h = ((n - 1) * p) / 100;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/**
 * Inversa de `percentileSorted`: nivel p ∈ [0, 100] cuyo percentil es `value` (interpolación lineal entre muestras
 * ordenadas; con valores repetidos, el mayor índice). Para arrastrar un marcador del histograma.
 */
export function percentileRank(sorted: ArrayLike<number>, value: number, n = sorted.length): number {
  if (!(n > 1) || !Number.isFinite(value)) return n === 1 ? 50 : NaN;
  if (value <= sorted[0]!) return 0;
  if (value >= sorted[n - 1]!) return 100;
  let lo = 0, hi = n - 1; // sorted[lo] <= value < sorted[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= value) lo = mid;
    else hi = mid;
  }
  const h = lo + (value - sorted[lo]!) / (sorted[hi]! - sorted[lo]!);
  return (100 * h) / (n - 1);
}

/** Muestra de origen: finita, en [top, base] y sin las banderas «excluida» ni «faltante original» (no estimaciones). */
export const isNormalizationSource = (value: number, q: number): boolean => Number.isFinite(value) && !(q & (Quality.Excluded | Quality.OriginallyMissing));

/**
 * Copia en `out` (desde 0) los valores de origen del intervalo y los ordena; devuelve cuántos son. `depth` creciente.
 */
export function normalizationSample(depth: ArrayLike<number>, data: ArrayLike<number>, quality: ArrayLike<number>, top: number, base: number, out: Float64Array): number {
  let n = 0;
  for (let k = 0; k < depth.length; k++) {
    const d = depth[k]!;
    if (d < top) continue;
    if (d > base) break;
    const v = data[k]!;
    if (isNormalizationSource(v, quality[k]!)) out[n++] = v;
  }
  out.subarray(0, n).sort();
  return n;
}

/** Anclajes de la transformación (lo que publica el motor y leen el informe, la exportación y el panel). */
export interface NormalizationStats {
  /** Muestras de origen del intervalo de referencia. */
  samples: number;
  /** x_lo (dos puntos) o x_p (un punto). */
  sourceLow: number;
  /** x_hi en dos puntos; null en un punto. */
  sourceHigh: number | null;
  /** Ganancia g: (y_hi − y_lo)/(x_hi − x_lo), 1 en desplazamiento, y/x_p en escala. */
  gain: number;
  /** Salidas finitas fuera del dominio físico del rol (conservadas, con OutOfDomain). */
  outOfDomain: number;
}

/** Anclajes desde la muestra ordenada; lanza el motivo (en español) si el dominio de los datos no lo permite. */
export function normalizationAnchors(config: CurveNormalization, sorted: ArrayLike<number>, n = sorted.length): Omit<NormalizationStats, 'outOfDomain'> {
  if (n < MIN_NORMALIZATION_SAMPLES) throw new Error(`El intervalo de referencia tiene ${n.toLocaleString('es-AR')} muestras válidas; la normalización necesita al menos ${MIN_NORMALIZATION_SAMPLES}. Ampliá el intervalo o revisá las exclusiones.`);
  if (config.method === 'two-point') {
    const lo = percentileSorted(sorted, config.lowPercentile, n), hi = percentileSorted(sorted, config.highPercentile, n);
    if (!(hi > lo)) throw new Error('Los dos percentiles de origen son iguales en el intervalo: no definen una escala. Separalos o elegí otro intervalo.');
    const gain = (config.highReference - config.lowReference) / (hi - lo);
    if (!Number.isFinite(gain) || !(gain > 0)) throw new Error('La ganancia de la normalización no es finita y positiva.');
    return { samples: n, sourceLow: lo, sourceHigh: hi, gain };
  }
  const p = percentileSorted(sorted, config.percentile, n);
  if (config.method === 'shift') return { samples: n, sourceLow: p, sourceHigh: null, gain: 1 };
  if (p === 0) throw new Error('El percentil de origen vale cero: la escala no está definida. Usá el desplazamiento u otro percentil.');
  const gain = config.reference / p;
  if (!Number.isFinite(gain) || !(gain > 0)) throw new Error('La escala debe ser positiva: el valor de referencia y el percentil de origen tienen que tener el mismo signo.');
  return { samples: n, sourceLow: p, sourceHigh: null, gain };
}

/** Transformación de un valor (NaN se conserva). */
export function normalizeValue(x: number, config: CurveNormalization, s: Pick<NormalizationStats, 'sourceLow' | 'gain'>): number {
  if (config.method === 'two-point') return config.lowReference + (x - s.sourceLow) * s.gain;
  if (config.method === 'shift') return x + (config.reference - s.sourceLow);
  return x * s.gain;
}

/** Inversa (para reconstruir el estado previo de una curva normalizada en el panel). */
export function denormalizeValue(y: number, config: CurveNormalization, s: Pick<NormalizationStats, 'sourceLow' | 'gain'>): number {
  if (config.method === 'two-point') return s.sourceLow + (y - config.lowReference) / s.gain;
  if (config.method === 'shift') return y - (config.reference - s.sourceLow);
  return y / s.gain;
}

export const NORMALIZATION_METHOD_LABEL: Readonly<Record<CurveNormalization['method'], string>> = { 'two-point': 'dos puntos', shift: 'un punto (desplazamiento)', scale: 'un punto (escala)' };

/** Pares percentil de origen → referencia de la receta, con los valores de origen calculados. */
export function normalizationAnchorsList(config: CurveNormalization, stats: Pick<NormalizationStats, 'sourceLow' | 'sourceHigh'>): { percentile: number; source: number; reference: number }[] {
  return config.method === 'two-point'
    ? [{ percentile: config.lowPercentile, source: stats.sourceLow, reference: config.lowReference }, { percentile: config.highPercentile, source: stats.sourceHigh ?? NaN, reference: config.highReference }]
    : [{ percentile: config.percentile, source: stats.sourceLow, reference: config.reference }];
}

/** Descripción de una línea (exportación: columna de calidad), sin ecuaciones; punto decimal como el resto del archivo. */
export function describeNormalization(config: CurveNormalization, stats: NormalizationStats, unit: string): string {
  const v = (x: number) => String(Number(x.toPrecision(6)));
  const pairs = normalizationAnchorsList(config, stats).map((a) => `P${v(a.percentile)} de origen ${v(a.source)} → ${v(a.reference)} ${unit}`).join('; ');
  return `Normalización ${NORMALIZATION_METHOD_LABEL[config.method]}: ${pairs}; intervalo de referencia ${v(config.top)}–${v(config.base)} m MD (${stats.samples} muestras de origen); ganancia ${v(stats.gain)}; ${stats.outOfDomain} salidas fuera del dominio físico (conservadas). Bits QC: 256=normalizada; 128 con valor=normalizada fuera del dominio físico.`;
}

/**
 * Etapa del evaluador: normaliza en el lugar toda muestra finita de `data` (bandera 256; 128 si cae fuera del dominio
 * físico, conservando el valor). `scratch` (≥ data.length) guarda la muestra ordenada. NaN y banderas previas quedan.
 */
export async function applyNormalization(depth: Float64Array, data: Float64Array, quality: Uint16Array, config: CurveNormalization, domain: PhysicalDomain | null, scratch: Float64Array, checkpoint: () => Promise<void>): Promise<NormalizationStats> {
  const n = normalizationSample(depth, data, quality, config.top, config.base, scratch);
  const anchors = normalizationAnchors(config, scratch, n);
  let outOfDomain = 0;
  for (let k = 0; k < data.length; k++) {
    if (k && k % 16384 === 0) await checkpoint();
    const x = data[k]!;
    if (!Number.isFinite(x)) continue;
    const y = normalizeValue(x, config, anchors);
    if (!Number.isFinite(y)) throw new Error('La normalización produjo un valor no finito.');
    data[k] = y;
    let q = quality[k]! | Quality.Normalized;
    if (outsideDomain(y, domain)) { q |= Quality.OutOfDomain; outOfDomain++; }
    quality[k] = q;
  }
  return { ...anchors, outOfDomain };
}
