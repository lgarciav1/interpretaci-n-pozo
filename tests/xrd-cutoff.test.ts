import { expect, it } from "vitest";
import {
  cutoffFixture,
  cutoffContract,
  cutoffConfig,
  cutoffComparison,
} from "./fixtures/xrd-cutoff";
import {
  proposeXrdCutoff,
  readXrdCutoff,
  cutoffImpact,
  XRD_CUTOFF_SETTING,
} from "../src/core/preparation/xrdCutoff";
import { previewXrdCutoff, applyXrdCutoff } from "../src/core/state/xrdCutoff";
import { registry } from "../src/modules";
import { calibrationPreviewRequest } from "../src/modules/preparation/calibrationPreview";
import {
  createInProcessClient,
  type ClientResult,
} from "../src/core/engine/client";
import { resolveDataContext } from "../src/core/preparation/projection";
import { materializePreparation } from "../src/core/preparation/plan";
import {
  setParam,
  updateInterpretation,
  type Project,
} from "../src/core/state/project";
import { addMaskInterval } from "../src/core/state/preparation";
import { setPointSetSetting } from "../src/core/state/pointSets";
import { useProject } from "../src/app/store/project";
import {
  serializeProject,
  deserializeProject,
} from "../src/core/state/serialize";
import { createSnapshot, restoreSnapshot } from "../src/core/state/snapshots";
async function run(p: Project) {
  const request = calibrationPreviewRequest(p, "w", registry),
    client = createInProcessClient(registry);
  try {
    client.syncWell(request.engineWell, request.context);
    const ready = new Promise<ClientResult>((resolve, reject) => {
      const off = client.subscribe((e) => {
        if (e.type === "result") {
          off();
          resolve(e.result);
        }
        if (e.type === "error" || e.type === "protocol-error") {
          off();
          reject(new Error(e.message));
        }
      });
    });
    client.run(
      request.entry.interpretation,
      request.context,
      request.preparation,
    );
    return await ready;
  } finally {
    client.dispose();
  }
}
async function propose(p = cutoffFixture(), config = cutoffConfig) {
  const e = p.wells[0]!,
    result = await run(p);
  const data = result.preparation
    ? materializePreparation(
        e.well,
        result.preparation,
        result.context,
        registry,
      )
    : resolveDataContext(
        e.well,
        e.interpretation,
        registry,
        e.inputRevisionId!,
      );
  const proposal = await proposeXrdCutoff(
    data,
    e.interpretation,
    e.well.pointSets[0]!,
    cutoffComparison,
    e.inputRevisionId!,
    config,
    result,
    registry,
  );
  return { result, data, proposal };
}
it("contrasta un cutoff inclusivo con Vsh activo, preserva réplicas y excluye censura, huecos, máscaras y fronteras", async () => {
  const { proposal } = await propose();
  const valid = proposal.rows.filter((r) => !r.reason);
  expect(valid.map((r) => r.id)).toEqual([
    "S1",
    "INTERVALO",
    "S2",
    "S2-rep",
    "S3",
  ]);
  expect(valid.filter((r) => r.labProxy! <= 0.5).map((r) => r.id)).toEqual([
    "S1",
    "INTERVALO",
    "S2",
  ]);
  expect(valid.filter((r) => r.vsh! <= 0.5)).toHaveLength(4);
  expect(proposal.rows.filter((r) => r.reason)).toHaveLength(5);
  expect(proposal.rows.find((r) => r.id === "INTERVALO")).toMatchObject({
    vsh: 0.5,
    coverage: 1,
  });
  expect(proposal.source).toBe("curve:vsh");
  expect(readXrdCutoff(JSON.stringify(proposal))).toEqual(proposal);
});
it("calcula el impacto con sensibilidad existente y aplica solo el cutoff zonal con una entrada de historial", async () => {
  const p = cutoffFixture(),
    { proposal, result } = await propose(p),
    draft = previewXrdCutoff(p, p, "w", "lab", proposal, registry),
    preview = await run(draft);
  const before = cutoffImpact(result, "z")!,
    after = cutoffImpact(preview, "z")!;
  expect(after.netRes! - before.netRes!).toBeCloseTo(10, 12);
  expect(after.netPay! - before.netPay!).toBeCloseTo(9, 12);
  expect(after.noDataPay! - before.noDataPay!).toBeCloseTo(1, 12);
  const next = applyXrdCutoff(
      p,
      p,
      "w",
      "lab",
      proposal,
      result,
      preview,
      registry,
    ),
    i = next.wells[0]!.interpretation,
    old = p.wells[0]!.interpretation;
  expect(i.params.zones.z).toEqual({ vshCutoff: 0.5 });
  expect(i.params.global).toBe(old.params.global);
  expect(i.params.zones.other).toBe(old.params.zones.other);
  expect(i.sources).toBe(old.sources);
  expect(next.inputRevisions).toBe(p.inputRevisions);
  expect(next.wells[0]!.well).toBe(p.wells[0]!.well);
  const saved = readXrdCutoff(
    i.pointSets.lab!.settings![XRD_CUTOFF_SETTING + ":z"],
  )!;
  expect(saved.impact).toEqual({ before, after });
  expect(saved.config.justification).toBe(cutoffConfig.justification);
  useProject.getState().replace(p);
  useProject
    .getState()
    .commit("Aplicar cutoff DRX", () => next, { group: "cutoff-one" });
  expect(useProject.getState().history.past).toHaveLength(1);
  useProject.getState().undo();
  expect(useProject.getState().project).toBe(p);
  useProject.getState().redo();
  expect(useProject.getState().project).toBe(next);
});
for (const cutoff of [0.505, -1, 1.01, NaN])
  it(`rechaza cutoff fuera de rango/paso sin redondear: ${cutoff}`, async () => {
    await expect(
      propose(cutoffFixture(), { ...cutoffConfig, cutoff }),
    ).rejects.toThrow(/rango|Declará/);
  });
