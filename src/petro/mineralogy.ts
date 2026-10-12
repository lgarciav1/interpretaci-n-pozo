/**
 * Mineralogía orientativa: GR espectral y ajuste multimineral con cierre exacto.
 * Método: mínimos cuadrados ponderados sobre el simplex. Se enumeran las 31 caras
 * de cinco componentes y se resuelve el sistema KKT de cada una. El mínimo factible
 * es global (problema convexo), sin recorte posterior que altere el cierre.
 * Referencias: Quirein, Gardner y Watson (1982), SPE 11143, fig. 2, ecs. 6–16;
 * Lawson y Hanson (1974), Solving Least Squares Problems, cap. 23 (restricciones).
 * Respuestas minerales: Schlumberger, Log Interpretation Charts, 2013,
 * Appendix B, pp. 279–280. Son respuestas de registro CNL en escala caliza,
 * no densidades físicas ni porosidades intrínsecas de minerales.
 * U fotoeléctrico = PE·ρe; no confundirlo con uranio en ppm.
 * Sin corrección de gas, lodo con barita o derrumbe: el residuo no es incertidumbre.
 */

export type ClayId = 'kaolinite' | 'chlorite' | 'illite' | 'smectite' | 'mica' | 'k-feldspar' | 'glauconite' | 'mixed-layer';
export interface ClayRegion { id: ClayId; label: string; vertices: [number, number][]; color: string }

/**
 * Schlumberger 2013, Lith-2 (antes CP-19), p. 194: sectores de Th/K y
 * regiones superpuestas. SIN VERIFICAR: vértices digitalizados aproximados,
 * recorte a K=6 wt%, Th=30 ppm y separación mica/glauconita/clorita.
 * No son fronteras mineralógicas exactas; se conservan candidatos superpuestos.
 */
function sector(id: ClayId, label: string, low: number, high: number, color: string): ClayRegion {
  const end = (s: number): [number, number] => s > 5 ? [30 / s, 30] : [6, 6 * s];
  const a = end(low); const b = end(high);
  const vertices: [number, number][] = [[0, 0], a];
  if (low < 5 && high > 5) vertices.push([6, 30]);
  vertices.push(b);
  return { id, label, vertices, color };
}
export const CLAY_REGIONS: readonly ClayRegion[] = [
  { id: 'chlorite', label: 'Clorita', color: '#14b8a6', vertices: [[0, 0], [0.55, 0], [0.55, 4], [0.25, 7], [0, 7]] },
  sector('kaolinite', 'Caolinita', 25, Infinity, '#eab308'),
  sector('smectite', 'Esmectita', 12, 25, '#a78bfa'),
  sector('mixed-layer', 'Capas mixtas', 3.5, 12, '#fb923c'),
  sector('illite', 'Illita', 2, 3.5, '#ef4444'),
  sector('mica', 'Micas', 0.6, 2, '#60a5fa'),
  { id: 'glauconite', label: 'Glauconita', color: '#22c55e', vertices: [[1, 0.8], [6, 4.8], [6, 10.8], [1, 1.8]] },
  sector('k-feldspar', 'Feldespato K', 0.3, 0.6, '#f472b6'),
];

