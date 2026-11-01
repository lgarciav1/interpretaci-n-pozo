/**
 * Cutoffs de arena, reservorio y pay (banderas de espesor neto).
 *
 * Unidades: Vsh, φ y Sw en v/v (fracción, NO %); k en mD. Sin dato (NaN) → NaN. Todas las comparaciones son
 * INCLUSIVAS.
 *
 * Definiciones (docs/decisiones/0007-modulos-fase-6a.md, D6; 0054 para la arena neta y el corte de k):
 *   Arena neta        NET_SAND = 1 si Vsh ≤ Vsh_max; 0 si Vsh > Vsh_max; NaN si falta Vsh.
 *   Reservorio neto   NET_RES = 0 si alguna curva CONOCIDA no pasa su corte (Vsh > Vsh_max, φ < φ_min o, con el corte
 *                     de k activo, k < k_min), aunque otra falte (descarte seguro: Vsh 0,9 con φ NaN da 0). Si ninguna
 *                     curva conocida la descarta: 1 si todas pasan; NaN («sin dato») si falta alguna de las que
 *                     intervienen (Vsh, φ y, solo con el corte de k activo, k). Con el corte de k desactivado la
 *                     permeabilidad no interviene (resultado idéntico al de antes de 0054).
 *   Pay neto          NET_PAY = NaN si NET_RES es NaN;  0 si NET_RES = 0;
 *                     si NET_RES = 1: 1 si Sw ≤ Sw_max, 0 si no, NaN si falta Sw (reservorio «sin dato de pay»:
 *                     NO se cuenta en silencio como no pay; el sumario lo informa).
 *   Por construcción pay ⊆ reservorio ⊆ arena (NET_PAY = 1 ⟹ NET_RES = 1 ⟹ NET_SAND = 1).
 *   Corte de k activo y k faltante: la misma regla que cualquier curva faltante (si Vsh o φ ya la descartan es 0;
 *   si no, NaN = sin dato). Si el pozo no tiene ninguna curva de permeabilidad, todo lo que no descartan Vsh y φ
 *   queda sin dato: el corte no se ignora en silencio (el módulo lo avisa).
 *
 * Los cortes son decisiones del intérprete (no hay valores «de libro»); los valores usuales para una arenisca
 * (Vsh ≤ 0,4–0,5; φ ≥ 0,06–0,10; Sw ≤ 0,5–0,6) se discuten en Asquith y Krygowski (2004).
 *
 * Referencias: Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16
 * (espesor neto de reservorio y de pay por cutoffs); Worthington, P.F. (2010), "Net pay — what is it? What does it
 * do? How do we quantify it? How do we use it?", SPE Reservoir Evaluation & Engineering 13(5) (jerarquía
 * arena neta → reservorio neto → pay neto, y el corte de permeabilidad); Worthington, P.F. y Cosentino, L. (2005), "The role of
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
  /**
   * Permeabilidad mínima para ser reservorio (mD), inclusiva. Ausente o no finita = corte de k desactivado (la
   * permeabilidad no interviene).
   */
  permMin?: number;
}

/** true si el corte de k está activo (permMin finito). */
export function hasPermCutoff(cutoffs: Pick<Cutoffs, 'permMin'>): cutoffs is { permMin: number } {
  return typeof cutoffs.permMin === 'number' && Number.isFinite(cutoffs.permMin);
}

/**
 * Bandera de arena neta: 1 si vsh ≤ vshMax, 0 si no, NaN si vsh es NaN.
 * @param vsh    volumen de arcilla (v/v)
 * @param vshMax corte de Vsh (v/v), inclusivo
 */
export function netSandFlag(vsh: number, vshMax: number): number {
  if (Number.isNaN(vsh)) return NaN;
  return vsh <= vshMax ? 1 : 0;
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
 * Bandera de reservorio neto con corte de permeabilidad: como `netReservoirFlag`, y además 0 si k (conocida) < permMin;
 * NaN si ninguna curva conocida la descarta y falta vsh, phi o k. Con `permMin` no finito equivale a
 * `netReservoirFlag` (k no interviene).
 * @param perm    permeabilidad (mD)
 * @param permMin corte de k (mD), inclusivo; NaN = desactivado
 */
export function netReservoirFlagK(vsh: number, phi: number, perm: number, vshMax: number, phiMin: number, permMin: number): number {
  if (!Number.isFinite(permMin)) return netReservoirFlag(vsh, phi, vshMax, phiMin);
  if (vsh > vshMax || phi < phiMin || perm < permMin) return 0; // false si la curva es NaN
  if (Number.isNaN(vsh) || Number.isNaN(phi) || Number.isNaN(perm)) return NaN;
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

/** Opciones adicionales de `netFlagsInto` (0054). */
export interface NetFlagsExtra {
  /**
   * Permeabilidad (mD) para el corte de k. Si el corte está activo (`cutoffs.permMin` finito) y no se pasa, se trata
   * como faltante en todas las muestras (regla de curva faltante: las que nada descarta quedan sin dato).
   */
  perm?: ArrayLike<number>;
  /** Si se pasa, recibe la bandera de arena neta (mismo índice). */
  outSand?: Float64Array;
}

/**
 * Banderas de reservorio y pay sobre el tramo [start, end), escritas en `outRes` y `outPay` (mismo índice); con
 * `extra.outSand`, también la de arena neta. Sin `cutoffs.permMin` el resultado de reservorio y pay es el mismo que
 * antes del corte de k.
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
  extra: NetFlagsExtra = {},
): void {
  const { vshMax, phiMin, swMax } = cutoffs;
  const { perm, outSand } = extra;
  const permMin = hasPermCutoff(cutoffs) ? cutoffs.permMin : NaN;
  const kCut = Number.isFinite(permMin);
  for (let i = start; i < end; i++) {
    const v = vsh[i]!;
    const res = kCut ? netReservoirFlagK(v, phi[i]!, perm ? perm[i]! : NaN, vshMax, phiMin, permMin) : netReservoirFlag(v, phi[i]!, vshMax, phiMin);
    outRes[i] = res;
    outPay[i] = netPayFlag(res, sw[i]!, swMax);
    if (outSand) outSand[i] = netSandFlag(v, vshMax);
  }
}
