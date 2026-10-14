/**
 * Control de calidad (QC) de los perfiles medidos. Puro: no modifica el pozo ni sus arrays (inmutables por
 * convención), no depende de React ni del DOM.
 *
 *   runQc(pozo, opciones?)        → QcReport (por curva: nulos, estadísticos, picos, rango físico, rachas
 *                                   constantes, semáforo y razones; y el estado del pozo según el caliper)
 *   unreliableMask(reporte, id)   → Uint8Array (1 = muestra no confiable) para el visor y los módulos
 *
 * Umbrales: `QC_DEFAULTS` (abajo, cada uno con su justificación). Rangos físicos por rol: `PHYSICAL_RANGES`.
 * Decisiones: docs/decisiones/0003-control-de-calidad.md.
 */
import { defaultRoleCatalog, type RoleCatalog, type RoleId } from '../core/roles';
import { conversionCoefficients, getUnit, sameDimension, unitLabel, type UnitId } from '../core/units';
import type { Curve, Well } from '../core/well';
import { isWashout, MIN_VALID_CALIPER_IN, WASHOUT_TOLERANCE_IN } from '../petro/indicators';

export type QcStatus = 'ok' | 'warning' | 'bad';
export type QcSeverity = 'info' | 'warning' | 'bad';
export type QcReasonCode = 'no-data' | 'nulls' | 'out-of-range' | 'spikes' | 'constant' | 'invalid-caliper' | 'washout' | 'borehole';

export interface QcReason {
  severity: QcSeverity;
  code: QcReasonCode;
  /** Texto para la interfaz, en español. */
  message: string;
}

/** Rango físico admisible, en la unidad canónica del rol. */
export interface PhysicalRange {
  min: number;
  max: number;
  /** true: el mínimo no se admite (resistividades > 0). */
  minExclusive?: boolean;
  unit: UnitId;
}

/**
 * Rangos físicos por rol (unidad canónica). Son límites de "imposible o herramienta fuera de escala", no rangos
 * típicos: un valor afuera es un error de medición o de procesamiento, no una roca rara.
 */
export const PHYSICAL_RANGES: Readonly<Record<RoleId, PhysicalRange>> = {
  CALI: { min: 0, max: 40, minExclusive: true, unit: 'in' },
  BS: { min: 0, max: 40, minExclusive: true, unit: 'in' },
  TEMP: { min: -30, max: 350, unit: 'degC' },
  GR: { min: 0, max: 500, unit: 'gAPI' },
  CGR: { min: 0, max: 500, unit: 'gAPI' },
  SP: { min: -500, max: 500, unit: 'mV' },
  PEF: { min: 0, max: 20, unit: 'b/e' },
  RHOB: { min: 1.0, max: 3.2, unit: 'g/cm3' },
  DRHO: { min: -1, max: 1, unit: 'g/cm3' },
  NPHI: { min: -0.15, max: 1, unit: 'v/v' },
  DT: { min: 30, max: 250, unit: 'us/ft' },
  DTS: { min: 50, max: 900, unit: 'us/ft' },
  RT: { min: 0, max: 100000, minExclusive: true, unit: 'ohm.m' },
  RM: { min: 0, max: 100000, minExclusive: true, unit: 'ohm.m' },
  RS: { min: 0, max: 100000, minExclusive: true, unit: 'ohm.m' },
  RXO: { min: 0, max: 100000, minExclusive: true, unit: 'ohm.m' },
  RA10: { min: 0, max: 100000, minExclusive: true, unit: 'ohm.m' },
  RA20: { min: 0, max: 100000, minExclusive: true, unit: 'ohm.m' },
  RA30: { min: 0, max: 100000, minExclusive: true, unit: 'ohm.m' },
  URAN: { min: 0, max: 500, unit: 'ppm' },
  THOR: { min: 0, max: 500, unit: 'ppm' },
  POTA: { min: 0, max: 30, unit: 'wt%' },
  PHIT_NMR: { min: 0, max: 1, unit: 'v/v' },
  PHIE_NMR: { min: 0, max: 1, unit: 'v/v' },
  BVI_NMR: { min: 0, max: 1, unit: 'v/v' },
};

