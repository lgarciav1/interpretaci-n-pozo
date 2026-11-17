/**
 * FLUJO GUIADO — definición de pasos y evaluación de su estado. Puro (sin React), testeado en tests/flow.test.ts.
 * Ver docs/decisiones/0004-sistema-de-diseno.md, D7.
 *
 * Un paso de módulos agrupa los módulos de sus `categories` y los que producen alguno de sus `ports`: agregar un
 * módulo nuevo lo suma al paso correcto sin tocar este archivo.
 */
import { isValidParamValue, paramScope, paramStorageKey, type ParamSpec, type ParamsSpec, type ParamState, type ParamValue } from '../../core/params';
import type { StepMark } from '../../core/state/project';
import type { WorkspaceId } from '../../core/workspaces';

export type FlowStepKind = 'load' | 'qc' | 'zones' | 'modules';

export interface FlowStepDef {
  id: string;
  /** Etiqueta corta (barra de pasos). */
  label: string;
  /** Abreviatura para la barra de pasos cuando no entra el rótulo (ventana angosta, tamaño de interfaz grande). */
  short?: string;
  /** Título largo (inspector). */
  title: string;
  kind: FlowStepKind;
  /** Categorías de módulos del paso. */
  categories?: readonly string[];
  /** Puertos: todo módulo que produce alguno pertenece al paso, sea cual sea su categoría. */
  ports?: readonly string[];
  /** Puertos que completan el paso. Sin `targets`, lo completa cualquier salida de sus módulos. */
  targets?: readonly string[];
  /** Qué hacer en este paso (estado vacío / pendiente). */
  hint: string;
}

const LOAD: FlowStepDef = {
  id: 'load',
  label: 'Cargar',
  title: 'Cargar pozo',
  kind: 'load',
  hint: 'Cargá un pozo desde Excel, LAS o CSV, o usá los datos del TP.',
};
const QC: FlowStepDef = {
  id: 'qc',
  label: 'Calidad',
  title: 'Revisar calidad',
  kind: 'qc',
  hint: 'Revisá el semáforo de cada curva y los tramos con derrumbe antes de interpretar.',
};
const ZONES: FlowStepDef = {
  id: 'zones',
  label: 'Zonas',
  title: 'Zonas',
  kind: 'zones',
  hint: 'Definí los topes y las capas: todas las herramientas pueden filtrar por zona.',
};

export const PETROPHYSICS_FLOW: readonly FlowStepDef[] = [
  LOAD,
  QC,
  ZONES,
  { id: 'shale', label: 'Arcilla', title: 'Volumen de arcilla', kind: 'modules', categories: ['shale'], targets: ['VSH'], hint: 'Elegí las líneas de arena limpia y de arcilla y el método de Vsh.' },
  { id: 'porosity', label: 'Porosidad', short: 'Poros.', title: 'Porosidad', kind: 'modules', categories: ['porosity'], targets: ['PHIE'], hint: 'Calculá la porosidad efectiva a partir de densidad, neutrón o sónico.' },
  { id: 'rw', label: 'Rw', title: 'Temperatura y Rw', kind: 'modules', categories: ['water'], ports: ['RW', 'RWA', 'TEMP'], targets: ['RW'], hint: 'Fijá la temperatura de formación y obtené Rw: conocida, desde el SP o por Rwa.' },
  { id: 'saturation', label: 'Saturación', short: 'Sat.', title: 'Saturación de agua', kind: 'modules', categories: ['saturation'], targets: ['SW'], hint: 'Elegí el modelo de saturación y sus exponentes.' },
  { id: 'permeability', label: 'Permeabilidad', short: 'Perm.', title: 'Permeabilidad', kind: 'modules', categories: ['permeability'], targets: ['PERM'], hint: 'Estimá la permeabilidad con Timur o Timur–Coates (RMN).' },
  { id: 'cutoffs', label: 'Cutoffs', title: 'Cutoffs', kind: 'modules', categories: ['cutoffs'], targets: ['NET_PAY'], hint: 'Fijá los cortes de Vsh (arena neta), φ y, si querés, k (reservorio neto) y Sw (pay neto); mirá cuánto cambia el pay con cada uno.' },
  { id: 'summary', label: 'Sumario', short: 'Sum.', title: 'Sumario por zona', kind: 'modules', categories: ['summary'], targets: ['ZONE_SUMMARY'], hint: 'Revisá espesores, N/G, φ y Sw promedio por zona y exportalo.' },
  { id: 'volumetrics', label: 'Volumen', short: 'Vol.', title: 'Volumen in situ', kind: 'modules', categories: ['volumetrics'], targets: ['OOIP', 'OGIP'], hint: 'Cargá área, factor de volumen y fluido por zona para estimar el petróleo y el gas in situ.' },
];

