/**
 * Sarta de perfilaje: modelo puro (docs/decisiones/0032-sarta-de-perfilaje.md).
 *
 * - `ToolStringState` es lo que se guarda (en `Interpretation.toolString`, por pozo): modo, herramientas apagadas,
 *   orden propio y sarta planificada. Ausente = modo «datos» sin nada apagado (proyectos anteriores a la fase 11).
 * - `resolveToolString` arma la sarta que se ve (arriba → abajo) con las curvas que registró cada herramienta y dice
 *   qué curvas del pozo quedan afuera (`excluded`). Esa misma regla la aplican el motor (`planGraph`) y el visor:
 *   un filtro sobre las curvas, nunca un borrado de datos ni una edición de las pistas.
 * - `moduleAvailability`: clausura sobre el registro de qué módulos pueden correr con lo que cubre la sarta, y para
 *   los que no, qué roles faltan y qué herramientas los darían.
 *
 * Puro: sin React ni stores. Lo consume directo la vista de la sarta (fase 11c).
 */
import type { Interpretation } from './interpretation';
import { portOf, type AnyModule } from './module';
import type { RoleCatalog, RoleId } from './roles';
import type { ToolCatalog, ToolCurveRef, ToolDef } from './tools';

// ---------------------------------------------------------------------------------------------------------------
// Estado guardado

/**
 * 'data': la sarta sale sola de las curvas del pozo; apagar una herramienta saca sus curvas del cálculo y del visor.
 * 'planning': la usuaria arma la sarta; el cálculo y el visor muestran solo los datos de las herramientas
 * planificadas (vista previa de lo que daría esa corrida) y la disponibilidad dice qué módulos correrían con ella
 * aunque el pozo no tenga esos datos.
 */
export type ToolStringMode = 'data' | 'planning';

export interface ToolStringState {
  mode: ToolStringMode;
  /** Herramientas apagadas (ids). Valen en los dos modos: una herramienta apagada está apagada. */
  off: string[];
  /** Orden propio de la sarta de datos, arriba → abajo. Las que falten van debajo, por orden típico. */
  order: string[];
  /** Sarta planificada, arriba → abajo (se conserva al volver al modo datos). */
  plan: string[];
}

export const DEFAULT_TOOL_STRING: Readonly<ToolStringState> = Object.freeze({ mode: 'data', off: [], order: [], plan: [] }) as Readonly<ToolStringState>;

/** Estado de la sarta de una interpretación (el de por defecto si no tiene). */
export function toolStringOf(i: Pick<Interpretation, 'toolString'>): ToolStringState {
  return i.toolString ?? (DEFAULT_TOOL_STRING as ToolStringState);
}

