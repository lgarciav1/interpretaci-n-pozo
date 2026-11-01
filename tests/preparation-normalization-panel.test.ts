/**
 * Normalización (0060): lógica pura de la herramienta (estado previo, muestra, histograma, marcadores), exportación,
 * informe y comando de la paleta. Sin píxeles.
 */
import { describe, expect, it } from 'vitest';
import { curve, linearModule } from './helpers';
import { createWell } from '../src/core/well';
import { createRegistry } from '../src/core/registry';
import { addWell, createProject } from '../src/core/state/project';
import { addMaskInterval, entryPreparationPlan, setNormalization } from '../src/core/state/preparation';
import { toEngineWell } from '../src/core/engine/engine';
import { createInProcessClient, type ClientResult } from '../src/core/engine/client';
import { MaskEvaluator } from '../src/core/preparation/evaluate';
import { Quality } from '../src/core/preparation/quality';
import type { CurveNormalization } from '../src/core/preparation/state';
import { percentileSorted } from '../src/core/preparation/normalization';
import { draggedPercentile, histogramFraction, histogramModel, histogramValueAt, isIdentity, nearestMarker, normalizationPreview, referenceIndices, stagePriorView } from '../src/modules/preparation/normalizationView';
import { exportSources } from '../src/app/export/exportActions';
import { buildReportModel } from '../src/app/report/report';
import { preparationReportHtml } from '../src/app/report/preparationReport';
import { escapeReportText } from '../src/app/report/report';
import { commands, NORMALIZATION_COMMAND_ID } from '../src/modules/preparation/commands';
import { usePreparationUi } from '../src/app/preparation/store';
import { useProject } from '../src/app/store/project';
import { useUi } from '../src/app/store/ui';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
const data = Array.from({ length: 100 }, (_, i) => ([3, 17, 40, 41, 42].includes(i) ? NaN : 50 + ((i * 13) % 29) - 0.25 * i));
const project = () => addMaskInterval(addWell(createProject(), createWell({ id: 'w', name: 'W', depth: Float64Array.from(data, (_, i) => i * 0.5), curves: [{ ...curve('C', 'GR', data), origin: { kind: 'measured' } }] })), 'w', 'C', { id: 'r', top: 10, base: 12 }, 'n');
const config: CurveNormalization = { method: 'two-point', top: 5, base: 45, lowPercentile: 5, highPercentile: 95, lowReference: 20, highReference: 80 };

async function run(p: ReturnType<typeof project>) {
  const entry = p.wells[0]!, plan = entryPreparationPlan(p, entry, registry), client = createInProcessClient(registry);
  try {
    const response = new Promise<ClientResult>((resolve, reject) => {
      const off = client.subscribe((event) => {
        if (event.type === 'result') { off(); resolve(event.result); } else if (event.type === 'error') { off(); reject(new Error(event.message)); }
      });
    });
    client.syncWell(toEngineWell(entry.well), plan.context);
    client.run(entry.interpretation, plan.context, plan);
    return { entry, plan, result: await response };
  } finally {
    client.dispose();
  }
}

