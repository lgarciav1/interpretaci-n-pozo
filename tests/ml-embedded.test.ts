import { describe, expect, it } from 'vitest';
import tpCsv from '../datos/pozo_tp_perfiles.csv?raw';
import { chooseLithologyVariant, getLithologyModel, predictLithologyEmbedded, type LithologyVariant } from '../src/ml/embedded';
import { EMBEDDED_LITHOLOGY_MODELS } from '../src/ml/model/lithologyModels';
import { LITHOLOGY_CLASSES } from '../src/ml/lithology';
import { predictLithology, modelImportance } from '../src/ml/lithologyModel';
import { resolveCurveAliases } from '../src/ml/features';
import { serializeModel, deserializeModel } from '../src/ml/serialize';
import { permutationImportance } from '../src/ml/importance';
import { argmaxRows, predictForest } from '../src/ml/forest';
import { buildFeatureMatrix } from '../src/ml/features';

function parseTp(): { curves: Record<string, Float64Array>; n: number } {
  const lines = tpCsv.trim().split(/\r?\n/);
  const header = lines[0]!.split(',');
  const n = lines.length - 1;
  const curves: Record<string, Float64Array> = {};
  for (const h of header) curves[h] = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cells = lines[i + 1]!.split(',');
    header.forEach((h, j) => {
      const c = cells[j];
      curves[h]![i] = c === undefined || c === '' || h === 'ZONA' ? NaN : Number(c);
    });
  }
  return { curves, n };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

const tp = parseTp();
const tpCurves = resolveCurveAliases(tp.curves);
const variants: LithologyVariant[] = ['withPe', 'noPe'];

