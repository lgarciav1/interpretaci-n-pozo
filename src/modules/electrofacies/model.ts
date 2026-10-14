/**
 * Electrofacies (fase 10c-2): constantes, elección de k y lectura de parámetros. Puro: lo usan las definiciones
 * (worker), la pista, el panel y los tests.
 */
import type { ParamState } from '../../core/params';
import type { ReadonlyTableValue } from '../../core/module';

export const ELECTROFACIES_ID = 'electrofacies';
export const ELECTROFACIES_SCAN_ID = 'electrofacies-scan';
export const EF_PORT = { cls: 'EF', conf: 'EF_P' } as const;
export const EF_SCAN_TABLE = 'EF_SCAN';
export const EF_CLUSTERS_TABLE = 'EF_CLUSTERS';
export const K_MIN = 2;
export const K_MAX = 8;
export const K_VALUES: readonly number[] = Array.from({ length: K_MAX - K_MIN + 1 }, (_, i) => K_MIN + i);
/** Semilla fija: mismo pozo y parámetros → mismas electrofacies. */
export const EF_SEED = 20201;

export type EfMethod = 'gmm' | 'kmeans';
export const METHOD_LABEL: Readonly<Record<EfMethod, string>> = { gmm: 'Mezcla gaussiana', kmeans: 'k-means' };
/** Qué mide la curva de elección de k según el método. */
export const SCORE_LABEL: Readonly<Record<EfMethod, string>> = { gmm: 'BIC', kmeans: 'Inercia' };

export const efLabel = (i: number): string => `EF ${i + 1}`;

/**
 * k sugerido a partir de una curva que baja con k (BIC o inercia). Si la curva tiene un mínimo interior (BIC que vuelve
 * a subir), ese mínimo. Si no, el codo: el k más alejado por debajo de la cuerda entre el primer y el último punto, con
 * los dos ejes normalizados a [0, 1] (criterio «kneedle», Satopää et al. 2011). null si hay menos de 3 puntos finitos.
 *
 * `interiorMinimum: false` (inercia de k-means): solo el codo. La inercia no tiene mínimo interior en teoría; si aparece
 * uno es un óptimo local de k-means en el k más alto (un poco peor que el anterior), no una señal para elegir ese k.
 */
export function suggestK(ks: readonly number[], score: readonly number[], opts: { interiorMinimum?: boolean } = {}): number | null {
  const pts = ks.map((k, i) => [k, score[i]!] as const).filter(([, s]) => Number.isFinite(s));
  if (pts.length < 3) return null;
  if (opts.interiorMinimum ?? true) {
    let iMin = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i]![1] < pts[iMin]![1]) iMin = i;
    if (iMin < pts.length - 1) return pts[iMin]![0];
  }
  const [k0, s0] = pts[0]!;
  const [k1, s1] = pts[pts.length - 1]!;
  if (!(s0 > s1) || k1 === k0) return null;
  let best = -Infinity;
  let bestK: number | null = null;
  for (const [k, s] of pts.slice(1, -1)) {
    const x = (k - k0) / (k1 - k0);
    const y = (s - s1) / (s0 - s1);
    const dist = 1 - x - y;
    if (dist > best) { best = dist; bestK = k; }
  }
  return best > 0 ? bestK : null;
}

export interface ScanRow { k: number; bic: number; inertia: number }

/** Filas de la tabla de elección de k. */
export function decodeScan(table: ReadonlyTableValue | undefined): ScanRow[] {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  return (table?.rows ?? []).map((r) => ({ k: num(r.k), bic: num(r.bic), inertia: num(r.inertia) })).filter((r) => Number.isInteger(r.k));
}

export function scoreOf(row: ScanRow, method: EfMethod): number {
  return method === 'gmm' ? row.bic : row.inertia;
}

/** k sugerido para el método, desde la tabla de elección de k. */
export function suggestedKFromScan(table: ReadonlyTableValue | undefined, method: EfMethod): number | null {
  const rows = decodeScan(table);
  return suggestK(rows.map((r) => r.k), rows.map((r) => scoreOf(r, method)), { interiorMinimum: method === 'gmm' });
}

const key = (k: string) => `${ELECTROFACIES_ID}.${k}`;

/** Método y k guardados (global), resueltos como el motor. `k` es 'auto' o '2'…'8'. */
export function efParams(params: Pick<ParamState, 'global'>): { method: EfMethod; k: string } {
  const m = params.global[key('method')];
  const k = params.global[key('k')];
  return { method: m === 'kmeans' ? 'kmeans' : 'gmm', k: typeof k === 'string' ? k : 'auto' };
}
