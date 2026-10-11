/**
 * PALETA DE CURVAS POR ROL — convenciones de lectura de la industria, en claro y oscuro
 * (ver docs/decisiones/0004-sistema-de-diseno.md, D4).
 *
 * Uso (visor, gráficos, leyendas):
 *
 *     const s = curveStyle('NPHI', getResolvedTheme(), registry.roles);
 *     ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.setLineDash(s.dash);
 *     // s.scale ('linear' | 'log'), s.min, s.max, s.reversed salen del catálogo de roles (src/core/roles.ts)
 *
 * Nunca leer `RoleDef.display.color` directamente: es solo el respaldo para roles que declaran los módulos.
 * Puro: sin DOM.
 */
import { defaultRoleCatalog, type RoleCatalog, type RoleId } from '../core/roles';
import { ensureContrast, mix } from './color';
import { THEMES, type ThemeName } from './tokens';

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot';

export interface CurvePaletteEntry {
  light: string;
  dark: string;
  line: LineStyle;
  /** Grosor en px CSS (por defecto 1,25). */
  width?: number;
  /** 'band' = se dibuja como relleno/bandera (no se exige contraste de línea). */
  kind?: 'line' | 'band';
}

/** Paleta curada de los roles incorporados. Un test exige que cubra todo `BUILTIN_ROLES`. */
export const CURVE_PALETTE: Readonly<Record<RoleId, CurvePaletteEntry>> = {
  // Pozo
  CALI: { light: '#2b2f36', dark: '#c9ced6', line: 'dashed' },
  BS: { light: '#6b7280', dark: '#8a929c', line: 'dotted', width: 1 },
  TEMP: { light: '#d9480f', dark: '#ff8a4c', line: 'solid' },
  // Litología
  GR: { light: '#1f9d55', dark: '#4cd17f', line: 'solid', width: 1.5 },
  SP: { light: '#2c4a9e', dark: '#7d9cf2', line: 'dashed' },
  PEF: { light: '#c026d3', dark: '#ea7bf5', line: 'dashed' },
  // Porosidad
  RHOB: { light: '#c81e3a', dark: '#ff6b7d', line: 'solid', width: 1.5 },
  DRHO: { light: '#b05fa8', dark: '#e39bdb', line: 'dotted', width: 1 },
  NPHI: { light: '#1f5fd1', dark: '#5b9cff', line: 'dashed', width: 1.5 },
  DT: { light: '#7c3aed', dark: '#b28cff', line: 'solid' },
  DTS: { light: '#a1307a', dark: '#e283c0', line: 'dashed' },
  // Resistividad: profunda roja continua, media azul rayada, somera naranja punteada, Rxo raya-punto
  RT: { light: '#d1242f', dark: '#ff5c64', line: 'solid', width: 1.75 },
  RM: { light: '#2563eb', dark: '#6b9bff', line: 'dashed' },
  RS: { light: '#c76a04', dark: '#ffb547', line: 'dotted', width: 1.5 },
  RXO: { light: '#0f8b8d', dark: '#3fd0c9', line: 'dashdot' },
  // Rayos gamma espectral
  URAN: { light: '#9333ea', dark: '#c4a1ff', line: 'solid' },
  THOR: { light: '#0e7c66', dark: '#3fd6b0', line: 'solid' },
  POTA: { light: '#db2777', dark: '#ff7ab6', line: 'solid' },
  CGR: { light: '#166534', dark: '#7ee2a8', line: 'dashed' },
  // Resonancia magnética
  PHIT_NMR: { light: '#4338ca', dark: '#9b95ff', line: 'solid' },
  PHIE_NMR: { light: '#0369a1', dark: '#58b7ec', line: 'dashed' },
  BVI_NMR: { light: '#64748b', dark: '#a3b1c4', line: 'dotted' },
  // Calculadas
  IGR: { light: '#1f9d55', dark: '#4cd17f', line: 'dashed' },
  VSH: { light: '#8a5a2b', dark: '#d6a36b', line: 'solid', width: 1.5 },
  PHID: { light: '#c81e3a', dark: '#ff6b7d', line: 'dashed' },
  PHIN: { light: '#1f5fd1', dark: '#5b9cff', line: 'dotted', width: 1.5 },
  PHIS: { light: '#7c3aed', dark: '#b28cff', line: 'dashed' },
  PHIT: { light: '#2b2f36', dark: '#d5d9df', line: 'solid' },
  PHIE: { light: '#0a7bc2', dark: '#4cc0ff', line: 'solid', width: 1.75 },
  SW: { light: '#1d4ed8', dark: '#6f97ff', line: 'solid', width: 1.75 },
  SXO: { light: '#0e8a99', dark: '#48d6e6', line: 'dashed' },
  BVW: { light: '#2f6aa3', dark: '#79aee6', line: 'solid' },
  SH: { light: '#4d7c0f', dark: '#a3d65c', line: 'solid' },
  RW: { light: '#0b5394', dark: '#6fa8f5', line: 'solid', width: 1.5 },
  RWA: { light: '#0e7490', dark: '#5fd3e8', line: 'dashed' },
  PERM: { light: '#c2410c', dark: '#ff9a5c', line: 'solid', width: 1.5 },
  NET_RES: { light: '#e9b949', dark: '#d8a83a', line: 'solid', kind: 'band' },
  NET_PAY: { light: '#d9534f', dark: '#e0605b', line: 'solid', kind: 'band' },
  LITHO: { light: '#8b939d', dark: '#6b737e', line: 'solid', kind: 'band' },
};

