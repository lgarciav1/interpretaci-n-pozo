/**
 * Columna litológica del pozo para la formación de la vista 3D de la sarta (docs/decisiones/0033, D9). PURA: sin three
 * ni DOM. Convierte el pozo cargado en capas (tope, base, litología, permeabilidad sugerida) que la escena recorta al
 * tramo dibujado y el renderizador pinta con texturas procedurales.
 *
 * Dos fuentes, en este orden:
 * - **Litología sugerida** del modelo de facies (clases FORCE 2020, 0030), si el motor la calculó.
 * - **GR**: índice de arcilla lineal con los percentiles 5 y 95 del pozo entero (así el color de una capa no cambia
 *   al mover la ventana), en cinco clases de arena limpia a lutita.
 *
 * Es una ilustración, no una interpretación: la permeabilidad es una sugerencia por clase (decide si se dibujan
 * revoque y zona invadida) y no sale de ningún cálculo petrofísico.
 */
import type { FillId } from '../../ui/curves';

/** Rellenos de litología que usa la columna (subconjunto de `FILL_PALETTE`). */
export type LithFill = Extract<FillId, 'sand' | 'shale' | 'limestone' | 'dolomite' | 'anhydrite' | 'salt' | 'coal' | 'marl' | 'chalk' | 'tuff' | 'basement'>;
/** Textura procedural de la capa. */
export type LithPattern = 'sand' | 'shale' | 'carbonate' | 'evaporite' | 'coal' | 'plain';

export interface FormationLayer {
  /** Tope y base (m, tope < base). */
  top: number;
  base: number;
  /** Litología: `a`, mezclada con `b` en proporción `t` (0 = solo `a`). */
  a: LithFill;
  b?: LithFill;
  t: number;
  pattern: LithPattern;
  /** Permeabilidad sugerida por la clase, 0–1 (revoque y zona invadida). */
  perm: number;
  label: string;
}

export type FormationSource = 'facies' | 'gr';

export interface FormationColumn {
  source: FormationSource;
  /** Capas de arriba a abajo, contiguas. */
  layers: FormationLayer[];
  top: number;
  base: number;
}

type LayerKind = Omit<FormationLayer, 'top' | 'base'>;

/** Clases del GR: índice de arcilla en quintos. */
export const GR_CLASSES: readonly LayerKind[] = [
  { a: 'sand', t: 0, pattern: 'sand', perm: 1, label: 'Arena limpia' },
  { a: 'sand', b: 'shale', t: 0.3, pattern: 'sand', perm: 0.7, label: 'Arena arcillosa' },
  { a: 'sand', b: 'shale', t: 0.55, pattern: 'shale', perm: 0.3, label: 'Heterolítica' },
  { a: 'shale', b: 'sand', t: 0.25, pattern: 'shale', perm: 0.08, label: 'Lutita arenosa' },
  { a: 'shale', t: 0, pattern: 'shale', perm: 0, label: 'Lutita' },
];

/** Clases FORCE 2020 por índice (0–11), con la misma paleta que la pista de litología sugerida. */
export const FACIES_CLASSES: readonly LayerKind[] = [
  { a: 'sand', t: 0, pattern: 'sand', perm: 1, label: 'Arenisca' },
  { a: 'sand', b: 'shale', t: 0.5, pattern: 'sand', perm: 0.5, label: 'Arenisca/Lutita' },
  { a: 'shale', t: 0, pattern: 'shale', perm: 0, label: 'Lutita' },
  { a: 'marl', t: 0, pattern: 'shale', perm: 0.1, label: 'Marga' },
  { a: 'dolomite', t: 0, pattern: 'carbonate', perm: 0.6, label: 'Dolomía' },
  { a: 'limestone', t: 0, pattern: 'carbonate', perm: 0.5, label: 'Caliza' },
  { a: 'chalk', t: 0, pattern: 'carbonate', perm: 0.4, label: 'Creta' },
  { a: 'salt', t: 0, pattern: 'evaporite', perm: 0, label: 'Halita' },
  { a: 'anhydrite', t: 0, pattern: 'evaporite', perm: 0, label: 'Anhidrita' },
  { a: 'tuff', t: 0, pattern: 'plain', perm: 0.2, label: 'Toba' },
  { a: 'coal', t: 0, pattern: 'coal', perm: 0, label: 'Carbón' },
  { a: 'basement', t: 0, pattern: 'plain', perm: 0, label: 'Basamento' },
];

/** Capas más finas que esto (muestras) se funden con la vecina: evita un código de barras de una muestra. */
const MIN_RUN = 3;

function percentile(sorted: readonly number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i]!;
}

