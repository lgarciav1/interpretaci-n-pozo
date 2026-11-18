import { formulaRegistry } from './formulas';
/**
 * Planificación del grafo de cálculo: qué fuente alimenta cada puerto, qué módulos corren, en qué orden,
 * y qué falta. No calcula nada: es puro y barato (se rehace en cada corrida).
 */
import type { Interpretation, SourceRef } from '../interpretation';
import { describeInputGroup, PORT_KIND_LABEL, portOf, unmetInputGroup, type AnyModule } from '../module';
import type { Registry } from '../registry';
import type { RoleId } from '../roles';
import { selectDataCurves } from '../preparation/projection';
import { isPreparedSource } from '../preparation/source';
import type { CurveProvenance } from './context';
import type { UnitId } from '../units';
import { validateExplicitSource } from './explicitSource';

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
    | 'params'
    | 'formula';
  message: string;
  moduleId?: string;
  port?: string;
  /** Zona a la que se refiere el aviso (id de `interpretation.zones`), si el módulo la informó (0072). */
  zoneId?: string;
  /** Profundidad medida (m) de un aviso puntual (una muestra, un punto MDT), si el módulo la informó (0072). */
  depth?: number;
}

/** Lo mínimo que el planificador necesita saber de las curvas del pozo. */
export interface CurveMeta {
  provenance?: CurveProvenance;
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
  registry: Registry;
  expressions: ReadonlyMap<string, string>;
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

export function planGraph(base: Registry, allCurves: readonly CurveMeta[], interp: Interpretation): Plan {
  const diagnostics: Diagnostic[] = [];
  const { registry, expressions } = formulaRegistry(base, allCurves, interp, diagnostics);
  const disabled = new Set(interp.disabled);

  // 0. Sarta (docs/decisiones/0032): las curvas de una herramienta apagada o fuera de la sarta planificada no existen
  //    para el cálculo. Es un filtro: los datos siguen en el pozo y vuelven al prender la herramienta.
  const { excluded, eligible: curves } = selectDataCurves(allCurves, interp, registry.tools);

  // 1. Candidatos por puerto: curvas medidas con ese rol (orden del pozo) y luego módulos (orden del registro).
  const candidates = new Map<string, SourceRef[]>();
  const addCandidate = (port: string, ref: SourceRef) => {
    const list = candidates.get(port);
    if (list) list.push(ref);
    else candidates.set(port, [ref]);
  };
  for (const c of curves) if (c.role && c.provenance?.origin !== 'prepared') addCandidate(c.role, { kind: 'curve', curveId: c.id });
  for (const m of registry.modules) {
    if (disabled.has(m.id)) continue;
    for (const spec of Object.values(m.outputs)) addCandidate(portOf(spec), { kind: 'module', moduleId: m.id });
  }

  // 2. Fuente elegida por puerto: la explícita si es válida; si no, la primera candidata que pueda correr.
  //    2a. Fuentes explícitas (las curvas con otro rol elegidas a propósito se suman a las candidatas).
  const curvesById = new Map(curves.map((c) => [c.id, c]));
  const sources = new Map<string, SourceRef>();
  const ports = new Set<string>([...candidates.keys(), ...Object.keys(interp.sources)]);
  const needDefault: string[] = [];
  const blockedPorts = new Set<string>();
  for (const port of ports) {
    const explicit = interp.sources[port];
    // Una preparación elegida nunca vuelve silenciosamente a original/módulo.
    if (isPreparedSource(explicit) && (explicit?.kind === 'curve') &&
      !allCurves.some(c => c.id === explicit.curveId && c.provenance?.origin !== 'prepared') &&
      (excluded.has(explicit.curveId) || validateExplicitSource(registry, curvesById, disabled, port, explicit))) {
      blockedPorts.add(port);
      diagnostics.push({ level: 'warning', code: 'invalid-source', port, message: `La curva preparada '${explicit.curveId}' elegida para ${port} no está disponible. El puerto queda bloqueado; elegí otra fuente explícitamente.` });
      continue;
    }
    if (explicit?.kind === 'curve' && excluded.has(explicit.curveId)) {
      // Elección del usuario que la sarta deja en suspenso: vuelve sola al prender la herramienta.
      const c = allCurves.find((x) => x.id === explicit.curveId)!;
      const tool = registry.tools.ownerOf(c);
      diagnostics.push({
        level: 'info',
        code: 'invalid-source',
        port,
        message: `La curva '${c.mnemonic}' elegida para ${port} es de ${tool ? `«${tool.name}»` : 'una herramienta'}, que no está activa en la sarta. Se usa la fuente por defecto.`,
      });
      needDefault.push(port);
      continue;
    }
    if (explicit) {
      const problem = validateExplicitSource(registry, curvesById, disabled, port, explicit);
      if (!problem) {
        sources.set(port, explicit);
        if (explicit.kind === 'curve') {
          const c = curvesById.get(explicit.curveId)!;
          if (c.provenance?.origin === 'prepared' && c.role === port) addCandidate(port, explicit);
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
    needDefault.push(port);
  }

  //    2b. Viabilidad estática: un módulo "puede correr" si cada entrada requerida tiene alguna candidata que pueda
  //        correr y no sea él mismo, y cada grupo «al menos N de» tiene N entradas así. Menor punto fijo (un ciclo no
  //        se justifica a sí mismo); optimista respecto de las fuentes elegidas. Sirve para elegir la fuente por
  //        defecto y para soltar entradas opcionales.
  const viable = new Set<string>();
  const notSelf = (ref: SourceRef, id: string) => !(ref.kind === 'module' && ref.moduleId === id);
  const isViable = (ref: SourceRef) => ref.kind === 'curve' || viable.has(ref.moduleId);
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of registry.modules) {
      if (disabled.has(m.id) || viable.has(m.id)) continue;
      const canFeed = (spec: AnyModule['inputs'][string]) => spec.kind === 'curve' && spec.curveId !== undefined
        ? curvesById.has(spec.curveId)
        : (candidates.get(portOf(spec)) ?? []).some((c) => notSelf(c, m.id) && isViable(c));
      const ok =
        Object.values(m.inputs).every((spec) => spec.optional || canFeed(spec)) &&
        !unmetInputGroup(m, (key) => !!m.inputs[key] && canFeed(m.inputs[key]!));
      if (ok) {
        viable.add(m.id);
        changed = true;
      }
    }
  }

  //    2c. Por defecto: curva medida con ese rol → primer módulo registrado que pueda correr → primer candidato.
  for (const port of needDefault) {
    const list = candidates.get(port) ?? [];
    const first = list.find(isViable) ?? list[0];
    if (first) sources.set(port, first);
  }

  // Para un consumidor dado: la fuente elegida, salvo que sea él mismo (entonces la siguiente candidata, preferentemente
  // una que pueda correr).
  const sourceFor = (port: string, consumer: string): SourceRef | null => {
    if (blockedPorts.has(port)) return null;
    const chosen = sources.get(port);
    if (chosen && notSelf(chosen, consumer)) return chosen;
    const list = candidates.get(port) ?? [];
    return list.find((s) => notSelf(s, consumer) && isViable(s)) ?? list.find((s) => notSelf(s, consumer)) ?? null;
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
    // Avisos de entradas opcionales soltadas: se publican solo si el módulo igual corre (si un grupo «al menos N de»
    // queda sin cumplir, decir «se calcula sin …» sería contradictorio).
    const dropped: Diagnostic[] = [];
    for (const [key, spec] of Object.entries(m.inputs)) {
      const port = portOf(spec);
      let src: SourceRef | null;
      if (spec.kind === 'curve' && spec.curveId !== undefined) {
        src = curvesById.has(spec.curveId) ? { kind: 'curve', curveId: spec.curveId } : null;
      } else if (expressions.has(id)) {
        src = sources.get(port) ?? null;
      } else {
        src = sourceFor(port, id);
      }
      if (blockedPorts.has(port) && spec.optional) {
        status = 'blocked';
        diagnostics.push({ level: 'warning', code: 'blocked', moduleId: id, port, message: `${moduleLabel(m, id)} está bloqueado por la fuente preparada de ${port}, aunque su entrada sea opcional.` });
      }
      if (src?.kind === 'module' && spec.optional && !isViable(src)) {
        // Entrada opcional cuya fuente no puede correr: el módulo corre sin ella (no se bloquea por algo opcional).
        dropped.push({
          level: 'info',
          code: 'missing-input',
          moduleId: id,
          port,
          message: `${moduleLabel(m, id)} se calcula sin ${port} (opcional): ${moduleLabel(registry.get(src.moduleId), src.moduleId)} no puede calcularse.`,
        });
        src = null;
      }
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
            spec.kind === 'curve' && spec.curveId !== undefined
              ? `${moduleLabel(m, id)} necesita la curva ${spec.label ?? spec.curveId}, que no está disponible.`
              : spec.kind === 'curve'
              ? `${moduleLabel(m, id)} necesita una curva con rol ${port} (${what}). Asigná ese rol a una curva del pozo o activá un módulo que la calcule.`
              : `${moduleLabel(m, id)} necesita ${spec.kind === 'scalar' ? 'el valor' : `el dato (${PORT_KIND_LABEL[spec.kind]})`} ${port} (${what}) y ningún módulo activo lo calcula.`,
        });
      }
    }
    // Grupos «al menos N de» (0032): con las entradas opcionales que quedaron.
    const unmet = unmetInputGroup(m, (key) => !!inputs[key]);
    if (!unmet) diagnostics.push(...dropped);
    if (status === 'ready' && unmet) {
      status = 'missing-input';
      diagnostics.push({
        level: 'error',
        code: 'missing-input',
        moduleId: id,
        message: `${moduleLabel(m, id)} necesita ${describeInputGroup(m, unmet)}, y no hay ninguna fuente que pueda calcularse.`,
      });
    }
    nodes.set(id, { moduleId: id, reason: reasons.get(id)!, inputs, deps: [...deps], status });
  }

  // Un módulo activo solo por defecto (nadie lo eligió, el usuario no lo pidió para comparar y ningún otro lo
  // consume) al que le falta una entrada no es un error: p. ej. 'Rw desde el SP' en un pozo sin SP. Se informa como `info`.
  const consumed = new Set([...nodes.values()].flatMap((n) => n.deps));
  const explicitModules = new Set(
    Object.values(interp.sources).flatMap((s) => (s.kind === 'module' ? [s.moduleId] : [])),
  );
  const compared = new Set(interp.compare);
  for (const d of diagnostics) {
    if (d.code !== 'missing-input' || d.level !== 'error' || !d.moduleId) continue;
    const id = d.moduleId;
    if (!expressions.has(id) && reasons.get(id) === 'chain' && !consumed.has(id) && !explicitModules.has(id) && !compared.has(id)) d.level = 'info';
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
  //    Una dependencia que solo alimenta entradas opcionales no bloquea: esas entradas quedan ausentes.
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of order) {
      const n = nodes.get(id)!;
      if (n.status !== 'ready') continue;
      for (const d of n.deps) {
        if (nodes.get(d)!.status === 'ready' || !feedsOnlyOptional(registry.get(id)!, n, d)) continue;
        for (const [key, src] of Object.entries(n.inputs)) if (src?.kind === 'module' && src.moduleId === d) n.inputs[key] = null;
        n.deps = n.deps.filter((x) => x !== d);
        changed = true;
        diagnostics.push({
          level: 'info',
          code: 'missing-input',
          moduleId: id,
          message: `${moduleLabel(registry.get(id), id)} se calcula sin las entradas opcionales que da ${moduleLabel(registry.get(d), d)}, que no se pudo calcular.`,
        });
      }
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
        continue;
      }
      // Soltar entradas opcionales puede dejar un grupo «al menos N de» sin cumplir.
      const m = registry.get(id)!;
      const unmet = unmetInputGroup(m, (key) => !!n.inputs[key]);
      if (unmet) {
        n.status = 'blocked';
        changed = true;
        diagnostics.push({
          level: 'warning',
          code: 'blocked',
          moduleId: id,
          message: `${moduleLabel(m, id)} no se puede calcular: necesita ${describeInputGroup(m, unmet)} y los módulos que las daban no se pudieron calcular.`,
        });
      }
    }
  }

  return { registry, expressions, sources, candidates, order, nodes, diagnostics };
}

/** true si el módulo `dep` alimenta a `node` solo a través de entradas opcionales. */
export function feedsOnlyOptional(m: AnyModule, node: PlanNode, dep: string): boolean {
  return Object.entries(node.inputs).every(([key, src]) => !(src?.kind === 'module' && src.moduleId === dep) || !!m.inputs[key]?.optional);
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

