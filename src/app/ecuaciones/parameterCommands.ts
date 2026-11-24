import { paramScope, paramStorageKey, type ParamSpec } from '../../core/params';
import type { AnyModule } from '../../core/module';
import { registry } from '../../modules';
import type { Command } from '../../ui';
import { openModuleInspector } from '../shell/moduleNavigation';
import { selectActiveEntry, useProject } from '../store/project';
import { useUi } from '../store/ui';
import { openEquations } from './open';

function showParameter(module: AnyModule, storage: string, spec: ParamSpec): void {
  if (!selectActiveEntry(useProject.getState())) {
    openEquations(module.id);
    return;
  }
  openModuleInspector(module, paramScope(spec) === 'global');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (useUi.getState().activeModuleId !== module.id) return;
    const panel = document.querySelector(`[data-module-panel="${CSS.escape(module.id)}"]`);
    // Algunos módulos muestran controles distintos según el método vigente.
    const target = panel?.querySelector<HTMLElement>(`[name="${CSS.escape(storage)}"]:not(:disabled)`)
      ?? panel?.querySelector<HTMLElement>('.module-panel__name');
    target?.scrollIntoView({ block: 'center', inline: 'nearest' });
    target?.focus({ preventScroll: true });
  }));
}

export const parameterCommands: readonly Command[] = registry.modules.flatMap((module) =>
  Object.entries(module.params).map(([key, spec]): Command => {
    const storage = paramStorageKey(module.id, key, spec);
    return {
      id: `param:${module.id}:${key}`,
      title: `${module.name} · ${spec.label}`,
      group: 'Parámetros',
      keywords: [key, storage, module.id, registry.categoryLabel(module.category)],
      icon: 'sliders',
      searchOnly: true,
      run: () => showParameter(module, storage, spec),
    };
  }),
);
