/** F22, ADR 0078. Exploratory model selection; never an independent validation.
 * Errors in v/v: RMSE=sqrt(mean((prediction-reference)^2)), MAE=mean(abs(error)),
 * bias=mean(error). References: Asquith & Krygowski (2004); Bateman (1985).
 * Reuses the production engine and its scientific equations rather than a parallel model.
 */
import { Engine, type EngineWell } from '../core/engine/engine';
import type { Interpretation } from '../core/interpretation';
import type { Registry } from '../core/registry';
import { matchLogToPlugs } from './coreCalibration';
import { VSH_METHODS, type VshMethod } from './vsh';

export const POROSITY_METHODS = ['densityNeutron', 'densityNeutronGas', 'density', 'neutron', 'sonic'] as const;
export const SW_MODULES = ['sw-archie', 'sw-simandoux', 'sw-indonesia'] as const;
export interface TournamentCandidate {
  id: string;
  vshMethod: VshMethod;
  porosityMethod: typeof POROSITY_METHODS[number];
  swModuleId: typeof SW_MODULES[number];
}
export const TOURNAMENT_CANDIDATES: readonly TournamentCandidate[] = VSH_METHODS.flatMap(vshMethod =>
  POROSITY_METHODS.flatMap(porosityMethod => SW_MODULES.map(swModuleId => ({
    id: `${vshMethod}/${porosityMethod}/${swModuleId}`, vshMethod, porosityMethod, swModuleId,
  }))));
export interface TournamentObservation { id: string; depth: number; value: number; usage: 'evaluation' | 'calibration'; source?: string; synthetic?: boolean }
export interface TournamentConfig { halfWindowM: number; minSupport: number; minCoverage: number }
export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = { halfWindowM: 0, minSupport: 5, minCoverage: 0.8 };
export interface TournamentMetric {
  n: number; total: number; coverage: number; rmse: number | null; mae: number | null; bias: number | null; supported: boolean;
}
export interface TournamentUnavailable { status: 'not-evaluable'; reason: string }
export interface TournamentCalculatedCoverage { n: number; total: number; coverage: number }
export interface TournamentRow {
  candidate: TournamentCandidate;
  calculatedCoverage: { phi: TournamentCalculatedCoverage; vsh: TournamentCalculatedCoverage; sw: TournamentCalculatedCoverage };
  applicable: boolean;
  diagnostics: string[];
  phi: TournamentMetric;
  commonPhi: TournamentMetric;
  sw: TournamentUnavailable;
  vsh: TournamentUnavailable;
}
export interface TournamentResult {
  version: 1;
  executionContext?: import('../core/engine/context').EngineContext;
  assessment: 'exploratory';
  config: TournamentConfig;
  rows: TournamentRow[];
  commonSupport: number;
  calibrationCount: number;
  evaluationCount: number;
  invalidCount: number;
  observationEvidence: { id: string; usage: 'evaluation' | 'calibration'; depth: number | null; value: number | null; source?: string; synthetic?: boolean }[];
  limits: string[];
}
export interface TournamentPrediction { candidate: TournamentCandidate; phi: ArrayLike<number>; vsh?: ArrayLike<number>; sw?: ArrayLike<number>; diagnostics?: string[] }

/** Same interpretation used both to run a candidate and to apply it. Overrides methods in every zone.
 * Keep all other explicit sources, PHIE, preparation recipes, parameters and user decisions unchanged.
 */
