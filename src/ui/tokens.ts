/**
 * TOKENS DE DISEÑO — fuente de verdad única (ver docs/decisiones/0004-sistema-de-diseno.md, D1).
 *
 * - `BASE_TOKENS`: lo que no depende del tema (tipografía, espaciado, radios, capas, movimiento, medidas).
 * - `THEMES.light` / `THEMES.dark`: colores semánticos, sombras y colores del visor (canvas).
 *
 * El CSS se genera de acá (`tokensToCss`, `installTokens`): `color.textMuted` → `var(--color-text-muted)`,
 * `space['4']` → `var(--space-4)`. El canvas lee los objetos directamente: `getThemeTokens().viewer.gridMajor`.
 * Puro: sin DOM salvo `installTokens`.
 */

// ---------------------------------------------------------------------------------------------------------------
// Tokens base (independientes del tema)

const SANS =
  '"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, Roboto, system-ui, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';

export const BASE_TOKENS = {
  font: { sans: SANS, mono: MONO },
  /** Tamaños de letra en px. La app es densa: el cuerpo es `md` (13 px). */
  text: { xs: 11, sm: 12, md: 13, lg: 14, xl: 16, '2xl': 20, '3xl': 26 },
  leading: { tight: 1.25, normal: 1.45, relaxed: 1.6 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  tracking: { tight: '-0.011em', normal: '0', wide: '0.06em' },
  /** Escala de espaciado en px (base 4). */
  space: { '0': 0, '0-5': 2, '1': 4, '1-5': 6, '2': 8, '2-5': 10, '3': 12, '4': 16, '5': 20, '6': 24, '8': 32, '10': 40, '12': 48 },
  radius: { xs: 4, sm: 6, md: 8, lg: 12, xl: 16, full: 999 },
  /** Capas. Todo lo flotante usa estas, nunca números sueltos. */
  z: { base: 0, raised: 1, sticky: 10, dock: 20, resizer: 30, home: 50, popover: 100, tooltip: 200, modal: 300, toast: 400 },
  /** Duraciones en ms. Con `prefers-reduced-motion: reduce` el CSS generado las pone en 0. */
  dur: { instant: 60, fast: 120, base: 180, slow: 280, flash: 700 },
  ease: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    enter: 'cubic-bezier(0, 0, 0.2, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
  /** Medidas de controles y del armazón, en px. */
  size: {
    controlSm: 26,
    controlMd: 30,
    controlLg: 36,
    iconSm: 14,
    iconMd: 16,
    iconLg: 20,
    topbar: 52,
    flowbar: 52,
    rail: 40,
    sidebarLeft: 292,
    sidebarRight: 368,
    dock: 260,
  },
} as const;

/** Unidad CSS de cada grupo numérico de BASE_TOKENS ('' = sin unidad). */
const BASE_UNITS: Record<keyof typeof BASE_TOKENS, string> = {
  font: '',
  text: 'px',
  leading: '',
  weight: '',
  tracking: '',
  space: 'px',
  radius: 'px',
  z: '',
  dur: 'ms',
  ease: '',
  size: 'px',
};

// ---------------------------------------------------------------------------------------------------------------
// Tamaño de interfaz (docs/decisiones/0013-tamano-de-interfaz.md)

/**
 * Niveles del tamaño de interfaz. `BASE_TOKENS` es el nivel Compacto (factor 1, la densidad original de la app); los
 * otros multiplican texto, espaciado y medidas por su factor. Radios, bordes, capas y movimiento no escalan.
 * Las figuras exportadas usan siempre `BASE_TOKENS` (factor 1): no dependen de este nivel.
 */
export type UiScale = 'compact' | 'normal' | 'large';

export interface UiScaleDef {
  id: UiScale;
  /** Rótulo en la interfaz. */
  label: string;
  /** Multiplicador de texto, espaciado y medidas (Compacto = 1). */
  factor: number;
}

export const UI_SCALES: readonly UiScaleDef[] = [
  { id: 'compact', label: 'Compacto', factor: 1 },
  { id: 'normal', label: 'Normal', factor: 1.125 },
  { id: 'large', label: 'Grande', factor: 1.25 },
];

/** Factor de un nivel (1 si no se conoce). */
export function uiScaleFactor(scale: UiScale): number {
  return UI_SCALES.find((s) => s.id === scale)?.factor ?? 1;
}

/** Una medida de Compacto (px) llevada a un factor, redondeada a px enteros (texto y bordes nítidos). */
export function scalePx(px: number, factor: number): number {
  return px === 0 || factor === 1 ? px : Math.round(px * factor);
}

/** Grupos de `BASE_TOKENS` que cambian con el tamaño de interfaz. */
export const SCALED_GROUPS = ['text', 'space', 'size'] as const;
type ScaledGroup = (typeof SCALED_GROUPS)[number];

/** Texto, espaciado y medidas de un nivel (en px), con las mismas claves que `BASE_TOKENS`. Puro. */
export function scaledTokens(scale: UiScale): { [G in ScaledGroup]: { [K in keyof (typeof BASE_TOKENS)[G]]: number } } {
  const f = uiScaleFactor(scale);
  const map = <T extends Record<string, number>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, scalePx(v, f)])) as { [K in keyof T]: number };
  return { text: map(BASE_TOKENS.text), space: map(BASE_TOKENS.space), size: map(BASE_TOKENS.size) };
}

