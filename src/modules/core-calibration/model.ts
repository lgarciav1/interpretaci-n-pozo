/**
 * Calibración con corona: modelo PURO del panel (docs/decisiones/0023-calibracion-con-corona.md).
 *
 * - Plugs incluidos con su profundidad CORREGIDA (`shiftedDepth`, la puesta en profundidad del panel «Corona»; acá
 *   nunca se recalcula ni se guarda un desplazamiento).
 * - φ perfil vs. φ corona (`matchLogToPlugs` + `calibrationStats`), densidad de matriz (grano de los plugs y ρma que
 *   iguala φD con φ corona) y exponente m (F de los plugs o Rt en una zona acuífera), todo con el motor puro
 *   `src/petro/coreCalibration.ts`.
 * - Recetas «Aplicar»: ρma de `phi-density` y a/m de Archie (compartidos), globales o de una zona, redondeados al paso
 *   del slider como los parámetros elegidos sobre los gráficos (0015). Una receta = un Ctrl+Z.
 *
 * Sin React, stores ni `src/plots` (la regla de pureza de las carpetas de módulos): lo importan el panel y los tests.
 */
import type { Interpretation } from '../../core/interpretation';
import type { TableCell } from '../../core/module';
import { paramScope, paramStorageKey, type NumberParamSpec, type ParamSpec, type ParamState } from '../../core/params';
import { pointNumbers, shiftedDepth, shiftOf, type PointSet, type PointSetDecisions } from '../../core/pointSets';
import { setParam, type Project } from '../../core/state/project';
import { layoutZones, type Zone } from '../../core/well';
import {
  calibrationStats,
  cementationExponentFromRt,
  fitCementationExponent,
  matchLogToPlugs,
  matrixDensityMatchingCore,
  summarizeValues,
  type CalibrationStats,
  type CementationResult,
  type LineFit,
  type MatrixDensityFit,
  type ValueSummary,
} from '../../petro/coreCalibration';
import { COL, coreGroups, DEFAULT_MATCH_CURVE, MATCH_CURVE_SETTING, plugStatuses } from '../core/model';
import phiDensity from '../phi-density';
import { SHARED_PARAMS } from '../sharedParams';
import coreCalibration, { CORE_CALIBRATION_ID, WHOLE_WELL_ROW } from './index';

export const CALIBRATION_DOCK_ID = 'core-calibration';

/** Ajustes del conjunto de plugs (en `Interpretation.pointSets[conjunto].settings`). No cambiarlos: se guardan. */
export const CALIB_CURVE_SETTING = 'calibCurve';
export const CALIB_WINDOW_SETTING = 'calibWindow';
/** Semiancho por defecto de la ventana del perfil (m): ≈ la resolución vertical de densidad–neutrón (0023, D4). */
export const DEFAULT_WINDOW = 0.15;
export const WINDOW_OPTIONS: readonly number[] = [0, 0.15, 0.3, 0.5];
/** Rango físico de la densidad de matriz para el ajuste a corona (arenisca–caliza–dolomía y algo de aire). */
export const RHOMA_BOUNDS: readonly [number, number] = [2.5, 3.0];

const settingOf = (dec: PointSetDecisions | undefined, key: string) => dec?.settings?.[key];

/** Curva del perfil para comparar con la φ de corona: la elegida acá o, si no, la de la puesta en profundidad. */
export function calibCurveKey(dec: PointSetDecisions | undefined): string {
  const own = settingOf(dec, CALIB_CURVE_SETTING);
  if (typeof own === 'string' && own) return own;
  const match = settingOf(dec, MATCH_CURVE_SETTING);
  return typeof match === 'string' && match ? match : DEFAULT_MATCH_CURVE;
}

/** Semiancho de la ventana (m, ≥ 0). */
export function calibWindow(dec: PointSetDecisions | undefined): number {
  const v = settingOf(dec, CALIB_WINDOW_SETTING);
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_WINDOW;
}