/** true si el estado no cambia nada respecto del de por defecto (entonces no se guarda). */
export function isDefaultToolString(s: ToolStringState | undefined): boolean {
  return !s || (s.mode === 'data' && s.off.length === 0 && s.order.length === 0 && s.plan.length === 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Sarta resuelta

export interface ToolStringEntry {
  tool: ToolDef;
  on: boolean;
  /** Curvas del pozo que registró esta herramienta (ids, orden del pozo). Vacío = sin datos en este pozo. */
  curveIds: string[];
  /** Roles con datos en este pozo, en el orden de `tool.roles`. */
  roles: RoleId[];
  hasData: boolean;
}

export interface ResolvedToolString {
  mode: ToolStringMode;
  /** Herramientas de la sarta, arriba → abajo. */
  entries: ToolStringEntry[];
  /** Curvas que el motor y el visor no ven: de una herramienta apagada o fuera de la sarta planificada. */
  excluded: ReadonlySet<string>;
  /** Curvas que no dependen de la sarta: sin rol o con un rol que ninguna herramienta registra (BS, curvas interpretadas). */
  uncontrolled: string[];
  /** Planificación: herramientas con datos en el pozo que no están en la sarta planificada (sus curvas quedan afuera). */
  outsidePlan: string[];
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Herramienta que registró cada curva con rol (las que no tienen herramienta no figuran). */
function attribute(curves: readonly ToolCurveRef[], tools: ToolCatalog): Map<string, ToolDef> {
  const owner = new Map<string, ToolDef>();
  for (const c of curves) {
    const t = tools.ownerOf(c);
    if (t) owner.set(c.id, t);
  }
  return owner;
}

/** Ids de las herramientas con datos en el pozo, por orden típico en la sarta (la sarta «de datos» sin ajustes). */
export function derivedToolIds(curves: readonly ToolCurveRef[], tools: ToolCatalog): string[] {
  const present = new Set([...attribute(curves, tools).values()]);
  return tools
    .all()
    .filter((t) => present.has(t))
    .slice()
    .sort((a, b) => a.typicalOrder - b.typicalOrder)
    .map((t) => t.id);
}

/** Orden propio sobre una lista: primero las de `order` (en ese orden), después el resto como venían. */
function applyOrder(ids: readonly string[], order: readonly string[]): string[] {
  if (!order.length) return [...ids];
  const rank = new Map(order.map((id, i) => [id, i]));
  return ids
    .map((id, i) => ({ id, i }))
    .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.i - b.i)
    .map((x) => x.id);
}

/** Arma la sarta que se ve, con las curvas de cada herramienta y las que quedan fuera del cálculo y del visor. */
export function resolveToolString(curves: readonly ToolCurveRef[], state: ToolStringState | undefined, tools: ToolCatalog): ResolvedToolString {
  const s = state ?? (DEFAULT_TOOL_STRING as ToolStringState);
  const owner = attribute(curves, tools);
  const curvesOf = new Map<string, ToolCurveRef[]>();
  const uncontrolled: string[] = [];
  for (const c of curves) {
    const t = owner.get(c.id);
    if (!t) uncontrolled.push(c.id);
    else curvesOf.set(t.id, [...(curvesOf.get(t.id) ?? []), c]);
  }
  const off = new Set(s.off);
  const ids =
    s.mode === 'planning'
      ? [...new Set(s.plan)].filter((id) => tools.has(id))
      : applyOrder(derivedToolIds(curves, tools), s.order);
  const entries = ids.map((id): ToolStringEntry => {
    const tool = tools.get(id)!;
    const own = curvesOf.get(id) ?? [];
    const present = new Set(own.map((c) => c.role));
    return { tool, on: !off.has(id), curveIds: own.map((c) => c.id), roles: tool.roles.filter((r) => present.has(r)), hasData: own.length > 0 };
  });
  const visibleTools = new Set(entries.filter((e) => e.on).map((e) => e.tool.id));
  const excluded = new Set<string>();
  for (const [curveId, t] of owner) if (!visibleTools.has(t.id)) excluded.add(curveId);
  const inString = new Set(ids);
  const outsidePlan = s.mode === 'planning' ? [...curvesOf.keys()].filter((id) => !inString.has(id)) : [];
  return { mode: s.mode, entries, excluded: excluded.size ? excluded : EMPTY_SET, uncontrolled, outsidePlan };
}

/** Curvas fuera del cálculo y del visor (rápido: vacío sin tocar nada si el estado es el de por defecto). */
export function excludedCurveIds(curves: readonly ToolCurveRef[], state: ToolStringState | undefined, tools: ToolCatalog): ReadonlySet<string> {
  if (isDefaultToolString(state)) return EMPTY_SET;
  return resolveToolString(curves, state, tools).excluded;
}

/**
 * Curvas que ven el motor y el visor. Devuelve EL MISMO array si no hay nada excluido (los memos de la interfaz y
 * la caché del visor dependen de la identidad).
 */
export function filterCurvesByToolString<C extends ToolCurveRef>(curves: readonly C[], state: ToolStringState | undefined, tools: ToolCatalog): readonly C[] {
  const excluded = excludedCurveIds(curves, state, tools);
  return excluded.size ? curves.filter((c) => !excluded.has(c.id)) : curves;
}

// ---------------------------------------------------------------------------------------------------------------
// Disponibilidad de módulos

/**
 * - 'available': puede correr con los datos que ven el motor y el visor.
 * - 'needs-data': solo en planificación: correría con la sarta planificada, pero el pozo no tiene esos datos.
 * - 'unavailable': a la sarta le faltan herramientas (o nadie produce una entrada que no es curva).
 * - 'disabled': el módulo está desactivado en la interpretación.
 */
export type AvailabilityStatus = 'available' | 'needs-data' | 'unavailable' | 'disabled';

/** Un dato que falta en la base de la cadena: un rol medido (con las herramientas que lo registran) u otro puerto. */
export interface MissingNeed {
  port: string;
  /** Herramientas que lo registran (orden del catálogo). Vacío = ninguna herramienta lo mide y ningún módulo lo produce. */
  tools: string[];
}

export interface ModuleAvailability {
  moduleId: string;
  status: AvailabilityStatus;
  /** Entradas obligatorias directas que no quedan cubiertas (puertos), con la sarta (planificada, si corresponde). */
  missingInputs: string[];
  /**
   * Datos medidos que faltan, siguiendo el camino más corto por los módulos productores (PHIE → RHOB): lo que hay que
   * sumar a la sarta. En 'needs-data', los que faltan en el pozo.
   */
  needs: MissingNeed[];
  /** 'needs-data': herramientas de la sarta planificada sin los datos que hacen falta en este pozo. */
  toolsWithoutData: string[];
}

export interface AvailabilityReport {
  mode: ToolStringMode;
  /** Por id de módulo, en orden del registro. */
  modules: Map<string, ModuleAvailability>;
  /** Puertos cubiertos con los datos (curvas visibles + salidas de módulos disponibles). */
  covered: ReadonlySet<string>;
}

export interface AvailabilityRegistry {
  readonly modules: readonly AnyModule[];
  readonly tools: ToolCatalog;
}

const DATA = '@data';

/**
 * Menor punto fijo: un módulo está disponible si cada entrada obligatoria la cubre un dato o la salida de OTRO módulo
 * disponible (un ciclo no se justifica a sí mismo). Misma regla que la viabilidad de `planGraph`.
 */
function closure(modules: readonly AnyModule[], covered: ReadonlySet<string>, disabled: ReadonlySet<string>): { available: Set<string>; ports: Set<string> } {
  const providers = new Map<string, Set<string>>();
  for (const p of covered) providers.set(p, new Set([DATA]));
  const available = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of modules) {
      if (disabled.has(m.id) || available.has(m.id)) continue;
      const ok = Object.values(m.inputs).every((spec) => {
        if (spec.optional) return true;
        const by = providers.get(portOf(spec));
        return !!by && [...by].some((x) => x !== m.id);
      });
      if (!ok) continue;
      available.add(m.id);
      changed = true;
      for (const spec of Object.values(m.outputs)) {
        const port = portOf(spec);
        const by = providers.get(port) ?? new Set<string>();
        by.add(m.id);
        providers.set(port, by);
      }
    }
  }
  return { available, ports: new Set(providers.keys()) };
}

