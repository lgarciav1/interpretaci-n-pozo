/**
 * Registro de módulos: valida el contrato de todos los módulos juntos y arma los índices que usa el motor.
 * Si algo está mal lanza un `RegistryError` con TODOS los problemas encontrados (no solo el primero).
 */
import { portOf, type AnyModule, type OutputSpec } from './module';
import { paramStorageKey, sharedSpecsCompatible, validateParamSpec, type ParamSpec } from './params';
import { BUILTIN_ROLES, RoleCatalog, validateRoleDef, type RoleDef } from './roles';
import { getUnit } from './units';
import { isCategoryId, isWorkspaceId } from './workspaces';

export type PortKind = OutputSpec['kind'];

export interface PortInfo {
  id: string;
  kind: PortKind;
  /** Ids de módulos que producen el puerto, en orden de registro. */
  producers: string[];
}

export interface Registry {
  readonly modules: readonly AnyModule[];
  readonly roles: RoleCatalog;
  /** Puertos producidos por algún módulo (curvas, escalares y tablas). */
  readonly ports: ReadonlyMap<string, PortInfo>;
  /** Clave de almacenamiento → declaración (para parámetros compartidos, la primera). */
  readonly paramSpecs: ReadonlyMap<string, { spec: ParamSpec; moduleIds: string[] }>;
  get(id: string): AnyModule | undefined;
  /** Posición en el registro (para ordenar de forma determinística). */
  indexOf(id: string): number;
}

export class RegistryError extends Error {
  constructor(public readonly problems: string[]) {
    super(`El registro de módulos tiene ${problems.length} problema(s):\n- ${problems.join('\n- ')}`);
    this.name = 'RegistryError';
  }
}

const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PORT_ID_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const LOCAL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface RegistryOptions {
  /** Roles base (por defecto, los incorporados). */
  baseRoles?: readonly RoleDef[];
}