describe('herramienta Normalizar: lógica pura', () => {
  it('reconstruye el estado previo invirtiendo la normalización aplicada (y quita solo sus banderas)', async () => {
    const before = project(), after = setNormalization(before, 'w', 'C', config, 'u');
    const ev = new MaskEvaluator();
    const evaluate = async (p: typeof before) => (await ev.evaluate(toEngineWell(p.wells[0]!.well), entryPreparationPlan(p, p.wells[0]!, registry)))[0]!;
    const prior = await evaluate(before), normalized = await evaluate(after);
    const back = stagePriorView(normalized, config, normalized.normalization);
    expect(Array.from(back.quality)).toEqual(Array.from(prior.quality));
    for (let i = 0; i < 100; i++) {
      if (Number.isNaN(prior.data[i]!)) expect(back.data[i]).toBeNaN();
      else expect(back.data[i]).toBeCloseTo(prior.data[i]!, 12);
    }
    // Sin normalización, la vista es la misma.
    expect(stagePriorView(prior, undefined, undefined)).toBe(prior);
  });
  it('muestra de origen del intervalo, vista previa local igual al motor e identidad', async () => {
    const p = project(), prior = (await new MaskEvaluator().evaluate(toEngineWell(p.wells[0]!.well), entryPreparationPlan(p, p.wells[0]!, registry)))[0]!;
    const depth = p.wells[0]!.well.depth.values;
    const idx = referenceIndices(depth, prior, 5, 45);
    expect(idx.length).toBe(72);
    expect(idx[0]).toBe(10);
    expect(idx.includes(20)).toBe(false); // excluida
    const local = normalizationPreview(prior, idx, config);
    expect(local.problem).toBeNull();
    expect(local.stats!.sourceLow).toBeCloseTo(34.8, 12);
    expect(local.stats!.sourceHigh).toBeCloseTo(66.42500000000001, 12);
    expect(local.after![0]).toBeCloseTo(20 + (local.sorted[0]! - 34.8) * local.stats!.gain, 12);
    const engine = (await new MaskEvaluator().evaluate(toEngineWell(p.wells[0]!.well), entryPreparationPlan(setNormalization(p, 'w', 'C', config, 'u'), setNormalization(p, 'w', 'C', config, 'u').wells[0]!, registry)))[0]!;
    expect(engine.normalization!.sourceLow).toBe(local.stats!.sourceLow);
    expect(engine.normalization!.gain).toBe(local.stats!.gain);
    expect(normalizationPreview(prior, idx.subarray(0, 10), config).problem).toMatch(/al menos 50/);
    const identity: CurveNormalization = { ...config, lowReference: local.stats!.sourceLow, highReference: local.stats!.sourceHigh! };
    expect(isIdentity(identity, normalizationPreview(prior, idx, identity).stats!)).toBe(true);
    expect(isIdentity(config, local.stats!)).toBe(false);
    expect(isIdentity({ method: 'scale', top: 5, base: 45, percentile: 50, reference: percentileSorted(local.sorted, 50) }, { sourceLow: percentileSorted(local.sorted, 50), gain: 1 })).toBe(true);
  });
  it('histograma: clases comunes, porcentajes y acumulada que llega a 100; escala log geométrica', () => {
    const before = Float64Array.from({ length: 200 }, (_, i) => i / 2), after = before.map((v) => v * 1.5 + 10);
    const m = histogramModel(before, after, false)!;
    const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0);
    expect(m.edges.length).toBeGreaterThanOrEqual(9);
    expect(m.edges.length).toBeLessThanOrEqual(61);
    expect(sum(m.before.percent) + (100 * (m.before.below + m.before.above)) / m.before.n).toBeCloseTo(100, 9);
    expect(m.before.cumulative.at(-1)! + (100 * m.before.above) / m.before.n).toBeCloseTo(100, 9);
    expect(m.after!.n).toBe(200);
    for (let j = 1; j < m.before.cumulative.length; j++) expect(m.before.cumulative[j]!).toBeGreaterThanOrEqual(m.before.cumulative[j - 1]!);
    expect(m.lo).toBeLessThan(0.5);
    expect(m.hi).toBeGreaterThan(150);
    // Fracción e inversa.
    expect(histogramValueAt(m, histogramFraction(m, 42))).toBeCloseTo(42, 9);
    const log = histogramModel(Float64Array.from({ length: 100 }, (_, i) => 10 ** (i / 50)), null, true)!;
    const r = log.edges[1]! / log.edges[0]!;
    expect(log.edges[2]! / log.edges[1]!).toBeCloseTo(r, 9);
    expect(log.after).toBeNull();
    expect(histogramModel([1], null, false)).toBeNull();
    // Los valores de referencia entran en el rango del eje.
    expect(histogramModel(before, null, false, [500])!.hi).toBeGreaterThan(500);
  });
  it('marcadores: arrastrar a un valor da su percentil (0,1), sin cruzar el otro; el más cercano dentro de la tolerancia', () => {
    const sorted = Float64Array.from({ length: 101 }, (_, i) => i);
    expect(draggedPercentile(sorted, 12.34, 'single', null)).toBe(12.3);
    expect(draggedPercentile(sorted, 80, 'low', 60)).toBe(59);
    expect(draggedPercentile(sorted, 10, 'high', 60)).toBe(61);
    expect(draggedPercentile(sorted, -5, 'low', 95)).toBe(0);
    expect(draggedPercentile(sorted, 500, 'high', 5)).toBe(100);
    expect(nearestMarker([{ id: 'low', x: 10 }, { id: 'high', x: 30 }], 27, 8)).toBe('high');
    expect(nearestMarker([{ id: 'low', x: 10 }, { id: 'high', x: 30 }], 20, 8)).toBeNull();
  });
});

