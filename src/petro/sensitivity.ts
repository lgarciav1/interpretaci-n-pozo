/**
 * Sensibilidad del espesor neto y de h·φ·Sh a cada cutoff (barrido de un corte con los otros dos fijos).
 *
 * Unidades: Vsh, φ y Sw en v/v, espesores en m. NaN = sin dato (la muestra no cuenta, igual que en `netFlagsInto`).
 *
 * Semántica: en cada umbral t_j la salida es EXACTAMENTE la que se obtiene sumando las banderas de
 * `netFlagsInto` con el cutoff de `variable` reemplazado por t_j (comparaciones inclusivas: Vsh ≤ t, φ ≥ t, Sw ≤ t):
 *   netRes_j    = Σ hᵢ        donde NET_RES(t_j) = 1
 *   netPay_j    = Σ hᵢ        donde NET_PAY(t_j) = 1
 *   hphiShPay_j = Σ hᵢφᵢ(1 − Swᵢ)  donde NET_PAY(t_j) = 1
 *
 * Algoritmo O(muestras + pasos): cada muestra que pasa los otros dos cortes pasa el corte barrido desde (Vsh, Sw) o
 * hasta (φ) un umbral concreto j*; se acumula en ese bin y una suma prefija (o sufija para φ) da el valor en cada
 * umbral. j* se busca comparando contra el mismo t_j que devuelve `sweepThresholds` (nunca con una división), de
 * modo que una muestra exactamente sobre un umbral queda del lado correcto del borde.
 *
 * Referencias: Worthington, P.F. y Cosentino, L. (2005), "The role of cut-offs in integrated reservoir studies",
 * SPE Reservoir Evaluation & Engineering 8(4); Asquith y Krygowski (2004), cap. 6.
 */
import type { Cutoffs } from './cutoffs';

export type SweepVariable = 'vsh' | 'phi' | 'sw';

/** Umbrales t_j = min + j·(max − min)/(steps − 1), j = 0…steps−1 (steps ≥ 2). */
export interface SweepGrid {
  min: number;
  max: number;
  steps: number;
}

export interface SweepCurves {
  /** t_j */
  thresholds: Float64Array;
  /** m, neto reservorio con el cutoff de `variable` = t_j */
  netRes: Float64Array;
  /** m */
  netPay: Float64Array;
  /** m, Σ h·φ·(1 − Sw) sobre el pay */
  hphiShPay: Float64Array;
}

function checkGrid(grid: SweepGrid): void {
  const { min, max, steps } = grid;
  if (!Number.isInteger(steps) || steps < 2) throw new RangeError(`El barrido necesita al menos 2 pasos (recibió ${steps}).`);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
    throw new RangeError(`La grilla del barrido necesita min < max finitos (recibió ${min} y ${max}).`);
  }
}

/** Umbrales equiespaciados de la grilla; el último es exactamente `max`. */
export function sweepThresholds(grid: SweepGrid): Float64Array {
  checkGrid(grid);
  const { min, max, steps } = grid;
  const t = new Float64Array(steps);
  const dx = (max - min) / (steps - 1);
  for (let j = 0; j < steps; j++) t[j] = min + j * dx;
  t[steps - 1] = max;
  return t;
}

/** Menor j con t[j] ≥ v (steps si ninguno). `t` creciente. */
function firstAtLeast(t: Float64Array, v: number, min: number, dx: number): number {
  const steps = t.length;
  let j = Math.ceil((v - min) / dx);
  if (!(j > 0)) j = 0;
  if (j > steps) j = steps;
  while (j > 0 && t[j - 1]! >= v) j--;
  while (j < steps && t[j]! < v) j++;
  return j;
}

/** Último j con t[j] ≤ v (−1 si ninguno). `t` creciente. */
function lastAtMost(t: Float64Array, v: number, min: number, dx: number): number {
  const steps = t.length;
  let j = Math.floor((v - min) / dx);
  if (!(j < steps - 1)) j = steps - 1;
  if (j < -1) j = -1;
  while (j >= 0 && t[j]! > v) j--;
  while (j < steps - 1 && t[j + 1]! <= v) j++;
  return j;
}

