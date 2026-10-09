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
 * - Escalares y tablas: el puerto es un id en MAYÚSCULAS declarado en `outputs` (no puede coincidir con un rol).
 */
import type { ParamsSpec, ParamValues } from './params';
import type { RoleDef, RoleId } from './roles';
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

export type InputSpec = CurveInputSpec | ScalarInputSpec;
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
};

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

type InputValue<S extends InputSpec> = S extends CurveInputSpec ? InputCurve : number;

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
}

export type OutputSpec = CurveOutputSpec | ScalarOutputSpec | TableOutputSpec;
export type OutputsSpec = Record<string, OutputSpec>;

export const output = {
  curve(role: RoleId, opts: { label?: string } = {}): CurveOutputSpec {
    return { kind: 'curve', role, ...opts };
  },
  scalar(port: string, opts: { label: string; unit?: UnitId }): ScalarOutputSpec {
    return { kind: 'scalar', port, ...opts };
  },
  table(port: string, opts: { label: string; columns: readonly TableColumn[] }): TableOutputSpec {
    return { kind: 'table', port, ...opts };
  },
};

export type TableCell = number | string | null;
export interface TableValue {
  rows: Record<string, TableCell>[];
}

export type OutputValue = Float64Array | number | TableValue;

export type ComputeResult<O extends OutputsSpec> = {
  [K in keyof O]: O[K] extends CurveOutputSpec ? Float64Array : O[K] extends ScalarOutputSpec ? number : TableValue;
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
  /** Zonas ubicadas sobre el índice de muestras (orden por tope). Incluye zonas sin muestras (start = end). */
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
   */
  warn(message: string): void;
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
  inputs: I;
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

export function moduleWorkspaces(m: AnyModule): readonly WorkspaceId[] {
  return typeof m.workspace === 'string' ? [m.workspace] : m.workspace;
}
