import { describe, expect, it } from "vitest";
import csv from "../datos/pozo_tp_perfiles.csv?raw";
import {
  DEFAULT_DIAGNOSTIC_CRITERIA as criteria,
  defaultDiagnosticSelection,
  diagnosticInputs,
  diagnosticSample,
  summarizeEnvironment,
} from "../src/core/preparation/environmentDiagnostics";
import { createWell, type Curve, type Zone } from "../src/core/well";
import { readWellFile } from "../src/io";
import { detectSuspectPe } from "../src/petro/mineralogy";
import { registry } from "../src/modules";
import {
  invasionParamsAt,
  radialViewAt,
  resolveInvasionInputs,
} from "../src/modules/invasion-step/radial";
import { emptyParamState } from "../src/core/params";

const curve = (role: string, data: number[], unit: string): Curve => ({
  id: role,
  mnemonic: role,
  role,
  unit,
  data: Float64Array.from(data),
  origin: { kind: "measured" },
});
const fixture = () =>
  createWell({
    id: "qa",
    name: "QA",
    depth: Float64Array.from([0, 1, 2, 3, 4, 5]),
    curves: [
      curve("CALI", [8.5, 10, 1.098, NaN, 8, 9.5], "in"),
      curve("BS", [8.5, 8.5, 8.5, 8.5, 8.5, 8.5], "in"),
      curve("PEF", [5, 4, NaN, 5, 5, 5], "b/e"),
      curve("RHOB", [2.4, 2.4, 2.4, 2.55, 2.4, 2.4], "g/cm3"),
      curve("RA10", [1, 1, 0, 1, 1, 1], "ohm.m"),
      curve("RM", [1, 2, 2, NaN, 1, 2], "ohm.m"),
      curve("RT", [1, 4, 4, 4, 1, 4], "ohm.m"),
    ],
  });
const zones: Zone[] = [
  { id: "a", name: "A", top: 0, base: 2, color: "#aaa", kind: "formation" },
  { id: "b", name: "B", top: 3, base: 4, color: "#bbb", kind: "formation" },
];
const summary = (w = fixture()) =>
  summarizeEnvironment(
    w,
    zones,
    diagnosticInputs(w, defaultDiagnosticSelection(w)),
  );

it("separa faltantes, caliper bajo mínimo y pares válidos; conserva bordes estrictos y denominadores", () => {
  const r = summary();
  expect(r.total).toEqual({
    samples: 6,
    invalidCaliper: 1,
    geometryPairs: 4,
    washout: 1,
    belowBit: 1,
    pePairs: 5,
    suspectPe: 3,
    resistivityTriples: 4,
    separated: 2,
    firstReviewIndex: 0,
  });
  expect(r.zones.map((z) => [z.name, z.counts.samples])).toEqual([
    ["A", 3],
    ["B", 2],
    ["Fuera de zonas", 1],
  ]);
  // Igual a la tolerancia no se marca como ensanchamiento.
  const w = fixture(),
    i = diagnosticInputs(w, defaultDiagnosticSelection(w));
  expect(diagnosticSample(w, i, 5, criteria).geometry).toBe("within-tolerance");
  expect(diagnosticSample(w, i, 3, criteria).suspectPe).toBe(false);
  expect(diagnosticSample(w, i, 2, criteria).suspectPe).toBe(null);
});
it("tramo inclusivo, muestra puntual, zonas y fuera de zonas preservan sus soportes", () => {
  const w = fixture(),
    i = diagnosticInputs(w, defaultDiagnosticSelection(w));
  expect(
    summarizeEnvironment(w, zones, i, criteria, { top: 1, base: 3 }).total
      .samples,
  ).toBe(3);
  const point = summarizeEnvironment(w, zones, i, criteria, {
    top: 2,
    base: 2,
  });
  expect(point.total.samples).toBe(1);
  expect(point.total.invalidCaliper).toBe(1);
  expect(
    summarizeEnvironment(w, zones, i, criteria, { top: 20, base: 30 }).total
      .samples,
  ).toBe(0);
  expect(() =>
    summarizeEnvironment(w, zones, i, criteria, { top: NaN, base: 3 }),
  ).toThrow(/tramo/);
  expect(() =>
    summarizeEnvironment(w, zones, i, criteria, { top: 4, base: 3 }),
  ).toThrow(/tramo/);
});
it("unidades equivalentes en caliper, BS y densidad producen el mismo diagnóstico", () => {
  const a = fixture(),
    b = fixture();
  for (const c of b.curves) {
    if (c.role === "CALI" || c.role === "BS") {
      c.unit = "cm";
      c.data = c.data.map((v) => v * 2.54);
    }
    if (c.role === "RHOB") {
      c.unit = "kg/m3";
      c.data = c.data.map((v) => v * 1000);
    }
  }
  expect(summary(b).total).toEqual(summary(a).total);
  expect(summary(b).inputs.find((c) => c.role === "CALI")).toMatchObject({
    originalUnit: "cm",
    canonicalUnit: "in",
  });
});
it("sin BS no inventa trépano ni revoque, y sin entradas no clasifica ausencia de alertas como soporte válido", () => {
  const w = fixture();
  w.curves = w.curves.filter((c) => c.role !== "BS");
  expect(summary(w).total.geometryPairs).toBe(0);
  const empty = summarizeEnvironment(w, zones, diagnosticInputs(w, {}));
  expect(empty.total).toMatchObject({
    samples: 6,
    geometryPairs: 0,
    pePairs: 0,
    resistivityTriples: 0,
  });
});
it("varias curvas con el mismo rol exigen selección; entradas inválidas explícitas nunca caen a otra", () => {
  const w = fixture();
  w.curves.push({ ...w.curves[0]!, id: "CAL2" });
  const selected = defaultDiagnosticSelection(w);
  expect(selected.CALI).toBeUndefined();
  expect(diagnosticInputs(w, selected).issues.join()).toContain(
    "varias curvas",
  );
  for (const invalid of ["does-not-exist", "BS"]) {
    const i = diagnosticInputs(w, { ...selected, CALI: invalid });
    expect(i.bindings.CALI).toBeUndefined();
    expect(i.issues.join()).toContain("seleccionada");
  }
  w.curves[0]!.unit = "unknown";
  expect(diagnosticInputs(w, { CALI: "CALI" }).bindings.CALI).toBeUndefined();
  w.curves[0]!.unit = "in";
  w.curves[0]!.origin = { kind: "prepared" };
  expect(diagnosticInputs(w, { CALI: "CALI" }).bindings.CALI).toBeUndefined();
});
it("criterios modificados cambian el conteo sin mutar arrays, zonas o selección; inválidos se rechazan", () => {
  const w = fixture(),
    selected = defaultDiagnosticSelection(w),
    i = diagnosticInputs(w, selected),
    before = structuredClone(w);
  const r = summarizeEnvironment(w, zones, i, {
    ...criteria,
    minCaliperIn: 1,
    washoutToleranceIn: 0.5,
  });
  expect(r.total.invalidCaliper).toBe(0);
  expect(r.total.washout).toBe(2);
  expect(w).toEqual(before);
  expect(i.selected).toEqual(selected);
  for (const c of [
    { ...criteria, minCaliperIn: NaN },
    { ...criteria, minSeparation: 0 },
    { ...criteria, washoutToleranceIn: -1 },
  ])
    expect(() => summarizeEnvironment(w, zones, i, c)).toThrow(/criterios/);
  expect(() => diagnosticSample(w, i, -1, criteria)).toThrow(/Muestra/);
});