export function createRegistry(modules: readonly AnyModule[], options: RegistryOptions = {}): Registry {
  const problems: string[] = [];
  const where = (m: AnyModule) => `Módulo '${m.id ?? '?'}'`;

  // 1. Identidad y metadatos
  const byId = new Map<string, AnyModule>();
  for (const m of modules) {
    if (!m || typeof m !== 'object') {
      problems.push('Hay una entrada vacía en la lista de módulos (¿falta el export default?).');
      continue;
    }
    if (typeof m.id !== 'string' || !MODULE_ID_PATTERN.test(m.id)) {
      problems.push(`${where(m)}: el id debe estar en kebab-case (p. ej. 'vsh-larionov').`);
    }
    if (byId.has(m.id)) problems.push(`Hay dos módulos con el id '${m.id}'.`);
    byId.set(m.id, m);
    if (!m.name?.trim()) problems.push(`${where(m)}: falta el nombre.`);
    if (!isCategoryId(m.category)) problems.push(`${where(m)}: categoría desconocida '${String(m.category)}'.`);
    const ws = typeof m.workspace === 'string' ? [m.workspace] : m.workspace;
    if (!Array.isArray(ws) || ws.length === 0) problems.push(`${where(m)}: falta el espacio de trabajo.`);
    else for (const w of ws) if (!isWorkspaceId(w)) problems.push(`${where(m)}: espacio de trabajo desconocido '${w}'.`);
    if (typeof m.compute !== 'function') problems.push(`${where(m)}: falta la función compute.`);
    if (!m.docs || typeof m.docs.summary !== 'string' || !Array.isArray(m.docs.equations) || !Array.isArray(m.docs.references)) {
      problems.push(`${where(m)}: docs debe tener summary, equations y references.`);
    }
  }

  // 2. Roles: base + declarados por módulos
  const roleDefs = new Map<string, { def: RoleDef; owner: string }>();
  for (const r of options.baseRoles ?? BUILTIN_ROLES) roleDefs.set(r.id, { def: r, owner: 'núcleo' });
  for (const m of modules) {
    for (const r of m.roles ?? []) {
      for (const p of validateRoleDef(r)) problems.push(`${where(m)}: ${p}`);
      const prev = roleDefs.get(r.id);
      if (prev) problems.push(`${where(m)}: el rol '${r.id}' ya lo define ${prev.owner === 'núcleo' ? 'el núcleo' : `el módulo '${prev.owner}'`}.`);
      else roleDefs.set(r.id, { def: r, owner: m.id });
    }
  }
  const roles = new RoleCatalog([...roleDefs.values()].map((x) => x.def));

  // 3. Salidas → puertos
  const ports = new Map<string, PortInfo>();
  for (const m of modules) {
    const outs = Object.entries(m.outputs ?? {});
    if (outs.length === 0) problems.push(`${where(m)}: no declara ninguna salida.`);
    const seen = new Set<string>();
    for (const [key, spec] of outs) {
      if (!LOCAL_KEY_PATTERN.test(key)) problems.push(`${where(m)}: la salida '${key}' debe ser un identificador.`);
      const port = portOf(spec);
      if (spec.kind === 'curve') {
        if (!roles.has(spec.role)) problems.push(`${where(m)}: la salida '${key}' usa el rol desconocido '${spec.role}'.`);
      } else {
        if (!PORT_ID_PATTERN.test(spec.port)) problems.push(`${where(m)}: el puerto '${spec.port}' debe estar en MAYÚSCULAS.`);
        if (roles.has(spec.port)) problems.push(`${where(m)}: el puerto ${spec.kind === 'scalar' ? 'escalar' : 'de tabla'} '${spec.port}' coincide con un rol de curva.`);
        if (spec.kind === 'scalar' && spec.unit !== undefined && !getUnit(spec.unit)) {
          problems.push(`${where(m)}: la salida '${key}' usa la unidad desconocida '${spec.unit}'.`);
        }
      }
      if (seen.has(port)) problems.push(`${where(m)}: produce dos veces el puerto '${port}'.`);
      seen.add(port);
      const info = ports.get(port);
      if (info) {
        if (info.kind !== spec.kind) problems.push(`${where(m)}: el puerto '${port}' es '${info.kind}' en otro módulo y '${spec.kind}' acá.`);
        info.producers.push(m.id);
      } else {
        ports.set(port, { id: port, kind: spec.kind, producers: [m.id] });
      }
    }
  }

  // 4. Entradas
  for (const m of modules) {
    for (const [key, spec] of Object.entries(m.inputs ?? {})) {
      if (!LOCAL_KEY_PATTERN.test(key)) problems.push(`${where(m)}: la entrada '${key}' debe ser un identificador.`);
      if (spec.kind === 'curve') {
        if (!roles.has(spec.role)) problems.push(`${where(m)}: la entrada '${key}' pide el rol desconocido '${spec.role}'.`);
      } else if (spec.kind === 'scalar') {
        const info = ports.get(spec.port);
        if (info && info.kind !== 'scalar') problems.push(`${where(m)}: la entrada '${key}' pide '${spec.port}' como escalar pero es '${info.kind}'.`);
        if (!info && !spec.optional) problems.push(`${where(m)}: ningún módulo produce el escalar requerido '${spec.port}'.`);
      } else {
        problems.push(`${where(m)}: la entrada '${key}' tiene un tipo desconocido.`);
      }
    }
  }

  // 5. Parámetros (incluye compatibilidad de compartidos)
  const paramSpecs = new Map<string, { spec: ParamSpec; moduleIds: string[] }>();
  for (const m of modules) {
    for (const [key, spec] of Object.entries(m.params ?? {})) {
      problems.push(...validateParamSpec(where(m), key, spec));
      const storage = paramStorageKey(m.id, key, spec);
      const prev = paramSpecs.get(storage);
      if (prev) {
        // Una clave propia repetida solo ocurre con ids de módulo repetidos (ya informado arriba).
        const why = spec.shared ? sharedSpecsCompatible(prev.spec, spec) : null;
        if (why) problems.push(`${where(m)}: el parámetro compartido '${key}' no coincide con el de '${prev.moduleIds[0]}': ${why}.`);
        prev.moduleIds.push(m.id);
      } else {
        paramSpecs.set(storage, { spec, moduleIds: [m.id] });
      }
    }
  }

  if (problems.length) throw new RegistryError(problems);

  const order = new Map(modules.map((m, i) => [m.id, i]));
  return {
    modules,
    roles,
    ports,
    paramSpecs,
    get: (id) => byId.get(id),
    indexOf: (id) => order.get(id) ?? -1,
  };
}
