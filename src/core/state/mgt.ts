import type { Project } from "./project";
import { updateInterpretation } from "./project";
import { validateMgtInputs, type MgtConfig } from "../preparation/mgt";
import { mgtGamma } from "../../petro/mgt";
import { preparationState, validatePreparation } from "../preparation/state";
import { preparedCurveId } from "../preparation/source";
import { restoreMaskInterval } from "./preparation";
/** Preview y aplicación usan esta misma receta, fijada al proyecto y adquisición. */
export function setMgtCorrection(
  project: Project,
  expected: Project,
  wellId: string,
  curveId: string,
  config: MgtConfig,
  nodeId: string,
): Project {
  if (project !== expected)
    throw new Error("Propuesta MGT obsoleta: cambió el proyecto.");
  const entry = project.wells.find((e) => e.well.id === wellId),
    revision = project.inputRevisions?.[entry?.inputRevisionId ?? ""];
  if (!entry || !revision)
    throw new Error("Registrá primero la adquisición MGT y su revisión.");
  const { gr, caliper, toInches } = validateMgtInputs(
    entry.well,
    revision.acquisition,
    curveId,
    config,
  );
  const existing = entry.interpretation.preparation?.nodes.find(
    (n) => n.input.curveId === curveId,
  );
  if (existing && existing.kind !== "mgt-borehole")
    throw new Error(
      "Retirá la preparación previa de GR antes de MGT v1; no se descarta ni se combina implícitamente.",
    );
  if (
    entry.interpretation.preparation?.nodes.some(
      (n) => n.enabled && n.input.curveId === caliper.id,
    )
  )
    throw new Error(
      "MGT v1 necesita caliper original sin etapas preparadas activas.",
    );
  let valid = false;
  for (let k = 0; k < gr.data.length; k++)
    if (
      Number.isFinite(
        mgtGamma(gr.data[k]!, caliper.data[k]! * toInches, config.position),
      )
    ) {
      valid = true;
      break;
    }
  if (!valid)
    throw new Error(
      "Sin muestras MGT dentro del dominio; no se aplica una fuente vacía.",
    );
  const active = entry.interpretation.sources.GR;
  if (
    existing?.kind === "mgt-borehole" &&
    existing.enabled &&
    existing.input.inputRevisionId === entry.inputRevisionId &&
    JSON.stringify(existing.mgt) === JSON.stringify(config) &&
    active?.kind === "curve" &&
    active.curveId === preparedCurveId(existing.id, "masked")
  )
    return project;
  const node = {
    id: existing?.id ?? nodeId,
    kind: "mgt-borehole" as const,
    methodVersion: 1 as const,
    enabled: true,
    input: {
      kind: "original" as const,
      inputRevisionId: entry.inputRevisionId!,
      curveId,
    },
    intervals: [],
    mgt: { ...config },
  };
  const nodes = entry.interpretation.preparation?.nodes ?? [];
  const preparation = preparationState(
    existing
      ? nodes.map((n) => (n.id === existing.id ? node : n))
      : [...nodes, node],
  );
  validatePreparation(preparation);
  return updateInterpretation(project, wellId, (i) => ({
    ...i,
    preparation,
    sources: {
      ...i.sources,
      GR: { kind: "curve", curveId: preparedCurveId(node.id, "masked") },
    },
  }));
}
export function removeMgtCorrection(
  project: Project,
  wellId: string,
  nodeId: string,
): Project {
  const node = project.wells
    .find((e) => e.well.id === wellId)
    ?.interpretation.preparation?.nodes.find((n) => n.id === nodeId);
  return node?.kind === "mgt-borehole"
    ? restoreMaskInterval(project, wellId, nodeId)
    : project;
}
export function enableMgtCorrection(
  project: Project,
  wellId: string,
  nodeId: string,
  enabled: boolean,
): Project {
  const entry = project.wells.find((e) => e.well.id === wellId),
    node = entry?.interpretation.preparation?.nodes.find(
      (n) => n.id === nodeId,
    );
  if (!entry || node?.kind !== "mgt-borehole" || node.enabled === enabled)
    return project;
  if (enabled)
    return setMgtCorrection(
      project,
      project,
      wellId,
      node.input.curveId,
      node.mgt,
      node.id,
    );
  return updateInterpretation(project, wellId, (i) => ({
    ...i,
    preparation: preparationState(
      i.preparation!.nodes.map((n) =>
        n.id === nodeId ? { ...n, enabled: false } : n,
      ),
    ),
    sources: {
      ...i.sources,
      GR: { kind: "curve", curveId: node.input.curveId },
    },
  }));
}
