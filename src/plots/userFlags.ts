/**
 * Proyección cacheada de banderas de usuario (`Interpretation.userFlags?`) y lógica pura de acciones desde una
 * selección (`PlotSelection` → bandera de usuario o exclusión QC en Preparación; docs/decisiones/0088).
 *
 * Puro (sin React ni stores): comparten la misma proyección el visor, «Armar pistas», la exportación de figuras y
 * todos los gráficos del dock (crossplot, histograma, distribuciones).
 */
import { curveProvenance, identityKey } from '../core/engine/context';
import { preparationBindings } from '../core/preparation/bindings';
import { isPreparedId, preparedCurveId } from '../core/preparation/source';
import { MASK_REASON_MAX, MAX_MASK_NODES, type MaskInterval } from '../core/preparation/state';
import { RoleCatalog, type RoleDef } from '../core/roles';
import { addMaskIntervals } from '../core/state/preparation';
import type { Project, WellEntry } from '../core/state/project';
import { addUserFlag } from '../core/state/userFlags';
import {
  clipUserFlagSource,
  evaluateUserFlag,
  maskToExactIntervals,
  USER_FLAG_MODULE_ID,
  userFlagColor,
  userFlagRoleId,
  type UserFlagDef,
  type UserFlagInterval,
} from '../core/userFlags';
import type { Curve } from '../core/well';
import type { ComputedCurve } from '../viewer/resolve';
import { selectionTitle, type PlotSelection } from './link';

const MAX_EXCLUSION_INTERVALS = 256;

// ── proyección cacheada de banderas de usuario ──────────────────────────────────────────────────────────────────

const dataCache = new WeakMap<Float64Array, WeakMap<UserFlagDef, Float64Array>>();
const listCache = new WeakMap<Float64Array, WeakMap<readonly UserFlagDef[], ComputedCurve[]>>();
const mergedCache = new WeakMap<
  Float64Array,
  WeakMap<readonly UserFlagDef[], WeakMap<readonly ComputedCurve[], readonly ComputedCurve[]>>
>();
const catalogCache = new WeakMap<RoleCatalog, WeakMap<readonly UserFlagDef[], RoleCatalog>>();

function cachedFlagData(depth: Float64Array, flag: UserFlagDef): Float64Array {
  let byFlag = dataCache.get(depth);
  if (!byFlag) dataCache.set(depth, (byFlag = new WeakMap()));
  let arr = byFlag.get(flag);
  if (!arr) {
    arr = evaluateUserFlag(depth, flag);
    byFlag.set(flag, arr);
  }
  return arr;
}

/** Curvas proyectadas 0/1 de las banderas de usuario sobre `depth`, cacheadas por identidad. */
export function userFlagCurves(depth: Float64Array, flags: readonly UserFlagDef[] | undefined): ComputedCurve[] {
  if (!flags?.length) return [];
  let byFlags = listCache.get(depth);
  if (!byFlags) listCache.set(depth, (byFlags = new WeakMap()));
  let out = byFlags.get(flags);
  if (!out) {
    out = flags.map((flag) => ({
      port: userFlagRoleId(flag.id),
      moduleId: USER_FLAG_MODULE_ID,
      label: flag.name,
      unit: 'unitless',
      data: cachedFlagData(depth, flag),
      active: true,
    }));
    byFlags.set(flags, out);
  }
  return out;
}

/** Agrega las banderas de usuario proyectadas a `computed` preservando identidad cuando no hay banderas (idempotente). */
export function withUserFlagCurves(
  depth: Float64Array,
  flags: readonly UserFlagDef[] | undefined,
  computed: readonly ComputedCurve[],
): readonly ComputedCurve[] {
  if (!flags?.length) return computed;
  if (computed.length === 0) return userFlagCurves(depth, flags);
  let byFlags = mergedCache.get(depth);
  if (!byFlags) mergedCache.set(depth, (byFlags = new WeakMap()));
  let byComputed = byFlags.get(flags);
  if (!byComputed) byFlags.set(flags, (byComputed = new WeakMap()));
  let merged = byComputed.get(computed);
  if (!merged) {
    const existing = new Set(computed.filter((c) => c.moduleId === USER_FLAG_MODULE_ID).map((c) => c.port));
    const extra = userFlagCurves(depth, flags).filter((c) => !existing.has(c.port));
    merged = extra.length ? [...computed, ...extra] : computed;
    byComputed.set(computed, merged);
  }
  return merged;
}

