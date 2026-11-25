/**
 * Lógica pura del panel y de la superposición de capacidad de flujo / SMLP (sin React ni canvas):
 * - Lee las tablas del módulo (`FLOW_UNITS`, `FLOW_LORENZ`, `FLOW_SUMMARY`), arma las filas de tramos de la zona
 *   elegida (o del total) y las series de Lorenz decimadas para dibujar.
 * - Lee y escribe los quiebres SMLP por zona y el estado de la superposición en
 *   `interpretation.moduleState['flow-capacity']` (claves estables en MD al centímetro, JSON puro, entra en Ctrl+Z).
 * - Resuelve los quiebres guardados contra los tramos vigentes (detectando huérfanos si cambia la zona o el filtro,
 *   sin corromper datos, igual que `pay-intervals`), calcula las sub-unidades SMLP (S1, S2…) y planifica el partido
 *   de una zona en un quiebre sobre las recetas puras de `src/core/state/zones.ts`.
 */
import type { Interpretation, JsonValue } from '../../core/interpretation';
import type { TableCell } from '../../core/module';
import { applyZoneEdit, setModuleState, type Project } from '../../core/state/project';
import { splitZoneAt, type NewZoneInput } from '../../core/state/zones';
import type { Zone } from '../../core/well';
import { smlpSubUnits, type SmlpCharacter, type SmlpSubUnit } from '../../petro/flowCapacity';

export const MODULE_ID = 'flow-capacity';
export const UNITS_PORT = 'FLOW_UNITS';
export const LORENZ_PORT = 'FLOW_LORENZ';
export const SUMMARY_PORT = 'FLOW_SUMMARY';

export const SMLP_BANDS_OVERLAY_ID = 'flow-capacity-smlp-bands';
export const SMLP_OVERLAY_ID = 'flow-capacity-smlp';

export type Row = Readonly<Record<string, TableCell>>;

/** Clave del selector para el total (zoneId = ''). */
export const TOTAL_KEY = '__total';

export const cellNum = (c: TableCell | undefined): number => (typeof c === 'number' && Number.isFinite(c) ? c : NaN);
export const zoneKey = (zoneId: TableCell | undefined): string => (zoneId === '' || zoneId === null || zoneId === undefined ? TOTAL_KEY : String(zoneId));

/** Rótulos operativos en español para cada carácter SMLP. */
export const SMLP_CHARACTER_LABEL: Record<SmlpCharacter, string> = {
  conduit: 'Conducto',
  homogeneous: 'Homogéneo',
  subordinate: 'Subordinado',
  barrier: 'Barrera / Sello parcial',
};

/** Rótulo compacto para insignias en la tabla angosta del panel y pastillas del visor. */
export const SMLP_CHARACTER_SHORT: Record<SmlpCharacter, string> = {
  conduit: 'Conducto',
  homogeneous: 'Homogéneo',
  subordinate: 'Subordinado',
  barrier: 'Barrera',
};

/** Tono semántico del sistema de diseño para cada carácter SMLP (coincide con `Tone` de `src/ui/`). */
export type SmlpTone = 'ok' | 'info' | 'warn' | 'error';

export const SMLP_CHARACTER_TONE: Record<SmlpCharacter, SmlpTone> = {
  conduit: 'ok',
  homogeneous: 'info',
  subordinate: 'warn',
  barrier: 'error',
};

/** Sensibilidades predefinidas del segmentador SMLP (tolerancia de desvío perpendicular en [0, 1]). */
export type SmlpSensitivity = 'high' | 'medium' | 'low';

export const SMLP_SENSITIVITY_TOLERANCE: Record<SmlpSensitivity, number> = {
  high: 0.01,
  medium: 0.02,
  low: 0.04,
};

/** Tramo listo para la tabla, el tooltip y la segmentación SMLP (porcentajes ×100; satisface `RawFlowUnit`). */
export interface UnitRow {
  /** Posición en la secuencia estratigráfica de la selección (0 = el de más arriba). */
  seq: number;
  zone: string;
  index: number;
  top: number;
  base: number;
  h: number;
  phi: number;
  k: number;
  phiH: number;
  kH: number;
  phiHPct: number;
  kHPct: number;
  cumPhiHPct: number;
  cumKHPct: number;
}

/**
 * Tramos de la selección en orden de profundidad. Para el total se concatenan todos los renglones (el motor arma el
 * total con los tramos de las zonas en ese mismo orden) y los porcentajes pasan a ser del total.
 */
