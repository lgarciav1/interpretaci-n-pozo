import { expect, it } from "vitest";
import {
  createXrdSet,
  xrdComposition,
  pairXrd,
  type XrdContract,
} from "../src/core/preparation/xrd";
import { buildXrdSet } from "../src/io/xrd";
import { parseTable } from "../src/io";
import { addWell, createProject } from "../src/core/state/project";
import { createWell } from "../src/core/well";
import { enableProjectInputRevisions } from "../src/core/state/inputRevisions";
import { addPointSet } from "../src/core/state/pointSets";
import {
  serializeProject,
  deserializeProject,
} from "../src/core/state/serialize";
const contract: XrdContract = {
  version: 1,
  basis: "mass",
  scope: "whole-rock",
  scale: "percent",
  closureTolerance: 0.01,
  report: "Ensayo sintético explícito",
  referenceId: "w",
  datum: "KB declarado",
  minerals: [
    { id: "q", name: "Cuarzo", clay: false },
    { id: "c", name: "Arcilla declarada", clay: true },
  ],
};
const set = (top = 1, base?: number) =>
  createXrdSet("x", "DRX sintético", "fixture", contract, [
    {
      id: "s",
      top,
      base,
      values: {
        q: { value: 60, status: "measured" },
        c: { value: 40, status: "measured" },
      },
    },
  ]);
