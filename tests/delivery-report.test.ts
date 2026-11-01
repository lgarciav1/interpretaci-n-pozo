import { afterEach, expect, it, vi } from "vitest";
import csv from "../datos/pozo_tp_perfiles.csv?raw";
import { readWellFile } from "../src/io";
import { buildPreparationReport } from "../src/app/report/preparationReport";
import {
  buildReportModel,
  defaultReportOptions,
  reportHtml,
} from "../src/app/report/report";
import { generateReport } from "../src/app/report/reportActions";
import { registry } from "../src/modules";
import { emptyInterpretation } from "../src/core/interpretation";
import { deliveryFixture, deliveryResult } from "./fixtures/delivery";
import { setParam } from "../src/core/state/project";
import { setPointSetSetting } from "../src/core/state/pointSets";
import { reviseProjectInputs } from "../src/core/state/inputRevisions";
import { useProject } from "../src/app/store/project";
import { useResults } from "../src/app/store/results";
import {
  serializeProject,
  deserializeProject,
} from "../src/core/state/serialize";
import {
  buildDataExport,
  exportSources,
} from "../src/app/export/exportActions";

vi.mock("../src/app/export/figureSources", () => ({
  figureEnv: () => ({
    viewer: null,
    xy: [],
    raster: { measure: () => 0 },
    date: new Date(),
  }),
}));
afterEach(() => vi.useRealTimers());

it("informe del TP conserva desconocidos, falta de DRX y diagnóstico con soportes explícitos", () => {
  const { well, zones } = readWellFile(csv, "pozo_tp_perfiles.csv");
  const interpretation = emptyInterpretation(zones);
  const report = buildPreparationReport(well, interpretation, null, registry);
  expect(report.datum).toBeNull();
  expect(report.acquisition).toEqual([]);
  expect(report.diagnostic.total).toMatchObject({
    samples: 5810,
    invalidCaliper: 189,
    washout: 71,
    suspectPe: 5559,
  });
  expect(report.laboratory).toEqual([]);
  expect(report.evidence).toEqual([]);
  const html = reportHtml(buildReportModel(well, interpretation, null));
  expect(html).toContain("Sin laboratorio DRX importado");
  expect(html).toContain("fabricante, modelo y procesado desconocidos");
  expect(html).toContain("criterios predeterminados");
  expect(html).toContain("no confirma baritina");
});
it("resume GR y cutoff aceptados con referencias, base física, métricas y carácter histórico", async () => {
  const p = await deliveryFixture(),
    e = p.wells[0]!;
  const report = buildPreparationReport(
    e.well,
    e.interpretation,
    e.inputRevisionId!,
    registry,
  );
  expect(report.laboratory[0]).toMatchObject({
    samples: 18,
    basis: "Volumen · roca completa · fraction",
  });
  expect(report.evidence).toHaveLength(2);
  expect(report.evidence[0]!.values).toContain("GR limpio 25; GR lutita 135");
  expect(report.evidence[0]!.values).toContain("RMSE por bloques");
  expect(report.evidence[1]!.values).toContain("0.4 → 0.5");
  expect(
    report.evidence.every((r) =>
      r.status.includes("parámetros y revisión coinciden"),
    ),
  ).toBe(true);
  const model = buildReportModel(e.well, e.interpretation, deliveryResult(p));
  const before = reportHtml(model);
  const changed = setParam(p, "w", "grClean", 40, "z").wells[0]!;
  expect(
    buildPreparationReport(
      changed.well,
      changed.interpretation,
      changed.inputRevisionId!,
      registry,
    ).evidence[0]!.status,
  ).toContain("cambiaron");
  expect(reportHtml(model)).toBe(before);
  expect(before).toContain("no revalida soporte");
});
it("versiones futuras/registro corrupto se informan sin aplicarlos ni perderlos, con texto escapado", async () => {
  let p = await deliveryFixture();
  p = setPointSetSetting(
    p,
    "w",
    "lab",
    "xrd:gr-calibration:future",
    '{"version":99}',
  );
  p = setPointSetSetting(
    p,
    "w",
    "lab",
    "xrd:cutoff:bad",
    "<script>evil()</script>",
  );
  const e = p.wells[0]!,
    model = buildReportModel(e.well, e.interpretation, deliveryResult(p));
  expect(model.preparation!.issues).toHaveLength(2);
  expect(reportHtml(model)).not.toContain("<script>evil()");
  expect(reportHtml(model)).toContain("no interpretable");
  expect(e.interpretation.pointSets.lab!.settings!["xrd:cutoff:bad"]).toBe(
    "<script>evil()</script>",
  );
});
it("adquisición se copia como texto y la nueva sección puede omitirse explícitamente", async () => {
  const p = await deliveryFixture(),
    e = p.wells[0]!,
    acquisition = structuredClone(
      p.inputRevisions![e.inputRevisionId!]!.acquisition,
    );
  acquisition.runs = [
    {
      id: "r",
      curveIds: ["gr"],
      tool: { catalogId: "gr", vendor: "<img>", model: null },
      corrections: { status: "unknown", effects: [] },
      mud: {
        salinityPpmNaClEquivalent: null,
        resistivityOhmM: null,
        temperatureC: null,
      },
    },
  ];
  const model = buildReportModel(
    e.well,
    e.interpretation,
    deliveryResult(p),
    new Date(0),
    registry,
    acquisition,
  );
  acquisition.runs[0]!.tool.vendor = "cambió";
  expect(reportHtml(model)).toContain("&lt;img&gt;");
  expect(
    reportHtml(model, [], {
      ...defaultReportOptions(),
      includePreparation: false,
    }),
  ).not.toContain("Diagnóstico de originales");
});
it("rechaza cambiar solo adquisición durante la generación aunque Well y decisiones sigan siendo los mismos", async () => {
  const p = await deliveryFixture(),
    e = p.wells[0]!;
  useProject.getState().replace(p);
  useResults.setState({ result: deliveryResult(p), busy: false, error: null });
  const options = { ...defaultReportOptions(), profile: "none" as const };
  const pending = generateReport(options);
  const acquisition = structuredClone(
    p.inputRevisions![e.inputRevisionId!]!.acquisition,
  );
  acquisition.depth.datum = "Otro datum declarado durante la generación";
  const changed = reviseProjectInputs(p, "w", { acquisition });
  expect(changed.wells[0]!.well).toBe(e.well);
  expect(changed.wells[0]!.interpretation).toBe(e.interpretation);
  useProject.setState({ project: changed });
  await expect(pending).rejects.toThrow(/estado cambió/);
});
it("guardar/abrir reproduce las exportaciones CSV, LAS y xlsx con reloj fijado", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
  const p = await deliveryFixture(),
    restored = await deserializeProject(await serializeProject(p));
  for (const format of ["csv", "las", "xlsx"] as const) {
    const files = [p, restored].map((project) => {
      const e = project.wells[0]!,
        result = deliveryResult(project);
      const selection = exportSources(
        e.well,
        result,
        false,
        result.context,
      ).columns.map((c) => c.id);
      return buildDataExport(
        e.well,
        e.interpretation.zones,
        result,
        {
          format,
          selection,
          zoneId: null,
          depthUnit: "m",
          nullValue: null,
          includeAlternatives: false,
          includeSummary: true,
        },
        result.context,
      );
    });
    expect(files[0]!.samples).toBe(201);
    expect(files[1]!.file.bytes).toEqual(files[0]!.file.bytes);
  }
});
