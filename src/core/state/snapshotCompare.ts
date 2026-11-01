/**
 * Comparación del sumario por zona entre dos estados de interpretación (snapshot o actual). Puro: sin React ni
 * stores. Decisión: docs/decisiones/0026-comparacion-de-snapshots.md.
 *
 * 1. `extractSummary` lee, de las salidas de una corrida del motor, la tabla ZONE_SUMMARY (y OOIP/OGIP si el
 *    volumétrico los entrega) y arma un valor por zona y por métrica, con la zona identificada por su id.
 * 2. `compareSummaries` empareja las zonas de A y B por id (en el orden de A, con las que solo están en B al final y
 *    el total último) y calcula Δ = B − A y el % relativo a A donde tiene sentido.
 */
import { convert } from '../units';
import type { NodeReport, OutputRecord } from '../engine/engine';
import type { Diagnostic } from '../engine/graph';
import type { TableValue } from '../module';
import { layoutZones, type Zone } from '../well';

export type MetricId = 'netSand' | 'netRes' | 'netPay' | 'phi' | 'sw' | 'vsh' | 'k' | 'ooip' | 'ogip';

export interface MetricDef {
  id: MetricId;
  /** Rótulo corto para la cabecera. */
  label: string;
  /** Descripción para el título accesible de la columna. */
  title: string;
  unit: string;
  digits: number;
  /** true si el % relativo tiene sentido (espesores, permeabilidad, volúmenes); en fracciones se muestra solo Δ. */
  pct: boolean;
  /** Columna de ZONE_SUMMARY de la que sale (las de volumen salen de las salidas por zona). */
  column?: string;
}

export const SUMMARY_METRICS: readonly MetricDef[] = [
  { id: 'netSand', label: 'Arena', title: 'Espesor de arena neta (solo Vsh)', unit: 'm', digits: 1, pct: true, column: 'netSand' },
  { id: 'netRes', label: 'Neto res.', title: 'Espesor neto de reservorio', unit: 'm', digits: 1, pct: true, column: 'netRes' },
  { id: 'netPay', label: 'Neto pay', title: 'Espesor neto pay', unit: 'm', digits: 1, pct: true, column: 'netPay' },
  { id: 'phi', label: 'φe', title: 'Porosidad efectiva media del pay', unit: 'v/v', digits: 3, pct: false, column: 'phiPay' },
  { id: 'sw', label: 'Sw', title: 'Saturación de agua media del pay', unit: 'v/v', digits: 3, pct: false, column: 'swPay' },
  { id: 'vsh', label: 'Vsh', title: 'Arcillosidad media del pay', unit: 'v/v', digits: 3, pct: false, column: 'vshPay' },
  { id: 'k', label: 'k', title: 'Permeabilidad media del pay', unit: 'mD', digits: 1, pct: true, column: 'kPay' },
  { id: 'ooip', label: 'OOIP', title: 'Petróleo in situ', unit: 'MMbbl', digits: 2, pct: true },
  { id: 'ogip', label: 'OGIP', title: 'Gas in situ', unit: 'Bcf', digits: 2, pct: true },
];

/** Clave de la fila del total (no choca con ids de zona, que no empiezan con «#»). */
export const TOTAL_KEY = '#total';
/** Clave del intervalo «Pozo completo» cuando no hay zonas. */
export const WHOLE_WELL_KEY = '#well';

export interface SummaryZone {
  key: string;
  name: string;
  seal: boolean;
  values: Partial<Record<MetricId, number>>;
}

export interface SummarySide {
  /** Zonas en orden de profundidad (o «Pozo completo»). */
  zones: SummaryZone[];
  total: SummaryZone | null;
  /** Por qué no hay sumario (faltan entradas, error); null si lo hay. */
  missing: string | null;
}

/** Lo que `extractSummary` necesita de una corrida del motor. */
export interface SummaryRun {
  outputs: readonly OutputRecord[];
  nodes?: readonly NodeReport[];
  diagnostics?: readonly Diagnostic[];
}

const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function moduleProblem(run: SummaryRun, moduleId: string): string {
  const node = run.nodes?.find((n) => n.moduleId === moduleId);
  const diag = run.diagnostics?.find((d) => d.moduleId === moduleId && d.level === 'error') ?? run.diagnostics?.find((d) => d.moduleId === moduleId);
  const why = diag?.message ? ` ${diag.message}` : '';
  if (!node) return `El sumario por zona no se calculó (módulo desactivado o sin registrar).${why}`;
  if (node.status === 'missing-input') return `Faltan entradas para el sumario por zona (curvas de cutoffs, φe o Sw).${why}`;
  if (node.status === 'error') return `El sumario por zona dio un error.${why}`;
  return `El sumario por zona no se pudo calcular.${why}`;
}

/**
 * Sumario por zona de una corrida. `zones` y `depth` son los de esa interpretación y ese pozo: sirven para saber a qué
 * zona corresponde cada fila de la tabla (el módulo las ordena como `layoutZones`).
 */
