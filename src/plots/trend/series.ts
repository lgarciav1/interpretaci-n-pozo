/**
 * SERIES DE DATOS PARA TENDENCIAS (docs/decisiones/0008-tendencias-y-gradientes.md, D3).
 *
 * Una tendencia nombra sus datos con `SeriesRef { provider, key }` y un PROVEEDOR los resuelve. Así la misma
 * herramienta sirve sobre curvas del visor, presiones MDT (6b-2), plugs de corona en un crossplot k–φ (6b-3) y
 * cualquier crossplot o histograma (fase 7), sin que el núcleo sepa de ninguno.
 *
 * Un módulo agrega proveedores en `src/modules/<id>/series.ts` (descubierto solo por `src/app/trends/providers.ts`):
 *
 *     export const seriesProviders: TrendSeriesProvider[] = [{
 *       id: 'mdt', label: 'Presiones MDT',
 *       list: (ctx) => [{ key: 'all', label: 'Presiones MDT', group: 'MDT' }],
 *       resolve: (ctx, key) => ({ ...x = profundidad, y = presión, xIsDepth: true, placement: { overlayId: 'mdt' },
 *                                 pointKey: (i) => puntos[i].id }),
 *     }];
 *
 * Puro: sin React ni stores (el contexto llega armado).
 */
import { canonicalCurveData } from '../../core/canonical';
import type { Interpretation } from '../../core/interpretation';
import type { RoleCatalog } from '../../core/roles';
import type { SeriesRef } from '../../core/trends';
import { unitLabel, type UnitId } from '../../core/units';
import type { Well } from '../../core/well';
import type { ComputedCurve } from '../../viewer/resolve';

/** Lo que un proveedor puede leer (SOLO LECTURA): pozo, interpretación y curvas calculadas activos, roles. */
export interface SeriesContext {
  well: Readonly<Well>;
  interpretation: Readonly<Interpretation>;
  computed: readonly ComputedCurve[];
  catalog: RoleCatalog;
}

/** Opción para elegir en el panel. */
export interface SeriesOption {
  key: string;
  label: string;
  /** Agrupa en el selector («Medidas», «Calculadas»). */
  group?: string;
  /** Unidad de y, para mostrar. */
  unit?: string;
}

export interface ResolvedSeries {
  ref: SeriesRef;
  /** Nombre corto para la ecuación y la lista (mnemónico, rol). */
  label: string;
  /**
   * Variable independiente. Si `xIsDepth`, profundidad en m, NO decreciente (se admiten repetidas: dos pretests MDT a
   * la misma cota) y finita (los puntos sin profundidad se dejan afuera de la serie).
   * La serie es INMUTABLE: los cachés de ajuste van por identidad del objeto, así que si los datos cambian el
   * proveedor devuelve OTRO objeto (nunca mutar `x`/`y` en el lugar).
   */
  x: ArrayLike<number>;
  /** Variable dependiente. */
  y: ArrayLike<number>;
  /** Profundidad de cada punto (m), para filtrar por tramo o zona cuando x no es la profundidad. */
  depth?: ArrayLike<number>;
  xUnit: UnitId;
  yUnit: UnitId;
  xScale: 'linear' | 'log';
  yScale: 'linear' | 'log';
  /**
   * x es la profundidad: el tramo se busca por bisección, la pendiente es un GRADIENTE (unidades de campo con
   * `gradientReadings`) y el visor la dibuja (profundidad vertical, valor en la escala de la pista).
   */
  xIsDepth: boolean;
  /** Clave estable de un punto (para excluirlo): profundidad redondeada, id de la medición… */
  pointKey(i: number): string;
  /** Índice de una clave (−1 si no está). Opcional: si falta, se recorre `pointKey`. */
  indexOfKey?(key: string): number;
  /**
   * Dónde se dibuja en el visor: `roleOrKey` = la pista que tenga esa curva (se usa `track.xOf(roleOrKey, v)`);
   * `overlayId` = la pista propia de esa superposición (`track.xOf(null, v)`). Sin `placement`, no va al visor.
   */
  placement?: { roleOrKey: string } | { overlayId: string };
  /**
   * Etiqueta en el visor: 'full' (ecuación; R² y gradiente; por defecto) o 'gradient' (una línea con el gradiente y,
   * si es de presión, la densidad equivalente: pistas angostas con varias rectas, como la de presiones MDT).
   */
  canvasLabel?: 'full' | 'gradient';
  /**
   * false: el visor no ofrece excluir muestras con un clic ni las marca al hacer zoom: los puntos los maneja el
   * módulo dueño de la serie (MDT: incluir o descartar una prueba vale para todos los ajustes). Por defecto, true.
   */
  pickSamples?: boolean;
}