describe('Modelos embebidos: forma y rangos sobre el pozo del TP (no litologías «correctas»)', () => {
  it('el pozo del TP tiene 5810 muestras y las siete curvas del modelo se resuelven por alias', () => {
    expect(tp.n).toBe(5810);
    expect(Object.keys(tpCurves).sort()).toEqual(['CALI', 'DTC', 'GR', 'NPHI', 'PEF', 'RDEP', 'RHOB']);
  });

  it.each(variants)('%s: probabilidades suman 1, sin NaN, clases e índices en rango', variant => {
    const model = getLithologyModel(variant);
    const t0 = performance.now();
    const pred = predictLithology(model, tpCurves);
    const ms = performance.now() - t0;
    const K = LITHOLOGY_CLASSES.length;
    expect(pred.n).toBe(5810);
    expect(pred.nClasses).toBe(K);
    expect(pred.probabilities.length).toBe(5810 * K);
    expect(pred.missingCurves).toEqual([]);
    for (let i = 0; i < pred.n; i++) {
      let s = 0;
      let max = 0;
      for (let c = 0; c < K; c++) {
        const p = pred.probabilities[i * K + c]!;
        expect(Number.isNaN(p)).toBe(false);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1 + 1e-6);
        s += p;
        max = Math.max(max, p);
      }
      expect(Math.abs(s - 1)).toBeLessThan(1e-5);
      expect(pred.classIndex[i]).toBeGreaterThanOrEqual(0);
      expect(pred.classIndex[i]).toBeLessThan(K);
      expect(pred.confidence[i]).toBeCloseTo(max, 6);
      expect(pred.confidence[i]).toBeGreaterThanOrEqual(1 / K - 1e-6);
      expect(LITHOLOGY_CLASSES.some(c => c.code === pred.classCode[i])).toBe(true);
    }
    // Con 6 de 6 (o 5 de 5) curvas casi siempre presentes, casi todas las muestras son válidas.
    const valid = pred.valid.reduce((a, b) => a + b, 0);
    expect(valid).toBeGreaterThan(5700);
    // Presupuesto: la inferencia de todo el pozo debe ser << 1 s (holgura x10 para CI lento; en la práctica ≈ 50–150 ms).
    expect(ms).toBeLessThan(2000);
  });

  it('las dos variantes declaran sus características y clases FORCE', () => {
    const withPe = getLithologyModel('withPe');
    const noPe = getLithologyModel('noPe');
    expect(withPe.featureNames).toEqual(['GR', 'RHOB', 'NPHI', 'PEF', 'DTC', 'LOG_RDEP']);
    expect(noPe.featureNames).toEqual(['GR', 'RHOB', 'NPHI', 'DTC', 'LOG_RDEP']);
    for (const m of [withPe, noPe]) {
      expect(Array.from(m.classCodes)).toEqual(LITHOLOGY_CLASSES.map(c => c.code));
      expect(Array.from(m.importance).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
      expect(Array.from(m.classPriors).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
      expect(m.meta.source).toMatch(/FORCE 2020/);
    }
    expect(modelImportance(noPe)[0]!.feature).toBe('GR');
  });

  it('el modelo decodificado se reserializa a los mismos bytes (ida y vuelta del embebido)', () => {
    for (const v of variants) {
      const model = getLithologyModel(v);
      const bytes = serializeModel(model);
      expect(sameBytes(serializeModel(deserializeModel(bytes)), bytes)).toBe(true);
    }
  });

  it('tamaño: los dos modelos embebidos suman menos de 1,5 MB de texto', () => {
    const total = Object.values(EMBEDDED_LITHOLOGY_MODELS).reduce((s, t) => s + t.length, 0);
    expect(total).toBeLessThan(1_500_000);
    expect(Object.keys(EMBEDDED_LITHOLOGY_MODELS).sort()).toEqual(['noPe', 'withPe']);
  });
});

describe('Variante con y sin PE', () => {
  it('«auto» descarta el PE del TP (firma de baritina, decisión 0029) y avisa por qué', () => {
    const choice = chooseLithologyVariant(tpCurves);
    expect(choice.variant).toBe('noPe');
    expect(choice.suspectFraction).toBeGreaterThan(0.9);
    expect(choice.reason).toMatch(/baritina/);
  });
  it('«use» e «ignore» fuerzan la variante; sin curva PE siempre es noPe; con PE coherente, withPe', () => {
    expect(chooseLithologyVariant(tpCurves, 'use').variant).toBe('withPe');
    expect(chooseLithologyVariant(tpCurves, 'ignore').variant).toBe('noPe');
    const { PEF: _omit, ...withoutPe } = tpCurves;
    void _omit;
    expect(chooseLithologyVariant(withoutPe, 'use').variant).toBe('noPe');
    // Arenisca típica: PE ≈ 1,8 b/e con ρb 2,35 g/cm³ → no sospechoso.
    const clean = { PEF: Array.from({ length: 200 }, (_, i) => 1.8 + (i % 5) * 0.1), RHOB: Array.from({ length: 200 }, (_, i) => 2.3 + (i % 7) * 0.02) };
    expect(chooseLithologyVariant(clean).variant).toBe('withPe');
    // PE presente pero casi todo NaN (o con muy pocas muestras válidas): no hay base para usarlo.
    const mostlyNaN = { PEF: clean.PEF.map((v, i) => (i < 10 ? v : NaN)), RHOB: clean.RHOB };
    const sparse = chooseLithologyVariant(mostlyNaN);
    expect(sparse.variant).toBe('noPe');
    expect(sparse.reason).toMatch(/muy pocas/);
    expect(chooseLithologyVariant({ PEF: clean.PEF.slice(0, 5), RHOB: clean.RHOB.slice(0, 5) }).variant).toBe('noPe');
  });
  it('predictLithologyEmbedded devuelve la variante usada y cae en noPe sin romperse si falta PE', () => {
    const { PEF: _omit, ...withoutPe } = tpCurves;
    void _omit;
    const r = predictLithologyEmbedded(withoutPe);
    expect(r.variant).toBe('noPe');
    expect(r.n).toBe(5810);
    expect(r.missingCurves).toEqual([]);
    // Pidiendo el modelo con PE sin la curva: la columna es NaN, se informa y no hay NaN en la salida.
    const forced = predictLithology(getLithologyModel('withPe'), withoutPe);
    expect(forced.missingCurves).toEqual(['PEF']);
    expect(Array.from(forced.probabilities).some(Number.isNaN)).toBe(false);
  });
  it('pozo sin ninguna curva útil: a priori, valid = 0, sin NaN', () => {
    const r = predictLithology(getLithologyModel('noPe'), { GR: [NaN, NaN, 80] });
    expect(Array.from(r.valid)).toEqual([0, 0, 0]); // solo 1 característica válida (< 2)
    expect(Array.from(r.probabilities).some(Number.isNaN)).toBe(false);
  });
});

describe('Importancia por permutación con el modelo embebido (humo de forma)', () => {
  it('devuelve una importancia por característica, finita y determinística', () => {
    const model = getLithologyModel('noPe');
    const fm = buildFeatureMatrix(tpCurves, model.featureNames as never);
    // Pseudo-verdad: la propia predicción (solo comprueba forma y que barajar GR cambie algo).
    const base = argmaxRows(predictForest(model, fm.X, fm.n).probabilities, fm.n, 12).classIndex;
    const run = () =>
      permutationImportance({
        X: fm.X, n: 1200, d: fm.d, truth: base.subarray(0, 1200), nClasses: 12, metric: 'accuracy', repeats: 2, seed: 4,
        featureNames: model.featureNames,
        predict: (X, n) => argmaxRows(predictForest(model, X, n).probabilities, n, 12).classIndex,
      });
    const a = run();
    const b = run();
    expect(a.importance.length).toBe(5);
    expect(Array.from(a.importance).every(Number.isFinite)).toBe(true);
    expect(Array.from(a.importance)).toEqual(Array.from(b.importance));
    expect(a.baseline).toBeCloseTo(1, 6);
    expect(Math.max(...a.importance)).toBeGreaterThan(0.05);
  });
});
