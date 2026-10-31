import {
  addMaskInterval,
  entryPreparationPlan,
} from "../src/core/state/preparation";
import { MaskEvaluator } from "../src/core/preparation/evaluate";
import { toEngineWell } from "../src/core/engine/engine";
import { materializePreparation } from "../src/core/preparation/plan";
import { expect, it, vi } from "vitest";
import {
  createXrdSet,
  pairXrd,
  xrdComposition,
  type XrdContract,
} from "../src/core/preparation/xrd";
import {
  evaluateXrdComparison,
  exportXrdComparisonCsv,
  readXrdRecord,
  xrdInputDigest,
  XRD_COMPARISON_SETTING,
  type XrdComparisonConfig,
} from "../src/core/preparation/xrdEvidence";
import { acceptXrdComparison } from "../src/core/state/xrd";
import { createWell } from "../src/core/well";
import {
  addWell,
  createProject,
  updateInterpretation,
  updateWell,
} from "../src/core/state/project";
import { enableProjectInputRevisions } from "../src/core/state/inputRevisions";
import {
  serializeProject,
  deserializeProject,
} from "../src/core/state/serialize";
import { resolveDataContext } from "../src/core/preparation/projection";
import { createSnapshot, restoreSnapshot } from "../src/core/state/snapshots";
import { createRegistry } from "../src/core/registry";
import { curve, linearModule } from "./helpers";
import { useProject } from "../src/app/store/project";
const registry = createRegistry([linearModule("igr", "GR", "IGR")]);
const contract: XrdContract = {
  version: 1,
  basis: "mass",
  scope: "whole-rock",
  scale: "percent",
  closureTolerance: 0.01,
  report: "QA sintético",
  referenceId: "w",
  datum: "KB declarado",
  minerals: [
    { id: "q", name: "Cuarzo", clay: false },
    { id: "c", name: "Arcilla", clay: true },
  ],
};
const fixture = () =>
  enableProjectInputRevisions(
    addWell(
      createProject(),
      createWell({
        id: "w",
        name: "W",
        depth: Float64Array.of(0, 1, 2, 3),
        curves: [
          {
            ...curve("gr", "GR", [10, 20, 30, 40]),
            origin: { kind: "measured" },
          },
        ],
        pointSets: [
          createXrdSet("lab", "Ensayo", "QA", contract, [
            {
              id: "=replica",
              top: 1,
              values: {
                q: { value: 60, status: "measured" },
                c: { value: 40, status: "measured" },
              },
            },
            {
              id: "p2",
              top: 2,
              values: {
                q: { value: 50, status: "measured" },
                c: { value: 50, status: "measured" },
              },
            },
          ]),
        ],
      }),
    ),
  );
