/**
 * Planificación del grafo de cálculo: qué fuente alimenta cada puerto, qué módulos corren, en qué orden,
 * y qué falta. No calcula nada: es puro y barato (se rehace en cada corrida).
 */
import type { Interpretation, SourceRef } from '../interpretation';
import { portOf, type AnyModule } from '../module';
import type { Registry } from '../registry';
import type { RoleId } from '../roles';
import { getUnit, type UnitId } from '../units';

export interface Diagnostic {
  level: 'error' | 'warning' | 'info';
  code:
    | 'missing-input'
    | 'blocked'
    | 'cycle'
    | 'invalid-source'
    | 'compute-error'
    | 'cross-role-source'
    | 'module-warning'
    | 'invalid-output'
    | 'unit-mismatch'
    | 'unknown-unit'
    | 'zones'
    | 'params';
  message: string;
  moduleId?: string;
  port?: string;
}

/** Lo mínimo que el planificador necesita saber de las curvas del pozo. */
export interface CurveMeta {
  id: string;
  mnemonic: string;
  role: RoleId | null;
  /** Para validar fuentes explícitas con otro rol (si falta, no se valida la dimensión). */
  unit?: UnitId;
}

export type NodeStatus = 'ready' | 'missing-input' | 'cycle' | 'blocked';

/** Por qué corre un módulo. */
export type NodeReason = 'chain' | 'compare' | 'dependency';

export interface PlanNode {
  moduleId: string;
  reason: NodeReason;
  /** Clave local de entrada → fuente resuelta (null si falta). */
  inputs: Record<string, SourceRef | null>;
  /** Módulos de los que depende (ids únicos). */
  deps: string[];
  status: NodeStatus;
}

export interface Plan {
  /** Fuente elegida por puerto (la que alimenta la cadena). */
  sources: Map<string, SourceRef>;
  /** Todas las fuentes disponibles por puerto (para el selector de método). */
  candidates: Map<string, SourceRef[]>;
  /** Módulos activos en orden topológico (incluye los que no podrán correr, en su lugar). */
  order: string[];
  nodes: Map<string, PlanNode>;
  diagnostics: Diagnostic[];
}

function moduleLabel(m: AnyModule | undefined, id: string): string {
  return m ? `'${m.name}'` : `'${id}'`;
}

