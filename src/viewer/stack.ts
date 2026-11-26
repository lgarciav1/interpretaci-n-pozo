/**
 * Pila de componentes que cierra a 1 (pista volumétrica, mineralogía). Puro y genérico: la pila se declara en la
 * plantilla (`StackSpec` de src/core/display.ts) y este módulo no sabe nada de arcilla ni de agua.
 * docs/decisiones/0005-visor-multipista.md, D9.
 *
 * Reglas (las heredan las pilas de Geología):
 * - Fracción de un componente = producto de sus factores (valor del rol, o 1 − valor), cada uno recortado a [0, 1].
 * - Si la suma de un nivel pasa de 1 (VSH + PHIE > 1, que no es físico) se normaliza a 1 conservando proporciones
 *   y el resto queda en 0: la columna nunca se sale de la pista ni cambia el orden de los componentes.
 * - `rest` = lo que falta para cerrar a 1. Si falta una entrada de un hermano, ese hermano no se dibuja y el resto
 *   se rotula como «sin partir» (`partialLabel`): con solo VSH se ve arcilla + resto, nunca una matriz inventada.
 * - Hijos: parten a su padre (agua + hidrocarburo = porosidad). Si les falta una entrada, el padre se dibuja entero.
 * - NaN: en un factor del primer nivel la muestra es hueco (no hay columna); en un hijo, el padre queda entero en
 *   esa muestra (se dibuja debajo de los hijos).
 */
import type { StackComponentSpec, StackSpec } from '../core/display';
import type { RoleId } from '../core/roles';

/** Una capa a dibujar: entre `left` y `right` (fracciones 0–1 del ancho de pista, NaN = hueco). */
export interface StackLayer {
  id: string;
  label: string;
  fill: string;
  left: Float32Array;
  right: Float32Array;
  /** 0 = primer nivel; 1 = hijo (se dibuja encima de su padre); 2 = nieto… */
  level: number;
  /** Id de la capa padre cuando `level > 0` (permite acotar el dibujo bajo decimación). */
  parentId?: string;
}

/** Entrada de la leyenda (lo que se lee en el encabezado y con el cursor). */
export interface StackLegendItem {
  id: string;
  label: string;
  /** Rótulo para encabezados angostos (o el mismo `label`). */
  short: string;
  fill: string;
}

export interface StackResult {
  layers: StackLayer[];
  legend: StackLegendItem[];
  /** Roles de la pila que no hay en el pozo ni en el motor. */
  missing: RoleId[];
  /** Roles usados. */
  used: RoleId[];
  /** Nada que dibujar (falta todo lo del primer nivel). */
  empty: boolean;
}

export type StackSource = (role: RoleId) => ArrayLike<number> | undefined;

interface PlanEntry {
  spec: StackComponentSpec;
  label: string;
  short: string;
  fill: string;
  /** Fuentes de los factores (vacío en el resto). */
  factors: { data: ArrayLike<number>; complement: boolean }[];
  rest: boolean;
  optional: boolean;
  childrenMode: 'fraction' | 'proportional';
  children: PlanEntry[] | null;
  /** true si en alguna muestra con ancho > 0 faltó un hijo y se vio el padre debajo. */
  hasFallback: boolean;
  /** true si al menos una muestra resolvió los hijos de este padre con valores finitos. */
  hasChildResolved: boolean;
}

const allRolesOf = (c: StackComponentSpec): RoleId[] => [...(c.factors ?? []).map((f) => f.role), ...(c.children ?? []).flatMap(allRolesOf)];
const requiredRolesOf = (c: StackComponentSpec): RoleId[] => (c.optional ? [] : [...(c.factors ?? []).map((f) => f.role), ...(c.children ?? []).flatMap(requiredRolesOf)]);

function hasFiniteSample(data: ArrayLike<number>, n: number): boolean {
  const limit = Math.min(data.length, n);
  for (let i = 0; i < limit; i++) if (Number.isFinite(data[i]!)) return true;
  return false;
}

