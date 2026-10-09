/**
 * Cutoffs de reservorio y pay (banderas de espesor neto).
 *
 * Unidades: Vsh, φ y Sw en v/v (fracción, NO %). Sin dato (NaN) → NaN. Todas las comparaciones son INCLUSIVAS.
 *
 * Definiciones (docs/decisiones/0007-modulos-fase-6a.md, D6):
 *   Reservorio neto   NET_RES = 0 si alguna curva CONOCIDA no pasa su corte (Vsh > Vsh_max o φ < φ_min), aunque la otra
 *                     falte (descarte seguro: Vsh 0,9 con φ NaN da 0). Si ninguna curva conocida la descarta:
 *                     1 si Vsh ≤ Vsh_max y φ ≥ φ_min; NaN («sin dato») si falta Vsh o φ.
 *   Pay neto          NET_PAY = NaN si NET_RES es NaN;  0 si NET_RES = 0;
 *                     si NET_RES = 1: 1 si Sw ≤ Sw_max, 0 si no, NaN si falta Sw (reservorio «sin dato de pay»:
 *                     NO se cuenta en silencio como no pay; el sumario lo informa).
 *   Por construcción pay ⊆ reservorio (NET_PAY = 1 implica NET_RES = 1).
 *
 * Los cortes son decisiones del intérprete (no hay valores «de libro»); los valores usuales para una arenisca
 * (Vsh ≤ 0,4–0,5; φ ≥ 0,06–0,10; Sw ≤ 0,5–0,6) se discuten en Asquith y Krygowski (2004).
 *
 * Referencias: Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16
 * (espesor neto de reservorio y de pay por cutoffs); Worthington, P.F. y Cosentino, L. (2005), "The role of
 * cut-offs in integrated reservoir studies", SPE Reservoir Evaluation & Engineering 8(4).
 */

/** Cortes de reservorio y pay (v/v). */
export interface Cutoffs {
  /** Vsh máxima para ser reservorio. */
  vshMax: number;
  /** Porosidad mínima para ser reservorio. */
  phiMin: number;
  /** Sw máxima para ser pay. */
  swMax: number;
}

/**
 * Bandera de reservorio neto: 0 si alguna curva conocida no pasa su corte (aunque la otra sea NaN); 1 si ambas
 * pasan (vsh ≤ vshMax y phi ≥ phiMin); NaN si ninguna conocida descarta la muestra y falta vsh o phi.
 * @param vsh    volumen de arcilla (v/v)
 * @param phi    porosidad efectiva (v/v)
 * @param vshMax corte de Vsh (v/v), inclusivo
 * @param phiMin corte de porosidad (v/v), inclusivo
 */
export function netReservoirFlag(vsh: number, phi: number, vshMax: number, phiMin: number): number {
  if (vsh > vshMax || phi < phiMin) return 0; // false si la curva es NaN
  if (Number.isNaN(vsh) || Number.isNaN(phi)) return NaN;
  return 1;
}

/**
 * Bandera de pay neto: NaN si netRes es NaN; 0 si netRes = 0; si netRes = 1: 1 si sw ≤ swMax, 0 si no, NaN si
 * sw es NaN.
 * @param netRes bandera de reservorio neto (0, 1 o NaN)
 * @param sw     saturación de agua (v/v)
 * @param swMax  corte de Sw (v/v), inclusivo
 */
export function netPayFlag(netRes: number, sw: number, swMax: number): number {
  if (Number.isNaN(netRes)) return NaN;
  if (netRes !== 1) return 0;
  if (Number.isNaN(sw)) return NaN;
  return sw <= swMax ? 1 : 0;
}

/**
 * Banderas de reservorio y pay sobre el tramo [start, end), escritas en `outRes` y `outPay` (mismo índice).
 */
export function netFlagsInto(
  vsh: ArrayLike<number>,
  phi: ArrayLike<number>,
  sw: ArrayLike<number>,
  outRes: Float64Array,
  outPay: Float64Array,
  cutoffs: Cutoffs,
  start = 0,
  end = vsh.length,
): void {
  const { vshMax, phiMin, swMax } = cutoffs;
  for (let i = start; i < end; i++) {
    const res = netReservoirFlag(vsh[i]!, phi[i]!, vshMax, phiMin);
    outRes[i] = res;
    outPay[i] = netPayFlag(res, sw[i]!, swMax);
  }
}