/**
 * Fuente para canvas a un factor: `canvasFont(BASE_TOKENS.text.xs, 600, f)` → '600 12px "Segoe UI…"'. Con factor 1
 * (figuras exportadas) da exactamente la misma cadena que antes de existir el tamaño de interfaz.
 */
export function canvasFont(px: number, weight: number = BASE_TOKENS.weight.regular, factor = 1): string {
  return `${weight} ${scalePx(px, factor)}px ${BASE_TOKENS.font.sans}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Temas

export type ThemeName = 'light' | 'dark';

export interface ThemeColors {
  /** Fondo de la aplicación (detrás de los paneles). */
  bg: string;
  /** Paneles. */
  surface: string;
  /** Zonas hundidas dentro de un panel (cabeceras de tabla, campos). */
  surfaceSubtle: string;
  /** Popovers, menús, diálogos. */
  surfaceRaised: string;
  surfaceHover: string;
  surfaceActive: string;
  /** Tooltips. */
  surfaceInverse: string;
  border: string;
  borderSubtle: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  /** Solo para texto no esencial (placeholders): contraste bajo a propósito. */
  textSubtle: string;
  textInverse: string;
  textOnAccent: string;
  accent: string;
  accentHover: string;
  accentActive: string;
  accentSoft: string;
  accentSoftHover: string;
  accentBorder: string;
  /** Acento usado como texto (enlaces, valores seleccionados): contraste ≥ 4,5 sobre `surface`. */
  accentText: string;
  focus: string;
  ok: string;
  okText: string;
  okSoft: string;
  okBorder: string;
  warn: string;
  warnText: string;
  warnSoft: string;
  warnBorder: string;
  error: string;
  errorText: string;
  errorSoft: string;
  errorBorder: string;
  info: string;
  infoText: string;
  infoSoft: string;
  infoBorder: string;
  overlay: string;
  scrollbar: string;
  scrollbarHover: string;
  selection: string;
}

export interface ThemeShadows {
  xs: string;
  sm: string;
  md: string;
  lg: string;
}

/** Colores del visor y de los gráficos (canvas). */
export interface ViewerColors {
  trackBg: string;
  trackBgAlt: string;
  trackBorder: string;
  gridMajor: string;
  gridMinor: string;
  axisText: string;
  depthText: string;
  cursor: string;
  cursorLabelBg: string;
  cursorLabelText: string;
  selection: string;
  /** Patrón de tramos sin dato. */
  nullPattern: string;
  /** Opacidad de las bandas de zona sobre las pistas (0–1). */
  zoneAlpha: number;
}

/**
 * Colores de la vista 3D de la sarta (docs/decisiones/0033, D8). Los lee la escena (WebGL), no el CSS: no generan
 * variables. Las cáscaras de profundidad de investigación usan el color de la curva (`curveStyle`), no estos.
 */
export interface SceneColors {
  /** Fondo de la vista. */
  bg: string;
  /** Formación: superficie exterior, caras del corte y estratos alternados. */
  formation: string;
  formationAlt: string;
  formationCut: string;
  /** Pared del pozo (cara interior de la formación). */
  wall: string;
  /** Lodo dentro del pozo (translúcido). */
  mud: string;
  /** Revoque contra la pared en las capas permeables y filtrado de la zona invadida (0033 D9). */
  mudcake: string;
  filtrate: string;
  /** Metal de la cabeza, uniones, flejes y brazos. */
  steel: string;
  steelDark: string;
  /** Acero del cuerpo de una herramienta prendida (el color de la familia va en sus anillos). */
  toolBody: string;
  cable: string;
  /** Patín de las herramientas apoyadas contra la pared. */
  pad: string;
  /** Herramienta apagada (gris mate). */
  off: string;
  /** Aristas de una herramienta planificada sin datos en el pozo. */
  outline: string;
  /** Regla de escala radial y sus rótulos. */
  ruler: string;
  /** Anillos identificadores por familia de herramienta (y la lista). */
  familyGamma: string;
  familyNuclear: string;
  familyResistivity: string;
  familyAcoustic: string;
  familyNmr: string;
  familyBorehole: string;
  familyOther: string;
}

export interface ThemeTokens {
  name: ThemeName;
  color: ThemeColors;
  shadow: ThemeShadows;
  viewer: ViewerColors;
  scene: SceneColors;
}

const light: ThemeTokens = {
  name: 'light',
  color: {
    bg: '#f3f4f6',
    surface: '#ffffff',
    surfaceSubtle: '#f8f9fa',
    surfaceRaised: '#ffffff',
    surfaceHover: '#f0f2f4',
    surfaceActive: '#e6e9ed',
    surfaceInverse: '#1b1e24',
    border: '#e1e4e8',
    borderSubtle: '#ebedf0',
    borderStrong: '#c9ced5',
    text: '#15181d',
    textMuted: '#5a636e',
    textSubtle: '#8b939d',
    textInverse: '#f3f4f6',
    textOnAccent: '#ffffff',
    accent: '#4f55d8',
    accentHover: '#444ac6',
    accentActive: '#3a3fb2',
    accentSoft: '#eef0fd',
    accentSoftHover: '#e2e5fb',
    accentBorder: '#c3c7f4',
    accentText: '#3e44c2',
    focus: '#5a61e6',
    ok: '#1e9e57',
    okText: '#16773f',
    okSoft: '#e8f6ee',
    okBorder: '#b6e1c6',
    warn: '#e0a100',
    warnText: '#8a5600',
    warnSoft: '#fdf5e1',
    warnBorder: '#efd697',
    error: '#d93a35',
    errorText: '#b3241f',
    errorSoft: '#fdeceb',
    errorBorder: '#f4c1be',
    info: '#2f80d1',
    infoText: '#1c62a8',
    infoSoft: '#e9f2fb',
    infoBorder: '#bbd5f1',
    overlay: 'rgba(17, 19, 24, 0.42)',
    scrollbar: '#cfd4da',
    scrollbarHover: '#b3b9c2',
    selection: 'rgba(79, 85, 216, 0.18)',
  },
  shadow: {
    xs: '0 1px 1px rgba(16, 24, 40, 0.04)',
    sm: '0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.04)',
    md: '0 6px 16px -4px rgba(16, 24, 40, 0.12), 0 2px 4px -2px rgba(16, 24, 40, 0.06)',
    lg: '0 24px 56px -12px rgba(16, 24, 40, 0.30), 0 6px 16px -6px rgba(16, 24, 40, 0.12)',
  },
  viewer: {
    trackBg: '#ffffff',
    trackBgAlt: '#fafbfc',
    trackBorder: '#d6dae0',
    gridMajor: '#dde1e6',
    gridMinor: '#eff1f4',
    axisText: '#5a636e',
    depthText: '#15181d',
    cursor: '#4f55d8',
    cursorLabelBg: '#15181d',
    cursorLabelText: '#ffffff',
    selection: 'rgba(79, 85, 216, 0.12)',
    nullPattern: '#c3c8cf',
    zoneAlpha: 0.14,
  },
  scene: {
    bg: '#eef0f3',
    formation: '#d6cdbf',
    formationAlt: '#c9beac',
    formationCut: '#ddd5c8',
    wall: '#a8916f',
    mud: '#7d8a99',
    mudcake: '#6b5a45',
    filtrate: '#6f9cc7',
    steel: '#b4bcc6',
    steelDark: '#6e7782',
    toolBody: '#5a626c',
    cable: '#2b3038',
    pad: '#2f343b',
    off: '#adb3ba',
    outline: '#4f55d8',
    ruler: '#2b3038',
    familyGamma: '#5f9e6e',
    familyNuclear: '#c0675c',
    familyResistivity: '#5b7fc0',
    familyAcoustic: '#8a6bbd',
    familyNmr: '#3f9a9a',
    familyBorehole: '#8d949c',
    familyOther: '#9a8f7c',
  },
};

const dark: ThemeTokens = {
  name: 'dark',
  color: {
    bg: '#0b0c0f',
    surface: '#131518',
    surfaceSubtle: '#0f1114',
    surfaceRaised: '#1a1d21',
    surfaceHover: '#1c1f23',
    surfaceActive: '#24282d',
    surfaceInverse: '#eceef1',
    border: '#24282e',
    borderSubtle: '#1c1f24',
    borderStrong: '#353a42',
    text: '#e8eaed',
    textMuted: '#9aa2ad',
    textSubtle: '#6b737e',
    textInverse: '#15181d',
    textOnAccent: '#ffffff',
    accent: '#5e64e6',
    accentHover: '#6d73ee',
    accentActive: '#5359d6',
    accentSoft: 'rgba(110, 118, 255, 0.14)',
    accentSoftHover: 'rgba(110, 118, 255, 0.22)',
    accentBorder: 'rgba(124, 131, 255, 0.42)',
    accentText: '#a5aaff',
    focus: '#8086ff',
    ok: '#34c472',
    okText: '#62d896',
    okSoft: 'rgba(52, 196, 114, 0.13)',
    okBorder: 'rgba(52, 196, 114, 0.36)',
    warn: '#f2b42c',
    warnText: '#f5c55a',
    warnSoft: 'rgba(242, 180, 44, 0.12)',
    warnBorder: 'rgba(242, 180, 44, 0.36)',
    error: '#f0605a',
    errorText: '#ff8a85',
    errorSoft: 'rgba(240, 96, 90, 0.13)',
    errorBorder: 'rgba(240, 96, 90, 0.40)',
    info: '#4ea1f5',
    infoText: '#82bdf8',
    infoSoft: 'rgba(78, 161, 245, 0.13)',
    infoBorder: 'rgba(78, 161, 245, 0.38)',
    overlay: 'rgba(0, 0, 0, 0.62)',
    scrollbar: '#30353c',
    scrollbarHover: '#454b54',
    selection: 'rgba(124, 131, 255, 0.30)',
  },
  shadow: {
    xs: '0 1px 1px rgba(0, 0, 0, 0.30)',
    sm: '0 1px 2px rgba(0, 0, 0, 0.45)',
    md: '0 8px 20px -6px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)',
    lg: '0 28px 64px -12px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.06)',
  },
  viewer: {
    trackBg: '#111316',
    trackBgAlt: '#14171a',
    trackBorder: '#2a2e35',
    gridMajor: '#2a2f36',
    gridMinor: '#1b1e23',
    axisText: '#9aa2ad',
    depthText: '#e8eaed',
    cursor: '#8086ff',
    cursorLabelBg: '#e8eaed',
    cursorLabelText: '#111316',
    selection: 'rgba(128, 134, 255, 0.16)',
    nullPattern: '#3a3f47',
    zoneAlpha: 0.18,
  },
  scene: {
    bg: '#0e1013',
    formation: '#4a433a',
    formationAlt: '#3f3931',
    formationCut: '#544b40',
    wall: '#3f352a',
    mud: '#4a5a6c',
    mudcake: '#2a231b',
    filtrate: '#3a6487',
    steel: '#b9c2cc',
    steelDark: '#76808c',
    toolBody: '#6b737e',
    cable: '#c9ced5',
    pad: '#2a2e35',
    off: '#4b5058',
    outline: '#8086ff',
    ruler: '#d6dae0',
    familyGamma: '#6fb37f',
    familyNuclear: '#d27b70',
    familyResistivity: '#6f93d6',
    familyAcoustic: '#a084d2',
    familyNmr: '#55b3b3',
    familyBorehole: '#9aa1aa',
    familyOther: '#a99e8b',
  },
};

export const THEMES: Readonly<Record<ThemeName, ThemeTokens>> = { light, dark };

// ---------------------------------------------------------------------------------------------------------------
// Generación de CSS

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Nombre de la variable CSS de un token: cssVarName('color', 'textMuted') → '--color-text-muted'. */
export function cssVarName(group: string, key: string): string {
  return `--${kebab(group)}-${kebab(key)}`;
}

function baseDeclarations(): string[] {
  const out: string[] = [];
  for (const [group, values] of Object.entries(BASE_TOKENS)) {
    const unit = BASE_UNITS[group as keyof typeof BASE_TOKENS];
    for (const [key, value] of Object.entries(values)) {
      const v = typeof value === 'number' && unit && value !== 0 ? `${value}${unit}` : String(value);
      out.push(`${cssVarName(group, key)}: ${v};`);
    }
  }
  // Factor del tamaño de interfaz, para medidas sueltas del CSS que deben escalar: calc(18px * var(--ui-scale)).
  out.push('--ui-scale: 1;');
  return out;
}

/** Variables que cambian en un nivel de tamaño de interfaz (sobre `:root[data-ui-scale="…"]`). */
function scaleDeclarations(scale: UiScale): string[] {
  const t = scaledTokens(scale);
  const out: string[] = [];
  for (const group of SCALED_GROUPS) for (const [key, value] of Object.entries(t[group])) out.push(`${cssVarName(group, key)}: ${value === 0 ? '0' : `${value}px`};`);
  out.push(`--ui-scale: ${uiScaleFactor(scale)};`);
  return out;
}

function themeDeclarations(t: ThemeTokens): string[] {
  const out: string[] = [`color-scheme: ${t.name};`];
  for (const group of ['color', 'shadow', 'viewer'] as const) {
    for (const [key, value] of Object.entries(t[group])) out.push(`${cssVarName(group, key)}: ${String(value)};`);
  }
  return out;
}

/** Todas las variables que define el CSS generado (sin el `--`), para tests y validaciones. */
export function definedCssVars(): Set<string> {
  const names = new Set<string>();
  for (const decl of [...baseDeclarations(), ...themeDeclarations(light)]) {
    const m = /^(--[a-z0-9-]+):/.exec(decl);
    if (m) names.add(m[1]!);
  }
  return names;
}

/**
 * CSS completo de los tokens: base en `:root` (nivel Compacto), tema claro por defecto y en `[data-theme="light"]`,
 * oscuro en `[data-theme="dark"]` (en `<html>` o en cualquier subárbol), un bloque por nivel de tamaño de interfaz en
 * `:root[data-ui-scale="…"]` y duraciones en 0 con movimiento reducido.
 */
export function tokensToCss(): string {
  const block = (sel: string, decls: string[]) => `${sel} {\n  ${decls.join('\n  ')}\n}`;
  const zeroDurations = Object.keys(BASE_TOKENS.dur).map((k) => `${cssVarName('dur', k)}: 0ms;`);
  return [
    block(':root', baseDeclarations()),
    block(':root, [data-theme="light"]', themeDeclarations(light)),
    block('[data-theme="dark"]', themeDeclarations(dark)),
    ...UI_SCALES.filter((s) => s.factor !== 1).map((s) => block(`:root[data-ui-scale="${s.id}"]`, scaleDeclarations(s.id))),
    `@media (prefers-reduced-motion: reduce) {\n${block(':root', zeroDurations)}\n}`,
  ].join('\n\n');
}

/** Inserta (una sola vez) el `<style id="ui-tokens">` con las variables. Llamar antes del primer render. */
export function installTokens(doc: Document = document): void {
  if (doc.getElementById('ui-tokens')) return;
  const style = doc.createElement('style');
  style.id = 'ui-tokens';
  style.textContent = tokensToCss();
  doc.head.prepend(style);
}