function segmentDistance(x: number, y: number, a: [number, number], b: [number, number]): number {
  // Métrica adimensional: el eje K se normaliza a 6 wt%, Th a 30 ppm.
  const dx = (b[0] - a[0]) / 6, dy = (b[1] - a[1]) / 30;
  const ax = (x - a[0]) / 6, ay = (y - a[1]) / 30;
  const den = dx * dx + dy * dy;
  const t = den ? Math.max(0, Math.min(1, (ax * dx + ay * dy) / den)) : 0;
  return Math.hypot(ax - t * dx, ay - t * dy);
}
export function regionDistance(k: number, th: number, region: ClayRegion): number {
  let inside = false, distance = Infinity;
  const v = region.vertices;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const a = v[j]!, b = v[i]!;
    distance = Math.min(distance, segmentDistance(k, th, a, b));
    if ((a[1] > th) !== (b[1] > th) && k < (b[0] - a[0]) * (th - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside || distance < 1e-12 ? 0 : distance;
}
export interface ClayClassification { id: ClayId; label: string; index: number; distance: number; inside: boolean; candidates: string[]; ambiguous: boolean }
export function classifyClay(k: number, th: number): ClayClassification | null {
  if (!Number.isFinite(k) || !Number.isFinite(th) || k < 0 || th < 0 || (k === 0 && th === 0)) return null;
  const distances = CLAY_REGIONS.map(r => regionDistance(k, th, r));
  const distance = Math.min(...distances);
  const candidates = CLAY_REGIONS.filter((_, i) => Math.abs(distances[i]! - distance) < 1e-10).map(r => r.id);
  // Desempate reproducible: región de menor área (más específica), manteniendo
  // TODOS los candidatos; no transforma superposición en certeza geológica.
  const area = (r: ClayRegion): number => Math.abs(r.vertices.reduce((s, a, i) => {
    const b = r.vertices[(i + 1) % r.vertices.length]!;
    return s + a[0] * b[1] - b[0] * a[1];
  }, 0));
  const index = distances.map((d, i) => ({ d, i })).filter(v => Math.abs(v.d - distance) < 1e-10)
    .sort((a, b) => area(CLAY_REGIONS[a.i]!) - area(CLAY_REGIONS[b.i]!))[0]!.i;
  const region = CLAY_REGIONS[index]!;
  return { id: region.id, label: region.label, index: index + 1, distance, inside: distance === 0, candidates, ambiguous: candidates.length > 1 };
}

export function thoriumUranium(th: number, uranium: number): { ratio: number; environment: 'reducing' | 'transitional' | 'oxidizing' | 'unknown'; label: string } {
  if (!Number.isFinite(th) || !Number.isFinite(uranium) || th < 0 || uranium <= 0) return { ratio: NaN, environment: 'unknown', label: 'Sin cociente válido' };
  const ratio = th / uranium;
  // Adams y Weaver (1958), AAPG 42(2), pp. 387–430. SIN VERIFICAR: página
  // original de los límites 2 y 7; son los límites solicitados en el brief.
  return ratio < 2 ? { ratio, environment: 'reducing', label: 'Compatible con medio marino o reductor' }
    : ratio > 7 ? { ratio, environment: 'oxidizing', label: 'Compatible con medio continental u oxidante' }
      : { ratio, environment: 'transitional', label: 'Transicional' };
}
/** SIN VERIFICAR: 5 ppm es umbral operativo configurable, no diagnóstico de TOC/MFS. */
export function uraniumFlag(uranium: number, threshold = 5): number {
  return Number.isFinite(uranium) && uranium >= 0 && Number.isFinite(threshold) && threshold > 0 ? +(uranium > threshold) : NaN;
}

/** Calibración de densidad: Yu et al. (2020), Nuclear Science and Techniques 31:124, Numerical simulation and method study
 * of X-ray litho-density logging, Nuclear Science and Techniques, ec. (2).
 * https://www.nst.sinap.ac.cn/article/id/5292 */
export function electronDensity(rho: number): number { return (rho + 0.1883) / 1.0704; }
export interface Mineral { id: string; label: string; rho: number; pe: number; rhoE: number; nphi: number; gr: number; color: string }
function mineral(id: string, label: string, rho: number, pe: number, nphi: number, gr: number, color: string): Mineral {
  return { id, label, rho, pe, rhoE: electronDensity(rho), nphi, gr, color };
}
// Schlumberger 2013, Appendix B p. 279 (cuarzo, calcita, dolomita, siderita),
// p. 280 (resto). GR limpio=0: SIN VERIFICAR, hipótesis ajustable de fondo.
// GR de arcillas: punto medio del intervalo tabulado (elección de modelo).
export const MINERALS: readonly Mineral[] = [
  mineral('quartz', 'Cuarzo', 2.64, 1.8, -0.02, 0, '#eab308'),
  mineral('calcite', 'Calcita', 2.71, 5.1, 0, 0, '#38bdf8'),
  mineral('dolomite', 'Dolomita', 2.85, 3.1, 0.01, 0, '#a78bfa'),
  mineral('illite', 'Illita', 2.77, 2.33, 0.30, 275, '#8b5a2b'),
  mineral('kaolinite', 'Caolinita', 2.62, 1.48, 0.37, 105, '#facc15'),
  mineral('chlorite', 'Clorita', 2.76, 6.3, 0.52, 215, '#14b8a6'),
  mineral('smectite', 'Esmectita', 2.12, 2, 0.60, 175, '#d8b4fe'),
  mineral('anhydrite', 'Anhidrita', 2.98, 5.1, -0.02, 0, '#f97316'),
  mineral('gypsum', 'Yeso', 2.35, 4, 0.60, 0, '#f9a8d4'),
  mineral('halite', 'Halita', 2.04, 4.7, -0.03, 0, '#94a3b8'),
  mineral('barite', 'Barita', 4.09, 267, -0.02, 0, '#dc2626'),
  mineral('siderite', 'Siderita', 3.89, 15, 0.12, 0, '#b45309'),
  mineral('pyrite', 'Pirita', 4.99, 17, -0.03, 0, '#ca8a04'),
  mineral('coal', 'Carbón (antracita)', 1.47, 0.16, 0.38, 0, '#64748b'),
];

export type ToolWeights = { rho: number; u: number; nphi: number; gr: number };
export interface MineralOptions { weights?: ToolWeights; clay?: 'illite' | 'kaolinite' | 'chlorite' | 'smectite'; clayGr?: number; cleanGr?: number; fluidRho?: number; fluidPe?: number }
export type MineralVolumes = [number, number, number, number, number];
export interface MineralObservation { rho: number; pe: number; nphi: number; gr: number }
export interface MineralResult { volumes: MineralVolumes; residual: number; residuals: { rho: number; u: number; nphi: number; gr: number }; valid: boolean }
export const DEFAULT_WEIGHTS: ToolWeights = { rho: 1, u: 1, nphi: 1, gr: 1 };
// Escalas prácticas de normalización del residuo, no precisiones de fabricantes.
export const TOOL_SCALES = [0.1, 1, 0.05, 20] as const;

function endmembers(options: MineralOptions): Mineral[] {
  const clay = MINERALS.find(m => m.id === (options.clay ?? 'illite'))!;
  const clean = options.cleanGr ?? 0;
  // Agua dulce ρ=1: SLB 2013 Lith-3 p.196. NPHI=1, PE=.36:
  // SIN VERIFICAR página primaria; hipótesis de fluido fresco, sin gas, ajustable.
  const water = mineral('fluid', 'Fluido', options.fluidRho ?? 1, options.fluidPe ?? 0.36, 1, clean, '#2563eb');
  return [...MINERALS.slice(0, 3).map(m => ({ ...m, gr: clean })), { ...clay, gr: options.clayGr ?? clay.gr }, water];
}
function responses(m: Mineral): number[] { return [m.rho, m.pe * m.rhoE, m.nphi, m.gr]; }
export function forwardMinerals(volumes: MineralVolumes, options: MineralOptions = {}): MineralObservation {
  const members = endmembers(options);
  const y = [0, 0, 0, 0];
  for (let j = 0; j < 5; j++) for (let t = 0; t < 4; t++) y[t]! += volumes[j]! * responses(members[j]!)[t]!;
  return { rho: y[0]!, pe: y[1]! / electronDensity(y[0]!), nphi: y[2]!, gr: y[3]! };
}
export function mineralMixLine(m: Mineral, phiMax = 0.4): { x: number[]; y: number[] } {
  const x: number[] = [], y: number[] = [];
  const fluid = endmembers({})[4]!;
  for (let i = 0; i <= 32; i++) {
    const phi = phiMax * i / 32;
    const rho = m.rho * (1 - phi) + fluid.rho * phi;
    const u = m.pe * m.rhoE * (1 - phi) + fluid.pe * fluid.rhoE * phi;
    x.push(u / electronDensity(rho)); y.push(rho);
  }
  return { x, y };
}

/** Eliminación de Gauss con pivoteo parcial; null si el sistema pierde rango. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length, a = matrix.map((r, i) => [...r, rhs[i]!]);
  const scale = Math.max(...matrix.flat().map(Math.abs));
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i]![k]!) > Math.abs(a[pivot]![k]!)) pivot = i;
    if (Math.abs(a[pivot]![k]!) <= 1e-12 * Math.max(1, scale)) return null;
    [a[k], a[pivot]] = [a[pivot]!, a[k]!];
    const p = a[k]![k]!;
    for (let j = k; j <= n; j++) a[k]![j]! /= p;
    for (let i = 0; i < n; i++) if (i !== k) {
      const f = a[i]![k]!;
      for (let j = k; j <= n; j++) a[i]![j]! -= f * a[k]![j]!;
    }
  }
  return a.map(r => r[n]!);
}

/** Prepara las 31 caras una sola vez por conjunto de parámetros. Sin estado global. */
export function prepareMineralInversion(options: MineralOptions = {}): (observation: MineralObservation) => MineralResult {
  const invalid = (): MineralResult => ({ volumes: [NaN, NaN, NaN, NaN, NaN], residual: NaN, residuals: { rho: NaN, u: NaN, nphi: NaN, gr: NaN }, valid: false });
  const w = options.weights ?? DEFAULT_WEIGHTS;
  const weights = [w.rho, w.u, w.nphi, w.gr];
  if (!weights.every(v => Number.isFinite(v) && v > 0)) return invalid;
  const members = endmembers(options);
  if (!members.every(m => responses(m).every(Number.isFinite) && m.rho > 0 && m.pe >= 0 && m.gr >= 0)) return invalid;
  const raw = members.map(responses);
  const factors = weights.map((v,t) => Math.sqrt(v)/TOOL_SCALES[t]!);
  const a = raw.map(r => r.map((v, t) => v * factors[t]!));
  const rankMatrix = Array.from({ length: 5 }, (_, i) => members.map((_, j) => i === 4 ? 1 : a[j]![i]!));
  if (!solve(rankMatrix, [0, 0, 0, 0, 1])) return invalid;
  const faces: { active: number[]; offset: number[]; coefficients: number[][] }[] = [];
  for (let mask = 1; mask < 32; mask++) {
    const active = [0, 1, 2, 3, 4].filter(j => mask & (1 << j));
    const n = active.length;
    const matrix = Array.from({ length: n + 1 }, () => Array<number>(n + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const ri = a[active[i]!]!;
      for (let j = 0; j < n; j++) matrix[i]![j] = ri.reduce((s, v, t) => s + v * a[active[j]!]![t]!, 0);
      matrix[i]![n] = matrix[n]![i] = 1;
    }
    const offset = solve(matrix, [...Array<number>(n).fill(0), 1]);
    const coefficients = [0,1,2,3].map(t => solve(matrix, [...active.map(j => a[j]![t]!), 0]));
    if (offset && coefficients.every((c): c is number[] => c !== null)) faces.push({ active, offset, coefficients });
  }
  const totalWeight = weights.reduce((s,v) => s+v,0);
  return observation => {
    const y = [observation.rho, observation.pe * electronDensity(observation.rho), observation.nphi, observation.gr];
    // Cuatro herramientas más cierre: no publicar un resultado subdeterminado.
    if (!y.every(Number.isFinite) || observation.rho <= 0 || observation.pe < 0 || observation.gr < 0) return invalid();
    const b = y.map((v,t) => v*factors[t]!);
    let best: MineralVolumes | null = null, bestError = Infinity;
    for (const face of faces) {
      const { active, offset, coefficients } = face;
      const volumes: MineralVolumes = [0,0,0,0,0];
      let feasible = true;
      for (let i=0;i<active.length;i++) {
        let v=offset[i]!;
        for (let t=0;t<4;t++) v += coefficients[t]![i]! * b[t]!;
        if (v < -1e-9) { feasible = false; break; }
        volumes[active[i]!] = Math.max(0,v);
      }
      if (!feasible) continue;
      const sum = volumes.reduce((s,v)=>s+v,0);
      for(let j=0;j<5;j++) volumes[j]! /= sum;
      let error=0;
      for(let t=0;t<4;t++) {
        let value=0;
        for(let j=0;j<5;j++) value += volumes[j]!*a[j]![t]!;
        error += (value-b[t]!)**2;
      }
      if(error<bestError) { best=volumes;bestError=error; }
    }
    if(!best) return invalid();
    const r=y.map((v,t)=>best!.reduce((s,f,j)=>s+f*raw[j]![t]!,0)-v);
    return { volumes:best, residual:Math.sqrt(bestError/totalWeight),residuals:{rho:r[0]!,u:r[1]!,nphi:r[2]!,gr:r[3]!},valid:true };
  };
}

export function invertMinerals(observation: MineralObservation, options: MineralOptions = {}): MineralResult {
  return prepareMineralInversion(options)(observation);
}
