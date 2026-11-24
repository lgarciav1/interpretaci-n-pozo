/**
 * Datos de corona: modelo puro del módulo (docs/decisiones/0010-datos-de-corona.md).
 *
 * - Ids que se guardan en el proyecto (proveedor de series, superposición, claves de serie, ajustes): no cambiarlos.
 * - Calidad de los plugs: reglas que PROPONEN descartar (sin φ ni k, φ fuera de rango, k ≤ 0, densidad de grano fuera
 *   de rango, plug fisurado o dañado según la descripción). Decide el usuario (`Interpretation.pointSets`).
 * - Coronas (grupos de puesta en profundidad): la columna `run` del conjunto (`RUN_COLUMN` del núcleo).
 * - Modelo k–φ hacia el motor: conversión de las tendencias exponencial y potencial, receta «Aplicar al pozo»
 *   (parámetros del módulo `perm-core`, globales o de una zona, y opcionalmente fuente de PERM) y estado de
 *   sincronización entre el ajuste y los parámetros.
 *
 * Sin React ni stores ni `src/plots`: lo importan el proveedor de series, la superposición, el panel y los tests.
 */
import type { Interpretation, JsonValue } from '../../core/interpretation';
import { listRuns, pointNumbers, pointRuns, pointTexts, RUN_COLUMN, shiftOf, type PointSet, type PointSetDecisions } from '../../core/pointSets';
import { clearParam, getWellEntry, setModuleState, setParam, setSource, type Project } from '../../core/state/project';
import { expTrendToLogLinear, isPowerPermModel, type CorePermModel, type LogLinearPermModel } from '../../petro/permeability';
import type { TrendCoefficients } from '../../petro/regression';
import { effectivePermCoreModel, isValidPowerModel, PERM_CORE_ID, PERM_CORE_KEYS } from '../perm-core/params';

export { PERM_CORE_DEFAULTS, PERM_CORE_KEYS } from '../perm-core/params';

export const CORE_KIND = 'core';
export const CORE_PROVIDER_ID = 'core';
export const CORE_OVERLAY_ID = 'core';
export const CORE_DOCK_ID = 'core';
/** Clave de serie del crossplot k–φ de un conjunto: `<conjunto>:kphi`. */
export const KPHI = 'kphi';
/** Ajuste del conjunto: curva del perfil contra la que se correlaciona la φ de corona (rol o `m:<curva>`). */
export const MATCH_CURVE_SETTING = 'matchCurve';
export const DEFAULT_MATCH_CURVE = 'PHIE';
/**
 * Ajuste del conjunto: la profundidad del archivo YA es la del perfil (p. ej. los plugs del TP, corridos por la cátedra).
 * Con él, un desplazamiento 0 cuenta como puesta en profundidad hecha (docs/decisiones/0056).
 */
export const DEPTH_ON_LOG_SETTING = 'depthOnLog';

/** Columnas del conjunto (las llena `src/io/core.ts` y el ejemplo). */
export const COL = { phi: 'phi', k: 'k', rhog: 'rhog', ff: 'ff', run: RUN_COLUMN, description: 'description' } as const;

export const kphiSeriesKey = (setId: string) => `${setId}:${KPHI}`;

export function parseCoreSeriesKey(key: string): { setId: string; what: string | null } {
  const k = key.lastIndexOf(':');
  return k > 0 ? { setId: key.slice(0, k), what: key.slice(k + 1) } : { setId: key, what: null };
}

export const coreSets = (sets: readonly PointSet[]): PointSet[] => sets.filter((s) => s.kind === CORE_KIND);

// ── coronas ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Nombre de una corona para la interfaz: «Corona 1» si es un número, el texto tal cual si no. */
export function runLabel(run: string | null): string {
  if (!run) return 'Todos los plugs';
  return /^\d+$/.test(run) ? `Corona ${run}` : run;
}

export interface CoreGroup {
  /** Valor de la columna de corona, o null = todo el conjunto (sin columna de corona). */
  run: string | null;
  label: string;
  /** Índices de los plugs del grupo. */
  indices: number[];
}

/**
 * Grupos de puesta en profundidad: una por corona si el conjunto tiene la columna; si no, uno con todos los plugs. Los
 * plugs sin corona en un conjunto que sí la tiene van en un grupo propio (usan la puesta del conjunto).
 */
