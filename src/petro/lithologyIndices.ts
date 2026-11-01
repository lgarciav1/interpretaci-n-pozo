/**
 * Índices de litología para los crossplots de determinación de litologías (Clase 8 de la cátedra; docs/decisiones/0059):
 * M y N (sónico–densidad y neutrón–densidad), U volumétrico, Umaa (matriz aparente) y el cociente Th/K. Además, las
 * líneas guía de las cartas: rectas de Wyllie para sónico–neutrón y densidad–sónico, puntos minerales de M–N, el
 * triángulo cuarzo–calcita–dolomita con su grilla de porcentajes en ρmaa–Umaa y las cajas de minerales de Lith-1
 * (PEF contra K y PEF contra Th/K).
 *
 * Puro (sin UI ni estado). Dominio explícito: toda entrada fuera de dominio devuelve NaN, nunca una excepción.
 *
 * Referencias:
 * - Burke, Campbell y Schmidt (1969), The litho-porosity cross plot, SPWLA 10th Symposium (M y N).
 * - Schlumberger (1989), Log Interpretation Principles/Applications, cap. 5 y 7 (M–N, ρmaa–Umaa, cartas CP-8 y CP-21).
 * - Schlumberger (2013), Log Interpretation Charts, Appendix B, pp. 279–280 (respuestas minerales: ρlog, φCNL, Δtc,
 *   Pe, U). Son las tablas de las slides 20–21 de la Clase 8.
 * - Wyllie, Gregory y Gardner (1956), Geophysics 21(1) (promedio en tiempo).
 */
import { MINERALS, electronDensity, type Mineral } from './mineralogy';

// ── parámetros por defecto (agua dulce) ───────────────────────────────────────────────────────────────────────

/** Δt del fluido (µs/ft): agua dulce, 189 µs/ft (Schlumberger 1989; el mismo default que `phi-sonic-wyllie`). */
export const DEFAULT_DT_FLUID = 189;
/** Densidad del fluido (g/cm³): agua dulce. */
export const DEFAULT_RHO_FLUID = 1.0;
/** Porosidad neutrónica del fluido (v/v): índice de hidrógeno 1 en agua dulce. */
export const DEFAULT_PHIN_FLUID = 1.0;
/** U volumétrico del agua dulce (b/cm³): Schlumberger (1989), tabla de U de fluidos (0,398). */
export const DEFAULT_U_FLUID = 0.398;

const finite = (...xs: number[]): boolean => xs.every(Number.isFinite);

// ── índices por muestra ───────────────────────────────────────────────────────────────────────────────────────

/**
 * M = 0,01·(Δtf − Δt)/(ρb − ρf). Independiente de la porosidad para una matriz dada (pendiente de la recta
 * matriz–fluido en densidad–sónico). NaN si alguna entrada no es finita, si Δt ≤ 0 o si ρb ≤ ρf (denominador nulo o
 * negativo: no hay mezcla matriz–fluido posible).
 */
export function mIndex(dt: number, rhob: number, dtFluid = DEFAULT_DT_FLUID, rhoFluid = DEFAULT_RHO_FLUID): number {
  if (!finite(dt, rhob, dtFluid, rhoFluid) || dt <= 0 || rhob - rhoFluid <= 0) return NaN;
  return (0.01 * (dtFluid - dt)) / (rhob - rhoFluid);
}

/**
 * N = (φNf − φN)/(ρb − ρf), con φN en unidades de caliza (v/v). Mismo dominio que M en la densidad; φN no finito → NaN.
 */
export function nIndex(nphi: number, rhob: number, phiNFluid = DEFAULT_PHIN_FLUID, rhoFluid = DEFAULT_RHO_FLUID): number {
  if (!finite(nphi, rhob, phiNFluid, rhoFluid) || rhob - rhoFluid <= 0) return NaN;
  return (phiNFluid - nphi) / (rhob - rhoFluid);
}

/**
 * U volumétrico (b/cm³): U = Pe·ρe, con la densidad electrónica ρe = (ρb + 0,1883)/1,0704 (la misma calibración que
 * usa la inversión mineral, `electronDensity`). NaN si Pe ≤ 0 o ρb ≤ 0.
 */
export function photoelectricU(pe: number, rhob: number): number {
  if (!finite(pe, rhob) || pe <= 0 || rhob <= 0) return NaN;
  return pe * electronDensity(rhob);
}

