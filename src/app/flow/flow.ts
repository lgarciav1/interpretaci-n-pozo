/**
 * FLUJO GUIADO — definición de pasos y evaluación de su estado. Puro (sin React), testeado en tests/flow.test.ts.
 * Ver docs/decisiones/0004-sistema-de-diseno.md, D7.
 *
 * Un paso de módulos agrupa los módulos de sus `categories` y los que producen alguno de sus `ports`: agregar un
 * módulo nuevo lo suma al paso correcto sin tocar este archivo.
 */
import type { StepMark } from '../../core/state/project';
import type { WorkspaceId } from '../../core/workspaces';

export type FlowStepKind = 'load' | 'qc' | 'zones' | 'modules';

export interface FlowStepDef {
  id: string;
  /** Etiqueta corta (barra de pasos). */
  label: string;
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
  { id: 'porosity', label: 'Porosidad', title: 'Porosidad', kind: 'modules', categories: ['porosity'], targets: ['PHIE'], hint: 'Calculá la porosidad efectiva a partir de densidad, neutrón o sónico.' },
  { id: 'rw', label: 'Rw', title: 'Resistividad del agua (Rw)', kind: 'modules', categories: ['water'], ports: ['RW', 'RWA', 'RMF'], targets: ['RW'], hint: 'Obtené Rw desde el SP, Rwa o el gráfico de Pickett.' },
  { id: 'saturation', label: 'Saturación', title: 'Saturación de agua', kind: 'modules', categories: ['saturation'], targets: ['SW'], hint: 'Elegí el modelo de saturación y sus exponentes.' },
  { id: 'cutoffs', label: 'Cutoffs', title: 'Cutoffs', kind: 'modules', categories: ['cutoffs'], targets: ['NET_PAY'], hint: 'Fijá los cortes de Vsh, φ y Sw para reservorio y pay netos.' },
  { id: 'summary', label: 'Sumario', title: 'Sumario', kind: 'modules', categories: ['summary'], hint: 'Revisá el sumario por zona y exportalo.' },
];

export const GEOLOGY_FLOW: readonly FlowStepDef[] = [
  LOAD,
  QC,
  ZONES,
  { id: 'lithology', label: 'Litología', title: 'Litología y mineralogía', kind: 'modules', categories: ['lithology'], hint: 'Identificá litologías y minerales con los crossplots.' },
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

export function evaluateStep(def: FlowStepDef, index: number, ctx: FlowContext): StepState {
  const mods = stepModules(def, ctx.modules);
  const mark = ctx.marks[def.id] ?? null;
  const base = { def, index, mark, modules: mods.map((m) => m.id) };
  const done = (reason: string, derived = true): StepState => ({ ...base, status: 'done', derived, reason });

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

export function evaluateFlow(steps: readonly FlowStepDef[], ctx: FlowContext): StepState[] {
  return steps.map((def, i) => evaluateStep(def, i, ctx));
}

/** Paso sugerido: el primero pendiente o en curso (null si no queda ninguno). */
export function suggestedStep(states: readonly StepState[]): StepState | null {
  return states.find((s) => s.status === 'todo' || s.status === 'partial') ?? null;
}

/** Pasos resueltos (completos o saltados) sobre el total, para el indicador de progreso. */
export function flowProgress(states: readonly StepState[]): { resolved: number; total: number } {
  return { resolved: states.filter((s) => s.status === 'done' || s.status === 'skipped').length, total: states.length };
}
