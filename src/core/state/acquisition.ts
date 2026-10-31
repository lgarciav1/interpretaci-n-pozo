import type { AcquisitionRun } from "../inputs/acquisition";
import { validateAcquisition } from "../inputs/acquisition";
import type { ToolCatalog } from "../tools";
import { reviseProjectInputs } from "./inputRevisions";
import type { Project } from "./project";

/** Edita declaraciones de una corrida existente en una nueva revisión. Nunca toca medidas/fuentes/recetas. */
export function updateRunAcquisition(
  project: Project,
  expected: Project,
  wellId: string,
  runId: string,
  declaration: Pick<AcquisitionRun, "tool" | "corrections">,
  tools: ToolCatalog,
  datum?: string | null,
): Project {
  if (project !== expected)
    throw new Error(
      "Cambió el proyecto; recargá la declaración antes de guardar.",
    );
  const entry = project.wells.find((e) => e.well.id === wellId),
    revision = project.inputRevisions?.[entry?.inputRevisionId ?? ""];
  const run = revision?.acquisition.runs.find((r) => r.id === runId);
  if (!entry || !revision || !run)
    throw new Error("La corrida de adquisición ya no existe.");
  if (
    declaration.tool.catalogId !== run.tool.catalogId &&
    declaration.tool.catalogId !== null &&
    !tools.has(declaration.tool.catalogId)
  )
    throw new Error("Herramienta fuera del catálogo.");
  const nextDatum =
    datum === undefined
      ? revision.acquisition.depth.datum
      : datum === null
        ? null
        : datum.trim();
  if (
    nextDatum !== revision.acquisition.depth.datum &&
    nextDatum !== null &&
    (!nextDatum || nextDatum.length > 128)
  )
    throw new Error(
      "El datum MD requiere entre 1 y 128 caracteres; no convierte profundidades.",
    );
  const next = {
    ...revision.acquisition,
    depth:
      nextDatum === revision.acquisition.depth.datum
        ? revision.acquisition.depth
        : { ...revision.acquisition.depth, datum: nextDatum },
    runs: revision.acquisition.runs.map((r) =>
      r.id === runId
        ? { ...r, tool: declaration.tool, corrections: declaration.corrections }
        : r,
    ),
  };
  validateAcquisition(next, entry.well);
  const effects = new Set<string>();
  for (const e of declaration.corrections.effects) {
    if (effects.has(e.effect))
      throw new Error(
        "No dupliques un efecto aplicado; reuní sus referencias en una declaración.",
      );
    effects.add(e.effect);
  }
  return reviseProjectInputs(project, wellId, { acquisition: next });
}