const config: XrdComparisonConfig = {
  curveId: "gr",
  target: "solid-volume",
  maxGapM: 1,
  minCoverage: 0.8,
  shiftM: 0,
  densities: {
    q: { value: 3, reference: "Densidad sintética Q", uncertainty: 0.1 },
    c: { value: 2, reference: "Densidad sintética C" },
  },
};
const frame = (p = fixture()) => {
  const e = p.wells[0]!;
  return {
    p,
    e,
    set: e.well.pointSets[0]!,
    data: resolveDataContext(
      e.well,
      e.interpretation,
      registry,
      e.inputRevisionId!,
    ),
  };
};
async function evaluate(p = fixture(), c = config) {
  const f = frame(p);
  return {
    ...f,
    ...(await evaluateXrdComparison(
      f.data,
      f.e.interpretation,
      f.set,
      c,
      f.e.inputRevisionId!,
    )),
  };
}
it("configuración, procedencia e incertidumbre se guardan en una receta con undo/redo, sin cambiar motor ni originales", async () => {
  const f = await evaluate();
  expect(f.rows[0]!.composition.clayFraction).toBe(0.5);
  const next = acceptXrdComparison(f.p, f.p, "w", "lab", f.record);
  expect(next.wells[0]!.well).toBe(f.e.well);
  expect(next.wells[0]!.interpretation.params).toBe(f.e.interpretation.params);
  expect(
    readXrdRecord(
      next.wells[0]!.interpretation.pointSets.lab!.settings![
        XRD_COMPARISON_SETTING
      ],
    )!.config.densities.q!.reference,
  ).toBe("Densidad sintética Q");
  useProject.getState().replace(f.p);
  useProject
    .getState()
    .commit("Guardar DRX", (p) =>
      acceptXrdComparison(p, f.p, "w", "lab", f.record),
    );
  useProject.getState().undo();
  expect(useProject.getState().project).toBe(f.p);
  useProject.getState().redo();
  expect(useProject.getState().project.wells[0]!.interpretation).toEqual(
    next.wells[0]!.interpretation,
  );
  expect(acceptXrdComparison(next, next, "w", "lab", f.record)).toBe(next);
});
it("huellas de contenido sobreviven guardar/reabrir y evidencia no se incluye a sí misma", async () => {
  const f = await evaluate(),
    saved = acceptXrdComparison(f.p, f.p, "w", "lab", f.record),
    reopened = await deserializeProject(await serializeProject(saved));
  const current = await evaluate(reopened);
  expect(current.record.evidence.inputDigest).toBe(
    f.record.evidence.inputDigest,
  );
  expect(current.record.evidence.resultDigest).toBe(
    f.record.evidence.resultDigest,
  );
  const stored = readXrdRecord(
    reopened.wells[0]!.interpretation.pointSets.lab!.settings![
      XRD_COMPARISON_SETTING
    ],
  );
  expect(stored).toEqual(f.record);
});
it("snapshot recupera configuración y evidencia aceptada sin modificar otra interpretación", async () => {
  const f = await evaluate(),
    saved = acceptXrdComparison(f.p, f.p, "w", "lab", f.record),
    withSnapshot = createSnapshot(saved, "w", "DRX QA").project;
  const changed = updateInterpretation(withSnapshot, "w", (i) => ({
    ...i,
    pointSets: {},
  }));
  const restored = restoreSnapshot(changed, withSnapshot.snapshots[0]!.id);
  expect(restored.wells[0]!.interpretation.pointSets).toEqual(
    saved.wells[0]!.interpretation.pointSets,
  );
});
it("cambiar fuente, calidad, muestras, zonas, exclusiones o desplazamiento invalida evidencia", async () => {
  const f = await evaluate();
  for (const p of [
    updateWell(f.p, "w", (w) => ({
      ...w,
      curves: w.curves.map((c) => ({
        ...c,
        data: Float64Array.of(11, 20, 30, 40),
      })),
    })),
    updateInterpretation(f.p, "w", (i) => ({
      ...i,
      pointSets: { lab: { points: { "=replica": { status: "exclude" } } } },
    })),
    updateInterpretation(f.p, "w", (i) => ({
      ...i,
      zones: [
        {
          id: "z",
          name: "Z",
          top: 0.5,
          base: 2.5,
          color: "#fff",
          kind: "formation",
        },
      ],
    })),
  ]) {
    const x = await evaluate(p);
    expect(x.record.evidence.inputDigest).not.toBe(
      f.record.evidence.inputDigest,
    );
  }
  const changedConfig = await evaluate(f.p, { ...config, shiftM: 0.1 });
  expect(changedConfig.record.evidence.inputDigest).not.toBe(
    f.record.evidence.inputDigest,
  );
  const qualityData = {
    ...f.data,
    quality: new Map([["gr", Uint16Array.of(0, 16, 0, 0)]]),
  };
  expect(
    await xrdInputDigest(
      qualityData,
      f.e.interpretation,
      f.set,
      config,
      f.e.inputRevisionId!,
    ),
  ).not.toBe(f.record.evidence.inputDigest);
});
it("nombre/presentación no invalidan contenido y una fuente ausente nunca cae a otra", async () => {
  const f = await evaluate(),
    renamed = updateWell(f.p, "w", (w) => ({ ...w, name: "Otro nombre" }));
  // updateWell crea una revisión: el cambio real de revisión se invalida conservadoramente.
  const d = resolveDataContext(
    { ...f.e.well, name: "Presentación temporal" },
    f.e.interpretation,
    registry,
    f.e.inputRevisionId!,
  );
  expect(
    await xrdInputDigest(
      d,
      f.e.interpretation,
      f.set,
      config,
      f.e.inputRevisionId!,
    ),
  ).toBe(f.record.evidence.inputDigest);
  expect(renamed).not.toBe(f.p);
  await expect(
    evaluate(f.p, { ...config, curveId: "ausente" }),
  ).rejects.toThrow(/no está disponible/);
});
it("rechaza evidencia obsoleta al aceptar y versiones futuras sin perder registro", async () => {
  const f = await evaluate();
  expect(() =>
    acceptXrdComparison({ ...f.p }, f.p, "w", "lab", f.record),
  ).toThrow(/Cambió/);
  expect(() =>
    readXrdRecord(JSON.stringify({ ...f.record, version: 2 })),
  ).toThrow(/Versión/);
  expect(() =>
    readXrdRecord(
      JSON.stringify({
        ...f.record,
        config: { ...config, densities: { q: { value: 3, reference: "" } } },
      }),
    ),
  ).toThrow(/densidad/);
  expect(() =>
    readXrdRecord(
      JSON.stringify({
        ...f.record,
        evidence: { ...f.record.evidence, usable: 3 },
      }),
    ),
  ).toThrow();
});
it("exporta tabla completa con fuente/procedencia y neutraliza fórmulas en ids; bloquea resultados o entradas alterados", async () => {
  const f = await evaluate();
  const csv = await exportXrdComparisonCsv(
    f.record,
    f.rows,
    f.set,
    f.record.evidence.inputDigest,
  );
  expect(csv).toContain("'=replica");
  expect(csv).toContain("Densidad sintética Q");
  expect(csv).toContain("No equivale a Vsh");
  expect(csv).toContain("p2");
  await expect(
    exportXrdComparisonCsv(
      f.record,
      [{ ...f.rows[0]!, pair: { ...f.rows[0]!.pair, value: 99 } }, f.rows[1]!],
      f.set,
      f.record.evidence.inputDigest,
    ),
  ).rejects.toThrow(/tabla/);
  await expect(
    exportXrdComparisonCsv(f.record, f.rows, f.set, "0".repeat(64)),
  ).rejects.toThrow(/tabla/);
});
it("cancelación no publica evidencia parcial", async () => {
  const f = frame();
  await expect(
    evaluateXrdComparison(
      f.data,
      f.e.interpretation,
      f.set,
      config,
      f.e.inputRevisionId!,
      async () => {
        throw new Error("cancelado");
      },
    ),
  ).rejects.toThrow("cancelado");
  expect(f.e.interpretation.pointSets.lab).toBeUndefined();
});
it("bloquea resultados numéricos no finitos y arcilla nativa mayor que uno en cierres tolerados", async () => {
  const f = frame();
  const pairs = await pairXrd(
    createXrdSet("z", "Z", "QA", contract, [
      {
        id: "p",
        top: 0,
        base: 2,
        values: {
          q: { value: 60, status: "measured" },
          c: { value: 40, status: "measured" },
        },
      },
    ]),
    Float64Array.of(0, 1, 2),
    Float64Array.of(1e308, 1e308, 1e308),
    undefined,
    { maxGapM: 1, minCoverage: 1, shiftM: 0, boundaries: [] },
  );
  expect(pairs[0]!.value).toBeNull();
  expect(pairs[0]!.dispersion).toBeNull();
  expect(pairs[0]!.reason).toMatch(/numérico/);
  const clay = createXrdSet(
    "x",
    "X",
    "QA",
    {
      ...contract,
      closureTolerance: 0.1,
      minerals: [
        { id: "a", name: "A", clay: true },
        { id: "b", name: "B", clay: true },
      ],
    },
    [
      {
        id: "p",
        top: 0,
        values: {
          a: { value: 60, status: "measured" },
          b: { value: 45, status: "measured" },
        },
      },
    ],
  );
  expect(xrdComposition(clay, 0, "native").clayFraction).toBeNull();
  expect(f.set.kind).toBe("xrd");
});