function plan(components: readonly StackComponentSpec[], source: StackSource, child: boolean, n: number): PlanEntry[] | null {
  const entries: PlanEntry[] = [];
  let dropped = 0;
  for (const c of components) {
    if (c.rest) continue;
    const factors = (c.factors ?? []).map((f) => ({ data: source(f.role), complement: !!f.complement }));
    if (!factors.length || factors.some((f) => !f.data)) {
      dropped++;
      continue;
    }
    if (c.optional && factors.some((f) => !hasFiniteSample(f.data!, n))) {
      dropped++;
      continue;
    }
    entries.push({
      spec: c,
      label: c.label,
      short: c.short ?? c.label,
      fill: c.fill,
      factors: factors as PlanEntry['factors'],
      rest: false,
      optional: !!c.optional,
      childrenMode: c.childrenMode ?? 'fraction',
      children: c.children?.length ? plan(c.children, source, true, n) : null,
      hasFallback: false,
      hasChildResolved: false,
    });
  }
  const rest = components.find((c) => c.rest);
  // Un hijo con un hermano faltante y sin resto no puede partir al padre: el padre va entero.
  if (child && dropped > 0 && !rest) return null;
  if (!entries.length) return child ? null : [];
  const out: PlanEntry[] = [];
  for (const c of components) {
    if (c.rest) {
      const partial = dropped > 0;
      out.push({
        spec: c,
        label: partial ? (c.partialLabel ?? c.label) : c.label,
        short: partial ? (c.partialShort ?? c.partialLabel ?? c.short ?? c.label) : (c.short ?? c.label),
        fill: partial ? (c.partialFill ?? c.fill) : c.fill,
        factors: [],
        rest: true,
        optional: !!c.optional,
        childrenMode: 'fraction',
        children: null,
        hasFallback: false,
        hasChildResolved: false,
      });
    } else {
      const e = entries.find((x) => x.spec === c);
      if (e) out.push(e);
    }
  }
  return out;
}

const clip01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fracción de un componente en la muestra i (NaN si falta un dato o no es finito). */
function fractionAt(e: PlanEntry, i: number): number {
  let f = 1;
  for (const k of e.factors) {
    const v = k.data[i]!;
    if (!Number.isFinite(v)) return NaN;
    const c = clip01(v);
    f *= k.complement ? 1 - c : c;
  }
  return f;
}

/** Arma las capas de una pila para n muestras. */
export function computeStack(spec: StackSpec, n: number, source: StackSource): StackResult {
  const all = [...new Set(spec.components.flatMap(allRolesOf))];
  const required = [...new Set(spec.components.flatMap(requiredRolesOf))];
  const missing = required.filter((r) => !source(r));
  const used = all.filter((r) => !!source(r));
  const top = plan(spec.components, source, false, n) ?? [];
  const empty = top.every((e) => e.rest);
  if (empty) return { layers: [], legend: [], missing, used, empty: true };

  const legend: StackLegendItem[] = [];
  const layerOf = new Map<PlanEntry, StackLayer>();
  const make = (e: PlanEntry, level: number, parentId?: string) => {
    const l: StackLayer = {
      id: e.spec.id,
      label: e.label,
      fill: e.fill,
      left: new Float32Array(n),
      right: new Float32Array(n),
      level,
      ...(parentId ? { parentId } : {}),
    };
    layerOf.set(e, l);
    return l;
  };
  const byLevel: StackLayer[][] = [];
  const collectLayers = (entries: readonly PlanEntry[], level: number, parentId?: string) => {
    const bucket = byLevel[level] ?? (byLevel[level] = []);
    for (const e of entries) {
      bucket.push(make(e, level, parentId));
      if (e.children) collectLayers(e.children, level + 1, e.spec.id);
    }
  };
  collectLayers(top, 0);

  const fr = new Float64Array(top.length);
  for (let i = 0; i < n; i++) {
    // Primer nivel: un NaN deja la muestra sin columna.
    let sum = 0;
    let gap = false;
    for (let k = 0; k < top.length; k++) {
      const e = top[k]!;
      if (e.rest) continue;
      const f = fractionAt(e, i);
      if (f !== f) {
        gap = true;
        break;
      }
      fr[k] = f;
      sum += f;
    }
    if (gap) {
      for (const l of layerOf.values()) l.left[i] = l.right[i] = NaN;
      continue;
    }
    const scale = sum > 1 ? 1 / sum : 1;
    const rest = Math.max(0, 1 - sum * scale);
    let acc = 0;
    for (let k = 0; k < top.length; k++) {
      const e = top[k]!;
      const w = e.rest ? rest : fr[k]! * scale;
      const l = layerOf.get(e)!;
      l.left[i] = acc;
      acc += w;
      l.right[i] = acc;
      if (e.children) splitChildren(e, l.left[i]!, w, i, layerOf);
    }
  }

  // Si un refinamiento opcional no se resolvió en ninguna muestra (p. ej. factores finitos en índices disjuntos
  // o solo donde falla nivel 0/1), se descarta de capas y leyenda para evitar leyendas fantasma.
  const inactive = new Set<string>();
  const markInactive = (entries: readonly PlanEntry[]) => {
    for (const e of entries) {
      inactive.add(e.spec.id);
      if (e.children) markInactive(e.children);
    }
  };
  const buildLegend = (entries: readonly PlanEntry[]) => {
    for (const e of entries) {
      if (e.children) {
        const isOptionalGroup = e.children.some((k) => k.optional);
        if (isOptionalGroup && !e.hasChildResolved) {
          markInactive(e.children);
          legend.push({ id: e.spec.id, label: e.label, short: e.short, fill: e.fill });
          continue;
        }
        if (isOptionalGroup && e.hasFallback) {
          legend.push({ id: e.spec.id, label: e.label, short: e.short, fill: e.fill });
        }
        buildLegend(e.children);
      } else {
        legend.push({ id: e.spec.id, label: e.label, short: e.short, fill: e.fill });
      }
    }
  };
  buildLegend(top);
  const layers: StackLayer[] = byLevel.flat().filter((l) => !inactive.has(l.id)); // nivel 0, luego nivel 1, luego nivel 2…

  return { layers, legend, missing, used, empty: false };
}

