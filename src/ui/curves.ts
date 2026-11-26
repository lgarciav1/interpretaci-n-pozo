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
  // Inducción de arreglo: de la más somera (ocre) a la más profunda de las sin rol clásico (violeta); AT60 (RM) es azul y AT90 (RT) roja
  RA10: { light: '#b45309', dark: '#f0a35e', line: 'solid', width: 1.25 },
  RA20: { light: '#4d7c0f', dark: '#a3d65c', line: 'solid', width: 1.25 },
  RA30: { light: '#6d28d9', dark: '#a78bfa', line: 'solid', width: 1.25 },
  // Rayos gamma espectral
  URAN: { light: '#9333ea', dark: '#c4a1ff', line: 'solid' },
  THOR: { light: '#0e7c66', dark: '#3fd6b0', line: 'solid' },
  POTA: { light: '#db2777', dark: '#ff7ab6', line: 'solid' },
  CGR: { light: '#166534', dark: '#7ee2a8', line: 'dashed' },
  // Resonancia magnética
  // Pista «RMN» (0019): PHIT_NMR cierra el agua ligada a la arcilla, PHIE_NMR (violeta, para no confundirse con la
  // PHIE azul de densidad–neutrón que se superpone) separa ligada de libre y BVI_NMR cierra el agua irreducible.
  PHIT_NMR: { light: '#374151', dark: '#d1d5db', line: 'solid', width: 1.25 },
  PHIE_NMR: { light: '#7c3aed', dark: '#c4a1ff', line: 'solid', width: 1.5 },
  BVI_NMR: { light: '#1e4f8f', dark: '#8fb8ec', line: 'dashed', width: 1 },
  FFI_NMR: { light: '#0b6bcb', dark: '#5fb0ff', line: 'solid' },
  CBW_NMR: { light: '#6b7280', dark: '#aab2bd', line: 'dotted' },
  SWIRR_NMR: { light: '#1b7f74', dark: '#52d1c0', line: 'dashed' },
  DPHI_NMR: { light: '#b91c1c', dark: '#ff7b72', line: 'solid' },
  IND_NMR_DEFICIT: { light: '#a21caf', dark: '#e879f9', line: 'solid', kind: 'band' },
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
  MOS: { light: '#15803d', dark: '#4ade80', line: 'solid', width: 1.5 },
  SHR: { light: '#b45309', dark: '#fb923c', line: 'dashed', width: 1.25 },
  MHI: { light: '#6d28d9', dark: '#c4a1ff', line: 'dashdot', width: 1.25 },
  BVW: { light: '#2f6aa3', dark: '#79aee6', line: 'solid' },
  SH: { light: '#4d7c0f', dark: '#a3d65c', line: 'solid' },
  RW: { light: '#0b5394', dark: '#6fa8f5', line: 'solid', width: 1.5 },
  RWA: { light: '#0e7490', dark: '#5fd3e8', line: 'dashed' },
  // R0 (F16): azul cielo punteado, para leerse junto a la Rt roja sin confundirse con la media (azul rayada)
  R0: { light: '#0284c7', dark: '#38bdf8', line: 'dotted', width: 1.75 },
  // Perfil de invasión escalonada (fase 8b)
  DI: { light: '#0f766e', dark: '#2dd4bf', line: 'solid', width: 1.5 },
  INV_MISFIT: { light: '#be185d', dark: '#f472b6', line: 'dotted', width: 1.25 },
  // Calibración con corona (fase 8, N): ámbar, distinta de RHOB (rojo), VSH (marrón) y PERM (naranja)
  RHOMAA: { light: '#a16207', dark: '#f2c14e', line: 'solid', width: 1.5 },
  FZI: { light: '#0f766e', dark: '#2dd4bf', line: 'solid', width: 1.25 },
  // Índices de litología (0059): M toma el violeta del sónico, N el azul del neutrón, Umaa el magenta del PEF y Th/K
  // un ocre distinto del torio (verde azulado) y del potasio (rosa). Trazo raya-punto: son derivadas, no medidas.
  M: { light: '#6d28d9', dark: '#c4a1ff', line: 'dashdot', width: 1.25 },
  N: { light: '#1d4ed8', dark: '#7aa7ff', line: 'dashdot', width: 1.25 },
  UMAA: { light: '#a21caf', dark: '#f08cf5', line: 'solid', width: 1.25 },
  THK: { light: '#b45309', dark: '#f4a957', line: 'solid', width: 1.25 },
  // Distribución de la arcilla (0061): el marrón de VSH, más oscuro, en raya-punto (código 0–3, derivado).
  CLAY_DIST: { light: '#6b4423', dark: '#e0b07a', line: 'dashdot', width: 1.25 },
  R35: { light: '#7c3aed', dark: '#b28cff', line: 'dashed', width: 1.25 },
  ROCK_TYPE: { light: '#3e4989', dark: '#5b7fc4', line: 'solid', kind: 'band' },
  PERM: { light: '#c2410c', dark: '#ff9a5c', line: 'solid', width: 1.5 },
  // Arena neta (rol del módulo de cutoffs, 0054): tostado de arena, menos saturado que el reservorio neto (oro).
  NET_SAND: { light: '#c9ad7f', dark: '#9c8662', line: 'solid', kind: 'band' },
  NET_RES: { light: '#e9b949', dark: '#d8a83a', line: 'solid', kind: 'band' },
  NET_PAY: { light: '#d9534f', dark: '#e0605b', line: 'solid', kind: 'band' },
  LITHO: { light: '#8b939d', dark: '#6b737e', line: 'solid', kind: 'band' },
  // Indicadores automáticos (fase 7c): franjas de la pista «Indicadores»
  IND_GAS: { light: '#e8a317', dark: '#f0b429', line: 'solid', kind: 'band' },
  IND_SHALE: { light: '#8a6d4b', dark: '#a8895f', line: 'solid', kind: 'band' },
  IND_COAL: { light: '#2b2b2b', dark: '#9aa0a8', line: 'solid', kind: 'band' },
  IND_WASHOUT: { light: '#5f87a8', dark: '#7da5c6', line: 'solid', kind: 'band' },
};

