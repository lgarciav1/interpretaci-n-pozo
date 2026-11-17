/**
 * Contrato de módulo.
 *
 * Un módulo es una carpeta `src/modules/<id>/` cuyo `index.ts` exporta (default) el resultado de `defineModule`.
 * Esa definición es PURA: no importa React ni toca el DOM, porque la ejecuta el Web Worker.
 * El panel a medida (opcional) va en `src/modules/<id>/panel.tsx`; si no existe, la interfaz se genera a partir
 * del esquema de parámetros.
 *
 * Puertos: los módulos se conectan por puertos, no por nombre de módulo.
 * - Curvas: el puerto es un rol de curva (catálogo en roles.ts o `roles` del propio módulo).
 * - Escalares, escalares por zona y tablas: el puerto es un id en MAYÚSCULAS declarado en `outputs` (no puede
 *   coincidir con un rol). Los cuatro tipos pueden ser entrada de otro módulo.
 */
import type { ParamsSpec, ParamValues } from './params';
import type { RoleDef, RoleId } from './roles';
import type { ToolDef } from './tools';
import type { UnitId } from './units';
import type { CategoryId, WorkspaceId } from './workspaces';
import type { ZoneSpan } from './well';

// ---------------------------------------------------------------------------------------------------------------
// Entradas

export interface CurveInputSpec {
  kind: 'curve';
  role: RoleId;
  optional?: boolean;
  /** Para mensajes y documentación; si falta se usa la etiqueta del rol. */
  label?: string;
}

export interface ScalarInputSpec {
  kind: 'scalar';
  port: string;
  optional?: boolean;
  label?: string;
}

export interface TableInputSpec {
  kind: 'table';
  port: string;
  optional?: boolean;
  label?: string;
}

/** Escalar por zona (`Record<zoneId, number>`, una entrada por cada zona de `ctx.zones`). */
export interface ZoneScalarInputSpec {
  kind: 'zoneScalar';
  port: string;
  optional?: boolean;
  label?: string;
}

export type InputSpec = CurveInputSpec | ScalarInputSpec | TableInputSpec | ZoneScalarInputSpec;
export type InputsSpec = Record<string, InputSpec>;

export const input = {
  curve(role: RoleId, opts: { label?: string } = {}): CurveInputSpec {
    return { kind: 'curve', role, ...opts };
  },
  optionalCurve(role: RoleId, opts: { label?: string } = {}): CurveInputSpec & { optional: true } {
    return { kind: 'curve', role, ...opts, optional: true };
  },
  scalar(port: string, opts: { label?: string } = {}): ScalarInputSpec {
    return { kind: 'scalar', port, ...opts };
  },
  optionalScalar(port: string, opts: { label?: string } = {}): ScalarInputSpec & { optional: true } {
    return { kind: 'scalar', port, ...opts, optional: true };
  },
  table(port: string, opts: { label?: string } = {}): TableInputSpec {
    return { kind: 'table', port, ...opts };
  },
  optionalTable(port: string, opts: { label?: string } = {}): TableInputSpec & { optional: true } {
    return { kind: 'table', port, ...opts, optional: true };
  },
  zoneScalar(port: string, opts: { label?: string } = {}): ZoneScalarInputSpec {
    return { kind: 'zoneScalar', port, ...opts };
  },
  optionalZoneScalar(port: string, opts: { label?: string } = {}): ZoneScalarInputSpec & { optional: true } {
    return { kind: 'zoneScalar', port, ...opts, optional: true };
  },
};

/**
 * Grupo de entradas opcionales de las que hacen falta al menos `min` (por defecto una): «al menos una de PHID, PHIN o
 * PHIS». El motor no corre el módulo si el grupo no se cumple (queda `missing-input`, o `blocked` si las fuentes que
 * lo cumplían fallaron) y la disponibilidad de la sarta lo trata igual, con un motivo propio.
 */
export interface InputGroupSpec<K extends string = string> {
  /** Claves de `inputs` del módulo; todas tienen que ser opcionales. */
  inputs: readonly K[];
  /** Cuántas tienen que estar como mínimo (entero entre 1 y la cantidad de entradas del grupo). Por defecto 1. */
  min?: number;
  /**
   * Qué falta, en español y en minúscula, para completar «Falta …» («una porosidad de densidad, neutrón o sónico»).
   * Si no se da, el motivo enumera los puertos del grupo.
   */
  label?: string;
}

/** Mínimo efectivo de un grupo. */
export function groupMin(g: InputGroupSpec): number {
  return g.min ?? 1;
}

