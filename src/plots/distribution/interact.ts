/**
 * Interacciones de las distribuciones por zona (docs/decisiones/0066, V2): cutoff sobre el eje y selección por rango.
 * Puro y testeado, sin React ni stores.
 *
 * - Muestras «usadas»: las MISMAS que entran en la caja (`intervalDistribution`, src/petro/distribution.ts): filtro
 *   zona/reservorio/pay, derrumbe excluido si se pide, sin dato fuera, y el mismo peso que los percentiles (espesor;
 *   h·φ para Sw por volumen poral). Así el % que pasa un cutoff o el % seleccionado se leen sobre la caja dibujada.
 * - Cutoff: el valor de cada zona sale de los parámetros compartidos del módulo de cutoffs (`sharedParamValue`,
 *   override de la zona o global), con el lado que pasa de `CUTOFF_PASSES` y cortes inclusivos como el motor.
 */
import type { ParamState } from '../../core/params';
import type { DistributionFilter, DistributionInput, DistributionOptions } from '../../petro/distribution';
import { CUTOFF_PASSES, cutoffActive, normalizeCutoff, paramStep, sharedParamValue, type CutoffParamKey } from '../cutoffs';
import type { XYAxis } from '../xy/axes';
import { nudgeGuideValue, snapGuideValue } from '../xy/XYPlot';
import type { IndexRange } from './distribution';

/**
 * Recorre las muestras usadas de los tramos `ranges` con las reglas de `intervalDistribution`: `visit(i, x, w)` con el
 * valor y su peso (> 0). Si el filtro pide una bandera que no está, no visita nada (el panel ya cae a «toda la zona»).
 */
export function forEachUsed(input: DistributionInput, options: DistributionOptions, ranges: readonly IndexRange[], visit: (i: number, x: number, w: number) => void): void {
  const { values, thickness, netRes, netPay, washout, phi, mask } = input;
  const { filter, excludeWashout, mean } = options;
  if ((filter === 'netRes' && !netRes) || (filter === 'netPay' && !netPay) || (mean === 'poreVolume' && !phi)) return;
  const flag = filter === 'netRes' ? netRes : filter === 'netPay' ? netPay : undefined;
  const dropWashout = excludeWashout && washout !== undefined;
  for (const { start, end } of ranges) {
    for (let i = start; i < end; i++) {
      if (mask && mask[i] !== 1) continue;
      if (flag && flag[i] !== 1) continue;
      if (filter === 'netPay' && netRes && netRes[i] !== 1) continue;
      if (dropWashout && washout![i] === 1) continue;
      const h = thickness[i]!;
      if (!Number.isFinite(h) || h <= 0) continue;
      const x = values[i]!;
      if (!Number.isFinite(x) || (mean === 'geometric' && !(x > 0))) continue;
      const w = mean === 'poreVolume' ? h * phi![i]! : h;
      if (!Number.isFinite(w) || w <= 0) continue;
      visit(i, x, w);
    }
  }
}

export interface WeightedFraction {
  /** 0–1; NaN si no hay ninguna muestra usada. */
  fraction: number;
  /** Peso total de las muestras usadas (m, o m·v/v con volumen poral). */
  total: number;
  /** Peso de las que cumplen. */
  part: number;
}

function fractionOf(input: DistributionInput, options: DistributionOptions, ranges: readonly IndexRange[], test: (i: number, x: number) => boolean): WeightedFraction {
  let total = 0;
  let part = 0;
  forEachUsed(input, options, ranges, (i, x, w) => {
    total += w;
    if (test(i, x)) part += w;
  });
  return { fraction: total > 0 ? part / total : NaN, total, part };
}

/** true si el valor pasa el cutoff (inclusivo, como el motor: Vsh y Sw ≤ máximo; φ y k ≥ mínimo). */
export const passesCutoff = (x: number, cutoff: number, side: 'below' | 'above'): boolean => (side === 'below' ? x <= cutoff : x >= cutoff);

/** Fracción ponderada de las muestras usadas que pasa el cutoff. */
export function cutoffPassFraction(input: DistributionInput, options: DistributionOptions, ranges: readonly IndexRange[], cutoff: number, side: 'below' | 'above'): WeightedFraction {
  if (!Number.isFinite(cutoff)) return { fraction: NaN, total: 0, part: 0 };
  return fractionOf(input, options, ranges, (_, x) => passesCutoff(x, cutoff, side));
}

/**
 * Filtro sobre el que se mide el % que pasa un cutoff real. Si el filtro elegido YA aplica ese cutoff (reservorio neto
 * con Vsh, φ o k; pay neto con cualquiera), el % sobre él sería 100 % por construcción: se mide sobre el nivel de
 * arriba que no lo aplica (Sw sobre el reservorio neto: es el N/G del pay; Vsh, φ y k sobre toda la zona).
 */
export function passBaseFilter(filter: DistributionFilter, param: CutoffParamKey | null): DistributionFilter {
  if (!param || filter === 'all') return filter;
  if (param === 'swCutoff') return 'netRes';
  return 'all';
}

