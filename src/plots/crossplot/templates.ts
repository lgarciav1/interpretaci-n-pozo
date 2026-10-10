/**
 * Plantillas del crossplot libre (docs/decisiones/0014, D7): ejes, escalas y LÍNEAS GUÍA calculadas en vivo con los
 * parámetros del proyecto. Puro y testeado contra valores conocidos. No dibuja: devuelve polilíneas en datos que el
 * panel pasa a `XYPlot` como capas `lines`.
 *
 * Cada línea sale de una función de sus parámetros (`densityNeutronLine(lith)`, `pickettLine(sw, archie)`, …): en la
 * fase 7b arrastrar un elemento cambia el parámetro y la vuelve a llamar (las inversas están en `drag.ts`; 0015).
 */
import type { CrossplotTemplateId } from '../../core/plots';

// ── densidad–neutrón ──────────────────────────────────────────────────────────────────────────────────────────

export interface Lithology {
  id: 'sandstone' | 'limestone' | 'dolomite';
  label: string;
  /** Densidad de matriz (g/cm³). */
  rhoMa: number;
  /** Porosidad neutrónica aparente de la matriz pura, en unidades de caliza (v/v). */
  phiNMa: number;
}

/**
 * Puntos de matriz para un neutrón calibrado en caliza (CNL) y agua dulce.
 * Fuente de los valores: tabla de minerales de Schlumberger (1989), Log Interpretation Principles/Applications
 * (cuarzo ρ ≈ 2,65 g/cm³ y φN ≈ −0,02; calcita 2,71 y 0; dolomita 2,87 y +0,01, unidades de caliza) y Asquith y
 * Krygowski (2004), Basic Well Log Analysis, 2.ª ed., cap. 4 (densidades de matriz).
 *
 * APROXIMACIÓN: las líneas de la carta CP-1 del fabricante son curvas (sobre todo la de dolomía, que se separa de la
 * de caliza al crecer la porosidad); acá son rectas de mezcla matriz–fluido. Sirven para ubicar la litología a simple
 * vista, no para leer porosidad con más precisión que ±0,02.
 */
export const DN_LITHOLOGIES: readonly Lithology[] = [
  { id: 'sandstone', label: 'Arenisca', rhoMa: 2.65, phiNMa: -0.02 },
  { id: 'limestone', label: 'Caliza', rhoMa: 2.71, phiNMa: 0 },
  { id: 'dolomite', label: 'Dolomía', rhoMa: 2.87, phiNMa: 0.01 },
];

/** Punto de fluido (agua dulce): ρf = 1,0 g/cm³ y φN = 1 (índice de hidrógeno 1). */
export const DN_FLUID = { rho: 1.0, phiN: 1.0 } as const;

export interface LithologyLine {
  lith: Lithology;
  /** Porosidades verdaderas de los puntos (v/v). */
  phi: number[];
  nphi: number[];
  rhob: number[];
}

/**
 * Recta de una litología entre su punto de matriz (φ = 0) y el de fluido, por mezcla lineal de volúmenes:
 * ρb = ρma·(1 − φ) + ρf·φ y φN = φNma·(1 − φ) + φNf·φ. Puntos cada `step` de porosidad hasta `phiMax`.
 */
export function densityNeutronLine(lith: Lithology, phiMax = 0.45, step = 0.05, fluid: { rho: number; phiN: number } = DN_FLUID): LithologyLine {
  const phi: number[] = [];
  const nphi: number[] = [];
  const rhob: number[] = [];
  for (let k = 0; k * step <= phiMax + 1e-9; k++) {
    const p = +(k * step).toFixed(6);
    phi.push(p);
    rhob.push(lith.rhoMa * (1 - p) + fluid.rho * p);
    nphi.push(lith.phiNMa * (1 - p) + fluid.phiN * p);
  }
  return { lith, phi, nphi, rhob };
}

// ── Pickett ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface ArchieParams {
  a: number;
  m: number;
  n: number;
  rw: number;
}

/** Rt de Archie para una porosidad y una Sw: Rt = a·Rw / (φ^m · Sw^n). */
export function archieRt(phi: number, sw: number, p: ArchieParams): number {
  return (p.a * p.rw) / (phi ** p.m * sw ** p.n);
}

