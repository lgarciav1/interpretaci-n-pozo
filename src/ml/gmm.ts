/**
 * Mezcla gaussiana de covarianza diagonal ajustada con EM (Dempster, Laird y Rubin, 1977), inicializada con k-means,
 * regularizada y tolerante a NaN.
 *
 *   p(x) = Σ_j w_j · Π_d N(x_d; μ_jd, σ²_jd)
 *   E: r_ij = w_j p_j(x_i) / Σ_l w_l p_l(x_i)      (responsabilidades; log-sum-exp para estabilidad numérica)
 *   M: w_j = Σ_i r_ij / n_válidas;  μ_jd = Σ_i r_ij x_id / Σ_i r_ij;  σ²_jd = Σ_i r_ij (x_id − μ_jd)² / Σ_i r_ij + piso
 *
 * FALTANTES: con covarianza diagonal los NaN se marginalizan exactamente: la verosimilitud de una fila usa solo las
 * dimensiones observadas y el paso M promedia solo sobre las observaciones de cada dimensión (EM exacto para
 * faltantes al azar). Una fila sin dimensiones observadas es inválida: no entra al ajuste y su salida son los pesos
 * de la mezcla.
 *
 * REGULARIZACIÓN: piso `varFloor` (por defecto 1e-3, en unidades de los datos ESTANDARIZADOS) sumado a toda varianza;
 * evita los colapsos de verosimilitud infinita sobre un punto o una dimensión constante (Bishop 2006, §9.2.1). Un
 * componente cuyo peso efectivo cae bajo `minWeight`·n se reinicia sobre la fila peor explicada con las varianzas
 * globales. EMPATES: argmax con empate → menor índice. DETERMINISMO: toda aleatoriedad sale de la semilla.
 *
 * BIC = −2·logL + p·ln(n_válidas), con p = k·2d + (k − 1) parámetros libres (menor es mejor; Schwarz 1978).
 */

import { kmeans, validRows } from './kmeans.ts';

export interface GmmOptions {
  k: number;
  seed?: number;
  maxIter?: number;
  /** Cambio de log-verosimilitud media por muestra para dar por convergido (por defecto 1e-7). */
  tol?: number;
  /** Piso de varianza (unidades estandarizadas). */
  varFloor?: number;
  /** Peso mínimo de un componente (fracción de n) antes de reiniciarlo. */
  minWeight?: number;
  /** Reinicios del k-means inicial. */
  nInit?: number;
}

export interface GmmResult {
  labels: Int16Array;
  /** Responsabilidades n × k (filas suman 1). */
  responsibilities: Float32Array;
  weights: Float64Array;
  /** Medias k × d. */
  means: Float64Array;
  /** Varianzas diagonales k × d (incluyen el piso). */
  variances: Float64Array;
  logLikelihood: number;
  bic: number;
  iterations: number;
  converged: boolean;
  /** Filas válidas. */
  valid: Uint8Array;
  nValid: number;
}

const LOG_2PI = Math.log(2 * Math.PI);

/** log w_j + log N_obs(x_r | μ_j, σ²_j) para cada componente en `out`. */
function logJoint(Z: ArrayLike<number>, r: number, d: number, k: number, w: Float64Array, mu: Float64Array, v: Float64Array, out: Float64Array): void {
  for (let j = 0; j < k; j++) {
    let s = Math.log(Math.max(w[j]!, 1e-300));
    for (let t = 0; t < d; t++) {
      const x = Z[r * d + t]!;
      if (x === x) {
        const diff = x - mu[j * d + t]!;
        s -= 0.5 * (LOG_2PI + Math.log(v[j * d + t]!) + (diff * diff) / v[j * d + t]!);
      }
    }
    out[j] = s;
  }
}

function logSumExp(a: Float64Array, k: number): number {
  let max = -Infinity;
  for (let j = 0; j < k; j++) if (a[j]! > max) max = a[j]!;
  if (max === -Infinity) return -Infinity;
  let s = 0;
  for (let j = 0; j < k; j++) s += Math.exp(a[j]! - max);
  return max + Math.log(s);
}

