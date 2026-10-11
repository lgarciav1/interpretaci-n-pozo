/**
 * Gráfico x–y genérico (docs/decisiones/0010-datos-de-corona.md, D6; ampliado en la 0014): ejes lineales o log en cada
 * eje, grilla y rótulos con unidad, capas de puntos (con color, variante lleno/vacío/descartado, nube tenue, nube densa
 * de decenas de miles de puntos), barras (histograma), líneas (con eje derecho opcional), guías verticales u
 * horizontales —ARRASTRABLES con el mouse y el teclado (cutoffs)— y TENDENCIAS (la capa de la 6b-1). Tooltip al
 * pasar, clic sobre un punto, selección por rectángulo arrastrando, navegación con el teclado (←/→ recorren los puntos,
 * Enter = clic, Esc) y un punto resaltado desde afuera (el cursor del visor).
 *
 * Dibuja en dos canvas: la escena (cambia con los datos) y una capa de interacción encima (anillo del puntero, punto
 * resaltado, clase bajo el puntero, rectángulo de selección), así mover el puntero no redibuja miles de puntos.
 *
 *     <XYPlot x={{ kind: 'linear', min: 0, max: 0.3, label: 'Porosidad', unit: 'v/v' }}
 *             y={{ kind: 'log', min: 0.01, max: 10000, label: 'Permeabilidad', unit: 'mD' }}
 *             points={[{ id: 'plugs', x: phi, y: k, color: '#a21caf', interactive: true, label: (i) => ids[i] }]}
 *             guides={[{ id: 'phi', axis: 'x', value: 0.08, color, label: 'Cutoff global', draggable: true }]}
 *             onGuideChange={(id, v, phase) => …} onPointClick={(layer, i) => …} height={260} ariaLabel="Crossplot k–φ" />
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useCanvas } from '../../ui/canvas';
import { withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { getUiScaleFactor, scaledCss } from '../../ui/uiScale';
import { axisFraction, dataRectFromPx, distanceToPolylinePx, fractionValue, movePointPx, niceStep, plotRectFor, validAxis, xyMapping, type DataRect, type PlotRect, type XYAxis, type XYMapping } from './axes';
import { drawDensePoints, drawXYScene } from './draw';
import type { XYColorKey } from './figure';
import { registerXYFigure } from './figures';
import type { XYBarLayer, XYGuide, XYHandle, XYLineLayer, XYPointLayer, XYTrendLayer } from './layers';
import { buildPointGrid, gridNearest, type PointGrid } from './pick';
import { simplifyPath, type DataPolygon, type SelectionShape } from '../selection';
import './xy.css';

export type { XYBarLayer, XYGuide, XYHandle, XYLineLayer, XYPointLayer, XYTrendLayer } from './layers';

export type GuidePhase = 'preview' | 'commit' | 'cancel';

export interface XYPlotProps {
  x: XYAxis;
  y: XYAxis;
  /** Eje derecho para las líneas con `y2` (acumulada). */
  y2?: XYAxis;
  points?: readonly XYPointLayer[];
  lines?: readonly XYLineLayer[];
  trends?: readonly XYTrendLayer[];
  guides?: readonly XYGuide[];
  bars?: readonly XYBarLayer[];
  /**
   * Alto en px de Compacto (escala con el tamaño de interfaz; el ancho es el del contenedor), o 'fill': ocupa el alto
   * del contenedor (paneles del dock que se agrandan con el separador).
   */
  height: number | 'fill';
  /** Versión chica: sin títulos de ejes, rótulos más chicos. */
  compact?: boolean;
  ariaLabel: string;
  onPointClick?(layerId: string, index: number): void;
  /** Punto bajo el puntero (o con el foco del teclado); null al salir. */
  onPointHover?(layerId: string, index: number): void;
  onPointLeave?(): void;
  /** Clase del histograma bajo el puntero (índice de clase de las barras), o null al salir. */
  onBarHover?(bin: number | null): void;
  /** Texto del tooltip de una clase. */
  barLabel?(bin: number): string;
  /** Punto resaltado desde afuera (cursor del visor). */
  highlight?: { layerId: string; index: number } | null;
  /**
   * Rectángulo elegido arrastrando (en datos). Sin esto, arrastrar no hace nada. `additive`: con Mayús (sumar a la
   * selección vigente).
   */
  onSelectRect?(r: DataRect, additive: boolean): void;
  /** Selección vigente (en datos): queda dibujada hasta que el dueño la limpie. */
  selection?: DataRect | null;
  /**
   * Herramienta de selección al arrastrar (fase 8b, 0021): rectángulo (por defecto) o lazo a mano alzada. Con 'lasso'
   * hace falta `onSelectLasso`.
   */
  selectTool?: 'rect' | 'lasso';
  /** Lazo elegido arrastrando: polígono en datos (se cierra solo). `additive` con Mayús. */
  onSelectLasso?(poly: DataPolygon, additive: boolean): void;
  /** Formas de la selección vigente (rectángulos y lazos, en datos): contorno punteado en la capa de interacción. */
  selectionShapes?: readonly SelectionShape[] | null;
  /**
   * Puntos resaltados de una capa densa (selección compartida): `mask[k] = 1` resalta el punto k de la capa
   * `layerId`; el resto de esa capa se atenúa. Va en una capa propia entre la escena y la interacción: cambiar la
   * máscara no redibuja la escena. No sale en la figura exportada.
   */
  emphasis?: { layerId: string; mask: Uint8Array } | null;
  /** Clases del histograma marcadas (selección fija): franja tenue y borde. */
  markedBins?: readonly number[] | null;
  /** Clic sobre una clase del histograma (sin arrastre); `additive` con Mayús. */
  onBarClick?(bin: number, additive: boolean): void;
  /** Escape sin nada que cancelar en el gráfico (limpiar la selección). true si lo usó. */
  onEscape?(): boolean;
  /**
   * Guía arrastrable (`draggable` con `id`) movida: 'preview' en cada movimiento, 'commit' al soltar (y con cada
   * tecla), 'cancel' con Escape durante el arrastre (volver al valor de antes).
   */
  onGuideChange?(id: string, value: number, phase: GuidePhase): void;
  /** Supr o Retroceso sobre la manija de una guía. */
  onGuideRemove?(id: string): void;
  /** Manijas arrastrables en 2D (punto de matriz, recta de agua; docs/decisiones/0015). */
  handles?: readonly XYHandle[];
  /**
   * Manija (o su `grabPath`) arrastrada: posición nueva en datos. 'preview' en cada movimiento, 'commit' al soltar,
   * 'cancel' con Escape (vuelve a la posición de antes).
   */
  onHandleChange?(id: string, pos: { x: number; y: number }, phase: GuidePhase): void;
  /** Flecha sobre una manija: dirección EN PANTALLA (derecha y arriba = +1); `big` con Mayús. */
  onHandleNudge?(id: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1, big: boolean): void;
  /** Texto si no hay nada para dibujar. */
  emptyText?: string;
  className?: string;
  /** Si se da (con `figureTitle`), el gráfico se puede exportar como figura desde «Exportar» mientras está a la vista. */
  figureId?: string;
  figureTitle?: string;
  /** Barra de color de la figura exportada (color por una tercera curva). */
  colorKey?: XYColorKey;
  'data-testid'?: string;
}

