import { PreparationCancelled } from './evaluate';

/** Diagnóstico local v1: seis vecinos, sin modificar ni estimar mediciones. */
export interface SuspectOptions { top: number; base: number; minDeviation: number; maxGapM: number }
export interface SuspectCandidate { index: number; depth: number; value: number; median: number; threshold: number }
export interface SuspectScan { candidates: SuspectCandidate[]; truncated: boolean; evaluated: number }
const median = (values: number[]) => {
  const sorted = values.sort((a, b) => a - b);
  const mid = sorted.length >>> 1;
  return sorted.length % 2 ? sorted[mid]! : sorted[mid - 1]! / 2 + sorted[mid]! / 2;
};
/** Mediana/MAD de los tres vecinos a cada lado, excluyendo el centro.
 * No cruza faltantes, exclusiones, saltos MD ni los límites del tramo.
 * Umbral estricto max(desviación mínima, 3 × 1,4826 × MAD).
 * Se retienen hasta 256 candidatos; si hay más se exige acotar el tramo.
 */
export async function scanSuspects(depth: Float64Array, data: Float64Array, options: SuspectOptions,
  excluded: readonly { top: number; base: number }[] = [], cancelled: () => boolean = () => false,
  yieldTask: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0))): Promise<SuspectScan> {
  const { top, base, minDeviation, maxGapM } = options;
  if (depth.length !== data.length || ![top, base, minDeviation, maxGapM].every(Number.isFinite) || top > base || minDeviation <= 0 || maxGapM <= 0) throw new Error('Elegí tramo, desviación mínima y separación máxima válidos, mayores que cero.');
  const candidates: SuspectCandidate[] = [];
  let evaluated = 0, run = 0, range = 0;
  for (let j = 0; j < depth.length; j++) {
    if (j % 4096 === 0) { if (j) await yieldTask(); if (cancelled()) throw new PreparationCancelled(); }
    const d = depth[j]!, value = data[j]!;
    if (!Number.isFinite(d) || (j > 0 && d <= depth[j - 1]!)) throw new Error('El índice MD debe ser finito y creciente.');
    if (!Number.isFinite(value) && !Number.isNaN(value)) throw new Error('La curva contiene valores infinitos.');
    while (range < excluded.length && excluded[range]!.base < d) range++;
    const masked = range < excluded.length && excluded[range]!.top <= d;
    if (j && d - depth[j - 1]! > maxGapM) run = 0;
    run = d >= top && d <= base && Number.isFinite(value) && !masked ? run + 1 : 0;
    if (run < 7) continue;
    const i = j - 3;
    const neighbors = [data[i - 3]!, data[i - 2]!, data[i - 1]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    const center = median(neighbors), mad = median(neighbors.map(v => Math.abs(v - center)));
    const threshold = Math.max(minDeviation, 3 * 1.4826 * mad);
    evaluated++;
    if (Math.abs(data[i]! - center) > threshold) {
      if (candidates.length === 256) return { candidates, evaluated, truncated: true };
      candidates.push({ index: i, depth: depth[i]!, value: data[i]!, median: center, threshold });
    }
  }
  if (cancelled()) throw new PreparationCancelled();
  return { candidates, evaluated, truncated: false };
}
