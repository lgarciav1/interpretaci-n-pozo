/**
 * Estadísticas del sumario por zona que se MUESTRAN pero no se calculan en el motor (docs/decisiones/0068): medias
 * geométrica y armónica de k y RT, y P10/P50/P90 con sus nulos. Ordenar las muestras para los percentiles cuesta ~2 ms
 * por llamada sobre el pozo del TP (el resto del sumario ~0,05 ms); en el recálculo en vivo de los cutoffs (test de
 * tiempo de `modules-6a-sensitivity`, < 20 ms) no se paga: el módulo llama a `summarizeRanges(…, { distributions: false })`
 * y esto se calcula aparte, una vez por resultado, solo cuando un panel lo muestra.
 *
 * Puro (sin React): mismas zonas que el motor (`layoutZones(…).spans`, tramo [start, end)) y mismas definiciones
 * (`summarizeRanges` completo). Las filas se identifican por el nombre de la fila de la tabla del sumario.
 */
import { layoutZones, type Zone } from '../../core/well';
import { summarizeRanges, type IntervalSummary, type SummaryInput } from '../../petro/summary';

/** Nombre de la fila del total y de la fila única sin zonas (iguales a los de la tabla del módulo). */
export const TOTAL_ROW = 'Total';
export const WHOLE_WELL_ROW = 'Pozo completo';

/** Sumario completo (con percentiles y medias) por nombre de fila de la tabla del sumario por zona. */
export function zoneSummaryStats(input: SummaryInput, depth: ArrayLike<number>, zones: readonly Zone[]): Map<string, IntervalSummary> {
  const n = depth.length;
  const spans = zones.length > 0 ? layoutZones(depth, zones).spans.map((s) => ({ name: s.name, start: s.start, end: s.end })) : [{ name: WHOLE_WELL_ROW, start: 0, end: n }];
  const out = new Map<string, IntervalSummary>();
  for (const s of spans) out.set(s.name, summarizeRanges(input, [{ start: s.start, end: s.end }]));
  out.set(TOTAL_ROW, summarizeRanges(input, spans.map((s) => ({ start: s.start, end: s.end }))));
  return out;
}