interface Hover {
  layer: number;
  i: number;
}

const DRAG_MIN_PX = 5;
const NO_POINTS: readonly XYPointLayer[] = [];
const NO_LINES: readonly XYLineLayer[] = [];
const NO_TRENDS: readonly XYTrendLayer[] = [];
const NO_GUIDES: readonly XYGuide[] = [];
const NO_BARS: readonly XYBarLayer[] = [];
const NO_HANDLES: readonly XYHandle[] = [];
const GUIDE_HIT_PX = 6;
/** Distancia mínima (px) entre vértices del lazo mientras se dibuja. */
const LASSO_STEP_PX = 3;
/** Opacidad de los puntos NO seleccionados de una nube con selección resaltada (el resto, atenuado). */
const DIM_ALPHA = 0.16;

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

/** Redondeo «humano» de un valor arrastrado sobre un eje: paso 1-2-5 de 1/400 del rango (lineal) o 3 cifras (log). */
export function snapGuideValue(a: XYAxis, v: number, fine = 400): number {
  if (!Number.isFinite(v)) return v;
  if (a.kind === 'log') return +v.toPrecision(3);
  const step = niceStep((a.max - a.min) / fine);
  return +(Math.round(v / step) * step).toPrecision(12);
}

/**
 * Valor de una guía movida `steps` pasos con el teclado (1 % del eje; Mayús = 10 %). Los pasos van en la dirección
 * EN PANTALLA (derecha o arriba = positivo), también en ejes invertidos.
 */
export function nudgeGuideValue(a: XYAxis, v: number, steps: number): number {
  const f = axisFraction(a, v);
  const next = fractionValue(a, Math.min(1, Math.max(0, (Number.isFinite(f) ? f : 0.5) + steps * 0.01)));
  return snapGuideValue(a, next, 100);
}

