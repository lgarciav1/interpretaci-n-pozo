import { expect, it } from "vitest";
import {
  environmentDeclaration,
  environmentFixture,
} from "./fixtures/environment";
import {
  ENVIRONMENT_CANDIDATES,
  reviewEnvironment,
} from "../src/core/preparation/environment";
import { unknownAcquisition } from "../src/core/inputs/acquisition";
import { updateRunAcquisition } from "../src/core/state/acquisition";
import { registry } from "../src/modules";
import { setParam } from "../src/core/state/project";
import { reviseProjectInputs } from "../src/core/state/inputRevisions";
import {
  addMaskInterval,
  entryPreparationPlan,
} from "../src/core/state/preparation";
import { MaskEvaluator } from "../src/core/preparation/evaluate";
import { toEngineWell } from "../src/core/engine/engine";
import {
  serializeProject,
  deserializeProject,
} from "../src/core/state/serialize";
import { createSnapshot, restoreSnapshot } from "../src/core/state/snapshots";
import { useProject } from "../src/app/store/project";
const current = (p: ReturnType<typeof environmentFixture>) =>
  p.inputRevisions![p.wells[0]!.inputRevisionId!]!;
const review = (p = environmentFixture(), id = "rho") =>
  reviewEnvironment(
    p.wells[0]!.well,
    current(p).acquisition,
    p.wells[0]!.well.curves.find((c) => c.id === id)!,
    registry.tools,
  );
