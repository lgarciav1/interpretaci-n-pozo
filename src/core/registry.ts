/**
 * Registro de módulos: valida el contrato de todos los módulos juntos y arma los índices que usa el motor.
 * Si algo está mal lanza un `RegistryError` con TODOS los problemas encontrados (no solo el primero).
 */
import { PORT_KIND_LABEL, portOf, type AnyModule, type PortKind } from './module';
import { paramStorageKey, sharedSpecDifferences, validateParamSpec, type ParamSpec, type ParamsSpec } from './params';
import { BUILTIN_ROLES, RoleCatalog, validateRoleDef, type RoleDef } from './roles';
import { getUnit } from './units';
import { CATEGORIES, isWorkspaceId } from './workspaces';

export type { PortKind } from './module';

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
  /** Categorías en uso, en orden de presentación: primero las conocidas del núcleo, después las nuevas. */
  readonly categories: readonly { id: string; label: string }[];
  /** Avisos que no impiden arrancar (p. ej. una clave compartida en un módulo y propia en otro). */
  readonly warnings: readonly string[];
  get(id: string): AnyModule | undefined;
  /** Etiqueta de una categoría (la conocida o la declarada por un módulo). */
  categoryLabel(id: string): string;
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
const CATEGORY_ID_PATTERN = MODULE_ID_PATTERN;
const PORT_ID_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const LOCAL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const REQUIRED_LABEL: Record<Exclude<PortKind, 'curve'>, string> = {
  scalar: 'el escalar requerido',
  table: 'la tabla requerida',
  zoneScalar: 'el valor por zona requerido',
};

