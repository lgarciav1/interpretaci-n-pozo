/**
 * Crossplot libre (docs/decisiones/0014, D6). Puro y testeado: muestras graficables (las dos curvas válidas, en el
 * filtro de zonas, > 0 en un eje log), rango automático robusto, color por una tercera curva cuantizado en una rampa
 * (pocos colores → dibujo en lotes) y mediana de una curva sobre las muestras visibles (Rw del gráfico de Pickett).
 */
import { percentile } from '../../petro/stats';

/** Índices de las muestras graficables. */
export function plottableIndices(x: ArrayLike<number>, y: ArrayLike<number>, include: (i: number) => boolean, xLog: boolean, yLog: boolean): Int32Array {
  const n = Math.min(x.length, y.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = x[i]!;
    const b = y[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if ((xLog && !(a > 0)) || (yLog && !(b > 0))) continue;
    if (!include(i)) continue;
    out.push(i);
  }
  return Int32Array.from(out);
}

/** Valores de `v` en los índices dados. */
export function gather(v: ArrayLike<number>, idx: ArrayLike<number>): Float64Array {
  const out = new Float64Array(idx.length);
  for (let k = 0; k < idx.length; k++) out[k] = v[idx[k]!]!;
  return out;
}

/**
 * Rango robusto de valores (percentiles `lo`–`hi`, por defecto 1–99): una lectura espuria no aplasta la nube. En log
 * solo cuentan los positivos. null si no hay valores.
 */
export function robustRange(v: ArrayLike<number>, log: boolean, lo = 0.01, hi = 0.99): { min: number; max: number } | null {
  const xs: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i]!;
    if (Number.isFinite(a) && (!log || a > 0)) xs.push(a);
  }
  if (xs.length === 0) return null;
  const min = percentile(xs, lo);
  const max = percentile(xs, hi);
  return { min, max };
}

/** Niveles de la rampa de color (32: suaves a la vista y pocos lotes de dibujo). */
export const COLOR_LEVELS = 32;

/**
 * Nivel de color (0…levels−1) de un valor en [min, max] (en log10 si `log`); −1 si no tiene dato (se pinta neutro).
 */
export function colorLevel(v: number, min: number, max: number, log: boolean, levels = COLOR_LEVELS): number {
  if (!Number.isFinite(v) || (log && !(v > 0))) return -1;
  const a = log ? Math.log10(min) : min;
  const b = log ? Math.log10(max) : max;
  const u = log ? Math.log10(v) : v;
  if (!(b > a)) return Math.floor(levels / 2);
  const t = (u - a) / (b - a);
  return Math.min(levels - 1, Math.max(0, Math.floor(t * levels)));
}

/** Mediana de `v` sobre los índices dados (NaN si no hay valores). */
export function medianAt(v: ArrayLike<number>, idx: ArrayLike<number>): number {
  return percentile(gather(v, idx), 0.5);
}