export function tournamentInterpretation(interp: Interpretation, candidate: TournamentCandidate): Interpretation {
  if (!TOURNAMENT_CANDIDATES.some(c => c.id === candidate.id && c.vshMethod === candidate.vshMethod && c.porosityMethod === candidate.porosityMethod && c.swModuleId === candidate.swModuleId)) throw new Error('Combinación del torneo inválida.');
  const methods = { 'vsh.method': candidate.vshMethod, 'phit.method': candidate.porosityMethod };
  const zones = Object.fromEntries(Object.entries(interp.params.zones).map(([id, params]) => [id, { ...params, ...methods }]));
  for (const zone of interp.zones) zones[zone.id] = { ...zones[zone.id], ...methods };
  const enabled = new Set(['vsh', 'phit', candidate.swModuleId]);
  return { ...interp, params: { global: { ...interp.params.global, ...methods }, zones },
    sources: { ...interp.sources, VSH: { kind: 'module', moduleId: 'vsh' }, PHIT: { kind: 'module', moduleId: 'phit' }, SW: { kind: 'module', moduleId: candidate.swModuleId } },
    disabled: interp.disabled.filter(id => !enabled.has(id)) };
}
function metric(refs: readonly TournamentObservation[], predicted: ArrayLike<number>, indices: readonly number[], total: number, cfg: TournamentConfig): TournamentMetric {
  let sq = 0, abs = 0, sum = 0;
  for (const i of indices) { const e = predicted[i]! - refs[i]!.value; sq += e * e; abs += Math.abs(e); sum += e; }
  const n = indices.length;
  const coverage = total ? n / total : 0;
  return { n, total, coverage, rmse: n ? Math.sqrt(sq / n) : null, mae: n ? abs / n : null, bias: n ? sum / n : null, supported: n >= cfg.minSupport && coverage >= cfg.minCoverage };
}
/** Scores own coverage and then the intersection of observations for all individually supported candidates.
 * Unavailable candidates cannot erase the intersection; unsupported candidates are never ranked on it.
 * Calibration IDs are excluded globally even if repeated as evaluation. Duplicate identities are rejected.
 */
export function scoreTournament(depth: ArrayLike<number>, predictions: readonly TournamentPrediction[], observations: readonly TournamentObservation[], config: Partial<TournamentConfig> = {}): TournamentResult {
  const cfg = { ...DEFAULT_TOURNAMENT_CONFIG, ...config };
  if (cfg.halfWindowM !== 0 || !Number.isInteger(cfg.minSupport) || cfg.minSupport < 5 || !Number.isFinite(cfg.minCoverage) || cfg.minCoverage < 0.8 || cfg.minCoverage > 1) throw new Error('Configuración de soporte del torneo inválida.');
  if (Array.from(depth).some((z, i) => !Number.isFinite(z) || (i > 0 && z <= depth[i - 1]!))) throw new Error('El torneo requiere MD creciente en metros.');
  const ids = new Set<string>();
  for (const o of observations) { if (!o.id || ids.has(o.id)) throw new Error('Identidad de observación duplicada o vacía.'); ids.add(o.id); }
  const calibrationCount = observations.filter(o => o.usage === 'calibration').length;
  const eligible = observations.filter(o => o.usage === 'evaluation' && Number.isFinite(o.depth) && Number.isFinite(o.value) && o.value >= 0 && o.value <= 0.5);
  const invalidCount = observations.length - eligible.length - calibrationCount;
  const matched = predictions.map(p => {
    if (p.phi.length !== depth.length) throw new Error('Longitud de predicción incompatible.');
    const physical = Float64Array.from(p.phi, value => Number.isFinite(value) && value >= 0 && value <= 0.5 ? value : NaN);
    const values = matchLogToPlugs(eligible.map(o => o.depth), depth, physical, 0);
    const indices = eligible.flatMap((_, i) => Number.isFinite(values[i]) && values[i]! >= 0 && values[i]! <= 0.5 ? [i] : []);
    return { p, values, indices, own: metric(eligible, values, indices, eligible.length, cfg) };
  });
  const supported = matched.filter(m => m.own.supported);
  const common = supported.length ? eligible.flatMap((_, i) => supported.every(m => Number.isFinite(m.values[i]) && m.values[i]! >= 0 && m.values[i]! <= 0.5) ? [i] : []) : [];
  const unavailableSw: TournamentUnavailable = { status: 'not-evaluable', reason: 'Sin Sw in situ compatible: el ensayo Sw–RI ajusta n y no valida SW del perfil.' };
  const unavailableVsh: TournamentUnavailable = { status: 'not-evaluable', reason: 'Sin referencia volumétrica Vsh compatible; DRX composicional no equivale automáticamente a Vsh.' };
  const coverage = (values: ArrayLike<number> | undefined, max: number): TournamentCalculatedCoverage => {
    const n = values ? Array.from(values).filter(v => Number.isFinite(v) && v >= 0 && v <= max).length : 0;
    return { n, total: depth.length, coverage: depth.length ? n / depth.length : 0 };
  };
  const rows: TournamentRow[] = matched.map(m => {
    const commonPhi = metric(eligible, m.values, m.own.supported ? common : [], eligible.length, cfg);
    const calculatedCoverage = { phi: coverage(m.p.phi, .5), vsh: coverage(m.p.vsh, 1), sw: coverage(m.p.sw, 1) };
    return { candidate: m.p.candidate, phi: m.own, commonPhi, calculatedCoverage,
      applicable: commonPhi.supported && calculatedCoverage.phi.n > 0 && calculatedCoverage.vsh.n > 0 && calculatedCoverage.sw.n > 0,
      diagnostics: [...(m.p.diagnostics ?? []), ...(!calculatedCoverage.vsh.n ? ['VSH sin valores calculados válidos.'] : []), ...(!calculatedCoverage.sw.n ? ['SW sin valores calculados válidos.'] : [])],
      sw: unavailableSw, vsh: unavailableVsh };
  });
  rows.sort((a, b) => Number(b.commonPhi.supported) - Number(a.commonPhi.supported) || ((a.commonPhi.supported ? a.commonPhi.rmse! : Infinity) - (b.commonPhi.supported ? b.commonPhi.rmse! : Infinity) || a.candidate.id.localeCompare(b.candidate.id)));
  const limits = ['Selección exploratoria: procedencia de ajustes previos desconocida; no es validación independiente.',
    'Seleccionar métodos repetidamente con los mismos plugs introduce optimismo; no hay ganador integral.',
    'Se compara PHIT con porosidad de laboratorio, sin asumir equivalencia con PHIE ni condiciones de confinamiento conocidas.',
    'Interpolación lineal en MD sin extrapolación ni imputación de vecinos faltantes.'];
  if (common.length < 10) limits.push('Soporte común escaso: menos de diez plugs; alto riesgo de sobreajuste en la selección.');
  if (calibrationCount) limits.push(`${calibrationCount} observaciones declaradas de ajuste excluidas de la evaluación.`);
  const observationEvidence = observations.map(o => ({ id: o.id, usage: o.usage, depth: Number.isFinite(o.depth) ? o.depth : null, value: Number.isFinite(o.value) ? o.value : null, ...(o.source !== undefined ? { source: o.source } : {}), ...(o.synthetic !== undefined ? { synthetic: o.synthetic } : {}) }));
  return { observationEvidence, version: 1, assessment: 'exploratory', config: cfg, rows, commonSupport: common.length, calibrationCount, evaluationCount: eligible.length, invalidCount, limits };
}