/** Primer grupo de entradas que no se cumple con las entradas presentes (`has(clave)`), o undefined. */
export function unmetInputGroup(m: Pick<AnyModule, 'inputGroups'>, has: (key: string) => boolean): InputGroupSpec | undefined {
  return m.inputGroups?.find((g) => g.inputs.filter(has).length < groupMin(g));
}

/** Descripción de un grupo para mensajes del motor («al menos una de estas entradas: PHID, PHIN o PHIS»). */
export function describeInputGroup(m: Pick<AnyModule, 'inputs'>, g: InputGroupSpec): string {
  const ports = g.inputs.map((k) => (m.inputs[k] ? portOf(m.inputs[k]!) : k));
  const list = ports.length <= 1 ? ports.join('') : `${ports.slice(0, -1).join(', ')} o ${ports[ports.length - 1]}`;
  const min = groupMin(g);
  return `${min === 1 ? 'al menos una de estas entradas' : `al menos ${min} de estas entradas`}: ${list}${g.label ? ` (${g.label})` : ''}`;
}

/**
 * Curva de solo lectura. Es la vista que reciben los módulos de sus entradas, de la profundidad y del espesor:
 * esos arrays están en caché y los comparten otros módulos (y, para curvas medidas, el proyecto).
 *
 * Expone solo operaciones que no mutan. `subarray` devuelve otra vista de solo lectura; `slice`, `map` y `filter`
 * devuelven copias nuevas (mutables, son del módulo). Los callbacks reciben el array como `ReadonlyCurve`.
 * Un `Float64Array` se puede pasar donde se pide un `ReadonlyCurve`; al revés hace falta un cast explícito, que
 * es exactamente lo que el modo `checkInputs` del motor detecta en tiempo de ejecución si se usa para escribir.
 */
export interface ReadonlyCurve extends Iterable<number> {
  readonly length: number;
  readonly [index: number]: number;
  at(index: number): number | undefined;
  subarray(begin?: number, end?: number): ReadonlyCurve;
  slice(start?: number, end?: number): Float64Array;
  indexOf(value: number, fromIndex?: number): number;
  lastIndexOf(value: number, fromIndex?: number): number;
  includes(value: number, fromIndex?: number): boolean;
  every(predicate: (value: number, index: number, array: ReadonlyCurve) => unknown): boolean;
  some(predicate: (value: number, index: number, array: ReadonlyCurve) => unknown): boolean;
  find(predicate: (value: number, index: number, array: ReadonlyCurve) => unknown): number | undefined;
  findIndex(predicate: (value: number, index: number, array: ReadonlyCurve) => unknown): number;
  forEach(callback: (value: number, index: number, array: ReadonlyCurve) => void): void;
  map(callback: (value: number, index: number, array: ReadonlyCurve) => number): Float64Array;
  filter(predicate: (value: number, index: number, array: ReadonlyCurve) => unknown): Float64Array;
  reduce<U>(callback: (acc: U, value: number, index: number, array: ReadonlyCurve) => U, initial: U): U;
  entries(): IterableIterator<[number, number]>;
  keys(): IterableIterator<number>;
  values(): IterableIterator<number>;
}

/** Curva de entrada de un módulo (alias de `ReadonlyCurve`). */
export type InputCurve = ReadonlyCurve;

/** Tabla de entrada: de solo lectura (está en caché y la comparten otros módulos; el motor la congela). */
export interface ReadonlyTableValue {
  readonly rows: readonly Readonly<Record<string, TableCell>>[];
}

/** Escalar por zona de entrada: de solo lectura (el motor lo congela). */
export type ReadonlyZoneScalarValue = Readonly<Record<string, number>>;

type InputValue<S extends InputSpec> = S extends CurveInputSpec
  ? InputCurve
  : S extends ScalarInputSpec
    ? number
    : S extends TableInputSpec
      ? ReadonlyTableValue
      : ReadonlyZoneScalarValue;

export type InputValues<I extends InputsSpec> = {
  readonly [K in keyof I]: I[K] extends { optional: true } ? InputValue<I[K]> | undefined : InputValue<I[K]>;
};

// ---------------------------------------------------------------------------------------------------------------
// Salidas

export interface CurveOutputSpec {
  kind: 'curve';
  role: RoleId;
  label?: string;
}

export interface ScalarOutputSpec {
  kind: 'scalar';
  port: string;
  label: string;
  unit?: UnitId;
}

export interface TableColumn {
  key: string;
  label: string;
  unit?: UnitId;
  kind?: 'number' | 'text';
}

