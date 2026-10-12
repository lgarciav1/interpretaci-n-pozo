/**
 * Lógica pura del panel de capacidad de flujo (sin React): lee las tablas del módulo, arma las filas de tramos de la
 * zona elegida (o del total) y las series de Lorenz decimadas para dibujar. No recalcula nada del motor: el total
 * solo re-expresa los porcentajes de cada tramo respecto del total (en FLOW_UNITS vienen respecto de su zona).
 */
import type { TableCell } from '../../core/module';

export type Row = Readonly<Record<string, TableCell>>;

/** Clave del selector para el total (zoneId = ''). */
export const TOTAL_KEY = '__total';

export const cellNum = (c: TableCell | undefined): number => (typeof c === 'number' && Number.isFinite(c) ? c : NaN);
export const zoneKey = (zoneId: TableCell | undefined): string => (zoneId === '' || zoneId === null || zoneId === undefined ? TOTAL_KEY : String(zoneId));

/** Tramo listo para la tabla y el tooltip (porcentajes ×100). */
export interface UnitRow {
  /** Posición en la secuencia estratigráfica de la selección (0 = el de más arriba). */
  seq: number;
  zone: string;
  index: number;
  top: number;
  base: number;
  h: number;
  phi: number;
  k: number;
  phiHPct: number;
  kHPct: number;
  cumPhiHPct: number;
  cumKHPct: number;
}

/**
 * Tramos de la selección en orden de profundidad. Para el total se concatenan todos los renglones (el motor arma el
 * total con los tramos de las zonas en ese mismo orden) y los porcentajes pasan a ser del total.
 */
export function unitsFor(rows: readonly Row[], key: string): UnitRow[] {
  const total = key === TOTAL_KEY;
  const picked = total ? rows : rows.filter((r) => zoneKey(r.zoneId) === key);
  const base = picked.map((r, seq) => ({
    seq,
    zone: String(r.zone ?? ''),
    index: cellNum(r.index),
    top: cellNum(r.top),
    base: cellNum(r.base),
    h: cellNum(r.h),
    phi: cellNum(r.phi),
    k: cellNum(r.k),
    phiHPct: cellNum(r.phiHPct),
    kHPct: cellNum(r.kHPct),
    cumPhiHPct: cellNum(r.cumPhiHPct),
    cumKHPct: cellNum(r.cumKHPct),
  }));
  // Sin zonas, el único intervalo ya es el pozo completo: sus porcentajes ya son del total.
  if (!total || rows.every((r) => zoneKey(r.zoneId) === TOTAL_KEY)) return base;
  const phiH = picked.map((r) => cellNum(r.phiH));
  const kH = picked.map((r) => cellNum(r.kH));
  const sPhi = phiH.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const sK = kH.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  let cPhi = 0;
  let cK = 0;
  return base.map((u, i) => {
    const p = Number.isFinite(phiH[i]!) ? phiH[i]! : 0;
    const q = Number.isFinite(kH[i]!) ? kH[i]! : 0;
    cPhi += p;
    cK += q;
    return {
      ...u,
      phiHPct: sPhi > 0 ? (100 * p) / sPhi : NaN,
      kHPct: sK > 0 ? (100 * q) / sK : NaN,
      cumPhiHPct: sPhi > 0 ? (100 * cPhi) / sPhi : NaN,
      cumKHPct: sK > 0 ? (100 * cK) / sK : NaN,
    };
  });
}

/** Índices a dibujar de una polilínea de `n` puntos: a lo sumo `max`, siempre con el primero y el último. */
export function decimateIndices(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n <= max || max < 2) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  const step = (n - 1) / (max - 1);
  let last = -1;
  for (let j = 0; j < max; j++) {
    const i = Math.round(j * step);
    if (i !== last) out.push(i);
    last = i;
  }
  return out;
}

/** Serie de Lorenz en % (0–100) decimada; `src[j]` es el índice del punto original (0 = origen; i ≥ 1 = tramo i − 1). */
export interface LorenzSeries {
  x: Float64Array;
  y: Float64Array;
  src: Int32Array;
  /** Puntos originales (antes de decimar). */
  n: number;
}

export function lorenzSeries(rows: readonly Row[], key: string, curve: 'strat' | 'ordered', max = 1000): LorenzSeries {
  const pts = rows
    .filter((r) => r.curve === curve && zoneKey(r.zoneId) === key)
    .map((r) => ({ i: cellNum(r.i), x: cellNum(r.x), y: cellNum(r.y) }))
    .filter((p) => Number.isFinite(p.i) && Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.i - b.i);
  const idx = decimateIndices(pts.length, max);
  const x = new Float64Array(idx.length);
  const y = new Float64Array(idx.length);
  const src = new Int32Array(idx.length);
  idx.forEach((k, j) => {
    x[j] = 100 * pts[k]!.x;
    y[j] = 100 * pts[k]!.y;
    src[j] = pts[k]!.i;
  });
  return { x, y, src, n: pts.length };
}

/** Tramo a mostrar en el visor al hacer clic: centrado en el tramo, con al menos `minSpan` m de contexto. */
export function viewRangeFor(top: number, base: number, minSpan = 20): { top: number; base: number } {
  const mid = (top + base) / 2;
  const span = Math.max(minSpan, (base - top) * 1.5);
  return { top: mid - span / 2, base: mid + span / 2 };
}