/** Saturaciones de las líneas de Pickett (100 % es la recta de agua). */
export const PICKETT_SW: readonly number[] = [1, 0.5, 0.3, 0.2];

/**
 * Línea de Sw constante del gráfico de Pickett (log Rt en x, log φ en y): recta de pendiente −1/m en log–log.
 * Fuente: Pickett, G. R. (1966). A review of current techniques for determination of water saturation from logs.
 * JPT 18(11); Asquith y Krygowski (2004), cap. 6.
 */
export function pickettLine(sw: number, p: ArchieParams, phiRange: [number, number] = [0.01, 1]): { rt: number[]; phi: number[] } {
  const phi = [phiRange[0], phiRange[1]];
  return { phi, rt: phi.map((f) => archieRt(f, sw, p)) };
}

// ── φ–Sw (Buckles) ────────────────────────────────────────────────────────────────────────────────────────────

/** Valores de volumen de agua (BVW = φ·Sw) de las hipérbolas del gráfico φ–Sw. */
export const BVW_LINES: readonly number[] = [0.02, 0.04, 0.06, 0.08, 0.1];

/**
 * Hipérbola de BVW constante: Sw = BVW / φ, de φ = BVW (Sw = 1) a `phiMax`.
 * Fuente: Buckles, R. S. (1965). Correlating and averaging connate water saturation data. J. Can. Pet. Tech. 4(1);
 * Asquith y Krygowski (2004), cap. 6 (volumen de agua total constante en zonas a saturación irreducible).
 */
export function bvwLine(bvw: number, phiMax = 0.4, samples = 48): { phi: number[]; sw: number[] } {
  const phi: number[] = [];
  const sw: number[] = [];
  const lo = Math.min(bvw, phiMax);
  for (let k = 0; k <= samples; k++) {
    // Más puntos donde la curva dobla (φ chicas): reparto geométrico.
    const p = lo * (phiMax / lo) ** (k / samples);
    phi.push(p);
    sw.push(bvw / p);
  }
  return { phi, sw };
}

// ── definición de las plantillas ──────────────────────────────────────────────────────────────────────────────

export interface TemplateAxis {
  role: string;
  scale: 'linear' | 'log';
  reversed?: boolean;
  /** Rango fijo; ausente = automático. */
  range?: [number, number];
}

export interface CrossplotTemplate {
  id: CrossplotTemplateId;
  label: string;
  /** Una línea para el menú. */
  description: string;
  x: TemplateAxis;
  y: TemplateAxis;
  /** Rol para colorear (si el pozo lo tiene); si no, por zona. */
  colorRole?: string;
}

export const CROSSPLOT_TEMPLATE_DEFS: readonly CrossplotTemplate[] = [
  {
    id: 'density-neutron',
    label: 'Densidad–neutrón',
    description: 'RHOB contra NPHI con las líneas de arenisca, caliza y dolomía',
    x: { role: 'NPHI', scale: 'linear', range: [-0.05, 0.45] },
    y: { role: 'RHOB', scale: 'linear', reversed: true, range: [1.9, 2.9] },
    colorRole: 'GR',
  },
  {
    id: 'pickett',
    label: 'Pickett',
    description: 'Rt contra φ en log–log con las líneas de Sw de Archie (a, m, n y Rw del proyecto)',
    x: { role: 'RT', scale: 'log' },
    y: { role: 'PHIE', scale: 'log', range: [0.01, 1] },
    colorRole: 'VSH',
  },
  {
    id: 'phi-sw',
    label: 'φ–Sw (Buckles)',
    description: 'Sw contra φ con las hipérbolas de volumen de agua constante',
    x: { role: 'PHIE', scale: 'linear', range: [0, 0.4] },
    y: { role: 'SW', scale: 'linear', range: [0, 1] },
    colorRole: 'VSH',
  },
  {
    id: 'gr-rt',
    label: 'GR–Rt',
    description: 'Rt contra GR con las lecturas de arena limpia y de arcilla',
    x: { role: 'GR', scale: 'linear' },
    y: { role: 'RT', scale: 'log' },
  },
];

export const templateDef = (id: CrossplotTemplateId | null): CrossplotTemplate | undefined => CROSSPLOT_TEMPLATE_DEFS.find((t) => t.id === id);
