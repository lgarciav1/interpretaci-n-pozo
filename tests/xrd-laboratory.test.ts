import { expect, it } from "vitest";
import { parseTable } from "../src/io";
import { buildXrdSet, type XrdMapping } from "../src/io/xrd";
import {
  createXrdSet,
  xrdComposition,
  type XrdContract,
} from "../src/core/preparation/xrd";
import { pointNumbers, pointTexts } from "../src/core/pointSets";
import {
  serializeProject,
  deserializeProject,
} from "../src/core/state/serialize";
import { addWell, createProject } from "../src/core/state/project";
import { enableProjectInputRevisions } from "../src/core/state/inputRevisions";
import { createWell } from "../src/core/well";
const c: XrdContract = {
  version: 1,
  basis: "mass",
  scope: "whole-rock",
  scale: "percent",
  report: "QA sintético",
  referenceId: "w",
  datum: "KB",
  closureTolerance: 0.01,
  uncertaintyNote:
    "Incertidumbre absoluta publicada, cobertura no especificada",
  minerals: [
    { id: "q", name: "Q", clay: false },
    { id: "c", name: "C", clay: true },
  ],
};
const mapping: XrdMapping = {
  depth: 0,
  base: null,
  sampleId: null,
  run: null,
  minerals: { q: 1, c: 2 },
  uncertainties: { c: 3 },
  detectionLimits: { c: 4 },
  depthUnit: "m",
};
const build = (s: string) =>
  buildXrdSet(
    parseTable(s, "lab.csv", { requireDepth: false, preserveRawCells: true }),
    mapping,
    c,
    "lab",
  );
it("conserva incertidumbre y límite en unidad/escala originales sin convertir censura en medida", () => {
  const s = build("MD;Q;C;UC;LC\n1;60;40;1,5;0,2\n2;100;<0,2;;0,2\n3;100;ND;;");
  expect([...pointNumbers(s, "uncertainty:c")!]).toEqual([1.5, NaN, NaN]);
  expect([...pointNumbers(s, "limit:c")!]).toEqual([0.2, 0.2, NaN]);
  expect(pointTexts(s, "status:c")![1]).toBe("below-detection");
  expect(xrdComposition(s, 1, "native").clayFraction).toBeNull();
});
it("rechaza auxiliares no numéricos, límites incompatibles, negativos y fuera de escala", () => {
  for (const row of [
    "1;60;40;abc;1",
    "1;60;40;-1;1",
    "1;100;<0.2;;0.3",
    "1;60;40;;0",
    "1;60;40;;101",
  ])
    expect(() => build("MD;Q;C;UC;LC\n" + row)).toThrow();
});
it("porcentajes y fracciones se distinguen y se exige describir incertidumbres", () => {
  expect(() =>
    createXrdSet("x", "X", "QA", { ...c, scale: "fraction" }, [
      {
        id: "p",
        top: 1,
        values: {
          q: { value: 0.6, status: "measured" },
          c: { value: 0.4, status: "measured", uncertainty: 1.1 },
        },
      },
    ]),
  ).toThrow();
  const { uncertaintyNote: _note, ...old } = c;
  expect(() =>
    createXrdSet("x", "X", "QA", old, [
      {
        id: "p",
        top: 1,
        values: {
          q: { value: 60, status: "measured" },
          c: { value: 40, status: "measured", uncertainty: 1 },
        },
      },
    ]),
  ).toThrow(/descripción/);
});
it("legado sin auxiliares no agrega columnas ni cambia la interpretación de ND", () => {
  const s = buildXrdSet(
    parseTable("MD;Q;C\n1;60;40\n2;100;ND", "lab.csv", {
      requireDepth: false,
      preserveRawCells: true,
    }),
    { ...mapping, uncertainties: undefined, detectionLimits: undefined },
    c,
    "lab",
  );
  expect(pointNumbers(s, "limit:c")).toBeNull();
  expect(pointNumbers(s, "uncertainty:c")).toBeNull();
  expect(pointTexts(s, "status:c")![1]).toBe("not-detected");
});
it("guardar/reabrir v7 conserva valores, censura, límites y nota del ensayo", async () => {
  const s = build("MD;Q;C;UC;LC\n1;60;40;1;0.2\n2;100;<0.2;;0.2");
  const p = enableProjectInputRevisions(
    addWell(
      createProject(),
      createWell({
        id: "w",
        name: "W",
        depth: Float64Array.of(0, 1, 2),
        curves: [],
        pointSets: [s],
      }),
    ),
  );
  const q = await deserializeProject(await serializeProject(p));
  expect(q.wells[0]!.well.pointSets[0]).toEqual(s);
});
