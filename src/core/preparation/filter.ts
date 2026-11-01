import { Quality } from './quality';
import type { MedianFilter } from './state';

export const MAX_MEDIAN_SAMPLES = 255;
const lowerBound = (sorted: number[], value: number) => {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid]! < value) lo = mid + 1; else hi = mid; }
  return lo;
};
/** Lee una copia fija de la etapa anterior: no hay filtrado recursivo.
 * Ventana física simétrica, mínimo 3 muestras con vecinos a ambos lados.
 * Conserva bordes sin ventana completa. NaN, zonas y saltos MD cortan segmentos.
 * Scratch reservado por el evaluador: 10 bytes/muestra, más hasta 255 números.
 */
export async function filterMedian(depth: Float64Array, data: Float64Array, quality: Uint16Array, config: MedianFilter, boundaries: readonly number[], checkpoint: () => Promise<void>): Promise<void> {
  const input = data.slice(), flags = quality.slice();
  let start = 0, boundary = 0, ticks = 0;
  while (start < data.length) {
    // No modificar ni llenar faltantes, exclusiones o muestras fuera del tramo.
    if (!Number.isFinite(input[start]!) || depth[start]! < config.top || depth[start]! > config.base) {
      start++; if (++ticks % 4096 === 0) await checkpoint(); continue;
    }
    let end = start + 1;
    while (end < data.length && Number.isFinite(input[end]!) && depth[end]! <= config.base && depth[end]! - depth[end - 1]! <= config.maxStepM) {
      while (boundary < boundaries.length && boundaries[boundary]! <= depth[end - 1]!) boundary++;
      if (boundary < boundaries.length && boundaries[boundary]! <= depth[end]!) break;
      end++; if (++ticks % 4096 === 0) await checkpoint();
    }
    const sorted: number[] = [];
    let lo = start, hi = start - 1, estimated = 0;
    for (let center = start; center < end; center++) {
      const lower = depth[center]! - config.radiusM, upper = depth[center]! + config.radiusM;
      while (lo <= hi && depth[lo]! < lower) {
        sorted.splice(lowerBound(sorted, input[lo]!), 1);
        if (flags[lo]! & Quality.Interpolated) estimated--;
        lo++;
      }
      // Si la ventana avanzó más allá del soporte previo, descartar esos índices.
      if (hi < lo - 1) hi = lo - 1;
      while (hi + 1 < end && depth[hi + 1]! <= upper) {
        hi++;
        if (depth[hi]! < lower) { lo = hi + 1; continue; }
        if (sorted.length === MAX_MEDIAN_SAMPLES) throw new Error('La ventana de mediana supera 255 muestras. Reducí el radio.');
        sorted.splice(lowerBound(sorted, input[hi]!), 0, input[hi]!);
        if (flags[hi]! & Quality.Interpolated) estimated++;
      }
      if (lower >= depth[start]! && upper <= depth[end - 1]! && sorted.length >= 3 && lo < center && hi > center) {
        const mid = sorted.length >>> 1;
        const a = sorted[mid - 1]!, b = sorted[mid]!;
        // Evitar tanto desbordamiento con signos opuestos como subdesbordamiento de constantes diminutas.
        const sum = a + b;
        const value = sorted.length % 2 ? b : Number.isFinite(sum) ? sum / 2 : a / 2 + b / 2;
        if (!Number.isFinite(value)) throw new Error('La mediana produjo un valor no finito.');
        data[center] = value;
        quality[center] = flags[center]! | Quality.Filtered | (estimated ? Quality.Interpolated : 0);
      }
      if (++ticks % 4096 === 0) await checkpoint();
    }
    start = end;
  }
}