describe("CSV real disponible del TP, sin completar metadatos de adquisición", () => {
  const { well, zones: tpZones } = readWellFile(csv, "pozo_tp_perfiles.csv");
  const input = diagnosticInputs(well, defaultDiagnosticSelection(well));
  const r = summarizeEnvironment(well, tpZones, input);
  it("reproduce 5810 muestras/189 caliper bajos y el criterio PE existente, con agregación zonal consistente", () => {
    expect(r.total.samples).toBe(5810);
    expect(r.total.invalidCaliper).toBe(189);
    // Contraste adicional con un barrido independiente del CSV en Python, sin importar producción.
    expect(r.total).toMatchObject({
      geometryPairs: 5621,
      washout: 71,
      belowBit: 4550,
      pePairs: 5810,
      suspectPe: 5559,
      resistivityTriples: 5810,
      separated: 3882,
    });
    expect(r.inputs.map((c) => c.mnemonic)).toEqual(
      expect.arrayContaining([
        "CAL",
        "BS",
        "ZDEN",
        "PE",
        "AT10",
        "AT30",
        "AT60",
        "AT90",
      ]),
    );
    const pe = detectSuspectPe(
      input.bindings.PEF!.curve.data,
      input.bindings.RHOB!.curve.data,
    );
    expect(r.total.pePairs).toBe(pe.samples);
    expect(r.total.suspectPe / r.total.pePairs).toBeCloseTo(pe.fraction, 12);
    for (const k of [
      "samples",
      "invalidCaliper",
      "geometryPairs",
      "washout",
      "belowBit",
      "pePairs",
      "suspectPe",
      "resistivityTriples",
      "separated",
    ] as const)
      expect(r.zones.reduce((s, z) => s + z.counts[k], 0)).toBe(r.total[k]);
    expect(r.issues).toEqual([]);
  });
  it("la muestra radial usa las originales seleccionadas y el evaluador existente, sin preparar ni cambiar entradas", () => {
    const before = well.curves.map((c) => c.data.slice());
    const selected = Object.values(input.bindings).map((b) => b!.curve);
    const readings = resolveInvasionInputs(selected, [], null, registry.roles);
    const params = invasionParamsAt(emptyParamState(), null);
    const v = radialViewAt(readings, 1000, well.depth.values[1000]!, params, {
      bitIn: input.bindings.BS!.at(1000),
    });
    expect(v.readings).toHaveLength(4);
    expect(v.fit.nCurves).toBe(4);
    expect(v.readings.find((c) => c.role === "RT")!.observed).toBe(
      input.bindings.RT!.at(1000),
    );
    for (let n = 0; n < before.length; n++)
      expect(well.curves[n]!.data).toEqual(before[n]);
  });
});
