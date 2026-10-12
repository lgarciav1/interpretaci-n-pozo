/**
 * Datos de corona: modelo puro del módulo (docs/decisiones/0010-datos-de-corona.md).
 *
 * - Ids que se guardan en el proyecto (proveedor de series, superposición, claves de serie, ajustes): no cambiarlos.
 * - Calidad de los plugs: reglas que PROPONEN descartar (sin φ ni k, φ fuera de rango, k ≤ 0, densidad de grano fuera
 *   de rango, plug fisurado o dañado según la descripción). Decide el usuario (`Interpretation.pointSets`).
 * - Coronas (grupos de puesta en profundidad): la columna `run` del conjunto (`RUN_COLUMN` del núcleo).
 * - Modelo k–φ hacia el motor: conversión de la tendencia exponencial a log10 k = a + b·φ, receta «Aplicar al pozo»
 *   (parámetros del módulo `perm-core`, globales o de una zona, y opcionalmente fuente de PERM) y estado de
 *   sincronización entre el ajuste y los parámetros.
 *
 * Sin React ni stores ni `src/plots`: lo importan el proveedor de series, la superposición, el panel y los tests.
 */
import type { Interpretation } from '../../core/interpretation';
import { listRuns, pointNumbers, pointRuns, pointTexts, RUN_COLUMN, shiftOf, type PointSet, type PointSetDecisions } from '../../core/pointSets';
import { setParam, setSource, type Project } from '../../core/state/project';
import { expTrendToLogLinear, type LogLinearPermModel } from '../../petro/permeability';
import type { TrendCoefficients } from '../../petro/regression';
import { PERM_CORE_ID } from '../perm-core';

export const CORE_KIND = 'core';
export const CORE_PROVIDER_ID = 'core';
export const CORE_OVERLAY_ID = 'core';
export const CORE_DOCK_ID = 'core';
/** Clave de serie del crossplot k–φ de un conjunto: `<conjunto>:kphi`. */
export const KPHI = 'kphi';
/** Ajuste del conjunto: curva del perfil contra la que se correlaciona la φ de corona (rol o `m:<curva>`). */
export const MATCH_CURVE_SETTING = 'matchCurve';
export const DEFAULT_MATCH_CURVE = 'PHIE';

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

/** Claves de almacenamiento de los parámetros del módulo `perm-core` (propios del módulo: `<id>.<clave>`). */
export const PERM_CORE_KEYS = { a: `${PERM_CORE_ID}.kphiA`, b: `${PERM_CORE_ID}.kphiB` } as const;
export const PERM_CORE_DEFAULTS: LogLinearPermModel = { a: -2, b: 20 };

/** Coeficientes a guardar: a con 4 decimales y b con 3 (lo que muestra el panel; la sincronización compara esto). */
export function roundModel(m: LogLinearPermModel): LogLinearPermModel {
  return { a: Math.round(m.a * 1e4) / 1e4, b: Math.round(m.b * 1e3) / 1e3 };
}

/** log10 k = a + b·φ desde los coeficientes de la tendencia k–φ (solo el modelo exponencial; si no, null). */
export function kphiModelOf(c: TrendCoefficients | null | undefined): LogLinearPermModel | null {
  if (!c || c.model !== 'exp') return null;
  const m = expTrendToLogLinear(c.a, c.b);
  return m ? roundModel(m) : null;
}

/** Valores efectivos de a y b del módulo para una zona (null = globales). */
export function permCoreParams(interp: Pick<Interpretation, 'params'>, zoneId: string | null): LogLinearPermModel & { set: boolean } {
  const g = interp.params.global;
  const z = zoneId ? interp.params.zones[zoneId] : undefined;
  const pick = (key: string, dflt: number) => {
    const v = z?.[key] ?? g[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  };
  const set = (z?.[PERM_CORE_KEYS.a] ?? g[PERM_CORE_KEYS.a]) !== undefined || (z?.[PERM_CORE_KEYS.b] ?? g[PERM_CORE_KEYS.b]) !== undefined;
  return { a: pick(PERM_CORE_KEYS.a, PERM_CORE_DEFAULTS.a), b: pick(PERM_CORE_KEYS.b, PERM_CORE_DEFAULTS.b), set };
}

export type KPhiSync = 'synced' | 'stale' | 'unapplied';

/** ¿Los parámetros del módulo coinciden con el ajuste actual? 'unapplied': nunca se aplicó (valores por defecto). */
export function kphiSync(interp: Pick<Interpretation, 'params'>, model: LogLinearPermModel | null, zoneId: string | null): { state: KPhiSync; params: LogLinearPermModel } {
  const p = permCoreParams(interp, zoneId);
  const params = { a: p.a, b: p.b };
  if (!p.set) return { state: 'unapplied', params };
  if (!model) return { state: 'stale', params };
  const r = roundModel(model);
  return { state: Math.abs(r.a - p.a) < 5e-5 && Math.abs(r.b - p.b) < 5e-4 ? 'synced' : 'stale', params };
}

/** ¿`perm-core` es la fuente elegida de PERM? */
export const permCoreIsSource = (interp: Pick<Interpretation, 'sources'>) => {
  const s = interp.sources['PERM'];
  return s?.kind === 'module' && s.moduleId === PERM_CORE_ID;
};

/**
 * «Aplicar al pozo»: escribe a y b en los parámetros de `perm-core` (globales, o de la zona si la tendencia usa una
 * zona como tramo) y, si `useAsSource`, elige `perm-core` como fuente de PERM. Una sola receta (un solo Ctrl+Z).
 */
export function applyKPhiModel(project: Project, wellId: string, model: LogLinearPermModel, opts: { zoneId?: string | null; useAsSource?: boolean } = {}): Project {
  const m = roundModel(model);
  const zone = opts.zoneId ?? null;
  let p = setParam(project, wellId, PERM_CORE_KEYS.a, m.a, zone);
  p = setParam(p, wellId, PERM_CORE_KEYS.b, m.b, zone);
  if (opts.useAsSource) p = setSource(p, wellId, 'PERM', { kind: 'module', moduleId: PERM_CORE_ID });
  return p;
}
