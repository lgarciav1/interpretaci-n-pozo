/** Copia auditable de preparación/DRX y diagnóstico de originales para el informe. */
import type { AcquisitionMetadata } from "../../core/inputs/acquisition";
import type { Interpretation } from "../../core/interpretation";
import {
  defaultDiagnosticSelection,
  diagnosticInputs,
  summarizeEnvironment,
  type EnvironmentDiagnosticSummary,
} from "../../core/preparation/environmentDiagnostics";
import {
  readGrCalibration,
  XRD_CALIBRATION_SETTING,
} from "../../core/preparation/xrdCalibration";
import {
  readXrdCutoff,
  XRD_CUTOFF_SETTING,
} from "../../core/preparation/xrdCutoff";
import { xrdContract } from "../../core/preparation/xrd";
import type { Registry } from "../../core/registry";
import type { Well } from "../../core/well";
import type { PreparedPackage } from "../../core/preparation/plan";
import { nodeNormalization } from "../../core/preparation/state";
import { preparedCurveId } from "../../core/preparation/source";
import {
  NORMALIZATION_METHOD_LABEL,
  normalizationAnchorsList,
} from "../../core/preparation/normalization";
import { normalizationQualityCounts } from "../../core/preparation/quality";
import { unitLabel } from "../../core/units";

export interface PreparationReport {
  revision: string | null;
  datum: string | null;
  acquisition: { run: string; tool: string; processing: string }[];
  diagnostic: EnvironmentDiagnosticSummary;
  laboratory: {
    name: string;
    samples: number;
    basis: string;
    reference: string;
  }[];
  evidence: {
    dataset: string;
    kind: string;
    zone: string;
    status: string;
    reference: string;
    relationship: string;
    revision: string;
    digest: string;
    values: string;
  }[];
  /** Normalizaciones de curva (0060): parámetros de la receta y, si hay resultado vigente, los percentiles de origen. */
  normalizations: {
    curve: string;
    method: string;
    interval: { top: number; base: number };
    anchors: { percentile: number; source: number | null; reference: number }[];
    unit: string;
    samples: number | null;
    gain: number | null;
    normalized: number | null;
    outOfDomain: number | null;
  }[];
  issues: string[];
}
export function buildPreparationReport(
  well: Well,
  interpretation: Interpretation,
  revision: string | null,
  catalog: Registry,
  acquisition?: AcquisitionMetadata,
  prepared?: PreparedPackage | null,
): PreparationReport {
  const report: PreparationReport = {
    revision,
    datum: acquisition?.depth.datum ?? null,
    acquisition: (acquisition?.runs ?? []).map((r) => ({
      run: r.id,
      tool:
        [r.tool.vendor, r.tool.model].filter(Boolean).join(" ") ||
        "Modelo desconocido",
      processing:
        r.corrections.status === "unknown"
          ? "Desconocido"
          : r.corrections.effects.length
            ? r.corrections.effects
                .map((e) => `${e.effect}: ${e.method} (${e.reference})`)
                .join("; ")
            : "Declarado sin efectos registrados; no prueba perfil crudo",
    })),
    diagnostic: summarizeEnvironment(
      well,
      interpretation.zones,
      diagnosticInputs(well, defaultDiagnosticSelection(well)),
    ),
    laboratory: [],
    evidence: [],
    normalizations: [],
    issues: [],
  };
  for (const node of interpretation.preparation?.nodes ?? []) {
    const config = nodeNormalization(node);
    if (!config) continue;
    const curve = well.curves.find((c) => c.id === node.input.curveId);
    const id = preparedCurveId(node.id, "masked");
    const payload = prepared?.artifacts.find((a) => a.id === id);
    const stats = payload?.normalization ?? null;
    report.normalizations.push({
      curve: curve?.mnemonic ?? node.input.curveId,
      method: NORMALIZATION_METHOD_LABEL[config.method],
      interval: { top: config.top, base: config.base },
      anchors: stats
        ? normalizationAnchorsList(config, stats)
        : normalizationAnchorsList(config, { sourceLow: NaN, sourceHigh: NaN }).map((a) => ({ ...a, source: null })),
      unit: curve ? unitLabel(curve.unit) : "",
      samples: stats?.samples ?? null,
      gain: stats?.gain ?? null,
      normalized: payload ? normalizationQualityCounts(payload.quality).normalized : null,
      outOfDomain: stats?.outOfDomain ?? null,
    });
  }
  const effective = (key: string, zoneId: string) =>
    interpretation.params.zones[zoneId]?.[key] ??
    interpretation.params.global[key] ??
    catalog.paramSpecs.get(key)?.spec.default;
  for (const set of well.pointSets.filter((s) => s.kind === "xrd")) {
    try {
      const contract = xrdContract(set);
      report.laboratory.push({
        name: set.name,
        samples: set.pointIds.length,
        basis: `${contract.basis === "mass" ? "Masa" : "Volumen"} · ${contract.scope === "whole-rock" ? "roca completa" : "fracción arcilla"} · ${contract.scale}`,
        reference: contract.report,
      });
    } catch (e) {
      report.issues.push(`Laboratorio ${set.name}: ${String(e)}`);
    }
    for (const [key, raw] of Object.entries(
      interpretation.pointSets[set.id]?.settings ?? {},
    )) {
      const gr = key.startsWith(XRD_CALIBRATION_SETTING + ":"),
        cutoff = key.startsWith(XRD_CUTOFF_SETTING + ":");
      if (!gr && !cutoff) continue;
      try {
        const p = gr ? readGrCalibration(raw) : null,
          c = cutoff ? readXrdCutoff(raw) : null;
        const record = p ?? c;
        if (!record) continue;
        const zoneId = record.config.zoneId;
        if (
          key !==
          (gr ? XRD_CALIBRATION_SETTING : XRD_CUTOFF_SETTING) + ":" + zoneId
        )
          throw new Error("La clave de evidencia no coincide con su zona.");
        const zone = interpretation.zones.find((z) => z.id === zoneId);
        const matches =
          !!zone &&
          (p
            ? effective("grClean", zoneId) === p.fit.applied.clean &&
              effective("grShale", zoneId) === p.fit.applied.shale &&
              effective("vsh.method", zoneId) === p.config.method
            : effective("vshCutoff", zoneId) === c!.config.cutoff);
        const sameRevision =
          revision !== null &&
          revision === record.comparison.evidence.inputRevisionId;
        report.evidence.push({
          dataset: set.name,
          kind: p ? "Calibración GR" : "Decisión de cutoff",
          zone: zone?.name ?? `${zoneId} (zona ausente)`,
          status:
            c && !c.impact
              ? "Registro sin impacto de aceptación; revisar"
              : matches && sameRevision
                ? "Registro histórico; parámetros y revisión coinciden"
                : "Registro histórico; parámetros o revisión cambiaron",
          reference: p ? p.config.independentReference : c!.config.reference,
          relationship: record.config.relationship,
          revision: record.comparison.evidence.inputRevisionId,
          digest: record.comparison.evidence.inputDigest,
          values: p
            ? `Método ${p.config.method}; GR limpio ${p.fit.applied.clean}; GR lutita ${p.fit.applied.shale} gAPI; ${p.fit.locations} localizaciones; RMSE ${p.fit.metrics.rmse}; RMSE por bloques ${p.fit.validation?.rmse ?? "sin dato"}.` +
              (p.config.fixed
                ? ` Extremo externo ${p.config.fixed.end}: ${p.config.fixed.value} gAPI; referencia: ${p.config.fixed.reference}.`
                : "")
            : `Vsh cutoff ${c!.before} → ${c!.config.cutoff}. Justificación: ${c!.config.justification}. Impacto registrado: ${JSON.stringify(c!.impact)}.`,
        });
      } catch (e) {
        report.issues.push(
          `Evidencia ${set.name} / ${key}: no interpretable; se conserva en el proyecto. ${String(e)}`,
        );
      }
    }
  }
  return report;
}

