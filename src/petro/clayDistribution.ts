/**
 * Distribución de la arcilla: diagrama de Thomas y Stieber (1975) (docs/decisiones/0061; Clase 8, slides 12–14).
 *
 * Ejes: x = Vsh (v/v, 0–1), y = porosidad total φ (v/v). Dos extremos: la arena limpia (x = 0, φsand) y la lutita
 * (x = 1, φsh). Todas las rectas son lineales en x:
 *
 *   laminada                         φ = (1 − x)·φsand + x·φsh                 0 ≤ x ≤ 1
 *   dispersa, relleno de poros       φ = φsand − x·(1 − φsh)                  0 ≤ x ≤ φsand
 *   dispersa, reemplazo de granos    φ = x·φsh                                φsand ≤ x ≤ 1
 *   estructural, reemplazo de granos φ = φsand + x·φsh                        0 ≤ x ≤ 1 − φsand
 *   estructural, relleno de poros    φ = 1 − x·(1 − φsh)                      1 − φsand ≤ x ≤ 1
 *
 * Región A (debajo de la laminada) = mezclas con arcilla dispersa; región B (encima) = arcilla estructural.
 *
 * Funciones PURAS. Dominio: 0 < φsh < φsand < 1; fuera de dominio devuelven NaN (o null / «sin clasificar»), nunca
 * una excepción.
 */

/** Tolerancia por defecto de la banda laminar: ±0,02 v/v de porosidad alrededor de la diagonal. */
export const DEFAULT_BAND_TOLERANCE = 0.02;
/** Vsh por debajo del cual la muestra es arena limpia y por encima de 1 − este valor, lutita (sin clasificar). */
export const DEFAULT_CLEAN_VSH = 0.1;
/** Mínimo de muestras para estimar cada extremo. */
export const MIN_ENDPOINT_SAMPLES = 10;

/** Extremos del diagrama válidos: 0 < φsh < φsand < 1. */
export function validEndpoints(phiSand: number, phiShale: number): boolean {
  return Number.isFinite(phiSand) && Number.isFinite(phiShale) && phiShale > 0 && phiShale < phiSand && phiSand < 1;
}

const inX = (x: number, lo: number, hi: number) => Number.isFinite(x) && x >= lo - 1e-12 && x <= hi + 1e-12;

/** Arena laminada (diagonal), de (0, φsand) a (1, φsh). */
export function laminatedPhi(x: number, phiSand: number, phiShale: number): number {
  if (!validEndpoints(phiSand, phiShale) || !inX(x, 0, 1)) return NaN;
  return (1 - x) * phiSand + x * phiShale;
}

/** Arcilla dispersa que rellena los poros, de (0, φsand) al vértice inferior (φsand, φsand·φsh). */
export function dispersedPoreFillingPhi(x: number, phiSand: number, phiShale: number): number {
  if (!validEndpoints(phiSand, phiShale) || !inX(x, 0, phiSand)) return NaN;
  return phiSand - x * (1 - phiShale);
}

/** Arcilla dispersa que reemplaza granos, del vértice inferior a (1, φsh). */
export function dispersedGrainReplacingPhi(x: number, phiSand: number, phiShale: number): number {
  if (!validEndpoints(phiSand, phiShale) || !inX(x, phiSand, 1)) return NaN;
  return x * phiShale;
}

/** Arcilla estructural que reemplaza granos, de (0, φsand) al vértice superior (1 − φsand, φsand + (1 − φsand)·φsh). */
export function structuralGrainReplacingPhi(x: number, phiSand: number, phiShale: number): number {
  if (!validEndpoints(phiSand, phiShale) || !inX(x, 0, 1 - phiSand)) return NaN;
  return phiSand + x * phiShale;
}

/** Arcilla estructural que rellena poros, del vértice superior a (1, φsh). */
export function structuralPoreFillingPhi(x: number, phiSand: number, phiShale: number): number {
  if (!validEndpoints(phiSand, phiShale) || !inX(x, 1 - phiSand, 1)) return NaN;
  return 1 - x * (1 - phiShale);
}

export interface DiagramPoint {
  x: number;
  y: number;
}