/** Curvas sin rol: rango por la dimensión de su unidad (p. ej. AT10 en ohm·m). */
const DIMENSION_RANGES: Partial<Record<string, PhysicalRange>> = {
  resistivity: PHYSICAL_RANGES['RT']!,
};

/** Roles cuya lectura depende del contacto del patín con la pared: no confiables con derrumbe o caliper inválido. */
export const PAD_ROLES: readonly RoleId[] = ['RHOB', 'PEF', 'DRHO'];

export interface QcOptions {
  /** Catálogo de roles (unidad canónica y escala). Por defecto el incorporado; la app pasa `registry.roles`. */
  roles?: RoleCatalog;
  /** Diámetro de trépano (in) si el pozo no tiene curva BS (o donde BS no tiene dato). */
  bitSize?: number;
  /** Derrumbe: CALI − BS mayor que esto (in). */
  washoutTolerance?: number;
  /** Caliper inválido por debajo de esto (in). */
  minValidCaliper?: number;
  /** Largo mínimo (muestras) de una racha de valor idéntico para considerarla sospechosa. */
  constantRunMin?: number;
  /** Picos: semiancho de la ventana de vecinos (muestras a cada lado, sin contar la propia). */
  spikeHalfWindow?: number;
  /** Picos: múltiplo del ruido local robusto (1,4826·MAD de los residuos contra la mediana móvil). */
  spikeLocalK?: number;
  /** Picos: múltiplo de la dispersión robusta de la curva (1,4826·MAD de los valores). */
  spikeGlobalK?: number;
  /** Fracción de nulos para 'warning' y para 'bad'. */
  nullWarning?: number;
  nullBad?: number;
  /** Fracción de muestras válidas fuera de rango / en rachas constantes / con picos que vuelve la curva 'bad'. */
  outOfRangeBad?: number;
  constantBad?: number;
  spikeBad?: number;
  invalidCaliperBad?: number;
  /** Tramos de derrumbe separados por hasta esta cantidad de muestras se unen en uno. */
  mergeGap?: number;
  /** Mínimo de muestras válidas para calcular picos. */
  minSamplesForSpikes?: number;
}

/**
 * Umbrales por defecto. Justificación (ver también docs/decisiones/0003-control-de-calidad.md):
 * - nulos: hasta 5 % es normal (empalmes, tope/base de la herramienta) → solo informativo; más de 50 % la curva
 *   no sirve para interpretar el intervalo → 'bad'.
 * - picos: ventana de ±3 muestras (≈ 0,9 m a 0,1524 m): un pico de hasta 3 muestras sigue siendo aislado frente a la
 *   mediana de sus vecinos. Se exige superar 8 veces el ruido local Y 4 veces la dispersión de la curva, para que
 *   las capas finas reales (que cambian poco frente a la dispersión total) no se marquen. Resistividades en log10.
 * - rachas constantes: 25 muestras (≈ 3,8 m) de valor idéntico. Una herramienta real siempre tiene ruido; las
 *   curvas cuantizadas (POTA cada 0,1 %) repiten valores en rachas de hasta ~13 muestras en el TP.
 * - derrumbe: CALI − BS > 1 in (≈ 2,5 cm de separación del patín); caliper < 5 in es físicamente imposible con
 *   trépano de 8,5 in.
 * - 'bad' por fracción: más de 5 % fuera de rango o 20 % en rachas constantes / caliper inválido; más de 1 % picos.
 */
export const QC_DEFAULTS = {
  bitSize: 8.5,
  washoutTolerance: WASHOUT_TOLERANCE_IN,
  minValidCaliper: MIN_VALID_CALIPER_IN,
  constantRunMin: 25,
  spikeHalfWindow: 3,
  spikeLocalK: 8,
  spikeGlobalK: 4,
  nullWarning: 0.05,
  nullBad: 0.5,
  outOfRangeBad: 0.05,
  constantBad: 0.2,
  spikeBad: 0.01,
  invalidCaliperBad: 0.2,
  mergeGap: 2,
  minSamplesForSpikes: 20,
} as const satisfies Required<Omit<QcOptions, 'roles'>>;

