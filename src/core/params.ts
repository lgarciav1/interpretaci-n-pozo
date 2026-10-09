/**
 * Esquema de parámetros de módulo y resolución de valores (global + override por zona).
 *
 * El esquema genera la interfaz (sliders, selectores, casillas) y define cómo se guardan los valores:
 * - `scope: 'global'`: un único valor para todo el pozo.
 * - `scope: 'zone'`: valor global por defecto + override opcional por zona.
 * - `shared: true`: la clave se comparte entre módulos (p. ej. m en Archie y Simandoux) y se guarda una sola vez.
 */
import { getUnit, type UnitId } from './units';

export type ParamValue = number | string | boolean;
export type ParamScope = 'global' | 'zone';

interface ParamBase {
  /** Etiqueta en español. */
  label: string;
  /** Ayuda corta en español (sin ecuaciones). */
  tooltip?: string;
  /** Por defecto 'global'. */
  scope?: ParamScope;
  /** Si es true, la clave se comparte con otros módulos que declaren el mismo parámetro. */
  shared?: boolean;
  /** Agrupa controles en el panel. */
  group?: string;
}

export interface NumberParamSpec extends ParamBase {
  type: 'number';
  default: number;
  /** Rango del slider (en `unit`). */
  min: number;
  max: number;
  step?: number;
  unit?: UnitId;
  /** Escala del slider. 'log' exige min > 0. */
  scale?: 'linear' | 'log';
}

export interface EnumOption<V extends string = string> {
  value: V;
  label: string;
}

export interface EnumParamSpec<V extends string = string> extends ParamBase {
  type: 'enum';
  options: readonly EnumOption<V>[];
  default: V;
}

export interface BooleanParamSpec extends ParamBase {
  type: 'boolean';
  default: boolean;
}

export type ParamSpec = NumberParamSpec | EnumParamSpec | BooleanParamSpec;
export type ParamsSpec = Record<string, ParamSpec>;

/** Tipo de los valores resueltos de un esquema. */
export type ParamValues<P extends ParamsSpec> = {
  readonly [K in keyof P]: P[K] extends NumberParamSpec
    ? number
    : P[K] extends BooleanParamSpec
      ? boolean
      : P[K] extends EnumParamSpec<infer V>
        ? V
        : never;
};

/** Constructores con inferencia de tipos para declarar parámetros. */
export const param = {
  number(spec: Omit<NumberParamSpec, 'type'>): NumberParamSpec {
    return { type: 'number', ...spec };
  },
  enum<const V extends string>(spec: Omit<EnumParamSpec<V>, 'type'>): EnumParamSpec<V> {
    return { type: 'enum', ...spec };
  },
  boolean(spec: Omit<BooleanParamSpec, 'type'>): BooleanParamSpec {
    return { type: 'boolean', ...spec };
  },
};

/** Valores guardados en el proyecto. Lo ausente toma el default del esquema. */
export interface ParamState {
  global: Record<string, ParamValue>;
  /** zoneId → clave → valor. Solo se aplica a parámetros con scope 'zone'. */
  zones: Record<string, Record<string, ParamValue>>;
}

export function emptyParamState(): ParamState {
  return { global: {}, zones: {} };
}

const PARAM_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Clave de almacenamiento: compartida = `clave`; propia del módulo = `moduloId.clave`. */
export function paramStorageKey(moduleId: string, key: string, spec: ParamSpec): string {
  return spec.shared ? key : `${moduleId}.${key}`;
}

export function paramScope(spec: ParamSpec): ParamScope {
  return spec.scope ?? 'global';
}

/** Verifica que un valor sea del tipo correcto para el esquema. */
export function isValidParamValue(spec: ParamSpec, value: unknown): value is ParamValue {
  switch (spec.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && spec.options.some((o) => o.value === value);
  }
}

/** Valida la declaración de un parámetro. Devuelve problemas en español. */
export function validateParamSpec(where: string, key: string, spec: ParamSpec): string[] {
  const p: string[] = [];
  const at = `${where}, parámetro '${key}'`;
  if (!PARAM_KEY_PATTERN.test(key)) p.push(`${at}: la clave debe ser un identificador (letras, números y _).`);
  if (!spec.label?.trim()) p.push(`${at}: falta la etiqueta.`);
  if (spec.scope !== undefined && spec.scope !== 'global' && spec.scope !== 'zone') {
    p.push(`${at}: scope debe ser 'global' o 'zone'.`);
  }
  switch (spec.type) {
    case 'number': {
      const { min, max, step, scale, unit } = spec;
      if (![min, max, spec.default].every(Number.isFinite)) p.push(`${at}: min, max y default deben ser números finitos.`);
      if (!(min < max)) p.push(`${at}: min (${min}) debe ser menor que max (${max}).`);
      if (spec.default < min || spec.default > max) p.push(`${at}: el default ${spec.default} está fuera de [${min}, ${max}].`);
      if (step !== undefined && !(step > 0)) p.push(`${at}: step debe ser positivo.`);
      if (scale === 'log' && !(min > 0)) p.push(`${at}: con escala logarítmica min debe ser > 0.`);
      if (unit !== undefined && !getUnit(unit)) p.push(`${at}: unidad desconocida '${unit}'.`);
      break;
    }
    case 'enum': {
      if (spec.options.length === 0) p.push(`${at}: el enum no tiene opciones.`);
      const values = spec.options.map((o) => o.value);
      if (new Set(values).size !== values.length) p.push(`${at}: hay opciones repetidas.`);
      if (!values.includes(spec.default)) p.push(`${at}: el default '${spec.default}' no está entre las opciones.`);
      break;
    }
    case 'boolean':
      if (typeof spec.default !== 'boolean') p.push(`${at}: el default debe ser booleano.`);
      break;
    default:
      p.push(`${at}: tipo de parámetro desconocido '${(spec as { type: string }).type}'.`);
  }
  return p;
}