/**
 * Variante de paleta. 'modern' es la de arriba (la de siempre: gráficos, listas, estilo «Moderno» del visor);
 * 'classic' es la del perfil clásico de fábrica del visor (docs/decisiones/0067): colores oscuros y trazos finos por
 * convención de curva, y rellenos apagados.
 */
export type PaletteVariant = 'modern' | 'classic';

/** Grosor de línea por defecto y máximo del perfil clásico (px CSS). Un override del usuario lo puede superar. */
export const CLASSIC_LINE_WIDTH = 1;
export const CLASSIC_MAX_LINE_WIDTH = 1.25;

/**
 * Perfil clásico: cambios sobre `CURVE_PALETTE` por rol. Convenciones de lectura: GR verde oscuro; resistividad
 * profunda roja sólida, media azul a rayas, somera verde punteada; RHOB rojo, NPHI azul a rayas; PE magenta; DT
 * violeta; CALI negro a rayas. En oscuro, los mismos tonos aclarados lo justo para leerse sobre la pista. Las
 * calculadas, en tonos menos saturados que en «Moderno». Lo que no está acá conserva color y trazo, con grosor fino.
 */
export const CLASSIC_CURVE_PALETTE: Readonly<Partial<Record<RoleId, Partial<CurvePaletteEntry>>>> = {
  CALI: { light: '#1c1f24', dark: '#d4d8de', line: 'dashed' },
  BS: { light: '#7a8088', dark: '#8f969f', line: 'dotted' },
  GR: { light: '#17663a', dark: '#5cc489', line: 'solid' },
  SP: { light: '#30437a', dark: '#93a6e0', line: 'dashed' },
  PEF: { light: '#a3238f', dark: '#e48ad6', line: 'dashed' },
  RHOB: { light: '#b3202c', dark: '#ff7a84', line: 'solid' },
  DRHO: { light: '#9a6b94', dark: '#cfa1c9', line: 'dotted' },
  NPHI: { light: '#1f4fa8', dark: '#7aa4ef', line: 'dashed' },
  DT: { light: '#5b2a9e', dark: '#b597ec', line: 'solid' },
  DTS: { light: '#87306c', dark: '#d991c0', line: 'dashed' },
  RT: { light: '#b3202c', dark: '#ff7a84', line: 'solid', width: 1.25 },
  RM: { light: '#1f4fa8', dark: '#7aa4ef', line: 'dashed' },
  RS: { light: '#2e7d32', dark: '#7ccf82', line: 'dotted', width: 1.25 },
  RXO: { light: '#3a3f46', dark: '#c3c8cf', line: 'dashdot' },
  RA10: { light: '#2e7d32', dark: '#7ccf82', line: 'dotted', width: 1.25 },
  RA20: { light: '#8a5a12', dark: '#e0b26a', line: 'dashdot' },
  RA30: { light: '#6a3fa0', dark: '#b89ae6', line: 'dashdot' },
  IGR: { light: '#3f7d55', dark: '#86c39b', line: 'dashed' },
  VSH: { light: '#6e5232', dark: '#c9a982', line: 'solid' },
  PHIE: { light: '#2b5d8a', dark: '#86b4dc', line: 'solid', width: 1.25 },
  PHIT: { light: '#3a3f46', dark: '#c3c8cf', line: 'solid' },
  SW: { light: '#1f2f5c', dark: '#a9bde6', line: 'solid' },
  SXO: { light: '#1c6d7a', dark: '#69c2cf', line: 'dashed' },
  MOS: { light: '#1f6f3d', dark: '#6cc48c', line: 'solid' },
  SHR: { light: '#9a4f1f', dark: '#e09a68', line: 'dashed' },
  MHI: { light: '#5b2a9e', dark: '#b89ae6', line: 'dashdot' },
  R0: { light: '#0b6fa8', dark: '#6cc0ee', line: 'dotted', width: 1.25 },
  BVW: { light: '#3f6f96', dark: '#8fb3d3', line: 'solid' },
  PERM: { light: '#9a4a1f', dark: '#e09a6c', line: 'solid' },
  NET_SAND: { light: '#cdbf9c', dark: '#8f8366' },
  NET_RES: { light: '#d8c27e', dark: '#a8955a' },
  NET_PAY: { light: '#c98a84', dark: '#a9675f' },
  IND_GAS: { light: '#d6b55e', dark: '#b99a45' },
  IND_SHALE: { light: '#9a8a6e', dark: '#8a7a5f' },
  IND_COAL: { light: '#3a3a3a', dark: '#8f959c' },
  IND_WASHOUT: { light: '#8aa0b2', dark: '#6f8798' },
  IND_NMR_DEFICIT: { light: '#a46a9c', dark: '#b98ab2' },
};