export function coreGroups(set: PointSet): CoreGroup[] {
  const runs = pointRuns(set);
  const all = Array.from({ length: set.depth.length }, (_, i) => i);
  const names = listRuns(set);
  if (!runs || names.length === 0) return [{ run: null, label: runLabel(null), indices: all }];
  const out: CoreGroup[] = names.map((r) => ({ run: r, label: runLabel(r), indices: all.filter((i) => runs[i] === r) }));
  const orphan = all.filter((i) => !runs[i]);
  if (orphan.length) out.push({ run: null, label: 'Sin corona', indices: orphan });
  return out;
}

/** Desplazamiento efectivo de un grupo (m). */
export const groupShift = (dec: PointSetDecisions | undefined, run: string | null) => shiftOf(dec, run);

/** Colores de cada corona (por orden), por tema: distintos de PHIE (azul), PERM (naranja) y RHOB (rojo). */
export const RUN_COLORS: Readonly<Record<'light' | 'dark', readonly string[]>> = {
  light: ['#a21caf', '#0f766e', '#4d7c0f', '#7c3aed', '#be123c'],
  dark: ['#e879f9', '#2dd4bf', '#a3e635', '#a78bfa', '#fb7185'],
};

export function runColor(set: PointSet, run: string | null | undefined, theme: 'light' | 'dark'): string {
  const list = RUN_COLORS[theme];
  const k = run ? listRuns(set).indexOf(run) : 0;
  return list[Math.max(0, k) % list.length]!;
}

// ── calidad ─────────────────────────────────────────────────────────────────────────────────────────────────

export type CoreQualityReason = 'noData' | 'phiRange' | 'kRange' | 'rhogRange' | 'damaged';

export const CORE_REASON_LABEL: Readonly<Record<CoreQualityReason, string>> = {
  noData: 'sin φ ni k',
  phiRange: 'φ fuera de rango',
  kRange: 'k no positiva',
  rhogRange: 'densidad de grano fuera de rango',
  damaged: 'plug fisurado o dañado',
};

/** Rangos físicos de un plug de roca: φ en v/v, densidad de grano en g/cm³ (cuarzo 2,65; calcita 2,71; dolomita 2,87). */
export const PHI_RANGE: readonly [number, number] = [0, 0.45];
export const RHOG_RANGE: readonly [number, number] = [2.5, 3.0];

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** ¿La descripción dice que el plug no es representativo? (español e inglés). */
export function damagedFromText(text: string | undefined): boolean {
  if (!text) return false;
  return /(fisur|fractur|microfract|broken|roto|rota|danad|damag|crack|astill|chipped|desmoron|no representativ|not representativ|unconsolid|friable)/.test(strip(text));
}

export interface PlugQuality {
  reasons: CoreQualityReason[];
  proposeExclude: boolean;
}

/** Reglas automáticas sobre cada plug (proponen; decide el usuario). */
export function assessCoreQuality(set: PointSet): PlugQuality[] {
  const phi = pointNumbers(set, COL.phi);
  const k = pointNumbers(set, COL.k);
  const rhog = pointNumbers(set, COL.rhog);
  const desc = pointTexts(set, COL.description);
  return Array.from({ length: set.depth.length }, (_, i) => {
    const reasons: CoreQualityReason[] = [];
    const p = phi?.[i] ?? NaN;
    const kk = k?.[i] ?? NaN;
    const g = rhog?.[i] ?? NaN;
    if (!Number.isFinite(p) && !Number.isFinite(kk)) reasons.push('noData');
    if (Number.isFinite(p) && (p < PHI_RANGE[0] || p > PHI_RANGE[1])) reasons.push('phiRange');
    if (Number.isFinite(kk) && !(kk > 0)) reasons.push('kRange');
    if (Number.isFinite(g) && (g < RHOG_RANGE[0] || g > RHOG_RANGE[1])) reasons.push('rhogRange');
    if (damagedFromText(desc?.[i])) reasons.push('damaged');
    return { reasons, proposeExclude: reasons.length > 0 };
  });
}

export interface PlugStatus {
  included: boolean;
  /** Decisión explícita del usuario, si la hay. */
  decided: 'include' | 'exclude' | null;
  quality: PlugQuality;
}

const qualityCache = new WeakMap<PointSet, PlugQuality[]>();
const statusCache = new WeakMap<PointSet, WeakMap<object, PlugStatus[]>>();
const NO_DEC = {};

