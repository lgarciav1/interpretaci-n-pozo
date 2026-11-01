import { useEffect, useRef, useState } from "react";
import {
  XrdCalibrationPanel,
  XrdCalibrationHistory,
} from "./XrdCalibrationPanel";
import { XrdLaboratory } from "./XrdLaboratory";
import { XrdCutoffPanel, XrdCutoffHistory } from "./XrdCutoffPanel";
import { parseTable, type RawTable } from "../../io";
import { buildXrdSet, type XrdMapping } from "../../io/xrd";
import {
  xrdComposition,
  xrdContract,
  type XrdContract,
} from "../../core/preparation/xrd";
import { acceptXrdComparison } from "../../core/state/xrd";
import {
  evaluateXrdComparison,
  xrdInputDigest,
  exportXrdComparisonCsv,
  readXrdRecord,
  XRD_COMPARISON_SETTING,
  type XrdComparisonRecord,
  type XrdComparisonRow,
} from "../../core/preparation/xrdEvidence";
import { addPointSet } from "../../core/state/pointSets";
import { enableProjectInputRevisions } from "../../core/state/inputRevisions";
import { entryPreparationPlan } from "../../core/state/preparation";
import { makeId, type Project, type WellEntry } from "../../core/state/project";
import { sameContext } from "../../core/engine/context";
import { resolveDataContext } from "../../core/preparation/projection";
import { registry } from "../../modules";
import { preparedData } from "../../app/preparation/data";
import { useResults } from "../../app/store/results";
import { useProject } from "../../app/store/project";
import { Button, Callout, Checkbox, Field, Select, TextField } from "../../ui";

const decimal = (value: string) =>
  value.trim() ? Number(value.trim().replace(",", ".")) : NaN;

