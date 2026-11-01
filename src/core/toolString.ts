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
import { validateExplicitSource } from './engine/explicitSource';
import type { Interpretation, SourceRef } from './interpretation';
import { groupMin, portOf, unmetInputGroup, type AnyModule, type InputGroupSpec } from './module';
import type { RoleCatalog, RoleId } from './roles';
import type { ToolCatalog, ToolCurveRef, ToolDef } from './tools';
import { ancestorToolIds } from './tools';
import { isPreparedSource } from './preparation/source';
import type { UnitId } from './units';

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
  /** Herramientas apagadas en la sarta de datos (ids). Es lo único, con `order`, que cambia el cálculo en modo datos. */
  off: string[];
  /** Orden propio de la sarta de datos, arriba → abajo. Las que falten van debajo, por orden típico. */
  order: string[];
  /** Sarta planificada, arriba → abajo (se conserva al volver al modo datos). */
  plan: string[];
  /**
   * Herramientas apagadas en la sarta planificada. Aparte de `off` a propósito: planificar es un ensayo y no puede
   * cambiar la interpretación del modo datos al volver (apagar o agregar una herramienta en el plan no la apaga ni la
   * prende en los datos).
   */
  planOff: string[];
}

export const DEFAULT_TOOL_STRING: Readonly<ToolStringState> = Object.freeze({ mode: 'data', off: [], order: [], plan: [], planOff: [] }) as Readonly<ToolStringState>;

/** Herramientas apagadas en el modo vigente (`off` en datos, `planOff` en planificación). */
export function offIdsOf(s: ToolStringState): readonly string[] {
  return s.mode === 'planning' ? s.planOff : s.off;
}

/** Estado de la sarta de una interpretación (el de por defecto si no tiene). */
export function toolStringOf(i: Pick<Interpretation, 'toolString'>): ToolStringState {
  return i.toolString ?? (DEFAULT_TOOL_STRING as ToolStringState);
}