/** Estado efectivo de cada plug: la decisión del usuario o la propuesta. Caché por identidad. */
export function plugStatuses(set: PointSet, dec: PointSetDecisions | undefined): PlugStatus[] {
  let q = qualityCache.get(set);
  if (!q) qualityCache.set(set, (q = assessCoreQuality(set)));
  let byDec = statusCache.get(set);
  if (!byDec) statusCache.set(set, (byDec = new WeakMap()));
  const key = dec ?? NO_DEC;
  let out = byDec.get(key);
  if (!out) {
    const quality = q;
    out = set.pointIds.map((id, i) => {
      const s = dec?.points[id]?.status ?? null;
      return { included: s ? s === 'include' : !quality[i]!.proposeExclude, decided: s, quality: quality[i]! };
    });
    byDec.set(key, out);
  }
  return out;
}

/** Decisión a guardar para que el plug quede incluido o no: null si coincide con la propuesta (no se guarda). */
export function plugDecisionFor(q: PlugQuality, include: boolean): { status: 'include' | 'exclude' } | null {
  return include === !q.proposeExclude ? null : { status: include ? 'include' : 'exclude' };
}

// ── modelo k–φ hacia el motor ─────────────────────────────────────────────────────────────────────────────

/** Coeficientes exponenciales guardados con el redondeo histórico. */
export function roundModel(m: LogLinearPermModel): LogLinearPermModel {
  return { a: Math.round(m.a * 1e4) / 1e4, b: Math.round(m.b * 1e3) / 1e3 };
}

/** Convierte la tendencia al modelo de PERM de corona. El potencial conserva todos sus dígitos. */
export function kphiModelOf(c: TrendCoefficients | null | undefined): CorePermModel | null {
  if (c?.model === 'power') {
    const a = Math.log10(c.a);
    return isValidPowerModel(a, c.b) ? { method: 'power', a, b: c.b } : null;
  }
  if (c?.model !== 'exp') return null;
  const m = expTrendToLogLinear(c.a, c.b);
  return m ? roundModel(m) : null;
}

export function permCoreParams(interp: Pick<Interpretation, 'params'>, zoneId: string | null): CorePermModel & { set: boolean } {
  const effective = effectivePermCoreModel(interp.params, zoneId);
  return { ...effective.model, set: effective.origin !== 'default' };
}

/** Evidencia de ajuste para repetir la selección y detectar cambios aunque los coeficientes sean los mismos. */
export type KPhiFitTrace = {
  setId: string;
  trendId: string;
  zoneId: string | null;
  method: 'exp' | 'power';
  depthRange: [number | null, number | null];
  phiFilter: [number | null, number | null];
  excluded: string[];
  points: [id: string, correctedMd: number | null, phi: number, k: number][];
  r2: number;
};

function savedFits(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Readonly<Record<string, JsonValue>>;
  return {};
}

const fitScope = (zoneId: string | null) => zoneId === null ? 'global' : `zone:${zoneId}`;

/** Otros ámbitos donde se aplicó la misma tendencia antes de cambiar el tramo del ajuste. */
export function otherKPhiScopes(interp: Interpretation, trendId: string, zoneId: string | null): string[] {
  const fits = savedFits(interp.moduleState?.[PERM_CORE_ID]);
  return [null, ...interp.zones.map((zone) => zone.id)].flatMap((scope) => {
    if (scope === zoneId) return [];
    const fit = fits[fitScope(scope)];
    if (!fit || typeof fit !== 'object' || !('trendId' in fit) || fit.trendId !== trendId) return [];
    return [scope === null ? 'global' : `zona ${interp.zones.find((zone) => zone.id === scope)!.name}`];
  });
}

export type KPhiSync = 'synced' | 'stale' | 'unapplied';

/** Comprueba los coeficientes y, si existe, la evidencia del ajuste aplicado en este alcance. */
export function kphiSync(
  interp: Pick<Interpretation, 'params' | 'moduleState'>,
  model: CorePermModel | null,
  zoneId: string | null,
  trace?: KPhiFitTrace | null,
): { state: KPhiSync; params: CorePermModel } {
  const { model: params, origin } = effectivePermCoreModel(interp.params, zoneId);
  if (origin === 'default' || (zoneId !== null && origin !== 'local')) return { state: 'unapplied', params };
  if (!model || isPowerPermModel(params) !== isPowerPermModel(model)) return { state: 'stale', params };
  const applied = savedFits(interp.moduleState?.[PERM_CORE_ID])[fitScope(zoneId)];
  if (applied !== undefined && trace !== undefined) {
    const { a, b } = params;
    const expected = trace ? { ...trace, a, b } : null;
    if (JSON.stringify(applied) !== JSON.stringify(expected)) return { state: 'stale', params };
  }
  if (isPowerPermModel(model)) {
    return { state: model.a === params.a && model.b === params.b ? 'synced' : 'stale', params };
  }
  const r = roundModel(model);
  return { state: Math.abs(r.a - params.a) < 5e-5 && Math.abs(r.b - params.b) < 5e-4 ? 'synced' : 'stale', params };
}

