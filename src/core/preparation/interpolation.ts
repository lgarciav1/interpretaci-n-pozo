import { Quality } from './quality';
import type { GapFill } from './state';
import { BUILTIN_ROLES } from '../roles';
import { getUnit } from '../units';

/** Alcance explícito: roles medidos del catálogo. No inferir continuidad por ver números. */
export function interpolationSourceProblem(curve: { role: string | null; unit: string }): string | null {
  const role = BUILTIN_ROLES.find(r => r.id === curve.role);
  if (!role || role.origin === 'computed' || role.family === 'flag') return 'La interpolación requiere un rol de perfil medido del catálogo; no admite banderas, categorías ni curvas sin rol reconocido.';
  if (!getUnit(curve.unit) || getUnit(curve.unit)?.dimension !== getUnit(role.unit)?.dimension) return 'La unidad no es compatible con el rol de la curva para interpolar.';
  return null;
}

/** Modifica sólo los arrays derivados del evaluador, nunca los originales.
 * Requiere índice MD creciente y datos ya enmascarados/validados.
 * Los dos anclajes deben ser mediciones finitas dentro del tramo; la longitud
 * del hueco es la distancia MD entre ellos. Exclusiones bloquean el hueco entero.
 */
export async function fillLinearGaps(depth: Float64Array, data: Float64Array, quality: Uint16Array, config: GapFill, boundaries: readonly number[], checkpoint: () => Promise<void>): Promise<void> {
  let left = -1, eligible = true, boundary = 0;
  for (let right = 0; right < data.length; right++) {
    if (right && right % 16384 === 0) await checkpoint();
    if (Number.isNaN(data[right]!)) {
      if (quality[right] !== Quality.OriginallyMissing) eligible = false;
      continue;
    }
    if (left >= 0 && right > left + 1 && eligible) {
      const a = depth[left]!, b = depth[right]!, span = b - a;
      while (boundary < boundaries.length && boundaries[boundary]! <= a) boundary++;
      const crossesZone = boundary < boundaries.length && boundaries[boundary]! <= b;
      if (a >= config.top && b <= config.base && span <= config.maxGapM && !crossesZone) {
        const x = data[left]!, y = data[right]!;
        for (let k = left + 1; k < right; k++) {
          if ((k - left) % 16384 === 0) await checkpoint();
          const t = (depth[k]! - a) / span;
          const value = (1 - t) * x + t * y;
          if (!Number.isFinite(value)) throw new Error('La interpolación produjo un valor no finito.');
          data[k] = value;
          quality[k] = Quality.OriginallyMissing | Quality.Interpolated;
        }
      }
    }
    left = right;
    eligible = true;
  }
}
