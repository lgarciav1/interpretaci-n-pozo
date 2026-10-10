/**
 * Superposición «Gráficos conectados» (docs/decisiones/0014, D4): marca en el visor lo que se señala en el histograma
 * (tramos de las muestras de la clase bajo el puntero) y en el crossplot libre (línea en la profundidad del punto bajo
 * el puntero; tramos de la selección por rectángulo). Lee el estado de `src/plots/link.ts` y se redibuja con
 * `subscribe`. Sin stores de la app ni React: se descubre sola (`src/modules/<id>/overlay.ts`).
 */
import { scalePx } from '../../ui/tokens';
import { withAlpha } from '../../ui/color';
import { getPlotLink, subscribePlotLink } from '../../plots/link';
import type { DepthRun } from '../../plots/data';
import type { OverlayFrame, ViewerOverlay } from '../../viewer/overlay';

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

export const overlays: ViewerOverlay[] = [
  {
    id: 'plot-link',
    label: 'Gráficos conectados',
    layer: 'over',
    order: 50,
    subscribe: subscribePlotLink,
    draw(frame) {
      // Marcas de interacción: solo en el visor en pantalla (las figuras exportadas no tienen `commit`).
      if (!frame.data.commit) return;
      const s = getPlotLink();
      if (s.hoverDepth === null && !s.hoverRuns && !s.selection) return;
      const { ctx, theme, tracks, viewport: v } = frame;
      if (tracks.length === 0) return;
      const x0 = Math.min(...tracks.map((t) => t.x));
      const x1 = Math.max(...tracks.map((t) => t.x + t.width));
      const accent = theme.color.accent;
      ctx.save();
      if (s.selection) bands(frame, s.selection.runs, withAlpha(accent, 0.2), withAlpha(accent, 0.9), x0, x1);
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
