/**
 * Marca de fiubaLog (docs/decisiones/0070-marca.md).
 *
 * Un perfil de rayos gamma sobre papel de perfil: la traza blanca baja por el cuadro y separa la tinta (izquierda) del
 * relleno con el gradiente térmico (derecha), frío arriba y caliente en profundidad, como el gradiente geotérmico.
 * La curva tiene carácter de perfil real: arcilla a la derecha, arenas en bloque a la izquierda y, al pie, una
 * secuencia granocreciente (embudo).
 *
 * - `BrandMark`: el cuadro. Hasta 39 px usa la traza simplificada (se lee a 16 px); desde 40 px, la detallada con
 *   grilla, estratos, brillo y grano. `animate` dibuja la traza de arriba hacia abajo (solo si no se pidió reducir
 *   el movimiento).
 * - `BrandWordmark`: el cuadro y el nombre («fiuba» liviano, «Log» semibold).
 *
 * Colores: `BASE_TOKENS.brand` (iguales en los dos temas).
 */
import { useId } from 'react';
import { BASE_TOKENS } from '../tokens';
import './brand.css';

/** Nombre del producto. */
export const PRODUCT_NAME = 'fiubaLog';

const B = BASE_TOKENS.brand;

/** Traza compacta (viewBox 64): pocos quiebres, esquinas redondeadas. */
const TRACE_COMPACT =
  'M37 0 L37.4 10.4 Q37.5 13 34.97 13.61 L25.53 15.89 Q23 16.5 22.85 19.1 L22.65 22.4 Q22.5 25 25.05 25.51 L37.45 27.99 Q40 28.5 40 31.1 L40 33.4 Q40 36 37.48 36.66 L31.02 38.34 Q28.5 39 31 39.73 L38 41.77 Q40.5 42.5 38.46 44.11 L23.54 55.89 Q21.5 57.5 21.7 60.09 L22 64';

/** Traza detallada (viewBox 64): arcilla, arena en bloque, arcilla, arena delgada y embudo granocreciente. */
const TRACE_DETAIL =
  'M37 0 L37.37 4.41 Q37.5 6 37 7.5 Q36.5 9 37.52 10.23 L37.98 10.77 Q39 12 38.25 13.25 Q37.5 14.5 35.92 14.73 L25.58 16.27 Q24 16.5 23 17.75 Q22 19 22.72 20.43 L22.78 20.57 Q23.5 22 22.61 23.33 L22.39 23.67 Q21.5 25 22.96 25.65 L24.54 26.35 Q26 27 27.59 27.17 L38.41 28.33 Q40 28.5 40.5 30 Q41 31.5 39.87 32.63 L39.63 32.87 Q38.5 34 39.5 35.25 Q40.5 36.5 38.92 36.75 L29.58 38.25 Q28 38.5 28.75 39.5 Q29.5 40.5 31.09 40.71 L39.41 41.79 Q41 42 40.11 43.33 L39.89 43.67 Q39 45 37.63 45.82 L22.87 55.13 Q21 57 21.23 58.58 L22 64';

/** Cierra la traza por la derecha: el área del relleno térmico. */
const fillOf = (trace: string) => `${trace} L64 64 L64 0 Z`;

/** Estratos: contactos suavemente inclinados que cruzan el cuadro. */
const STRATA = ['M0 15.5 C18 14 40 17 64 15', 'M0 27.5 C20 26 42 29.5 64 27', 'M0 37.5 C18 36 44 39.5 64 37', 'M0 47 C16 45.5 44 49 64 46'];

/** Grilla de papel de perfil (solo se ve sobre la tinta): verticales cada 5, horizontales cada 4 (más marcada cada 5). */
const GRID_V = [5, 10, 15, 20, 25, 30];
const GRID_H = Array.from({ length: 16 }, (_, i) => 2 + i * 4);

export interface BrandMarkProps {
  /** Lado en px en el nivel Compacto (escala con el tamaño de interfaz). Por defecto 22. */
  size?: number;
  /** Forzar una versión. Por defecto: compacta hasta 39 px, detallada desde 40. */
  detail?: 'compact' | 'full';
  /** Dibuja la traza al montarse (Inicio). Sin efecto con movimiento reducido. */
  animate?: boolean;
  /** Si se da, la marca es significativa (role="img"); si no, es decorativa. */
  label?: string;
  className?: string;
}