export interface TrendSeriesProvider {
  /** Único (va en `SeriesRef.provider` y se guarda en el proyecto: no cambiarlo). */
  id: string;
  label: string;
  list(ctx: SeriesContext): SeriesOption[];
  /** null si la clave ya no existe (curva borrada): la tendencia queda «sin datos», no se rompe. */
  resolve(ctx: SeriesContext, key: string): ResolvedSeries | null;
}

export interface SeriesRegistry {
  providers: readonly TrendSeriesProvider[];
  get(id: string): TrendSeriesProvider | undefined;
  resolve(ctx: SeriesContext, ref: SeriesRef): ResolvedSeries | null;
  /** Todas las opciones de todos los proveedores, con su `SeriesRef`. */
  list(ctx: SeriesContext): (SeriesOption & { ref: SeriesRef })[];
}

/** Registro de proveedores: el primero con un id gana (los repetidos se ignoran con aviso). */
export function createSeriesRegistry(providers: readonly TrendSeriesProvider[], warn: (m: string) => void = (m) => console.warn(m)): SeriesRegistry {
  const byId = new Map<string, TrendSeriesProvider>();
  for (const p of providers) {
    if (!p || typeof p.id !== 'string' || typeof p.resolve !== 'function' || typeof p.list !== 'function') {
      warn('Proveedor de series inválido (falta id, list o resolve); se ignora.');
      continue;
    }
    if (byId.has(p.id)) {
      warn(`Proveedor de series '${p.id}' repetido; se ignora.`);
      continue;
    }
    byId.set(p.id, p);
  }
  const list = [...byId.values()];
  return {
    providers: list,
    get: (id) => byId.get(id),
    resolve(ctx, ref) {
      const p = byId.get(ref.provider);
      if (!p) return null;
      try {
        return p.resolve(ctx, ref.key);
      } catch (err) {
        console.error(`Proveedor de series '${p.id}':`, err);
        return null;
      }
    },
    list(ctx) {
      return list.flatMap((p) => {
        try {
          return p.list(ctx).map((o) => ({ ...o, ref: { provider: p.id, key: o.key } }));
        } catch (err) {
          console.error(`Proveedor de series '${p.id}':`, err);
          return [];
        }
      });
    },
  };
}

// ── proveedor incorporado: curvas del visor ─────────────────────────────────────────────────────────────────────

export const CURVE_PROVIDER_ID = 'curve';

/** Clave de punto de una serie en profundidad: la profundidad redondeada a 0,1 mm (estable al reabrir el proyecto). */
export function depthPointKey(d: number): string {
  return String(Math.round(d * 1e4) / 1e4);
}

