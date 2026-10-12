/**
 * Lógica pura del panel de incertidumbre (sin React): lee las tablas del módulo, arma las opciones del selector de
 * destino (zonas con fluido y totales), pasa los volúmenes a unidades de campo (MMbbl o Bcf) y prepara el histograma,
 * la curva de excedencia y el tornado. También define la «firma» de lo que determina el resultado, para marcar los
 * resultados como desactualizados cuando cambia algo después de calcular. No recalcula nada del motor.
 */
import type { Interpretation } from '../../core/interpretation';
import type { TableCell } from '../../core/module';
import { convert, type UnitId } from '../../core/units';

export type Row = Readonly<Record<string, TableCell>>;

/** Clave de almacenamiento del interruptor de cálculo (parámetro global, no compartido). */
export const CALCULATE_KEY = 'uncertainty.calculate';

export const cellNum = (c: TableCell | undefined): number => (typeof c === 'number' && Number.isFinite(c) ? c : NaN);

export type FieldUnit = 'MMbbl' | 'Bcf';

export interface TargetOption {
  key: string;
  label: string;
  fluid: 'oil' | 'gas';
  fieldUnit: FieldUnit;
  total: boolean;
}

const TOTAL_LABEL: Record<string, string> = { TOTAL_OIL: 'Total petróleo', TOTAL_GAS: 'Total gas' };

/** Destinos del selector en el orden del motor (zonas en profundidad, después los totales). */
export function targetsOf(summary: readonly Row[]): TargetOption[] {
  // Con un solo fluido alcanza con «Total» (entra en el selector junto a las zonas).
  const oneTotal = summary.filter((r) => String(r.key ?? '') in TOTAL_LABEL).length === 1;
  return summary.map((r) => {
    const key = String(r.key ?? '');
    const fieldUnit: FieldUnit = r.fieldUnit === 'Bcf' ? 'Bcf' : 'MMbbl';
    return { key, label: key in TOTAL_LABEL ? (oneTotal ? 'Total' : TOTAL_LABEL[key]!) : String(r.target ?? key), fluid: fieldUnit === 'Bcf' ? 'gas' : 'oil', fieldUnit, total: key in TOTAL_LABEL };
  });
}

/** m³ → unidad de campo. */
export const toField = (v: number, unit: FieldUnit): number => (Number.isFinite(v) ? convert(v, 'm3', unit as UnitId) : NaN);

/** Percentiles y determinista de un destino, en unidades de campo. */
export interface TargetStats {
  unit: FieldUnit;
  det: number;
  p90: number;
  p50: number;
  p10: number;
  mean: number;
  min: number;
  max: number;
  /** (P10 − P90) / P50: ancho relativo de la incertidumbre. */
  spread: number;
}

export function statsOf(row: Row): TargetStats {
  const unit: FieldUnit = row.fieldUnit === 'Bcf' ? 'Bcf' : 'MMbbl';
  const f = (k: string) => toField(cellNum(row[k]), unit);
  const p90 = f('p90');
  const p50 = f('p50');
  const p10 = f('p10');
  return { unit, det: f('det'), p90, p50, p10, mean: f('mean'), min: f('min'), max: f('max'), spread: p50 > 0 ? (p10 - p90) / p50 : NaN };
}

/** Histograma del destino: bordes (n + 1) en unidades de campo y frecuencia en %. */
export function histogramFor(rows: readonly Row[], key: string, unit: FieldUnit): { edges: Float64Array; values: Float64Array } {
  const bins = rows.filter((r) => r.key === key).sort((a, b) => cellNum(a.bin) - cellNum(b.bin));
  const edges = new Float64Array(bins.length > 0 ? bins.length + 1 : 0);
  const values = new Float64Array(bins.length);
  bins.forEach((r, i) => {
    edges[i] = toField(cellNum(r.x0), unit);
    edges[i + 1] = toField(cellNum(r.x1), unit);
    values[i] = 100 * cellNum(r.freq);
  });
  return { edges, values };
}

/**
 * Curva de excedencia: x = volumen (campo), y = probabilidad de superarlo en % (100 → 0). Con esta lectura P90 es el
 * volumen donde la curva vale 90 %.
 */