export function BrandMark({ size = 22, detail, animate = false, label, className }: BrandMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const id = (k: string) => `brand-${uid}-${k}`;
  const full = (detail ?? (size >= 40 ? 'full' : 'compact')) === 'full';
  const trace = full ? TRACE_DETAIL : TRACE_COMPACT;
  // El trazo se afina con el tamaño: grueso en 16 px (si no, desaparece), fino en el emblema.
  const stroke = full ? (size >= 96 ? 1.8 : 2.2) : size <= 18 ? 4.2 : 3.4;
  const side = `calc(${size}px * var(--ui-scale, 1))`;
  const classes = ['ui-brand-mark', full ? 'is-full' : 'is-compact', animate ? 'is-animated' : '', className ?? ''].filter(Boolean).join(' ');

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      style={{ width: side, height: side }}
      viewBox="0 0 64 64"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false })}
    >
      <defs>
        <linearGradient id={id('ink')} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor={B.ink} />
          <stop offset="1" stopColor={B.inkDeep} />
        </linearGradient>
        <linearGradient id={id('heat')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={B.thermal1} />
          <stop offset="0.42" stopColor={B.thermal2} />
          <stop offset="0.75" stopColor={B.thermal3} />
          <stop offset="1" stopColor={B.thermal4} />
        </linearGradient>
        <linearGradient id={id('edge')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.24" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.16" />
        </linearGradient>
        <clipPath id={id('tile')}>
          <rect width="64" height="64" rx="15" />
        </clipPath>
        {full && (
          <>
            <radialGradient id={id('ember')} cx="0.7" cy="1.02" r="0.6">
              <stop offset="0" stopColor={B.thermal4} stopOpacity="0.55" />
              <stop offset="1" stopColor={B.thermal4} stopOpacity="0" />
            </radialGradient>
            <filter id={id('glow')} x="-50%" y="-10%" width="200%" height="120%">
              <feGaussianBlur stdDeviation="1.4" />
            </filter>
            {/* Grano (grainy gradient): ruido fractal monocromo, muy tenue, para que el gradiente no se vea plano. */}
            <filter id={id('grain')} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch" />
              <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0" />
            </filter>
          </>
        )}
      </defs>
      <g clipPath={`url(#${id('tile')})`}>
        <rect width="64" height="64" fill={`url(#${id('ink')})`} />
        {full && (
          <g className="ui-brand-mark__grid" stroke="#fff" strokeWidth="0.45">
            {GRID_V.map((x) => (
              <path key={`v${x}`} d={`M${x} 0V64`} strokeOpacity={x % 10 === 0 ? 0.11 : 0.06} />
            ))}
            {GRID_H.map((y, i) => (
              <path key={`h${y}`} d={`M0 ${y}H64`} strokeOpacity={i % 5 === 0 ? 0.11 : 0.05} />
            ))}
          </g>
        )}
        <g fill="none" stroke="#fff" strokeOpacity={full ? 0.12 : 0.1} strokeWidth="0.8">
          {(full ? STRATA : STRATA.slice(1, 3)).map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <path className="ui-brand-mark__fill" d={fillOf(trace)} fill={`url(#${id('heat')})`} />
        {full && <rect width="64" height="64" fill={`url(#${id('ember')})`} />}
        {full && <path className="ui-brand-mark__halo" d={trace} fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth={stroke + 2.4} filter={`url(#${id('glow')})`} pathLength={1} />}
        <path className="ui-brand-mark__trace" d={trace} fill="none" stroke="#fff" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
        {full && <rect className="ui-brand-mark__grain" width="64" height="64" filter={`url(#${id('grain')})`} opacity="0.09" />}
      </g>
      <rect x="0.5" y="0.5" width="63" height="63" rx="14.5" fill="none" stroke={`url(#${id('edge')})`} />
    </svg>
  );
}

export interface BrandWordmarkProps {
  /** Lado de la marca en px (Compacto). Por defecto 22. */
  size?: number;
  className?: string;
}

/** Marca y nombre: «fiuba» liviano y «Log» semibold. El tamaño de letra lo da el contenedor. */
export function BrandWordmark({ size = 22, className }: BrandWordmarkProps) {
  return (
    <span className={className ? `ui-wordmark ${className}` : 'ui-wordmark'}>
      <BrandMark size={size} />
      <BrandName />
    </span>
  );
}

/** Solo el nombre, con el mismo dibujo tipográfico del wordmark. */
export function BrandName({ className }: { className?: string }) {
  return (
    <span className={className ? `ui-wordmark__name ${className}` : 'ui-wordmark__name'}>
      <span className="ui-wordmark__a">fiuba</span>
      <span className="ui-wordmark__b">Log</span>
    </span>
  );
}