/** Vértice inferior (fin de la dispersa por relleno de poros): (φsand, φsand·φsh). null fuera de dominio. */
export function dispersedVertex(phiSand: number, phiShale: number): DiagramPoint | null {
  return validEndpoints(phiSand, phiShale) ? { x: phiSand, y: phiSand * phiShale } : null;
}

/** Vértice superior (fin de la estructural por reemplazo de granos): (1 − φsand, φsand + (1 − φsand)·φsh). */
export function structuralVertex(phiSand: number, phiShale: number): DiagramPoint | null {
  return validEndpoints(phiSand, phiShale) ? { x: 1 - phiSand, y: phiSand + (1 - phiSand) * phiShale } : null;
}

/** Borde inferior del diagrama (región A) en x: la dispersa por relleno de poros y luego por reemplazo de granos. */
export function lowerBoundPhi(x: number, phiSand: number, phiShale: number): number {
  if (!validEndpoints(phiSand, phiShale) || !inX(x, 0, 1)) return NaN;
  return x <= phiSand ? phiSand - x * (1 - phiShale) : x * phiShale;
}

/** Borde superior del diagrama (región B) en x: la estructural por reemplazo de granos y luego por relleno de poros. */
export function upperBoundPhi(x: number, phiSand: number, phiShale: number): number {
  if (!validEndpoints(phiSand, phiShale) || !inX(x, 0, 1)) return NaN;
  return x <= 1 - phiSand ? phiSand + x * phiShale : 1 - x * (1 - phiShale);
}

/** Las cinco rectas como polilíneas (para dibujar), y los dos polígonos de las regiones A y B. */
export interface ThomasStieberGeometry {
  laminated: { x: number[]; y: number[] };
  dispersedPoreFilling: { x: number[]; y: number[] };
  dispersedGrainReplacing: { x: number[]; y: number[] };
  structuralGrainReplacing: { x: number[]; y: number[] };
  structuralPoreFilling: { x: number[]; y: number[] };
  /** Región A: arena limpia → vértice inferior → lutita (debajo de la diagonal). */
  regionA: [number, number][];
  /** Región B: arena limpia → vértice superior → lutita (encima de la diagonal). */
  regionB: [number, number][];
  sand: DiagramPoint;
  shale: DiagramPoint;
  lowerVertex: DiagramPoint;
  upperVertex: DiagramPoint;
}

export function thomasStieberGeometry(phiSand: number, phiShale: number): ThomasStieberGeometry | null {
  const lo = dispersedVertex(phiSand, phiShale);
  const up = structuralVertex(phiSand, phiShale);
  if (!lo || !up) return null;
  const sand = { x: 0, y: phiSand };
  const shale = { x: 1, y: phiShale };
  const seg = (a: DiagramPoint, b: DiagramPoint) => ({ x: [a.x, b.x], y: [a.y, b.y] });
  return {
    laminated: seg(sand, shale),
    dispersedPoreFilling: seg(sand, lo),
    dispersedGrainReplacing: seg(lo, shale),
    structuralGrainReplacing: seg(sand, up),
    structuralPoreFilling: seg(up, shale),
    regionA: [[sand.x, sand.y], [lo.x, lo.y], [shale.x, shale.y]],
    regionB: [[sand.x, sand.y], [up.x, up.y], [shale.x, shale.y]],
    sand,
    shale,
    lowerVertex: lo,
    upperVertex: up,
  };
}

// ── clasificación ─────────────────────────────────────────────────────────────────────────────────────────────

export type ClayDistribution = 'laminated' | 'dispersed' | 'structural' | 'unclassified';
/** Por qué una muestra queda sin clasificar. */
export type UnclassifiedReason = 'no-data' | 'invalid-endpoints' | 'clean-sand' | 'shale' | 'outside';

export interface ClayClassification {
  kind: ClayDistribution;
  reason?: UnclassifiedReason;
}

/** Código de la curva de distribución: 0 sin clasificar, 1 laminar, 2 dispersa, 3 estructural (NaN sin dato). */
export const CLAY_DISTRIBUTION_CODE: Readonly<Record<ClayDistribution, number>> = { unclassified: 0, laminated: 1, dispersed: 2, structural: 3 };