/**
 * Muestras para elegir el color de una curva (editor de escalas): los colores clásicos de los perfiles, tomados de
 * la paleta (rojo de la profunda, azul de la media, verde del GR, negro del caliper…).
 */
export const CURVE_SWATCHES: readonly string[] = (['RT', 'RM', 'NPHI', 'GR', 'THOR', 'CALI', 'PEF', 'DT', 'RS', 'RXO', 'VSH', 'BS'] as const).map((r) => CURVE_PALETTE[r]!.light);

/** Rellenos convencionales (crossover, litologías, fluidos, banderas). `alpha` sugerida para canvas. */
export type FillId =
  | 'gasCrossover'
  | 'shaleCrossover'
  | 'modelSpread'
  | 'shale'
  | 'sand'
  | 'limestone'
  | 'dolomite'
  | 'anhydrite'
  | 'salt'
  | 'coal'
  | 'water'
  | 'boundWater'
  | 'oil'
  | 'gas'
  | 'hydrocarbon'
  | 'washout'
  | 'netReservoir'
  | 'netPay'
  | 'pore'
  | 'undivided';

export interface FillEntry {
  label: string;
  light: string;
  dark: string;
  alpha: number;
}

export const FILL_PALETTE: Readonly<Record<FillId, FillEntry>> = {
  gasCrossover: { label: 'Cruce densidad–neutrón (gas)', light: '#f2c12e', dark: '#e3b23c', alpha: 0.55 },
  shaleCrossover: { label: 'Separación densidad–neutrón (arcilla)', light: '#a08360', dark: '#8d7457', alpha: 0.35 },
  shale: { label: 'Arcilla', light: '#9c8466', dark: '#8a735a', alpha: 0.6 },
  sand: { label: 'Arena', light: '#f1d27a', dark: '#c9a94f', alpha: 0.7 },
  limestone: { label: 'Caliza', light: '#8ec5e8', dark: '#4f8fb8', alpha: 0.7 },
  dolomite: { label: 'Dolomía', light: '#c7a3e6', dark: '#8f6cb3', alpha: 0.7 },
  anhydrite: { label: 'Anhidrita', light: '#e6a3c7', dark: '#b06d92', alpha: 0.7 },
  salt: { label: 'Sal', light: '#d4eef7', dark: '#7fb7c7', alpha: 0.7 },
  coal: { label: 'Carbón', light: '#2b2b2b', dark: '#050505', alpha: 0.9 },
  water: { label: 'Agua', light: '#5aa9e6', dark: '#3d82c4', alpha: 0.55 },
  boundWater: { label: 'Agua ligada', light: '#a7c4e0', dark: '#5d7f9f', alpha: 0.55 },
  oil: { label: 'Petróleo', light: '#3fa34d', dark: '#2f8a3c', alpha: 0.6 },
  gas: { label: 'Gas', light: '#e8554e', dark: '#d4473f', alpha: 0.6 },
  hydrocarbon: { label: 'Hidrocarburo', light: '#43a047', dark: '#388e3c', alpha: 0.5 },
  washout: { label: 'Derrumbe', light: '#9aa1ab', dark: '#5b626b', alpha: 0.35 },
  netReservoir: { label: 'Reservorio neto', light: '#f0c43c', dark: '#c79f2c', alpha: 0.8 },
  netPay: { label: 'Pay neto', light: '#e0453f', dark: '#d0423c', alpha: 0.8 },
  /** Banda entre la mínima y la máxima de varios modelos de la misma magnitud (modelos de Sw lado a lado). */
  modelSpread: { label: 'Dispersión entre modelos', light: '#7c6bd6', dark: '#a99bf0', alpha: 0.5 },
  /** Porosidad sin partir (falta Sw): ni agua ni hidrocarburo. */
  pore: { label: 'Porosidad', light: '#bcdcec', dark: '#4f7f94', alpha: 0.75 },
  /** Resto de una columna que no se pudo partir (faltan entradas): neutro, para no inventar una matriz. */
  undivided: { label: 'Sin partir', light: '#c4c8ce', dark: '#5d636b', alpha: 0.55 },
};

