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

// ---------------------------------------------------------------------------------------------------------------
// Superficie 2D, contornos y estabilidad local (G09 — docs/decisiones/0093-superficie-2d-cutoffs.md)

export type SurfacePairId = 'phi-sw' | 'vsh-phi' | 'vsh-sw';

export interface SurfacePairDef {
  id: SurfacePairId;
  xVar: SweepVariable;
  yVar: SweepVariable;
  fixedVar: SweepVariable;
  label: string;
}

/** Pares de cutoffs disponibles en la superficie 2D. */
export const SURFACE_PAIRS: readonly SurfacePairDef[] = [
  { id: 'phi-sw', xVar: 'phi', yVar: 'sw', fixedVar: 'vsh', label: 'φ × Sw' },
  { id: 'vsh-phi', xVar: 'vsh', yVar: 'phi', fixedVar: 'sw', label: 'Vsh × φ' },
  { id: 'vsh-sw', xVar: 'vsh', yVar: 'sw', fixedVar: 'phi', label: 'Vsh × Sw' },
];

export type SurfaceMetricKey = 'netRes' | 'netPay' | 'hphiShPay' | 'noDataPay';

/** Superficie 2D de sensibilidad en grillas uniformes (matrices fila-mayor `k = jy * nx + ix`). */
export interface Surface2D {
  pairId: SurfacePairId;
  xVar: SweepVariable;
  yVar: SweepVariable;
  xThresholds: Float64Array;
  yThresholds: Float64Array;
  nx: number;
  ny: number;
  netRes: Float64Array;
  netPay: Float64Array;
  hphiShPay: Float64Array;
  noDataPay: Float64Array;
}

