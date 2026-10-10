/**
 * Presiones MDT de EJEMPLO SINTÉTICO para el pozo del TP (7633–8518 m). NO son datos reales: el conjunto lleva
 * `synthetic: true` y la interfaz lo rotula «ejemplo sintético» siempre.
 *
 * Diseño (físicamente coherente con la Sw que calcula la app con los parámetros por defecto, que baja entre
 * ≈ 7970 y 8083 m en la zona D y vuelve a ≈ 1 desde ≈ 8085 m):
 * - Columna continua en la zona D–E con nivel de agua libre (FWL) a 8086 m y contacto gas–petróleo a 8009 m.
 * - Gradientes: agua 0,45 psi/ft (1,038 g/cm³), petróleo 0,33 psi/ft (0,761 g/cm³), gas 0,08 psi/ft (0,185 g/cm³).
 * - Presión en el FWL: 11 950 psi (≈ hidrostática normal con 0,45 psi/ft desde superficie).
 * - Lodo de 10,5 lb/gal (0,546 psi/ft): sobrebalance ≈ 2500 psi.
 * - Ruido de manómetro ±2 psi (pseudoaleatorio con semilla fija: el ejemplo es siempre el mismo).
 * - Tres pruebas malas: una seca (presión sin estabilizar, muy baja), una sobrecargada (+42 psi, movilidad baja) y
 *   una tight (+11 psi, movilidad 0,08 mD/cP).
 * Los puntos están en capas porosas (PHIE ≥ 0,10 en el perfil calculado) salvo las pruebas malas, en capas cerradas.
 */
import { createPointSet, type PointSet } from '../../core/pointSets';
import { addPointSet } from '../../core/state/pointSets';
import type { Project } from '../../core/state/project';
import { addTrend } from '../../core/state/trends';
import type { TrendSpec } from '../../core/trends';
import { FLUID_COLOR, FLUID_LABEL, MDT_PROVIDER_ID, mdtSeriesKey, type Fluid } from './model';

const FT = 0.3048;
export const EXAMPLE_FWL_M = 8086;
export const EXAMPLE_GOC_M = 8009;
export const EXAMPLE_P_FWL_PSI = 11950;
export const EXAMPLE_GRADIENT_PSI_FT: Readonly<Record<Fluid, number>> = { gas: 0.08, oil: 0.33, water: 0.45 };
const MUD_PSI_FT = 0.546;

/** Presión «verdadera» del ejemplo a la profundidad z (m), sin ruido. */
export function examplePressure(z: number): number {
  const g = (f: Fluid) => EXAMPLE_GRADIENT_PSI_FT[f] / FT; // psi/m
  if (z >= EXAMPLE_FWL_M) return EXAMPLE_P_FWL_PSI + g('water') * (z - EXAMPLE_FWL_M);
  const pGoc = EXAMPLE_P_FWL_PSI + g('oil') * (EXAMPLE_GOC_M - EXAMPLE_FWL_M);
  if (z >= EXAMPLE_GOC_M) return EXAMPLE_P_FWL_PSI + g('oil') * (z - EXAMPLE_FWL_M);
  return pGoc + g('gas') * (z - EXAMPLE_GOC_M);
}

interface ExamplePoint {
  z: number;
  fluid: Fluid;
  quality: string;
  mobility: number;
  /** Desvío respecto de la presión de la columna (psi): pruebas malas. */
  offset?: number;
  /** Presión fija (prueba seca: no se estabilizó). */
  fixed?: number;
  comment?: string;
}

const POINTS: readonly ExamplePoint[] = [
  { z: 7971.5, fluid: 'gas', quality: 'Buena', mobility: 640 },
  { z: 7977.5, fluid: 'gas', quality: 'Buena', mobility: 410 },
  { z: 7990.0, fluid: 'gas', quality: 'Buena', mobility: 980 },
  { z: 7993.0, fluid: 'gas', quality: 'Buena', mobility: 1250 },
  { z: 8002.0, fluid: 'gas', quality: 'Buena', mobility: 1520 },
  { z: 8016.5, fluid: 'oil', quality: 'Buena', mobility: 85 },
  { z: 8040.5, fluid: 'oil', quality: 'Seca', mobility: 0.02, fixed: 6850, comment: 'Sin flujo: la presión no se estabilizó' },
  { z: 8049.5, fluid: 'oil', quality: 'Buena', mobility: 120 },
  { z: 8055.5, fluid: 'oil', quality: 'Buena', mobility: 64 },
  { z: 8064.5, fluid: 'oil', quality: 'Buena', mobility: 140 },
  { z: 8076.5, fluid: 'oil', quality: 'Buena', mobility: 210 },
  { z: 8094.5, fluid: 'water', quality: 'Buena', mobility: 160 },
  { z: 8103.5, fluid: 'water', quality: 'Buena', mobility: 145 },
  { z: 8112.5, fluid: 'water', quality: 'Buena', mobility: 230 },
  { z: 8118.5, fluid: 'water', quality: 'Tight', mobility: 0.08, offset: 11, comment: 'Capa cerrada; la presión no termina de estabilizar' },
  { z: 8130.5, fluid: 'water', quality: 'Buena', mobility: 175 },
  { z: 8137.0, fluid: 'water', quality: 'Sobrecargada', mobility: 0.6, offset: 42, comment: 'Invasión de filtrado: presión por encima de la tendencia' },
  { z: 8152.5, fluid: 'water', quality: 'Buena', mobility: 260 },
  { z: 8160.5, fluid: 'water', quality: 'Buena', mobility: 190 },
  { z: 8205.5, fluid: 'water', quality: 'Buena', mobility: 120 },
  { z: 8229.5, fluid: 'water', quality: 'Buena', mobility: 95 },
];

