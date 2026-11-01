import { useState } from "react";
import type { Project, WellEntry } from "../../core/state/project";
import { registerRun, removeRunDepthShift } from "../../core/state/runs";
import { useProject } from "../../app/store/project";
import { Button, Checkbox, Field, Select, TextField, Callout } from "../../ui";
import { diagnoseShift } from "../../core/preparation/correlation";

export function RunEditor({
  project,
  entry,
  curveId,
  runId,
  onChange,
}: {
  project: Project;
  entry: WellEntry;
  curveId: string;
  runId: string;
  onChange: (id: string) => void;
}) {
  const runs =
    project.inputRevisions?.[entry.inputRevisionId ?? ""]?.acquisition.runs ??
    [];
  const [id, setId] = useState(""),
    [members, setMembers] = useState<string[]>([]),
    [error, setError] = useState("");
  return (
    <section className="prep-legacy" aria-label="Corridas registradas">
      <h3>Corridas registradas</h3>
      <p>
        Registrá solo pertenencias conocidas de adquisición. Herramienta, lodo y
        correcciones siguen desconocidos. Registrar crea una revisión de
        entradas y puede deshacerse.
      </p>
      <Field label="Identificador de corrida">
        <TextField
          aria-label="Identificador de corrida"
          value={id}
          onChange={setId}
        />
      </Field>
      {entry.well.curves.map((c) => (
        <Checkbox
          key={c.id}
          checked={members.includes(c.id)}
          label={c.mnemonic}
          onChange={(v) =>
            setMembers((old) =>
              v ? [...old, c.id] : old.filter((x) => x !== c.id),
            )
          }
        />
      ))}
      <Button
        size="sm"
        onClick={() => {
          try {
            useProject
              .getState()
              .commit("Registrar corrida", (p) =>
                registerRun(p, entry.well.id, id.trim(), members),
              );
            setError("");
            setMembers([]);
            setId("");
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        Registrar corrida
      </Button>
      {runs.map((r) => (
        <Button
          key={r.id}
          size="sm"
          onClick={() => {
            try {
              useProject
                .getState()
                .commit(`Quitar alineación de corrida ${r.id}`, (p) =>
                  removeRunDepthShift(p, entry.well.id, r.id),
                );
              setError("");
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Quitar alineación de corrida {r.id}
        </Button>
      ))}
      {error && <Callout tone="error">{error}</Callout>}
      <Field label="Alcance de alineación">
        <Select
          aria-label="Alcance de alineación"
          value={runId}
          onChange={onChange}
          options={[
            { value: "", label: "Solo curva seleccionada" },
            ...runs
              .filter((r) => r.curveIds.includes(curveId))
              .map((r) => ({
                value: r.id,
                label: `Corrida ${r.id} · ${r.curveIds.length} curvas`,
              })),
          ]}
        />
      </Field>
    </section>
  );
}

export function CorrelationReview({
  entry,
  curveId,
  top,
  base,
}: {
  entry: WellEntry;
  curveId: string;
  top: number;
  base: number;
}) {
  const [referenceId, setReferenceId] = useState(""),
    [range, setRange] = useState(""),
    [gap, setGap] = useState(""),
    [vtop, setVtop] = useState(""),
    [vbase, setVbase] = useState("");
  const [report, setReport] = useState<{
      key: string;
      value: Awaited<ReturnType<typeof diagnoseShift>>;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const moving = entry.well.curves.find((c) => c.id === curveId),
    reference = entry.well.curves.find((c) => c.id === referenceId);
  const key = JSON.stringify([
    curveId,
    referenceId,
    range,
    gap,
    vtop,
    vbase,
    top,
    base,
    entry.inputRevisionId,
  ]);
  const result = report?.key === key ? report.value : null;
  return (
    <section className="prep-legacy" aria-label="Diagnóstico de correlación">
      <h3>Diagnóstico de correlación</h3>
      <p>
        Compara originales de igual rol y unidad. El tope/base superior define
        búsqueda. Reservá otra ventana separada para validar. Reporta
        asociación, no evidencia geológica ni una corrección automática.
      </p>
      <Field label="Curva de referencia">
        <Select
          aria-label="Curva de referencia"
          value={referenceId}
          onChange={setReferenceId}
          options={[
            { value: "", label: "Elegir referencia" },
            ...entry.well.curves
              .filter(
                (c) =>
                  c.id !== curveId &&
                  c.role &&
                  c.role === moving?.role &&
                  c.unit === moving.unit,
              )
              .map((c) => ({ value: c.id, label: c.mnemonic })),
          ]}
        />
      </Field>
      {(
        [
          ["Máximo absoluto del desplazamiento (m)", range, setRange],
          ["Máximo entre anclajes para correlación (m)", gap, setGap],
          ["Tope de validación (m)", vtop, setVtop],
          ["Base de validación (m)", vbase, setVbase],
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
      <Button
        size="sm"
        disabled={busy || !moving || !reference}
        onClick={async () => {
          setBusy(true);
          setError("");
          setReport(null);
          try {
            const r = Number(range);
            if (!Number.isFinite(r) || r <= 0)
              throw new Error("El máximo debe ser positivo.");
            const start = entry;
            const value = await diagnoseShift(
              entry.well.depth.values,
              moving!.data,
              reference!.data,
              Array.from({ length: 21 }, (_, i) => ((i - 10) * r) / 10),
              { top, base },
              { top: Number(vtop), base: Number(vbase) },
              Number(gap),
              async () => {
                await new Promise((resolve) => setTimeout(resolve, 0));
                if (
                  useProject
                    .getState()
                    .project.wells.find((e) => e.well.id === entry.well.id) !==
                  start
                )
                  throw new Error(
                    "Cambió el proyecto. Recalculá el diagnóstico.",
                  );
              },
            );
            setReport({ key, value });
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Evaluar 21 desplazamientos
      </Button>
      {error && <Callout tone="error">{error}</Callout>}
      {result && (
        <>
          <p role="status">
            Pico: {result.peak?.offsetM ?? "sin soporte"} m; borde:{" "}
            {result.atEdge ? "sí" : "no"}; ambiguo:{" "}
            {result.ambiguous ? "sí" : "no"}. Validación independiente: r=
            {result.validation?.r?.toFixed(3) ?? "indeterminada"}, pares=
            {result.validation?.pairs ?? 0}, cobertura=
            {((result.validation?.coverage ?? 0) * 100).toFixed(1)} %.
          </p>
          <table className="prep-editor__table">
            <caption>Búsqueda · originales · Pearson</caption>
            <thead>
              <tr>
                <th>Desplazamiento</th>
                <th>Pares</th>
                <th>Cobertura</th>
                <th>r</th>
              </tr>
            </thead>
            <tbody>
              {result.scores.map((s) => (
                <tr key={s.offsetM}>
                  <td>{s.offsetM.toPrecision(4)}</td>
                  <td>{s.pairs}</td>
                  <td>{(s.coverage * 100).toFixed(1)} %</td>
                  <td>{s.r?.toFixed(3) ?? "indeterminada"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Si decidís alinear, ingresá el desplazamiento manualmente y revisá
            la vista previa de todas las curvas.
          </p>
        </>
      )}
    </section>
  );
}
