/** Configuración aceptada y evidencia reproducible; nunca contiene arrays derivados. */
import { sha256 } from "../state/archive/sha256";
import { pointNumbers, pointTexts, type PointSet } from "../pointSets";
import { engineDecisionKey, wellInputKey } from "../engine/context";
import type { Interpretation } from "../interpretation";
import type { DataContext } from "./projection";
import { preparationStateKey } from "./state";
import {
  pairXrd,
  xrdComposition,
  xrdContract,
  type XrdPair,
  type XrdComposition,
} from "./xrd";

export const XRD_COMPARISON_SETTING = "xrd:comparison";
export interface XrdDensity {
  value: number;
  reference: string;
  uncertainty?: number;
}
export interface XrdComparisonConfig {
  curveId: string;
  target: "native" | "solid-volume";
  maxGapM: number;
  minCoverage: number;
  shiftM: number;
  densities: Record<string, XrdDensity>;
}
export interface XrdEvidence {
  method: "xrd-pairs-v1";
  inputRevisionId: string;
  inputDigest: string;
  resultDigest: string;
  createdAt: string;
  source: { mnemonic: string; unit: string; role: string | null };
  rows: number;
  usable: number;
}
export interface XrdComparisonRecord {
  version: 1;
  config: XrdComparisonConfig;
  evidence: XrdEvidence;
}
export interface XrdComparisonRow {
  pair: XrdPair;
  composition: XrdComposition;
}
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : value,
  );