/** Clase GR (0–4) por muestra con el índice de arcilla P5–P95; −1 sin dato. */
export function grClasses(gr: ArrayLike<number>): Int8Array | null {
  const vals: number[] = [];
  for (let i = 0; i < gr.length; i++) if (Number.isFinite(gr[i]!)) vals.push(gr[i]!);
  if (vals.length < 2) return null;
  vals.sort((a, b) => a - b);
  const lo = percentile(vals, 0.05);
  const hi = percentile(vals, 0.95);
  if (!(hi > lo)) return null;
  const out = new Int8Array(gr.length);
  for (let i = 0; i < gr.length; i++) {
    const v = gr[i]!;
    if (!Number.isFinite(v)) {
      out[i] = -1;
      continue;
    }
    const igr = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    out[i] = Math.min(4, Math.floor(igr * 5));
  }
  return out;
}

/**
 * Capas a partir de una clase por muestra (−1 = sin dato: toma la clase de la vecina). Las corridas de menos de
 * `MIN_RUN` muestras se funden con la de arriba (o con la de abajo si es la primera).
 */
export function layersFromClasses(depth: ArrayLike<number>, cls: ArrayLike<number>, kinds: readonly LayerKind[]): FormationLayer[] {
  const n = Math.min(depth.length, cls.length);
  // Sin dato → la clase anterior válida (o la siguiente al principio).
  const c = new Int16Array(n).fill(-1);
  let last = -1;
  for (let i = 0; i < n; i++) {
    const k = cls[i]!;
    const v = Number.isFinite(k) && k >= 0 && k < kinds.length ? Math.round(k) : -1;
    if (v >= 0) last = v;
    c[i] = v >= 0 ? v : last;
  }
  const first = c.findIndex((v) => v >= 0);
  if (first < 0) return [];
  for (let i = 0; i < first; i++) c[i] = c[first]!;
  // Corridas.
  let runs: { k: number; i0: number; i1: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = runs[runs.length - 1];
    if (r && r.k === c[i]) r.i1 = i;
    else runs.push({ k: c[i]!, i0: i, i1: i });
  }
  // Fundir las finas con la vecina (repetido: al fundir se pueden juntar dos iguales).
  for (let pass = 0; pass < 3; pass++) {
    const merged: typeof runs = [];
    for (let j = 0; j < runs.length; j++) {
      const r = runs[j]!;
      const prev = merged[merged.length - 1];
      if (r.i1 - r.i0 + 1 < MIN_RUN && (prev || runs[j + 1])) {
        if (prev) prev.i1 = r.i1;
        else runs[j + 1]!.i0 = r.i0;
        continue;
      }
      if (prev && prev.k === r.k) prev.i1 = r.i1;
      else merged.push({ ...r });
    }
    runs = merged;
  }
  // Límites a mitad de camino entre muestras.
  const edge = (i: number) => (i <= 0 ? depth[0]! : i >= n ? depth[n - 1]! : (depth[i - 1]! + depth[i]!) / 2);
  return runs.map((r) => ({ top: edge(r.i0), base: edge(r.i1 + 1), ...kinds[r.k]! }));
}

/** Columna desde el GR (null si no hay GR útil). */
export function formationFromGr(depth: ArrayLike<number>, gr: ArrayLike<number>): FormationColumn | null {
  const cls = grClasses(gr);
  if (!cls) return null;
  const layers = layersFromClasses(depth, cls, GR_CLASSES);
  return layers.length ? { source: 'gr', layers, top: layers[0]!.top, base: layers[layers.length - 1]!.base } : null;
}

/** Columna desde la clase de litología sugerida (índices FORCE 0–11; null si no hay ninguna). */
export function formationFromFacies(depth: ArrayLike<number>, cls: ArrayLike<number>): FormationColumn | null {
  const layers = layersFromClasses(depth, cls, FACIES_CLASSES);
  return layers.length ? { source: 'facies', layers, top: layers[0]!.top, base: layers[layers.length - 1]!.base } : null;
}

/** Capas de la columna dentro de [top, base], recortadas. */
export function clipLayers(col: FormationColumn, top: number, base: number): FormationLayer[] {
  const out: FormationLayer[] = [];
  for (const l of col.layers) {
    if (l.base <= top || l.top >= base) continue;
    out.push({ ...l, top: Math.max(top, l.top), base: Math.min(base, l.base) });
  }
  return out;
}

/** Tramo [tope, base] de largo `length` centrado en `center` y dentro de la columna (si la columna es más corta, toda). */
export function depthWindow(col: Pick<FormationColumn, 'top' | 'base'>, center: number, length: number): { top: number; base: number } {
  if (col.base - col.top <= length) return { top: col.top, base: col.top + length };
  const top = Math.min(col.base - length, Math.max(col.top, center - length / 2));
  return { top, base: top + length };
}
