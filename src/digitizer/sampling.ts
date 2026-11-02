/**
 * Del trazo en píxeles a una serie en unidades físicas y su remuestreo. Puro (sin DOM).
 *
 * SERIE. Cada punto (x, y) del trazo pasa a (profundidad en m, valor) con la calibración: z = depthAtRow(y) y
 * v = valueAtX(x). La serie sale ordenada por profundidad creciente, sin NaN (los huecos simplemente faltan) y con los
 * puntos que caen en la misma profundidad (a 1e-9 m) PROMEDIADOS (media geométrica si la escala es log, que es la media
 * aritmética en el espacio donde la escala es lineal).
 *
 * REMUESTREO. Interpolación lineal entre puntos vecinos de la serie (en log10 del valor si la escala es log: un trazo es
 * lineal en el espacio de la pista, que en escala log es logarítmico). NUNCA extrapola: fuera de [primera, última]
 * profundidad de la serie da NaN, y los huecos entre puntos consecutivos mayores que `maxGapM` también (por defecto 5 ×
 * el espaciado mediano de la serie).
 *
 * SUAVIZADO (opcional): mediana móvil de ventana impar sobre los puntos (reduce el temblor de píxel conservando los
 * escalones). ELIMINACIÓN DE PICOS (opcional, APAGADA por defecto): un punto es pico aislado si se aparta de sus dos
 * vecinos inmediatos más que `threshold` (fracción del ancho de la escala, 0,25 por defecto) en el mismo sentido y esos
 * dos vecinos coinciden entre sí (a menos de la mitad del umbral). Se elimina o se reemplaza por la interpolación.
 */
import { depthAtRow, depthToMeters, metersToDepthUnit, valueAtX } from './calibration';
import { DigitizerError } from './errors';
import { valueToFraction, fractionToValue, type AxisScale } from '../viewer/scale';
import type { DepthCalibration, DigitizedSeries, ImageDepthUnit, PixelPoint, ResampledSeries, TracedCurve, ValueFrame } from './types';

const SAME_DEPTH_M = 1e-9;
const NODE_EPS_M = 1e-7;

const bad = (message: string): never => {
  throw new DigitizerError('invalid-series', message);
};

/** Serie vacía (para trazos sin dato). */
export function emptySeries(scale: AxisScale): DigitizedSeries {
  return { depthM: new Float64Array(0), values: new Float64Array(0), confidence: new Float64Array(0), scale };
}

/**
 * Arma una serie ordenada y sin duplicados a partir de arrays paralelos. Descarta puntos no finitos (y valores ≤ 0 en
 * escala log). Promedia los puntos con la misma profundidad.
 */
export function buildSeries(depthM: ArrayLike<number>, values: ArrayLike<number>, confidence: ArrayLike<number> | null, scale: AxisScale): DigitizedSeries {
  if (depthM.length !== values.length) bad(`La profundidad (${depthM.length}) y los valores (${values.length}) deben tener el mismo largo.`);
  const log = scale.kind === 'log';
  const idx: number[] = [];
  for (let i = 0; i < depthM.length; i++) {
    const d = depthM[i]!;
    const v = values[i]!;
    if (!Number.isFinite(d) || !Number.isFinite(v)) continue;
    if (log && !(v > 0)) continue;
    idx.push(i);
  }
  let sorted = true;
  for (let k = 1; k < idx.length && sorted; k++) if (depthM[idx[k]!]! < depthM[idx[k - 1]!]!) sorted = false;
  if (!sorted) idx.sort((a, b) => depthM[a]! - depthM[b]!);
  const od: number[] = [];
  const ov: number[] = [];
  const oc: number[] = [];
  let k = 0;
  while (k < idx.length) {
    let j = k;
    let sd = 0;
    let sv = 0;
    let sc = 0;
    while (j < idx.length && depthM[idx[j]!]! - depthM[idx[k]!]! <= SAME_DEPTH_M) {
      sd += depthM[idx[j]!]!;
      sv += log ? Math.log10(values[idx[j]!]!) : values[idx[j]!]!;
      sc += confidence ? confidence[idx[j]!]! : 1;
      j++;
    }
    const n = j - k;
    od.push(sd / n);
    ov.push(log ? 10 ** (sv / n) : sv / n);
    oc.push(sc / n);
    k = j;
  }
  return { depthM: Float64Array.from(od), values: Float64Array.from(ov), confidence: Float64Array.from(oc), scale };
}

export interface TraceToSeriesOptions {
  /** Descarta los puntos con confianza menor que esto (por defecto 0: se conservan todos). */
  minConfidence?: number;
  /** Si es true, descarta también los puntos interpolados dentro de huecos (observed = 0). Por defecto false. */
  observedOnly?: boolean;
}

