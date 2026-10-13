/**
 * Colores de las electrofacies (pista y panel; no lo importa el worker). Categóricos del sistema de diseño en orden
 * fijo: a propósito NO son colores de litología, porque las electrofacies no son litologías.
 */
import { CATEGORICAL } from '../../ui/curves';
import type { ThemeName } from '../../ui/tokens';

export function efColor(i: number, theme: ThemeName): string {
  const list = CATEGORICAL[theme];
  return list[((i % list.length) + list.length) % list.length]!;
}
