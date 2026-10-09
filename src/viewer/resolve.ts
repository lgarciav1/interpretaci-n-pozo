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
import type { CurveDisplayOverride, FillSpec, StackSpec, TrackSpec } from '../core/display';
import type { RoleCatalog, RoleId } from '../core/roles';
import { convertArray, getUnit, sameDimension, unitLabel, type UnitId } from '../core/units';
import type { Curve } from '../core/well';
import { ensureContrast } from '../ui/color';
import { curveStyle, dashPattern, FILL_PALETTE, type CurveStyle, type FillId } from '../ui/curves';
import { THEMES, type ThemeName } from '../ui/tokens';
import { dataRange, validScale, type AxisScale } from './scale';
import { computeStack, type StackResult } from './stack';

/** Curva calculada por el motor (salida de un módulo). */
export interface ComputedCurve {
  port: RoleId;
  moduleId: string;
  label: string;
  data: Float64Array;
  /**
   * true si alimenta la cadena (fuente elegida del puerto). Las alternativas (`compare`) se dibujan en la misma pista,
   * rayadas y translúcidas, con la etiqueta «alternativa»; no alimentan rellenos ni superposiciones.
   */
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
  /** Salida calculada que no alimenta la cadena (método en comparación). */
  alternative: boolean;
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
  /** Nombre corto para encabezados angostos (banderas: «Arcilla» en vez de «SHALE_FLAG»). */
  short: string;
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
  /** 'between': por posición en pantalla o por valor (aLeft = a < b). */
  compare: 'screen' | 'value';
  opacity: number;
}

/** Curva oculta por el usuario (para volver a mostrarla desde el encabezado). */
export interface HiddenCurve {
  key: string;
  name: string;
  role: RoleId | null;
  curveId?: string;
  origin: 'measured' | 'computed';
}

/** Pila resuelta de una pista 'stack'. */
export interface ResolvedStack extends StackResult {
  spec: StackSpec;
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
  /**
   * Escala de la grilla vertical (null = sin grilla, p. ej. banderas): la de la curva de arriba de la pista (la
   * última), así la grilla coincide siempre con una escala que se ve; sin curvas, la de la pista.
   */
  grid: AxisScale | null;
  emptyHint?: string;
  /** Pistas 'overlay': superposición que la dibuja y unidad de su escala. */
  overlayId?: string;
  unit?: string;
  /** Pistas 'stack': capas, leyenda y entradas faltantes. */
  stack?: ResolvedStack;
  /** Curvas de la pista ocultas por el usuario. */
  hidden?: HiddenCurve[];
}

/**
 * Curva de una pista por clave o por rol. Por rol, la calculada (salida activa del motor) gana a la medida: si el
 * usuario calculó VSH, los rellenos y las superposiciones usan esa y no la del archivo.
 */
export function findCurve(curves: readonly ResolvedCurve[], roleOrKey: string, lineOnly = false): ResolvedCurve | undefined {
  const ok = (c: ResolvedCurve) => !lineOnly || c.kind === 'line';
  // Por rol nunca una alternativa: los rellenos y las superposiciones siguen a la fuente que alimenta la cadena.
  return (
    curves.find((c) => c.key === roleOrKey && ok(c)) ??
    curves.find((c) => c.role === roleOrKey && c.origin === 'computed' && !c.alternative && ok(c)) ??
    curves.find((c) => c.role === roleOrKey && !c.alternative && ok(c))
  );
}

/** Nombre corto: banderas por su rol sin «Bandera de» («Arcilla», «Reservorio neto»); el resto, el mnemónico. */
function shortName(name: string, kind: 'line' | 'band', roleLabel: string | undefined): string {
  if (kind !== 'band' || !roleLabel) return name;
  const s = roleLabel.replace(/^bandera\s+de\s+(la\s+|l\s+)?/i, '').trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : name;
}