/** true si el estado no cambia nada respecto del de por defecto (entonces no se guarda). */
export function isDefaultToolString(s: ToolStringState | undefined): boolean {
  return !s || (s.mode === 'data' && s.off.length === 0 && s.order.length === 0 && s.plan.length === 0 && s.planOff.length === 0);
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

/** Ids de las herramientas con datos en el pozo, por orden típico en la sarta (la sarta «de datos» sin ajustes). */
export function derivedToolIds(curves: readonly ToolCurveRef[], tools: ToolCatalog): string[] {
  const present = new Set(curves.flatMap(c => ancestorToolIds(c, tools)));
  return tools
    .all()
    .filter((t) => present.has(t.id))
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
  const curvesOf = new Map<string, ToolCurveRef[]>();
  const uncontrolled: string[] = [];
  for (const c of curves) {
    const ancestors = ancestorToolIds(c, tools);
    if (!ancestors.length) uncontrolled.push(c.id);
    for (const id of ancestors) curvesOf.set(id, [...(curvesOf.get(id) ?? []), c]);
  }
  const off = new Set(offIdsOf(s));
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
  for (const c of curves) if (ancestorToolIds(c, tools).some(id => !visibleTools.has(id))) excluded.add(c.id);
  const inString = new Set(ids);
  const outsidePlan = s.mode === 'planning' ? [...curvesOf.keys()].filter((id) => !inString.has(id)) : [];
  return { mode: s.mode, entries, excluded: excluded.size ? excluded : EMPTY_SET, uncontrolled, outsidePlan };
}

/** Curvas fuera del cálculo y del visor (rápido: vacío sin tocar nada si el estado es el de por defecto). */
export function excludedCurveIds(curves: readonly ToolCurveRef[], state: ToolStringState | undefined, tools: ToolCatalog): ReadonlySet<string> {
  if (isDefaultToolString(state) && !curves.some(c => c.provenance?.origin === 'prepared')) return EMPTY_SET;
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

/** Por qué una curva medida no se ve: su herramienta está apagada o (planificación) fuera de la sarta planificada. */
export interface HiddenCurve {
  curveId: string;
  mnemonic: string;
  role: RoleId | null;
  toolId: string;
  toolName: string;
  /** 'off': apagada en la sarta del modo vigente; 'outside-plan': la herramienta no está en la sarta planificada. */
  reason: 'off' | 'outside-plan';
}

const NO_HIDDEN: ReadonlyMap<string, HiddenCurve> = new Map();

/**
 * Curvas que la sarta oculta, por id, con su herramienta y el motivo (para los estados vacíos de los gráficos y la
 * lista de curvas: «RHOB está oculta: la herramienta Densidad está apagada en la sarta»). Mismo criterio que `excluded`.
 */
export function hiddenCurves(curves: readonly ToolCurveRef[], state: ToolStringState | undefined, tools: ToolCatalog): ReadonlyMap<string, HiddenCurve> {
  if (isDefaultToolString(state) && !curves.some(c => c.provenance?.origin === 'prepared')) return NO_HIDDEN;
  const resolved = resolveToolString(curves, state, tools);
  if (!resolved.excluded.size) return NO_HIDDEN;
  const inString = new Set(resolved.entries.map((e) => e.tool.id));
  const out = new Map<string, HiddenCurve>();
  for (const c of curves) {
    if (!resolved.excluded.has(c.id)) continue;
    const t = ancestorToolIds(c, tools).map(id => tools.get(id)).find(t => t && !resolved.entries.some(e => e.tool.id === t.id && e.on));
    if (!t) continue;
    out.set(c.id, { curveId: c.id, mnemonic: c.mnemonic, role: c.role, toolId: t.id, toolName: t.name, reason: inString.has(t.id) ? 'off' : 'outside-plan' });
  }
  return out;
}

/** Curvas ocultas agrupadas por herramienta (orden de aparición en el pozo): la lista de curvas dice una vez por qué. */
export interface HiddenByTool {
  toolId: string;
  toolName: string;
  reason: HiddenCurve['reason'];
  mnemonics: string[];
}

export function hiddenByTool(hidden: ReadonlyMap<string, HiddenCurve>): HiddenByTool[] {
  const byTool = new Map<string, HiddenByTool>();
  for (const h of hidden.values()) {
    const g = byTool.get(h.toolId);
    if (g) g.mnemonics.push(h.mnemonic);
    else byTool.set(h.toolId, { toolId: h.toolId, toolName: h.toolName, reason: h.reason, mnemonics: [h.mnemonic] });
  }
  return [...byTool.values()];
}

/** Motivo en español de una curva oculta («La herramienta Densidad está apagada en la sarta.»). */
export function hiddenCurveReason(h: Pick<HiddenCurve, 'toolName' | 'reason'>): string {
  return h.reason === 'off' ? `La herramienta ${h.toolName} está apagada en la sarta.` : `La herramienta ${h.toolName} no está en la sarta planificada.`;
}

/** Rótulo del atajo que la vuelve a mostrar («Prender Densidad» / «Agregar Densidad a la sarta»). */
export function showToolLabel(h: Pick<HiddenCurve, 'toolName' | 'reason'>): string {
  return h.reason === 'off' ? `Prender ${h.toolName}` : `Agregar ${h.toolName} a la sarta`;
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
  /** Módulo elegido a mano para este puerto que no se puede calcular por ningún camino (p. ej. un ciclo de elecciones). */
  chosen?: { id: string; name: string };
}

export interface ModuleAvailability {
  moduleId: string;
  blockedPreparedPorts?: string[];
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
  /** Grupos «al menos N de» sin cumplir (p. ej. PHIT sin ninguna porosidad), con lo que daría cada opción. */
  missingGroups: MissingInputGroup[];
}

/** Un grupo «al menos N de» (`inputGroups` del contrato) que no se cumple. */
export interface MissingInputGroup {
  /** Puertos del grupo, en el orden del contrato. */
  ports: string[];
  min: number;
  /** Cuántos están cubiertos. */
  have: number;
  label?: string;
  /** Datos medidos de la base de la cadena que darían alguna de las opciones que faltan (unión, sin repetir). */
  needs: MissingNeed[];
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
  readonly roles: RoleCatalog;
  get(id: string): AnyModule | undefined;
}

export interface AvailabilityOptions {
  /** Módulos desactivados en la interpretación (`Interpretation.disabled`). */
  disabled?: readonly string[];
  /**
   * Fuentes elegidas a mano (`Interpretation.sources`). El motor las respeta aunque no puedan correr (un módulo elegido
   * para Rw que necesita el SP apagado bloquea a Sw), así que la disponibilidad también.
   */
  sources?: Readonly<Record<string, SourceRef>>;
}

/** Curva del pozo para la disponibilidad: la de la sarta más su unidad (valida las fuentes explícitas como el motor). */
export type AvailabilityCurve = ToolCurveRef & { unit?: UnitId };

/** Fuente de un puerto en la clausura: los datos del pozo o el id de un módulo. */
const DATA = '@data';
type Src = string;

/** Fuentes explícitas válidas (las mismas que acepta `planGraph`): puertos con curva elegida y con módulo elegido. */
interface Explicit {
  curve: ReadonlySet<string>;
  module: ReadonlyMap<string, string>;
  blocked: ReadonlySet<string>;
}

function explicitChoices(
  registry: AvailabilityRegistry,
  visible: readonly AvailabilityCurve[],
  sources: Readonly<Record<string, SourceRef>> | undefined,
  disabled: ReadonlySet<string>,
  allCurves: readonly AvailabilityCurve[],
): Explicit {
  const curve = new Set<string>();
  const module = new Map<string, string>();
  const blocked = new Set<string>();
  if (!sources) return { curve, module, blocked };
  const byId = new Map(visible.map((c) => [c.id, c]));
  for (const [port, ref] of Object.entries(sources)) {
    // Una curva de una herramienta apagada no está en `visible`: queda en suspenso y el motor usa la fuente por defecto.
    if (validateExplicitSource(registry, byId, disabled, port, ref)) {
      if (isPreparedSource(ref) && ref.kind === 'curve' && !allCurves.some(c => c.id === ref.curveId && c.provenance?.origin !== 'prepared')) blocked.add(port);
      continue;
    }
    if (ref.kind === 'curve') curve.add(port);
    else module.set(port, ref.moduleId);
  }
  return { curve, module, blocked };
}

interface Closure {
  available: ReadonlySet<string>;
  /** Fuente con la que el motor alimenta `port` al consumidor `consumer` (null = ninguna candidata). */
  sourceFor(port: string, consumer: string): Src | null;
  /** true si la fuente de `port` para `consumer` corre (datos o un módulo disponible). */
  covers(port: string, consumer?: string): boolean;
  /** Puertos cubiertos (para un consumidor cualquiera). */
  ports: ReadonlySet<string>;
}

/**
 * Qué módulos corren, con las mismas reglas que `planGraph`:
 * 1. Viabilidad estática (2b): menor punto fijo, optimista respecto de las fuentes elegidas (un ciclo no se justifica
 *    a sí mismo).
 * 2. Fuente de cada puerto (2c): la explícita si es válida; si no, la primera candidata viable (datos primero, después
 *    módulos en orden de registro). Un módulo no se consume a sí mismo: toma la siguiente candidata.
 * 3. Disponible = corre con esas fuentes (menor punto fijo): lo que el motor deja `ready`.
 */
function closure(modules: readonly AnyModule[], covered: ReadonlySet<string>, disabled: ReadonlySet<string>, explicit: Explicit): Closure {
  const candidates = new Map<string, Src[]>();
  const add = (port: string, s: Src) => {
    if (explicit.blocked.has(port)) return;
    const list = candidates.get(port);
    if (!list) candidates.set(port, [s]);
    else if (!list.includes(s)) list.push(s);
  };
  for (const p of covered) add(p, DATA);
  for (const p of explicit.curve) add(p, DATA);
  const active = modules.filter((m) => !disabled.has(m.id));
  for (const m of active) for (const spec of Object.values(m.outputs)) add(portOf(spec), m.id);

  const fixpoint = (ok: (m: AnyModule, done: ReadonlySet<string>) => boolean): Set<string> => {
    const done = new Set<string>();
    for (let changed = true; changed; ) {
      changed = false;
      for (const m of active) {
        if (done.has(m.id) || !ok(m, done)) continue;
        done.add(m.id);
        changed = true;
      }
    }
    return done;
  };

  // 1. Viabilidad estática (entradas obligatorias y grupos «al menos N de»).
  const viable = fixpoint((m, done) => {
    const feeds = (port: string) => (candidates.get(port) ?? []).some((s) => s !== m.id && (s === DATA || done.has(s)));
    return Object.values(m.inputs).every((spec) => spec.optional || feeds(portOf(spec))) && !unmetInputGroup(m, (k) => !!m.inputs[k] && feeds(portOf(m.inputs[k]!)));
  });
  const isViable = (s: Src) => s === DATA || viable.has(s);

  // 2. Fuente elegida por puerto y por consumidor.
  const chosen = new Map<string, Src>();
  for (const [port, list] of candidates) {
    const forced = explicit.module.get(port) ?? (explicit.curve.has(port) ? DATA : undefined);
    chosen.set(port, forced ?? list.find(isViable) ?? list[0]!);
  }
  const sourceFor = (port: string, consumer: string): Src | null => {
    const c = chosen.get(port);
    if (c !== undefined && c !== consumer) return c;
    const list = candidates.get(port) ?? [];
    return list.find((s) => s !== consumer && isViable(s)) ?? list.find((s) => s !== consumer) ?? null;
  };

  // 3. Lo que corre con esas fuentes.
  const runsWith = (s: Src | null, done: ReadonlySet<string>) => s !== null && (s === DATA || done.has(s));
  const available = fixpoint((m, done) => {
    if (Object.values(m.inputs).some(spec => explicit.blocked.has(portOf(spec)))) return false;
    const runs = (port: string) => runsWith(sourceFor(port, m.id), done);
    return Object.values(m.inputs).every((spec) => spec.optional || runs(portOf(spec))) && !unmetInputGroup(m, (k) => !!m.inputs[k] && runs(portOf(m.inputs[k]!)));
  });
  const covers = (port: string, consumer = '') => runsWith(sourceFor(port, consumer), available);
  const ports = new Set([...candidates.keys()].filter((p) => covers(p)));
  return { available, sourceFor, covers, ports };
}

/**
 * Datos medidos que faltan para cubrir `port`, por el camino más corto: el propio rol si alguna herramienta lo mide, o
 * lo que falta a algún productor. Si el puerto tiene un módulo elegido a mano, solo ese productor (el motor no usa
 * otro). null = imposible (nadie lo mide ni lo produce, o solo por un ciclo).
 */
function makeNeedFinder(registry: AvailabilityRegistry, cl: Closure, disabled: ReadonlySet<string>, explicit: Explicit) {
  const producers = new Map<string, AnyModule[]>();
  for (const m of registry.modules) {
    if (disabled.has(m.id)) continue;
    for (const spec of Object.values(m.outputs)) producers.set(portOf(spec), [...(producers.get(portOf(spec)) ?? []), m]);
  }
  const memo = new Map<string, string[]>();
  const need = (port: string, visiting: ReadonlySet<string>): string[] | null => {
    if (cl.covers(port)) return [];
    if (explicit.blocked.has(port)) return null;
    const hit = memo.get(port);
    if (hit) return hit;
    const forced = explicit.module.get(port);
    let best: string[] | null = !forced && registry.tools.toolsForRole(port).length ? [port] : null;
    const options = forced ? [registry.get(forced)!] : (producers.get(port) ?? []);
    for (const p of options) {
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
      // Grupos «al menos N de»: las opciones más baratas que falten para llegar al mínimo.
      for (const g of p.inputGroups ?? []) {
        if (!ok) break;
        const picked = cheapestGroupOptions(p, g, (port) => need(port, inner));
        if (!picked) ok = false;
        else picked.forEach((x) => acc.add(x));
      }
      if (ok && (!best || acc.size < best.length)) best = [...acc];
    }
    if (best) memo.set(port, best);
    return best;
  };
  return need;
}

/**
 * Lo que falta para cumplir un grupo «al menos N de»: los datos de las opciones más baratas hasta llegar al mínimo
 * ([] si ya se cumple; null si no hay suficientes opciones posibles).
 */
function cheapestGroupOptions(m: AnyModule, g: InputGroupSpec, need: (port: string) => string[] | null): string[] | null {
  const options = g.inputs.flatMap((k) => (m.inputs[k] ? [need(portOf(m.inputs[k]!))] : [])).filter((x): x is string[] => x !== null);
  const min = groupMin(g);
  if (options.length < min) return null;
  return [...new Set(options.sort((a, b) => a.length - b.length).slice(0, min).flat())];
}

function rolesOfEntries(entries: readonly ToolStringEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) if (e.on) e.tool.roles.forEach((r) => out.add(r));
  return out;
}

/**
 * Disponibilidad de cada módulo del registro con la sarta resuelta. Misma regla que el motor (`planGraph`), incluidas
 * las fuentes elegidas a mano (`opts.sources`) y los módulos desactivados.
 *
 * - Cubierto con datos = roles de las curvas que ven el motor y el visor (`curves` menos `resolved.excluded`).
 * - En planificación, además, cubierto en hipótesis = los roles que registran las herramientas prendidas de la sarta
 *   (aunque el pozo no tenga esas curvas): lo disponible así y no con datos es 'needs-data'.
 */
export function moduleAvailability(
  registry: AvailabilityRegistry,
  curves: readonly AvailabilityCurve[],
  resolved: ResolvedToolString,
  opts: AvailabilityOptions = {},
): AvailabilityReport {
  const disabled = new Set(opts.disabled ?? []);
  const visible = resolved.excluded.size ? curves.filter((c) => !resolved.excluded.has(c.id)) : curves;
  const realCovered = new Set<string>();
  for (const c of visible) if (c.role && c.provenance?.origin !== 'prepared') realCovered.add(c.role);
  const explicit = explicitChoices(registry, visible, opts.sources, disabled, curves);
  const real = closure(registry.modules, realCovered, disabled, explicit);
  const planning = resolved.mode === 'planning';
  const hypo = planning ? closure(registry.modules, new Set([...realCovered, ...rolesOfEntries(resolved.entries)]), disabled, explicit) : real;
  const needHypo = makeNeedFinder(registry, hypo, disabled, explicit);
  const needReal = planning ? makeNeedFinder(registry, real, disabled, explicit) : needHypo;
  const toolIds = (port: string) => registry.tools.toolsForRole(port).map((t) => t.id);

  const leafNeeds = (m: AnyModule, cl: Closure, need: ReturnType<typeof makeNeedFinder>): { missing: string[]; needs: MissingNeed[]; groups: MissingInputGroup[] } => {
    const missing: string[] = [];
    const leaves = new Map<string, MissingNeed>();
    for (const spec of Object.values(m.inputs)) {
      if (spec.optional) continue;
      const port = portOf(spec);
      if (cl.covers(port, m.id)) continue;
      missing.push(port);
      const sub = need(port, new Set([m.id]));
      const forced = explicit.module.get(port);
      if (!sub && forced && !leaves.has(port)) {
        leaves.set(port, { port, tools: [], chosen: { id: forced, name: registry.get(forced)?.name ?? forced } });
        continue;
      }
      for (const leaf of sub ?? [port]) if (!leaves.has(leaf)) leaves.set(leaf, { port: leaf, tools: sub ? toolIds(leaf) : [] });
    }
    const groups: MissingInputGroup[] = [];
    for (const g of m.inputGroups ?? []) {
      const ports = g.inputs.flatMap((k) => (m.inputs[k] ? [portOf(m.inputs[k]!)] : []));
      const have = ports.filter((p) => cl.covers(p, m.id)).length;
      const min = groupMin(g);
      if (have >= min) continue;
      const opts = new Map<string, MissingNeed>();
      for (const p of ports) {
        if (cl.covers(p, m.id)) continue;
        for (const leaf of need(p, new Set([m.id])) ?? []) if (!opts.has(leaf)) opts.set(leaf, { port: leaf, tools: toolIds(leaf) });
      }
      groups.push({ ports, min, have, ...(g.label ? { label: g.label } : {}), needs: [...opts.values()] });
    }
    return { missing, needs: [...leaves.values()], groups };
  };

  const modules = new Map<string, ModuleAvailability>();
  for (const m of registry.modules) {
    if (disabled.has(m.id)) {
      modules.set(m.id, { moduleId: m.id, status: 'disabled', missingInputs: [], needs: [], toolsWithoutData: [], missingGroups: [] });
      continue;
    }
    if (real.available.has(m.id)) {
      modules.set(m.id, { moduleId: m.id, status: 'available', missingInputs: [], needs: [], toolsWithoutData: [], missingGroups: [] });
      continue;
    }
    if (hypo.available.has(m.id)) {
      // Correría con la sarta planificada: lo que falta son datos del pozo de herramientas que ya están en la sarta.
      const { missing, needs, groups } = leafNeeds(m, real, needReal);
      const planned = resolved.entries.filter((e) => e.on);
      const plannedRole = (port: string) => planned.some((e) => e.tool.roles.includes(port));
      // De los grupos, lo que daría la sarta planificada (es lo que le falta al pozo): se suma a `needs` para el motivo.
      const all = [...needs];
      for (const g of groups) for (const n of g.needs) if (plannedRole(n.port) && !all.some((x) => x.port === n.port)) all.push(n);
      const without = new Set<string>();
      for (const n of all) for (const e of planned) if (e.tool.roles.includes(n.port)) without.add(e.tool.id);
      modules.set(m.id, { moduleId: m.id, status: 'needs-data', missingInputs: missing, needs: all, toolsWithoutData: [...without], missingGroups: groups });
      continue;
    }
    const { missing, needs, groups } = leafNeeds(m, hypo, needHypo);
    const blockedPreparedPorts = Object.values(m.inputs).map(portOf).filter(port => explicit.blocked.has(port));
    modules.set(m.id, { moduleId: m.id, status: 'unavailable', missingInputs: missing, needs, toolsWithoutData: [], missingGroups: groups, ...(blockedPreparedPorts.length ? { blockedPreparedPorts } : {}) });
  }
  return { mode: resolved.mode, modules, covered: real.ports };
}

/**
 * Herramientas apagadas de la sarta que habilitarían un módulo (o lo acercarían): las que registran algún dato que le
 * falta. Para el botón «Prender …» del panel del módulo.
 */
export function offToolsFor(av: ModuleAvailability, resolved: ResolvedToolString): ToolDef[] {
  const wanted = new Set([...av.needs, ...av.missingGroups.flatMap((g) => g.needs)].map((n) => n.port));
  return resolved.entries.filter((e) => !e.on && e.tool.roles.some((r) => wanted.has(r)) && (resolved.mode === 'planning' || e.hasData)).map((e) => e.tool);
}

/** Módulos que dejarían de estar disponibles si se apaga una herramienta (para la ficha: «habilita …»). */
export function modulesEnabledBy(
  registry: AvailabilityRegistry,
  curves: readonly AvailabilityCurve[],
  state: ToolStringState | undefined,
  toolId: string,
  opts: AvailabilityOptions = {},
): string[] {
  const s = state ?? (DEFAULT_TOOL_STRING as ToolStringState);
  const key = s.mode === 'planning' ? 'planOff' : 'off';
  const on = { ...s, [key]: s[key].filter((id) => id !== toolId) };
  const off = { ...s, [key]: [...on[key], toolId] };
  const a = moduleAvailability(registry, curves, resolveToolString(curves, on, registry.tools), opts);
  const b = moduleAvailability(registry, curves, resolveToolString(curves, off, registry.tools), opts);
  const usable = (x: ModuleAvailability | undefined) => x?.status === 'available' || x?.status === 'needs-data';
  return registry.modules.filter((m) => usable(a.modules.get(m.id)) && !usable(b.modules.get(m.id))).map((m) => m.id);
}

// ---------------------------------------------------------------------------------------------------------------
// Textos

/** Motivo en español, sin ecuaciones, de por qué un módulo no está disponible ('' si lo está). */
export function availabilityReason(av: ModuleAvailability, ctx: { tools: ToolCatalog; roles: RoleCatalog; resolved: ResolvedToolString }): string {
  if (av.blockedPreparedPorts?.length) return `La fuente preparada de ${av.blockedPreparedPorts.join(', ')} no está disponible. Revisá la preparación o elegí otra fuente.`;
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
      const offAmong = (ids: readonly string[]) => ids.filter((id) => entries.get(id) && !entries.get(id)!.on && (resolved.mode === 'planning' || entries.get(id)!.hasData));
      const parts = av.needs.map((n) => {
        if (n.chosen) return `Falta ${what(n.port)}: «${n.chosen.name}», elegido a mano, no se puede calcular con ninguna sarta (p. ej. sus entradas forman un ciclo); elegí otra fuente.`;
        if (!n.tools.length) return `Falta ${what(n.port)}: ningún módulo disponible lo calcula.`;
        const offTools = offAmong(n.tools);
        if (offTools.length) return `Falta ${what(n.port)}: prendé ${or(offTools.map(name))} en la sarta.`;
        if (resolved.mode === 'planning') return `Falta ${what(n.port)}: agregá ${or(n.tools.map(name))} a la sarta.`;
        return `Falta ${what(n.port)}: el pozo no la tiene (la registra ${or(n.tools.map(name))}).`;
      });
      for (const g of av.missingGroups) {
        const head = g.label
          ? `${g.min > 1 ? 'Faltan' : 'Falta'} ${g.label}${g.min > 1 && g.have > 0 ? ` (hay ${g.have})` : ''}`
          : `Falta${g.min === 1 ? ' al menos una de' : `n al menos ${g.min} de`} ${or(g.ports.map(what))}${g.min > 1 && g.have > 0 ? ` (hay ${g.have})` : ''}`;
        const toolsOf = [...new Set(g.needs.flatMap((n) => n.tools))];
        const offTools = offAmong(toolsOf);
        if (!toolsOf.length) parts.push(`${head}: ningún módulo disponible la calcula.`);
        else if (offTools.length) parts.push(`${head}: prendé ${or(offTools.map(name))} en la sarta.`);
        else if (resolved.mode === 'planning') parts.push(`${head}: agregá ${or(toolsOf.map(name))} a la sarta.`);
        else parts.push(`${head}: el pozo no tiene esos datos (los registra ${or(toolsOf.map(name))}).`);
      }
      // Sin faltantes directos: lo bloquea un ciclo entre fuentes elegidas a mano.
      return parts.length ? parts.join(' ') : 'No se puede calcular con las fuentes elegidas a mano: forman un ciclo o dependen de un módulo que no corre.';
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
  const state: ToolStringState = {
    mode,
    off: ids('off', 'la lista de apagadas'),
    order: ids('order', 'el orden'),
    plan: ids('plan', 'la sarta planificada'),
    planOff: ids('planOff', 'la lista de apagadas de la sarta planificada'),
  };
  return isDefaultToolString(state) ? undefined : state;
}

