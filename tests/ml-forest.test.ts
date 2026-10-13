import { describe, expect, it } from 'vitest';
import { argmaxRows, binOf, computeBinEdges, leafCount, predictForest, trainRandomForest, type ForestModel, type TrainingMatrix } from '../src/ml/forest';
import { base64ToBytes, bytesToBase64, decodeModelText, deserializeModel, encodeModelText, serializeModel } from '../src/ml/serialize';
import { permutationImportance } from '../src/ml/importance';
import { mulberry32, randNormal } from '../src/ml/rng';
import { LEAF_FEATURE } from '../src/ml/forest';

/** Datos sintéticos con regla de decisión conocida. Columnas: x0, x1 informativas; x2, x3 ruido. */
function ruleData(n: number, seed: number, rule: (x0: number, x1: number) => number, K: number): TrainingMatrix {
  const rng = mulberry32(seed);
  const d = 4;
  const X = new Float32Array(n * d);
  const y = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) X[i * d + j] = rng();
    y[i] = rule(X[i * d]!, X[i * d + 1]!);
  }
  return { X, n, d, featureNames: ['x0', 'x1', 'noise1', 'noise2'], y, classCodes: Array.from({ length: K }, (_, c) => c * 10) };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

const opts = { nTrees: 30, maxDepth: 10, minSamplesLeaf: 5, sampleSize: 3000, seed: 7 };

function accuracy(model: ForestModel, data: TrainingMatrix): number {
  const p = predictForest(model, data.X, data.n);
  const { classIndex } = argmaxRows(p.probabilities, data.n, model.classCodes.length);
  let ok = 0;
  for (let i = 0; i < data.n; i++) if (classIndex[i] === data.y[i]) ok++;
  return ok / data.n;
}

describe('Random forest: aprende reglas de decisión conocidas', () => {
  it('regla por umbrales (3 clases) con ruido en las demás columnas', () => {
    // clase 0 si x0 < 0,3; clase 1 si x0 ≥ 0,3 y x1 < 0,6; clase 2 en el resto. Cota teórica: 100 % (sin ruido de etiqueta).
    const rule = (x0: number, x1: number) => (x0 < 0.3 ? 0 : x1 < 0.6 ? 1 : 2);
    const train = ruleData(4000, 1, rule, 3);
    const test = ruleData(2000, 2, rule, 3);
    const model = trainRandomForest(train, opts);
    // Los cortes quedan en bordes de bin: el error esperado es del orden del ancho de bin (1/64 por eje).
    expect(accuracy(model, test)).toBeGreaterThan(0.97);
  });

  it('XOR: solo se resuelve con interacción entre x0 y x1', () => {
    const xor = (x0: number, x1: number) => ((x0 > 0.5 ? 1 : 0) ^ (x1 > 0.5 ? 1 : 0));
    const train = ruleData(5000, 3, xor, 2);
    const test = ruleData(2000, 4, xor, 2);
    const model = trainRandomForest(train, { ...opts, mtry: 2, maxDepth: 8 });
    expect(accuracy(model, test)).toBeGreaterThan(0.95);
    // Cada variable por separado no separa nada (50 %): ambas deben tener importancia y el ruido casi nada.
    const imp = model.importance;
    expect(imp[0]! + imp[1]!).toBeGreaterThan(0.9);
  });

  it('las probabilidades suman 1, no hay NaN y la confianza es la probabilidad máxima', () => {
    const rule = (x0: number) => (x0 < 0.5 ? 0 : 1);
    const train = ruleData(2000, 5, rule, 2);
    const model = trainRandomForest(train, opts);
    const test = ruleData(500, 6, rule, 2);
    const p = predictForest(model, test.X, test.n);
    const { confidence } = argmaxRows(p.probabilities, test.n, 2);
    for (let i = 0; i < test.n; i++) {
      const a = p.probabilities[2 * i]!;
      const b = p.probabilities[2 * i + 1]!;
      expect(a + b).toBeCloseTo(1, 5);
      expect(Number.isNaN(a) || Number.isNaN(b)).toBe(false);
      expect(confidence[i]).toBeCloseTo(Math.max(a, b), 6);
    }
  });
});