export function planGraph(registry: Registry, curves: readonly CurveMeta[], interp: Interpretation): Plan {
  const diagnostics: Diagnostic[] = [];
  const disabled = new Set(interp.disabled);

  // 1. Candidatos por puerto: curvas medidas con ese rol (orden del pozo) y luego módulos (orden del registro).
  const candidates = new Map<string, SourceRef[]>();
  const addCandidate = (port: string, ref: SourceRef) => {
    const list = candidates.get(port);
    if (list) list.push(ref);
    else candidates.set(port, [ref]);
  };
  for (const c of curves) if (c.role) addCandidate(c.role, { kind: 'curve', curveId: c.id });
  for (const m of registry.modules) {
    if (disabled.has(m.id)) continue;
    for (const spec of Object.values(m.outputs)) addCandidate(portOf(spec), { kind: 'module', moduleId: m.id });
  }

  // 2. Fuente elegida por puerto: la explícita si es válida; si no, la primera candidata.
  const curvesById = new Map(curves.map((c) => [c.id, c]));
  const sources = new Map<string, SourceRef>();
  const ports = new Set<string>([...candidates.keys(), ...Object.keys(interp.sources)]);
  for (const port of ports) {
    const explicit = interp.sources[port];
    if (explicit) {
      const problem = validateExplicitSource(registry, curvesById, disabled, port, explicit);
      if (!problem) {
        sources.set(port, explicit);
        if (explicit.kind === 'curve') {
          const c = curvesById.get(explicit.curveId)!;
          if (c.role !== port) {
            // Intencional: el usuario puede usar una curva con otro rol (p. ej. AT60 como RT). Se informa y se
            // ofrece en el selector junto a las candidatas normales.
            diagnostics.push({
              level: 'info',
              code: 'cross-role-source',
              port,
              message: `Se usa la curva '${c.mnemonic}'${c.role ? ` (rol ${c.role})` : ' (sin rol)'} como ${port} por elección explícita.`,
            });
            addCandidate(port, explicit);
          }
        }
        continue;
      }
      diagnostics.push({ level: 'warning', code: 'invalid-source', port, message: `${problem} Se usa la fuente por defecto.` });
    }
    const first = candidates.get(port)?.[0];
    if (first) sources.set(port, first);
  }

  // Para un consumidor dado: la fuente elegida, salvo que sea él mismo (entonces la siguiente candidata).
  const sourceFor = (port: string, consumer: string): SourceRef | null => {
    const chosen = sources.get(port);
    if (chosen && !(chosen.kind === 'module' && chosen.moduleId === consumer)) return chosen;
    return candidates.get(port)?.find((s) => !(s.kind === 'module' && s.moduleId === consumer)) ?? null;
  };

  // 3. Módulos activos: elegidos para algún puerto o en comparación; luego clausura por dependencias.
  const reasons = new Map<string, NodeReason>();
  for (const m of registry.modules) {
    if (disabled.has(m.id)) continue;
    const chosenSomewhere = Object.values(m.outputs).some((spec) => {
      const s = sources.get(portOf(spec));
      return s?.kind === 'module' && s.moduleId === m.id;
    });
    if (chosenSomewhere) reasons.set(m.id, 'chain');
  }
  for (const id of interp.compare) {
    if (disabled.has(id)) continue;
    if (!registry.get(id)) {
      diagnostics.push({ level: 'warning', code: 'invalid-source', moduleId: id, message: `El módulo '${id}' marcado para comparar no existe.` });
      continue;
    }
    if (!reasons.has(id)) reasons.set(id, 'compare');
  }

  const nodes = new Map<string, PlanNode>();
  const pending = [...reasons.keys()];
  while (pending.length) {
    const id = pending.pop()!;
    if (nodes.has(id)) continue;
    const m = registry.get(id)!;
    const inputs: Record<string, SourceRef | null> = {};
    const deps = new Set<string>();
    let status: NodeStatus = 'ready';
    for (const [key, spec] of Object.entries(m.inputs)) {
      const port = portOf(spec);
      const src = sourceFor(port, id);
      inputs[key] = src;
      if (src?.kind === 'module') {
        deps.add(src.moduleId);
        if (!reasons.has(src.moduleId)) {
          reasons.set(src.moduleId, 'dependency');
          pending.push(src.moduleId);
        }
      }
      if (!src && !spec.optional) {
        status = 'missing-input';
        const what = spec.kind === 'curve' ? registry.roles.get(spec.role)?.label ?? spec.role : spec.label ?? spec.port;
        diagnostics.push({
          level: 'error',
          code: 'missing-input',
          moduleId: id,
          port,
          message:
            spec.kind === 'curve'
              ? `${moduleLabel(m, id)} necesita una curva con rol ${port} (${what}). Asigná ese rol a una curva del pozo o activá un módulo que la calcule.`
              : `${moduleLabel(m, id)} necesita el valor ${port} (${what}) y ningún módulo activo lo calcula.`,
        });
      }
    }
    nodes.set(id, { moduleId: id, reason: reasons.get(id)!, inputs, deps: [...deps], status });
  }

  // 4. Orden topológico (Kahn) con desempate por orden de registro → determinístico.
  const byRegistry = (a: string, b: string) => registry.indexOf(a) - registry.indexOf(b);
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const n of nodes.values()) {
    indegree.set(n.moduleId, n.deps.length);
    for (const d of n.deps) {
      const list = dependents.get(d);
      if (list) list.push(n.moduleId);
      else dependents.set(d, [n.moduleId]);
    }
  }
  const ready = [...nodes.keys()].filter((id) => indegree.get(id) === 0).sort(byRegistry);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const left = indegree.get(dep)! - 1;
      indegree.set(dep, left);
      if (left === 0) {
        ready.push(dep);
        ready.sort(byRegistry);
      }
    }
  }

  // 5. Ciclos: lo que no entró al orden está en un ciclo o depende de uno.
  if (order.length < nodes.size) {
    const leftover = [...nodes.keys()].filter((id) => !order.includes(id)).sort(byRegistry);
    const reported = new Set<string>();
    for (const id of leftover) {
      const cycle = findCycle(id, nodes, new Set(leftover));
      if (cycle) {
        for (const c of cycle) nodes.get(c)!.status = 'cycle';
        const key = [...cycle].sort().join(',');
        if (!reported.has(key)) {
          reported.add(key);
          const path = [...cycle, cycle[0]!].map((c) => moduleLabel(registry.get(c), c)).join(' → ');
          diagnostics.push({ level: 'error', code: 'cycle', moduleId: cycle[0], message: `Hay un ciclo de dependencias: ${path}. Elegí otra fuente para alguno de esos puertos.` });
        }
      }
    }
    for (const id of leftover) order.push(id);
  }

  // 6. Propagar bloqueos estáticos aguas abajo (hasta punto fijo: los nodos tras un ciclo no están ordenados).
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of order) {
      const n = nodes.get(id)!;
      if (n.status !== 'ready') continue;
      const bad = n.deps.find((d) => nodes.get(d)!.status !== 'ready');
      if (bad) {
        n.status = 'blocked';
        changed = true;
        diagnostics.push({
          level: 'warning',
          code: 'blocked',
          moduleId: id,
          message: `${moduleLabel(registry.get(id), id)} no se puede calcular porque ${moduleLabel(registry.get(bad), bad)} no se pudo calcular.`,
        });
      }
    }
  }

  return { sources, candidates, order, nodes, diagnostics };
}

