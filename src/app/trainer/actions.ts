import { addWell, makeId, setActiveWell } from '../../core/state/project';
import { generateTrainerWell, type TrainerRecipe } from '../../petro/trainer';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

export function startTrainer(recipe: TrainerRecipe): void {
  const { well, zones } = generateTrainerWell(recipe);
  const original = { ...well, id: makeId(well.id) };
  useProject.getState().commit('Iniciar ejercicio', (project) => {
    const added = addWell(project, original, zones);
    return setActiveWell({
      ...added,
      wells: added.wells.map(entry => entry.well.id === original.id ? { ...entry, trainerRecipe: recipe } : entry),
    }, original.id);
  });
  useUi.getState().set({ workspace: 'petrophysics', activeStepId: null, activeModuleId: null, editingZoneId: null });
}
