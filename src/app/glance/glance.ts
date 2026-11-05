/**
 * Resumen de un vistazo (docs/decisiones/0068): modelo PURO de las tarjetas, los histogramas apilados por zona y la
 * nube del Pickett chico. Sin React ni stores. Los números salen de lo que ya calcula el motor: la tabla del sumario por
 * zona (`summarizeRanges`, src/petro/summary.ts) para las tarjetas, `cumulativeCurve`/`quantileFromCdf` del histograma
 * para la acumulada y su P50, y las zonas con la misma regla que el motor (`zoneRows`, src/plots/distribution/).
 */
import type { TableCell } from '../../core/module';
import { autoRange, binEdges, binIndex, cumulativeCurve, type CumulativeCurve, type HistScale } from '../../plots/histogram/histogram';
import type { ZoneRow } from '../../plots/distribution/distribution';

type Row = Readonly<Record<string, TableCell>>;

/** Nombre de la fila del total en la tabla del sumario por zona. */
export const TOTAL_ROW = 'Total';

export interface GlanceCards {
  /** m */
  gross: number;
  /** Reservorio neto, m. */
  net: number;
  /** Neto/bruto del reservorio, v/v. */
  ntg: number;
  /** Pay neto, m. */
  pay: number;
  /** φ media del reservorio neto, v/v. */
  phiNet: number;
  /** Sw media del pay (ponderada por volumen poral), v/v. */
  swPay: number;
}

const val = (c: TableCell | undefined): number => (typeof c === 'number' && Number.isFinite(c) ? c : NaN);

/** Tarjetas de una zona (por nombre) o del total (`zoneName` null) desde las filas del sumario. null si no está. */
export function glanceCards(rows: readonly Row[] | null | undefined, zoneName: string | null): GlanceCards | null {
  const r = rows?.find((x) => x.zone === (zoneName ?? TOTAL_ROW));
  if (!r) return null;
  return { gross: val(r.gross), net: val(r.netRes), ntg: val(r.ntgRes), pay: val(r.netPay), phiNet: val(r.phiRes), swPay: val(r.swPay) };
}

/** Índice de zona de cada muestra (posición en `rows`; −1 fuera de toda zona). */
export function zoneIndexOf(n: number, rows: readonly Pick<ZoneRow, 'ranges'>[]): Int16Array {
  const out = new Int16Array(n).fill(-1);
  rows.forEach((r, j) => {
    for (const g of r.ranges) for (let i = Math.max(0, g.start); i < Math.min(n, g.end); i++) out[i] = j;
  });
  return out;
}

export interface StackedLayer {
  zoneId: string;
  color: string;
  /** Espesor de la zona en cada clase (m). */
  values: Float64Array;
  /** Base apilada de cada clase (m): suma de las zonas anteriores. */
  base: Float64Array;
}

export interface StackedHistogram {
  edges: Float64Array;
  scale: HistScale;
  /** Una capa por zona con muestras en las clases (en orden de profundidad). */
  layers: StackedLayer[];
  /** Espesor total de cada clase (m). */
  total: Float64Array;
  /** Mayor total de una clase. */
  max: number;
  /** Acumulada ponderada por espesor de las muestras incluidas, con su P10/P50/P90 leídos sobre ella. */
  cdf: CumulativeCurve;
}

/** Cantidad de clases de un histograma chico: la automática acotada (se lee a ~170 px de ancho). */
export const MINI_BINS = { min: 8, max: 28 } as const;

/**
 * Histograma de espesor por clase apilado por zona (`zones` = índices de `rows` incluidos; null = todas). Las clases son
 * las automáticas del histograma (`autoRange`, `binEdges`, con la misma pertenencia que `countBins`), acotadas a
 * `MINI_BINS`. Los valores ≤ 0 no cuentan en log. null si no hay al menos dos valores distintos.
 */
export function stackedHistogram(
  values: ArrayLike<number>,
  scale: HistScale,
  zoneIdx: ArrayLike<number>,
  rows: readonly Pick<ZoneRow, 'id' | 'color'>[],
  thickness: ArrayLike<number>,
  zones: ReadonlySet<number> | null,
): StackedHistogram | null {
  const include = (i: number) => {
    const z = zoneIdx[i]!;
    return z >= 0 && (zones === null || zones.has(z));
  };
  const range = autoRange(values, scale, include);
  if (!range) return null;
  const bins = Math.min(MINI_BINS.max, Math.max(MINI_BINS.min, range.bins));
  const edges = binEdges(range.lo, range.hi, bins, scale);
  const k = edges.length - 1;
  const per = rows.map(() => new Float64Array(k));
  for (let i = 0; i < values.length; i++) {
    if (!include(i)) continue;
    const v = values[i]!;
    if (!Number.isFinite(v) || (scale === 'log' && !(v > 0))) continue;
    const h = thickness[i]!;
    if (!(h > 0)) continue;
    const j = binIndex(edges, v);
    if (j >= 0) per[zoneIdx[i]!]![j]! += h;
  }
  const total = new Float64Array(k);
  const layers: StackedLayer[] = [];
  rows.forEach((r, z) => {
    const v = per[z]!;
    if (!v.some((x) => x > 0)) return;
    layers.push({ zoneId: r.id, color: r.color, values: v, base: Float64Array.from(total) });
    for (let j = 0; j < k; j++) total[j]! += v[j]!;
  });
  let max = 0;
  for (const t of total) if (t > max) max = t;
  const cdf = cumulativeCurve(values, edges, scale, { weights: thickness, include });
  return { edges, scale, layers, total, max, cdf };
}

export interface PickettCloud {
  /** RT (ohm·m) y φ (v/v) de las muestras con los dos > 0 en las zonas incluidas (a lo sumo `max`, salteando parejo). */
  rt: Float64Array;
  phi: Float64Array;
  /** Índice de zona de cada punto (para el color). */
  zone: Int16Array;
  /** Muestras usadas (índices del pozo), para leer la Rw de esos puntos. */
  samples: Int32Array;
}

/** Nube del Pickett chico: RT contra φ en las zonas incluidas (null = todas), con un tope de puntos para dibujar liviano. */
export function pickettCloud(rt: ArrayLike<number>, phi: ArrayLike<number>, zoneIdx: ArrayLike<number>, zones: ReadonlySet<number> | null, max = 6000): PickettCloud {
  const idx: number[] = [];
  const n = Math.min(rt.length, phi.length);
  for (let i = 0; i < n; i++) {
    const z = zoneIdx[i]!;
    if (z < 0 || (zones !== null && !zones.has(z))) continue;
    if (rt[i]! > 0 && phi[i]! > 0 && Number.isFinite(rt[i]!) && Number.isFinite(phi[i]!)) idx.push(i);
  }
  const stride = Math.max(1, Math.ceil(idx.length / max));
  const keep = stride === 1 ? idx : idx.filter((_, q) => q % stride === 0);
  return {
    rt: Float64Array.from(keep, (i) => rt[i]!),
    phi: Float64Array.from(keep, (i) => phi[i]!),
    zone: Int16Array.from(keep, (i) => zoneIdx[i]!),
    samples: Int32Array.from(keep),
  };
}

/** Mediana de los valores > 0 de `data` en las muestras dadas (NaN si no hay). */
export function positiveMedianAt(data: ArrayLike<number>, samples: ArrayLike<number>): number {
  const xs: number[] = [];
  for (let q = 0; q < samples.length; q++) {
    const v = data[samples[q]!]!;
    if (v > 0 && Number.isFinite(v)) xs.push(v);
  }
  if (xs.length === 0) return NaN;
  xs.sort((a, b) => a - b);
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}
