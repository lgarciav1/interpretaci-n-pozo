import { calibrationPreviewRequest } from "../src/modules/preparation/calibrationPreview";
import {
  createInProcessClient,
  type ClientResult,
} from "../src/core/engine/client";
import {
  addMaskInterval,
  entryPreparationPlan,
} from "../src/core/state/preparation";
import { MaskEvaluator } from "../src/core/preparation/evaluate";
import { materializePreparation } from "../src/core/preparation/plan";
import { toEngineWell } from "../src/core/engine/engine";
import { expect, it } from "vitest";
import known from "./fixtures/xrd-gr-known.json";
import {
  DEFAULT_GR_POLICY,
  fitGrCalibration,
  type CalibrationPoint,
} from "../src/petro/xrdCalibration";
import { VSH_METHODS, type VshMethod } from "../src/petro/vsh";
import { registry } from "../src/modules";
import {
  grBounds,
  proposeGrCalibration,
  type GrCalibrationConfig,
  XRD_CALIBRATION_SETTING,
  readGrCalibration,
} from "../src/core/preparation/xrdCalibration";
import { createWell } from "../src/core/well";
import { createXrdSet, type XrdContract } from "../src/core/preparation/xrd";
import {
  addWell,
  createProject,
  updateInterpretation,
} from "../src/core/state/project";
import { enableProjectInputRevisions } from "../src/core/state/inputRevisions";
import { resolveDataContext } from "../src/core/preparation/projection";
import { applyGrCalibration } from "../src/core/state/xrdCalibration";
import { useProject } from "../src/app/store/project";
import {
  serializeProject,
  deserializeProject,
} from "../src/core/state/serialize";
import { createSnapshot, restoreSnapshot } from "../src/core/state/snapshots";
const bounds = grBounds(registry),
  policy = { ...DEFAULT_GR_POLICY };
const points = (method: VshMethod = "linear"): CalibrationPoint[] =>
  Array.from({ length: 18 }, (_, i) => ({
    id: "p" + i,
    depth: 10 + 10 * i,
    gr: known.gr[i % 6]!,
    target: known.targets[method][i % 6]!,
  }));
const contract: XrdContract = {
  version: 1,
  basis: "volume",
  scope: "whole-rock",
  scale: "fraction",
  closureTolerance: 0.01,
  report: "Ensayo sintético independiente en fixture Python",
  referenceId: "w",
  datum: "KB declarado",
  minerals: [
    { id: "q", name: "Q", clay: false },
    { id: "c", name: "C", clay: true },
  ],
};
function fixture(
  method: VshMethod = "linear",
  replicas = false,
  labContract = contract,
  reportedUncertainty?: number,
) {
  const pts = points(method),
    labs = replicas
      ? pts.flatMap((p) => [p, { ...p, id: p.id + "-rep" }])
      : pts;
  const w = createWell({
    id: "w",
    name: "W",
    depth: Float64Array.from(pts, (p) => p.depth),
    curves: [
      {
        id: "gr",
        mnemonic: "GR",
        role: "GR",
        unit: "gAPI",
        origin: { kind: "measured" },
        data: Float64Array.from(pts, (p) => p.gr),
      },
    ],
    pointSets: [
      createXrdSet(
        "lab",
        "QA sintético",
        "Python",
        labContract,
        labs.map((p) => ({
          id: p.id,
          top: p.depth,
          values: {
            q: { value: 1 - p.target, status: "measured" },
            c: {
              value: p.target,
              status: "measured",
              ...(reportedUncertainty === undefined
                ? {}
                : { uncertainty: reportedUncertainty }),
            },
          },
        })),
      ),
    ],
  });
  return enableProjectInputRevisions(
    addWell(createProject(), w, [
      {
        id: "z",
        name: "Z",
        top: 0,
        base: 200,
        color: "#fff",
        kind: "formation",
      },
      {
        id: "other",
        name: "Otra",
        top: 210,
        base: 300,
        color: "#000",
        kind: "formation",
      },
    ]),
  );
}
const config = (method: VshMethod = "linear"): GrCalibrationConfig => ({
  version: 1,
  method,
  zoneId: "z",
  clayClean: 0,
  clayShale: 1,
  relationship:
    "Proxy constitutivo sintético: arcillas de sólidos como variable normalizada entre extremos externos.",
  independenceDeclared: true,
  independentReference:
    "Fixture independiente Python, no derivado del Vsh calculado por la app.",
  policy: { ...policy },
});
const cmp = {
  curveId: "gr",
  target: "native" as const,
  maxGapM: 10,
  minCoverage: 1,
  shiftM: 0,
  densities: {},
};
async function propose(p = fixture(), method: VshMethod = "linear") {
  const e = p.wells[0]!,
    data = resolveDataContext(
      e.well,
      e.interpretation,
      registry,
      e.inputRevisionId!,
    );
  return proposeGrCalibration(
    data,
    e.interpretation,
    e.well.pointSets[0]!,
    cmp,
    e.inputRevisionId!,
    config(method),
    registry,
  );
}
for (const method of VSH_METHODS)
  it(`recupera extremos conocidos con ${method} y valida bloques sin reparto aleatorio`, async () => {
    const fit = await fitGrCalibration(
      points(method),
      method,
      bounds,
      policy,
      3,
    );
    expect(fit.reasons).toEqual([]);
    expect(fit.admitted).toBe(true);
    expect(fit.applied).toEqual({ clean: 30, shale: 120 });
    expect(fit.validation!.rmse).toBeLessThan(1e-10);
    expect(fit.folds).toHaveLength(3);
    expect(fit.endpointSpread.clean).toBeLessThan(1e-8);
  });