// ── plugs ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface IncludedPlugs {
  /** Índices en el conjunto de los plugs incluidos (y dentro del alcance, si se dio uno). */
  idx: number[];
  /** Profundidad CORREGIDA de esos plugs (m). */
  depth: Float64Array;
}

/**
 * Alcance de las estimaciones desde plugs: el de «Aplicar en». Con una zona solo cuentan los plugs cuya profundidad
 * CORREGIDA cae en ella; con `zoneId` null, todos los incluidos.
 */
export interface PlugScope {
  zones: readonly Zone[];
  zoneId: string | null;
}

/**
 * Zona de cada profundidad (id, o null fuera de las zonas), con la regla de `layoutZones`: tope ≤ z ≤ base y, si
 * hay solapamiento, gana la de tope más somero. No exige profundidades ordenadas (los plugs pueden no estarlo).
 */
export function zoneIdsAt(depth: ArrayLike<number>, zones: readonly Zone[]): (string | null)[] {
  const sorted = zones.filter((z) => Number.isFinite(z.top) && Number.isFinite(z.base) && z.top < z.base).sort((a, b) => a.top - b.top);
  return Array.from({ length: depth.length }, (_, i) => {
    const d = depth[i]!;
    return Number.isFinite(d) ? (sorted.find((z) => z.top <= d && d <= z.base)?.id ?? null) : null;
  });
}

/**
 * Plugs incluidos (decisión del usuario o propuesta de calidad) con su profundidad corregida; con un alcance de zona,
 * solo los que caen en ella.
 */
export function includedPlugs(set: PointSet, dec: PointSetDecisions | undefined, scope?: PlugScope | null): IncludedPlugs {
  const st = plugStatuses(set, dec);
  const z = shiftedDepth(set, dec);
  let idx: number[] = [];
  for (let i = 0; i < st.length; i++) if (st[i]!.included) idx.push(i);
  if (scope?.zoneId) {
    const ids = zoneIdsAt(Float64Array.from(idx, (i) => z[i]!), scope.zones);
    idx = idx.filter((_, j) => ids[j] === scope.zoneId);
  }
  return { idx, depth: Float64Array.from(idx, (i) => z[i]!) };
}

/** Cuántos plugs incluidos hay en total y cuántos entran en el alcance (para el panel). */
export function plugScopeCount(set: PointSet, dec: PointSetDecisions | undefined, scope: PlugScope): { included: number; inScope: number } {
  return { included: includedPlugs(set, dec).idx.length, inScope: includedPlugs(set, dec, scope).idx.length };
}

/** Zona con más plugs incluidos (alcance por defecto de «Aplicar»; empate: la más somera); null si ninguno cae en una zona. */
export function dominantPlugZone(set: PointSet, dec: PointSetDecisions | undefined, zones: readonly Zone[]): string | null {
  const plugs = includedPlugs(set, dec);
  const count = new Map<string, number>();
  for (const id of zoneIdsAt(plugs.depth, zones)) if (id) count.set(id, (count.get(id) ?? 0) + 1);
  let best: string | null = null;
  for (const z of [...zones].sort((a, b) => a.top - b.top)) {
    const c = count.get(z.id) ?? 0;
    if (c > 0 && (best === null || c > count.get(best)!)) best = z.id;
  }
  return best;
}

/** Valores de una columna numérica en los plugs incluidos (null si el conjunto no la tiene). */
export function plugColumn(set: PointSet, plugs: IncludedPlugs, key: string): Float64Array | null {
  const v = pointNumbers(set, key);
  return v ? Float64Array.from(plugs.idx, (i) => v[i]!) : null;
}

export type DepthMatchState = 'applied' | 'none';

/** ¿Alguna corona tiene puesta en profundidad? Sin ella se calibra contra la profundidad del archivo. */
export function depthMatchState(set: PointSet, dec: PointSetDecisions | undefined): { state: DepthMatchState; shifts: { label: string; shift: number }[] } {
  const shifts = coreGroups(set).map((g) => ({ label: g.label, shift: shiftOf(dec, g.run) }));
  return { state: shifts.some((s) => s.shift !== 0) ? 'applied' : 'none', shifts };
}