export const GEOLOGY_FLOW: readonly FlowStepDef[] = [
  LOAD,
  QC,
  ZONES,
  { id: 'lithology', label: 'Litología', short: 'Litol.', title: 'Litología y mineralogía', kind: 'modules', categories: ['lithology'], hint: 'Identificá litologías y minerales con los crossplots.' },
  { id: 'geology', label: 'Geología', title: 'Lectura geológica', kind: 'modules', categories: ['geology'], hint: 'Electrosecuencias, tipo de arcilla y columna sedimentológica.' },
];

export const FLOWS: Readonly<Record<WorkspaceId, readonly FlowStepDef[]>> = {
  petrophysics: PETROPHYSICS_FLOW,
  geology: GEOLOGY_FLOW,
};

export type StepStatus = 'done' | 'partial' | 'todo' | 'skipped' | 'empty' | 'locked';

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  done: 'Completo',
  partial: 'En curso',
  todo: 'Pendiente',
  skipped: 'Saltado',
  empty: 'Sin módulos todavía',
  locked: 'Necesita un pozo',
};

/** Lo mínimo de un módulo que necesita el flujo. */
export interface FlowModule {
  id: string;
  category: string;
  /** Puertos que produce (roles de curva, ids de escalares y tablas). */
  outputPorts: readonly string[];
  /** Nombre en español (para las razones de «revisado»). */
  name?: string;
  /** Esquema de parámetros: un valor guardado distinto del de fábrica marca el paso como revisado. */
  params?: ParamsSpec;
}

export interface FlowContext {
  hasWell: boolean;
  zoneCount: number;
  /** Módulos del espacio de trabajo, en orden de registro. */
  modules: readonly FlowModule[];
  /** Puertos producidos por su fuente activa sin error (o medidos, si el motor los eligió como fuente). */
  producedPorts: ReadonlySet<string>;
  /** Módulos que corrieron sin error en el último cálculo. */
  okModules: ReadonlySet<string>;
  marks: Readonly<Record<string, StepMark>>;
  /** Valores de parámetros guardados en el pozo (lo ausente es de fábrica). Sin esto, ningún parámetro cuenta. */
  params?: ParamState;
  /** Fuentes elegidas por la usuaria (puerto → fuente). Sin esto, ninguna fuente cuenta. */
  sources?: Readonly<Record<string, unknown>>;
  /** Ids de las zonas actuales: un override de una zona borrada no cuenta. Sin esto, cuentan todas. */
  zoneIds?: readonly string[];
}

export interface StepState {
  def: FlowStepDef;
  index: number;
  status: StepStatus;
  /** true si el estado sale de los datos (no de una marca del usuario). */
  derived: boolean;
  mark: StepMark | null;
  /** Ids de los módulos del paso. */
  modules: string[];
  /** Explicación corta en español del estado. */
  reason: string;
  /**
   * true si hubo una decisión de la usuaria en el paso (marca, parámetro distinto del de fábrica, fuente elegida o,
   * en Cargar, el pozo). Es un eje independiente de `status`: ver docs/decisiones/0073-estado-revisado.md.
   */
  reviewed: boolean;
  /** Por qué cuenta como revisado (null si no lo está). */
  reviewReason: string | null;
}

