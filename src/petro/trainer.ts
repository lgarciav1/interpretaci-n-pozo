import type { UnitId } from '../core/units';
import { createWell, type Curve, type Segment, type Zone } from '../core/well';
import { wetResistivity } from './saturation';
import { mulberry32 } from './uncertainty';

export type TrainerRecipe = { version: 1; seed: number; noise: boolean };

export const TRAINER_PARAMETERS = {
  grClean: 32,
  grShale: 117,
  rhoMatrix: 2.65,
  rhoFluid: 1,
  a: 1,
  m: 2,
  n: 2,
  rw: 0.05,
  noise: { gr: 0.34, rhob: 0.0033, nphi: 0.002, logRt: 0.02 },
} as const;

const TOP_M = 2500;
const STEP_M = 0.25;
const SAMPLES_PER_ZONE = 400;
const SAMPLES_PER_BED = 20;
const ZONE_DESIGNS = [
  { name: 'A', color: '#e8c872', swMin: 0.68, swMax: 0.95 },
  { name: 'B', color: '#9ec5e8', swMin: 0.25, swMax: 0.55 },
  { name: 'C', color: '#f2a65a', swMin: 0.45, swMax: 0.75 },
] as const;
const SAMPLE_COUNT = ZONE_DESIGNS.length * SAMPLES_PER_ZONE;

export interface TrainerTruth {
  phi: Float64Array;
  vsh: Float64Array;
  sw: Float64Array;
}

export function trainerWellId(recipe: TrainerRecipe): string {
  return `trainer-v1-${recipe.seed}-${recipe.noise ? 'noise' : 'clean'}`;
}

/** Cuatro observaciones compatibles con IGR, Vsh lineal, densidad–neutrón, PHIE y Archie (ADR 0080). */
function generate(recipe: TrainerRecipe, truth?: TrainerTruth) {
  if (recipe.version !== 1 || !Number.isInteger(recipe.seed) || recipe.seed < 0 || recipe.seed > 0xffffffff || typeof recipe.noise !== 'boolean') {
    throw new Error('La receta del entrenador requiere versión 1, semilla entera de 32 bits sin signo y modo de ruido.');
  }

  const random = mulberry32(recipe.seed);
  const depth = Float64Array.from({ length: SAMPLE_COUNT }, (_, i) => TOP_M + STEP_M * i);
  const gr = new Float64Array(SAMPLE_COUNT);
  const rhob = new Float64Array(SAMPLE_COUNT);
  const nphi = new Float64Array(SAMPLE_COUNT);
  const rt = new Float64Array(SAMPLE_COUNT);
  const settings = TRAINER_PARAMETERS;
  const perturb = (amplitude: number) => (2 * random() - 1) * amplitude;

  // Cada lecho tiene un valor de base y variaciones por muestra acotadas a las mismas bandas.
  const inBed = (base: number) => 0.85 * base + 0.15 * random();
  const zones: Zone[] = ZONE_DESIGNS.map(({ name, color, swMin, swMax }, zoneIndex) => {
    const start = zoneIndex * SAMPLES_PER_ZONE;
    const end = start + SAMPLES_PER_ZONE;
    for (let bedStart = start; bedStart < end; bedStart += SAMPLES_PER_BED) {
      const bedPhi = random();
      const bedVsh = random();
      const bedSw = random();
      for (let i = bedStart; i < bedStart + SAMPLES_PER_BED; i++) {
        const phi = 0.12 + 0.14 * inBed(bedPhi);
        const vsh = 0.03 + 0.22 * inBed(bedVsh);
        const sw = swMin + (swMax - swMin) * inBed(bedSw);
        const phiTotal = phi / (1 - vsh);
        if (truth) {
          truth.phi[i] = phi;
          truth.vsh[i] = vsh;
          truth.sw[i] = sw;
        }

        // El modo de ruido no cambia la secuencia que siembra las propiedades.
        const grError = perturb(settings.noise.gr);
        const densityError = perturb(settings.noise.rhob);
        const neutronError = perturb(settings.noise.nphi);
        const logRtError = perturb(settings.noise.logRt);
        const r0 = wetResistivity(phi, settings.rw, settings.a, settings.m);
        gr[i] = settings.grClean + (settings.grShale - settings.grClean) * vsh + (recipe.noise ? grError : 0);
        rhob[i] = settings.rhoMatrix - (settings.rhoMatrix - settings.rhoFluid) * phiTotal + (recipe.noise ? densityError : 0);
        nphi[i] = phiTotal + (recipe.noise ? neutronError : 0);
        rt[i] = r0 / Math.pow(sw, settings.n) * Math.exp(recipe.noise ? logRtError : 0);
      }
    }
    return { id: `trainer-zone-${name.toLowerCase()}`, name, color, kind: 'formation', top: depth[start]!, base: depth[end - 1]! };
  });

  const curve = (role: string, unit: UnitId, data: Float64Array, description: string): Curve => ({
    id: role,
    mnemonic: role,
    role,
    unit,
    data,
    description,
    origin: { kind: 'measured', source: 'Entrenador sintético' },
  });
  const well = createWell({
    id: trainerWellId(recipe),
    name: 'Pozo del entrenador',
    depth,
    depthSourceUnit: 'm',
    curves: [
      curve('GR', 'gAPI', gr, 'Rayos gamma'),
      curve('RHOB', 'g/cm3', rhob, 'Densidad de formación'),
      curve('NPHI', 'v/v', nphi, 'Lectura neutrónica'),
      curve('RT', 'ohm.m', rt, 'Resistividad profunda'),
    ],
  });
  return { well, zones };
}