describe('normalización en la exportación y el informe', () => {
  it('la columna de calidad y la curva preparada declaran percentiles de origen, referencias, intervalo y bits 256/128', async () => {
    const p = setNormalization(project(), 'w', 'C', config, 'u');
    const { entry, plan, result } = await run(p);
    const columns = exportSources(entry.well, result, false, plan.context).columns;
    const qc = columns.find((c) => c.id === 'q:prep:n:masked')!;
    expect(qc.description).toContain('Normalización dos puntos');
    expect(qc.description).toContain('P5 de origen 34.8 → 20 gAPI');
    expect(qc.description).toContain('P95 de origen 66.425 → 80 gAPI');
    expect(qc.description).toContain('intervalo de referencia 5–45 m MD (72 muestras de origen)');
    expect(qc.description).toContain('256=normalizada');
    expect(qc.data[0]).toBe(Quality.Normalized);
    expect(columns.find((c) => c.id === 'm:prep:n:masked')!.description).toContain('Normalización dos puntos');
  });
  it('el informe de preparación lista método, intervalo, percentiles de origen, referencias y conteos', async () => {
    const p = setNormalization(project(), 'w', 'C', config, 'u');
    const { entry, result } = await run(p);
    const model = buildReportModel(entry.well, entry.interpretation, result, new Date(0), registry);
    const n = model.preparation!.normalizations;
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ curve: 'C', method: 'dos puntos', interval: { top: 5, base: 45 }, unit: 'gAPI', samples: 72, normalized: 90, outOfDomain: 0 });
    expect(n[0]!.anchors[0]!.percentile).toBe(5);
    expect(n[0]!.anchors[0]!.source).toBeCloseTo(34.8, 12);
    expect(n[0]!.anchors[1]!.reference).toBe(80);
    const html = preparationReportHtml(model.preparation!, escapeReportText);
    expect(html).toContain('Normalización de curvas');
    expect(html).toContain('P5: 34,8 → 20 gAPI');
    expect(html).toContain('Clase 8, slides 9–10');
    expect(model.warnings.join('\n')).toContain('Normalización dos puntos · C preparada');
    // Sin resultado vigente: la receta se informa igual, sin inventar percentiles de origen.
    const stale = buildReportModel(entry.well, entry.interpretation, null, new Date(0), registry).preparation!.normalizations[0]!;
    expect(stale.anchors.every((a) => a.source === null)).toBe(true);
    expect(preparationReportHtml({ ...model.preparation!, normalizations: [stale] }, escapeReportText)).toContain('sin resultado vigente');
  });
});

describe('comando de la paleta', () => {
  it('«Normalizar curva» abre Preparar datos con la herramienta, sin cambiar el proyecto', () => {
    const cmd = (typeof commands === 'function' ? commands() : []).find((c) => c.id === NORMALIZATION_COMMAND_ID)!;
    expect(cmd.title).toBe('Normalizar curva');
    expect(cmd.keywords).toContain('normalizar');
    useProject.getState().replace(project());
    const before = useProject.getState().project;
    expect(cmd.enabled!()).toBe(true);
    cmd.run!();
    expect(usePreparationUi.getState().request).toMatchObject({ curveId: null, tool: 'normalize' });
    expect(useUi.getState().dockTab).toBe('preparation');
    expect(useProject.getState().project).toBe(before);
    usePreparationUi.setState({ request: null });
    useProject.getState().replace(createProject());
  });
});