/**
 * Datos medidos que faltan para cubrir `port`, por el camino más corto: el propio rol si alguna herramienta lo mide, o
 * lo que falta a algún productor. null = imposible (nadie lo mide ni lo produce, o solo por un ciclo).
 */
function makeNeedFinder(modules: readonly AnyModule[], tools: ToolCatalog, ports: ReadonlySet<string>, disabled: ReadonlySet<string>) {
  const producers = new Map<string, AnyModule[]>();
  for (const m of modules) {
    if (disabled.has(m.id)) continue;
    for (const spec of Object.values(m.outputs)) producers.set(portOf(spec), [...(producers.get(portOf(spec)) ?? []), m]);
  }
  const memo = new Map<string, string[]>();
  const need = (port: string, visiting: ReadonlySet<string>): string[] | null => {
    if (ports.has(port)) return [];
    const hit = memo.get(port);
    if (hit) return hit;
    let best: string[] | null = tools.toolsForRole(port).length ? [port] : null;
    for (const p of producers.get(port) ?? []) {
      if (visiting.has(p.id)) continue;
      const inner = new Set(visiting).add(p.id);
      const acc = new Set<string>();
      let ok = true;
      for (const spec of Object.values(p.inputs)) {
        if (spec.optional) continue;
        const sub = need(portOf(spec), inner);
        if (!sub) {
          ok = false;
          break;
        }
        sub.forEach((x) => acc.add(x));
        if (best && acc.size >= best.length) break; // no mejora
      }
      if (ok && (!best || acc.size < best.length)) best = [...acc];
    }
    if (best) memo.set(port, best);
    return best;
  };
  return need;
}

function rolesOfEntries(entries: readonly ToolStringEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) if (e.on) e.tool.roles.forEach((r) => out.add(r));
  return out;
}

