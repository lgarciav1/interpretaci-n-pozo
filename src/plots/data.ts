/**
 * Datos de los gráficos del dock (histograma y crossplot libre; docs/decisiones/0014). Puro: curvas por clave (las
 * mismas `m:<curva>` / `r:<ROL>` de las tendencias, en unidad canónica), escala por rol, filtro por zonas y tramos de
 * profundidad de un conjunto de muestras (para marcarlos en el visor).
 */
import type { SourceRef } from '../core/interpretation';
import type { HiddenCurve } from '../core/toolString';
import { unitLabel, type UnitId } from '../core/units';
import { layoutZones, type Zone } from '../core/well';
import { curveSeriesProvider, type SeriesContext } from './trend/series';

export interface PlotCurve {
  key: string;
  /** Nombre corto (mnemónico o rol): rótulo del eje y de la ecuación. */
  short: string;
  /** Nombre para los selectores («GR · Rayos gamma»). */
  label: string;
  role: string | null;
  unit: UnitId;
  /** Texto de la unidad («v/v», «ohm·m»), vacío si no tiene. */
  unitText: string;
  /** Datos en la unidad canónica del rol (alineados con la profundidad del pozo). */
  data: Float64Array;
  /** Escala convencional del rol (log para resistividades y permeabilidad). */
  scale: 'linear' | 'log';
  /** Rango típico de la pista (catálogo de roles). */
  typical?: { min: number; max: number };
}

export interface CurveOption {
  value: string;
  label: string;
  group: string;
}

/** Curvas que se pueden graficar: medidas (`m:`) y calculadas activas (`r:`), sin banderas. */
export function plotCurveOptions(ctx: SeriesContext): CurveOption[] {
  return curveSeriesProvider.list(ctx).map((o) => ({ value: o.key, label: o.label, group: o.group ?? 'Curvas' }));
}

/** Rol de una clave de curva (medida con rol o `r:<ROL>`); null si no tiene. */
export function roleOfKey(ctx: Pick<SeriesContext, 'well'>, key: string): string | null {
  if (key.startsWith('r:')) return key.slice(2);
  if (key.startsWith('m:')) return ctx.well.curves.find((c) => c.id === key.slice(2))?.role ?? null;
  return null;
}

/**
 * Curva medida de una clave que la sarta oculta (docs/decisiones/0032), o null. Sirve para que un gráfico con esa curva
 * elegida muestre por qué no se ve y cómo volver a verla, en vez de «ya no está en el pozo».
 */
export function hiddenCurveOfKey(ctx: Pick<SeriesContext, 'hidden'>, key: string | null): HiddenCurve | null {
  if (!key || !key.startsWith('m:') || !ctx.hidden) return null;
  return ctx.hidden.get(key.slice(2)) ?? null;
}

/** Curva medida con ese rol que la sarta oculta (la primera), o null: para explicar por qué una plantilla no se arma. */
export function hiddenCurveOfRole(ctx: Pick<SeriesContext, 'hidden'>, role: string): HiddenCurve | null {
  if (!ctx.hidden) return null;
  for (const h of ctx.hidden.values()) if (h.role === role) return h;
  return null;
}

/** Curva de una clave, o null si ya no existe (curva borrada, rol sin fuente todavía). */
export function resolvePlotCurve(ctx: SeriesContext, key: string | null): PlotCurve | null {
  if (!key) return null;
  const s = curveSeriesProvider.resolve(ctx, key);
  if (!s || !(s.y instanceof Float64Array)) return null;
  const role = roleOfKey(ctx, key);
  const def = role ? ctx.catalog.get(role) : undefined;
  const opt = curveSeriesProvider.list(ctx).find((o) => o.key === key);
  const d = def?.display;
  return {
    key,
    short: s.label,
    label: opt?.label ?? s.label,
    role,
    unit: s.yUnit,
    unitText: s.yUnit && s.yUnit !== 'unitless' ? unitLabel(s.yUnit) : '',
    data: s.y,
    scale: s.yScale,
    ...(d && d.min !== undefined && d.max !== undefined ? { typical: { min: d.min, max: d.max } } : {}),
  };
}

/** Clave de la curva a usar para un rol: la medida con ese rol si hay, o la fuente activa (`r:`). null si no hay. */
export function keyForRole(ctx: SeriesContext, role: string): string | null {
  const m = ctx.well.curves.find((c) => c.role === role);
  if (m) return `m:${m.id}`;
  if (ctx.computed.some((c) => c.active && c.port === role)) return `r:${role}`;
  return null;
}

