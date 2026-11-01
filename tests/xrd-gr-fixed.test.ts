import { expect, it } from "vitest";
import golden from "./fixtures/xrd-gr-fixed-known.json";
import legacy from "./fixtures/xrd-gr-calibration-v1.json";
import {
  DEFAULT_GR_POLICY,
  DEFAULT_FIXED_GR_POLICY,
  fitGrCalibration,
  type CalibrationPoint,
  type FixedGrEndpoint,
} from "../src/petro/xrdCalibration";
import { VSH_METHODS, type VshMethod } from "../src/petro/vsh";
import { registry } from "../src/modules";
import {
  grBounds,
  proposeGrCalibration,
  readGrCalibration,
  type GrCalibrationConfig,
  type GrCalibrationProposal,
  XRD_CALIBRATION_SETTING,
} from "../src/core/preparation/xrdCalibration";
import { createXrdSet, type XrdContract } from "../src/core/preparation/xrd";
import { resolveDataContext } from "../src/core/preparation/projection";
import { createWell } from "../src/core/well";
import {
  createProject,
  addWell,
  updateInterpretation,
} from "../src/core/state/project";
import { enableProjectInputRevisions } from "../src/core/state/inputRevisions";
import { applyGrCalibration } from "../src/core/state/xrdCalibration";
import {
  serializeProject,
  deserializeProject,
} from "../src/core/state/serialize";
import { createSnapshot, restoreSnapshot } from "../src/core/state/snapshots";
import { useProject } from "../src/app/store/project";
const bounds = grBounds(registry);
function points(
  method: VshMethod,
  end: FixedGrEndpoint["end"],
): CalibrationPoint[] {
  const g = golden.methods[method][end];
  return Array.from({ length: 18 }, (_, i) => ({
    id: "P" + i,
    depth: 10 + i * 10,
    target: g.targets[i % 6]!,
    gr: g.gr[i % 6]!,
  }));
}
for (const method of VSH_METHODS)
  for (const end of ["clean", "shale"] as const)
    it(`${method}: conserva ${end} externo y recupera el extremo libre con validación por bloques`, async () => {
      const g = golden.methods[method][end],
        p = points(method, end),
        fixed = Object.freeze({ end, value: g.fixed });
      const free = await fitGrCalibration(
        p,
        method,
        bounds,
        { ...DEFAULT_GR_POLICY },
        3,
      );
      expect(free.admitted).toBe(false);
      const result = await fitGrCalibration(
        p,
        method,
        bounds,
        { ...DEFAULT_FIXED_GR_POLICY },
        3,
        async () => {},
        fixed,
      );
      expect(result.reasons).toEqual([]);
      expect(result.admitted).toBe(true);
      expect(result.raw[end]).toBe(g.fixed);
      expect(result.applied).toEqual({ clean: 30, shale: 120 });
      expect(result.fixed).toEqual({ end, value: g.fixed });
      expect(result.folds.every((f) => f.endpoints[end] === g.fixed)).toBe(
        true,
      );
      expect(result.endpointSpread[end]).toBe(0);
      expect(result.validation!.rmse).toBeLessThan(1e-10);
      expect(fixed).toEqual({ end, value: g.fixed });
    });
