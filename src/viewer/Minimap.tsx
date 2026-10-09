/**
 * Minimapa: el pozo entero en una columna angosta (curva resumen + zonas) con el rectángulo de la ventana visible.
 * Arrastrar el rectángulo navega; un clic en otro lado centra la vista ahí (y se puede seguir arrastrando).
 * Teclado: es un control deslizante (role="slider"): ↑/↓ desplazan un décimo de ventana, Re Pág/Av Pág una
 * ventana, Inicio/Fin van al tope y a la base.
 *
 * El canvas se redibuja solo si cambian la curva, las zonas, el tema o el tamaño; la ventana se mueve escribiendo
 * estilos directo (`setWindow`, llamado por el visor en cada cuadro), sin re-render de React.
 */
import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { formatNumber, withAlpha } from '../ui';
import { THEMES, type ThemeName } from '../ui/tokens';
import { minimapDepth, minimapRows, windowRect, type MinimapScale } from './minimap';
import type { ViewerZone } from './overlay';
import type { ResolvedCurve } from './resolve';
import { fractionArray } from './scale';

export interface MinimapHandle {
  /** Ubica la ventana visible (m). */
  setWindow(top: number, base: number): void;
}

export interface MinimapProps {
  depth: Float64Array;
  curve: ResolvedCurve | null;
  zones: readonly ViewerZone[];
  theme: ThemeName;
  /** Desplaza el visor para que su tope quede en `top` (m). */
  onScrollTo(top: number): void;
  /** Cualquier interacción (corta la animación de carga). */
  onInteract?(): void;
  /** Alto del encabezado (el mismo de los encabezados de pista, para que el cuerpo arranque alineado). */
  headHeight?: number;
  ref?: Ref<MinimapHandle>;
}

const fmt = (d: number) => formatNumber(d, { digits: 0, grouping: false });

export function Minimap({ depth, curve, zones, theme, onScrollTo, onInteract, headHeight, ref }: MinimapProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const view = useRef<{ top: number; base: number } | null>(null);
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);

  const scale = useCallback((): MinimapScale => ({ min: depth[0] ?? 0, max: depth[depth.length - 1] ?? 1, height }), [depth, height]);

  const place = useCallback(() => {
    const v = view.current;
    const win = winRef.current;
    const box = boxRef.current;
    if (!v || !win || !box || height <= 0) return;
    const r = windowRect(scale(), v.top, v.base);
    win.style.transform = `translateY(${r.y}px)`;
    win.style.height = `${r.h}px`;
    const s = scale();
    box.setAttribute('aria-valuenow', String(Math.round((v.top + v.base) / 2)));
    box.setAttribute('aria-valuetext', `Vista de ${fmt(Math.max(s.min, v.top))} a ${fmt(Math.min(s.max, v.base))} m, de un pozo de ${fmt(s.min)} a ${fmt(s.max)} m`);
  }, [scale, height]);

  useImperativeHandle(ref, () => ({
    setWindow(top: number, base: number) {
      const v = view.current;
      if (v && v.top === top && v.base === base) return;
      view.current = { top, base };
      place();
    },
  }), [place]);

  // Alto disponible.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setHeight(box.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Dibujo: zonas y curva resumen (mín–máx por fila de píxel).
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box || height <= 0) return;
    const width = box.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = THEMES[theme];
    ctx.fillStyle = t.viewer.trackBg;
    ctx.fillRect(0, 0, width, height);
    const s = scale();
    const y = (d: number) => ((d - s.min) / (s.max - s.min || 1)) * height;
    const STRIP = 4;
    for (const z of zones) {
      const y0 = y(z.top);
      const y1 = Math.max(y0 + 1, y(z.base));
      ctx.fillStyle = withAlpha(z.color, t.viewer.zoneAlpha * 0.9);
      ctx.fillRect(STRIP, y0, width - STRIP, y1 - y0);
      ctx.fillStyle = z.color;
      ctx.fillRect(0, y0, STRIP, y1 - y0);
    }
    if (curve) {
      const rows = Math.max(1, Math.round(height));
      const { min, max } = minimapRows(depth, fractionArray(curve.data, curve.axis), rows);
      const x0 = STRIP + 3;
      const w = width - x0 - 3;
      ctx.fillStyle = curve.styles[theme].color;
      for (let r = 0; r < rows; r++) {
        const lo = min[r]!;
        if (lo !== lo) continue;
        const hi = max[r]!;
        ctx.fillRect(x0 + lo * w, (r * height) / rows, Math.max(1, (hi - lo) * w), height / rows + 0.5);
      }
    }
    place();
  }, [depth, curve, zones, theme, height, scale, place]);

  const span = () => {
    const v = view.current;
    return v ? v.base - v.top : 0;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    onInteract?.();
    const box = boxRef.current;
    const v = view.current;
    if (!box || !v) return;
    const s = scale();
    const yLocal = e.clientY - box.getBoundingClientRect().top;
    const r = windowRect(s, v.top, v.base);
    const inside = yLocal >= r.y && yLocal <= r.y + r.h;
    // Dentro del rectángulo: se agarra donde está. Afuera: se centra ahí y se sigue arrastrando desde el centro.
    const offset = inside ? yLocal - r.y : r.h / 2;
    if (!inside) onScrollTo(minimapDepth(s, yLocal) - span() / 2);
    drag.current = { pointerId: e.pointerId, offset };
    e.currentTarget.setPointerCapture(e.pointerId);
    box.dataset['dragging'] = '';
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || d.pointerId !== e.pointerId || !box) return;
    const yTop = e.clientY - box.getBoundingClientRect().top - d.offset;
    const s = scale();
    // El rectángulo puede tener alto mínimo: se navega por su centro.
    const r = view.current ? windowRect(s, view.current.top, view.current.base) : { h: 0 };
    onScrollTo(minimapDepth(s, yTop + r.h / 2) - span() / 2);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    delete boxRef.current?.dataset['dragging'];
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const v = view.current;
    if (!v) return;
    const s = scale();
    const w = v.base - v.top;
    let top: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') top = v.top + w * (e.shiftKey ? 0.5 : 0.1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') top = v.top - w * (e.shiftKey ? 0.5 : 0.1);
    else if (e.key === 'PageDown') top = v.top + w * 0.9;
    else if (e.key === 'PageUp') top = v.top - w * 0.9;
    else if (e.key === 'Home') top = s.min;
    else if (e.key === 'End') top = s.max;
    if (top === null) return;
    e.preventDefault();
    onInteract?.();
    onScrollTo(top);
  };

  const s = scale();
  return (
    <div className="wv-mini">
      <div className="wv-mini__head" style={headHeight ? { height: headHeight } : undefined} title={curve ? `Minimapa: ${curve.title}` : 'Minimapa del pozo'}>
        <span className="wv-mini__title">Pozo</span>
        {curve && (
          <span className="wv-mini__curve" style={{ color: curve.styles[theme].color }}>
            {curve.name}
          </span>
        )}
      </div>
      <div
        ref={boxRef}
        className="wv-mini__body"
        role="slider"
        tabIndex={0}
        aria-label="Minimapa del pozo: ventana visible"
        aria-orientation="vertical"
        aria-valuemin={Math.round(s.min)}
        aria-valuemax={Math.round(s.max)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvasRef} className="wv-mini__canvas" aria-hidden="true" />
        <div ref={winRef} className="wv-mini__window" aria-hidden="true" />
      </div>
    </div>
  );
}