/** Entrada de la paleta de un rol en una variante (null si el rol no es de la paleta curada). */
export function paletteEntry(role: RoleId, variant: PaletteVariant = 'modern'): CurvePaletteEntry | null {
  const base = CURVE_PALETTE[role];
  if (!base) return null;
  if (variant === 'modern') return base;
  const over = CLASSIC_CURVE_PALETTE[role];
  const width = Math.min(CLASSIC_MAX_LINE_WIDTH, over?.width ?? CLASSIC_LINE_WIDTH);
  return { ...base, ...over, width };
}

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
  | 'curveUncertainty'
  | 'shale'
  | 'sand'
  | 'limestone'
  | 'dolomite'
  | 'anhydrite'
  | 'salt'
  | 'coal'
  | 'marl'
  | 'chalk'
  | 'tuff'
  | 'basement'
  | 'water'
  | 'boundWater'
  | 'clayBoundWater'
  | 'capillaryWater'
  | 'freeFluid'
  | 'oil'
  | 'gas'
  | 'hydrocarbon'
  | 'movableHydrocarbon'
  | 'residualHydrocarbon'
  | 'washout'
  | 'netReservoir'
  | 'netPay'
  | 'pore'
  | 'undivided'
  | 'uraniumExcess';

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
  /** Litologías de las clases FORCE 2020 (pista de litología sugerida, 0030): marga verde-gris, creta casi blanca, toba naranja, basamento rojo. */
  marl: { label: 'Marga', light: '#a9b98f', dark: '#7d8c66', alpha: 0.7 },
  chalk: { label: 'Creta', light: '#eef0e2', dark: '#b4b8a6', alpha: 0.7 },
  tuff: { label: 'Toba', light: '#e8935c', dark: '#b8693a', alpha: 0.7 },
  basement: { label: 'Basamento', light: '#c0605e', dark: '#94403f', alpha: 0.7 },
  water: { label: 'Agua', light: '#5aa9e6', dark: '#3d82c4', alpha: 0.55 },
  boundWater: { label: 'Agua ligada', light: '#a7c4e0', dark: '#5d7f9f', alpha: 0.55 },
  /** Partición de la porosidad de RMN (0019): agua ligada a la arcilla, agua irreducible y fluido libre. */
  clayBoundWater: { label: 'Agua ligada a la arcilla (CBW)', light: '#a3a8b0', dark: '#6b7079', alpha: 0.6 },
  capillaryWater: { label: 'Agua irreducible (BVI)', light: '#4a8fdc', dark: '#3a76c0', alpha: 0.6 },
  freeFluid: { label: 'Fluido libre (FFI)', light: '#e3dc5a', dark: '#e0d453', alpha: 0.65 },
  oil: { label: 'Petróleo', light: '#3fa34d', dark: '#2f8a3c', alpha: 0.6 },
  gas: { label: 'Gas', light: '#e8554e', dark: '#d4473f', alpha: 0.6 },
  hydrocarbon: { label: 'Hidrocarburo', light: '#43a047', dark: '#388e3c', alpha: 0.5 },
  movableHydrocarbon: { label: 'Hidrocarburo móvil', light: '#22c55e', dark: '#2ecc71', alpha: 0.65 },
  residualHydrocarbon: { label: 'Hidrocarburo residual', light: '#c85a32', dark: '#cf6b42', alpha: 0.65 },
  washout: { label: 'Derrumbe', light: '#9aa1ab', dark: '#5b626b', alpha: 0.35 },
  netReservoir: { label: 'Reservorio neto', light: '#f0c43c', dark: '#c79f2c', alpha: 0.8 },
  netPay: { label: 'Pay neto', light: '#e0453f', dark: '#d0423c', alpha: 0.8 },
  /** Banda entre la mínima y la máxima de varios modelos de la misma magnitud (modelos de Sw lado a lado). */
  curveUncertainty: { label: 'Incertidumbre P10–P90', light: '#6050aa', dark: '#a89cf0', alpha: 0.22 },
  modelSpread: { label: 'Dispersión entre modelos', light: '#7c6bd6', dark: '#a99bf0', alpha: 0.5 },
  /** Porosidad sin partir (falta Sw): ni agua ni hidrocarburo. */
  pore: { label: 'Porosidad', light: '#bcdcec', dark: '#4f7f94', alpha: 0.75 },
  /** Resto de una columna que no se pudo partir (faltan entradas): neutro, para no inventar una matriz. */
  undivided: { label: 'Sin partir', light: '#c4c8ce', dark: '#5d636b', alpha: 0.55 },
  /** Exceso de rayos gamma atribuible al uranio (área entre CGR y GR total, ADR 0090). */
  uraniumExcess: { label: 'Aporte de uranio (GR − CGR)', light: '#a855f7', dark: '#c084fc', alpha: 0.38 },
};

