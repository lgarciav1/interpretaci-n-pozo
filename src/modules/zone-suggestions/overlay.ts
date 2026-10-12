/**
 * Superposición «Zonas sugeridas» (docs/decisiones/0025): los límites propuestos como líneas DISCONTINUAS a todo el
 * ancho del visor, en el color de acento (las zonas reales son líneas continuas del color de cada zona), con una
 * etiqueta «L3» (orden por fuerza) en la pista de profundidad. Las que caen a ≤ 2 m de un tope existente van más tenues.
 * Tooltip con el salto de GR; clic = seleccionarla en el panel; arrastre o ↑/↓ = editar su profundidad antes de
 * aceptarla. Lee el estado de `store.ts` (lo publica el panel mientras está abierto) y se redibuja con `subscribe`.
 * Solo en pantalla (las figuras exportadas no tienen `commit`).
 */
import { formatNumber } from '../../ui/format';
import { withAlpha } from '../../ui/color';
import { BASE_TOKENS, scalePx } from '../../ui/tokens';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayTarget, ViewerOverlay } from '../../viewer/overlay';
import { editSuggestion, getSuggestionUi, selectSuggestion, subscribeSuggestionUi, type ShownLine } from './store';

const OVERLAY_ID = 'zone-suggestions';

/** Vista previa de un arrastre (key → profundidad), para no escribir el store en cada movimiento. */
let preview: { key: string; depth: number } | null = null;

const linesFor = (frame: OverlayHitFrame): readonly ShownLine[] => {
  const st = getSuggestionUi();
  if (!frame.data.commit || st.wellId !== frame.data.wellId) return [];
  return st.lines;
};
const depthOf = (l: ShownLine) => (preview && preview.key === l.key ? preview.depth : l.depth);
const tag = (l: ShownLine) => `L${l.rank}`;
const fmtM = (v: number) => `${formatNumber(v, { digits: 2 })} m`;

function hitFor(frame: OverlayHitFrame, l: ShownLine): OverlayHit & { key: string } {
  return {
    key: l.key,
    label: `Límite sugerido ${tag(l)} · ${fmtM(depthOf(l))}\n${l.label}${l.near ? '\nHay un tope existente a menos de 2 m.' : ''}\nArrastrá para ajustar la profundidad; aceptalo en el panel.`,
    cursor: 'ns-resize',
    activate: () => selectSuggestion(l.key),
    nudge(deltaM) {
      editSuggestion(l.key, depthOf(l) + deltaM);
    },
    drag: {
      cursor: 'ns-resize',
      move(p) {
        if (!Number.isFinite(p.depth)) return;
        preview = { key: l.key, depth: p.depth };
        selectSuggestion(l.key);
        frame.invalidate();
      },
      end(p) {
        preview = null;
        if (Number.isFinite(p.depth)) editSuggestion(l.key, p.depth);
      },
      cancel() {
        preview = null;
        frame.invalidate();
      },
    },
  };
}

export const overlays: ViewerOverlay[] = [
  {
    id: OVERLAY_ID,
    label: 'Zonas sugeridas',
    layer: 'over',
    order: 30,
    subscribe: subscribeSuggestionUi,
    draw(frame: OverlayFrame) {
      const lines = linesFor(frame);
      if (!lines.length || !frame.tracks.length) return;
      const { ctx, theme, tracks, viewport: vp } = frame;
      const u = frame.uiScale ?? 1;
      const selected = getSuggestionUi().selectedKey;
      const x0 = Math.min(...tracks.map((t) => t.x));
      const x1 = Math.max(...tracks.map((t) => t.x + t.width));
      // Etiqueta en la pista de profundidad (los números van a la derecha: la izquierda está libre y siempre a la vista).
      const depthTrack = tracks.find((t) => t.kind === 'depth');
      const tagX = (depthTrack ?? tracks[0]!).x + scalePx(4, u);
      const accent = theme.color.accent;
      const muted = theme.color.textMuted;
      ctx.save();
      ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      // Las seleccionadas y las fuertes, encima.
      const order = [...lines].sort((a, b) => (a.key === selected ? 1 : b.key === selected ? -1 : b.rank - a.rank));
      for (const l of order) {
        const d = depthOf(l);
        if (d < vp.top || d > vp.base) continue;
        const isSel = l.key === selected;
        const color = l.near && !isSel ? muted : accent;
        const y = Math.round(vp.yOf(d)) + 0.5;
        // Halo del fondo para que la línea se lea sobre curvas y rellenos.
        ctx.setLineDash([]);
        ctx.strokeStyle = withAlpha(theme.viewer.trackBg, 0.7);
        ctx.lineWidth = isSel ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.strokeStyle = withAlpha(color, isSel ? 1 : l.near ? 0.65 : 0.9);
        ctx.lineWidth = isSel ? 2 : 1.25;
        ctx.setLineDash(isSel ? [8, 4] : [6, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        // Etiqueta «L3».
        const text = tag(l);
        const ph = scalePx(15, u);
        const pw = ctx.measureText(text).width + scalePx(10, u);
        const bx = tagX;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.roundRect(bx, y - ph / 2, pw, ph, ph / 2);
        if (isSel) {
          ctx.fillStyle = accent;
          ctx.fill();
          ctx.fillStyle = theme.color.textOnAccent;
        } else {
          ctx.fillStyle = theme.color.surface;
          ctx.fill();
          ctx.strokeStyle = withAlpha(color, 0.9);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = l.near ? muted : theme.color.accentText;
        }
        ctx.fillText(text, bx + pw / 2, y + 0.5);
      }
      ctx.restore();
    },
    hit(frame: OverlayHitFrame, p): OverlayHit | null {
      const lines = linesFor(frame);
      if (!lines.length || !p.track) return null;
      const tol = scalePx(4, frame.uiScale ?? 1);
      let best: ShownLine | null = null;
      let bestDy = Infinity;
      for (const l of lines) {
        const dy = Math.abs(frame.viewport.yOf(depthOf(l)) - p.y);
        if (dy <= tol && dy < bestDy) {
          best = l;
          bestDy = dy;
        }
      }
      return best ? hitFor(frame, best) : null;
    },
    targets(frame: OverlayHitFrame): OverlayTarget[] {
      return linesFor(frame).map((l) => ({ depth: depthOf(l), hit: hitFor(frame, l) }));
    },
  },
];