export interface RegistryOptions {
  /** Roles base (por defecto, los incorporados). */
  baseRoles?: readonly RoleDef[];
  /**
   * Catálogo canónico de parámetros compartidos (clave → spec con `shared: true`). Si se da, todo parámetro
   * compartido de un módulo tiene que estar en el catálogo y ser idéntico. La app pasa `src/modules/sharedParams.ts`.
   */
  sharedParams?: ParamsSpec;
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
    const ws = typeof m.workspace === 'string' ? [m.workspace] : m.workspace;
    if (!Array.isArray(ws) || ws.length === 0) problems.push(`${where(m)}: falta el espacio de trabajo.`);
    else for (const w of ws) if (!isWorkspaceId(w)) problems.push(`${where(m)}: espacio de trabajo desconocido '${w}'.`);
    if (typeof m.compute !== 'function') problems.push(`${where(m)}: falta la función compute.`);
    if (!m.docs || typeof m.docs.summary !== 'string' || !Array.isArray(m.docs.equations) || !Array.isArray(m.docs.references)) {
      problems.push(`${where(m)}: docs debe tener summary, equations y references.`);
    }
  }

  // 1b. Categorías: las conocidas del núcleo + las que declaren los módulos (id + categoryLabel)
  const known = new Map<string, string>(CATEGORIES.map((c) => [c.id, c.label]));
  const declared = new Map<string, { label: string; owner: string }>();
  for (const m of modules) {
    if (!m || typeof m !== 'object') continue;
    const id = m.category as string;
    if (typeof id !== 'string' || !CATEGORY_ID_PATTERN.test(id)) {
      problems.push(`${where(m)}: la categoría '${String(id)}' debe estar en kebab-case.`);
      continue;
    }
    if (m.categoryLabel === undefined) continue;
    const label = m.categoryLabel.trim();
    if (!label) problems.push(`${where(m)}: categoryLabel está vacío.`);
    else if (known.has(id) && known.get(id) !== label) {
      problems.push(`${where(m)}: la categoría '${id}' ya existe con la etiqueta '${known.get(id)}'; no declares otra.`);
    } else if (!known.has(id)) {
      const prev = declared.get(id);
      if (prev && prev.label !== label) problems.push(`${where(m)}: la categoría '${id}' ya la declaró '${prev.owner}' como '${prev.label}'.`);
      else if (!prev) declared.set(id, { label, owner: m.id });
    }
  }
  for (const m of modules) {
    if (!m || typeof m !== 'object' || typeof m.category !== 'string') continue;
    if (!known.has(m.category) && !declared.has(m.category)) {
      problems.push(`${where(m)}: categoría desconocida '${m.category}'. Si es nueva, declarala con categoryLabel.`);
    }
  }
  const used = new Set(modules.filter((m) => m && typeof m === 'object').map((m) => m.category as string));
  const categories = [
    ...CATEGORIES.filter((c) => used.has(c.id)).map((c) => ({ id: c.id as string, label: c.label as string })),
    ...[...declared].map(([id, d]) => ({ id, label: d.label })),
  ];

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
        if (roles.has(spec.port)) problems.push(`${where(m)}: el puerto (${PORT_KIND_LABEL[spec.kind] ?? spec.kind}) '${spec.port}' coincide con un rol de curva.`);
        if ((spec.kind === 'scalar' || spec.kind === 'zoneScalar') && spec.unit !== undefined && !getUnit(spec.unit)) {
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
      } else if (spec.kind === 'scalar' || spec.kind === 'table' || spec.kind === 'zoneScalar') {
        // El tipo del puerto lo fijan sus productores: el consumidor tiene que pedirlo con el mismo tipo.
        const info = ports.get(spec.port);
        const want = PORT_KIND_LABEL[spec.kind];
        if (!PORT_ID_PATTERN.test(spec.port)) problems.push(`${where(m)}: la entrada '${key}' pide el puerto '${spec.port}', que debe estar en MAYÚSCULAS.`);
        if (roles.has(spec.port)) problems.push(`${where(m)}: la entrada '${key}' pide '${spec.port}' como ${want}, pero es un rol de curva: usá input.curve('${spec.port}').`);
        if (info && info.kind !== spec.kind) {
          problems.push(`${where(m)}: la entrada '${key}' pide '${spec.port}' como ${want} pero es '${info.kind}' (${PORT_KIND_LABEL[info.kind]}).`);
        }
        if (!info && !spec.optional) problems.push(`${where(m)}: ningún módulo produce ${REQUIRED_LABEL[spec.kind]} '${spec.port}'.`);
      } else {
        problems.push(`${where(m)}: la entrada '${key}' tiene un tipo desconocido.`);
      }
    }
  }

  // 5. Parámetros (incluye compatibilidad de compartidos)
  const warnings: string[] = [];
  const catalog = options.sharedParams;
  if (catalog) {
    for (const [key, spec] of Object.entries(catalog)) {
      for (const p of validateParamSpec('Catálogo de parámetros compartidos', key, spec)) problems.push(p);
      if (!spec.shared) problems.push(`Catálogo de parámetros compartidos: '${key}' debe tener shared: true.`);
    }
  }
  const paramSpecs = new Map<string, { spec: ParamSpec; moduleIds: string[] }>();
  /** clave local → módulos donde es compartida / propia (para avisar mezclas). */
  const sharedUse = new Map<string, { shared: string[]; local: string[] }>();
  for (const m of modules) {
    for (const [key, spec] of Object.entries(m.params ?? {})) {
      problems.push(...validateParamSpec(where(m), key, spec));
      const use = sharedUse.get(key) ?? { shared: [], local: [] };
      (spec.shared ? use.shared : use.local).push(m.id);
      sharedUse.set(key, use);
      if (spec.shared && catalog) {
        const canonical = catalog[key];
        if (!canonical) {
          problems.push(`${where(m)}: el parámetro compartido '${key}' no está en el catálogo de parámetros compartidos; agregalo ahí y usalo desde el catálogo.`);
        } else {
          const diffs = sharedSpecDifferences(canonical, spec);
          if (diffs.length) problems.push(`${where(m)}: el parámetro compartido '${key}' difiere del catálogo en ${diffs.join(', ')}. Usá el spec del catálogo.`);
        }
      }
      const storage = paramStorageKey(m.id, key, spec);
      const prev = paramSpecs.get(storage);
      if (prev) {
        // Una clave propia repetida solo ocurre con ids de módulo repetidos (ya informado arriba).
        const diffs = spec.shared ? sharedSpecDifferences(prev.spec, spec) : [];
        if (diffs.length) problems.push(`${where(m)}: el parámetro compartido '${key}' no coincide con el de '${prev.moduleIds[0]}' en ${diffs.join(', ')}.`);
        prev.moduleIds.push(m.id);
      } else {
        paramSpecs.set(storage, { spec, moduleIds: [m.id] });
      }
    }
  }
  for (const [key, use] of sharedUse) {
    if (use.shared.length && use.local.length) {
      warnings.push(
        `El parámetro '${key}' es compartido en ${use.shared.map((x) => `'${x}'`).join(', ')} y propio en ${use.local.map((x) => `'${x}'`).join(', ')}: ` +
          'se guardan como valores distintos. Si es el mismo parámetro, declaralo compartido en todos.',
      );
    }
  }

  if (problems.length) throw new RegistryError(problems);

  const order = new Map(modules.map((m, i) => [m.id, i]));
  return {
    modules,
    roles,
    ports,
    paramSpecs,
    categories,
    warnings,
    get: (id) => byId.get(id),
    categoryLabel: (id) => known.get(id) ?? declared.get(id)?.label ?? id,
    indexOf: (id) => order.get(id) ?? -1,
  };
}