for (const changes of [
  { relationship: "" },
  { justification: "" },
  { reference: "" },
  { clayClean: 0.8, clayShale: 0.2 },
  { classificationDeclared: false },
])
  it(`requiere hipótesis/justificación explícitas: ${JSON.stringify(changes)}`, async () => {
    await expect(
      propose(cutoffFixture(), {
        ...cutoffConfig,
        ...changes,
      } as typeof cutoffConfig),
    ).rejects.toThrow(/Declará/);
  });
it("no equipara masa nativa ni fracción arcilla a Vsh", async () => {
  for (const contract of [
    { ...cutoffContract, basis: "mass" as const },
    {
      ...cutoffContract,
      scope: "clay-fraction" as const,
      minerals: cutoffContract.minerals.map((m) => ({ ...m, clay: true })),
    },
  ])
    await expect(propose(cutoffFixture(contract))).rejects.toThrow(
      /volumen de sólidos/,
    );
});
it("no admite zona solapada ni evaluación sin pares zonales", async () => {
  const p = updateInterpretation(cutoffFixture(), "w", (i) => ({
    ...i,
    zones: i.zones.map((z) => (z.id === "other" ? { ...z, top: 29 } : z)),
  }));
  await expect(propose(p)).rejects.toThrow(/solapamientos/);
  await expect(
    propose(cutoffFixture(), { ...cutoffConfig, zoneId: "other" }),
  ).rejects.toThrow(/Sin pares/);
});
it("rechaza resultado obsoleto y cancelación cooperativa", async () => {
  const p = cutoffFixture(),
    { data, result } = await propose(p),
    e = p.wells[0]!;
  await expect(
    proposeXrdCutoff(
      data,
      e.interpretation,
      e.well.pointSets[0]!,
      cutoffComparison,
      e.inputRevisionId!,
      cutoffConfig,
      { ...result, context: { ...result.context, engineKey: "viejo" } },
      registry,
    ),
  ).rejects.toThrow(/contexto vigente/);
  await expect(
    proposeXrdCutoff(
      data,
      e.interpretation,
      e.well.pointSets[0]!,
      cutoffComparison,
      e.inputRevisionId!,
      cutoffConfig,
      result,
      registry,
      async () => {
        throw new Error("Cancelada");
      },
    ),
  ).rejects.toThrow("Cancelada");
});
it("invalida propuesta por proyecto, parámetros, revisión, laboratorio e impacto ajeno", async () => {
  const p = cutoffFixture(),
    { proposal, result } = await propose(p),
    draft = previewXrdCutoff(p, p, "w", "lab", proposal, registry),
    preview = await run(draft);
  const changed = setParam(p, "w", "grClean", 30, "z");
  expect(() =>
    previewXrdCutoff(changed, p, "w", "lab", proposal, registry),
  ).toThrow(/obsoleta/);
  expect(() =>
    previewXrdCutoff(changed, changed, "w", "lab", proposal, registry),
  ).toThrow(/obsoletos/);
  expect(() =>
    previewXrdCutoff(p, p, "w", "otherlab", proposal, registry),
  ).toThrow(/obsoletos/);
  expect(() =>
    previewXrdCutoff(
      p,
      p,
      "w",
      "lab",
      {
        ...proposal,
        comparison: {
          ...proposal.comparison,
          evidence: {
            ...proposal.comparison.evidence,
            inputRevisionId: "input-" + "0".repeat(32),
          },
        },
      },
      registry,
    ),
  ).toThrow(/obsoletos/);
  expect(() =>
    applyXrdCutoff(p, p, "w", "lab", proposal, preview, result, registry),
  ).toThrow(/otro contexto/);
});
it("sin PHIE/Sw mantiene impacto desconocido y no fabrica ceros", async () => {
  const p = cutoffFixture(cutoffContract, false),
    { proposal, result } = await propose(p),
    draft = previewXrdCutoff(p, p, "w", "lab", proposal, registry),
    preview = await run(draft),
    next = applyXrdCutoff(
      p,
      p,
      "w",
      "lab",
      proposal,
      result,
      preview,
      registry,
    );
  expect(cutoffImpact(result, "z")).toBeNull();
  expect(
    readXrdCutoff(
      next.wells[0]!.interpretation.pointSets.lab!.settings![
        XRD_CUTOFF_SETTING + ":z"
      ],
    )!.impact,
  ).toEqual({ before: null, after: null });
});
it("admite Vsh calculado y preparado con el mismo contrato de preview", async () => {
  let p = updateInterpretation(cutoffFixture(), "w", (i) => ({
    ...i,
    sources: { ...i.sources, VSH: { kind: "module", moduleId: "vsh" } },
  }));
  let evaluation = await propose(p);
  expect(evaluation.proposal.source).toBe("module:vsh:VSH");
  expect(evaluation.proposal.rows.find((r) => r.id === "S2")!.vsh).toBeCloseTo(
    0.5,
  );
  p = addMaskInterval(p, "w", "gr", { id: "mask", top: 5, base: 5 }, "mask-gr");
  evaluation = await propose(p);
  expect(
    evaluation.proposal.rows.find((r) => r.id === "S1")!.reason,
  ).not.toBeNull();
  const draft = previewXrdCutoff(
    p,
    p,
    "w",
    "lab",
    evaluation.proposal,
    registry,
  );
  const preview = await run(draft);
  expect(() =>
    applyXrdCutoff(
      p,
      p,
      "w",
      "lab",
      evaluation.proposal,
      evaluation.result,
      preview,
      registry,
    ),
  ).not.toThrow();
});
it("guarda/abre, restaura parámetros/evidencia de snapshot y conserva versiones futuras sin ejecutarlas", async () => {
  const p = cutoffFixture(),
    { proposal, result } = await propose(p),
    draft = previewXrdCutoff(p, p, "w", "lab", proposal, registry),
    next = applyXrdCutoff(
      p,
      p,
      "w",
      "lab",
      proposal,
      result,
      await run(draft),
      registry,
    ),
    snap = createSnapshot(next, "w", "Cutoff auditado");
  const modified = setPointSetSetting(
      setParam(snap.project, "w", "vshCutoff", 0.7, "z"),
      "w",
      "lab",
      XRD_CUTOFF_SETTING + ":z",
      undefined,
    ),
    opened = await deserializeProject(await serializeProject(modified)),
    restored = restoreSnapshot(opened, snap.snapshot.id);
  expect(restored.wells[0]!.interpretation).toEqual(
    next.wells[0]!.interpretation,
  );
  const future = JSON.stringify({ ...proposal, version: 999 }),
    preserved = setPointSetSetting(
      next,
      "w",
      "lab",
      XRD_CUTOFF_SETTING + ":z",
      future,
    ),
    reopened = await deserializeProject(await serializeProject(preserved));
  expect(
    reopened.wells[0]!.interpretation.pointSets.lab!.settings![
      XRD_CUTOFF_SETTING + ":z"
    ],
  ).toBe(future);
  expect(() => readXrdCutoff(future)).toThrow(/desconocida/);
  for (const mutation of [
    { ...proposal, rows: [{ ...proposal.rows[0], coverage: 2 }] },
    {
      ...proposal,
      impact: {
        before: {
          netRes: -1,
          netPay: null,
          noDataPay: null,
          ooip: null,
          ogip: null,
        },
        after: null,
      },
    },
  ])
    expect(() => readXrdCutoff(JSON.stringify(mutation))).toThrow(
      /inválid|incompleta/,
    );
});
