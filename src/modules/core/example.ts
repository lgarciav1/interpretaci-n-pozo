/**
 * Plugs de corona de EJEMPLO SINTÉTICO para el pozo del TP. NO son datos reales: el conjunto lleva `synthetic: true`
 * y la interfaz lo rotula «ejemplo sintético» siempre.
 *
 * Diseño (docs/decisiones/0010, D8):
 * - Dos coronas en las capas de mejor porosidad del pozo (zona D): corona 1 de 7986 a 8008 m y corona 2 de 8100 a
 *   8118 m (profundidad VERDADERA, la del perfil), un plug por metro.
 * - φ de cada plug = PHIE del perfil a la profundidad verdadera + ruido N(0; 0,008) (la PHIE con la que se arma el
 *   ejemplo es la que calculó la app: así la correlación es la del pozo y no una inventada aparte).
 * - k = 10^(a + b·φ + ε), a = −1,7 y b = 22 (arenisca típica: 1 mD con φ ≈ 0,08 y 60 mD con φ ≈ 0,16), ε ~ N(0; 0,22)
 *   en log10 (ruido log-normal).
 * - Densidad de grano 2,65 ± 0,02 g/cm³ (cuarzo).
 * - Factor de formación F = a/φ^m con a = 1 y m = 1,85 (`EXAMPLE_M`) y ruido log-normal σ = 0,03 en log10, con OTRA
 *   semilla (docs/decisiones/0023, D8): agregar F no cambia φ, k, ρg ni las profundidades del ejemplo.
 * - Puesta en profundidad conocida: el archivo tiene la profundidad del perforador, 2,4 m MÁS ARRIBA que la del perfil
 *   en la corona 1 y 1,6 m en la corona 2. La correcta es +2,4 m y +1,6 m (`EXAMPLE_SHIFTS`): la sugerencia por
 *   correlación debe recuperarlas.
 * - Dos plugs malos: uno fisurado (k ×200, la descripción lo dice) y uno desmoronado con φ = 0,47 (fuera de rango).
 *   Las reglas de calidad proponen descartarlos.
 * Ruido pseudoaleatorio con semilla fija: con la misma PHIE el ejemplo es siempre el mismo.
 */
import { createPointSet, type PointSet } from '../../core/pointSets';
import { addPointSet } from '../../core/state/pointSets';
import type { Project } from '../../core/state/project';
import { addTrend } from '../../core/state/trends';
import type { TrendSpec } from '../../core/trends';
import { interpolateAt } from '../../petro/depthMatch';
import { COL, CORE_KIND, CORE_PROVIDER_ID, kphiSeriesKey } from './model';

export const EXAMPLE_A = -1.7;
export const EXAMPLE_B = 22;
/** Exponente de cementación de diseño del factor de formación de los plugs (a = 1). */
export const EXAMPLE_M = 1.85;
/** Puesta en profundidad correcta de cada corona (m): la que tiene que recuperar la sugerencia. */
export const EXAMPLE_SHIFTS: Readonly<Record<string, number>> = { '1': 2.4, '2': 1.6 };
const CORES = [
  { run: '1', top: 7986, base: 8008 },
  { run: '2', top: 8100, base: 8118 },
] as const;

/** Generador congruencial (Numerical Recipes) + Box–Muller: ruido gaussiano reproducible. */
function gaussian(seed: number): () => number {
  let s = seed >>> 0;
  const u = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

const describe = (phi: number) => (phi >= 0.12 ? 'Arenisca media, bien seleccionada' : phi >= 0.06 ? 'Arenisca fina, algo arcillosa' : 'Limolita arcillosa');

/**
 * Conjunto de plugs de ejemplo (sintético) a partir de la PHIE del perfil (profundidad y valores, v/v). null si la PHIE
 * no tiene datos en los tramos de las coronas (otro pozo).
 */
export function exampleCoreSet(id: string, log: { depth: ArrayLike<number>; phie: ArrayLike<number> }): PointSet | null {
  const rnd = gaussian(20261010);
  const rndF = gaussian(20261012);
  const depth: number[] = [];
  const phi: number[] = [];
  const k: number[] = [];
  const rhog: number[] = [];
  const ff: number[] = [];
  const run: string[] = [];
  const desc: string[] = [];
  const ids: string[] = [];
  for (const c of CORES) {
    let n = 0;
    for (let z = c.top; z <= c.base + 1e-9; z += 1) {
      const e1 = rnd();
      const e2 = rnd();
      const e3 = rnd();
      const base = interpolateAt(log.depth, log.phie, z);
      if (!Number.isFinite(base)) continue;
      n++;
      let p = Math.min(0.4, Math.max(0.005, base + 0.008 * e1));
      let logk = EXAMPLE_A + EXAMPLE_B * p + 0.22 * e2;
      let d = describe(p);
      if (c.run === '1' && n === 8) {
        logk += 2.3; // fisura: el gas pasa por la fisura y no por la matriz
        d = 'Arenisca media, fisurada';
      }
      if (c.run === '2' && n === 13) {
        p = 0.47;
        d = 'Plug desmoronado: volumen poroso mal medido';
      }
      depth.push(+(z - EXAMPLE_SHIFTS[c.run]!).toFixed(2));
      phi.push(+p.toFixed(4));
      k.push(+Math.pow(10, logk).toPrecision(3));
      rhog.push(+(2.65 + 0.02 * e3).toFixed(3));
      const eF = rndF();
      ff.push(p > 0.02 && p < 0.45 ? +Math.pow(10, -EXAMPLE_M * Math.log10(p) + 0.03 * eF).toPrecision(4) : NaN);
      run.push(c.run);
      desc.push(d);
      ids.push(`C${c.run}-${String(n).padStart(2, '0')}`);
    }
  }
  if (ids.length < 10) return null;
  return createPointSet({
    id,
    kind: CORE_KIND,
    name: 'Corona · ejemplo sintético',
    synthetic: true,
    depth: Float64Array.from(depth),
    pointIds: ids,
    columns: {
      [COL.phi]: { label: 'Porosidad', unit: 'v/v', values: Float64Array.from(phi) },
      [COL.k]: { label: 'Permeabilidad', unit: 'mD', values: Float64Array.from(k) },
      [COL.rhog]: { label: 'Densidad de grano', unit: 'g/cm3', values: Float64Array.from(rhog) },
      [COL.ff]: { label: 'Factor de formación', unit: 'unitless', values: Float64Array.from(ff) },
      [COL.run]: { label: 'Corona', values: run },
      [COL.description]: { label: 'Descripción', values: desc },
    },
  });
}

/** Color del modelo k–φ (azul: se distingue de los plugs, fucsia y verde azulado, y de la nube gris del perfil). */
export const KPHI_COLOR = '#1d4ed8';

/** Modelo k–φ nuevo: tendencia exponencial (recta en log k) sobre la serie k–φ del conjunto. */
export function kphiTrendSpec(id: string, setId: string, name = 'Modelo k–φ'): TrendSpec {
  return {
    id,
    name,
    color: KPHI_COLOR,
    visible: true,
    series: { provider: CORE_PROVIDER_ID, key: kphiSeriesKey(setId) },
    model: 'exp',
    mode: 'fit',
    selection: { excluded: [] },
    extend: true,
  };
}

/** Agrega el conjunto de ejemplo y su modelo k–φ ya ajustado (sin poner en profundidad: eso lo hace el usuario). */
export function addCoreExample(project: Project, wellId: string, set: PointSet, trendId: string): Project {
  return addTrend(addPointSet(project, wellId, set), wellId, kphiTrendSpec(trendId, set.id));
}