/** Inicio del ejercicio. Solo se devuelven las observaciones y las zonas. */
export function generateTrainerWell(recipe: TrainerRecipe) {
  return generate(recipe);
}

/** Regeneración para corregir. Las series verdaderas están separadas del pozo. */
export function generateTrainer(recipe: TrainerRecipe) {
  const truth: TrainerTruth = {
    phi: new Float64Array(SAMPLE_COUNT),
    vsh: new Float64Array(SAMPLE_COUNT),
    sw: new Float64Array(SAMPLE_COUNT),
  };
  return { ...generate(recipe, truth), truth };
}

export interface TrainerError {
  /** Errores en puntos porcentuales. */
  mae: number | null;
  rmse: number | null;
  valid: number;
  total: number;
  /** Porcentaje de muestras con par finito, o null si la zona no tiene muestras. */
  coverage: number | null;
}

interface ErrorAccumulator {
  sumAbsolute: number;
  sumSquared: number;
  valid: number;
  total: number;
}

function newAccumulator(): ErrorAccumulator {
  return { sumAbsolute: 0, sumSquared: 0, valid: 0, total: 0 };
}

function addSegment(acc: ErrorAccumulator, segment: Segment, expected: ArrayLike<number>, interpreted?: ArrayLike<number>): void {
  acc.total += segment.end - segment.start;
  for (let i = segment.start; i < segment.end; i++) {
    const actual = interpreted?.[i];
    const target = expected[i];
    if (actual === undefined || target === undefined || !Number.isFinite(actual) || !Number.isFinite(target)) continue;
    const error = 100 * (actual - target);
    acc.sumAbsolute += Math.abs(error);
    acc.sumSquared += error * error;
    acc.valid++;
  }
}

function summarize({ sumAbsolute, sumSquared, valid, total }: ErrorAccumulator): TrainerError {
  return {
    mae: valid ? sumAbsolute / valid : null,
    rmse: valid ? Math.sqrt(sumSquared / valid) : null,
    valid,
    total,
    coverage: total ? 100 * valid / total : null,
  };
}

/** Agrupa tramos según las zonas efectivas del motor, incluyendo el conjunto de muestras sin zona. */
export function trainerMetrics(
  segments: readonly Segment[],
  truth: Pick<TrainerTruth, 'phi' | 'sw'>,
  interpreted: { phi?: ArrayLike<number>; sw?: ArrayLike<number> },
) {
  const errors = new Map<string | null, { phi: ErrorAccumulator; sw: ErrorAccumulator }>();
  for (const segment of segments) {
    const zone = errors.get(segment.zoneId) ?? { phi: newAccumulator(), sw: newAccumulator() };
    addSegment(zone.phi, segment, truth.phi, interpreted.phi);
    addSegment(zone.sw, segment, truth.sw, interpreted.sw);
    errors.set(segment.zoneId, zone);
  }
  return Array.from(errors, ([zoneId, { phi, sw }]) => ({ zoneId, phi: summarize(phi), sw: summarize(sw) }));
}
