import { describe, expect, it } from 'vitest';
import { computeOnce, toEngineWell, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { registry } from '../src/modules';
import { generateTrainer, generateTrainerWell, trainerMetrics, type TrainerRecipe } from '../src/petro/trainer';

const recipe: TrainerRecipe = { version: 1, seed: 73154, noise: false };

function activeCurve(run: EngineRunResult, port: string): Float64Array {
  const curve = run.outputs.find((item) => item.port === port && item.active)?.value;
  expect(curve).toBeInstanceOf(Float64Array);
  return curve as Float64Array;
}

function maxError(actual: Float64Array, expected: Float64Array): number {
  return actual.reduce((max, value, i) => Math.max(max, Math.abs(value - expected[i]!)), 0);
}

describe('Modelo directo del entrenador', () => {
  it('repite la receta v1 y publica únicamente las observaciones', () => {
    const clean = generateTrainer(recipe);
    const observations = generateTrainerWell(recipe);
    expect(observations).toEqual({ well: clean.well, zones: clean.zones });
    expect(clean.well.curves.map(({ role, unit }) => [role, unit])).toEqual([
      ['GR', 'gAPI'], ['RHOB', 'g/cm3'], ['NPHI', 'v/v'], ['RT', 'ohm.m'],
    ]);
    expect(clean.well.depth).toMatchObject({ unit: 'm', step: 0.25 });
    expect(clean.well.depth.values).toHaveLength(1200);
    expect(clean.well.depth.values[0]).toBe(2500);

    // Primera muestra de semilla 73154, con aritmética de 32 bits y el modelo directo recalculados en Python.
    expect(clean.truth.phi[0]).toBeCloseTo(0.24573528817971238, 14);
    expect(clean.truth.vsh[0]).toBeCloseTo(0.13338153865700586, 14);
    expect(clean.truth.sw[0]).toBeCloseTo(0.8183432522907388, 14);
    const expected = [43.3374307858455, 2.1821317931905337, 0.2835564889754341, 1.236414072506402];
    clean.well.curves.forEach((curve, i) => expect(curve.data[0]).toBeCloseTo(expected[i]!, 12));

    const noisy = generateTrainer({ ...recipe, noise: true });
    expect(noisy.truth).toEqual(clean.truth);
    expect(noisy.well.curves).not.toEqual(clean.well.curves);
    expect(generateTrainerWell({ ...recipe, noise: true })).toEqual({ well: noisy.well, zones: noisy.zones });
    expect(generateTrainer({ ...recipe, seed: 73155 }).truth).not.toEqual(clean.truth);
  });

  it.each([
    { noise: false, phiLimit: 1e-12, swLimit: 1e-12, vshLimit: 1e-12 },
    { noise: true, phiLimit: 0.004, swLimit: 0.05, vshLimit: 0.004 },
  ])('reconstruye el ejercicio con el registro completo del motor, ruido=$noise (ADR 0080)',
    ({ noise, phiLimit, swLimit, vshLimit }) => {
      const { well, zones, truth } = generateTrainer({ ...recipe, noise });
      const interpretation = emptyInterpretation(zones);
      interpretation.sources = {
        PHIE: { kind: 'module', moduleId: 'phie-vsh' },
        RW: { kind: 'module', moduleId: 'rw-manual' },
        SW: { kind: 'module', moduleId: 'sw-archie' },
      };
      // Parámetros de generación declarados en el ADR. Se fijan de forma independiente de las constantes del modelo.
      interpretation.params.global = {
        grClean: 32,
        grShale: 117,
        'vsh.method': 'linear',
        'phi-density.rhoMa': 2.65,
        'phi-density.rhoFl': 1,
        'phi-neutron.matrixOffset': 0,
        'phit.method': 'densityNeutron',
        'rw-manual.rwRef': 0.05,
        'rw-manual.correct': false,
        a: 1,
        m: 2,
        n: 2,
      };
      const run = computeOnce(registry, toEngineWell(well), interpretation, { checkInputs: true });
      const phi = activeCurve(run, 'PHIE');
      const sw = activeCurve(run, 'SW');
      const vsh = activeCurve(run, 'VSH');
      expect(phi).toHaveLength(well.depth.values.length);
      expect(sw).toHaveLength(well.depth.values.length);
      expect(maxError(phi, truth.phi)).toBeLessThanOrEqual(phiLimit);
      expect(maxError(sw, truth.sw)).toBeLessThanOrEqual(swLimit);
      expect(maxError(vsh, truth.vsh)).toBeLessThanOrEqual(vshLimit);

      const metrics = trainerMetrics(run.segments, truth, { phi, sw });
      expect(metrics.map((item) => item.zoneId)).toEqual(zones.map((zone) => zone.id));
      for (const zone of metrics) {
        expect(zone.phi).toMatchObject({ valid: 400, total: 400, coverage: 100 });
        expect(zone.sw).toMatchObject({ valid: 400, total: 400, coverage: 100 });
      }
    });

  it('agrupa tramos y calcula errores solo sobre pares finitos con cobertura sobre toda la zona', () => {
    const segments = [
      { zoneId: 'a', start: 0, end: 2 },
      { zoneId: null, start: 2, end: 3 },
      { zoneId: 'a', start: 3, end: 4 },
    ];
    const truth = {
      phi: Float64Array.of(0.125, 0.25, 0.25, 0.375),
      sw: Float64Array.of(0.5, 0.5, 0.75, 0.75),
    };
    const [{ phi, sw }, unzoned] = trainerMetrics(segments, truth, { phi: [0.25, NaN, Infinity, 0.125] });
    expect(phi).toMatchObject({ mae: 18.75, valid: 2, total: 3, coverage: 200 / 3 });
    expect(phi.rmse).toBeCloseTo(19.764235376052373, 12);
    expect(sw).toEqual({ mae: null, rmse: null, valid: 0, total: 3, coverage: 0 });
    expect(unzoned).toMatchObject({ zoneId: null, phi: { valid: 0, total: 1, coverage: 0 } });
  });
});
