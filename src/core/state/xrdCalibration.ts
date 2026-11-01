import type { Registry } from "../registry";
import {
  grBounds,
  readGrCalibration,
  XRD_CALIBRATION_SETTING,
  type GrCalibrationProposal,
} from "../preparation/xrdCalibration";
import { setParam, type Project } from "./project";
import { setPointSetSetting } from "./pointSets";
/** Preview y aplicación construyen el mismo Project; aceptar es una sola unidad de historial. */
export function applyGrCalibration(
  project: Project,
  expected: Project,
  wellId: string,
  setId: string,
  proposal: GrCalibrationProposal,
  registry: Registry,
): Project {
  if (project !== expected)
    throw new Error(
      "Propuesta obsoleta: cambió el proyecto. Recalculá antes de aplicar.",
    );
  readGrCalibration(JSON.stringify(proposal));
  const entry = project.wells.find((e) => e.well.id === wellId),
    set = entry?.well.pointSets.find((s) => s.id === setId),
    { clean, shale } = proposal.fit.applied,
    bounds = grBounds(registry);
  if (
    set?.kind !== "xrd" ||
    entry!.inputRevisionId !== proposal.comparison.evidence.inputRevisionId ||
    !entry!.interpretation.zones.some((z) => z.id === proposal.config.zoneId) ||
    clean < bounds.clean.min ||
    clean > bounds.clean.max ||
    shale < bounds.shale.min ||
    shale > bounds.shale.max ||
    Math.abs(
      (clean - bounds.clean.min) / bounds.clean.step -
        Math.round((clean - bounds.clean.min) / bounds.clean.step),
    ) > 1e-8 ||
    Math.abs(
      (shale - bounds.shale.min) / bounds.shale.step -
        Math.round((shale - bounds.shale.min) / bounds.shale.step),
    ) > 1e-8
  )
    throw new Error("Datos, zona o parámetros aplicables inválidos.");
  let next = setParam(
    project,
    wellId,
    "grClean",
    clean,
    proposal.config.zoneId,
  );
  next = setParam(next, wellId, "grShale", shale, proposal.config.zoneId);
  next = setParam(
    next,
    wellId,
    "vsh.method",
    proposal.config.method,
    proposal.config.zoneId,
  );
  return setPointSetSetting(
    next,
    wellId,
    setId,
    XRD_CALIBRATION_SETTING + ":" + proposal.config.zoneId,
    JSON.stringify(proposal),
  );
}