it("recalcula métricas luego de redondear, sin cambiar datos originales", async () => {
  const p = points().map((p) => ({ ...p, gr: p.gr + 0.26 })),
    fit = await fitGrCalibration(p, "linear", bounds, policy, 3);
  expect(fit.raw.clean).toBeCloseTo(30.26, 9);
  expect(fit.applied).toEqual({ clean: 30.5, shale: 120.5 });
  expect(fit.metrics.bias).toBeCloseTo(-0.24 / 90, 10);
  expect(fit.metrics.rmse).toBeCloseTo(0.24 / 90, 10);
});
it("rechaza rango estrecho, pendiente inversa, parámetros fuera de dominio y falta de validación separada", async () => {
  for (const p of [
    points().map((p) => ({ ...p, target: 0.4 + 0.2 * p.target })),
    points().map((p) => ({ ...p, gr: 150 - p.gr })),
    points().map((p) => ({ ...p, gr: -20 + 400 * p.target })),
  ])
    expect(
      (await fitGrCalibration(p, "linear", bounds, policy, 3)).admitted,
    ).toBe(false);
  expect(
    (
      await fitGrCalibration(points(), "linear", bounds, policy, 1000)
    ).reasons.join(),
  ).toMatch(/validación/);
});
it("réplicas técnicas se agrupan, no aumentan localizaciones ni peso; excluye soportes contradictorios", async () => {
  const p = fixture("linear", true),
    proposal = await propose(p);
  expect(proposal.fit.locations).toBe(18);
  expect(proposal.fit.applied).toEqual({ clean: 30, shale: 120 });
  expect(proposal.locations[0]!.ids).toHaveLength(2);
});
it("aplicación atómica por zona preserva cutoffs, fuentes y otras zonas; undo/redo y persistencia/snapshots", async () => {
  let p = updateInterpretation(fixture(), "w", (i) => ({
    ...i,
    params: {
      global: { vshCutoff: 0.4, phiCutoff: 0.1, swCutoff: 0.6 },
      zones: {
        other: { grClean: 55, grShale: 140, "vsh.method": "steiber" },
        z: { vshCutoff: 0.33 },
      },
    },
  }));
  const e = p.wells[0]!,
    proposal = await propose(p),
    q = applyGrCalibration(p, p, "w", "lab", proposal, registry),
    i = q.wells[0]!.interpretation;
  expect(i.params.global).toBe(e.interpretation.params.global);
  expect(i.params.zones.other).toBe(e.interpretation.params.zones.other);
  expect(i.sources).toBe(e.interpretation.sources);
  expect(i.params.zones.z).toEqual({
    grClean: 30,
    grShale: 120,
    "vsh.method": "linear",
    vshCutoff: 0.33,
  });
  expect(q.wells[0]!.well).toBe(e.well);
  useProject.getState().replace(p);
  useProject.getState().commit("Calibrar GR", () => q);
  useProject.getState().undo();
  expect(useProject.getState().project).toBe(p);
  useProject.getState().redo();
  expect(useProject.getState().project).toBe(q);
  const saved = createSnapshot(q, "w", "GR calibrado").project,
    opened = await deserializeProject(await serializeProject(saved));
  expect(
    readGrCalibration(
      opened.wells[0]!.interpretation.pointSets.lab!.settings![
        XRD_CALIBRATION_SETTING + ":z"
      ],
    )!.fit.applied,
  ).toEqual({ clean: 30, shale: 120 });
  const changed = updateInterpretation(opened, "w", (i) => ({
    ...i,
    pointSets: {},
  }));
  expect(
    restoreSnapshot(changed, opened.snapshots[0]!.id).wells[0]!.interpretation
      .pointSets,
  ).toEqual(i.pointSets);
  expect(() =>
    applyGrCalibration({ ...p }, p, "w", "lab", proposal, registry),
  ).toThrow(/obsoleta/);
});
it("la puerta de bloques opera también sobre pares; se rechaza source calculada o cadena inactiva y masa nativa", async () => {
  await expect(
    propose(fixture("linear", false, { ...contract, basis: "mass" })),
  ).rejects.toThrow(/masa nativa/);
  const p = fixture(),
    proposal = await propose(p);
  expect(proposal.fit.admitted).toBe(true);
  const blocked = updateInterpretation(p, "w", (i) => ({
    ...i,
    disabled: ["igr"],
  }));
  await expect(propose(blocked)).rejects.toThrow(/cadena/);
  const e = p.wells[0]!,
    data = resolveDataContext(
      e.well,
      e.interpretation,
      registry,
      e.inputRevisionId!,
    );
  await expect(
    proposeGrCalibration(
      data,
      e.interpretation,
      e.well.pointSets[0]!,
      { ...cmp, curveId: "ausente" },
      e.inputRevisionId!,
      config(),
      registry,
    ),
  ).rejects.toThrow(/cadena/);
});
it("cancelación y esquema futuro no publican parámetros ni evidencia ejecutable", async () => {
  const p = fixture(),
    e = p.wells[0]!,
    data = resolveDataContext(
      e.well,
      e.interpretation,
      registry,
      e.inputRevisionId!,
    );
  await expect(
    proposeGrCalibration(
      data,
      e.interpretation,
      e.well.pointSets[0]!,
      cmp,
      e.inputRevisionId!,
      config(),
      registry,
      async () => {
        throw new Error("cancelado");
      },
    ),
  ).rejects.toThrow("cancelado");
  expect(e.interpretation.params.global).toEqual({});
  const proposal = await propose(p);
  expect(() =>
    readGrCalibration(JSON.stringify({ ...proposal, version: 2 })),
  ).toThrow(/desconocida/);
});

