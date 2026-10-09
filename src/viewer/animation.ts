/**
 * Animación de carga del visor (fase 4b): al cargar un pozo las curvas se dibujan de arriba hacia abajo, como si el
 * registro saliera en vivo. Puro: duración, curva de los tokens y progreso. docs/decisiones/0005, D12.
 *
 * - Dura LOAD_ANIMATION_MS con la curva `--ease-standard` del sistema de diseño (arranca, avanza y se asienta).
 * - Cualquier interacción la corta (el visor queda en su estado final); con movimiento reducido no se anima.
 * - Solo existe mientras dura: un cuadro normal no paga nada (el dibujante recibe `reveal` indefinido).
 */
import { BASE_TOKENS } from '../ui/tokens';

/** Más larga que las transiciones de la interfaz a propósito: es un gesto de "registro", no de un control. */
export const LOAD_ANIMATION_MS = 1000;

/** Curva cubic-bezier(x1, y1, x2, y2) de CSS como función t → progreso (0–1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton y, si no converge, bisección: u tal que x(u) = t.
    let u = t;
    for (let k = 0; k < 8; k++) {
      const err = sx(u) - t;
      if (Math.abs(err) < 1e-6) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    for (let k = 0; k < 40; k++) {
      const x = sx(u);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

/** Lee `cubic-bezier(a, b, c, d)` de un token; si no se entiende, lineal. */
export function easingFromToken(css: string): (t: number) => number {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css);
  const v = m?.[1]!.split(',').map((x) => Number(x.trim()));
  if (!v || v.length !== 4 || v.some((x) => !Number.isFinite(x))) return (t) => Math.min(1, Math.max(0, t));
  return cubicBezier(v[0]!, v[1]!, v[2]!, v[3]!);
}

export const loadEasing = easingFromToken(BASE_TOKENS.ease.standard);

/** Progreso de la animación de carga a los `elapsed` ms (1 = terminó). */
export function revealAt(elapsed: number, duration = LOAD_ANIMATION_MS): number {
  return loadEasing(elapsed / duration);
}