const clampNum = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function thresholdIndex(t: Float64Array, v: number, mode: 'le' | 'ge'): number {
  let lo = 0;
  let hi = t.length;
  if (mode === 'le') {
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (t[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function fixedCutoffPass(variable: SweepVariable, v: number, p: number, c: Cutoffs): boolean {
  if (variable === 'vsh') return !Number.isNaN(v) && v <= c.vshMax;
  if (variable === 'phi') return !Number.isNaN(p) && p >= c.phiMin;
  return true;
}

/** Acumula deltas en grilla 2D según sentido del corte en cada eje ('le' → sufijo; 'ge' → prefijo). */
function sweepAccumulate2D(arr: Float64Array, nx: number, ny: number, xMode: 'le' | 'ge', yMode: 'le' | 'ge'): void {
  for (let jy = 0; jy < ny; jy++) {
    const row = jy * nx;
    if (xMode === 'le') {
      for (let ix = 1; ix < nx; ix++) arr[row + ix] = arr[row + ix]! + arr[row + ix - 1]!;
    } else {
      for (let ix = nx - 2; ix >= 0; ix--) arr[row + ix] = arr[row + ix]! + arr[row + ix + 1]!;
    }
  }
  if (yMode === 'le') {
    for (let jy = 1; jy < ny; jy++) {
      const row = jy * nx;
      const prev = (jy - 1) * nx;
      for (let ix = 0; ix < nx; ix++) arr[row + ix] = arr[row + ix]! + arr[prev + ix]!;
    }
  } else {
    for (let jy = ny - 2; jy >= 0; jy--) {
      const row = jy * nx;
      const next = (jy + 1) * nx;
      for (let ix = 0; ix < nx; ix++) arr[row + ix] = arr[row + ix]! + arr[next + ix]!;
    }
  }
}

/**
 * Evalúa exactamente los espesores netos e hidrocarburo equivalente sobre una grilla 2D de dos cutoffs en
 * O(N + nx·ny), preservando la semántica de datos faltantes y el corte de permeabilidad de `cutoffSweep`.
 */
export function cutoffSurface2D(
  vsh: ArrayLike<number>,
  phi: ArrayLike<number>,
  sw: ArrayLike<number>,
  thickness: ArrayLike<number>,
  cutoffs: Cutoffs,
  pairId: SurfacePairId,
  xGrid: SweepGrid,
  yGrid: SweepGrid,
  ranges: readonly { start: number; end: number }[],
  perm?: ArrayLike<number>,
): Surface2D {
  const pair = SURFACE_PAIRS.find((p) => p.id === pairId)!;
  const xThresholds = sweepThresholds(xGrid);
  const yThresholds = sweepThresholds(yGrid);
  const nx = xThresholds.length;
  const ny = yThresholds.length;
  const size = nx * ny;

  const netRes = new Float64Array(size);
  const netPay = new Float64Array(size);
  const hphiShPay = new Float64Array(size);
  const noDataPay = new Float64Array(size);
  const resN = new Float64Array(size);
  const knownN = new Float64Array(size);

  const xMode: 'le' | 'ge' = pair.xVar === 'phi' ? 'ge' : 'le';
  const yMode: 'le' | 'ge' = pair.yVar === 'phi' ? 'ge' : 'le';
  const permMin = hasPermCutoff(cutoffs) ? cutoffs.permMin : NaN;
  const kCut = Number.isFinite(permMin);

  const valOf = (variable: SweepVariable, v: number, p: number, s: number) =>
    variable === 'vsh' ? v : variable === 'phi' ? p : s;

  for (const r of ranges) {
    for (let i = r.start; i < r.end; i++) {
      const h = thickness[i]!;
      if (!(h > 0) || !Number.isFinite(h)) continue;
      if (kCut) {
        const kv = perm ? perm[i]! : NaN;
        if (Number.isNaN(kv) || kv < permMin) continue;
      }
      const v = vsh[i]!;
      const p = phi[i]!;
      const s = sw[i]!;
      if (!fixedCutoffPass(pair.fixedVar, v, p, cutoffs)) continue;

      // Ubicación en X e Y para reservorio (`sw` no restringe reservorio: entra en todos los índices 'le', j = 0).
      const xVal = valOf(pair.xVar, v, p, s);
      const yVal = valOf(pair.yVar, v, p, s);
      let ixRes: number;
      if (pair.xVar === 'sw') ixRes = 0;
      else {
        if (Number.isNaN(xVal)) continue;
        ixRes = thresholdIndex(xThresholds, xVal, xMode);
        if (xMode === 'le' ? ixRes >= nx : ixRes < 0) continue;
      }

      let jyRes: number;
      if (pair.yVar === 'sw') jyRes = 0;
      else {
        if (Number.isNaN(yVal)) continue;
        jyRes = thresholdIndex(yThresholds, yVal, yMode);
        if (yMode === 'le' ? jyRes >= ny : jyRes < 0) continue;
      }

      const resIdx = jyRes * nx + ixRes;
      netRes[resIdx] = netRes[resIdx]! + h;
      resN[resIdx] = resN[resIdx]! + 1;

      if (Number.isNaN(s)) {
        noDataPay[resIdx] = noDataPay[resIdx]! + h;
        continue;
      }
      knownN[resIdx] = knownN[resIdx]! + 1;

      let ixPay = ixRes;
      if (pair.xVar === 'sw') {
        ixPay = thresholdIndex(xThresholds, s, 'le');
        if (ixPay >= nx) continue;
      }
      let jyPay = jyRes;
      if (pair.yVar === 'sw') {
        jyPay = thresholdIndex(yThresholds, s, 'le');
        if (jyPay >= ny) continue;
      } else if (pair.fixedVar === 'sw' && s > cutoffs.swMax) {
        continue;
      }

      const payIdx = jyPay * nx + ixPay;
      netPay[payIdx] = netPay[payIdx]! + h;
      hphiShPay[payIdx] = hphiShPay[payIdx]! + h * p * (1 - s);
    }
  }

  sweepAccumulate2D(netRes, nx, ny, xMode, yMode);
  sweepAccumulate2D(netPay, nx, ny, xMode, yMode);
  sweepAccumulate2D(hphiShPay, nx, ny, xMode, yMode);
  sweepAccumulate2D(noDataPay, nx, ny, xMode, yMode);
  sweepAccumulate2D(resN, nx, ny, xMode, yMode);
  sweepAccumulate2D(knownN, nx, ny, xMode, yMode);

  for (let k = 0; k < size; k++) {
    if (resN[k]! > 0 && knownN[k]! === 0) {
      netPay[k] = NaN;
      hphiShPay[k] = NaN;
    }
  }

  return {
    pairId,
    xVar: pair.xVar,
    yVar: pair.yVar,
    xThresholds,
    yThresholds,
    nx,
    ny,
    netRes,
    netPay,
    hphiShPay,
    noDataPay,
  };
}

export interface ContourPolyline {
  points: readonly { x: number; y: number }[];
  closed: boolean;
}

export interface ContourLevel {
  level: number;
  lines: readonly ContourPolyline[];
}

/**
 * Elige entre 3 y 6 niveles estrictamente interiores al rango `[min, max]` con pasos limpios (`1, 2, 5 × 10^k`).
 */
export function contourLevelsForRange(min: number, max: number, targetCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const span = max - min;
  if (span <= 1e-12) return [];
  const desired = Math.max(3, Math.min(6, Math.round(targetCount)));
  const raw = span / (desired + 1);
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const eps = span * 1e-9;

  let best: number[] = [];
  let bestScore = Infinity;
  for (const mult of [0.5, 1, 2, 2.5, 5, 10, 20]) {
    const step = base * mult;
    if (!(step > 0)) continue;
    const kStart = Math.ceil((min + eps) / step);
    const kEnd = Math.floor((max - eps) / step);
    const count = kEnd - kStart + 1;
    if (count < 2 || count > 8) continue;
    const score = Math.abs(count - desired) + (count < 3 || count > 6 ? 10 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = [];
      for (let k = kStart; k <= kEnd; k++) {
        const v = k * step;
        best.push(Math.abs(v) < step * 1e-12 ? 0 : Number(v.toPrecision(12)));
      }
    }
  }
  if (best.length >= 2) return best;
  return [1, 2, 3].map((k) => Number((min + (span * k) / 4).toPrecision(12)));
}

function cellSegments(mask: number, avg: number, level: number): readonly [number, number][] {
  // Aristas locales: 0=Abajo (BL-BR), 1=Derecha (BR-TR), 2=Arriba (TR-TL), 3=Izquierda (TL-BL).
  switch (mask) {
    case 1: return [[3, 0]];
    case 2: return [[0, 1]];
    case 3: return [[3, 1]];
    case 4: return [[1, 2]];
    case 5: return avg >= level ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
    case 6: return [[0, 2]];
    case 7: return [[3, 2]];
    case 8: return [[2, 3]];
    case 9: return [[2, 0]];
    case 10: return avg >= level ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]];
    case 11: return [[2, 1]];
    case 12: return [[1, 3]];
    case 13: return [[1, 0]];
    case 14: return [[0, 3]];
    default: return [];
  }
}

/**
 * Extrae curvas de nivel (*Marching Squares*) sobre una grilla 2D. Omite celdas con `NaN` y desambigua los casos
 * de silla (`5` y `10`) por el promedio de los cuatro vértices respecto al nivel.
 */
export function extractContours2D(
  grid: Pick<Surface2D, 'xThresholds' | 'yThresholds' | 'nx' | 'ny'>,
  values: ArrayLike<number>,
  levels: readonly number[],
): ContourLevel[] {
  const { xThresholds: tx, yThresholds: ty, nx, ny } = grid;
  if (nx < 2 || ny < 2 || values.length < nx * ny) return [];

  const out: ContourLevel[] = [];
  for (const level of levels) {
    if (!Number.isFinite(level)) continue;
    interface EdgeNode {
      key: string;
      x: number;
      y: number;
      neighbors: string[];
    }
    const nodes = new Map<string, EdgeNode>();
    const edges: { a: string; b: string; used: boolean }[] = [];

    const edgePoint = (ix: number, jy: number, edge: number, v00: number, v10: number, v11: number, v01: number): { key: string; x: number; y: number } => {
      const interp = (va: number, vb: number) => {
        const d = vb - va;
        return Math.abs(d) < 1e-15 ? 0.5 : clampNum((level - va) / d, 0, 1);
      };
      if (edge === 0) {
        const t = interp(v00, v10);
        return { key: `h:${jy}:${ix}`, x: tx[ix]! + t * (tx[ix + 1]! - tx[ix]!), y: ty[jy]! };
      }
      if (edge === 1) {
        const t = interp(v10, v11);
        return { key: `v:${jy}:${ix + 1}`, x: tx[ix + 1]!, y: ty[jy]! + t * (ty[jy + 1]! - ty[jy]!) };
      }
      if (edge === 2) {
        const t = interp(v01, v11);
        return { key: `h:${jy + 1}:${ix}`, x: tx[ix]! + t * (tx[ix + 1]! - tx[ix]!), y: ty[jy + 1]! };
      }
      const t = interp(v00, v01);
      return { key: `v:${jy}:${ix}`, x: tx[ix]!, y: ty[jy]! + t * (ty[jy + 1]! - ty[jy]!) };
    };

    for (let jy = 0; jy < ny - 1; jy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const v00 = values[jy * nx + ix]!;
        const v10 = values[jy * nx + ix + 1]!;
        const v11 = values[(jy + 1) * nx + ix + 1]!;
        const v01 = values[(jy + 1) * nx + ix]!;
        if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v11) || !Number.isFinite(v01)) continue;
        const mask = (v00 >= level ? 1 : 0) | (v10 >= level ? 2 : 0) | (v11 >= level ? 4 : 0) | (v01 >= level ? 8 : 0);
        if (mask === 0 || mask === 15) continue;
        const segs = cellSegments(mask, (v00 + v10 + v11 + v01) * 0.25, level);
        for (const [e0, e1] of segs) {
          const p0 = edgePoint(ix, jy, e0, v00, v10, v11, v01);
          const p1 = edgePoint(ix, jy, e1, v00, v10, v11, v01);
          let n0 = nodes.get(p0.key);
          if (!n0) { n0 = { ...p0, neighbors: [] }; nodes.set(p0.key, n0); }
          let n1 = nodes.get(p1.key);
          if (!n1) { n1 = { ...p1, neighbors: [] }; nodes.set(p1.key, n1); }
          const ei = edges.length;
          edges.push({ a: p0.key, b: p1.key, used: false });
          n0.neighbors.push(String(ei));
          n1.neighbors.push(String(ei));
        }
      }
    }

    const lines: ContourPolyline[] = [];
    const traceFrom = (startKey: string) => {
      const pts: { x: number; y: number }[] = [];
      let curKey = startKey;
      const pushUnique = (x: number, y: number) => {
        const prev = pts[pts.length - 1];
        if (!prev || Math.abs(prev.x - x) > 1e-12 || Math.abs(prev.y - y) > 1e-12) pts.push({ x, y });
      };
      const first = nodes.get(curKey)!;
      pushUnique(first.x, first.y);
      while (true) {
        const node = nodes.get(curKey)!;
        const nextEdgeId = node.neighbors.find((id) => !edges[Number(id)]!.used);
        if (nextEdgeId === undefined) break;
        const edge = edges[Number(nextEdgeId)]!;
        edge.used = true;
        const nextKey = edge.a === curKey ? edge.b : edge.a;
        const nextNode = nodes.get(nextKey)!;
        pushUnique(nextNode.x, nextNode.y);
        curKey = nextKey;
        if (curKey === startKey) break;
      }
      const closed = curKey === startKey && pts.length >= 3;
      if (closed && pts.length >= 2) {
        const firstPt = pts[0]!;
        const lastPt = pts[pts.length - 1]!;
        if (Math.abs(firstPt.x - lastPt.x) <= 1e-12 && Math.abs(firstPt.y - lastPt.y) <= 1e-12) pts.pop();
      }
      if (pts.length >= 2) lines.push({ points: pts, closed });
    };

    // Primero polilíneas abiertas (grado impar), luego lazos cerrados.
    for (const node of nodes.values()) {
      const unused = node.neighbors.filter((id) => !edges[Number(id)]!.used).length;
      if (unused === 1) traceFrom(node.key);
    }
    for (const edge of edges) {
      if (!edge.used) traceFrom(edge.a);
    }
    out.push({ level, lines });
  }
  return out;
}