export function unitsFor(rows: readonly Row[], key: string): UnitRow[] {
  const total = key === TOTAL_KEY;
  const picked = total ? rows : rows.filter((r) => zoneKey(r.zoneId) === key);
  const base = picked.map((r, seq) => {
    const h = cellNum(r.h);
    const phi = cellNum(r.phi);
    const k = cellNum(r.k);
    const rawPhiH = cellNum(r.phiH);
    const rawKH = cellNum(r.kH);
    return {
      seq,
      zone: String(r.zone ?? ''),
      index: cellNum(r.index),
      top: cellNum(r.top),
      base: cellNum(r.base),
      h,
      phi,
      k,
      phiH: Number.isFinite(rawPhiH) ? rawPhiH : Number.isFinite(phi) && Number.isFinite(h) ? phi * h : 0,
      kH: Number.isFinite(rawKH) ? rawKH : Number.isFinite(k) && Number.isFinite(h) ? Math.max(0, k) * h : 0,
      phiHPct: cellNum(r.phiHPct),
      kHPct: cellNum(r.kHPct),
      cumPhiHPct: cellNum(r.cumPhiHPct),
      cumKHPct: cellNum(r.cumKHPct),
    };
  });
  // Sin zonas, el único intervalo ya es el pozo completo: sus porcentajes ya son del total.
  if (!total || rows.every((r) => zoneKey(r.zoneId) === TOTAL_KEY)) return base;
  const sPhi = base.reduce((s, u) => s + (Number.isFinite(u.phiH) ? u.phiH : 0), 0);
  const sK = base.reduce((s, u) => s + (Number.isFinite(u.kH) ? u.kH : 0), 0);
  let cPhi = 0;
  let cK = 0;
  return base.map((u) => {
    const p = Number.isFinite(u.phiH) ? u.phiH : 0;
    const q = Number.isFinite(u.kH) ? u.kH : 0;
    cPhi += p;
    cK += q;
    return {
      ...u,
      phiHPct: sPhi > 0 ? (100 * p) / sPhi : NaN,
      kHPct: sK > 0 ? (100 * q) / sK : NaN,
      cumPhiHPct: sPhi > 0 ? (100 * cPhi) / sPhi : NaN,
      cumKHPct: sK > 0 ? (100 * cK) / sK : NaN,
    };
  });
}

/** Índices a dibujar de una polilínea de `n` puntos: a lo sumo `max`, siempre con el primero y el último. */
export function decimateIndices(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n <= max || max < 2) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  const step = (n - 1) / (max - 1);
  let last = -1;
  for (let j = 0; j < max; j++) {
    const i = Math.round(j * step);
    if (i !== last) out.push(i);
    last = i;
  }
  return out;
}

/** Serie de Lorenz en % (0–100) decimada; `src[j]` es el índice del punto original (0 = origen; i ≥ 1 = tramo i − 1). */
export interface LorenzSeries {
  x: Float64Array;
  y: Float64Array;
  src: Int32Array;
  /** Puntos originales (antes de decimar). */
  n: number;
}

export function lorenzSeries(rows: readonly Row[], key: string, curve: 'strat' | 'ordered', max = 1000): LorenzSeries {
  const pts = rows
    .filter((r) => r.curve === curve && zoneKey(r.zoneId) === key)
    .map((r) => ({ i: cellNum(r.i), x: cellNum(r.x), y: cellNum(r.y) }))
    .filter((p) => Number.isFinite(p.i) && Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.i - b.i);
  const idx = decimateIndices(pts.length, max);
  const x = new Float64Array(idx.length);
  const y = new Float64Array(idx.length);
  const src = new Int32Array(idx.length);
  idx.forEach((k, j) => {
    x[j] = 100 * pts[k]!.x;
    y[j] = 100 * pts[k]!.y;
    src[j] = pts[k]!.i;
  });
  return { x, y, src, n: pts.length };
}

/** Tramo a mostrar en el visor al hacer clic: centrado en el tramo, con al menos `minSpan` m de contexto. */
export function viewRangeFor(top: number, base: number, minSpan = 20): { top: number; base: number } {
  const mid = (top + base) / 2;
  const span = Math.max(minSpan, (base - top) * 1.5);
  return { top: mid - span / 2, base: mid + span / 2 };
}

// ── Persistencia SMLP en `interpretation.moduleState['flow-capacity']` ─────────────────────────────────────────

/** Clave estable de un quiebre en MD redondeado al centímetro (como `pay-intervals`). */
export function breakDepthKey(depth: number): string {
  if (!Number.isFinite(depth)) return '';
  return Math.abs(depth) < 0.005 ? '0.00' : depth.toFixed(2);
}

