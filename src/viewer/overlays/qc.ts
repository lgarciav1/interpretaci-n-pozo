/**
 * Superposición de calidad del pozo: tramos con derrumbe o caliper inválido (del control de calidad,
 * `QcReport.borehole`) rayados sobre las pistas que tienen curvas afectadas (las de patín: densidad, PE, DRHO) y
 * marcados con una barra en el borde de la pista del caliper. Tooltip con el detalle.
 */
import type { BoreholeInterval } from '../../io/qc';
import { withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import type { OverlayHitFrame, OverlayTrack, ViewerOverlay } from '../overlay';

const HATCH = 7;

function affectedTracks(frame: OverlayHitFrame): { hatch: OverlayTrack[]; caliper: OverlayTrack[] } {
  const b = frame.data.qc?.borehole;
  if (!b) return { hatch: [], caliper: [] };
  const ids = new Set(b.affectedCurveIds);
  const hatch = frame.tracks.filter((t) => t.curves.some((c) => c.curveId && ids.has(c.curveId)));
  const caliper = frame.tracks.filter((t) => t.curves.some((c) => c.curveId === b.caliperId));
  return { hatch, caliper };
}

function intervals(frame: OverlayHitFrame): BoreholeInterval[] {
  const b = frame.data.qc?.borehole;
  return b ? [...b.washouts, ...b.invalidCaliper] : [];
}

function describe(iv: BoreholeInterval, frame: OverlayHitFrame): string {
  const names = frame.data.qc?.borehole?.affectedCurveIds.join(', ');
  const range = `${formatNumber(iv.topM, { digits: 1, grouping: false })}–${formatNumber(iv.baseM, { digits: 1, grouping: false })} m`;
  const what =
    iv.kind === 'washout'
      ? `Derrumbe ${range} (caliper hasta ${formatNumber(iv.extreme, { digits: 2 })} in sobre el trépano)`
      : `Caliper inválido ${range} (mínimo ${formatNumber(iv.extreme, { digits: 2 })} in)`;
  return names ? `${what}: ${names} no confiables` : what;
}

/** Tramos visibles en px, con al menos 2 px de alto (un derrumbe de una muestra se ve a cualquier zoom) y unidos si quedan a menos de 1 px. */
function mergedRects(list: readonly BoreholeInterval[], vp: OverlayHitFrame['viewport']): [number, number][] {
  const out: [number, number][] = [];
  const sorted = [...list].sort((a, b) => a.topM - b.topM);
  for (const iv of sorted) {
    let y0 = vp.yOf(iv.topM);
    let y1 = vp.yOf(iv.baseM);
    if (y1 - y0 < 2) {
      const mid = (y0 + y1) / 2;
      y0 = mid - 1;
      y1 = mid + 1;
    }
    if (y1 < 0 || y0 > vp.height) continue;
    const last = out[out.length - 1];
    if (last && y0 - last[1] < 1) last[1] = Math.max(last[1], y1);
    else out.push([y0, y1]);
  }
  return out;
}

export function createQcOverlay(): ViewerOverlay {
  return {
    id: 'qc-borehole',
    label: 'Calidad del pozo (derrumbes)',
    layer: 'over',
    order: 0,
    draw(frame) {
      const { ctx, viewport: vp, theme } = frame;
      const list = intervals(frame);
      if (!list.length) return;
      const { hatch, caliper } = affectedTracks(frame);
      for (const kind of ['washout', 'invalid-caliper'] as const) {
        const rects = mergedRects(list.filter((iv) => iv.kind === kind), vp);
        if (!rects.length) continue;
        const color = kind === 'washout' ? theme.color.warn : theme.color.error;
        // Un recorte y un rayado por pista (no uno por tramo): cuesta lo mismo con 5 que con 500 tramos.
        for (const t of hatch) {
          const area = new Path2D();
          for (const [y0, y1] of rects) area.rect(t.x, y0, t.width, y1 - y0);
          ctx.save();
          ctx.fillStyle = withAlpha(theme.viewer.nullPattern, 0.18);
          ctx.fill(area);
          ctx.clip(area);
          ctx.strokeStyle = withAlpha(color, 0.45);
          ctx.lineWidth = 1;
          ctx.beginPath();
          // Rayas a 45° sobre la recta x + y = c (c múltiplo de HATCH): continúan entre tramos vecinos.
          for (const [y0, y1] of rects) {
            for (let c = Math.ceil((t.x + y0) / HATCH) * HATCH; c <= t.x + t.width + y1; c += HATCH) {
              ctx.moveTo(c - y1, y1);
              ctx.lineTo(c - y0, y0);
            }
          }
          ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = withAlpha(color, 0.9);
        for (const t of [...new Set([...caliper, ...hatch])]) for (const [y0, y1] of rects) ctx.fillRect(t.x + t.width - 4, y0, 3, y1 - y0);
      }
    },
    hit(frame, p) {
      if (!p.track) return null;
      const { hatch, caliper } = affectedTracks(frame);
      if (!hatch.some((t) => t.id === p.track!.id) && !caliper.some((t) => t.id === p.track!.id)) return null;
      const tol = 2 / frame.viewport.pxPerM;
      const iv = intervals(frame).find((i) => p.depth >= i.topM - tol && p.depth <= i.baseM + tol);
      return iv ? { label: describe(iv, frame), range: { top: iv.topM, base: iv.baseM } } : null;
    },
  };
}
