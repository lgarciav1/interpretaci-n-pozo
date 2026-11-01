/**
 * Normalización de curvas (docs/decisiones/0060). Los valores esperados de los casos 1–4 salen de
 * `scripts/qa/normalization-reference.py` (numpy, percentiles `method="linear"` = definición 7).
 */
import { describe, expect, it } from 'vitest';
import legacy from './fixtures/preparation-legacy-v1-v4.json';
import { curve, linearModule } from './helpers';
import { createWell } from '../src/core/well';
import { createRegistry } from '../src/core/registry';
import { addWell, createProject } from '../src/core/state/project';
import { addMaskInterval, entryPreparationPlan, removeDepthShift, removeGapFill, removeMedianFilter, removeNormalization, restoreMaskInterval, setDepthShift, setGapFill, setMedianFilter, setNormalization } from '../src/core/state/preparation';
import { MaskEvaluator, PreparationCancelled } from '../src/core/preparation/evaluate';
import { toEngineWell } from '../src/core/engine/engine';
import { materializePreparation, validatePreparedPayloads } from '../src/core/preparation/plan';
import { Quality, normalizationQualityCounts } from '../src/core/preparation/quality';
import { preparationState, preparationStateKey, validateNormalization, validatePreparation, type CurveNormalization } from '../src/core/preparation/state';
import { MIN_NORMALIZATION_SAMPLES, applyNormalization, denormalizeValue, normalizationAnchors, normalizationDomain, normalizeValue, outsideDomain, percentileRank, percentileSorted } from '../src/core/preparation/normalization';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { useProject } from '../src/app/store/project';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
/** Serie racional de la referencia: ((i·37) mod 101)/100 + i/1000. */
const series = (n: number) => Array.from({ length: n }, (_, i) => ((i * 37) % 101) / 100 + i / 1000);
const sorted = (xs: number[]) => Float64Array.from(xs).sort();
const anonymous = (key: string) => key.replace(/\b(array|depth|well):\d+/g, '$1:#');
const withoutSavedAt =(text: string) => text.replace(/"savedAt":"[^"]*"/, '"savedAt":""');
const close = (a: number, b: number, eps = 1e-12) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps * Math.max(1, Math.abs(b)));

/** Caso 3 de la referencia: 100 muestras cada 0,5 m, NaN en 3, 17, 40–42. */
function case3Data() {
  return Array.from({ length: 100 }, (_, i) => ([3, 17, 40, 41, 42].includes(i) ? NaN : 50 + ((i * 13) % 29) - 0.25 * i));
}
function fixture(data = case3Data(), role = 'GR', step = 0.5) {
  const depth = Float64Array.from(data, (_, i) => i * step);
  return addWell(createProject(), createWell({ id: 'w', name: 'W', depth, curves: [{ ...curve('C', role, data), origin: { kind: 'measured' } }, { ...curve('RT', 'RT', data.map((_, i) => i + 1)), origin: { kind: 'measured' } }] }));
}
const twoPoint = (extra: Partial<Extract<CurveNormalization, { method: 'two-point' }>> = {}): CurveNormalization => ({ method: 'two-point', top: 5, base: 45, lowPercentile: 5, highPercentile: 95, lowReference: 20, highReference: 80, ...extra });
async function evaluate(project: ReturnType<typeof fixture>, evaluator = new MaskEvaluator()) {
  const entry = project.wells[0]!, plan = entryPreparationPlan(project, entry, registry), artifacts = await evaluator.evaluate(toEngineWell(entry.well), plan);
  return { entry, plan, artifacts, payload: artifacts[0]!, data: materializePreparation(entry.well, { plan, artifacts }, plan.context, registry) };
}
const masked = () => addMaskInterval(fixture(), 'w', 'C', { id: 'r', top: 10, base: 12 }, 'n');