/** Extiende `base` con roles `family: 'flag'` para las banderas de usuario, sin mutar el catálogo global. */
export function withUserFlagCatalog(base: RoleCatalog, flags: readonly UserFlagDef[] | undefined): RoleCatalog {
  if (!flags?.length) return base;
  let byFlags = catalogCache.get(base);
  if (!byFlags) catalogCache.set(base, (byFlags = new WeakMap()));
  let cat = byFlags.get(flags);
  if (!cat) {
    const extra: RoleDef[] = [];
    flags.forEach((flag, idx) => {
      const id = userFlagRoleId(flag.id);
      if (base.has(id)) return;
      extra.push({
        id,
        label: flag.name,
        unit: 'unitless',
        family: 'flag',
        origin: 'computed',
        display: { color: flag.color ?? userFlagColor(idx), scale: 'linear', min: 0, max: 1 },
        description: flag.source ? `Bandera de usuario · ${flag.source}` : 'Bandera de usuario',
      });
    });
    cat = extra.length ? new RoleCatalog([...base.all(), ...extra]) : base;
    byFlags.set(flags, cat);
  }
  return cat;
}

// ── selección → bandera de usuario ──────────────────────────────────────────────────────────────────────────────

export interface SaveSelectionFlagOptions {
  id: string;
  name: string;
  color?: string;
  source?: string;
}

/** Convierte una `PlotSelection` activa del pozo en una bandera de usuario 0/1 dentro de `Interpretation.userFlags`. */
export function saveSelectionAsUserFlag(
  project: Project,
  wellId: string,
  selection: PlotSelection,
  opts: SaveSelectionFlagOptions,
): Project {
  const entry = project.wells.find((w) => w.well.id === wellId);
  if (!entry) throw new Error('El pozo activo ya no existe.');
  if (selection.depth !== entry.well.depth.values) {
    throw new Error('La selección ya no corresponde a la profundidad del pozo activo.');
  }
  const intervals = maskToExactIntervals(entry.well.depth.values, selection.mask);
  if (intervals.length === 0) throw new Error('La selección no contiene muestras válidas.');
  const rawSource = opts.source ?? selectionTitle(selection);
  const source = clipUserFlagSource(rawSource);
  return addUserFlag(project, wellId, {
    id: opts.id,
    name: opts.name,
    ...(opts.color ? { color: opts.color } : {}),
    intervals,
    ...(source ? { source } : {}),
  });
}

// ── selección → exclusión en Preparación ────────────────────────────────────────────────────────────────────────

/**
 * Resuelve una clave de curva de gráfico (`m:<id>` o `r:<ROL>`) al id de la curva original medida en `entry.well`.
 * Si la clave apunta a una curva preparada (`prep:<nodeId>:masked`), remonta a `node.input.curveId` (I01/I02).
 */
export function resolveOriginalCurveId(
  entry: Pick<WellEntry, 'well' | 'interpretation'>,
  key: string | null | undefined,
  hiddenCurveIds?: ReadonlySet<string>,
): string | null {
  if (!key) return null;
  const originals = entry.well.curves;
  const nodes = entry.interpretation.preparation?.nodes ?? [];
  const unwrapCurveId = (curveId: string): string | null => {
    if (originals.some((c) => c.id === curveId)) return curveId;
    if (isPreparedId(curveId)) {
      const node = nodes.find((n) => preparedCurveId(n.id, 'masked') === curveId);
      if (node && originals.some((c) => c.id === node.input.curveId)) return node.input.curveId;
    }
    return null;
  };
  if (key.startsWith('m:')) return unwrapCurveId(key.slice(2));
  if (key.startsWith('r:')) {
    const role = key.slice(2);
    const src = entry.interpretation.sources[role];
    if (src?.kind === 'curve') {
      const resolved = unwrapCurveId(src.curveId);
      if (resolved) return resolved;
    } else if (src?.kind === 'module') {
      return null;
    }
    const visibleMatch = hiddenCurveIds
      ? originals.find((c) => c.role === role && !hiddenCurveIds.has(c.id))
      : undefined;
    const measured = visibleMatch ?? originals.find((c) => c.role === role);
    return measured?.id ?? null;
  }
  return null;
}