export function XrdPanel({
  project,
  entry,
}: {
  project: Project;
  entry: WellEntry;
}) {
  const [table, setTable] = useState<RawTable | null>(null),
    [mapping, setMapping] = useState<XrdMapping>({
      depth: 0,
      base: null,
      sampleId: null,
      run: null,
      minerals: {},
      depthUnit: "m",
    });
  const [contract, setContract] = useState<XrdContract>({
    version: 1,
    basis: "mass",
    scope: "whole-rock",
    scale: "percent",
    closureTolerance: 0.02,
    report: "",
    referenceId: entry.well.id,
    datum: "",
    minerals: [],
  });
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ReturnType<typeof buildXrdSet> | null>(
      null,
    ),
    [setId, setSetId] = useState(""),
    [curveId, setCurveId] = useState("");
  const [gap, setGap] = useState(""),
    [coverage, setCoverage] = useState("0.8"),
    [shift, setShift] = useState("0"),
    [target, setTarget] = useState<"native" | "solid-volume">("native"),
    [densities, setDensities] = useState<Record<string, string>>({});
  const [densityReferences, setDensityReferences] = useState<
    Record<string, string>
  >({});
  const [densityUncertainties, setDensityUncertainties] = useState<
    Record<string, string>
  >({});
  const [comparison, setComparison] = useState<{
      base: Project;
      key: string;
      rows: XrdComparisonRow[];
      record: XrdComparisonRecord;
      verification: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const previewBase = useRef<Project | null>(null);
  const task = useRef(0),
    result = useResults((s) => s.result);
  useEffect(
    () => () => {
      task.current++;
    },
    [],
  );
  const sets = entry.well.pointSets.filter((s) => s.kind === "xrd"),
    set = sets.find((s) => s.id === setId);
  const comparisonKey = JSON.stringify([
    setId,
    curveId,
    gap,
    coverage,
    shift,
    target,
    densities,
    densityReferences,
    densityUncertainties,
  ]);
  const currentDraft = useRef(comparisonKey);
  currentDraft.current = comparisonKey;
  const selectSet = (id: string) => {
    setSetId(id);
    setDensities({});
    setDensityReferences({});
    setDensityUncertainties({});
    setTarget("native");
    setComparison(null);
    setError("");
  };
  let data: ReturnType<typeof resolveDataContext> | null = null,
    problem = "";
  try {
    const plan = entryPreparationPlan(project, entry, registry);
    if (entry.interpretation.preparation?.nodes.length) {
      if (!result || !sameContext(result.context, plan.context))
        throw new Error("Esperá resultados vigentes de preparación.");
      data = preparedData(entry.well, result);
      if (!data) throw new Error("Falta preparación publicada.");
    } else
      data = resolveDataContext(
        entry.well,
        entry.interpretation,
        registry,
        entry.inputRevisionId ?? null,
      );
  } catch (e) {
    problem = String(e);
  }
  let savedRecord: XrdComparisonRecord | null = null,
    savedError = "";
  try {
    savedRecord = readXrdRecord(
      entry.interpretation.pointSets[setId]?.settings?.[XRD_COMPARISON_SETTING],
    );
  } catch (e) {
    savedError = String(e);
  }
  const restoreSaved = () => {
    if (!savedRecord) return;
    const c = savedRecord.config;
    setCurveId(c.curveId);
    setGap(String(c.maxGapM));
    setCoverage(String(c.minCoverage));
    setShift(String(c.shiftM));
    setTarget(c.target);
    setDensities(
      Object.fromEntries(
        Object.entries(c.densities).map(([id, d]) => [id, String(d.value)]),
      ),
    );
    setDensityReferences(
      Object.fromEntries(
        Object.entries(c.densities).map(([id, d]) => [id, d.reference]),
      ),
    );
    setDensityUncertainties(
      Object.fromEntries(
        Object.entries(c.densities).map(([id, d]) => [
          id,
          d.uncertainty === undefined ? "" : String(d.uncertainty),
        ]),
      ),
    );
    setComparison(null);
  };
  const options = [
    { value: "", label: "Sin asignar" },
    ...(table?.columns.map((c, i) => ({ value: String(i), label: c.name })) ??
      []),
  ];
  const change = () => {
    setPreview(null);
  };
  return (
    <details>
      <summary>DRX · carga y comparación diagnóstica</summary>
      <section aria-label="Diagnóstico DRX">
        <p>
          DRX mide minerales: contenido de arcillas y Vsh son magnitudes
          diferentes. Esta etapa no calibra GR ni modifica cutoffs. Archivos
          homogéneos por ensayo; separá bases distintas. Profundidad MD y datum
          compartidos deben estar confirmados antes de comparar.
        </p>
        <input
          aria-label="Archivo DRX CSV o Excel"
          type="file"
          accept=".csv,.tsv,.xlsx"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const t = parseTable(await f.arrayBuffer(), f.name, {
                requireDepth: false,
                preserveRawCells: true,
              });
              setTable(t);
              setMapping({
                depth: Math.max(0, t.depthColumn),
                base: null,
                sampleId: null,
                run: null,
                minerals: {},
                depthUnit: "m",
              });
              setContract((c) => ({ ...c, minerals: [] }));
              setPreview(null);
              setError("");
            } catch (err) {
              setError(String(err));
            }
          }}
        />
        {table && (
          <>
            {(["depth", "base", "sampleId", "run"] as const).map((k) => (
              <Field
                key={k}
                label={
                  {
                    depth: "Profundidad/tope DRX",
                    base: "Base DRX (solo intervalos)",
                    sampleId: "Identificador de muestra",
                    run: "Corrida/corona de muestra",
                  }[k]
                }
              >
                <Select
                  aria-label={`DRX ${k}`}
                  value={mapping[k] === null ? "" : String(mapping[k])}
                  onChange={(v) => {
                    change();
                    setMapping((m) => ({
                      ...m,
                      [k]: v === "" ? null : Number(v),
                    }));
                  }}
                  options={k === "depth" ? options.slice(1) : options}
                />
              </Field>
            ))}
            <Field label="Unidad de profundidad DRX">
              <Select
                value={mapping.depthUnit}
                onChange={(v) => {
                  change();
                  setMapping((m) => ({ ...m, depthUnit: v as "m" | "ft" }));
                }}
                options={[
                  { value: "m", label: "m MD" },
                  { value: "ft", label: "ft MD" },
                ]}
              />
            </Field>
            <Field label="Base composicional">
              <Select
                aria-label="Base composicional DRX"
                value={contract.basis}
                onChange={(v) => {
                  change();
                  setContract((c) => ({
                    ...c,
                    basis: v as XrdContract["basis"],
                  }));
                }}
                options={[
                  { value: "mass", label: "Masa" },
                  { value: "volume", label: "Volumen de sólidos" },
                ]}
              />
            </Field>
            <Field label="Alcance de composición">
              <Select
                value={contract.scope}
                onChange={(v) => {
                  change();
                  setContract((c) => ({
                    ...c,
                    scope: v as XrdContract["scope"],
                  }));
                }}
                options={[
                  { value: "whole-rock", label: "Roca completa" },
                  { value: "clay-fraction", label: "Solo fracción arcilla" },
                ]}
              />
            </Field>
            <Field label="Escala de laboratorio">
              <Select
                aria-label="Escala de laboratorio DRX"
                value={contract.scale}
                onChange={(v) => {
                  change();
                  setContract((c) => ({
                    ...c,
                    scale: v as XrdContract["scale"],
                  }));
                }}
                options={[
                  { value: "percent", label: "Porcentaje (0–100)" },
                  { value: "fraction", label: "Fracción (0–1)" },
                ]}
              />
            </Field>
            <Field label="Tolerancia de cierre (fracción)">
              <TextField
                aria-label="Tolerancia de cierre (fracción)"
                value={String(contract.closureTolerance)}
                onChange={(v) => {
                  change();
                  setContract((c) => ({ ...c, closureTolerance: Number(v) }));
                }}
              />
            </Field>
            <Field label="Referencia del informe DRX">
              <TextField
                aria-label="Referencia del informe DRX"
                value={contract.report}
                onChange={(v) => {
                  change();
                  setContract((c) => ({ ...c, report: v }));
                }}
              />
            </Field>
            <Field label="Datum MD de laboratorio y perfiles">
              <TextField
                aria-label="Datum MD de laboratorio y perfiles"
                value={contract.datum}
                onChange={(v) => {
                  change();
                  setConfirmed(false);
                  setContract((c) => ({ ...c, datum: v }));
                }}
              />
            </Field>
            <Checkbox
              checked={confirmed}
              onChange={(v) => {
                change();
                setConfirmed(v);
              }}
              label="Confirmo referencia MD del mismo pozo y datum compartido para DRX"
            />
            <Field label="Descripción de incertidumbre de laboratorio">
              <TextField
                aria-label="Descripción de incertidumbre de laboratorio"
                value={contract.uncertaintyNote ?? ""}
                onChange={(v) => {
                  change();
                  setContract((c) => {
                    const { uncertaintyNote: _old, ...rest } = c;
                    return v.trim() ? { ...rest, uncertaintyNote: v } : rest;
                  });
                }}
              />
            </Field>
            <p>
              Elegí las columnas minerales y clasificá explícitamente cuáles son
              arcillas. Vacío = no medido; ND = no detectado; BLD/LD = bajo
              detección. Otros textos se rechazan.
            </p>
            {table.columns.map((col, i) => {
              const id = `m${i}`,
                m = contract.minerals.find((m) => m.id === id);
              return (
                <div key={id}>
                  <Checkbox
                    label={`Mineral: ${col.name}`}
                    checked={!!m}
                    onChange={(v) => {
                      change();
                      setContract((c) => ({
                        ...c,
                        minerals: v
                          ? [...c.minerals, { id, name: col.name, clay: false }]
                          : c.minerals.filter((m) => m.id !== id),
                      }));
                      setMapping((old) => {
                        const minerals = { ...old.minerals };
                        if (v) minerals[id] = i;
                        else delete minerals[id];
                        const uncertainties = { ...old.uncertainties },
                          detectionLimits = { ...old.detectionLimits };
                        if (!v) {
                          delete uncertainties[id];
                          delete detectionLimits[id];
                        }
                        return {
                          ...old,
                          minerals,
                          uncertainties,
                          detectionLimits,
                        };
                      });
                    }}
                  />
                  {m && (
                    <div>
                      {(["uncertainties", "detectionLimits"] as const).map(
                        (key) => (
                          <Field
                            key={key}
                            label={`${key === "uncertainties" ? "Incertidumbre" : "Límite de detección"} de ${col.name}`}
                          >
                            <Select
                              aria-label={`${key} ${col.name}`}
                              value={
                                mapping[key]?.[id] === undefined
                                  ? ""
                                  : String(mapping[key]![id])
                              }
                              options={options}
                              onChange={(v) => {
                                change();
                                setMapping((old) => {
                                  const map = { ...old[key] };
                                  if (v === "") delete map[id];
                                  else map[id] = Number(v);
                                  return { ...old, [key]: map };
                                });
                              }}
                            />
                          </Field>
                        ),
                      )}
                    </div>
                  )}
                  {m && (
                    <Checkbox
                      label={`${col.name} es mineral arcilloso`}
                      checked={m.clay}
                      onChange={(v) => {
                        change();
                        setContract((c) => ({
                          ...c,
                          minerals: c.minerals.map((m) =>
                            m.id === id ? { ...m, clay: v } : m,
                          ),
                        }));
                      }}
                    />
                  )}
                </div>
              );
            })}
            <Button
              onClick={() => {
                try {
                  const known =
                    project.inputRevisions?.[entry.inputRevisionId ?? ""]
                      ?.acquisition.depth.datum;
                  if (!confirmed || (known && known !== contract.datum))
                    throw new Error(
                      "Confirmá referencia MD/datum compatible con el pozo.",
                    );
                  setPreview(
                    buildXrdSet(table, mapping, contract, makeId("xrd")),
                  );
                  previewBase.current = project;
                  setError("");
                } catch (e) {
                  setPreview(null);
                  setError(String(e));
                }
              }}
            >
              Revisar DRX
            </Button>
            {preview && (
              <>
                <p role="status">
                  {preview.depth.length} muestras. Se conservan duplicados de
                  profundidad y valores originales. El cierre se evalúa por
                  muestra.
                </p>
                <ul>
                  {preview.pointIds.slice(0, 20).map((id, i) => {
                    const c = xrdComposition(preview, i, "native");
                    return (
                      <li key={id}>
                        {id}: cierre {c.sum.toFixed(4)};{" "}
                        {c.reason ??
                          `${c.quantity}: ${c.clayFraction?.toFixed(4)}`}
                      </li>
                    );
                  })}
                </ul>
                <Button
                  onClick={() => {
                    try {
                      useProject.getState().commit("Importar DRX", (p) => {
                        if (p !== previewBase.current)
                          throw new Error(
                            "Cambió el proyecto. Revisá nuevamente la importación.",
                          );
                        return addPointSet(
                          enableProjectInputRevisions(p),
                          entry.well.id,
                          preview,
                        );
                      });
                      selectSet(preview.id);
                      setPreview(null);
                      setTable(null);
                      setError("");
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Importar muestras revisadas
                </Button>
              </>
            )}
          </>
        )}
        {sets.length > 0 && (
          <>
            <Field label="Conjunto DRX">
              <Select
                aria-label="Conjunto DRX"
                value={setId}
                onChange={selectSet}
                options={[
                  { value: "", label: "Elegir ensayo" },
                  ...sets.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </Field>
            {set && (
              <>
                <XrdLaboratory set={set} />
                <XrdCalibrationHistory entry={entry} set={set} />
                <XrdCutoffHistory entry={entry} set={set} />
              </>
            )}
            {savedError && (
              <Callout tone="error">
                {savedError} Se conserva el registro sin modificarlo.
              </Callout>
            )}
            {savedRecord && (
              <>
                <p role="status">
                  Comparación guardada: {savedRecord.evidence.usable}/
                  {savedRecord.evidence.rows} pares utilizables. Evidencia sin
                  verificar en esta sesión; recuperá la configuración y volvé a
                  comparar.
                </p>
                <Button onClick={restoreSaved}>
                  Recuperar configuración DRX guardada
                </Button>
              </>
            )}
            <Field label="Curva para comparar con DRX">
              <Select
                aria-label="Curva para comparar con DRX"
                value={curveId}
                onChange={setCurveId}
                options={[
                  { value: "", label: "Elegir original o preparada" },
                  ...(data?.eligible.map((c) => ({
                    value: c.id,
                    label: `${c.mnemonic} (${c.unit})`,
                  })) ?? []),
                ]}
              />
            </Field>
            {problem && <Callout tone="warn">{problem}</Callout>}
            {(
              [
                ["Máximo entre anclajes DRX (m)", gap, setGap],
                ["Cobertura mínima DRX (0–1)", coverage, setCoverage],
                ["Desplazamiento de muestras DRX (m)", shift, setShift],
              ] as const
            ).map(([label, value, set]) => (
              <Field key={label} label={label}>
                <TextField
                  aria-label={label}
                  value={value}
                  onChange={set}
                  inputMode="decimal"
                />
              </Field>
            ))}
            <Field label="Cantidad DRX de comparación">
              <Select
                aria-label="Cantidad DRX de comparación"
                value={target}
                onChange={(v) => setTarget(v as typeof target)}
                options={[
                  {
                    value: "native",
                    label: "Contenido de arcillas en base nativa",
                  },
                  {
                    value: "solid-volume",
                    label: "Contenido de arcillas en volumen de sólidos",
                  },
                ]}
              />
            </Field>
            {set &&
              target === "solid-volume" &&
              (() => {
                try {
                  return xrdContract(set).minerals.map((m) => (
                    <div key={m.id}>
                      <Field label={`Densidad ${m.name} (g/cm³)`}>
                        <TextField
                          aria-label={`Densidad ${m.name} (g/cm³)`}
                          value={
                            densities[m.id] === undefined
                              ? ""
                              : String(densities[m.id])
                          }
                          onChange={(v) =>
                            setDensities((d) => ({ ...d, [m.id]: v }))
                          }
                        />
                      </Field>
                      <Field label={`Referencia de densidad ${m.name}`}>
                        <TextField
                          aria-label={`Referencia de densidad ${m.name}`}
                          value={densityReferences[m.id] ?? ""}
                          onChange={(v) =>
                            setDensityReferences((d) => ({ ...d, [m.id]: v }))
                          }
                        />
                      </Field>
                      <Field
                        label={`Incertidumbre de densidad ${m.name} (g/cm³, opcional)`}
                      >
                        <TextField
                          aria-label={`Incertidumbre de densidad ${m.name} (g/cm³, opcional)`}
                          value={densityUncertainties[m.id] ?? ""}
                          onChange={(v) =>
                            setDensityUncertainties((d) => ({
                              ...d,
                              [m.id]: v,
                            }))
                          }
                        />
                      </Field>
                    </div>
                  ));
                } catch {
                  return <p>Contrato DRX no reconocido.</p>;
                }
              })()}
            <Button
              disabled={busy || !set || !data || !curveId}
              onClick={async () => {
                const token = ++task.current;
                setBusy(true);
                setError("");
                setComparison(null);
                try {
                  const labContract = xrdContract(set!);
                  const known =
                    project.inputRevisions?.[entry.inputRevisionId ?? ""]
                      ?.acquisition.depth.datum;
                  if (
                    labContract.referenceId !== entry.well.id ||
                    (known && known !== labContract.datum)
                  )
                    throw new Error(
                      "Referencia MD/datum del laboratorio incompatible.",
                    );
                  const curve = data!.eligible.find((c) => c.id === curveId);
                  if (!curve) throw new Error("Fuente no disponible.");
                  const config = {
                    curveId,
                    target,
                    maxGapM: decimal(gap),
                    minCoverage: decimal(coverage),
                    shiftM: decimal(shift),
                    densities:
                      target === "solid-volume" && labContract.basis === "mass"
                        ? Object.fromEntries(
                            labContract.minerals.map((m) => [
                              m.id,
                              {
                                value: decimal(densities[m.id] ?? ""),
                                reference: densityReferences[m.id] ?? "",
                                ...(densityUncertainties[m.id]?.trim()
                                  ? {
                                      uncertainty: decimal(
                                        densityUncertainties[m.id]!,
                                      ),
                                    }
                                  : {}),
                              },
                            ]),
                          )
                        : {},
                  };
                  if (!entry.inputRevisionId)
                    throw new Error(
                      "La evidencia DRX requiere una revisión de entradas.",
                    );
                  const evaluated = await evaluateXrdComparison(
                    data!,
                    entry.interpretation,
                    set!,
                    config,
                    entry.inputRevisionId,
                    async () => {
                      await new Promise((r) => setTimeout(r, 0));
                      if (
                        token !== task.current ||
                        useProject.getState().project !== project
                      )
                        throw new Error("Comparación cancelada u obsoleta.");
                    },
                  );
                  if (
                    token !== task.current ||
                    useProject.getState().project !== project
                  )
                    throw new Error("Comparación obsoleta.");
                  const verification = !savedRecord
                    ? "Comparación nueva, aún sin guardar."
                    : savedRecord.evidence.inputDigest ===
                          evaluated.record.evidence.inputDigest &&
                        savedRecord.evidence.resultDigest ===
                          evaluated.record.evidence.resultDigest
                      ? "Evidencia guardada verificada: mismas entradas y resultados."
                      : "La evidencia guardada no corresponde a estas entradas, configuración o resultados. Esta tabla fue recalculada.";
                  setComparison({
                    base: project,
                    key: comparisonKey,
                    rows: evaluated.rows,
                    record: evaluated.record,
                    verification,
                  });
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Comparar con soporte declarado
            </Button>
            {busy && (
              <Button
                onClick={() => {
                  task.current++;
                }}
              >
                Cancelar comparación
              </Button>
            )}
            {comparison?.base === project &&
              comparison.key === comparisonKey && (
                <>
                  <p>
                    Comparación diagnóstica. Réplicas a igual profundidad no
                    constituyen localizaciones independientes. Cruces de zona
                    sirven para comparación global; quedan fuera de un futuro
                    ajuste zonal. No se ajustan parámetros.
                  </p>
                  <p role="status">{comparison.verification}</p>
                  <Button
                    onClick={() => {
                      try {
                        useProject
                          .getState()
                          .commit("Guardar comparación DRX", (p) =>
                            acceptXrdComparison(
                              p,
                              comparison.base,
                              entry.well.id,
                              setId,
                              comparison.record,
                            ),
                          );
                        setComparison({
                          ...comparison,
                          base: useProject.getState().project,
                          verification: "Configuración y evidencia guardadas.",
                        });
                        setError("");
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    Guardar configuración y evidencia DRX
                  </Button>
                  <Button
                    onClick={async () => {
                      try {
                        const captured = comparison;
                        const csv = await exportXrdComparisonCsv(
                          captured.record,
                          captured.rows,
                          set!,
                          await xrdInputDigest(
                            data!,
                            entry.interpretation,
                            set!,
                            captured.record.config,
                            entry.inputRevisionId!,
                          ),
                        );
                        if (
                          useProject.getState().project !== captured.base ||
                          currentDraft.current !== captured.key
                        )
                          throw new Error(
                            "La comparación cambió; recalculá antes de exportar.",
                          );
                        const url = URL.createObjectURL(
                          new Blob([csv], { type: "text/csv;charset=utf-8" }),
                        );
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "comparacion-drx.csv";
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    Exportar comparación DRX (CSV)
                  </Button>
                  <p>
                    La incertidumbre de densidad se conserva como declaración,
                    sin propagación a intervalos de confianza. Guardar no aplica
                    calibración ni cambia cutoffs.
                  </p>
                  {data && set && (
                    <XrdCutoffPanel
                      key={set.id}
                      project={project}
                      entry={entry}
                      set={set}
                      data={data}
                      comparison={comparison.record}
                    />
                  )}
                  {data && set && (
                    <XrdCalibrationPanel
                      project={project}
                      entry={entry}
                      set={set}
                      data={data}
                      comparison={comparison.record}
                    />
                  )}
                  <table className="prep-editor__table">
                    <caption>
                      Pares DRX · {comparison.rows.length} muestras (vista de
                      primeras 200)
                    </caption>
                    <thead>
                      <tr>
                        <th>Muestra</th>
                        <th>Arcillas</th>
                        <th>Perfil</th>
                        <th>Cobertura</th>
                        <th>Dispersión</th>
                        <th>QC soporte</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.rows
                        .slice(0, 200)
                        .map(({ pair, composition }) => (
                          <tr key={pair.id}>
                            <td>{pair.id}</td>
                            <td>
                              {composition.clayFraction?.toFixed(4) ?? "—"}
                            </td>
                            <td>{pair.value?.toFixed(4) ?? "—"}</td>
                            <td>{(pair.coverage * 100).toFixed(1)} %</td>
                            <td>{pair.dispersion?.toFixed(4) ?? "—"}</td>
                            <td>{pair.quality}</td>
                            <td>
                              {composition.reason ??
                                pair.reason ??
                                (pair.crossesZone
                                  ? "Cruza zona · solo global"
                                  : composition.quantity)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </>
              )}
          </>
        )}
        {error && <Callout tone="error">{error}</Callout>}
      </section>
    </details>
  );
}