it("fuente GR preparada seleccionada conserva procedencia y es calibrable tras exclusión", async () => {
  const p = addMaskInterval(
      fixture(),
      "w",
      "gr",
      { id: "r", top: 20, base: 20 },
      "mask",
    ),
    e = p.wells[0]!,
    plan = entryPreparationPlan(p, e, registry),
    artifacts = await new MaskEvaluator().evaluate(toEngineWell(e.well), plan),
    data = materializePreparation(
      e.well,
      { plan, artifacts },
      plan.context,
      registry,
    );
  const proposal = await proposeGrCalibration(
    data,
    e.interpretation,
    e.well.pointSets[0]!,
    { ...cmp, curveId: "prep:mask:masked" },
    e.inputRevisionId!,
    config(),
    registry,
  );
  expect(proposal.fit.admitted).toBe(true);
  expect(proposal.fit.applied).toEqual({ clean: 30, shale: 120 });
  expect(proposal.exclusions.length).toBeGreaterThan(0);
});
it("datos demasiado próximos o réplicas contradictorias no hacen pasar la puerta de independencia", async () => {
  const p = points().map((p, i) => ({ ...p, depth: i * 0.01 }));
  expect(
    (await fitGrCalibration(p, "linear", bounds, policy, 10)).admitted,
  ).toBe(false);
  const q = fixture("linear", true),
    e = q.wells[0]!;
  const lab = e.well.pointSets[0]!;
  const column = lab.columns["mineral:c"]!.values as Float64Array;
  const quartz = lab.columns["mineral:q"]!.values as Float64Array;
  column[1] = 0.95;
  quartz[1] = 0.05;
  const proposal = await propose(q);
  expect(proposal.fit.locations).toBe(17);
  expect(proposal.exclusions.map((e) => e.reason).join()).toMatch(
    /contradictorios/,
  );
});
it("incertidumbres declaradas grandes bloquean o excluyen, y las fuentes calculadas no se confunden con GR medido", async () => {
  await expect(
    propose(
      fixture(
        "linear",
        false,
        {
          ...contract,
          uncertaintyNote:
            "Incertidumbre absoluta sintética, sin cobertura estadística",
        },
        0.2,
      ),
    ),
  ).rejects.toThrow(/localizaciones/);
  const p = fixture(),
    e = p.wells[0]!,
    lab = e.well.pointSets[0]!;
  const computed = {
    ...e.well,
    curves: e.well.curves.map((c) => ({
      ...c,
      origin: { kind: "computed" as const, moduleId: "inventado", port: "GR" },
    })),
  };
  const data = resolveDataContext(
    computed,
    e.interpretation,
    registry,
    e.inputRevisionId!,
  );
  await expect(
    proposeGrCalibration(
      data,
      e.interpretation,
      lab,
      cmp,
      e.inputRevisionId!,
      config(),
      registry,
    ),
  ).rejects.toThrow(/calculadas/);
  const invalid = config();
  invalid.clayClean = 0.5;
  invalid.clayShale = 0.5;
  const real = resolveDataContext(
    e.well,
    e.interpretation,
    registry,
    e.inputRevisionId!,
  );
  await expect(
    proposeGrCalibration(
      real,
      e.interpretation,
      lab,
      cmp,
      e.inputRevisionId!,
      invalid,
      registry,
    ),
  ).rejects.toThrow(/Declará/);
});

