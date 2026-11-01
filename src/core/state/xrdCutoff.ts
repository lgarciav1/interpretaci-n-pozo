import type { ClientResult } from "../engine/client";
import { engineDecisionKey, sameContext } from "../engine/context";
import {
  cutoffImpact,
  readXrdCutoff,
  validateCutoffStep,
  XRD_CUTOFF_SETTING,
  type XrdCutoffProposal,
} from "../preparation/xrdCutoff";
import type { Registry } from "../registry";
import { xrdContract } from "../preparation/xrd";
import { setPointSetSetting } from "./pointSets";
import { entryPreparationPlan } from "./preparation";
import { setParam, type Project } from "./project";

/** El mismo borrador se usa en preview y aceptación; solo cambia el cutoff zonal. */
export function previewXrdCutoff(
  project: Project,
  expected: Project,
  wellId: string,
  setId: string,
  proposal: XrdCutoffProposal,
  registry: Registry,
): Project {
  if (project !== expected)
    throw new Error("Propuesta de cutoff obsoleta: cambió el proyecto.");
  readXrdCutoff(JSON.stringify(proposal));
  validateCutoffStep(proposal.config.cutoff, registry);
  const entry = project.wells.find((e) => e.well.id === wellId);
  const set = entry?.well.pointSets.find((s) => s.id === setId);
  if (
    !entry ||
    set?.kind !== "xrd" ||
    setId !== proposal.setId ||
    entry.inputRevisionId !== proposal.comparison.evidence.inputRevisionId ||
    !entry.interpretation.zones.some((z) => z.id === proposal.config.zoneId) ||
    engineDecisionKey(entry.interpretation) !== proposal.decisionKey ||
    set.pointIds.length !== proposal.rows.length ||
    set.pointIds.some((id, index) => id !== proposal.rows[index]?.id)
  )
    throw new Error("Datos, zona o parámetros de cutoff obsoletos.");
  const contract = xrdContract(set),
    knownDatum =
      project.inputRevisions?.[entry.inputRevisionId!]?.acquisition.depth.datum;
  if (
    contract.referenceId !== wellId ||
    (knownDatum && knownDatum !== contract.datum)
  )
    throw new Error("Referencia MD/datum del laboratorio incompatible.");
  return setParam(
    project,
    wellId,
    "vshCutoff",
    proposal.config.cutoff,
    proposal.config.zoneId,
  );
}
/** Una sola receta: umbral + justificación + pares + impacto exacto, validando ambos contextos. */
export function applyXrdCutoff(
  project: Project,
  expected: Project,
  wellId: string,
  setId: string,
  proposal: XrdCutoffProposal,
  baseline: ClientResult,
  preview: ClientResult,
  registry: Registry,
): Project {
  const next = previewXrdCutoff(
    project,
    expected,
    wellId,
    setId,
    proposal,
    registry,
  );
  const entry = project.wells.find((e) => e.well.id === wellId)!,
    draft = next.wells.find((e) => e.well.id === wellId)!;
  if (
    !sameContext(
      baseline.context,
      entryPreparationPlan(project, entry, registry).context,
    ) ||
    !sameContext(
      preview.context,
      entryPreparationPlan(next, draft, registry).context,
    )
  )
    throw new Error(
      "El impacto pertenece a otro contexto; volvé a evaluar el cutoff.",
    );
  const record: XrdCutoffProposal = {
    ...proposal,
    impact: {
      before: cutoffImpact(baseline, proposal.config.zoneId),
      after: cutoffImpact(preview, proposal.config.zoneId),
    },
  };
  readXrdCutoff(JSON.stringify(record));
  return setPointSetSetting(
    next,
    wellId,
    setId,
    XRD_CUTOFF_SETTING + ":" + proposal.config.zoneId,
    JSON.stringify(record),
  );
}
