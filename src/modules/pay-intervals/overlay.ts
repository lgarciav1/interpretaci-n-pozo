/**
 * Superposición «Punzados sugeridos» (F04): los tramos de pay elegidos en el panel de capas de pay, marcados en la
 * pista de profundidad con la convención de los perfiles de terminación: una línea vertical con corchetes en el tope y
 * la base y triangulitos de disparo apuntando hacia la formación, más un rótulo con el orden del tramo (por k·h).
 * Va en una columna angosta a la derecha de la franja de zonas, a la izquierda de los números de profundidad: no tapa
 * ninguna curva. Tooltip con tope–base, espesor y k·h; doble clic = ver el tramo.
 *
 * Lee la tabla PAY_INTERVALS de la misma corrida (`frame.data.tables`) y la selección guardada en
 * `interpretation.moduleState['pay-intervals']`: se redibuja sola cuando cambia la interpretación. Igual en pantalla y
 * en las figuras exportadas (sin el resaltado del elemento activo).
 */
import { ensureContrast, withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { BASE_TOKENS, scalePx } from '../../ui/tokens';
import type { ReadonlyTableValue } from '../../core/module';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayTarget, OverlayTrack, ViewerOverlay } from '../../viewer/overlay';
import { MODULE_ID, TABLE_PORT, payRowsFrom, readPicks, resolvePicks, viewRangeFor, type PayRow } from './model';

export const PAY_OVERLAY_ID = 'pay-intervals-perforations';

/** Franja de zonas en la pista de profundidad (px a escala 1; ver src/viewer/overlays/zones.ts). */
const ZONE_STRIP = { modern: 14, classic: 6 } as const;
/** Columna de los punzados (px a escala 1): separación de la franja y ancho del símbolo. */
const GAP = 3;
const COL = 9;

const rowsCache = new WeakMap<ReadonlyTableValue, PayRow[]>();
function tableRows(frame: OverlayHitFrame): PayRow[] {
  const table = frame.data.tables?.find((t) => t.moduleId === MODULE_ID && t.port === TABLE_PORT && t.active)?.value;
  if (!table) return [];
  let rows = rowsCache.get(table);
  if (!rows) {
    rows = payRowsFrom(table.rows);
    rowsCache.set(table, rows);
  }
  return rows;
}

/** Tramos elegidos que existen en la corrida actual. */
const pickedOf = (frame: OverlayHitFrame): PayRow[] => {
  const picks = readPicks(frame.data.interpretation);
  return picks.length ? resolvePicks(tableRows(frame), picks).picked : [];
};

const depthTrackOf = (frame: OverlayHitFrame): OverlayTrack | undefined => frame.tracks.find((t) => t.kind === 'depth');

/** Caja de la columna de punzados en px CSS. */
function column(frame: OverlayHitFrame, dt: OverlayTrack): { x: number; w: number } {
  const u = frame.uiScale ?? 1;
  const strip = frame.data.zones.length ? ZONE_STRIP[frame.look === 'classic' ? 'classic' : 'modern'] : 0;
  return { x: dt.x + scalePx(strip + GAP, u), w: scalePx(COL, u) };
}

const fmt = (v: number, digits: number) => formatNumber(Number.isFinite(v) ? v : null, { digits });
const depthText = (v: number) => formatNumber(v, { digits: 2, grouping: false });

function labelOf(r: PayRow): string {
  const lines = [
    `Punzado sugerido · tramo ${r.rank}${r.zone ? ` · ${r.zone}` : ''}`,
    `${depthText(r.top)}–${depthText(r.base)} m`,
    `Pay neto ${fmt(r.net, 2)} m${r.gaps > 0 ? ` (bruto ${fmt(r.gross, 2)} m)` : ''} · φ ${fmt(r.phi, 3)} · Sw ${fmt(r.sw, 2)}`,
  ];
  if (Number.isFinite(r.kh)) lines.push(`k·h ${fmt(r.kh, r.kh >= 100 ? 0 : 1)} mD·m${Number.isFinite(r.khPct) ? ` (${fmt(r.khPct, 0)} % del total)` : ''}`);
  return lines.join('\n');
}

function hitOf(r: PayRow): OverlayHit & { key: string } {
  return { key: r.key, label: labelOf(r), cursor: 'pointer', range: viewRangeFor(r.top, r.base) };
}