export interface TableOutputSpec {
  kind: 'table';
  port: string;
  label: string;
  columns: readonly TableColumn[];
  /**
   * Tabla de datos para un panel a medida o un gráfico (p. ej. el barrido de sensibilidad de cutoffs): no se lista
   * en el panel genérico de Resultados. Sigue siendo un puerto normal (otro módulo la puede consumir).
   */
  hidden?: boolean;
}

/**
 * Escalar por zona: un número por zona (p. ej. espesor neto pay, OOIP). El valor es `Record<zoneId, number>` con
 * EXACTAMENTE una clave por cada zona de `ctx.zones` (incluidas las zonas sin muestras); `NaN` = sin dato. El
 * motor lo valida y rechaza claves de más o de menos.
 */
export interface ZoneScalarOutputSpec {
  kind: 'zoneScalar';
  port: string;
  label: string;
  unit?: UnitId;
}

export type OutputSpec = CurveOutputSpec | ScalarOutputSpec | TableOutputSpec | ZoneScalarOutputSpec;
export type OutputsSpec = Record<string, OutputSpec>;

export const output = {
  curve(role: RoleId, opts: { label?: string } = {}): CurveOutputSpec {
    return { kind: 'curve', role, ...opts };
  },
  scalar(port: string, opts: { label: string; unit?: UnitId }): ScalarOutputSpec {
    return { kind: 'scalar', port, ...opts };
  },
  table(port: string, opts: { label: string; columns: readonly TableColumn[]; hidden?: boolean }): TableOutputSpec {
    return { kind: 'table', port, ...opts };
  },
  zoneScalar(port: string, opts: { label: string; unit?: UnitId }): ZoneScalarOutputSpec {
    return { kind: 'zoneScalar', port, ...opts };
  },
};

export type TableCell = number | string | null;
export interface TableValue {
  rows: Record<string, TableCell>[];
}

/** Valor por zona: zoneId → número (NaN = sin dato). */
export type ZoneScalarValue = Record<string, number>;

export type OutputValue = Float64Array | number | TableValue | ZoneScalarValue;

export type ComputeResult<O extends OutputsSpec> = {
  [K in keyof O]: O[K] extends CurveOutputSpec
    ? Float64Array
    : O[K] extends ScalarOutputSpec
      ? number
      : O[K] extends TableOutputSpec
        ? TableValue
        : ZoneScalarValue;
};

/** Tipo de puerto (igual para entradas y salidas). */
export type PortKind = OutputSpec['kind'];

/** Nombre en español de un tipo de puerto, para mensajes. */
export const PORT_KIND_LABEL: Readonly<Record<PortKind, string>> = {
  curve: 'curva',
  scalar: 'escalar',
  table: 'tabla',
  zoneScalar: 'valor por zona',
};

/** Puerto (id) de una entrada o salida. */
export function portOf(spec: InputSpec | OutputSpec): string {
  return spec.kind === 'curve' ? spec.role : spec.port;
}

// ---------------------------------------------------------------------------------------------------------------
// Contexto de cálculo

/** Tramo de muestras [start, end) con los parámetros ya resueltos para su zona. */
export interface ParamSegment<P extends ParamsSpec> {
  start: number;
  end: number;
  zoneId: string | null;
  params: ParamValues<P>;
}

/** A qué se refiere un aviso de módulo (0072). */
export interface WarningWhere {
  zoneId?: string;
  depth?: number;
}

export interface ComputeContext<I extends InputsSpec, P extends ParamsSpec> {
  /** Cantidad de muestras. */
  n: number;
  /** Profundidad (m). */
  depth: InputCurve;
  /** Espesor que representa cada muestra (m). */
  thickness: InputCurve;
  /** Entradas en la unidad canónica de su rol. Las opcionales ausentes son undefined. */
  inputs: InputValues<I>;
  /** Parámetros globales (sin overrides de zona). */
  params: ParamValues<P>;
  /** Tramos contiguos que cubren [0, n) con los parámetros efectivos de cada zona. */
  segments: readonly ParamSegment<P>[];
  /**
   * Zonas ubicadas sobre el índice de muestras (orden por tope), con su tipo (`kind`: reservorio, sello…).
   * Incluye zonas sin muestras (start = end). Las salidas `zoneScalar` llevan una clave por cada una.
   */
  zones: readonly ZoneSpan[];
  /**
   * Parámetros efectivos de una zona (globales + overrides), para cálculos por zona (tablas, sumario) sin
   * buscar en `segments`. Funciona también para zonas sin muestras. `null` = parámetros globales.
   * Lanza un error si la zona no está en `zones`.
   */
  paramsFor(zoneId: string | null): ParamValues<P>;
  /**
   * Informa una advertencia para el usuario (en español, sin ecuaciones), p. ej. parámetros incoherentes en una
   * zona. Queda asociada al resultado: se vuelve a mostrar mientras el resultado siga en caché.
   * `where` (opcional, 0072) dice a qué se refiere: `zoneId` (id de una zona de `zones`) o `depth` (m, profundidad
   * medida de un aviso puntual). El panel Avisos lo usa para navegar; el texto no cambia. Dos avisos con el mismo
   * texto y distinta zona son distintos.
   */
  warn(message: string, where?: WarningWhere): void;
}

