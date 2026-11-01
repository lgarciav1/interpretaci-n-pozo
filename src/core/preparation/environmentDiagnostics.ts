/** Diagnóstico observacional de originales. No prepara curvas ni aplica correcciones. ADR 0051. */
import type { RoleId } from "../roles";
import { conversionCoefficients, sameDimension, type UnitId } from "../units";
import { layoutZones, type Curve, type Well, type Zone } from "../well";
import {
  MIN_VALID_CALIPER_IN,
  WASHOUT_TOLERANCE_IN,
  isWashout,
} from "../../petro/indicators";
import { DEFAULT_MIN_SEPARATION } from "../../petro/invasion";
import { detectSuspectPe } from "../../petro/mineralogy";

export const DIAGNOSTIC_UNITS = {
  CALI: "in",
  BS: "in",
  PEF: "b/e",
  RHOB: "g/cm3",
  RA10: "ohm.m",
  RA20: "ohm.m",
  RA30: "ohm.m",
  RM: "ohm.m",
  RT: "ohm.m",
} as const satisfies Partial<Record<RoleId, UnitId>>;
export type DiagnosticRole = keyof typeof DIAGNOSTIC_UNITS;
export const DIAGNOSTIC_ROLES = Object.keys(
  DIAGNOSTIC_UNITS,
) as DiagnosticRole[];
export type DiagnosticSelection = Partial<Record<DiagnosticRole, string>>;
export interface DiagnosticCriteria {
  minCaliperIn: number;
  washoutToleranceIn: number;
  minSeparation: number;
}
export const DEFAULT_DIAGNOSTIC_CRITERIA: Readonly<DiagnosticCriteria> = {
  minCaliperIn: MIN_VALID_CALIPER_IN,
  washoutToleranceIn: WASHOUT_TOLERANCE_IN,
  minSeparation: DEFAULT_MIN_SEPARATION,
};
export interface DiagnosticBinding {
  curve: Curve;
  unit: UnitId;
  at(index: number): number;
}
export interface DiagnosticInputs {
  selected: DiagnosticSelection;
  bindings: Partial<Record<DiagnosticRole, DiagnosticBinding>>;
  issues: string[];
}
/** Una alternativa por rol se puede sugerir; varias requieren elección explícita. */
export function defaultDiagnosticSelection(well: Well): DiagnosticSelection {
  const out: DiagnosticSelection = {};
  for (const role of DIAGNOSTIC_ROLES) {
    const candidates = well.curves.filter(
      (c) => c.origin.kind === "measured" && c.role === role,
    );
    if (candidates.length === 1) out[role] = candidates[0]!.id;
  }
  return out;
}
/** Una selección inválida queda sin entrada: nunca se sustituye por otra curva. */
export function diagnosticInputs(
  well: Well,
  selected: DiagnosticSelection,
): DiagnosticInputs {
  const bindings: DiagnosticInputs["bindings"] = {},
    issues: string[] = [];
  for (const role of DIAGNOSTIC_ROLES) {
    const id = selected[role];
    if (!id) {
      if (
        well.curves.filter(
          (c) => c.origin.kind === "measured" && c.role === role,
        ).length > 1
      )
        issues.push(
          `${role}: varias curvas originales; elegí una para comparar.`,
        );
      continue;
    }
    const curve = well.curves.find((c) => c.id === id),
      unit = DIAGNOSTIC_UNITS[role];
    if (
      !curve ||
      curve.origin.kind !== "measured" ||
      curve.role !== role ||
      !sameDimension(curve.unit, unit)
    ) {
      issues.push(
        `${role}: la curva seleccionada falta, tiene otro origen/rol o unidad incompatible.`,
      );
      continue;
    }
    const [scale, offset] = conversionCoefficients(curve.unit, unit);
    bindings[role] = {
      curve,
      unit,
      at: (i) => curve.data[i]! * scale + offset,
    };
  }
  return { selected: { ...selected }, bindings, issues };
}
export function validateDiagnosticCriteria(c: DiagnosticCriteria): void {
  if (
    !Object.values(c).every(Number.isFinite) ||
    c.minCaliperIn <= 0 ||
    c.minCaliperIn > 40 ||
    c.washoutToleranceIn < 0 ||
    c.washoutToleranceIn > 20 ||
    c.minSeparation <= 0 ||
    c.minSeparation > 1
  )
    throw new Error(
      "Revisá criterios: caliper mínimo >0 y ≤40 in, tolerancia 0–20 in y separación >0 y ≤1.",
    );
}
export interface DiagnosticSample {
  index: number;
  depthM: number;
  values: Partial<Record<DiagnosticRole, number>>;
  geometry:
    | "missing"
    | "invalid-caliper"
    | "washout"
    | "below-bit"
    | "within-tolerance";
  deltaIn: number;
  suspectPe: boolean | null;
  resistivityCount: number;
  separation: number;
}
function sampleAt(
  well: Well,
  input: DiagnosticInputs,
  index: number,
  criteria: DiagnosticCriteria,
): DiagnosticSample {
  const values: DiagnosticSample["values"] = {};
  for (const role of DIAGNOSTIC_ROLES)
    if (input.bindings[role]) values[role] = input.bindings[role]!.at(index);
  const c = values.CALI ?? NaN,
    bit = values.BS ?? NaN;
  const validCaliper = Number.isFinite(c) && c >= criteria.minCaliperIn;
  const deltaIn =
    validCaliper && Number.isFinite(bit) && bit > 0 ? c - bit : NaN;
  const geometry =
    Number.isFinite(c) && !validCaliper
      ? "invalid-caliper"
      : !Number.isFinite(deltaIn)
        ? "missing"
        : isWashout(c, bit, criteria.washoutToleranceIn)
          ? "washout"
          : deltaIn < 0
            ? "below-bit"
            : "within-tolerance";
  // Mismo criterio operativo de ADR 0029; el detector conserva sus límites estrictos.
  const pe = detectSuspectPe([values.PEF ?? NaN], [values.RHOB ?? NaN]);
  let min = Infinity,
    max = -Infinity,
    n = 0;
  for (const role of ["RA10", "RA20", "RA30", "RM", "RT"] as const) {
    const v = values[role] ?? NaN;
    if (Number.isFinite(v) && v > 0) {
      min = Math.min(min, v);
      max = Math.max(max, v);
      n++;
    }
  }
  return {
    index,
    depthM: well.depth.values[index]!,
    values,
    geometry,
    deltaIn,
    suspectPe: pe.samples ? pe.suspect : null,
    resistivityCount: n,
    separation: n >= 3 ? max / min - 1 : NaN,
  };
}
export function diagnosticSample(
  well: Well,
  input: DiagnosticInputs,
  index: number,
  criteria: DiagnosticCriteria,
): DiagnosticSample {
  validateDiagnosticCriteria(criteria);
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= well.depth.values.length
  )
    throw new Error("Muestra fuera del pozo.");
  return sampleAt(well, input, index, criteria);
}
export interface DiagnosticCounts {
  samples: number;
  invalidCaliper: number;
  geometryPairs: number;
  washout: number;
  belowBit: number;
  pePairs: number;
  suspectPe: number;
  resistivityTriples: number;
  separated: number;
  firstReviewIndex: number | null;
}
const emptyCounts = (): DiagnosticCounts => ({
  samples: 0,
  invalidCaliper: 0,
  geometryPairs: 0,
  washout: 0,
  belowBit: 0,
  pePairs: 0,
  suspectPe: 0,
  resistivityTriples: 0,
  separated: 0,
  firstReviewIndex: null,
});
export interface EnvironmentDiagnosticSummary {
  kind: "observational-environment-diagnostic";
  version: 1;
  basis: "original-measured-curves";
  wellId: string;
  rangeM: { top: number; base: number };
  criteria: DiagnosticCriteria & { peMin: 4; rhoMax: 2.55 };
  inputs: {
    role: DiagnosticRole;
    curveId: string;
    mnemonic: string;
    originalUnit: UnitId;
    canonicalUnit: UnitId;
  }[];
  issues: string[];
  total: DiagnosticCounts;
  zones: { id: string | null; name: string; counts: DiagnosticCounts }[];
}
/** Un barrido sin ajustar todo el pozo; la inversión radial se evalúa solo en la profundidad inspeccionada. */
export function summarizeEnvironment(
  well: Well,
  zones: readonly Zone[],
  input: DiagnosticInputs,
  criteria: DiagnosticCriteria = DEFAULT_DIAGNOSTIC_CRITERIA,
  range = { top: well.depth.values[0]!, base: well.depth.values.at(-1)! },
): EnvironmentDiagnosticSummary {
  validateDiagnosticCriteria(criteria);
  if (
    !Number.isFinite(range.top) ||
    !Number.isFinite(range.base) ||
    range.top > range.base
  )
    throw new Error(
      "El tramo del diagnóstico requiere tope y base finitos, con tope ≤ base.",
    );
  const layout = layoutZones(well.depth.values, zones);
  const groups = layout.spans.map((s) => ({
    id: s.id as string | null,
    name: s.name,
    counts: emptyCounts(),
  }));
  const outside = { id: null, name: "Fuera de zonas", counts: emptyCounts() };
  const total = emptyCounts();
  const add = (counts: DiagnosticCounts, s: DiagnosticSample) => {
    counts.samples++;
    if (s.geometry === "invalid-caliper") counts.invalidCaliper++;
    if (Number.isFinite(s.deltaIn)) counts.geometryPairs++;
    if (s.geometry === "washout") counts.washout++;
    if (s.geometry === "below-bit") counts.belowBit++;
    if (s.suspectPe !== null) {
      counts.pePairs++;
      if (s.suspectPe) counts.suspectPe++;
    }
    if (Number.isFinite(s.separation)) {
      counts.resistivityTriples++;
      if (s.separation >= criteria.minSeparation) counts.separated++;
    }
    if (
      counts.firstReviewIndex === null &&
      (s.geometry === "invalid-caliper" ||
        s.geometry === "washout" ||
        s.geometry === "below-bit" ||
        s.suspectPe ||
        s.separation >= criteria.minSeparation)
    )
      counts.firstReviewIndex = s.index;
  };
  for (let i = 0; i < well.depth.values.length; i++) {
    const d = well.depth.values[i]!;
    if (d < range.top || d > range.base) continue;
    const sample = sampleAt(well, input, i, criteria),
      z = layout.zoneIndex[i]!;
    add(total, sample);
    add(z < 0 ? outside.counts : groups[z]!.counts, sample);
  }
  return {
    kind: "observational-environment-diagnostic",
    version: 1,
    basis: "original-measured-curves",
    wellId: well.id,
    rangeM: { ...range },
    criteria: { ...criteria, peMin: 4, rhoMax: 2.55 },
    inputs: DIAGNOSTIC_ROLES.flatMap((role) => {
      const b = input.bindings[role];
      return b
        ? [
            {
              role,
              curveId: b.curve.id,
              mnemonic: b.curve.mnemonic,
              originalUnit: b.curve.unit,
              canonicalUnit: b.unit,
            },
          ]
        : [];
    }),
    issues: [...input.issues, ...layout.problems],
    total,
    zones: [...groups, ...(outside.counts.samples ? [outside] : [])],
  };
}
