import { describe, expect, it } from 'vitest';
import { FORCE_PENALTY_MATRIX, LITHOLOGY_CLASSES, lithologyIndexOfCode } from '../src/ml/lithology';
import {
  confusionMatrix,
  crossValidate,
  depthBlockFolds,
  evaluatePredictions,
  forestFitPredict,
  leaveOneWellOutFolds,
  metricsFromConfusion,
  type Fold,
} from '../src/ml/validation';
import { mulberry32 } from '../src/ml/rng';
import type { TrainingMatrix } from '../src/ml/forest';

/** Pozos sintéticos: profundidad cada 0,5 m con inicios y largos distintos; el orden de las muestras se baraja. */
function syntheticWells(seed = 1) {
  const rng = mulberry32(seed);
  const wellIds: number[] = [];
  const depth: number[] = [];
  const spec = [
    { id: 10, top: 1000, len: 900 },
    { id: 11, top: 2500, len: 1300 },
    { id: 12, top: 300, len: 150 }, // pozo corto: menos bloques que folds
    { id: 13, top: 5000, len: 2200 },
  ];
  for (const w of spec) for (let z = 0; z < w.len; z += 0.5) (wellIds.push(w.id), depth.push(w.top + z));
  const order = wellIds.map((_, i) => i).sort(() => rng() - 0.5);
  return { wellIds: order.map(i => wellIds[i]!), depth: order.map(i => depth[i]!) };
}

describe('depthBlockFolds: propiedades de ausencia de fuga', () => {
  const { wellIds, depth } = syntheticWells();
  const n = wellIds.length;
  const cfg = { wellIds, depth, nFolds: 5, blockLength: 100, gap: 20, seed: 3 };
  const folds = depthBlockFolds(cfg);

  it('los conjuntos de prueba particionan las muestras: cada una es de prueba exactamente una vez', () => {
    const seen = new Int32Array(n);
    for (const f of folds) for (const i of f.test) seen[i]!++;
    expect(Array.from(seen).every(c => c === 1)).toBe(true);
  });

  it('train y test de un fold nunca comparten muestras', () => {
    for (const f of folds) {
      const test = new Set(f.test);
      for (const i of f.train) expect(test.has(i)).toBe(false);
    }
  });

  it('toda muestra de train está a ≥ gap de toda muestra de test del mismo pozo (buffer)', () => {
    for (const f of folds) {
      const testByWell = new Map<number, number[]>();
      for (const i of f.test) {
        const list = testByWell.get(wellIds[i]!) ?? [];
        list.push(depth[i]!);
        testByWell.set(wellIds[i]!, list);
      }
      for (const [, zs] of testByWell) zs.sort((a, b) => a - b);
      for (const i of f.train) {
        const zs = testByWell.get(wellIds[i]!);
        if (!zs) continue;
        // distancia mínima a una muestra de prueba por búsqueda binaria
        let lo = 0;
        let hi = zs.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (zs[mid]! < depth[i]!) lo = mid + 1;
          else hi = mid;
        }
        const d1 = lo < zs.length ? zs[lo]! - depth[i]! : Infinity;
        const d0 = lo > 0 ? depth[i]! - zs[lo - 1]! : Infinity;
        expect(Math.min(d0, d1)).toBeGreaterThanOrEqual(cfg.gap);
      }
    }
  });

  it('los bloques son contiguos: dentro de un pozo, cada bloque de 100 m cae entero en un solo fold', () => {
    const foldOfSample = new Int32Array(n).fill(-1);
    folds.forEach((f, fi) => f.test.forEach(i => (foldOfSample[i] = fi)));
    const minDepth = new Map<number, number>();
    for (let i = 0; i < n; i++) minDepth.set(wellIds[i]!, Math.min(minDepth.get(wellIds[i]!) ?? Infinity, depth[i]!));
    const blockFold = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const key = `${wellIds[i]}:${Math.floor((depth[i]! - minDepth.get(wellIds[i]!)!) / 100)}`;
      const prev = blockFold.get(key);
      if (prev === undefined) blockFold.set(key, foldOfSample[i]!);
      else expect(prev).toBe(foldOfSample[i]);
    }
  });

  it('con gap = 0 el train es todo lo que no es test; con gap grande se descartan más muestras', () => {
    const f0 = depthBlockFolds({ ...cfg, gap: 0 });
    for (const f of f0) expect(f.train.length + f.test.length).toBe(n);
    const f50 = depthBlockFolds({ ...cfg, gap: 50 });
    f50.forEach((f, k) => expect(f.train.length).toBeLessThan(f0[k]!.train.length));
  });

  it('es determinístico y cada pozo largo aporta a todos los folds', () => {
    const again = depthBlockFolds(cfg);
    folds.forEach((f, k) => {
      expect(Array.from(again[k]!.test)).toEqual(Array.from(f.test));
      expect(Array.from(again[k]!.train)).toEqual(Array.from(f.train));
      expect(f.test.length).toBeGreaterThan(0);
    });
  });

  it('ignora profundidades no finitas y valida parámetros', () => {
    const f = depthBlockFolds({ wellIds: [1, 1, 1, 1], depth: [0, NaN, 150, 300], nFolds: 2, blockLength: 100, gap: 0 });
    const all = new Set([...f[0]!.test, ...f[1]!.test]);
    expect(all.has(1)).toBe(false);
    expect(all.size).toBe(3);
    expect(() => depthBlockFolds({ ...cfg, nFolds: 1 })).toThrow();
    expect(() => depthBlockFolds({ ...cfg, blockLength: 0 })).toThrow();
    expect(() => depthBlockFolds({ ...cfg, gap: -1 })).toThrow();
    expect(() => depthBlockFolds({ ...cfg, depth: [1, 2] })).toThrow();
  });
});

