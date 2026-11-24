import { moduleWorkspaces, type AnyModule } from '../../core/module';
import { FLOWS, stepsOfModule } from '../flow/flow';
import { toFlowModule } from '../flow/useFlow';
import { useUi } from '../store/ui';
import { FREE_MODULE_VIEW } from './freeModuleView';

export function openModuleInspector(module: AnyModule, editGlobal = false): void {
  const ui = useUi.getState();
  const workspaces = moduleWorkspaces(module);
  const workspace = workspaces.includes(ui.workspace) ? ui.workspace : workspaces[0] ?? ui.workspace;
  const [step] = stepsOfModule(FLOWS[workspace], toFlowModule(module));
  if (ui.layout.rightCollapsed) ui.setLayout({ rightCollapsed: false });
  ui.set({
    workspace,
    activeModuleId: module.id,
    activeStepId: step?.id ?? FREE_MODULE_VIEW,
    ...(editGlobal ? { editingZoneId: null } : {}),
  });
}
