import { requireShape, requireText } from "../inputs/validation";
import type { AcquisitionMetadata } from "../inputs/acquisition";
import type { Well } from "../well";
import { convert, getUnit } from "../units";
import { MGT_METHOD, type MgtPosition } from "../../petro/mgt";
export { MGT_METHOD };
export interface MgtConfig {
  caliperCurveId: string;
  position: MgtPosition;
  environment: "open-hole-seawater";
  maxAmbientDepthM: number;
  temperatureC: number;
  pressurePsi: number;
  conditionsReference: string;
  uncorrectedReference: string;
  declared: true;
}
export function validateMgtConfig(value: unknown): asserts value is MgtConfig {
  const c = requireShape(value, "MGT", [
    "caliperCurveId",
    "position",
    "environment",
    "maxAmbientDepthM",
    "temperatureC",
    "pressurePsi",
    "conditionsReference",
    "uncorrectedReference",
    "declared",
  ]);
  requireText(c.caliperCurveId, "Caliper MGT");
  for (const k of ["conditionsReference", "uncorrectedReference"]) {
    requireText(c[k], "Referencia MGT");
    if ((c[k] as string).trim().length < 12 || (c[k] as string).length > 4000)
      throw new Error(
        "MGT requiere referencias explícitas de condiciones y ausencia de corrección previa.",
      );
  }
  if (
    !["centered", "eccentered"].includes(c.position as string) ||
    c.environment !== "open-hole-seawater" ||
    c.declared !== true ||
    ![c.maxAmbientDepthM, c.temperatureC, c.pressurePsi].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) ||
    (c.maxAmbientDepthM as number) <= 0 ||
    (c.maxAmbientDepthM as number) > MGT_METHOD.maxAmbientDepthM ||
    (c.temperatureC as number) < 0 ||
    (c.temperatureC as number) > MGT_METHOD.maxTemperatureC ||
    (c.pressurePsi as number) < 0 ||
    (c.pressurePsi as number) > MGT_METHOD.maxPressurePsi
  )
    throw new Error(
      "MGT requiere posición conocida, pozo abierto con agua de mar, profundidad ambiente ≤5000 m, temperatura 0–100 °C y presión 0–10000 psi. No se extrapola.",
    );
}
/** La declaración concreta se comprueba en el dominio, nunca por prefijo de mnemónico. */
export function validateMgtInputs(
  well: Well,
  acquisition: AcquisitionMetadata,
  curveId: string,
  config: MgtConfig,
) {
  validateMgtConfig(config);
  const gr = well.curves.find((c) => c.id === curveId),
    caliper = well.curves.find((c) => c.id === config.caliperCurveId),
    run = acquisition.runs.find((r) => r.curveIds.includes(curveId));
  if (
    gr?.role !== "GR" ||
    gr.unit !== "gAPI" ||
    gr.origin.kind !== "measured" ||
    caliper?.role !== "CALI" ||
    caliper.origin.kind !== "measured" ||
    getUnit(caliper.unit)?.dimension !== "length"
  )
    throw new Error(
      "MGT necesita GR total original en gAPI y caliper original con unidad de longitud.",
    );
  if (
    !run ||
    !["gr", "spectral-gr"].includes(run.tool.catalogId ?? "") ||
    !["ldeo", "lamont-doherty earth observatory"].includes(
      run.tool.vendor?.trim().toLowerCase() ?? "",
    ) ||
    run.tool.model?.trim().toUpperCase() !== "MGT"
  )
    throw new Error(
      "Solo LDEO MGT confirmado en adquisición; no se atribuye el modelo por el mnemónico.",
    );
  if (!acquisition.depth.datum)
    throw new Error(
      "MGT requiere datum MD registrado y caliper en el mismo índice/referencia.",
    );
  if (
    run.corrections.status === "unknown" ||
    run.corrections.effects.length > 0
  )
    throw new Error(
      "Procesado previo desconocido, incompatible o con efecto ya aplicado. Revisá adquisición antes de corregir.",
    );
  const toInches = convert(1, caliper.unit, "in");
  if (!Number.isFinite(toInches) || toInches <= 0)
    throw new Error("Unidad de caliper no convertible a pulgadas.");
  return { gr, caliper, run, toInches };
}
export function mgtAcquisitionKey(a: AcquisitionMetadata): string {
  return JSON.stringify(a);
}
