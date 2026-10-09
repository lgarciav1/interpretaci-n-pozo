/**
 * Escala horizontal de una curva dentro de su pista: valor ↔ fracción del ancho (0 = borde izquierdo, 1 =
 * derecho), lineal o log, normal o invertida. Puro.
 *
 * `fractionArray` transforma una curva entera una vez y la guarda en caché por identidad del array y firma de la
 * escala: en cada cuadro el dibujo solo multiplica por el ancho de pista (docs/decisiones/0005, D2).
 */

export interface AxisScale {
  kind: 'linear' | 'log';
  /** Valor menor y mayor de la escala (unidad canónica). */
  min: number;
  max: number;
  /** true: el mayor queda a la izquierda (NPHI, DT, porosidades). */
  reversed: boolean;
}

export const scaleKey = (s: AxisScale): string => `${s.kind}:${s.min}:${s.max}:${s.reversed ? 1 : 0}`;

/** Valor → fracción (sin acotar: < 0 o > 1 = fuera de escala). NaN si no hay dato (o ≤ 0 en log). */
export function valueToFraction(v: number, s: AxisScale): number {
  let f: number;
  if (s.kind === 'log') {
    if (!(v > 0)) return NaN;
    f = (Math.log10(v) - Math.log10(s.min)) / (Math.log10(s.max) - Math.log10(s.min));
  } else {
    f = (v - s.min) / (s.max - s.min);
  }
  return s.reversed ? 1 - f : f;
}

/** Fracción → valor (inversa de valueToFraction). */
export function fractionToValue(f: number, s: AxisScale): number {
  const u = s.reversed ? 1 - f : f;
  if (s.kind === 'log') return 10 ** (Math.log10(s.min) + u * (Math.log10(s.max) - Math.log10(s.min)));
  return s.min + u * (s.max - s.min);
}

/** Valor del borde izquierdo y derecho de la pista para esta escala. */
export function edgeValues(s: AxisScale): [left: number, right: number] {
  return s.reversed ? [s.max, s.min] : [s.min, s.max];
}

/** Escala válida (min < max, y > 0 en log). Si no lo es, devuelve null. */
export function validScale(s: AxisScale): AxisScale | null {
  if (!Number.isFinite(s.min) || !Number.isFinite(s.max) || !(s.max > s.min)) return null;
  if (s.kind === 'log' && !(s.min > 0)) return null;
  return s;
}

/** Escalas recordadas por array (LRU): alcanza para ida y vuelta entre dos o tres escalas en el editor de 4b. */
export const FRACTION_CACHE_PER_ARRAY = 4;
const fractionCache = new WeakMap<Float64Array, Map<string, Float32Array>>();

/** Cantidad de escalas en caché para un array (para tests). */
export function fractionCacheSize(data: Float64Array): number {
  return fractionCache.get(data)?.size ?? 0;
}
const wrapCache = new WeakMap<Float32Array, Float32Array>();

/** Fracciones de toda la curva (Float32Array nuevo, en caché). No modificar. */
export function fractionArray(data: Float64Array, s: AxisScale): Float32Array {
  let byScale = fractionCache.get(data);
  if (!byScale) fractionCache.set(data, (byScale = new Map()));
  const key = scaleKey(s);
  let out = byScale.get(key);
  if (out) {
    // Más reciente al final (orden de inserción del Map = orden LRU).
    byScale.delete(key);
    byScale.set(key, out);
  } else {
    out = new Float32Array(data.length);
    const log = s.kind === 'log';
    const a = log ? Math.log10(s.min) : s.min;
    const span = (log ? Math.log10(s.max) : s.max) - a;
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      let f = log ? (v > 0 ? (Math.log10(v) - a) / span : NaN) : (v - a) / span;
      if (s.reversed) f = 1 - f;
      out[i] = f;
    }
    byScale.set(key, out);
    while (byScale.size > FRACTION_CACHE_PER_ARRAY) byScale.delete(byScale.keys().next().value!);
  }
  return out;
}

/**
 * Curva de respaldo ("wrap"): donde la fracción supera 1 (hasta 2), la misma fracción corrida un ancho de escala;
 * NaN en el resto (así la línea de respaldo solo aparece donde la curva se sale). En caché.
 */
export function wrapFractionArray(frac: Float32Array): Float32Array {
  let out = wrapCache.get(frac);
  if (!out) {
    out = new Float32Array(frac.length);
    for (let i = 0; i < frac.length; i++) {
      const f = frac[i]!;
      out[i] = f > 1 && f <= 2 ? f - 1 : NaN;
    }
    wrapCache.set(frac, out);
  }
  return out;
}

/** Rango "lindo" para una curva sin escala conocida: min/max de los datos con 5 % de margen. */
export function dataRange(data: ArrayLike<number>): { min: number; max: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (hi === lo) return { min: lo - 1, max: hi + 1 };
  const pad = (hi - lo) * 0.05;
  return { min: +(lo - pad).toPrecision(3), max: +(hi + pad).toPrecision(3) };
}