/**
 * Evalúa por interpolación bilineal el valor en `(x, y)` sobre una grilla 2D. Devuelve `NaN` fuera del dominio o si
 * alguna esquina activa de la celda no es finita.
 */
export function sampleSurface2D(
  grid: Pick<Surface2D, 'xThresholds' | 'yThresholds' | 'nx' | 'ny'>,
  values: ArrayLike<number>,
  x: number,
  y: number,
): number {
  const { xThresholds: tx, yThresholds: ty, nx, ny } = grid;
  if (!Number.isFinite(x) || !Number.isFinite(y) || nx < 1 || ny < 1 || values.length < nx * ny) return NaN;
  const xMin = tx[0]!;
  const xMax = tx[nx - 1]!;
  const yMin = ty[0]!;
  const yMax = ty[ny - 1]!;
  const xEps = Math.max(1e-12, Math.abs(xMax - xMin) * 1e-12);
  const yEps = Math.max(1e-12, Math.abs(yMax - yMin) * 1e-12);
  if (x < xMin - xEps || x > xMax + xEps || y < yMin - yEps || y > yMax + yEps) return NaN;
  const xc = clampNum(x, xMin, xMax);
  const yc = clampNum(y, yMin, yMax);

  const bracket = (t: ArrayLike<number>, n: number, v: number): { i0: number; i1: number; f: number } => {
    if (n === 1) return { i0: 0, i1: 0, f: 0 };
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (t[mid]! <= v) lo = mid;
      else hi = mid - 1;
    }
    const a = t[lo]!;
    const b = t[lo + 1]!;
    const f = b === a ? 0 : clampNum((v - a) / (b - a), 0, 1);
    return { i0: lo, i1: lo + 1, f };
  };

  const bx = bracket(tx, nx, xc);
  const by = bracket(ty, ny, yc);
  const w00 = (1 - bx.f) * (1 - by.f);
  const w10 = bx.f * (1 - by.f);
  const w01 = (1 - bx.f) * by.f;
  const w11 = bx.f * by.f;

  let acc = 0;
  for (const [ix, jy, w] of [
    [bx.i0, by.i0, w00],
    [bx.i1, by.i0, w10],
    [bx.i0, by.i1, w01],
    [bx.i1, by.i1, w11],
  ] as const) {
    if (w <= 0) continue;
    const v = values[jy * nx + ix]!;
    if (!Number.isFinite(v)) return NaN;
    acc += w * v;
  }
  return acc;
}