export const CLAY_DISTRIBUTION_LABEL: Readonly<Record<ClayDistribution, string>> = {
  laminated: 'Laminar',
  dispersed: 'Dispersa',
  structural: 'Estructural',
  unclassified: 'Sin clasificar',
};

export interface ClassifyOptions {
  /** Vsh de arena limpia (por debajo, sin clasificar) y de lutita (por encima de 1 − cleanVsh). */
  cleanVsh?: number;
}

/**
 * Distribución de la arcilla de una muestra según su posición en el diagrama:
 * - sin dato (Vsh o φ no finitos) o extremos inválidos → sin clasificar;
 * - Vsh < cleanVsh (arena limpia) o Vsh > 1 − cleanVsh (lutita: todas las rectas convergen) → sin clasificar;
 * - |φ − φlaminada| ≤ tolerancia → laminar (banda laminar);
 * - debajo de la banda y no más de `tolerance` debajo del borde inferior → dispersa (región A);
 * - encima de la banda y no más de `tolerance` encima del borde superior → estructural (región B);
 * - el resto (fuera del diagrama, o Vsh fuera de [0, 1]) → sin clasificar.
 */
export function classifyClayDistribution(vsh: number, phi: number, phiSand: number, phiShale: number, tolerance = DEFAULT_BAND_TOLERANCE, opts: ClassifyOptions = {}): ClayClassification {
  if (!Number.isFinite(vsh) || !Number.isFinite(phi)) return { kind: 'unclassified', reason: 'no-data' };
  if (!validEndpoints(phiSand, phiShale)) return { kind: 'unclassified', reason: 'invalid-endpoints' };
  const tol = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : DEFAULT_BAND_TOLERANCE;
  const clean = opts.cleanVsh ?? DEFAULT_CLEAN_VSH;
  if (vsh < 0 || vsh > 1) return { kind: 'unclassified', reason: 'outside' };
  if (vsh < clean) return { kind: 'unclassified', reason: 'clean-sand' };
  if (vsh > 1 - clean) return { kind: 'unclassified', reason: 'shale' };
  const d = phi - laminatedPhi(vsh, phiSand, phiShale);
  if (Math.abs(d) <= tol) return { kind: 'laminated' };
  if (d < 0) return phi >= lowerBoundPhi(vsh, phiSand, phiShale) - tol ? { kind: 'dispersed' } : { kind: 'unclassified', reason: 'outside' };
  return phi <= upperBoundPhi(vsh, phiSand, phiShale) + tol ? { kind: 'structural' } : { kind: 'unclassified', reason: 'outside' };
}

/** Conteo de una nube de muestras por distribución. */
export interface ClayDistributionCounts {
  laminated: number;
  dispersed: number;
  structural: number;
  unclassified: number;
  /** Muestras con dato (Vsh y φ finitos). */
  total: number;
}

export function countClayDistribution(vsh: ArrayLike<number>, phi: ArrayLike<number>, phiSand: number, phiShale: number, tolerance = DEFAULT_BAND_TOLERANCE, opts: ClassifyOptions = {}): ClayDistributionCounts {
  const c: ClayDistributionCounts = { laminated: 0, dispersed: 0, structural: 0, unclassified: 0, total: 0 };
  const n = Math.min(vsh.length, phi.length);
  for (let i = 0; i < n; i++) {
    const r = classifyClayDistribution(vsh[i]!, phi[i]!, phiSand, phiShale, tolerance, opts);
    if (r.reason === 'no-data') continue;
    c.total++;
    c[r.kind]++;
  }
  return c;
}

/**
 * Resumen de una línea para el gráfico: qué porcentaje de las muestras CLASIFICADAS cae debajo de la diagonal
 * (dispersa), sobre ella (laminar) o encima (estructural), y cuál predomina. null si no hay muestras clasificadas.
 */
