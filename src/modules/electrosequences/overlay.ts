/**
 * Pista «Electrosecuencias» del visor de Geología (docs/decisiones/0025). Contrato `ViewerOverlay`, descubierto solo:
 * no toca el núcleo del visor. Va al lado de la pista de GR (`after: 'spectral'`).
 *
 * La pista tiene la escala del GR (0–150 gAPI). Cada tramo de la segmentación lleva un fondo tenue del color de su
 * forma y una silueta anclada a la derecha cuyo borde izquierdo es el GR AJUSTADO del tramo (draw.ts): embudo,
 * campana, cilindro, rombo del simétrico y dientes del serrado se leen como el propio perfil. La opacidad dice la
 * confianza (la baja, además, con trazo discontinuo). Tooltip con forma, confianza, descripción e interpretación; clic = seleccionarlo
 * (el panel lo resalta); doble clic = ver el tramo. Mismos tramos que el módulo: misma función y mismos parámetros.
 */
import { formatNumber } from '../../ui/format';
import { withAlpha } from '../../ui/color';
import { BASE_TOKENS, scalePx } from '../../ui/tokens';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayTrack, ViewerOverlay } from '../../viewer/overlay';
import { drawShapeIcon, segmentOutline, shapeColor } from './draw';
import { CONFIDENCE_LABEL, sequenceAt, sequencesForWell } from './model';
import { getSelectedSequence, selectSequence, subscribeSelectedSequence } from './selection';

export const ESEQ_OVERLAY_ID = 'electrosequences';
/** Escala de GR de la pista (la del rol GR): el borde izquierdo de cada silueta es el GR ajustado del tramo. */
const TRACK_SCALE = { kind: 'linear' as const, min: 0, max: 150 };

const findTrack = (frame: OverlayHitFrame): OverlayTrack | undefined => frame.tracks.find((t) => t.overlayId === ESEQ_OVERLAY_ID);
const fmtM = (v: number) => formatNumber(v, { digits: 1 });

/** Parte un texto largo en renglones de a lo sumo `max` caracteres (para el tooltip). */
function wrap(text: string, max = 72): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if (line && line.length + 1 + w.length > max) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

export const overlays: ViewerOverlay[] = [
  {
    id: ESEQ_OVERLAY_ID,
    label: 'Electrosecuencias',
    layer: 'under',
    order: 55,
    subscribe: subscribeSelectedSequence,
    track: {
      title: 'Electrosec.',
      scale: TRACK_SCALE,
      unit: 'gAPI',
      width: 0.6,
      after: 'spectral',
      workspaces: ['geology'],
      resolve({ well }) {
        return well.curves.some((c) => c.role === 'GR') ? { scale: TRACK_SCALE, unit: 'gAPI', title: 'Electrosec.' } : null;
      },
    },
    draw(frame: OverlayFrame) {
      const t = findTrack(frame);
      if (!t) return;
      const { ctx, viewport: vp, theme } = frame;
      const u = frame.uiScale ?? 1;
      const list = sequencesForWell(frame.data.well, frame.data.interpretation);
      ctx.save();
      ctx.beginPath();
      ctx.rect(t.x, 0, t.width, vp.height);
      ctx.clip();
      if (!list) {
        ctx.fillStyle = theme.viewer.axisText;
        ctx.font = `${BASE_TOKENS.weight.regular} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
        ctx.textAlign = 'center';
        ctx.fillText('Sin GR', t.x + t.width / 2, vp.height / 2);
        ctx.restore();
        return;
      }
      const sel = getSelectedSequence();
      const selTop = sel && sel.wellId === frame.data.wellId ? sel.top : null;
      const padX = scalePx(3, u);
      const right = t.x + t.width - padX;
      const xOf = (gr: number) => t.x + (t.xOf(null, gr) ?? 0);
      for (const s of list) {
        if (s.base < vp.top || s.top > vp.base) continue;
        const y0 = vp.yOf(s.top);
        const y1 = vp.yOf(s.base);
        const h = y1 - y0;
        const color = shapeColor(s.shape, theme.name);
        const isSel = selTop !== null && Math.abs(s.top - selTop) < 1e-6;
        ctx.fillStyle = withAlpha(color, isSel ? 0.22 : theme.name === 'dark' ? 0.12 : 0.08);
        ctx.fillRect(t.x, y0, t.width, h);
        if (h >= 5) {
          const padY = Math.min(scalePx(3, u), h * 0.12);
          const outline = segmentOutline(s, { x: t.x + padX, y0: y0 + padY, y1: y1 - padY, right, minWidth: t.width * 0.18 }, xOf);
          drawShapeIcon(ctx, s.shape, s.confidence, outline, theme.name, { selected: isSel });
        }
        // Límite entre tramos.
        ctx.strokeStyle = theme.viewer.gridMajor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const ly = Math.round(y0) + 0.5;
        ctx.moveTo(t.x, ly);
        ctx.lineTo(t.x + t.width, ly);
        ctx.stroke();
        if (isSel) {
          ctx.strokeStyle = theme.color.accent;
          ctx.lineWidth = 2;
          ctx.strokeRect(t.x + 1, y0 + 1, t.width - 2, Math.max(2, h - 2));
        }
      }
      ctx.restore();
    },
    hit(frame: OverlayHitFrame, p): OverlayHit | null {
      if (!p.track || p.track.overlayId !== ESEQ_OVERLAY_ID) return null;
      const list = sequencesForWell(frame.data.well, frame.data.interpretation);
      if (!list) return null;
      const s = sequenceAt(list, p.depth);
      if (!s) return { label: `Sin tramo a ${fmtM(p.depth)} m (sin dato de GR)`, cursor: 'default' };
      const wellId = frame.data.wellId;
      const lines = [
        `${s.shapeLabel}${s.serrated && s.shape !== 'serrated' ? ' serrado' : ''} · confianza ${CONFIDENCE_LABEL[s.confidence].toLowerCase()}`,
        `${fmtM(s.top)}–${fmtM(s.base)} m (${fmtM(s.thickness)} m)`,
        ...wrap(s.description),
        ...wrap(s.interpretation),
      ];
      return {
        label: lines.join('\n'),
        cursor: 'pointer',
        key: `eseq:${s.top}`,
        activate: () => {
          const cur = getSelectedSequence();
          selectSequence(wellId, cur && cur.wellId === wellId && cur.top === s.top ? null : s.top);
        },
        range: { top: s.top, base: s.base },
        doubleClick: () => selectSequence(wellId, s.top),
      };
    },
  },
];