/** ¿`perm-core` es la fuente elegida de PERM? */
export const permCoreIsSource = (interp: Pick<Interpretation, 'sources'>) => {
  const s = interp.sources['PERM'];
  return s?.kind === 'module' && s.moduleId === PERM_CORE_ID;
};

/** Guarda el modelo y su evidencia en una sola receta, con activación de PERM opcional. */
export function applyKPhiModel(
  project: Project,
  wellId: string,
  model: CorePermModel,
  opts: { zoneId?: string | null; useAsSource?: boolean; trace?: KPhiFitTrace | null } = {},
): Project {
  const zone = opts.zoneId ?? null;
  const normalized = isPowerPermModel(model) ? model : roundModel(model);
  if (!validModel(normalized)) return project;
  const next = storeKPhiModel(project, wellId, normalized, zone, opts.trace);
  return opts.useAsSource ? setSource(next, wellId, 'PERM', { kind: 'module', moduleId: PERM_CORE_ID }) : next;
}

/** Guarda los coeficientes efectivos, también cuando se editan desde el panel de parámetros. */
export function storeKPhiModel(project: Project, wellId: string, model: CorePermModel, zone: string | null, trace?: KPhiFitTrace | null): Project {
  let next = project;
  const power = isPowerPermModel(model);
  const m = model;
  if (!validModel(m)) return project;
  next = setParam(next, wellId, PERM_CORE_KEYS.method, power ? 'power' : 'exp', zone);
  if (isPowerPermModel(m)) {
    next = setParam(next, wellId, PERM_CORE_KEYS.powerLogA, m.a, zone);
    next = setParam(next, wellId, PERM_CORE_KEYS.powerB, m.b, zone);
    next = setParam(next, wellId, PERM_CORE_KEYS.powerPhiMin, m.phiMin ?? 0, zone);
    next = setParam(next, wellId, PERM_CORE_KEYS.powerPhiMax, m.phiMax ?? 0, zone);
  } else {
    next = setParam(next, wellId, PERM_CORE_KEYS.a, m.a, zone);
    next = setParam(next, wellId, PERM_CORE_KEYS.b, m.b, zone);
    for (const key of [PERM_CORE_KEYS.powerLogA, PERM_CORE_KEYS.powerB, PERM_CORE_KEYS.powerPhiMin, PERM_CORE_KEYS.powerPhiMax]) {
      next = clearParam(next, wellId, key, zone);
    }
  }
  return updateFitTrace(next, wellId, zone, trace ? { ...trace, a: m.a, b: m.b } : null);
}

function validModel(model: CorePermModel): boolean {
  if (!Number.isFinite(model.a) || !Number.isFinite(model.b)) return false;
  if (!isPowerPermModel(model)) return true;
  return isValidPowerModel(model.a, model.b) && (
    (model.phiMin === undefined && model.phiMax === undefined) ||
    (model.phiMin !== undefined && model.phiMax !== undefined && Number.isFinite(model.phiMax) && model.phiMin > 0 && model.phiMin <= model.phiMax)
  );
}

function updateFitTrace(project: Project, wellId: string, zone: string | null, trace: JsonValue): Project {
  const saved = savedFits(getWellEntry(project, wellId).interpretation.moduleState?.[PERM_CORE_ID]);
  const scope = fitScope(zone);
  if (trace !== null) return setModuleState(project, wellId, PERM_CORE_ID, { ...saved, [scope]: trace });
  if (saved[scope] === undefined) return project;
  const { [scope]: _discarded, ...rest } = saved;
  return setModuleState(project, wellId, PERM_CORE_ID, Object.keys(rest).length ? rest : undefined);
}

export function clearKPhiModel(project: Project, wellId: string, zone: string | null): Project {
  let next = project;
  for (const key of Object.values(PERM_CORE_KEYS)) next = clearParam(next, wellId, key, zone);
  return updateFitTrace(next, wellId, zone, null);
}
