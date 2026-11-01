import { expect, it } from "vitest";
import known from "./fixtures/mgt-known.json";
import { mgtFixture, mgtConfig } from "./fixtures/mgt";
import { mgtGamma, mgtFactor, MGT_METHOD } from "../src/petro/mgt";
import { validateMgtConfig } from "../src/core/preparation/mgt";
import {
  setMgtCorrection,
  enableMgtCorrection,
  removeMgtCorrection,
} from "../src/core/state/mgt";
import { calibrationPreviewRequest } from "../src/app/preparation/calibrationPreview";
import {
  createInProcessClient,
  type ClientResult,
} from "../src/core/engine/client";
import { registry } from "../src/modules";
import {
  MaskEvaluator,
  PreparationCancelled,
} from "../src/core/preparation/evaluate";
import {
  validatePreparedPayloads,
  materializePreparation,
} from "../src/core/preparation/plan";
import { validatePreparation } from "../src/core/preparation/state";
import {
  addMaskInterval,
  setGapFill,
  setMedianFilter,
  setDepthShift,
  entryPreparationPlan,
} from "../src/core/state/preparation";
import { reviseProjectInputs } from "../src/core/state/inputRevisions";
import { setParam, type Project } from "../src/core/state/project";
import { useProject } from "../src/app/store/project";
import {
  serializeProject,
  deserializeProject,
} from "../src/core/state/serialize";
import { createSnapshot, restoreSnapshot } from "../src/core/state/snapshots";
import {
  buildDataExport,
  exportSources,
} from "../src/app/export/exportActions";
import { buildReportModel } from "../src/app/report/report";
import { unzipSync, strFromU8 } from "fflate";
import { createWell } from "../src/core/well";
import { setToolOn } from "../src/core/state/toolString";
import { updateRunAcquisition } from "../src/core/state/acquisition";
const apply = (p = mgtFixture(), config = mgtConfig) =>
  setMgtCorrection(p, p, "w", "gr", config, "mgt");
