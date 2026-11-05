/**
 * Herramienta «Medir un intervalo» (menú contextual del perfil, docs/decisiones/0067, D12): con la herramienta armada,
 * arrastrar en cualquier punto marca un tramo y muestra su tope, base y espesor (y el vertical si hay TVDSS). La medida
 * queda a la vista hasta Escape o hasta medir otra. Usa el contrato de superposiciones (`../overlay.ts`) como cualquier
 * módulo; el visor la agrega a las suyas. Sin React.
 */
import { withAlpha } from '../../ui/color';
import { BASE_TOKENS, scalePx } from '../../ui/tokens';
import { measureInterval, measureLabel, type Measurement } from '../contextMenu';
import type { OverlayFrame, OverlayHitFrame, ViewerOverlay } from '../overlay';

export const MEASURE_OVERLAY_ID = 'viewer-measure';

export interface MeasureTool {
  overlay: ViewerOverlay;
  /** Arma la herramienta: el próximo arrastre mide. */
  arm(): void;
  /** Desarma y borra la medida. true si había algo que borrar (para que Escape no haga otra cosa). */
  clear(): boolean;
  readonly armed: boolean;
  readonly measurement: Measurement | null;
}

export interface MeasureOptions {
  /** TVDSS del pozo a la vista (para el espesor vertical), si hay. */
  tvdss(): ArrayLike<number> | null;
  /** Se terminó una medida (texto para anunciar). */
  measured?(text: string): void;
  /** Cambió el estado (armada o no): el visor actualiza el aviso y el cursor. */
  changed?(armed: boolean): void;
}

export function createMeasureTool(opts: MeasureOptions): MeasureTool {
  let armed = false;
  let current: Measurement | null = null;
  let frameRef: OverlayHitFrame | null = null;
  const setArmed = (v: boolean) => {
    if (armed === v) return;
    armed = v;
    opts.changed?.(v);
  };

  const overlay: ViewerOverlay = {
    id: MEASURE_OVERLAY_ID,
    label: 'Medir un intervalo',
    layer: 'over',
    // Por encima de la herramienta de tendencias (20): armada, el arrastre es suyo.
    order: 30,
    draw(frame: OverlayFrame) {
      frameRef = frame;
      if (!current) return;
      const { ctx, viewport: vp, theme, tracks } = frame;
      const y0 = vp.yOf(current.top);
      const y1 = vp.yOf(current.base);
      if (y1 < -2 || y0 > vp.height + 2) return;
      const width = tracks.reduce((mx, t) => Math.max(mx, t.x + t.width), 0);
      const accent = theme.color.accent;
      ctx.fillStyle = withAlpha(accent, 0.07);
      ctx.fillRect(0, y0, width, y1 - y0);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      for (const y of [y0, y1]) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(width, Math.round(y) + 0.5);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Regla vertical con remates en la primera pista de curvas, y el rótulo al lado.
      const first = tracks.find((t) => t.kind !== 'depth' && t.kind !== 'overlay') ?? tracks[0];
      if (!first) return;
      const x = Math.round(first.x + 10) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.moveTo(x - 4, Math.round(y0) + 0.5);
      ctx.lineTo(x + 4, Math.round(y0) + 0.5);
      ctx.moveTo(x - 4, Math.round(y1) + 0.5);
      ctx.lineTo(x + 4, Math.round(y1) + 0.5);
      ctx.stroke();
      const u = frame.uiScale ?? 1;
      const text = measureLabel(current);
      ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
      const pad = scalePx(7, u);
      const w = ctx.measureText(text).width + 2 * pad;
      const h = scalePx(20, u);
      const mid = Math.min(vp.height - h / 2 - 2, Math.max(h / 2 + 2, (Math.max(0, y0) + Math.min(vp.height, y1)) / 2));
      const bx = Math.min(x + 8, width - w - 4);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(bx, mid - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.fillStyle = theme.color.textOnAccent;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + pad, mid + 0.5);
    },
    hit(frame) {
      frameRef = frame;
      if (!armed) return null;
      return {
        label: 'Arrastrá para medir un intervalo · Esc para salir',
        cursor: 'crosshair',
        drag: {
          cursor: 'crosshair',
          move(p, start) {
            if (!Number.isFinite(p.depth) || !Number.isFinite(start.depth)) return;
            current = measureInterval(start.depth, p.depth, frame.data.depth, opts.tvdss());
            frameRef?.invalidate();
          },
          end(p, start) {
            if (Number.isFinite(p.depth) && Number.isFinite(start.depth)) current = measureInterval(start.depth, p.depth, frame.data.depth, opts.tvdss());
            setArmed(false);
            frameRef?.invalidate();
            if (current) opts.measured?.(`Intervalo medido: ${measureLabel(current)}`);
          },
          cancel() {
            current = null;
            setArmed(false);
            frameRef?.invalidate();
          },
        },
      };
    },
  };

  return {
    overlay,
    arm() {
      current = null;
      setArmed(true);
      frameRef?.invalidate();
    },
    clear() {
      const had = armed || current !== null;
      current = null;
      setArmed(false);
      if (had) frameRef?.invalidate();
      return had;
    },
    get armed() {
      return armed;
    },
    get measurement() {
      return current;
    },
  };
}
