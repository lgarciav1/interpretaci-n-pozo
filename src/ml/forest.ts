/**
 * Random forest de clasificación (Breiman 2001) en TypeScript puro: entrenamiento por histogramas y árboles
 * compactos en arrays planos. Sin dependencias, sin DOM; corre en Web Worker y en Node.
 *
 * DISEÑO
 *  - Cada característica se cuantiza en hasta `maxBins` (≤ 254) clases por cuantiles (bordes en Float32). Un corte
 *    «x ≤ borde[b]» se guarda como el índice de bin `b` (1 byte). En inferencia cada valor se cuantiza UNA vez por
 *    característica y los árboles comparan bytes. El bin 255 es «sin dato».
 *  - FALTANTES: cada corte aprende hacia qué hijo van los NaN (el que da mejor impureza en entrenamiento; si el nodo
 *    no vio NaN en esa característica, hacia el hijo con más peso). No se imputa nada. Una fila con muy pocas
 *    características válidas devuelve la distribución a priori del entrenamiento (`predictForest` / `predictLithology`).
 *  - Impureza de Gini. Ganancia de un corte (ponderada):
 *        ΔI = Σ_c nL,c²/nL + Σ_c nR,c²/nR − Σ_c n_c²/n        (maximizar; equivale a minimizar la impureza hija)
 *    con n_c el conteo de la clase c en el nodo. Es N·G(padre) − N_L·G(L) − N_R·G(R) con G = 1 − Σ p_c².
 *  - Importancia MDI (mean decrease in impurity): suma de ΔI de los cortes de cada característica, normalizada por
 *    árbol y promediada entre árboles; el vector final suma 1 (Breiman et al. 1984; Louppe et al. 2013). Tiene sesgo
 *    conocido hacia características continuas con muchos cortes posibles: para decidir cuál curva importa, contrastar
 *    con la importancia por permutación (`importance.ts`).
 *  - Cada árbol entrena con una muestra con reemplazo de `sampleSize` filas, tomada con probabilidad proporcional al
 *    peso de muestreo de la fila (`rowWeight`: peso de clase × peso de confianza de la etiqueta). Los pesos entran
 *    solo por el muestreo; dentro del árbol todas las filas valen 1. Las probabilidades de las hojas son entonces las
 *    de la muestra ponderada, no la prevalencia real (ver decisión 0030).
 *  - Predicción: promedio de las probabilidades de hoja de todos los árboles.
 *
 * FORMATO DEL MODELO (arrays planos, árboles en preorden: hijo izquierdo = i+1, derecho = i + nodeRight[i])
 *   nodeFeature[i] : bits 0–6 = característica (0x7F = hoja), bit 7 = los NaN van a la izquierda
 *   nodeThreshold[i]: índice de bin del corte (hijo izquierdo si bin ≤ umbral)
 *   nodeRight[i]   : desplazamiento al hijo derecho (0 en hojas)
 *   leafClass/leafProb: de cada hoja, sus `leafTop` clases más probables (uint8) y sus probabilidades (uint8, suma 255
 *                    tras renormalizar entre ellas), en el orden en que aparecen las hojas. Guardar solo las T mejores
 *                    reduce 4× el tamaño; al promediar decenas de árboles, la probabilidad de las clases menores se
 *                    reconstruye con muy poco error.
 *
 * Referencias: Breiman, L. (2001), «Random forests», Machine Learning 45(1), 5–32. Breiman, Friedman, Olshen y
 * Stone (1984), «Classification and Regression Trees». Louppe et al. (2013), «Understanding variable importances
 * in forests of randomized trees», NIPS.
 */

import { deriveSeed, mulberry32, randInt, type Rng } from './rng.ts';

/** Bin reservado para «sin dato». */
export const MISSING_BIN = 255;
/** Valor de `nodeFeature` (bits 0–6) que marca una hoja. */
export const LEAF_FEATURE = 0x7f;
const MISS_LEFT_BIT = 0x80;

export interface ForestMeta {
  [key: string]: unknown;
}