/** Sanea una lista de claves MD al cm (descarta inválidas, normaliza, sin duplicados, ordenadas por MD). */
export function sanitizeDepthKeys(raw: readonly unknown[]): string[] {
  const seen = new Map<string, number>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const v = Number(trimmed);
    if (!Number.isFinite(v)) continue;
    const key = breakDepthKey(v);
    if (!seen.has(key)) seen.set(key, Number(key));
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
}

/** Estado leído de `interpretation.moduleState['flow-capacity']`. */
export interface FlowCapacityState {
  /** Quiebres por clave de zona (`zoneId` o `TOTAL_KEY`), como claves MD al cm ordenadas. */
  breaksByZone: Record<string, string[]>;
  /** Si la superposición SMLP del visor está habilitada (por defecto true). */
  overlayEnabled: boolean;
  /** Clave de zona preferida para pintar en el visor (null = primera zona con quiebres). */
  overlayZoneKey: string | null;
}

export function readFlowState(interpretation: Pick<Interpretation, 'moduleState'> | undefined): FlowCapacityState {
  const raw = interpretation?.moduleState?.[MODULE_ID];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { breaksByZone: {}, overlayEnabled: true, overlayZoneKey: null };
  }
  const obj = raw as { readonly [k: string]: JsonValue };
  const breaksByZone: Record<string, string[]> = {};
  if (obj.breaks && typeof obj.breaks === 'object' && !Array.isArray(obj.breaks)) {
    for (const [k, v] of Object.entries(obj.breaks)) {
      if (!k || !Array.isArray(v)) continue;
      const clean = sanitizeDepthKeys(v);
      if (clean.length > 0) breaksByZone[k] = clean;
    }
  }
  const overlayEnabled = typeof obj.overlay === 'boolean' ? obj.overlay : true;
  const overlayZoneKey = typeof obj.overlayZone === 'string' && obj.overlayZone.length > 0 ? obj.overlayZone : null;
  return { breaksByZone, overlayEnabled, overlayZoneKey };
}

/** Codifica el estado como JSON puro para `moduleState['flow-capacity']` (`undefined` si no hay quiebres guardados). */
export function encodeFlowState(state: FlowCapacityState): JsonValue | undefined {
  const breaks: Record<string, string[]> = {};
  const zoneKeys = Object.keys(state.breaksByZone).sort();
  for (const k of zoneKeys) {
    const clean = sanitizeDepthKeys(state.breaksByZone[k] ?? []);
    if (clean.length > 0) breaks[k] = clean;
  }
  const hasBreaks = Object.keys(breaks).length > 0;
  if (!hasBreaks) return undefined;
  const out: Record<string, JsonValue> = { breaks };
  if (!state.overlayEnabled) out.overlay = false;
  if (state.overlayZoneKey && breaks[state.overlayZoneKey]) out.overlayZone = state.overlayZoneKey;
  return out;
}