export function stepModules(def: FlowStepDef, modules: readonly FlowModule[]): FlowModule[] {
  if (def.kind !== 'modules') return [];
  return modules.filter((m) => def.categories?.includes(m.category) || m.outputPorts.some((p) => def.ports?.includes(p)));
}

/** Pasos de un flujo en los que aparece un módulo (puede ser más de uno). */
export function stepsOfModule(steps: readonly FlowStepDef[], module: FlowModule): FlowStepDef[] {
  return steps.filter((s) => stepModules(s, [module]).length > 0);
}

const list = (ports: readonly string[]) => ports.join(', ');

type StatusState = Omit<StepState, 'reviewed' | 'reviewReason'>;

function evaluateStatus(def: FlowStepDef, index: number, ctx: FlowContext): StatusState {
  const mods = stepModules(def, ctx.modules);
  const mark = ctx.marks[def.id] ?? null;
  const base = { def, index, mark, modules: mods.map((m) => m.id) };
  const done = (reason: string, derived = true): StatusState => ({ ...base, status: 'done', derived, reason });

  if (def.kind !== 'load' && !ctx.hasWell) return { ...base, status: 'locked', derived: true, reason: 'Cargá un pozo para empezar.' };

  switch (def.kind) {
    case 'load':
      if (ctx.hasWell) return done('Pozo cargado.');
      break;
    case 'zones':
      if (ctx.zoneCount > 0) return done(ctx.zoneCount === 1 ? '1 zona definida.' : `${ctx.zoneCount} zonas definidas.`);
      break;
    case 'qc':
      break; // revisar la calidad es un acto del usuario: solo se completa con la marca
    case 'modules': {
      const targets = def.targets ?? [];
      const reached = targets.filter((p) => ctx.producedPorts.has(p));
      if (targets.length > 0 ? reached.length > 0 : mods.some((m) => ctx.okModules.has(m.id))) {
        return done(targets.length > 0 ? `Disponible: ${list(reached)}.` : 'Hay resultados.');
      }
      break;
    }
  }

  if (mark === 'done') return done(def.kind === 'qc' ? 'Calidad revisada.' : 'Marcado como completo.', false);
  if (mark === 'skipped') return { ...base, status: 'skipped', derived: false, reason: 'Saltado. Podés volver cuando quieras.' };
  if (def.kind === 'modules' && mods.length === 0) {
    return { ...base, status: 'empty', derived: true, reason: 'Todavía no hay módulos para este paso. Podés saltarlo.' };
  }
  if (def.kind === 'modules' && mods.some((m) => ctx.okModules.has(m.id))) {
    return { ...base, status: 'partial', derived: true, reason: `En curso: falta ${list(def.targets ?? [])}.` };
  }
  return { ...base, status: 'todo', derived: true, reason: def.hint };
}

/** Tolerancia relativa para comparar números con el valor de fábrica (volver un slider a su lugar lo «desrevisa»). */
const REL_TOL = 1e-9;

function sameValue(a: ParamValue, b: ParamValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= REL_TOL * Math.max(Math.abs(a), Math.abs(b));
  return a === b;
}

/** Parámetros de los módulos que difieren del valor de fábrica (global u override de alguna zona), sin repetir claves compartidas. */
export function changedParams(mods: readonly FlowModule[], state: ParamState | undefined, zoneIds?: readonly string[]): ParamSpec[] {
  if (!state) return [];
  const seen = new Set<string>();
  const changed: ParamSpec[] = [];
  for (const m of mods) {
    for (const [key, spec] of Object.entries(m.params ?? {})) {
      const storage = paramStorageKey(m.id, key, spec);
      if (seen.has(storage)) continue;
      seen.add(storage);
      const differs = (raw: unknown) => raw !== undefined && isValidParamValue(spec, raw) && !sameValue(raw, spec.default);
      // Los overrides por zona solo se aplican a parámetros con alcance de zona (igual que resolveModuleParams).
      const zoned = paramScope(spec) === 'zone' && Object.entries(state.zones).some(([id, z]) => (!zoneIds || zoneIds.includes(id)) && differs(z[storage]));
      if (differs(state.global[storage]) || zoned) changed.push(spec);
    }
  }
  return changed;
}