export const overlays: ViewerOverlay[] = [
  {
    id: PAY_OVERLAY_ID,
    label: 'Punzados sugeridos',
    layer: 'over',
    order: 25,
    draw(frame: OverlayFrame) {
      const picked = pickedOf(frame);
      if (!picked.length) return;
      const dt = depthTrackOf(frame);
      if (!dt) return;
      const { ctx, theme, viewport: vp } = frame;
      const u = frame.uiScale ?? 1;
      const { x, w } = column(frame, dt);
      const bg = theme.viewer.trackBgAlt;
      const ink = ensureContrast(theme.color.error, bg, 3);
      const active = frame.purpose !== 'export' && frame.active?.overlayId === PAY_OVERLAY_ID ? frame.active.key : null;
      const tri = scalePx(3.5, u); // medio alto del triangulito
      const pitch = scalePx(8, u); // separación entre disparos
      const bracket = scalePx(4, u);

      ctx.save();
      ctx.font = `${BASE_TOKENS.weight.bold} ${scalePx(10, u)}px ${BASE_TOKENS.font.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const r of [...picked].sort((a, b) => (a.key === active ? 1 : b.key === active ? -1 : 0))) {
        const y0 = vp.yOf(r.top);
        const y1 = vp.yOf(r.base);
        if (y1 < -20 || y0 > vp.height + 20) continue;
        const isActive = r.key === active;
        const h = Math.max(1, y1 - y0);
        const xl = Math.round(x) + 0.5;

        // Fondo tenue del tramo en la columna (se lee como intervalo aunque esté muy alejado).
        ctx.fillStyle = withAlpha(ink, isActive ? 0.24 : 0.13);
        ctx.fillRect(xl, y0, w, h);

        // Triangulitos de disparo hacia la formación (derecha), centrados en el tramo.
        const shots = Math.max(1, Math.floor(h / pitch));
        const start = y0 + (h - (shots - 1) * pitch) / 2;
        const half = Math.min(tri, Math.max(1.5, h / 2));
        ctx.fillStyle = ink;
        ctx.beginPath();
        // Solo los disparos visibles: con mucho zoom un tramo largo mide decenas de miles de px.
        const kFrom = Math.max(0, Math.floor((-tri - start) / pitch));
        const kTo = Math.min(shots - 1, Math.ceil((vp.height + tri - start) / pitch));
        for (let k = kFrom; k <= kTo; k++) {
          const yc = start + k * pitch;
          ctx.moveTo(xl + 1, yc - half);
          ctx.lineTo(xl + w, yc);
          ctx.lineTo(xl + 1, yc + half);
          ctx.closePath();
        }
        ctx.fill();

        // Línea del intervalo con corchetes en el tope y la base.
        ctx.strokeStyle = ink;
        ctx.lineWidth = isActive ? 2.25 : 1.5;
        ctx.beginPath();
        ctx.moveTo(xl + bracket, Math.round(y0) + 0.5);
        ctx.lineTo(xl, Math.round(y0) + 0.5);
        ctx.lineTo(xl, Math.round(y1) - 0.5);
        ctx.lineTo(xl + bracket, Math.round(y1) - 0.5);
        ctx.stroke();

        // Rótulo con el orden, junto al tope (dentro de la vista), sobre el fondo de la pista.
        const text = String(r.rank);
        const ph = scalePx(14, u);
        const pw = Math.max(ph, ctx.measureText(text).width + scalePx(8, u));
        const bx = xl + w + scalePx(2, u);
        const by = Math.max(ph / 2 + 1, Math.min(vp.height - ph / 2 - 1, Math.max(y0, 0) + ph / 2));
        if (y1 < 0 || y0 > vp.height) continue; // el tramo quedó fuera de la vista: sin rótulo
        ctx.beginPath();
        ctx.roundRect(bx, by - ph / 2, pw, ph, ph / 2);
        ctx.fillStyle = isActive ? ink : withAlpha(theme.color.surface, 0.94);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = ink;
        ctx.stroke();
        ctx.fillStyle = isActive ? theme.color.textInverse : ink;
        ctx.fillText(text, bx + pw / 2, by + 0.5);
      }
      ctx.restore();
    },
    hit(frame: OverlayHitFrame, p): OverlayHit | null {
      if (!p.track || p.track.kind !== 'depth') return null;
      const picked = pickedOf(frame);
      if (!picked.length) return null;
      const u = frame.uiScale ?? 1;
      const { x, w } = column(frame, p.track);
      // La columna, el rótulo y un margen para el puntero.
      if (p.x < x - scalePx(3, u) || p.x > x + w + scalePx(24, u)) return null;
      const tol = scalePx(3, u);
      const vp = frame.viewport;
      const r = picked.find((t) => p.y >= vp.yOf(t.top) - tol && p.y <= vp.yOf(t.base) + tol);
      return r ? hitOf(r) : null;
    },
    targets(frame: OverlayHitFrame): OverlayTarget[] {
      return pickedOf(frame).map((r) => ({ depth: r.top, hit: hitOf(r) }));
    },
  },
];