export interface ForestModel {
  /** Versión del formato de arrays (también del binario serializado). */
  formatVersion: 1;
  /** Nombres de las características, en el orden de las columnas de X. */
  featureNames: string[];
  /** Código de cada clase (para litología, los códigos FORCE 2020). */
  classCodes: Int32Array;
  /** Distribución a priori de las clases en la muestra de entrenamiento ponderada (suma 1). */
  classPriors: Float32Array;
  /** Bordes de cuantización de cada característica (ascendentes). Bin de x = nº de bordes < x. */
  edges: Float32Array[];
  nodeFeature: Uint8Array;
  nodeThreshold: Uint8Array;
  nodeRight: Uint16Array;
  /** Clases guardadas por hoja (T). */
  leafTop: number;
  /** Índice del primer nodo de cada árbol; longitud nTrees + 1 (el último es el nº total de nodos). */
  treeStart: Uint32Array;
  /** Clases más probables de cada hoja (nLeaves × leafTop). */
  leafClass: Uint8Array;
  /** Sus probabilidades en 1/255 (nLeaves × leafTop). */
  leafProb: Uint8Array;
  /** Importancia MDI por característica, suma 1. */
  importance: Float32Array;
  /** Metadatos libres serializables a JSON (hiperparámetros, fuente, métricas...). */
  meta: ForestMeta;
}

export interface ForestOptions {
  /** Nº de árboles. */
  nTrees: number;
  /** Profundidad máxima (la raíz tiene profundidad 0). */
  maxDepth: number;
  /** Mínimo de filas de la muestra del árbol en cada hoja. */
  minSamplesLeaf: number;
  /** Características probadas en cada nodo (por defecto ⌈√d⌉). */
  mtry?: number;
  /** Filas por árbol (muestra con reemplazo). Por defecto min(n, 100 000). */
  sampleSize?: number;
  /** Bins máximos por característica (≤ 254). Por defecto 64. */
  maxBins?: number;
  /** Clases guardadas por hoja (por defecto 3, máximo K). */
  leafTop?: number;
  /**
   * Las filas con menos de este nº de características finitas NO se usan para entrenar (por defecto 2): en inferencia
   * esas filas reciben la distribución a priori (ver `PredictOptions.minValidFeatures`), así que no hay nada que aprender.
   */
  minValidFeatures?: number;
  /** Ganancia mínima relativa al peso del nodo raíz para aceptar un corte. */
  minGain?: number;
  seed?: number;
  /** Metadatos a guardar en el modelo. */
  meta?: ForestMeta;
}

export interface TrainingMatrix {
  /** Características fila a fila (n × d), NaN = sin dato. */
  X: ArrayLike<number>;
  n: number;
  d: number;
  featureNames: readonly string[];
  /** Clase de cada fila: entero en [0, K). */
  y: ArrayLike<number>;
  /** Códigos de las K clases. */
  classCodes: ArrayLike<number>;
  /** Peso de muestreo por fila (≥ 0); por defecto 1. */
  rowWeight?: ArrayLike<number>;
  /** Subconjunto de filas a usar (índices en X); por defecto todas. */
  rows?: ArrayLike<number>;
}

/** Bordes de cuantización por cuantiles de los valores finitos (muestrea hasta 200 000 valores por columna). */
export function computeBinEdges(
  X: ArrayLike<number>,
  rows: ArrayLike<number>,
  d: number,
  maxBins: number,
): Float32Array[] {
  if (maxBins < 2 || maxBins > 254) throw new Error('maxBins debe estar entre 2 y 254.');
  const m = rows.length;
  const stride = Math.max(1, Math.floor(m / 200000));
  const edges: Float32Array[] = [];
  for (let j = 0; j < d; j++) {
    const buf = new Float32Array(Math.ceil(m / stride));
    let c = 0;
    for (let k = 0; k < m; k += stride) {
      const v = X[rows[k]! * d + j]!;
      if (Number.isFinite(v)) buf[c++] = v;
    }
    const sorted = buf.subarray(0, c).sort();
    const out: number[] = [];
    const push = (v: number) => {
      const f = Math.fround(v);
      if (out.length === 0 || f > out[out.length - 1]!) out.push(f);
    };
    if (c > 0) {
      // Valores distintos; si caben en maxBins, un borde por valor (menos el último): cortes exactos.
      const distinct: number[] = [];
      for (let k = 0; k < c; k++) if (k === 0 || sorted[k] !== sorted[k - 1]) distinct.push(sorted[k]!);
      if (distinct.length <= maxBins) {
        for (let k = 0; k < distinct.length - 1; k++) push(distinct[k]!);
      } else {
        for (let b = 1; b < maxBins; b++) push(sorted[Math.min(c - 1, Math.floor((b * c) / maxBins))]!);
        // El último valor no puede ser borde (su bin quedaría vacío a la derecha).
        const last = Math.fround(sorted[c - 1]!);
        while (out.length > 0 && out[out.length - 1]! >= last) out.pop();
      }
    }
    edges.push(Float32Array.from(out));
  }
  return edges;
}

