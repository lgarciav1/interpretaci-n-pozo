/**
 * Recetas puras sobre zonas (topes y bases), usadas por la edición sobre el perfil (fase 4b) y el panel de zonas.
 * Trabajan sobre la lista de zonas; `applyZoneEdit` (src/core/state/project.ts) la guarda en la interpretación,
 * así el motor recalcula los parámetros por zona.
 *
 * Convenciones (docs/decisiones/0005-visor-multipista.md, D10):
 * - Los bordes se ajustan a la MUESTRA más cercana (como vienen las zonas de una columna ZONA: tope = primera
 *   muestra, base = última).
 * - Las zonas no se superponen. Mover un borde FRENA en la vecina, no la empuja: empujar en cadena puede deshacer
 *   trabajo en zonas que el usuario no está mirando.
 * - Dos zonas CONTIGUAS (separadas a lo sumo por una muestra, como A y B del TP) comparten el contacto: mover la base
 *   de una mueve el tope de la otra, conservando la separación. Sin contacto, el borde frena a una muestra de la
 *   vecina.
 * - Ninguna zona queda más delgada que `minThickness` (por defecto MIN_ZONE_THICKNESS).
 */
import type { Zone, ZoneKind } from '../well';

/** Espesor mínimo de una zona (m). */
export const MIN_ZONE_THICKNESS = 0.5;

export type ZoneEdge = 'top' | 'base';

export interface ZoneEditOptions {
  /** Profundidad de las muestras del pozo (creciente). */
  depth: ArrayLike<number>;
  minThickness?: number;
}

