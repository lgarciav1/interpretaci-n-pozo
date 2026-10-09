/**
 * Índice de rayos gamma (IGR).
 *
 * Primera pieza del contrato de `src/petro/` (funciones puras, sin UI, testeadas). Vsh a partir del IGR
 * (lineal/Larionov/Clavier/Steiber) está en `vsh.ts`.
 *
 * IGR = (GR − GRclean) / (GRshale − GRclean), recortado a [0, 1].
 * Sin dato (NaN) en GR → NaN. Si GRshale ≤ GRclean el índice no está definido → NaN.
 */

/** IGR de una muestra. */
export function gammaRayIndex(gr: number, grClean: number, grShale: number): number {
  const span = grShale - grClean;
  if (!(span > 0) || Number.isNaN(gr)) return NaN;
  const igr = (gr - grClean) / span;
  return igr < 0 ? 0 : igr > 1 ? 1 : igr;
}

/**
 * IGR sobre el tramo [start, end) de `gr`, escrito en `out` (mismo índice).
 * Pensado para llamarse por segmento de zona con los parámetros de esa zona.
 */
export function gammaRayIndexInto(
  gr: ArrayLike<number>,
  out: Float64Array,
  grClean: number,
  grShale: number,
  start = 0,
  end = gr.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = gammaRayIndex(gr[i]!, grClean, grShale);
  return out;
}