/** Bin de x: nº de bordes estrictamente menores que x (búsqueda binaria); MISSING_BIN si x no es finito. */
export function binOf(edges: Float32Array, x: number): number {
  if (!Number.isFinite(x)) return MISSING_BIN;
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (edges[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface TreeOut {
  feature: number[];
  threshold: number[];
  right: number[];
  /** Por hoja: T clases seguidas de T probabilidades (uint8). */
  leaves: Uint8Array[];
  gain: Float64Array;
}

/**
 * Hoja → sus `top` clases más frecuentes (empate → índice menor) con probabilidades renormalizadas entre ellas y
 * cuantizadas a 1/255 con suma exacta 255 (el redondeo se carga en la clase dominante). Devuelve [clases..., probs...].
 */
function quantizeLeaf(counts: Float64Array, K: number, top: number): Uint8Array {
  const order = Array.from({ length: K }, (_, c) => c).sort((a, b) => counts[b]! - counts[a]! || a - b);
  let kept = 0;
  for (let t = 0; t < top; t++) kept += counts[order[t]!]!;
  const out = new Uint8Array(2 * top);
  let sum = 0;
  for (let t = 0; t < top; t++) {
    const c = order[t]!;
    out[t] = c;
    out[top + t] = kept > 0 ? Math.round((counts[c]! / kept) * 255) : 0;
    sum += out[top + t]!;
  }
  out[top] = out[top]! + (255 - sum);
  return out;
}

/**
 * Entrena un random forest. Determinístico para la misma entrada y semilla. Lanza error si no hay filas, si el
 * número de clases es 0 o si un árbol necesita más de 65 535 nodos de distancia al hijo derecho (subir
 * `minSamplesLeaf` o bajar `sampleSize`).
 */
export function trainRandomForest(data: TrainingMatrix, opts: ForestOptions): ForestModel {
  const { X, d, y } = data;
  const K = data.classCodes.length;
  const candidate = data.rows ?? Int32Array.from({ length: data.n }, (_, i) => i);
  const minValidTrain = opts.minValidFeatures ?? 2;
  const keep: number[] = [];
  for (let q = 0; q < candidate.length; q++) {
    const r = candidate[q]!;
    let valid = 0;
    for (let j = 0; j < d; j++) if (Number.isFinite(X[r * d + j]!)) valid++;
    if (valid >= Math.min(minValidTrain, d)) keep.push(r);
  }
  const rowsAll = Int32Array.from(keep);
  const m = rowsAll.length;
  if (m === 0) throw new Error('No hay filas de entrenamiento.');
  if (K < 1) throw new Error('No hay clases.');
  const maxBins = opts.maxBins ?? 64;
  const minLeaf = Math.max(1, opts.minSamplesLeaf);
  const mtry = Math.min(d, Math.max(1, opts.mtry ?? Math.ceil(Math.sqrt(d))));
  const sampleSize = Math.max(1, opts.sampleSize ?? Math.min(m, 100000));
  const seed = opts.seed ?? 1;
  const minGain = opts.minGain ?? 1e-7;
  const leafTop = Math.min(K, Math.max(1, opts.leafTop ?? 3));

  // Datos locales del subconjunto: etiquetas, bins en columna mayor (cache-friendly para histogramas).
  const edges = computeBinEdges(X, rowsAll, d, maxBins);
  const bins = new Uint8Array(d * m);
  const yLocal = new Uint8Array(m);
  const priorCounts = new Float64Array(K);
  const cum = new Float64Array(m);
  let acc = 0;
  for (let i = 0; i < m; i++) {
    const r = rowsAll[i]!;
    for (let j = 0; j < d; j++) bins[j * m + i] = binOf(edges[j]!, X[r * d + j]!);
    const cls = y[r]!;
    if (!(cls >= 0 && cls < K)) throw new Error(`Clase fuera de rango en la fila ${r}.`);
    yLocal[i] = cls;
    const w = data.rowWeight ? Math.max(0, data.rowWeight[r]!) : 1;
    acc += w;
    cum[i] = acc;
    priorCounts[cls]! += w;
  }
  if (acc <= 0) throw new Error('La suma de pesos de muestreo es 0.');
  const priors = new Float32Array(K);
  let priorSum = 0;
  for (let c = 0; c < K; c++) priorSum += priorCounts[c]!;
  for (let c = 0; c < K; c++) priors[c] = priorCounts[c]! / priorSum;

  const maxSlots = Math.max(...edges.map(e => e.length + 1)) + 1; // +1: ranura de faltantes
  const hist = new Float64Array(maxSlots * K);
  const cnt = new Int32Array(maxSlots);
  const nodeCounts = new Float64Array(K);
  const featOrder = Int32Array.from({ length: d }, (_, j) => j);

  const trees: TreeOut[] = [];
  const importance = new Float64Array(d);

  for (let t = 0; t < opts.nTrees; t++) {
    const rng: Rng = mulberry32(deriveSeed(seed, t));
    // Cada árbol parte del mismo orden de características: su resultado no depende de los árboles previos.
    for (let j = 0; j < d; j++) featOrder[j] = j;
    // Muestra con reemplazo proporcional al peso.
    const idx = new Int32Array(sampleSize);
    for (let s = 0; s < sampleSize; s++) {
      const u = rng() * acc;
      let lo = 0;
      let hi = m - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cum[mid]! <= u) lo = mid + 1;
        else hi = mid;
      }
      idx[s] = lo;
    }
    const out: TreeOut = { feature: [], threshold: [], right: [], leaves: [], gain: new Float64Array(d) };

    const build = (lo: number, hi: number, depth: number): void => {
      const n = hi - lo;
      nodeCounts.fill(0);
      for (let i = lo; i < hi; i++) nodeCounts[yLocal[idx[i]!]!]! += 1;
      let maxC = 0;
      for (let c = 0; c < K; c++) if (nodeCounts[c]! > maxC) maxC = nodeCounts[c]!;
      const makeLeaf = () => {
        out.feature.push(LEAF_FEATURE);
        out.threshold.push(0);
        out.right.push(0);
        out.leaves.push(quantizeLeaf(nodeCounts, K, leafTop));
      };
      if (depth >= opts.maxDepth || n < 2 * minLeaf || maxC === n) return makeLeaf();

      let parentScore = 0;
      for (let c = 0; c < K; c++) parentScore += nodeCounts[c]! * nodeCounts[c]!;
      parentScore /= n;

      let bestGain = 0;
      let bestF = -1;
      let bestBin = 0;
      let bestMissLeft = false;
      let tried = 0;
      // Selección parcial de mtry características; si ninguna da corte válido, sigue con las restantes.
      for (let k = 0; k < d; k++) {
        if (tried >= mtry && bestF >= 0) break;
        const pick = k + randInt(rng, d - k);
        const f = featOrder[pick]!;
        featOrder[pick] = featOrder[k]!;
        featOrder[k] = f;
        tried++;

        const nb = edges[f]!.length + 1;
        const slots = nb + 1;
        hist.fill(0, 0, slots * K);
        cnt.fill(0, 0, slots);
        const base = f * m;
        for (let i = lo; i < hi; i++) {
          const r = idx[i]!;
          const b = bins[base + r]!;
          const slot = b === MISSING_BIN ? nb : b;
          hist[slot * K + yLocal[r]!]! += 1;
          cnt[slot]! += 1;
        }
        const missCnt = cnt[nb]!;
        // Barrido: izquierda acumulada L (bins ≤ b), faltantes M, derecha = total − L − M.
        const L = new Float64Array(K);
        let nL = 0;
        for (let b = 0; b < nb - 1; b++) {
          for (let c = 0; c < K; c++) L[c]! += hist[b * K + c]!;
          nL += cnt[b]!;
          if (cnt[b]! === 0) continue;
          const variants = missCnt > 0 ? 2 : 1;
          for (let v = 0; v < variants; v++) {
            const missLeft = v === 0;
            const leftN = nL + (missLeft ? missCnt : 0);
            const rightN = n - leftN;
            if (leftN < minLeaf || rightN < minLeaf) continue;
            let sL = 0;
            let sR = 0;
            for (let c = 0; c < K; c++) {
              const lc = L[c]! + (missLeft ? hist[nb * K + c]! : 0);
              const rc = nodeCounts[c]! - lc;
              sL += lc * lc;
              sR += rc * rc;
            }
            const gain = sL / leftN + sR / rightN - parentScore;
            if (gain > bestGain + 1e-12) {
              bestGain = gain;
              bestF = f;
              bestBin = b;
              bestMissLeft = missLeft;
            }
          }
        }
      }
      if (bestF < 0 || bestGain < minGain * sampleSize) return makeLeaf();

      // Partición in situ: izquierda primero.
      const base = bestF * m;
      let i = lo;
      let j = hi - 1;
      let leftCount = 0;
      let missingSeen = 0;
      while (i <= j) {
        const b = bins[base + idx[i]!]!;
        const goLeft = b === MISSING_BIN ? bestMissLeft : b <= bestBin;
        if (b === MISSING_BIN) missingSeen++;
        if (goLeft) {
          i++;
          leftCount++;
        } else {
          const tmp = idx[i]!;
          idx[i] = idx[j]!;
          idx[j] = tmp;
          j--;
        }
      }
      // Sin faltantes en este nodo: los NaN futuros van al hijo con más filas.
      if (missingSeen === 0) bestMissLeft = leftCount >= n - leftCount;
      out.gain[bestF]! += bestGain;

      const nodeIndex = out.feature.length;
      out.feature.push(bestF | (bestMissLeft ? MISS_LEFT_BIT : 0));
      out.threshold.push(bestBin);
      out.right.push(0);
      build(lo, lo + leftCount, depth + 1);
      out.right[nodeIndex] = out.feature.length - nodeIndex;
      build(lo + leftCount, hi, depth + 1);
    };
    build(0, sampleSize, 0);
    trees.push(out);

    let g = 0;
    for (let f = 0; f < d; f++) g += out.gain[f]!;
    if (g > 0) for (let f = 0; f < d; f++) importance[f]! += out.gain[f]! / g;
  }

  // Ensamble en arrays planos.
  let nNodes = 0;
  let nLeaves = 0;
  for (const tr of trees) {
    nNodes += tr.feature.length;
    nLeaves += tr.leaves.length;
  }
  const nodeFeature = new Uint8Array(nNodes);
  const nodeThreshold = new Uint8Array(nNodes);
  const nodeRight = new Uint16Array(nNodes);
  const treeStart = new Uint32Array(trees.length + 1);
  const leafClass = new Uint8Array(nLeaves * leafTop);
  const leafProb = new Uint8Array(nLeaves * leafTop);
  let at = 0;
  let leafAt = 0;
  trees.forEach((tr, t) => {
    treeStart[t] = at;
    for (let i = 0; i < tr.feature.length; i++) {
      if (tr.right[i]! > 65535) throw new Error('Un árbol es demasiado grande para el formato (subí minSamplesLeaf).');
      nodeFeature[at + i] = tr.feature[i]!;
      nodeThreshold[at + i] = tr.threshold[i]!;
      nodeRight[at + i] = tr.right[i]!;
    }
    at += tr.feature.length;
    for (const leaf of tr.leaves) {
      leafClass.set(leaf.subarray(0, leafTop), leafAt * leafTop);
      leafProb.set(leaf.subarray(leafTop), leafAt * leafTop);
      leafAt++;
    }
  });
  treeStart[trees.length] = at;

  let impSum = 0;
  for (let f = 0; f < d; f++) impSum += importance[f]!;
  const imp = new Float32Array(d);
  if (impSum > 0) for (let f = 0; f < d; f++) imp[f] = importance[f]! / impSum;

  return {
    formatVersion: 1,
    featureNames: [...data.featureNames],
    classCodes: Int32Array.from(data.classCodes),
    classPriors: priors,
    edges,
    nodeFeature,
    nodeThreshold,
    nodeRight,
    leafTop,
    treeStart,
    leafClass,
    leafProb,
    importance: imp,
    meta: { ...(opts.meta ?? {}), nTrees: trees.length, maxDepth: opts.maxDepth, minSamplesLeaf: minLeaf, mtry, sampleSize, maxBins, leafTop, seed, nTrainRows: m, nDroppedRows: candidate.length - m },
  };
}

export interface ForestPrediction {
  /** Probabilidades n × K fila a fila; cada fila suma 1 (hasta redondeo Float32). */
  probabilities: Float32Array;
  n: number;
  nClasses: number;
  /** 1 si la fila tenía al menos `minValidFeatures` características con dato; 0 si se devolvió la distribución a priori. */
  valid: Uint8Array;
}

export interface PredictOptions {
  /** Mínimo de características con dato para predecir con los árboles (por defecto 2); si no, a priori. */
  minValidFeatures?: number;
}

const leafIndexCache = new WeakMap<ForestModel, Uint32Array>();

/** Índice en `leafProb` de cada nodo hoja (preorden = orden de la tabla de hojas). Se cachea por modelo. */
function leafIndexTable(model: ForestModel): Uint32Array {
  let table = leafIndexCache.get(model);
  if (!table) {
    table = new Uint32Array(model.nodeFeature.length);
    let li = 0;
    for (let i = 0; i < model.nodeFeature.length; i++) {
      if ((model.nodeFeature[i]! & 0x7f) === LEAF_FEATURE) table[i] = li++;
    }
    leafIndexCache.set(model, table);
  }
  return table;
}

/** Cantidad de hojas de un modelo. */
export function leafCount(model: ForestModel): number {
  return model.leafProb.length / model.leafTop;
}

/**
 * Predice las probabilidades de clase de n filas (n × d, fila a fila, NaN = sin dato) como promedio de las
 * probabilidades de las hojas de todos los árboles. No muta la entrada. Filas con menos de `minValidFeatures`
 * valores finitos devuelven la distribución a priori del entrenamiento (nunca NaN).
 */
export function predictForest(
  model: ForestModel,
  X: ArrayLike<number>,
  n: number,
  opts: PredictOptions = {},
): ForestPrediction {
  const d = model.featureNames.length;
  const K = model.classCodes.length;
  const nTrees = model.treeStart.length - 1;
  const minValid = opts.minValidFeatures ?? 2;
  if (X.length < n * d) throw new Error(`X tiene ${X.length} valores; se esperaban ${n * d} (n × d).`);
  const probabilities = new Float32Array(n * K);
  const valid = new Uint8Array(n);
  const rowBins = new Uint8Array(d);
  const acc = new Float64Array(K);
  const { nodeFeature, nodeThreshold, nodeRight, treeStart, leafClass, leafProb, leafTop } = model;

  const leafIndexOf = leafIndexTable(model);

  for (let r = 0; r < n; r++) {
    let nValid = 0;
    for (let j = 0; j < d; j++) {
      const b = binOf(model.edges[j]!, Math.fround(X[r * d + j]!));
      rowBins[j] = b;
      if (b !== MISSING_BIN) nValid++;
    }
    const out = r * K;
    if (nValid < minValid) {
      for (let c = 0; c < K; c++) probabilities[out + c] = model.classPriors[c]!;
      continue;
    }
    valid[r] = 1;
    acc.fill(0);
    for (let t = 0; t < nTrees; t++) {
      let i = treeStart[t]!;
      for (;;) {
        const nf = nodeFeature[i]!;
        const f = nf & 0x7f;
        if (f === LEAF_FEATURE) break;
        const b = rowBins[f]!;
        const left = b === MISSING_BIN ? (nf & MISS_LEFT_BIT) !== 0 : b <= nodeThreshold[i]!;
        i = left ? i + 1 : i + nodeRight[i]!;
      }
      const base = leafIndexOf[i]! * leafTop;
      for (let q = 0; q < leafTop; q++) acc[leafClass[base + q]!]! += leafProb[base + q]!;
    }
    let sum = 0;
    for (let c = 0; c < K; c++) sum += acc[c]!;
    for (let c = 0; c < K; c++) probabilities[out + c] = acc[c]! / sum;
  }
  return { probabilities, n, nClasses: K, valid };
}

/** Clase ganadora (argmax; empate → índice menor) y su probabilidad para cada fila de una matriz n × K. */
export function argmaxRows(probabilities: ArrayLike<number>, n: number, K: number): { classIndex: Int16Array; confidence: Float32Array } {
  const classIndex = new Int16Array(n);
  const confidence = new Float32Array(n);
  for (let r = 0; r < n; r++) {
    let best = 0;
    let bestP = -Infinity;
    for (let c = 0; c < K; c++) {
      const p = probabilities[r * K + c]!;
      if (p > bestP) {
        bestP = p;
        best = c;
      }
    }
    classIndex[r] = best;
    confidence[r] = bestP;
  }
  return { classIndex, confidence };
}