describe('leaveOneWellOutFolds', () => {
  const { wellIds } = syntheticWells();
  it('el pozo de prueba nunca aparece en el train y los demás sí', () => {
    const folds = leaveOneWellOutFolds(wellIds);
    expect(folds.length).toBe(4);
    for (const f of folds) {
      const testWells = new Set(Array.from(f.test, i => wellIds[i]!));
      expect(testWells.size).toBe(1);
      for (const i of f.train) expect(testWells.has(wellIds[i]!)).toBe(false);
      expect(f.train.length + f.test.length).toBe(wellIds.length);
    }
  });
  it('wellsPerFold agrupa pozos', () => {
    const folds = leaveOneWellOutFolds(wellIds, { wellsPerFold: 2 });
    expect(folds.length).toBe(2);
    expect(new Set(Array.from(folds[0]!.test, i => wellIds[i]!)).size).toBe(2);
  });
});

describe('Métricas con resultados calculados a mano', () => {
  // Verdad:      0 0 0 0 1 1 1 2 2 2    Predicción:  0 0 1 0 1 1 2 2 2 0
  const truth = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2];
  const pred = [0, 0, 1, 0, 1, 1, 2, 2, 2, 0];
  it('matriz de confusión, exactitud y F1 macro', () => {
    const cm = confusionMatrix(truth, pred, 3);
    expect(Array.from(cm)).toEqual([3, 1, 0, 0, 2, 1, 1, 0, 2]);
    const m = evaluatePredictions(truth, pred, 3);
    expect(m.accuracy).toBeCloseTo(7 / 10, 12);
    // Clase 0: P = 3/4, R = 3/4 → F1 = 0,75. Clase 1: P = 2/3, R = 2/3 → F1 = 2/3. Clase 2: P = 2/3, R = 2/3 → F1 = 2/3.
    expect(m.f1Macro).toBeCloseTo((0.75 + 2 / 3 + 2 / 3) / 3, 12);
    expect(m.perClass[0]!.precision).toBeCloseTo(0.75, 12);
    expect(m.perClass[2]!.support).toBe(3);
    expect(Number.isNaN(m.penalty)).toBe(true); // K = 3: sin matriz de penalización
  });
  it('una clase que nunca se predice cuenta con F1 = 0 y una clase sin soporte no entra al promedio', () => {
    const m = evaluatePredictions([0, 0, 1, 1], [0, 0, 0, 0], 3);
    expect(m.perClass[1]!.f1).toBe(0);
    expect(m.f1Macro).toBeCloseTo((2 / 3 + 0) / 2, 12); // clase 0: P = 0,5 R = 1 → 2/3; clase 1: 0; clase 2 sin soporte
  });
  it('penalización de FORCE: media de A[verdad][predicción]', () => {
    // Pares (arenisca→lutita) 3,5; (lutita→lutita) 0; (caliza→creta) 1,375; (marga→caliza) 2,0 → (3,5 + 0 + 1,375 + 2) / 4
    const m = evaluatePredictions([0, 2, 5, 3], [2, 2, 6, 5], 12);
    expect(m.penalty).toBeCloseTo((3.5 + 0 + 1.375 + 2.0) / 4, 12);
    const perfect = evaluatePredictions([0, 2, 5], [0, 2, 5], 12);
    expect(perfect.penalty).toBe(0);
    expect(perfect.accuracy).toBe(1);
  });
  it('metricsFromConfusion acepta una matriz propia', () => {
    const m = metricsFromConfusion(Int32Array.from([5, 0, 0, 5]), 2, [[0, 1], [1, 0]]);
    expect(m.accuracy).toBe(1);
    expect(m.penalty).toBe(0);
  });
});