const MAX_LISTED = 3;
const listLabels = (labels: readonly string[]) =>
  labels.length <= MAX_LISTED ? labels.join(', ') : `${labels.slice(0, MAX_LISTED).join(', ')} y ${labels.length - MAX_LISTED} más`;

/** Nombre legible de una fuente elegida: el módulo o «curva medida» (null si no se reconoce). */
function sourceName(ref: unknown, modules: readonly FlowModule[]): string | null {
  if (typeof ref !== 'object' || ref === null) return null;
  const r = ref as { kind?: unknown; moduleId?: unknown };
  if (r.kind === 'curve') return 'curva medida';
  if (r.kind === 'module') return modules.find((m) => m.id === r.moduleId)?.name ?? null;
  return null;
}

function reviewOf(def: FlowStepDef, status: StepStatus, mark: StepMark | null, mods: readonly FlowModule[], ctx: FlowContext): string | null {
  if (status === 'locked') return null;
  if (def.kind === 'load') return ctx.hasWell ? 'Revisado: elegiste el pozo.' : null;
  if (def.kind === 'modules') {
    const changed = changedParams(mods, ctx.params, ctx.zoneIds);
    if (changed.length > 0) {
      const labels = changed.map((p) => p.label);
      return changed.length === 1 ? `Revisado: cambiaste ${labels[0]}.` : `Revisado: cambiaste ${changed.length} parámetros (${listLabels(labels)}).`;
    }
    const sources = ctx.sources ?? {};
    const ports = new Set([...mods.flatMap((m) => m.outputPorts), ...(def.targets ?? [])]);
    const chosen = [...ports].filter((p) => sources[p] !== undefined && sources[p] !== null);
    if (chosen.length === 1) {
      const port = chosen[0]!;
      const what = sourceName(sources[port], ctx.modules);
      return `Revisado: elegiste la fuente de ${port}${what ? ` (${what})` : ''}.`;
    }
    if (chosen.length > 1) return `Revisado: elegiste las fuentes de ${listLabels(chosen)}.`;
  }
  if (mark === 'done') return def.kind === 'qc' ? 'Revisado: revisaste la calidad.' : 'Revisado: marcado a mano.';
  if (mark === 'skipped') return 'Revisado: lo saltaste a mano.';
  return null;
}

export function evaluateStep(def: FlowStepDef, index: number, ctx: FlowContext): StepState {
  const state = evaluateStatus(def, index, ctx);
  const reviewReason = reviewOf(def, state.status, state.mark, stepModules(def, ctx.modules), ctx);
  return { ...state, reviewed: reviewReason !== null, reviewReason };
}

export function evaluateFlow(steps: readonly FlowStepDef[], ctx: FlowContext): StepState[] {
  return steps.map((def, i) => evaluateStep(def, i, ctx));
}

/** Paso sugerido: el primero pendiente o en curso (null si no queda ninguno). */
export function suggestedStep(states: readonly StepState[]): StepState | null {
  return states.find((s) => s.status === 'todo' || s.status === 'partial') ?? null;
}

export interface FlowProgressCount {
  /** Pasos completos o saltados. */
  resolved: number;
  total: number;
  /** Pasos con resultado (completos). */
  computed: number;
  /** Pasos con una decisión de la usuaria. */
  reviewed: number;
}

/** Conteos para el indicador de progreso: resueltos, calculados y revisados sobre el total. */
export function flowProgress(states: readonly StepState[]): FlowProgressCount {
  return {
    resolved: states.filter((s) => s.status === 'done' || s.status === 'skipped').length,
    total: states.length,
    computed: states.filter((s) => s.status === 'done').length,
    reviewed: states.filter((s) => s.reviewed).length,
  };
}
