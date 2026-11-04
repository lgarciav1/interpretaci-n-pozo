/**
 * Cambio de las corridas pedidas al motor de comparación (docs/decisiones/0066, D4). Puro, sin React.
 *
 * Se toman las corridas nuevas ANTES de soltar las anteriores: una serie que sigue elegida mientras se agrega o quita
 * otra no llega a quedar sin interesados. Si se soltara primero, `IsolatedRunner` la sacaría de la cola (y la volvería a
 * encolar al final) o, si estaba en vuelo con preparación, cancelaría el cálculo y la dejaría con error.
 */
export function swapLeases(previous: readonly (() => void)[], acquireNext: () => (() => void)[]): (() => void)[] {
  const next = acquireNext();
  for (const release of previous) release();
  return next;
}
