import {
  readXrdRecord,
  XRD_COMPARISON_SETTING,
  type XrdComparisonRecord,
} from "../preparation/xrdEvidence";
import { setPointSetSetting } from "./pointSets";
import type { Project } from "./project";

/** El preview ya evaluado solo se acepta sobre el mismo Project; una entrada de historial. */
export function acceptXrdComparison(
  project: Project,
  expected: Project,
  wellId: string,
  setId: string,
  record: XrdComparisonRecord,
): Project {
  if (project !== expected)
    throw new Error(
      "Cambió el proyecto. Volvé a comparar antes de guardar evidencia.",
    );
  readXrdRecord(JSON.stringify(record));
  const entry = project.wells.find((e) => e.well.id === wellId),
    set = entry?.well.pointSets.find((s) => s.id === setId);
  if (
    !entry ||
    set?.kind !== "xrd" ||
    entry.inputRevisionId !== record.evidence.inputRevisionId
  )
    throw new Error("La evidencia pertenece a otras entradas.");
  return setPointSetSetting(
    project,
    wellId,
    setId,
    XRD_COMPARISON_SETTING,
    JSON.stringify(record),
  );
}