/**
 * Disponibilidad de cada módulo del registro con la sarta resuelta.
 *
 * - Cubierto con datos = roles de las curvas que ven el motor y el visor (`curves` menos `resolved.excluded`).
 * - En planificación, además, cubierto en hipótesis = los roles que registran las herramientas prendidas de la sarta
 *   (aunque el pozo no tenga esas curvas): lo disponible así y no con datos es 'needs-data'.
 */
export function moduleAvailability(
  registry: AvailabilityRegistry,
  curves: readonly ToolCurveRef[],
  resolved: ResolvedToolString,
  opts: { disabled?: readonly string[] } = {},
): AvailabilityReport {
  const disabled = new Set(opts.disabled ?? []);
  const realCovered = new Set<string>();
  for (const c of curves) if (c.role && !resolved.excluded.has(c.id)) realCovered.add(c.role);
  const real = closure(registry.modules, realCovered, disabled);
  const planning = resolved.mode === 'planning';
  const hypo = planning ? closure(registry.modules, new Set([...realCovered, ...rolesOfEntries(resolved.entries)]), disabled) : real;
  const needHypo = makeNeedFinder(registry.modules, registry.tools, hypo.ports, disabled);
  const needReal = planning ? makeNeedFinder(registry.modules, registry.tools, real.ports, disabled) : needHypo;
  const toolIds = (port: string) => registry.tools.toolsForRole(port).map((t) => t.id);

  const leafNeeds = (m: AnyModule, ports: ReadonlySet<string>, need: ReturnType<typeof makeNeedFinder>): { missing: string[]; needs: MissingNeed[] } => {
    const missing: string[] = [];
    const leaves = new Map<string, MissingNeed>();
    for (const spec of Object.values(m.inputs)) {
      if (spec.optional) continue;
      const port = portOf(spec);
      if (ports.has(port)) continue;
      missing.push(port);
      const sub = need(port, new Set([m.id]));
      for (const leaf of sub ?? [port]) if (!leaves.has(leaf)) leaves.set(leaf, { port: leaf, tools: sub ? toolIds(leaf) : [] });
    }
    return { missing, needs: [...leaves.values()] };
  };

  const modules = new Map<string, ModuleAvailability>();
  for (const m of registry.modules) {
    if (disabled.has(m.id)) {
      modules.set(m.id, { moduleId: m.id, status: 'disabled', missingInputs: [], needs: [], toolsWithoutData: [] });
      continue;
    }
    if (real.available.has(m.id)) {
      modules.set(m.id, { moduleId: m.id, status: 'available', missingInputs: [], needs: [], toolsWithoutData: [] });
      continue;
    }
    if (hypo.available.has(m.id)) {
      // Correría con la sarta planificada: lo que falta son datos del pozo de herramientas que ya están en la sarta.
      const { missing, needs } = leafNeeds(m, real.ports, needReal);
      const planned = resolved.entries.filter((e) => e.on);
      const without = new Set<string>();
      for (const n of needs) for (const e of planned) if (e.tool.roles.includes(n.port)) without.add(e.tool.id);
      modules.set(m.id, { moduleId: m.id, status: 'needs-data', missingInputs: missing, needs, toolsWithoutData: [...without] });
      continue;
    }
    const { missing, needs } = leafNeeds(m, hypo.ports, needHypo);
    modules.set(m.id, { moduleId: m.id, status: 'unavailable', missingInputs: missing, needs, toolsWithoutData: [] });
  }
  return { mode: resolved.mode, modules, covered: real.ports };
}

/**
 * Herramientas apagadas de la sarta que habilitarían un módulo (o lo acercarían): las que registran algún dato que le
 * falta. Para el botón «Prender …» del panel del módulo.
 */
export function offToolsFor(av: ModuleAvailability, resolved: ResolvedToolString): ToolDef[] {
  const wanted = new Set(av.needs.map((n) => n.port));
  return resolved.entries.filter((e) => !e.on && e.tool.roles.some((r) => wanted.has(r)) && (resolved.mode === 'planning' || e.hasData)).map((e) => e.tool);
}