// ── φ perfil vs. φ corona ────────────────────────────────────────────────────────────────────────────────────

export interface PorosityCalibration {
  /** Índices en el conjunto de los plugs comparados (incluidos con φ de corona). */
  idx: number[];
  core: Float64Array;
  /** Perfil en cada plug (ventana ±h; NaN fuera del perfil). */
  log: Float64Array;
  stats: CalibrationStats;
}

/**
 * Calibración de la porosidad: φ del perfil (promediada en ±h alrededor de la profundidad corregida de cada plug
 * incluido y dentro del alcance) contra φ de corona. null si los plugs no tienen porosidad.
 */
export function porosityCalibration(
  set: PointSet,
  dec: PointSetDecisions | undefined,
  logDepth: ArrayLike<number>,
  logValues: ArrayLike<number>,
  h: number,
  scope?: PlugScope | null,
): PorosityCalibration | null {
  const plugs = includedPlugs(set, dec, scope);
  const core = plugColumn(set, plugs, COL.phi);
  if (!core) return null;
  const log = matchLogToPlugs(plugs.depth, logDepth, logValues, h);
  return { idx: plugs.idx, core, log, stats: calibrationStats(core, log) };
}

/** Puntos extremos de una recta y = b0 + b1·x en [lo, hi] (para dibujarla). */
export function lineOver(line: LineFit, lo: number, hi: number): { x: Float64Array; y: Float64Array } {
  return { x: Float64Array.of(lo, hi), y: Float64Array.of(line.intercept + line.slope * lo, line.intercept + line.slope * hi) };
}

// ── densidad de matriz ───────────────────────────────────────────────────────────────────────────────────────

export interface MatrixDensityEstimates {
  /** Densidad de grano de los plugs incluidos (null si no hay columna). */
  grain: ValueSummary | null;
  /** ρma que iguala φD con φ corona (null si faltan φ de corona o densidad, o no hay plugs válidos). */
  fit: MatrixDensityFit | null;
  /** ρf con la que se ajustó (la vigente de `phi-density`). */
  rhoFl: number;
}

/**
 * Las dos estimaciones de la densidad de matriz que salen de los plugs: grano (mediana y P10–P90) y la ρma que hace
 * coincidir la porosidad densidad (con la ρb del perfil en los plugs, ventana ±h) con la de corona, acotada a
 * `RHOMA_BOUNDS`. Solo los plugs del alcance (todos los incluidos, o los de la zona).
 */
export function matrixDensityEstimates(
  set: PointSet,
  dec: PointSetDecisions | undefined,
  logDepth: ArrayLike<number>,
  rhob: ArrayLike<number> | null,
  rhoFl: number,
  h: number,
  scope?: PlugScope | null,
): MatrixDensityEstimates {
  const plugs = includedPlugs(set, dec, scope);
  const g = plugColumn(set, plugs, COL.rhog);
  const grain = g ? summarizeValues(g) : null;
  const phi = plugColumn(set, plugs, COL.phi);
  let fit: MatrixDensityFit | null = null;
  if (phi && rhob) fit = matrixDensityMatchingCore(matchLogToPlugs(plugs.depth, logDepth, rhob, h), phi, rhoFl, RHOMA_BOUNDS);
  return { grain: grain && grain.n > 0 ? grain : null, fit, rhoFl };
}

export interface RhomaaZoneRow {
  /** '' = pozo completo. */
  zoneId: string;
  zone: string;
  n: number;
  median: number;
  p10: number;
  p90: number;
}

const toNum = (c: TableCell | undefined) => (typeof c === 'number' ? c : NaN);