type ResolvedOptions = { -readonly [K in keyof typeof QC_DEFAULTS]: number };

/** Bits de `CurveQc.flags`. */
export const QC_FLAGS = {
  OUT_OF_RANGE: 1,
  SPIKE: 2,
  CONSTANT: 4,
  /** Tramo con derrumbe o caliper inválido (curvas de patín: RHOB, PEF, DRHO). */
  BOREHOLE: 8,
  /** El propio caliper es inválido en esta muestra. */
  INVALID_CALIPER: 16,
} as const;

export interface CurveStats {
  /** Muestras con dato. */
  count: number;
  min: number;
  max: number;
  p1: number;
  p99: number;
  median: number;
}

export interface ConstantRun {
  value: number;
  /** [start, end) en índices de muestra. */
  start: number;
  end: number;
  topM: number;
  baseM: number;
}

export interface CurveQc {
  curveId: string;
  mnemonic: string;
  role: RoleId | null;
  unit: UnitId;
  samples: number;
  nullCount: number;
  nullFraction: number;
  /** En la unidad de la curva; null si no tiene datos. */
  stats: CurveStats | null;
  /** Rango aplicado (unidad canónica), o null si no hay uno para esta curva. */
  range: PhysicalRange | null;
  outOfRangeCount: number;
  /** Índices de muestra de los picos aislados. */
  spikeIndices: number[];
  constantRuns: ConstantRun[];
  status: QcStatus;
  reasons: QcReason[];
  /** Bits QC_FLAGS por muestra. No modificar. */
  flags: Uint8Array;
}

export type BoreholeIssue = 'washout' | 'invalid-caliper';

export interface BoreholeInterval {
  kind: BoreholeIssue;
  topM: number;
  baseM: number;
  /** [start, end) en índices de muestra. */
  start: number;
  end: number;
  /** Muestras afectadas dentro del tramo (las uniones de huecos chicos no cuentan). */
  samples: number;
  /** Washout: máximo CALI − BS (in). Caliper inválido: mínimo CALI (in). */
  extreme: number;
}

export interface BoreholeQc {
  caliperId: string;
  /** Curva BS usada, o null si se usó `bitSize`. */
  bitSizeCurveId: string | null;
  bitSize: number;
  washouts: BoreholeInterval[];
  invalidCaliper: BoreholeInterval[];
  washoutSamples: number;
  invalidCaliperSamples: number;
  /** Espesor afectado (m): muestras × paso medio. */
  washoutThicknessM: number;
  invalidCaliperThicknessM: number;
  /** Curvas (de patín) marcadas como no confiables en esos tramos. */
  affectedCurveIds: string[];
  /** 1 = derrumbe o caliper inválido. No modificar. */
  mask: Uint8Array;
}

export interface QcReport {
  wellId: string;
  samples: number;
  curves: CurveQc[];
  /** null si el pozo no tiene caliper (rol CALI). */
  borehole: BoreholeQc | null;
  /** Peor semáforo entre las curvas. */
  status: QcStatus;
  options: Readonly<ResolvedOptions>;
}

// ── utilidades numéricas ────────────────────────────────────────────────────────────────────────────────────────

/** Cuantil con interpolación lineal sobre un array ORDENADO. */
function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function medianOf(values: Float64Array): number {
  const s = Float64Array.from(values).sort();
  return quantileSorted(s, 0.5);
}

/** 1,4826·MAD: estimador robusto de la desviación estándar (igual a σ para datos normales). */
function robustSigma(values: Float64Array): number {
  if (values.length === 0) return 0;
  const med = medianOf(values);
  const dev = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) dev[i] = Math.abs(values[i]! - med);
  return 1.4826 * medianOf(dev);
}

function finiteValues(data: ArrayLike<number>): Float64Array {
  let k = 0;
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i]!)) k++;
  const out = new Float64Array(k);
  k = 0;
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i]!)) out[k++] = data[i]!;
  return out;
}

// ── formato de mensajes ─────────────────────────────────────────────────────────────────────────────────────────

