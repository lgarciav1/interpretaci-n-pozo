/**
 * Superposición «Gráficos conectados» (docs/decisiones/0014, D4; 0021, F): marca en el visor lo que se señala en el
 * histograma (tramos de las muestras de la clase bajo el puntero) y en el crossplot libre (línea en la profundidad del
 * punto bajo el puntero), y la SELECCIÓN compartida (lazo o rectángulo del crossplot, clases del histograma, tramo del
 * visor) como tramos que quedan hasta limpiarla.
 *
 * Sentido inverso: **Mayús + arrastre** en cualquier pista marca un tramo de profundidad; el crossplot resalta esos
 * puntos (el resto atenuado) y el histograma superpone su distribución. Mayús gana a los demás elementos del visor
 * (esta superposición es la de mayor orden): con Mayús no se mueven topes ni tendencias, se elige un tramo.
 *
 * Lee el estado de `src/plots/link.ts` y se redibuja con `subscribe`. Sin stores de la app ni React: se descubre sola
 * (`src/modules/<id>/overlay.ts`).
 */
import { BASE_TOKENS, canvasFont, scalePx } from '../../ui/tokens';
import { withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { getPlotLink, makeSelection, selectionFor, setPlotSelection, subscribePlotLink } from '../../plots/link';
import { intervalMask } from '../../plots/selection';
import type { DepthRun } from '../../plots/data';
import type { OverlayFrame, OverlayHitFrame, OverlayPointer, ViewerOverlay } from '../../viewer/overlay';

function bands(frame: OverlayFrame, runs: readonly DepthRun[], fill: string, edge: string, x0: number, x1: number): void {
  const { ctx, viewport: v } = frame;
  ctx.fillStyle = fill;
  for (const r of runs) {
    if (r.base < v.top || r.top > v.base) continue;
    const ya = v.yOf(r.top);
    const yb = v.yOf(r.base);
    ctx.fillRect(x0, ya, x1 - x0, Math.max(1, yb - ya));
  }
  // Marca en el borde izquierdo: se ve aunque el tramo sea de una sola muestra.
  ctx.fillStyle = edge;
  for (const r of runs) {
    if (r.base < v.top || r.top > v.base) continue;
    const ya = v.yOf(r.top);
    const yb = v.yOf(r.base);
    ctx.fillRect(x0, ya, 3, Math.max(2, yb - ya));
  }
}

const fmtM = (d: number) => formatNumber(d, { digits: 1 });

/** Bordes y rótulo de un tramo elegido en el visor (o en curso): «7 800,0–7 850,0 m · 328 muestras». */
function intervalMarks(frame: OverlayFrame, top: number, base: number, text: string, x0: number, x1: number): void {
  const { ctx, theme, viewport: v } = frame;
  const ui = frame.uiScale ?? 1;
  const accent = theme.color.accent;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 3]);
  for (const d of [top, base]) {
    if (d < v.top || d > v.base) continue;
    const y = Math.round(v.yOf(d)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Rótulo junto al tope (o arriba del todo si el tope quedó fuera de la vista), a la derecha de la pista de
  // profundidad para no tapar sus números.
  const y = Math.max(v.yOf(Math.max(top, v.top)), 0) + scalePx(4, ui);
  ctx.font = canvasFont(BASE_TOKENS.text.xs, 600, ui);
  const w = ctx.measureText(text).width + scalePx(10, ui);
  const h = scalePx(18, ui);
  const depthTrack = frame.tracks.find((t) => t.kind === 'depth');
  const x = (depthTrack ? depthTrack.x + depthTrack.width : x0) + scalePx(8, ui);
  ctx.fillStyle = withAlpha(theme.viewer.trackBg, 0.92);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = withAlpha(accent, 0.7);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = accent;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + scalePx(5, ui), y + h / 2);
}

/** Tramo que se está marcando con Mayús + arrastre (vista previa, solo en esta superposición). */
let preview: { top: number; base: number } | null = null;

