/**
 * De plantilla de pistas + datos del pozo + resultados del motor → pistas listas para dibujar.
 * Puro (sin React ni DOM). docs/decisiones/0005-visor-multipista.md, D3 y D4.
 *
 * - `{ role }`: curvas medidas con ese rol + salida activa del módulo que produce ese puerto.
 * - `{ curveId }`: una curva puntual.
 * - `{ unassigned: dimensión }`: curvas medidas sin rol de esa magnitud (AT10/AT30 en ohm·m).
 * - `collect`: la pista toma las calculadas (o banderas) que ninguna otra pista ubicó → un módulo nuevo se ve sin
 *   tocar nada.
 * Las curvas medidas se convierten a la unidad canónica de su rol (caché por identidad del array).
 * Estilo: override de curva → override de rol → plantilla → curveStyle() (paleta + catálogo de roles).
 */
import type { CurveDisplayOverride, FillSpec, TrackSpec } from '../core/display';
import type { RoleCatalog, RoleId } from '../core/roles';
import { convertArray, getUnit, sameDimension, unitLabel, type UnitId } from '../core/units';
import type { Curve } from '../core/well';
import { ensureContrast } from '../ui/color';
import { curveStyle, dashPattern, FILL_PALETTE, type CurveStyle, type FillId } from '../ui/curves';
import { THEMES, type ThemeName } from '../ui/tokens';
import { dataRange, validScale, type AxisScale } from './scale';

/** Curva calculada por el motor (salida de un módulo). */
export interface ComputedCurve {
  port: RoleId;
  moduleId: string;
  label: string;
  data: Float64Array;
  /** true si alimenta la cadena (fuente elegida del puerto). Las alternativas no se dibujan en 4a. */
  active: boolean;
}

export interface ViewerSources {
  depth: Float64Array;
  /** Curvas medidas del pozo. */
  curves: readonly Curve[];
  computed: readonly ComputedCurve[];
  catalog: RoleCatalog;
}

export interface DisplayOverrides {
  roles?: Readonly<Record<string, CurveDisplayOverride>>;
  /** Overrides por id de curva de ESTE pozo. */
  curves?: Readonly<Record<string, CurveDisplayOverride>>;
}

export interface ResolvedCurve {
  /** 'm:<curveId>' (medida) o 'c:<moduleId>:<puerto>' (calculada). */
  key: string;
  /** Nombre en el encabezado (mnemónico o rol). */
  name: string;
  role: RoleId | null;
  /** Unidad de `data` (canónica del rol si se pudo convertir). */
  unit: UnitId;
  unitLabel: string;
  origin: 'measured' | 'computed';
  moduleId?: string;
  curveId?: string;
  /** Datos en `unit` (no modificar). */
  data: Float64Array;
  axis: AxisScale;
  wrap: boolean;
  kind: 'line' | 'band';
  /** Estilo por tema (color con contraste garantizado contra el fondo de pista). */
  styles: Readonly<Record<ThemeName, CurveStyle>>;
  /** Descripción para tooltips y lectura accesible. */
  title: string;
}

export interface ResolvedFill {
  kind: FillSpec['kind'];
  a: ResolvedCurve;
  b?: ResolvedCurve;
  /** edge: borde; baseline: valor de la línea base. */
  side?: 'left' | 'right';
  baseline?: number;
  /** Relleno donde `a` queda a la izquierda (de b, del borde o de la línea base). */
  aLeft?: FillId;
  /** Relleno donde `a` queda a la derecha. */
  bLeft?: FillId;
  opacity: number;
}

export interface ResolvedTrack {
  id: string;
  title: string;
  kind: TrackSpec['kind'];
  width: number;
  /** Ancho fijo en px (profundidad, banderas). */
  fixed?: number;
  curves: ResolvedCurve[];
  fills: ResolvedFill[];
  /** Escala de la grilla vertical (null = sin grilla, p. ej. banderas). */
  grid: AxisScale | null;
  emptyHint?: string;
}

export const DEPTH_TRACK_WIDTH = 76;
const FLAG_COLUMN = 18;

const isFillId = (id: string | undefined): id is FillId => !!id && id in FILL_PALETTE;

// ── conversión a unidad canónica (caché) ───────────────────────────────────────────────────────────────────────

const converted = new WeakMap<Float64Array, Map<string, Float64Array>>();

function toCanonical(c: Curve, catalog: RoleCatalog): { data: Float64Array; unit: UnitId } {
  const role = c.role ? catalog.get(c.role) : undefined;
  if (!role || role.unit === c.unit || !getUnit(c.unit) || !sameDimension(c.unit, role.unit)) return { data: c.data, unit: c.unit };
  let byUnit = converted.get(c.data);
  if (!byUnit) converted.set(c.data, (byUnit = new Map()));
  const key = `${c.unit}>${role.unit}`;
  let data = byUnit.get(key);
  if (!data) byUnit.set(key, (data = convertArray(c.data, c.unit, role.unit)));
  return { data, unit: role.unit };
}

