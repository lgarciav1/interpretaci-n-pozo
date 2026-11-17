/**
 * AVISOS AGRUPADOS — lógica pura del panel Avisos (docs/decisiones/0072): huella de un aviso, agrupado por paso del
 * flujo y por módulo, filtros y plegado por defecto. Sin React ni stores: se testea en tests/diagnostics-grouping.test.ts.
 */
import type { Diagnostic } from '../../core/engine/graph';
import type { WorkspaceId } from '../../core/workspaces';
import { stepsOfModule, type FlowModule, type FlowStepDef } from '../flow/flow';

export type DiagnosticLevel = Diagnostic['level'];

/** Gravedades, de mayor a menor (orden de las fichas de filtro y de los avisos dentro de un módulo). */
export const DIAGNOSTIC_LEVELS: readonly DiagnosticLevel[] = ['error', 'warning', 'info'];

export const LEVEL_LABEL: Record<DiagnosticLevel, string> = { error: 'Error', warning: 'Advertencia', info: 'Información' };
export const LEVEL_LABEL_PLURAL: Record<DiagnosticLevel, string> = { error: 'Errores', warning: 'Advertencias', info: 'Información' };

export type LevelCounts = Record<DiagnosticLevel, number>;

export const GENERAL_GROUP = 'general';
export const OTHER_GROUP = 'other';

/** Se abren plegados los grupos sin errores cuando hay más avisos que esto. */
export const COLLAPSE_THRESHOLD = 10;

/**
 * Huella de un aviso: `moduleId|code|zoneId|message`, con el texto completo. Si el aviso cambia (otro porcentaje,
 * otra cantidad de muestras) cambia la huella y vuelve a aparecer sin marcar.
 */
export function diagnosticFingerprint(d: Pick<Diagnostic, 'moduleId' | 'code' | 'zoneId' | 'message'>): string {
  return [d.moduleId ?? '', d.code, d.zoneId ?? '', d.message].join('|');
}

/**
 * Texto del aviso sin el nombre del módulo al principio (ya está en el encabezado del subgrupo). Acepta las dos formas
 * que usa el motor: «Nombre: …» y «'Nombre': …». Si no empieza así, el texto queda igual.
 */
export function stripModulePrefix(message: string, moduleName: string | null): string {
  if (!moduleName) return message;
  for (const prefix of [`${moduleName}: `, `'${moduleName}': `]) {
    if (message.startsWith(prefix) && message.length > prefix.length) {
      const rest = message.slice(prefix.length);
      // Solo palabras en letras latinas minúsculas: «φ», «ρmaa», «k» o «kH» no se tocan (φ → Φ cambiaría el sentido).
      return /^[a-záéíóúüñ]{2}/.test(rest) ? rest.charAt(0).toLocaleUpperCase('es') + rest.slice(1) : rest;
    }
  }
  return message;
}

/** Lo que el agrupado necesita saber de un módulo registrado. */
export interface GroupingModule extends FlowModule {
  name: string;
  workspaces: readonly WorkspaceId[];
}

/** Un flujo guiado (pasos de un espacio de trabajo). */
export interface GroupingFlow {
  workspace: WorkspaceId;
  steps: readonly FlowStepDef[];
}

/** Dónde se abre un módulo: su paso (y el espacio de trabajo de ese paso) o, si no tiene, la vista libre. */
export interface ModuleTarget {
  moduleId: string;
  workspace: WorkspaceId | null;
  step: { id: string; label: string } | null;
}

/**
 * Paso de un módulo: el primero en el que aparece, buscando primero en los flujos de `flows` (en ese orden) que
 * correspondan a un espacio de trabajo del módulo. Sin paso, el primer espacio de trabajo del módulo que esté en
 * `flows` (o el primero suyo).
 */
export function moduleTarget(module: GroupingModule, flows: readonly GroupingFlow[]): ModuleTarget {
  const own = flows.filter((f) => module.workspaces.includes(f.workspace));
  for (const f of own) {
    const step = stepsOfModule(f.steps, module)[0];
    if (step) return { moduleId: module.id, workspace: f.workspace, step: { id: step.id, label: step.label } };
  }
  return { moduleId: module.id, workspace: own[0]?.workspace ?? module.workspaces[0] ?? null, step: null };
}

export interface DiagnosticItem {
  diagnostic: Diagnostic;
  fingerprint: string;
  /** Texto para mostrar (sin el prefijo del módulo). */
  text: string;
  seen: boolean;
}

export interface ModuleSubgroup {
  /** null = avisos generales (sin módulo). */
  moduleId: string | null;
  name: string | null;
  target: ModuleTarget | null;
  items: DiagnosticItem[];
}

export interface DiagnosticGroup {
  /** `general`, el id del paso o `other`. */
  id: string;
  title: string;
  modules: ModuleSubgroup[];
  /** Todos los avisos del grupo por gravedad. */
  counts: LevelCounts;
  /** Los no vistos por gravedad. */
  unseen: LevelCounts;
  total: number;
}

export const emptyCounts = (): LevelCounts => ({ error: 0, warning: 0, info: 0 });

const LEVEL_RANK: Record<DiagnosticLevel, number> = { error: 0, warning: 1, info: 2 };

/**
 * Agrupa los avisos por paso del flujo y, dentro, por módulo. «General» (sin módulo) va primero; los pasos, en el orden
 * de `flows` (el espacio de trabajo activo primero); «Otros módulos» (sin paso o desconocidos) al final. Dentro de un
 * módulo: no vistos antes que vistos y, en cada parte, por gravedad y en el orden del motor.
 */