/** Filas de la tabla `RHOMAA_ZONES` del motor, tipadas (la del pozo completo al final, como la publica el módulo). */
export function rhomaaZoneRows(rows: readonly Record<string, TableCell>[] | null | undefined): RhomaaZoneRow[] {
  return (rows ?? []).map((r) => ({
    zoneId: typeof r['zoneId'] === 'string' ? r['zoneId'] : WHOLE_WELL_ROW,
    zone: String(r['zone'] ?? ''),
    n: toNum(r['n']),
    median: toNum(r['median']),
    p10: toNum(r['p10']),
    p90: toNum(r['p90']),
  }));
}

// ── exponente de cementación ────────────────────────────────────────────────────────────────────────────────

/** m desde el factor de formación de los plugs incluidos del alcance (a fija y libre). null si no hay columna F. */
export function plugCementation(
  set: PointSet,
  dec: PointSetDecisions | undefined,
  a: number,
  scope?: PlugScope | null,
): (CementationResult & { phi: Float64Array; F: Float64Array; idx: number[] }) | null {
  const plugs = includedPlugs(set, dec, scope);
  const F = plugColumn(set, plugs, COL.ff);
  const phi = plugColumn(set, plugs, COL.phi);
  if (!F || !phi) return null;
  return { ...fitCementationExponent(phi, F, a), phi, F, idx: plugs.idx };
}

export interface LogCementation {
  /** m por muestra válida (Sw = 1) en las zonas elegidas: mediana, P10–P90. */
  perSample: ValueSummary;
  /** Ajuste de F = Rt/Rw contra φ en las mismas muestras (a fija y libre). */
  fit: CementationResult;
  /** Muestras usadas (para la nube del gráfico): φ y F = Rt/Rw. */
  phi: Float64Array;
  F: Float64Array;
}

/**
 * Exponente de cementación desde el perfil en zonas acuíferas (Sw = 1 ⇒ Rt = Ro): m por muestra con la Rt y la Rw
 * vigentes (Rw por muestra, ya corregida por temperatura), en las muestras de las zonas elegidas con φ, Rt y Rw
 * válidas y, si hay VSH, con Vsh ≤ `vshMax` (el de la zona de la muestra si se da una función). null si no hay zonas
 * elegidas.
 */
export function logCementation(input: {
  depth: ArrayLike<number>;
  zones: readonly Zone[];
  waterZones: readonly string[];
  phi: ArrayLike<number>;
  rt: ArrayLike<number>;
  rw: ArrayLike<number>;
  vsh?: ArrayLike<number> | null;
  /** Vsh máxima de las muestras limpias: un número, o una función de la zona (el parámetro `vshMax` es por zona). */
  vshMax: number | ((zoneId: string) => number);
  a: number;
}): LogCementation | null {
  const { depth, zones, waterZones, phi, rt, rw, vsh, vshMax, a } = input;
  const valid = zones.filter((z) => waterZones.includes(z.id));
  if (valid.length === 0) return null;
  const layout = layoutZones(depth, zones);
  const water = new Set(valid.map((z) => z.id));
  const allowed = layout.spans.map((sp) => water.has(sp.id));
  const vshLimit = layout.spans.map((sp) => (typeof vshMax === 'function' ? vshMax(sp.id) : vshMax));
  const ms: number[] = [];
  const ps: number[] = [];
  const Fs: number[] = [];
  const n = Math.min(depth.length, phi.length, rt.length, rw.length);
  for (let i = 0; i < n; i++) {
    const zi = layout.zoneIndex[i]!;
    if (zi < 0 || !allowed[zi]) continue;
    if (vsh && !(vsh[i]! <= vshLimit[zi]!)) continue;
    const m = cementationExponentFromRt(phi[i]!, rt[i]!, rw[i]!, a);
    if (!Number.isFinite(m)) continue;
    ms.push(m);
    ps.push(phi[i]!);
    Fs.push(rt[i]! / rw[i]!);
  }
  const phiArr = Float64Array.from(ps);
  const F = Float64Array.from(Fs);
  return { perSample: summarizeValues(ms), fit: fitCementationExponent(phiArr, F, a), phi: phiArr, F };
}

