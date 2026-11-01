import {
  createXrdSet,
  type XrdContract,
  type XrdSample,
  type XrdStatus,
} from "../core/preparation/xrd";
import type { RawTable } from "./table";
export interface XrdMapping {
  depth: number;
  base: number | null;
  sampleId: number | null;
  run: number | null;
  minerals: Record<string, number>;
  uncertainties?: Record<string, number>;
  detectionLimits?: Record<string, number>;
  depthUnit: "m" | "ft";
}
/** Tabla CSV/xlsx ya leída; el mapeo, las unidades y los minerales se declaran antes de importar. */
export function buildXrdSet(
  table: RawTable,
  mapping: XrdMapping,
  contract: XrdContract,
  id: string,
) {
  const indices = [
    mapping.depth,
    ...[mapping.base, mapping.sampleId, mapping.run].filter(
      (i): i is number => i !== null,
    ),
    ...Object.values(mapping.minerals),
    ...Object.values(mapping.uncertainties ?? {}),
    ...Object.values(mapping.detectionLimits ?? {}),
  ];
  if (
    new Set(indices).size !== indices.length ||
    indices.some((i) => !Number.isInteger(i) || !table.columns[i]) ||
    !["m", "ft"].includes(mapping.depthUnit)
  )
    throw new Error("Mapeo DRX inválido o columnas repetidas.");
  if (
    contract.minerals.some(
      (m) => !table.columns[mapping.minerals[m.id] ?? -1]?.rawCells,
    )
  )
    throw new Error(
      "Leé DRX con preserveRawCells para conservar estados de laboratorio.",
    );
  if (contract.minerals.some((m) => mapping.minerals[m.id] === undefined))
    throw new Error("Falta mapear un mineral declarado.");
  for (const map of [mapping.uncertainties, mapping.detectionLimits])
    if (
      map &&
      Object.keys(map).some((id) => !contract.minerals.some((m) => m.id === id))
    )
      throw new Error("Columna auxiliar de mineral no declarado.");
  const raw = (column: number, row: number): string | number =>
    table.columns[column]!.rawCells?.[row] ??
    table.columns[column]!.numbers?.[row] ??
    table.columns[column]!.text?.[row] ??
    "";
  const num = (v: string | number) =>
    typeof v === "number" ? v : v.trim() ? Number(v.replace(",", ".")) : NaN;
  const factor = mapping.depthUnit === "ft" ? 0.3048 : 1;
  const optionalNumber = (column: number | undefined, row: number) => {
    if (column === undefined) return undefined;
    const value = raw(column, row);
    if (String(value).trim() === "") return undefined;
    const n = num(value);
    if (!Number.isFinite(n))
      throw new Error(
        `Valor auxiliar no numérico en fila ${table.sourceRows[row]}.`,
      );
    return n;
  };
  const samples: XrdSample[] = [];
  for (let row = 0; row < table.rowCount; row++) {
    const values: XrdSample["values"] = {};
    for (const m of contract.minerals) {
      const v = raw(mapping.minerals[m.id]!, row),
        t = String(v).trim().toUpperCase();
      let status: XrdStatus = "measured",
        value = num(v);
      const bound =
        /^<\s*([+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)$/i.exec(t);
      let detectionLimit = optionalNumber(mapping.detectionLimits?.[m.id], row);
      if (Number.isNaN(detectionLimit)) detectionLimit = undefined;
      const uncertainty = optionalNumber(mapping.uncertainties?.[m.id], row);
      if (bound) {
        const limit = num(bound[1]!);
        if (detectionLimit !== undefined && detectionLimit !== limit)
          throw new Error(
            `Límites contradictorios en fila ${table.sourceRows[row]}.`,
          );
        detectionLimit = limit;
      }
      if (!Number.isFinite(value)) {
        if (bound) status = "below-detection";
        else if (t === "ND") status = "not-detected";
        else if (t === "BLD" || t === "LD") status = "below-detection";
        else if (t === "" || t === "NAN") status = "not-measured";
        else
          throw new Error(
            `Estado DRX desconocido '${v}' en fila ${table.sourceRows[row]}. Usá ND, BLD o celda vacía.`,
          );
        value = NaN;
      }
      values[m.id] = {
        value,
        status,
        ...(uncertainty === undefined || Number.isNaN(uncertainty)
          ? {}
          : { uncertainty }),
        ...(detectionLimit === undefined ? {} : { detectionLimit }),
      };
    }
    samples.push({
      id:
        mapping.sampleId === null
          ? `fila-${table.sourceRows[row]}`
          : String(raw(mapping.sampleId, row)),
      top: num(raw(mapping.depth, row)) * factor,
      ...(mapping.base === null
        ? {}
        : { base: num(raw(mapping.base, row)) * factor }),
      run: mapping.run === null ? "" : String(raw(mapping.run, row)),
      values,
    });
  }
  return createXrdSet(
    id,
    table.sourceName,
    table.sourceName,
    contract,
    samples,
  );
}
