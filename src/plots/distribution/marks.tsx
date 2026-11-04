/**
 * Capas DOM sobre los canvas de las distribuciones por zona (docs/decisiones/0066, V2): el cutoff (línea, lado que no
 * pasa sombreado y manija enfocable) y la banda de la selección por rango. Van en DOM y no en el canvas para que un
 * arrastre no vuelva a dibujar las cajas: solo se mueven estas capas (las cajas cambian cuando el motor recalcula).
 *
 * La posición sale de la fracción del eje en CSS (`--zd-pad`, el margen de `laneX`), así coincide con el canvas sin
 * medir nada; para pasar del puntero a un valor se mide el contenedor (`laneValue`).
 */
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { CutoffParamKey } from '../cutoffs';
import type { XYAxis } from '../xy/axes';
import type { GuidePhase } from '../xy/XYPlot';
import { laneFraction, laneValue } from './draw';
import { cutoffDragValue, nudgeCutoff } from './interact';

/** `left` en CSS de una fracción del eje dentro del área de las cajas. */
export const atFraction = (f: number): string => `calc(var(--zd-pad) + (100% - 2 * var(--zd-pad)) * ${f})`;
const spanFraction = (f: number): string => `calc((100% - 2 * var(--zd-pad)) * ${f})`;

/** Cómo se ve una marca de cutoff. */
export type CutTone = 'real' | 'inactive' | 'free';

export interface CutMark {
  value: number;
  tone: CutTone;
  /** Lado que pasa (cutoff real activo): se sombrea el otro. */
  side?: 'below' | 'above' | null;
  /** La zona tiene su propio valor (manija rellena); si no, sigue al global (hueca). */
  own?: boolean;
  /** Nombre accesible y tooltip. */
  label: string;
  /** Valor como texto (aria-valuetext). */
  text: string;
}

interface GripProps {
  axis: XYAxis;
  param: CutoffParamKey | null;
  mark: CutMark;
  ui: number;
  variant: 'row' | 'axis';
  onChange(value: number, phase: GuidePhase): void;
  'data-testid'?: string;
}

/**
 * Manija de un cutoff (role="slider"). Puntero: arrastrar = vista previa en cada movimiento y 'commit' al soltar;
 * Escape durante el arrastre = 'cancel'. Teclado: las flechas mueven (vista previa, un solo deshacer), Enter confirma,
 * Escape vuelve al valor de antes y salir de la manija confirma. Mayús = pasos de a 10.
 */
export function CutGrip({ axis, param, mark, ui, variant, onChange, ...rest }: GripProps) {
  const drag = useRef<{ pointerId: number; start: number; moved: boolean } | null>(null);
  const keyed = useRef<number | null>(null);
  const latest = useRef({ value: mark.value, onChange });
  latest.current = { value: mark.value, onChange };
  // Si la manija desaparece en medio de un gesto de teclado (cambió la propiedad, se cerró el panel), se confirma.
  useEffect(
    () => () => {
      if (keyed.current !== null) latest.current.onChange(latest.current.value, 'commit');
    },
    [],
  );
  const f = laneFraction(axis, mark.value);
  if (!Number.isFinite(f)) return null;
  const valueAt = (e: PointerEvent<HTMLElement>) => {
    const host = e.currentTarget.parentElement!;
    const r = host.getBoundingClientRect();
    return cutoffDragValue(axis, param, laneValue(axis, r.width, e.clientX - r.left, ui));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowDown') {
      const steps = (k === 'ArrowRight' || k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
      if (keyed.current === null) keyed.current = mark.value;
      onChange(nudgeCutoff(axis, param, mark.value, steps), 'preview');
    } else if (k === 'Enter') {
      if (keyed.current === null) return;
      keyed.current = null;
      onChange(mark.value, 'commit');
    } else if (k === 'Escape') {
      if (drag.current) {
        const { start, moved } = drag.current;
        drag.current = null;
        if (moved) onChange(start, 'cancel');
      } else if (keyed.current !== null) {
        const start = keyed.current;
        keyed.current = null;
        onChange(start, 'cancel');
      } else return; // sin gesto propio: Escape sigue su camino (limpiar la selección)
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      className={`zdist-grip is-${variant} is-${mark.tone}${mark.own ? ' is-own' : ''}`}
      style={{ left: atFraction(f) }}
      title={mark.label}
      aria-label={`${mark.label}. Flechas para mover, Mayús para pasos largos, Enter confirma, Escape vuelve atrás`}
      aria-orientation="horizontal"
      aria-valuemin={axis.min}
      aria-valuemax={axis.max}
      aria-valuenow={mark.value}
      aria-valuetext={mark.text}
      data-testid={rest['data-testid']}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.focus();
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* id ya soltado: sin captura */
        }
        drag.current = { pointerId: e.pointerId, start: mark.value, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d?.pointerId !== e.pointerId) return;
        const v = valueAt(e);
        // Hasta que el valor cambia no hay gesto: un clic en la manija no escribe nada (ni crea un valor propio).
        if (!d.moved && v === d.start) return;
        d.moved = true;
        onChange(v, 'preview');
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (d?.pointerId !== e.pointerId) return;
        drag.current = null;
        if (d.moved) onChange(valueAt(e), 'commit');
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) onChange(d.start, 'cancel');
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (keyed.current === null) return;
        keyed.current = null;
        onChange(mark.value, 'commit');
      }}
    >
      {variant === 'axis' && <span className="zdist-grip__value num">{mark.text}</span>}
    </div>
  );
}

/** Banda de un rango [a, b] del eje (selección por rango). */
export function Band({ axis, range, className }: { axis: XYAxis; range: readonly [number, number]; className?: string }) {
  const fa = laneFraction(axis, Math.min(range[0], range[1]));
  const fb = laneFraction(axis, Math.max(range[0], range[1]));
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  return <div className={`zdist-band${className ? ` ${className}` : ''}`} style={{ left: atFraction(fa), width: spanFraction(Math.max(0, fb - fa)) }} aria-hidden="true" />;
}

/** Línea del cutoff y el lado que no pasa, sombreado (solo un cutoff real activo). */
export function CutLine({ axis, mark }: { axis: XYAxis; mark: CutMark }) {
  const f = laneFraction(axis, mark.value);
  if (!Number.isFinite(f)) return null;
  // El lado que NO pasa: a la derecha de un máximo (Vsh, Sw), a la izquierda de un mínimo (φ, k).
  const shade: CSSProperties | null = mark.tone === 'real' && mark.side ? (mark.side === 'below' ? { left: atFraction(f), right: 0 } : { left: 0, width: atFraction(f) }) : null;
  return (
    <>
      {shade && <div className="zdist-shade" style={shade} aria-hidden="true" />}
      <div className={`zdist-cut is-${mark.tone}`} style={{ left: atFraction(f) }} aria-hidden="true" />
    </>
  );
}