describe('Random forest: determinismo y serialización', () => {
  const rule = (x0: number, x1: number) => (x0 < 0.3 ? 0 : x1 < 0.6 ? 1 : 2);
  const data = ruleData(3000, 11, rule, 3);

  it('misma semilla → mismos bytes; otra semilla → distinto', () => {
    const a = serializeModel(trainRandomForest(data, opts));
    const b = serializeModel(trainRandomForest(data, opts));
    const c = serializeModel(trainRandomForest(data, { ...opts, seed: 8 }));
    expect(sameBytes(a, b)).toBe(true);
    expect(sameBytes(a, c)).toBe(false);
  });

  it('ida y vuelta binaria idéntica: bytes y predicciones', () => {
    const model = trainRandomForest(data, { ...opts, meta: { fuente: 'prueba' } });
    const bytes = serializeModel(model);
    const back = deserializeModel(bytes);
    expect(sameBytes(serializeModel(back), bytes)).toBe(true);
    expect(back.meta).toEqual(model.meta);
    expect(back.featureNames).toEqual(model.featureNames);
    expect(Array.from(back.importance)).toEqual(Array.from(model.importance));
    const test = ruleData(300, 12, rule, 3);
    const p1 = predictForest(model, test.X, test.n).probabilities;
    const p2 = predictForest(back, test.X, test.n).probabilities;
    expect(Array.from(p2)).toEqual(Array.from(p1));
  });

  it('ida y vuelta por texto (zlib + base64) idéntica', () => {
    const model = trainRandomForest(data, opts);
    const text = encodeModelText(model);
    expect(/^[A-Za-z0-9+/]+=*$/.test(text)).toBe(true);
    const back = decodeModelText(text);
    expect(sameBytes(serializeModel(back), serializeModel(model))).toBe(true);
  });

  it('base64 propio coincide con el de Node y rechaza basura', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37 + 11) % 256);
    const reference = btoa(String.fromCharCode(...bytes));
    expect(bytesToBase64(bytes)).toBe(reference);
    expect(Array.from(base64ToBytes(reference))).toEqual(Array.from(bytes));
    expect(() => base64ToBytes('@@@@')).toThrow();
  });

  it('rechaza bytes que no son un modelo', () => {
    expect(() => deserializeModel(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/magia/);
    const bytes = serializeModel(trainRandomForest(data, { ...opts, nTrees: 2 }));
    expect(() => deserializeModel(bytes.subarray(0, bytes.length - 40))).toThrow(/truncado/);
  });

  it('entrenar con `rows` ignora por completo las demás filas (sin fuga)', () => {
    const rows = Int32Array.from({ length: 1500 }, (_, i) => i * 2); // filas pares
    const altered: TrainingMatrix = { ...data, X: Float32Array.from(data.X as Float32Array), y: Int16Array.from(data.y as Int16Array) };
    for (let i = 1; i < data.n; i += 2) {
      for (let j = 0; j < data.d; j++) (altered.X as Float32Array)[i * data.d + j] = 1e6 * (j + 1); // valores absurdos en filas ajenas
      (altered.y as Int16Array)[i] = 2;
    }
    const a = serializeModel(trainRandomForest({ ...data, rows }, opts));
    const b = serializeModel(trainRandomForest({ ...altered, rows }, opts));
    expect(sameBytes(a, b)).toBe(true);
  });
});

