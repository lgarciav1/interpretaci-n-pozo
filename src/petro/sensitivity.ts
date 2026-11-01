/**
 * Sensibilidad del espesor neto y de h·φ·Sh a cada cutoff (barrido de un corte con los otros dos fijos).
 *
 * Unidades: Vsh, φ y Sw en v/v, espesores en m. NaN = sin dato (la muestra no cuenta, igual que en `netFlagsInto`).
 *
 * Datos faltantes (las mismas reglas que `netFlagsInto` y `summarizeRanges`): una muestra descartada por una curva
 * conocida es no reservorio aunque falte otra (no suma a nada); una de reservorio sin Sw no suma al pay y su espesor
 * va a `noDataPay`. Si en un umbral hay reservorio pero NINGUNA muestra de reservorio tiene Sw, el pay es «sin
 * dato»: `netPay` y `hphiShPay` valen NaN en ese umbral (no 0).
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
 * Corte de permeabilidad (0054): si `cutoffs.permMin` es finito es un corte FIJO más (no se barre): una muestra con
 * k < k_min o sin k nunca es reservorio en ningún umbral (0 o «sin dato», igual que en `netFlagsInto`); sin `perm`
 * se trata como faltante en todas. Sin `permMin` la permeabilidad no interviene.
 *
 * Referencias: Worthington, P.F. y Cosentino, L. (2005), "The role of cut-offs in integrated reservoir studies",
 * SPE Reservoir Evaluation & Engineering 8(4); Asquith y Krygowski (2004).
 */
import { hasPermCutoff, type Cutoffs } from './cutoffs';

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
  /** m, reservorio sin dato de pay (falta Sw) */
  noDataPay: Float64Array;
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
 * @param perm      permeabilidad (mD), solo para el corte fijo de k (`cutoffs.permMin`)
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
  perm?: ArrayLike<number>,
): SweepCurves {
  const t = sweepThresholds(grid);
  const steps = t.length;
  const dx = (grid.max - grid.min) / (steps - 1);
  const { vshMax, phiMin, swMax } = cutoffs;
  const permMin = hasPermCutoff(cutoffs) ? cutoffs.permMin : NaN;
  const kCut = Number.isFinite(permMin);

  // Bins: índice del primer (≤) o último (φ ≥) umbral en que la muestra pasa.
  const binRes = new Float64Array(steps);
  const binPay = new Float64Array(steps);
  const binHphi = new Float64Array(steps);
  const binUnk = new Float64Array(steps); // reservorio sin Sw (m)
  const binResN = new Float64Array(steps); // muestras de reservorio
  const binKnownN = new Float64Array(steps); // de ellas, con Sw
  // Para 'sw' el reservorio no depende del umbral.
  let constRes = 0;
  let constUnk = 0;
  let constResN = 0;
  let constKnownN = 0;

  for (const { start, end } of ranges) {
    for (let i = start; i < end; i++) {
      const v = vsh[i]!;
      const p = phi[i]!;
      const w = sw[i]!;
      if (Number.isNaN(v) || Number.isNaN(p)) continue; // NET_RES = NaN: no cuenta en ningún umbral
      if (kCut && !((perm ? perm[i]! : NaN) >= permMin)) continue; // k bajo (0) o sin k (NaN): nunca reservorio
      const h = thickness[i]!;
      const hphiSh = h * p * (1 - w);

      if (variable === 'sw') {
        if (!(v <= vshMax && p >= phiMin)) continue;
        constRes += h;
        constResN++;
        if (Number.isNaN(w)) {
          constUnk += h; // NET_PAY = NaN
          continue;
        }
        constKnownN++;
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
        binResN[j]!++;
        if (Number.isNaN(w)) binUnk[j]! += h;
        else {
          binKnownN[j]!++;
          if (w <= swMax) {
            binPay[j]! += h;
            binHphi[j]! += hphiSh;
          }
        }
      } else {
        if (!(v <= vshMax)) continue;
        const j = lastAtMost(t, p, grid.min, dx); // reservorio hasta j (φ ≥ t_j)
        if (j < 0) continue;
        binRes[j]! += h;
        binResN[j]!++;
        if (Number.isNaN(w)) binUnk[j]! += h;
        else {
          binKnownN[j]!++;
          if (w <= swMax) {
            binPay[j]! += h;
            binHphi[j]! += hphiSh;
          }
        }
      }
    }
  }

  const netRes = new Float64Array(steps);
  const netPay = new Float64Array(steps);
  const hphiShPay = new Float64Array(steps);
  const noDataPay = new Float64Array(steps);
  let r = 0;
  let pa = 0;
  let hp = 0;
  let un = 0;
  let rn = 0;
  let kn = 0;
  // φ: sufijas (la muestra con último umbral j* cuenta en todos los j ≤ j*); Vsh y Sw: prefijas.
  for (let k = 0; k < steps; k++) {
    const j = variable === 'phi' ? steps - 1 - k : k;
    r += binRes[j]!;
    pa += binPay[j]!;
    hp += binHphi[j]!;
    un += binUnk[j]!;
    rn += binResN[j]!;
    kn += binKnownN[j]!;
    const resN = variable === 'sw' ? constResN : rn;
    const knownN = variable === 'sw' ? constKnownN : kn;
    const unknown = resN > 0 && knownN === 0;
    netRes[j] = variable === 'sw' ? constRes : r;
    netPay[j] = unknown ? NaN : pa;
    hphiShPay[j] = unknown ? NaN : hp;
    noDataPay[j] = variable === 'sw' ? constUnk : un;
  }
  return { thresholds: t, netRes, netPay, hphiShPay, noDataPay };
}