/** Recta de Archie F = a/φ^m en [lo, hi] de φ (dos puntos: es una recta en log–log). */
export function archieLine(a: number, m: number, lo: number, hi: number): { x: Float64Array; y: Float64Array } {
  return { x: Float64Array.of(lo, hi), y: Float64Array.of(a / Math.pow(lo, m), a / Math.pow(hi, m)) };
}

// ── parámetros vigentes y recetas «Aplicar» ─────────────────────────────────────────────────────────────────

/** Un parámetro del motor que escribe el panel. */
export interface CalibParam {
  spec: NumberParamSpec;
  /** Clave de almacenamiento (`paramStorageKey`): la clave si es compartido, `módulo.clave` si no. */
  storage: string;
}

function calibParam(moduleId: string, key: string, spec: ParamSpec): CalibParam {
  if (spec.type !== 'number') throw new Error(`El parámetro ${moduleId}.${key} no es numérico.`);
  return { spec, storage: paramStorageKey(moduleId, key, spec) };
}

/** ρma y ρf de la porosidad por densidad; a, m y n de Archie (compartidos por Archie, Simandoux, Indonesia y el Pickett). */
export const CALIB_PARAMS = {
  rhoMa: calibParam('phi-density', 'rhoMa', phiDensity.params.rhoMa),
  rhoFl: calibParam('phi-density', 'rhoFl', phiDensity.params.rhoFl),
  a: calibParam('sw-archie', 'a', SHARED_PARAMS.a),
  m: calibParam('sw-archie', 'm', SHARED_PARAMS.m),
  /** Exponente de saturación, compartido por los mismos modelos (0053). */
  n: calibParam('sw-archie', 'n', SHARED_PARAMS.n),
  /** Del propio módulo: ρf de ρmaa y Vsh máxima de las muestras limpias (valor por zona y m desde el perfil). */
  rhomaaFl: calibParam(CORE_CALIBRATION_ID, 'rhoFl', coreCalibration.params.rhoFl),
  vshMax: calibParam(CORE_CALIBRATION_ID, 'vshMax', coreCalibration.params.vshMax),
} as const;

/**
 * Valor efectivo de un parámetro en el alcance, como lo resuelve el motor: el de la zona si es por zona y lo tiene,
 * si no el global guardado, si no el de fábrica.
 */
export function paramValue(params: ParamState, p: CalibParam, zoneId: string | null): number {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const zoned = zoneId && paramScope(p.spec) === 'zone' ? params.zones[zoneId]?.[p.storage] : undefined;
  if (ok(zoned)) return zoned;
  const g = params.global[p.storage];
  return ok(g) ? g : p.spec.default;
}

/**
 * Valor que se guardaría: acotado al rango y redondeado al paso contado desde el mínimo, igual que el slider del
 * inspector y los parámetros elegidos sobre los gráficos (`normalizeParam`, 0015; los cuatro son lineales). NaN si no es
 * finito.
 */
export function roundedParam(p: CalibParam, v: number): number {
  if (!Number.isFinite(v)) return NaN;
  const { min, max, step } = p.spec;
  const c = Math.min(max, Math.max(min, v));
  if (!step) return c;
  const snapped = +(min + Math.round((c - min) / step) * step).toPrecision(12);
  return Math.min(max, Math.max(min, snapped));
}

/**
 * ¿El valor cabe en el rango del control (con media vuelta de paso de tolerancia, que el redondeo absorbe)? Si no,
 * `roundedParam` lo acotaría y se escribiría un número que no es el ajustado: las recetas «Aplicar» no lo escriben.
 */
export function fitsParam(p: CalibParam, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  const tol = (p.spec.step ?? 0) / 2 + 1e-9;
  return v >= p.spec.min - tol && v <= p.spec.max + tol;
}

/** ¿El valor vigente en el alcance ya es el que se aplicaría? */
export function isApplied(params: ParamState, p: CalibParam, zoneId: string | null, v: number): boolean {
  const r = roundedParam(p, v);
  return Number.isFinite(r) && Math.abs(paramValue(params, p, zoneId) - r) < 1e-9;
}