/** Fracción ponderada de las muestras usadas con valor en [lo, hi] (en cualquier orden). */
export function rangeFraction(input: DistributionInput, options: DistributionOptions, ranges: readonly IndexRange[], lo: number, hi: number): WeightedFraction {
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  return fractionOf(input, options, ranges, (_, x) => x >= a && x <= b);
}

/** Fracción ponderada de las muestras usadas que están en la máscara (selección de otra fuente). */
export function maskFraction(input: DistributionInput, options: DistributionOptions, ranges: readonly IndexRange[], mask: Uint8Array): WeightedFraction {
  return fractionOf(input, options, ranges, (i) => mask[i] === 1);
}

/**
 * Máscara de la selección por rango sobre las `n` muestras del pozo: las usadas (zonas visibles, filtro, derrumbe,
 * sin dato) con valor en [lo, hi].
 */
export function rangeMask(n: number, input: DistributionInput, options: DistributionOptions, ranges: readonly IndexRange[], lo: number, hi: number): Uint8Array {
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  const m = new Uint8Array(n);
  forEachUsed(input, options, ranges, (i, x) => {
    if (i < n && x >= a && x <= b) m[i] = 1;
  });
  return m;
}

/** Tramos de índices [start, end) de `ranges` cuyas muestras están en la máscara (para la caja de la selección). */
export function maskedRanges(ranges: readonly IndexRange[], mask: Uint8Array): IndexRange[] {
  const out: IndexRange[] = [];
  for (const { start, end } of ranges) {
    let s = -1;
    for (let i = start; i < end; i++) {
      if (mask[i] === 1) {
        if (s < 0) s = i;
      } else if (s >= 0) {
        out.push({ start: s, end: i });
        s = -1;
      }
    }
    if (s >= 0) out.push({ start: s, end });
  }
  return out;
}

// ── cutoff por zona ──────────────────────────────────────────────────────────────────────────────────────────────

/** Alcance de un arrastre de cutoff: una zona o el global (null). */
export interface CutoffPreview {
  zoneId: string | null;
  value: number;
}

export interface ZoneCutoff {
  value: number;
  /** La zona tiene su propio valor (override); si no, sigue al global. */
  own: boolean;
  /** Corte de k desactivado en la zona (se dibuja inactivo; arrastrarlo lo activa). */
  inactive: boolean;
  side: 'below' | 'above';
}

const hasOwn = (params: ParamState, key: string, zoneId: string) => {
  const v = params.zones[zoneId]?.[key];
  return typeof v === 'number' && Number.isFinite(v);
};

/**
 * Cutoff vigente de una zona (zoneId null = el global), con la vista previa de un arrastre: la del propio alcance, o
 * la del global si la zona no tiene valor propio (sigue al global mientras se arrastra).
 */
export function zoneCutoff(params: ParamState, key: CutoffParamKey, zoneId: string | null, preview?: CutoffPreview | null): ZoneCutoff {
  const own = zoneId !== null && hasOwn(params, key, zoneId);
  let value = sharedParamValue(params, key, zoneId);
  if (preview && (preview.zoneId === zoneId || (preview.zoneId === null && zoneId !== null && !own))) value = preview.value;
  return { value, own, inactive: !cutoffActive(params, key, zoneId), side: CUTOFF_PASSES[key] };
}

/**
 * Valor de un cutoff arrastrado: el real, acotado y redondeado como el slider del inspector (`normalizeCutoff`); una
 * línea libre, con el redondeo «humano» de las guías del gráfico x–y.
 */
export function cutoffDragValue(axis: XYAxis, key: CutoffParamKey | null, raw: number): number {
  return key ? normalizeCutoff(key, raw) : snapGuideValue(axis, raw);
}

/**
 * Valor de un cutoff movido `steps` pasos con el teclado: el paso del parámetro (el del slider); k (log, sin paso) y
 * las líneas libres, un 1 % del eje (proporcional en log). Mayús = 10 pasos lo decide quien llama.
 */
export function nudgeCutoff(axis: XYAxis, key: CutoffParamKey | null, v: number, steps: number): number {
  const step = key ? paramStep(key) : undefined;
  if (key && step !== undefined) return normalizeCutoff(key, v + steps * step);
  const next = nudgeGuideValue(axis, v, steps);
  return key ? normalizeCutoff(key, next) : next;
}

// ── sumario por zona del motor ───────────────────────────────────────────────────────────────────────────────────

/** Fila de la tabla ZONE_SUMMARY (módulo `zone-summary`). */
export type SummaryRow = Readonly<Record<string, string | number | boolean | null>>;

/** Pay neto (m) de una zona en la tabla del sumario (por nombre, como las tarjetas de zona); NaN si no está. */
export function summaryPay(rows: readonly SummaryRow[] | null | undefined, zoneName: string): number {
  const r = rows?.find((x) => x['zone'] === zoneName && x['zone'] !== 'Total');
  const v = r?.['netPay'];
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}