export function XYPlot(props: XYPlotProps) {
  // Capas ausentes = listas vacías CONSTANTES (un `[]` nuevo en cada render redibujaría toda la escena).
  const { x: xAxis, y: yAxis, y2, points = NO_POINTS, lines = NO_LINES, trends = NO_TRENDS, guides = NO_GUIDES, bars = NO_BARS, handles = NO_HANDLES, height, compact = false } = props;
  const mapRef = useRef<XYMapping | null>(null);
  const gridRef = useRef<{ key: unknown; grids: (PointGrid | null)[] } | null>(null);
  const [geom, setGeom] = useState<PlotRect | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [hoverBin, setHoverBin] = useState<number | null>(null);
  const [focus, setFocus] = useState<Hover | null>(null);
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** Traza del lazo en curso (px). */
  const [lasso, setLasso] = useState<{ x: number; y: number }[] | null>(null);
  const [dragGuide, setDragGuide] = useState<{ id: string; value: number; start: number } | null>(null);
  const [hoverGuide, setHoverGuide] = useState<string | null>(null);
  const drag = useRef<{ x0: number; y0: number; pointerId: number; moved: boolean; path: { x: number; y: number }[] } | null>(null);
  const guideDrag = useRef<{ id: string; pointerId: number; start: number; axis: 'x' | 'y' } | null>(null);
  const handleDrag = useRef<{ id: string; pointerId: number; start: { x: number; y: number }; p0: { x: number; y: number } } | null>(null);
  const [dragHandle, setDragHandle] = useState<string | null>(null);
  const [hoverHandle, setHoverHandle] = useState<string | null>(null);
  const order = useMemo(() => keyboardOrder(points), [points]);
  const ok = validAxis(xAxis) && validAxis(yAxis) && (!y2 || validAxis(y2));
  const { figureId, figureTitle, colorKey } = props;
  const tool = props.selectTool ?? 'rect';

  // Guías con el valor del arrastre en curso (vista previa inmediata, sin esperar al dueño).
  const shownGuides = useMemo(() => (dragGuide ? guides.map((g) => (g.id === dragGuide.id ? { ...g, value: dragGuide.value } : g)) : guides), [guides, dragGuide]);

  useEffect(() => {
    if (!figureId || !ok) return;
    return registerXYFigure({ id: figureId, title: figureTitle ?? figureId, x: xAxis, y: yAxis, points, lines, trends, guides, bars, ...(y2 ? { y2 } : {}), ...(colorKey ? { colorKey } : {}) });
  }, [figureId, figureTitle, ok, xAxis, yAxis, y2, points, lines, trends, guides, bars, colorKey]);

  // Con una selección resaltada, su capa se dibuja atenuada en la escena. Solo cambia al prender o apagar el resaltado,
  // no con cada selección nueva: la máscara va en la capa intermedia.
  const emphLayer = props.emphasis?.layerId ?? null;
  const scenePoints = useMemo(() => (emphLayer ? points.map((l) => (l.id === emphLayer && l.dense ? { ...l, alpha: DIM_ALPHA } : l)) : points), [points, emphLayer]);

  const canvasRef = useCanvas(
    (ctx, size, theme, ui) => {
      const m = xyMapping(xAxis, yAxis, plotRectFor(size.width, size.height, compact, ui, !!y2));
      mapRef.current = m;
      gridRef.current = null;
      setGeom((g) => (g && g.x === m.rect.x && g.y === m.rect.y && g.width === m.rect.width && g.height === m.rect.height ? g : m.rect));
      if (!ok) return;
      drawXYScene(ctx, m, xAxis, yAxis, { points: scenePoints, lines, trends, guides: shownGuides, bars, ...(y2 ? { y2 } : {}) }, theme, compact, ui);
    },
    [xAxis, yAxis, y2, scenePoints, lines, trends, shownGuides, bars, compact, ok],
  );

  // Capa intermedia: puntos de la selección a pleno y clases marcadas. Se redibuja con la selección, no con el puntero.
  const emphasis = props.emphasis ?? null;
  const markedBins = props.markedBins ?? null;
  const midRef = useCanvas(
    (ctx, size, theme, ui) => {
      if (!ok || (!emphasis && !markedBins?.length)) return;
      const m = xyMapping(xAxis, yAxis, plotRectFor(size.width, size.height, compact, ui, !!y2));
      const r = m.rect;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.width, r.height);
      ctx.clip();
      const b0 = bars[0];
      if (markedBins?.length && b0) {
        for (const j of markedBins) {
          const xa = m.x(b0.edges[j]!);
          const xb = m.x(b0.edges[j + 1]!);
          if (!Number.isFinite(xa) || !Number.isFinite(xb)) continue;
          ctx.fillStyle = withAlpha(theme.color.accent, 0.1);
          ctx.fillRect(Math.min(xa, xb), r.y, Math.abs(xb - xa), r.height);
          ctx.strokeStyle = withAlpha(theme.color.accent, 0.85);
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(Math.min(xa, xb) + 0.75, r.y + 0.75, Math.abs(xb - xa) - 1.5, r.height - 1.5);
          ctx.setLineDash([]);
        }
      }
      const l = emphasis ? points.find((q) => q.id === emphasis.layerId) : undefined;
      if (l && emphasis) {
        const mask = emphasis.mask;
        drawDensePoints(ctx, m, l, theme, { only: (i) => mask[i] === 1, alpha: theme.name === 'dark' ? 0.95 : 0.9 });
      }
      ctx.restore();
    },
    [emphasis, markedBins, points, bars, xAxis, yAxis, y2, compact, ok],
  );

  const ext = props.highlight ?? null;
  const extHover = useMemo<Hover | null>(() => {
    if (!ext) return null;
    const k = points.findIndex((l) => l.id === ext.layerId);
    return k >= 0 && ext.index >= 0 ? { layer: k, i: ext.index } : null;
  }, [ext, points]);

  const topRef = useCanvas(
    (ctx, _size, theme) => {
      const m = mapRef.current;
      if (!m || !ok) return;
      const r = m.rect;
      // Clase del histograma bajo el puntero.
      const b0 = bars[0];
      if (hoverBin !== null && b0) {
        const xa = m.x(b0.edges[hoverBin]!);
        const xb = m.x(b0.edges[hoverBin + 1]!);
        if (Number.isFinite(xa) && Number.isFinite(xb)) {
          ctx.fillStyle = withAlpha(theme.color.accent, 0.12);
          ctx.fillRect(Math.min(xa, xb), r.y, Math.abs(xb - xa), r.height);
          ctx.strokeStyle = withAlpha(theme.color.accent, 0.6);
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.min(xa, xb) + 0.5, r.y + 0.5, Math.abs(xb - xa) - 1, r.height - 1);
        }
      }
      // Punto resaltado desde afuera (cursor del visor): cruz fina + anillo.
      if (extHover) {
        const l = points[extHover.layer];
        const px = l ? m.x(l.x[extHover.i]!) : NaN;
        const py = l ? m.y(l.y[extHover.i]!) : NaN;
        if (Number.isFinite(px) && Number.isFinite(py)) {
          ctx.save();
          ctx.strokeStyle = withAlpha(theme.viewer.cursor, 0.45);
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.round(px) + 0.5, r.y);
          ctx.lineTo(Math.round(px) + 0.5, r.y + r.height);
          ctx.moveTo(r.x, Math.round(py) + 0.5);
          ctx.lineTo(r.x + r.width, Math.round(py) + 0.5);
          ctx.stroke();
          ctx.restore();
          ctx.strokeStyle = theme.viewer.cursor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, (l!.radius ?? 4) + 4, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
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
      // Guía bajo el puntero o arrastrándose: trazo más grueso.
      const gid = dragGuide?.id ?? hoverGuide;
      const g = gid ? shownGuides.find((q) => q.id === gid) : undefined;
      if (g) {
        ctx.strokeStyle = withAlpha(g.color, 0.35);
        ctx.lineWidth = 6;
        ctx.beginPath();
        if (g.axis === 'x') {
          const px = m.x(g.value);
          ctx.moveTo(px, r.y);
          ctx.lineTo(px, r.y + r.height);
        } else {
          const py = m.y(g.value);
          ctx.moveTo(r.x, py);
          ctx.lineTo(r.x + r.width, py);
        }
        ctx.stroke();
      }
      // Recta de una manija bajo el puntero o arrastrándose: trazo más grueso.
      const hid = dragHandle ?? hoverHandle;
      const hh = hid ? handles.find((q) => q.id === hid) : undefined;
      if (hh?.grabPath) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.width, r.height);
        ctx.clip();
        ctx.strokeStyle = withAlpha(hh.color, 0.3);
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        let pen = false;
        const n = Math.min(hh.grabPath.x.length, hh.grabPath.y.length);
        for (let k = 0; k < n; k++) {
          const px = m.x(hh.grabPath.x[k]!);
          const py = m.y(hh.grabPath.y[k]!);
          if (!Number.isFinite(px) || !Number.isFinite(py)) {
            pen = false;
            continue;
          }
          if (pen) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
          pen = true;
        }
        ctx.stroke();
        ctx.restore();
      }
      const shapes = props.selectionShapes;
      if (shapes?.length && !rect && !lasso) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.width, r.height);
        ctx.clip();
        ctx.strokeStyle = theme.color.accent;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        for (const q of shapes) {
          ctx.beginPath();
          if (q.kind === 'rect') {
            const xa = m.x(q.rect.xMin);
            const xb = m.x(q.rect.xMax);
            const ya = m.y(q.rect.yMin);
            const yb = m.y(q.rect.yMax);
            if (![xa, xb, ya, yb].every(Number.isFinite)) continue;
            ctx.rect(Math.min(xa, xb) + 0.5, Math.min(ya, yb) + 0.5, Math.abs(xb - xa), Math.abs(yb - ya));
          } else {
            const n = Math.min(q.poly.x.length, q.poly.y.length);
            for (let k = 0; k < n; k++) {
              const px = m.x(q.poly.x[k]!);
              const py = m.y(q.poly.y[k]!);
              if (k === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
          }
          ctx.stroke();
        }
        ctx.restore();
      }
      if (lasso && lasso.length > 1) {
        ctx.save();
        ctx.fillStyle = withAlpha(theme.color.accent, 0.1);
        ctx.strokeStyle = theme.color.accent;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        lasso.forEach((q, k) => (k === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      const sel = props.selection;
      if (sel && !rect && !lasso) {
        const xa = m.x(sel.xMin);
        const xb = m.x(sel.xMax);
        const ya = m.y(sel.yMin);
        const yb = m.y(sel.yMax);
        if ([xa, xb, ya, yb].every(Number.isFinite)) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(r.x, r.y, r.width, r.height);
          ctx.clip();
          ctx.strokeStyle = theme.color.accent;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(Math.min(xa, xb) + 0.5, Math.min(ya, yb) + 0.5, Math.abs(xb - xa), Math.abs(yb - ya));
          ctx.restore();
        }
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
    [hover, focus, extHover, hoverBin, rect, lasso, dragGuide, hoverGuide, shownGuides, points, bars, ok, geom, xAxis, yAxis, props.selection, props.selectionShapes, handles, dragHandle, hoverHandle],
  );

  /** Grillas de búsqueda por capa interactiva (se arman la primera vez que hacen falta tras un dibujo). */
  const grids = (): (PointGrid | null)[] => {
    const m = mapRef.current;
    if (!m) return [];
    if (gridRef.current && gridRef.current.key === points) return gridRef.current.grids;
    const g = points.map((l) => (l.interactive ? buildPointGrid(l.x, l.y, m) : null));
    gridRef.current = { key: points, grids: g };
    return g;
  };

  const pick = (px: number, py: number): Hover | null => {
    const gs = grids();
    let best: Hover | null = null;
    let bestD = 8 * getUiScaleFactor();
    gs.forEach((g, k) => {
      if (!g) return;
      const hit = gridNearest(g, px, py, bestD);
      if (hit && hit.d <= bestD) {
        bestD = hit.d;
        best = { layer: k, i: hit.i };
      }
    });
    return best;
  };

  const pickGuide = (px: number, py: number): XYGuide | null => {
    const m = mapRef.current;
    if (!m || !props.onGuideChange) return null;
    const tol = GUIDE_HIT_PX * getUiScaleFactor();
    let best: XYGuide | null = null;
    let bestD = tol;
    for (const g of shownGuides) {
      if (!g.draggable || !g.id) continue;
      const d = g.axis === 'x' ? Math.abs(m.x(g.value) - px) : Math.abs(m.y(g.value) - py);
      if (d <= bestD) {
        bestD = d;
        best = g;
      }
    }
    return best;
  };

  /** Manija cuya recta (`grabPath`) está bajo el puntero, dentro del área del gráfico. */
  const pickHandlePath = (px: number, py: number): XYHandle | null => {
    const m = mapRef.current;
    if (!m || !props.onHandleChange) return null;
    const r = m.rect;
    if (px < r.x || px > r.x + r.width || py < r.y || py > r.y + r.height) return null;
    let best: XYHandle | null = null;
    let bestD = GUIDE_HIT_PX * getUiScaleFactor();
    for (const h of handles) {
      if (!h.grabPath || h.disabled) continue;
      const d = distanceToPolylinePx(m, h.grabPath.x, h.grabPath.y, px, py);
      if (d <= bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  };

  const startHandleDrag = (h: XYHandle, pointerId: number, p0: { x: number; y: number }) => {
    handleDrag.current = { id: h.id, pointerId, start: { x: h.x, y: h.y }, p0 };
    setDragHandle(h.id);
    setHoverPoint(null);
  };

  const pickBin = (px: number, py: number, forClick = false): number | null => {
    const m = mapRef.current;
    const b = bars[0];
    if (!m || !b || (!props.onBarHover && !forClick)) return null;
    const r = m.rect;
    if (px < r.x || px > r.x + r.width || py < r.y || py > r.y + r.height) return null;
    const v = m.xInv(px);
    for (let j = 0; j < b.edges.length - 1; j++) {
      const lo = Math.min(b.edges[j]!, b.edges[j + 1]!);
      const hi = Math.max(b.edges[j]!, b.edges[j + 1]!);
      if (v >= lo && v <= hi) return j;
    }
    return null;
  };

  const local = (e: PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  const guideValueAt = (axis: 'x' | 'y', p: { x: number; y: number }) => {
    const m = mapRef.current!;
    const r = m.rect;
    const a = axis === 'x' ? xAxis : yAxis;
    const v = axis === 'x' ? m.xInv(Math.min(r.x + r.width, Math.max(r.x, p.x))) : m.yInv(Math.min(r.y + r.height, Math.max(r.y, p.y)));
    return snapGuideValue(a, v);
  };

  // Los avisos al dueño van FUERA de los actualizadores de estado: un actualizador corre durante el render y avisar
  // desde ahí actualizaría otros componentes en pleno render (el visor y la barra leen la conexión con los gráficos).
  const hoverRef = useRef<Hover | null>(null);
  const binRef = useRef<number | null>(null);
  const setHoverPoint = (h: Hover | null) => {
    const prev = hoverRef.current;
    if (prev?.layer === h?.layer && prev?.i === h?.i) return;
    hoverRef.current = h;
    setHover(h);
    if (h) props.onPointHover?.(points[h.layer]!.id, h.i);
    else if (prev) props.onPointLeave?.();
  };
  const setBin = (j: number | null) => {
    if (binRef.current === j) return;
    binRef.current = j;
    setHoverBin(j);
    props.onBarHover?.(j);
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = local(e);
    const hp = pickHandlePath(p.x, p.y);
    if (hp) {
      startHandleDrag(hp, e.pointerId, p);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    const g = pickGuide(p.x, p.y);
    if (g) {
      guideDrag.current = { id: g.id!, pointerId: e.pointerId, start: g.value, axis: g.axis };
      setDragGuide({ id: g.id!, value: g.value, start: g.value });
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    drag.current = { x0: p.x, y0: p.y, pointerId: e.pointerId, moved: false, path: [p] };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    const hd = handleDrag.current;
    if (hd && hd.pointerId === e.pointerId) {
      if (mapRef.current) props.onHandleChange?.(hd.id, movePointPx(mapRef.current, hd.start, hd.p0, p), 'preview');
      return;
    }
    const gd = guideDrag.current;
    if (gd && gd.pointerId === e.pointerId) {
      const v = guideValueAt(gd.axis, p);
      setDragGuide((d) => (d && d.value === v ? d : { id: gd.id, value: v, start: gd.start }));
      props.onGuideChange?.(gd.id, v, 'preview');
      return;
    }
    const d = drag.current;
    const useLasso = tool === 'lasso' && !!props.onSelectLasso;
    if (d && d.pointerId === e.pointerId && (useLasso || props.onSelectRect)) {
      if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) > DRAG_MIN_PX) d.moved = true;
      if (d.moved) {
        const r = mapRef.current?.rect;
        const cx = r ? Math.min(r.x + r.width, Math.max(r.x, p.x)) : p.x;
        const cy = r ? Math.min(r.y + r.height, Math.max(r.y, p.y)) : p.y;
        if (useLasso) {
          const last = d.path[d.path.length - 1]!;
          if (Math.hypot(cx - last.x, cy - last.y) >= LASSO_STEP_PX) {
            d.path.push({ x: cx, y: cy });
            setLasso(d.path.slice());
          }
        } else setRect({ x0: d.x0, y0: d.y0, x1: cx, y1: cy });
        setHoverPoint(null);
        setBin(null);
        return;
      }
    }
    const hp = d ? null : pickHandlePath(p.x, p.y);
    setHoverHandle(hp?.id ?? null);
    if (hp) {
      setHoverGuide(null);
      setHoverPoint(null);
      setBin(null);
      return;
    }
    const g = d ? null : pickGuide(p.x, p.y);
    setHoverGuide(g?.id ?? null);
    if (g) {
      setHoverPoint(null);
      setBin(null);
      return;
    }
    setHoverPoint(pick(p.x, p.y));
    setBin(pickBin(p.x, p.y));
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const hd = handleDrag.current;
    if (hd && hd.pointerId === e.pointerId) {
      handleDrag.current = null;
      setDragHandle(null);
      if (mapRef.current) props.onHandleChange?.(hd.id, movePointPx(mapRef.current, hd.start, hd.p0, local(e)), 'commit');
      return;
    }
    const gd = guideDrag.current;
    if (gd && gd.pointerId === e.pointerId) {
      guideDrag.current = null;
      const v = guideValueAt(gd.axis, local(e));
      setDragGuide(null);
      props.onGuideChange?.(gd.id, v, 'commit');
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d || d.pointerId !== e.pointerId) return;
    const m = mapRef.current;
    if (d.moved && tool === 'lasso' && m && props.onSelectLasso) {
      const path = simplifyPath(d.path, 2);
      setLasso(null);
      if (path.length >= 3) props.onSelectLasso({ x: path.map((q) => m.xInv(q.x)), y: path.map((q) => m.yInv(q.y)) }, e.shiftKey);
      return;
    }
    if (d.moved && rect && m && props.onSelectRect) {
      props.onSelectRect(dataRectFromPx(m, rect.x0, rect.y0, rect.x1, rect.y1), e.shiftKey);
      setRect(null);
      return;
    }
    setRect(null);
    setLasso(null);
    if (d.moved) return;
    const p = local(e);
    const h = pick(p.x, p.y);
    if (h && props.onPointClick) {
      props.onPointClick(points[h.layer]!.id, h.i);
      return;
    }
    const j = props.onBarClick ? pickBin(p.x, p.y, true) : null;
    if (j !== null) props.onBarClick!(j, e.shiftKey);
  };
  const cancelGuideDrag = () => {
    const hd = handleDrag.current;
    if (hd) {
      handleDrag.current = null;
      setDragHandle(null);
      props.onHandleChange?.(hd.id, hd.start, 'cancel');
      return true;
    }
    const gd = guideDrag.current;
    if (!gd) return false;
    guideDrag.current = null;
    setDragGuide(null);
    props.onGuideChange?.(gd.id, gd.start, 'cancel');
    return true;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === 'Escape') {
      if (cancelGuideDrag()) {
        e.preventDefault();
        return;
      }
      if (rect || lasso || drag.current) {
        drag.current = null;
        setRect(null);
        setLasso(null);
      } else if (focus) setFocus(null);
      // Sin nada propio que cancelar: el dueño (limpiar la selección); si tampoco, el evento sigue su camino.
      else if (!props.onEscape?.()) return;
      e.preventDefault();
      return;
    }
    if (order.length === 0) return;
    const at = focus ? order.findIndex((o) => o.layer === focus.layer && o.i === focus.i) : -1;
    let next: Hover | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = order[Math.min(order.length - 1, at + 1)]!;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = order[Math.max(0, at < 0 ? 0 : at - 1)]!;
    else if (e.key === 'Home' || e.key === 'End') next = order[e.key === 'Home' ? 0 : order.length - 1]!;
    else if ((e.key === 'Enter' || e.key === ' ') && focus && props.onPointClick) {
      props.onPointClick(points[focus.layer]!.id, focus.i);
      e.preventDefault();
    }
    if (next) {
      setFocus(next);
      props.onPointHover?.(points[next.layer]!.id, next.i);
      e.preventDefault();
    }
  };

  const canvasCursor = (): string => {
    if (dragHandle) return 'grabbing';
    if (hoverHandle) return 'grab';
    const g = dragGuide ? { axis: guideDrag.current?.axis } : hoverGuide ? shownGuides.find((q) => q.id === hoverGuide) : null;
    if (g) return g.axis === 'y' ? 'ns-resize' : 'ew-resize';
    if (rect || lasso) return 'crosshair';
    if (hover && props.onPointClick) return 'pointer';
    if (hoverBin !== null && props.onBarClick) return 'pointer';
    return props.onSelectRect || props.onSelectLasso ? 'crosshair' : 'default';
  };

  const tip = hover ?? focus;
  const tipLayer = tip ? points[tip.layer] : undefined;
  const tipText = tipLayer?.label?.(tip!.i) ?? null;
  // Mapeo de ESTE render (ejes actuales + rectángulo medido): el de `mapRef` es el del último dibujo, que todavía no
  // corrió si los ejes acaban de cambiar (otra curva, otra plantilla) y dejaría las manijas en el lugar viejo.
  const m = useMemo(() => (geom && ok ? xyMapping(xAxis, yAxis, geom) : null), [geom, ok, xAxis, yAxis]);
  const tipPos = tip && tipLayer && m ? { x: m.x(tipLayer.x[tip.i]!), y: m.y(tipLayer.y[tip.i]!) } : null;
  const barTip = hoverBin !== null && props.barLabel && m && bars[0] ? props.barLabel(hoverBin) : null;
  const barPos = barTip && m && bars[0] ? { x: Math.max(m.x(bars[0].edges[hoverBin!]!), m.x(bars[0].edges[hoverBin! + 1]!)), y: m.rect.y + 6 } : null;
  const hasData = points.some((l) => l.x.length > 0) || lines.length > 0 || trends.length > 0 || bars.some((b) => b.values.length > 0);
  const draggable = props.onGuideChange && geom && m ? shownGuides.filter((g) => g.draggable && g.id) : [];

  return (
    <div className={`xy-plot${props.className ? ` ${props.className}` : ''}`} style={{ height: height === 'fill' ? '100%' : scaledCss(height) }} data-testid={props['data-testid']}>
      <canvas ref={canvasRef} className="xy-plot__canvas" aria-hidden="true" />
      <canvas ref={midRef} className="xy-plot__canvas xy-plot__mid" aria-hidden="true" />
      <canvas
        ref={topRef}
        className="xy-plot__canvas xy-plot__top"
        tabIndex={0}
        role="img"
        aria-label={props.ariaLabel}
        style={{
          cursor: canvasCursor(),
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHoverPoint(null);
          setBin(null);
          setHoverGuide(null);
          setHoverHandle(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setRect(null);
          setLasso(null);
          cancelGuideDrag();
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (focus) props.onPointLeave?.();
          setFocus(null);
        }}
      />
      {draggable.map((g) => {
        const a = g.axis === 'x' ? xAxis : yAxis;
        const r = geom!;
        const pos = g.axis === 'x' ? { left: m!.x(g.value), top: r.y + r.height } : { left: r.x, top: m!.y(g.value) };
        if (!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null;
        const name = g.label ?? 'Cutoff';
        return (
          <div
            key={g.id}
            role="slider"
            tabIndex={0}
            className={`xy-plot__grip is-${g.axis}`}
            style={{ left: pos.left, top: pos.top, ['--grip' as string]: g.color }}
            aria-label={`${name} (${a.label}). Flechas para mover, Mayús para pasos largos${g.removable === false || !props.onGuideRemove ? '' : ', Supr para quitar'}`}
            aria-orientation={g.axis === 'x' ? 'horizontal' : 'vertical'}
            aria-valuemin={a.min}
            aria-valuemax={a.max}
            aria-valuenow={g.value}
            aria-valuetext={formatNumber(g.value, { significant: 3 })}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).focus();
              const host = (e.currentTarget.parentElement?.querySelector('.xy-plot__top') as HTMLCanvasElement | null) ?? null;
              host?.setPointerCapture?.(e.pointerId);
              guideDrag.current = { id: g.id!, pointerId: e.pointerId, start: g.value, axis: g.axis };
              setDragGuide({ id: g.id!, value: g.value, start: g.value });
            }}
            onKeyDown={(e) => {
              const k = e.key;
              const inc = g.axis === 'x' ? ['ArrowRight', 'ArrowUp'] : ['ArrowUp', 'ArrowRight'];
              const dec = g.axis === 'x' ? ['ArrowLeft', 'ArrowDown'] : ['ArrowDown', 'ArrowLeft'];
              if (inc.includes(k) || dec.includes(k)) {
                const steps = (inc.includes(k) ? 1 : -1) * (e.shiftKey ? 10 : 1);
                // Con paso propio (parámetro): en la dirección en pantalla, que en un eje invertido es la opuesta.
                const v = g.step ? +(g.value + steps * g.step * (a.reversed ? -1 : 1)).toPrecision(12) : nudgeGuideValue(a, g.value, steps);
                // Solo 'commit' (sin gesto): las teclas seguidas se agrupan en deshacer por la ventana de 800 ms.
                props.onGuideChange?.(g.id!, v, 'commit');
                e.preventDefault();
              } else if ((k === 'Delete' || k === 'Backspace') && props.onGuideRemove && g.removable !== false) {
                props.onGuideRemove(g.id!);
                e.preventDefault();
              }
            }}
          />
        );
      })}
      {props.onHandleChange && geom && m
        ? handles.map((h) => {
            const r = geom;
            const rawX = m.x(h.x);
            const rawY = m.y(h.y);
            if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
            // Fuera del área (un valor fuera de los ejes): se muestra en el borde, igual se puede arrastrar.
            const left = Math.min(r.x + r.width, Math.max(r.x, rawX));
            const top = Math.min(r.y + r.height, Math.max(r.y, rawY));
            const fx = (left - r.x) / r.width;
            const fy = (top - r.y) / r.height;
            const wantLeft = h.labelAt?.x === 'left' ? fx > 0.38 : fx > 0.62;
            const wantBelow = h.labelAt?.y === 'below' ? fy < 0.8 : fy < 0.2;
            const side = wantLeft ? ' is-left' : '';
            const below = wantBelow ? ' is-below' : '';
            const active = dragHandle === h.id || hoverHandle === h.id;
            return (
              <div key={h.id} className="xy-plot__handle-host">
                <div
                  role="slider"
                  tabIndex={h.disabled ? -1 : 0}
                  aria-roledescription="manija arrastrable"
                  aria-label={h.ariaLabel}
                  aria-valuetext={h.valueText}
                  aria-disabled={h.disabled || undefined}
                  data-testid={`xy-handle-${h.id}`}
                  className={`xy-plot__handle is-${h.shape ?? 'circle'}${h.disabled ? ' is-disabled' : ''}${active ? ' is-active' : ''}`}
                  style={{ left, top, ['--grip' as string]: h.color, cursor: h.disabled ? 'not-allowed' : dragHandle === h.id ? 'grabbing' : (h.cursor ?? 'move') }}
                  onPointerDown={(e) => {
                    if (h.disabled || e.button !== 0) return;
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).focus();
                    const host = (e.currentTarget.closest('.xy-plot')?.querySelector('.xy-plot__top') as HTMLCanvasElement | null) ?? null;
                    if (!host) return;
                    host.setPointerCapture?.(e.pointerId);
                    const b = host.getBoundingClientRect();
                    startHandleDrag(h, e.pointerId, { x: e.clientX - b.left, y: e.clientY - b.top });
                  }}
                  onPointerEnter={() => setHoverHandle(h.id)}
                  onPointerLeave={() => setHoverHandle((v) => (v === h.id && !handleDrag.current ? null : v))}
                  onKeyDown={(e) => {
                    if (h.disabled) return;
                    const k = e.key;
                    const dx = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
                    const dy = k === 'ArrowUp' ? 1 : k === 'ArrowDown' ? -1 : 0;
                    if (dx || dy) {
                      props.onHandleNudge?.(h.id, dx, dy, e.shiftKey);
                      e.preventDefault();
                    } else if (k === 'Escape' && cancelGuideDrag()) e.preventDefault();
                  }}
                />
                <div className={`xy-plot__handle-label${side}${below}${active ? ' is-active' : ''}`} style={{ left, top, ['--grip' as string]: h.color }} aria-hidden="true">
                  <span>{h.label}</span>
                  {h.detail && <span className="xy-plot__handle-detail">{h.detail}</span>}
                </div>
              </div>
            );
          })
        : null}
      {!hasData && props.emptyText && <div className="xy-plot__empty">{props.emptyText}</div>}
      {tipText && tipPos && Number.isFinite(tipPos.x) && Number.isFinite(tipPos.y) && (
        <div className={`xy-plot__tip${tipPos.x > (m?.rect.x ?? 0) + (m?.rect.width ?? 0) * 0.6 ? ' is-left' : ''}`} style={{ left: tipPos.x, top: tipPos.y }} role="tooltip">
          {tipText}
        </div>
      )}
      {!tipText && barTip && barPos && Number.isFinite(barPos.x) && (
        <div className={`xy-plot__tip is-bar${barPos.x > (m?.rect.x ?? 0) + (m?.rect.width ?? 0) * 0.6 ? ' is-left' : ''}`} style={{ left: barPos.x, top: barPos.y }} role="tooltip">
          {barTip}
        </div>
      )}
      <span className="ui-visually-hidden" aria-live="polite">
        {focus && tipText ? tipText : ''}
      </span>
    </div>
  );
}