/**
 * Umaa = (U − φ·Uf)/(1 − φ): U de la matriz aparente, con φ la porosidad total de densidad–neutrón. NaN fuera de
 * dominio: U inválido (ver `photoelectricU`), φ < 0 o φ ≥ 1 (división por cero o porosidad no física).
 */
export function umaa(pe: number, rhob: number, phi: number, uFluid = DEFAULT_U_FLUID): number {
  const u = photoelectricU(pe, rhob);
  if (!finite(u, phi, uFluid) || phi < 0 || phi >= 1) return NaN;
  return (u - phi * uFluid) / (1 - phi);
}

/** ρmaa = (ρb − φ·ρf)/(1 − φ). Igual dominio que Umaa (es la misma fórmula que `apparentMatrixDensity`). */
export function rhomaa(rhob: number, phi: number, rhoFluid = DEFAULT_RHO_FLUID): number {
  if (!finite(rhob, phi, rhoFluid) || phi < 0 || phi >= 1) return NaN;
  return (rhob - phi * rhoFluid) / (1 - phi);
}

/** Cociente Th/K (ppm / %). NaN si K ≤ 0 (división por cero o potasio no físico) o si Th < 0. */
export function thkRatio(th: number, k: number): number {
  if (!finite(th, k) || k <= 0 || th < 0) return NaN;
  return th / k;
}

// ── matrices de referencia ────────────────────────────────────────────────────────────────────────────────────

export type MatrixId = 'quartz' | 'calcite' | 'dolomite' | 'anhydrite' | 'halite' | 'gypsum' | 'k-feldspar';

export interface LithologyMatrix {
  id: MatrixId;
  label: string;
  /** ρlog (g/cm³), de `MINERALS`. */
  rho: number;
  /** φCNL en unidades de caliza (v/v), de `MINERALS`. */
  phiN: number;
  /** Δtc (µs/ft), Appendix B. */
  dt: number;
  /** Pe (b/e), de `MINERALS`. */
  pe: number;
  /** U tabulado (b/cm³), Appendix B. */
  u: number;
}

/**
 * Δtc y U tabulados del Appendix B (Schlumberger 2013, pp. 279–280; slides 20–21). La densidad, el φCNL y el Pe salen de
 * `MINERALS` (mismas filas del Appendix B, ya usadas por la inversión mineral). Δt de cuarzo 56,0, calcita 49,0 y
 * dolomita 44,0 difieren de los defaults de Δtma del proyecto (55,5; 47,5; 43,5, `sharedParams.dtMa`): las cartas de
 * la cátedra usan los del Appendix B.
 */
const APPENDIX_B: Record<MatrixId, { dt: number; u: number }> = {
  quartz: { dt: 56.0, u: 4.8 },
  calcite: { dt: 49.0, u: 13.8 },
  dolomite: { dt: 44.0, u: 9.0 },
  anhydrite: { dt: 50, u: 15 },
  halite: { dt: 67.0, u: 9.5 },
  gypsum: { dt: 52, u: 9.4 },
  'k-feldspar': { dt: 69, u: 7.2 },
};

const LABELS: Record<MatrixId, string> = {
  quartz: 'Cuarzo',
  calcite: 'Calcita',
  dolomite: 'Dolomita',
  anhydrite: 'Anhidrita',
  halite: 'Sal',
  gypsum: 'Yeso',
  'k-feldspar': 'Feldespato K',
};

function matrixOf(id: MatrixId): LithologyMatrix {
  const m = MINERALS.find((x: Mineral) => x.id === id);
  if (!m) throw new Error(`Mineral sin datos: ${id}`);
  return { id, label: LABELS[id], rho: m.rho, phiN: m.nphi, pe: m.pe, ...APPENDIX_B[id] };
}

/** Matrices de las cartas (orden: las tres litologías principales primero). */
export const LITHOLOGY_MATRICES: readonly LithologyMatrix[] = (['quartz', 'calcite', 'dolomite', 'anhydrite', 'halite', 'gypsum', 'k-feldspar'] as const).map(matrixOf);
export const lithologyMatrix = (id: MatrixId): LithologyMatrix => LITHOLOGY_MATRICES.find((m) => m.id === id)!;
/** Las tres matrices de las rectas de porosidad (arenisca, caliza, dolomía). */
export const MAIN_MATRICES: readonly LithologyMatrix[] = LITHOLOGY_MATRICES.slice(0, 3);