/** CPU task for the dedicated tournament worker. Input well must be the central prepared projection. */
export function evaluateTournament(registry: Registry, well: EngineWell, interp: Interpretation, observations: readonly TournamentObservation[], config: Partial<TournamentConfig> = {}): TournamentResult {
  const engines = new Map(SW_MODULES.map(swModuleId => {
    const engine = new Engine(registry, { targetModuleIds: ['vsh', 'phit', swModuleId] });
    engine.setWell(well);
    return [swModuleId, engine] as const;
  }));
  const predictions = TOURNAMENT_CANDIDATES.map(candidate => {
    const run = engines.get(candidate.swModuleId)!.run(tournamentInterpretation(interp, candidate));
    const output = run.outputs.find(o => o.moduleId === 'phit' && o.port === 'PHIT');
    const phi = output?.value instanceof Float64Array ? output.value : new Float64Array(well.depth.length).fill(NaN);
    const values = (moduleId: string, port: string): Float64Array | undefined => {
      const value = run.outputs.find(o => o.moduleId === moduleId && o.port === port)?.value;
      return value instanceof Float64Array ? value : undefined;
    };
    return { candidate, phi, vsh: values('vsh', 'VSH'), sw: values(candidate.swModuleId, 'SW'), diagnostics: run.diagnostics.filter(d => d.level !== 'info').map(d => d.message) };
  });
  return scoreTournament(well.depth, predictions, observations, config);
}
