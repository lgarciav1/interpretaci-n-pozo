/** Decisión manual de cutoff, independiente del ajuste GR. No infiere permeabilidad ni pay desde DRX. */
import type { ClientResult } from "../engine/client";
import { engineDecisionKey, sameContext } from "../engine/context";
import type { Interpretation } from "../interpretation";
import type { TableValue } from "../module";
import type { PointSet } from "../pointSets";
import type { Registry } from "../registry";
import type { Curve } from "../well";
import type { DataContext } from "./projection";
import { xrdContract } from "./xrd";
import {
  evaluateXrdComparison,
  readXrdRecord,
  type XrdComparisonConfig,
  type XrdComparisonRecord,
} from "./xrdEvidence";

export const XRD_CUTOFF_SETTING = "xrd:cutoff";
export interface XrdCutoffConfig {
  zoneId: string;
  cutoff: number;
  clayClean: number;
  clayShale: number;
  relationship: string;
  justification: string;
  reference: string;
  classificationDeclared: true;
}
export interface XrdCutoffRow {
  id: string;
  top: number;
  base: number | null;
  labProxy: number | null;
  vsh: number | null;
  coverage: number;
  dispersion: number | null;
  quality: number;
  reason: string | null;
}
export interface CutoffImpact {
  netRes: number | null;
  netPay: number | null;
  noDataPay: number | null;
  ooip: number | null;
  ogip: number | null;
}
export interface XrdCutoffProposal {
  version: 1;
  method: "xrd-cutoff-v1";
  config: XrdCutoffConfig;
  comparison: XrdComparisonRecord;
  decisionKey: string;
  source: string;
  setId: string;
  before: number;
  rows: XrdCutoffRow[];
  /** null durante el borrador; antes/después null si faltan entradas para sensibilidad. */
  impact: { before: CutoffImpact | null; after: CutoffImpact | null } | null;
}
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const fraction = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;
const text = (v: unknown, min = 1): v is string =>
  typeof v === "string" && v.trim().length >= min && v.length <= 4000;
