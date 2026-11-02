/**
 * Lienzo de la mesa (docs/decisiones/0063): imagen con zoom (rueda) y desplazamiento (arrastrar, barra espaciadora o
 * botón del medio), cruz de lectura en vivo y las herramientas de marcado (geometría, amarres, bordes, cuentagotas,
 * región, guía, pintar, borrar y agregar puntos). Todo se dibuja en un único canvas por encima de la imagen.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { valueAtX, type PixelPoint, type TraceMask } from '../../../digitizer';
import { getThemeTokens, getUiScaleFactor, isTypingTarget, subscribeTheme, subscribeUiScale, toast } from '../../../ui';
import { formatNumber } from '../../../ui/format';
import { unitLabel } from '../../../core/units';
import { calibrationOf, depthInImageUnit, draftId, frameOf, pickColorAt, updateCurve } from '../model/form';
import { eraseTrace, paintTrace } from '../model/traceEdit';
import { clampPan, fitImage, fitWidth, imageToScreen, panBy, screenDistance, screenToImage, zoomAt, type Viewport } from '../model/viewport';
import { useDigitizer, type Tool } from '../store';
import { drawDesk, type DeskScene } from '../draw';
import { useDeskView } from './viewStore';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vp: Viewport }
  | { kind: 'tilt' | 'quad'; index: number }
  | { kind: 'tie'; id: string }
  | { kind: 'edge'; side: 'left' | 'right' }
  | { kind: 'rect'; a: PixelPoint; b: PixelPoint }
  | { kind: 'paint'; last: PixelPoint }
  | { kind: 'band'; y0: number; y1: number }
  | { kind: 'guide'; index: number };

const S = () => useDigitizer.getState();

/** Herramientas que trabajan sobre la imagen original (las demás, sobre la corregida). */
export const ORIGINAL_TOOLS: readonly Tool[] = ['tilt', 'quad'];

async function toBitmap(data: Uint8ClampedArray, width: number, height: number): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height));
  } catch {
    return null;
  }
}

/** Máscara (0–255) → imagen RGBA del color de acento con alfa = intensidad. */
function maskRgba(m: TraceMask, rgb: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(m.width * m.height * 4);
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i]!;
    if (v === 0) continue;
    out[i * 4] = rgb[0];
    out[i * 4 + 1] = rgb[1];
    out[i * 4 + 2] = rgb[2];
    out[i * 4 + 3] = Math.min(255, 60 + v);
  }
  return out;
}

