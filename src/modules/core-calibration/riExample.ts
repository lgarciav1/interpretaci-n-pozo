/**
 * Ensayo de índice de resistividad de EJEMPLO SINTÉTICO, coherente con los plugs de ejemplo de `../core/example.ts`.
 * NO son datos reales: el conjunto lleva `synthetic: true` y la interfaz lo rotula «ejemplo sintético» siempre.
 *
 * Diseño (docs/decisiones/0053):
 * - Cuatro plugs con el mismo id y la misma profundidad de archivo que plugs del ejemplo de corona (C1-04, C1-12,
 *   C2-03 y C2-09: la profundidad del perforador, 2,4 m y 1,6 m por encima del perfil, como en ese ejemplo).
 * - Desaturación por plato poroso: Sw de 1 hasta 0,24–0,35 según el plug (el más arcilloso no baja tanto).
 * - RI = Sw^(−nᵢ) con nᵢ = `EXAMPLE_N` + un apartamiento propio del plug (−0,10 … +0,08) y ruido log-normal σ = 0,015
 *   en log10 RI (semilla fija). El primer paso es Sw = 1, RI = 1 (la definición del ensayo).
 * - Con a = 1 y m = 1,85 del factor de formación de ejemplo, el trío de diseño es a = 1, m = 1,85, n ≈ 2,1.
 */
import { createPointSet, type PointSet } from '../../core/pointSets';
import { CORE_RI_COLUMNS, CORE_RI_SET_KIND } from '../../io/coreRi';
import { EXAMPLE_SHIFTS } from '../core/example';

/** Exponente de saturación de diseño del ejemplo. */
export const EXAMPLE_N = 2.1;

const PLUGS = [
  { id: 'C1-04', run: '1', depth: 7986 + 3, dn: 0.08, swEnd: 0.24 },
  { id: 'C1-12', run: '1', depth: 7986 + 11, dn: -0.05, swEnd: 0.27 },
  { id: 'C2-03', run: '2', depth: 8100 + 2, dn: 0.03, swEnd: 0.3 },
  { id: 'C2-09', run: '2', depth: 8100 + 8, dn: -0.1, swEnd: 0.35 },
] as const;
const STEPS = 9;

function gaussian(seed: number): () => number {
  let s = seed >>> 0;
  const u = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** Conjunto RI–Sw de ejemplo (sintético). Determinista. */
export function exampleRiSet(id: string): PointSet {
  const rnd = gaussian(20261101);
  const sw: number[] = [];
  const ri: number[] = [];
  const md: number[] = [];
  const plug: string[] = [];
  const ids: string[] = [];
  for (const p of PLUGS) {
    const n = EXAMPLE_N + p.dn;
    const z = +(p.depth - EXAMPLE_SHIFTS[p.run]!).toFixed(2);
    for (let k = 0; k < STEPS; k++) {
      // Pasos equiespaciados en log Sw, de 1 a swEnd.
      const s = k === 0 ? 1 : Math.pow(p.swEnd, k / (STEPS - 1));
      const e = rnd();
      sw.push(+s.toFixed(4));
      ri.push(k === 0 ? 1 : +Math.pow(10, -n * Math.log10(s) + 0.015 * e).toPrecision(4));
      md.push(z);
      plug.push(p.id);
      ids.push(`${p.id}·${String(k + 1).padStart(2, '0')}`);
    }
  }
  return createPointSet({
    id,
    kind: CORE_RI_SET_KIND,
    name: 'Índice de resistividad · ejemplo sintético',
    synthetic: true,
    depth: Float64Array.from(md),
    pointIds: ids,
    columns: {
      [CORE_RI_COLUMNS.sw]: { label: 'Saturación de agua', unit: 'v/v', values: Float64Array.from(sw) },
      [CORE_RI_COLUMNS.ri]: { label: 'Índice de resistividad', unit: 'unitless', values: Float64Array.from(ri) },
      [CORE_RI_COLUMNS.md]: { label: 'Profundidad', unit: 'm', values: Float64Array.from(md) },
      [CORE_RI_COLUMNS.plug]: { label: 'Plug', values: plug },
    },
  });
}
