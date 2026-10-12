/**
 * Lógica pura de «Zonas sugeridas» (sin React): lee la tabla del módulo, ordena y filtra las propuestas, marca las
 * que caen cerca de un tope o base existente y acepta límites en el modelo de zonas (recetas puras del proyecto, una
 * sola entrada de deshacer por aceptación).
 *
 * Aceptar un límite a la profundidad d (el límite cae entre dos muestras: arriba la última muestra < d, abajo la
 * primera ≥ d):
 * - Dentro de una zona: la parte. Arriba queda la original (su id, nombre, color y parámetros); abajo una zona nueva
 *   que hereda tipo y parámetros (es la misma roca hasta que el usuario diga otra cosa), con el nombre de la original
 *   numerado («B» → «B 2») y el siguiente color de la paleta de zonas.
 * - Fuera de toda zona (pozo sin zonas, o un hueco entre zonas): el hueco se llena con dos zonas nuevas, una a cada
 *   lado del límite («Z1», «Z2»…), así el primer «Aceptar» en un pozo sin zonas ya deja el pozo zonificado.
 * - Ninguna zona queda más delgada que MIN_ZONE_THICKNESS: un límite pegado a un tope existente no se acepta.
 */
import type { TableCell } from '../../core/module';
import type { ParamValue } from '../../core/params';
import { getWellEntry, setZones, updateInterpretation, type Project } from '../../core/state/project';
import { defaultZoneName, MIN_ZONE_THICKNESS } from '../../core/state/zones';
import type { Zone } from '../../core/well';

type Row = Readonly<Record<string, TableCell>>;

const num = (c: TableCell | undefined): number => (typeof c === 'number' && Number.isFinite(c) ? c : NaN);

/** Distancia (m) a un tope o base existente por debajo de la cual se avisa «ya hay un tope cerca». */
export const NEAR_EXISTING_M = 2;

export interface Suggestion {
  /** Identidad estable mientras no cambien los parámetros (la profundidad propuesta, en mm). */
  key: string;
  rank: number;
  /** Profundidad propuesta por el motor (m). */
  depth: number;
  strengthRel: number;
  contrast: number;
  valueAbove: number;
  valueBelow: number;
  contrastRhob: number;
  contrastLogRt: number;
}

export const suggestionKey = (depth: number): string => String(Math.round(depth * 1000));

/** Propuestas de la tabla del módulo, ordenadas por fuerza (rank 1 = la más fuerte). */
export function suggestionsFrom(rows: readonly Row[]): Suggestion[] {
  return rows
    .map((r) => {
      const depth = num(r.depth);
      return {
        key: suggestionKey(depth),
        rank: num(r.rank),
        depth,
        strengthRel: num(r.strengthRel),
        contrast: num(r.contrast),
        valueAbove: num(r.valueAbove),
        valueBelow: num(r.valueBelow),
        contrastRhob: num(r.contrastRhob),
        contrastLogRt: num(r.contrastLogRt),
      };
    })
    .filter((s) => Number.isFinite(s.depth))
    .sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity) || a.depth - b.depth);
}

export interface NearEdge {
  zoneName: string;
  edge: 'top' | 'base';
  depth: number;
  /** m, siempre ≥ 0. */
  distance: number;
}

/** Tope o base de zona existente más cercano a d, si está a ≤ `maxDist` m. */
export function nearestZoneEdge(zones: readonly Zone[], d: number, maxDist = NEAR_EXISTING_M): NearEdge | null {
  let best: NearEdge | null = null;
  for (const z of zones) {
    for (const edge of ['top', 'base'] as const) {
      const distance = Math.abs(z[edge] - d);
      if (distance <= maxDist && (!best || distance < best.distance)) best = { zoneName: z.name, edge, depth: z[edge], distance };
    }
  }
  return best;
}

export interface ShownSuggestion extends Suggestion {
  /** Profundidad que se aceptaría (la editada, si la hay). */
  effectiveDepth: number;
  edited: boolean;
  near: NearEdge | null;
}

export interface SuggestionFilter {
  /** Fuerza relativa mínima (0–1). */
  minStrength: number;
  dismissed: ReadonlySet<string>;
  edits: ReadonlyMap<string, number>;
  /** Oculta las que ya tienen un tope existente cerca. */
  hideNear?: boolean;
}

