/**
 * Superposición de zonas: bandas translúcidas sobre las pistas, franja de color con el nombre en la pista de
 * profundidad, líneas de tope y rótulo con el nombre (fijo arriba mientras la zona está a la vista).
 * Clic en la franja, en la pista de profundidad o en un rótulo → `onSelect` (otro clic sobre la seleccionada la
 * deselecciona); doble clic → muestra la zona entera. Usa el contrato de `../overlay.ts` como cualquier módulo.
 */
import { contrastRatio, withAlpha } from '../../ui/color';
import { BASE_TOKENS, THEMES } from '../../ui/tokens';
import type { OverlayFrame, OverlayHitFrame, OverlayPointer, OverlayTrack, ViewerOverlay, ViewerZone } from '../overlay';
import { formatNumber } from '../../ui/format';

const STRIP = 14;
const LABEL_H = 16;

/** Caja del rótulo de una zona (en la primera pista de curvas). Estimación sin medir texto: sirve a draw y a hit. */
function labelBox(z: ViewerZone, frame: OverlayHitFrame, track: OverlayTrack): { x: number; y: number; w: number; h: number } | null {
  const vp = frame.viewport;
  const yTop = vp.yOf(z.top);
  const yBase = vp.yOf(z.base);
  if (yBase < 0 || yTop > vp.height) return null;
  const y = Math.max(yTop + 3, 3);
  if (y + LABEL_H > yBase - 2) return null;
  return { x: track.x + 4, y, w: 12 + z.name.length * 6.6, h: LABEL_H };
}

const firstCurveTrack = (tracks: readonly OverlayTrack[]) => tracks.find((t) => t.kind !== 'depth') ?? null;

/** Tinta legible sobre el color de la zona: el texto del tema oscuro (claro) o el del claro (oscuro), el de más contraste. */
const INK_DARK = THEMES.light.color.text;
const INK_LIGHT = THEMES.dark.color.text;
function readableOn(bg: string): string {
  return contrastRatio(INK_LIGHT, bg) >= contrastRatio(INK_DARK, bg) ? INK_LIGHT : INK_DARK;
}

function zoneRange(z: ViewerZone): string {
  return `${formatNumber(z.top, { digits: 1, grouping: false })}–${formatNumber(z.base, { digits: 1, grouping: false })} m`;
}

export function createZonesOverlay(opts: { onSelect?: (zoneId: string | null) => void } = {}): ViewerOverlay[] {
  const under: ViewerOverlay = {
    id: 'zones-bands',
    label: 'Zonas (bandas)',
    layer: 'under',
    order: -10,
    draw({ ctx, viewport: vp, tracks, data, theme }) {
      const alpha = theme.viewer.zoneAlpha;
      for (const z of data.zones) {
        const y0 = vp.yOf(z.top);
        const y1 = vp.yOf(z.base);
        if (y1 < 0 || y0 > vp.height) continue;
        const selected = z.id === data.selectedZoneId;
        for (const t of tracks) {
          if (t.kind === 'depth') {
            ctx.fillStyle = withAlpha(z.color, selected ? 0.95 : 0.7);
            ctx.fillRect(t.x, y0, STRIP, y1 - y0);
            continue;
          }
          // Sutiles: la zona se lee por la franja y los topes; la banda solo da contexto.
          ctx.fillStyle = withAlpha(z.color, alpha * (selected ? 0.5 : data.selectedZoneId ? 0.25 : 0.5));
          ctx.fillRect(t.x, y0, t.width, y1 - y0);
        }
        // Nombre vertical en la franja, centrado en la parte visible.
        const depthTrack = tracks.find((t) => t.kind === 'depth');
        const vis0 = Math.max(0, y0);
        const vis1 = Math.min(vp.height, y1);
        if (depthTrack && vis1 - vis0 > 18 + z.name.length * 7) {
          ctx.save();
          ctx.translate(depthTrack.x + STRIP / 2, (vis0 + vis1) / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillStyle = readableOn(z.color);
          ctx.font = `${BASE_TOKENS.weight.semibold} 10px ${BASE_TOKENS.font.sans}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(z.name, 0, 0.5);
          ctx.restore();
        }
      }
    },
  };

  const over: ViewerOverlay = {
    id: 'zones-tops',
    label: 'Zonas (topes)',
    layer: 'over',
    order: 10,
    draw(frame: OverlayFrame) {
      const { ctx, viewport: vp, tracks, data, theme } = frame;
      const first = firstCurveTrack(tracks);
      const width = tracks.reduce((m, t) => Math.max(m, t.x + t.width), 0);
      const sorted = [...data.zones].sort((a, b) => a.top - b.top);
      sorted.forEach((z, k) => {
        const selected = z.id === data.selectedZoneId;
        const y0 = vp.yOf(z.top);
        const y1 = vp.yOf(z.base);
        if (y1 < -2 || y0 > vp.height + 2) return;
        ctx.strokeStyle = withAlpha(z.color, selected ? 1 : 0.85);
        ctx.lineWidth = selected ? 2 : 1;
        ctx.beginPath();
        const ty = Math.round(y0) + (selected ? 0 : 0.5);
        ctx.moveTo(0, ty);
        ctx.lineTo(width, ty);
        // Base solo si no la marca el tope de la zona siguiente (zonas contiguas).
        const next = sorted[k + 1];
        if (!next || next.top - z.base > 0.5) {
          const by = Math.round(y1) + (selected ? 0 : 0.5);
          ctx.moveTo(0, by);
          ctx.lineTo(width, by);
        }
        ctx.stroke();
        if (!first) return;
        const box = labelBox(z, frame, first);
        if (!box) return;
        ctx.fillStyle = z.color;
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, 4);
        ctx.fill();
        if (selected) {
          ctx.strokeStyle = theme.viewer.depthText;
          ctx.lineWidth = 1.25;
          ctx.stroke();
        }
        ctx.fillStyle = readableOn(z.color);
        ctx.font = `${BASE_TOKENS.weight.semibold} ${BASE_TOKENS.text.xs}px ${BASE_TOKENS.font.sans}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(z.name, box.x + box.w / 2, box.y + box.h / 2 + 0.5);
      });
    },
    hit(frame, p: OverlayPointer) {
      const z = frame.data.zones.find((zz) => p.depth >= zz.top && p.depth <= zz.base);
      if (!z) return null;
      const first = firstCurveTrack(frame.tracks);
      const box = first ? labelBox(z, frame, first) : null;
      const onLabel = !!box && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
      const onDepth = p.track?.kind === 'depth';
      if (!onLabel && !onDepth) return null;
      const selected = z.id === frame.data.selectedZoneId;
      return {
        label: `Zona ${z.name} · ${zoneRange(z)}${opts.onSelect ? (selected ? ' · clic para volver a los parámetros globales' : ' · clic para editar sus parámetros') : ''}`,
        cursor: 'pointer',
        ...(opts.onSelect ? { activate: () => opts.onSelect!(selected ? null : z.id), doubleClick: () => opts.onSelect!(z.id) } : {}),
        range: { top: z.top, base: z.base },
      };
    },
  };
  return [under, over];
}