/** Índice de la muestra más cercana a d. */
export function nearestSample(depth: ArrayLike<number>, d: number): number {
  const n = depth.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  if (d <= depth[0]!) return 0;
  if (d >= depth[hi]!) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (depth[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return d - depth[lo]! <= depth[hi]! - d ? lo : hi;
}

/** Profundidad de la muestra más cercana. */
export function snapToSample(depth: ArrayLike<number>, d: number): number {
  const i = nearestSample(depth, d);
  return i < 0 ? d : depth[i]!;
}

/** Paso local de muestreo en torno a d. */
function localStep(depth: ArrayLike<number>, d: number): number {
  const n = depth.length;
  if (n < 2) return 1;
  const i = Math.min(n - 2, Math.max(0, nearestSample(depth, d)));
  return depth[i + 1]! - depth[i]!;
}

/** Muestras de separación entre la base de `upper` y el tope de `lower` si son contiguas (0 o 1); null si no. */
export function contactGap(upper: Zone, lower: Zone, depth: ArrayLike<number>): number | null {
  const gap = lower.top - upper.base;
  const step = localStep(depth, upper.base);
  if (gap < -1e-6) return 0; // superpuestas (archivo viejo): se tratan como contacto
  if (gap <= 1e-6) return 0;
  return gap <= step * 1.5 + 1e-6 ? 1 : null;
}

const byTop = (zones: readonly Zone[]) => [...zones].sort((a, b) => a.top - b.top);

/** Primer índice con depth ≥ d, y último con depth ≤ d. */
function firstAtOrBelow(depth: ArrayLike<number>, d: number): number {
  const i = nearestSample(depth, d);
  return depth[i]! >= d - 1e-9 ? i : i + 1;
}
function lastAtOrAbove(depth: ArrayLike<number>, d: number): number {
  const i = nearestSample(depth, d);
  return depth[i]! <= d + 1e-9 ? i : i - 1;
}

/**
 * Mueve el tope o la base de una zona a la muestra más cercana a `target`, sin superponerse con las vecinas (frena)
 * y sin dejar zonas más delgadas que el mínimo. Si comparte contacto con la vecina, la vecina se mueve con él.
 * Devuelve las zonas nuevas (la misma lista si no hubo cambio).
 */
export function moveZoneEdge(zones: readonly Zone[], zoneId: string, edge: ZoneEdge, target: number, opts: ZoneEditOptions): Zone[] {
  const { depth } = opts;
  const minT = opts.minThickness ?? MIN_ZONE_THICKNESS;
  const n = depth.length;
  const sorted = byTop(zones);
  const k = sorted.findIndex((z) => z.id === zoneId);
  if (k < 0 || n < 2 || !Number.isFinite(target)) return zones as Zone[];
  const z = sorted[k]!;
  let iLo: number;
  let iHi: number;
  let neighbor: Zone | undefined;
  let gap: number | null = null;
  if (edge === 'top') {
    neighbor = sorted[k - 1];
    gap = neighbor ? contactGap(neighbor, z, depth) : null;
    const upper = !neighbor ? depth[0]! : gap !== null ? neighbor.top + minT : neighbor.base;
    // Sin contacto, el tope queda al menos una muestra por debajo de la base de la vecina.
    iLo = !neighbor ? 0 : gap !== null ? firstAtOrBelow(depth, upper) + gap : lastAtOrAbove(depth, upper) + 1;
    iHi = lastAtOrAbove(depth, z.base - minT);
  } else {
    neighbor = sorted[k + 1];
    gap = neighbor ? contactGap(z, neighbor, depth) : null;
    iLo = firstAtOrBelow(depth, z.top + minT);
    const lower = !neighbor ? depth[n - 1]! : gap !== null ? neighbor.base - minT : neighbor.top;
    iHi = !neighbor ? n - 1 : gap !== null ? lastAtOrAbove(depth, lower) - gap : firstAtOrBelow(depth, lower) - 1;
  }
  iLo = Math.max(0, iLo);
  iHi = Math.min(n - 1, iHi);
  if (iLo > iHi) return zones as Zone[]; // ya está en el mínimo
  const i = Math.min(iHi, Math.max(iLo, nearestSample(depth, target)));
  const d = depth[i]!;
  if (d === z[edge]) return zones as Zone[];
  const moved: Zone = { ...z, [edge]: d };
  const changes = new Map<string, Zone>([[z.id, moved]]);
  if (neighbor && gap !== null) {
    const nd = edge === 'top' ? depth[i - gap]! : depth[i + gap]!;
    changes.set(neighbor.id, { ...neighbor, ...(edge === 'top' ? { base: nd } : { top: nd }) });
  }
  return zones.map((x) => changes.get(x.id) ?? x);
}

/** Desplaza un borde `deltaM` metros (↑/↓ del teclado): al menos una muestra en la dirección pedida. */
export function nudgeZoneEdge(zones: readonly Zone[], zoneId: string, edge: ZoneEdge, deltaM: number, opts: ZoneEditOptions): Zone[] {
  const z = zones.find((x) => x.id === zoneId);
  if (!z || deltaM === 0) return zones as Zone[];
  const { depth } = opts;
  const from = nearestSample(depth, z[edge]);
  const steps = Math.max(1, Math.round(Math.abs(deltaM) / localStep(depth, z[edge])));
  const to = Math.min(depth.length - 1, Math.max(0, from + Math.sign(deltaM) * steps));
  return moveZoneEdge(zones, zoneId, edge, depth[to]!, opts);
}

export interface NewZoneInput {
  id: string;
  name: string;
  color: string;
  kind?: ZoneKind;
  /** Id y nombre del resto inferior si la zona nueva parte a otra en tres. */
  lowerId?: string;
}

export type CreateZoneResult =
  | {
      zones: Zone[];
      created: Zone;
      /** Zona que quedó debajo de la nueva al partir otra: hereda los parámetros de `from`. */
      clone: { from: string; to: string } | null;
    }
  | { error: string };

/**
 * Crea una zona en el tramo [a, b] (a = donde empezó el arrastre). El tramo se acota a la zona (o al hueco) donde
 * empezó: nunca se superpone ni borra otras zonas. Dentro de una zona la parte: arriba queda la original (con su id
 * y sus parámetros), en el medio la nueva y abajo un resto que hereda los parámetros. Un resto más delgado que el
 * mínimo se suma a la nueva.
 */
export function createZone(zones: readonly Zone[], a: number, b: number, input: NewZoneInput, opts: ZoneEditOptions): CreateZoneResult {
  const { depth } = opts;
  const minT = opts.minThickness ?? MIN_ZONE_THICKNESS;
  const n = depth.length;
  if (n < 2) return { error: 'El pozo no tiene muestras suficientes.' };
  const sorted = byTop(zones);
  const host = sorted.find((z) => a >= z.top && a <= z.base) ?? null;
  // Límites del lugar donde empezó: la zona anfitriona o el hueco entre vecinas.
  let lo: number;
  let hi: number;
  if (host) {
    lo = nearestSample(depth, host.top);
    hi = nearestSample(depth, host.base);
  } else {
    const above = [...sorted].reverse().find((z) => z.base < a);
    const below = sorted.find((z) => z.top > a);
    lo = above ? lastAtOrAbove(depth, above.base) + 1 : 0;
    hi = below ? firstAtOrBelow(depth, below.top) - 1 : n - 1;
  }
  let i0 = Math.max(lo, nearestSample(depth, Math.min(a, b)));
  let i1 = Math.min(hi, nearestSample(depth, Math.max(a, b)));
  if (i1 <= i0 || depth[i1]! - depth[i0]! < minT - 1e-9) return { error: `El tramo es muy corto: una zona tiene al menos ${String(minT).replace('.', ',')} m.` };

  if (!host) {
    const created: Zone = { id: input.id, name: input.name, color: input.color, kind: input.kind ?? 'formation', top: depth[i0]!, base: depth[i1]! };
    return { zones: byTop([...zones, created]), created, clone: null };
  }
  // Restos: arriba [lo, i0 − 1], abajo [i1 + 1, hi]; los delgados se suman a la nueva.
  const upperOk = i0 - 1 >= lo && depth[i0 - 1]! - depth[lo]! >= minT - 1e-9;
  const lowerOk = i1 + 1 <= hi && depth[hi]! - depth[i1 + 1]! >= minT - 1e-9;
  if (!upperOk) i0 = lo;
  if (!lowerOk) i1 = hi;
  if (!upperOk && !lowerOk) return { error: `El tramo cubre casi toda la zona ${host.name}: cambiale el nombre o el color en vez de crear otra.` };
  const created: Zone = { id: input.id, name: input.name, color: input.color, kind: input.kind ?? host.kind, top: depth[i0]!, base: depth[i1]! };
  const out: Zone[] = [];
  let clone: { from: string; to: string } | null = null;
  for (const z of zones) {
    if (z.id !== host.id) {
      out.push(z);
      continue;
    }
    if (upperOk) out.push({ ...z, base: depth[i0 - 1]! });
    if (lowerOk) {
      const lower: Zone = { ...z, id: input.lowerId ?? `${z.id}-inf`, name: uniqueName(zones, `${z.name} inf.`), top: depth[i1 + 1]!, base: z.base };
      if (!upperOk) out.push({ ...lower, id: z.id, name: z.name }); // la original sigue siendo la de abajo
      else {
        out.push(lower);
        clone = { from: z.id, to: lower.id };
      }
    }
  }
  return { zones: byTop([...out, created]), created, clone };
}

function uniqueName(zones: readonly Zone[], base: string): string {
  const names = new Set(zones.map((z) => z.name.trim().toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let k = 2; ; k++) if (!names.has(`${base} ${k}`.toLowerCase())) return `${base} ${k}`;
}

/** Nombre por defecto para una zona nueva: «Z1», «Z2»… (el primero libre; la interfaz ya antepone «Zona»). */
export function defaultZoneName(zones: readonly Zone[]): string {
  const names = new Set(zones.map((z) => z.name.trim().toLowerCase()));
  for (let k = 1; ; k++) if (!names.has(`z${k}`)) return `Z${k}`;
}

/** Cambia nombre, color o tipo de una zona. */
export function updateZone(zones: readonly Zone[], zoneId: string, patch: Partial<Pick<Zone, 'name' | 'color' | 'kind'>>): Zone[] {
  const z = zones.find((x) => x.id === zoneId);
  if (!z) return zones as Zone[];
  const next = { ...z, ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) };
  if (next.name === z.name && next.color === z.color && next.kind === z.kind) return zones as Zone[];
  return zones.map((x) => (x.id === zoneId ? next : x));
}

/** Borra una zona (sus muestras quedan sin zona: valen los parámetros globales). */
export function deleteZone(zones: readonly Zone[], zoneId: string): Zone[] {
  return zones.some((z) => z.id === zoneId) ? zones.filter((z) => z.id !== zoneId) : (zones as Zone[]);
}

/** Valida un nombre de zona. null si sirve; si no, el motivo en español. */
export function validateZoneName(zones: readonly Zone[], zoneId: string | null, name: string): string | null {
  const t = name.trim();
  if (!t) return 'El nombre no puede quedar vacío.';
  if (t.length > 40) return 'El nombre es demasiado largo (máximo 40 caracteres).';
  if (zones.some((z) => z.id !== zoneId && z.name.trim().toLowerCase() === t.toLowerCase())) return `Ya hay una zona «${t}».`;
  return null;
}
