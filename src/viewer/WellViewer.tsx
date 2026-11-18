import { NotesDialog } from './NotesDialog';
/**
 * Visor multipista (docs/decisiones/0005-visor-multipista.md). Encabezados HTML (CurveLegend + lectura del cursor)
 * sobre dos canvas apilados: base (pistas, grilla, rellenos, curvas, superposiciones) y cursor; a la derecha, el
 * minimapa del pozo entero.
 *
 * Rendimiento: el viewport y el cursor viven en refs, no en estado de React. Toda interacción marca qué canvas
 * está sucio y pide un único requestAnimationFrame; mover el mouse solo redibuja el canvas de cursor y escribe las
 * lecturas directo en el DOM. React re-renderiza solo si cambian pistas, datos, tema o tamaño.
 *
 * El componente no conoce stores: recibe pistas resueltas, datos y superposiciones, y publica cursor y tramo
 * visible por callbacks (src/app/shell/ViewerSlot.tsx los conecta). El editor de escalas lo abre la app con
 * `onEditCurve` (el visor solo dice qué curva y dónde anclarlo).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ContextMenu, CurveLegend, copyText, formatNumber, getResolvedTheme, getUiScaleFactor, Icon, IconButton, Menu, Popover, prefersReducedMotion, toast, useResolvedTheme, useUiScaleFactor, type MenuEntry } from '../ui';
import { pxPerMeterForScale } from '../io/export/figures/sizing';
import { nearestCurveAt, outputKeyOfViewerCurve, readingsText } from './contextMenu';
import { VIEWER_LOOKS, type ViewerLook } from './look';
import { createGhostTool, ghostOffset, GHOST_OVERLAY_ID, type GhostStatus } from './overlays/ghost';
import { createMeasureTool } from './overlays/measure';
import { matchingPrintScale, printScaleOptions, scaleButtonLabel } from './printScale';
import { THEMES } from '../ui/tokens';
import { LOAD_ANIMATION_MS, revealAt } from './animation';
import { layoutTracks, MIN_TRACK_WIDTH, trackAt } from './layout';
import { DropLayer, ResizeEdge, type ViewerLayoutEditing } from './layoutEdit';
import { PointerGestures, type HitResult } from './interaction';
import { Minimap, type MinimapHandle } from './MinimapView';
import { pickMinimapCurve } from './minimap';
import { RangeNavigator } from './RangeNavigator';
import { guard, type OverlayHit, type OverlayPointer, type ViewerData, type ViewerOverlay } from './overlay';
import { formatDepth, formatReadout, nearestIndex, valueAt } from './readout';
import { overlayTracks, overlayViewport, stackFillColor, ViewerRenderer, type FrameInput } from './render';
import { scaleKey } from './scale';
import type { HiddenCurve, ResolvedCurve, ResolvedTrack } from './resolve';
import { stackHint, stackReadout } from './stack';
import { unitLabel } from '../core/units';
import {
  baseOf,
  clampViewport,
  depthOf,
  ensureVisible,
  fitAll,
  resizeViewport,
  scaleRatio,
  scrollBy,
  showRange,
  viewportLimits,
  yOf,
  zoomAt,
  type Viewport,
  type ViewportLimits,
} from './viewport';
import './viewer.css';

export interface WellViewerProps {
  /** Cambia cuando cambia el pozo (o su profundidad): se vuelve a "ver todo" y se anima la carga. */
  wellKey: string;
  depth: Float64Array;
  depthStep: number | null;
  tracks: readonly ResolvedTrack[];
  data: ViewerData;
  overlays: readonly ViewerOverlay[];
  /** Nombre accesible ("Perfiles del pozo X"). */
  label: string;
  /** Contenido a la izquierda de la barra del visor. */
  toolbarStart?: ReactNode;
  /** Contenido a la derecha de la barra, antes del rango y el zoom (modos de edición). */
  toolbarEnd?: ReactNode;
  /** Franja bajo la barra (encabezado de pozo). */
  header?: ReactNode;
  trackControls?(track: ResolvedTrack): ReactNode;
  /** Encabezados de pista compactos: título y mnemónicos; escalas y unidades en el tooltip (docs/decisiones/0069). */
  compactHeads?: boolean;
  /** Si está, el encabezado de la pista de profundidad muestra el botón que alterna los encabezados compactos. */
  onToggleCompactHeads?(): void;
  /** Aviso flotante sobre el perfil (p. ej. «modo marcar zona»). */
  notice?: ReactNode;
  /** Clic o Enter en el encabezado de una curva: abrir su editor anclado a `anchor`. */
  onEditCurve?(target: { track: ResolvedTrack; curve: ResolvedCurve }, anchor: HTMLElement): void;
  /** Volver a mostrar una curva oculta. */
  onShowCurve?(track: ResolvedTrack, curve: HiddenCurve): void;
  /** Escape sin nada que cancelar en el visor (salir de un modo). true si lo usó. */
  onEscape?(): boolean;
  /** Pedido de mostrar un tramo (cambia `seq` para repetir el pedido). */
  rangeRequest?: { top: number; base: number; seq: number } | null;
  /** Ayudas por rol para el estado vacío de las pistas apiladas. */
  stackHints?: Readonly<Record<string, string>>;
  /** Animar la carga de un pozo (por defecto sí; nunca con movimiento reducido). */
  animateLoad?: boolean;
  /** Minimapa (por defecto sí). */
  minimap?: boolean;
  onCursorChange?(depth: number | null): void;
  onViewportChange?(range: { top: number; base: number }): void;
  /** Empieza o termina el arrastre de un elemento del perfil (tope, zona nueva…). */
  onDragChange?(dragging: boolean): void;
  /**
   * Modo «Armar pistas» (docs/decisiones/0016): manijas, menús y bordes de ancho en los encabezados y destinos de
   * arrastre. Ausente = visor normal.
   */
  layoutEdit?: ViewerLayoutEditing | null;
  /**
   * Cortina antes/después (docs/decisiones/0026): línea vertical arrastrable; a su izquierda las pistas de `before`
   * (alineadas con `tracks`), a su derecha las actuales. Mover la línea solo redibuja (no recalcula nada).
   */
  curtain?: ViewerCurtain | null;
  /** Estilo de dibujo (look.ts, docs/decisiones/0067). Ausente = «Moderno». */
  look?: ViewerLook;
  /** Menú contextual: crear un tope en esa profundidad (la app aplica la receta). Ausente = opción deshabilitada. */
  onCreateTop?(depth: number): void;
  /**
   * Menú contextual: «¿De dónde sale este número?» sobre una curva calculada (docs/decisiones/0074). `outputKey` es
   * `<moduleId>:<puerto>` (la clave de la salida del motor). Ausente = opción deshabilitada.
   */
  onTraceSample?(target: { outputKey: string; depth: number }): void;
  /** Menú contextual: exportar lo visible como PNG (tramo, escala 1:N y ancho de las pistas en px CSS). */
  onExportVisible?(request: { top: number; base: number; scale: number; widthPx: number }): void;
}

export interface ViewerCurtain {
  /** Versión «antes» de cada pista de `tracks` (mismo orden; null = no existe antes). */
  before: readonly (ResolvedTrack | null)[];
  beforeLabel: string;
  afterLabel: string;
}

/** Paso de la cortina con el teclado (fracción del ancho; con Mayús, ×5). */
const CURTAIN_STEP = 0.02;

/** Clases de un encabezado en modo «Armar pistas»: destino activo, rechazado o pista arrastrada. */
function headEditClass(edit: ViewerLayoutEditing, t: ResolvedTrack): string {
  const drag = edit.drag;
  if (!drag) return ' is-editable';
  if (drag.what === 'track') return drag.trackId === t.id ? ' is-editable is-dragging' : ' is-editable';
  const active = edit.target?.kind === 'track' && edit.target.trackId === t.id;
  return ` is-editable${active ? (edit.accepts(t) ? ' is-drop-target' : ' is-drop-refused') : ''}`;
}

/** Unidad corta para los encabezados del perfil clásico («ohm·m» → «Ω·m»). */
const headerUnit = (u: string) => (u === 'ohm·m' ? 'Ω·m' : u);

const ZOOM_STEP = 1.25;

const WHEEL_ZOOM = 0.0018;
const LINE_PX = 16;
/** Filas de leyenda por pista antes de agrupar el resto en «+N». */
const MAX_HEAD_ROWS = 4;

interface Pointer {
  x: number;
  y: number;
}

interface Target {
  overlayId: string;
  key: string;
  depth: number;
  hit: OverlayHit & { key: string };
}

