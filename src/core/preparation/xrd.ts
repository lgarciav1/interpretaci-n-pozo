import {
  createPointSet,
  pointNumbers,
  pointTexts,
  type PointColumn,
  shiftOf,
  pointRuns,
  type PointSetDecisions,
  type PointSet,
} from "../pointSets";
import { sampleLinear } from "./correlation";

export interface XrdMineral {
  id: string;
  name: string;
  clay: boolean;
}
export interface XrdContract {
  version: 1;
  basis: "mass" | "volume";
  scope: "whole-rock" | "clay-fraction";
  scale: "percent" | "fraction";
  closureTolerance: number;
  report: string;
  referenceId: string;
  datum: string;
  minerals: XrdMineral[];
  uncertaintyNote?: string;
}
export type XrdStatus =
  "measured" | "not-measured" | "not-detected" | "below-detection";
export interface XrdSample {
  id: string;
  top: number;
  base?: number;
  run?: string;
  values: Record<
    string,
    {
      value: number;
      status: XrdStatus;
      uncertainty?: number;
      detectionLimit?: number;
    }
  >;
}
export function validateXrdContract(c: XrdContract) {
  if (
    c.version !== 1 ||
    !["mass", "volume"].includes(c.basis) ||
    !["whole-rock", "clay-fraction"].includes(c.scope) ||
    !["percent", "fraction"].includes(c.scale) ||
    !c.report.trim() ||
    !c.referenceId?.trim() ||
    !c.datum?.trim() ||
    !Number.isFinite(c.closureTolerance) ||
    c.closureTolerance < 0 ||
    c.closureTolerance > 0.1 ||
    !c.minerals.length ||
    c.minerals.length > 64
  )
    throw new Error(
      "Contrato DRX inválido: declará base, escala, informe y tolerancia de cierre entre 0 y 0,1 (fracción).",
    );
  if (
    c.uncertaintyNote !== undefined &&
    (typeof c.uncertaintyNote !== "string" ||
      !c.uncertaintyNote.trim() ||
      c.uncertaintyNote.length > 2000)
  )
    throw new Error(
      "Describí la incertidumbre absoluta informada por el laboratorio.",
    );
  const ids = new Set<string>();
  for (const m of c.minerals) {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(m.id) ||
      ids.has(m.id) ||
      !m.name.trim() ||
      typeof m.clay !== "boolean"
    )
      throw new Error(
        "Identificadores minerales únicos y clasificación explícita requeridos.",
      );
    ids.add(m.id);
    if (c.scope === "clay-fraction" && !m.clay)
      throw new Error("Fracción arcilla solo admite sus minerales arcillosos.");
  }
}
/** Datos originales y estados, sin normalizar ni convertir ND/LD a cero. */
export function createXrdSet(
  id: string,
  name: string,
  source: string,
  contract: XrdContract,
  samples: XrdSample[],
): PointSet {
  validateXrdContract(contract);
  if (!samples.length || samples.length > 100000)
    throw new Error("DRX requiere entre 1 y 100000 muestras.");
  const numeric = (
    label: string,
    unit: string,
    values: number[],
  ): PointColumn => ({ label, unit, values: Float64Array.from(values) });
  for (const s of samples) {
    if (
      !Number.isFinite(s.top) ||
      (s.base !== undefined && (!Number.isFinite(s.base) || s.base <= s.top))
    )
      throw new Error(`Profundidad o intervalo inválido en ${s.id}.`);
    if (
      Object.keys(s.values).some(
        (id) => !contract.minerals.some((m) => m.id === id),
      )
    )
      throw new Error("Mineral no declarado.");
    for (const m of contract.minerals) {
      const cell = s.values[m.id];
      if (
        cell?.uncertainty !== undefined &&
        (!Number.isFinite(cell.uncertainty) ||
          cell.uncertainty < 0 ||
          cell.uncertainty > (contract.scale === "percent" ? 100 : 1) ||
          !contract.uncertaintyNote?.trim())
      )
        throw new Error(`Incertidumbre inválida o sin descripción en ${s.id}.`);
      if (
        cell?.detectionLimit !== undefined &&
        (!Number.isFinite(cell.detectionLimit) ||
          cell.detectionLimit <= 0 ||
          cell.detectionLimit > (contract.scale === "percent" ? 100 : 1))
      )
        throw new Error(`Límite de detección inválido en ${s.id}.`);
      if (
        !cell ||
        ![
          "measured",
          "not-measured",
          "not-detected",
          "below-detection",
        ].includes(cell.status) ||
        (cell.status === "measured"
          ? !Number.isFinite(cell.value) ||
            cell.value < 0 ||
            cell.value > (contract.scale === "percent" ? 100 : 1)
          : !Number.isNaN(cell.value))
      )
        throw new Error(`Valor/estado inválido de ${m.name} en ${s.id}.`);
    }
  }
  const columns: Record<string, PointColumn> = {
    "xrd:contract": {
      label: "Contrato DRX",
      values: samples.map(() => JSON.stringify(contract)),
    },
    "xrd:base": numeric(
      "Base MD (vacío = puntual)",
      "m",
      samples.map((s) => s.base ?? NaN),
    ),
    run: { label: "Corrida/corona", values: samples.map((s) => s.run ?? "") },
  };
  for (const m of contract.minerals) {
    columns[`mineral:${m.id}`] = numeric(
      m.name,
      contract.scale === "percent"
        ? "%"
        : contract.basis === "volume"
          ? "v/v"
          : "unitless",
      samples.map((s) => s.values[m.id]!.value),
    );
    const unit =
      contract.scale === "percent"
        ? "%"
        : contract.basis === "volume"
          ? "v/v"
          : "unitless";
    if (samples.some((s) => s.values[m.id]!.uncertainty !== undefined))
      columns[`uncertainty:${m.id}`] = numeric(
        `Incertidumbre absoluta ${m.name}`,
        unit,
        samples.map((s) => s.values[m.id]!.uncertainty ?? NaN),
      );
    if (samples.some((s) => s.values[m.id]!.detectionLimit !== undefined))
      columns[`limit:${m.id}`] = numeric(
        `Límite de detección ${m.name}`,
        unit,
        samples.map((s) => s.values[m.id]!.detectionLimit ?? NaN),
      );
    columns[`status:${m.id}`] = {
      label: `Estado ${m.name}`,
      values: samples.map((s) => s.values[m.id]!.status),
    };
  }
  return createPointSet({
    id,
    name,
    kind: "xrd",
    source,
    depth: Float64Array.from(samples, (s) => s.top),
    pointIds: samples.map((s) => s.id),
    columns,
  });
}
const contractCache = new WeakMap<PointSet, XrdContract>();
export function xrdContract(set: PointSet): XrdContract {
  if (set.kind !== "xrd") throw new Error("Se requiere un conjunto DRX.");
  const cached = contractCache.get(set);
  if (cached) return cached;
  const texts = pointTexts(set, "xrd:contract");
  if (!texts?.length || texts.some((t) => t !== texts[0]))
    throw new Error(
      "Contrato DRX ausente o heterogéneo; separá conjuntos por ensayo.",
    );
  const c = JSON.parse(texts[0]!) as XrdContract;
  validateXrdContract(c);
  const expectedUnit =
    c.scale === "percent" ? "%" : c.basis === "volume" ? "v/v" : "unitless";
  for (const m of c.minerals)
    for (const prefix of ["uncertainty", "limit"]) {
      const key = `${prefix}:${m.id}`;
      if (!set.columns[key]) continue;
      const values = pointNumbers(set, key);
      if (
        !values ||
        !("unit" in set.columns[key]!) ||
        set.columns[key]!.unit !== expectedUnit
      )
        throw new Error("Unidad o columna auxiliar DRX inválida.");
      for (const value of values) {
        if (Number.isNaN(value)) continue;
        if (
          !Number.isFinite(value) ||
          value < 0 ||
          (prefix === "limit" && value === 0) ||
          value > (c.scale === "percent" ? 100 : 1) ||
          (prefix === "uncertainty" && !c.uncertaintyNote?.trim())
        )
          throw new Error(
            "Dato auxiliar DRX fuera de dominio o sin descripción.",
          );
      }
    }
  contractCache.set(set, c);
  return c;
}
export interface XrdComposition {
  clayFraction: number | null;
  quantity: string;
  sum: number;
  reason: string | null;
}
/** La conversión volumétrica requiere composición completa, cierre y todas las densidades explícitas. */
export function xrdComposition(
  set: PointSet,
  row: number,
  target: "native" | "solid-volume",
  densities: Readonly<Record<string, number>> = {},
): XrdComposition {
  const c = xrdContract(set),
    factor = c.scale === "percent" ? 0.01 : 1;
  let sum = 0,
    clay = 0,
    total = 0;
  const quantity =
    c.scope === "clay-fraction"
      ? "Proporciones dentro de fracción arcilla"
      : target === "solid-volume" || c.basis === "volume"
        ? "Minerales arcillosos / volumen de sólidos"
        : "Minerales arcillosos / masa de roca";
  const fail = (reason: string): XrdComposition => ({
    clayFraction: null,
    quantity,
    sum,
    reason,
  });
  for (const m of c.minerals) {
    const v = pointNumbers(set, `mineral:${m.id}`)?.[row],
      status = pointTexts(set, `status:${m.id}`)?.[row];
    if (
      status !== "measured" ||
      v === undefined ||
      !Number.isFinite(v) ||
      v < 0 ||
      v * factor > 1
    )
      return fail(
        "Composición incompleta o censurada; no se completa con ceros.",
      );
    sum += v * factor;
  }
  if (Math.abs(sum - 1) > c.closureTolerance + 1e-12)
    return fail("Cierre fuera de tolerancia; no se renormaliza.");
  if (c.scope === "clay-fraction")
    return fail("La fracción arcilla no determina arcillas totales de roca.");
  for (const m of c.minerals) {
    let v = pointNumbers(set, `mineral:${m.id}`)![row]! * factor;
    if (target === "solid-volume" && c.basis === "mass") {
      const rho = densities[m.id];
      if (!rho || !Number.isFinite(rho) || rho <= 0)
        return fail(`Falta densidad positiva declarada de ${m.name}.`);
      v /= rho;
    }
    if (!Number.isFinite(v))
      return fail("Conversión fuera de dominio numérico.");
    total += v;
    if (m.clay) clay += v;
  }
  if (
    !Number.isFinite(total) ||
    total <= 0 ||
    clay > total ||
    !Number.isFinite(clay)
  )
    return fail("Conversión fuera de dominio numérico.");
  if (!(target === "solid-volume" && c.basis === "mass") && clay > 1)
    return fail(
      "Contenido de arcillas fuera de 0–1; revisá el cierre del ensayo.",
    );
  // Base nativa conserva los valores; solo masa→volumen normaliza con densidades.
  return {
    clayFraction:
      target === "solid-volume" && c.basis === "mass" ? clay / total : clay,
    quantity,
    sum,
    reason: null,
  };
}
export interface XrdPair {
  id: string;
  topMD: number;
  baseMD: number | null;
  value: number | null;
  coverage: number;
  dispersion: number | null;
  quality: number;
  reason: string | null;
  crossesZone: boolean;
}
export interface PairOptions {
  maxGapM: number;
  minCoverage: number;
  shiftM: number;
  boundaries: readonly number[];
  decisions?: PointSetDecisions;
}
/** Intervalos: integral trapezoidal solo sobre segmentos adyacentes finitos y cortos. No inventa soporte en huecos. */
export async function pairXrd(
  set: PointSet,
  depth: Float64Array,
  data: Float64Array,
  quality: Uint16Array | undefined,
  options: PairOptions,
  checkpoint: () => Promise<void> = async () => {},
): Promise<XrdPair[]> {
  if (
    data.length !== depth.length ||
    (quality && quality.length !== depth.length) ||
    !Number.isFinite(options.maxGapM) ||
    options.maxGapM <= 0 ||
    !Number.isFinite(options.minCoverage) ||
    options.minCoverage <= 0 ||
    options.minCoverage > 1 ||
    !Number.isFinite(options.shiftM)
  )
    throw new Error("Soporte o cobertura DRX inválidos.");
  xrdContract(set);
  for (let i = 0; i < depth.length; i++)
    if (!Number.isFinite(depth[i]) || (i > 0 && depth[i]! <= depth[i - 1]!))
      throw new Error("Índice MD inválido.");
  const bases = pointNumbers(set, "xrd:base"),
    runs = pointRuns(set);
  const pairs: XrdPair[] = [];
  let work = 0;
  for (let row = 0; row < set.pointIds.length; row++) {
    await checkpoint();
    const id = set.pointIds[row]!;
    const offset = options.shiftM + shiftOf(options.decisions, runs?.[row]);
    const top = set.depth[row]! + offset,
      base = (bases?.[row] ?? NaN) + offset;
    if (
      !Number.isFinite(top) ||
      (!Number.isNaN(base) && (!Number.isFinite(base) || base <= top))
    )
      throw new Error("Geometría DRX inválida.");
    let value: number | null = null,
      coverage = 0,
      dispersion: number | null = null,
      flags = 0,
      crossesZone = false;
    if (!Number.isFinite(base)) {
      const v = sampleLinear(depth, data, top, options.maxGapM);
      if (Number.isFinite(v)) {
        value = v;
        coverage = 1;
      }
      let right = 0;
      while (right < depth.length && depth[right]! < top) right++;
      flags = quality?.[right] ?? 0;
      if (depth[right] !== top) flags |= quality?.[right - 1] ?? 0;
      if (
        depth[right] !== top &&
        options.boundaries.some(
          (z) => z > depth[right - 1]! && z <= depth[right]!,
        )
      ) {
        value = null;
        coverage = 0;
      }
    } else {
      let width = 0,
        integral = 0,
        square = 0;
      crossesZone = options.boundaries.some((z) => z > top && z < base);
      for (let i = 1; i < depth.length; i++) {
        if (++work > 2000000)
          throw new Error(
            "Emparejado demasiado grande: acotá el conjunto o los intervalos.",
          );
        if (work % 2048 === 0) await checkpoint();
        const a = depth[i - 1]!,
          b = depth[i]!,
          lo = Math.max(a, top),
          hi = Math.min(b, base);
        if (
          hi <= lo ||
          b - a > options.maxGapM ||
          !Number.isFinite(data[i - 1]) ||
          !Number.isFinite(data[i])
        )
          continue;
        const x =
            (1 - (lo - a) / (b - a)) * data[i - 1]! +
            ((lo - a) / (b - a)) * data[i]!,
          y =
            (1 - (hi - a) / (b - a)) * data[i - 1]! +
            ((hi - a) / (b - a)) * data[i]!;
        const w = hi - lo;
        width += w;
        integral += (w * (x + y)) / 2;
        square += (w * (x * x + x * y + y * y)) / 3;
        flags |= (quality?.[i - 1] ?? 0) | (quality?.[i] ?? 0);
      }
      coverage = width / (base - top);
      if (width) {
        value = integral / width;
        dispersion = Math.sqrt(Math.max(0, square / width - value * value));
      }
    }
    const reason =
      options.decisions?.points[id]?.status === "exclude"
        ? "Muestra excluida por decisión"
        : value !== null &&
            (!Number.isFinite(value) ||
              (dispersion !== null && !Number.isFinite(dispersion)))
          ? "Fuera del dominio numérico del emparejado"
          : value === null
            ? "Sin soporte válido"
            : coverage + 1e-12 < options.minCoverage
              ? "Cobertura insuficiente"
              : null;
    pairs.push({
      id,
      topMD: top,
      baseMD: Number.isFinite(base) ? base : null,
      value: reason ? null : value,
      coverage,
      dispersion:
        dispersion !== null && Number.isFinite(dispersion) ? dispersion : null,
      quality: flags,
      reason,
      crossesZone,
    });
  }
  return pairs;
}
