/**
 * Visor multipista (docs/decisiones/0005-visor-multipista.md). Encabezados HTML (CurveLegend + lectura del cursor)
 * sobre dos canvas apilados: base (pistas, grilla, rellenos, curvas, superposiciones) y cursor.
 *
 * Rendimiento: el viewport y el cursor viven en refs, no en estado de React. Toda interacción marca qué canvas
 * está sucio y pide un único requestAnimationFrame; mover el mouse solo redibuja el canvas de cursor y escribe las
 * lecturas directo en el DOM. React re-renderiza solo si cambian pistas, datos, tema o tamaño.
 *
 * El componente no conoce stores: recibe pistas resueltas, datos y superposiciones, y publica cursor y tramo
 * visible por callbacks (src/app/shell/ViewerSlot.tsx los conecta).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CurveLegend, formatNumber, getResolvedTheme, IconButton, useResolvedTheme } from '../ui';
import { THEMES } from '../ui/tokens';
import { layoutTracks, trackAt } from './layout';
import { PointerGestures, type HitResult } from './interaction';
import { guard, type OverlayHit, type OverlayPointer, type ViewerData, type ViewerOverlay } from './overlay';
import { formatDepth, formatReadout, nearestIndex, valueAt } from './readout';
import { overlayTracks, overlayViewport, ViewerRenderer, type FrameInput } from './render';
import type { ResolvedTrack } from './resolve';
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
  zoomAt,
  type Viewport,
  type ViewportLimits,
} from './viewport';
import './viewer.css';

export interface WellViewerProps {
  /** Cambia cuando cambia el pozo (o su profundidad): se vuelve a "ver todo". */
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
  onCursorChange?(depth: number | null): void;
  onViewportChange?(range: { top: number; base: number }): void;
}

const ZOOM_STEP = 1.25;
const WHEEL_ZOOM = 0.0018;
const LINE_PX = 16;

interface Pointer {
  x: number;
  y: number;
}

