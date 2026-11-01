import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PointSet } from "../../core/pointSets";
import type { DataContext } from "../../core/preparation/projection";
import type { Project, WellEntry } from "../../core/state/project";
import { makeId } from "../../core/state/project";
import {
  proposeGrCalibration,
  readGrCalibration,
  XRD_CALIBRATION_SETTING,
  type GrCalibrationProposal,
} from "../../core/preparation/xrdCalibration";
import type { XrdComparisonRecord } from "../../core/preparation/xrdEvidence";
import {
  DEFAULT_GR_POLICY,
  DEFAULT_FIXED_GR_POLICY,
} from "../../petro/xrdCalibration";
import { VSH_METHODS, type VshMethod } from "../../petro/vsh";
import { applyGrCalibration } from "../../core/state/xrdCalibration";
import { calibrationPreviewRequest } from "./calibrationPreview";
import { sameContext } from "../../core/engine/context";
import type { ClientResult } from "../../core/engine/client";
import { registry } from "../../modules";
import { snapshotRunner } from "../snapshots/snapshotEngine";
import { useProject } from "../store/project";
import { useResults } from "../store/results";
import { Button, Callout, Checkbox, Field, Select, TextField } from "../../ui";
const number = (s: string) =>
  s.trim() ? Number(s.trim().replace(",", ".")) : NaN;
const display = (n: number | null | undefined) =>
  n !== null && n !== undefined && Number.isFinite(n) ? n.toFixed(4) : "—";
