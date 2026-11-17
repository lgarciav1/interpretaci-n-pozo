/** Pozo de demostración en el proyecto activo (paleta de comandos e Inicio): lo agrega o, si ya está, lo activa. */
import { addWell, setActiveWell } from '../../core/state/project';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { syntheticWell } from './syntheticWell';

import { DEMO_WELL_ID } from './ids';

export { DEMO_WELL_ID };

export function loadDemoWell(): void {
  const { project } = useProject.getState();
  if (project.wells.some((w) => w.well.id === DEMO_WELL_ID)) {
    if (project.activeWellId !== DEMO_WELL_ID) useProject.getState().commit('Cambiar de pozo', (p) => setActiveWell(p, DEMO_WELL_ID));
    return;
  }
  const demo = syntheticWell();
  useProject.getState().commit('Cargar el pozo de demostración', (p) => setActiveWell(addWell(p, demo.well, demo.zones), demo.well.id));
  useUi.getState().set({ activeStepId: null, activeModuleId: null, editingZoneId: null });
}