function exact(
  v: unknown,
  keys: string[],
): asserts v is Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    throw new Error("Estructura de evidencia de cutoff DRX inválida.");
}
export function validateXrdCutoffConfig(
  c: unknown,
): asserts c is XrdCutoffConfig {
  exact(c, [
    "zoneId",
    "cutoff",
    "clayClean",
    "clayShale",
    "relationship",
    "justification",
    "reference",
    "classificationDeclared",
  ]);
  if (
    !text(c.zoneId) ||
    !fraction(c.cutoff) ||
    !fraction(c.clayClean) ||
    !fraction(c.clayShale) ||
    c.clayShale <= c.clayClean ||
    !text(c.relationship, 12) ||
    !text(c.justification, 12) ||
    !text(c.reference, 12) ||
    c.classificationDeclared !== true
  )
    throw new Error(
      "Declará zona, cutoff, extremos del proxy, relación física, justificación y referencia de clasificación.",
    );
}
export function validateCutoffStep(value: number, registry: Registry) {
  const spec = registry.paramSpecs.get("vshCutoff")?.spec;
  if (
    spec?.type !== "number" ||
    !spec.step ||
    !finite(value) ||
    value < spec.min ||
    value > spec.max ||
    Math.abs(
      (value - spec.min) / spec.step -
        Math.round((value - spec.min) / spec.step),
    ) > 1e-8
  )
    throw new Error(
      "El cutoff debe respetar el rango y paso del parámetro Vsh vigente; no se redondea silenciosamente.",
    );
}
/** Adapta la fuente VSH activa del resultado completo; nunca sustituye una fuente medida por un módulo. */
function activeVsh(data: DataContext, result: ClientResult) {
  if (!sameContext(data.context, result.context))
    throw new Error(
      "Esperá Vsh del contexto vigente antes de evaluar el cutoff.",
    );
  const source = result.sources.VSH;
  if (source?.kind === "curve") {
    const curve = data.eligible.find((c) => c.id === source.curveId);
    if (curve?.role === "VSH" && curve.unit === "v/v")
      return { curve, source: `curve:${curve.id}` };
  } else if (source?.kind === "module") {
    const output = result.outputs.find(
      (o) =>
        o.active &&
        o.moduleId === source.moduleId &&
        o.port === "VSH" &&
        o.kind === "curve",
    );
    if (
      output?.value instanceof Float64Array &&
      output.unit === "v/v" &&
      result.nodes.some(
        (n) => n.moduleId === source.moduleId && n.status === "ok",
      )
    ) {
      const curve: Curve = {
        id: "@xrd:active-vsh",
        mnemonic: "VSH",
        role: "VSH",
        unit: "v/v",
        origin: { kind: "computed", moduleId: source.moduleId, port: "VSH" },
        data: output.value,
      };
      return { curve, source: `module:${output.key}` };
    }
  }
  throw new Error(
    "Falta Vsh activo válido; no se evalúa un cutoff contra una alternativa inactiva.",
  );
}
export async function proposeXrdCutoff(
  data: DataContext,
  i: Interpretation,
  set: PointSet,
  comparisonConfig: XrdComparisonConfig,
  inputRevisionId: string,
  config: XrdCutoffConfig,
  result: ClientResult,
  registry: Registry,
  checkpoint: () => Promise<void> = async () => {},
): Promise<XrdCutoffProposal> {
  validateXrdCutoffConfig(config);
  validateCutoffStep(config.cutoff, registry);
  if (set.pointIds.length > 2048)
    throw new Error(
      "Acotá la evaluación a 2048 muestras; no se truncan datos.",
    );
  const zone = i.zones.find((z) => z.id === config.zoneId);
  if (
    !zone ||
    i.zones.some(
      (z) => z.id !== zone.id && z.top < zone.base && z.base > zone.top,
    )
  )
    throw new Error("Elegí una zona sin solapamientos para evaluar el cutoff.");
  const contract = xrdContract(set);
  if (
    contract.scope !== "whole-rock" ||
    (contract.basis !== "volume" && comparisonConfig.target !== "solid-volume")
  )
    throw new Error(
      "El proxy de clasificación exige arcillas en volumen de sólidos de roca completa.",
    );
  const { curve, source } = activeVsh(data, result);
  if (curve.data.length !== data.well.depth.values.length)
    throw new Error("Vsh de longitud incompatible.");
  // Proyección efímera exclusivamente para emparejar/hashear Vsh: no entra en los originales ni en el grafo.
  const view = { ...data, eligible: [curve] };
  const comparison = await evaluateXrdComparison(
    view,
    i,
    set,
    { ...comparisonConfig, curveId: curve.id },
    inputRevisionId,
    checkpoint,
  );
  const rows = comparison.rows.map(({ pair, composition }): XrdCutoffRow => {
    let reason = composition.reason ?? pair.reason;
    if (
      pair.topMD <= zone.top ||
      (pair.baseMD ?? pair.topMD) >= zone.base ||
      pair.crossesZone
    )
      reason = "Fuera de la zona o cruza una frontera.";
    const labProxy =
      composition.clayFraction === null
        ? null
        : (composition.clayFraction - config.clayClean) /
          (config.clayShale - config.clayClean);
    if (!reason && !fraction(labProxy))
      reason = "Contenido fuera de la relación declarada; no se recorta.";
    if (!reason && !fraction(pair.value))
      reason = "Vsh fuera de dominio o sin soporte.";
    return {
      id: pair.id,
      top: pair.topMD,
      base: pair.baseMD,
      labProxy: fraction(labProxy) ? labProxy : null,
      vsh: fraction(pair.value) ? pair.value : null,
      coverage: pair.coverage,
      dispersion: pair.dispersion,
      quality: pair.quality,
      reason,
    };
  });
  if (!rows.some((r) => !r.reason && r.labProxy !== null && r.vsh !== null))
    throw new Error(
      "Sin pares válidos dentro de la zona para fundamentar esta decisión.",
    );
  return {
    version: 1,
    method: "xrd-cutoff-v1",
    config,
    comparison: comparison.record,
    source,
    setId: set.id,
    decisionKey: engineDecisionKey(i),
    before: Number(
      i.params.zones[zone.id]?.vshCutoff ??
        i.params.global.vshCutoff ??
        registry.paramSpecs.get("vshCutoff")!.spec.default,
    ),
    rows,
    impact: null,
  };
}
/** Lectura exacta de la fila vigente del motor existente: no interpola ni recalcula netos. */
export function cutoffImpact(
  result: ClientResult,
  zoneId: string,
): CutoffImpact | null {
  if (
    !result.nodes.some(
      (n) => n.moduleId === "cutoff-sensitivity" && n.status === "ok",
    )
  )
    return null;
  const table = result.outputs.find(
    (o) =>
      o.moduleId === "cutoff-sensitivity" &&
      o.port === "CUTOFF_SWEEP" &&
      o.kind === "table",
  )?.value as TableValue | undefined;
  const row = table?.rows.find(
    (r) => r.variable === "vsh" && r.zoneId === zoneId && r.current === 1,
  );
  if (!row) return null;
  return Object.fromEntries(
    ["netRes", "netPay", "noDataPay", "ooip", "ogip"].map((k) => [
      k,
      finite(row[k]) ? row[k] : null,
    ]),
  ) as unknown as CutoffImpact;
}
export function readXrdCutoff(raw: unknown): XrdCutoffProposal | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string" || raw.length > 2000000)
    throw new Error("Evidencia de cutoff DRX inválida.");
  const p = JSON.parse(raw);
  if (p?.version !== 1 || p?.method !== "xrd-cutoff-v1")
    throw new Error(
      "Versión de cutoff DRX desconocida; se conserva sin ejecutar.",
    );
  exact(p, [
    "version",
    "method",
    "config",
    "comparison",
    "decisionKey",
    "source",
    "setId",
    "before",
    "rows",
    "impact",
  ]);
  validateXrdCutoffConfig(p.config);
  readXrdRecord(JSON.stringify(p.comparison));
  if (
    typeof p.decisionKey !== "string" ||
    !p.decisionKey ||
    !text(p.source) ||
    !text(p.setId) ||
    !fraction(p.before) ||
    !Array.isArray(p.rows) ||
    !p.rows.length ||
    p.rows.length > 2048 ||
    p.rows.length !== (p.comparison as XrdComparisonRecord).evidence.rows
  )
    throw new Error("Evidencia de cutoff incompleta.");
  const ids = new Set<string>();
  for (const r of p.rows) {
    exact(r, [
      "id",
      "top",
      "base",
      "labProxy",
      "vsh",
      "coverage",
      "dispersion",
      "quality",
      "reason",
    ]);
    if (
      !text(r.id) ||
      ids.has(r.id) ||
      !finite(r.top) ||
      !(r.base === null || (finite(r.base) && r.base > r.top)) ||
      !(r.labProxy === null || fraction(r.labProxy)) ||
      !(r.vsh === null || fraction(r.vsh)) ||
      !fraction(r.coverage) ||
      !(r.dispersion === null || (finite(r.dispersion) && r.dispersion >= 0)) ||
      !Number.isInteger(r.quality) ||
      Number(r.quality) < 0 ||
      !(r.reason === null || text(r.reason)) ||
      (r.reason === null && (r.labProxy === null || r.vsh === null))
    )
      throw new Error("Fila de evidencia de cutoff inválida.");
    ids.add(r.id);
  }
  if (p.impact !== null) {
    exact(p.impact, ["before", "after"]);
    for (const impact of Object.values(p.impact)) {
      if (impact === null) continue;
      exact(impact, ["netRes", "netPay", "noDataPay", "ooip", "ogip"]);
      if (
        Object.values(impact).some((v) => v !== null && (!finite(v) || v < 0))
      )
        throw new Error("Impacto de cutoff inválido.");
    }
  }
  return p as unknown as XrdCutoffProposal;
}
