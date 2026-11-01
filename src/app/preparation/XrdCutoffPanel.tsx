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
import { sameContext } from "../../core/engine/context";
import type { ClientResult } from "../../core/engine/client";
import type { XrdComparisonRecord } from "../../core/preparation/xrdEvidence";
import {
  cutoffImpact,
  proposeXrdCutoff,
  readXrdCutoff,
  XRD_CUTOFF_SETTING,
  type XrdCutoffProposal,
} from "../../core/preparation/xrdCutoff";
import { applyXrdCutoff, previewXrdCutoff } from "../../core/state/xrdCutoff";
import { registry } from "../../modules";
import { snapshotRunner } from "../snapshots/snapshotEngine";
import { useProject } from "../store/project";
import { useResults } from "../store/results";
import { Button, Callout, Checkbox, Field, Select, TextField } from "../../ui";
import { calibrationPreviewRequest } from "./calibrationPreview";

const decimal = (s: string) =>
  s.trim() ? Number(s.trim().replace(",", ".")) : NaN;
const display = (v: number | null | undefined) =>
  v !== null && v !== undefined && Number.isFinite(v)
    ? v.toFixed(4)
    : "Sin dato";
const subscribe = (cb: () => void) => snapshotRunner.subscribe(cb);
interface Draft {
  base: Project;
  project: Project;
  baseline: ClientResult;
  key: string;
  controls: string;
  proposal: XrdCutoffProposal;
}