/** Generador congruencial (Numerical Recipes): ruido reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Tramos de los gradientes del ejemplo (para trazarlos ya hechos): de la primera a la última prueba buena. */
export const EXAMPLE_GRADIENT_RANGES: readonly { fluid: Fluid; top: number; base: number }[] = [
  { fluid: 'gas', top: 7968, base: 8005 },
  { fluid: 'oil', top: 8013, base: 8080 },
  { fluid: 'water', top: 8091, base: 8233 },
];

/** Conjunto MDT de ejemplo (sintético). */
export function examplePressureSet(id: string): PointSet {
  const rnd = lcg(20261009);
  const n = POINTS.length;
  const depth = new Float64Array(n);
  const pressure = new Float64Array(n);
  const mobility = new Float64Array(n);
  const mudBefore = new Float64Array(n);
  const mudAfter = new Float64Array(n);
  const tvd = new Float64Array(n);
  const ids: string[] = [];
  POINTS.forEach((p, i) => {
    depth[i] = p.z;
    tvd[i] = p.z; // pozo vertical
    const noise = (rnd() * 2 - 1) * 2; // ±2 psi
    pressure[i] = Math.round((p.fixed ?? examplePressure(p.z) + (p.offset ?? 0) + noise) * 10) / 10;
    mobility[i] = p.mobility;
    const mud = (MUD_PSI_FT / FT) * p.z + 14.7;
    mudBefore[i] = Math.round((mud + rnd() * 1.5) * 10) / 10;
    mudAfter[i] = Math.round((mud + rnd() * 1.5 - 0.8) * 10) / 10;
    ids.push(`MDT-${String(i + 1).padStart(2, '0')}`);
  });
  return createPointSet({
    id,
    kind: 'pressure',
    name: 'MDT · ejemplo sintético',
    synthetic: true,
    depth,
    pointIds: ids,
    columns: {
      tvd: { label: 'Profundidad TVD', unit: 'm', values: tvd },
      pressure: { label: 'Presión de formación', unit: 'psi', values: pressure },
      mobility: { label: 'Movilidad', unit: 'mD/cP', values: mobility },
      mudBefore: { label: 'Presión hidrostática (antes)', unit: 'psi', values: mudBefore },
      mudAfter: { label: 'Presión hidrostática (después)', unit: 'psi', values: mudAfter },
      quality: { label: 'Calidad', values: POINTS.map((p) => p.quality) },
      testType: { label: 'Tipo de prueba', values: POINTS.map(() => 'Pretest') },
      comment: { label: 'Comentario', values: POINTS.map((p) => p.comment ?? '') },
    },
  });
}

// ── receta: cargar el ejemplo con sus tres gradientes ya trazados ─────────────────────────────────────────────

/** Gradiente de presión nuevo (tendencia lineal sobre la serie MDT de ese fluido, con extensión para ver cortes). */
export function gradientSpec(id: string, name: string, setId: string, fluid: Fluid, range?: { top: number; base: number }): TrendSpec {
  return {
    id,
    name,
    color: FLUID_COLOR.light[fluid],
    visible: true,
    series: { provider: MDT_PROVIDER_ID, key: mdtSeriesKey(setId, fluid) },
    model: 'linear',
    mode: 'fit',
    selection: { ...(range ? { top: range.top, base: range.base } : {}), excluded: [] },
    extend: true,
  };
}

/**
 * Agrega al pozo el conjunto de ejemplo y sus tres gradientes (gas, petróleo, agua) con los tramos del diseño: así
 * se ven enseguida los contactos. El usuario puede mover los tramos, descartar puntos o borrarlos.
 */
export function addExample(project: Project, wellId: string, ids: { set: string; trends: Readonly<Record<Fluid, string>> }): Project {
  let p = addPointSet(project, wellId, examplePressureSet(ids.set));
  for (const r of EXAMPLE_GRADIENT_RANGES) {
    p = addTrend(p, wellId, gradientSpec(ids.trends[r.fluid], `Gradiente de ${FLUID_LABEL[r.fluid].toLowerCase()}`, ids.set, r.fluid, r));
  }
  return p;
}