/** Colores sugeridos para zonas nuevas (bandas sobre el perfil, chips, crossplots coloreados por capa). */
export const ZONE_PALETTE: readonly string[] = [
  '#5b8def',
  '#e58f3c',
  '#4fb07d',
  '#c062c9',
  '#d4b13d',
  '#e05a6a',
  '#3fb5c4',
  '#8e7cc3',
  '#9aa65a',
  '#c98b6b',
];

export const zoneColor = (index: number): string => ZONE_PALETTE[((index % ZONE_PALETTE.length) + ZONE_PALETTE.length) % ZONE_PALETTE.length]!;

/**
 * Rampa secuencial para colorear puntos por una tercera curva (crossplot libre): viridis (Smith y van der Walt, 2015),
 * perceptualmente uniforme, legible en escala de grises y para daltonismo. En oscuro arranca más clara para que los
 * valores bajos no se pierdan contra el fondo de la pista.
 */
export const SEQUENTIAL_PALETTE: Readonly<Record<ThemeName, readonly string[]>> = {
  light: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  dark: ['#5b3a8e', '#4f4f9c', '#3e64a0', '#31789e', '#268c97', '#1fa187', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
};

/** Color de la rampa en t ∈ [0, 1] (interpolación lineal entre paradas; fuera de rango se acota). */
export function rampColor(t: number, stops: readonly string[]): string {
  if (stops.length === 0) return '#808080';
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(u));
  if (stops.length === 1) return stops[0]!;
  return mix(stops[k]!, stops[k + 1]!, u - k);
}

/** Paleta categórica para curvas sin rol (o roles sin color): estable por id. */
export const CATEGORICAL: Readonly<Record<ThemeName, readonly string[]>> = {
  light: ['#2563eb', '#c76a04', '#059669', '#c026d3', '#dc2626', '#0891b2', '#7c3aed', '#5f9a0c', '#db2777', '#475569'],
  dark: ['#6b9bff', '#ffb547', '#34d399', '#ea7bf5', '#ff6b6b', '#38d0e8', '#b28cff', '#a3e635', '#ff7ab6', '#a3b1c4'],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function categoricalColor(key: string, theme: ThemeName): string {
  const list = CATEGORICAL[theme];
  return list[hash(key) % list.length]!;
}

/** Patrón de trazo para `ctx.setLineDash` (y `stroke-dasharray` en SVG), escalado al grosor. */
export function dashPattern(line: LineStyle, width = 1.25): number[] {
  const k = Math.max(1, width * 0.8);
  switch (line) {
    case 'solid':
      return [];
    case 'dashed':
      return [6 * k, 4 * k];
    case 'dotted':
      return [1.2 * k, 2.6 * k];
    case 'dashdot':
      return [8 * k, 3 * k, 1.5 * k, 3 * k];
  }
}

export interface CurveStyle {
  color: string;
  line: LineStyle;
  dash: number[];
  width: number;
  kind: 'line' | 'band';
  scale: 'linear' | 'log';
  min?: number;
  max?: number;
  reversed: boolean;
  /** Etiqueta del rol (o el id si no hay rol). */
  label: string;
}

const DEFAULT_WIDTH = 1.25;

/**
 * Estilo de dibujo de una curva por rol y tema.
 * - Rol en la paleta → color/trazo curados.
 * - Rol declarado por un módulo → su `display.color`, aclarado/oscurecido hasta contraste 3:1 con la pista.
 * - Sin rol o sin color → color categórico estable por `fallbackKey` (p. ej. el mnemónico).
 */
export function curveStyle(role: RoleId | null | undefined, theme: ThemeName, catalog: RoleCatalog = defaultRoleCatalog, fallbackKey?: string): CurveStyle {
  const def = role ? catalog.get(role) : undefined;
  const display = def?.display;
  const entry = role ? CURVE_PALETTE[role] : undefined;
  const trackBg = THEMES[theme].viewer.trackBg;
  let color: string;
  if (entry) color = entry[theme];
  else if (display?.color) color = ensureContrast(display.color, trackBg, 3);
  else color = categoricalColor(fallbackKey ?? role ?? '?', theme);
  const line = entry?.line ?? 'solid';
  const width = entry?.width ?? DEFAULT_WIDTH;
  const kind = entry?.kind ?? (def?.family === 'flag' ? 'band' : 'line');
  return {
    color,
    line,
    dash: dashPattern(line, width),
    width,
    kind,
    scale: display?.scale ?? 'linear',
    ...(display?.min !== undefined ? { min: display.min } : {}),
    ...(display?.max !== undefined ? { max: display.max } : {}),
    reversed: display?.reversed ?? false,
    label: def?.label ?? fallbackKey ?? role ?? '',
  };
}

export function fillColor(id: FillId, theme: ThemeName): { color: string; alpha: number } {
  const f = FILL_PALETTE[id];
  return { color: f[theme], alpha: f.alpha };
}