export function extractSummary(run: SummaryRun, zones: readonly Zone[], depth: ArrayLike<number>): SummarySide {
  const table = run.outputs.find((o) => o.moduleId === 'zone-summary' && o.port === 'ZONE_SUMMARY');
  const rows = (table?.value as TableValue | undefined)?.rows;
  if (!table || !rows) return { zones: [], total: null, missing: moduleProblem(run, 'zone-summary') };

  const spans = layoutZones(depth, zones).spans;
  const zoneScalar = (port: string) => {
    const o = run.outputs.find((x) => x.moduleId === 'volumetrics' && x.port === port);
    return o && o.kind === 'zoneScalar' ? (o.value as Readonly<Record<string, number>>) : null;
  };
  const ooip = zoneScalar('OOIP');
  const ogip = zoneScalar('OGIP');
  const totalScalar = (port: string) => {
    const o = run.outputs.find((x) => x.moduleId === 'volumetrics' && x.port === port);
    return o && o.kind === 'scalar' ? finite(o.value) : undefined;
  };

  const values = (row: Readonly<Record<string, unknown>>, zoneId: string | null): Partial<Record<MetricId, number>> => {
    const out: Partial<Record<MetricId, number>> = {};
    for (const m of SUMMARY_METRICS) {
      if (!m.column) continue;
      const v = finite(row[m.column]);
      if (v !== undefined) out[m.id] = v;
    }
    const vo = zoneId === null ? totalScalar('OOIP_TOTAL') : finite(ooip?.[zoneId]);
    const vg = zoneId === null ? totalScalar('OGIP_TOTAL') : finite(ogip?.[zoneId]);
    if (vo !== undefined) out.ooip = convert(vo, 'm3', 'MMbbl');
    if (vg !== undefined) out.ogip = convert(vg, 'm3', 'Bcf');
    return out;
  };

  const list: SummaryZone[] = [];
  let total: SummaryZone | null = null;
  rows.forEach((row, i) => {
    if (row['zone'] === 'Total' && i === rows.length - 1) {
      total = { key: TOTAL_KEY, name: 'Total', seal: false, values: values(row, null) };
      return;
    }
    const span = spans[i];
    if (spans.length === 0) {
      list.push({ key: WHOLE_WELL_KEY, name: String(row['zone'] ?? 'Pozo completo'), seal: false, values: values(row, null) });
    } else if (span) {
      list.push({ key: span.id, name: span.name, seal: span.kind === 'seal', values: values(row, span.id) });
    }
  });
  return { zones: list, total, missing: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Comparación

export type Sign = -1 | 0 | 1;

export interface CompareCell {
  a: number | null;
  b: number | null;
  /** B − A (null si falta alguno). */
  delta: number | null;
  /** 100·(B − A)/|A| (null si no aplica, falta un valor o A = 0 con B ≠ 0). */
  pct: number | null;
  sign: Sign | null;
}

export interface CompareRow {
  key: string;
  name: string;
  /** 'both' si la zona está en los dos estados; si no, en cuál. */
  presence: 'both' | 'onlyA' | 'onlyB';
  total: boolean;
  seal: boolean;
  cells: Record<MetricId, CompareCell>;
}

export interface SummaryComparison {
  /** Métricas a mostrar (OOIP/OGIP solo si alguno de los dos estados las entrega con algún valor ≠ 0). */
  metrics: MetricDef[];
  rows: CompareRow[];
  /** Filas (sin el total) con algún Δ ≠ 0 o presentes en un solo estado. */
  changed: number;
}

/** Diferencias menores que esto (relativas al valor) se consideran 0: ruido de punto flotante. */
const REL_EPS = 1e-9;

export function compareCell(a: number | null | undefined, b: number | null | undefined, withPct: boolean): CompareCell {
  const va = a !== null && a !== undefined && Number.isFinite(a) ? a : null;
  const vb = b !== null && b !== undefined && Number.isFinite(b) ? b : null;
  if (va === null || vb === null) return { a: va, b: vb, delta: null, pct: null, sign: null };
  let delta = vb - va;
  if (Math.abs(delta) <= REL_EPS * Math.max(1, Math.abs(va), Math.abs(vb))) delta = 0;
  const sign: Sign = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  let pct: number | null = null;
  if (withPct) pct = delta === 0 ? 0 : va === 0 ? null : (100 * delta) / Math.abs(va);
  return { a: va, b: vb, delta, pct, sign };
}

export function compareSummaries(a: SummarySide, b: SummarySide): SummaryComparison {
  const hasVolume = (id: MetricId) =>
    [a, b].some((s) => [...s.zones, ...(s.total ? [s.total] : [])].some((z) => { const v = z.values[id]; return v !== undefined && v !== 0; }));
  const metrics = SUMMARY_METRICS.filter((m) => (m.id === 'ooip' || m.id === 'ogip' ? hasVolume(m.id) : true));

  const cellsOf = (za: SummaryZone | undefined, zb: SummaryZone | undefined) => {
    const cells = {} as Record<MetricId, CompareCell>;
    for (const m of SUMMARY_METRICS) cells[m.id] = compareCell(za?.values[m.id], zb?.values[m.id], m.pct);
    return cells;
  };

  const byKeyB = new Map(b.zones.map((z) => [z.key, z]));
  const keysA = new Set(a.zones.map((z) => z.key));
  const rows: CompareRow[] = [];
  for (const za of a.zones) {
    const zb = byKeyB.get(za.key);
    rows.push({ key: za.key, name: zb?.name ?? za.name, presence: zb ? 'both' : 'onlyA', total: false, seal: (zb ?? za).seal, cells: cellsOf(za, zb) });
  }
  for (const zb of b.zones) {
    if (keysA.has(zb.key)) continue;
    rows.push({ key: zb.key, name: zb.name, presence: 'onlyB', total: false, seal: zb.seal, cells: cellsOf(undefined, zb) });
  }
  if (a.total || b.total) {
    rows.push({
      key: TOTAL_KEY,
      name: 'Total',
      presence: a.total && b.total ? 'both' : a.total ? 'onlyA' : 'onlyB',
      total: true,
      seal: false,
      cells: cellsOf(a.total ?? undefined, b.total ?? undefined),
    });
  }
  const changed = rows.filter((r) => !r.total && (r.presence !== 'both' || metrics.some((m) => r.cells[m.id].sign !== 0 && r.cells[m.id].sign !== null) || metrics.some((m) => (r.cells[m.id].a === null) !== (r.cells[m.id].b === null)))).length;
  return { metrics, rows, changed };
}