describe('Random forest: datos faltantes (NaN)', () => {
  it('un bosque entrenado con NaN aleatorios sigue prediciendo bien y sin NaN en la salida', () => {
    const rule = (x0: number, x1: number) => (x0 < 0.3 ? 0 : x1 < 0.6 ? 1 : 2);
    const train = ruleData(5000, 21, rule, 3);
    const rng = mulberry32(99);
    for (let i = 0; i < train.n; i++) for (let j = 0; j < 4; j++) if (rng() < 0.15) (train.X as Float32Array)[i * 4 + j] = NaN;
    const model = trainRandomForest(train, opts);
    // Prueba con datos completos: la regla se aprendió a pesar de los faltantes del entrenamiento.
    const test = ruleData(2000, 22, rule, 3);
    expect(accuracy(model, test)).toBeGreaterThan(0.9);
    // Prueba con NaN: ningún NaN en las probabilidades.
    for (let i = 0; i < test.n; i++) if (rng() < 0.3) (test.X as Float32Array)[i * 4 + (i % 4)] = NaN;
    const p = predictForest(model, test.X, test.n);
    expect(Array.from(p.probabilities).some(Number.isNaN)).toBe(false);
  });

  it('el faltante puede ser informativo: el corte aprende su dirección', () => {
    // x0 ausente ⇒ clase 1 siempre; si está presente, clase 0 (x0 no discrimina nada más).
    const n = 3000;
    const rng = mulberry32(31);
    const d = 2;
    const X = new Float32Array(n * d);
    const y = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const missing = rng() < 0.4;
      X[i * d] = missing ? NaN : rng();
      X[i * d + 1] = rng();
      y[i] = missing ? 1 : 0;
    }
    const model = trainRandomForest({ X, n, d, featureNames: ['a', 'b'], y, classCodes: [0, 1] }, { ...opts, mtry: 2, minValidFeatures: 1 });
    const probe = new Float32Array([NaN, 0.5, 0.3, 0.5]);
    const p = predictForest(model, probe, 2, { minValidFeatures: 1 });
    expect(p.probabilities[1]).toBeGreaterThan(0.95); // NaN → clase 1
    expect(p.probabilities[2]).toBeGreaterThan(0.95); // dato presente → clase 0
  });

  it('filas con menos de minValidFeatures valores finitos reciben la distribución a priori y valid = 0', () => {
    const rule = (x0: number) => (x0 < 0.7 ? 0 : 1);
    const train = ruleData(2000, 41, rule, 2);
    const model = trainRandomForest(train, opts);
    const X = new Float32Array([NaN, NaN, NaN, NaN, 0.1, NaN, NaN, NaN, 0.1, 0.2, 0.3, 0.4]);
    const p = predictForest(model, X, 3);
    expect(Array.from(p.valid)).toEqual([0, 0, 1]);
    expect(p.probabilities[0]).toBeCloseTo(model.classPriors[0]!, 6);
    expect(p.probabilities[1]).toBeCloseTo(model.classPriors[1]!, 6);
    expect(Array.from(p.probabilities).some(Number.isNaN)).toBe(false);
    const strict = predictForest(model, X, 3, { minValidFeatures: 1 });
    expect(Array.from(strict.valid)).toEqual([0, 1, 1]);
  });

  it('las filas con menos de minValidFeatures características finitas no se usan para entrenar', () => {
    const rule = (x0: number) => (x0 < 0.5 ? 0 : 1);
    const train = ruleData(1000, 55, rule, 2);
    const X = train.X as Float32Array;
    for (let i = 0; i < 100; i++) for (let j = 0; j < 4; j++) if (j !== 0) X[i * 4 + j] = NaN; // 100 filas con solo x0
    for (let i = 100; i < 130; i++) for (let j = 0; j < 4; j++) X[i * 4 + j] = NaN; // 30 filas sin nada
    const model = trainRandomForest(train, { ...opts, nTrees: 3 });
    expect(model.meta.nDroppedRows).toBe(130);
    expect(model.meta.nTrainRows).toBe(870);
    expect(trainRandomForest(train, { ...opts, nTrees: 3, minValidFeatures: 1 }).meta.nDroppedRows).toBe(30);
  });

  it('una característica toda NaN no rompe el entrenamiento ni la predicción', () => {
    const rule = (x0: number) => (x0 < 0.5 ? 0 : 1);
    const train = ruleData(1500, 51, rule, 2);
    for (let i = 0; i < train.n; i++) (train.X as Float32Array)[i * 4 + 3] = NaN;
    const model = trainRandomForest(train, opts);
    expect(accuracy(model, train)).toBeGreaterThan(0.97);
  });

  it('rechaza una matriz demasiado corta', () => {
    const train = ruleData(500, 61, x => (x < 0.5 ? 0 : 1), 2);
    const model = trainRandomForest(train, { ...opts, nTrees: 2 });
    expect(() => predictForest(model, new Float32Array(7), 2)).toThrow();
  });
});

