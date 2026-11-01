import { pointNumbers, type PointSet } from "../pointSets";
import type { Interpretation } from "../interpretation";
import type { DataContext } from "./projection";
import type { Registry } from "../registry";
import { planGraph } from "../engine/graph";
import { VSH_METHODS, type VshMethod } from "../../petro/vsh";
import {
  fitGrCalibration,
  validateFixedGrEndpoint,
  type FixedGrEndpoint,
  validateGrPolicy,
  type CalibrationFit,
  type CalibrationPolicy,
  type GrBounds,
} from "../../petro/xrdCalibration";
import {
  readXrdRecord,
  evaluateXrdComparison,
  type XrdComparisonConfig,
  type XrdComparisonRecord,
} from "./xrdEvidence";
import { xrdContract } from "./xrd";

export const XRD_CALIBRATION_SETTING = "xrd:gr-calibration";
export interface ExternalGrEndpoint extends FixedGrEndpoint {
  externalDeclared: true;
  reference: string;
  uncertainty?: number;
  uncertaintyNote?: string;
}
export interface GrCalibrationConfig {
  version: 1 | 2;
  fixed?: ExternalGrEndpoint;
  method: VshMethod;
  zoneId: string;
  clayClean: number;
  clayShale: number;
  relationship: string;
  independentReference: string;
  independenceDeclared: true;
  policy: CalibrationPolicy;
}
export interface GrCalibrationProposal {
  version: 1 | 2;
  methodVersion: "xrd-gr-v1" | "xrd-gr-fixed-v1";
  config: GrCalibrationConfig;
  comparison: XrdComparisonRecord;
  before: Record<string, number | string | boolean>;
  fit: CalibrationFit;
  locations: {
    depth: number;
    top: number;
    base: number;
    gr: number;
    target: number;
    ids: string[];
  }[];
  exclusions: { id: string; reason: string }[];
}
export function validateCalibrationConfig(c: GrCalibrationConfig) {
  if (
    !c ||
    Object.keys(c).sort().join("|") !==
      [
        "version",
        "method",
        "zoneId",
        "clayClean",
        "clayShale",
        "relationship",
        "independentReference",
        "independenceDeclared",
        "policy",
        ...(c.version === 2 ? ["fixed"] : []),
      ]
        .sort()
        .join("|") ||
    ![1, 2].includes(c.version) ||
    c.independenceDeclared !== true ||
    !VSH_METHODS.includes(c.method) ||
    typeof c.zoneId !== "string" ||
    !c.zoneId ||
    ![c.clayClean, c.clayShale].every(Number.isFinite) ||
    c.clayClean < 0 ||
    c.clayShale > 1 ||
    c.clayShale <= c.clayClean ||
    typeof c.relationship !== "string" ||
    c.relationship.trim().length < 12 ||
    c.relationship.length > 4000 ||
    typeof c.independentReference !== "string" ||
    c.independentReference.trim().length < 12 ||
    c.independentReference.length > 4000
  )
    throw new Error(
      "Declará zona, relación de arcillas con el proxy de Vsh y evidencia independiente del ensayo.",
    );
  validateGrPolicy(c.policy);
  if (c.version === 2) {
    const f = c.fixed;
    if (
      !f ||
      Object.keys(f).some(
        (k) =>
          ![
            "end",
            "value",
            "externalDeclared",
            "reference",
            "uncertainty",
            "uncertaintyNote",
          ].includes(k),
      ) ||
      !["clean", "shale"].includes(f.end) ||
      f.externalDeclared !== true ||
      !Number.isFinite(f.value) ||
      typeof f.reference !== "string" ||
      f.reference.trim().length < 12 ||
      f.reference.length > 4000 ||
      (f.uncertainty !== undefined &&
        (!Number.isFinite(f.uncertainty) ||
          f.uncertainty < 0 ||
          typeof f.uncertaintyNote !== "string" ||
          !f.uncertaintyNote.trim())) ||
      (f.uncertaintyNote !== undefined &&
        (typeof f.uncertaintyNote !== "string" ||
          !f.uncertaintyNote.trim() ||
          f.uncertaintyNote.length > 2000))
    )
      throw new Error(
        "Declará extremo externo, referencia y significado de su incertidumbre si se informa.",
      );
  }
}
export function grBounds(registry: Registry): GrBounds {
  const get = (key: string) => {
    const spec = registry.paramSpecs.get(key)?.spec;
    if (spec?.type !== "number" || !spec.step)
      throw new Error("Falta el esquema canónico de extremos GR.");
    return { min: spec.min, max: spec.max, step: spec.step };
  };
  return { clean: get("grClean"), shale: get("grShale") };
}
export function validateCalibrationChain(
  data: DataContext,
  i: Interpretation,
  registry: Registry,
  curveId: string,
) {
  const curve = data.eligible.find((c) => c.id === curveId),
    plan = planGraph(registry, data.engineWell.curves, i),
    gr = plan.sources.get("GR"),
    igr = plan.sources.get("IGR"),
    vsh = plan.sources.get("VSH");
  if (
    !curve ||
    curve.role !== "GR" ||
    curve.unit !== "gAPI" ||
    curve.origin.kind === "computed" ||
    gr?.kind !== "curve" ||
    gr.curveId !== curveId ||
    igr?.kind !== "module" ||
    igr.moduleId !== "igr" ||
    vsh?.kind !== "module" ||
    vsh.moduleId !== "vsh" ||
    plan.nodes.get("igr")?.status !== "ready" ||
    plan.nodes.get("vsh")?.status !== "ready"
  )
    throw new Error(
      "Elegí el GR medido/preparado que alimenta la cadena IGR → Vsh. Las fuentes calculadas o alternativas inactivas no se calibran.",
    );
}
export async function proposeGrCalibration(
  data: DataContext,
  i: Interpretation,
  set: PointSet,
  comparisonConfig: XrdComparisonConfig,
  inputRevisionId: string,
  config: GrCalibrationConfig,
  registry: Registry,
  checkpoint: () => Promise<void> = async () => {},
): Promise<GrCalibrationProposal> {
  if (set.pointIds.length > 2048)
    throw new Error(
      "Acotá el ensayo a 2048 muestras para esta calibración; no se truncan datos.",
    );
  validateCalibrationConfig(config);
  if (config.fixed) validateFixedGrEndpoint(config.fixed, grBounds(registry));
  validateCalibrationChain(data, i, registry, comparisonConfig.curveId);
  const zone = i.zones.find((z) => z.id === config.zoneId);
  if (!zone) throw new Error("La zona de calibración ya no existe.");
  const overlaps = i.zones.some(
    (z) => z.id !== zone.id && z.top < zone.base && z.base > zone.top,
  );
  if (overlaps)
    throw new Error("Resolvé el solapamiento de zonas antes de calibrar.");
  const contract = xrdContract(set);
  if (
    contract.scope !== "whole-rock" ||
    (comparisonConfig.target !== "solid-volume" && contract.basis !== "volume")
  )
    throw new Error(
      "El proxy exige contenido de arcillas en volumen de sólidos de roca completa; masa nativa o fracción arcilla quedan en diagnóstico.",
    );
  const comparison = await evaluateXrdComparison(
    data,
    i,
    set,
    comparisonConfig,
    inputRevisionId,
    checkpoint,
  );
  const exclusions: GrCalibrationProposal["exclusions"] = [],
    candidates: GrCalibrationProposal["locations"] = [];
  for (let row = 0; row < comparison.rows.length; row++) {
    const { pair, composition } = comparison.rows[row]!,
      top = pair.topMD,
      base = pair.baseMD ?? pair.topMD,
      depth = top + (base - top) / 2;
    let reason = composition.reason ?? pair.reason;
    if (top <= zone.top || base >= zone.base || pair.crossesZone)
      reason = "Fuera de la zona o cruza una frontera.";
    if (!config.policy.allowEstimatedGR && pair.quality & 8)
      reason = "GR estimado: no admitido por la política.";
    const uncertainty =
      contract.minerals.reduce(
        (s, m) => s + (pointNumbers(set, `uncertainty:${m.id}`)?.[row] || 0),
        0,
      ) * (contract.scale === "percent" ? 0.01 : 1);
    if (uncertainty > config.policy.maxReportedUncertainty)
      reason =
        "Incertidumbre absoluta informada excede el umbral en la base original.";
    const target =
      composition.clayFraction === null
        ? NaN
        : (composition.clayFraction - config.clayClean) /
          (config.clayShale - config.clayClean);
    if (!reason && (!Number.isFinite(target) || target < 0 || target > 1))
      reason = "Contenido fuera de la relación declarada; no se recorta.";
    if (reason || pair.value === null) {
      exclusions.push({ id: pair.id, reason: reason ?? "Sin par" });
      continue;
    }
    candidates.push({
      top,
      base,
      depth,
      gr: pair.value,
      target,
      ids: [pair.id],
    });
  }
  candidates.sort((a, b) => a.top - b.top || a.base - b.base);
  const groups: typeof candidates = [];
  for (const point of candidates) {
    const group = groups.at(-1);
    if (group && point.top <= group.base + config.policy.separationM) {
      group.top = Math.min(group.top, point.top);
      group.base = Math.max(group.base, point.base);
      group.ids.push(...point.ids);
    } else groups.push({ ...point, ids: [...point.ids] });
  }
  const locations: typeof candidates = [];
  if (groups.length > 512)
    throw new Error("Acotá el ensayo a 512 localizaciones independientes.");
  for (const group of groups) {
    const members = candidates.filter(
      (p) => p.top >= group.top && p.base <= group.base,
    );
    const targets = members.map((p) => p.target);
    if (
      Math.max(...targets) - Math.min(...targets) >
      config.policy.maxReplicaSpread
    ) {
      for (const id of group.ids)
        exclusions.push({
          id,
          reason: "Réplicas/soportes próximos contradictorios.",
        });
      continue;
    }
    locations.push({
      ...group,
      depth: group.top + (group.base - group.top) / 2,
      gr: members.reduce((s, p) => s + p.gr, 0) / members.length,
      target: targets.reduce((s, v) => s + v, 0) / members.length,
    });
  }
  if (locations.length < 3 || locations.length > 512)
    throw new Error(
      "Se necesitan de 3 a 512 localizaciones independientes tras exclusiones/agrupación.",
    );
  const fit = await fitGrCalibration(
    locations.map((l) => ({ ...l, id: l.ids.join("|") })),
    config.method,
    grBounds(registry),
    config.policy,
    2 * comparisonConfig.maxGapM +
      config.policy.separationM +
      Math.max(...locations.map((p) => p.base - p.top)),
    checkpoint,
    config.fixed,
  );
  if (
    config.fixed?.uncertainty !== undefined &&
    config.fixed.uncertainty > config.policy.maxEndpointSpread
  ) {
    fit.reasons.push(
      "Incertidumbre declarada del extremo externo excede el umbral en gAPI.",
    );
    fit.admitted = false;
  }
  if (
    Object.values(comparisonConfig.densities).some(
      (d) =>
        (d.uncertainty ?? 0) / d.value >
        config.policy.maxRelativeDensityUncertainty,
    )
  ) {
    fit.reasons.push("Incertidumbre relativa de densidad excede el umbral.");
    fit.admitted = false;
  }
  return {
    version: config.version,
    methodVersion: config.fixed ? "xrd-gr-fixed-v1" : "xrd-gr-v1",
    config,
    comparison: comparison.record,
    before: Object.fromEntries(
      ["grClean", "grShale", "vsh.method"].map((key) => [
        key,
        i.params.zones[zone.id]?.[key] ??
          i.params.global[key] ??
          registry.paramSpecs.get(key)!.spec.default,
      ]),
    ),
    fit,
    locations,
    exclusions,
  };
}
export function readGrCalibration(raw: unknown): GrCalibrationProposal | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string" || raw.length > 200000)
    throw new Error("Evidencia de calibración GR inválida.");
  const p = JSON.parse(raw) as GrCalibrationProposal;
  if (
    ![1, 2].includes(p.version) ||
    (p.version === 1
      ? p.methodVersion !== "xrd-gr-v1"
      : p.methodVersion !== "xrd-gr-fixed-v1") ||
    p.config?.version !== p.version
  )
    throw new Error(
      "Versión de calibración GR desconocida; se conserva sin aplicar.",
    );
  validateCalibrationConfig(p.config);
  readXrdRecord(JSON.stringify(p.comparison));
  if (p.config.fixed) {
    const f = p.config.fixed;
    if (
      p.fit?.fixed?.end !== f.end ||
      p.fit.fixed.value !== f.value ||
      p.fit.raw[f.end] !== f.value ||
      p.fit.applied[f.end] !== f.value ||
      p.fit.folds.some((fold) => fold.endpoints[f.end] !== f.value) ||
      p.fit.endpointSpread[f.end] !== 0
    )
      throw new Error("La propuesta no conserva el extremo externo declarado.");
  } else if (p.fit?.fixed)
    throw new Error("Restricción inesperada en una propuesta de dos extremos.");
  if (
    !p.fit?.admitted ||
    !p.fit.validation ||
    !Object.values(p.fit.metrics).every(Number.isFinite) ||
    !Object.values(p.fit.validation).every(Number.isFinite) ||
    p.fit.method !== p.config.method ||
    p.fit.reasons.length ||
    !Number.isFinite(p.fit.applied.clean) ||
    !Number.isFinite(p.fit.applied.shale) ||
    p.fit.applied.shale <= p.fit.applied.clean ||
    !Array.isArray(p.locations) ||
    !Array.isArray(p.exclusions) ||
    !p.comparison?.evidence?.inputDigest
  )
    throw new Error("Propuesta de calibración GR no admitida.");
  return p;
}