/**
 * Datos que el motor usa para un puerto (en unidad canónica): la curva medida elegida como fuente, o la salida activa
 * del módulo. Sin fuentes (todavía no hay resultado): la calculada activa o la medida con ese rol. null si no hay.
 */
export function engineInputData(ctx: SeriesContext, sources: Readonly<Record<string, SourceRef>> | null, port: string): Float64Array | null {
  const s = sources?.[port];
  if (s?.kind === 'curve') return resolvePlotCurve(ctx, `m:${s.curveId}`)?.data ?? null;
  const computed = ctx.computed.find((c) => c.active && c.port === port)?.data;
  if (computed || s) return computed ?? null;
  return resolvePlotCurve(ctx, keyForRole(ctx, port))?.data ?? null;
}

/** Escala efectiva de un eje: la elegida o la del rol. */
export const effectiveScale = (choice: 'auto' | 'linear' | 'log', curve: Pick<PlotCurve, 'scale'> | null): 'linear' | 'log' => (choice === 'auto' ? (curve?.scale ?? 'linear') : choice);

// ── zonas ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ZoneFilter {
  /** Zona de cada muestra (índice en `zones`, −1 = sin zona). */
  zoneIndex: Int32Array;
  /** Zonas del pozo en orden de tope. */
  zones: readonly Zone[];
  /** Ids elegidos que existen (vacío = todas). */
  selected: string[];
  /** true si la muestra entra en el filtro. */
  include(i: number): boolean;
  /** Zonas a mostrar (las elegidas o todas), en orden de tope. */
  shown: readonly Zone[];
}

/**
 * Filtro por zonas: con `selected` vacío entran todas las muestras (también las fuera de toda zona); si no, solo las
 * de las zonas elegidas. Los ids que ya no existen se ignoran.
 */
export function zoneFilter(depth: ArrayLike<number>, zones: readonly Zone[], selected: readonly string[]): ZoneFilter {
  const sorted = [...zones].filter((z) => z.top < z.base).sort((a, b) => a.top - b.top);
  const layout = layoutZones(depth, sorted);
  // layoutZones ordena igual: los índices de `zoneIndex` son posiciones en `sorted`.
  const ids = selected.filter((id) => sorted.some((z) => z.id === id));
  const allow = new Uint8Array(sorted.length);
  sorted.forEach((z, j) => {
    if (ids.length === 0 || ids.includes(z.id)) allow[j] = 1;
  });
  const zi = layout.zoneIndex;
  const include = ids.length === 0 ? () => true : (i: number) => zi[i]! >= 0 && allow[zi[i]!] === 1;
  return { zoneIndex: zi, zones: sorted, selected: ids, include, shown: ids.length === 0 ? sorted : sorted.filter((z) => ids.includes(z.id)) };
}

// ── tramos de profundidad ──────────────────────────────────────────────────────────────────────────────────────

export interface DepthRun {
  top: number;
  base: number;
}

/**
 * Tramos contiguos de muestras que cumplen `pick` (para marcarlos en el visor), cada uno ensanchado medio paso de
 * muestreo a cada lado. Un hueco de hasta `gap` muestras no corta el tramo (lecturas sueltas en una capa).
 */
export function depthRuns(depth: ArrayLike<number>, pick: (i: number) => boolean, gap = 0): DepthRun[] {
  const n = depth.length;
  const out: DepthRun[] = [];
  let start = -1;
  let last = -1;
  const half = (i: number) => (n > 1 ? Math.abs(depth[Math.min(n - 1, i + 1)]! - depth[Math.max(0, i - 1)]!) / (i > 0 && i < n - 1 ? 4 : 2) : 0);
  for (let i = 0; i < n; i++) {
    if (!pick(i)) continue;
    if (start >= 0 && i - last - 1 <= gap) {
      last = i;
      continue;
    }
    if (start >= 0) out.push({ top: depth[start]! - half(start), base: depth[last]! + half(last) });
    start = last = i;
  }
  if (start >= 0) out.push({ top: depth[start]! - half(start), base: depth[last]! + half(last) });
  return out;
}

/** Índice de la muestra más cercana a una profundidad (depth creciente); −1 si está fuera del pozo por más de un paso. */
export function nearestSample(depth: ArrayLike<number>, d: number): number {
  const n = depth.length;
  if (n === 0 || !Number.isFinite(d)) return -1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (depth[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const i = Math.abs(depth[lo]! - d) <= Math.abs(depth[hi]! - d) ? lo : hi;
  const step = n > 1 ? Math.abs(depth[1]! - depth[0]!) : 1;
  return Math.abs(depth[i]! - d) <= step * 1.01 ? i : -1;
}