/** Mínimo válido para una escala log cuando el pedido no sirve (≤ 0): la década por debajo del P1 positivo. */
export function logFloor(data: ArrayLike<number>, max: number): number {
  const pos: number[] = [];
  for (let i = 0; i < data.length; i += Math.max(1, Math.floor(data.length / 4000))) {
    const v = data[i]!;
    if (v > 0 && Number.isFinite(v)) pos.push(v);
  }
  pos.sort((a, b) => a - b);
  const p1 = pos.length ? pos[Math.floor(pos.length * 0.01)]! : NaN;
  let min = p1 > 0 ? 10 ** Math.floor(Math.log10(p1)) : max > 0 ? max / 1e4 : 0.1;
  if (!(min < max)) min = max / 1e4;
  return +min.toPrecision(6);
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
  base: { key: string; name: string; role: RoleId | null; unit: UnitId; origin: 'measured' | 'computed'; alternative: boolean; data: Float64Array; moduleId?: string; curveId?: string; title: string },
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
  const reversed = layers.reversed ?? fromRole.reversed ?? track.scale?.reversed ?? false;
  if (kind === 'log') {
    // Se conserva la escala log pedida: un mínimo ≤ 0 (GR 0–150 pasada a log, RT con min 0) se reemplaza por el
    // primero válido (rol → pista → década de los datos), nunca se cae a lineal sin avisar.
    const positive = (v: number | undefined) => (v !== undefined && v > 0 ? v : undefined);
    if (!(max! > 0)) max = positive(fromRole.max) ?? positive(fromTrack.max) ?? dataRange(base.data)?.max ?? 1;
    if (!(min! > 0) || !(min! < max!)) {
      const cand = [positive(fromRole.min), positive(fromTrack.min)].find((v) => v !== undefined && v < max!);
      min = cand ?? logFloor(base.data, max!);
    }
  }
  let axis = validScale({ kind, min: min!, max: max!, reversed });
  if (!axis) {
    // Lineal con min ≥ max: se ensancha al rango de los datos.
    const r = dataRange(base.data);
    kind = 'linear';
    axis = validScale({ kind, min: Math.min(min!, r?.min ?? min!), max: Math.max(max!, r?.max ?? max! + 1), reversed }) ?? { kind: 'linear', min: 0, max: 1, reversed };
  }
  const kindLine: 'line' | 'band' = light.kind;
  const styles = {} as Record<ThemeName, CurveStyle>;
  for (const theme of ['light', 'dark'] as const) {
    const s = theme === 'light' ? light : curveStyle(base.role, theme, catalog, base.name);
    const width = layers.width ?? s.width;
    // Alternativa: rayada salvo que el usuario elija otro trazo (además se dibuja translúcida).
    const line = layers.line ?? (base.alternative && s.line === 'solid' ? 'dashed' : s.line);
    const color = layers.color ? ensureContrast(layers.color, THEMES[theme].viewer.trackBg, 3) : s.color;
    styles[theme] = { ...s, color, width, line, dash: dashPattern(line, width), scale: axis.kind, min: axis.min, max: axis.max, reversed: axis.reversed };
  }
  return {
    ...base,
    unitLabel: unitLabel(base.unit),
    short: shortName(base.name, kindLine, base.role ? catalog.get(base.role)?.label : undefined),
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
  // Activas primero: en una pista, la alternativa queda debajo de la que alimenta la cadena.
  const computed = src.computed.filter((c) => c.data.length === n).sort((a, b) => Number(a.active) - Number(b.active));
  const placed = new Set<string>();
  const hiddenBy = new Map<TrackSpec, HiddenCurve[]>();
  const hide = (track: TrackSpec, h: HiddenCurve) => {
    const list = hiddenBy.get(track) ?? [];
    if (!list.some((x) => x.key === h.key)) list.push(h);
    hiddenBy.set(track, list);
    placed.add(h.key);
  };

  const measuredCurve = (c: Curve, track: TrackSpec, tpl?: CurveDisplayOverride) => {
    const { data, unit } = toCanonical(c, catalog);
    const role = c.role;
    const layers = merge(tpl, role ? overrides.roles?.[role] : undefined, overrides.curves?.[c.id]);
    const roleLabel = role ? catalog.get(role)?.label : undefined;
    const key = `m:${c.id}`;
    if (layers.hidden) {
      hide(track, { key, name: c.mnemonic, role, curveId: c.id, origin: 'measured' });
      return null;
    }
    return makeCurve(
      { key, name: c.mnemonic, role, unit, origin: 'measured', alternative: false, data, curveId: c.id, title: roleLabel ? `${c.mnemonic} — ${roleLabel}` : c.mnemonic },
      catalog,
      track,
      layers,
    );
  };
  const computedCurve = (c: ComputedCurve, track: TrackSpec, tpl?: CurveDisplayOverride) => {
    const layers = merge(tpl, overrides.roles?.[c.port]);
    const def = catalog.get(c.port);
    const key = `c:${c.moduleId}:${c.port}`;
    if (layers.hidden) {
      hide(track, { key, name: c.port, role: c.port, origin: 'computed' });
      return null;
    }
    const title = c.active ? `${def?.label ?? c.label} (calculada)` : `${def?.label ?? c.label} · alternativa (${c.label}): calculada para comparar, no alimenta la cadena`;
    return makeCurve(
      { key, name: c.port, role: c.port, unit: def?.unit ?? 'unitless', origin: 'computed', alternative: !c.active, data: c.data, moduleId: c.moduleId, title },
      catalog,
      track,
      layers,
    );
  };
  /** Entrada de una pila: la calculada activa gana a la medida (en unidad canónica). */
  const stackSource = (role: RoleId): Float64Array | undefined => {
    const c = computed.find((x) => x.active && x.port === role);
    if (c) return c.data;
    const m = measured.find((x) => x.role === role);
    return m ? toCanonical(m, catalog).data : undefined;
  };
  const isFlag = (role: RoleId | null) => !!role && catalog.get(role)?.family === 'flag';

  // 1) selectores explícitos; 2) recolectores (después, para que tomen solo lo no ubicado).
  const perTrack = new Map<TrackSpec, ResolvedCurve[]>();
  for (const t of layout) {
    if (t.kind === 'depth' || t.kind === 'overlay' || t.kind === 'stack') continue;
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
    if (!t.collect || !perTrack.has(t)) continue;
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
    if (t.kind === 'stack') {
      if (!t.stack) continue;
      out.push({
        id: t.id,
        title: t.title,
        kind: 'stack',
        width: t.width ?? 1,
        curves: [],
        fills: [],
        grid: { kind: 'linear', min: 0, max: 1, reversed: false },
        stack: cachedStack(t.stack, n, stackSource),
        ...(t.emptyHint ? { emptyHint: t.emptyHint } : {}),
      });
      continue;
    }
    if (t.kind === 'overlay') {
      // Pista propia de una superposición: se conserva sin curvas; la escala es la de la pista.
      const sc = t.scale ? validScale({ kind: t.scale.kind, min: t.scale.min, max: t.scale.max, reversed: t.scale.reversed ?? false }) : null;
      out.push({
        id: t.id,
        title: t.title,
        kind: 'overlay',
        width: t.width ?? 1,
        curves: [],
        fills: [],
        grid: sc ?? { kind: 'linear', min: 0, max: 1, reversed: false },
        ...(t.overlayId ? { overlayId: t.overlayId } : {}),
        ...(t.unit !== undefined ? { unit: t.unit } : {}),
      });
      continue;
    }
    const curves = perTrack.get(t)!;
    const hidden = hiddenBy.get(t);
    if (curves.length === 0 && !hidden?.length && t.hideWhenEmpty) continue;
    const byRole = (role: RoleId) => findCurve(curves, role, true);
    const fills: ResolvedFill[] = [];
    for (const f of t.fills ?? []) {
      const opacity = f.opacity ?? 1;
      if (f.kind === 'between') {
        const a = byRole(f.a);
        const b = byRole(f.b);
        if (a && b) fills.push({ kind: 'between', a, b, ...(isFillId(f.aLeft) ? { aLeft: f.aLeft } : {}), ...(isFillId(f.bLeft) ? { bLeft: f.bLeft } : {}), compare: f.compare ?? 'screen', opacity });
      } else if (f.kind === 'edge') {
        const a = byRole(f.curve);
        // Borde izquierdo: el relleno está a la derecha del borde → la curva queda a la derecha (bLeft).
        if (a && isFillId(f.fill)) fills.push({ kind: 'edge', a, side: f.side, ...(f.side === 'left' ? { bLeft: f.fill } : { aLeft: f.fill }), compare: 'screen', opacity });
      } else {
        const a = byRole(f.curve);
        if (a) fills.push({ kind: 'baseline', a, baseline: f.value, ...(isFillId(f.left) ? { aLeft: f.left } : {}), ...(isFillId(f.right) ? { bLeft: f.right } : {}), compare: 'screen', opacity });
      }
    }
    const top = [...curves].reverse().find((c) => c.kind === 'line');
    const trackScale = t.scale ? validScale({ kind: t.scale.kind, min: t.scale.min, max: t.scale.max, reversed: t.scale.reversed ?? false }) : null;
    const grid: AxisScale | null = t.kind === 'flags' ? null : (top?.axis ?? trackScale ?? { kind: 'linear', min: 0, max: 1, reversed: false });
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
      ...(hidden?.length ? { hidden } : {}),
    });
  }
  return out;
}

/** Caché de una pila por spec y por identidad de sus entradas (resolver no recalcula si no cambió nada). */
const stackCache = new WeakMap<StackSpec, { n: number; inputs: (Float64Array | undefined)[]; value: ResolvedStack }>();

function cachedStack(spec: StackSpec, n: number, source: (role: RoleId) => Float64Array | undefined): ResolvedStack {
  const roles = [...new Set(spec.components.flatMap(function walk(c): string[] {
    return [...(c.factors ?? []).map((f) => f.role), ...(c.children ?? []).flatMap(walk)];
  }))];
  const inputs = roles.map(source);
  const hit = stackCache.get(spec);
  if (hit && hit.n === n && hit.inputs.length === inputs.length && hit.inputs.every((a, i) => a === inputs[i])) return hit.value;
  const byRole = new Map(roles.map((r, i) => [r, inputs[i]]));
  const value: ResolvedStack = { spec, ...computeStack(spec, n, (r) => byRole.get(r)) };
  stackCache.set(spec, { n, inputs, value });
  return value;
}