it("conserva masa nativa y convierte masa→volumen con densidades independientes conocidas", () => {
  expect(xrdComposition(set(), 0, "native").clayFraction).toBe(0.4);
  expect(
    xrdComposition(set(), 0, "solid-volume", { q: 3, c: 2 }).clayFraction,
  ).toBeCloseTo(0.5, 14);
  expect(xrdComposition(set(), 0, "solid-volume").reason).toMatch(/densidad/);
});
it("base volumen no requiere densidades, escala fracción explícita", () => {
  const s = createXrdSet(
    "x",
    "X",
    "S",
    { ...contract, basis: "volume", scale: "fraction" },
    [
      {
        id: "a",
        top: 1,
        values: {
          q: { value: 0.6, status: "measured" },
          c: { value: 0.4, status: "measured" },
        },
      },
    ],
  );
  expect(xrdComposition(s, 0, "solid-volume").clayFraction).toBe(0.4);
});
it("no renormaliza cierre incompleto y bloquea arcillas totales desde fracción arcilla", () => {
  const s = set();
  (s.columns["mineral:q"]!.values as Float64Array)[0] = 40;
  expect(xrdComposition(s, 0, "native").reason).toMatch(/Cierre/);
  const clay = createXrdSet(
    "x",
    "X",
    "S",
    { ...contract, scope: "clay-fraction", minerals: [contract.minerals[1]!] },
    [{ id: "a", top: 1, values: { c: { value: 100, status: "measured" } } }],
  );
  expect(xrdComposition(clay, 0, "native").reason).toMatch(/no determina/);
});
it("valida intervalo, escala, negativos, minerales desconocidos y no confunde ND/BLD/no medido con cero", () => {
  expect(() => set(2, 1)).toThrow();
  expect(() =>
    createXrdSet("x", "X", "S", contract, [
      {
        id: "a",
        top: 1,
        values: {
          q: { value: 101, status: "measured" },
          c: { value: -1, status: "measured" },
        },
      },
    ]),
  ).toThrow();
  const table = parseTable("MD;Q;C\n1;60;40\n1;ND;BLD\n3;;100", "lab.csv", {
    requireDepth: false,
    preserveRawCells: true,
  });
  const s = buildXrdSet(
    table,
    {
      depth: 0,
      base: null,
      sampleId: null,
      run: null,
      depthUnit: "m",
      minerals: { q: 1, c: 2 },
    },
    contract,
    "x",
  );
  expect([...s.depth]).toEqual([1, 1, 3]);
  expect(s.pointIds).toHaveLength(3);
  expect(s.columns["status:q"]!.values).toEqual([
    "measured",
    "not-detected",
    "not-measured",
  ]);
  expect(s.columns["status:c"]!.values[1]).toBe("below-detection");
  expect(xrdComposition(s, 1, "native").clayFraction).toBeNull();
});
it("mapeo convierte ft a m, conserva replicas e informe; rechaza columnas repetidas y textos no admitidos", () => {
  const table = parseTable("MD;Q;C\n10;60;40\n10;60;40", "lab.csv", {
    requireDepth: false,
    preserveRawCells: true,
  });
  const mapping = {
    depth: 0,
    base: null,
    sampleId: null,
    run: null,
    depthUnit: "ft" as const,
    minerals: { q: 1, c: 2 },
  };
  const s = buildXrdSet(table, mapping, contract, "x");
  expect([...s.depth]).toEqual([3.048, 3.048]);
  expect(s.pointIds[0]).not.toBe(s.pointIds[1]);
  expect(() =>
    buildXrdSet(table, { ...mapping, minerals: { q: 1, c: 1 } }, contract, "x"),
  ).toThrow(/repetidas/);
  expect(() =>
    buildXrdSet(
      parseTable("MD;Q;C\n10;traza;40", "lab.csv", {
        requireDepth: false,
        preserveRawCells: true,
      }),
      mapping,
      contract,
      "x",
    ),
  ).toThrow(/desconocido/);
});
it("punto interpolado acotado sin extrapolación ni cruce de huecos o zonas", async () => {
  const depth = Float64Array.of(0, 2, 4),
    data = Float64Array.of(0, 20, 40);
  const opts = { maxGapM: 2, minCoverage: 1, shiftM: 0, boundaries: [] };
  expect(
    (await pairXrd(set(), depth, data, Uint16Array.of(0, 16, 0), opts))[0],
  ).toMatchObject({ value: 10, coverage: 1, quality: 16 });
  expect(
    (await pairXrd(set(), depth, data, undefined, { ...opts, maxGapM: 1 }))[0]!
      .reason,
  ).toMatch(/soporte/);
  expect(
    (
      await pairXrd(set(), depth, data, undefined, { ...opts, boundaries: [1] })
    )[0]!.value,
  ).toBeNull();
  expect(
    (await pairXrd(set(-1), depth, data, undefined, opts))[0]!.value,
  ).toBeNull();
});
it("intervalos ponderados por espesor en grilla irregular con integral y dispersión independientes", async () => {
  const r = (
    await pairXrd(
      set(0, 4),
      Float64Array.of(0, 1, 4),
      Float64Array.of(0, 1, 4),
      undefined,
      { maxGapM: 3, minCoverage: 1, shiftM: 0, boundaries: [2] },
    )
  )[0]!;
  expect(r.value).toBeCloseTo(2, 14);
  expect(r.dispersion).toBeCloseTo(Math.sqrt(4 / 3), 14);
  expect(r.coverage).toBe(1);
  expect(r.crossesZone).toBe(true);
});
it("huecos grandes no se asignan al vecino y cobertura insuficiente excluye sin borrar calidad", async () => {
  const d = Float64Array.of(0, 1, 10, 11),
    a = Float64Array.of(0, 10, 100, 110),
    opts = { maxGapM: 1, minCoverage: 0.5, shiftM: 0, boundaries: [] };
  const r = (await pairXrd(set(0, 11), d, a, undefined, opts))[0]!;
  expect(r.value).toBeNull();
  expect(r.coverage).toBeCloseTo(2 / 11, 14);
  expect(r.reason).toMatch(/Cobertura/);
  const s = (
    await pairXrd(set(0, 11), d, a, undefined, { ...opts, minCoverage: 0.1 })
  )[0]!;
  expect(s.value).toBeCloseTo(55, 14);
});
it("respeta decisiones y desplazamientos por corrida y cancela sin publicar tabla parcial", async () => {
  const d = Float64Array.of(0, 1, 2, 3),
    a = Float64Array.of(0, 10, 20, 30),
    opts = { maxGapM: 1, minCoverage: 1, shiftM: 0, boundaries: [] };
  const s = set();
  (s.columns.run!.values as string[])[0] = "R";
  expect(
    (
      await pairXrd(s, d, a, undefined, {
        ...opts,
        decisions: { points: {}, runShifts: { R: 1 }, depthShift: -1 },
      })
    )[0]!.value,
  ).toBe(20);
  expect(
    (
      await pairXrd(s, d, a, undefined, {
        ...opts,
        decisions: { points: { s: { status: "exclude" } } },
      })
    )[0]!.reason,
  ).toMatch(/excluida/);
  await expect(
    pairXrd(s, d, a, undefined, opts, async () => {
      throw new Error("cancelado");
    }),
  ).rejects.toThrow("cancelado");
});
it("archivo v7 conserva contrato, valores y estados de DRX sin crear curvas continuas", async () => {
  const w = createWell({
    id: "w",
    name: "W",
    depth: Float64Array.of(0, 1, 2),
    curves: [],
  });
  const p = addPointSet(
    enableProjectInputRevisions(addWell(createProject(), w)),
    "w",
    set(),
  );
  const q = await deserializeProject(await serializeProject(p));
  expect(q.wells[0]!.well.pointSets[0]).toEqual(set());
  expect(q.wells[0]!.well.curves).toHaveLength(0);
});
