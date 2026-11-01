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
import { LITH1_BOXES, LITHOLOGY_MATRICES, MAIN_MATRICES, UMAA_CHART_POINTS, UMAA_CHART_RANGE, UMAA_TRIANGLE, boxVertices, mnPoint, porosityLine, ternaryGrid, type LithologyMatrix, type MatrixId, type MineralBox } from '../../petro/lithologyIndices';
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
  /** Sección del menú de plantillas. */
  group: 'lithology' | 'fluids';
  /** Colorear por zona al aplicarla (plantillas de minerales, sin un rol natural para el color). */
  zoneColor?: boolean;
  /** De dónde salen las curvas derivadas de los ejes: se agrega al motivo cuando faltan. */
  needs?: string;
}

export const TEMPLATE_GROUPS: readonly { id: CrossplotTemplate['group']; label: string }[] = [
  { id: 'lithology', label: 'Litología y mineralogía' },
  { id: 'fluids', label: 'Porosidad y fluidos' },
];

export const CROSSPLOT_TEMPLATE_DEFS: readonly CrossplotTemplate[] = [
  {
    id: 'density-neutron',
    group: 'lithology',
    label: 'Densidad–neutrón',
    description: 'RHOB contra NPHI con las líneas de arenisca, caliza y dolomía',
    x: { role: 'NPHI', scale: 'linear', range: [-0.05, 0.45] },
    y: { role: 'RHOB', scale: 'linear', reversed: true, range: [1.9, 2.9] },
    colorRole: 'GR',
  },
  {
    id: 'pickett',
    group: 'fluids',
    label: 'Pickett',
    description: 'Rt contra φ en log–log con las líneas de Sw de Archie (a, m, n y Rw del proyecto)',
    x: { role: 'RT', scale: 'log' },
    y: { role: 'PHIE', scale: 'log', range: [0.01, 1] },
    colorRole: 'VSH',
  },
  {
    id: 'phi-sw',
    group: 'fluids',
    label: 'φ–Sw (Buckles)',
    description: 'Sw contra φ con las hipérbolas de volumen de agua constante',
    x: { role: 'PHIE', scale: 'linear', range: [0, 0.4] },
    y: { role: 'SW', scale: 'linear', range: [0, 1] },
    colorRole: 'VSH',
  },
  {
    id: 'gr-rt',
    group: 'fluids',
    label: 'GR–Rt',
    description: 'Rt contra GR con las lecturas de arena limpia y de arcilla',
    x: { role: 'GR', scale: 'linear' },
    y: { role: 'RT', scale: 'log' },
  },
  {
    id: 'nmr-dn',
    group: 'fluids',
    label: 'RMN vs. densidad–neutrón',
    description: 'PHIE de RMN contra PHIE de densidad–neutrón con la recta 1:1 y el umbral de déficit',
    x: { role: 'PHIE', scale: 'linear', range: [NMR_DN_RANGE[0], NMR_DN_RANGE[1]] },
    y: { role: 'PHIE_NMR', scale: 'linear', range: [NMR_DN_RANGE[0], NMR_DN_RANGE[1]] },
    colorRole: 'SWIRR_NMR',
  },
  {
    id: 'th-k',
    group: 'lithology',
    zoneColor: true,
    label: 'Torio–potasio',
    description: 'Minerales arcillosos orientativos y cocientes Th/K',
    x: { role: 'POTA', scale: 'linear', range: [0, 6] },
    y: { role: 'THOR', scale: 'linear', range: [0, 30] },
  },
  {
    id: 'pe-density',
    group: 'lithology',
    zoneColor: true,
    label: 'PE–densidad',
    description: 'Puntos minerales y mezcla matriz–agua dulce',
    x: { role: 'PEF', scale: 'linear', range: [0, 8] },
    y: { role: 'RHOB', scale: 'linear', range: [1.3, 3.2] },
  },
  {
    id: 'sonic-neutron',
    group: 'lithology',
    label: 'Sónico–neutrón',
    description: 'DT contra NPHI con las rectas de arenisca, caliza y dolomía (Wyllie)',
    x: { role: 'NPHI', scale: 'linear', range: [-0.05, 0.45] },
    y: { role: 'DT', scale: 'linear', range: [40, 140] },
    colorRole: 'GR',
  },
  {
    id: 'density-sonic',
    group: 'lithology',
    label: 'Densidad–sónico',
    description: 'RHOB contra DT con las rectas de arenisca, caliza y dolomía (Wyllie)',
    x: { role: 'DT', scale: 'linear', range: [40, 140] },
    y: { role: 'RHOB', scale: 'linear', reversed: true, range: [1.9, 3] },
    colorRole: 'GR',
  },
  {
    id: 'm-n',
    group: 'lithology',
    label: 'M–N',
    description: 'M contra N con los puntos de cuarzo, calcita, dolomita y evaporitas',
    x: { role: 'N', scale: 'linear', range: [0.25, 0.8] },
    y: { role: 'M', scale: 'linear', range: [0.4, 1.1] },
    colorRole: 'GR',
    needs: 'M y N las calcula «Índices de litología» con RHOB, NPHI y DT.',
  },
  {
    id: 'rhomaa-umaa',
    group: 'lithology',
    label: 'Identificación de matriz',
    description: 'ρmaa contra Umaa con el triángulo cuarzo–calcita–dolomita y su grilla de porcentajes',
    x: { role: 'UMAA', scale: 'linear', range: [UMAA_CHART_RANGE.u[0], UMAA_CHART_RANGE.u[1]] },
    y: { role: 'RHOMAA', scale: 'linear', reversed: true, range: [UMAA_CHART_RANGE.rho[0], UMAA_CHART_RANGE.rho[1]] },
    colorRole: 'GR',
    needs: 'Umaa la calcula «Índices de litología» con RHOB, PEF y PHIT; ρmaa, «Densidad de matriz aparente» con RHOB y PHIT.',
  },
  {
    id: 'pe-k',
    group: 'lithology',
    label: 'PEF–potasio',
    description: 'PEF contra K con las cajas orientativas de minerales arcillosos y micas',
    x: { role: 'POTA', scale: 'linear', range: [0, 10] },
    y: { role: 'PEF', scale: 'linear', range: [0, 10] },
    zoneColor: true,
  },
  {
    id: 'pe-thk',
    group: 'lithology',
    label: 'PEF–Th/K',
    description: 'PEF contra Th/K (log) con las cajas orientativas de minerales arcillosos y micas',
    x: { role: 'THK', scale: 'log', range: [0.1, 100] },
    y: { role: 'PEF', scale: 'linear', range: [0, 10] },
    zoneColor: true,
    needs: 'Th/K la calcula «Índices de litología» con THOR y POTA.',
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

// ── plantillas de determinación de litologías (Clase 8; docs/decisiones/0059) ──────────────────────────────────

export type LithologyTemplateId = 'sonic-neutron' | 'density-sonic' | 'm-n' | 'rhomaa-umaa' | 'pe-k' | 'pe-thk';
export const LITHOLOGY_TEMPLATE_IDS: readonly LithologyTemplateId[] = ['sonic-neutron', 'density-sonic', 'm-n', 'rhomaa-umaa', 'pe-k', 'pe-thk'];
export const isLithologyTemplate = (id: CrossplotTemplateId | null): id is LithologyTemplateId => !!id && (LITHOLOGY_TEMPLATE_IDS as readonly string[]).includes(id);

/** Colores de las matrices (el panel pasa los rellenos de litología del tema; por defecto, los de `MINERALS`). */
export type MatrixColors = Record<MatrixId, string> & { guide: string };

const mineralColor = (id: string) => MINERALS.find((m) => m.id === id)?.color ?? '#78828f';
export const DEFAULT_MATRIX_COLORS: MatrixColors = {
  quartz: mineralColor('quartz'), calcite: mineralColor('calcite'), dolomite: mineralColor('dolomite'),
  anhydrite: mineralColor('anhydrite'), halite: mineralColor('halite'), gypsum: mineralColor('gypsum'),
  'k-feldspar': mineralColor('k-feldspar'), guide: '#78828f',
};

/** Nombre de la litología de cada matriz principal en las rectas de porosidad (como en densidad–neutrón). */
const ROCK_LABEL: Partial<Record<MatrixId, string>> = { quartz: 'Arenisca', calcite: 'Caliza', dolomite: 'Dolomía' };

/** Rótulo fijo junto a un punto: una «línea» de un solo punto (no se dibuja; el rótulo va a su derecha). */
function pointLabel(id: string, x: number, y: number, text: string, color: string): XYLineLayer {
  return { id: `label-${id}`, x: [x], y: [y], color, label: text, labelAt: 'start' };
}

/**
 * Flecha en datos (cuerpo + punta) con la punta proporcional al rango de los ejes, para que se vea igual en x e y.
 * Se usa en la carta ρmaa–Umaa (sal, gas, baritina, minerales pesados).
 */
export function arrowPath(from: [number, number], to: [number, number], span: [number, number], head = 0.022): { x: number[]; y: number[] } {
  const [sx, sy] = span;
  const dx = (to[0] - from[0]) / sx;
  const dy = (to[1] - from[1]) / sy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const wing = (sign: number): [number, number] => [to[0] + (-ux * 0.8 + sign * uy * 0.5) * head * sx, to[1] + (-uy * 0.8 - sign * ux * 0.5) * head * sy];
  const [lx, ly] = wing(1);
  const [rx, ry] = wing(-1);
  return { x: [from[0], to[0], lx, to[0], rx], y: [from[1], to[1], ly, to[1], ry] };
}

const LITH1_COLORS: Record<string, string> = {
  glauconite: '#22c55e', biotite: '#0ea5e9', chlorite: '#14b8a6', illite: '#ef4444',
  'mixed-layer': '#fb923c', montmorillonite: '#a78bfa', kaolinite: '#eab308', muscovite: '#60a5fa',
};

/** Dónde va el rótulo de cada caja (las chicas, afuera; las grandes, adentro). */
type BoxLabelAt = 'above' | 'below' | 'inside' | 'right';
const PE_K_LABELS: Record<string, BoxLabelAt> = { glauconite: 'inside', chlorite: 'right', kaolinite: 'right', montmorillonite: 'above' };
const PE_THK_LABELS: Record<string, BoxLabelAt> = { glauconite: 'inside', 'mixed-layer': 'inside', montmorillonite: 'below' };

function boxLayers(axis: 'k' | 'thk', contrast: (c: string) => string): XYPolygonLayer[] {
  const out: XYPolygonLayer[] = [];
  const where = axis === 'k' ? PE_K_LABELS : PE_THK_LABELS;
  const log = axis === 'thk';
  for (const box of LITH1_BOXES as readonly MineralBox[]) {
    const x = box[axis];
    if (!x) continue;
    const cx = log ? Math.sqrt(x[0] * x[1]) : (x[0] + x[1]) / 2;
    const cy = (box.pe[0] + box.pe[1]) / 2;
    const at = where[box.id] ?? 'above';
    const labelPosition: [number, number] = at === 'inside' ? [cx, cy] : at === 'below' ? [cx, box.pe[0] - 0.3] : at === 'right' ? [x[1] + 0.75, cy] : [cx, box.pe[1] + 0.3];
    out.push({
      id: `lith1-${box.id}`, name: box.label, vertices: boxVertices(x, box.pe), color: contrast(LITH1_COLORS[box.id] ?? '#78828f'),
      fillAlpha: box.id === 'mixed-layer' ? 0.06 : 0.16, label: box.label, labelPosition,
    });
  }
  return out;
}

/**
 * Capas de las seis plantillas de litología: rectas de porosidad (Wyllie), puntos y triángulos de matrices, grilla de
 * porcentajes y cajas de minerales. `colors` y `contrast` vienen del tema; los datos, de `src/petro/lithologyIndices.ts`.
 */
export function lithologyTemplateLayers(
  id: LithologyTemplateId,
  colors: MatrixColors = DEFAULT_MATRIX_COLORS,
  contrast: (color: string) => string = (color) => color,
): { polygons: XYPolygonLayer[]; lines: XYLineLayer[]; points: XYPointLayer[]; info: string } {
  const lines: XYLineLayer[] = [];
  const points: XYPointLayer[] = [];
  const polygons: XYPolygonLayer[] = [];
  const mineralPoint = (m: LithologyMatrix, x: number, y: number, detail: string) => {
    const color = colors[m.id];
    points.push({ id: `matrix-${m.id}`, name: m.label, x: [x], y: [y], color, radius: 4.5, interactive: true, label: () => `${m.label} · ${detail}` });
    lines.push(pointLabel(m.id, x, y, m.label, color));
  };

  if (id === 'sonic-neutron' || id === 'density-sonic') {
    for (const m of MAIN_MATRICES) {
      const l = porosityLine(m);
      const color = colors[m.id];
      const x = id === 'sonic-neutron' ? l.nphi : l.dt;
      const y = id === 'sonic-neutron' ? l.dt : l.rhob;
      // Rótulo en la punta de la matriz en densidad–sónico (las rectas convergen hacia el fluido y los rótulos del otro
      // extremo se pisan); en sónico–neutrón, en la punta de alta porosidad (las matrices están juntas abajo).
      lines.push({ id: `por-${m.id}`, name: ROCK_LABEL[m.id], x, y, color, width: 1.5, label: ROCK_LABEL[m.id], labelAt: id === 'density-sonic' ? 'start' : 'end' });
      // Marcas cada 0,1 de porosidad (la de 0 es el punto de matriz).
      const ticks = l.phi.map((p, k) => (Math.abs(p * 10 - Math.round(p * 10)) < 1e-6 ? k : -1)).filter((k) => k >= 0);
      points.push({ id: `por-ticks-${m.id}`, x: ticks.map((k) => x[k]!), y: ticks.map((k) => y[k]!), color, radius: 2.6 });
    }
    const others: readonly MatrixId[] = id === 'sonic-neutron' ? ['anhydrite', 'halite'] : ['anhydrite', 'halite', 'gypsum'];
    for (const mid of others) {
      const m = LITHOLOGY_MATRICES.find((x) => x.id === mid)!;
      if (id === 'sonic-neutron') mineralPoint(m, m.phiN, m.dt, `NPHI ${m.phiN} · Δt ${m.dt} µs/ft`);
      else mineralPoint(m, m.dt, m.rho, `Δt ${m.dt} µs/ft · densidad ${m.rho} g/cm³`);
    }
    return {
      polygons, lines, points,
      info: id === 'sonic-neutron'
        ? 'Rectas de Wyllie con agua dulce (Δt del fluido 189 µs/ft) y matrices del Appendix B; marcas cada 0,1 de porosidad, neutrón en unidades de caliza. Arriba de ~25 % de porosidad la carta del fabricante se curva: leer la porosidad con ±0,03. La arcilla corre los puntos hacia Δt y neutrón altos.'
        : 'Rectas de Wyllie con agua dulce (Δt del fluido 189 µs/ft, densidad 1,0 g/cm³) y matrices del Appendix B; marcas cada 0,1 de porosidad. Arenisca y caliza casi se superponen: esta carta separa mal cuarzo de calcita y sí distingue dolomía y evaporitas. La arcilla y la falta de compactación corren los puntos hacia Δt alto.',
    };
  }

  if (id === 'm-n') {
    const shown = LITHOLOGY_MATRICES.filter((m) => m.id !== 'k-feldspar');
    const mn = new Map(shown.map((m) => [m.id, mnPoint(m)]));
    const tri = MAIN_MATRICES.map((m) => mn.get(m.id)!);
    lines.push({ id: 'mn-triangle', name: 'Cuarzo–calcita–dolomita', x: [...tri.map((p) => p.n), tri[0]!.n], y: [...tri.map((p) => p.m), tri[0]!.m], color: colors.guide, width: 1.5 });
    for (const m of shown) {
      const p = mn.get(m.id)!;
      mineralPoint(m, p.n, p.m, `N ${p.n.toFixed(3)} · M ${p.m.toFixed(3)}`);
    }
    return {
      polygons, lines, points,
      info: 'Puntos de matriz con agua dulce (matrices del Appendix B): M y N no dependen de la porosidad. La porosidad secundaria corre los puntos hacia arriba, el gas hacia arriba y a la derecha, la arcilla hacia abajo. La sal queda fuera del rango (N ≈ 0,99; M ≈ 1,17).',
    };
  }

  if (id === 'rhomaa-umaa') {
    const span: [number, number] = [UMAA_CHART_RANGE.u[1] - UMAA_CHART_RANGE.u[0], UMAA_CHART_RANGE.rho[1] - UMAA_CHART_RANGE.rho[0]];
    for (const g of ternaryGrid(0.2)) {
      lines.push({ id: `grid-${g.component}-${g.fraction}`, x: g.u, y: g.rho, color: colors[g.component], width: 0.75, dash: [3, 3] });
    }
    const v = UMAA_TRIANGLE;
    lines.push({ id: 'umaa-triangle', name: 'Cuarzo–calcita–dolomita', x: [...v.map((p) => p.u), v[0]!.u], y: [...v.map((p) => p.rho), v[0]!.rho], color: colors.guide, width: 1.5 });
    for (const p of v) {
      const color = colors[p.id];
      points.push({ id: `umaa-${p.id}`, name: p.label, x: [p.u], y: [p.rho], color, radius: 4.5, interactive: true, label: () => `${p.label} · Umaa ${p.u} b/cm³ · ρmaa ${p.rho} g/cm³` });
      lines.push(pointLabel(`umaa-${p.id}`, p.u, p.rho, p.label, color));
    }
    for (const p of UMAA_CHART_POINTS) {
      const color = p.id === 'anhydrite' ? colors.anhydrite : p.id === 'k-feldspar' ? colors['k-feldspar'] : contrast(mineralColor(p.id));
      points.push({ id: `umaa-${p.id}`, name: p.label, x: [p.u], y: [p.rho], color, radius: 4, interactive: true, label: () => `${p.label} (leído de la carta) · Umaa ${p.u} · ρmaa ${p.rho}` });
      lines.push(pointLabel(`umaa-${p.id}`, p.u, p.rho, p.label, color));
    }
    const arrow = (key: string, from: [number, number], to: [number, number], label: string) =>
      lines.push({ id: `arrow-${key}`, ...arrowPath(from, to, span), color: colors.guide, width: 1.25, label, labelAt: 'start' });
    // Flechas de la carta (slide 27): posiciones leídas, orientativas.
    arrow('salt', [9.45, 2.36], [9.45, 2.23], 'Sal');
    arrow('gas', [7.6, 2.52], [7.3, 2.4], 'Gas');
    arrow('barite', [15.2, 2.81], [16.9, 2.81], 'Baritina');
    arrow('heavy', [15.2, 2.91], [16.9, 2.95], 'Minerales pesados');
    return {
      polygons, lines, points,
      info: 'Triángulo cuarzo–calcita–dolomita con grilla cada 20 %; feldespato, arcillas y anhidrita leídos de la carta (orientativos). Umaa y ρmaa usan la porosidad total: el gas sube los puntos y la baritina del lodo los lleva a la derecha.',
    };
  }

  // PEF contra K o contra Th/K: cajas de Lith-1.
  polygons.push(...boxLayers(id === 'pe-k' ? 'k' : 'thk', contrast));
  return {
    polygons, lines, points,
    info: id === 'pe-k'
      ? 'Cajas orientativas de Lith-1 (ex CP-18): rangos de K leídos de la carta y de PEF de la hoja CROSSPLOT de la cátedra. Límites SIN VERIFICAR. La baritina del lodo sube el PEF de todas las muestras.'
      : 'Cajas orientativas de Lith-1 (ex CP-18) de la hoja CROSSPLOT de la cátedra: límites SIN VERIFICAR y superpuestos (capas mixtas incluye montmorillonita). La baritina del lodo sube el PEF de todas las muestras.',
  };
}