describe('normalización: matemática pura (referencia numpy)', () => {
  it('caso 1: percentiles definición 7 y su inversa', () => {
    const s = sorted(series(120));
    const expected: Record<number, number> = { 0: 0.0, 5: 0.10195000000000001, 12.5: 0.1815, 50: 0.5555, 95: 1.00805, 100: 1.07 };
    for (const [p, v] of Object.entries(expected)) close(percentileSorted(s, Number(p)), v);
    for (const p of [0, 0.5, 5, 12.5, 37.3, 50, 95, 99.9, 100]) close(percentileRank(s, percentileSorted(s, p)), p, 1e-9);
    expect(percentileSorted(s, -1)).toBeNaN();
    expect(percentileSorted(s, 101)).toBeNaN();
    expect(percentileRank(s, -5)).toBe(0);
    expect(percentileRank(s, 5)).toBe(100);
  });
  it('caso 2: una descalibración conocida se recupera de ida y vuelta', async () => {
    const t = series(120).map((x) => x * 0.5 + 0.05), m = t.map((x) => 0.8 * x + 0.03);
    const st = sorted(t);
    const config: CurveNormalization = { method: 'two-point', top: 0, base: 119, lowPercentile: 5, highPercentile: 95, lowReference: percentileSorted(st, 5), highReference: percentileSorted(st, 95) };
    close(config.lowReference, 0.10097500000000001);
    close(config.highReference, 0.554025);
    const depth = Float64Array.from(m, (_, i) => i), data = Float64Array.from(m), quality = new Uint16Array(m.length);
    const stats = await applyNormalization(depth, data, quality, config, normalizationDomain('NPHI', 'v/v'), new Float64Array(m.length), async () => {});
    close(stats.sourceLow, 0.11078);
    close(stats.sourceHigh!, 0.4732200000000001);
    close(stats.gain, 1.2499999999999996);
    expect(stats.samples).toBe(120);
    expect(stats.outOfDomain).toBe(0);
    let err = 0;
    for (let i = 0; i < t.length; i++) err = Math.max(err, Math.abs(data[i]! - t[i]!));
    expect(err).toBeLessThanOrEqual(1e-15);
    expect(quality.every((q) => q === Quality.Normalized)).toBe(true);
    // Inversa: vuelve a la curva medida.
    for (let i = 0; i < m.length; i++) close(denormalizeValue(data[i]!, config, stats), m[i]!, 1e-14);
  });
  it('caso 4: dominio físico de NPHI; desplazamiento y escala', () => {
    const x = series(120), s = sorted(x);
    const config: CurveNormalization = { method: 'two-point', top: 0, base: 1, lowPercentile: 10, highPercentile: 90, lowReference: -0.1, highReference: 0.95 };
    const a = normalizationAnchors(config, s);
    close(a.sourceLow, 0.14390000000000003);
    close(a.sourceHigh!, 0.9499000000000001);
    close(a.gain, 1.3027295285359801);
    const domain = normalizationDomain('NPHI', 'v/v');
    const y = x.map((v) => normalizeValue(v, config, a));
    expect(y.filter((v) => v < -0.15).length).toBe(8);
    expect(y.filter((v) => v > 1).length).toBe(8);
    expect(y.filter((v) => outsideDomain(v, domain)).length).toBe(16);
    close(Math.min(...y), -0.28746277915632756);
    close(Math.max(...y), 1.1064578163771712);
    // El dominio se expresa en la unidad de la curva (NPHI en %).
    expect(normalizationDomain('NPHI', '%')).toEqual({ min: -15, max: 100, strictMin: false });
    expect(normalizationDomain('SP', 'mV')).toBeNull();
    expect(outsideDomain(0, normalizationDomain('RT', 'ohm.m'))).toBe(true);
    expect(outsideDomain(0, normalizationDomain('GR', 'gAPI'))).toBe(false);
  });
  it('dominio de los datos: muestras mínimas, percentiles iguales y escala sin signo', () => {
    const few = sorted(series(MIN_NORMALIZATION_SAMPLES - 1));
    expect(() => normalizationAnchors(twoPoint(), few)).toThrow(/al menos 50/);
    expect(() => normalizationAnchors(twoPoint(), sorted(series(MIN_NORMALIZATION_SAMPLES)))).not.toThrow();
    expect(() => normalizationAnchors(twoPoint(), new Float64Array(60).fill(3))).toThrow(/iguales/);
    expect(() => normalizationAnchors({ method: 'scale', top: 0, base: 1, percentile: 50, reference: 2 }, new Float64Array(60))).toThrow(/cero/);
    expect(() => normalizationAnchors({ method: 'scale', top: 0, base: 1, percentile: 50, reference: -2 }, new Float64Array(60).fill(3))).toThrow(/mismo signo/);
    expect(normalizationAnchors({ method: 'shift', top: 0, base: 1, percentile: 50, reference: -2 }, new Float64Array(60).fill(3))).toEqual({ samples: 60, sourceLow: 3, sourceHigh: null, gain: 1 });
  });
});