/**
 * Dos declaraciones del mismo parámetro compartido tienen que ser idénticas en todo lo que afecta al valor o a
 * cómo se muestra (un único control y un único valor guardado para todos los módulos). Devuelve la lista de
 * diferencias (vacía si son compatibles). `tooltip` y `group` pueden variar entre módulos.
 */
export function sharedSpecDifferences(a: ParamSpec, b: ParamSpec): string[] {
  const diffs: string[] = [];
  const cmp = (field: string, x: unknown, y: unknown) => {
    if (x !== y) diffs.push(`${field} (${fmt(x)} / ${fmt(y)})`);
  };
  cmp('tipo', a.type, b.type);
  cmp('etiqueta', a.label, b.label);
  cmp('alcance', paramScope(a), paramScope(b));
  cmp('default', a.default, b.default);
  cmp('shared', !!a.shared, !!b.shared);
  if (a.type === 'number' && b.type === 'number') {
    cmp('min', a.min, b.min);
    cmp('max', a.max, b.max);
    cmp('step', a.step, b.step);
    cmp('escala', a.scale ?? 'linear', b.scale ?? 'linear');
    cmp('unidad', a.unit, b.unit);
  }
  if (a.type === 'enum' && b.type === 'enum') {
    const oa = a.options.map((o) => `${o.value}=${o.label}`).join(', ');
    const ob = b.options.map((o) => `${o.value}=${o.label}`).join(', ');
    cmp('opciones', oa, ob);
  }
  return diffs;
}

function fmt(v: unknown): string {
  return v === undefined ? '—' : String(v);
}

export interface ResolvedModuleParams {
  /** Valores globales (clave local del módulo → valor). */
  global: Record<string, ParamValue>;
  /** zoneId → valores efectivos en esa zona (globales + overrides). Solo zonas pedidas. */
  byZone: Map<string, Record<string, ParamValue>>;
  /** Firma estable de todo lo anterior: si no cambia, los parámetros del módulo no cambiaron. */
  key: string;
  /** Valores guardados con tipo inválido (se usó el default). */
  problems: string[];
}

/**
 * Resuelve los parámetros de un módulo para un conjunto de zonas.
 * Lo ausente o inválido toma el default; los overrides por zona solo valen para scope 'zone'.
 */
export function resolveModuleParams(
  moduleId: string,
  specs: ParamsSpec,
  state: ParamState,
  zoneIds: readonly string[],
): ResolvedModuleParams {
  const problems: string[] = [];
  const global: Record<string, ParamValue> = {};
  const zonedKeys: { key: string; storage: string; spec: ParamSpec }[] = [];
  for (const [key, spec] of Object.entries(specs)) {
    const storage = paramStorageKey(moduleId, key, spec);
    const raw = state.global[storage];
    if (raw !== undefined && !isValidParamValue(spec, raw)) {
      problems.push(`Valor inválido para '${spec.label}' (${String(raw)}): se usa el valor por defecto.`);
    }
    global[key] = raw !== undefined && isValidParamValue(spec, raw) ? raw : spec.default;
    if (paramScope(spec) === 'zone') zonedKeys.push({ key, storage, spec });
  }
  const byZone = new Map<string, Record<string, ParamValue>>();
  const keyParts: unknown[] = [Object.values(global)];
  for (const zoneId of zoneIds) {
    const overrides = state.zones[zoneId];
    const values: Record<string, ParamValue> = { ...global };
    const zoneParts: unknown[] = [];
    if (overrides) {
      for (const { key, storage, spec } of zonedKeys) {
        const raw = overrides[storage];
        if (raw === undefined) continue;
        if (!isValidParamValue(spec, raw)) {
          problems.push(`Valor inválido para '${spec.label}' en una zona (${String(raw)}): se ignora.`);
          continue;
        }
        values[key] = raw;
        zoneParts.push(key, raw);
      }
    }
    byZone.set(zoneId, values);
    if (zoneParts.length) keyParts.push(zoneId, zoneParts);
  }
  return { global, byZone, key: JSON.stringify(keyParts), problems };
}