export function exceedanceFor(rows: readonly Row[], key: string, unit: FieldUnit): { x: Float64Array; y: Float64Array } {
  const pts = rows
    .filter((r) => r.key === key)
    .map((r) => ({ p: cellNum(r.prob), v: toField(cellNum(r.value), unit) }))
    .filter((q) => Number.isFinite(q.p) && Number.isFinite(q.v))
    .sort((a, b) => a.p - b.p);
  return { x: Float64Array.from(pts, (q) => q.v), y: Float64Array.from(pts, (q) => 100 * (1 - q.p)) };
}

/** Barra del tornado en unidades de campo. */
export interface TornadoBar {
  param: string;
  label: string;
  /** Valor del parámetro en su extremo bajo / alto, ya con unidad («0,70 km²», «×0,90», «0,35 v/v»). */
  lowText: string;
  highText: string;
  vLow: number;
  vHigh: number;
  base: number;
  swing: number;
  swingPct: number;
}

export type NumberFormat = (v: number, digits: number) => string;

/** Valor del parámetro con su unidad. NaN = el valor difiere entre las zonas del total. */
export function paramValueText(param: string, v: number, fmt: NumberFormat): string {
  if (!Number.isFinite(v)) return 'por zona';
  switch (param) {
    case 'area':
      return `${fmt(v / 1e6, 2)} km²`;
    case 'b':
      return fmt(v, v < 0.05 ? 5 : 3);
    case 'phiMult':
    case 'swMult':
      return `×${fmt(v, 2)}`;
    default:
      return fmt(v, 3);
  }
}

/** Barras del tornado del destino, ordenadas por amplitud (como las entrega el motor). */
export function tornadoFor(rows: readonly Row[], key: string, unit: FieldUnit, fmt: NumberFormat): TornadoBar[] {
  return rows
    .filter((r) => r.key === key)
    .sort((a, b) => cellNum(a.rank) - cellNum(b.rank))
    .map((r) => {
      const param = String(r.param ?? '');
      return {
        param,
        label: String(r.label ?? param),
        lowText: paramValueText(param, cellNum(r.low), fmt),
        highText: paramValueText(param, cellNum(r.high), fmt),
        vLow: toField(cellNum(r.vLow), unit),
        vHigh: toField(cellNum(r.vHigh), unit),
        base: toField(cellNum(r.base), unit),
        swing: toField(cellNum(r.swing), unit),
        swingPct: 100 * cellNum(r.swingPct),
      };
    });
}

/** Extremos «redondos» que contienen los valores dados, con un margen relativo. */
export function niceRange(values: readonly number[], pad = 0.04): { min: number; max: number } | null {
  const v = values.filter(Number.isFinite);
  if (v.length === 0) return null;
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (hi - lo < 1e-12 * Math.max(1, Math.abs(hi))) {
    const d = Math.abs(hi) > 0 ? Math.abs(hi) * 0.1 : 1;
    lo -= d;
    hi += d;
  }
  const span = hi - lo;
  lo -= span * pad;
  hi += span * pad;
  const step = 10 ** Math.floor(Math.log10(span / 5));
  const min = Math.floor(lo / step) * step;
  return { min: values.every((x) => !Number.isFinite(x) || x >= 0) ? Math.max(0, min) : min, max: Math.ceil(hi / step) * step };
}

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

/**
 * Firma de lo que puede cambiar el resultado: parámetros de todos los módulos (los cutoffs y la cadena φ/Sw son de
 * otros módulos), zonas, fuentes elegidas y módulos desactivados. Excluye el propio interruptor de cálculo. Es
 * conservadora: un parámetro que no afecta al volumen también marca los resultados como desactualizados.
 */
export function dependencySignature(interp: Pick<Interpretation, 'params' | 'zones' | 'sources' | 'disabled'>): string {
  const { [CALCULATE_KEY]: _calc, ...global } = interp.params.global;
  return stable({
    global,
    zones: interp.params.zones,
    zoneDefs: interp.zones.map((z) => [z.id, z.name, z.kind, z.top, z.base]),
    sources: interp.sources,
    disabled: interp.disabled,
  });
}