/** Primer índice con depth[i] ≥ v (depth creciente). */
export function lowerBound(depth: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = depth.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (depth[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Primer índice con depth[i] > v (depth creciente). */
export function upperBound(depth: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = depth.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (depth[mid]! <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function depthIndexOf(depth: ArrayLike<number>, key: string): number {
  const v = Number(key);
  if (!Number.isFinite(v)) return -1;
  const i = lowerBound(depth, v - 5e-5);
  return i < depth.length && Math.abs(depth[i]! - v) <= 5e-5 ? i : -1;
}

/** Clave de serie de una curva del visor: medida → `m:<id>`; calculada → `r:<ROL>` (sigue al método elegido). */
export function curveSeriesKey(c: { origin: 'measured' | 'computed'; curveId?: string; role: string | null }): string | null {
  if (c.origin === 'measured') return c.curveId ? `m:${c.curveId}` : null;
  return c.role ? `r:${c.role}` : null;
}

/** Cache por identidad de (y, profundidad): la misma serie mientras los datos no cambien (cachés de ajuste estables). */
const seriesCache = new WeakMap<Float64Array, WeakMap<Float64Array, Map<string, ResolvedSeries>>>();

function depthSeries(ref: SeriesRef, label: string, depth: Float64Array, y: Float64Array, yUnit: UnitId, yScale: 'linear' | 'log', placement: string): ResolvedSeries {
  let byDepth = seriesCache.get(y);
  if (!byDepth) seriesCache.set(y, (byDepth = new WeakMap()));
  let byKey = byDepth.get(depth);
  if (!byKey) byDepth.set(depth, (byKey = new Map()));
  const id = `${ref.provider}|${ref.key}|${label}|${yUnit}|${yScale}`;
  let s = byKey.get(id);
  if (!s) {
    s = {
      ref,
      label,
      x: depth,
      y,
      depth,
      xUnit: 'm',
      yUnit,
      xScale: 'linear',
      yScale,
      xIsDepth: true,
      pointKey: (i) => depthPointKey(depth[i]!),
      indexOfKey: (k) => depthIndexOf(depth, k),
      placement: { roleOrKey: placement },
    };
    byKey.set(id, s);
  }
  return s;
}

const isFlag = (catalog: RoleCatalog, role: string | null) => !!role && catalog.get(role)?.family === 'flag';

/**
 * Curvas del visor: medidas (en la unidad canónica de su rol, la misma conversión del visor) y calculadas activas.
 * x = profundidad (m), y = valor. Se excluyen las banderas (0/1: una tendencia no tiene sentido).
 */
export const curveSeriesProvider: TrendSeriesProvider = {
  id: CURVE_PROVIDER_ID,
  label: 'Curvas del pozo',
  list(ctx) {
    const out: SeriesOption[] = [];
    for (const c of ctx.well.curves) {
      if (isFlag(ctx.catalog, c.role)) continue;
      const role = c.role ? ctx.catalog.get(c.role) : undefined;
      out.push({ key: `m:${c.id}`, label: role ? `${c.mnemonic} · ${role.label}` : c.mnemonic, group: 'Medidas', unit: unitLabel(canonicalCurveData(c, ctx.catalog).unit) });
    }
    const seen = new Set<string>();
    for (const c of ctx.computed) {
      if (!c.active || seen.has(c.port) || isFlag(ctx.catalog, c.port)) continue;
      seen.add(c.port);
      const role = ctx.catalog.get(c.port);
      out.push({ key: `r:${c.port}`, label: role ? `${c.port} · ${role.label}` : c.port, group: 'Calculadas', ...(role ? { unit: unitLabel(role.unit) } : {}) });
    }
    return out;
  },
  resolve(ctx, key) {
    const depth = ctx.well.depth.values;
    const ref = { provider: CURVE_PROVIDER_ID, key };
    if (key.startsWith('m:')) {
      const c = ctx.well.curves.find((x) => x.id === key.slice(2));
      if (!c) return null;
      const { data, unit } = canonicalCurveData(c, ctx.catalog);
      const scale = (c.role && ctx.catalog.get(c.role)?.display?.scale) || 'linear';
      return depthSeries(ref, c.mnemonic, depth, data, unit, scale, key);
    }
    if (key.startsWith('r:')) {
      const role = key.slice(2);
      const def = ctx.catalog.get(role);
      const scale = def?.display?.scale ?? 'linear';
      const comp = ctx.computed.find((c) => c.active && c.port === role);
      if (comp && comp.data.length === depth.length) return depthSeries(ref, role, depth, comp.data, def?.unit ?? 'unitless', scale, role);
      const m = ctx.well.curves.find((c) => c.role === role);
      if (!m) return null;
      const { data, unit } = canonicalCurveData(m, ctx.catalog);
      return depthSeries(ref, m.mnemonic, depth, data, unit, scale, role);
    }
    return null;
  },
};