describe('Clases y matriz de penalización de FORCE 2020', () => {
  it('el mapa código → índice coincide con `lithology_numbers` de test_code.py', () => {
    const fromTestCode: Record<number, number> = { 30000: 0, 65030: 1, 65000: 2, 80000: 3, 74000: 4, 70000: 5, 70032: 6, 88000: 7, 86000: 8, 99000: 9, 90000: 10, 93000: 11 };
    for (const [code, idx] of Object.entries(fromTestCode)) expect(lithologyIndexOfCode(Number(code))).toBe(idx);
    expect(lithologyIndexOfCode(12345)).toBe(-1);
    expect(LITHOLOGY_CLASSES.map(c => c.index)).toEqual([...Array(12).keys()]);
    // Nombres según starter_notebook.ipynb: 74000 es Dolomite (no caliza), 88000 Halite, 86000 Anhydrite.
    expect(LITHOLOGY_CLASSES[4]!.name).toBe('Dolomite');
    expect(LITHOLOGY_CLASSES[7]!.name).toBe('Halite');
    expect(LITHOLOGY_CLASSES[8]!.name).toBe('Anhydrite');
  });
  it('la matriz es 12×12, simétrica, de diagonal 0 y máximo 4 (propiedades de penalty_matrix.npy)', () => {
    expect(FORCE_PENALTY_MATRIX.length).toBe(12);
    for (let i = 0; i < 12; i++) {
      expect(FORCE_PENALTY_MATRIX[i]!.length).toBe(12);
      expect(FORCE_PENALTY_MATRIX[i]![i]).toBe(0);
      for (let j = 0; j < 12; j++) {
        expect(FORCE_PENALTY_MATRIX[i]![j]).toBe(FORCE_PENALTY_MATRIX[j]![i]);
        expect(FORCE_PENALTY_MATRIX[i]![j]).toBeLessThanOrEqual(4);
      }
    }
    // Entradas leídas con NumPy del archivo original: caliza↔creta 1,375; arenisca↔arenisca/lutita 2; halita↔anhidrita 2,75.
    expect(FORCE_PENALTY_MATRIX[5]![6]).toBe(1.375);
    expect(FORCE_PENALTY_MATRIX[0]![1]).toBe(2);
    expect(FORCE_PENALTY_MATRIX[7]![8]).toBe(2.75);
    expect(FORCE_PENALTY_MATRIX[1]![2]).toBe(2.375);
  });
});

/** Lee un .npy v1/v2 de float64 en C-order y devuelve forma y datos. */
function readNpy(bytes: Uint8Array): { shape: number[]; data: Float64Array } {
  const magic = String.fromCharCode(...bytes.subarray(1, 6));
  if (bytes[0] !== 0x93 || magic !== 'NUMPY') throw new Error('No es un .npy');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = bytes[6]!;
  const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const start = (major === 1 ? 10 : 12) + headerLen;
  const header = new TextDecoder().decode(bytes.subarray(major === 1 ? 10 : 12, start));
  if (!/'descr': '<f8'/.test(header) || !/'fortran_order': False/.test(header)) throw new Error(`Formato npy no soportado: ${header}`);
  const shape = (/'shape': \(([^)]*)\)/.exec(header)![1]!).split(',').filter(t => t.trim()).map(Number);
  const count = shape.reduce((a, b) => a * b, 1);
  const data = new Float64Array(count);
  for (let i = 0; i < count; i++) data[i] = view.getFloat64(start + 8 * i, true);
  return { shape, data };
}

// El .npy vive en datos/FORCE2020; si no está en el checkout, el test se salta explícitamente.
const NPY_PATH = new URL('../datos/FORCE2020/lithology_competition/data/penalty_matrix.npy', import.meta.url);
const nodeModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ nodeModule)) as { existsSync: (p: URL) => boolean; readFileSync: (p: URL) => Uint8Array };
const hasNpy = fs.existsSync(NPY_PATH);

describe('FORCE_PENALTY_MATRIX contra penalty_matrix.npy', () => {
  it.skipIf(!hasNpy)('coincide celda por celda con el archivo original', () => {
    const { shape, data } = readNpy(fs.readFileSync(NPY_PATH));
    expect(shape).toEqual([12, 12]);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) expect(FORCE_PENALTY_MATRIX[i]![j]).toBe(data[i * 12 + j]);
  });
});