/** Semiamplitudes operativas locales para evaluar estabilidad bivariada (ADR 0093). */
export const CUTOFF_STABILITY_HALF: Readonly<Record<SweepVariable, number>> = {
  vsh: 0.05,
  phi: 0.01,
  sw: 0.05,
};

export type StabilityClass = 'stable' | 'sensitive' | 'critical' | 'empty' | 'no-data';

export interface StabilityAssessment {
  status: StabilityClass;
  centerValue: number;
  minValue: number;
  maxValue: number;
  maxRelDelta: number | null;
  zeroCenterWithGain: boolean;
  box: { xLow: number; xHigh: number; yLow: number; yHigh: number };
}

/**
 * Clasifica la estabilidad local bivariada a partir del valor exacto en el centro y en las 4 esquinas de la caja
 * operativa `[xLow, xHigh] × [yLow, yHigh]`.
 */
export function classifyStability2D(
  centerValue: number,
  cornerValues: readonly number[],
  box: { xLow: number; xHigh: number; yLow: number; yHigh: number },
): StabilityAssessment {
  if (!Number.isFinite(centerValue)) {
    return { status: 'no-data', centerValue: NaN, minValue: NaN, maxValue: NaN, maxRelDelta: null, zeroCenterWithGain: false, box };
  }
  const finiteCorners = cornerValues.filter(Number.isFinite);
  if (finiteCorners.length === 0) {
    return { status: 'no-data', centerValue, minValue: centerValue, maxValue: centerValue, maxRelDelta: null, zeroCenterWithGain: false, box };
  }
  let minValue = centerValue;
  let maxValue = centerValue;
  for (const v of finiteCorners) {
    if (v < minValue) minValue = v;
    if (v > maxValue) maxValue = v;
  }
  if (Math.abs(centerValue) <= 1e-12) {
    if (maxValue <= 1e-12 && minValue >= -1e-12) {
      return { status: 'empty', centerValue: 0, minValue: 0, maxValue: 0, maxRelDelta: null, zeroCenterWithGain: false, box };
    }
    return { status: 'critical', centerValue: 0, minValue, maxValue, maxRelDelta: null, zeroCenterWithGain: true, box };
  }
  let maxDiff = 0;
  for (const v of finiteCorners) {
    const d = Math.abs(v - centerValue);
    if (d > maxDiff) maxDiff = d;
  }
  const maxRelDelta = maxDiff / Math.abs(centerValue);
  const status: StabilityClass = maxRelDelta <= 0.1 ? 'stable' : maxRelDelta <= 0.25 ? 'sensitive' : 'critical';
  return { status, centerValue, minValue, maxValue, maxRelDelta, zeroCenterWithGain: false, box };
}