function depthLimits(frame: OverlayHitFrame): { min: number; max: number } | null {
  const d = frame.data.depth;
  return d.length ? { min: d[0]!, max: d[d.length - 1]! } : null;
}

function intervalOf(frame: OverlayHitFrame, p: OverlayPointer, start: OverlayPointer): { top: number; base: number } | null {
  const lim = depthLimits(frame);
  if (!lim || !Number.isFinite(p.depth) || !Number.isFinite(start.depth)) return null;
  const clamp = (d: number) => Math.min(lim.max, Math.max(lim.min, d));
  const a = clamp(Math.min(p.depth, start.depth));
  const b = clamp(Math.max(p.depth, start.depth));
  return b > a ? { top: a, base: b } : null;
}

export const overlays: ViewerOverlay[] = [
  {
    id: 'plot-link',
    label: 'Gráficos conectados',
    layer: 'over',
    order: 50,
    subscribe: subscribePlotLink,
    hit(frame, p) {
      // Solo en el visor interactivo y con Mayús: elegir un tramo para el crossplot y el histograma.
      if (!p.shiftKey || !frame.data.commit) return null;
      return {
        label: 'Mayús + arrastre: marcar un tramo y verlo en el crossplot y el histograma',
        cursor: 'crosshair',
        drag: {
          cursor: 'crosshair',
          move(q, start) {
            preview = intervalOf(frame, q, start);
            frame.invalidate();
          },
          end(q, start) {
            const iv = intervalOf(frame, q, start);
            preview = null;
            if (iv) {
              const depth = frame.data.depth;
              const sel = makeSelection('viewer', depth, intervalMask(depth, iv.top, iv.base), { kind: 'interval', top: iv.top, base: iv.base });
              setPlotSelection(sel);
            }
            frame.invalidate();
          },
          cancel() {
            preview = null;
            frame.invalidate();
          },
        },
      };
    },
    draw(frame) {
      // Marcas de interacción: solo en el visor en pantalla (las figuras exportadas no tienen `commit`).
      if (!frame.data.commit) return;
      const s = getPlotLink();
      const sel = selectionFor(frame.data.depth);
      if (s.hoverDepth === null && !s.hoverRuns && !sel && !preview) return;
      const { ctx, theme, tracks, viewport: v } = frame;
      if (tracks.length === 0) return;
      const x0 = Math.min(...tracks.map((t) => t.x));
      const x1 = Math.max(...tracks.map((t) => t.x + t.width));
      const accent = theme.color.accent;
      ctx.save();
      if (sel) bands(frame, sel.runs, withAlpha(accent, 0.13), withAlpha(accent, 0.85), x0, x1);
      if (sel?.detail.kind === 'interval' && !preview) intervalMarks(frame, sel.detail.top, sel.detail.base, `${fmtM(sel.detail.top)}–${fmtM(sel.detail.base)} m · ${formatNumber(sel.count, { digits: 0 })} muestras`, x0, x1);
      if (preview) {
        bands(frame, [preview], withAlpha(accent, 0.1), withAlpha(accent, 0.6), x0, x1);
        intervalMarks(frame, preview.top, preview.base, `${fmtM(preview.top)}–${fmtM(preview.base)} m`, x0, x1);
      }
      if (s.hoverRuns) bands(frame, s.hoverRuns, withAlpha(accent, 0.16), accent, x0, x1);
      if (s.hoverDepth !== null && s.hoverDepth >= v.top && s.hoverDepth <= v.base) {
        const y = Math.round(v.yOf(s.hoverDepth)) + 0.5;
        const ui = frame.uiScale ?? 1;
        ctx.strokeStyle = withAlpha(theme.viewer.trackBg, 0.85);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        // Rombo en el borde izquierdo: «este es el punto del crossplot».
        const r = scalePx(5, ui);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(x0 + r, y - r);
        ctx.lineTo(x0 + 2 * r, y);
        ctx.lineTo(x0 + r, y + r);
        ctx.lineTo(x0, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
  },
];