describe('normalización: receta, motor y banderas', () => {
  it('caso 3: NaN, exclusión e intervalo de referencia en MD; bandera 256 en toda salida finita', async () => {
    const r = await evaluate(setNormalization(masked(), 'w', 'C', twoPoint(), 'unused'));
    expect(r.payload.normalization).toEqual({ samples: 72, sourceLow: 34.8, sourceHigh: 66.42500000000001, gain: expect.any(Number), outOfDomain: 0 });
    close(r.payload.normalization!.gain, 1.8972332015810267);
    const expected: Record<number, number | null> = { 0: 48.83794466403161, 3: null, 9: 46.46640316205533, 20: null, 50: 47.889328063241095, 99: 22.750988142292496 };
    for (const [k, v] of Object.entries(expected)) {
      const got = r.payload.data[Number(k)]!;
      if (v === null) expect(got).toBeNaN();
      else close(got, v);
    }
    expect(Array.from(r.payload.data).filter(Number.isFinite).length).toBe(90);
    expect(r.payload.quality[3]).toBe(Quality.OriginallyMissing);
    expect(r.payload.quality[20]).toBe(Quality.Excluded);
    expect(r.payload.quality[0]).toBe(Quality.Normalized);
    expect(normalizationQualityCounts(r.payload.quality)).toEqual({ normalized: 90, outOfDomain: 0 });
    expect(r.entry.interpretation.preparation!.schemaVersion).toBe(6);
    expect(r.entry.interpretation.preparation!.nodes[0]!.kind).toBe('linear-normalization');
    expect(r.entry.interpretation.sources.GR).toEqual({ kind: 'curve', curveId: 'prep:n:masked' });
    // Originales intactos.
    expect(Number.isNaN(r.entry.well.curves[0]!.data[3])).toBe(true);
    expect(r.entry.well.curves[0]!.data[0]).toBe(50);
  });
  it('desplazamiento y escala de un punto (caso 4 de la referencia)', async () => {
    const shift = await evaluate(setNormalization(masked(), 'w', 'C', { method: 'shift', top: 5, base: 45, percentile: 50, reference: 60 }, 'u'));
    close(shift.payload.normalization!.sourceLow, 50.125);
    expect(shift.payload.normalization!.sourceHigh).toBeNull();
    close(shift.payload.data[50]!, 59.375);
    close(shift.payload.data[99]!, 46.125);
    const scale = await evaluate(setNormalization(masked(), 'w', 'C', { method: 'scale', top: 5, base: 45, percentile: 50, reference: 75 }, 'u'));
    close(scale.payload.normalization!.gain, 1.4962593516209477);
    close(scale.payload.data[50]!, 74.06483790523691);
    close(scale.payload.data[99]!, 54.239401496259354);
  });
  it('fuera del dominio físico: conserva el valor, marca 128 + 256 y lo cuenta', async () => {
    const nphi = series(120);
    const project = setNormalization(fixture(nphi, 'NPHI', 1), 'w', 'C', { method: 'two-point', top: 0, base: 119, lowPercentile: 10, highPercentile: 90, lowReference: -0.1, highReference: 0.95 }, 'n');
    const r = await evaluate(project);
    expect(r.payload.normalization!.outOfDomain).toBe(16);
    expect(normalizationQualityCounts(r.payload.quality)).toEqual({ normalized: 120, outOfDomain: 16 });
    const k = Array.from(r.payload.data).findIndex((v) => v > 1);
    expect(r.payload.quality[k]).toBe(Quality.Normalized | Quality.OutOfDomain);
    close(Math.max(...r.payload.data), 1.1064578163771712);
    // Un paquete con la bandera de dominio alterada o sin 256 se rechaza.
    const bad = (q: Uint16Array, stats = r.payload.normalization) => () => validatePreparedPayloads(r.plan, [{ ...r.payload, quality: q, ...(stats ? { normalization: stats } : {}) }], 120);
    expect(bad(r.payload.quality)).not.toThrow();
    const noFlag = r.payload.quality.slice(); noFlag[0] = 0;
    expect(bad(noFlag)).toThrow(/bandera de normalización/);
    const lost = r.payload.quality.slice(); lost[k] = Quality.Normalized;
    expect(bad(lost)).toThrow(/fuera de dominio/);
    expect(() => validatePreparedPayloads(r.plan, [{ ...r.payload, normalization: undefined }], 120)).toThrow(/Estadísticas/);
  });
  it('rechaza en la evaluación un intervalo con menos de 50 muestras o constante, con el motivo', async () => {
    await expect(evaluate(setNormalization(masked(), 'w', 'C', twoPoint({ top: 5, base: 20 }), 'u'))).rejects.toThrow(/al menos 50/);
    await expect(evaluate(setNormalization(fixture(Array<number>(100).fill(7)), 'w', 'C', twoPoint({ top: 0, base: 49.5 }), 'u'))).rejects.toThrow(/iguales/);
  });
  it('compone después de interpolación, mediana y alineación, y cada etapa se quita sin perder las otras', async () => {
    const data = case3Data();
    const fill = setGapFill(fixture(data), 'w', 'C', { top: 0, base: 49.5, maxGapM: 1 }, 'n');
    const filter = setMedianFilter(fill, 'w', 'C', { top: 0, base: 49.5, radiusM: 1, maxStepM: 1 }, 'u');
    const shifted = setDepthShift(filter, 'w', 'C', { offsetM: 1, maxGapM: 1, referenceId: 'w', depthKind: 'MD', datum: 'KB' }, 'u');
    const all = setNormalization(shifted, 'w', 'C', twoPoint(), 'u');
    const node = all.wells[0]!.interpretation.preparation!.nodes[0]!;
    expect(node.kind).toBe('linear-normalization');
    expect(Object.keys(node).sort()).toEqual(['enabled', 'filter', 'gapFill', 'id', 'input', 'intervals', 'kind', 'methodVersion', 'normalization', 'shift']);
    const prior = await evaluate(shifted), r = await evaluate(all);
    // La normalización es un mapa por muestra sobre la etapa anterior: mismas banderas + 256, valores transformados.
    const config = node.kind === 'linear-normalization' ? node.normalization : twoPoint();
    for (let k = 0; k < 100; k++) {
      const x = prior.payload.data[k]!;
      if (Number.isFinite(x)) {
        const y = normalizeValue(x, config, r.payload.normalization!);
        expect(r.payload.quality[k]).toBe(prior.payload.quality[k]! | Quality.Normalized | (y < 0 ? Quality.OutOfDomain : 0));
        close(r.payload.data[k]!, y);
      } else {
        expect(r.payload.data[k]).toBeNaN();
        expect(r.payload.quality[k]).toBe(prior.payload.quality[k]);
      }
    }
    expect(r.payload.sourceCounts).toEqual(prior.payload.sourceCounts);
    // Quitar etapas conserva la normalización; quitar la normalización vuelve a la receta anterior.
    expect(removeNormalization(all, 'w', 'n').wells[0]!.interpretation).toEqual(shifted.wells[0]!.interpretation);
    for (const removed of [removeDepthShift(all, 'w', 'n'), removeMedianFilter(all, 'w', 'n'), removeGapFill(all, 'w', 'n')]) expect(removed.wells[0]!.interpretation.preparation!.nodes[0]!.kind).toBe('linear-normalization');
    expect(setGapFill(all, 'w', 'C', { top: 0, base: 49.5, maxGapM: 2 }, 'u').wells[0]!.interpretation.preparation!.nodes[0]!.kind).toBe('linear-normalization');
    expect(addMaskInterval(all, 'w', 'C', { id: 'x', top: 30, base: 31 }, 'u').wells[0]!.interpretation.preparation!.nodes[0]!.kind).toBe('linear-normalization');
    // Sola, quitarla restaura el original y la fuente.
    const alone = setNormalization(fixture(), 'w', 'C', twoPoint(), 'solo');
    const back = removeNormalization(alone, 'w', 'solo').wells[0]!.interpretation;
    expect(back.preparation).toBeUndefined();
    expect(back.sources.GR).toEqual({ kind: 'curve', curveId: 'C' });
    expect(restoreMaskInterval(alone, 'w', 'solo').wells[0]!.interpretation.preparation).toBeUndefined();
  });
  it('misma receta es no-op; otra receta cambia el contexto; cancelación no cachea', async () => {
    const a = setNormalization(fixture(), 'w', 'C', twoPoint(), 'n');
    expect(setNormalization(a, 'w', 'C', twoPoint(), 'otro')).toBe(a);
    const b = setNormalization(a, 'w', 'C', twoPoint({ highReference: 81 }), 'otro');
    expect(b.wells[0]!.interpretation.preparation!.nodes[0]!.id).toBe('n');
    const ra = await evaluate(a), rb = await evaluate(b);
    expect(ra.plan.context.preparationKey).not.toBe(rb.plan.context.preparationKey);
    expect(preparationStateKey(a.wells[0]!.interpretation.preparation)).not.toBe(preparationStateKey(b.wells[0]!.interpretation.preparation));
    const ev = new MaskEvaluator(), entry = a.wells[0]!, plan = entryPreparationPlan(a, entry, registry);
    await expect(ev.evaluate(toEngineWell(entry.well), plan, () => true)).rejects.toBeInstanceOf(PreparationCancelled);
    expect(ev.retainedBytes).toBe(0);
  });
  it('no se combina con MGT ni con curvas sin rol medido, ni fuera del pozo', () => {
    expect(() => setNormalization(fixture(), 'w', 'C', twoPoint({ top: -1 }), 'n')).toThrow(/dentro del pozo/);
    const flag = addWell(createProject(), createWell({ id: 'w', name: 'W', depth: Float64Array.from({ length: 60 }, (_, i) => i), curves: [{ ...curve('F', null, Array<number>(60).fill(1)), origin: { kind: 'measured' } }] }));
    expect(() => setNormalization(flag, 'w', 'F', twoPoint({ top: 0, base: 59 }), 'n')).toThrow(/La normalización requiere un rol/);
  });
  it('deshacer y rehacer: aplicar es un paso; guardar y reabrir v7 conserva la normalización', async () => {
    const store = useProject.getState(), original = masked();
    store.replace(original);
    store.commit('Normalizar C', (p) => setNormalization(p, 'w', 'C', twoPoint(), 'u'), { group: 'norm' });
    const applied = useProject.getState().project;
    store.undo();
    expect(useProject.getState().project).toBe(original);
    store.redo();
    expect(useProject.getState().project).toBe(applied);
    store.replace(createProject());
    const snap = createSnapshot(applied, 'w', 'Normalizada', { id: 's' }).project;
    const text = await serializeProject(snap), raw = JSON.parse(text);
    expect(raw.version).toBe(7);
    expect(raw.project.wells[0].interpretation.preparation.schemaVersion).toBe(6);
    expect(raw.project.wells[0].interpretation.preparation.nodes[0].normalization).toEqual(twoPoint());
    const reopened = await deserializeProject(text);
    expect(reopened.wells[0]!.interpretation.preparation).toEqual(applied.wells[0]!.interpretation.preparation);
    expect(withoutSavedAt(await serializeProject(reopened))).toBe(withoutSavedAt(text));
    const restored = restoreSnapshot(removeNormalization(reopened, 'w', 'n'), 's');
    expect((await evaluate(restored)).payload.normalization!.samples).toBe(72);
    raw.project.wells[0].interpretation.preparation.nodes[0].normalization.highReference = 10;
    await expect(deserializeProject(JSON.stringify(raw))).rejects.toThrow();
  });
});