/** Normalizaciones (0060): método, intervalo, percentiles de origen → referencias y conteos, como tabla. */
function normalizationHtml(
  report: PreparationReport,
  e: (text: unknown) => string,
): string {
  if (!report.normalizations.length) return "";
  const num = (v: number | null) =>
    v === null || !Number.isFinite(v)
      ? "sin resultado vigente"
      : v.toLocaleString("es-AR", { maximumSignificantDigits: 6 });
  const rows = report.normalizations
    .map(
      (r) =>
        `<tr><td>${e(r.curve)}</td><td>${e(r.method)}</td><td>${num(r.interval.top)}–${num(r.interval.base)} m MD</td><td>${r.anchors.map((a) => `P${num(a.percentile)}: ${num(a.source)} → ${num(a.reference)} ${e(r.unit)}`).join("<br>")}</td><td>${num(r.samples)}</td><td>${num(r.gain)}</td><td>${num(r.normalized)}</td><td>${num(r.outOfDomain)}</td></tr>`,
    )
    .join("");
  return `<h3>Normalización de curvas</h3>
    <p>Corrección por posibles errores de calibración y escala (Clase 8, slides 9–10). Los percentiles de origen salen de las muestras finitas del intervalo de referencia, sin excluidas ni estimadas, de la curva después de las demás etapas; los valores de referencia los ingresó el usuario (un pozo, sin ajuste entre pozos). Se aplica a toda la curva; las muestras normalizadas llevan la bandera 256 y las que quedan fuera del dominio físico del rol se conservan con la bandera 128.</p>
    <table><thead><tr><th>Curva</th><th>Método</th><th>Intervalo de referencia</th><th>Percentil: origen → referencia</th><th>Muestras de origen</th><th>Ganancia</th><th>Normalizadas</th><th>Fuera de dominio</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function preparationReportHtml(
  report: PreparationReport,
  escape: (text: unknown) => string,
): string {
  const e = escape,
    d = report.diagnostic;
  const count = (n: number, total: number) =>
    total ? `${n}/${total}` : "Sin soporte";
  const rows = [{ name: "Total", counts: d.total }, ...d.zones];
  return `<section><h2>Preparación, laboratorio y alcance</h2>
    <p>Revisión de entradas: ${e(report.revision ?? "sin revisión vigente")}. Datum MD declarado: ${e(report.datum ?? "desconocido")}.</p>
    <p>Se trabaja con los datos disponibles. Modelo, lodo o procesado no verificables permanecen desconocidos. Las correcciones que requieren esos datos quedan fuera del alcance; MGT es opcional y conserva sus requisitos.</p>
    <h3>Adquisición declarada</h3>${report.acquisition.length ? `<table><thead><tr><th>Corrida</th><th>Herramienta</th><th>Procesado</th></tr></thead><tbody>${report.acquisition.map((r) => `<tr><td>${e(r.run)}</td><td>${e(r.tool)}</td><td>${e(r.processing)}</td></tr>`).join("")}</tbody></table>` : "<p>Sin declaraciones de corrida; fabricante, modelo y procesado desconocidos.</p>"}
    <h3>Diagnóstico de originales · criterios predeterminados</h3>
    <p>Todo el pozo. Caliper mínimo ${d.criteria.minCaliperIn} in; tolerancia ${d.criteria.washoutToleranceIn} in; PE &gt;${d.criteria.peMin} b/e con densidad &lt;${d.criteria.rhoMax} g/cm³; separación resistiva ≥${100 * d.criteria.minSeparation} %. Son criterios operativos. Cada cociente usa su soporte válido; los recuentos son muestras, no espesores.</p>
    <p>Entradas: ${d.inputs.map((i) => `${e(i.mnemonic)} (${e(i.originalUnit)} → ${e(i.canonicalUnit)})`).join("; ") || "sin entradas seleccionables"}. Si hay varias curvas de un rol, no se elige una arbitrariamente.</p>
    <table><thead><tr><th>Zona</th><th>Muestras</th><th>CAL bajo mínimo</th><th>Ensanchamiento / pares</th><th>CAL &lt; BS / pares</th><th>PE sospechoso / pares</th><th>Separación / ternas</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${e(r.name)}</td><td>${r.counts.samples}</td><td>${r.counts.invalidCaliper}</td><td>${count(r.counts.washout, r.counts.geometryPairs)}</td><td>${count(r.counts.belowBit, r.counts.geometryPairs)}</td><td>${count(r.counts.suspectPe, r.counts.pePairs)}</td><td>${count(r.counts.separated, r.counts.resistivityTriples)}</td></tr>`).join("")}</tbody></table>
    <p>CAL no determina revoque/standoff; PE sospechoso no confirma baritina; separación resistiva no prueba invasión. Este informe no reproduce controles temporales ni la hipótesis radial del panel: adjuntá su JSON si los usaste.</p>
    ${[...d.issues, ...report.issues].map((issue) => `<p>${e(issue)}</p>`).join("")}
    ${normalizationHtml(report, e)}
    <h3>Laboratorio DRX disponible</h3>${report.laboratory.length ? `<table><thead><tr><th>Conjunto</th><th>Muestras</th><th>Base</th><th>Referencia</th></tr></thead><tbody>${report.laboratory.map((l) => `<tr><td>${e(l.name)}</td><td>${l.samples}</td><td>${e(l.basis)}</td><td>${e(l.reference)}</td></tr>`).join("")}</tbody></table>` : "<p>Sin laboratorio DRX importado. No se afirma calibración DRX para este pozo.</p>"}
    <h3>Evidencia DRX registrada</h3><p>Registros históricos de aceptación; la coincidencia de parámetros y revisión no revalida soporte, decisiones de muestras ni hipótesis. Para recalibrar se debe volver al panel y generar evidencia vigente. El proyecto conserva el JSON completo.</p>
    ${report.evidence.length ? report.evidence.map((r) => `<article><h4>${e(r.kind)} · ${e(r.dataset)} · ${e(r.zone)}</h4><p>${e(r.status)}.</p><p>${e(r.values)}</p><p>Relación adoptada: ${e(r.relationship)}</p><p>Referencia: ${e(r.reference)}</p><p>Revisión de aceptación: ${e(r.revision)}. Huella de entradas: ${e(r.digest)}.</p></article>`).join("") : "<p>Sin decisiones de calibración GR/cutoff registradas en DRX.</p>"}
    </section>`;
}
