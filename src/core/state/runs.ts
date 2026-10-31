import { validateAcquisition } from "../inputs/acquisition";
import {
  enableProjectInputRevisions,
  reviseProjectInputs,
} from "./inputRevisions";
import { setDepthShift, removeDepthShift } from "./preparation";
import type { Project } from "./project";
import type { DepthShift } from "../preparation/state";

/** La pertenencia es observada y explícita: nunca se infiere del mnemónico. */
export function registerRun(
  project: Project,
  wellId: string,
  id: string,
  curveIds: string[],
): Project {
  const next = enableProjectInputRevisions(project),
    entry = next.wells.find((e) => e.well.id === wellId);
  if (
    !entry ||
    !id.trim() ||
    !curveIds.length ||
    new Set(curveIds).size !== curveIds.length
  )
    throw new Error("Indicá corrida y curvas únicas.");
  const acquisition = next.inputRevisions![entry.inputRevisionId!]!.acquisition;
  if (acquisition.runs.some((r) => r.id === id))
    throw new Error("La corrida ya está registrada.");
  const updated = {
    ...acquisition,
    runs: [
      ...acquisition.runs,
      {
        id,
        curveIds: [...curveIds],
        tool: { catalogId: null, vendor: null, model: null },
        corrections: { status: "unknown" as const, effects: [] },
        mud: {
          salinityPpmNaClEquivalent: null,
          resistivityOhmM: null,
          temperatureC: null,
        },
      },
    ],
  };
  validateAcquisition(updated, entry.well);
  return reviseProjectInputs(next, wellId, { acquisition: updated });
}

/** Construye el lote completo antes de publicarlo; una curva inválida rechaza toda la corrida. */
export function setRunDepthShift(
  project: Project,
  wellId: string,
  runId: string,
  shift: DepthShift,
  nodeId: (curveId: string) => string,
): Project {
  const entry = project.wells.find((e) => e.well.id === wellId);
  const run = project.inputRevisions?.[
    entry?.inputRevisionId ?? ""
  ]?.acquisition.runs.find((r) => r.id === runId);
  if (!run?.curveIds.length)
    throw new Error("Elegí una corrida registrada con curvas.");
  const roles = new Set<string>();
  for (const id of run.curveIds) {
    const role = entry!.well.curves.find((c) => c.id === id)?.role;
    if (role && roles.has(role))
      throw new Error(
        "La corrida tiene fuentes alternativas del mismo rol. Resolvé la selección antes de activar el lote.",
      );
    if (role) roles.add(role);
  }
  let next = project;
  for (const id of run.curveIds)
    next = setDepthShift(next, wellId, id, shift, nodeId(id));
  return next;
}

/** Retirada del lote sin tocar filtros, máscaras o interpolación. */
export function removeRunDepthShift(
  project: Project,
  wellId: string,
  runId: string,
): Project {
  const entry = project.wells.find((e) => e.well.id === wellId);
  const run = project.inputRevisions?.[
    entry?.inputRevisionId ?? ""
  ]?.acquisition.runs.find((r) => r.id === runId);
  if (!run) throw new Error("La corrida ya no existe.");
  let next = project;
  for (const node of entry?.interpretation.preparation?.nodes ?? [])
    if (run.curveIds.includes(node.input.curveId))
      next = removeDepthShift(next, wellId, node.id);
  return next;
}
