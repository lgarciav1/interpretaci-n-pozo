import { useState } from "react";
import {
  unknownAcquisition,
  type AcquisitionRun,
} from "../../core/inputs/acquisition";
import {
  ENVIRONMENT_EFFECTS,
  reviewEnvironment,
} from "../../core/preparation/environment";
import { updateRunAcquisition } from "../../core/state/acquisition";
import type { Project, WellEntry } from "../../core/state/project";
import { registry } from "../../modules";
import { unitLabel } from "../../core/units";
import { Button, Callout, Checkbox, Field, Select, TextField } from "../../ui";
import { useProject } from "../store/project";
import { MgtPanel } from "./MgtPanel";

function AcquisitionEditor({
  project,
  entry,
  run,
}: {
  project: Project;
  entry: WellEntry;
  run: AcquisitionRun;
}) {
  const originalDatum =
    project.inputRevisions?.[entry.inputRevisionId ?? ""]?.acquisition.depth
      .datum ?? null;
  const initial = () => ({
    base: project,
    datum: originalDatum,
    tool: { ...run.tool },
    corrections: {
      ...run.corrections,
      effects: run.corrections.effects.map((e) => ({ ...e })),
    },
  });
  const [draft, setDraft] = useState(initial),
    [confirmed, setConfirmed] = useState(false),
    [datumConfirmed, setDatumConfirmed] = useState(false),
    [error, setError] = useState("");
  const changed = () => {
    setConfirmed(false);
    setDatumConfirmed(false);
    setError("");
  };
  const current = draft.base === project;
  const datumChanged = draft.datum !== originalDatum;
  const toolOptions = [
    { value: "", label: "Herramienta desconocida" },
    ...registry.tools.all().map((t) => ({ value: t.id, label: t.name })),
  ];
  if (draft.tool.catalogId && !registry.tools.has(draft.tool.catalogId))
    toolOptions.push({
      value: draft.tool.catalogId,
      label: `Id conservado: ${draft.tool.catalogId} (no reconocido)`,
    });
  return (
    <details>
      <summary>Declarar adquisición de corrida {run.id}</summary>
      <p>
        Estas declaraciones se aplican a {run.curveIds.length} curvas de la
        corrida:{" "}
        {run.curveIds
          .map(
            (id) => entry.well.curves.find((c) => c.id === id)?.mnemonic ?? id,
          )
          .join(", ")}
        . Verificá que compartan herramienta y procesado. No se deducen
        fabricante/modelo del nombre de la curva. Campos vacíos permanecen
        desconocidos.
      </p>
      <Field label="Datum MD del pozo (todas las corridas)">
        <TextField
          aria-label="Datum MD del pozo (todas las corridas)"
          value={draft.datum ?? ""}
          onChange={(value) => {
            changed();
            setDraft((d) => ({ ...d, datum: value || null }));
          }}
        />
      </Field>
      <p>
        Este datum describe el índice MD de todo el pozo; declararlo no
        transforma profundidades. Cambiarlo puede invalidar preparaciones y
        comparaciones vinculadas a la referencia anterior.
      </p>
      {datumChanged && (
        <Checkbox
          label="Confirmo el datum MD para todas las curvas y corridas del pozo"
          checked={datumConfirmed}
          onChange={setDatumConfirmed}
        />
      )}
      {!current && (
        <Callout tone="warn">
          Cambió el proyecto. Recargá la declaración para editar el contexto
          vigente.
          <Button
            onClick={() => {
              setDraft(initial());
              setConfirmed(false);
              setError("");
            }}
          >
            Recargar declaración de adquisición
          </Button>
        </Callout>
      )}
      <Field label="Herramienta declarada de corrida">
        <Select
          aria-label="Herramienta declarada de corrida"
          value={draft.tool.catalogId ?? ""}
          onChange={(value) => {
            changed();
            setDraft((d) => ({
              ...d,
              tool: { ...d.tool, catalogId: value || null },
            }));
          }}
          options={toolOptions}
        />
      </Field>
      {(
        [
          ["Fabricante confirmado", "vendor"],
          ["Modelo confirmado", "model"],
        ] as const
      ).map(([label, key]) => (
        <Field key={key} label={label}>
          <TextField
            aria-label={label}
            value={draft.tool[key] ?? ""}
            onChange={(v) => {
              changed();
              setDraft((d) => ({
                ...d,
                tool: { ...d.tool, [key]: v || null },
              }));
            }}
          />
        </Field>
      ))}
      <p>
        Lodo registrado en adquisición: salinidad equivalente NaCl{" "}
        {run.mud.salinityPpmNaClEquivalent ?? "desconocida"} ppm; Rm{" "}
        {run.mud.resistivityOhmM ?? "desconocida"} Ω·m; temperatura{" "}
        {run.mud.temperatureC ?? "desconocida"} °C. Este esquema no declara
        tipo/composición, Rmf/Rmc ni referencias de laboratorio; esos faltantes
        siguen pendientes. No son Rw.
      </p>
      <Field label="Estado del procesado adquirido">
        <Select
          aria-label="Estado del procesado adquirido"
          value={draft.corrections.status}
          onChange={(v) => {
            changed();
            setDraft((d) => ({
              ...d,
              corrections: {
                ...d.corrections,
                status: v as "unknown" | "declared",
              },
            }));
          }}
          options={[
            { value: "unknown", label: "Desconocido" },
            { value: "declared", label: "Efectos aplicados declarados" },
          ]}
        />
      </Field>
      <p>
        Declarar sin efectos registrados no prueba que el perfil esté crudo.
        Para volver a desconocido después de registrar efectos, quitá
        explícitamente esas declaraciones. Guardar crea una revisión y conserva
        la anterior.
      </p>
      {draft.corrections.effects.map((effect, index) => (
        <fieldset key={index}>
          <legend>Efecto adquirido {index + 1}</legend>
          <Field label={`Efecto aplicado ${index + 1}`}>
            <Select
              aria-label={`Efecto aplicado ${index + 1}`}
              value={effect.effect}
              onChange={(value) => {
                changed();
                setDraft((d) => ({
                  ...d,
                  corrections: {
                    ...d.corrections,
                    effects: d.corrections.effects.map((e, n) =>
                      n === index ? { ...e, effect: value } : e,
                    ),
                  },
                }));
              }}
              options={[
                { value: "", label: "Elegir efecto" },
                ...ENVIRONMENT_EFFECTS.map((e) => ({
                  value: e.id,
                  label: e.label,
                })),
                ...(!ENVIRONMENT_EFFECTS.some((e) => e.id === effect.effect) &&
                effect.effect
                  ? [
                      {
                        value: effect.effect,
                        label: `Efecto conservado: ${effect.effect}`,
                      },
                    ]
                  : []),
              ]}
            />
          </Field>
          {(
            [
              ["Método aplicado", "method"],
              ["Versión aplicada (opcional)", "version"],
              ["Referencia del procesado", "reference"],
            ] as const
          ).map(([label, key]) => (
            <Field key={key} label={`${label} ${index + 1}`}>
              <TextField
                aria-label={`${label} ${index + 1}`}
                value={effect[key] ?? ""}
                onChange={(value) => {
                  changed();
                  setDraft((d) => ({
                    ...d,
                    corrections: {
                      ...d.corrections,
                      effects: d.corrections.effects.map((e, n) =>
                        n === index
                          ? {
                              ...e,
                              [key]: key === "version" ? value || null : value,
                            }
                          : e,
                      ),
                    },
                  }));
                }}
              />
            </Field>
          ))}
          <Button
            onClick={() => {
              changed();
              setDraft((d) => ({
                ...d,
                corrections: {
                  ...d.corrections,
                  effects: d.corrections.effects.filter((_, n) => n !== index),
                },
              }));
            }}
          >
            Quitar declaración de efecto {index + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        disabled={draft.corrections.status !== "declared"}
        onClick={() => {
          changed();
          setDraft((d) => ({
            ...d,
            corrections: {
              ...d.corrections,
              effects: [
                ...d.corrections.effects,
                { effect: "", method: "", version: null, reference: "" },
              ],
            },
          }));
        }}
      >
        Añadir efecto aplicado
      </Button>
      <Checkbox
        checked={confirmed}
        onChange={setConfirmed}
        label="Confirmo estas declaraciones de adquisición para todas las curvas de la corrida"
      />
      {error && <Callout tone="error">{error}</Callout>}
      <Button
        disabled={!confirmed || !current || (datumChanged && !datumConfirmed)}
        onClick={() => {
          try {
            const declaration = {
              tool: {
                catalogId: draft.tool.catalogId,
                vendor: draft.tool.vendor?.trim() || null,
                model: draft.tool.model?.trim() || null,
              },
              corrections: {
                ...draft.corrections,
                effects: draft.corrections.effects.map((e) => ({
                  effect: e.effect.trim(),
                  method: e.method.trim(),
                  version: e.version?.trim() || null,
                  reference: e.reference.trim(),
                })),
              },
            };
            useProject
              .getState()
              .commit(
                `Declarar adquisición de ${run.id}`,
                (p) =>
                  updateRunAcquisition(
                    p,
                    draft.base,
                    entry.well.id,
                    run.id,
                    declaration,
                    registry.tools,
                    draft.datum?.trim() || null,
                  ),
                { group: `acquisition:${entry.inputRevisionId}:${run.id}` },
              );
            setError("");
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        Guardar declaración de adquisición
      </Button>
    </details>
  );
}

export function EnvironmentPanel({
  project,
  entry,
  curveId,
}: {
  project: Project;
  entry: WellEntry;
  curveId: string;
}) {
  const curve = entry.well.curves.find((c) => c.id === curveId);
  if (!curve) return null;
  const acquisition =
    project.inputRevisions?.[entry.inputRevisionId ?? ""]?.acquisition ??
    unknownAcquisition();
  const reviews = reviewEnvironment(
    entry.well,
    acquisition,
    curve,
    registry.tools,
  );
  const run = acquisition.runs.find((r) => r.curveIds.includes(curveId));
  return (
    <details>
      <summary>Correcciones ambientales · catálogo y adquisición</summary>
      <p>
        Relevamiento de {curve.mnemonic}. Las familias generales permanecen
        pendientes de admisión; registrar datos no las habilita. La excepción
        específica MGT tiene su propia referencia, condiciones y aceptación con
        preview debajo. Declarar adquisición no modifica medidas.
      </p>
      <p>
        Atribución del catálogo por rol/mnemónico:{" "}
        {registry.tools.ownerOf(curve)?.name ?? "sin familia atribuida"}; no
        confirma instrumento físico. Corrida declarada:{" "}
        {run?.id ?? "desconocida"}.
      </p>
      {!run && (
        <Callout tone="warn">
          Registrá una pertenencia conocida en «Gestionar corridas y alineación
          conjunta». No se inventa una corrida para habilitar un método.
        </Callout>
      )}
      {run && (
        <AcquisitionEditor
          key={`${entry.inputRevisionId}:${run.id}`}
          project={project}
          entry={entry}
          run={run}
        />
      )}
      {!reviews.length && (
        <p>
          No hay candidato ambiental relevado para este rol. No se sustituye por
          otra familia de herramienta.
        </p>
      )}
      {reviews.map((review) => (
        <section key={review.candidate.id} aria-label={review.candidate.name}>
          <h3>{review.candidate.name} · no ejecutable</h3>
          <p>{review.candidate.limitation}</p>
          <p>
            Relevar según el modelo: {review.candidate.metadata} Las entradas
            siguientes son un inventario, no requisitos definitivos de una
            fórmula.
          </p>
          <ul>
            {review.survey.map((s) => (
              <li key={s.label}>
                {s.label} ({unitLabel(s.expectedUnit)}):{" "}
                {s.curves.length
                  ? s.curves
                      .map((c) => `${c.mnemonic} · ${unitLabel(c.unit)}`)
                      .join(", ") +
                    " · importada, calidad/procesado por verificar"
                  : "sin curva disponible"}
                .
              </li>
            ))}
          </ul>
          <ul aria-label={`Bloqueos de ${review.candidate.name}`}>
            {review.blockers.map((b, n) => (
              <li key={`${b.code}:${n}`}>{b.message}</li>
            ))}
          </ul>
          <a
            href={review.candidate.reference.url}
            target="_blank"
            rel="noreferrer"
          >
            {review.candidate.reference.title}
          </a>
        </section>
      ))}
      <MgtPanel
        key={curveId}
        project={project}
        entry={entry}
        curveId={curveId}
      />
    </details>
  );
}