describe('Random forest: importancia de variables', () => {
  const rule = (x0: number) => (x0 < 0.5 ? 0 : 1);
  const train = ruleData(4000, 71, rule, 2);
  const model = trainRandomForest(train, opts);

  it('MDI: la variable informativa pesa mucho más que el ruido y el vector suma 1', () => {
    const imp = Array.from(model.importance);
    expect(imp.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5);
    expect(imp[0]).toBeGreaterThan(0.9);
    expect(imp[2]! + imp[3]!).toBeLessThan(0.05);
  });

  it('permutación: caída de exactitud ≈ 0,5 para la informativa y ≈ 0 para el ruido', () => {
    const test = ruleData(3000, 72, rule, 2);
    const res = permutationImportance({
      X: test.X,
      n: test.n,
      d: 4,
      truth: test.y,
      nClasses: 2,
      metric: 'accuracy',
      repeats: 4,
      seed: 5,
      featureNames: model.featureNames,
      predict: (X, n) => argmaxRows(predictForest(model, X, n).probabilities, n, 2).classIndex,
    });
    expect(res.baseline).toBeGreaterThan(0.98);
    // Barajar la única variable informativa deja la exactitud en el azar (≈ 0,5): caída ≈ baseline − 0,5.
    expect(res.importance[0]).toBeGreaterThan(0.4);
    expect(res.importance[0]).toBeLessThan(0.55);
    expect(Math.abs(res.importance[2]!)).toBeLessThan(0.01);
    expect(Math.abs(res.importance[3]!)).toBeLessThan(0.01);
    // Determinismo con la misma semilla.
    const again = permutationImportance({
      X: test.X, n: test.n, d: 4, truth: test.y, nClasses: 2, metric: 'accuracy', repeats: 4, seed: 5,
      predict: (X, n) => argmaxRows(predictForest(model, X, n).probabilities, n, 2).classIndex,
    });
    expect(Array.from(again.importance)).toEqual(Array.from(res.importance));
  });

  it('permutación por grupos: baraja solo dentro de cada grupo', () => {
    // Si cada grupo es una sola clase y x0 vale lo mismo dentro del grupo, barajar dentro del grupo no cambia nada.
    const n = 400;
    const d = 4;
    const X = new Float32Array(n * d);
    const truth = new Int16Array(n);
    const groups = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      groups[i] = i % 2; // grupo 0 → clase 0 (x0 = 0,1); grupo 1 → clase 1 (x0 = 0,9)
      truth[i] = groups[i]!;
      X[i * d] = groups[i] ? 0.9 : 0.1;
    }
    const predict = (M: Float32Array, m: number) => argmaxRows(predictForest(model, M, m, { minValidFeatures: 1 }).probabilities, m, 2).classIndex;
    const within = permutationImportance({ X, n, d, truth, nClasses: 2, metric: 'accuracy', predict, groups, repeats: 2 });
    const global = permutationImportance({ X, n, d, truth, nClasses: 2, metric: 'accuracy', predict, repeats: 2 });
    expect(Math.abs(within.importance[0]!)).toBeLessThan(1e-9);
    expect(global.importance[0]).toBeGreaterThan(0.3);
  });
});

describe('Cuantización por bins', () => {
  it('binOf: cuenta bordes estrictamente menores y marca faltantes', () => {
    const edges = Float32Array.from([1, 2, 3]);
    expect(binOf(edges, 0.5)).toBe(0);
    expect(binOf(edges, 1)).toBe(0); // x ≤ borde[0] → bin 0
    expect(binOf(edges, 1.0001)).toBe(1);
    expect(binOf(edges, 3)).toBe(2);
    expect(binOf(edges, 9)).toBe(3);
    expect(binOf(edges, NaN)).toBe(255);
    expect(binOf(edges, Infinity)).toBe(255);
  });

  it('computeBinEdges: valores discretos → un borde por valor menos el último; cuantiles si hay muchos', () => {
    const X = Float32Array.from([1, 2, 2, 3, 3, 3, NaN]);
    const rows = Int32Array.from([0, 1, 2, 3, 4, 5, 6]);
    expect(Array.from(computeBinEdges(X, rows, 1, 8)[0]!)).toEqual([1, 2]);
    const big = Float32Array.from({ length: 10000 }, (_, i) => i);
    const edges = computeBinEdges(big, Int32Array.from({ length: 10000 }, (_, i) => i), 1, 10)[0]!;
    expect(edges.length).toBe(9);
    for (let b = 0; b < 9; b++) expect(edges[b]).toBeCloseTo(((b + 1) * 10000) / 10, -1);
    expect(() => computeBinEdges(big, [0], 1, 300)).toThrow();
  });
});