/**
 * Curva medida sugerida por defecto al excluir desde una `PlotSelection`:
 * - Crossplot: eje Y si es medida; si no, eje X.
 * - Histograma / Distribuciones: la curva graficada si es medida.
 * - Visor / respaldo: primera curva original visible según la sarta (o la primera del pozo si todas están ocultas).
 */
export function defaultExclusionCurveId(
  entry: Pick<WellEntry, 'well' | 'interpretation'>,
  selection: PlotSelection,
  preferredKeys: readonly (string | null | undefined)[] = [],
  hiddenCurveIds?: ReadonlySet<string>,
): string | null {
  const candidates: (string | null | undefined)[] = [...preferredKeys];
  const d = selection.detail;
  if (d.kind === 'shapes') candidates.push(d.y, d.x);
  else if (d.kind === 'bins' || d.kind === 'range') candidates.push(d.curve);
  for (const key of candidates) {
    const id = resolveOriginalCurveId(entry, key, hiddenCurveIds);
    if (id && (!hiddenCurveIds || !hiddenCurveIds.has(id))) return id;
  }
  for (const key of candidates) {
    const id = resolveOriginalCurveId(entry, key, hiddenCurveIds);
    if (id) return id;
  }
  const firstVisible = hiddenCurveIds ? entry.well.curves.find((c) => !hiddenCurveIds.has(c.id)) : undefined;
  return (firstVisible ?? entry.well.curves[0])?.id ?? null;
}

export interface ExclusionTargetInfo {
  curve: Curve;
  intervals: readonly UserFlagInterval[];
  existingIntervals: number;
  remainingSlots: number;
  /** true si el rol de la curva ya tiene seleccionada su versión preparada como fuente activa. */
  alreadyUsingPrepared: boolean;
  /** Descripción breve si el rol apunta actualmente a otra curva o a un módulo (no al original ni a su preparada). */
  otherActiveSource: string | null;
  /** Error bloqueante que impide aplicar la exclusión respetando I01–I08 (null si se puede aplicar). */
  blockingError: string | null;
}