/**
 * Perfil clásico: rellenos apagados (oliva o tierra desaturados, azul y verde grisáceos) para que las curvas manden.
 * Lo que no está acá queda como en `FILL_PALETTE`.
 */
export const CLASSIC_FILL_PALETTE: Readonly<Partial<Record<FillId, Partial<FillEntry>>>> = {
  gasCrossover: { light: '#e3c766', dark: '#b59a46', alpha: 0.45 },
  shaleCrossover: { light: '#a59a86', dark: '#7d7361', alpha: 0.3 },
  shale: { light: '#8f8a62', dark: '#7d7856', alpha: 0.42 },
  sand: { light: '#e4d7a8', dark: '#a69a6f', alpha: 0.55 },
  limestone: { light: '#b4cbdb', dark: '#62808f', alpha: 0.6 },
  dolomite: { light: '#c6b9d6', dark: '#7b6d8f', alpha: 0.6 },
  anhydrite: { light: '#d8b9c9', dark: '#8f6f80', alpha: 0.6 },
  salt: { light: '#d9e6ea', dark: '#7a9299', alpha: 0.6 },
  coal: { light: '#2f2f2f', dark: '#0c0c0c', alpha: 0.85 },
  marl: { light: '#b5bc9c', dark: '#727a5c', alpha: 0.6 },
  chalk: { light: '#efefe6', dark: '#a4a698', alpha: 0.6 },
  tuff: { light: '#d9a988', dark: '#9a6f52', alpha: 0.6 },
  basement: { light: '#b98380', dark: '#835553', alpha: 0.6 },
  water: { light: '#8fb0cc', dark: '#4d6f8c', alpha: 0.55 },
  hydrocarbon: { light: '#9fba86', dark: '#5e7a4a', alpha: 0.55 },
  movableHydrocarbon: { light: '#6eb362', dark: '#548c46', alpha: 0.65 },
  residualHydrocarbon: { light: '#b87654', dark: '#945d42', alpha: 0.65 },
  oil: { light: '#9fba86', dark: '#5e7a4a', alpha: 0.55 },
  gas: { light: '#d39c93', dark: '#93605a', alpha: 0.55 },
  washout: { light: '#b3b8bf', dark: '#5b626b', alpha: 0.3 },
  netReservoir: { light: '#d8c27e', dark: '#a8955a', alpha: 0.7 },
  netPay: { light: '#c98a84', dark: '#a9675f', alpha: 0.7 },
  pore: { light: '#cddbe4', dark: '#4f6a78', alpha: 0.7 },
  freeFluid: { light: '#dcd58a', dark: '#a9a35a', alpha: 0.55 },
  capillaryWater: { light: '#8fb0cc', dark: '#4d6f8c', alpha: 0.55 },
  uraniumExcess: { light: '#a67cc4', dark: '#9872b8', alpha: 0.34 },
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
export function curveStyle(role: RoleId | null | undefined, theme: ThemeName, catalog: RoleCatalog = defaultRoleCatalog, fallbackKey?: string, variant: PaletteVariant = 'modern'): CurveStyle {
  const def = role ? catalog.get(role) : undefined;
  const display = def?.display;
  const entry = role ? (paletteEntry(role, variant) ?? undefined) : undefined;
  const trackBg = THEMES[theme].viewer.trackBg;
  let color: string;
  if (entry) color = entry[theme];
  else if (display?.color) color = ensureContrast(display.color, trackBg, 3);
  else color = categoricalColor(fallbackKey ?? role ?? '?', theme);
  const line = entry?.line ?? 'solid';
  const width = entry?.width ?? (variant === 'classic' ? CLASSIC_LINE_WIDTH : DEFAULT_WIDTH);
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

export function fillColor(id: FillId, theme: ThemeName, variant: PaletteVariant = 'modern'): { color: string; alpha: number } {
  const f = variant === 'classic' ? { ...FILL_PALETTE[id], ...CLASSIC_FILL_PALETTE[id] } : FILL_PALETTE[id];
  return { color: f[theme], alpha: f.alpha };
}