export function WellViewer(props: WellViewerProps) {
  const { tracks, wellKey, label, toolbarStart } = props;
  const theme = useResolvedTheme();
  const propsRef = useRef(props);
  propsRef.current = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLSpanElement>(null);
  const scaleRef = useRef<HTMLSpanElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const readouts = useRef(new Map<string, HTMLSpanElement>());

  const [size, setSize] = useState({ width: 0, height: 0 });
  const layout = useMemo(() => layoutTracks(tracks.map((t) => ({ width: t.width, ...(t.fixed !== undefined ? { fixed: t.fixed } : {}) })), size.width), [tracks, size.width]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const renderer = useRef<ViewerRenderer>(null as unknown as ViewerRenderer);
  renderer.current ??= new ViewerRenderer();
  const vpRef = useRef<Viewport | null>(null);
  const limRef = useRef<ViewportLimits | null>(null);
  const cursor = useRef<{ depth: number | null; source: 'pointer' | 'keyboard' | null }>({ depth: null, source: null });
  const pointer = useRef<Pointer | null>(null);
  /** Puntero apretado (capturado) por un gesto: paneo o arrastre de una superposición. */
  const pressed = useRef<number | null>(null);
  const tickFrame = useRef(0);
  const touches = useRef(new Map<number, Pointer>());
  const pinch = useRef<{ dist: number } | null>(null);
  const dirty = useRef({ base: false, cursor: false, frame: 0 });
  const frameTimes = useRef<number[]>([]);
  const lastPublished = useRef<{ top: number; base: number } | null>(null);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── dibujo ──────────────────────────────────────────────────────────────────────────────────────────────────
  const frameInput = useCallback((): FrameInput | null => {
    const vp = vpRef.current;
    if (!vp) return null;
    const p = propsRef.current;
    return {
      tracks: p.tracks,
      boxes: layoutRef.current.boxes,
      viewport: vp,
      theme: THEMES[getResolvedTheme()],
      depth: p.depth,
      width: layoutRef.current.total,
      overlays: p.overlays,
      data: p.data,
      invalidate: () => invalidateRef.current('base'),
    };
  }, []);
  const invalidateRef = useRef<(what: 'base' | 'cursor') => void>(() => {});

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
    for (const t of p.tracks) {
      for (const c of t.curves) {
        const el = readouts.current.get(`${t.id}|${c.key}`);
        if (el) el.textContent = idx < 0 ? '' : formatReadout(valueAt(c.data, idx), c.kind);
      }
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
      if (scaleRef.current) scaleRef.current.textContent = `1:${formatNumber(+scaleRatio(f.viewport.pxPerM).toPrecision(2), { digits: 0 })}`;
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
  }, [frameInput, updateReadouts]);

  const invalidate = useCallback(
    (what: 'base' | 'cursor') => {
      if (what === 'base') dirty.current.base = true;
      dirty.current.cursor = true;
      if (!dirty.current.frame) dirty.current.frame = requestAnimationFrame(paint);
    },
    [paint],
  );
  invalidateRef.current = invalidate;

  useEffect(
    () => () => {
      // Con StrictMode el efecto se desmonta y se vuelve a montar: hay que olvidar el cuadro cancelado.
      cancelAnimationFrame(dirty.current.frame);
      cancelAnimationFrame(tickFrame.current);
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
      invalidate('cursor');
      propsRef.current.onCursorChange?.(depth);
    },
    [invalidate],
  );

  // Tamaño disponible (ancho del contenedor con desplazamiento horizontal, alto del cuerpo).
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const body = bodyRef.current;
    if (!scroll || !body) return;
    const measure = () => setSize((s) => (s.width === scroll.clientWidth && s.height === body.clientHeight ? s : { width: scroll.clientWidth, height: body.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroll);
    ro.observe(body);
    return () => ro.disconnect();
  }, []);

  // Pozo nuevo → ver todo. Alto nuevo → conservar tope y zoom.
  const wellKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (size.height <= 0) return;
    const p = propsRef.current;
    const lim = viewportLimits(p.depth, size.height, p.depthStep);
    const prevLim = limRef.current;
    limRef.current = lim;
    if (wellKeyRef.current !== wellKey || !vpRef.current || !prevLim) {
      wellKeyRef.current = wellKey;
      renderer.current.reset();
      vpRef.current = fitAll(lim, size.height);
      cursor.current = { depth: null, source: null };
    } else {
      vpRef.current = resizeViewport(vpRef.current, prevLim, lim, size.height);
    }
    invalidate('base');
  }, [wellKey, size.height, invalidate]);

  // Cambios de pistas, datos, tema o ancho → redibujar.
  useEffect(() => invalidate('base'), [tracks, props.data, props.overlays, theme, layout, invalidate]);

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
      const c = cursor.current.depth;
      const y = anchorY ?? (c !== null && c >= vp.top && c <= baseOf(vp) ? (c - vp.top) * vp.pxPerM : vp.height / 2);
      setViewport(zoomAt(vp, factor, y, lim));
    },
    [setViewport],
  );

  const fit = useCallback(() => {
    const vp = vpRef.current;
    const lim = limRef.current;
    if (vp && lim) setViewport(fitAll(lim, vp.height));
  }, [setViewport]);

  const show = useCallback(
    (top: number, base: number) => {
      const vp = vpRef.current;
      const lim = limRef.current;
      if (vp && lim) setViewport(showRange(lim, vp.height, top, base));
    },
    [setViewport],
  );

  const pointerDepth = () => {
    const vp = vpRef.current;
    const p = pointer.current;
    return vp && p ? depthOf(vp, p.y) : null;
  };

  const overlayPointer = useCallback(
    (p: Pointer): OverlayPointer | null => {
      const f = frameInput();
      if (!f) return null;
      const tracksO = overlayTracks(f.tracks, f.boxes);
      const ti = trackAt(f.boxes, p.x);
      return { x: p.x, y: p.y, depth: depthOf(f.viewport, p.y), track: ti >= 0 ? tracksO[ti]! : null };
    },
    [frameInput],
  );

  const hitAt = useCallback(
    (p: Pointer): HitResult | null => {
      const f = frameInput();
      if (!f) return null;
      const tracksO = overlayTracks(f.tracks, f.boxes);
      const ti = trackAt(f.boxes, p.x);
      const frame = { theme: f.theme, viewport: overlayViewport(f.viewport), tracks: tracksO, data: f.data, invalidate: () => invalidate('base') };
      const ptr = { x: p.x, y: p.y, depth: depthOf(f.viewport, p.y), track: ti >= 0 ? tracksO[ti]! : null };
      // Las de arriba primero (las 'over' y de mayor orden tapan a las otras).
      const ordered = [...f.overlays].sort((a, b) => (a.layer === b.layer ? (b.order ?? 0) - (a.order ?? 0) : a.layer === 'over' ? -1 : 1));
      for (const o of ordered) {
        if (!o.hit) continue;
        const h = guard(o.id, 'hit', () => o.hit!(frame, ptr));
        if (h) return { overlayId: o.id, hit: h };
      }
      return null;
    },
    [frameInput, invalidate],
  );

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
  });
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;
  const overlayPointerRef = useRef(overlayPointer);
  overlayPointerRef.current = overlayPointer;
  const hitAtRef = useRef(hitAt);
  hitAtRef.current = hitAt;
  const setCursorRef = useRef(setCursor);
  setCursorRef.current = setCursor;

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
        const rect = body.getBoundingClientRect();
        setViewport(zoomAt(vp, Math.exp(-e.deltaY * unit * WHEEL_ZOOM), e.clientY - rect.top, lim));
      } else if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        e.preventDefault();
        setViewport(scrollBy(vp, e.deltaY * unit, lim));
      } else return;
      if (cursor.current.source === 'pointer') setCursor(pointerDepth(), 'pointer');
    };
    body.addEventListener('wheel', onWheel, { passive: false });
    return () => body.removeEventListener('wheel', onWheel);
  }, [setViewport, setCursor]);

  const localPoint = (e: { clientX: number; clientY: number }): Pointer => {
    const rect = bodyRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = localPoint(e);
    pointer.current = p;
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
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = e.pointerId;
    gestures.current.down(e.pointerId, p);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = localPoint(e);
    pointer.current = p;
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

  const moveKeyboardCursor = (depth: number) => {
    const vp = vpRef.current;
    const lim = limRef.current;
    if (!vp || !lim) return;
    const d = Math.min(lim.max, Math.max(lim.min, depth));
    setViewport(ensureVisible(vp, d, lim));
    setCursor(d, 'keyboard');
    announce();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const vp = vpRef.current;
    const lim = limRef.current;
    if (!vp || !lim) return;
    const p = propsRef.current;
    const step = p.depthStep ?? (lim.max - lim.min) / Math.max(1, p.depth.length - 1);
    // ↑/↓: una muestra; si a este zoom una muestra mide menos de 2 px, las necesarias para moverse 2 px (que el
    // cursor se vea avanzar). Mayús ×10. El cursor queda SOBRE una muestra: la lectura es exacta.
    const samples = Math.max(1, Math.ceil(2 / (vp.pxPerM * step) - 1e-9)) * (e.shiftKey ? 10 : 1);
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
      case 'Escape':
        if (!gestures.current.cancel()) setCursor(null, null);
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

  // ── render ──────────────────────────────────────────────────────────────────────────────────────────────────
  const columns = layout.boxes.map((b) => `${b.width}px`).join(' ');
  const helpId = `wv-help-${wellKey.replace(/[^a-z0-9_-]/gi, '')}`;
  const heights = { height: size.height || undefined };

  return (
    <div className="wv" ref={rootRef}>
      <div className="wv-toolbar">
        <div className="wv-toolbar__start">{toolbarStart}</div>
        <div className="wv-toolbar__end">
          <span className="wv-toolbar__range num" ref={rangeRef} aria-label="Tramo visible" />
          <span className="wv-toolbar__scale num" ref={scaleRef} title="Escala vertical a 96 ppp" />
          <div className="wv-toolbar__zoom" role="group" aria-label="Zoom">
            <IconButton icon="zoom-out" size="sm" label="Alejar" hint="−" onClick={() => zoom(1 / ZOOM_STEP)} />
            <IconButton icon="zoom-in" size="sm" label="Acercar" hint="+" onClick={() => zoom(ZOOM_STEP)} />
            <IconButton icon="fit-height" size="sm" label="Ver todo el pozo" hint="0" onClick={fit} />
          </div>
        </div>
      </div>
      <div className="wv-scroll" ref={scrollRef}>
        <div className="wv-inner" style={{ width: layout.total || '100%' }}>
          <div className="wv-heads" style={{ gridTemplateColumns: columns }}>
            {tracks.map((t) => (
              <div key={t.id} className={`wv-head wv-head--${t.kind}`}>
                <div className="wv-head__title" title={t.title}>
                  {t.title}
                </div>
                {t.kind === 'depth' ? (
                  <div className="wv-head__depth num">m</div>
                ) : t.kind === 'overlay' ? (
                  <div className="wv-head__scale num">
                    <span>{t.grid ? formatNumber(t.grid.reversed ? t.grid.max : t.grid.min, { significant: 3, grouping: false }) : ''}</span>
                    {t.unit && <span className="wv-head__unit">{t.unit}</span>}
                    <span>{t.grid ? formatNumber(t.grid.reversed ? t.grid.min : t.grid.max, { significant: 3, grouping: false }) : ''}</span>
                  </div>
                ) : t.curves.length === 0 ? (
                  <div className="wv-head__empty">
                    <span>Sin curvas</span>
                    {t.emptyHint && <span className="wv-head__hint">{t.emptyHint}</span>}
                  </div>
                ) : (
                  <div className="wv-head__curves">
                    {[...t.curves].reverse().map((c) => (
                      <CurveLegend
                        key={c.key}
                        role={c.role}
                        name={c.kind === 'band' ? c.short : c.name}
                        layout="inline"
                        {...(c.kind === 'line' && c.unitLabel !== '—' ? { unit: c.unitLabel } : {})}
                        curveStyle={c.styles[theme]}
                        scale={c.kind === 'line'}
                        scaleTag={false}
                        title={c.wrap ? `${c.title} · con curva de respaldo` : c.title}
                        value={
                          <span
                            ref={(el) => {
                              const k = `${t.id}|${c.key}`;
                              if (el) readouts.current.set(k, el);
                              else readouts.current.delete(k);
                            }}
                          />
                        }
                      />
                    ))}
                  </div>
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
            aria-keyshortcuts="ArrowUp ArrowDown PageUp PageDown Home End + - 0 Escape"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onPointerLeave={onPointerLeave}
            onClick={onClick}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            onBlur={onBlur}
          >
            <canvas
              ref={baseRef}
              className="wv-canvas"
              style={{ width: layout.total, ...heights }}
              role="img"
              aria-label={`${label}: ${tracks.filter((t) => t.kind !== 'depth').map((t) => `${t.title}${t.curves.length ? ` (${t.curves.map((c) => c.name).join(', ')})` : ''}`).join('; ')}`}
            />
            <canvas ref={cursorRef} className="wv-canvas wv-canvas--cursor" style={{ width: layout.total, ...heights }} aria-hidden="true" />
            <div className="wv-tip" ref={tipRef} role="tooltip" hidden />
          </div>
        </div>
      </div>
      <p id={helpId} className="ui-visually-hidden">
        Flechas arriba y abajo mueven el cursor de profundidad (con Mayús, de a diez muestras); Re Pág y Av Pág desplazan
        una pantalla; Inicio y Fin van al tope y a la base; más y menos acercan y alejan; cero muestra todo el pozo.
      </p>
      <div className="ui-visually-hidden" aria-live="polite" ref={liveRef} />
    </div>
  );
}