export function clayDistributionSummary(c: ClayDistributionCounts): { dominant: Exclude<ClayDistribution, 'unclassified'>; pct: Record<'laminated' | 'dispersed' | 'structural', number>; classified: number; text: string } | null {
  const classified = c.laminated + c.dispersed + c.structural;
  if (classified === 0) return null;
  const pct = { laminated: (100 * c.laminated) / classified, dispersed: (100 * c.dispersed) / classified, structural: (100 * c.structural) / classified };
  const dominant = (['dispersed', 'laminated', 'structural'] as const).reduce((a, b) => (pct[b] > pct[a] ? b : a));
  const where = { dispersed: 'bajo la diagonal', laminated: 'sobre la diagonal (banda laminar)', structural: 'encima de la diagonal' }[dominant];
  const what = { dispersed: 'arcilla dispersa', laminated: 'arcilla laminar', structural: 'arcilla estructural' }[dominant];
  const r = Math.round(pct[dominant]);
  return { dominant, pct, classified, text: `${r} % ${where}: predomina ${what}` };
}

// ── estimación de los extremos ────────────────────────────────────────────────────────────────────────────────

/** Percentil con interpolación lineal entre muestras ordenadas (tipo 7 de Hyndman y Fan). */
function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

export interface EndpointEstimateOptions {
  /** Vsh máximo de la arena limpia (por defecto 0,1). */
  sandVshMax?: number;
  /** Vsh mínimo de la lutita (por defecto 0,9). */
  shaleVshMin?: number;
  /** Percentil de PHIT de la arena limpia (por defecto 0,95). */
  sandPercentile?: number;
  /** Mínimo de muestras de cada extremo (por defecto 10). */
  minSamples?: number;
}

export interface EndpointEstimate {
  /** φ de la arena limpia: percentil 95 de PHIT con Vsh ≤ 0,1; null si no hay muestras suficientes. */
  phiSand: number | null;
  /** φ de la lutita: mediana de PHIT con Vsh ≥ 0,9; null si no hay muestras suficientes. */
  phiShale: number | null;
  nSand: number;
  nShale: number;
  /** Por qué no se puede proponer el par (en español), o null si los dos extremos son válidos. */
  problem: string | null;
}

/**
 * Propone φsand y φsh de los datos: φsand = percentil 95 de PHIT de las muestras con Vsh ≤ 0,1 (las arenas más
 * limpias y porosas: la porosidad «original» antes de la arcilla) y φsh = mediana de PHIT de las muestras con
 * Vsh ≥ 0,9. Con menos de `minSamples` de un extremo, ese extremo es null y `problem` dice por qué.
 */
export function estimateClayEndpoints(vsh: ArrayLike<number>, phit: ArrayLike<number>, opts: EndpointEstimateOptions = {}): EndpointEstimate {
  const sandMax = opts.sandVshMax ?? 0.1;
  const shaleMin = opts.shaleVshMin ?? 0.9;
  const p = opts.sandPercentile ?? 0.95;
  const min = opts.minSamples ?? MIN_ENDPOINT_SAMPLES;
  const sand: number[] = [];
  const shale: number[] = [];
  const n = Math.min(vsh.length, phit.length);
  for (let i = 0; i < n; i++) {
    const v = vsh[i]!;
    const f = phit[i]!;
    if (!Number.isFinite(v) || !Number.isFinite(f) || f < 0 || f >= 1) continue;
    if (v <= sandMax) sand.push(f);
    else if (v >= shaleMin) shale.push(f);
  }
  sand.sort((a, b) => a - b);
  shale.sort((a, b) => a - b);
  const phiSand = sand.length >= min ? quantile(sand, p) : null;
  const phiShale = shale.length >= min ? quantile(shale, 0.5) : null;
  const fmt = (v: number) => v.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const problems: string[] = [];
  if (phiSand === null) problems.push(`hay ${sand.length} muestras de arena limpia (Vsh ≤ ${fmt(sandMax)}) y hacen falta ${min}`);
  if (phiShale === null) problems.push(`hay ${shale.length} muestras de lutita (Vsh ≥ ${fmt(shaleMin)}) y hacen falta ${min}`);
  if (phiSand !== null && phiShale !== null && !validEndpoints(phiSand, phiShale)) problems.push(`la φ de la lutita (${fmt(phiShale)}) no queda por debajo de la de la arena (${fmt(phiSand)})`);
  const problem = problems.length ? `${problems.join('; ')}.`.replace(/^./, (s) => s.toUpperCase()) : null;
  return { phiSand, phiShale, nSand: sand.length, nShale: shale.length, problem };
}
