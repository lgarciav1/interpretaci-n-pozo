/** Ejemplo explícitamente sintético de entrega; no es laboratorio del TP. */
import known from "./xrd-gr-known.json";
import { createWell } from "../../src/core/well";
import { createXrdSet } from "../../src/core/preparation/xrd";
import { resolveDataContext } from "../../src/core/preparation/projection";
import { proposeGrCalibration } from "../../src/core/preparation/xrdCalibration";
import { proposeXrdCutoff } from "../../src/core/preparation/xrdCutoff";
import { DEFAULT_GR_POLICY } from "../../src/petro/xrdCalibration";
import {
  addWell,
  createProject,
  updateInterpretation,
  type Project,
} from "../../src/core/state/project";
import { applyGrCalibration } from "../../src/core/state/xrdCalibration";
import {
  applyXrdCutoff,
  previewXrdCutoff,
} from "../../src/core/state/xrdCutoff";
import { entryPreparationPlan } from "../../src/core/state/preparation";
import { Engine, toEngineWell } from "../../src/core/engine/engine";
import type { ClientResult } from "../../src/core/engine/client";
import { registry } from "../../src/modules";
import { enableProjectInputRevisions } from "../../src/core/state/inputRevisions";

export function deliveryResult(p: Project): ClientResult {
  const e = p.wells[0]!,
    engine = new Engine(registry);
  engine.setWell(toEngineWell(e.well));
  return {
    ...engine.run(e.interpretation),
    wellId: e.well.id,
    seq: 1,
    gen: 1,
    roundTripMs: 0,
    coalesced: 0,
    context: entryPreparationPlan(p, e, registry).context,
  };
}
export async function deliveryFixture(): Promise<Project> {
  const depth = Float64Array.from({ length: 201 }, (_, i) => i);
  const gr = Float64Array.from(depth, (d) => 25 + 110 * ((d % 60) / 60));
  const samples = Array.from({ length: 18 }, (_, i) => {
    const top = 10 + 10 * i,
      clay = known.igr[i % known.igr.length]!;
    gr[top] = 25 + 110 * clay;
    return {
      id: `S${i}`,
      top,
      values: {
        q: { value: 1 - clay, status: "measured" as const },
        c: { value: clay, status: "measured" as const },
      },
    };
  });
  const lab = createXrdSet(
    "lab",
    "DRX sintético de entrega",
    "Fixture matemático; no campaña real",
    {
      version: 1,
      basis: "volume",
      scope: "whole-rock",
      scale: "fraction",
      closureTolerance: 0.01,
      report:
        "Ensayo sintético independiente para QA P8; no representa laboratorio del TP.",
      referenceId: "w",
      datum: "KB sintético",
      minerals: [
        { id: "q", name: "Cuarzo", clay: false },
        { id: "c", name: "Arcillas", clay: true },
      ],
    },
    samples,
  );
  const original = addWell(
    createProject("Ejemplo sintético P8; no TP real"),
    createWell({
      id: "w",
      name: "Ejemplo sintético P8",
      depth,
      pointSets: [lab],
      curves: [
        {
          id: "gr",
          mnemonic: "GR",
          role: "GR",
          unit: "gAPI",
          data: gr,
          origin: { kind: "measured", source: "QA sintético" },
        },
        {
          id: "phi",
          mnemonic: "PHIE",
          role: "PHIE",
          unit: "v/v",
          data: new Float64Array(201).fill(0.2),
          origin: { kind: "measured", source: "QA sintético" },
        },
        {
          id: "sw",
          mnemonic: "SW",
          role: "SW",
          unit: "v/v",
          data: new Float64Array(201).fill(0.3),
          origin: { kind: "measured", source: "QA sintético" },
        },
      ],
    }),
    [
      {
        id: "z",
        name: "Zona sintética",
        top: 0,
        base: 200,
        color: "#168777",
        kind: "formation",
      },
    ],
  );
  let p = updateInterpretation(original, "w", (i) => ({
    ...i,
    params: {
      global: {
        grClean: 50,
        grShale: 160,
        "vsh.method": "linear",
        vshCutoff: 0.4,
        phiCutoff: 0.1,
        swCutoff: 0.6,
      },
      zones: {},
    },
    sources: {
      ...i.sources,
      PHIE: { kind: "curve", curveId: "phi" },
      SW: { kind: "curve", curveId: "sw" },
    },
  }));
  p = enableProjectInputRevisions(p);
  const comparison = {
    curveId: "gr",
    target: "native" as const,
    maxGapM: 1,
    minCoverage: 0.8,
    shiftM: 0,
    densities: {},
  };
  let e = p.wells[0]!;
  const proposal = await proposeGrCalibration(
    resolveDataContext(e.well, e.interpretation, registry, e.inputRevisionId!),
    e.interpretation,
    lab,
    comparison,
    e.inputRevisionId!,
    {
      version: 1,
      method: "linear",
      zoneId: "z",
      clayClean: 0,
      clayShale: 1,
      relationship:
        "Proxy sintético explícito de Vsh con extremos 0 y 1; no equivalencia universal arcilla/lutita.",
      independentReference:
        "Fixture Python Decimal de casos conocidos; laboratorio sintético independiente del ajuste.",
      independenceDeclared: true,
      policy: { ...DEFAULT_GR_POLICY },
    },
    registry,
  );
  p = applyGrCalibration(p, p, "w", "lab", proposal, registry);
  e = p.wells[0]!;
  const baseline = deliveryResult(p);
  const cutoff = await proposeXrdCutoff(
    resolveDataContext(e.well, e.interpretation, registry, e.inputRevisionId!),
    e.interpretation,
    lab,
    comparison,
    e.inputRevisionId!,
    {
      zoneId: "z",
      cutoff: 0.5,
      clayClean: 0,
      clayShale: 1,
      relationship:
        "Proxy sintético explícito de Vsh a partir de composición de sólidos.",
      justification:
        "Umbral operativo sintético para verificar la entrega; no demuestra permeabilidad real.",
      reference:
        "QA P8 sintético con porosidad y Sw conocidas; no datos reales de producción.",
      classificationDeclared: true,
    },
    baseline,
    registry,
  );
  const draft = previewXrdCutoff(p, p, "w", "lab", cutoff, registry);
  return applyXrdCutoff(
    p,
    p,
    "w",
    "lab",
    cutoff,
    baseline,
    deliveryResult(draft),
    registry,
  );
}
