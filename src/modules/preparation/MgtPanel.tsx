import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Project, WellEntry } from "../../core/state/project";
import { makeId } from "../../core/state/project";
import {
  setMgtCorrection,
  removeMgtCorrection,
  enableMgtCorrection,
} from "../../core/state/mgt";
import { MGT_METHOD, type MgtConfig } from "../../core/preparation/mgt";
import { sameContext } from "../../core/engine/context";
import type { ClientResult } from "../../core/engine/client";
import { registry } from "../../modules";
import { Button, Callout, Checkbox, Field, Select, TextField } from "../../ui";
import { useProject } from "../../app/store/project";
import { useResults } from "../../app/store/results";
import { snapshotRunner } from "../../app/snapshots/snapshotEngine";
import { calibrationPreviewRequest } from "./calibrationPreview";
import { entryPreparationPlan } from "../../core/state/preparation";
import { cutoffImpact } from "../../core/preparation/xrdCutoff";
const decimal = (s: string) =>
  s.trim() ? Number(s.trim().replace(",", ".")) : NaN;
const mean = (v: Float64Array | undefined) => {
  let s = 0,
    n = 0;
  for (const x of v ?? [])
    if (Number.isFinite(x)) {
      s += x;
      n++;
    }
  return n ? `${(s / n).toFixed(4)} (n=${n})` : "Sin dato";
};
const subscribe = (cb: () => void) => snapshotRunner.subscribe(cb);
interface Draft {
  base: Project;
  project: Project;
  key: string;
  controls: string;
  request: ReturnType<typeof calibrationPreviewRequest>;
}
export function MgtPanel({
  project,
  entry,
  curveId,
}: {
  project: Project;
  entry: WellEntry;
  curveId: string;
}) {
  const [caliper, setCaliper] = useState(""),
    [position, setPosition] = useState(""),
    [depth, setDepth] = useState(""),
    [temperature, setTemperature] = useState(""),
    [pressure, setPressure] = useState(""),
    [conditions, setConditions] = useState(""),
    [raw, setRaw] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<Draft | null>(null);
  const baseline = useResults((s) => s.result);
  const basePlan = entryPreparationPlan(project, entry, registry);
  const currentBaseline =
    baseline && sameContext(baseline.context, basePlan.context)
      ? baseline
      : null;
  const controls = JSON.stringify([
    curveId,
    caliper,
    position,
    depth,
    temperature,
    pressure,
    conditions,
    raw,
    confirmed,
  ]);
  const live = useRef(controls);
  live.current = controls;
  const current =
    draft?.base === project && draft.controls === controls ? draft : null;
  useEffect(() => {
    if (!current) return;
    const r = current.request;
    try {
      return snapshotRunner.acquire(
        current.key,
        r.engineWell,
        r.entry.interpretation,
        r.context,
        r.preparation,
      );
    } catch (e) {
      setError(String(e));
      return;
    }
  }, [current]);
  const preview = useSyncExternalStore(subscribe, () =>
    current ? (snapshotRunner.get(current.key) ?? null) : null,
  );
  const result = preview?.status === "ready" ? preview.result : null;
  const artifact = result?.preparation?.artifacts.find(
    (a) =>
      result.preparation!.plan.artifacts.find((p) => p.id === a.id)
        ?.sourceCurveId === curveId,
  );
  const corrected = artifact
    ? artifact.quality.reduce((n, q) => n + (q === 64 ? 1 : 0), 0)
    : 0;
  const unsupported = artifact
    ? artifact.quality.reduce((n, q) => n + (q === 128 ? 1 : 0), 0)
    : 0;
  const ready =
    !!current &&
    !!result &&
    sameContext(result.context, current.request.context) &&
    corrected > 0 &&
    result.sources.GR?.kind === "curve" &&
    result.sources.GR.curveId === artifact?.id &&
    project.activeWellId === entry.well.id;
  const original = entry.well.curves.find((c) => c.id === curveId);
  const beforeNets = currentBaseline ? cutoffImpact(currentBaseline, "") : null;
  const afterNets = result ? cutoffImpact(result, "") : null;
  const existing = entry.interpretation.preparation?.nodes.find(
    (n) => n.kind === "mgt-borehole" && n.input.curveId === curveId,
  );
  if (original?.role !== "GR") return null;
  const input = (setter: (s: string) => void) => (value: string) => {
    setter(value);
    setConfirmed(false);
    setDraft(null);
  };
  const values = [
    ["Profundidad ambiente máxima bajo nivel del mar (m)", depth, setDepth],
    ["Temperatura ambiente MGT (°C)", temperature, setTemperature],
    ["Presión ambiente MGT (psi)", pressure, setPressure],
    [
      "Referencia de agua de mar, posición, datum y condiciones MGT",
      conditions,
      setConditions,
    ],
    ["Referencia de GR calibrado sin corrección de pozo previa", raw, setRaw],
  ] as const;
  return (
    <section className="prep-legacy" aria-label="MGT">
      <h3>MGT · corrección GR específica con vista previa</h3>
      <p>
        Modelo publicado LDEO MGT v1, para GR total calibrado, pozo abierto con
        agua de mar y posición conocida. Activará GR preparado en la cadena
        vigente; no modifica extremos GR ni cutoffs. No sirve para otro modelo
        de herramienta ni para K/U/Th.
      </p>
      <Callout tone="warn">
        {MGT_METHOD.uncertainty} Guarda operativa: caliper &gt;3,375 in y ≤42
        cm. Fuera de ella o sin caliper, GR preparado queda sin dato. No se usa
        el máximo del caliper para rellenar huecos. Profundidad ambiente bajo
        nivel del mar ≤5000 m declarada desde adquisición; no se infiere de MD.
      </Callout>
      <p>
        Requiere familia GR/espectral, fabricante LDEO y modelo MGT declarados
        en la corrida, datum registrado y procesado revisado sin efecto de pozo
        previo. La referencia siguiente documenta la ausencia de esa corrección;
        una lista vacía de efectos no la demuestra.
      </p>
      <Field label="Caliper original para MGT">
        <Select
          aria-label="Caliper original para MGT"
          value={caliper}
          onChange={input(setCaliper)}
          options={[
            { value: "", label: "Elegir caliper original" },
            ...entry.well.curves
              .filter((c) => c.role === "CALI" && c.origin.kind === "measured")
              .map((c) => ({
                value: c.id,
                label: `${c.mnemonic} · ${c.unit}`,
              })),
          ]}
        />
      </Field>
      <Field label="Posición de herramienta MGT">
        <Select
          aria-label="Posición de herramienta MGT"
          value={position}
          onChange={input(setPosition)}
          options={[
            { value: "", label: "Elegir posición conocida" },
            { value: "centered", label: "Centrada" },
            { value: "eccentered", label: "Excéntrica" },
          ]}
        />
      </Field>
      {values.map(([label, value, setter], k) => (
        <Field key={label} label={label}>
          <TextField
            aria-label={label}
            value={value}
            onChange={input(setter)}
            inputMode={k < 3 ? "decimal" : "text"}
          />
        </Field>
      ))}
      <Checkbox
        label="Confirmo MGT, agua de mar sin aditivos, pozo abierto, condiciones y caliper en la misma referencia MD; acepto la limitación del modelo"
        checked={confirmed}
        onChange={(value) => {
          setConfirmed(value);
          setDraft(null);
        }}
      />
      <Button
        disabled={!confirmed || project.activeWellId !== entry.well.id}
        onClick={() => {
          setError("");
          setDraft(null);
          try {
            const config: MgtConfig = {
              caliperCurveId: caliper,
              position: position as MgtConfig["position"],
              environment: "open-hole-seawater",
              maxAmbientDepthM: decimal(depth),
              temperatureC: decimal(temperature),
              pressurePsi: decimal(pressure),
              conditionsReference: conditions.trim(),
              uncorrectedReference: raw.trim(),
              declared: true,
            };
            const next = setMgtCorrection(
              project,
              project,
              entry.well.id,
              curveId,
              config,
              makeId("mgt"),
            );
            setDraft({
              base: project,
              project: next,
              controls,
              key: `preparation-preview:mgt:${makeId("job")}`,
              request: calibrationPreviewRequest(next, entry.well.id, registry),
            });
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        Previsualizar corrección MGT
      </Button>
      {error && <Callout tone="error">{error}</Callout>}
      {draft && !current && (
        <Callout tone="warn">
          Propuesta MGT obsoleta. Volvé a previsualizar.
        </Callout>
      )}
      {current && (
        <>
          {(!preview || preview.status === "pending") && (
            <p role="status">Calculando MGT e impacto en motor aislado…</p>
          )}
          {preview?.status === "error" && (
            <Callout tone="error">{preview.message}</Callout>
          )}
          {result &&
            corrected > 0 &&
            (result.sources.GR?.kind !== "curve" ||
              result.sources.GR.curveId !== artifact?.id) && (
              <Callout tone="warn">
                El GR preparado no es una fuente disponible de la cadena. Revisá
                herramientas excluidas y selección de fuentes antes de aceptar.
              </Callout>
            )}
          {result && (
            <>
              <table className="prep-editor__table">
                <caption>
                  MGT · original, corregida y diferencia · primeras 14 muestras
                </caption>
                <thead>
                  <tr>
                    <th>MD · m</th>
                    <th>GR original</th>
                    <th>GR corregido</th>
                    <th>Diferencia · gAPI</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(
                    { length: Math.min(14, original.data.length) },
                    (_, k) => {
                      const v = artifact?.data[k],
                        show = (n: number | undefined) =>
                          n !== undefined && Number.isFinite(n)
                            ? n.toFixed(4)
                            : "Sin dato";
                      return (
                        <tr key={k}>
                          <td>{entry.well.depth.values[k]}</td>
                          <td>{show(original.data[k])}</td>
                          <td>{show(v)}</td>
                          <td>
                            {show(
                              v === undefined
                                ? undefined
                                : v - original.data[k]!,
                            )}
                          </td>
                          <td>
                            {artifact?.quality[k] === 64
                              ? "Corregida MGT"
                              : artifact?.quality[k] === 1
                                ? "Faltante original"
                                : "Fuera de dominio o sin caliper"}
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
              <p role="status">
                {corrected} muestras corregidas; {unsupported} fuera de dominio
                o sin caliper. Originales conservados. QC: 64 corregida, 128
                fuera de dominio, 1 faltante original.
              </p>
              <table className="prep-editor__table">
                <caption>
                  Impacto MGT · promedios finitos y cantidad de muestras
                </caption>
                <thead>
                  <tr>
                    <th>Resultado</th>
                    <th>Actual/original</th>
                    <th>Propuesto</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>GR seleccionado · gAPI</td>
                    <td>{mean(original.data)}</td>
                    <td>{mean(artifact?.data)}</td>
                  </tr>
                  {["VSH", "PHIE", "SW"].map((port) => {
                    const get = (r: ClientResult | null) => {
                      const source = r?.sources[port];
                      if (source?.kind === "curve")
                        return (
                          r?.preparation?.artifacts.find(
                            (a) => a.id === source.curveId,
                          )?.data ??
                          entry.well.curves.find((c) => c.id === source.curveId)
                            ?.data
                        );
                      const out = r?.outputs.find(
                        (o) =>
                          o.port === port && o.active && o.kind === "curve",
                      );
                      return out?.value instanceof Float64Array
                        ? out.value
                        : undefined;
                    };
                    return (
                      <tr key={port}>
                        <td>{port}</td>
                        <td>{mean(get(currentBaseline))}</td>
                        <td>{mean(get(result))}</td>
                      </tr>
                    );
                  })}
                  {(
                    [
                      ["netRes", "Reservorio neto · m (total zonas)"],
                      ["netPay", "Pay neto · m (total zonas)"],
                    ] as const
                  ).map(([key, label]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td>
                        {beforeNets?.[key] === null ||
                        beforeNets?.[key] === undefined
                          ? "Sin dato"
                          : beforeNets[key]!.toFixed(4)}
                      </td>
                      <td>
                        {afterNets?.[key] === null ||
                        afterNets?.[key] === undefined
                          ? "Sin dato"
                          : afterNets[key]!.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              try {
                if (live.current !== current.controls)
                  throw new Error("Controles MGT obsoletos.");
                useProject.getState().commit(
                  "Aplicar corrección ambiental MGT",
                  (p) => {
                    if (p !== current.base)
                      throw new Error("Proyecto MGT obsoleto.");
                    return current.project;
                  },
                  { group: current.key },
                );
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Aplicar corrección MGT
          </Button>
        </>
      )}
      {existing?.kind === "mgt-borehole" && (
        <section aria-label="Corrección MGT aceptada">
          <p>
            MGT v1 guardado ·{" "}
            {existing.enabled
              ? basePlan.artifacts.some((a) => a.nodeId === existing.id)
                ? "habilitado; revisar fuente GR activa"
                : "bloqueado: cambiaron entradas o adquisición"
              : "desactivado"}
            . La receta y sus referencias se recuperan con el proyecto y
            snapshots.
          </p>
          <p>
            Posición:{" "}
            {existing.mgt.position === "centered" ? "centrada" : "excéntrica"}.
            Condiciones: {existing.mgt.conditionsReference}. Ausencia de
            corrección previa: {existing.mgt.uncorrectedReference}. Límites
            declarados: {existing.mgt.maxAmbientDepthM} m bajo nivel del mar,{" "}
            {existing.mgt.temperatureC} °C, {existing.mgt.pressurePsi} psi.
          </p>
          <Button
            onClick={() => {
              try {
                useProject
                  .getState()
                  .commit(
                    existing.enabled ? "Desactivar MGT" : "Activar MGT",
                    (p) =>
                      enableMgtCorrection(
                        p,
                        entry.well.id,
                        existing.id,
                        !existing.enabled,
                      ),
                  );
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {existing.enabled ? "Desactivar MGT" : "Activar MGT"}
          </Button>
          <Button
            onClick={() =>
              useProject
                .getState()
                .commit("Retirar corrección MGT", (p) =>
                  removeMgtCorrection(p, entry.well.id, existing.id),
                )
            }
          >
            Retirar MGT y volver a original
          </Button>
        </section>
      )}
      <a href={MGT_METHOD.url} target="_blank" rel="noreferrer">
        {MGT_METHOD.reference}
      </a>
    </section>
  );
}
