/**
 * Colores de los tipos de roca, compartidos por el panel «Tipos de roca» y la pista del visor (no lo importa el worker).
 */
import { rampColor, SEQUENTIAL_PALETTE } from '../../ui/curves';
import type { ThemeName } from '../../ui/tokens';

/**
 * Color de la clase `i` de `count` (0 = peor roca): rampa viridis del sistema de diseño (la de «color por curva» del
 * crossplot), de violeta (mala) a amarillo (muy buena). Misma función en el panel y en la pista.
 */
export function classColor(i: number, count: number, theme: ThemeName): string {
  return rampColor(count <= 1 ? 1 : i / (count - 1), SEQUENTIAL_PALETTE[theme]);
}