export function DeskCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmaps = useRef<{ original: ImageBitmap | null; corrected: ImageBitmap | null; mask: { bitmap: ImageBitmap; x0: number; y0: number } | null }>({ original: null, corrected: null, mask: null });
  const drag = useRef<Drag | null>(null);
  const addChain = useRef<PixelPoint | null>(null);
  const cursorRef = useRef<{ sx: number; sy: number } | null>(null);
  const frame = useRef(0);
  const [, setBitmapVersion] = useState(0);

  const image = useDigitizer((s) => s.image);
  const corrected = useDigitizer((s) => s.corrected);
  const mask = useDigitizer((s) => s.mask);
  const tool = useDigitizer((s) => s.tool);
  const spacePan = useDeskView((s) => s.spacePan);

  const viewImage = () => {
    const st = S();
    return st.view === 'original' ? st.image?.original ?? null : st.corrected;
  };

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const st = S();
    const img = viewImage();
    const vp = useDeskView.getState().vp;
    const cal = calibrationOf(st.work).calibration;
    const sel = st.work.curves.find((c) => c.id === st.selectedCurveId) ?? null;
    const theme = getThemeTokens();
    const ui = getUiScaleFactor();
    let label: string[] = [];
    const cur = cursorRef.current;
    if (cur && img) {
      const p = screenToImage(vp, cur.sx, cur.sy);
      if (st.view === 'original') label = [`x ${Math.round(p.x)} · y ${Math.round(p.y)} px`];
      else {
        const d = depthInImageUnit(cal, p.y);
        if (Number.isFinite(d)) label.push(`${formatNumber(d, { digits: 2 })} ${cal!.unit}`);
        const f = sel ? frameOf(sel).frame : null;
        if (sel && f) label.push(`${sel.mnemonic} ${formatNumber(valueAtX(f, p.x), { significant: 4 })} ${unitLabel(sel.unit)}`);
        if (!label.length) label = [`fila ${Math.round(p.y)} px`];
      }
    }
    const scene: DeskScene = {
      width,
      height,
      vp,
      view: st.view,
      bitmap: st.view === 'original' ? bitmaps.current.original : bitmaps.current.corrected,
      imgW: img?.width ?? 0,
      imgH: img?.height ?? 0,
      mask: st.view === 'mask' && st.mask ? bitmaps.current.mask : null,
      tilt: st.picks.tilt,
      quad: st.picks.quad,
      ties: st.work.ties,
      tieUnit: st.work.depthUnit,
      cal,
      curves: st.work.curves,
      selectedId: st.selectedCurveId,
      cursor: cur ? { ...cur, label } : null,
      preview: drag.current?.kind === 'rect' ? { kind: 'rect', a: drag.current.a, b: drag.current.b } : drag.current?.kind === 'band' ? { kind: 'band', y0: drag.current.y0, y1: drag.current.y1 } : null,
      showTraces: true,
      focusTieId: st.focusTieId,
    };
    drawDesk(ctx, scene, theme, ui);
  }, []);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(paint);
  }, [paint]);

  const setVp = useCallback(
    (vp: Viewport) => {
      const img = viewImage();
      const { size } = useDeskView.getState();
      useDeskView.setState({ vp: img ? clampPan(vp, img.width, img.height, size.width, size.height) : vp });
    },
    [],
  );

  const fit = useCallback(() => {
    const img = viewImage();
    const { size } = useDeskView.getState();
    if (!img || !size.width) return;
    const tall = img.height / img.width > (size.height / size.width) * 2.2;
    useDeskView.setState({ vp: tall ? fitWidth(img.width, size.width, 24) : fitImage(img.width, img.height, size.width, size.height, 24) });
  }, []);

  // Tamaño del lienzo.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const first = useDeskView.getState().size.width === 0;
      useDeskView.setState({ size: { width: el.clientWidth, height: el.clientHeight } });
      if (first) fit();
      schedule();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, schedule]);

  // Redibujar ante cualquier cambio de la mesa, de la vista, del tema o del tamaño de interfaz.
  useEffect(() => {
    const a = useDigitizer.subscribe(schedule);
    const b = useDeskView.subscribe((s, p) => {
      if (s.vp === p.vp) return;
      schedule();
      // La vista queda en el DOM para pruebas automáticas (convertir puntos de la imagen a la pantalla).
      const el = canvasRef.current;
      if (el) el.dataset['viewport'] = `${s.vp.scale} ${s.vp.ox} ${s.vp.oy}`;
    });
    const c = subscribeTheme(schedule);
    const d = subscribeUiScale(schedule);
    return () => {
      a();
      b();
      c();
      d();
      cancelAnimationFrame(frame.current);
    };
  }, [schedule]);

  // Pedido de encuadre (imagen nueva, geometría aplicada, botón).
  const fitSeq = useDigitizer((s) => s.fitSeq);
  useEffect(() => {
    fit();
  }, [fitSeq, fit]);

  // Imágenes → ImageBitmap (una vez por imagen).
  useEffect(() => {
    let alive = true;
    const o = image?.original;
    bitmaps.current.original?.close();
    bitmaps.current.original = null;
    if (o) void toBitmap(o.data, o.width, o.height).then((b) => (alive ? ((bitmaps.current.original = b), setBitmapVersion((v) => v + 1), schedule()) : b?.close()));
    return () => {
      alive = false;
    };
  }, [image, schedule]);
  useEffect(() => {
    let alive = true;
    if (corrected && corrected === image?.original) {
      // Sin geometría: la corregida es la original (se espera su bitmap).
      const wait = () => {
        if (!alive) return;
        if (bitmaps.current.original) {
          bitmaps.current.corrected = bitmaps.current.original;
          schedule();
        } else setTimeout(wait, 30);
      };
      wait();
    } else if (corrected) {
      bitmaps.current.corrected = null;
      void toBitmap(corrected.data, corrected.width, corrected.height).then((b) => (alive ? ((bitmaps.current.corrected = b), setBitmapVersion((v) => v + 1), schedule()) : b?.close()));
    } else bitmaps.current.corrected = null;
    return () => {
      alive = false;
    };
  }, [corrected, image, schedule]);
  useEffect(() => {
    let alive = true;
    bitmaps.current.mask?.bitmap.close();
    bitmaps.current.mask = null;
    if (mask) {
      const c = S().work.curves.find((k) => k.id === mask.curveId);
      const rgb: [number, number, number] = c?.color?.mode === 'color' ? [255 - c.color.rgb[0], 255 - c.color.rgb[1], 255 - c.color.rgb[2]] : [255, 106, 0];
      const m = mask.mask;
      void toBitmap(maskRgba(m, rgb), m.width, m.height).then((b) => {
        if (!alive || !b) return b?.close();
        bitmaps.current.mask = { bitmap: b, x0: m.x0, y0: m.y0 };
        schedule();
      });
    }
    return () => {
      alive = false;
    };
  }, [mask, schedule]);

  // Rueda: zoom alrededor del puntero (listener no pasivo para poder evitar el desplazamiento de la página).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const vp = useDeskView.getState().vp;
      if (e.shiftKey) setVp(panBy(vp, -e.deltaY, 0));
      else setVp(zoomAt(vp, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setVp]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const updateCursor = (sx: number, sy: number) => {
    cursorRef.current = { sx, sy };
    const img = viewImage();
    const st = S();
    if (!img) return;
    const vp = useDeskView.getState().vp;
    const p = screenToImage(vp, sx, sy);
    const cal = st.view === 'original' ? null : calibrationOf(st.work).calibration;
    const sel = st.work.curves.find((c) => c.id === st.selectedCurveId);
    const f = sel && st.view !== 'original' ? frameOf(sel).frame : null;
    useDeskView.setState({
      cursor: {
        x: p.x,
        y: p.y,
        inside: p.x >= -0.5 && p.y >= -0.5 && p.x <= img.width - 0.5 && p.y <= img.height - 0.5,
        depth: depthInImageUnit(cal, p.y),
        value: f ? valueAtX(f, p.x) : NaN,
      },
    });
    schedule();
  };

  const selected = () => {
    const st = S();
    return st.work.curves.find((c) => c.id === st.selectedCurveId) ?? null;
  };

  const effectiveTool = (e: React.PointerEvent): Tool => (e.button === 1 || useDeskView.getState().spacePan ? 'pan' : S().tool);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return;
    // Un campo de texto con foco se tragaría los atajos (barra espaciadora, letras): el lienzo lo suelta.
    const active = document.activeElement as HTMLElement | null;
    if (active && isTypingTarget(active)) active.blur();
    const img = viewImage();
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { sx, sy } = local(e);
    const vp = useDeskView.getState().vp;
    const p = screenToImage(vp, sx, sy);
    const st = S();
    const t = effectiveTool(e);
    const near = (q: PixelPoint) => screenDistance(vp, q, sx, sy) <= 9;
    switch (t) {
      case 'pan':
        drag.current = { kind: 'pan', sx, sy, vp };
        break;
      case 'tilt':
      case 'quad': {
        const list = st.picks[t];
        const hit = list.findIndex(near);
        if (hit >= 0) drag.current = { kind: t, index: hit };
        else {
          const max = t === 'tilt' ? 2 : 4;
          const next = list.length >= max ? [p] : [...list, p];
          st.set({ picks: { ...st.picks, [t]: next } });
          drag.current = { kind: t, index: next.length - 1 };
        }
        break;
      }
      case 'tie': {
        const hit = st.work.ties.find((k) => Math.abs(imageToScreen(vp, 0, k.y).y - sy) <= 6);
        st.beginGesture();
        if (hit) {
          drag.current = { kind: 'tie', id: hit.id };
          st.set({ focusTieId: hit.id });
        } else {
          const id = draftId('t');
          st.updateWork((w) => ({ ...w, ties: [...w.ties, { id, y: p.y, depth: null }].sort((a, b) => a.y - b.y) }), { record: false });
          st.set({ focusTieId: id });
          drag.current = { kind: 'tie', id };
        }
        break;
      }
      case 'edge-left':
      case 'edge-right': {
        const c = selected();
        if (!c) {
          toast({ title: 'Agregá o elegí una curva primero', tone: 'warn' });
          return;
        }
        const side = t === 'edge-left' ? 'left' : 'right';
        st.beginGesture();
        st.updateWork((w) => updateCurve(w, c.id, side === 'left' ? { leftPx: p.x } : { rightPx: p.x }), { record: false });
        drag.current = { kind: 'edge', side };
        break;
      }
      case 'eyedropper': {
        const c = selected();
        if (!c || !st.corrected) return;
        const r = pickColorAt(st.corrected, p.x, p.y);
        if (!r) {
          toast({ title: 'Ahí no hay un trazo', description: 'Solo hay papel o grilla clara. Hacé clic justo sobre el trazo de la curva (acercá el zoom si hace falta).', tone: 'warn' });
          return;
        }
        st.updateWork((w) => updateCurve(w, c.id, { color: r.spec }));
        st.set({ tool: 'pan', mask: null });
        break;
      }
      case 'region':
        drag.current = { kind: 'rect', a: p, b: p };
        break;
      case 'guide': {
        const c = selected();
        if (!c) return;
        const hit = c.guide.findIndex(near);
        st.beginGesture();
        if (hit >= 0) drag.current = { kind: 'guide', index: hit };
        else {
          st.updateWork((w) => updateCurve(w, c.id, { guide: [...c.guide, p], mode: 'guided' }), { record: false });
          drag.current = { kind: 'guide', index: c.guide.length };
        }
        break;
      }
      case 'paint': {
        const c = selected();
        if (!c) return;
        st.beginGesture();
        st.updateWork((w) => updateCurve(w, c.id, { trace: paintTrace(c.trace, p) }), { record: false });
        drag.current = { kind: 'paint', last: p };
        break;
      }
      case 'erase':
        drag.current = { kind: 'band', y0: p.y, y1: p.y };
        break;
      case 'add': {
        const c = selected();
        if (!c) return;
        const from = !e.shiftKey && addChain.current ? addChain.current : p;
        st.updateWork((w) => updateCurve(w, c.id, { trace: paintTrace(c.trace, from, p) }));
        addChain.current = p;
        break;
      }
    }
    schedule();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = local(e);
    updateCursor(sx, sy);
    const d = drag.current;
    if (!d) return;
    const vp = useDeskView.getState().vp;
    const p = screenToImage(vp, sx, sy);
    const st = S();
    const c = selected();
    switch (d.kind) {
      case 'pan':
        setVp({ ...d.vp, ox: d.vp.ox + sx - d.sx, oy: d.vp.oy + sy - d.sy });
        break;
      case 'tilt':
      case 'quad': {
        const list = [...st.picks[d.kind]];
        list[d.index] = p;
        st.set({ picks: { ...st.picks, [d.kind]: list } });
        break;
      }
      case 'tie':
        st.updateWork((w) => ({ ...w, ties: w.ties.map((k) => (k.id === d.id ? { ...k, y: p.y } : k)) }), { record: false });
        break;
      case 'edge':
        if (c) st.updateWork((w) => updateCurve(w, c.id, d.side === 'left' ? { leftPx: p.x } : { rightPx: p.x }), { record: false });
        break;
      case 'rect':
        d.b = p;
        schedule();
        break;
      case 'band':
        d.y1 = p.y;
        schedule();
        break;
      case 'guide':
        if (c) {
          const g = [...c.guide];
          g[d.index] = p;
          st.updateWork((w) => updateCurve(w, c.id, { guide: g }), { record: false });
        }
        break;
      case 'paint':
        if (c) {
          st.updateWork((w) => updateCurve(w, c.id, { trace: paintTrace(c.trace, d.last, p) }), { record: false });
          d.last = p;
        }
        break;
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const st = S();
    const c = selected();
    if (d.kind === 'tie') st.set({ work: { ...st.work, ties: [...st.work.ties].sort((a, b) => a.y - b.y) } });
    if (d.kind === 'edge' && c) {
      // Flujo natural: borde izquierdo → derecho → color.
      if (d.side === 'left' && c.rightPx === null) st.set({ tool: 'edge-right' });
      else if (d.side === 'right') st.set({ tool: c.color ? 'pan' : 'eyedropper' });
    }
    if (d.kind === 'rect' && c) {
      const x0 = Math.min(d.a.x, d.b.x);
      const x1 = Math.max(d.a.x, d.b.x);
      const y0 = Math.min(d.a.y, d.b.y);
      const y1 = Math.max(d.a.y, d.b.y);
      if (x1 - x0 >= 3 && y1 - y0 >= 3) {
        st.updateWork((w) => updateCurve(w, c.id, { region: { x0, y0, x1, y1 } }));
        st.set({ tool: 'pan' });
      }
    }
    if (d.kind === 'band' && c?.trace) st.updateWork((w) => updateCurve(w, c.id, { trace: eraseTrace(c.trace!, d.y0, d.y1) }));
    schedule();
  };

  const onLeave = () => {
    cursorRef.current = null;
    useDeskView.setState({ cursor: null });
    schedule();
  };

  // Cambiar de herramienta corta la cadena de «agregar puntos».
  useEffect(() => {
    addChain.current = null;
  }, [tool]);

  const cursor = spacePan || tool === 'pan' ? (drag.current?.kind === 'pan' ? 'grabbing' : 'grab') : 'crosshair';

  return (
    <div ref={wrapRef} className="dz-canvas">
      <canvas
        ref={canvasRef}
        className="dz-canvas__el"
        style={{ cursor }}
        data-testid="digitizer-canvas"
        aria-label="Imagen del registro. Rueda: zoom; arrastrar con la mano o con la barra espaciadora: desplazar."
        role="img"
        onPointerDown={onPointerDown}
        // El clic en el lienzo no le quita el foco al panel (p. ej. al campo de profundidad del amarre recién marcado).
        onMouseDown={(e) => e.preventDefault()}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onLeave}
        onDoubleClick={() => {
          if (S().tool === 'guide') S().set({ tool: 'pan' });
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

/** Acciones de la vista para la barra de herramientas y los atajos. */
export const deskViewActions = {
  zoom(factor: number) {
    const { vp, size } = useDeskView.getState();
    useDeskView.setState({ vp: zoomAt(vp, factor, size.width / 2, size.height / 2) });
  },
  fit() {
    useDigitizer.setState((s) => ({ fitSeq: s.fitSeq + 1 }));
  },
  /** Centra la vista en una fila de la imagen corregida. */
  centerRow(y: number) {
    const { vp, size } = useDeskView.getState();
    useDeskView.setState({ vp: { ...vp, oy: size.height / 2 - (y + 0.5) * vp.scale } });
  },
};
