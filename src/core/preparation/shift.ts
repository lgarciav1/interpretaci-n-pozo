import { Quality } from './quality';
import type { DepthShift } from './state';
import type { PreparationScratch } from './scratch';

/** z' = z + offsetM; toda la curva, sin modificar el índice maestro ni extrapolar.
 * Copias exactas conservan flags del soporte; entre muestras se estima en valores
 * lineales. Fronteras de zona en el eje destino bloquean sólo esa estimación.
 */
export async function shiftConstant(depth: Float64Array, data: Float64Array, quality: Uint16Array, config: DepthShift, boundaries: readonly number[], checkpoint: () => Promise<void>, scratch: PreparationScratch): Promise<{ interpolated: number; filtered: number }> {
  const input = scratch.data, flags = scratch.quality;
  input.set(data); flags.set(quality);
  let previous = -Infinity, interpolated = 0, filtered = 0;
  for (let k = 0; k < depth.length; k++) {
    if (k && k % 4096 === 0) await checkpoint();
    const d = depth[k]! + config.offsetM;
    if (!Number.isFinite(d) || d <= previous) throw new Error('El desplazamiento no conserva un eje finito y estrictamente creciente.');
    previous = d;
    if ((flags[k]! & 1) && (flags[k]! & 8)) interpolated++;
    if (flags[k]! & 16) filtered++;
  }
  let right = 0, boundary = 0;
  const matches = (index: number, target: number) => {
    if (index < 0 || index >= depth.length) return false;
    const d = depth[index]! + config.offsetM;
    let tolerance = 8 * Number.EPSILON * Math.max(Math.abs(d), Math.abs(target));
    if (index) tolerance = Math.min(tolerance, (d - (depth[index - 1]! + config.offsetM)) / 4);
    if (index + 1 < depth.length) tolerance = Math.min(tolerance, (depth[index + 1]! + config.offsetM - d) / 4);
    return Math.abs(d - target) <= tolerance;
  };
  for (let k = 0; k < depth.length; k++) {
    if (k && k % 4096 === 0) await checkpoint();
    const target = depth[k]!;
    while (right < depth.length && depth[right]! + config.offsetM < target) right++;
    const exact = matches(right, target) ? right : matches(right - 1, target) ? right - 1 : -1;
    if (exact >= 0) { data[k] = input[exact]!; quality[k] = flags[exact]! | Quality.Shifted; continue; }
    if (right === depth.length || target < depth[0]! + config.offsetM) {
      data[k] = NaN; quality[k] = Quality.Shifted | Quality.OutOfDomain; continue;
    }
    const b = depth[right]! + config.offsetM;
    const left = right - 1, a = depth[left]! + config.offsetM;
    while (boundary < boundaries.length && boundaries[boundary]! <= a) boundary++;
    const crossesZone = boundary < boundaries.length && boundaries[boundary]! <= b;
    const inherited = flags[left]! | flags[right]! | Quality.Shifted;
    if (b - a > config.maxGapM || crossesZone || !Number.isFinite(input[left]!) || !Number.isFinite(input[right]!)) {
      data[k] = NaN; quality[k] = inherited | Quality.OutOfDomain; continue;
    }
    const t = (target - a) / (b - a), value = (1 - t) * input[left]! + t * input[right]!;
    if (!Number.isFinite(value)) throw new Error('El remuestreo produjo un valor no finito.');
    data[k] = value; quality[k] = inherited | Quality.Interpolated;
  }
  return { interpolated, filtered };
}