/** Deja en NaN toda la descendencia en la muestra i (para que el padre quede entero sin residuos de nietos). */
function clearSubtree(children: readonly PlanEntry[], i: number, layerOf: Map<PlanEntry, StackLayer>): void {
  for (const c of children) {
    const l = layerOf.get(c)!;
    l.left[i] = l.right[i] = NaN;
    if (c.children) clearSubtree(c.children, i, layerOf);
  }
}

/** Parte [x0, x0 + w] entre los hijos; un NaN deja al padre entero en esa muestra. */
function splitChildren(parent: PlanEntry, x0: number, w: number, i: number, layerOf: Map<PlanEntry, StackLayer>): void {
  const children = parent.children!;
  let sum = 0;
  const fr: number[] = [];
  for (const k of children) {
    const f = k.rest ? 0 : fractionAt(k, i);
    if (f !== f) {
      clearSubtree(children, i, layerOf);
      if (w > 0) parent.hasFallback = true;
      return;
    }
    fr.push(f);
    sum += f;
  }
  let scale: number;
  let rest: number;
  if (parent.childrenMode === 'proportional') {
    if (sum > 0) {
      scale = 1 / sum;
      rest = 0;
    } else if (w > 0) {
      clearSubtree(children, i, layerOf);
      parent.hasFallback = true;
      return;
    } else {
      scale = 0;
      rest = 0;
    }
  } else {
    scale = sum > 1 ? 1 / sum : 1;
    rest = Math.max(0, 1 - sum * scale);
  }
  let acc = x0;
  parent.hasChildResolved = true;
  children.forEach((k, j) => {
    const cw = (k.rest ? rest : fr[j]! * scale) * w;
    const l = layerOf.get(k)!;
    l.left[i] = acc;
    acc += cw;
    l.right[i] = acc;
    if (k.children) splitChildren(k, l.left[i]!, cw, i, layerOf);
  });
}

/**
 * Acota en sitio el tramo decimado `[xa, xb]` de una capa hija (`level > 0`) dentro del tramo decimado de su padre
 * `[parentXa, parentXb]`, evitando desbordes visuales en filas mixtas con muestras resueltas y `NaN` (ADR 0091).
 */
export function clampChildDecimatedSpan(
  xa: Float32Array,
  xb: Float32Array,
  parentXa: Float32Array,
  parentXb: Float32Array,
  n: number,
): void {
  for (let k = 0; k < n; k++) {
    const pa = parentXa[k]!;
    const pb = parentXb[k]!;
    const ca = xa[k]!;
    const cb = xb[k]!;
    if (pa !== pa || pb !== pb || ca !== ca || cb !== cb) {
      xa[k] = xb[k] = NaN;
      continue;
    }
    const a = ca < pa ? pa : ca > pb ? pb : ca;
    const b = cb < a ? a : cb > pb ? pb : cb;
    xa[k] = a;
    xb[k] = b;
  }
}

/** Volumen de cada entrada de la leyenda en la muestra i (NaN = sin dato). */
export function stackReadout(result: StackResult, i: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of result.legend) {
    const l = result.layers.find((x) => x.id === item.id);
    out.set(item.id, l && i >= 0 && i < l.left.length ? l.right[i]! - l.left[i]! : NaN);
  }
  return out;
}

/** Texto para el estado vacío o parcial: «Falta VSH (paso Arcilla)…». */
export function stackHint(result: StackResult, hints: Readonly<Record<string, string>> = {}): string | null {
  if (!result.missing.length) return null;
  const parts = result.missing.map((r) => (hints[r] ? `${r} (${hints[r]})` : r));
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
  return `${result.missing.length === 1 ? 'Falta' : 'Faltan'} ${list}.`;
}