async function run(p: Project): Promise<ClientResult> {
  const request = calibrationPreviewRequest(p, "w", registry),
    client = createInProcessClient(registry);
  try {
    client.syncWell(request.engineWell, request.context);
    const ready = new Promise<ClientResult>((resolve, reject) => {
      const off = client.subscribe((e) => {
        if (e.type === "result") {
          off();
          resolve(e.result);
        } else if (e.type === "error" || e.type === "protocol-error") {
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
for (const position of ["centered", "eccentered"] as const)
  it(`recupera cinco casos independientes Decimal del modelo MGT ${position}`, () => {
    for (const r of known.rows) {
      expect(mgtFactor(r.diameterIn, position)).toBeCloseTo(r[position], 12);
      expect(mgtGamma(100, r.diameterIn, position)).toBeCloseTo(
        position === "centered" ? r.gr100Centered : r.gr100Eccentered,
        10,
      );
    }
  });
it("guardas explícitas no extrapolan y conservan nulos/dominio GR", () => {
  for (const d of [3.375, 0, -1, 17, Infinity, NaN])
    expect(mgtFactor(d, "centered")).toBeNaN();
  expect(mgtFactor(MGT_METHOD.maxDiameterIn, "centered")).toBeGreaterThan(0);
  for (const gr of [NaN, Infinity, -1, -Infinity])
    expect(mgtGamma(gr, 8.5, "centered")).toBeNaN();
  expect(mgtGamma(0, 8.5, "centered")).toBe(0);
  expect(mgtFactor(8.5, "future" as "centered")).toBeNaN();
});
it("valida condiciones, referencias y ausencia de extrapolación ambiental", () => {
  for (const patch of [
    { maxAmbientDepthM: 5001 },
    { pressurePsi: 10001 },
    { temperatureC: 101 },
    { temperatureC: NaN },
    { environment: "oil" },
    { declared: false },
    { conditionsReference: "" },
    { uncorrectedReference: "" },
    { position: "unknown" },
  ])
    expect(() => validateMgtConfig({ ...mgtConfig, ...patch })).toThrow();
});
it("registra datum y herramienta desde adquisición desconocida sin transformar MD; datum nuevo invalida MGT activo", () => {
  let p = mgtFixture();
  const e = p.wells[0]!,
    a = structuredClone(p.inputRevisions![e.inputRevisionId!]!.acquisition);
  a.depth.datum = null;
  a.runs[0]!.tool = { catalogId: null, vendor: null, model: null };
  a.runs[0]!.corrections.status = "unknown";
  p = reviseProjectInputs(p, "w", { acquisition: a });
  const declaration = {
    tool: { catalogId: "gr", vendor: "LDEO", model: "MGT" },
    corrections: { status: "declared" as const, effects: [] },
  };
  expect(() => apply(p)).toThrow();
  const registered = updateRunAcquisition(
    p,
    p,
    "w",
    "MGT-QA",
    declaration,
    registry.tools,
    "Seafloor",
  );
  expect(registered.wells[0]!.well).toBe(p.wells[0]!.well);
  const q = apply(registered);
  expect(entryPreparationPlan(q, q.wells[0]!, registry).artifacts).toHaveLength(
    1,
  );
  expect(
    updateRunAcquisition(
      registered,
      registered,
      "w",
      "MGT-QA",
      declaration,
      registry.tools,
      "Seafloor",
    ),
  ).toBe(registered);
  expect(() =>
    updateRunAcquisition(
      p,
      p,
      "w",
      "MGT-QA",
      declaration,
      registry.tools,
      " ".repeat(5),
    ),
  ).toThrow(/datum/);
  const changed = updateRunAcquisition(
    q,
    q,
    "w",
    "MGT-QA",
    declaration,
    registry.tools,
    "Otro datum declarado",
  );
  expect(
    entryPreparationPlan(changed, changed.wells[0]!, registry).artifacts,
  ).toHaveLength(0);
});
it("solo admite MGT declarado, datum y procesado revisados; estado vacío no sustituye la referencia explícita", () => {
  const p = mgtFixture(),
    e = p.wells[0]!,
    original = p.inputRevisions![e.inputRevisionId!]!.acquisition;
  for (const change of [
    "vendor",
    "model",
    "prior",
    "unknown",
    "datum",
    "other-effect",
    "temperature",
  ]) {
    const a = structuredClone(original),
      r = a.runs[0]!;
    if (change === "vendor") r.tool.vendor = null;
    if (change === "model") r.tool.model = "HNGS";
    if (change === "unknown") r.corrections.status = "unknown";
    if (change === "datum") a.depth.datum = null;
    if (
      change === "prior" ||
      change === "other-effect" ||
      change === "temperature"
    )
      r.corrections.effects = [
        {
          effect:
            change === "prior"
              ? "borehole"
              : change === "temperature"
                ? "temperature"
                : "unknown-effect",
          method: "Proveedor",
          reference: "Informe QA de procesado",
          version: "1",
        },
      ];
    expect(() =>
      apply(reviseProjectInputs(p, "w", { acquisition: a })),
    ).toThrow();
  }
  expect(() => apply(p, { ...mgtConfig, uncorrectedReference: "" })).toThrow();
});
it("motor real publica contexto, valores y QC; cambios en Vsh sin modificar GR endpoints/cutoffs", async () => {
  const p = mgtFixture(),
    q = apply(p),
    old = await run(p),
    result = await run(q),
    payload = result.preparation!.artifacts[0]!,
    plan = result.preparation!.plan;
  expect(payload.data[0]).toBeCloseTo(known.rows[1]!.gr100Centered, 10);
  expect(payload.quality[0]).toBe(64);
  expect(payload.quality[1]).toBe(1);
  expect(Array.from(payload.quality).filter((x) => x === 64)).toHaveLength(46);
  expect(Array.from(payload.quality).filter((x) => x === 128)).toHaveLength(4);
  expect(plan.artifacts[0]!.correctionLedger[0]).toMatchObject({
    method: MGT_METHOD.id,
    version: 1,
    effect: "borehole",
    conditions: mgtConfig,
  });
  expect(plan.artifacts[0]!.provenance.ancestorToolIds).toContain("caliper");
  expect(() =>
    validatePreparedPayloads(plan, result.preparation!.artifacts, 51),
  ).not.toThrow();
  const bad = { ...payload, quality: payload.quality.slice() };
  bad.quality[0] = 0;
  expect(() => validatePreparedPayloads(plan, [bad], 51)).toThrow(
    /Calidad MGT/,
  );
  const data = materializePreparation(
    q.wells[0]!.well,
    result.preparation!,
    result.context,
    registry,
  );
  expect(data.quality.get(payload.id)).toEqual(payload.quality);
  const vsh = (r: ClientResult) =>
    r.outputs.find((o) => o.port === "VSH" && o.active)!.value as Float64Array;
  expect(vsh(result)[0]).not.toBe(vsh(old)[0]);
  expect(q.wells[0]!.interpretation.params).toBe(
    p.wells[0]!.interpretation.params,
  );
  expect(q.wells[0]!.well).toBe(p.wells[0]!.well);
  expect(q.inputRevisions).toBe(p.inputRevisions);
  const caliperOff = await run(setToolOn(q, "w", "caliper", false));
  expect(caliperOff.sources.GR).toBeUndefined();
  expect(caliperOff.nodes.find((n) => n.moduleId === "igr")!.status).not.toBe(
    "ok",
  );
});
it("caliper en cm, m y ft produce la misma corrección y calidad", async () => {
  const reference = (await run(apply())).preparation!.artifacts[0]!;
  for (const [unit, factor] of [
    ["cm", 2.54],
    ["m", 0.0254],
    ["ft", 1 / 12],
  ] as const) {
    const output = (await run(apply(mgtFixture(unit, factor)))).preparation!
      .artifacts[0]!;
    expect(output.quality).toEqual(reference.quality);
    output.data.forEach((v, i) => {
      if (Number.isNaN(v)) expect(reference.data[i]).toBeNaN();
      else expect(v).toBeCloseTo(reference.data[i]!, 10);
    });
  }
});
it("no combina limpieza/alineación o caliper preparado ni aplica dos veces el factor", async () => {
  const p = mgtFixture(),
    q = apply(p);
  const operations = [
    (curve: string) =>
      addMaskInterval(
        q,
        "w",
        curve,
        { id: "bad", top: 106, base: 106 },
        "mask",
      ),
    (curve: string) =>
      setGapFill(q, "w", curve, { top: 100, base: 120, maxGapM: 2 }, "fill"),
    (curve: string) =>
      setMedianFilter(
        q,
        "w",
        curve,
        { top: 100, base: 120, radiusM: 2, maxStepM: 1 },
        "filter",
      ),
    (curve: string) =>
      setDepthShift(
        q,
        "w",
        curve,
        {
          offsetM: 1,
          maxGapM: 2,
          referenceId: "w",
          depthKind: "MD",
          datum: "Seafloor",
        },
        "shift",
      ),
  ];
  for (const operation of operations)
    for (const curve of ["gr", "cal"])
      expect(() => operation(curve)).toThrow(/MGT/);
  expect(() =>
    apply(
      addMaskInterval(p, "w", "gr", { id: "bad", top: 106, base: 106 }, "mask"),
    ),
  ).toThrow();
  expect(() =>
    apply(
      addMaskInterval(
        p,
        "w",
        "cal",
        { id: "bad", top: 106, base: 106 },
        "mask",
      ),
    ),
  ).toThrow();
  const again = await run(apply(q));
  expect(apply(q)).toBe(q);
  expect(again.preparation!.artifacts[0]!.data[0]).toBeCloseTo(
    known.rows[1]!.gr100Centered,
    10,
  );
  expect(again.preparation!.plan.artifacts[0]!.correctionLedger).toHaveLength(
    1,
  );
});
it("invalida por proyecto, caliper o adquisición nueva y restaura revisión anterior desde snapshot", async () => {
  const p = mgtFixture(),
    q = apply(p),
    changed = setParam(q, "w", "grClean", 30, null);
  expect(() =>
    setMgtCorrection(changed, q, "w", "gr", mgtConfig, "mgt"),
  ).toThrow(/obsoleta/);
  const snap = createSnapshot(q, "w", "MGT validado"),
    e = q.wells[0]!,
    a = structuredClone(q.inputRevisions![e.inputRevisionId!]!.acquisition);
  a.runs[0]!.tool.model = "Otro modelo";
  const modified = reviseProjectInputs(snap.project, "w", { acquisition: a });
  expect(
    entryPreparationPlan(modified, modified.wells[0]!, registry).artifacts,
  ).toHaveLength(0);
  const noFallback = await run(modified);
  expect(noFallback.nodes.find((n) => n.moduleId === "igr")!.status).not.toBe(
    "ok",
  );
  const reopened = await deserializeProject(await serializeProject(modified)),
    restored = restoreSnapshot(reopened, snap.snapshot.id);
  expect(restored.wells[0]!.inputRevisionId).toBe(q.wells[0]!.inputRevisionId);
  expect((await run(restored)).preparation!.artifacts[0]!.data[0]).toBeCloseTo(
    known.rows[1]!.gr100Centered,
    10,
  );
  const well = {
    ...e.well,
    curves: e.well.curves.map((c) =>
      c.id === "cal" ? { ...c, data: c.data.map(() => 9) } : c,
    ),
  };
  const newCaliper = reviseProjectInputs(q, "w", { well });
  expect(
    entryPreparationPlan(newCaliper, newCaliper.wells[0]!, registry).artifacts,
  ).toHaveLength(0);
});
it("una aceptación revierte/repite; desactivar y retirar recuperan fuente original y archivo reproduce receta", async () => {
  const p = mgtFixture(),
    q = apply(p);
  useProject.getState().replace(p);
  useProject.getState().commit("Aplicar MGT", () => q);
  expect(useProject.getState().history.past).toHaveLength(1);
  useProject.getState().undo();
  expect(useProject.getState().project).toBe(p);
  useProject.getState().redo();
  expect(useProject.getState().project).toBe(q);
  const off = enableMgtCorrection(q, "w", "mgt", false);
  const caliperPrepared = addMaskInterval(
    off,
    "w",
    "cal",
    { id: "bad-cal", top: 110, base: 110 },
    "cal-mask",
  );
  expect(() => enableMgtCorrection(caliperPrepared, "w", "mgt", true)).toThrow(
    /caliper/,
  );
  expect(off.wells[0]!.interpretation.sources.GR).toEqual({
    kind: "curve",
    curveId: "gr",
  });
  expect(
    entryPreparationPlan(off, off.wells[0]!, registry).artifacts,
  ).toHaveLength(0);
  const on = enableMgtCorrection(off, "w", "mgt", true);
  expect((await run(on)).preparation!.artifacts[0]!.data[0]).toBeCloseTo(
    known.rows[1]!.gr100Centered,
    10,
  );
  const removed = removeMgtCorrection(q, "w", "mgt");
  expect(removed.wells[0]!.interpretation.preparation).toBeUndefined();
  expect(removed.wells[0]!.interpretation.sources.GR).toEqual({
    kind: "curve",
    curveId: "gr",
  });
  const reopened = await deserializeProject(await serializeProject(q));
  expect(reopened.wells[0]!.interpretation.preparation).toEqual(
    q.wells[0]!.interpretation.preparation,
  );
  expect((await run(reopened)).preparation!.artifacts[0]!.data[0]).toBeCloseTo(
    known.rows[1]!.gr100Centered,
    10,
  );
});
it("fuera de soporte total, método futuro o campo inesperado quedan bloqueados", () => {
  const p = mgtFixture(),
    e = p.wells[0]!,
    well = {
      ...e.well,
      curves: e.well.curves.map((c) =>
        c.id === "cal" ? { ...c, data: new Float64Array(51).fill(99) } : c,
      ),
    };
  expect(() => apply(reviseProjectInputs(p, "w", { well }))).toThrow(
    /fuente vacía/,
  );
  const q = apply(p),
    prep = structuredClone(q.wells[0]!.interpretation.preparation!);
  expect(prep.schemaVersion).toBe(5);
  expect(() => validatePreparation({ ...prep, schemaVersion: 4 })).toThrow();
  expect(() =>
    validatePreparation({
      ...prep,
      nodes: prep.nodes.map((n) => ({ ...n, methodVersion: 2 })),
    }),
  ).toThrow();
  expect(() =>
    validateMgtConfig({ ...mgtConfig, automaticOverride: true }),
  ).toThrow();
});
it("evaluator cancela y mantiene caché/acotación sin mutar originales", async () => {
  const p = apply(),
    request = calibrationPreviewRequest(p, "w", registry),
    evaluator = new MaskEvaluator(),
    original = p.wells[0]!.well.curves[0]!.data.slice();
  await expect(
    evaluator.evaluate(request.engineWell, request.plan, () => true),
  ).rejects.toBeInstanceOf(PreparationCancelled);
  const first = await evaluator.evaluate(request.engineWell, request.plan),
    second = await evaluator.evaluate(request.engineWell, request.plan);
  expect(second[0]!.data).toBe(first[0]!.data);
  expect(evaluator.retainedBytes).toBe(510);
  expect(p.wells[0]!.well.curves[0]!.data).toEqual(original);
});
it("cancelación cooperativa entre bloques no retiene una corrección parcial; presupuesto rechaza antes de alocar", async () => {
  const p = mgtFixture(),
    e = p.wells[0]!,
    n = 32769;
  const well = createWell({
    id: "w",
    name: "QA de cancelación sintético",
    depth: Float64Array.from({ length: n }, (_, k) => k),
    curves: e.well.curves.map((c) => ({
      ...c,
      data: Float64Array.from(
        { length: n },
        (_, k) => c.data[k % c.data.length]!,
      ),
    })),
  });
  const q = apply(reviseProjectInputs(p, "w", { well })),
    r = calibrationPreviewRequest(q, "w", registry),
    evaluator = new MaskEvaluator();
  let cancelled = false,
    checkpoints = 0;
  await expect(
    evaluator.evaluate(
      r.engineWell,
      r.plan,
      () => cancelled,
      async () => {
        checkpoints++;
        cancelled = true;
      },
    ),
  ).rejects.toBeInstanceOf(PreparationCancelled);
  expect(checkpoints).toBe(1);
  expect(evaluator.retainedBytes).toBe(0);
  await expect(
    new MaskEvaluator(100).evaluate(r.engineWell, r.plan),
  ).rejects.toThrow(/memoria/);
});
for (const format of ["csv", "las", "xlsx"] as const)
  it(`exporta ${format} con manifiesto, QC y procedencia del mismo contexto`, async () => {
    const p = apply(),
      result = await run(p),
      e = p.wells[0]!,
      id = result.preparation!.artifacts[0]!.id,
      context = entryPreparationPlan(p, e, registry).context;
    const sources = exportSources(e.well, result, false, context);
    expect(
      sources.columns.find((c) => c.id === `q:${id}`)!.description,
    ).toContain("64=corregida");
    const { file } = buildDataExport(
      e.well,
      e.interpretation.zones,
      result,
      {
        format,
        selection: [`m:${id}`, `q:${id}`, "m:gr"],
        zoneId: null,
        depthUnit: "m",
        nullValue: null,
        includeAlternatives: false,
        includeSummary: false,
      },
      context,
    );
    const archive = unzipSync(file.bytes),
      manifest = JSON.parse(strFromU8(archive["preparacion-ambiental.json"]!));
    expect(manifest.methods[0].ledger[0]).toMatchObject({
      method: MGT_METHOD.id,
      conditions: mgtConfig,
    });
    expect(manifest.inputRevisionId).toBe(e.inputRevisionId);
    expect(manifest.columns.map((c: { origin: string }) => c.origin)).toContain(
      "measured",
    );
    const report = buildReportModel(e.well, e.interpretation, result);
    expect(
      report.warnings.some(
        (w) =>
          w.includes(MGT_METHOD.id) && w.includes("46 muestras corregidas"),
      ),
    ).toBe(true);
  });