/** Diagnóstico previo de una exclusión QC desde selección sobre una curva original, antes de confirmar. */
export function exclusionTargetInfo(
  project: Project,
  wellId: string,
  curveId: string,
  selection: PlotSelection,
): ExclusionTargetInfo | null {
  const entry = project.wells.find((w) => w.well.id === wellId);
  const curve = entry?.well.curves.find((c) => c.id === curveId);
  if (!entry || !curve) return null;

  const nodes = entry.interpretation.preparation?.nodes ?? [];
  const existing = nodes.find((n) => n.input.curveId === curveId);
  const existingIntervals = existing?.intervals.length ?? 0;
  const remainingSlots = Math.max(0, MAX_EXCLUSION_INTERVALS - existingIntervals);
  const intervals =
    selection.depth === entry.well.depth.values ? maskToExactIntervals(entry.well.depth.values, selection.mask) : [];

  const preparedId = existing ? preparedCurveId(existing.id, 'masked') : null;
  const roleSource = curve.role ? entry.interpretation.sources[curve.role] : undefined;
  const alreadyUsingPrepared =
    !!curve.role && !!preparedId && roleSource?.kind === 'curve' && roleSource.curveId === preparedId;

  let otherActiveSource: string | null = null;
  if (curve.role && roleSource && !alreadyUsingPrepared) {
    if (roleSource.kind === 'module') otherActiveSource = `módulo ${roleSource.moduleId}`;
    else if (roleSource.curveId !== curve.id) {
      const other = entry.well.curves.find((c) => c.id === roleSource.curveId);
      if (other) {
        otherActiveSource = other.mnemonic;
      } else if (isPreparedId(roleSource.curveId)) {
        const otherNode = nodes.find((n) => preparedCurveId(n.id, 'masked') === roleSource.curveId);
        const otherOrig = otherNode ? entry.well.curves.find((c) => c.id === otherNode.input.curveId) : undefined;
        otherActiveSource = otherOrig ? `${otherOrig.mnemonic} (preparada)` : roleSource.curveId;
      } else {
        otherActiveSource = roleSource.curveId;
      }
    }
  }

  let blockingError: string | null = null;
  if (selection.depth !== entry.well.depth.values) {
    blockingError = 'La selección ya no corresponde a la profundidad del pozo activo.';
  } else if (intervals.length === 0) {
    blockingError = 'La selección no contiene muestras válidas para excluir.';
  } else if (
    nodes.some(
      (n) => n.kind === 'density-reconstruction' && n.enabled && n.density.predictors.some((p) => p.curveId === curveId),
    )
  ) {
    blockingError = 'Retirá o desactivá la reconstrucción antes de preparar sus predictores.';
  } else if (nodes.some((n) => n.kind === 'mgt-borehole' && n.enabled && n.mgt.caliperCurveId === curveId)) {
    blockingError = 'Retirá o desactivá MGT antes de preparar su caliper; no se ignora una dependencia.';
  } else if (existing?.kind === 'density-reconstruction') {
    blockingError = 'Retirá la reconstrucción antes de excluir densidad.';
  } else if (existing?.kind === 'mgt-borehole') {
    blockingError = 'Retirá MGT antes de excluir datos; la corrección no se descarta silenciosamente.';
  } else if (!existing && nodes.length >= MAX_MASK_NODES) {
    blockingError = `Se alcanzó el límite de ${MAX_MASK_NODES} curvas preparadas en este pozo.`;
  } else if (intervals.length > remainingSlots) {
    blockingError = `La selección genera ${intervals.length} tramos separados y el límite por curva en Preparación es ${MAX_EXCLUSION_INTERVALS} (quedan ${remainingSlots}). Acotá la selección o guardala como bandera de usuario.`;
  } else if (existing) {
    const binding = preparationBindings(
      entry.interpretation,
      wellId,
      project.inputRevisions,
      entry.inputRevisionId,
    )[existing.id];
    const depthKey = `depth:${identityKey(entry.well.depth.values)}`;
    if (
      !binding ||
      binding.depthKey !== depthKey ||
      binding.contentVersion !== curveProvenance(curve, depthKey).contentVersion ||
      binding.unit !== curve.unit ||
      binding.role !== curve.role ||
      binding.mnemonic !== curve.mnemonic
    ) {
      blockingError = 'La máscara está vinculada a otros datos. Restaurá el original antes de preparar esta revisión.';
    }
  }

  return {
    curve,
    intervals,
    existingIntervals,
    remainingSlots,
    alreadyUsingPrepared,
    otherActiveSource,
    blockingError,
  };
}

export interface ExcludeSelectionOptions {
  /** Motivo obligatorio de QC (1–200 caracteres). */
  reason: string;
  /** Si true, activa explícitamente la curva preparada como fuente del rol en el mismo paso atómico. */
  activateSource: boolean;
  /** Generador de ids únicos para intervalos y nodo nuevo. */
  makeId: (prefix: string) => string;
}

/**
 * Agrega los tramos MD exactos (`gap = 0`) de una `PlotSelection` como exclusiones en `Preparation` con motivo
 * obligatorio, respetando I01–I08 y activación explícita de fuente (I04).
 */
export function excludeSelectionInPreparation(
  project: Project,
  wellId: string,
  curveId: string,
  selection: PlotSelection,
  opts: ExcludeSelectionOptions,
): Project {
  const reason = opts.reason.trim();
  if (!reason) throw new Error('Ingresá un motivo obligatorio para la exclusión.');
  if (reason.length > MASK_REASON_MAX) {
    throw new Error(`El motivo de exclusión admite hasta ${MASK_REASON_MAX} caracteres.`);
  }
  const entry = project.wells.find((w) => w.well.id === wellId);
  if (!entry) throw new Error('El pozo activo ya no existe.');
  if (selection.depth !== entry.well.depth.values) {
    throw new Error('La selección ya no corresponde a la profundidad del pozo activo.');
  }
  const runs = maskToExactIntervals(entry.well.depth.values, selection.mask);
  if (runs.length === 0) throw new Error('La selección no contiene muestras válidas para excluir.');
  const intervals: MaskInterval[] = runs.map((r) => ({
    id: opts.makeId('excluded'),
    top: r.top,
    base: r.base,
    reason,
  }));
  return addMaskIntervals(project, wellId, curveId, intervals, opts.makeId('mask'), {
    activateSource: opts.activateSource,
  });
}
