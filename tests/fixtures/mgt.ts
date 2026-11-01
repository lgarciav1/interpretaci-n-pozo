/** Modelo y condiciones QA sintéticos. No representan la herramienta del TP. */
import { createWell } from "../../src/core/well";
import {
  createProject,
  addWell,
  updateInterpretation,
} from "../../src/core/state/project";
import { registerRun } from "../../src/core/state/runs";
import { reviseProjectInputs } from "../../src/core/state/inputRevisions";
import type { MgtConfig } from "../../src/core/preparation/mgt";
export const mgtConfig: MgtConfig = {
  caliperCurveId: "cal",
  position: "centered",
  environment: "open-hole-seawater",
  maxAmbientDepthM: 400,
  temperatureC: 30,
  pressurePsi: 600,
  conditionsReference:
    "QA sintético: agua de mar, posición centrada, caliper y GR en datum Seafloor; máximos de condiciones declarados.",
  uncorrectedReference:
    "QA sintético: GR MGT calibrado en gAPI, sin corrección ambiental de pozo previa.",
  declared: true,
};
export function mgtFixture(caliperUnit = "in", factor = 1) {
  const depth = Float64Array.from({ length: 51 }, (_, i) => 100 + i),
    gr = Float64Array.from(depth, (_, i) => 50 + i);
  gr[0] = 100;
  gr[1] = NaN;
  gr[2] = -1;
  const cal = new Float64Array(51).fill(8.5);
  cal[3] = NaN;
  cal[4] = 17;
  cal[5] = 3.375;
  let p = registerRun(
    addWell(
      createProject("QA MGT sintético"),
      createWell({
        id: "w",
        name: "Pozo MGT QA",
        depth,
        curves: [
          {
            id: "gr",
            mnemonic: "MGT_GR",
            role: "GR",
            unit: "gAPI",
            data: gr,
            origin: {
              kind: "measured",
              source:
                "GR calibrado QA sintético sin corrección ambiental previa",
            },
          },
          {
            id: "cal",
            mnemonic: "CAL",
            role: "CALI",
            unit: caliperUnit,
            data: Float64Array.from(cal, (v) => v * factor),
            origin: { kind: "measured" },
          },
          {
            id: "phi",
            mnemonic: "PHIE",
            role: "PHIE",
            unit: "v/v",
            data: new Float64Array(51).fill(0.2),
            origin: { kind: "measured" },
          },
          {
            id: "sw",
            mnemonic: "SW",
            role: "SW",
            unit: "v/v",
            data: new Float64Array(51).fill(0.3),
            origin: { kind: "measured" },
          },
        ],
      }),
      [
        {
          id: "z",
          name: "Zona QA",
          top: 100,
          base: 125,
          color: "#009688",
          kind: "formation",
        },
        {
          id: "other",
          name: "Otra zona",
          top: 126,
          base: 150,
          color: "#f57c00",
          kind: "formation",
        },
      ],
    ),
    "w",
    "MGT-QA",
    ["gr"],
  );
  const e = p.wells[0]!,
    acquisition = structuredClone(
      p.inputRevisions![e.inputRevisionId!]!.acquisition,
    );
  acquisition.depth.datum = "Seafloor";
  acquisition.runs[0]!.tool = { catalogId: "gr", vendor: "LDEO", model: "MGT" };
  acquisition.runs[0]!.corrections = { status: "declared", effects: [] };
  p = reviseProjectInputs(p, "w", { acquisition });
  return updateInterpretation(p, "w", (i) => ({
    ...i,
    sources: {
      ...i.sources,
      PHIE: { kind: "curve", curveId: "phi" },
      SW: { kind: "curve", curveId: "sw" },
    },
    params: {
      global: {
        grClean: 25,
        grShale: 150,
        "vsh.method": "linear",
        vshCutoff: 0.4,
        phiCutoff: 0.1,
        swCutoff: 0.6,
      },
      zones: { other: { grClean: 55, grShale: 175 } },
    },
  }));
}