/** Trazo (píxeles) → serie (m, valor). Los NaN del trazo no generan puntos. */
export function traceToSeries(trace: TracedCurve, depth: DepthCalibration, frame: ValueFrame, opts: TraceToSeriesOptions = {}): DigitizedSeries {
  const n = trace.x.length;
  const d = new Float64Array(n);
  const v = new Float64Array(n);
  const c = new Float64Array(n);
  const minConf = opts.minConfidence ?? 0;
  for (let i = 0; i < n; i++) {
    const x = trace.x[i]!;
    const ok = !Number.isNaN(x) && trace.confidence[i]! >= minConf && (!opts.observedOnly || trace.observed[i] === 1);
    d[i] = ok ? depthAtRow(depth, trace.y0 + i) : NaN;
    v[i] = ok ? valueAtX(frame, x) : NaN;
    c[i] = trace.confidence[i]!;
  }
  return buildSeries(d, v, c, frame.scale);
}

/** Puntos sueltos en píxeles (p. ej. marcados a mano) → serie. */
export function pointsToSeries(points: readonly PixelPoint[], depth: DepthCalibration, frame: ValueFrame): DigitizedSeries {
  const d = new Float64Array(points.length);
  const v = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    d[i] = depthAtRow(depth, points[i]!.y);
    v[i] = valueAtX(frame, points[i]!.x);
  }
  return buildSeries(d, v, null, frame.scale);
}

/** Mediana móvil de ventana impar `size` sobre los puntos (en los bordes la ventana se acorta). */
export function medianFilter(series: DigitizedSeries, size = 3): DigitizedSeries {
  if (!Number.isInteger(size) || size < 1 || size % 2 === 0) bad(`La ventana de la mediana móvil debe ser un entero impar (vale ${size}).`);
  if (size === 1 || series.values.length < 3) return series;
  const n = series.values.length;
  const half = (size - 1) / 2;
  const out = new Float64Array(n);
  const buf: number[] = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) buf.push(series.values[k]!);
    buf.sort((a, b) => a - b);
    out[i] = buf.length % 2 ? buf[(buf.length - 1) / 2]! : (buf[buf.length / 2 - 1]! + buf[buf.length / 2]!) / 2;
  }
  return { ...series, values: out };
}

export interface DespikeOptions {
  /** Desviación mínima, como fracción del ancho de la escala (en el espacio de la pista), para ser pico. Por defecto 0,25. */
  threshold?: number;
  /** 'remove' quita el punto; 'replace' lo reemplaza por la interpolación de sus vecinos. Por defecto 'remove'. */
  mode?: 'remove' | 'replace';
}

/** Elimina picos aislados de un punto (ver el encabezado del archivo). No es el comportamiento por defecto del flujo. */
export function removeSpikes(series: DigitizedSeries, opts: DespikeOptions = {}): DigitizedSeries {
  const thr = opts.threshold ?? 0.25;
  if (!(thr > 0 && thr <= 1)) bad(`El umbral de picos debe estar entre 0 y 1 (vale ${thr}).`);
  const n = series.values.length;
  if (n < 3) return series;
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = valueToFraction(series.values[i]!, series.scale);
  const spike = new Uint8Array(n);
  for (let i = 1; i < n - 1; i++) {
    const a = f[i]! - f[i - 1]!;
    const b = f[i]! - f[i + 1]!;
    if (Math.abs(a) > thr && Math.abs(b) > thr && Math.sign(a) === Math.sign(b) && Math.abs(f[i - 1]! - f[i + 1]!) < thr / 2) spike[i] = 1;
  }
  const mode = opts.mode ?? 'remove';
  const d: number[] = [];
  const v: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < n; i++) {
    if (spike[i]) {
      if (mode === 'remove') continue;
      const t = (series.depthM[i]! - series.depthM[i - 1]!) / (series.depthM[i + 1]! - series.depthM[i - 1]!);
      v.push(fractionToValue(f[i - 1]! + t * (f[i + 1]! - f[i - 1]!), series.scale));
    } else v.push(series.values[i]!);
    d.push(series.depthM[i]!);
    c.push(series.confidence[i]!);
  }
  return { depthM: Float64Array.from(d), values: Float64Array.from(v), confidence: Float64Array.from(c), scale: series.scale };
}

/** Espaciado mediano positivo de la serie (m); 0 si tiene menos de 2 puntos. */
export function medianSpacing(depthM: ArrayLike<number>): number {
  if (depthM.length < 2) return 0;
  const dz: number[] = [];
  for (let i = 1; i < depthM.length; i++) dz.push(depthM[i]! - depthM[i - 1]!);
  dz.sort((a, b) => a - b);
  return dz[dz.length >> 1]!;
}

export interface ResampleOptions {
  /** Huecos entre puntos consecutivos mayores que esto (m) dan NaN. Por defecto 5 × espaciado mediano. */
  maxGapM?: number;
  /** 'log' interpola en log10 (por defecto si la escala es log); 'linear' en el valor. */
  interpolation?: 'linear' | 'log';
}