const fmtNum = (v: number): string => v.toLocaleString('es-AR', { maximumSignificantDigits: 4 });
const fmtCount = (v: number): string => v.toLocaleString('es-AR');
const fmtPct = (f: number): string => `${(f * 100).toLocaleString('es-AR', { maximumFractionDigits: f < 0.01 ? 2 : 1 })} %`;
const fmtDepth = (v: number): string => v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const samplesWord = (n: number): string => `${fmtCount(n)} ${n === 1 ? 'muestra' : 'muestras'}`;
const withUnit = (v: number, unit: UnitId): string => (unit === 'unitless' ? fmtNum(v) : `${fmtNum(v)} ${unitLabel(unit)}`);

function rangeText(r: PhysicalRange): string {
  const u = unitLabel(r.unit);
  return r.minExclusive ? `> ${fmtNum(r.min)} y ≤ ${fmtNum(r.max)} ${u}` : `${fmtNum(r.min)} a ${fmtNum(r.max)} ${u}`;
}

// ── QC por curva ────────────────────────────────────────────────────────────────────────────────────────────────

function resolveOptions(options: QcOptions): ResolvedOptions {
  const out = { ...QC_DEFAULTS } as ResolvedOptions;
  for (const k of Object.keys(QC_DEFAULTS) as (keyof ResolvedOptions)[]) {
    const v = options[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Coeficientes para pasar la curva a la unidad del rango, o null si no son convertibles. */
function toRangeUnit(unit: UnitId, range: PhysicalRange): [number, number] | null {
  if (!getUnit(unit) || !sameDimension(unit, range.unit)) return null;
  return conversionCoefficients(unit, range.unit);
}

function isLogScale(curve: Curve, roles: RoleCatalog): boolean {
  if (curve.role !== null) return roles.get(curve.role)?.display?.scale === 'log';
  const dim = getUnit(curve.unit)?.dimension;
  return dim === 'resistivity' || dim === 'permeability';
}

function rangeFor(curve: Curve): PhysicalRange | null {
  if (curve.role !== null) return PHYSICAL_RANGES[curve.role] ?? null;
  const dim = getUnit(curve.unit)?.dimension;
  return (dim && DIMENSION_RANGES[dim]) || null;
}

/** Picos aislados: residuo contra la mediana de los vecinos (sin la muestra) grande frente al ruido local Y a la curva. */
function detectSpikes(data: ArrayLike<number>, log: boolean, skip: Uint8Array, o: ResolvedOptions): number[] {
  const n = data.length;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = data[i]!;
    w[i] = skip[i] ? NaN : log ? (v > 0 ? Math.log10(v) : NaN) : v;
  }
  const valid = finiteValues(w);
  if (valid.length < o.minSamplesForSpikes) return [];
  const h = Math.max(1, Math.round(o.spikeHalfWindow));
  const res = new Float64Array(n).fill(NaN);
  const nb = new Float64Array(2 * h);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(w[i]!)) continue;
    let k = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) {
      if (j !== i && Number.isFinite(w[j]!)) nb[k++] = w[j]!;
    }
    if (k < 2) continue;
    // Inserción: k ≤ 2·h es chico y evita crear vistas por muestra.
    for (let a = 1; a < k; a++) {
      const x = nb[a]!;
      let b = a - 1;
      while (b >= 0 && nb[b]! > x) {
        nb[b + 1] = nb[b]!;
        b--;
      }
      nb[b + 1] = x;
    }
    res[i] = w[i]! - (k % 2 ? nb[(k - 1) / 2]! : (nb[k / 2 - 1]! + nb[k / 2]!) / 2);
  }
  const absRes = finiteValues(res).map(Math.abs);
  const sigmaLocal = 1.4826 * medianOf(absRes);
  const sigmaCurve = robustSigma(valid);
  const threshold = Math.max(o.spikeLocalK * sigmaLocal, o.spikeGlobalK * sigmaCurve);
  if (!(threshold > 0)) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (Math.abs(res[i]!) > threshold) out.push(i);
  return out;
}

