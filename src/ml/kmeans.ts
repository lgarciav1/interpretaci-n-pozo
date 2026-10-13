/**
 * k-means con inicialización k-means++ (Arthur y Vassilvitskii, 2007) y semilla fija, tolerante a NaN.
 *
 * Datos: matriz fila a fila n × d (típicamente ya estandarizada). Un NaN es «sin dato»: la distancia de una fila a un
 * centro es la suma de cuadrados sobre las dimensiones OBSERVADAS de la fila, y el centro se actualiza con la media de
 * las observaciones disponibles en cada dimensión (equivale a suponer faltantes al azar). Una fila sin ninguna
 * dimensión observada es inválida: no participa del ajuste y se le asigna el cluster más poblado.
 *
 *   objetivo (inercia):  J = Σ_i Σ_{j observada} (x_ij − c_{z_i, j})²
 *
 * Empates: un punto equidistante de dos centros va al de menor índice. Cluster vacío durante las iteraciones: se
 * re-siembra con la fila (válida) más lejana de su centro, de forma determinística. Se ejecutan `nInit` reinicios con
 * semillas derivadas y se conserva el de menor inercia (empate → el primero).
 *
 * PSEUDO-PROBABILIDAD (k-means no es probabilístico): p_j(x) ∝ exp(−‖x−c_j‖²_obs / (2σ²)), con σ² la varianza común
 * por dimensión dentro de los clusters, σ² = J / (nº de valores observados). Son las responsabilidades de una mezcla
 * esférica de igual varianza y pesos iguales; sirven para ordenar la ambigüedad entre clusters, no como probabilidades
 * calibradas.
 */

import { deriveSeed, mulberry32, type Rng } from './rng.ts';

export interface KMeansOptions {
  k: number;
  seed?: number;
  /** Iteraciones máximas de Lloyd por reinicio. */
  maxIter?: number;
  /** Reinicios con k-means++ (por defecto 5). */
  nInit?: number;
  /** Cambio relativo de inercia por debajo del cual se detiene (por defecto 1e-8). */
  tol?: number;
}

export interface KMeansResult {
  /** Cluster de cada fila (0..k−1), en el orden original de los centros. */
  labels: Int16Array;
  /** Centros k × d fila a fila. */
  centers: Float64Array;
  /** Filas por cluster. */
  counts: Int32Array;
  inertia: number;
  /** Nº de valores observados (denominador de σ²). */
  nObserved: number;
  iterations: number;
  converged: boolean;
  /** 1 = fila con al menos una dimensión observada; 0 = inválida. */
  valid: Uint8Array;
}

/** Suma de cuadrados sobre dimensiones observadas de la fila r contra el centro c (offset c·d en `centers`). */
function sqDist(Z: ArrayLike<number>, r: number, centers: ArrayLike<number>, c: number, d: number): number {
  let s = 0;
  for (let j = 0; j < d; j++) {
    const x = Z[r * d + j]!;
    if (x === x) {
      const diff = x - centers[c * d + j]!;
      s += diff * diff;
    }
  }
  return s;
}

function rowIsValid(Z: ArrayLike<number>, r: number, d: number): boolean {
  for (let j = 0; j < d; j++) if (Z[r * d + j]! === Z[r * d + j]!) return true;
  return false;
}

/** Índices de las filas válidas y su máscara. */
export function validRows(Z: ArrayLike<number>, n: number, d: number): { rows: Int32Array; mask: Uint8Array } {
  const mask = new Uint8Array(n);
  let m = 0;
  for (let r = 0; r < n; r++) if (rowIsValid(Z, r, d)) mask[r] = 1, m++;
  const rows = new Int32Array(m);
  let a = 0;
  for (let r = 0; r < n; r++) if (mask[r]) rows[a++] = r;
  return { rows, mask };
}

/** Copia la fila r a un centro, reemplazando los NaN por 0 (media de los datos estandarizados). */
function seedCenter(Z: ArrayLike<number>, r: number, centers: Float64Array, c: number, d: number): void {
  for (let j = 0; j < d; j++) {
    const x = Z[r * d + j]!;
    centers[c * d + j] = x === x ? x : 0;
  }
}

/** Inicialización k-means++ sobre las filas válidas. */
export function kmeansPlusPlus(Z: ArrayLike<number>, rows: Int32Array, d: number, k: number, rng: Rng): Float64Array {
  const centers = new Float64Array(k * d);
  const m = rows.length;
  const minD = new Float64Array(m).fill(Infinity);
  seedCenter(Z, rows[Math.min(m - 1, Math.floor(rng() * m))]!, centers, 0, d);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < m; i++) {
      const dist = sqDist(Z, rows[i]!, centers, c - 1, d);
      if (dist < minD[i]!) minD[i] = dist;
      total += minD[i]!;
    }
    let pick = 0;
    if (total > 0) {
      const u = rng() * total;
      let accum = 0;
      for (let i = 0; i < m; i++) {
        accum += minD[i]!;
        if (accum > u) {
          pick = i;
          break;
        }
        pick = i;
      }
    } else {
      pick = Math.min(m - 1, Math.floor(rng() * m)); // datos degenerados (todos iguales)
    }
    seedCenter(Z, rows[pick]!, centers, c, d);
  }
  return centers;
}

