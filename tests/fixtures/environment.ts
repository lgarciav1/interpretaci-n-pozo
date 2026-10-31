/** Adquisición sintética para P6a. Los modelos/referencias son declaraciones QA, no datos de campo. */
import { createWell, type Curve } from "../../src/core/well";
import { createProject, addWell } from "../../src/core/state/project";
import { registerRun } from "../../src/core/state/runs";
import type { AcquisitionRun } from "../../src/core/inputs/acquisition";
export const environmentDeclaration: Pick<
  AcquisitionRun,
  "tool" | "corrections"
> = {
  tool: {
    catalogId: "density",
    vendor: "Proveedor QA sintético",
    model: "Modelo QA sin admisión numérica",
  },
  corrections: {
    status: "declared",
    effects: [
      {
        effect: "borehole",
        method: "Compensación del proveedor QA",
        version: "QA-1",
        reference:
          "Informe sintético de procesado QA, página 1; no evidencia de campo",
      },
    ],
  },
};
export function environmentFixture() {
  const curves: Curve[] = [
    {
      id: "gr",
      mnemonic: "GR",
      role: "GR",
      unit: "gAPI",
      origin: { kind: "measured" },
      data: Float64Array.of(30, 50, 70, 90, 110),
    },
    {
      id: "rho",
      mnemonic: "RHOB",
      role: "RHOB",
      unit: "g/cm3",
      origin: { kind: "measured" },
      data: Float64Array.of(2.3, 2.35, 2.4, 2.45, 2.5),
    },
    {
      id: "pe",
      mnemonic: "PE",
      role: "PEF",
      unit: "b/e",
      origin: { kind: "measured" },
      data: new Float64Array(5).fill(3),
    },
    {
      id: "rt",
      mnemonic: "AT90",
      role: "RT",
      unit: "ohm.m",
      origin: { kind: "measured" },
      data: Float64Array.of(2, 3, 4, 5, 6),
    },
    {
      id: "cal",
      mnemonic: "CAL",
      role: "CALI",
      unit: "in",
      origin: { kind: "measured" },
      data: new Float64Array(5).fill(9),
    },
    {
      id: "bs",
      mnemonic: "BS",
      role: "BS",
      unit: "in",
      origin: { kind: "measured" },
      data: new Float64Array(5).fill(8.5),
    },
  ];
  let p = addWell(
    createProject("QA P6a sintético"),
    createWell({
      id: "w",
      name: "Pozo QA ambiental",
      depth: Float64Array.of(0, 1, 2, 3, 4),
      curves,
    }),
  );
  p = registerRun(p, "w", "DENS-QA", ["rho", "pe"]);
  return registerRun(p, "w", "IND-QA", ["rt"]);
}