/** Valores de la serie en cada profundidad de `gridM` (lo normal es creciente; funciona en cualquier orden). NaN fuera del tramo y en huecos grandes. No extrapola. */
export function resampleSeries(series: DigitizedSeries, gridM: ArrayLike<number>, opts: ResampleOptions = {}): Float64Array {
  const out = new Float64Array(gridM.length).fill(NaN);
  const n = series.depthM.length;
  if (n === 0) return out;
  const maxGap = opts.maxGapM ?? 5 * medianSpacing(series.depthM);
  if (!(maxGap >= 0)) bad(`El hueco máximo debe ser un número no negativo (vale ${String(opts.maxGapM)}).`);
  const useLog = (opts.interpolation ?? (series.scale.kind === 'log' ? 'log' : 'linear')) === 'log';
  const d = series.depthM;
  const v = series.values;
  const first = d[0]!;
  const last = d[n - 1]!;
  let k = 0;
  for (let i = 0; i < gridM.length; i++) {
    const t = gridM[i]!;
    if (!Number.isFinite(t) || t < first - NODE_EPS_M || t > last + NODE_EPS_M) continue;
    while (k > 0 && d[k]! > t) k--; // admite grillas no crecientes (el puntero retrocede)
    while (k < n - 2 && d[k + 1]! < t) k++;
    // d[k] ≤ t ≤ d[k+1] (o t cae sobre el último nodo)
    if (n === 1 || Math.abs(t - d[k]!) <= NODE_EPS_M) {
      out[i] = v[k]!;
      continue;
    }
    if (Math.abs(t - d[k + 1]!) <= NODE_EPS_M) {
      out[i] = v[k + 1]!;
      continue;
    }
    if (d[k + 1]! - d[k]! > maxGap) continue;
    const w = (t - d[k]!) / (d[k + 1]! - d[k]!);
    if (useLog && v[k]! > 0 && v[k + 1]! > 0) {
      const a = Math.log10(v[k]!);
      out[i] = 10 ** (a + w * (Math.log10(v[k + 1]!) - a));
    } else out[i] = v[k]! + w * (v[k + 1]! - v[k]!);
  }
  return out;
}

/** Remuestrea la serie al índice de profundidad (m, estrictamente creciente) de un pozo existente. */
export function resampleToIndex(series: DigitizedSeries, indexDepthM: ArrayLike<number>, opts: ResampleOptions = {}): Float64Array {
  return resampleSeries(series, indexDepthM, opts);
}

export interface UniformGridOptions {
  /** Paso de la grilla, en `unit` (> 0). */
  step: number;
  /** Unidad del paso y de la alineación: 'm' o 'ft'. Por defecto 'm'. */
  unit?: ImageDepthUnit;
  topM: number;
  baseM: number;
  /** true (defecto): la grilla cae en múltiplos exactos del paso (p. ej. 0,1 m → 1500,1; 1500,2…). false: empieza en `topM`. */
  align?: boolean;
}

/** Grilla uniforme de profundidades en METROS (estrictamente creciente). El paso se da en m o en ft. */
export function uniformDepthGrid(o: UniformGridOptions): Float64Array {
  const unit = o.unit ?? 'm';
  if (unit !== 'm' && unit !== 'ft') bad(`La unidad del paso '${String(unit)}' no es válida: usá m o ft.`);
  if (!(Number.isFinite(o.step) && o.step > 0)) bad(`El paso de remuestreo debe ser un número positivo (vale ${o.step}).`);
  if (!Number.isFinite(o.topM) || !Number.isFinite(o.baseM) || o.baseM < o.topM) bad('El tramo del remuestreo es inválido: el tope debe ser menor o igual a la base.');
  const topU = metersToDepthUnit(o.topM, unit);
  const baseU = metersToDepthUnit(o.baseM, unit);
  const k0 = (o.align ?? true) ? Math.ceil(topU / o.step - 1e-9) : 0;
  const start = (o.align ?? true) ? k0 * o.step : topU;
  const count = Math.floor((baseU - start) / o.step + 1e-9) + 1;
  if (count < 1) return new Float64Array(0);
  if (count > 5_000_000) bad(`El remuestreo generaría ${count} muestras; aumentá el paso.`);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = Math.round(depthToMeters(start + i * o.step, unit) * 1e9) / 1e9;
  return out;
}

export interface ResampleUniformOptions extends ResampleOptions {
  step: number;
  unit?: ImageDepthUnit;
  align?: boolean;
  /** Tramo (m); por defecto el de la serie. */
  topM?: number;
  baseM?: number;
}

/** Remuestrea la serie a un paso uniforme (m o ft). Serie vacía → grilla vacía. */
export function resampleToUniform(series: DigitizedSeries, o: ResampleUniformOptions): ResampledSeries {
  const n = series.depthM.length;
  const unit = o.unit ?? 'm';
  const stepM = depthToMeters(o.step, unit);
  if (n === 0) {
    if (!(Number.isFinite(o.step) && o.step > 0)) bad(`El paso de remuestreo debe ser un número positivo (vale ${o.step}).`);
    return { depthM: new Float64Array(0), values: new Float64Array(0), stepM };
  }
  const depthM = uniformDepthGrid({ step: o.step, unit, topM: o.topM ?? series.depthM[0]!, baseM: o.baseM ?? series.depthM[n - 1]!, ...(o.align !== undefined ? { align: o.align } : {}) });
  return { depthM, values: resampleSeries(series, depthM, o), stepM };
}
