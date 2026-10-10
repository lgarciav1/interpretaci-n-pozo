/**
 * Gráfico x–y genérico (docs/decisiones/0010-datos-de-corona.md, D6): ejes lineales o log en cada eje, grilla y
 * rótulos con unidad, capas de puntos (con color, variante lleno/vacío/descartado, nube tenue no interactiva), líneas,
 * guías verticales u horizontales y TENDENCIAS (la capa de la 6b-1). Tooltip al pasar, clic sobre un punto,
 * selección por rectángulo arrastrando y navegación con el teclado (←/→ recorren los puntos, Enter = clic, Esc).
 *
 * Lo usan el crossplot k–φ y la curva r(desplazamiento) de la corona; la fase 7 lo hereda para el crossplot libre (con
 * color por una tercera curva = `color(i)`, cutoffs = `guides` arrastrables) y el histograma.
 *
 *     <XYPlot x={{ kind: 'linear', min: 0, max: 0.3, label: 'Porosidad', unit: 'v/v' }}
 *             y={{ kind: 'log', min: 0.01, max: 10000, label: 'Permeabilidad', unit: 'mD' }}
 *             points={[{ id: 'plugs', x: phi, y: k, color: '#a21caf', interactive: true, label: (i) => ids[i] }]}
 *             trends={[{ id: 't1', coeffs, span, color, extend: true, label: ['k = 0,02·e^(50·φ)', 'R² 0,95'] }]}
 *             onPointClick={(layer, i) => …} onSelectRect={(r) => …} height={260} ariaLabel="Crossplot k–φ" />
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useCanvas } from '../../ui/canvas';
import { withAlpha } from '../../ui/color';
import { dataRectFromPx, nearestPoint, plotRectFor, validAxis, xyMapping, type DataRect, type XYAxis, type XYMapping } from './axes';
import { drawXYScene } from './draw';
import { registerXYFigure } from './figures';
import type { XYGuide, XYLineLayer, XYPointLayer, XYTrendLayer } from './layers';
import './xy.css';

export type { XYGuide, XYLineLayer, XYPointLayer, XYTrendLayer } from './layers';

export interface XYPlotProps {
  x: XYAxis;
  y: XYAxis;
  points?: readonly XYPointLayer[];
  lines?: readonly XYLineLayer[];
  trends?: readonly XYTrendLayer[];
  guides?: readonly XYGuide[];
  /** Alto en px (el ancho es el del contenedor). */
  height: number;
  /** Versión chica: sin títulos de ejes, rótulos más chicos. */
  compact?: boolean;
  ariaLabel: string;
  onPointClick?(layerId: string, index: number): void;
  /** Rectángulo elegido arrastrando (en datos). Sin esto, arrastrar no hace nada. */
  onSelectRect?(r: DataRect): void;
  /** Texto si no hay nada para dibujar. */
  emptyText?: string;
  className?: string;
  /** Si se da (con `figureTitle`), el gráfico se puede exportar como figura desde «Exportar» mientras está a la vista. */
  figureId?: string;
  figureTitle?: string;
  'data-testid'?: string;
}

interface Hover {
  layer: number;
  i: number;
}

const DRAG_MIN_PX = 5;

/** Puntos interactivos en orden de x (para el teclado). */
function keyboardOrder(layers: readonly XYPointLayer[]): Hover[] {
  const out: (Hover & { x: number })[] = [];
  layers.forEach((l, k) => {
    if (!l.interactive) return;
    const n = Math.min(l.x.length, l.y.length);
    for (let i = 0; i < n; i++) if (Number.isFinite(l.x[i]!) && Number.isFinite(l.y[i]!)) out.push({ layer: k, i, x: l.x[i]! });
  });
  return out.sort((a, b) => a.x - b.x || a.layer - b.layer || a.i - b.i).map(({ layer, i }) => ({ layer, i }));
}