/** Ajusta la mezcla. Z es n × d estandarizada (NaN permitido). */
export function gmm(Z: ArrayLike<number>, n: number, d: number, opts: GmmOptions): GmmResult {
  const k = opts.k;
  const { rows, mask } = validRows(Z, n, d);
  const m = rows.length;
  if (!(k >= 1) || !Number.isInteger(k)) throw new Error('k debe ser un entero ≥ 1.');
  if (m < k) throw new Error(`Hay ${m} filas válidas y se pidieron ${k} componentes.`);
  const varFloor = opts.varFloor ?? 1e-3;
  const minWeight = opts.minWeight ?? 1e-3;
  const maxIter = opts.maxIter ?? 200;
  const tol = opts.tol ?? 1e-7;

  // Varianza global por dimensión (para reinicios) y valores iniciales desde k-means.
  const globalVar = new Float64Array(d).fill(1);
  for (let t = 0; t < d; t++) {
    let s = 0;
    let s2 = 0;
    let c = 0;
    for (let q = 0; q < m; q++) {
      const x = Z[rows[q]! * d + t]!;
      if (x === x) {
        s += x;
        s2 += x * x;
        c++;
      }
    }
    if (c > 1) globalVar[t] = Math.max(s2 / c - (s / c) * (s / c), varFloor);
  }
  const km = kmeans(Z, n, d, { k, ...(opts.seed === undefined ? {} : { seed: opts.seed }), nInit: opts.nInit ?? 3 });
  const w = new Float64Array(k);
  const mu = Float64Array.from(km.centers);
  const v = new Float64Array(k * d);
  for (let c = 0; c < k; c++) w[c] = Math.max(km.counts[c]!, 1) / m;
  {
    const ssq = new Float64Array(k * d);
    const cnt = new Float64Array(k * d);
    for (let q = 0; q < m; q++) {
      const r = rows[q]!;
      const c = km.labels[r]!;
      for (let t = 0; t < d; t++) {
        const x = Z[r * d + t]!;
        if (x === x) {
          ssq[c * d + t]! += (x - mu[c * d + t]!) ** 2;
          cnt[c * d + t]!++;
        }
      }
    }
    for (let i = 0; i < k * d; i++) v[i] = (cnt[i]! > 1 ? ssq[i]! / cnt[i]! : globalVar[i % d]!) + varFloor;
  }

  const resp = new Float32Array(n * k);
  const lj = new Float64Array(k);
  const R = new Float64Array(m * k); // responsabilidades de filas válidas
  const sumR = new Float64Array(k);
  const sumRx = new Float64Array(k * d);
  const sumRobs = new Float64Array(k * d);
  const sumRxx = new Float64Array(k * d);
  let ll = -Infinity;
  let iterations = 0;
  let converged = false;

  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    // E
    let L = 0;
    const rowLL = new Float64Array(m);
    for (let q = 0; q < m; q++) {
      logJoint(Z, rows[q]!, d, k, w, mu, v, lj);
      const lse = logSumExp(lj, k);
      rowLL[q] = lse;
      L += lse;
      for (let c = 0; c < k; c++) R[q * k + c] = Math.exp(lj[c]! - lse);
    }
    // M
    sumR.fill(0);
    sumRx.fill(0);
    sumRobs.fill(0);
    sumRxx.fill(0);
    for (let q = 0; q < m; q++) {
      const r = rows[q]!;
      for (let c = 0; c < k; c++) {
        const g = R[q * k + c]!;
        sumR[c]! += g;
        for (let t = 0; t < d; t++) {
          const x = Z[r * d + t]!;
          if (x === x) {
            sumRx[c * d + t]! += g * x;
            sumRxx[c * d + t]! += g * x * x;
            sumRobs[c * d + t]! += g;
          }
        }
      }
    }
    let restarted = false;
    for (let c = 0; c < k; c++) {
      if (sumR[c]! < minWeight * m) {
        restarted = true;
        // Componente degenerado: se reinicia sobre la fila peor explicada (menor log-verosimilitud), una distinta por componente.
        let worst = 0;
        for (let q = 1; q < m; q++) if (rowLL[q]! < rowLL[worst]!) worst = q;
        const r = rows[worst]!;
        for (let t = 0; t < d; t++) {
          const x = Z[r * d + t]!;
          mu[c * d + t] = x === x ? x : 0;
          v[c * d + t] = globalVar[t]!;
        }
        w[c] = 1 / m;
        rowLL[worst] = Infinity;
        continue;
      }
      w[c] = sumR[c]! / m;
      for (let t = 0; t < d; t++) {
        const o = sumRobs[c * d + t]!;
        if (o > 1e-12) {
          const mean = sumRx[c * d + t]! / o;
          mu[c * d + t] = mean;
          v[c * d + t] = Math.max(sumRxx[c * d + t]! / o - mean * mean, 0) + varFloor;
        }
      }
    }
    // Renormaliza pesos (por los reinicios).
    let ws = 0;
    for (let c = 0; c < k; c++) ws += w[c]!;
    for (let c = 0; c < k; c++) w[c]! /= ws;

    // Una iteración con reinicio de componente cambia los parámetros de golpe: no cuenta para la convergencia.
    const delta = Math.abs(L - ll) / m;
    ll = L;
    if (!restarted && delta < tol) {
      converged = true;
      break;
    }
  }

  // Responsabilidades finales con los parámetros finales.
  let L = 0;
  const labels = new Int16Array(n);
  let big = 0;
  for (let c = 1; c < k; c++) if (w[c]! > w[big]!) big = c;
  for (let r = 0; r < n; r++) {
    if (!mask[r]) {
      for (let c = 0; c < k; c++) resp[r * k + c] = w[c]!;
      labels[r] = big;
      continue;
    }
    logJoint(Z, r, d, k, w, mu, v, lj);
    const lse = logSumExp(lj, k);
    L += lse;
    let best = 0;
    let bestP = -Infinity;
    for (let c = 0; c < k; c++) {
      const p = Math.exp(lj[c]! - lse);
      resp[r * k + c] = p;
      if (p > bestP) {
        bestP = p;
        best = c;
      }
    }
    labels[r] = best;
  }
  const nParams = k * 2 * d + (k - 1);
  return {
    labels,
    responsibilities: resp,
    weights: w,
    means: mu,
    variances: v,
    logLikelihood: L,
    bic: -2 * L + nParams * Math.log(m),
    iterations,
    converged,
    valid: mask,
    nValid: m,
  };
}