export interface FluidPoint {
  dt: number;
  rho: number;
  phiN: number;
}
export const DEFAULT_FLUID: FluidPoint = { dt: DEFAULT_DT_FLUID, rho: DEFAULT_RHO_FLUID, phiN: DEFAULT_PHIN_FLUID };

// ── rectas de porosidad (sónico–neutrón, densidad–sónico) ─────────────────────────────────────────────────────

export interface PorosityLine {
  matrix: LithologyMatrix;
  phi: number[];
  dt: number[];
  nphi: number[];
  rhob: number[];
}

/**
 * Recta de una matriz entre φ = 0 y `phiMax` (paso `step`): Wyllie Δt = Δtma + φ·(Δtf − Δtma); neutrón
 * φN = φNma·(1 − φ) + φNf·φ (= φ + φNma·(1 − φ) con agua dulce: la misma mezcla que la plantilla densidad–neutrón);
 * densidad ρb = ρma·(1 − φ) + ρf·φ. Las tres son lineales en φ: rectas en sónico–neutrón y en densidad–sónico.
 *
 * APROXIMACIÓN: Wyllie no corrige compactación ni el «Raymer–Hunt»; las cartas de fabricante (CP-2, CP-7) traen
 * además la curva empírica, que se separa de la recta por encima de ~25 % de porosidad.
 */
export function porosityLine(matrix: LithologyMatrix, phiMax = 0.45, step = 0.05, fluid: FluidPoint = DEFAULT_FLUID): PorosityLine {
  const out: PorosityLine = { matrix, phi: [], dt: [], nphi: [], rhob: [] };
  for (let k = 0; k * step <= phiMax + 1e-9; k++) {
    const p = +(k * step).toFixed(6);
    out.phi.push(p);
    out.dt.push(matrix.dt + p * (fluid.dt - matrix.dt));
    out.nphi.push(matrix.phiN * (1 - p) + fluid.phiN * p);
    out.rhob.push(matrix.rho * (1 - p) + fluid.rho * p);
  }
  return out;
}

// ── M–N ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Punto (N, M) de una matriz con el fluido dado. */
export function mnPoint(matrix: LithologyMatrix, fluid: FluidPoint = DEFAULT_FLUID): { n: number; m: number } {
  return { n: nIndex(matrix.phiN, matrix.rho, fluid.phiN, fluid.rho), m: mIndex(matrix.dt, matrix.rho, fluid.dt, fluid.rho) };
}

// ── ρmaa–Umaa (carta CP-21 / Lith-?) ──────────────────────────────────────────────────────────────────────────

export interface UmaaVertex {
  id: 'quartz' | 'calcite' | 'dolomite';
  label: string;
  u: number;
  rho: number;
}

/**
 * Vértices del triángulo de la carta ρmaa–Umaa de la cátedra (slide 27; hoja CROSSPLOT del Excel, columnas D:I):
 * cuarzo (4,8; 2,65), calcita (13,8; 2,71) y dolomita (9,0; 2,87). La carta usa ρma 2,65 y 2,87 (como la plantilla
 * densidad–neutrón), no los ρlog 2,64 y 2,85 del Appendix B; los U son los tabulados del Appendix B.
 */
export const UMAA_TRIANGLE: readonly UmaaVertex[] = [
  { id: 'quartz', label: 'Cuarzo', u: 4.8, rho: 2.65 },
  { id: 'calcite', label: 'Calcita', u: 13.8, rho: 2.71 },
  { id: 'dolomite', label: 'Dolomita', u: 9.0, rho: 2.87 },
];

/** Punto de una mezcla de matrices (fracciones de cuarzo, calcita, dolomita; suman 1). ρmaa y Umaa se mezclan por volumen. */
export function ternaryPoint(q: number, c: number, d: number): { u: number; rho: number } {
  const [Q, C, D] = UMAA_TRIANGLE as [UmaaVertex, UmaaVertex, UmaaVertex];
  return { u: q * Q.u + c * C.u + d * D.u, rho: q * Q.rho + c * C.rho + d * D.rho };
}

export interface GridLine {
  /** Componente constante a lo largo de la línea. */
  component: 'quartz' | 'calcite' | 'dolomite';
  fraction: number;
  u: [number, number];
  rho: [number, number];
}