function detectConstantRuns(data: ArrayLike<number>, depth: ArrayLike<number>, minRun: number): ConstantRun[] {
  const runs: ConstantRun[] = [];
  const n = data.length;
  let i = 0;
  while (i < n) {
    const v = data[i]!;
    let j = i + 1;
    if (Number.isFinite(v)) while (j < n && data[j] === v) j++;
    if (Number.isFinite(v) && j - i >= minRun) runs.push({ value: v, start: i, end: j, topM: depth[i]!, baseM: depth[j - 1]! });
    i = j;
  }
  return runs;
}

function worst(reasons: readonly QcReason[]): QcStatus {
  if (reasons.some((r) => r.severity === 'bad')) return 'bad';
  if (reasons.some((r) => r.severity === 'warning')) return 'warning';
  return 'ok';
}

function curveQc(
  curve: Curve,
  depth: ArrayLike<number>,
  roles: RoleCatalog,
  o: ResolvedOptions,
  /** Solo para el caliper: muestras con caliper inválido (se excluyen de la búsqueda de picos). */
  invalidCaliper: Uint8Array | null,
): CurveQc {
  const data = curve.data;
  const n = data.length;
  const flags = new Uint8Array(n);
  const reasons: QcReason[] = [];
  const valid = finiteValues(data);
  const nullCount = n - valid.length;
  const nullFraction = n === 0 ? 0 : nullCount / n;
  const base = { curveId: curve.id, mnemonic: curve.mnemonic, role: curve.role, unit: curve.unit, samples: n, nullCount, nullFraction };

  if (valid.length === 0) {
    reasons.push({ severity: 'bad', code: 'no-data', message: 'La curva no tiene ningún dato.' });
    return { ...base, stats: null, range: rangeFor(curve), outOfRangeCount: 0, spikeIndices: [], constantRuns: [], status: 'bad', reasons, flags };
  }

  const sorted = Float64Array.from(valid).sort();
  const stats: CurveStats = {
    count: valid.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    p1: quantileSorted(sorted, 0.01),
    p99: quantileSorted(sorted, 0.99),
    median: quantileSorted(sorted, 0.5),
  };

  // Nulos
  if (nullCount > 0) {
    const severity: QcSeverity = nullFraction > o.nullBad ? 'bad' : nullFraction > o.nullWarning ? 'warning' : 'info';
    const message =
      nullFraction > o.nullBad
        ? `Casi sin datos: solo ${samplesWord(valid.length)} con dato de ${fmtCount(n)} (${fmtPct(1 - nullFraction)}).`
        : `${samplesWord(nullCount)} sin dato (${fmtPct(nullFraction)}).`;
    reasons.push({ severity, code: 'nulls', message });
  }

  // Rango físico (en la unidad canónica)
  const range = rangeFor(curve);
  let outOfRangeCount = 0;
  if (range) {
    const k = toRangeUnit(curve.unit, range);
    if (k) {
      const [scale, shift] = k;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const raw = data[i]!;
        if (!Number.isFinite(raw)) continue;
        const v = raw * scale + shift;
        const bad = v > range.max || (range.minExclusive ? v <= range.min : v < range.min);
        if (bad) {
          flags[i]! |= QC_FLAGS.OUT_OF_RANGE;
          outOfRangeCount++;
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
      if (outOfRangeCount > 0) {
        const frac = outOfRangeCount / valid.length;
        const extremes = lo === hi ? withUnit(lo, range.unit) : `${withUnit(lo, range.unit)} a ${withUnit(hi, range.unit)}`;
        reasons.push({
          severity: frac > o.outOfRangeBad ? 'bad' : 'warning',
          code: 'out-of-range',
          message: `${samplesWord(outOfRangeCount)} fuera del rango físico (${rangeText(range)}): ${extremes}.`,
        });
      }
    }
  }

  // Picos aislados. Las muestras ya marcadas (fuera de rango, caliper inválido) no cuentan ni como pico ni como vecinas.
  const skip = new Uint8Array(n);
  for (let i = 0; i < n; i++) skip[i] = flags[i]! !== 0 || (invalidCaliper?.[i] ?? 0) ? 1 : 0;
  const spikeIndices = detectSpikes(data, isLogScale(curve, roles), skip, o);
  if (spikeIndices.length > 0) {
    let peak = spikeIndices[0]!;
    for (const i of spikeIndices) {
      const far = (x: number) => Math.abs(x - stats.median);
      if (far(data[i]!) > far(data[peak]!)) peak = i;
      flags[i]! |= QC_FLAGS.SPIKE;
    }
    const frac = spikeIndices.length / valid.length;
    reasons.push({
      severity: frac > o.spikeBad ? 'bad' : 'warning',
      code: 'spikes',
      message:
        `${fmtCount(spikeIndices.length)} ${spikeIndices.length === 1 ? 'pico aislado' : 'picos aislados'} ` +
        `(el mayor, ${withUnit(data[peak]!, curve.unit)} a ${fmtDepth(depth[peak]!)} m; percentil 99: ${withUnit(stats.p99, curve.unit)}).`,
    });
  }

  // Rachas de valor constante (BS es constante por definición; las banderas y clases también).
  const role = curve.role !== null ? roles.get(curve.role) : undefined;
  const skipConstant = curve.role === 'BS' || role?.family === 'flag' || role?.unit === 'unitless';
  const constantRuns = skipConstant ? [] : detectConstantRuns(data, depth, Math.max(2, Math.round(o.constantRunMin)));
  if (constantRuns.length > 0) {
    const byValue = new Map<number, { samples: number; runs: number }>();
    let total = 0;
    for (const r of constantRuns) {
      for (let i = r.start; i < r.end; i++) flags[i]! |= QC_FLAGS.CONSTANT;
      const e = byValue.get(r.value) ?? { samples: 0, runs: 0 };
      e.samples += r.end - r.start;
      e.runs++;
      byValue.set(r.value, e);
      total += r.end - r.start;
    }
    const severity: QcSeverity = total / valid.length > o.constantBad ? 'bad' : 'warning';
    const entries = [...byValue.entries()].sort((a, b) => b[1].samples - a[1].samples);
    for (const [value, e] of entries.slice(0, 3)) {
      const runs = e.runs > 1 ? ` en ${e.runs} tramos` : '';
      reasons.push({ severity, code: 'constant', message: `${samplesWord(e.samples)} con valor constante ${withUnit(value, curve.unit)}${runs}.` });
    }
    if (entries.length > 3) {
      const rest = entries.slice(3).reduce((s, [, e]) => s + e.samples, 0);
      reasons.push({ severity, code: 'constant', message: `${samplesWord(rest)} más en rachas de otros ${entries.length - 3} valores constantes.` });
    }
  }

  return { ...base, stats, range, outOfRangeCount, spikeIndices, constantRuns, status: worst(reasons), reasons, flags };
}

// ── Estado del pozo (caliper) ───────────────────────────────────────────────────────────────────────────────────

function toInches(curve: Curve): Float64Array | null {
  if (!getUnit(curve.unit) || !sameDimension(curve.unit, 'in')) return null;
  const [scale, shift] = conversionCoefficients(curve.unit, 'in');
  return Float64Array.from(curve.data, (v) => v * scale + shift);
}

function intervals(
  hit: Uint8Array,
  depth: ArrayLike<number>,
  value: (i: number) => number,
  pick: (a: number, b: number) => number,
  kind: BoreholeIssue,
  mergeGap: number,
): BoreholeInterval[] {
  const out: BoreholeInterval[] = [];
  const n = hit.length;
  let i = 0;
  while (i < n) {
    if (!hit[i]) {
      i++;
      continue;
    }
    let end = i + 1;
    let samples = 1;
    let extreme = value(i);
    let j = i + 1;
    while (j < n) {
      if (hit[j]) {
        samples++;
        extreme = pick(extreme, value(j));
        end = j + 1;
        j++;
      } else if (j - end < mergeGap) j++;
      else break;
    }
    out.push({ kind, start: i, end, topM: depth[i]!, baseM: depth[end - 1]!, samples, extreme });
    i = end;
  }
  return out;
}

function thicknessOf(list: readonly BoreholeInterval[], depth: ArrayLike<number>): number {
  const step = depth.length > 1 ? (depth[depth.length - 1]! - depth[0]!) / (depth.length - 1) : 0;
  return list.reduce((s, r) => s + r.samples * step, 0);
}

function boreholeQc(well: Well, byId: Map<string, CurveQc>, o: ResolvedOptions): BoreholeQc | null {
  const cal = well.curves.find((c) => c.role === 'CALI');
  if (!cal) return null;
  const calIn = toInches(cal);
  if (!calIn) return null;
  const bsCurve = well.curves.find((c) => c.role === 'BS') ?? null;
  const bsIn = bsCurve ? toInches(bsCurve) : null;
  const depth = well.depth.values;
  const n = calIn.length;
  const washout = new Uint8Array(n);
  const invalid = new Uint8Array(n);
  const mask = new Uint8Array(n);
  const bitAt = (i: number): number => (bsIn && Number.isFinite(bsIn[i]!) ? bsIn[i]! : o.bitSize);
  let washoutSamples = 0;
  let invalidSamples = 0;
  for (let i = 0; i < n; i++) {
    const c = calIn[i]!;
    if (!Number.isFinite(c)) continue;
    if (c < o.minValidCaliper) {
      invalid[i] = 1;
      invalidSamples++;
    } else if (isWashout(c, bitAt(i), o.washoutTolerance)) {
      washout[i] = 1;
      washoutSamples++;
    }
    mask[i] = invalid[i]! | washout[i]!;
  }
  const washouts = intervals(washout, depth, (i) => calIn[i]! - bitAt(i), Math.max, 'washout', o.mergeGap);
  const invalidCaliper = intervals(invalid, depth, (i) => calIn[i]!, Math.min, 'invalid-caliper', o.mergeGap);

  // Razones sobre el propio caliper
  const calQc = byId.get(cal.id);
  if (calQc && invalidSamples > 0) {
    for (let i = 0; i < n; i++) if (invalid[i]) calQc.flags[i]! |= QC_FLAGS.INVALID_CALIPER;
    const minCal = invalidCaliper.reduce((m, r) => Math.min(m, r.extreme), Infinity);
    calQc.reasons.push({
      severity: invalidSamples / Math.max(1, calQc.stats?.count ?? 1) > o.invalidCaliperBad ? 'bad' : 'warning',
      code: 'invalid-caliper',
      message:
        `${samplesWord(invalidSamples)} con caliper inválido (< ${fmtNum(o.minValidCaliper)} in con trépano de ` +
        `${fmtNum(bsIn ? bitAt(0) : o.bitSize)} in; mínimo ${fmtNum(minCal)} in) en ${washoutsWord(invalidCaliper.length)}.`,
    });
  }
  if (calQc && washoutSamples > 0) {
    calQc.reasons.push({
      severity: 'info',
      code: 'washout',
      message:
        `Derrumbe (caliper > trépano + ${fmtNum(o.washoutTolerance)} in) en ${washoutsWord(washouts.length)}, ` +
        `${samplesWord(washoutSamples)} (${fmtNum(thicknessOf(washouts, depth))} m).`,
    });
  }
  if (calQc) calQc.status = worst(calQc.reasons);

  // Curvas de patín: no confiables en esos tramos
  const affectedCurveIds: string[] = [];
  const bad = washoutSamples + invalidSamples;
  if (bad > 0) {
    for (const c of well.curves) {
      if (c.role === null || !PAD_ROLES.includes(c.role)) continue;
      const q = byId.get(c.id);
      if (!q || q.stats === null) continue;
      let k = 0;
      for (let i = 0; i < n; i++) {
        if (mask[i] && Number.isFinite(c.data[i]!)) {
          q.flags[i]! |= QC_FLAGS.BOREHOLE;
          k++;
        }
      }
      if (k === 0) continue;
      affectedCurveIds.push(c.id);
      const parts = [
        washoutSamples > 0 ? `derrumbe en ${washoutsWord(washouts.length)}` : '',
        invalidSamples > 0 ? `caliper inválido en ${washoutsWord(invalidCaliper.length)}` : '',
      ].filter(Boolean);
      q.reasons.push({
        severity: 'warning',
        code: 'borehole',
        message: `No confiable en ${samplesWord(k)} por el estado del pozo (${parts.join('; ')}).`,
      });
      q.status = worst(q.reasons);
    }
  }

  return {
    caliperId: cal.id,
    bitSizeCurveId: bsIn ? bsCurve!.id : null,
    bitSize: bsIn ? bitAt(0) : o.bitSize,
    washouts,
    invalidCaliper,
    washoutSamples,
    invalidCaliperSamples: invalidSamples,
    washoutThicknessM: thicknessOf(washouts, depth),
    invalidCaliperThicknessM: thicknessOf(invalidCaliper, depth),
    affectedCurveIds,
    mask,
  };
}

const washoutsWord = (k: number): string => `${fmtCount(k)} ${k === 1 ? 'tramo' : 'tramos'}`;

// ── API ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Corre el control de calidad sobre todas las curvas del pozo (con rol o sin él). No modifica el pozo. */
export function runQc(well: Well, options: QcOptions = {}): QcReport {
  const o = resolveOptions(options);
  const roles = options.roles ?? defaultRoleCatalog;
  const depth = well.depth.values;
  const caliper = well.curves.find((c) => c.role === 'CALI');
  const calIn = caliper ? toInches(caliper) : null;
  const invalidCal = calIn ? Uint8Array.from(calIn, (v) => (v < o.minValidCaliper ? 1 : 0)) : null;
  const curves = well.curves.map((c) => curveQc(c, depth, roles, o, c === caliper ? invalidCal : null));
  const byId = new Map(curves.map((q) => [q.curveId, q]));
  const borehole = boreholeQc(well, byId, o);
  const status: QcStatus = curves.some((c) => c.status === 'bad') ? 'bad' : curves.some((c) => c.status === 'warning') ? 'warning' : 'ok';
  return { wellId: well.id, samples: depth.length, curves, borehole, status, options: o };
}

/** Curvas ocultas: un `Set` de ids o cualquier colección con `has` y `size` (un `Map` por id). */
export interface CurveIdFilter {
  readonly size: number;
  has(curveId: string): boolean;
}

const restrictCache = new WeakMap<QcReport, { excluded: CurveIdFilter; report: QcReport }>();

/**
 * El reporte visto a través de la sarta de perfilaje (docs/decisiones/0032): sin las curvas ocultas y, si el caliper
 * está oculto, sin la evaluación del pozo (derrumbes): esa información sale del caliper y la sarta lo saca de la vista.
 * Las curvas de patín ocultas salen de `affectedCurveIds`. No recalcula nada (el control se hizo sobre el archivo
 * entero) y devuelve EL MISMO reporte si no hay nada oculto; mismo objeto derivado para el mismo conjunto.
 */
export function restrictQcReport(report: QcReport, excluded: CurveIdFilter): QcReport {
  if (excluded.size === 0) return report;
  const hit = restrictCache.get(report);
  if (hit && hit.excluded === excluded) return hit.report;
  const curves = report.curves.filter((c) => !excluded.has(c.curveId));
  const b = report.borehole;
  const borehole = !b || excluded.has(b.caliperId) ? null : { ...b, affectedCurveIds: b.affectedCurveIds.filter((id) => !excluded.has(id)) };
  const status: QcStatus = curves.some((c) => c.status === 'bad') ? 'bad' : curves.some((c) => c.status === 'warning') ? 'warning' : 'ok';
  const out: QcReport = { ...report, curves, borehole, status };
  restrictCache.set(report, { excluded, report: out });
  return out;
}

export function getCurveQc(report: QcReport, curveId: string): CurveQc | undefined {
  return report.curves.find((c) => c.curveId === curveId);
}

/**
 * Máscara de muestras no confiables de una curva (array nuevo; 1 = no confiable): fuera de rango, picos, rachas
 * constantes, caliper inválido y, para las curvas de patín, tramos con derrumbe. Las muestras sin dato quedan en 0
 * (ya son NaN). `exclude` permite ignorar algunos tipos (p. ej. `QC_FLAGS.CONSTANT`). null si la curva no está.
 */
export function unreliableMask(report: QcReport, curveId: string, exclude = 0): Uint8Array | null {
  const q = getCurveQc(report, curveId);
  if (!q) return null;
  const keep = 0xff & ~exclude;
  return Uint8Array.from(q.flags, (f) => (f & keep ? 1 : 0));
}
