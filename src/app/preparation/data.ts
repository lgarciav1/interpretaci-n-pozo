/** Único adaptador de los originales del proyecto a la proyección publicada completa. */
import type { ClientResult } from '../../core/engine/client';
import { contextMatchesWell, type EngineContext } from '../../core/engine/context';
import { materializePreparation } from '../../core/preparation/plan';
import type { DataContext } from '../../core/preparation/projection';
import { entryPreparationPlan } from '../../core/state/preparation';
import type { Project, WellEntry } from '../../core/state/project';
import type { Well } from '../../core/well';
import { registry } from '../../modules';
import { useProject } from '../store/project';

const cache = new WeakMap<ClientResult, WeakMap<Well, DataContext>>();
export function preparedData(well: Well, result: ClientResult): DataContext | null {
  if (!result.preparation) return null;
  let wells = cache.get(result);
  if (!wells) { wells = new WeakMap(); cache.set(result, wells); }
  let data = wells.get(well);
  if (!data) { data = materializePreparation(well, result.preparation, result.context, registry); wells.set(well, data); }
  return data;
}
export function effectiveWell(well: Well, result: ClientResult | null): Well {
  if (!result?.preparation || contextMatchesWell(result.context, { id: well.id, depth: well.depth.values, curves: well.curves })) return well;
  try { return preparedData(well, result)?.well ?? well; } catch { return well; }
}
export function entryContext(entry: WellEntry, project: Project = useProject.getState().project): EngineContext | undefined {
  try { return entryPreparationPlan(project, entry, registry).context; } catch { return undefined; }
}