// ── estilo ─────────────────────────────────────────────────────────────────────────────────────────────────────

function merge(...layers: (CurveDisplayOverride | undefined)[]): CurveDisplayOverride {
  const out: CurveDisplayOverride = {};
  for (const l of layers) if (l) for (const [k, v] of Object.entries(l)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

function makeCurve(
  base: { key: string; name: string; role: RoleId | null; unit: UnitId; origin: 'measured' | 'computed'; data: Float64Array; moduleId?: string; curveId?: string; title: string },
  catalog: RoleCatalog,
  track: TrackSpec,
  layers: CurveDisplayOverride,
): ResolvedCurve | null {
  if (layers.hidden) return null;
  const light = curveStyle(base.role, 'light', catalog, base.name);
  const roleKnown = !!(base.role && catalog.get(base.role)?.display);
  // Escala: overrides → paleta/catálogo → escala de la pista → rango de los datos.
  const fromRole: Partial<AxisScale> = roleKnown ? { kind: light.scale, ...(light.min !== undefined ? { min: light.min } : {}), ...(light.max !== undefined ? { max: light.max } : {}), reversed: light.reversed } : {};
  const fromTrack: Partial<AxisScale> = track.scale ? { kind: track.scale.kind, min: track.scale.min, max: track.scale.max } : {};
  const pick = <K extends keyof AxisScale>(k: K, ov: AxisScale[K] | undefined): AxisScale[K] | undefined => ov ?? (fromRole[k] as AxisScale[K] | undefined) ?? (fromTrack[k] as AxisScale[K] | undefined);
  let kind = pick('kind', layers.scale) ?? 'linear';
  let min = pick('min', layers.min);
  let max = pick('max', layers.max);
  if (min === undefined || max === undefined) {
    const r = dataRange(base.data);
    min ??= r?.min ?? 0;
    max ??= r?.max ?? 1;
  }
  const reversed = layers.reversed ?? fromRole.reversed ?? false;
  let axis = validScale({ kind, min, max, reversed });
  if (!axis) {
    kind = 'linear';
    axis = validScale({ kind, min, max, reversed }) ?? { kind: 'linear', min: 0, max: 1, reversed };
  }
  const kindLine: 'line' | 'band' = light.kind;
  const styles = {} as Record<ThemeName, CurveStyle>;
  for (const theme of ['light', 'dark'] as const) {
    const s = theme === 'light' ? light : curveStyle(base.role, theme, catalog, base.name);
    const width = layers.width ?? s.width;
    const line = layers.line ?? s.line;
    const color = layers.color ? ensureContrast(layers.color, THEMES[theme].viewer.trackBg, 3) : s.color;
    styles[theme] = { ...s, color, width, line, dash: dashPattern(line, width), scale: axis.kind, min: axis.min, max: axis.max, reversed: axis.reversed };
  }
  return {
    ...base,
    unitLabel: unitLabel(base.unit),
    axis,
    wrap: (layers.wrap ?? false) && axis.kind === 'linear',
    kind: kindLine,
    styles,
  };
}

// ── resolución ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Arma las pistas a dibujar. Las pistas `hideWhenEmpty` sin curvas se omiten. */
export function resolveTracks(layout: readonly TrackSpec[], src: ViewerSources, overrides: DisplayOverrides = {}): ResolvedTrack[] {
  const { catalog } = src;
  const n = src.depth.length;
  const measured = src.curves.filter((c) => c.data.length === n);
  const computed = src.computed.filter((c) => c.active && c.data.length === n);
  const placed = new Set<string>();

  const measuredCurve = (c: Curve, track: TrackSpec, tpl?: CurveDisplayOverride) => {
    const { data, unit } = toCanonical(c, catalog);
    const role = c.role;
    const layers = merge(tpl, role ? overrides.roles?.[role] : undefined, overrides.curves?.[c.id]);
    const roleLabel = role ? catalog.get(role)?.label : undefined;
    return makeCurve(
      { key: `m:${c.id}`, name: c.mnemonic, role, unit, origin: 'measured', data, curveId: c.id, title: roleLabel ? `${c.mnemonic} — ${roleLabel}` : c.mnemonic },
      catalog,
      track,
      layers,
    );
  };
  const computedCurve = (c: ComputedCurve, track: TrackSpec, tpl?: CurveDisplayOverride) => {
    const layers = merge(tpl, overrides.roles?.[c.port]);
    const def = catalog.get(c.port);
    return makeCurve(
      { key: `c:${c.moduleId}:${c.port}`, name: c.port, role: c.port, unit: def?.unit ?? 'unitless', origin: 'computed', data: c.data, moduleId: c.moduleId, title: `${def?.label ?? c.label} (calculada)` },
      catalog,
      track,
      layers,
    );
  };
  const isFlag = (role: RoleId | null) => !!role && catalog.get(role)?.family === 'flag';

  // 1) selectores explícitos; 2) recolectores (después, para que tomen solo lo no ubicado).
  const perTrack = new Map<TrackSpec, ResolvedCurve[]>();
  for (const t of layout) {
    if (t.kind === 'depth') continue;
    const list: ResolvedCurve[] = [];
    const add = (rc: ResolvedCurve | null) => {
      if (!rc || list.some((x) => x.key === rc.key)) return;
      list.push(rc);
      placed.add(rc.key);
    };
    for (const entry of t.curves ?? []) {
      const sel = entry.select;
      if ('role' in sel) {
        for (const c of measured) if (c.role === sel.role) add(measuredCurve(c, t, entry.style));
        for (const c of computed) if (c.port === sel.role) add(computedCurve(c, t, entry.style));
      } else if ('curveId' in sel) {
        const c = measured.find((m) => m.id === sel.curveId);
        if (c) add(measuredCurve(c, t, entry.style));
      } else {
        for (const c of measured) if (!c.role && getUnit(c.unit)?.dimension === sel.unassigned) add(measuredCurve(c, t, entry.style));
      }
    }
    perTrack.set(t, list);
  }
  for (const t of layout) {
    if (!t.collect) continue;
    const list = perTrack.get(t)!;
    for (const c of computed) {
      const key = `c:${c.moduleId}:${c.port}`;
      if (placed.has(key) || isFlag(c.port) !== (t.collect === 'flags')) continue;
      const rc = computedCurve(c, t);
      if (!rc || (t.collect === 'computed' && rc.kind === 'band')) continue;
      list.push(rc);
      placed.add(key);
    }
    if (t.collect === 'flags') {
      for (const c of measured) {
        const key = `m:${c.id}`;
        if (placed.has(key) || !isFlag(c.role)) continue;
        const rc = measuredCurve(c, t);
        if (rc) {
          list.push(rc);
          placed.add(key);
        }
      }
    }
  }

  const out: ResolvedTrack[] = [];
  for (const t of layout) {
    if (t.kind === 'depth') {
      out.push({ id: t.id, title: t.title, kind: 'depth', width: 0, fixed: DEPTH_TRACK_WIDTH, curves: [], fills: [], grid: null });
      continue;
    }
    const curves = perTrack.get(t)!;
    if (curves.length === 0 && t.hideWhenEmpty) continue;
    const byRole = (role: RoleId) => curves.find((c) => c.role === role && c.kind === 'line');
    const fills: ResolvedFill[] = [];
    for (const f of t.fills ?? []) {
      const opacity = f.opacity ?? 1;
      if (f.kind === 'between') {
        const a = byRole(f.a);
        const b = byRole(f.b);
        if (a && b) fills.push({ kind: 'between', a, b, ...(isFillId(f.aLeft) ? { aLeft: f.aLeft } : {}), ...(isFillId(f.bLeft) ? { bLeft: f.bLeft } : {}), opacity });
      } else if (f.kind === 'edge') {
        const a = byRole(f.curve);
        // Borde izquierdo: el relleno está a la derecha del borde → la curva queda a la derecha (bLeft).
        if (a && isFillId(f.fill)) fills.push({ kind: 'edge', a, side: f.side, ...(f.side === 'left' ? { bLeft: f.fill } : { aLeft: f.fill }), opacity });
      } else {
        const a = byRole(f.curve);
        if (a) fills.push({ kind: 'baseline', a, baseline: f.value, ...(isFillId(f.left) ? { aLeft: f.left } : {}), ...(isFillId(f.right) ? { bLeft: f.right } : {}), opacity });
      }
    }
    const grid: AxisScale | null =
      t.kind === 'flags' ? null : t.scale ? (validScale({ kind: t.scale.kind, min: t.scale.min, max: t.scale.max, reversed: false }) ?? null) : (curves.find((c) => c.kind === 'line')?.axis ?? { kind: 'linear', min: 0, max: 1, reversed: false });
    out.push({
      id: t.id,
      title: t.title,
      kind: t.kind,
      width: t.width ?? 1,
      ...(t.kind === 'flags' ? { fixed: Math.max(88, 14 + FLAG_COLUMN * Math.max(1, curves.length)) } : {}),
      curves,
      fills,
      grid,
      ...(t.emptyHint ? { emptyHint: t.emptyHint } : {}),
    });
  }
  return out;
}