export function groupDiagnostics(
  diagnostics: readonly Diagnostic[],
  modules: readonly GroupingModule[],
  flows: readonly GroupingFlow[],
  seen: ReadonlySet<string> = new Set(),
): DiagnosticGroup[] {
  const byId = new Map(modules.map((m, i) => [m.id, { m, i }]));
  const stepOrder = new Map<string, number>();
  for (const f of flows) for (const s of f.steps) if (!stepOrder.has(s.id)) stepOrder.set(s.id, stepOrder.size);
  const targets = new Map<string, ModuleTarget>();
  const targetOf = (id: string): ModuleTarget | null => {
    const known = byId.get(id);
    if (!known) return null;
    let t = targets.get(id);
    if (!t) targets.set(id, (t = moduleTarget(known.m, flows)));
    return t;
  };

  const groups = new Map<string, DiagnosticGroup & { order: number }>();
  const subgroups = new Map<string, ModuleSubgroup & { order: number }>();
  diagnostics.forEach((d) => {
    const moduleId = d.moduleId ?? null;
    const target = moduleId ? targetOf(moduleId) : null;
    const groupId = moduleId === null ? GENERAL_GROUP : target?.step ? target.step.id : OTHER_GROUP;
    let g = groups.get(groupId);
    if (!g) {
      const title = groupId === GENERAL_GROUP ? 'General' : groupId === OTHER_GROUP ? 'Otros módulos' : target!.step!.label;
      const order = groupId === GENERAL_GROUP ? -1 : groupId === OTHER_GROUP ? Number.MAX_SAFE_INTEGER : (stepOrder.get(groupId) ?? stepOrder.size);
      g = { id: groupId, title, modules: [], counts: emptyCounts(), unseen: emptyCounts(), total: 0, order };
      groups.set(groupId, g);
    }
    const subKey = `${groupId}\u0000${moduleId ?? ''}`;
    let sub = subgroups.get(subKey);
    if (!sub) {
      const known = moduleId ? byId.get(moduleId) : undefined;
      sub = { moduleId, name: moduleId ? (known?.m.name ?? moduleId) : null, target, items: [], order: known ? known.i : moduleId ? modules.length : -1 };
      subgroups.set(subKey, sub);
      g.modules.push(sub);
    }
    const fingerprint = diagnosticFingerprint(d);
    const isSeen = seen.has(fingerprint);
    sub.items.push({ diagnostic: d, fingerprint, text: stripModulePrefix(d.message, sub.name), seen: isSeen });
    g.counts[d.level]++;
    if (!isSeen) g.unseen[d.level]++;
    g.total++;
  });

  const rank = (it: DiagnosticItem) => (it.seen ? 3 : 0) + LEVEL_RANK[it.diagnostic.level];
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _o, ...g }) => ({
      ...g,
      modules: (g.modules as (ModuleSubgroup & { order: number })[])
        .sort((a, b) => a.order - b.order)
        .map(({ order: _so, ...s }) => ({ ...s, items: s.items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map((x) => x.it) })),
    }));
}

export interface DiagnosticFilter {
  /** Gravedades ocultas. */
  hiddenLevels: readonly DiagnosticLevel[];
  hideSeen: boolean;
}

/** Aplica el filtro: quita avisos, subgrupos y grupos vacíos. Los contadores del grupo cuentan lo que queda. */
export function filterGroups(groups: readonly DiagnosticGroup[], filter: DiagnosticFilter): DiagnosticGroup[] {
  if (filter.hiddenLevels.length === 0 && !filter.hideSeen) return [...groups];
  const keep = (it: DiagnosticItem) => !filter.hiddenLevels.includes(it.diagnostic.level) && !(filter.hideSeen && it.seen);
  const out: DiagnosticGroup[] = [];
  for (const g of groups) {
    const modules = g.modules.map((s) => ({ ...s, items: s.items.filter(keep) })).filter((s) => s.items.length > 0);
    if (modules.length === 0) continue;
    const counts = emptyCounts();
    const unseen = emptyCounts();
    let total = 0;
    for (const s of modules)
      for (const it of s.items) {
        counts[it.diagnostic.level]++;
        if (!it.seen) unseen[it.diagnostic.level]++;
        total++;
      }
    out.push({ ...g, modules, counts, unseen, total });
  }
  return out;
}

/** Cuenta de avisos por gravedad (para las fichas de filtro). */
export function countByLevel(diagnostics: readonly Diagnostic[]): LevelCounts {
  const c = emptyCounts();
  for (const d of diagnostics) c[d.level]++;
  return c;
}

/** Avisos no vistos (insignia del panel). */
export function countUnseen(diagnostics: readonly Diagnostic[], seen: readonly string[] | undefined): number {
  if (!seen || seen.length === 0) return diagnostics.length;
  const set = new Set(seen);
  let n = 0;
  for (const d of diagnostics) if (!set.has(diagnosticFingerprint(d))) n++;
  return n;
}

/** Grupos plegados por defecto: con más de `COLLAPSE_THRESHOLD` avisos, los que no tienen errores. */
export function defaultCollapsed(groups: readonly DiagnosticGroup[]): Set<string> {
  const total = groups.reduce((n, g) => n + g.total, 0);
  if (total <= COLLAPSE_THRESHOLD) return new Set();
  return new Set(groups.filter((g) => g.counts.error === 0).map((g) => g.id));
}