describe('crossValidate', () => {
  it('detecta una fuga (muestra en train y test) y falla', () => {
    const bad: Fold = { train: Int32Array.from([0, 1, 2]), test: Int32Array.from([2, 3]), label: 'malo' };
    expect(() => crossValidate({ folds: [bad], truth: [0, 0, 1, 1], nClasses: 2, fitPredict: () => [0, 0] })).toThrow(/Fuga/);
  });
  it('agrega métricas por fold y agrupadas; includeTest filtra las muestras evaluadas', () => {
    const truth = [0, 0, 1, 1, 0, 1];
    const folds: Fold[] = [
      { train: Int32Array.from([2, 3, 4, 5]), test: Int32Array.from([0, 1]), label: 'a' },
      { train: Int32Array.from([0, 1, 4, 5]), test: Int32Array.from([2, 3]), label: 'b' },
    ];
    const res = crossValidate({
      folds,
      truth,
      nClasses: 2,
      fitPredict: (_f, fi) => (fi === 0 ? [0, 1] : [1, 1]),
    });
    expect(res.folds[0]!.accuracy).toBe(0.5);
    expect(res.folds[1]!.accuracy).toBe(1);
    expect(res.mean.accuracy).toBeCloseTo(0.75, 12);
    expect(res.std.accuracy).toBeCloseTo(0.25, 12);
    expect(res.pooled.accuracy).toBeCloseTo(3 / 4, 12);
    const filtered = crossValidate({ folds, truth, nClasses: 2, fitPredict: (_f, fi) => (fi === 0 ? [0, 1] : [1, 1]), includeTest: i => i !== 1 });
    expect(filtered.pooled.n).toBe(3);
    expect(filtered.pooled.accuracy).toBe(1);
  });
  it('fitPredict debe devolver una predicción por muestra de prueba', () => {
    const f: Fold = { train: Int32Array.from([0]), test: Int32Array.from([1, 2]), label: 'x' };
    expect(() => crossValidate({ folds: [f], truth: [0, 0, 0], nClasses: 2, fitPredict: () => [0] })).toThrow();
  });
});

describe('Por qué por tramos: la partición al azar infla la exactitud, la de bloques no', () => {
  // Cada tramo de 50 m tiene una «huella» propia (x0 constante por tramo, más ruido mínimo) y una litología
  // aleatoria SIN relación con la huella entre tramos. Un modelo que memoriza la huella acierta en cualquier
  // partición al azar (los vecinos están en train), pero no puede acertar en un tramo que nunca vio.
  const nWells = 3;
  const per = 800; // muestras por pozo (0,5 m → 400 m, 8 tramos)
  const n = nWells * per;
  const rng = mulberry32(5);
  const wellIds = new Int32Array(n);
  const depth = new Float64Array(n);
  const X = new Float32Array(n * 2);
  const y = new Int16Array(n);
  for (let w = 0; w < nWells; w++) {
    for (let b = 0; b < per / 100; b++) {
      const fingerprint = rng();
      const cls = Math.floor(rng() * 3);
      for (let s = 0; s < 100; s++) {
        const i = w * per + b * 100 + s;
        wellIds[i] = w;
        depth[i] = 1000 + (b * 100 + s) * 0.5;
        X[i * 2] = fingerprint + 1e-4 * rng();
        X[i * 2 + 1] = rng();
        y[i] = cls;
      }
    }
  }
  const data: TrainingMatrix = { X, n, d: 2, featureNames: ['huella', 'ruido'], y, classCodes: [0, 1, 2] };
  const options = { nTrees: 20, maxDepth: 12, minSamplesLeaf: 3, sampleSize: 2000, seed: 1 };

  it('al azar ≈ memorización; por bloques ≈ azar de clases', () => {
    const order = Array.from({ length: n }, (_, i) => i).sort(() => rng() - 0.5);
    const randomFolds: Fold[] = Array.from({ length: 5 }, (_, f) => {
      const test = order.filter((_, q) => q % 5 === f);
      const set = new Set(test);
      return { test: Int32Array.from(test), train: Int32Array.from(order.filter(i => !set.has(i))), label: `azar ${f}` };
    });
    const blockFolds = depthBlockFolds({ wellIds, depth, nFolds: 4, blockLength: 50, gap: 5, seed: 2 });
    const fit = forestFitPredict(data, options);
    const acc = (folds: Fold[]) => crossValidate({ folds, truth: y, nClasses: 3, fitPredict: f => fit(f), penaltyMatrix: null }).pooled.accuracy;
    const random = acc(randomFolds);
    const blocks = acc(blockFolds);
    // La cuantización en 64 bins junta huellas muy cercanas, por eso el azar no llega a 1,0.
    expect(random).toBeGreaterThan(0.85);
    expect(blocks).toBeLessThan(0.6); // sin información real, cerca de 1/3 (con 24 tramos hay mucha varianza: cota holgada)
    expect(random - blocks).toBeGreaterThan(0.3);
  });
});