describe('Forma del modelo', () => {
  it('hojas con T clases (suma ≤ 255; = 255 si T = K) y recuento coherente', () => {
    const rule = (x0: number, x1: number) => (x0 < 0.3 ? 0 : x1 < 0.6 ? 1 : 2);
    const model = trainRandomForest(ruleData(2000, 81, rule, 3), { ...opts, nTrees: 5, leafTop: 2 });
    expect(model.leafTop).toBe(2);
    const full = trainRandomForest(ruleData(2000, 81, rule, 3), { ...opts, nTrees: 5, leafTop: 3 });
    for (let l = 0; l < leafCount(full); l++) expect(full.leafProb[3 * l]! + full.leafProb[3 * l + 1]! + full.leafProb[3 * l + 2]!).toBe(255);
    const L = leafCount(model);
    expect(Number.isInteger(L)).toBe(true);
    for (let l = 0; l < L; l++) expect(model.leafProb[2 * l]! + model.leafProb[2 * l + 1]!).toBeLessThanOrEqual(255);
    // Árboles en preorden: cada árbol tiene tantas hojas como (nodos + 1) / 2.
    let leaves = 0;
    for (let i = 0; i < model.nodeFeature.length; i++) if ((model.nodeFeature[i]! & 0x7f) === 0x7f) leaves++;
    expect(leaves).toBe(L);
    expect(model.nodeFeature.length).toBe(2 * L - 5); // árbol binario completo: n = 2·hojas − 1 por árbol, 5 árboles
  });

  it('validación de entradas', () => {
    const data = ruleData(100, 91, x => (x < 0.5 ? 0 : 1), 2);
    expect(() => trainRandomForest({ ...data, rows: [] }, opts)).toThrow(/filas/);
    expect(() => trainRandomForest({ ...data, y: Int16Array.from({ length: 100 }, () => 5) }, opts)).toThrow(/fuera de rango/);
    expect(Math.abs(randNormal(mulberry32(1)))).toBeLessThan(10);
  });
});

describe('Entrenamiento con Float64 y validación de parámetros', () => {
  it('una característica discreta en Float64 ({0,6; 0,7; 0,8}) se cuantiza igual que en inferencia: resustitución 1,0', () => {
    // 0,6 / 0,7 / 0,8 no son exactamente representables en Float32: si el entrenamiento cuantiza en Float64 y la
    // inferencia en Float32, los valores caen en bins distintos de los bordes y el modelo falla.
    const n = 900;
    const values = [0.6, 0.7, 0.8];
    const X = new Float64Array(n);
    const y = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      X[i] = values[i % 3]!;
      y[i] = X[i] === 0.7 ? 1 : 0;
    }
    const data: TrainingMatrix = { X, n, d: 1, featureNames: ['v'], y, classCodes: [0, 1] };
    const model = trainRandomForest(data, { nTrees: 5, maxDepth: 4, minSamplesLeaf: 2, sampleSize: 900, seed: 3, minValidFeatures: 1 });
    const p = predictForest(model, X, n, { minValidFeatures: 1 });
    const { classIndex } = argmaxRows(p.probabilities, n, 2);
    let ok = 0;
    for (let i = 0; i < n; i++) if (classIndex[i] === y[i]) ok++;
    expect(ok / n).toBe(1);
  });

  it('rechaza nTrees < 1 o no entero y más características de las que caben en 7 bits', () => {
    const data = ruleData(100, 3, x => (x < 0.5 ? 0 : 1), 2);
    expect(() => trainRandomForest(data, { ...opts, nTrees: 0 })).toThrow(/nTrees/);
    expect(() => trainRandomForest(data, { ...opts, nTrees: 2.5 })).toThrow(/nTrees/);
    const d = LEAF_FEATURE; // 127 características: una más de las permitidas
    const wide: TrainingMatrix = { X: new Float32Array(20 * d), n: 20, d, featureNames: Array.from({ length: d }, (_, j) => `f${j}`), y: new Int16Array(20), classCodes: [0, 1] };
    expect(() => trainRandomForest(wide, opts)).toThrow(/características/);
    const ok = LEAF_FEATURE - 1; // 126 es el máximo
    const fine: TrainingMatrix = { ...wide, d: ok, featureNames: wide.featureNames.slice(0, ok), X: Float32Array.from({ length: 20 * ok }, (_, i) => (i * 7919) % 13) };
    for (let i = 0; i < 20; i++) (fine.y as Int16Array)[i] = i % 2;
    expect(() => trainRandomForest(fine, { ...opts, nTrees: 1, maxDepth: 3 })).not.toThrow();
  });
});

