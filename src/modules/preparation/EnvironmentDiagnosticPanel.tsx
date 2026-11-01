import { useMemo, useState } from "react";
import { unknownAcquisition } from "../../core/inputs/acquisition";
import {
  DEFAULT_DIAGNOSTIC_CRITERIA,
  DIAGNOSTIC_ROLES,
  DIAGNOSTIC_UNITS,
  defaultDiagnosticSelection,
  diagnosticInputs,
  diagnosticSample,
  summarizeEnvironment,
  type DiagnosticCounts,
} from "../../core/preparation/environmentDiagnostics";
import type { Project, WellEntry } from "../../core/state/project";
import { unitLabel } from "../../core/units";
import { registry } from "../../modules";
import {
  invasionParamsAt,
  nearestSampleIndex,
  radialViewAt,
  resolveInvasionInputs,
  statusText,
  zoneLookup,
} from "../../modules/invasion-step/radial";
import {
  Button,
  Callout,
  Checkbox,
  Field,
  Select,
  TextField,
  formatNumber,
} from "../../ui";
import { downloadFile } from "../../app/export/exportActions";

const number = (s: string) =>
  s.trim() ? Number(s.trim().replace(",", ".")) : NaN;
const show = (n: number) =>
  Number.isFinite(n) ? formatNumber(n, { digits: 4 }) : "Sin dato";
const ratio = (n: number, total: number) =>
  total
    ? `${n}/${total} (${formatNumber((100 * n) / total, { digits: 1 })} %)`
    : "Sin soporte";
const geometryText = {
  missing: "Sin par caliper/trépano válido",
  "invalid-caliper": "Caliper bajo el mínimo operativo",
  washout: "Ensanchamiento por encima de la tolerancia",
  "below-bit": "Caliper menor que trépano: revisar",
  "within-tolerance": "Sin ensanchamiento por encima de la tolerancia",
};

export function EnvironmentDiagnosticPanel(props: {
  project: Project;
  entry: WellEntry;
  top: number;
  base: number;
}) {
  // Pestaña del panel (0058): se monta solo cuando está a la vista, así el diagnóstico no corre de más.
  return (
    <section className="prep-legacy" aria-label="Diagnóstico ambiental con datos disponibles">
      <h3>Diagnóstico ambiental con datos disponibles</h3>
      <DiagnosticReview key={props.entry.well.id} {...props} />
    </section>
  );
}

