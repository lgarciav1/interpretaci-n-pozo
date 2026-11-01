/** Misma frontera que snapshots: un contexto identidad no envía plan de preparación. */
import type { Project } from "../../core/state/project";
import type { Registry } from "../../core/registry";
import { entryPreparationPlan } from "../../core/state/preparation";
import { toEngineWell } from "../../core/engine/engine";
export function calibrationPreviewRequest(
  project: Project,
  wellId: string,
  registry: Registry,
) {
  const entry = project.wells.find((e) => e.well.id === wellId);
  if (!entry) throw new Error("El pozo de preview ya no existe.");
  const plan = entryPreparationPlan(project, entry, registry);
  return {
    entry,
    plan,
    engineWell: toEngineWell(entry.well),
    context: plan.context,
    preparation: entry.interpretation.preparation?.nodes.length
      ? plan
      : undefined,
  };
}
