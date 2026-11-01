/** Pozo y DRX sintéticos de clasificación. No representan una campaña real. */
import { createWell } from "../../src/core/well";
import { createXrdSet, type XrdContract } from "../../src/core/preparation/xrd";
import {
  addWell,
  createProject,
  updateInterpretation,
} from "../../src/core/state/project";
import { enableProjectInputRevisions } from "../../src/core/state/inputRevisions";
import { setPointDecision } from "../../src/core/state/pointSets";
import type { XrdCutoffConfig } from "../../src/core/preparation/xrdCutoff";
export const cutoffContract: XrdContract = {
  version: 1,
  basis: "volume",
  scope: "whole-rock",
  scale: "fraction",
  closureTolerance: 0.01,
  report: "Laboratorio sintético QA de cutoff; no campaña real",
  referenceId: "w",
  datum: "KB declarado",
  minerals: [
    { id: "q", name: "Cuarzo", clay: false },
    { id: "c", name: "Arcillas", clay: true },
  ],
};
export const cutoffConfig: XrdCutoffConfig = {
  zoneId: "z",
  cutoff: 0.5,
  clayClean: 0,
  clayShale: 1,
  relationship:
    "Proxy sintético conocido; extremos composicionales externos 0 y 1 para Zona QA.",
  justification:
    "Criterio operativo sintético para verificar clasificación; sin k ni facies reales, no demuestra calidad de reservorio.",
  reference:
    "Fixture QA sintético de φ/Sw y DRX. No existe evidencia de permeabilidad real.",
  classificationDeclared: true,
};
export const cutoffComparison = {
  curveId: "gr",
  target: "native" as const,
  maxGapM: 1,
  minCoverage: 0.8,
  shiftM: 0,
  densities: {},
};
export function cutoffFixture(contract = cutoffContract, full = true) {
  const depth = Float64Array.from({ length: 41 }, (_, i) => i),
    vsh = Float64Array.from(depth, (d) =>
      d === 6 ? NaN : d <= 10 ? 0.2 : d <= 20 ? 0.5 : 0.8,
    );
  const sample = (id: string, top: number, c: number, base?: number) => ({
    id,
    top,
    ...(base === undefined ? {} : { base }),
    values: {
      q: { value: 1 - c, status: "measured" as const },
      c: { value: c, status: "measured" as const },
    },
  });
  const set = createXrdSet(
    "lab",
    "DRX QA sintético",
    "Fixture de clasificación manual",
    contract,
    [
      sample("S1", 5, 0.2),
      sample("S2", 15, 0.5),
      sample("S2-rep", 15, 0.55),
      sample("S3", 25, 0.8),
      sample("INTERVALO", 11, 0.5, 19),
      sample("CRUZA", 28, 0.8, 32),
      sample("BORDE", 0, 0.2),
      sample("EXCLUIDA", 7, 0.2),
      {
        id: "CENSURADA",
        top: 8,
        values: {
          q: { value: 1, status: "measured" },
          c: { value: NaN, status: "below-detection", detectionLimit: 0.01 },
        },
      },
      sample("HUECO", 6, 0.2),
    ],
  );
  let p = enableProjectInputRevisions(
    addWell(
      createProject("QA P5 cutoff sintético"),
      createWell({
        id: "w",
        name: "Pozo QA sintético",
        depth,
        curves: [
          {
            id: "gr",
            mnemonic: "GR",
            role: "GR",
            unit: "gAPI",
            origin: { kind: "measured" },
            data: Float64Array.from(vsh, (v) => 25 + 110 * v),
          },
          {
            id: "vsh",
            mnemonic: "VSH",
            role: "VSH",
            unit: "v/v",
            origin: { kind: "measured" },
            data: vsh,
          },
          ...(full
            ? [
                {
                  id: "phi",
                  mnemonic: "PHIE",
                  role: "PHIE",
                  unit: "v/v" as const,
                  origin: { kind: "measured" as const },
                  data: new Float64Array(41).fill(0.2),
                },
                {
                  id: "sw",
                  mnemonic: "SW",
                  role: "SW",
                  unit: "v/v" as const,
                  origin: { kind: "measured" as const },
                  data: Float64Array.from(depth, (d) => (d === 15 ? NaN : 0.3)),
                },
              ]
            : []),
        ],
        pointSets: [set],
      }),
      [
        {
          id: "z",
          name: "Zona QA",
          top: 0,
          base: 30,
          color: "#009688",
          kind: "formation",
        },
        {
          id: "other",
          name: "Otra zona",
          top: 31,
          base: 40,
          color: "#f57c00",
          kind: "formation",
        },
      ],
    ),
  );
  p = updateInterpretation(p, "w", (i) => ({
    ...i,
    sources: {
      ...i.sources,
      VSH: { kind: "curve", curveId: "vsh" },
      ...(full
        ? {
            PHIE: { kind: "curve", curveId: "phi" },
            SW: { kind: "curve", curveId: "sw" },
          }
        : {}),
    },
    params: {
      global: {
        grClean: 25,
        grShale: 135,
        "vsh.method": "linear",
        vshCutoff: 0.4,
        phiCutoff: 0.1,
        swCutoff: 0.6,
      },
      zones: {
        z: { vshCutoff: 0.4 },
        other: { vshCutoff: 0.9, grClean: 40, grShale: 170 },
      },
    },
  }));
  return setPointDecision(p, "w", "lab", "EXCLUIDA", { status: "exclude" });
}