/** Propuestas visibles con su profundidad efectiva y su cercanía a un tope existente, en orden de fuerza. */
export function visibleSuggestions(list: readonly Suggestion[], zones: readonly Zone[], f: SuggestionFilter): ShownSuggestion[] {
  const out: ShownSuggestion[] = [];
  for (const s of list) {
    if (f.dismissed.has(s.key)) continue;
    if (!(s.strengthRel >= f.minStrength) && f.minStrength > 0) continue;
    const edit = f.edits.get(s.key);
    const effectiveDepth = edit ?? s.depth;
    const near = nearestZoneEdge(zones, effectiveDepth);
    if (f.hideNear && near) continue;
    out.push({ ...s, effectiveDepth, edited: edit !== undefined, near });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Aceptar límites

/** Primer índice con depth[i] ≥ d (depth creciente). */
function lowerBound(depth: ArrayLike<number>, d: number): number {
  let lo = 0;
  let hi = depth.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (depth[m]! < d - 1e-9) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** «B» → «B 2»; «B 2» → «B 3» (el primero libre). */
export function nextZoneName(zones: readonly Zone[], name: string): string {
  const taken = new Set(zones.map((z) => z.name.trim().toLowerCase()));
  const m = /^(.*?)\s+(\d+)$/.exec(name.trim());
  const root = m ? m[1]! : name.trim();
  for (let k = m ? Number(m[2]) + 1 : 2; ; k++) {
    const candidate = `${root} ${k}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Ids y colores para las zonas nuevas (los da la interfaz: `makeId` y la paleta de zonas). */
export interface NewZoneFactory {
  id(): string;
  /** Color de la próxima zona, dada la lista actual. */
  color(zones: readonly Zone[]): string;
}

export type SplitResult =
  | { zones: Zone[]; created: Zone[]; clone: { from: string; to: string } | null }
  | { error: string };

const fmtM = (v: number) => `${v.toFixed(1).replace('.', ',')} m`;

/** Parte las zonas con un límite a la profundidad d (ver el encabezado). Puro. */
export function splitZonesAt(zones: readonly Zone[], depth: ArrayLike<number>, d: number, make: NewZoneFactory): SplitResult {
  const n = depth.length;
  if (n < 2 || !Number.isFinite(d)) return { error: 'Profundidad inválida.' };
  const k = lowerBound(depth, d);
  if (k <= 0 || k >= n) return { error: `${fmtM(d)} está fuera del pozo.` };
  const above = depth[k - 1]!;
  const below = depth[k]!;
  const sorted = [...zones].sort((a, b) => a.top - b.top);
  const host = sorted.find((z) => z.top <= above + 1e-9 && z.base >= below - 1e-9);
  const thin = (top: number, base: number) => base - top < MIN_ZONE_THICKNESS - 1e-9;

  if (host) {
    if (thin(host.top, above) || thin(below, host.base)) {
      const edge = Math.abs(host.top - d) < Math.abs(host.base - d) ? `el tope de ${host.name}` : `la base de ${host.name}`;
      return { error: `Está pegado a ${edge}: una zona tiene al menos ${String(MIN_ZONE_THICKNESS).replace('.', ',')} m.` };
    }
    const lower: Zone = { id: make.id(), name: nextZoneName(zones, host.name), color: make.color(zones), kind: host.kind, top: below, base: host.base };
    const out = zones.map((z) => (z.id === host.id ? { ...z, base: above } : z));
    return { zones: [...out, lower].sort((a, b) => a.top - b.top), created: [lower], clone: { from: host.id, to: lower.id } };
  }

  // Hueco: entre la base de la zona de arriba y el tope de la de abajo (o los extremos del pozo).
  if (sorted.some((z) => z.top <= below && z.base >= above)) return { error: `${fmtM(d)} cae justo en el contacto entre dos zonas.` };
  const up = [...sorted].reverse().find((z) => z.base < below);
  const down = sorted.find((z) => z.top > above);
  const gTop = up ? depth[Math.min(n - 1, lowerBound(depth, up.base + 1e-6))]! : depth[0]!;
  const gBase = down ? depth[Math.max(0, lowerBound(depth, down.top) - 1)]! : depth[n - 1]!;
  if (thin(gTop, above) || thin(below, gBase)) return { error: `Muy cerca del borde del tramo sin zona: una zona tiene al menos ${String(MIN_ZONE_THICKNESS).replace('.', ',')} m.` };
  const z1: Zone = { id: make.id(), name: defaultZoneName(zones), color: make.color(zones), kind: 'formation', top: gTop, base: above };
  const withZ1 = [...zones, z1];
  const z2: Zone = { id: make.id(), name: defaultZoneName(withZ1), color: make.color(withZ1), kind: 'formation', top: below, base: gBase };
  return { zones: [...withZ1, z2].sort((a, b) => a.top - b.top), created: [z1, z2], clone: null };
}

export interface AcceptResult {
  project: Project;
  accepted: number[];
  /** Profundidad y motivo de los que no se pudieron aceptar. */
  skipped: { depth: number; reason: string }[];
  created: Zone[];
}

/**
 * Acepta uno o varios límites de una vez (receta pura: el llamador la pasa a `commit`, así es UNA entrada de deshacer).
 * Las zonas nuevas que salen de partir otra heredan sus parámetros por zona.
 */
export function acceptBoundaries(project: Project, wellId: string, depths: readonly number[], make: NewZoneFactory): AcceptResult {
  const entry = getWellEntry(project, wellId);
  const depthArr = entry.well.depth.values;
  let zones: Zone[] = entry.interpretation.zones;
  const accepted: number[] = [];
  const skipped: { depth: number; reason: string }[] = [];
  const created: Zone[] = [];
  const cloneFrom = new Map<string, string>();
  for (const d of [...depths].sort((a, b) => a - b)) {
    const r = splitZonesAt(zones, depthArr, d, make);
    if ('error' in r) {
      skipped.push({ depth: d, reason: r.error });
      continue;
    }
    zones = r.zones;
    created.push(...r.created);
    if (r.clone) cloneFrom.set(r.clone.to, r.clone.from);
    accepted.push(d);
  }
  if (!accepted.length) return { project, accepted, skipped, created };
  const zoneParams = entry.interpretation.params.zones;
  const paramsOf = (id: string): Record<string, ParamValue> | undefined => zoneParams[id] ?? (cloneFrom.has(id) ? paramsOf(cloneFrom.get(id)!) : undefined);
  let next = setZones(project, wellId, zones);
  const inherited: Record<string, Record<string, ParamValue>> = {};
  for (const to of cloneFrom.keys()) {
    const p = paramsOf(to);
    if (p && zones.some((z) => z.id === to)) inherited[to] = { ...p };
  }
  if (Object.keys(inherited).length) {
    next = updateInterpretation(next, wellId, (i) => ({ ...i, params: { ...i.params, zones: { ...i.params.zones, ...inherited } } }));
  }
  return { project: next, accepted, skipped, created };
}