it("rechaza referencia fuera de límites/paso en vez de redondearla o recortarla", async () => {
  for (const fixed of [
    { end: "clean", value: 30.25 },
    { end: "clean", value: -0.5 },
    { end: "shale", value: 301 },
    { end: "shale", value: NaN },
  ] as FixedGrEndpoint[])
    await expect(
      fitGrCalibration(
        points("linear", "clean"),
        "linear",
        bounds,
        { ...DEFAULT_FIXED_GR_POLICY },
        3,
        async () => {},
        fixed,
      ),
    ).rejects.toThrow(/externo/);
});
it("un extremo realmente externo puede estar en una cota; el extremo libre no se admite en una cota", async () => {
  const clean = await fitGrCalibration(
    points("linear", "clean").map((p) => ({ ...p, gr: p.gr - 30 })),
    "linear",
    bounds,
    { ...DEFAULT_FIXED_GR_POLICY },
    3,
    async () => {},
    { end: "clean", value: 0 },
  );
  expect(clean.admitted).toBe(true);
  expect(clean.applied).toEqual({ clean: 0, shale: 90 });
  const shale = await fitGrCalibration(
    points("linear", "shale").map((p) => ({ ...p, gr: 30 + 270 * p.target })),
    "linear",
    bounds,
    { ...DEFAULT_FIXED_GR_POLICY },
    3,
    async () => {},
    { end: "shale", value: 300 },
  );
  expect(shale.admitted).toBe(true);
  expect(shale.applied).toEqual({ clean: 30, shale: 300 });
  const edge = await fitGrCalibration(
    points("linear", "clean").map((p) => ({ ...p, gr: 30 + 270 * p.target })),
    "linear",
    bounds,
    { ...DEFAULT_FIXED_GR_POLICY },
    3,
    async () => {},
    { end: "clean", value: 30 },
  );
  expect(edge.admitted).toBe(false);
  expect(edge.reasons.join()).toMatch(/borde/);
});
it("no dispensa falta de soporte libre, rango, asociación ni bloques independientes", async () => {
  for (const pts of [
    points("linear", "clean").map((p) => ({
      ...p,
      target: 0.4 + 0.1 * p.target,
    })),
    points("linear", "clean").map((p) => ({ ...p, gr: 100 })),
    points("linear", "clean").map((p, i) => ({ ...p, depth: i * 0.01 })),
  ])
    expect(
      (
        await fitGrCalibration(
          pts,
          "linear",
          bounds,
          { ...DEFAULT_FIXED_GR_POLICY },
          3,
          async () => {},
          { end: "clean", value: 30 },
        )
      ).admitted,
    ).toBe(false);
  const wrong = await fitGrCalibration(
    points("linear", "clean"),
    "linear",
    bounds,
    { ...DEFAULT_FIXED_GR_POLICY },
    3,
    async () => {},
    { end: "clean", value: 140 },
  );
  expect(wrong.admitted).toBe(false);
});
const contract: XrdContract = {
  version: 1,
  basis: "volume",
  scope: "whole-rock",
  scale: "fraction",
  closureTolerance: 0.01,
  report: "Fixture sintético Python independiente",
  referenceId: "w",
  datum: "KB",
  minerals: [
    { id: "q", name: "Q", clay: false },
    { id: "c", name: "C", clay: true },
  ],
};
function fixture(end: FixedGrEndpoint["end"] = "clean") {
  const pts = points("linear", end);
  return enableProjectInputRevisions(
    addWell(
      createProject(),
      createWell({
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
            "QA",
            "Python",
            contract,
            pts.map((p) => ({
              id: p.id,
              top: p.depth,
              values: {
                q: { value: 1 - p.target, status: "measured" },
                c: { value: p.target, status: "measured" },
              },
            })),
          ),
        ],
      }),
      [
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
      ],
    ),
  );
}
const config = (
  end: FixedGrEndpoint["end"] = "clean",
): GrCalibrationConfig => ({
  version: 2,
  method: "linear",
  zoneId: "z",
  clayClean: 0,
  clayShale: 1,
  relationship: "Proxy volumétrico declarado solo para la zona sintética.",
  independentReference: "Laboratorio sintético independiente de la app.",
  independenceDeclared: true,
  policy: { ...DEFAULT_FIXED_GR_POLICY },
  fixed: {
    end,
    value: end === "clean" ? 30 : 120,
    externalDeclared: true,
    reference: "Referencia externa sintética independiente de este ajuste.",
    uncertainty: 0.5,
    uncertaintyNote: "Incertidumbre absoluta declarada, sin propagación.",
  },
});
async function propose(p = fixture(), c = config()) {
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
    {
      curveId: "gr",
      target: "native",
      maxGapM: 1,
      minCoverage: 1,
      shiftM: 0,
      densities: {},
    },
    e.inputRevisionId!,
    c,
    registry,
  );
}
it("guarda modo, referencia e incertidumbre externos como v2 y conserva legado v1", async () => {
  const p = fixture(),
    proposal = await propose(p);
  expect(proposal.version).toBe(2);
  expect(proposal.methodVersion).toBe("xrd-gr-fixed-v1");
  expect(proposal.fit.admitted).toBe(true);
  const q = applyGrCalibration(p, p, "w", "lab", proposal, registry),
    reopened = await deserializeProject(await serializeProject(q));
  const record = readGrCalibration(
    reopened.wells[0]!.interpretation.pointSets.lab!.settings![
      XRD_CALIBRATION_SETTING + ":z"
    ],
  )!;
  expect(record.config.fixed).toEqual(config().fixed);
  expect(record.fit.applied).toEqual({ clean: 30, shale: 120 });
  const old = readGrCalibration(JSON.stringify(legacy))!;
  expect(old.version).toBe(1);
  expect(old.config.fixed).toBeUndefined();
  expect(old.fit.applied).toEqual({ clean: 25, shale: 135 });
  expect(old).toEqual(legacy);
});
it("aplicación, undo/redo y snapshot preservan cutoffs, otras zonas y originales junto con la referencia externa", async () => {
  const p = updateInterpretation(fixture(), "w", (i) => ({
      ...i,
      params: {
        global: { vshCutoff: 0.4, phiCutoff: 0.1, swCutoff: 0.6 },
        zones: { other: { grClean: 45, grShale: 150 }, z: { vshCutoff: 0.3 } },
      },
    })),
    proposal = await propose(p),
    q = applyGrCalibration(p, p, "w", "lab", proposal, registry),
    before = p.wells[0]!,
    after = q.wells[0]!;
  expect(after.well).toBe(before.well);
  expect(after.interpretation.params.global).toBe(
    before.interpretation.params.global,
  );
  expect(after.interpretation.params.zones.other).toBe(
    before.interpretation.params.zones.other,
  );
  expect(after.interpretation.params.zones.z).toEqual({
    grClean: 30,
    grShale: 120,
    "vsh.method": "linear",
    vshCutoff: 0.3,
  });
  expect(after.interpretation.sources).toBe(before.interpretation.sources);
  useProject.getState().replace(p);
  useProject.getState().commit("Aplicar fijo", () => q);
  useProject.getState().undo();
  expect(useProject.getState().project).toBe(p);
  useProject.getState().redo();
  expect(useProject.getState().project).toBe(q);
  const snap = createSnapshot(q, "w", "Extremo externo").project,
    changed = updateInterpretation(snap, "w", (i) => ({
      ...i,
      pointSets: {},
      params: { global: {}, zones: {} },
    }));
  expect(
    restoreSnapshot(changed, snap.snapshots[0]!.id).wells[0]!.interpretation,
  ).toEqual(after.interpretation);
  expect(() =>
    applyGrCalibration({ ...p }, p, "w", "lab", proposal, registry),
  ).toThrow(/obsoleta/);
});
it("rechaza referencias/atestaciones/uncertidumbres inválidas y bloquea la incertidumbre externa excesiva", async () => {
  for (const patch of [
    { reference: "" },
    { externalDeclared: false },
    { uncertainty: -1 },
    { uncertainty: 0.5, uncertaintyNote: "" },
    { uncertainty: 0.5, uncertaintyNote: 123 },
  ]) {
    const c = config();
    c.fixed = { ...c.fixed!, ...patch } as typeof c.fixed;
    await expect(propose(fixture(), c)).rejects.toThrow(/externo/);
  }
  const c = config();
  c.fixed!.uncertainty = 21;
  const p = fixture();
  const result = await propose(p, c);
  expect(result.fit.admitted).toBe(false);
  expect(result.fit.reasons.join()).toMatch(/extremo externo/);
  expect(() =>
    applyGrCalibration(p, p, "w", "lab", result, registry),
  ).toThrow();
});
it("detecta pérdida o alteración del extremo fijo en raw/aplicable/folds y versiones futuras", async () => {
  const proposal = await propose();
  for (const alter of [
    (p: GrCalibrationProposal) => {
      p.fit.applied.clean = 30.5;
    },
    (p: GrCalibrationProposal) => {
      p.fit.raw.clean = 29.5;
    },
    (p: GrCalibrationProposal) => {
      p.fit.folds[0]!.endpoints.clean = 31;
    },
    (p: GrCalibrationProposal) => {
      p.fit.fixed!.value = 31;
    },
  ]) {
    const p = structuredClone(proposal);
    alter(p);
    expect(() => readGrCalibration(JSON.stringify(p))).toThrow(/conserva/);
  }
  expect(() =>
    readGrCalibration(JSON.stringify({ ...proposal, version: 3 })),
  ).toThrow(/desconocida/);
  const c = config();
  c.version = 1;
  await expect(propose(fixture(), c)).rejects.toThrow();
});
it("cancelar el ajuste restringido no publica un resultado parcial", async () => {
  await expect(
    fitGrCalibration(
      points("clavier", "clean"),
      "clavier",
      bounds,
      { ...DEFAULT_FIXED_GR_POLICY },
      3,
      async () => {
        throw new Error("cancelado");
      },
      { end: "clean", value: 30 },
    ),
  ).rejects.toThrow("cancelado");
});