/**
 * Barrido del cutoff de `variable` sobre la unión de `ranges`, con los otros dos cortes de `cutoffs`.
 * @param vsh       volumen de arcilla (v/v)
 * @param phi       porosidad efectiva (v/v)
 * @param sw        saturación de agua (v/v)
 * @param thickness espesor por muestra (m)
 * @param cutoffs   cortes vigentes (el de `variable` se ignora: lo reemplaza cada umbral)
 * @param variable  corte a barrer
 * @param grid      grilla de umbrales (steps ≥ 2, min < max)
 * @param ranges    tramos [start, end) que se suman (una zona, o todas para el total)
 */
export function cutoffSweep(
  vsh: ArrayLike<number>,
  phi: ArrayLike<number>,
  sw: ArrayLike<number>,
  thickness: ArrayLike<number>,
  cutoffs: Cutoffs,
  variable: SweepVariable,
  grid: SweepGrid,
  ranges: readonly { start: number; end: number }[],
): SweepCurves {
  const t = sweepThresholds(grid);
  const steps = t.length;
  const dx = (grid.max - grid.min) / (steps - 1);
  const { vshMax, phiMin, swMax } = cutoffs;

  // Bins: índice del primer (≤) o último (φ ≥) umbral en que la muestra pasa.
  const binRes = new Float64Array(steps);
  const binPay = new Float64Array(steps);
  const binHphi = new Float64Array(steps);
  // Para 'sw' el neto de reservorio no depende del umbral.
  let constRes = 0;

  for (const { start, end } of ranges) {
    for (let i = start; i < end; i++) {
      const v = vsh[i]!;
      const p = phi[i]!;
      const w = sw[i]!;
      if (Number.isNaN(v) || Number.isNaN(p)) continue; // NET_RES = NaN: no cuenta en ningún umbral
      const h = thickness[i]!;
      const hphiSh = h * p * (1 - w);

      if (variable === 'sw') {
        if (!(v <= vshMax && p >= phiMin)) continue;
        constRes += h;
        if (Number.isNaN(w)) continue; // NET_PAY = NaN
        const j = firstAtLeast(t, w, grid.min, dx); // pay desde j (Sw ≤ t_j)
        if (j < steps) {
          binPay[j]! += h;
          binHphi[j]! += hphiSh;
        }
      } else if (variable === 'vsh') {
        if (!(p >= phiMin)) continue;
        const j = firstAtLeast(t, v, grid.min, dx); // reservorio desde j (Vsh ≤ t_j)
        if (j >= steps) continue;
        binRes[j]! += h;
        if (!Number.isNaN(w) && w <= swMax) {
          binPay[j]! += h;
          binHphi[j]! += hphiSh;
        }
      } else {
        if (!(v <= vshMax)) continue;
        const j = lastAtMost(t, p, grid.min, dx); // reservorio hasta j (φ ≥ t_j)
        if (j < 0) continue;
        binRes[j]! += h;
        if (!Number.isNaN(w) && w <= swMax) {
          binPay[j]! += h;
          binHphi[j]! += hphiSh;
        }
      }
    }
  }

  const netRes = new Float64Array(steps);
  const netPay = new Float64Array(steps);
  const hphiShPay = new Float64Array(steps);
  if (variable === 'phi') {
    // Sufijas: la muestra con último umbral j* cuenta en todos los j ≤ j*.
    let r = 0;
    let pa = 0;
    let hp = 0;
    for (let j = steps - 1; j >= 0; j--) {
      r += binRes[j]!;
      pa += binPay[j]!;
      hp += binHphi[j]!;
      netRes[j] = r;
      netPay[j] = pa;
      hphiShPay[j] = hp;
    }
  } else {
    let r = 0;
    let pa = 0;
    let hp = 0;
    for (let j = 0; j < steps; j++) {
      r += binRes[j]!;
      pa += binPay[j]!;
      hp += binHphi[j]!;
      netRes[j] = variable === 'sw' ? constRes : r;
      netPay[j] = pa;
      hphiShPay[j] = hp;
    }
  }
  return { thresholds: t, netRes, netPay, hphiShPay };
}