it("el catálogo de seis familias distingue descripción de admisión y no ofrece evaluadores ejecutables", () => {
  expect(ENVIRONMENT_CANDIDATES).toHaveLength(6);
  for (const c of ENVIRONMENT_CANDIDATES) {
    expect(c.admission).toEqual({
      status: "not-admitted",
      algorithmVersion: null,
      chartVersion: null,
      domain: null,
      redistribution: null,
      independentCases: [],
    });
    expect(c.reference.url).toMatch(/^https:\/\/glossary.slb.com\//);
  }
  const p = environmentFixture(),
    q = updateRunAcquisition(
      p,
      p,
      "w",
      "DENS-QA",
      environmentDeclaration,
      registry.tools,
    );
  expect(review(q)[0]!.executable).toBe(false);
  expect(
    review(q)[0]!.blockers.some((b) => b.code === "scientific-admission"),
  ).toBe(true);
});
it("la atribución AT90/RT no inventa corrida, modelo ni procesado, ni elige una física por tener el mismo rol", () => {
  const e = environmentFixture().wells[0]!,
    curve = e.well.curves.find((c) => c.id === "rt")!;
  const reviews = reviewEnvironment(
    e.well,
    unknownAcquisition(),
    curve,
    registry.tools,
  );
  expect(reviews).toHaveLength(2);
  expect(
    reviews.every(
      (r) =>
        r.attributedTool === "Inducción" && r.run === null && !r.executable,
    ),
  ).toBe(true);
  expect(reviews[0]!.blockers.map((b) => b.code)).toContain("run");
  const registered = review(environmentFixture(), "rt")[0]!;
  expect(registered.blockers.map((b) => b.code)).toEqual(
    expect.arrayContaining(["tool", "model", "processing-unknown"]),
  );
});
it("releva curvas y unidades sin inventar DRHO y mantiene explícita la advertencia de doble corrección", () => {
  const r = review()[0]!;
  expect(
    r.survey.map((s) => [s.label, s.curves.map((c) => c.mnemonic)]),
  ).toEqual([
    ["Caliper", ["CAL"]],
    ["Trépano", ["BS"]],
    ["Corrección de densidad del proveedor", []],
  ]);
  expect(r.candidate.limitation).toContain("no autoriza sumarla a RHOB");
  const p = environmentFixture(),
    q = updateRunAcquisition(
      p,
      p,
      "w",
      "DENS-QA",
      environmentDeclaration,
      registry.tools,
    );
  expect(review(q)[0]!.blockers.some((b) => b.code === "already-applied")).toBe(
    true,
  );
  expect(review(q)[0]!.executable).toBe(false);
});
it("el estado declarado vacío no prueba que el perfil esté crudo; efectos desconocidos no se tratan como compatibles", () => {
  const p = environmentFixture();
  const empty = updateRunAcquisition(
    p,
    p,
    "w",
    "DENS-QA",
    {
      ...environmentDeclaration,
      corrections: { status: "declared", effects: [] },
    },
    registry.tools,
  );
  expect(
    review(empty)[0]!.blockers.some((b) => b.code === "empty-history"),
  ).toBe(true);
  const unknown = updateRunAcquisition(
    p,
    p,
    "w",
    "DENS-QA",
    {
      ...environmentDeclaration,
      corrections: {
        status: "declared",
        effects: [
          {
            ...environmentDeclaration.corrections.effects[0]!,
            effect: "vendor-effect-future",
          },
        ],
      },
    },
    registry.tools,
  );
  expect(
    review(unknown)[0]!.blockers.some((b) => b.code === "unclassified-effect"),
  ).toBe(true);
});
it("declara incompatibilidades de herramienta/unidad/origen sin convertir ni sustituir la curva", () => {
  const p = environmentFixture(),
    q = updateRunAcquisition(
      p,
      p,
      "w",
      "DENS-QA",
      {
        ...environmentDeclaration,
        tool: { ...environmentDeclaration.tool, catalogId: "neutron" },
      },
      registry.tools,
    );
  expect(review(q)[0]!.blockers.some((b) => b.code === "tool-mismatch")).toBe(
    true,
  );
  const e = p.wells[0]!,
    rho = e.well.curves.find((c) => c.id === "rho")!;
  const r = reviewEnvironment(
    e.well,
    current(p).acquisition,
    {
      ...rho,
      unit: "kg/m3",
      origin: { kind: "computed", moduleId: "unknown", port: "RHOB" },
    },
    registry.tools,
  )[0]!;
  expect(r.blockers.map((b) => b.code)).toEqual(
    expect.arrayContaining(["unit", "original"]),
  );
  expect(
    reviewEnvironment(
      e.well,
      current(p).acquisition,
      { ...rho, role: null },
      registry.tools,
    ),
  ).toEqual([]);
});
it("revisar no migra ni muta el proyecto; declarar crea revisión sin cambiar medidas, fuentes, parámetros u otras corridas", () => {
  const p = environmentFixture(),
    before = current(p),
    original = p.wells[0]!,
    prior = JSON.stringify(before.acquisition);
  review(p);
  expect(JSON.stringify(before.acquisition)).toBe(prior);
  const q = updateRunAcquisition(
      p,
      p,
      "w",
      "DENS-QA",
      environmentDeclaration,
      registry.tools,
    ),
    after = current(q);
  expect(after.parentRevisionId).toBe(before.id);
  expect(after.id).not.toBe(before.id);
  expect(after.well).toBe(before.well);
  expect(after.acquisition.runs[1]).toBe(before.acquisition.runs[1]);
  expect(after.acquisition.runs[0]!.mud).toBe(before.acquisition.runs[0]!.mud);
  expect(q.wells[0]!.interpretation).toBe(original.interpretation);
  expect(q.inputRevisions![before.id]).toBe(before);
  expect(
    updateRunAcquisition(
      q,
      q,
      "w",
      "DENS-QA",
      structuredClone(environmentDeclaration),
      registry.tools,
    ),
  ).toBe(q);
  expect(Object.isFrozen(after.acquisition.runs[0]!.corrections.effects)).toBe(
    true,
  );
});
it("rechaza contexto obsoleto, corrida inexistente, catálogo nuevo desconocido, efecto sin referencia, duplicados y desconocido contradictorio", () => {
  const p = environmentFixture(),
    changed = setParam(p, "w", "grClean", 25, null);
  expect(() =>
    updateRunAcquisition(
      changed,
      p,
      "w",
      "DENS-QA",
      environmentDeclaration,
      registry.tools,
    ),
  ).toThrow(/Cambió el proyecto/);
  expect(() =>
    updateRunAcquisition(
      p,
      p,
      "w",
      "missing",
      environmentDeclaration,
      registry.tools,
    ),
  ).toThrow(/ya no existe/);
  expect(() =>
    updateRunAcquisition(
      p,
      p,
      "w",
      "DENS-QA",
      {
        ...environmentDeclaration,
        tool: { ...environmentDeclaration.tool, catalogId: "invented" },
      },
      registry.tools,
    ),
  ).toThrow(/catálogo/);
  const effect = environmentDeclaration.corrections.effects[0]!;
  for (const corrections of [
    { status: "unknown" as const, effects: [effect] },
    { status: "declared" as const, effects: [effect, effect] },
    { status: "declared" as const, effects: [{ ...effect, reference: "" }] },
  ])
    expect(() =>
      updateRunAcquisition(
        p,
        p,
        "w",
        "DENS-QA",
        { ...environmentDeclaration, corrections },
        registry.tools,
      ),
    ).toThrow();
});
it("preserva ids/effectos desconocidos importados al editar otros campos y conserva propiedades de lodo sin reinterpretarlas", async () => {
  let p = environmentFixture();
  const a = structuredClone(current(p).acquisition);
  a.runs[0]!.tool.catalogId = "vendor-tool-not-in-catalog";
  a.runs[0]!.mud = {
    salinityPpmNaClEquivalent: 10000,
    resistivityOhmM: 0.5,
    temperatureC: 24,
  };
  a.runs[0]!.corrections = {
    status: "declared",
    effects: [
      {
        effect: "vendor-effect-future",
        method: "Vendor",
        version: "V9",
        reference: "Documento preservado",
      },
    ],
  };
  p = reviseProjectInputs(p, "w", { acquisition: a });
  const r = current(p).acquisition.runs[0]!,
    q = updateRunAcquisition(
      p,
      p,
      "w",
      r.id,
      {
        tool: { ...r.tool, model: "Modelo confirmado QA" },
        corrections: r.corrections,
      },
      registry.tools,
    );
  const reopened = await deserializeProject(await serializeProject(q));
  expect(current(reopened).acquisition.runs[0]).toEqual({
    ...r,
    tool: { ...r.tool, model: "Modelo confirmado QA" },
  });
  expect(
    review(reopened)[0]!.blockers.some((b) => b.code === "unclassified-effect"),
  ).toBe(true);
});
it("una edición de adquisición es una sola entrada de historial y snapshot restaura la declaración previa después de guardar/abrir", async () => {
  const p = environmentFixture(),
    snap = createSnapshot(p, "w", "Adquisición desconocida"),
    q = updateRunAcquisition(
      snap.project,
      snap.project,
      "w",
      "DENS-QA",
      environmentDeclaration,
      registry.tools,
    );
  useProject.getState().replace(snap.project);
  useProject.getState().commit("Declarar adquisición", () => q);
  expect(useProject.getState().history.past).toHaveLength(1);
  useProject.getState().undo();
  expect(useProject.getState().project).toBe(snap.project);
  useProject.getState().redo();
  expect(useProject.getState().project).toBe(q);
  const reopened = await deserializeProject(await serializeProject(q));
  expect(current(reopened).acquisition.runs[0]!.tool).toEqual(
    environmentDeclaration.tool,
  );
  const restored = restoreSnapshot(reopened, snap.snapshot.id);
  expect(current(restored).acquisition).toEqual(current(p).acquisition);
  expect(restored.wells[0]!.inputRevisionId).toBe(p.wells[0]!.inputRevisionId);
});
it("con preparación existente, cambia el contexto de revisión y preserva exactamente máscara, valores y calidad derivados", async () => {
  const p = addMaskInterval(
      environmentFixture(),
      "w",
      "rho",
      { id: "bad", top: 1, base: 1 },
      "mask-rho",
    ),
    q = updateRunAcquisition(
      p,
      p,
      "w",
      "DENS-QA",
      environmentDeclaration,
      registry.tools,
    );
  const before = entryPreparationPlan(p, p.wells[0]!, registry),
    after = entryPreparationPlan(q, q.wells[0]!, registry),
    evaluator = new MaskEvaluator();
  expect(after.context.inputRevisionId).not.toBe(
    before.context.inputRevisionId,
  );
  expect(after.context.preparationKey).toBe(before.context.preparationKey);
  const out1 = await evaluator.evaluate(toEngineWell(p.wells[0]!.well), before),
    out2 = await evaluator.evaluate(toEngineWell(q.wells[0]!.well), after);
  expect(out2).toEqual(out1);
  expect(q.wells[0]!.interpretation).toBe(p.wells[0]!.interpretation);
});