export function XrdCutoffPanel({
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
  const [zoneId, setZoneId] = useState(""),
    [cutoff, setCutoff] = useState(""),
    [clean, setClean] = useState(""),
    [shale, setShale] = useState(""),
    [relationship, setRelationship] = useState(""),
    [justification, setJustification] = useState(""),
    [reference, setReference] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<Draft | null>(null);
  const baseline = useResults((s) => s.result);
  const controls = JSON.stringify([
    zoneId,
    cutoff,
    clean,
    shale,
    relationship,
    justification,
    reference,
    confirmed,
    comparison.evidence.inputDigest,
  ]);
  const live = useRef(controls),
    task = useRef(0);
  live.current = controls;
  useEffect(
    () => () => {
      task.current++;
    },
    [],
  );
  const current =
    draft?.base === project && draft.controls === controls ? draft : null;
  const request = useMemo(
    () =>
      current
        ? calibrationPreviewRequest(current.project, entry.well.id, registry)
        : null,
    [current, entry.well.id],
  );
  useEffect(() => {
    if (!current || !request) return;
    try {
      return snapshotRunner.acquire(
        current.key,
        request.engineWell,
        request.entry.interpretation,
        request.context,
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
  const result = preview?.status === "ready" ? preview.result : null;
  const ready =
    !!result &&
    !!request &&
    sameContext(result.context, request.context) &&
    !!result.sources.VSH;
  const rows = current?.proposal.rows ?? [],
    usable = rows.filter((r) => !r.reason);
  const labPass = usable.filter(
    (r) => r.labProxy! <= current!.proposal.config.cutoff,
  ).length;
  const profilePass = usable.filter(
    (r) => r.vsh! <= current!.proposal.config.cutoff,
  ).length;
  const agreement = usable.filter(
    (r) =>
      r.labProxy! <= current!.proposal.config.cutoff ===
      r.vsh! <= current!.proposal.config.cutoff,
  ).length;
  const before = current ? cutoffImpact(current.baseline, zoneId) : null,
    after = result ? cutoffImpact(result, zoneId) : null;
  const zone = entry.interpretation.zones.find((z) => z.id === zoneId);
  return (
    <details>
      <summary>Evaluar cutoff de Vsh con DRX · decisión separada</summary>
      <p>
        Elegí un criterio de clasificación y contrastalo con el Vsh activo. DRX
        mide minerales: no demuestra permeabilidad, reservorio ni pay. Declarar
        el proxy requiere su propia relación física. Fundamentá el corte con
        facies, plugs y φ/k cuando existan; indicá las limitaciones cuando
        falten.
      </p>
      <Field label="Zona del cutoff DRX">
        <Select
          aria-label="Zona del cutoff DRX"
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
      {(
        [
          ["Cutoff Vsh propuesto", cutoff, setCutoff, true],
          ["Arcillas del extremo limpio para cutoff", clean, setClean, true],
          ["Arcillas del extremo lutítico para cutoff", shale, setShale, true],
          [
            "Relación física del proxy para cutoff",
            relationship,
            setRelationship,
            false,
          ],
          [
            "Justificación del cutoff y limitaciones",
            justification,
            setJustification,
            false,
          ],
          [
            "Referencia de facies, plugs o criterio operativo",
            reference,
            setReference,
            false,
          ],
        ] as const
      ).map(([label, value, change, numeric]) => (
        <Field key={label} label={label}>
          <TextField
            aria-label={label}
            value={value}
            onChange={change}
            inputMode={numeric ? "decimal" : "text"}
          />
        </Field>
      ))}
      <Checkbox
        label="Declaro este cutoff como criterio de clasificación, sin inferir calidad de reservorio solo desde DRX"
        checked={confirmed}
        onChange={setConfirmed}
      />
      <Button
        disabled={
          busy ||
          !confirmed ||
          !baseline ||
          !sameContext(baseline.context, data.context)
        }
        onClick={async () => {
          const token = ++task.current;
          setBusy(true);
          setError("");
          setDraft(null);
          try {
            if (!baseline) throw new Error("Esperá resultados vigentes.");
            const proposal = await proposeXrdCutoff(
              data,
              entry.interpretation,
              set,
              comparison.config,
              entry.inputRevisionId!,
              {
                zoneId,
                cutoff: decimal(cutoff),
                clayClean: decimal(clean),
                clayShale: decimal(shale),
                relationship: relationship.trim(),
                justification: justification.trim(),
                reference: reference.trim(),
                classificationDeclared: true,
              },
              baseline,
              registry,
              async () => {
                await new Promise((r) => setTimeout(r, 0));
                if (
                  useProject.getState().project !== project ||
                  task.current !== token ||
                  live.current !== controls
                )
                  throw new Error(
                    "Cambió el proyecto o los controles; evaluación cancelada.",
                  );
              },
            );
            setDraft({
              base: project,
              project: previewXrdCutoff(
                project,
                project,
                entry.well.id,
                set.id,
                proposal,
                registry,
              ),
              baseline,
              key: `preparation-preview:cutoff:${makeId("job")}`,
              controls,
              proposal,
            });
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Evaluar y previsualizar cutoff
      </Button>
      {busy && (
        <Button
          onClick={() => {
            task.current++;
          }}
        >
          Cancelar evaluación del cutoff
        </Button>
      )}
      {error && <Callout tone="error">{error}</Callout>}
      {draft && !current && (
        <Callout tone="warn">
          Evaluación de cutoff obsoleta. Volvé a evaluar.
        </Callout>
      )}
      {current && (
        <>
          <p role="status">
            Cutoff de la zona {zone?.name}: {display(current.proposal.before)} →{" "}
            {display(current.proposal.config.cutoff)}. {usable.length} muestras
            válidas; {rows.length - usable.length} excluidas. Las réplicas
            cuentan como muestras, no como validación independiente.
          </p>
          <p>
            Dentro del corte: {labPass} en el proxy de laboratorio y{" "}
            {profilePass} en el perfil; coinciden en {agreement} de{" "}
            {usable.length} muestras. No es una prueba de calidad de reservorio
            ni una optimización del cutoff. Incertidumbres y censura se
            conservan en el laboratorio; estos recuentos no son probabilidades
            ni intervalos de confianza.
          </p>
          <table className="prep-editor__table">
            <caption>Contraste del cutoff · primeras 200 muestras</caption>
            <thead>
              <tr>
                <th>Muestra</th>
                <th>MD tope/base · m</th>
                <th>Proxy DRX</th>
                <th>Vsh activo</th>
                <th>Cobertura</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>
                    {display(r.top)} /{" "}
                    {r.base === null ? "Punto" : display(r.base)}
                  </td>
                  <td>{display(r.labProxy)}</td>
                  <td>{display(r.vsh)}</td>
                  <td>{display(r.coverage)}</td>
                  <td>{r.reason ?? "Par válido"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!preview || preview.status === "pending" ? (
            <p role="status">Calculando impacto del cutoff…</p>
          ) : null}
          {preview?.status === "error" && (
            <Callout tone="error">{preview.message}</Callout>
          )}
          {ready && (
            <>
              <table className="prep-editor__table">
                <caption>Impacto exacto del cutoff · zona seleccionada</caption>
                <thead>
                  <tr>
                    <th>Resultado</th>
                    <th>Actual</th>
                    <th>Propuesto</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["netRes", "Reservorio neto · m"],
                      ["netPay", "Pay neto · m"],
                      ["noDataPay", "Reservorio sin Sw · m"],
                      ["ooip", "Petróleo in situ · m³"],
                      ["ogip", "Gas in situ · m³"],
                    ] as const
                  ).map(([k, label]) => (
                    <tr key={k}>
                      <td>{label}</td>
                      <td>{display(before?.[k])}</td>
                      <td>{display(after?.[k])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!before || !after) && (
                <Callout tone="warn">
                  Faltan entradas o está desactivada la sensibilidad: el impacto
                  en netos no está disponible. El contraste DRX–Vsh no reemplaza
                  PHIE/Sw.
                </Callout>
              )}
              <p>
                Se reutiliza la fila exacta del módulo Sensibilidad a los
                cutoffs, con φ y Sw vigentes. Allí podés explorar el barrido
                completo. Esta acción solo aplica Vsh máxima en esta zona; la
                calibración GR se acepta por separado.
              </p>
            </>
          )}
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              try {
                if (!result) throw new Error("Falta preview vigente.");
                useProject
                  .getState()
                  .commit(
                    `Aplicar cutoff DRX en ${zone?.name ?? zoneId}`,
                    (p) =>
                      applyXrdCutoff(
                        p,
                        current.base,
                        entry.well.id,
                        set.id,
                        current.proposal,
                        current.baseline,
                        result,
                        registry,
                      ),
                    { group: current.key },
                  );
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Aplicar cutoff Vsh con evidencia a esta zona
          </Button>
        </>
      )}
    </details>
  );
}

export function XrdCutoffHistory({
  entry,
  set,
}: {
  entry: WellEntry;
  set: PointSet;
}) {
  const records = Object.entries(
    entry.interpretation.pointSets[set.id]?.settings ?? {},
  ).filter(([k]) => k.startsWith(XRD_CUTOFF_SETTING + ":"));
  if (!records.length) return null;
  return (
    <details>
      <summary>Cutoffs DRX aceptados · evidencia histórica</summary>
      <p>
        El recibo conserva el contexto de aceptación. No se presenta como
        evidencia verificada contra los parámetros actuales ni se ejecuta al
        abrir.
      </p>
      {records.map(([key, value]) => {
        try {
          const p = readXrdCutoff(value)!;
          const zone = entry.interpretation.zones.find(
            (z) => z.id === p.config.zoneId,
          );
          return (
            <p key={key}>
              {zone?.name ?? "Zona eliminada"}: cutoff {p.before} →{" "}
              {p.config.cutoff}. {p.rows.filter((r) => !r.reason).length} pares
              válidos. {p.config.justification} Referencia: {p.config.reference}
              . Relación: {p.config.relationship}
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
