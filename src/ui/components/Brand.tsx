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
 * Colores: `BASE_TOKENS.brand` (iguales en los dos temas). Geometría: `../brandSvg.ts` (compartida con el informe).
 */
import { useId } from 'react';
import { BASE_TOKENS } from '../tokens';
import {
  BRAND_GRID_H as GRID_H,
  BRAND_GRID_V as GRID_V,
  BRAND_HEAT_STOPS,
  BRAND_STRATA as STRATA,
  BRAND_TRACE_COMPACT as TRACE_COMPACT,
  BRAND_TRACE_DETAIL as TRACE_DETAIL,
  brandFillOf as fillOf,
  brandStroke,
} from '../brandSvg';
import './brand.css';

export { PRODUCT_NAME } from '../brandSvg';

const B = BASE_TOKENS.brand;

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
  const stroke = brandStroke(full, size);
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
          {BRAND_HEAT_STOPS.map(([o, c]) => (
            <stop key={o} offset={o} stopColor={c} />
          ))}
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