it("admisión conserva y comprueba incertidumbre relativa de densidades en la conversión masa/volumen", async () => {
  const p = fixture("linear", false, { ...contract, basis: "mass" }),
    e = p.wells[0]!,
    data = resolveDataContext(
      e.well,
      e.interpretation,
      registry,
      e.inputRevisionId!,
    );
  const proposal = await proposeGrCalibration(
    data,
    e.interpretation,
    e.well.pointSets[0]!,
    {
      ...cmp,
      target: "solid-volume",
      densities: {
        q: { value: 3, reference: "QA sintético Q" },
        c: { value: 2, reference: "QA sintético C", uncertainty: 0.5 },
      },
    },
    e.inputRevisionId!,
    config(),
    registry,
  );
  expect(proposal.fit.admitted).toBe(false);
  expect(proposal.fit.reasons.join()).toMatch(/relativa de densidad/);
});

it("un GR casi constante con extremos de laboratorio no se vuelve identificable por bajo RMSE agregado", async () => {
  const pts = Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    depth: i * 10,
    gr: 100 + ((i % 7) - 3) * 1e-6,
    target: i % 20 === 0 ? 0.05 : i % 20 === 1 ? 0.95 : 0.5,
  }));
  const fit = await fitGrCalibration(pts, "clavier", bounds, policy, 3);
  expect(fit.admitted).toBe(false);
  expect(fit.reasons.join()).toMatch(/Rango de GR/);
});

it("preview identidad y preparado usan el protocolo real sin enviar planes vacíos ni publicar en el motor principal", async () => {
  const original = fixture(),
    proposal = await propose(original),
    draft = applyGrCalibration(
      original,
      original,
      "w",
      "lab",
      proposal,
      registry,
    );
  for (const p of [
    draft,
    addMaskInterval(draft, "w", "gr", { id: "r", top: 20, base: 20 }, "mask"),
  ]) {
    const request = calibrationPreviewRequest(p, "w", registry);
    expect(!!request.preparation).toBe(
      !!p.wells[0]!.interpretation.preparation?.nodes.length,
    );
    const client = createInProcessClient(registry);
    try {
      client.syncWell(request.engineWell, request.context);
      const ready = new Promise<ClientResult>((resolve, reject) => {
        const off = client.subscribe((e) => {
          if (e.type === "result") {
            off();
            resolve(e.result);
          }
          if (e.type === "error") {
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
      const result = await ready;
      expect(result.context).toEqual(request.context);
      expect(result.nodes.find((n) => n.moduleId === "vsh")!.status).toBe("ok");
      expect(
        result.outputs.find((o) => o.port === "VSH")!.value,
      ).toBeInstanceOf(Float64Array);
    } finally {
      client.dispose();
    }
  }
  expect(original.wells[0]!.interpretation.params.global).toEqual({});
});