/** Construye la caja operativa acotada alrededor de `(x0, y0)` para un par de cutoffs dado. */
export function stabilityBox2D(
  pair: Pick<SurfacePairDef, 'xVar' | 'yVar'>,
  x0: number,
  y0: number,
  xRange: { min: number; max: number },
  yRange: { min: number; max: number },
): { xLow: number; xHigh: number; yLow: number; yHigh: number } {
  const dx = CUTOFF_STABILITY_HALF[pair.xVar];
  const dy = CUTOFF_STABILITY_HALF[pair.yVar];
  return {
    xLow: clampNum(x0 - dx, xRange.min, xRange.max),
    xHigh: clampNum(x0 + dx, xRange.min, xRange.max),
    yLow: clampNum(y0 - dy, yRange.min, yRange.max),
    yHigh: clampNum(y0 + dy, yRange.min, yRange.max),
  };
}

/**
 * Evalúa exactamente un punto `(xVal, yVal)` de cutoffs sobre los tramos `ranges` sin discretización de grilla.
 */
export function evalCutoffPairPoint(
  vsh: ArrayLike<number>,
  phi: ArrayLike<number>,
  sw: ArrayLike<number>,
  thickness: ArrayLike<number>,
  cutoffs: Cutoffs,
  pairId: SurfacePairId,
  xVal: number,
  yVal: number,
  ranges: readonly { start: number; end: number }[],
  perm?: ArrayLike<number>,
): Record<SurfaceMetricKey, number> {
  const pair = SURFACE_PAIRS.find((p) => p.id === pairId)!;
  const c: Cutoffs = { ...cutoffs };
  const assign = (variable: SweepVariable, val: number) => {
    if (variable === 'vsh') c.vshMax = val;
    else if (variable === 'phi') c.phiMin = val;
    else c.swMax = val;
  };
  assign(pair.xVar, xVal);
  assign(pair.yVar, yVal);

  const permMin = hasPermCutoff(c) ? c.permMin : NaN;
  const kCut = Number.isFinite(permMin);
  let netRes = 0;
  let netPay = 0;
  let hphiShPay = 0;
  let noDataPay = 0;
  let resN = 0;
  let knownN = 0;

  for (const r of ranges) {
    for (let i = r.start; i < r.end; i++) {
      const h = thickness[i]!;
      if (!(h > 0) || !Number.isFinite(h)) continue;
      if (kCut) {
        const kv = perm ? perm[i]! : NaN;
        if (Number.isNaN(kv) || kv < permMin) continue;
      }
      const v = vsh[i]!;
      const p = phi[i]!;
      if (Number.isNaN(v) || v > c.vshMax || Number.isNaN(p) || p < c.phiMin) continue;
      netRes += h;
      resN++;
      const s = sw[i]!;
      if (Number.isNaN(s)) {
        noDataPay += h;
        continue;
      }
      knownN++;
      if (s <= c.swMax) {
        netPay += h;
        hphiShPay += h * p * (1 - s);
      }
    }
  }
  const unknown = resN > 0 && knownN === 0;
  return {
    netRes,
    netPay: unknown ? NaN : netPay,
    hphiShPay: unknown ? NaN : hphiShPay,
    noDataPay,
  };
}

