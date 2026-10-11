/** Conecta el flujo guiado (puro) con los stores: pozo activo, resultados del motor, módulos y marcas. */
import { useMemo } from 'react';
import type { ClientResult } from '../../core/engine/client';
import { moduleWorkspaces, portOf, type AnyModule } from '../../core/module';
import { setStepMark, type StepMark } from '../../core/state/project';
import type { WorkspaceId } from '../../core/workspaces';
import { registry } from '../../modules';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { evaluateFlow, FLOWS, suggestedStep, type FlowModule, type StepState } from './flow';

export function toFlowModule(m: AnyModule): FlowModule {
  return { id: m.id, category: m.category, outputPorts: Object.values(m.outputs).map(portOf) };
}

export function workspaceModules(workspace: WorkspaceId): AnyModule[] {
  return registry.modules.filter((m) => moduleWorkspaces(m).includes(workspace));
}

/** Puertos disponibles: salidas activas de módulos sin error, o curvas medidas elegidas como fuente. */
export function producedPorts(result: ClientResult | null): Set<string> {
  const ports = new Set<string>();
  if (!result) return ports;
  const ok = new Set(result.nodes.filter((n) => n.status === 'ok').map((n) => n.moduleId));
  for (const o of result.outputs) if (o.active && ok.has(o.moduleId)) ports.add(o.port);
  for (const [port, src] of Object.entries(result.sources)) if (src.kind === 'curve') ports.add(port);
  return ports;
}

export interface FlowView {
  states: StepState[];
  /** Paso abierto en el inspector (el elegido o, si no, el sugerido; el primero si no queda ninguno). */
  active: StepState;
  suggested: StepState | null;
}

/** Estado de todos los pasos del espacio de trabajo y el que está abierto (puro respecto de sus argumentos). */
export function computeFlow(workspace: WorkspaceId, activeStepId: string | null, entry: ReturnType<typeof selectActiveEntry>, result: ClientResult | null): FlowView {
  const modules = workspaceModules(workspace).map(toFlowModule);
  const states = evaluateFlow(FLOWS[workspace], {
    hasWell: !!entry,
    zoneCount: entry?.interpretation.zones.length ?? 0,
    modules,
    producedPorts: producedPorts(result),
    okModules: new Set(result?.nodes.filter((n) => n.status === 'ok').map((n) => n.moduleId) ?? []),
    marks: entry?.progress.marks ?? {},
  });
  const suggested = suggestedStep(states);
  // Elegido → sugerido → primero sin completar (p. ej. un paso sin módulos) → el primero.
  const active = states.find((s) => s.def.id === activeStepId) ?? suggested ?? states.find((s) => s.status !== 'done') ?? states[0]!;
  return { states, active, suggested };
}

/** El flujo con los stores de ahora (para acciones fuera de React: la paleta de comandos). */
export function currentFlow(): FlowView {
  const ui = useUi.getState();
  return computeFlow(ui.workspace, ui.activeStepId, selectActiveEntry(useProject.getState()), useResults.getState().result);
}

export function useFlow(): FlowView {
  const workspace = useUi((s) => s.workspace);
  const activeStepId = useUi((s) => s.activeStepId);
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  return useMemo(() => computeFlow(workspace, activeStepId, entry, result), [workspace, activeStepId, entry, result]);
}

/** Marca (o desmarca) un paso del pozo activo. */
export function markStep(stepId: string, mark: StepMark | null): void {
  const { project, commit } = useProject.getState();
  const wellId = project.activeWellId;
  if (!wellId) return;
  commit(mark === 'done' ? 'Marcar paso completo' : mark === 'skipped' ? 'Saltar paso' : 'Reabrir paso', (p) => setStepMark(p, wellId, stepId, mark));
}

/** Abre un paso en el inspector y, si tiene módulos, el primero (o el ya activo si pertenece al paso). */
export function openStep(state: StepState): void {
  const ui = useUi.getState();
  const keep = ui.activeModuleId && state.modules.includes(ui.activeModuleId);
  ui.set({ activeStepId: state.def.id, ...(state.modules.length > 0 && !keep ? { activeModuleId: state.modules[0]! } : {}) });
}
