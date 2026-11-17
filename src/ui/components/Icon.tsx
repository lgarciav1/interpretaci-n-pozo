/**
 * Íconos SVG propios, en línea (sin librería ni recursos remotos). Grilla de 24, trazo 1,75 px, `currentColor`.
 * Para agregar uno: una entrada en ICONS con sus trazos.
 */
import type { CSSProperties, ReactElement } from 'react';

const ICONS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  /** Intercambiar (ejes de un crossplot). */
  swap: <path d="M8 19V5M4.5 8.5L8 5l3.5 3.5M16 5v14M12.5 15.5L16 19l3.5-3.5" />,
  /** Invertir el sentido de una escala. */
  reverse: <path d="M4 12h16M7.5 8.5L4 12l3.5 3.5M16.5 8.5L20 12l-3.5 3.5" />,
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" />
    </>
  ),
  folder: <path d="M3.5 7.5A1.5 1.5 0 015 6h4.2l2 2.2H19a1.5 1.5 0 011.5 1.5v8.3A1.5 1.5 0 0119 19.5H5A1.5 1.5 0 013.5 18z" />,
  save: (
    <>
      <path d="M5 4h11l3 3v12a1 1 0 01-1 1H6a1 1 0 01-1-1z" />
      <path d="M8 4v5h7V4M8 20v-6h8v6" />
    </>
  ),
  /** Fijar (una profundidad, un valor). */
  pin: <path d="M9.5 4h5l-.8 5.2 3.3 3.3H7l3.3-3.3zM12 12.5V20" />,
  /** Perfil radial: anillos alrededor del pozo. */
  radial: (
    <>
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="9" strokeDasharray="2.5 2.5" />
    </>
  ),
  bookmark: <path d="M6.5 4h11v16L12 16l-5.5 4z" />,
  history: (
    <>
      <path d="M4 12a8 8 0 102.4-5.7L4 8.5" />
      <path d="M4 4v4.5h4.5M12 8v4.5l3 2" />
    </>
  ),
  /** Cronómetro: esfera con corona y aguja. */
  stopwatch: (
    <>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M10 3h4M12 3v3.5M12 13.5V10M18 7.5l1.3-1.3" />
    </>
  ),
  /** Cortina antes/después: marco partido por una línea con manija. */
  curtain: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M12 2.5v19" />
      <path d="M9.5 10l-2 2 2 2M14.5 10l2 2-2 2" />
    </>
  ),
  compare: (
    <>
      <path d="M8 4v16M16 4v16" />
      <path d="M4 8h4M16 16h4M4 16h4M16 8h4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </>
  ),
  /** Tamaño de interfaz: una «A» chica, mediana y grande. */
  'text-size-sm': <path d="M8.75 16.5L12 8.25l3.25 8.25M9.9 13.6h4.2" />,
  'text-size-md': <path d="M7.5 18L12 6.75 16.5 18M9.1 14.1h5.8" />,
  'text-size-lg': <path d="M6 19.5L12 4.5l6 15M8.2 14.6h7.6" />,
  moon: <path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  'expand-view': <path d="M8.5 3.5h-5v5M15.5 3.5h5v5M20.5 15.5v5h-5M8.5 20.5h-5v-5" />,
  'restore-view': <path d="M3.5 8.5h5v-5M20.5 8.5h-5v-5M15.5 20.5v-5h5M8.5 20.5v-5h-5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.4" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 014.9.7c0 1.7-2.5 2.1-2.5 3.6M12 16.8v.3" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 4.3a2 2 0 013.4 0l7 12.2a2 2 0 01-1.7 3H5a2 2 0 01-1.7-3z" />
      <path d="M12 9.5v4M12 16.6v.3" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.3l2.7 2.7L16 9.7" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
    </>
  ),
  skip: <path d="M6 6l7 6-7 6zM17 6v12" />,
  more: (
    <>
      <circle cx="6" cy="12" r="0.9" fill="currentColor" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
      <circle cx="18" cy="12" r="0.9" fill="currentColor" />
    </>
  ),
  'panel-left': (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  'panel-right': (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  'panel-bottom': (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 14.5h17" />
    </>
  ),
  layers: (
    <>
      <path d="M12 4l8.5 4.5L12 13 3.5 8.5z" />
      <path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" />
    </>
  ),
  well: (
    <>
      <path d="M12 3v18" />
      <path d="M8 6.5h2M14 9h2M8 11.5h2M14 14h2M8 16.5h2" />
      <path d="M9 3h6" />
    </>
  ),
  curve: <path d="M8 3c3 2-2 4 1 6s-3 4 0 6 4 2 1 6M15 3v18" />,
  tracks: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
      <path d="M9.5 4v16M15 4v16" />
      <path d="M6.5 7c1 2-1 3 0 5s-1 3 0 5M12 7c1 1.5 1 3-.5 5s0 3 1 5" />
    </>
  ),
  table: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10" />
    </>
  ),
  histogram: <path d="M4 20h16M6 20v-5M10 20V8M14 20v-9M18 20v-4" />,
  // Boxplots horizontales (distribuciones por zona): bigote, caja y mediana.
  boxplot: (
    <>
      <path d="M3 8h3M15 8h5M3 16h5M17 16h4M3 5v6M20 5v6M3 13v6M21 13v6M11 6v4M12 14v4" />
      <rect x="6" y="6" width="9" height="4" rx="1" />
      <rect x="8" y="14" width="9" height="4" rx="1" />
    </>
  ),
  trend: (
    <>
      <path d="M4 19.5L20 5" />
      <circle cx="7" cy="14.5" r="1" fill="currentColor" />
      <circle cx="10.5" cy="13.5" r="1" fill="currentColor" />
      <circle cx="13" cy="9" r="1" fill="currentColor" />
      <circle cx="17" cy="9.5" r="1" fill="currentColor" />
    </>
  ),
  pen: (
    <>
      <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 013 3L8 18.5z" />
      <path d="M13.5 7l3 3" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5" />
    </>
  ),
  scatter: (
    <>
      <path d="M4 4v16h16" />
      <circle cx="9" cy="14" r="1" fill="currentColor" />
      <circle cx="12" cy="10" r="1" fill="currentColor" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" />
      <circle cx="17" cy="7" r="1" fill="currentColor" />
    </>
  ),
  cpu: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
      <path d="M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21" />
    </>
  ),
  activity: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  droplet: <path d="M12 3.5s6 6.4 6 10.5a6 6 0 01-12 0C6 9.9 12 3.5 12 3.5z" />,
  sigma: <path d="M17 5H7l5.5 7L7 19h10" />,
  filter: <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />,
  mountain: <path d="M3 19l6.5-11 4 6.5 2-3L21 19z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.2M17.6 15.3l2.2 1.2M4.2 16.5l2.2-1.2M17.6 8.7l2.2-1.2" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  play: <path d="M7 5l12 7-12 7z" />,
  undo: (
    <>
      <path d="M9 14L4.5 9.5 9 5" />
      <path d="M4.5 9.5h10a5 5 0 010 10H11" />
    </>
  ),
  redo: (
    <>
      <path d="M15 14l4.5-4.5L15 5" />
      <path d="M19.5 9.5h-10a5 5 0 000 10H13" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 01-14 5.3M4 12a8 8 0 0114-5.3" />
      <path d="M18 3v3.7h-3.7M6 21v-3.7h3.7" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 12.5h9l1-12.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.9 5.8A9.8 9.8 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-2.6 3.4M6.4 7.4A16.6 16.6 0 002.5 12S6 18.5 12 18.5a9.4 9.4 0 004.6-1.2" />
      <path d="M9.9 10a2.8 2.8 0 004 4M4 4l16 16" />
    </>
  ),
  'zone-add': (
    <>
      <path d="M3.5 6h17M3.5 18h17" />
      <path d="M6 9.5h7v5H6z" />
      <path d="M17.5 9.5v5M15 12h5" />
    </>
  ),
  grip: (
    <>
      <circle cx="9.5" cy="7" r="0.9" fill="currentColor" />
      <circle cx="14.5" cy="7" r="0.9" fill="currentColor" />
      <circle cx="9.5" cy="12" r="0.9" fill="currentColor" />
      <circle cx="14.5" cy="12" r="0.9" fill="currentColor" />
      <circle cx="9.5" cy="17" r="0.9" fill="currentColor" />
      <circle cx="14.5" cy="17" r="0.9" fill="currentColor" />
    </>
  ),
  'zoom-in': (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5M10.5 8v5" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5" />
    </>
  ),
  'fit-height': <path d="M12 3.5v17M8.5 7L12 3.5 15.5 7M8.5 17l3.5 3.5 3.5-3.5M5 12h3M16 12h3" />,
  dot: <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />,
  /** Medir un intervalo: regla vertical con remates. */
  ruler: <path d="M8 3.5h8M8 20.5h8M12 3.5v17M12 8h3M12 12h4M12 16h3" />,
  /** Sarta de perfilaje: cable y herramientas apiladas. */
  'tool-string': (
    <>
      <path d="M12 2.5v3" />
      <rect x="9.5" y="5.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="12" width="5" height="4" rx="1" />
      <rect x="9.5" y="17.5" width="5" height="4" rx="1" />
      <path d="M14.5 13.5l3 1.5" />
    </>
  ),
  /** Vista inicial de una escena 3D: cubo con flecha de vuelta. */
  'view-reset': (
    <>
      <path d="M12 4l7 4v8l-7 4-7-4V8z" />
      <path d="M5 8l7 4 7-4M12 12v8" />
    </>
  ),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  /** Tamaño en px en el nivel Compacto (por defecto 16): escala con el tamaño de interfaz (`--ui-scale`). */
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  /** Si se da, el ícono es significativo (role="img"); si no, es decorativo (aria-hidden). */
  label?: string;
}

/** Lado de un ícono que sigue el tamaño de interfaz (`size` es la medida en Compacto). */
const scaledSide = (size: number) => `calc(${size}px * var(--ui-scale, 1))`;

export function Icon({ name, size = 16, strokeWidth = 1.75, className, style, label }: IconProps) {
  return (
    <svg
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: scaledSide(size), height: scaledSide(size), ...style }}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false })}
    >
      {ICONS[name]}
    </svg>
  );
}