function sameJsonValue(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Alterna una clave MD en la lista ordenada de claves de una zona. */
export function toggleDepthKey(keys: readonly string[], depthKey: string): string[] {
  const clean = sanitizeDepthKeys(keys);
  const norm = sanitizeDepthKeys([depthKey])[0];
  if (!norm) return clean;
  if (clean.includes(norm)) return clean.filter((k) => k !== norm);
  return sanitizeDepthKeys([...clean, norm]);
}

/** Receta pura: fija los quiebres SMLP de una zona (entra en Ctrl+Z; sin cambios devuelve el mismo `Project`). */
export function setZoneBreaksRecipe(
  wellId: string,
  zKey: string,
  depthKeys: readonly string[],
  opts: { enableOverlay?: boolean } = {},
): (p: Project) => Project {
  const clean = sanitizeDepthKeys(depthKeys);
  return (p) => {
    const entry = p.wells.find((e) => e.well.id === wellId);
    if (!entry) return p;
    const prev = readFlowState(entry.interpretation);
    const nextBreaks: Record<string, string[]> = { ...prev.breaksByZone };
    if (clean.length > 0) nextBreaks[zKey] = clean;
    else delete nextBreaks[zKey];

    const overlayEnabled = opts.enableOverlay ? true : prev.overlayEnabled;
    const overlayZoneKey = clean.length > 0 ? zKey : prev.overlayZoneKey === zKey ? null : prev.overlayZoneKey;
    const encoded = encodeFlowState({ breaksByZone: nextBreaks, overlayEnabled, overlayZoneKey });
    const rawPrev = entry.interpretation.moduleState?.[MODULE_ID];
    if (sameJsonValue(rawPrev, encoded)) return p;
    return setModuleState(p, wellId, MODULE_ID, encoded);
  };
}

/** Receta pura: enciende o apaga la superposición SMLP en el visor (opcionalmente fijando la zona mostrada). */
export function setSmlpOverlayRecipe(wellId: string, enabled: boolean, zKey?: string): (p: Project) => Project {
  return (p) => {
    const entry = p.wells.find((e) => e.well.id === wellId);
    if (!entry) return p;
    const prev = readFlowState(entry.interpretation);
    const overlayZoneKey = zKey && (prev.breaksByZone[zKey]?.length ?? 0) > 0 ? zKey : prev.overlayZoneKey;
    const encoded = encodeFlowState({ ...prev, overlayEnabled: enabled, overlayZoneKey });
    const rawPrev = entry.interpretation.moduleState?.[MODULE_ID];
    if (sameJsonValue(rawPrev, encoded)) return p;
    return setModuleState(p, wellId, MODULE_ID, encoded);
  };
}

/** Receta pura: descarta claves huérfanas de una zona (y opcionalmente zonas borradas que ya no existen). */
export function cleanOrphanBreaksRecipe(
  wellId: string,
  zKey: string,
  validDepthKeys: readonly string[],
  validZoneKeys?: ReadonlySet<string>,
): (p: Project) => Project {
  const clean = sanitizeDepthKeys(validDepthKeys);
  return (p) => {
    const entry = p.wells.find((e) => e.well.id === wellId);
    if (!entry) return p;
    const prev = readFlowState(entry.interpretation);
    const nextBreaks: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(prev.breaksByZone)) {
      if (k === zKey) continue;
      if (validZoneKeys && k !== TOTAL_KEY && !validZoneKeys.has(k)) continue;
      nextBreaks[k] = v;
    }
    if (clean.length > 0) nextBreaks[zKey] = clean;
    const overlayZoneKey = prev.overlayZoneKey && nextBreaks[prev.overlayZoneKey] ? prev.overlayZoneKey : null;
    const encoded = encodeFlowState({ breaksByZone: nextBreaks, overlayEnabled: prev.overlayEnabled, overlayZoneKey });
    const rawPrev = entry.interpretation.moduleState?.[MODULE_ID];
    if (sameJsonValue(rawPrev, encoded)) return p;
    return setModuleState(p, wellId, MODULE_ID, encoded);
  };
}

// ── Resolución de quiebres y sub-unidades SMLP ─────────────────────────────────────────────────────────────────

export interface ResolvedSmlpBreak {
  /** Índice interior (1 ≤ index < units.length) en `units`. */
  index: number;
  /** Clave MD al cm (`units[index].top`). */
  key: string;
  /** Profundidad del quiebre (m, tope de la sub-unidad inferior `units[index].top`). */
  depth: number;
  /** Coordenadas normalizadas acumuladas en el Lorenz estratigráfico (0–100 %). */
  xPct: number;
  yPct: number;
  upperLabel: string;
  lowerLabel: string;
}

export interface ResolvedSmlp {
  breaks: ResolvedSmlpBreak[];
  subUnits: SmlpSubUnit[];
  /** Claves guardadas en la zona que ya no coinciden con ningún quiebre interior de `units`. */
  orphanKeys: string[];
}

/**
 * Resuelve las claves MD guardadas contra los tramos vigentes `units` y arma las sub-unidades SMLP (`S1`, `S2`…).
 * Si algún quiebre guardado ya no coincide con el tope de ningún tramo interior (cambió la zona, el filtro o el
 * agrupamiento), queda listado en `orphanKeys` para avisar y ofrecer limpiarlo sin corromper los tramos válidos.
 */
