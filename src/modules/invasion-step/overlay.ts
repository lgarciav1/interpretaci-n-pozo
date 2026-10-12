/**
 * Superposición «Perfil radial fijado» (docs/decisiones/0020, sección 8): con una profundidad fijada en la pestaña
 * «Perfil radial», una línea fina a esa profundidad en todas las pistas y una etiqueta, para no perder de vista qué
 * muestra el panel mientras el cursor recorre el pozo. Lee el estado de `pin.ts` y se redibuja con `subscribe`. Solo
 * en pantalla (las figuras exportadas no tienen `commit`). Se descubre sola (`src/modules/<id>/overlay.ts`).
 */
import { withAlpha } from '../../ui/color';
import { BASE_TOKENS, canvasFont, scalePx } from '../../ui/tokens';
import type { ViewerOverlay } from '../../viewer/overlay';
import { getRadialPin, subscribeRadialPin } from './pin';

export const overlays: ViewerOverlay[] = [
  {
    id: 'radial-pin',
    label: 'Perfil radial fijado',
    layer: 'over',
    order: 40,
    subscribe: subscribeRadialPin,
    draw(frame) {
      if (!frame.data.commit) return;
      const pin = getRadialPin();
      if (pin.pinnedDepth === null || pin.wellId !== frame.data.wellId) return;
      const { ctx, theme, tracks, viewport: v } = frame;
      const d = pin.pinnedDepth;
      if (tracks.length === 0 || d < v.top || d > v.base) return;
      const ui = frame.uiScale ?? 1;
      const x0 = Math.min(...tracks.map((t) => t.x));
      const x1 = Math.max(...tracks.map((t) => t.x + t.width));
      const y = Math.round(v.yOf(d)) + 0.5;
      const ink = theme.color.text;
      ctx.save();
      ctx.strokeStyle = withAlpha(theme.viewer.trackBg, 0.85);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(ink, 0.8);
      ctx.lineWidth = 1.25;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Etiqueta a la izquierda, sobre la línea (la derecha puede quedar fuera de la vista si las pistas desbordan).
      const text = 'Perfil radial';
      ctx.font = canvasFont(BASE_TOKENS.text.xs, BASE_TOKENS.weight.medium, ui);
      const w = ctx.measureText(text).width;
      const pad = scalePx(4, ui);
      const h = scalePx(15, ui);
      const bx = x0 + scalePx(26, ui);
      const by = y - h - scalePx(2, ui);
      ctx.fillStyle = withAlpha(ink, 0.88);
      ctx.beginPath();
      ctx.roundRect(bx, by, w + 2 * pad, h, scalePx(3, ui));
      ctx.fill();
      ctx.fillStyle = theme.viewer.trackBg;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + pad, by + h / 2);
      ctx.restore();
    },
  },
];