it("fuente preparada reproduce huellas tras guardar/reabrir con arrays y contexto nuevos", async () => {
  const p = addMaskInterval(
    fixture(),
    "w",
    "gr",
    { id: "r", top: 1, base: 1 },
    "mask",
  );
  async function prepared(project: typeof p) {
    const e = project.wells[0]!,
      plan = entryPreparationPlan(project, e, registry),
      artifacts = await new MaskEvaluator().evaluate(
        toEngineWell(e.well),
        plan,
      ),
      data = materializePreparation(
        e.well,
        { plan, artifacts },
        plan.context,
        registry,
      );
    return evaluateXrdComparison(
      data,
      e.interpretation,
      e.well.pointSets[0]!,
      { ...config, curveId: "prep:mask:masked" },
      e.inputRevisionId!,
    );
  }
  const a = await prepared(p),
    saved = acceptXrdComparison(p, p, "w", "lab", a.record),
    q = await deserializeProject(await serializeProject(saved)),
    b = await prepared(q);
  expect(b.record.evidence.inputDigest).toBe(a.record.evidence.inputDigest);
  expect(b.record.evidence.resultDigest).toBe(a.record.evidence.resultDigest);
  expect(b.rows[0]!.pair.value).toBeNull();
});
it("SHA-256 sin SubtleCrypto verifica la misma evidencia offline", async () => {
  const f = await evaluate();
  vi.stubGlobal("crypto", undefined);
  try {
    const g = await evaluate(f.p);
    expect(g.record.evidence.inputDigest).toBe(f.record.evidence.inputDigest);
    expect(g.record.evidence.resultDigest).toBe(f.record.evidence.resultDigest);
  } finally {
    vi.unstubAllGlobals();
  }
});