export function XYPlot(props: XYPlotProps) {
  const { x: xAxis, y: yAxis, points = [], lines = [], trends = [], guides = [], height, compact = false } = props;
  const mapRef = useRef<XYMapping | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [focus, setFocus] = useState<Hover | null>(null);
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const drag = useRef<{ x0: number; y0: number; pointerId: number; moved: boolean } | null>(null);
  const order = useMemo(() => keyboardOrder(points), [points]);
  const ok = validAxis(xAxis) && validAxis(yAxis);
  const { figureId, figureTitle } = props;
  useEffect(() => {
    if (!figureId || !ok) return;
    return registerXYFigure({ id: figureId, title: figureTitle ?? figureId, x: xAxis, y: yAxis, points, lines, trends, guides });
  }, [figureId, figureTitle, ok, xAxis, yAxis, points, lines, trends, guides]);

  const canvasRef = useCanvas(
    (ctx, size, theme) => {
      const m = xyMapping(xAxis, yAxis, plotRectFor(size.width, size.height, compact));
      mapRef.current = m;
      if (!ok) return;
      drawXYScene(ctx, m, xAxis, yAxis, { points, lines, trends, guides }, theme, compact);
      // Punto bajo el puntero o con el foco del teclado: anillo.
      for (const h of [hover, focus]) {
        const l = h && points[h.layer];
        if (!l) continue;
        const px = m.x(l.x[h.i]!);
        const py = m.y(l.y[h.i]!);
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        ctx.strokeStyle = h === focus ? theme.color.focus : theme.color.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, (l.radius ?? 4) + 4, 0, 2 * Math.PI);
        ctx.stroke();
      }
      if (rect) {
        const x = Math.min(rect.x0, rect.x1);
        const y = Math.min(rect.y0, rect.y1);
        ctx.fillStyle = withAlpha(theme.color.accent, 0.1);
        ctx.strokeStyle = theme.color.accent;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.fillRect(x, y, Math.abs(rect.x1 - rect.x0), Math.abs(rect.y1 - rect.y0));
        ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(rect.x1 - rect.x0), Math.abs(rect.y1 - rect.y0));
      }
    },
    [xAxis, yAxis, points, lines, trends, guides, hover, focus, rect, compact, ok],
  );

  const pick = (px: number, py: number): Hover | null => {
    const m = mapRef.current;
    if (!m) return null;
    let best: Hover | null = null;
    let bestD = Infinity;
    points.forEach((l, k) => {
      if (!l.interactive) return;
      const xs = Array.from({ length: Math.min(l.x.length, l.y.length) }, (_, i) => m.x(l.x[i]!));
      const ys = Array.from(xs, (_, i) => m.y(l.y[i]!));
      const i = nearestPoint(xs, ys, px, py, 8);
      if (i < 0) return;
      const d = Math.hypot(xs[i]! - px, ys[i]! - py);
      if (d < bestD) {
        bestD = d;
        best = { layer: k, i };
      }
    });
    return best;
  };

  const local = (e: PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = local(e);
    drag.current = { x0: p.x, y0: p.y, pointerId: e.pointerId, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    const d = drag.current;
    if (d && d.pointerId === e.pointerId && props.onSelectRect) {
      if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) > DRAG_MIN_PX) d.moved = true;
      if (d.moved) {
        const r = mapRef.current?.rect;
        const cx = r ? Math.min(r.x + r.width, Math.max(r.x, p.x)) : p.x;
        const cy = r ? Math.min(r.y + r.height, Math.max(r.y, p.y)) : p.y;
        setRect({ x0: d.x0, y0: d.y0, x1: cx, y1: cy });
        setHover(null);
        return;
      }
    }
    const h = pick(p.x, p.y);
    setHover((prev) => (prev?.layer === h?.layer && prev?.i === h?.i ? prev : h));
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.moved && rect && mapRef.current && props.onSelectRect) {
      props.onSelectRect(dataRectFromPx(mapRef.current, rect.x0, rect.y0, rect.x1, rect.y1));
      setRect(null);
      return;
    }
    setRect(null);
    const p = local(e);
    const h = pick(p.x, p.y);
    if (h && props.onPointClick) props.onPointClick(points[h.layer]!.id, h.i);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === 'Escape') {
      if (rect || drag.current) {
        drag.current = null;
        setRect(null);
      } else setFocus(null);
      e.preventDefault();
      return;
    }
    if (order.length === 0) return;
    const at = focus ? order.findIndex((o) => o.layer === focus.layer && o.i === focus.i) : -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      setFocus(order[Math.min(order.length - 1, at + 1)]!);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      setFocus(order[Math.max(0, at < 0 ? 0 : at - 1)]!);
      e.preventDefault();
    } else if (e.key === 'Home' || e.key === 'End') {
      setFocus(order[e.key === 'Home' ? 0 : order.length - 1]!);
      e.preventDefault();
    } else if ((e.key === 'Enter' || e.key === ' ') && focus && props.onPointClick) {
      props.onPointClick(points[focus.layer]!.id, focus.i);
      e.preventDefault();
    }
  };

  const tip = hover ?? focus;
  const tipLayer = tip ? points[tip.layer] : undefined;
  const tipText = tipLayer?.label?.(tip!.i) ?? null;
  const m = mapRef.current;
  const tipPos = tip && tipLayer && m ? { x: m.x(tipLayer.x[tip.i]!), y: m.y(tipLayer.y[tip.i]!) } : null;
  const hasData = points.some((l) => l.x.length > 0) || lines.length > 0 || trends.length > 0;

  return (
    <div className={`xy-plot${props.className ? ` ${props.className}` : ''}`} style={{ height }} data-testid={props['data-testid']}>
      <canvas
        ref={canvasRef}
        className="xy-plot__canvas"
        tabIndex={0}
        role="img"
        aria-label={props.ariaLabel}
        aria-describedby={undefined}
        style={{ cursor: rect ? 'crosshair' : hover && props.onPointClick ? 'pointer' : props.onSelectRect ? 'crosshair' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => {
          drag.current = null;
          setRect(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setFocus(null)}
      />
      {!hasData && props.emptyText && <div className="xy-plot__empty">{props.emptyText}</div>}
      {tipText && tipPos && Number.isFinite(tipPos.x) && Number.isFinite(tipPos.y) && (
        <div className={`xy-plot__tip${tipPos.x > (m?.rect.x ?? 0) + (m?.rect.width ?? 0) * 0.6 ? ' is-left' : ''}`} style={{ left: tipPos.x, top: tipPos.y }} role="tooltip">
          {tipText}
        </div>
      )}
      <span className="ui-visually-hidden" aria-live="polite">
        {focus && tipText ? tipText : ''}
      </span>
    </div>
  );
}