/** ¿Alguna zona tiene un valor propio de este parámetro? (al aplicar globalmente, esas zonas no cambian). */
export function zonesWithOwnValue(interp: Pick<Interpretation, 'params' | 'zones'>, p: CalibParam): Zone[] {
  return interp.zones.filter((z) => {
    const v = interp.params.zones[z.id]?.[p.storage];
    return typeof v === 'number' && Number.isFinite(v);
  });
}

/** «Aplicar ρma»: densidad de matriz de la porosidad por densidad (global o de una zona). Una receta. */
export function applyMatrixDensity(project: Project, wellId: string, rhoMa: number, zoneId: string | null): Project {
  if (!fitsParam(CALIB_PARAMS.rhoMa, rhoMa)) return project;
  const v = roundedParam(CALIB_PARAMS.rhoMa, rhoMa);
  if (!Number.isFinite(v)) return project;
  return setParam(project, wellId, CALIB_PARAMS.rhoMa.storage, v, zoneId);
}

/**
 * «Aplicar m» (y a, si se da): exponentes de Archie compartidos por los modelos de Sw (global o de una zona). Una receta.
 * Si m, o a cuando se da, cae fuera del rango del control no se escribe nada (acotar uno de los dos dejaría un par que
 * ya no es el ajustado).
 */
export function applyCementation(project: Project, wellId: string, fit: { m: number; a?: number }, zoneId: string | null): Project {
  if (!fitsParam(CALIB_PARAMS.m, fit.m) || (fit.a !== undefined && !fitsParam(CALIB_PARAMS.a, fit.a))) return project;
  const m = roundedParam(CALIB_PARAMS.m, fit.m);
  if (!Number.isFinite(m)) return project;
  let p = setParam(project, wellId, CALIB_PARAMS.m.storage, m, zoneId);
  if (fit.a !== undefined) {
    const a = roundedParam(CALIB_PARAMS.a, fit.a);
    if (Number.isFinite(a)) p = setParam(p, wellId, CALIB_PARAMS.a.storage, a, zoneId);
  }
  return p;
}

/**
 * «Aplicar n»: exponente de saturación compartido por los modelos de Sw (global o de una zona), desde el ensayo de
 * índice de resistividad de corona (0053). Una receta. Fuera del rango del control no se escribe nada.
 */
export function applySaturation(project: Project, wellId: string, n: number, zoneId: string | null): Project {
  if (!fitsParam(CALIB_PARAMS.n, n)) return project;
  const v = roundedParam(CALIB_PARAMS.n, n);
  if (!Number.isFinite(v)) return project;
  return setParam(project, wellId, CALIB_PARAMS.n.storage, v, zoneId);
}

/** a, m y n de Archie calibrados con corona (a y m del factor de formación, n del índice de resistividad). */
export interface ArchieFromCore {
  a: number;
  m: number;
  n: number;
}

/** ¿Los tres caben en el rango de sus controles? (si uno no, «Aplicar a, m y n» no escribe ninguno). */
export function archieFits(v: ArchieFromCore): boolean {
  return fitsParam(CALIB_PARAMS.a, v.a) && fitsParam(CALIB_PARAMS.m, v.m) && fitsParam(CALIB_PARAMS.n, v.n);
}

/**
 * «Aplicar a, m y n»: los tres exponentes de Archie en UNA receta (un solo Ctrl+Z), global o de una zona. Si alguno
 * cae fuera del rango de su control no se escribe nada: acotar uno dejaría un trío que no es el calibrado.
 */
export function applyArchie(project: Project, wellId: string, v: ArchieFromCore, zoneId: string | null): Project {
  if (!archieFits(v)) return project;
  let p = project;
  for (const [param, value] of [[CALIB_PARAMS.a, v.a], [CALIB_PARAMS.m, v.m], [CALIB_PARAMS.n, v.n]] as const) {
    const r = roundedParam(param, value);
    if (!Number.isFinite(r)) return project;
    p = setParam(p, wellId, param.storage, r, zoneId);
  }
  return p;
}