const methodName: Record<VshMethod, string> = {
  linear: "Lineal",
  larionovTertiary: "Larionov terciario",
  larionovOlder: "Larionov antiguo",
  clavier: "Clavier",
  steiber: "Steiber",
};
interface Draft {
  base: Project;
  project: Project | null;
  key: string;
  draftKey: string;
  proposal: GrCalibrationProposal;
}
const subscribe = (cb: () => void) => snapshotRunner.subscribe(cb);
export function XrdCalibrationPanel({
  project,
  entry,
  set,
  data,
  comparison,
}: {
  project: Project;
  entry: WellEntry;
  set: PointSet;
  data: DataContext;
  comparison: XrdComparisonRecord;
}) {
  const [method, setMethod] = useState<VshMethod>("linear"),
    [zoneId, setZoneId] = useState(""),
    [clean, setClean] = useState(""),
    [shale, setShale] = useState(""),
    [relationship, setRelationship] = useState(""),
    [reference, setReference] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [allowEstimated, setAllowEstimated] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<Draft | null>(null);
  const [fitMode, setFitMode] = useState<"both" | "clean" | "shale">("both"),
    [fixedValue, setFixedValue] = useState(""),
    [fixedReference, setFixedReference] = useState(""),
    [fixedUncertainty, setFixedUncertainty] = useState(""),
    [fixedNote, setFixedNote] = useState(""),
    [fixedConfirmed, setFixedConfirmed] = useState(false);
  const policy =
    fitMode === "both" ? DEFAULT_GR_POLICY : DEFAULT_FIXED_GR_POLICY;
  const baseline = useResults((s) => s.result);
  const draftKey = JSON.stringify([
    method,
    zoneId,
    clean,
    shale,
    relationship,
    reference,
    confirmed,
    allowEstimated,
    fitMode,
    fixedValue,
    fixedReference,
    fixedUncertainty,
    fixedNote,
    fixedConfirmed,
    comparison.evidence.inputDigest,
  ]);
  const task = useRef(0),
    liveKey = useRef(draftKey);
  liveKey.current = draftKey;
  useEffect(
    () => () => {
      task.current++;
    },
    [],
  );
  const current =
    draft?.base === project && draft.draftKey === draftKey ? draft : null;
  const request = useMemo(() => {
    if (!current?.project) return null;
    return calibrationPreviewRequest(current.project, entry.well.id, registry);
  }, [current, entry.well.id]);
  useEffect(() => {
    if (!current || !request) return;
    try {
      return snapshotRunner.acquire(
        current.key,
        request.engineWell,
        request.entry.interpretation,
        request.plan.context,
        request.preparation,
      );
    } catch (e) {
      setError(String(e));
      return;
    }
  }, [current, request]);
  const preview = useSyncExternalStore(subscribe, () =>
    current ? (snapshotRunner.get(current.key) ?? null) : null,
  );
  const previewResult = preview?.status === "ready" ? preview.result : null;
  const ready =
    !!previewResult &&
    !!request &&
    sameContext(previewResult.context, request.plan.context) &&
    !!current?.proposal.fit.admitted &&
    previewResult.nodes.some(
      (n) => n.moduleId === "igr" && n.status === "ok",
    ) &&
    previewResult.nodes.some((n) => n.moduleId === "vsh" && n.status === "ok");
  const zone = entry.interpretation.zones.find((z) => z.id === zoneId);
  const summary = (result: ClientResult | null, port: string) => {
    const out = result?.outputs.find(
      (o) => o.port === port && o.active && o.kind === "curve",
    );
    if (!(out?.value instanceof Float64Array) || !zone) return null;
    let sum = 0,
      n = 0;
    for (let i = 0; i < out.value.length; i++) {
      const d = entry.well.depth.values[i]!,
        v = out.value[i]!;
      if (d > zone.top && d < zone.base && Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    return n ? sum / n : null;
  };
  return (
    <details open>
      <summary>Calibrar GR con evidencia DRX · P5</summary>
      <p>
        Solo la fuente GR activa de la cadena IGR → Vsh. Requiere arcillas en
        volumen de sólidos, una relación constitutiva declarada y laboratorio
        independiente. Los extremos siguientes describen esa relación; no se
        infiere que arcillas sean lutita. Aplicar cambia tres parámetros de esta
        zona y conserva los cutoffs y otras zonas.
      </p>
      <Field label="Zona de calibración GR">
        <Select
          aria-label="Zona de calibración GR"
          value={zoneId}
          onChange={setZoneId}
          options={[
            { value: "", label: "Elegir zona" },
            ...entry.interpretation.zones.map((z) => ({
              value: z.id,
              label: z.name,
            })),
          ]}
        />
      </Field>
      <Field label="Método Vsh a calibrar">
        <Select
          aria-label="Método Vsh a calibrar"
          value={method}
          onChange={(v) => setMethod(v as VshMethod)}
          options={VSH_METHODS.map((value) => ({
            value,
            label: methodName[value],
          }))}
        />
      </Field>
      <Field label="Modo de ajuste GR">
        <Select
          aria-label="Modo de ajuste GR"
          value={fitMode}
          onChange={(v) => {
            setFitMode(v as typeof fitMode);
            setFixedConfirmed(false);
          }}
          options={[
            { value: "both", label: "Estimar ambos extremos" },
            {
              value: "clean",
              label: "Fijar arena limpia externa; estimar lutita",
            },
            {
              value: "shale",
              label: "Fijar lutita externa; estimar arena limpia",
            },
          ]}
        />
      </Field>
      {fitMode !== "both" && (
        <section aria-label="Extremo GR externo">
          <p>
            El valor fijo es una hipótesis externa aplicable a esta zona. Se
            conserva exactamente, incluso en los ajustes de validación; su
            variación cero no significa incertidumbre cero.
          </p>
          <Field label="Valor GR externo fijo (gAPI)">
            <TextField
              aria-label="Valor GR externo fijo (gAPI)"
              value={fixedValue}
              onChange={(v) => {
                setFixedValue(v);
                setFixedConfirmed(false);
              }}
              inputMode="decimal"
            />
          </Field>
          <Field label="Referencia del extremo GR externo">
            <TextField
              aria-label="Referencia del extremo GR externo"
              value={fixedReference}
              onChange={(v) => {
                setFixedReference(v);
                setFixedConfirmed(false);
              }}
            />
          </Field>
          <Field label="Incertidumbre absoluta del extremo externo (gAPI, opcional)">
            <TextField
              aria-label="Incertidumbre absoluta del extremo externo (gAPI, opcional)"
              value={fixedUncertainty}
              onChange={setFixedUncertainty}
              inputMode="decimal"
            />
          </Field>
          <Field label="Significado de la incertidumbre externa">
            <TextField
              aria-label="Significado de la incertidumbre externa"
              value={fixedNote}
              onChange={setFixedNote}
            />
          </Field>
          <Checkbox
            checked={fixedConfirmed}
            onChange={setFixedConfirmed}
            label="Declaro que el extremo fijo procede de evidencia externa aplicable a esta zona"
          />
        </section>
      )}
      <Field label="Arcillas del extremo limpio (fracción de sólidos)">
        <TextField
          aria-label="Arcillas del extremo limpio (fracción de sólidos)"
          value={clean}
          onChange={setClean}
          inputMode="decimal"
        />
      </Field>
      <Field label="Arcillas del extremo lutítico (fracción de sólidos)">
        <TextField
          aria-label="Arcillas del extremo lutítico (fracción de sólidos)"
          value={shale}
          onChange={setShale}
          inputMode="decimal"
        />
      </Field>
      <Field label="Relación constitutiva y alcance del proxy de Vsh">
        <TextField
          aria-label="Relación constitutiva y alcance del proxy de Vsh"
          value={relationship}
          onChange={setRelationship}
        />
      </Field>
      <Field label="Referencia de laboratorio independiente del GR">
        <TextField
          aria-label="Referencia de laboratorio independiente del GR"
          value={reference}
          onChange={setReference}
        />
      </Field>
      <Checkbox
        label="Confirmo que el objetivo procede de laboratorio independiente, no de Vsh calculado con el mismo GR"
        checked={confirmed}
        onChange={setConfirmed}
      />
      <Checkbox
        label="Admitir explícitamente GR estimado en esta propuesta"
        checked={allowEstimated}
        onChange={setAllowEstimated}
      />
      <details>
        <summary>Puertas de admisión declaradas</summary>
        <p>
          Al menos {policy.minLocations} localizaciones agrupadas; rango del
          proxy ≥{policy.minRange}, rango GR ≥{policy.minGrRange} gAPI y
          correlación positiva ≥{policy.minCorrelation}.{" "}
          {fitMode === "both"
            ? "Se requiere soporte ≤0,2/≥0,8 de ambos extremos."
            : fitMode === "clean"
              ? "El extremo libre lutítico exige soporte ≥0,8."
              : "El extremo libre limpio exige soporte ≤0,2."}{" "}
          Tres bloques de profundidad separados; mínimo seis localizaciones de
          entrenamiento y dos de validación por bloque. RMSE ≤0,1, sesgo
          absoluto ≤0,05 y variación de extremos ≤20 gAPI. Réplicas con
          diferencia de proxy &gt;0,15 se excluyen. Separación de agrupación: 1
          m. Incertidumbre absoluta informada sumada ≤0,05 en fracción de la
          base original; incertidumbre relativa de densidad ≤0,1. Son filtros de
          admisión versionados, no intervalos de confianza. Incertidumbre no
          informada sigue desconocida.
        </p>
      </details>
      <Button
        disabled={busy || !confirmed || (fitMode !== "both" && !fixedConfirmed)}
        onClick={async () => {
          const token = ++task.current;
          setBusy(true);
          setError("");
          setDraft(null);
          try {
            const config = {
              version: fitMode === "both" ? (1 as const) : (2 as const),
              ...(fitMode === "both"
                ? {}
                : {
                    fixed: {
                      end: fitMode,
                      value: number(fixedValue),
                      externalDeclared: true as const,
                      reference: fixedReference.trim(),
                      ...(fixedUncertainty.trim()
                        ? { uncertainty: number(fixedUncertainty) }
                        : {}),
                      ...(fixedNote.trim()
                        ? { uncertaintyNote: fixedNote.trim() }
                        : {}),
                    },
                  }),
              method,
              zoneId,
              clayClean: number(clean),
              clayShale: number(shale),
              relationship: relationship.trim(),
              independentReference: reference.trim(),
              independenceDeclared: true as const,
              policy: {
                ...policy,
                allowEstimatedGR: allowEstimated,
              },
            };
            const proposal = await proposeGrCalibration(
              data,
              entry.interpretation,
              set,
              comparison.config,
              entry.inputRevisionId!,
              config,
              registry,
              async () => {
                await new Promise((r) => setTimeout(r, 0));
                if (
                  useProject.getState().project !== project ||
                  task.current !== token ||
                  liveKey.current !== draftKey
                )
                  throw new Error(
                    "Cambió el proyecto o los controles; propuesta cancelada.",
                  );
              },
            );
            const next = proposal.fit.admitted
              ? applyGrCalibration(
                  project,
                  project,
                  entry.well.id,
                  set.id,
                  proposal,
                  registry,
                )
              : null;
            setDraft({
              base: project,
              project: next,
              key: `preparation-preview:gr:${makeId("job")}`,
              draftKey,
              proposal,
            });
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Proponer y previsualizar calibración GR
      </Button>
      {busy && (
        <Button
          onClick={() => {
            task.current++;
          }}
        >
          Cancelar propuesta GR
        </Button>
      )}
      {error && <Callout tone="error">{error}</Callout>}
      {draft && !current && (
        <Callout tone="warn">
          Propuesta obsoleta. Volvé a proponer con los controles actuales.
        </Callout>
      )}
      {current && (
        <>
          <p role="status">
            {current.proposal.fit.locations} localizaciones independientes;{" "}
            {current.proposal.exclusions.length} filas excluidas. Proxy{" "}
            {display(current.proposal.fit.range[0])}–
            {display(current.proposal.fit.range[1])}.
          </p>
          <table className="prep-editor__table">
            <caption>Extremos GR propuestos · gAPI</caption>
            <thead>
              <tr>
                <th>Parámetro</th>
                <th>Sin redondear</th>
                <th>Aplicable</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Arena limpia
                  {current.proposal.config.fixed?.end === "clean"
                    ? " · externo fijo"
                    : ""}
                </td>
                <td>{display(current.proposal.fit.raw.clean)}</td>
                <td>{display(current.proposal.fit.applied.clean)}</td>
              </tr>
              <tr>
                <td>
                  Lutita
                  {current.proposal.config.fixed?.end === "shale"
                    ? " · externo fijo"
                    : ""}
                </td>
                <td>{display(current.proposal.fit.raw.shale)}</td>
                <td>{display(current.proposal.fit.applied.shale)}</td>
              </tr>
            </tbody>
          </table>
          {current.proposal.config.fixed && (
            <p role="status">
              Extremo externo conservado: {current.proposal.config.fixed.value}{" "}
              gAPI. Referencia: {current.proposal.config.fixed.reference}.
              Incertidumbre:{" "}
              {current.proposal.config.fixed.uncertainty === undefined
                ? "no informada"
                : `${current.proposal.config.fixed.uncertainty} gAPI`}
              .{" "}
              {current.proposal.config.fixed.uncertaintyNote ??
                "Sin propagación estadística de incertidumbre."}
            </p>
          )}
          <p>
            RMSE del proxy tras redondear:{" "}
            {display(current.proposal.fit.metrics.rmse)}; sesgo:{" "}
            {display(current.proposal.fit.metrics.bias)}. RMSE de validación por
            bloques: {display(current.proposal.fit.validation?.rmse)}. Variación
            de extremos: {display(current.proposal.fit.endpointSpread.clean)} /{" "}
            {display(current.proposal.fit.endpointSpread.shale)} gAPI.
          </p>
          {current.proposal.fit.reasons.map((r) => (
            <Callout key={r} tone="warn">
              {r}
            </Callout>
          ))}
          <details>
            <summary>Localizaciones, réplicas y exclusiones</summary>
            <ul>
              {current.proposal.locations.map((l) => (
                <li key={l.ids.join("|")}>
                  {l.ids.join(", ")} · MD {l.depth.toFixed(2)} · GR{" "}
                  {display(l.gr)} · proxy {display(l.target)}
                </li>
              ))}
              {current.proposal.exclusions.map((e) => (
                <li key={e.id}>
                  {e.id}: {e.reason}
                </li>
              ))}
            </ul>
          </details>
          {current.proposal.fit.admitted &&
            (!preview || preview.status === "pending") && (
              <p role="status">Calculando impacto petrofísico aislado…</p>
            )}
          {preview?.status === "error" && (
            <Callout tone="error">{preview.message}</Callout>
          )}
          {ready && (
            <table className="prep-editor__table">
              <caption>
                Impacto del preview · promedio en el interior de la zona
              </caption>
              <thead>
                <tr>
                  <th>Resultado</th>
                  <th>Actual</th>
                  <th>Propuesto</th>
                </tr>
              </thead>
              <tbody>
                {["VSH", "PHIE", "SW"].map((port) => (
                  <tr key={port}>
                    <td>{port}</td>
                    <td>{display(summary(baseline, port))}</td>
                    <td>{display(summary(previewResult, port))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              try {
                if (
                  !current.project ||
                  useProject.getState().project !== current.base
                )
                  throw new Error("Propuesta obsoleta.");
                useProject.getState().commit(
                  `Calibrar GR en ${zone?.name ?? zoneId}`,
                  (p) => {
                    if (p !== current.base)
                      throw new Error("Propuesta obsoleta.");
                    return current.project!;
                  },
                  { group: current.key },
                );
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Aplicar calibración GR a esta zona
          </Button>
          <p>
            La aceptación guarda parámetros y evidencia en un solo undo/redo. No
            aplica cutoffs ni acredita calidad de reservorio.
          </p>
        </>
      )}
    </details>
  );
}
export function XrdCalibrationHistory({
  entry,
  set,
}: {
  entry: WellEntry;
  set: PointSet;
}) {
  const records = Object.entries(
    entry.interpretation.pointSets[set.id]?.settings ?? {},
  ).filter(([key]) => key.startsWith(XRD_CALIBRATION_SETTING + ":"));
  if (!records.length) return null;
  return (
    <details>
      <summary>Calibraciones GR aceptadas</summary>
      <p>
        Evidencia histórica; no es una propuesta ejecutable ni una verificación
        de laboratorio real.
      </p>
      {records.map(([key, raw]) => {
        try {
          const p = readGrCalibration(raw)!;
          return (
            <p key={key}>
              {entry.interpretation.zones.find((z) => z.id === p.config.zoneId)
                ?.name ?? p.config.zoneId}
              : {methodName[p.config.method]}, GR {p.fit.applied.clean}/
              {p.fit.applied.shale} gAPI; RMSE {display(p.fit.metrics.rmse)}.{" "}
              {p.config.relationship} Referencia:{" "}
              {p.config.independentReference}
              {p.config.fixed && (
                <>
                  {" "}
                  Extremo{" "}
                  {p.config.fixed.end === "clean" ? "limpio" : "lutítico"}{" "}
                  externo: {p.config.fixed.value} gAPI;{" "}
                  {p.config.fixed.reference}; incertidumbre{" "}
                  {p.config.fixed.uncertainty === undefined
                    ? "no informada"
                    : `${p.config.fixed.uncertainty} gAPI`}
                  . {p.config.fixed.uncertaintyNote ?? ""}
                </>
              )}
            </p>
          );
        } catch (e) {
          return (
            <Callout key={key} tone="error">
              {String(e)}
            </Callout>
          );
        }
      })}
    </details>
  );
}
