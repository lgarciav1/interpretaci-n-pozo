/**
 * Plantillas del crossplot libre (docs/decisiones/0014, D7): ejes, escalas y LÍNEAS GUÍA calculadas en vivo con los
 * parámetros del proyecto. Puro y testeado contra valores conocidos. No dibuja: devuelve polilíneas en datos que el
 * panel pasa a `XYPlot` como capas `lines`.
 *
 * Cada línea sale de una función de sus parámetros (`densityNeutronLine(lith)`, `pickettLine(sw, archie)`, …): en la
 * fase 7b arrastrar un elemento cambia el parámetro y la vuelve a llamar (las inversas están en `drag.ts`; 0015).
 */
import type { CrossplotTemplateId } from '../../core/plots';
import { CLAY_REGIONS, MINERALS, mineralMixLine } from '../../petro/mineralogy';
import type { XYLineLayer, XYPointLayer, XYPolygonLayer } from '../xy/layers';

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

// ── RMN vs. densidad–neutrón ──────────────────────────────────────────────────────────────────────────────────

/** Rango de porosidad de la plantilla RMN vs. densidad–neutrón (v/v, los dos ejes). */
export const NMR_DN_RANGE: readonly [number, number] = [0, 0.4];

/**
 * Recta 1:1 (PHIE_NMR = PHIE) y recta del umbral del déficit de RMN (PHIE_NMR = PHIE − tol), en todo el rango.
 * La RMN no depende de la matriz: con la matriz bien elegida y sin hidrocarburos livianos los puntos caen sobre la
 * 1:1; por debajo de la del umbral el módulo `nmr-fluids` marca IND_NMR_DEFICIT (desigualdad estricta, 0019).
 */
export function nmrDnLines(tol: number, range: readonly [number, number] = NMR_DN_RANGE): { oneToOne: { x: number[]; y: number[] }; deficit: { x: number[]; y: number[] } } {
  const [lo, hi] = range;
  const t = Math.max(0, tol);
  return {
    oneToOne: { x: [lo, hi], y: [lo, hi] },
    // Desde donde PHIE − tol = lo (corta el borde inferior) hasta el borde derecho.
    deficit: { x: [lo + t, hi], y: [lo, hi - t] },
  };
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
  {
    id: 'nmr-dn',
    label: 'RMN vs. densidad–neutrón',
    description: 'PHIE de RMN contra PHIE de densidad–neutrón con la recta 1:1 y el umbral de déficit',
    x: { role: 'PHIE', scale: 'linear', range: [NMR_DN_RANGE[0], NMR_DN_RANGE[1]] },
    y: { role: 'PHIE_NMR', scale: 'linear', range: [NMR_DN_RANGE[0], NMR_DN_RANGE[1]] },
    colorRole: 'SWIRR_NMR',
  },
  {
    id: 'th-k',
    label: 'Torio–potasio',
    description: 'Minerales arcillosos orientativos y cocientes Th/K',
    x: { role: 'POTA', scale: 'linear', range: [0, 6] },
    y: { role: 'THOR', scale: 'linear', range: [0, 30] },
  },
  {
    id: 'pe-density',
    label: 'PE–densidad',
    description: 'Puntos minerales y mezcla matriz–agua dulce',
    x: { role: 'PEF', scale: 'linear', range: [0, 8] },
    y: { role: 'RHOB', scale: 'linear', range: [1.3, 3.2] },
  },
];

export const templateDef = (id: CrossplotTemplateId | null): CrossplotTemplate | undefined => CROSSPLOT_TEMPLATE_DEFS.find((t) => t.id === id);


/** Capas reutilizables por los módulos Geo-2/Geo-3 y el crossplot libre. */
export function mineralogyTemplateLayers(
  id: 'th-k' | 'pe-density',
  contrast: (color: string) => string = (color) => color,
): { polygons: XYPolygonLayer[]; lines: XYLineLayer[]; points: XYPointLayer[]; info: string } {
  if (id === 'th-k') {
    // Cocientes de referencia geométrica, elegidos para lectura visual; no son umbrales de clasificación.
    const ratios = [1, 2, 4, 8];
    // Posiciones de rótulos para lectura: no alteran los campos ni la clasificación.
    const labels: Record<string, [number, number]> = { kaolinite: [0.55, 27], smectite: [1.65, 25], 'mixed-layer': [4.4, 22], illite: [4.3, 11], chlorite: [0.42, 5.5], mica: [4.8, 4.6], glauconite: [2.9, 6.1], 'k-feldspar': [4.8, 1.5] };
    return {
      polygons: CLAY_REGIONS.map((region) => ({
        id: `clay-${region.id}`, name: region.label, vertices: region.vertices,
        color: contrast(region.color), fillAlpha: 0.09, label: region.label, labelPosition: labels[region.id],
      })),
      lines: ratios.map((ratio) => ({
        id: `th-k-${ratio}`, x: [0, Math.min(6, 30 / ratio)], y: [0, Math.min(30, 6 * ratio)],
        color: contrast('#78828f'), dash: [4, 4], width: 1, label: `Th/K ${ratio}`, labelAt: 'end',
      })),
      points: [],
      info: 'Regiones orientativas aproximadas de CP-19: límites SIN VERIFICAR y superpuestos. La clasificación es una hipótesis mineralógica; confirmar con corona o difracción de rayos X.',
    };
  }
  const lines: XYLineLayer[] = [];
  const points: XYPointLayer[] = [];
  for (const mineral of MINERALS) {
    const color = contrast(mineral.color);
    points.push({ id: `mineral-${mineral.id}`, name: mineral.label, x: [mineral.pe], y: [mineral.rho], color, radius: 4.5, interactive: true, label: () => `${mineral.label} · PE ${mineral.pe} b/e · densidad ${mineral.rho} g/cm³` });
    if (['quartz', 'calcite', 'dolomite'].includes(mineral.id)) {
      const mix = mineralMixLine(mineral);
      lines.push({ id: `mix-${mineral.id}`, ...mix, color, width: 1.5, label: mineral.label, labelAt: 'start' });
      // Cinco marcas desde matriz pura hasta 40 %: pasos de 0,1 v/v sobre el muestreo del motor.
      const ticks = [0, 1, 2, 3, 4].map((step) => Math.round((mix.x.length - 1) * step / 4));
      points.push({ id: `mix-ticks-${mineral.id}`, x: ticks.map((index) => mix.x[index]!), y: ticks.map((index) => mix.y[index]!), color, radius: 2.5 });
    }
  }
  return {
    polygons: [], lines, points,
    info: 'Mezclas matriz–agua dulce hasta 40 % de porosidad; marcas cada 10 %. El PE se mezcla mediante absorción volumétrica y densidad electrónica. Barita y pirita pueden quedar fuera del rango inicial; usá «Ver todos los minerales». Arcillas y carbón son referencias variables.',
  };
}

/** Rango ampliado para minerales pesados: se deriva de la tabla y no agrega constantes petrofísicas. */
export function mineralogyFullRange(): { xRange: [number, number]; yRange: [number, number] } {
  return { xRange: [0, Math.ceil(Math.max(...MINERALS.map((mineral) => mineral.pe)) * 1.05)], yRange: [1, Math.ceil(Math.max(...MINERALS.map((mineral) => mineral.rho)) * 1.05 * 10) / 10] };
}