describe('normalización: esquema v6 y migración desde 1–5', () => {
  const node = (normalization: unknown, extra: Record<string, unknown> = {}) => ({ id: 'n', kind: 'linear-normalization', methodVersion: 1, enabled: true, input: { kind: 'original', inputRevisionId: 'r', curveId: 'C' }, intervals: [], normalization, ...extra });
  it('valida la forma exacta y el dominio de cada método', () => {
    expect(() => validateNormalization(twoPoint())).not.toThrow();
    expect(() => validateNormalization({ method: 'shift', top: 0, base: 1, percentile: 50, reference: -3 })).not.toThrow();
    for (const bad of [
      { ...twoPoint(), extra: 1 },
      { method: 'two-point', top: 0, base: 1, lowPercentile: 5, highPercentile: 95, lowReference: 0 },
      { method: 'otro', top: 0, base: 1, percentile: 5, reference: 1 },
      { method: 'shift', top: 0, base: 1, percentile: 50, reference: 1, lowReference: 0 },
      twoPoint({ top: 5, base: 5 }),
      twoPoint({ top: NaN }),
      twoPoint({ lowPercentile: 95, highPercentile: 95 }),
      twoPoint({ lowPercentile: -1 }),
      twoPoint({ highPercentile: 100.5 }),
      twoPoint({ lowReference: 80, highReference: 20 }),
      twoPoint({ lowReference: 20, highReference: 20 }),
      twoPoint({ highReference: Infinity }),
      { method: 'scale', top: 0, base: 1, percentile: 50, reference: 0 },
      { method: 'shift', top: 0, base: 1, percentile: 50, reference: NaN },
      { method: 'shift', top: 0, base: 1, percentile: '50', reference: 1 },
    ]) expect(() => validateNormalization(bad), JSON.stringify(bad)).toThrow();
  });
  it('la versión es la mínima del contenido: 6 solo con normalización', () => {
    const n = node(twoPoint());
    expect(() => validatePreparation({ schemaVersion: 6, nodes: [n] })).not.toThrow();
    expect(() => validatePreparation({ schemaVersion: 5, nodes: [n] })).toThrow(/versión/);
    expect(() => validatePreparation({ schemaVersion: 6, nodes: [{ ...n, kind: 'mask', normalization: undefined }] })).toThrow();
    const mask = { id: 'm', kind: 'mask', methodVersion: 1, enabled: true, input: { kind: 'original', inputRevisionId: 'r', curveId: 'C' }, intervals: [{ id: 'a', top: 0, base: 1 }] };
    expect(() => validatePreparation({ schemaVersion: 6, nodes: [mask] })).toThrow(/versión/);
    expect(() => validatePreparation({ schemaVersion: 7, nodes: [mask] })).toThrow();
    // Campos opcionales de etapas previas validados; claves ajenas rechazadas.
    expect(() => validatePreparation({ schemaVersion: 6, nodes: [node(twoPoint(), { gapFill: { top: 0, base: 1, maxGapM: 0 } })] })).toThrow();
    expect(() => validatePreparation({ schemaVersion: 6, nodes: [node(twoPoint(), { shift: { offsetM: 1, maxGapM: 1, referenceId: 'w', depthKind: 'MD', datum: 'KB' } })] })).not.toThrow();
    expect(() => validatePreparation({ schemaVersion: 6, nodes: [node(twoPoint(), { mgt: {} })] })).toThrow();
    expect(() => validatePreparation({ schemaVersion: 6, nodes: [node({ ...twoPoint(), lowReference: 90 })] })).toThrow();
    expect(preparationState([n as never]).schemaVersion).toBe(6);
    expect(preparationState([mask as never]).schemaVersion).toBe(1);
  });
  it('proyectos y snapshots v1–v4 guardados ANTES de 0060 abren idénticos y se reescriben byte a byte', async () => {
    const fixtureFile = legacy as unknown as { projects: { label: string; schemaVersion: number; text: string; stateKey: string; preparationKey: string; engineKey: string; artifacts: { id: string; version: string; data: (number | null)[]; quality: number[]; sourceCounts?: unknown }[] }[] };
    expect(fixtureFile.projects.map((p) => p.schemaVersion)).toEqual([1, 2, 3, 4]);
    for (const old of fixtureFile.projects) {
      const project = await deserializeProject(old.text);
      // Byte a byte, salvo la marca de hora de guardado.
      expect(withoutSavedAt(await serializeProject(project)), old.label).toBe(withoutSavedAt(old.text));
      const entry = project.wells[0]!;
      expect(entry.interpretation.preparation!.schemaVersion).toBe(old.schemaVersion);
      const plan = entryPreparationPlan(project, entry, registry);
      expect(plan.stateKey).toBe(old.stateKey);
      // Las claves de identidad de arrays son contadores de la sesión: se comparan sin su número.
      expect(anonymous(plan.context.preparationKey)).toBe(anonymous(old.preparationKey));
      expect(anonymous(plan.context.engineKey)).toBe(anonymous(old.engineKey));
      const artifacts = await new MaskEvaluator().evaluate(toEngineWell(entry.well), plan);
      expect(artifacts.map((a) => ({ id: a.id, version: anonymous(a.version), data: Array.from(a.data, (v) => (Number.isNaN(v) ? null : v)), quality: Array.from(a.quality), ...(a.sourceCounts ? { sourceCounts: a.sourceCounts } : {}) }))).toEqual(old.artifacts.map((a) => ({ ...a, version: anonymous(a.version) })));
      expect(artifacts.every((a) => a.normalization === undefined)).toBe(true);
      // El snapshot viejo se restaura con la misma receta.
      const restored = restoreSnapshot(project, project.snapshots[0]!.id);
      expect(restored.wells[0]!.interpretation.preparation).toEqual(entry.interpretation.preparation);
      // Normalizar después sube a v6 sin tocar las otras recetas.
      const curveId = entry.interpretation.preparation!.nodes[0]!.input.curveId;
      const next = setNormalization(project, 'w', curveId, { method: 'shift', top: 1000, base: 1019.5, percentile: 50, reference: 60 }, 'nueva');
      const nodes = next.wells[0]!.interpretation.preparation!;
      expect(nodes.schemaVersion).toBe(6);
      expect(nodes.nodes.slice(1)).toEqual(entry.interpretation.preparation!.nodes.slice(1));
    }
  });
});