export function resolveSmlp(units: readonly UnitRow[], savedKeys: readonly string[]): ResolvedSmlp {
  if (units.length === 0) {
    return { breaks: [], subUnits: [], orphanKeys: sanitizeDepthKeys(savedKeys) };
  }
  const indexByKey = new Map<string, number>();
  for (let i = 1; i < units.length; i++) {
    const k = breakDepthKey(units[i]!.top);
    if (k && !indexByKey.has(k)) indexByKey.set(k, i);
  }
  const cleanSaved = sanitizeDepthKeys(savedKeys);
  const matched: number[] = [];
  const orphanKeys: string[] = [];
  for (const k of cleanSaved) {
    const idx = indexByKey.get(k);
    if (idx !== undefined) matched.push(idx);
    else orphanKeys.push(k);
  }
  const subUnits = smlpSubUnits(units, matched);
  const breaks: ResolvedSmlpBreak[] = [];
  for (let m = 0; m < subUnits.length - 1; m++) {
    const upper = subUnits[m]!;
    const lower = subUnits[m + 1]!;
    const index = upper.endIndex;
    const depth = units[index]!.top;
    breaks.push({
      index,
      key: breakDepthKey(depth),
      depth,
      xPct: Number.isFinite(upper.endPhiH) ? 100 * upper.endPhiH : NaN,
      yPct: Number.isFinite(upper.endKH) ? 100 * upper.endKH : NaN,
      upperLabel: upper.label,
      lowerLabel: lower.label,
    });
  }
  return { breaks, subUnits, orphanKeys };
}

/** Claves de zona guardadas en `breaksByZone` cuyo `zoneId` ya no existe entre las zonas del pozo. */
export function staleZoneBreakKeys(state: FlowCapacityState, validZoneKeys: ReadonlySet<string>): string[] {
  return Object.keys(state.breaksByZone).filter((k) => k !== TOTAL_KEY && !validZoneKeys.has(k));
}

// ── Partido de zona en un quiebre SMLP (Ctrl+Z atómico) ────────────────────────────────────────────────────────

export type SplitBreakPlan =
  | {
      zones: Zone[];
      created: Zone;
      host: Zone;
      clone: { from: string; to: string } | null;
      nextFlowState: FlowCapacityState;
    }
  | { error: string };

/**
 * Planifica partir una zona existente en la profundidad `breakDepth` usando `splitZoneAt` (`src/core/state/zones.ts`)
 * y redistribuye atómicamente los quiebres SMLP guardados de la zona partida entre la mitad superior y la nueva mitad
 * inferior (el quiebre usado como límite pasa a ser borde de zona).
 */
export function planSplitZoneAtBreak(
  zones: readonly Zone[],
  depth: ArrayLike<number>,
  breakDepth: number,
  input: NewZoneInput,
  flowState: FlowCapacityState,
): SplitBreakPlan {
  const host = zones.find((z) => z.top < breakDepth && breakDepth < z.base);
  const result = splitZoneAt(zones, breakDepth, input, { depth });
  if ('error' in result) return result;
  if (!host) return { error: 'No se encontró la zona anfitriona para ese quiebre.' };

  const nextBreaks: Record<string, string[]> = { ...flowState.breaksByZone };
  const hostKeys = nextBreaks[host.id];
  if (hostKeys && hostKeys.length > 0) {
    const splitDepth = result.created.top;
    const upperKeys: string[] = [];
    const lowerKeys: string[] = [];
    for (const k of hostKeys) {
      const md = Number(k);
      if (!Number.isFinite(md)) continue;
      if (md < splitDepth - 0.005) upperKeys.push(k);
      else if (md > splitDepth + 0.005) lowerKeys.push(k);
      // El quiebre en splitDepth (±0,005 m) queda absorbido por el nuevo límite entre zonas.
    }
    if (upperKeys.length > 0) nextBreaks[host.id] = upperKeys;
    else delete nextBreaks[host.id];
    if (lowerKeys.length > 0) nextBreaks[result.created.id] = lowerKeys;
  }

  let overlayZoneKey = flowState.overlayZoneKey;
  if (overlayZoneKey === host.id && !nextBreaks[host.id]) {
    overlayZoneKey = nextBreaks[result.created.id] ? result.created.id : null;
  }

  return {
    zones: result.zones,
    created: result.created,
    host,
    clone: result.clone,
    nextFlowState: {
      breaksByZone: nextBreaks,
      overlayEnabled: flowState.overlayEnabled,
      overlayZoneKey,
    },
  };
}

/** Receta atómica: aplica el partido de zona y actualiza `moduleState['flow-capacity']` en un solo `commit`. */
export function applySplitZoneAtBreak(project: Project, wellId: string, plan: Exclude<SplitBreakPlan, { error: string }>): Project {
  const withZones = applyZoneEdit(project, wellId, plan.zones, plan.clone);
  return setModuleState(withZones, wellId, MODULE_ID, encodeFlowState(plan.nextFlowState));
}

/** Indica si existe una zona que contenga estrictamente `depth` y pueda partirse allí. */
export function findSplittableHostZone(zones: readonly Zone[], depth: number): Zone | null {
  if (!Number.isFinite(depth)) return null;
  return zones.find((z) => z.top < depth && depth < z.base) ?? null;
}
