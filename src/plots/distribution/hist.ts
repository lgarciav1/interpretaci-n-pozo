/**
 * Vista «Histogramas» de las distribuciones por zona (docs/decisiones/0066, D18). Puro y testeado.
 *
 * - Clases: el mismo criterio que el histograma del dock (`src/plots/histogram/histogram.ts`): rango del percentil 0,5
 *   al 99,5 ensanchado un 8 % (`autoRange`) sobre TODAS las muestras usadas de las filas visibles, y cantidad de clases
 *   por Freedman–Diaconis (Sturges si el IQR es 0), iguales en log10 para k y las resistividades. Los bordes van de un
 *   extremo al otro del eje compartido, así cada clase cae en el mismo lugar en todas las filas.
 * - Peso: el mismo de la caja (`forEachUsed`): espesor; h·φ para Sw (volumen poral); los plugs, 1 cada uno.
 * - Normalización: cada serie se lleva a fracción de su propio peso total y se dibuja escalada a SU pico (como un
 *   «ridgeline»): una zona fina se lee igual que una gruesa, y una serie angosta (los plugs) no aplasta a la del perfil
 *   en la misma fila. Las alturas no se comparan entre series; la forma, la posición y la fracción por clase (tooltip) sí.
 */
import type { DistributionInput, DistributionOptions } from '../../petro/distribution';
import { autoBinCount, autoRange, binEdges, binIndex, type HistScale } from '../histogram/histogram';
import { niceRange, type XYAxis } from '../xy/axes';
import { formatNumber } from '../../ui/format';
import { fmtValue, type IndexRange } from './distribution';
import { forEachUsed } from './interact';

/** Una serie dentro de una fila: fracción del peso por clase (suma ≤ 1; lo de afuera del eje no entra). */
export interface LaneHistogram {
  fraction: Float64Array;
  /** Peso total usado (m, m·v/v o cantidad de plugs). */
  total: number;
  /** Fracción del peso fuera del eje (por debajo + por encima). */
  outside: number;
  /** Mayor fracción de una clase: la altura a la que se escala la serie en su fila. */
  peak: number;
}

/** Valores y pesos usados de una serie en unos tramos (las mismas muestras que la caja). */
export function usedSamples(input: DistributionInput, options: DistributionOptions, ranges: readonly IndexRange[]): { xs: number[]; ws: number[] } {
  const xs: number[] = [];
  const ws: number[] = [];
  forEachUsed(input, options, ranges, (_, x, w) => {
    xs.push(x);
    ws.push(w);
  });
  return { xs, ws };
}

/**
 * Eje de la vista de histogramas: el rango automático del histograma del dock sobre los valores de todas las series
 * (y los cutoffs, para que su manija siempre se pueda agarrar), con extremos «lindos». Si todo es ≥ 0, no baja de 0.
 */
export function histogramAxis(values: ArrayLike<number>, scale: HistScale, label: string, unit?: string, extra: readonly number[] = []): XYAxis | null {
  const r = autoRange(values, scale);
  if (!r) return null;
  const ok = (v: number) => Number.isFinite(v) && (scale === 'linear' || v > 0);
  const finite = [r.lo, r.hi, ...extra].filter(ok);
  const nice = niceRange([finite], scale, { pad: 0.02 });
  if (!nice) return null;
  let allPos = true;
  for (let i = 0; i < values.length; i++) if (values[i]! < 0) allPos = false;
  const min = scale === 'linear' && allPos && finite.every((v) => v >= 0) ? Math.max(0, nice.min) : nice.min;
  return { kind: scale, min, max: nice.max, label, ...(unit ? { unit } : {}) };
}

/** Bordes de las clases sobre el eje: cantidad por Freedman–Diaconis de los valores (en la escala del eje). */
export function histogramEdges(axis: XYAxis, values: ArrayLike<number>): Float64Array {
  const scale: HistScale = axis.kind === 'log' ? 'log' : 'linear';
  const t = (v: number) => (scale === 'log' ? (v > 0 ? Math.log10(v) : NaN) : v);
  const xs: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = t(values[i]!);
    if (Number.isFinite(v)) xs.push(v);
  }
  xs.sort((a, b) => a - b);
  const q = (p: number) => {
    if (xs.length === 0) return NaN;
    const h = (xs.length - 1) * p;
    const a = Math.floor(h);
    const b = Math.min(a + 1, xs.length - 1);
    return xs[a]! + (h - a) * (xs[b]! - xs[a]!);
  };
  const span = t(axis.max) - t(axis.min);
  const k = autoBinCount(xs.length, q(0.75) - q(0.25), span);
  return binEdges(axis.min, axis.max, k, scale);
}

/** Histograma ponderado de una serie en una fila, como fracción de su peso total. null si no hay peso. */
export function laneHistogram(xs: readonly number[], ws: readonly number[], edges: ArrayLike<number>): LaneHistogram | null {
  const fraction = new Float64Array(Math.max(0, edges.length - 1));
  let total = 0;
  let out = 0;
  for (let j = 0; j < xs.length; j++) {
    const w = ws[j]!;
    if (!(w > 0) || !Number.isFinite(xs[j]!)) continue;
    total += w;
    const b = binIndex(edges, xs[j]!);
    if (b >= 0) fraction[b]! += w;
    else out += w;
  }
  if (!(total > 0)) return null;
  let peak = 0;
  for (let b = 0; b < fraction.length; b++) {
    fraction[b]! /= total;
    if (fraction[b]! > peak) peak = fraction[b]!;
  }
  return { fraction, total, outside: out / total, peak };
}

/**
 * Tooltip de una fila en la vista de histogramas: la clase bajo el puntero y, por serie, qué fracción de su peso cae
 * en ella; después la mediana y la media de cada serie (las marcas dibujadas).
 */
export function histTooltip(
  zone: string,
  value: number,
  edges: ArrayLike<number>,
  lanes: readonly { label: string; hist: LaneHistogram | null; stats: { n: number; p50: number; mean: number } | null; plugs: boolean }[],
  weightText: string,
  unit?: string,
): string[] {
  const b = binIndex(edges, value);
  const lines = [zone];
  if (b >= 0) lines.push(`Clase ${fmtValue(edges[b]!)}–${fmtValue(edges[b + 1]!, unit)}`);
  const pct = (f: number) => (f > 0 && f < 0.001 ? '<0,1' : formatNumber(f * 100, { digits: 1 }));
  for (const l of lanes) {
    const name = l.label || 'Zona';
    if (!l.stats || !(l.stats.n > 0)) {
      lines.push(`${name}: sin dato`);
      continue;
    }
    const inBin = l.hist && b >= 0 ? `${pct(l.hist.fraction[b]!)} % del ${l.plugs ? 'total de plugs' : weightText} en la clase · ` : '';
    lines.push(`${name}: ${inBin}P50 ${fmtValue(l.stats.p50)} · media ${fmtValue(l.stats.mean, unit)}`);
  }
  return lines;
}