describe('Hojas: leafTop = K es el promedio exacto; con leafTop < K el resto se reparte', () => {
  const K = 4;
  const rule = (x0: number, x1: number) => Math.min(K - 1, Math.floor((x0 * 0.6 + x1 * 0.4) * K) + (x0 > 0.9 ? 0 : 0));
  // Etiqueta con ruido para que las hojas mezclen varias clases.
  function noisy(n: number, seed: number): TrainingMatrix {
    const base = ruleData(n, seed, rule, K);
    const rng = mulberry32(seed + 1000);
    const y = base.y as Int16Array;
    for (let i = 0; i < n; i++) if (rng() < 0.2) y[i] = Math.floor(rng() * K);
    return base;
  }
  const train = noisy(4000, 5);
  const test = noisy(500, 6);
  const o = { nTrees: 6, maxDepth: 8, minSamplesLeaf: 15, sampleSize: 3000, seed: 9, leafTop: K };

  /** Recorre los árboles con comparaciones directas contra los bordes (sin pasar por binOf) y promedia las hojas. */
  function independentAverage(model: ForestModel, X: ArrayLike<number>, n: number): Float64Array {
    const d = model.featureNames.length;
    const T = model.leafTop;
    const out = new Float64Array(n * K);
    const leafIndex = new Map<number, number>();
    let li = 0;
    for (let i = 0; i < model.nodeFeature.length; i++) if ((model.nodeFeature[i]! & 0x7f) === 0x7f) leafIndex.set(i, li++);
    const nTrees = model.treeStart.length - 1;
    for (let r = 0; r < n; r++) {
      for (let t = 0; t < nTrees; t++) {
        let i = model.treeStart[t]!;
        while ((model.nodeFeature[i]! & 0x7f) !== 0x7f) {
          const f = model.nodeFeature[i]! & 0x7f;
          const x = X[r * d + f]!;
          const left = Number.isNaN(x) ? (model.nodeFeature[i]! & 0x80) !== 0 : x <= model.edges[f]![model.nodeThreshold[i]!]!;
          i = left ? i + 1 : i + model.nodeRight[i]!;
        }
        const base = leafIndex.get(i)! * T;
        for (let q = 0; q < T; q++) out[r * K + model.leafClass[base + q]!]! += model.leafProb[base + q]! / 255 / nTrees;
      }
    }
    return out;
  }

  it('leafTop = K: predictForest coincide con el promedio de hojas calculado a mano', () => {
    const model = trainRandomForest(train, o);
    expect(model.leafTop).toBe(K);
    const mine = independentAverage(model, test.X, test.n);
    const p = predictForest(model, test.X, test.n, { minValidFeatures: 1 }).probabilities;
    for (let i = 0; i < p.length; i++) expect(Math.abs(p[i]! - mine[i]!)).toBeLessThan(1e-6);
  });

  it('leafTop < K conserva la masa total (suma 1) y reparte el resto: casi ninguna clase queda en 0 por truncar', () => {
    const full = trainRandomForest(train, o);
    const top2 = trainRandomForest(train, { ...o, leafTop: 2 });
    const pf = predictForest(full, test.X, test.n).probabilities;
    const p2 = predictForest(top2, test.X, test.n).probabilities;
    let diff = 0;
    let zeros = 0;
    for (let r = 0; r < test.n; r++) {
      let s = 0;
      for (let c = 0; c < K; c++) {
        s += p2[r * K + c]!;
        diff += Math.abs(p2[r * K + c]! - pf[r * K + c]!);
        if (p2[r * K + c] === 0) zeros++;
      }
      expect(s).toBeCloseTo(1, 5);
    }
    expect(diff / (test.n * K)).toBeLessThan(0.03);
    // Solo queda en 0 una clase si en todas las hojas visitadas la masa guardada ya sumaba 255 (resto < 0,5/255).
    expect(zeros / (test.n * K)).toBeLessThan(0.01);
  });
});