export function WellViewer(props: WellViewerProps) {
  const { tracks, wellKey, label, toolbarStart, toolbarEnd, header, notice, onEditCurve, onShowCurve, layoutEdit } = props;
  const theme = useResolvedTheme();
  /** Tamaño de interfaz: anchos fijos y mínimos de pista, rótulos del canvas (las figuras exportadas usan 1). */
  const ui = useUiScaleFactor();
  const propsRef = useRef(props);
  propsRef.current = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLSpanElement>(null);
  const scaleRef = useRef<HTMLSpanElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<MinimapHandle>(null);
  const readouts = useRef(new Map<string, HTMLSpanElement>());
  const targetEls = useRef(new Map<string, HTMLButtonElement>());

  const [size, setSize] = useState({ width: 0, height: 0, heads: 0 });
  /** Ancho que se está arrastrando en modo «Armar pistas» (vista previa hasta soltar). */
  const [resizing, setResizing] = useState<{ id: string; width: number } | null>(null);
  // Si el modo edición termina en medio del arrastre del borde, la vista previa no queda pegada.
  useEffect(() => {
    if (!layoutEdit) setResizing(null);
  }, [layoutEdit]);
  const layout = useMemo(
    () =>
      layoutTracks(
        tracks.map((t) => ({ width: resizing?.id === t.id ? resizing.width : t.width, ...(t.fixed !== undefined ? { fixed: Math.round(t.fixed * ui) } : {}) })),
        size.width,
        Math.round((props.look?.minTrackWidth ?? MIN_TRACK_WIDTH) * ui),
        { weightedMin: true },
      ),
    [tracks, size.width, ui, resizing, props.look],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const renderer = useRef<ViewerRenderer>(null as unknown as ViewerRenderer);
  renderer.current ??= new ViewerRenderer();
  const vpRef = useRef<Viewport | null>(null);
  const limRef = useRef<ViewportLimits | null>(null);
  const cursor = useRef<{ depth: number | null; source: 'pointer' | 'keyboard' | null }>({ depth: null, source: null });
  const pointer = useRef<Pointer | null>(null);
  /** Mayús en el último evento del puntero (gestos con modificador de las superposiciones, OverlayPointer.shiftKey). */
  const shiftRef = useRef(false);
  /** Puntero apretado (capturado) por un gesto: paneo o arrastre de una superposición. */
  const pressed = useRef<number | null>(null);
  const tickFrame = useRef(0);
  const touches = useRef(new Map<number, Pointer>());
  const pinch = useRef<{ dist: number } | null>(null);
  const dirty = useRef({ base: false, cursor: false, frame: 0 });
  const frameTimes = useRef<number[]>([]);
  const lastPublished = useRef<{ top: number; base: number } | null>(null);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Animación de carga en curso: progreso y cuadro pedido. */
  const reveal = useRef<{ start: number; value: number; frame: number } | null>(null);
  /** Posición de la cortina como fracción del ancho de las pistas (sobrevive a cambios de ancho). */
  const curtainFrac = useRef(0.5);
  const curtainRef = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  /** Estilo de dibujo (por defecto, el moderno: el componente sin la prop se ve como siempre). */
  const look = props.look ?? VIEWER_LOOKS.modern;
  const classic = look.headers === 'classic';
  /** Herramienta «Medir un intervalo» del menú contextual: una superposición propia del visor. */
  const [measuring, setMeasuring] = useState(false);
  const measure = useRef<ReturnType<typeof createMeasureTool>>(null as unknown as ReturnType<typeof createMeasureTool>);
  measure.current ??= createMeasureTool({
    tvdss: () => propsRef.current.tracks.find((t) => t.kind === 'depth')?.tvdss ?? null,
    measured: (text) => announceRef.current(text),
    changed: (armed) => setMeasuring(armed),
  });
  const [ghostStatus, setGhostStatus] = useState<GhostStatus | null>(null);
  const ghost = useRef<ReturnType<typeof createGhostTool> | null>(null);
  ghost.current ??= createGhostTool(setGhostStatus, () => toast({
    tone: 'warn', title: 'El tramo no tiene una línea continua', description: 'Arrastrá sobre un tramo con al menos dos muestras válidas consecutivas.',
  }));
  const overlays = useMemo(() => [...props.overlays, measure.current.overlay, ghost.current!.overlay], [props.overlays]);
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  /** Menú contextual abierto: punto de la ventana, profundidad y pista donde se abrió. */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; depth: number; track: number; localX: number } | null>(null);

  // ── dibujo ──────────────────────────────────────────────────────────────────────────────────────────────────
  const frameInput = useCallback((): FrameInput | null => {
    const vp = vpRef.current;
    if (!vp) return null;
    const p = propsRef.current;
    return {
      purpose: 'interactive',
      tracks: p.tracks,
      boxes: layoutRef.current.boxes,
      viewport: vp,
      theme: THEMES[getResolvedTheme()],
      depth: p.depth,
      width: layoutRef.current.total,
      overlays: overlaysRef.current,
      data: p.data,
      invalidate: () => invalidateRef.current('base'),
      ...(p.look ? { look: p.look } : {}),
      ...(reveal.current ? { reveal: reveal.current.value } : {}),
      active: gestures.current?.activeKey ?? null,
      ...(p.stackHints ? { stackHints: p.stackHints } : {}),
      uiScale: getUiScaleFactor(),
      ...(p.curtain ? { curtain: { x: curtainFrac.current * layoutRef.current.total, before: p.curtain.before } } : {}),
    };
  }, []);
  const invalidateRef = useRef<(what: 'base' | 'cursor') => void>(() => {});
  const announceRef = useRef<(text: string) => void>(() => {});

  const prepare = (canvas: HTMLCanvasElement | null, width: number, height: number) => {
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  };

  const updateReadouts = useCallback(() => {
    const p = propsRef.current;
    const d = cursor.current.depth;
    const idx = d === null ? -1 : nearestIndex(p.depth, d);
    const set = (k: string, text: string) => {
      const a = readouts.current.get(k);
      if (a) a.textContent = text;
      const b = readouts.current.get(`${k}|pop`);
      if (b) b.textContent = text;
    };
    for (const t of p.tracks) {
      if (t.kind === 'stack' && t.stack && !t.stack.empty) {
        const vals = idx < 0 ? null : stackReadout(t.stack, idx);
        for (const item of t.stack.legend) {
          const v = vals?.get(item.id);
          set(`${t.id}|stack:${item.id}`, v === undefined ? '' : Number.isFinite(v) ? formatNumber(v, { digits: 2 }) : '—');
        }
        continue;
      }
      for (const c of t.curves) set(`${t.id}|${c.key}`, idx < 0 ? '' : formatReadout(valueAt(c.data, idx), c.kind));
    }
  }, []);

  /** Ubica los botones de los elementos navegables con el teclado sobre su profundidad. */
  const placeTargets = useCallback((vp: Viewport) => {
    for (const t of targetsRef.current) {
      const el = targetEls.current.get(`${t.overlayId}|${t.key}`);
      if (!el) continue;
      const y = yOf(vp, t.depth);
      el.style.transform = `translateY(${Math.round(Math.min(vp.height - 12, Math.max(12, y)))}px)`;
    }
  }, []);

  const paint = useCallback(() => {
    dirty.current.frame = 0;
    const f = frameInput();
    if (!f) return;
    const { base, cursor: cur } = dirty.current;
    dirty.current.base = dirty.current.cursor = false;
    if (base) {
      const ctx = prepare(baseRef.current, f.width, f.viewport.height);
      if (ctx) {
        const ms = renderer.current.drawBase(ctx, f);
        const times = frameTimes.current;
        times.push(ms);
        if (times.length > 120) times.shift();
        const root = rootRef.current;
        if (root) {
          const sorted = [...times].sort((a, b) => a - b);
          root.dataset['frameMs'] = ms.toFixed(2);
          root.dataset['frameAvg'] = (times.reduce((s, v) => s + v, 0) / times.length).toFixed(2);
          root.dataset['frameP95'] = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!.toFixed(2);
        }
      }
      const top = f.viewport.top;
      const bottom = baseOf(f.viewport);
      if (rangeRef.current) rangeRef.current.textContent = `${formatNumber(Math.max(top, f.depth[0] ?? top), { digits: 1, grouping: false })} – ${formatNumber(Math.min(bottom, f.depth[f.depth.length - 1] ?? bottom), { digits: 1, grouping: false })} m`;
      if (scaleRef.current) scaleRef.current.textContent = propsRef.current.look ? scaleButtonLabel(f.viewport.pxPerM) : `1:${formatNumber(+scaleRatio(f.viewport.pxPerM).toPrecision(2), { digits: 0 })}`;
      miniRef.current?.setWindow(top, bottom);
      placeTargets(f.viewport);
      const prev = lastPublished.current;
      if (!prev || prev.top !== top || prev.base !== bottom) {
        lastPublished.current = { top, base: bottom };
        propsRef.current.onViewportChange?.({ top, base: bottom });
      }
    }
    if (base || cur) {
      const ctx = prepare(cursorRef.current, f.width, f.viewport.height);
      if (ctx) renderer.current.drawCursor(ctx, f, cursor.current.depth);
      updateReadouts();
    }
  }, [frameInput, updateReadouts, placeTargets]);

  const invalidate = useCallback(
    (what: 'base' | 'cursor') => {
      if (what === 'base') dirty.current.base = true;
      dirty.current.cursor = true;
      if (!dirty.current.frame) dirty.current.frame = requestAnimationFrame(paint);
    },
    [paint],
  );
  invalidateRef.current = invalidate;

  // ── animación de carga ──────────────────────────────────────────────────────────────────────────────────────
  const stopReveal = useCallback(() => {
    const r = reveal.current;
    if (!r) return;
    cancelAnimationFrame(r.frame);
    reveal.current = null;
    invalidate('base');
  }, [invalidate]);
  const startReveal = useCallback(() => {
    if (reveal.current) cancelAnimationFrame(reveal.current.frame);
    if (propsRef.current.animateLoad === false || prefersReducedMotion()) {
      reveal.current = null;
      return;
    }
    const step = (now: number) => {
      const r = reveal.current;
      if (!r) return;
      if (!r.start) r.start = now;
      const elapsed = now - r.start;
      r.value = revealAt(elapsed);
      invalidate('base');
      if (elapsed >= LOAD_ANIMATION_MS) {
        reveal.current = null;
        invalidate('base');
      } else r.frame = requestAnimationFrame(step);
    };
    reveal.current = { start: 0, value: 0, frame: requestAnimationFrame(step) };
  }, [invalidate]);

  useEffect(
    () => () => {
      // Con StrictMode el efecto se desmonta y se vuelve a montar: hay que olvidar el cuadro cancelado.
      cancelAnimationFrame(dirty.current.frame);
      cancelAnimationFrame(tickFrame.current);
      if (reveal.current) cancelAnimationFrame(reveal.current.frame);
      reveal.current = null;
      dirty.current.frame = 0;
      tickFrame.current = 0;
    },
    [],
  );

  // ── viewport ────────────────────────────────────────────────────────────────────────────────────────────────
  const setViewport = useCallback(
    (next: Viewport) => {
      if (next === vpRef.current) return;
      vpRef.current = next;
      invalidate('base');
    },
    [invalidate],
  );

  const setCursor = useCallback(
    (depth: number | null, source: 'pointer' | 'keyboard' | null) => {
      const c = cursor.current;
      if (c.depth === depth && c.source === source) return;
      cursor.current = { depth, source };
      // Con lectura activa, las pistas angostas cambian extremos de escala por valores (viewer.css).
      if (rootRef.current) rootRef.current.toggleAttribute('data-reading', depth !== null);
      invalidate('cursor');
      propsRef.current.onCursorChange?.(depth);
    },
    [invalidate],
  );

  // Tamaño disponible (ancho del contenedor con desplazamiento horizontal, alto del cuerpo y de los encabezados).
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const body = bodyRef.current;
    const heads = headsRef.current;
    if (!scroll || !body) return;
    const measure = () =>
      setSize((s) => {
        const next = { width: scroll.clientWidth, height: body.clientHeight, heads: heads?.offsetHeight ?? 0 };
        return s.width === next.width && s.height === next.height && s.heads === next.heads ? s : next;
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroll);
    ro.observe(body);
    if (heads) ro.observe(heads);
    return () => ro.disconnect();
  }, []);

  // Pozo nuevo → ver todo y animar la carga. Alto nuevo → conservar tope y zoom.
  const wellKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (size.height <= 0) return;
    const p = propsRef.current;
    const lim = viewportLimits(p.depth, size.height, p.depthStep);
    const prevLim = limRef.current;
    limRef.current = lim;
    if (wellKeyRef.current !== wellKey || !vpRef.current || !prevLim) {
      const isNew = wellKeyRef.current !== wellKey;
      wellKeyRef.current = wellKey;
      renderer.current.reset();
      vpRef.current = fitAll(lim, size.height);
      cursor.current = { depth: null, source: null };
      if (isNew) startReveal();
    } else {
      vpRef.current = resizeViewport(vpRef.current, prevLim, lim, size.height);
    }
    invalidate('base');
  }, [wellKey, size.height, invalidate, startReveal]);

  // Cambios de pistas, datos, tema, tamaño de interfaz, ancho o cortina → redibujar.
  useEffect(() => invalidate('base'), [tracks, props.data, overlays, theme, ui, layout, props.curtain, props.look, invalidate]);

  // ── cortina ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** Ubica la manija y pide un cuadro: el único trabajo al arrastrar es redibujar (nada se recalcula). */
  const placeCurtain = useCallback(() => {
    const el = curtainRef.current;
    if (!el) return;
    const total = layoutRef.current.total;
    const x = Math.round(curtainFrac.current * total);
    el.style.transform = `translateX(${x}px)`;
    const pct = Math.round(curtainFrac.current * 100);
    el.setAttribute('aria-valuenow', String(pct));
    el.setAttribute('aria-valuetext', `${pct} % del ancho`);
    // Un rótulo que no entra de su lado (borde del área visible) pasa al otro, debajo del primero.
    const sc = scrollRef.current;
    const visL = sc?.scrollLeft ?? 0;
    const visR = visL + (sc?.clientWidth ?? total);
    const [lb, la] = [el.querySelector<HTMLElement>('.wv-curtain__label--before'), el.querySelector<HTMLElement>('.wv-curtain__label--after')];
    const gap = 12;
    el.toggleAttribute('data-edge-left', !!lb && x - lb.offsetWidth - gap < visL);
    el.toggleAttribute('data-edge-right', !!la && x + la.offsetWidth + gap > visR);
  }, []);
  // El área visible cambia con el desplazamiento horizontal: reubicar los rótulos.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !props.curtain) return;
    sc.addEventListener('scroll', placeCurtain, { passive: true });
    return () => sc.removeEventListener('scroll', placeCurtain);
  }, [placeCurtain, props.curtain]);
  const setCurtain = useCallback(
    (frac: number) => {
      const next = Math.min(1, Math.max(0, frac));
      if (next === curtainFrac.current) return;
      curtainFrac.current = next;
      placeCurtain();
      invalidate('base');
    },
    [placeCurtain, invalidate],
  );
  useLayoutEffect(() => placeCurtain(), [placeCurtain, layout, props.curtain]);
  const curtainDrag = useRef<number | null>(null);
  const onCurtainDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    curtainDrag.current = e.pointerId;
    e.currentTarget.dataset['dragging'] = '';
  };
  const onCurtainMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (curtainDrag.current !== e.pointerId) return;
    const total = layoutRef.current.total;
    if (total > 0) setCurtain(localPoint(e).x / total);
  };
  const onCurtainUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (curtainDrag.current !== e.pointerId) return;
    curtainDrag.current = null;
    delete e.currentTarget.dataset['dragging'];
  };
  const onCurtainKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = CURTAIN_STEP * (e.shiftKey ? 5 : 1);
    const moves: Record<string, number> = { ArrowLeft: -step, ArrowRight: step, ArrowDown: -step, ArrowUp: step };
    if (e.key in moves) setCurtain(curtainFrac.current + moves[e.key]!);
    else if (e.key === 'Home') setCurtain(0);
    else if (e.key === 'End') setCurtain(1);
    else return; // Escape y el resto siguen al visor (Escape cierra la comparación)
    e.preventDefault();
    e.stopPropagation();
  };

  // Cambio de devicePixelRatio (ventana a otro monitor, zoom del navegador): el ResizeObserver no se entera.
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    let mq: MediaQueryList | null = null;
    const onChange = () => {
      watch();
      invalidate('base');
    };
    const watch = () => {
      mq?.removeEventListener('change', onChange);
      mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener('change', onChange);
    };
    watch();
    return () => mq?.removeEventListener('change', onChange);
  }, [invalidate]);

  // Superposiciones con estado propio.
  useEffect(() => {
    const offs = props.overlays.map((o) => (o.subscribe ? guard(o.id, 'subscribe', () => o.subscribe!(() => invalidate('base'))) : undefined));
    return () => offs.forEach((off, i) => off && guard(props.overlays[i]!.id, 'desuscribir', off));
  }, [props.overlays, invalidate]);

  // ── acciones ────────────────────────────────────────────────────────────────────────────────────────────────
  const zoom = useCallback(
    (factor: number, anchorY?: number) => {
      const vp = vpRef.current;
      const lim = limRef.current;
      if (!vp || !lim) return;
      stopReveal();
      const c = cursor.current.depth;
      const y = anchorY ?? (c !== null && c >= vp.top && c <= baseOf(vp) ? (c - vp.top) * vp.pxPerM : vp.height / 2);
      setViewport(zoomAt(vp, factor, y, lim));
    },
    [setViewport, stopReveal],
  );

  const fit = useCallback(() => {
    const vp = vpRef.current;
    const lim = limRef.current;
    stopReveal();
    if (vp && lim) setViewport(fitAll(lim, vp.height));
  }, [setViewport, stopReveal]);

  const show = useCallback(
    (top: number, base: number) => {
      const vp = vpRef.current;
      const lim = limRef.current;
      if (vp && lim) setViewport(showRange(lim, vp.height, top, base));
    },
    [setViewport],
  );

  const scrollTo = useCallback(
    (top: number) => {
      const vp = vpRef.current;
      const lim = limRef.current;
      stopReveal();
      if (vp && lim) setViewport(clampViewport({ ...vp, top }, lim));
    },
    [setViewport, stopReveal],
  );

  // Pedido de la app: mostrar un tramo (zona elegida en el encabezado, zona recién creada).
  const lastRequest = useRef<number | null>(null);
  useEffect(() => {
    const r = props.rangeRequest;
    if (!r || r.seq === lastRequest.current) return;
    lastRequest.current = r.seq;
    stopReveal();
    show(r.top, r.base);
  }, [props.rangeRequest, show, stopReveal]);

  const pointerDepth = () => {
    const vp = vpRef.current;
    const p = pointer.current;
    return vp && p ? depthOf(vp, p.y) : null;
  };

  const hitFrame = useCallback(() => {
    const f = frameInput();
    if (!f) return null;
    const tracksO = overlayTracks(f.tracks, f.boxes);
    return { f, tracksO, frame: { purpose: 'interactive' as const, theme: f.theme, viewport: overlayViewport(f.viewport), tracks: tracksO, data: f.data, invalidate: () => invalidate('base'), active: f.active ?? null, uiScale: f.uiScale ?? 1, ...(f.look ? { look: f.look.id } : {}) } };
  }, [frameInput, invalidate]);

  const overlayPointer = useCallback(
    (p: Pointer): OverlayPointer | null => {
      const h = hitFrame();
      if (!h) return null;
      const ti = trackAt(h.f.boxes, p.x);
      return { x: p.x, y: p.y, depth: depthOf(h.f.viewport, p.y), track: ti >= 0 ? h.tracksO[ti]! : null, shiftKey: shiftRef.current };
    },
    [hitFrame],
  );

  const hitAt = useCallback(
    (p: Pointer): HitResult | null => {
      const h = hitFrame();
      if (!h) return null;
      const ti = trackAt(h.f.boxes, p.x);
      const ptr = { x: p.x, y: p.y, depth: depthOf(h.f.viewport, p.y), track: ti >= 0 ? h.tracksO[ti]! : null, shiftKey: shiftRef.current };
      // Las de arriba primero (las 'over' y de mayor orden tapan a las otras).
      const ordered = [...h.f.overlays].sort((a, b) => (a.layer === b.layer ? (b.order ?? 0) - (a.order ?? 0) : a.layer === 'over' ? -1 : 1));
      for (const o of ordered) {
        if (!o.hit) continue;
        const hit = guard(o.id, 'hit', () => o.hit!(h.frame, ptr));
        if (hit) return { overlayId: o.id, hit };
      }
      return null;
    },
    [hitFrame],
  );

  const draggingRef = useRef(false);
  const gestures = useRef<PointerGestures>(null as unknown as PointerGestures);
  gestures.current ??= new PointerGestures({
    viewport: () => vpRef.current,
    limits: () => limRef.current,
    setViewport: (v) => setViewportRef.current(v),
    pointerAt: (p) => overlayPointerRef.current(p) ?? { x: p.x, y: p.y, depth: NaN, track: null },
    hitAt: (p) => hitAtRef.current(p),
    requestTick: () => {
      if (tickFrame.current) return;
      tickFrame.current = requestAnimationFrame(() => {
        tickFrame.current = 0;
        if (gestures.current.tick() && pointer.current) setCursorRef.current(pointerDepth(), 'pointer');
      });
    },
    setCursor: (css) => {
      if (bodyRef.current) bodyRef.current.style.cursor = css;
    },
    activeChanged: () => invalidateRef.current('base'),
    dragChanged: (dragging) => {
      draggingRef.current = dragging;
      propsRef.current.onDragChange?.(dragging);
    },
  });
  // Desmontado a mitad de un arrastre: avisar que terminó.
  useEffect(
    () => () => {
      if (draggingRef.current) propsRef.current.onDragChange?.(false);
    },
    [],
  );
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;
  const overlayPointerRef = useRef(overlayPointer);
  overlayPointerRef.current = overlayPointer;
  const hitAtRef = useRef(hitAt);
  hitAtRef.current = hitAt;
  const setCursorRef = useRef(setCursor);
  setCursorRef.current = setCursor;

  const ghostUnavailable = !!(props.curtain || layoutEdit || notice);
  useLayoutEffect(() => {
    const h = hitFrame();
    const cleared = props.curtain ? ghost.current!.clear()
      : (h && ghost.current!.reconcile(h.frame)) || (ghostUnavailable && ghost.current!.cancelSelection());
    if (cleared) gestures.current.cancel(GHOST_OVERLAY_ID);
  }, [props.curtain, ghostUnavailable, hitFrame, props.data, tracks]);

  // Elementos navegables con el teclado (topes de zona, plugs…): se recalculan cuando cambian los datos.
  useEffect(() => {
    const h = hitFrame();
    if (!h) {
      setTargets([]);
      return;
    }
    const list: Target[] = [];
    for (const o of overlays) {
      if (!o.targets) continue;
      const got = guard(o.id, 'targets', () => o.targets!(h.frame)) ?? [];
      for (const t of got) if (t.hit.key && Number.isFinite(t.depth)) list.push({ overlayId: o.id, key: t.hit.key, depth: t.depth, hit: t.hit });
    }
    list.sort((a, b) => a.depth - b.depth);
    setTargets(list);
    // Si el foco está en un elemento que sigue existiendo, el activo pasa a ser su versión nueva (datos al día).
    const focused = document.activeElement as HTMLElement | null;
    const k = focused?.dataset['target'];
    const again = k ? list.find((t) => `${t.overlayId}|${t.key}` === k) : undefined;
    if (again) gestures.current.focus({ overlayId: again.overlayId, hit: again.hit });
    else {
      // El activo (último clic o arrastre) también se actualiza; si ya no existe (deshacer quitó la zona), se suelta.
      const a = gestures.current.active;
      const own = a?.hit.key ? overlays.find((o) => o.id === a.overlayId) : undefined;
      if (a && own?.targets) {
        const fresh = list.find((t) => t.overlayId === a.overlayId && t.key === a.hit.key);
        gestures.current.focus(fresh ? { overlayId: fresh.overlayId, hit: fresh.hit } : null);
      }
    }
  }, [props.data, overlays, tracks, size.height, hitFrame, ghostStatus]);

  useLayoutEffect(() => {
    if (vpRef.current) placeTargets(vpRef.current);
  }, [targets, placeTargets]);

  const showTip = (p: Pointer | null, hit: OverlayHit | null) => {
    const tip = tipRef.current;
    const body = bodyRef.current;
    if (!tip || !body) return;
    body.style.cursor = hit?.cursor ?? (hit?.drag ? 'grab' : '');
    if (!p || !hit) {
      tip.hidden = true;
      return;
    }
    tip.textContent = hit.label;
    tip.hidden = false;
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const maxX = scrollLeft + (scrollRef.current?.clientWidth ?? 0) - tip.offsetWidth - 8;
    tip.style.left = `${Math.max(scrollLeft + 4, Math.min(maxX, p.x + 14))}px`;
    tip.style.top = `${Math.min(body.clientHeight - tip.offsetHeight - 4, p.y + 16)}px`;
  };

  // Rueda (listener nativo: hace falta preventDefault, y React registra la rueda como pasiva).
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onWheel = (e: WheelEvent) => {
      const vp = vpRef.current;
      const lim = limRef.current;
      if (!vp || !lim) return;
      const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? vp.height : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        stopReveal();
        const rect = body.getBoundingClientRect();
        setViewport(zoomAt(vp, Math.exp(-e.deltaY * unit * WHEEL_ZOOM), e.clientY - rect.top, lim));
      } else if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        e.preventDefault();
        stopReveal();
        setViewport(scrollBy(vp, e.deltaY * unit, lim));
      } else return;
      if (cursor.current.source === 'pointer') setCursor(pointerDepth(), 'pointer');
    };
    body.addEventListener('wheel', onWheel, { passive: false });
    return () => body.removeEventListener('wheel', onWheel);
  }, [setViewport, setCursor, stopReveal]);

  const localPoint = (e: { clientX: number; clientY: number }): Pointer => {
    const rect = bodyRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    stopReveal();
    const p = localPoint(e);
    pointer.current = p;
    shiftRef.current = e.shiftKey;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, p);
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
        if (pressed.current !== null) gestures.current.cancel();
        pressed.current = null;
      }
    }
    if (e.button !== 0 || pinch.current) return;
    if (ghostStatus) e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = e.pointerId;
    gestures.current.down(e.pointerId, p);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = localPoint(e);
    pointer.current = p;
    shiftRef.current = e.shiftKey;
    const vp = vpRef.current;
    const lim = limRef.current;
    if (!vp || !lim) return;
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, p);
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch.current.dist > 0 && dist > 0) setViewport(zoomAt(vp, dist / pinch.current.dist, (a!.y + b!.y) / 2, lim));
        pinch.current.dist = dist;
        return;
      }
    }
    if (pressed.current === e.pointerId) {
      gestures.current.move(e.pointerId, p);
      if (gestures.current.dragging) showTip(null, null);
    } else {
      showTip(p, hitAt(p)?.hit ?? null);
    }
    setCursor(depthOf(vpRef.current!, p.y), 'pointer');
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (pressed.current === e.pointerId) {
      pressed.current = null;
      if (e.type === 'pointercancel') gestures.current.cancel();
      gestures.current.up(e.pointerId, localPoint(e));
    }
  };
  const onPointerLeave = () => {
    if (pressed.current !== null) return;
    pointer.current = null;
    showTip(null, null);
    if (cursor.current.source === 'pointer') setCursor(null, null);
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!gestures.current.takeClick()) return;
    const p = localPoint(e);
    const h = hitAt(p);
    const hit = h?.hit;
    if (e.detail >= 2) {
      // Doble clic: muestra el elemento (zona, tramo) o acerca ×2 sobre el puntero.
      if (hit?.range) show(hit.range.top, hit.range.base);
      else zoom(2, p.y);
      if (hit?.doubleClick) guard(h!.overlayId, 'doubleClick', () => hit.doubleClick!());
      return;
    }
    if (hit?.activate) guard(h!.overlayId, 'activate', () => hit.activate!());
    gestures.current.clicked(h);
    if (h && hit?.nudge) announceText(`${hit.label}. Flechas arriba y abajo lo mueven; Escape lo suelta.`);
  };

  // ── teclado ─────────────────────────────────────────────────────────────────────────────────────────────────
  const announce = useCallback(() => {
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => {
      const d = cursor.current.depth;
      const live = liveRef.current;
      if (!live || d === null) return;
      const p = propsRef.current;
      const idx = nearestIndex(p.depth, d);
      const parts = p.tracks.flatMap((t) => t.curves.map((c) => `${c.name} ${formatReadout(valueAt(c.data, idx), c.kind)}${c.kind === 'line' && c.unitLabel !== '—' ? ` ${c.unitLabel}` : ''}`));
      const zone = p.data.zones.find((z) => d >= z.top && d <= z.base);
      live.textContent = `${formatDepth(d)} m${zone ? `, zona ${zone.name}` : ''}. ${parts.join('; ')}.`;
    }, 450);
  }, []);
  useEffect(() => () => clearTimeout(liveTimer.current), []);
  const announceText = (text: string) => {
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => {
      if (liveRef.current) liveRef.current.textContent = text;
    }, 200);
  };
  announceRef.current = announceText;

  const moveKeyboardCursor = (depth: number) => {
    const vp = vpRef.current;
    const lim = limRef.current;
    if (!vp || !lim) return;
    const d = Math.min(lim.max, Math.max(lim.min, depth));
    setViewport(ensureVisible(vp, d, lim));
    setCursor(d, 'keyboard');
    announce();
  };

  /** Paso de ↑/↓ en metros: una muestra, o las necesarias para avanzar 2 px (Mayús ×10). */
  const keyStep = (shift: boolean): { samples: number; step: number } | null => {
    const vp = vpRef.current;
    const lim = limRef.current;
    if (!vp || !lim) return null;
    const p = propsRef.current;
    const step = p.depthStep ?? (lim.max - lim.min) / Math.max(1, p.depth.length - 1);
    const samples = Math.max(1, Math.ceil(2 / (vp.pxPerM * step) - 1e-9)) * (shift ? 10 : 1);
    return { samples, step };
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const vp = vpRef.current;
    const lim = limRef.current;
    const ks = keyStep(e.shiftKey);
    if (!vp || !lim || !ks) return;
    stopReveal();
    const p = propsRef.current;
    const { samples, step } = ks;
    const current = cursor.current.depth ?? depthOf(vp, vp.height / 2);
    const idx = nearestIndex(p.depth, current);
    const stepTo = (dir: 1 | -1) => (idx >= 0 ? p.depth[Math.min(p.depth.length - 1, Math.max(0, idx + dir * samples))]! : current + dir * samples * step);
    const page = (vp.height / vp.pxPerM) * 0.9;
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
        if (!gestures.current.nudge(samples * step)) moveKeyboardCursor(stepTo(1));
        break;
      case 'ArrowUp':
        if (!gestures.current.nudge(-samples * step)) moveKeyboardCursor(stepTo(-1));
        break;
      case 'PageDown':
        setViewport(scrollBy(vp, page * vp.pxPerM, lim));
        moveKeyboardCursor(current + page);
        break;
      case 'PageUp':
        setViewport(scrollBy(vp, -page * vp.pxPerM, lim));
        moveKeyboardCursor(current - page);
        break;
      case 'Home':
        setViewport(clampViewport({ ...vp, top: lim.min }, lim));
        moveKeyboardCursor(lim.min);
        break;
      case 'End':
        setViewport(clampViewport({ ...vp, top: lim.max }, lim));
        moveKeyboardCursor(lim.max);
        break;
      case '+':
      case '=':
        zoom(ZOOM_STEP);
        break;
      case '-':
      case '_':
        zoom(1 / ZOOM_STEP);
        break;
      case '0':
        fit();
        break;
      case 'Escape': {
        const handledGesture = gestures.current.cancel();
        if (!ghost.current!.cancelSelection() && !handledGesture && !measure.current.clear() && !propsRef.current.onEscape?.()) setCursor(null, null);
        break;
      }
      case 'ContextMenu':
        openContextMenuAt(current);
        break;
      case 'F10':
        if (e.shiftKey) openContextMenuAt(current);
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    // Solo si el foco llegó con el teclado (Tab): un clic enfoca el visor pero el cursor lo maneja el puntero.
    let byKeyboard = true;
    try {
      byKeyboard = e.currentTarget.matches(':focus-visible');
    } catch {
      // navegador sin :focus-visible
    }
    const vp = vpRef.current;
    if (byKeyboard && vp && cursor.current.depth === null) {
      setCursor(depthOf(vp, vp.height / 2), 'keyboard');
      announce();
    }
  };
  const onBlur = () => {
    if (cursor.current.source === 'keyboard') setCursor(null, null);
  };

  // ── menú contextual (docs/decisiones/0067, D12) ────────────────────────────────────────────────────────────
  /** Clic derecho sobre el perfil. Mayús + clic derecho deja el menú del navegador. */
  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.shiftKey) return;
    e.preventDefault();
    const vp = vpRef.current;
    if (!vp) return;
    stopReveal();
    gestures.current.cancel();
    const p = localPoint(e);
    bodyRef.current?.focus({ preventScroll: true });
    setCtxMenu({ x: e.clientX, y: e.clientY, depth: depthOf(vp, p.y), track: trackAt(layoutRef.current.boxes, p.x), localX: p.x });
  };
  /** Tecla Menú o Mayús+F10 con el visor enfocado: el menú se abre en la profundidad del cursor (o en el medio). */
  const openContextMenuAt = (depth: number) => {
    const vp = vpRef.current;
    const body = bodyRef.current;
    if (!vp || !body) return;
    const boxes = layoutRef.current.boxes;
    const tracksNow = propsRef.current.tracks;
    const ti = tracksNow.findIndex((t) => t.kind === 'curves' && t.curves.length > 0);
    const box = boxes[ti] ?? boxes[0] ?? { x: 0, width: 0 };
    const rect = body.getBoundingClientRect();
    const localX = box.x + box.width / 2;
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    setCtxMenu({ x: rect.left + localX - scrollLeft, y: rect.top + Math.min(vp.height - 4, Math.max(4, yOf(vp, depth))), depth, track: ti, localX });
  };
  const [notesDepth, setNotesDepth] = useState<number | null>(null);
  const contextItems = (): { header: ReactNode; items: MenuEntry[] } => {
    const m = ctxMenu!;
    const p = propsRef.current;
    const idx = nearestIndex(p.depth, m.depth);
    const d = idx >= 0 ? p.depth[idx]! : m.depth;
    const tv = p.tracks.find((t) => t.kind === 'depth')?.tvdss;
    const zone = p.data.zones.find((z) => d >= z.top && d <= z.base);
    const track = m.track >= 0 ? p.tracks[m.track] : undefined;
    const box = m.track >= 0 ? layoutRef.current.boxes[m.track] : undefined;
    const curve = track && box && track.kind === 'curves' && idx >= 0 ? nearestCurveAt(track, box, idx, m.localX) : null;
    const traceKey = curve ? outputKeyOfViewerCurve(curve) : null;
    const vp = vpRef.current;
    const header = (
      <>
        <strong className="num">{`MD ${formatDepth(d)} m${tv && idx >= 0 && Number.isFinite(tv[idx]!) ? ` · TVDSS ${formatDepth(tv[idx]!)} m` : ''}`}</strong>
        {zone ? `Zona ${zone.name}` : 'Fuera de las zonas'}
        {curve ? ` · ${curve.name} ${formatReadout(valueAt(curve.data, idx), curve.kind)}${curve.kind === 'line' && curve.unitLabel !== '—' ? ` ${curve.unitLabel}` : ''}` : ''}
      </>
    );
    const items: MenuEntry[] = [
      { id: 'notes', label: 'Notas de profundidad…', disabled: !p.data.commit, onSelect: () => setNotesDepth(d) },
      {
        id: 'copy',
        label: 'Copiar profundidad y lecturas',
        icon: 'copy',
        onSelect: () => {
          void copyText(readingsText(p.tracks, idx, d, tv)).then((ok) => {
            toast(ok ? { tone: 'ok', title: 'Lecturas copiadas', description: `${formatDepth(d)} m · se pegan en una planilla como dos columnas.` } : { tone: 'warn', title: 'No se pudo copiar', description: 'El navegador no dio acceso al portapapeles.' });
          });
        },
      },
      {
        id: 'top',
        label: `Crear un tope a ${formatDepth(d)} m`,
        icon: 'zone-add',
        disabled: !p.onCreateTop || idx < 0,
        description: zone ? `Parte la zona ${zone.name} en esa profundidad` : 'Zona nueva desde esa profundidad',
        onSelect: () => p.onCreateTop?.(d),
      },
      { type: 'separator', id: 's1' },
      {
        id: 'edit',
        label: track && track.kind === 'curves' ? `Editar la pista «${track.title}»…` : 'Editar la pista…',
        icon: 'tracks',
        disabled: !curve || !p.onEditCurve,
        ...(curve ? { description: `${curve.name}: escala, color y trazo` } : { description: 'Solo en las pistas de curvas' }),
        onSelect: () => {
          if (!curve || !track || !p.onEditCurve) return;
          const row = headsRef.current?.querySelector<HTMLElement>(`.wv-head[data-track-id="${CSS.escape(track.id)}"] [data-curve-key="${CSS.escape(curve.key)}"]`);
          // Si la curva quedó agrupada en «+N», el editor se ancla al título de la pista.
          const anchor = row ?? headsRef.current?.querySelector<HTMLElement>(`.wv-head[data-track-id="${CSS.escape(track.id)}"]`) ?? bodyRef.current!;
          p.onEditCurve({ track, curve }, anchor);
        },
      },
      { id: 'measure', label: 'Medir un intervalo', icon: 'ruler', hint: 'arrastrá', onSelect: () => {
        ghost.current!.cancelSelection();
        measure.current.arm();
      } },
      {
        id: 'ghost',
        label: curve?.kind === 'line' ? `Calcar un tramo de ${curve.name}` : 'Calcar un tramo',
        disabled: ghostUnavailable || curve?.kind !== 'line',
        description: ghostUnavailable ? 'Cerrá la herramienta activa del perfil para elegir un tramo' : 'Arrastrá en la pista para elegir las dos profundidades',
        onSelect: () => {
          if (!track || curve?.kind !== 'line' || ghostUnavailable) return;
          measure.current.clear();
          gestures.current.focus(null);
          ghost.current!.arm({
            trackId: track.id, curve, depth: p.data.depth, wellId: p.data.wellId,
            roleSource: curve.role ? p.data.interpretation.sources[curve.role] : undefined,
          });
        },
      },
      {
        id: 'origin',
        label: '¿De dónde sale este número?',
        icon: 'lineage',
        disabled: !traceKey || !p.onTraceSample,
        description: traceKey
          ? `Cadena de ${curve!.name} en ${formatDepth(d)} m, con fuentes y parámetros`
          : curve && curve.origin !== 'computed'
            ? `${curve.name} es una curva ${curve.origin === 'prepared' ? 'preparada' : 'medida'}: no sale de un cálculo`
            : 'Solo sobre una curva calculada (Sw, φ, Vsh…)',
        onSelect: () => {
          if (traceKey) p.onTraceSample?.({ outputKey: traceKey, depth: d });
        },
      },
      { type: 'separator', id: 's2' },
      {
        id: 'png',
        label: 'Exportar lo visible como PNG…',
        icon: 'download',
        disabled: !p.onExportVisible || !vp,
        description: vp ? `${formatNumber(Math.max(vp.top, p.depth[0] ?? vp.top), { digits: 1, grouping: false })}–${formatNumber(Math.min(baseOf(vp), p.depth[p.depth.length - 1] ?? baseOf(vp)), { digits: 1, grouping: false })} m a ${scaleButtonLabel(vp.pxPerM)}` : undefined,
        onSelect: () => {
          if (!vp) return;
          p.onExportVisible?.({ top: Math.max(vp.top, p.depth[0] ?? vp.top), base: Math.min(baseOf(vp), p.depth[p.depth.length - 1] ?? baseOf(vp)), scale: Math.round(scaleRatio(vp.pxPerM)), widthPx: layoutRef.current.total });
        },
      },
      { type: 'label', id: 'shift', label: 'Mayús + clic derecho: menú del navegador' },
    ];
    return { header, items };
  };

  // ── escala de impresión (docs/decisiones/0067, D11) ────────────────────────────────────────────────────────
  const setPrintScale = (n: number) => {
    const vp = vpRef.current;
    const lim = limRef.current;
    if (!vp || !lim) return;
    stopReveal();
    const c = cursor.current.depth;
    const y = c !== null && c >= vp.top && c <= baseOf(vp) ? (c - vp.top) * vp.pxPerM : vp.height / 2;
    setViewport(zoomAt(vp, pxPerMeterForScale(n) / vp.pxPerM, y, lim));
  };
  const scaleItems = (): MenuEntry[] => {
    const vp = vpRef.current;
    const lim = limRef.current;
    const current = vp ? matchingPrintScale(vp.pxPerM) : null;
    return [
      { type: 'label', id: 'l', label: 'Escala de impresión' },
      ...(lim ? printScaleOptions(lim) : []).map((o): MenuEntry => ({
        id: `s${o.denominator}`,
        label: o.label,
        hint: o.detail,
        ...(current === o.denominator ? { icon: 'check' as const } : {}),
        disabled: !!o.disabled,
        ...(o.disabled ? { description: o.disabled } : {}),
        onSelect: () => setPrintScale(o.denominator),
      })),
      { type: 'separator', id: 'sep' },
      { id: 'fit', label: 'Ajustar al pozo', icon: 'fit-height', hint: '0', onSelect: fit },
    ];
  };
  // Las opciones leen el viewport y los límites (refs): un render al abrir el menú las deja al día.
  const [, setScaleMenuTick] = useState(0);

  // Elementos de superposición con el teclado: Tab llega a cada uno; ↑/↓ lo mueven; Enter lo activa.
  const onTargetFocus = (t: Target) => {
    stopReveal();
    gestures.current.focus({ overlayId: t.overlayId, hit: t.hit });
    const vp = vpRef.current;
    const lim = limRef.current;
    if (vp && lim) setViewport(ensureVisible(vp, t.depth, lim, 48));
    invalidate('base');
  };
  const onTargetBlur = (t: Target) => {
    const a = gestures.current.activeKey;
    if (a && a.overlayId === t.overlayId && a.key === t.key) gestures.current.focus(null);
  };
  const onTargetKey = (e: React.KeyboardEvent<HTMLButtonElement>, t: Target) => {
    const ks = keyStep(e.shiftKey);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (ks) gestures.current.nudge((e.key === 'ArrowDown' ? 1 : -1) * ks.samples * ks.step);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (t.hit.activate) guard(t.overlayId, 'activate', () => t.hit.activate!());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      gestures.current.focus(null);
      bodyRef.current?.focus();
    }
  };
  // Seguir al elemento enfocado si se movió (el botón se reubica en `paint`).
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    const k = focused?.dataset['target'];
    const t = k ? targets.find((x) => `${x.overlayId}|${x.key}` === k) : undefined;
    const vp = vpRef.current;
    const lim = limRef.current;
    if (t && vp && lim) setViewport(ensureVisible(vp, t.depth, lim, 48));
  }, [targets, setViewport]);

  // ── encabezados ─────────────────────────────────────────────────────────────────────────────────────────────
  const [overflow, setOverflow] = useState<string | null>(null);
  const overflowAnchor = useRef<HTMLElement | null>(null);

  const readoutRef = (k: string) => (el: HTMLSpanElement | null) => {
    if (el) readouts.current.set(k, el);
    else readouts.current.delete(k);
  };

  const legend = (t: ResolvedTrack, c: ResolvedCurve, where: 'head' | 'pop', sharedScale = false) => {
    const k = `${t.id}|${c.key}${where === 'pop' ? '|pop' : ''}`;
    const classicRow = classic && c.kind === 'line';
    const body = (
      <CurveLegend
        role={c.role}
        name={c.kind === 'band' ? c.short : c.name}
        layout={classicRow ? 'classic' : 'inline'}
        {...(c.kind === 'line' && c.unitLabel !== '—' ? { unit: classicRow ? headerUnit(c.unitLabel) : c.unitLabel } : {})}
        curveStyle={c.styles[theme]}
        scale={c.kind === 'line' && !sharedScale}
        scaleTag={false}
        {...(c.alternative ? { tag: 'alternativa' } : {})}
        title={c.wrap ? `${c.title} · con curva de respaldo` : c.title}
        value={<span ref={readoutRef(k)} />}
      />
    );
    const edit = where === 'head' ? layoutEdit : null;
    if (!onEditCurve && !edit) return <div key={c.key} data-curve-key={c.key}>{body}</div>;
    const open = (el: HTMLElement) => {
      if (!onEditCurve) return;
      setOverflow(null);
      onEditCurve({ track: t, curve: c }, where === 'pop' && overflowAnchor.current ? overflowAnchor.current : el);
    };
    const row = (
      <div
        key={c.key}
        role="button"
        tabIndex={0}
        className="wv-legend"
        data-curve-key={c.key}
        aria-haspopup="dialog"
        aria-label={`${c.name}${c.alternative ? ', alternativa' : ''}: editar escala y color${edit ? '. Alt y flechas la mueven' : ''}`}
        {...(edit ? { 'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight' } : {})}
        onPointerDown={edit ? (e) => edit.onCurvePointerDown(e, t, c) : undefined}
        onClick={(e) => open(e.currentTarget)}
        onKeyDown={(e) => {
          if (edit && e.altKey) {
            edit.onCurveKeyDown(e, t, c);
            if (e.defaultPrevented) return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open(e.currentTarget);
          }
        }}
      >
        {body}
      </div>
    );
    if (!edit) return row;
    const target = edit.target;
    const drop = target?.kind === 'track' && target.trackId === t.id && target.row?.curveKey === c.key && edit.accepts(t) ? target.row.side : null;
    const dragging = edit.drag?.what !== 'track' && edit.drag?.trackId === t.id && edit.drag.curveKey === c.key;
    return (
      <div key={c.key} className={`wv-legend-row${drop ? ` is-drop-${drop}` : ''}${dragging ? ' is-dragging' : ''}`} data-drop-row={c.key}>
        {row}
        <Menu
          aria-label={`Acciones de ${c.name}`}
          minWidth={210}
          items={edit.curveMenu(t, c)}
          trigger={(tp) => (
            <button {...tp} type="button" className="wv-legend-row__menu" aria-label={`Acciones de ${c.name}: mover o quitar`} title="Mover o quitar">
              <Icon name="more" size={13} />
            </button>
          )}
        />
      </div>
    );
  };

  const hiddenMenu = (t: ResolvedTrack) =>
    t.hidden?.length && onShowCurve ? (
      <Menu
        aria-label={`Curvas ocultas de ${t.title}`}
        minWidth={180}
        items={[
          { type: 'label', id: 'l', label: 'Curvas ocultas' },
          ...t.hidden.map((h) => ({ id: h.key, label: `Mostrar ${h.name}`, icon: 'eye' as const, onSelect: () => onShowCurve(t, h) })),
        ]}
        trigger={(tp) => (
          <button {...tp} type="button" className="wv-head__hidden" title={`${t.hidden!.length} ${t.hidden!.length === 1 ? 'curva oculta' : 'curvas ocultas'}`} aria-label={`${t.hidden!.length} ${t.hidden!.length === 1 ? 'curva oculta' : 'curvas ocultas'} en ${t.title}: mostrar`}>
            <Icon name="eye-off" size={12} />
            {t.hidden!.length}
          </button>
        )}
      />
    ) : null;

  const curvesHead = (t: ResolvedTrack) => {
    const list = [...t.curves].reverse(); // la de arriba (la última dibujada) primero
    // Armando pistas se ven todas las filas: cada una se arrastra.
    const shown = list.length > MAX_HEAD_ROWS && !layoutEdit ? list.slice(0, MAX_HEAD_ROWS - 1) : list;
    const extra = list.length - shown.length;
    // Curvas con la MISMA escala (resistividades 0,2–2000): los extremos se muestran una vez abajo y cada fila queda
    // con todo el ancho para el nombre y la lectura (en pistas angostas no se corta el valor).
    const lines = t.curves.filter((c) => c.kind === 'line');
    // Perfil clásico: cada curva con sus extremos y su unidad (0,2 · AT90 Ω·m · 2000), aunque compartan escala.
    const shared = !classic && lines.length >= 2 && lines.length === t.curves.length && lines.every((c) => scaleKey(c.axis) === scaleKey(lines[0]!.axis)) ? lines[0]!.axis : null;
    const lo = shared ? (shared.reversed ? shared.max : shared.min) : 0;
    const hi = shared ? (shared.reversed ? shared.min : shared.max) : 0;
    const fmtEdge = (v: number) => formatNumber(v, { significant: 3, grouping: false });
    return (
      <div className="wv-head__curves">
        {shown.map((c) => legend(t, c, 'head', !!shared))}
        {extra > 0 && (
          <button
            type="button"
            className="wv-head__overflow"
            aria-haspopup="dialog"
            aria-expanded={overflow === t.id}
            title={list.slice(shown.length).map((c) => c.name).join(', ')}
            onClick={(e) => {
              overflowAnchor.current = e.currentTarget;
              setOverflow((o) => (o === t.id ? null : t.id));
            }}
          >
            <span className="wv-head__overflow-names">{list.slice(shown.length).map((c) => c.name).join(' · ')}</span>
            <span className="wv-head__overflow-count">{classic ? `+${extra} curvas` : `+${extra}`}</span>
          </button>
        )}
        {shared && (
          <div className="wv-head__shared num" title={`Escala común de las ${lines.length} curvas${shared.kind === 'log' ? ' (logarítmica)' : ''}`}>
            <span>{fmtEdge(lo)}</span>
            {shared.kind === 'log' && <span className="wv-head__shared-tag">log</span>}
            <span>{fmtEdge(hi)}</span>
          </div>
        )}
      </div>
    );
  };

  const stackHead = (t: ResolvedTrack) => {
    const st = t.stack!;
    // En el encabezado, corto («Faltan VSH, PHIE y SW.»); el detalle de dónde se calcula va en el cuerpo.
    const hint = stackHint(st);
    if (st.empty) {
      return (
        <div className="wv-head__empty">
          <span>Sin columna</span>
          <span className="wv-head__hint">{hint ?? t.emptyHint}</span>
        </div>
      );
    }
    return (
      <div className="wv-head__stack">
        {st.legend.map((item) => (
          <div key={item.id} className="wv-stack-item" title={item.label}>
            <span className="wv-stack-item__swatch" style={{ background: stackFillColor(item.fill, THEMES[theme], look.palette) }} aria-hidden="true" />
            <span className="wv-stack-item__label">{item.short}</span>
            <span className="wv-stack-item__value num" ref={readoutRef(`${t.id}|stack:${item.id}`)} />
          </div>
        ))}
        {hint && <span className="wv-head__hint" title={hint}>{hint}</span>}
      </div>
    );
  };

  const minimapCurve = useMemo(() => pickMinimapCurve(tracks), [tracks]);

  const removeGhost = () => {
    ghost.current!.clear();
    gestures.current.cancel(GHOST_OVERLAY_ID);
    bodyRef.current?.focus();
  };

  // ── render ──────────────────────────────────────────────────────────────────────────────────────────────────
  const columns = layout.boxes.map((b) => `${b.width}px`).join(' ');
  const helpId = `wv-help-${wellKey.replace(/[^a-z0-9_-]/gi, '')}`;
  const heights = { height: size.height || undefined };
  // Botones de los elementos navegables: en la primera pista después de la de profundidad (como las pastillas).
  const depthIndex = tracks.findIndex((t) => t.kind === 'depth');
  const firstCurveBox = layout.boxes[tracks.findIndex((t, i) => i > depthIndex && t.kind !== 'depth')] ?? layout.boxes[0] ?? { x: 0, width: 0 };
  const overflowTrack = tracks.find((t) => t.id === overflow);
  // Px y pesos de las pistas flexibles (para traducir el arrastre del borde a un ancho relativo).
  const flexRoom = { room: 0, weights: 0 };
  tracks.forEach((t, i) => {
    if (t.fixed !== undefined) return;
    flexRoom.room += layout.boxes[i]?.width ?? 0;
    flexRoom.weights += resizing?.id === t.id ? resizing.width : t.width;
  });

  return (
    <div className="wv" ref={rootRef} data-look={look.id} {...(props.compactHeads && !layoutEdit ? { 'data-heads': 'compact' } : {})}>
      <div className="wv-toolbar">
        <div className="wv-toolbar__start">{toolbarStart}</div>
        <div className="wv-toolbar__end">
          {toolbarEnd}
          <RangeNavigator key={wellKey} rangeRef={rangeRef} fit={fit}
            getWindow={() => {
              const vp = vpRef.current;
              const lim = limRef.current;
              if (!vp || !lim || draggingRef.current) return null;
              return { top: Math.max(lim.min, vp.top), base: Math.min(lim.max, baseOf(vp)), min: lim.min, max: lim.max, minimumSpan: vp.height / lim.maxPxPerM };
            }}
            show={(range) => {
              const vp = vpRef.current;
              const lim = limRef.current;
              if (!vp || !lim || draggingRef.current) return null;
              stopReveal();
              const next = showRange(lim, vp.height, range.top, range.base);
              setViewport(next);
              return { top: next.top, base: baseOf(next) };
            }} />
          {props.look ? (
            <Menu
              aria-label="Escala vertical"
              minWidth={230}
              items={scaleItems()}
              trigger={(tp) => (
                <button
                  {...tp}
                  type="button"
                  className="wv-toolbar__scale wv-scale-btn num"
                  title="Escala vertical a 96 ppp: elegir una escala de impresión"
                  onPointerDown={() => setScaleMenuTick((k) => k + 1)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') setScaleMenuTick((k) => k + 1);
                    tp.onKeyDown(e);
                  }}
                >
                  <span ref={scaleRef} />
                  <Icon name="chevron-down" size={11} />
                </button>
              )}
            />
          ) : (
            <span className="wv-toolbar__scale num" ref={scaleRef} title="Escala vertical a 96 ppp" />
          )}
          <div className="wv-toolbar__zoom" role="group" aria-label="Zoom">
            <IconButton icon="zoom-out" size="sm" label="Alejar" hint="−" onClick={() => zoom(1 / ZOOM_STEP)} />
            <IconButton icon="zoom-in" size="sm" label="Acercar" hint="+" onClick={() => zoom(ZOOM_STEP)} />
            <IconButton icon="fit-height" size="sm" label="Ver todo el pozo" hint="0" onClick={fit} />
          </div>
        </div>
      </div>
      {header}
      <div className="wv-main">
        <div className="wv-scroll" ref={scrollRef}>
          <div className="wv-inner" style={{ width: layout.total || '100%' }}>
            <div className={`wv-heads${layoutEdit ? ' wv-heads--edit' : ''}`} ref={headsRef} style={{ gridTemplateColumns: columns }}>
              {tracks.map((t, ti) => (
                <div
                  key={t.id}
                  className={`wv-head wv-head--${t.kind}${t.latent ? ' is-latent' : ''}${layoutEdit ? headEditClass(layoutEdit, t) : ''}`}
                  data-track-id={t.id}
                  {...(layoutEdit ? { 'data-drop-track': t.id } : {})}
                >
                  <div className="wv-head__top">
                    {layoutEdit && (
                      <Menu
                        aria-label={`Acciones de la pista ${t.title}`}
                        align="start"
                        minWidth={220}
                        items={layoutEdit.trackMenu(t)}
                        trigger={(tp) => (
                          <button
                            {...tp}
                            type="button"
                            className="wv-head__grip"
                            aria-label={`Pista ${t.title}: arrastrá para moverla o abrí sus acciones. Alt y flechas la mueven`}
                            aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Delete"
                            title="Arrastrá para mover la pista · clic para más acciones"
                            onPointerDown={(e) => layoutEdit.onTrackPointerDown(e, t)}
                            onKeyDown={(e) => {
                              layoutEdit.onTrackKeyDown(e, t);
                              if (!e.defaultPrevented) tp.onKeyDown(e);
                            }}
                          >
                            <Icon name="grip" size={12} />
                          </button>
                        )}
                      />
                    )}
                    <div className="wv-head__title" title={t.title}>
                      {t.title}
                    </div>
                    {props.trackControls?.(t)}
                    {hiddenMenu(t)}
                    {t.kind === 'depth' && props.onToggleCompactHeads && !layoutEdit && (
                      <button
                        type="button"
                        className="wv-head__collapse"
                        aria-pressed={!!props.compactHeads}
                        aria-label="Encabezados compactos"
                        title={props.compactHeads ? 'Mostrar escalas y unidades en los encabezados' : 'Encabezados compactos: más alto para las curvas'}
                        onClick={props.onToggleCompactHeads}
                        data-testid="compact-heads"
                      >
                        <Icon name={props.compactHeads ? 'chevron-down' : 'chevron-up'} size={12} />
                      </button>
                    )}
                  </div>
                  {t.kind === 'depth' ? (
                    t.tvdss ? (
                      <div className="wv-head__depth wv-head__depth--two num" title="MD: profundidad medida · TVDSS: profundidad vertical bajo el nivel del mar">
                        <span>MD</span>
                        <span className="wv-head__tvdss">TVDSS</span>
                        <span>m</span>
                        <span className="wv-head__tvdss">m</span>
                      </div>
                    ) : (
                      <div className="wv-head__depth num" title={classic ? 'MD: profundidad medida' : undefined}>{classic ? 'MD · m' : 'm'}</div>
                    )
                  ) : t.kind === 'overlay' && props.overlays.find(o => o.id === t.overlayId)?.track?.axisLabels ? (
                    <div className="wv-head__categories">
                      <span className="wv-head__unit">{props.overlays.find(o => o.id === t.overlayId)?.track?.headerLabel}</span>
                      <div className="wv-head__category-axis">{props.overlays.find(o => o.id === t.overlayId)!.track!.axisLabels!.map((label, i) => <span key={i} style={{ left: `${label.position * 100}%` }}>{label.label}</span>)}</div>
                    </div>
                  ) : t.kind === 'overlay' ? (
                    <div className="wv-head__scale num">
                      <span>{t.grid ? formatNumber(t.grid.reversed ? t.grid.max : t.grid.min, { significant: 3, grouping: false }) : ''}</span>
                      {t.unit && <span className="wv-head__unit">{unitLabel(t.unit)}</span>}
                      <span>{t.grid ? formatNumber(t.grid.reversed ? t.grid.min : t.grid.max, { significant: 3, grouping: false }) : ''}</span>
                    </div>
                  ) : t.kind === 'stack' && t.stack ? (
                    stackHead(t)
                  ) : t.curves.length === 0 ? (
                    <div className="wv-head__empty">
                      <span>{t.hidden?.length ? 'Curvas ocultas' : t.latent ? 'Aparece cuando haya curvas' : 'Sin curvas'}</span>
                      {t.emptyHint && !t.hidden?.length && <span className="wv-head__hint">{t.emptyHint}</span>}
                    </div>
                  ) : (
                    curvesHead(t)
                  )}
                  {layoutEdit && t.fixed === undefined && layout.boxes[ti] && (
                    <ResizeEdge
                      track={t}
                      px={layout.boxes[ti]!.width}
                      room={flexRoom.room}
                      weights={flexRoom.weights}
                      minPx={Math.round(look.minTrackWidth * ui)}
                      overflow={layout.total > size.width + 1}
                      onPreview={(w) => setResizing(w === null ? null : { id: t.id, width: w })}
                      onCommit={(w) => layoutEdit.onResize(t, w)}
                    />
                  )}
                </div>
              ))}
            </div>
            <div
              className="wv-body"
              ref={bodyRef}
              tabIndex={0}
              role="group"
              aria-roledescription="visor de perfiles"
              aria-label={label}
              aria-describedby={helpId}
              aria-keyshortcuts="ArrowUp ArrowDown PageUp PageDown Home End + - 0 Escape ContextMenu Shift+F10"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onPointerLeave={onPointerLeave}
              onClick={onClick}
              onContextMenu={onContextMenu}
              onKeyDown={onKeyDown}
              onFocus={onFocus}
              onBlur={onBlur}
            >
              <canvas
                ref={baseRef}
                className="wv-canvas"
                style={{ width: layout.total, ...heights }}
                role="img"
                aria-label={`${label}: ${tracks
                  .filter((t) => t.kind !== 'depth')
                  .map((t) => `${t.title}${t.curves.length ? ` (${t.curves.map((c) => c.name).join(', ')})` : t.stack && !t.stack.empty ? ` (${t.stack.legend.map((l) => l.label).join(', ')})` : ''}`)
                  .join('; ')}`}
              />
              <canvas ref={cursorRef} className="wv-canvas wv-canvas--cursor" style={{ width: layout.total, ...heights }} aria-hidden="true" />
              <div className="wv-tip" ref={tipRef} role="tooltip" hidden />
              {props.curtain && (
                <div
                  ref={curtainRef}
                  className="wv-curtain"
                  role="slider"
                  tabIndex={0}
                  aria-label={`Cortina: a la izquierda ${props.curtain.beforeLabel}, a la derecha ${props.curtain.afterLabel}`}
                  aria-orientation="horizontal"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  title="Arrastrá para mover la cortina · flechas con el foco · Esc para cerrar"
                  onPointerDown={onCurtainDown}
                  onPointerMove={onCurtainMove}
                  onPointerUp={onCurtainUp}
                  onPointerCancel={onCurtainUp}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={onCurtainKey}
                  data-testid="viewer-curtain"
                >
                  <span className="wv-curtain__line" aria-hidden="true" />
                  <span className="wv-curtain__label wv-curtain__label--before">{props.curtain.beforeLabel}</span>
                  <span className="wv-curtain__label wv-curtain__label--after">{props.curtain.afterLabel}</span>
                  <span className="wv-curtain__grip" aria-hidden="true">
                    <Icon name="chevron-left" size={12} strokeWidth={2.25} />
                    <Icon name="chevron-right" size={12} strokeWidth={2.25} />
                  </span>
                </div>
              )}
              {measuring ? (
                <div className="wv-notice">
                  <Icon name="ruler" size={14} />
                  Arrastrá sobre el perfil para medir un intervalo · <kbd>Esc</kbd> para salir
                </div>
              ) : (
                notice && <div className="wv-notice">{notice}</div>
              )}
            </div>
            {layoutEdit?.drag && <DropLayer tracks={tracks} boxes={layout.boxes} heads={size.heads} edit={layoutEdit} ui={ui} />}
            {targets.length > 0 && (
              <div className="wv-targets" role="group" aria-label="Elementos editables del perfil" style={{ top: size.heads, left: firstCurveBox.x + 6 }}>
                {targets.map((t) => {
                  const id = `${t.overlayId}|${t.key}`;
                  return (
                    <button
                      key={id}
                      ref={(el) => {
                        if (el) targetEls.current.set(id, el);
                        else targetEls.current.delete(id);
                      }}
                      type="button"
                      data-target={id}
                      className="wv-target"
                      aria-label={`${t.hit.label}. Flechas arriba y abajo lo mueven; Escape vuelve al perfil.`}
                      onFocus={() => onTargetFocus(t)}
                      onBlur={() => onTargetBlur(t)}
                      onKeyDown={(e) => onTargetKey(e, t)}
                    >
                      <Icon name="chevron-up" size={11} strokeWidth={2.5} />
                      <span>{t.hit.label}</span>
                      <Icon name="chevron-down" size={11} strokeWidth={2.5} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {ghostStatus && !props.curtain && (
          <div className={`wv-notice wv-ghost${ghostStatus.offset !== null ? ' wv-ghost--ready' : ''}`}
            style={ghostStatus.offset === null ? { top: `calc(${size.heads}px + var(--space-2))` } : undefined}>
            <span role="status" data-testid="viewer-ghost-status">
              {ghostStatus.offset === null
                ? `Arrastrá en la pista de ${ghostStatus.name} para calcar un tramo · Esc para cancelar`
                : `Calco de ${ghostStatus.name} · ${ghostOffset(ghostStatus.offset)}`}
            </span>
            <button type="button" onClick={removeGhost} onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              if (ghostStatus.offset === null) removeGhost();
              else bodyRef.current?.focus();
            }}>{ghostStatus.offset === null ? 'Cancelar' : 'Quitar calco'}</button>
          </div>
        )}
        {props.minimap !== false && (
          <Minimap
            ref={miniRef}
            depth={props.depth}
            curve={minimapCurve}
            zones={props.data.zones}
            theme={theme}
            headHeight={size.heads}
            onScrollTo={scrollTo}
            onInteract={stopReveal}
          />
        )}
      </div>
      {overflowTrack && (
        <Popover open anchorRef={overflowAnchor} onClose={() => setOverflow(null)} label={`Curvas de ${overflowTrack.title}`} width={Math.max(220, (layout.boxes[tracks.indexOf(overflowTrack)]?.width ?? 220) / ui)}>
          <div className="wv-overflow">
            <div className="wv-overflow__title">{overflowTrack.title}</div>
            {[...overflowTrack.curves].reverse().map((c) => legend(overflowTrack, c, 'pop'))}
          </div>
        </Popover>
      )}
      {notesDepth !== null && <NotesDialog key={props.data.wellId} data={props.data} depth={notesDepth} onClose={() => setNotesDepth(null)} />}
      {ctxMenu && (() => {
        const { header, items } = contextItems();
        return <ContextMenu at={{ x: ctxMenu.x, y: ctxMenu.y }} items={items} header={header} onClose={() => setCtxMenu(null)} returnFocus={bodyRef} aria-label={`Perfil a ${formatDepth(ctxMenu.depth)} m`} minWidth={260} />;
      })()}
      <p id={helpId} className="ui-visually-hidden">
        Flechas arriba y abajo mueven el cursor de profundidad (con Mayús, de a diez muestras); Re Pág y Av Pág desplazan
        una pantalla; Inicio y Fin van al tope y a la base; más y menos acercan y alejan; cero muestra todo el pozo. Con
        Tab se llega a los topes y bases de las zonas, que se mueven con las flechas. La tecla Menú o Mayús y F10 abren el
        menú del perfil en la profundidad del cursor: copiar lecturas, crear un tope, editar la pista, medir y exportar.
      </p>
      <div className="ui-visually-hidden" aria-live="polite" ref={liveRef} />
    </div>
  );
}