function validateExplicitSource(
  registry: Registry,
  curvesById: Map<string, CurveMeta>,
  disabled: Set<string>,
  port: string,
  ref: SourceRef,
): string | null {
  if (ref.kind === 'curve') {
    if (!registry.roles.has(port)) return `El puerto ${port} no es una curva: no puede tener como fuente una curva medida.`;
    const c = curvesById.get(ref.curveId);
    if (!c) return `La curva '${ref.curveId}' elegida para ${port} no existe en el pozo.`;
    // Con otro rol se admite, pero tiene que ser la misma magnitud (no se puede usar una densidad como Rt).
    const expected = getUnit(registry.roles.unitOf(port));
    const actual = c.unit !== undefined ? getUnit(c.unit) : undefined;
    if (c.role !== port && expected && actual && actual.dimension !== expected.dimension) {
      return `La curva '${c.mnemonic}' (${actual.label}) no puede ser ${port}: se esperaba una magnitud en ${expected.label}.`;
    }
    return null;
  }
  const m = registry.get(ref.moduleId);
  if (!m) return `El módulo '${ref.moduleId}' elegido para ${port} no existe.`;
  if (disabled.has(ref.moduleId)) return `El módulo '${m.name}' elegido para ${port} está desactivado.`;
  if (!Object.values(m.outputs).some((s) => portOf(s) === port)) return `El módulo '${m.name}' no produce ${port}.`;
  return null;
}

/** Busca un ciclo que pase por `start` dentro de `allowed`. Devuelve los nodos del ciclo en orden. */
function findCycle(start: string, nodes: Map<string, PlanNode>, allowed: Set<string>): string[] | null {
  const path: string[] = [];
  const visited = new Set<string>();
  const dfs = (id: string): string[] | null => {
    path.push(id);
    visited.add(id);
    for (const d of nodes.get(id)!.deps) {
      if (!allowed.has(d)) continue;
      if (d === start) return [...path];
      if (!visited.has(d)) {
        const found = dfs(d);
        if (found) return found;
      }
    }
    path.pop();
    return null;
  };
  const cycle = dfs(start);
  // deps apuntan "hacia arriba": invertimos para leer en el sentido del flujo de datos.
  return cycle ? cycle.reverse() : null;
}