function DiagnosticReview({
  project,
  entry,
  top,
  base,
}: {
  project: Project;
  entry: WellEntry;
  top: number;
  base: number;
}) {
  const { well, interpretation } = entry;
  const [selected, setSelected] = useState(() =>
    defaultDiagnosticSelection(well),
  );
  const [minimum, setMinimum] = useState(
    String(DEFAULT_DIAGNOSTIC_CRITERIA.minCaliperIn),
  );
  const [tolerance, setTolerance] = useState(
    String(DEFAULT_DIAGNOSTIC_CRITERIA.washoutToleranceIn),
  );
  const [separation, setSeparation] = useState(
    String(DEFAULT_DIAGNOSTIC_CRITERIA.minSeparation),
  );
  const [depth, setDepth] = useState(
    String(
      Number.isFinite(top)
        ? Math.max(top, well.depth.values[0]!)
        : well.depth.values[0],
    ),
  );
  const [radialHypothesis, setRadialHypothesis] = useState(false);
  const input = useMemo(
    () => diagnosticInputs(well, selected),
    [well, selected],
  );
  const criteria = useMemo(
    () => ({
      minCaliperIn: number(minimum),
      washoutToleranceIn: number(tolerance),
      minSeparation: number(separation),
    }),
    [minimum, tolerance, separation],
  );
  const review = useMemo(() => {
    try {
      const all = Number.isNaN(top) && Number.isNaN(base);
      const range = all ? undefined : { top, base };
      return {
        summary: summarizeEnvironment(
          well,
          interpretation.zones,
          input,
          criteria,
          range,
        ),
        error: "",
      };
    } catch (e) {
      return {
        summary: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [well, interpretation.zones, input, criteria, top, base]);
  const summary = review.summary;
  let index = nearestSampleIndex(well.depth.values, number(depth));
  // La muestra inspeccionada debe pertenecer también al tramo del resumen.
  if (summary && index >= 0) {
    if (well.depth.values[index]! < summary.rangeM.top) index++;
    else if (well.depth.values[index]! > summary.rangeM.base) index--;
  }
  const requestedDepth = number(depth);
  const inRange =
    !!summary &&
    Number.isFinite(requestedDepth) &&
    requestedDepth >= summary.rangeM.top &&
    requestedDepth <= summary.rangeM.base;
  const sample =
    summary &&
    summary.total.samples > 0 &&
    inRange &&
    index >= 0 &&
    index < well.depth.values.length &&
    well.depth.values[index]! >= summary.rangeM.top &&
    well.depth.values[index]! <= summary.rangeM.base
      ? diagnosticSample(well, input, index, criteria)
      : null;
  const radial = useMemo(() => {
    if (!sample || !radialHypothesis) return null;
    const curves = Object.values(input.bindings).map((b) => b!.curve);
    const inputs = resolveInvasionInputs(curves, [], null, registry.roles);
    const zone = zoneLookup(
      well.depth.values,
      interpretation.zones,
    )(sample.index);
    const params = invasionParamsAt(interpretation.params, zone?.id ?? null);
    return radialViewAt(inputs, sample.index, sample.depthM, params, {
      bitIn: sample.values.BS,
      caliperIn:
        sample.geometry === "invalid-caliper" ? undefined : sample.values.CALI,
    });
  }, [
    sample,
    radialHypothesis,
    input,
    well,
    interpretation.zones,
    interpretation.params,
  ]);
  const status = radial
    ? {
        ...statusText(radial),
        ...(radial.status === "poorly-resolved"
          ? {
              detail:
                "Varios diámetros de invasión reproducen las lecturas casi igual. El modelo no determina un diámetro único; no se adopta Rxo ni di para la interpretación.",
            }
          : {}),
      }
    : null;
  const revision = project.inputRevisions?.[entry.inputRevisionId ?? ""];
  const acquisition = revision?.acquisition ?? unknownAcquisition();
  const countsRow = (name: string, c: DiagnosticCounts, key: string) => (
    <tr key={key}>
      <th scope="row">{name}</th>
      <td>{c.samples}</td>
      <td>{c.invalidCaliper}</td>
      <td>{ratio(c.washout, c.geometryPairs)}</td>
      <td>{ratio(c.belowBit, c.geometryPairs)}</td>
      <td>{ratio(c.suspectPe, c.pePairs)}</td>
      <td>{ratio(c.separated, c.resistivityTriples)}</td>
      <td>
        {c.firstReviewIndex !== null && (
          <Button
            size="sm"
            aria-label={`Revisar primera alerta de ${name}`}
            onClick={() =>
              setDepth(String(well.depth.values[c.firstReviewIndex!]))
            }
          >
            Revisar profundidad
          </Button>
        )}
      </td>
    </tr>
  );
  return (
    <section aria-label="Revisión ambiental de originales">
      <p>
        Revisión de curvas originales importadas de {well.name}. Los resultados
        son observacionales y no cambian fuentes, parámetros, cutoffs ni
        preparaciones. Las curvas preparadas y calculadas quedan fuera de esta
        comparación.
      </p>
      <p>
        La herramienta y el procesado pueden permanecer desconocidos en el TP.
        Esta revisión no exige completarlos. El caliper por sí solo no determina
        espesor de revoque ni separación herramienta–pared; el contraste de
        resistividades no prueba invasión.
      </p>
      <details>
        <summary>Procesado declarado y compatibilidad</summary>
        <p>
          El diagnóstico observa originales incluso si hay otra fuente activa.
          Declaraciones adquiridas y recetas se muestran para revisar posibles
          efectos previos; esta vista no aplica una segunda corrección. Los
          métodos ambientales adicionales conservan sus requisitos específicos.
          La composición MGT con limpieza o efectos previos sigue bloqueada.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="prep-editor__table">
            <caption>Estado de las curvas seleccionadas</caption>
            <thead>
              <tr>
                <th>Original</th>
                <th>Procesado adquirido</th>
                <th>Preparación guardada</th>
                <th>Fuente explícita del rol</th>
              </tr>
            </thead>
            <tbody>
              {DIAGNOSTIC_ROLES.filter((role) => input.bindings[role]).map(
                (role) => {
                  const c = input.bindings[role]!.curve;
                  const run = acquisition.runs.find((r) =>
                    r.curveIds.includes(c.id),
                  );
                  const nodes =
                    interpretation.preparation?.nodes.filter(
                      (n) => n.input.curveId === c.id,
                    ) ?? [];
                  const source = interpretation.sources[role];
                  return (
                    <tr key={role}>
                      <th scope="row">{c.mnemonic}</th>
                      <td>
                        {!run || run.corrections.status === "unknown"
                          ? "Desconocido"
                          : run.corrections.effects.length
                            ? run.corrections.effects
                                .map((e) => `${e.effect}: ${e.method}`)
                                .join("; ")
                            : "Declarado sin efectos registrados"}
                      </td>
                      <td>
                        {nodes.length
                          ? nodes
                              .map(
                                (n) =>
                                  `${n.kind} (${n.enabled ? "habilitada" : "desactivada"})`,
                              )
                              .join("; ")
                          : "Sin receta"}
                      </td>
                      <td>
                        {!source
                          ? "Automática; no se altera"
                          : source.kind === "curve"
                            ? source.curveId
                            : `Módulo ${source.moduleId}`}
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
        <p>
          Una receta habilitada puede quedar invalidada por cambios de entradas.
          La disponibilidad efectiva y la elección de fuentes se revisan en sus
          controles habituales; esta tabla conserva la distinción entre receta y
          fuente.
        </p>
      </details>
      <details>
        <summary>Curvas y criterios del diagnóstico</summary>
        <div className="prep-editor__range">
          {DIAGNOSTIC_ROLES.map((role) => (
            <Field
              key={role}
              label={`Original ${role} (${unitLabel(DIAGNOSTIC_UNITS[role])})`}
            >
              <Select
                aria-label={`Original ${role} para diagnóstico`}
                value={selected[role] ?? ""}
                onChange={(value) =>
                  setSelected((s) => ({ ...s, [role]: value }))
                }
                options={[
                  { value: "", label: "Sin selección" },
                  ...well.curves
                    .filter(
                      (c) => c.origin.kind === "measured" && c.role === role,
                    )
                    .map((c) => ({
                      value: c.id,
                      label: `${c.mnemonic} · ${unitLabel(c.unit)}`,
                    })),
                ]}
              />
            </Field>
          ))}
        </div>
        <div className="prep-editor__range">
          {(
            [
              ["Caliper mínimo operativo (in)", minimum, setMinimum],
              ["Tolerancia de ensanchamiento (in)", tolerance, setTolerance],
              [
                "Separación resistiva mínima (fracción)",
                separation,
                setSeparation,
              ],
            ] as const
          ).map(([label, value, setter]) => (
            <Field key={label} label={label}>
              <TextField
                aria-label={label}
                value={value}
                onChange={setter}
                inputMode="decimal"
              />
            </Field>
          ))}
        </div>
        <p>
          Umbrales operativos, ajustables para explorar sensibilidad. PE
          sospechoso: PE &gt;4 b/e con densidad &lt;2,55 g/cm³, como el
          diagnóstico existente de mineralogía; no confirma baritina ni
          determina su corrección. Las comparaciones geométricas requieren BS
          medido: no se inventa trépano donde falta.
        </p>
      </details>
      {review.error && <Callout tone="warn">{review.error}</Callout>}
      {summary && (
        <>
          <p>
            Tramo: {show(summary.rangeM.top)}–{show(summary.rangeM.base)} m MD.
            Cada cociente usa su soporte válido; las alertas pueden coexistir en
            una muestra. Caliper bajo mínimo se cuenta aparte y no entra en los
            pares geométricos. Separación requiere al menos tres resistividades
            positivas y finitas. Son recuentos de muestras, no espesores netos.
          </p>
          {summary.issues.map((issue, i) => (
            <Callout key={i} tone="warn">
              {issue}
            </Callout>
          ))}
          {!summary.total.samples && (
            <Callout tone="warn">No hay muestras en el tramo indicado.</Callout>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="prep-editor__table">
              <caption>Alertas por zona · originales</caption>
              <thead>
                <tr>
                  <th>Zona</th>
                  <th>Muestras</th>
                  <th>CAL bajo mínimo</th>
                  <th>Ensanchamiento / pares</th>
                  <th>CAL &lt; BS / pares</th>
                  <th>PE sospechoso / pares</th>
                  <th>Separación / ternas</th>
                  <th>Inspección</th>
                </tr>
              </thead>
              <tbody>
                {countsRow("Total", summary.total, "total")}
                {summary.zones.map((z) =>
                  countsRow(z.name, z.counts, z.id ?? "outside"),
                )}
              </tbody>
            </table>
          </div>
          <Field label="Profundidad del diagnóstico (m MD)">
            <TextField
              aria-label="Profundidad del diagnóstico (m MD)"
              value={depth}
              onChange={setDepth}
              inputMode="decimal"
            />
          </Field>
          {!sample && (
            <p>
              Indicá una profundidad dentro del tramo para inspeccionar la
              muestra más cercana.
            </p>
          )}
          {sample && (
            <>
              <p>
                Inspección a {show(sample.depthM)} m MD (muestra más cercana).{" "}
                {geometryText[sample.geometry]}. Diferencia CAL–BS:{" "}
                {show(sample.deltaIn)} in. PE:{" "}
                {sample.suspectPe === null
                  ? "sin soporte"
                  : sample.suspectPe
                    ? "sospechoso"
                    : "sin firma sospechosa"}
                . Separación resistiva: {show(100 * sample.separation)} % (
                {sample.resistivityCount} lecturas válidas).
              </p>
              <table className="prep-editor__table">
                <caption>
                  Lecturas originales en la profundidad inspeccionada
                </caption>
                <thead>
                  <tr>
                    <th>Curva</th>
                    <th>Valor</th>
                    <th>Unidad canónica</th>
                  </tr>
                </thead>
                <tbody>
                  {DIAGNOSTIC_ROLES.filter((role) => input.bindings[role]).map(
                    (role) => (
                      <tr key={role}>
                        <th scope="row">
                          {input.bindings[role]!.curve.mnemonic}
                        </th>
                        <td>{show(sample.values[role] ?? NaN)}</td>
                        <td>{unitLabel(DIAGNOSTIC_UNITS[role])}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              <Checkbox
                checked={radialHypothesis}
                onChange={setRadialHypothesis}
                label="Explorar hipótesis de inducción de arreglo"
                description="Usa sensibilidades radiales aproximadas del modelo existente para estas curvas originales; no confirma fabricante ni selecciona una Rt nueva."
              />
            </>
          )}
          {radial && status && (
            <section aria-label="Hipótesis radial sobre originales">
              <Callout tone={status.tone}>
                {status.title}. {status.detail}
              </Callout>
              <p>
                Trépano del modelo: {show(radial.bitSize)} in (
                {radial.bitFrom === "curve"
                  ? "BS original"
                  : "parámetro del módulo: supuesto explícito"}
                ). Separación mínima del modelo en esta zona:{" "}
                {show(radial.params.minSeparation)}; desajuste máximo:{" "}
                {show(radial.params.maxMisfit)}. Estos parámetros pueden diferir
                del criterio de conteo anterior. Desajuste relativo:{" "}
                {show(radial.fit.misfit)}.
              </p>
              {radial.status === "poorly-resolved" && (
                <p>
                  Diámetros compatibles con el modelo: {show(radial.fit.diLow)}–
                  {show(radial.fit.diHigh)} in. Es una medida de resolución del
                  ajuste aproximado, no un intervalo de confianza experimental.
                </p>
              )}
              <table className="prep-editor__table">
                <caption>Lecturas y modelo radial aproximado</caption>
                <thead>
                  <tr>
                    <th>Curva</th>
                    <th>Investigación supuesta (in)</th>
                    <th>Observada (Ω·m)</th>
                    <th>Modelada (Ω·m)</th>
                    <th>Residuo relativo (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {radial.readings.map((r) => (
                    <tr key={r.role}>
                      <th scope="row">{r.label}</th>
                      <td>{r.r50}</td>
                      <td>{show(r.observed)}</td>
                      <td>{show(r.modelled)}</td>
                      <td>{show(100 * r.relativeError)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Es una exploración con el modelo radial existente. Los estados
                ambiguo, no resuelto e insuficiente conservan sus advertencias;
                este panel no publica una curva Rt/Rxo corregida ni modifica la
                cadena petrofísica.
              </p>
            </section>
          )}
          <Button
            onClick={() => {
              const report = {
                ...summary,
                inputRevisionId: entry.inputRevisionId ?? null,
                acquisition,
                inspectedSample: sample,
                radialHypothesis: radial
                  ? {
                      basis: "approximate-array-induction-on-originals",
                      status: radial.status,
                      description: status,
                      params: radial.params,
                      bitSize: radial.bitSize,
                      bitFrom: radial.bitFrom,
                      misfit: radial.fit.misfit,
                      compatibleDiameterIn: {
                        low: radial.fit.diLow,
                        high: radial.fit.diHigh,
                      },
                      readings: radial.readings,
                    }
                  : null,
                limitations: [
                  "Diagnóstico de originales; no aplica correcciones ni cambia fuentes.",
                  "Umbrales operativos; PE no confirma baritina; CAL no determina revoque/standoff; separación no prueba invasión.",
                  "Modelo radial aproximado bajo hipótesis explícita; no certificado del fabricante ni nueva Rt seleccionada.",
                  "Metadatos de adquisición desconocidos permanecen desconocidos.",
                ],
              };
              downloadFile({
                name: "diagnostico-ambiental.json",
                mime: "application/json",
                bytes: new TextEncoder().encode(
                  JSON.stringify(report, null, 2),
                ),
              });
            }}
          >
            Exportar diagnóstico ambiental
          </Button>
        </>
      )}
    </section>
  );
}
