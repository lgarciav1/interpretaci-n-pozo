import { expect, it } from "vitest";
import { curve, linearModule } from "./helpers";
import { createWell } from "../src/core/well";
import { createProject, addWell } from "../src/core/state/project";
import {
  registerRun,
  setRunDepthShift,
  removeRunDepthShift,
} from "../src/core/state/runs";
import { entryPreparationPlan } from "../src/core/state/preparation";
import { createRegistry } from "../src/core/registry";
import { MaskEvaluator } from "../src/core/preparation/evaluate";
import { toEngineWell } from "../src/core/engine/engine";
import {
  serializeProject,
  deserializeProject,
} from "../src/core/state/serialize";
import { useProject } from "../src/app/store/project";
import { diagnoseShift } from "../src/core/preparation/correlation";
const fixture = () =>
  addWell(
    createProject(),
    createWell({
      id: "w",
      name: "W",
      depth: Float64Array.of(0, 1, 2, 3, 4),
      curves: [
        {
          ...curve("gr", "GR", [0, 10, 0, 0, 0]),
          origin: { kind: "measured" },
        },
        { ...curve("rt", "RT", [1, 2, 3, 4, 5]), origin: { kind: "measured" } },
      ],
    }),
  );
const shift = {
  offsetM: 1,
  maxGapM: 1,
  referenceId: "w",
  depthKind: "MD" as const,
  datum: "KB declarado",
};
it("registra pertenencia explícita, sin inventar adquisición ni aceptar solapamientos", () => {
  const p = fixture(),
    q = registerRun(p, "w", "R", ["gr", "rt"]);
  expect(p.inputRevisions).toBeUndefined();
  expect(q.wells[0]!.well.curves[0]!.data).toEqual(
    p.wells[0]!.well.curves[0]!.data,
  );
  expect(
    q.inputRevisions![q.wells[0]!.inputRevisionId!]!.acquisition.runs[0]!
      .corrections.status,
  ).toBe("unknown");
  expect(() => registerRun(q, "w", "R2", ["gr"])).toThrow();
  expect(() => registerRun(p, "w", "R", ["missing"])).toThrow();
});
it("previsualiza corrida completa, conserva originales y publica un undo/redo, archivo reproducible", async () => {
  const p = registerRun(fixture(), "w", "R", ["gr", "rt"]),
    q = setRunDepthShift(p, "w", "R", shift, (id) => "shift-" + id),
    e = q.wells[0]!,
    registry = createRegistry([linearModule("igr", "GR", "IGR")]);
  const plan = entryPreparationPlan(q, e, registry),
    out = await new MaskEvaluator().evaluate(toEngineWell(e.well), plan);
  expect(out).toHaveLength(2);
  expect(out[0]!.data).toEqual(Float64Array.of(NaN, 0, 10, 0, 0));
  expect(out[1]!.data).toEqual(Float64Array.of(NaN, 1, 2, 3, 4));
  expect(p.wells[0]!.interpretation.preparation).toBeUndefined();
  useProject.getState().replace(p);
  useProject.getState().commit("Alinear corrida", () => q);
  useProject.getState().undo();
  expect(useProject.getState().project).toBe(p);
  useProject.getState().redo();
  expect(useProject.getState().project).toBe(q);
  expect(
    removeRunDepthShift(q, "w", "R").wells[0]!.interpretation.preparation,
  ).toBeUndefined();
  const reopened = await deserializeProject(await serializeProject(q));
  expect(reopened.wells[0]!.interpretation).toEqual(e.interpretation);
  expect(setRunDepthShift(q, "w", "R", shift, () => "unused")).toBe(q);
});
it("rechaza lote entero si una curva no admite alineación o repite rol", () => {
  const p = fixture();
  p.wells[0]!.well.curves[1]!.role = null;
  const q = registerRun(p, "w", "R", ["gr", "rt"]);
  expect(() =>
    setRunDepthShift(q, "w", "R", shift, (id) => "s" + id),
  ).toThrow();
  expect(q.wells[0]!.interpretation.preparation).toBeUndefined();
  const r = fixture();
  r.wells[0]!.well.curves[1]!.role = "GR";
  expect(() =>
    setRunDepthShift(
      registerRun(r, "w", "R", ["gr", "rt"]),
      "w",
      "R",
      shift,
      (id) => "s" + id,
    ),
  ).toThrow(/alternativas/);
});
it("recupera signo conocido con validación independiente y rechaza ventanas con soporte compartido", async () => {
  const d = Float64Array.from({ length: 200 }, (_, i) => i),
    a = Float64Array.from(d, (x) => Math.sin(x * 0.37) + Math.cos(x * 0.13)),
    b = Float64Array.from(d, (_, i) => (i >= 2 ? a[i - 2]! : NaN));
  const r = await diagnoseShift(
    d,
    a,
    b,
    [-3, -2, -1, 0, 1, 2, 3],
    { top: 10, base: 70 },
    { top: 100, base: 170 },
    1,
  );
  expect(r.peak!.offsetM).toBe(2);
  expect(r.peak!.r).toBeCloseTo(1, 12);
  expect(r.validation!.r).toBeCloseTo(1, 12);
  expect(r.atEdge).toBe(false);
  expect(r.ambiguous).toBe(false);
  await expect(
    diagnoseShift(
      d,
      a,
      b,
      [-1, 0, 1],
      { top: 10, base: 70 },
      { top: 71, base: 170 },
      1,
    ),
  ).rejects.toThrow(/soporte/);
});
it("constantes no identificables, bordes, huecos y cancelación explícita", async () => {
  const d = Float64Array.from({ length: 100 }, (_, i) => i),
    a = new Float64Array(100).fill(1);
  const r = await diagnoseShift(
    d,
    a,
    a,
    [-1, 0, 1],
    { top: 10, base: 30 },
    { top: 60, base: 90 },
    1,
  );
  expect(r.peak).toBeNull();
  expect(r.ambiguous).toBe(true);
  await expect(
    diagnoseShift(
      d,
      a,
      a,
      [-1, 0, 1],
      { top: 10, base: 30 },
      { top: 60, base: 90 },
      1,
      async () => {
        throw new Error("cancelado");
      },
    ),
  ).rejects.toThrow("cancelado");
});