const digest = (v: unknown) => sha256(new TextEncoder().encode(canonical(v)));
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function exact(
  value: unknown,
  required: string[],
  optional: string[] = [],
): asserts value is Record<string, unknown> {
  if (
    !object(value) ||
    required.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some(
      (k) => !required.includes(k) && !optional.includes(k),
    )
  )
    throw new Error("Estructura de comparación DRX no admitida.");
}
export function validateXrdConfig(
  value: unknown,
): asserts value is XrdComparisonConfig {
  exact(value, [
    "curveId",
    "target",
    "maxGapM",
    "minCoverage",
    "shiftM",
    "densities",
  ]);
  if (
    typeof value.curveId !== "string" ||
    !value.curveId.trim() ||
    !["native", "solid-volume"].includes(value.target as string) ||
    typeof value.maxGapM !== "number" ||
    !Number.isFinite(value.maxGapM) ||
    value.maxGapM <= 0 ||
    typeof value.minCoverage !== "number" ||
    !Number.isFinite(value.minCoverage) ||
    value.minCoverage <= 0 ||
    value.minCoverage > 1 ||
    typeof value.shiftM !== "number" ||
    !Number.isFinite(value.shiftM) ||
    !object(value.densities) ||
    Object.keys(value.densities).length > 64
  )
    throw new Error("Configuración DRX inválida.");
  for (const d of Object.values(value.densities)) {
    exact(d, ["value", "reference"], ["uncertainty"]);
    if (
      typeof d.value !== "number" ||
      !Number.isFinite(d.value) ||
      d.value <= 0 ||
      typeof d.reference !== "string" ||
      !d.reference.trim() ||
      d.reference.length > 2000 ||
      (d.uncertainty !== undefined &&
        (typeof d.uncertainty !== "number" ||
          !Number.isFinite(d.uncertainty) ||
          d.uncertainty < 0))
    )
      throw new Error(
        "Cada densidad requiere valor positivo, referencia y, si se declara, incertidumbre no negativa.",
      );
  }
}
export function readXrdRecord(raw: unknown): XrdComparisonRecord | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string" || raw.length > 100000)
    throw new Error("Registro de comparación DRX inválido.");
  const r: unknown = JSON.parse(raw);
  exact(r, ["version", "config", "evidence"]);
  if (r.version !== 1)
    throw new Error("Versión futura o desconocida de comparación DRX.");
  validateXrdConfig(r.config);
  exact(r.evidence, [
    "method",
    "inputRevisionId",
    "inputDigest",
    "resultDigest",
    "createdAt",
    "source",
    "rows",
    "usable",
  ]);
  const e = r.evidence;
  exact(e.source, ["mnemonic", "unit", "role"]);
  if (
    typeof e.source.mnemonic !== "string" ||
    !e.source.mnemonic ||
    typeof e.source.unit !== "string" ||
    !e.source.unit ||
    (e.source.role !== null && typeof e.source.role !== "string")
  )
    throw new Error("Fuente de evidencia DRX inválida.");
  if (
    e.method !== "xrd-pairs-v1" ||
    typeof e.inputRevisionId !== "string" ||
    !/^input-[0-9a-f]{32}$/.test(e.inputRevisionId) ||
    ![e.inputDigest, e.resultDigest].every(
      (x) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x),
    ) ||
    typeof e.createdAt !== "string" ||
    !Number.isFinite(Date.parse(e.createdAt)) ||
    !Number.isInteger(e.rows) ||
    Number(e.rows) < 1 ||
    Number(e.rows) > 100000 ||
    !Number.isInteger(e.usable) ||
    Number(e.usable) < 0 ||
    Number(e.usable) > Number(e.rows)
  )
    throw new Error("Evidencia DRX inválida.");
  return r as unknown as XrdComparisonRecord;
}
async function arrayDigest(
  values: ArrayLike<number>,
  checkpoint: () => Promise<void>,
) {
  const bytes = new Uint8Array(values.length * 8),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) {
    if (i % 4096 === 0) await checkpoint();
    if (Number.isNaN(values[i]))
      view.setBigUint64(i * 8, 0x7ff8000000000000n, true);
    else view.setFloat64(i * 8, values[i]!, true);
  }
  const result = await sha256(bytes);
  await checkpoint();
  return result;
}
export async function xrdInputDigest(
  data: DataContext,
  interpretation: Interpretation,
  set: PointSet,
  config: XrdComparisonConfig,
  inputRevisionId: string,
  checkpoint: () => Promise<void> = async () => {},
) {
  validateXrdConfig(config);
  const contract = xrdContract(set);
  if (contract.referenceId !== data.well.id)
    throw new Error("Laboratorio de otro pozo.");
  if (
    (data.preparationStateKey !== undefined ||
      interpretation.preparation?.nodes.length) &&
    data.preparationStateKey !== preparationStateKey(interpretation.preparation)
  )
    throw new Error("Preparación obsoleta.");
  if (
    data.context.engineKey !==
    wellInputKey(data.engineWell) + "|" + engineDecisionKey(interpretation)
  )
    throw new Error("Contexto científico obsoleto.");
  const curve = data.eligible.find((c) => c.id === config.curveId);
  if (!curve)
    throw new Error(
      "La fuente elegida no está disponible; no se sustituye por otra.",
    );
  const columns = [];
  for (const [key, column] of Object.entries(set.columns).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  ))
    columns.push([
      key,
      column.label,
      "unit" in column ? column.unit : null,
      column.values instanceof Float64Array
        ? await arrayDigest(column.values, checkpoint)
        : await digest(key === "xrd:contract" ? contract : column.values),
    ]);
  const decisions = interpretation.pointSets[set.id];
  const quality = data.quality.get(curve.id);
  return digest({
    method: "xrd-pairs-v1",
    inputRevisionId,
    wellId: data.well.id,
    config,
    preparation: interpretation.preparation ?? null,
    toolString: interpretation.toolString ?? null,
    zones: interpretation.zones.map((z) => [z.id, z.top, z.base]),
    curve: [
      curve.id,
      curve.mnemonic,
      curve.origin.kind,
      curve.role,
      curve.unit,
      await arrayDigest(curve.data, checkpoint),
    ],
    quality: quality ? await arrayDigest(quality, checkpoint) : null,
    depth: await arrayDigest(data.well.depth.values, checkpoint),
    lab: [
      set.id,
      set.kind,
      set.synthetic ?? false,
      set.pointIds,
      await arrayDigest(set.depth, checkpoint),
      columns,
    ],
    decisions: {
      points: decisions?.points ?? {},
      depthShift: decisions?.depthShift ?? 0,
      runShifts: decisions?.runShifts ?? {},
    },
  });
}
export async function evaluateXrdComparison(
  data: DataContext,
  interpretation: Interpretation,
  set: PointSet,
  config: XrdComparisonConfig,
  inputRevisionId: string,
  checkpoint: () => Promise<void> = async () => {},
) {
  const inputDigest = await xrdInputDigest(
    data,
    interpretation,
    set,
    config,
    inputRevisionId,
    checkpoint,
  );
  const curve = data.eligible.find((c) => c.id === config.curveId)!;
  const knownMinerals = new Set(xrdContract(set).minerals.map((m) => m.id));
  if (Object.keys(config.densities).some((id) => !knownMinerals.has(id)))
    throw new Error("Densidad de mineral no declarado.");
  const pairs = await pairXrd(
    set,
    data.well.depth.values,
    curve.data,
    data.quality.get(curve.id),
    {
      maxGapM: config.maxGapM,
      minCoverage: config.minCoverage,
      shiftM: config.shiftM,
      boundaries: interpretation.zones.flatMap((z) => [z.top, z.base]),
      decisions: interpretation.pointSets[set.id],
    },
    checkpoint,
  );
  const densities = Object.fromEntries(
    Object.entries(config.densities).map(([id, d]) => [id, d.value]),
  );
  const rows: XrdComparisonRow[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (i % 256 === 0) await checkpoint();
    rows.push({
      pair: pairs[i]!,
      composition: xrdComposition(set, i, config.target, densities),
    });
  }
  await checkpoint();
  const evidence: XrdEvidence = {
    method: "xrd-pairs-v1",
    inputRevisionId,
    inputDigest,
    resultDigest: await digest(rows),
    createdAt: new Date().toISOString(),
    source: { mnemonic: curve.mnemonic, unit: curve.unit, role: curve.role },
    rows: rows.length,
    usable: rows.filter(
      (r) => r.pair.value !== null && r.composition.clayFraction !== null,
    ).length,
  };
  return { rows, record: { version: 1 as const, config, evidence } };
}
/** CSV autónomo con configuración/procedencia y resultados; no presenta una huella antigua como vigente. */
export async function exportXrdComparisonCsv(
  record: XrdComparisonRecord,
  rows: XrdComparisonRow[],
  set: PointSet,
  currentInputDigest: string,
): Promise<string> {
  readXrdRecord(JSON.stringify(record));
  if (
    currentInputDigest !== record.evidence.inputDigest ||
    set.pointIds.length !== rows.length ||
    rows.some((r, i) => r.pair.id !== set.pointIds[i]) ||
    (await digest(rows)) !== record.evidence.resultDigest ||
    rows.length !== record.evidence.rows
  )
    throw new Error("La tabla no corresponde a la evidencia guardada.");
  const cell = (v: unknown) =>
    '"' +
    String(
      typeof v === "string" && /^[=+@\-\t\r]/.test(v) ? "'" + v : (v ?? ""),
    ).replace(/"/g, '""') +
    '"';
  const line = (values: unknown[]) => values.map(cell).join(",");
  const bases = pointNumbers(set, "xrd:base"),
    contract = xrdContract(set);
  return (
    "\ufeff" +
    [
      line([
        "DRX diagnóstico",
        "xrd-pairs-v1",
        "No equivale a Vsh; no calibra GR ni cutoffs",
      ]),
      line(["configuración", canonical(record.config)]),
      line(["evidencia", canonical(record.evidence)]),
      line(["laboratorio", canonical(xrdContract(set))]),
      line(["fuente", canonical(record.evidence.source)]),
      line([
        "muestra",
        "tope_original_m_MD",
        "base_original_m_MD",
        "tope_corregido_m_MD",
        "base_corregida_m_MD",
        "arcillas",
        "cantidad",
        "perfil",
        "cobertura",
        "dispersion",
        "QC_soporte",
        "cruza_zona",
        "motivo_composicion",
        "motivo_perfil",
        "cierre_original_fraccion",
        ...contract.minerals.flatMap((m) => [
          `mineral:${m.id}:${m.name}`,
          `estado:${m.id}`,
          `incertidumbre:${m.id}`,
          `limite_deteccion:${m.id}`,
        ]),
      ]),
      ...rows.map(({ pair, composition }, i) =>
        line([
          pair.id,
          set.depth[i],
          Number.isNaN(bases?.[i] ?? NaN) ? "" : bases![i],
          pair.topMD,
          pair.baseMD,
          composition.clayFraction,
          composition.quantity,
          pair.value,
          pair.coverage,
          pair.dispersion,
          pair.quality,
          pair.crossesZone,
          composition.reason,
          pair.reason,
          composition.sum,
          ...contract.minerals.flatMap((m) => {
            const v = pointNumbers(set, `mineral:${m.id}`)?.[i];
            return [
              v === undefined || Number.isNaN(v) ? null : v,
              pointTexts(set, `status:${m.id}`)?.[i],
              Number.isFinite(pointNumbers(set, `uncertainty:${m.id}`)?.[i])
                ? pointNumbers(set, `uncertainty:${m.id}`)![i]
                : null,
              Number.isFinite(pointNumbers(set, `limit:${m.id}`)?.[i])
                ? pointNumbers(set, `limit:${m.id}`)![i]
                : null,
            ];
          }),
        ]),
      ),
    ].join("\r\n")
  );
}