/**
 * Evalúa exactamente la estabilidad local alrededor del par de cutoffs vigente en `cutoffs` sin error de grilla.
 */
export function assessStability2D(
  vsh: ArrayLike<number>,
  phi: ArrayLike<number>,
  sw: ArrayLike<number>,
  thickness: ArrayLike<number>,
  cutoffs: Cutoffs,
  pairId: SurfacePairId,
  ranges: readonly { start: number; end: number }[],
  xRange: { min: number; max: number },
  yRange: { min: number; max: number },
  metric: SurfaceMetricKey = 'netPay',
  perm?: ArrayLike<number>,
): StabilityAssessment {
  const pair = SURFACE_PAIRS.find((p) => p.id === pairId)!;
  const readCut = (v: SweepVariable) => (v === 'vsh' ? cutoffs.vshMax : v === 'phi' ? cutoffs.phiMin : cutoffs.swMax);
  const x0 = clampNum(readCut(pair.xVar), xRange.min, xRange.max);
  const y0 = clampNum(readCut(pair.yVar), yRange.min, yRange.max);
  const box = stabilityBox2D(pair, x0, y0, xRange, yRange);

  const center = evalCutoffPairPoint(vsh, phi, sw, thickness, cutoffs, pairId, x0, y0, ranges, perm)[metric];
  const corners = [
    evalCutoffPairPoint(vsh, phi, sw, thickness, cutoffs, pairId, box.xLow, box.yLow, ranges, perm)[metric],
    evalCutoffPairPoint(vsh, phi, sw, thickness, cutoffs, pairId, box.xHigh, box.yLow, ranges, perm)[metric],
    evalCutoffPairPoint(vsh, phi, sw, thickness, cutoffs, pairId, box.xLow, box.yHigh, ranges, perm)[metric],
    evalCutoffPairPoint(vsh, phi, sw, thickness, cutoffs, pairId, box.xHigh, box.yHigh, ranges, perm)[metric],
  ];
  return classifyStability2D(center, corners, box);
}