/** Grilla de porcentajes del triángulo: para cada componente, líneas de fracción constante cada `step` (sin los bordes). */
export function ternaryGrid(step = 0.2): GridLine[] {
  const lines: GridLine[] = [];
  const n = Math.round(1 / step);
  for (let k = 1; k < n; k++) {
    const f = +(k * step).toFixed(6);
    const r = 1 - f;
    const add = (component: GridLine['component'], a: { u: number; rho: number }, b: { u: number; rho: number }) =>
      lines.push({ component, fraction: f, u: [a.u, b.u], rho: [a.rho, b.rho] });
    add('quartz', ternaryPoint(f, r, 0), ternaryPoint(f, 0, r));
    add('calcite', ternaryPoint(r, f, 0), ternaryPoint(0, f, r));
    add('dolomite', ternaryPoint(r, 0, f), ternaryPoint(0, r, f));
  }
  return lines;
}

/**
 * Otros puntos de la carta ρmaa–Umaa, LEÍDOS DE LA CARTA (slide 27), orientativos: las arcillas están en su posición
 * aparente (agua ligada incluida en la porosidad de densidad–neutrón), no en los ρlog/U del Appendix B.
 */
export const UMAA_CHART_POINTS: readonly { id: string; label: string; u: number; rho: number }[] = [
  { id: 'k-feldspar', label: 'Feldespato K', u: 7.6, rho: 2.62 },
  { id: 'kaolinite', label: 'Caolinita', u: 6.25, rho: 3.025 },
  { id: 'illite', label: 'Illita', u: 11.7, rho: 3.065 },
  { id: 'anhydrite', label: 'Anhidrita', u: 14.95, rho: 2.985 },
];

/** Rango de la carta ρmaa–Umaa de la cátedra. */
export const UMAA_CHART_RANGE = { u: [2, 17] as [number, number], rho: [2.2, 3.1] as [number, number] };

// ── cajas de minerales de Lith-1 (PEF contra K y contra Th/K) ─────────────────────────────────────────────────

export interface MineralBox {
  id: string;
  label: string;
  /** Rango de Pe (b/e). */
  pe: [number, number];
  /** Rango de K (%) en PEF contra K; ausente si la carta no lo trae (capas mixtas). */
  k?: [number, number];
  /** Rango de Th/K en PEF contra Th/K; ausente si la carta no lo trae. */
  thk?: [number, number];
}

/**
 * Cajas de Lith-1 (ex CP-18). Pe y Th/K: polígonos de la hoja CROSSPLOT de la cátedra (columnas X:Z). K: LEÍDO de la
 * carta de la slide 28. Límites orientativos SIN VERIFICAR contra la carta original del fabricante.
 */
export const LITH1_BOXES: readonly MineralBox[] = [
  { id: 'glauconite', label: 'Glauconita', pe: [5.5, 7.5], k: [3.2, 5.8], thk: [0.8, 1.4] },
  { id: 'biotite', label: 'Biotita', pe: [6.1, 6.3], k: [6.2, 10], thk: [1.9, 3.1] },
  { id: 'chlorite', label: 'Clorita', pe: [6.15, 6.3], k: [0, 0.3], thk: [10, 30] },
  { id: 'illite', label: 'Illita', pe: [3.45, 3.75], k: [3.6, 8.4], thk: [2.3, 5] },
  { id: 'mixed-layer', label: 'Capas mixtas', pe: [2, 3.95], thk: [4.5, 9.5] },
  { id: 'montmorillonite', label: 'Montmorillonita', pe: [2, 2.2], k: [0, 4.9], thk: [4.5, 9.5] },
  { id: 'kaolinite', label: 'Caolinita', pe: [1.8, 1.9], k: [0, 0.6], thk: [10, 30] },
  { id: 'muscovite', label: 'Muscovita', pe: [2.2, 2.4], k: [7.9, 9.9], thk: [1.8, 3.1] },
];

/** Vértices cerrados (el último repite el primero, como el Excel) de la caja en (x, Pe). */
export function boxVertices(x: [number, number], pe: [number, number]): [number, number][] {
  return [[x[0], pe[1]], [x[0], pe[0]], [x[1], pe[0]], [x[1], pe[1]], [x[0], pe[1]]];
}