function lloyd(Z: ArrayLike<number>, n: number, d: number, rows: Int32Array, init: Float64Array, k: number, maxIter: number, tol: number): KMeansResult {
  const centers = Float64Array.from(init);
  const labels = new Int16Array(n);
  const m = rows.length;
  const dist = new Float64Array(n);
  let inertia = Infinity;
  let iterations = 0;
  let converged = false;
  const sums = new Float64Array(k * d);
  const obs = new Int32Array(k * d);
  const counts = new Int32Array(k);

  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    // Asignación (empate → menor índice).
    let J = 0;
    for (let q = 0; q < m; q++) {
      const r = rows[q]!;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const s = sqDist(Z, r, centers, c, d);
        if (s < bestD) {
          bestD = s;
          best = c;
        }
      }
      labels[r] = best;
      dist[r] = bestD;
      J += bestD;
    }
    // Actualización.
    sums.fill(0);
    obs.fill(0);
    counts.fill(0);
    for (let q = 0; q < m; q++) {
      const r = rows[q]!;
      const c = labels[r]!;
      counts[c]!++;
      for (let j = 0; j < d; j++) {
        const x = Z[r * d + j]!;
        if (x === x) {
          sums[c * d + j]! += x;
          obs[c * d + j]!++;
        }
      }
    }
    for (let c = 0; c < k; c++) {
      if (counts[c]! === 0) {
        // Re-siembra determinística con la fila más lejana de su centro.
        let far = -1;
        let farD = -1;
        for (let q = 0; q < m; q++) {
          const r = rows[q]!;
          if (dist[r]! > farD) {
            farD = dist[r]!;
            far = r;
          }
        }
        if (far >= 0) {
          seedCenter(Z, far, centers, c, d);
          dist[far] = 0;
        }
        continue;
      }
      for (let j = 0; j < d; j++) if (obs[c * d + j]! > 0) centers[c * d + j] = sums[c * d + j]! / obs[c * d + j]!;
    }
    const rel = Number.isFinite(inertia) ? Math.abs(inertia - J) / Math.max(J, 1e-300) : Infinity;
    inertia = J;
    if (rel <= tol) {
      converged = true;
      break;
    }
  }
  // Asignación final consistente con los centros finales.
  let J = 0;
  counts.fill(0);
  let nObserved = 0;
  for (let q = 0; q < m; q++) {
    const r = rows[q]!;
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const s = sqDist(Z, r, centers, c, d);
      if (s < bestD) {
        bestD = s;
        best = c;
      }
    }
    labels[r] = best;
    counts[best]!++;
    J += bestD;
    for (let j = 0; j < d; j++) if (Z[r * d + j]! === Z[r * d + j]!) nObserved++;
  }
  const valid = new Uint8Array(n);
  for (let q = 0; q < m; q++) valid[rows[q]!] = 1;
  return { labels, centers, counts, inertia: J, nObserved, iterations, converged, valid };
}

/** Ejecuta k-means (k-means++ + Lloyd, `nInit` reinicios). */
export function kmeans(Z: ArrayLike<number>, n: number, d: number, opts: KMeansOptions): KMeansResult {
  const k = opts.k;
  const { rows } = validRows(Z, n, d);
  if (!(k >= 1) || !Number.isInteger(k)) throw new Error('k debe ser un entero ≥ 1.');
  if (rows.length < k) throw new Error(`Hay ${rows.length} filas válidas y se pidieron ${k} clusters.`);
  const nInit = Math.max(1, opts.nInit ?? 5);
  const seed = opts.seed ?? 1;
  let best: KMeansResult | null = null;
  for (let s = 0; s < nInit; s++) {
    const rng = mulberry32(deriveSeed(seed, s));
    const init = kmeansPlusPlus(Z, rows, d, k, rng);
    const res = lloyd(Z, n, d, rows, init, k, opts.maxIter ?? 100, opts.tol ?? 1e-8);
    if (!best || res.inertia < best.inertia) best = res;
  }
  const result = best!;
  // Filas inválidas: cluster más poblado.
  let big = 0;
  for (let c = 1; c < k; c++) if (result.counts[c]! > result.counts[big]!) big = c;
  for (let r = 0; r < n; r++) if (!result.valid[r]) result.labels[r] = big;
  return result;
}

/**
 * Pseudo-probabilidades de k-means (ver cabecera): n × k, cada fila suma 1. Filas inválidas → proporciones de cluster.
 */
export function kmeansPseudoProbabilities(Z: ArrayLike<number>, n: number, d: number, res: KMeansResult): Float32Array {
  const k = res.counts.length;
  const out = new Float32Array(n * k);
  const total = res.counts.reduce((s, c) => s + c, 0) || 1;
  const sigma2 = Math.max(res.nObserved > 0 ? res.inertia / res.nObserved : 1, 1e-12);
  const logp = new Float64Array(k);
  for (let r = 0; r < n; r++) {
    if (!res.valid[r]) {
      for (let c = 0; c < k; c++) out[r * k + c] = res.counts[c]! / total;
      continue;
    }
    let min = Infinity;
    for (let c = 0; c < k; c++) {
      logp[c] = sqDist(Z, r, res.centers, c, d);
      if (logp[c]! < min) min = logp[c]!;
    }
    let sum = 0;
    for (let c = 0; c < k; c++) {
      logp[c] = Math.exp(-(logp[c]! - min) / (2 * sigma2));
      sum += logp[c]!;
    }
    for (let c = 0; c < k; c++) out[r * k + c] = logp[c]! / sum;
  }
  return out;
}