// ---------------------------------------------------------------------------------------------------------------
// Documentación (alimenta el futuro módulo Ecuaciones; no se muestra en el resto de la interfaz)

export interface ModuleDocs {
  /** Descripción breve en español. */
  summary: string;
  equations: readonly { latex: string; description?: string }[];
  references: readonly string[];
  notes?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Definición

export interface ModuleDefinition<
  I extends InputsSpec = InputsSpec,
  P extends ParamsSpec = ParamsSpec,
  O extends OutputsSpec = OutputsSpec,
> {
  /** kebab-case, único. Es también el nombre de la carpeta. */
  id: string;
  /** Nombre en español para la interfaz. */
  name: string;
  description?: string;
  /** Categoría: una conocida (src/core/workspaces.ts) o una nueva, en cuyo caso hay que dar `categoryLabel`. */
  category: CategoryId;
  /** Etiqueta en español de una categoría nueva (no hace falta para las conocidas). */
  categoryLabel?: string;
  /** Espacio(s) de trabajo donde aparece. */
  workspace: WorkspaceId | readonly WorkspaceId[];
  /** Roles de curva nuevos que introduce este módulo. */
  roles?: readonly RoleDef[];
  /**
   * Herramientas de perfilaje nuevas que registran roles medidos (los propios o los del núcleo): aparecen en la sarta
   * y en el catálogo de pistas sin tocar el núcleo (docs/decisiones/0032).
   */
  tools?: readonly ToolDef[];
  inputs: I;
  /**
   * Grupos «al menos N de» sobre entradas opcionales (p. ej. PHIT necesita alguna porosidad de densidad, neutrón o
   * sónico). Sin grupos, un módulo con todas sus entradas opcionales corre siempre.
   */
  inputGroups?: readonly InputGroupSpec<Extract<keyof I, string>>[];
  params: P;
  outputs: O;
  /**
   * Función PURA: no muta las entradas, no tiene efectos, mismo resultado para mismo contexto.
   * Devuelve una curva (Float64Array de largo n), un número o una tabla por cada salida declarada.
   * Declarada como método a propósito (bivarianza) para que el registro acepte módulos con tipos concretos.
   */
  compute(ctx: ComputeContext<I, P>): ComputeResult<O>;
  docs: ModuleDocs;
}

/** Módulo con tipos borrados, como lo maneja el registro y el motor. */
export type AnyModule = ModuleDefinition<InputsSpec, ParamsSpec, OutputsSpec>;

/** Declara un módulo con inferencia completa de tipos en `compute`. */
export function defineModule<const I extends InputsSpec, const P extends ParamsSpec, const O extends OutputsSpec>(
  def: ModuleDefinition<I, P, O>,
): ModuleDefinition<I, P, O> {
  return def;
}

/**
 * Módulo de panel (docs/decisiones/0058): una herramienta de la interfaz que NO es un nodo del motor —no tiene puertos
 * ni `compute`— pero sí identidad, categoría, espacio de trabajo y `docs` para el módulo Ecuaciones. Se registra en
 * `src/modules/index.ts` (`PANEL_MODULES`, una línea) y aporta su interfaz con los archivos descubiertos de su carpeta
 * (`dock.tsx`, `commands.ts`…). Ejemplo: «Preparar datos» (`src/modules/preparation/`), cuyos cálculos viven en
 * `src/core/preparation/` y corren en el plan de preparación del motor, no como módulo.
 */
export interface PanelModuleDefinition {
  /** kebab-case, único entre módulos y paneles. Es también el nombre de la carpeta. */
  id: string;
  name: string;
  description?: string;
  category: CategoryId;
  categoryLabel?: string;
  workspace: WorkspaceId | readonly WorkspaceId[];
  docs: ModuleDocs;
}

/** Declara un módulo de panel (sin puertos ni cálculo en el motor). */
export function definePanelModule(def: PanelModuleDefinition): PanelModuleDefinition {
  return def;
}

export function moduleWorkspaces(m: Pick<AnyModule, 'workspace'>): readonly WorkspaceId[] {
  return typeof m.workspace === 'string' ? [m.workspace] : m.workspace;
}