/** Módulos que dejarían de estar disponibles si se apaga una herramienta (para la ficha: «habilita …»). */
export function modulesEnabledBy(
  registry: AvailabilityRegistry,
  curves: readonly ToolCurveRef[],
  state: ToolStringState | undefined,
  toolId: string,
  opts: { disabled?: readonly string[] } = {},
): string[] {
  const s = state ?? (DEFAULT_TOOL_STRING as ToolStringState);
  const on = { ...s, off: s.off.filter((id) => id !== toolId) };
  const off = { ...s, off: [...on.off, toolId] };
  const a = moduleAvailability(registry, curves, resolveToolString(curves, on, registry.tools), opts);
  const b = moduleAvailability(registry, curves, resolveToolString(curves, off, registry.tools), opts);
  const usable = (x: ModuleAvailability | undefined) => x?.status === 'available' || x?.status === 'needs-data';
  return registry.modules.filter((m) => usable(a.modules.get(m.id)) && !usable(b.modules.get(m.id))).map((m) => m.id);
}

// ---------------------------------------------------------------------------------------------------------------
// Textos

/** Motivo en español, sin ecuaciones, de por qué un módulo no está disponible ('' si lo está). */
export function availabilityReason(av: ModuleAvailability, ctx: { tools: ToolCatalog; roles: RoleCatalog; resolved: ResolvedToolString }): string {
  const { tools, roles, resolved } = ctx;
  const name = (id: string) => tools.get(id)?.name ?? id;
  const what = (port: string) => {
    const label = roles.get(port)?.label;
    return label ? `${port} (${label.charAt(0).toLowerCase()}${label.slice(1)})` : port;
  };
  const or = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} o ${xs[xs.length - 1]}`);
  switch (av.status) {
    case 'available':
      return '';
    case 'disabled':
      return 'El módulo está desactivado.';
    case 'needs-data':
      return `Correría con la sarta planificada, pero el pozo no tiene ${or(av.needs.map((n) => what(n.port)))}${
        av.toolsWithoutData.length ? ` de ${or(av.toolsWithoutData.map(name))}` : ''
      }.`;
    case 'unavailable': {
      const entries = new Map(resolved.entries.map((e) => [e.tool.id, e]));
      const parts = av.needs.map((n) => {
        if (!n.tools.length) return `Falta ${what(n.port)}: ningún módulo disponible lo calcula.`;
        const offTools = n.tools.filter((id) => entries.get(id) && !entries.get(id)!.on && (resolved.mode === 'planning' || entries.get(id)!.hasData));
        if (offTools.length) return `Falta ${what(n.port)}: prendé ${or(offTools.map(name))} en la sarta.`;
        if (resolved.mode === 'planning') return `Falta ${what(n.port)}: agregá ${or(n.tools.map(name))} a la sarta.`;
        return `Falta ${what(n.port)}: el pozo no la tiene (la registra ${or(n.tools.map(name))}).`;
      });
      return parts.join(' ');
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Validación al abrir un proyecto

const TOOL_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Sarta leída de un archivo: lo inválido se descarta con aviso. No conoce el registro a propósito: un id de
 * herramienta bien formado que la app no conoce (de un módulo quitado) se conserva y `resolveToolString` lo ignora,
 * así volver a agregar el módulo restituye la sarta. Devuelve undefined si no queda nada distinto del estado por
 * defecto (proyectos anteriores a la fase 11: no traen el campo).
 */
export function sanitizeToolString(raw: unknown, where: string, warn: (m: string) => void): ToolStringState | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warn(`${where}: la sarta de perfilaje es inválida; se usa la que sale de los datos.`);
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  let mode: ToolStringMode = 'data';
  if (r['mode'] === 'planning' || r['mode'] === 'data') mode = r['mode'];
  else if (r['mode'] !== undefined) warn(`${where}: modo de sarta desconocido '${String(r['mode'])}'; se usa el modo datos.`);
  const ids = (key: string, label: string): string[] => {
    const v = r[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      warn(`${where}: ${label} de la sarta no es una lista; se descarta.`);
      return [];
    }
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== 'string' || !TOOL_ID.test(x)) warn(`${where}: ${label} de la sarta tiene un id inválido (${JSON.stringify(x)}); se descarta.`);
      else if (!out.includes(x)) out.push(x);
    }
    return out;
  };
  const state: ToolStringState = { mode, off: ids('off', 'la lista de apagadas'), order: ids('order', 'el orden'), plan: ids('plan', 'la sarta planificada') };
  return isDefaultToolString(state) ? undefined : state;
}
