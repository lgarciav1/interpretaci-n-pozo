/**
 * Herramienta «Medir un intervalo» (menú contextual del perfil, docs/decisiones/0067, D12; G01 regla viva de Pay):
 * con la herramienta armada, arrastrar en cualquier punto marca un tramo y muestra su tope, base, espesor (y el
 * vertical si hay TVDSS) junto con una tarjeta compacta de métricas petrofísicas calculadas en vivo sobre las curvas
 * activas vigentes. La medida queda a la vista hasta Escape o hasta medir otra. Usa el contrato de superposiciones
 * (`../overlay.ts`) como cualquier módulo; el visor la agrega a las suyas. Sin React.
 */
import { sampleThickness } from '../../core/well';
import { summarizeDepthInterval, type DepthIntervalInput, type DepthIntervalSummary } from '../../petro/summary';
import { withAlpha } from '../../ui/color';
import { BASE_TOKENS, scalePx } from '../../ui/tokens';
import { measureCardItems, measureInterval, measureLabel, type Measurement } from '../contextMenu';
import type { OverlayFrame, OverlayHitFrame, ViewerData, ViewerOverlay } from '../overlay';

export const MEASURE_OVERLAY_ID = 'viewer-measure';

export interface MeasureTool {
  overlay: ViewerOverlay;
  /** Arma la herramienta: el próximo arrastre mide. */
  arm(): void;
  /** Desarma y borra la medida. true si había algo que borrar (para que Escape no haga otra cosa). */
  clear(): boolean;
  readonly armed: boolean;
  readonly measurement: Measurement | null;
  /** Resumen petrofísico vigente del intervalo medido (calculado sobre las curvas activas), o null si no hay medida. */
  readonly summary: DepthIntervalSummary | null;
}

export interface MeasureOptions {
  /** TVDSS del pozo a la vista (para el espesor vertical), si hay. */
  tvdss(): ArrayLike<number> | null;
  /** Curvas activas del pozo para la regla viva de Pay (si devuelve undefined, se toman de `frame.data.computed`). */
  intervalInput?(): DepthIntervalInput | null | undefined;
  /** Se terminó una medida (texto para anunciar). */
  measured?(text: string): void;
  /** Cambió el estado (armada o no): el visor actualiza el aviso y el cursor. */
  changed?(armed: boolean): void;
}

const fallbackThicknessCache = new WeakMap<ArrayLike<number>, Float64Array>();
const fallbackInputCache = new WeakMap<ViewerData, DepthIntervalInput>();

/** Respaldo cuando el visor no pasó `intervalInput` (tests aislados): usa las curvas calculadas activas de `data`. */
function fallbackIntervalInput(data: ViewerData): DepthIntervalInput {
  let cached = fallbackInputCache.get(data);
  if (cached) return cached;
  const depth = data.depth;
  let thickness = fallbackThicknessCache.get(depth);
  if (!thickness) fallbackThicknessCache.set(depth, (thickness = sampleThickness(depth)));
  const active = (port: string) => {
    const c = data.computed.find((x) => x.active && x.port === port);
    return c && c.data.length === depth.length ? c.data : null;
  };
  cached = {
    depth,
    thickness,
    netRes: active('NET_RES'),
    netPay: active('NET_PAY'),
    netSand: active('NET_SAND'),
    phi: active('PHIE'),
    sw: active('SW'),
    vsh: active('VSH'),
    perm: active('PERM'),
  };
  fallbackInputCache.set(data, cached);
  return cached;
}

export function createMeasureTool(opts: MeasureOptions): MeasureTool {
  let armed = false;
  let current: Measurement | null = null;
  let frameRef: OverlayHitFrame | null = null;
  let summaryCache: { m: Measurement; input: DepthIntervalInput; value: DepthIntervalSummary } | null = null;

  const setArmed = (v: boolean) => {
    if (armed === v) return;
    armed = v;
    opts.changed?.(v);
  };

  const resolveInput = (frame?: OverlayHitFrame | null): DepthIntervalInput | null => {
    if (opts.intervalInput) {
      const provided = opts.intervalInput();
      if (provided !== undefined) return provided;
    }
    return frame ? fallbackIntervalInput(frame.data) : null;
  };

  const computeSummary = (frame?: OverlayHitFrame | null): DepthIntervalSummary | null => {
    if (!current) return null;
    const input = resolveInput(frame ?? frameRef);
    if (!input) return null;
    if (summaryCache && summaryCache.m === current && summaryCache.input === input) return summaryCache.value;
    const value = summarizeDepthInterval(input, current.top, current.base);
    summaryCache = { m: current, input, value };
    return value;
  };

  const overlay: ViewerOverlay = {
    id: MEASURE_OVERLAY_ID,
    label: 'Medir un intervalo',
    layer: 'over',
    // Por encima de tendencias (20) y notas de profundidad (100): armada, el arrastre mide incluso sobre una nota
    // existente (sin moverla) y la tarjeta viva no queda tapada al crear una nota en el intervalo.
    order: 110,
    draw(frame: OverlayFrame) {
      frameRef = frame;
      if (!current) return;
      const { ctx, viewport: vp, theme, tracks } = frame;
      const y0 = vp.yOf(current.top);
      const y1 = vp.yOf(current.base);
      if (y1 < -2 || y0 > vp.height + 2) return;
      const width = tracks.reduce((mx, t) => Math.max(mx, t.x + t.width), 0);
      const accent = theme.color.accent;

      ctx.save();
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
      // Regla vertical con remates en la primera pista de curvas después de Prof. (así la tarjeta nunca cruza la
      // columna de profundidad ni la franja de zonas), o la primera pista disponible si Prof. quedó al final.
      const depthIdx = tracks.findIndex((t) => t.kind === 'depth');
      const first =
        tracks.find((t, i) => i > depthIdx && t.kind !== 'depth' && t.kind !== 'overlay') ??
        tracks.find((t) => t.kind !== 'depth' && t.kind !== 'overlay') ??
        tracks[0];
      if (!first) {
        ctx.restore();
        return;
      }
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
      const headText = measureLabel(current);
      const headFont = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
      const summary = computeSummary(frame);
      const card = measureCardItems(summary);

      const visTop = Math.max(0, y0);
      const visBot = Math.min(vp.height, y1);
      const mid = (visTop + visBot) / 2;

      if (card.items.length === 0) {
        // Sin curvas petrofísicas disponibles: solo la píldora compacta `tope–base · Δh` sin inventar ceros.
        ctx.font = headFont;
        const pad = scalePx(7, u);
        const w = ctx.measureText(headText).width + 2 * pad;
        const h = scalePx(20, u);
        const pillMid = Math.min(vp.height - h / 2 - 2, Math.max(h / 2 + 2, mid));
        const bx = Math.max(4, Math.min(x + 8, width - w - 4));
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.roundRect(bx, pillMid - h / 2, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = theme.color.textOnAccent;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(headText, bx + pad, pillMid + 0.5);
        ctx.restore();
        return;
      }

      // Tarjeta compacta de métricas petrofísicas junto al corchete.
      const labelFont = `${BASE_TOKENS.weight.medium} ${scalePx(10, u)}px ${BASE_TOKENS.font.sans}`;
      const valueFont = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
      const noteFont = `${BASE_TOKENS.weight.regular} ${scalePx(10, u)}px ${BASE_TOKENS.font.sans}`;

      const padX = scalePx(10, u);
      const padY = scalePx(6, u);
      const colGap = scalePx(14, u);
      const kvGap = scalePx(8, u);
      const headH = scalePx(22, u);
      const rowH = scalePx(18, u);
      const noteH = card.note ? scalePx(15, u) : 0;
      const radius = BASE_TOKENS.radius.md;

      ctx.font = headFont;
      const headTextW = ctx.measureText(headText).width;
      let noteTextW = 0;
      if (card.note) {
        ctx.font = noteFont;
        noteTextW = ctx.measureText(card.note).width;
      }

      const measureGrid = (cols: 1 | 2) => {
        const colWidths = Array<number>(cols).fill(0);
        for (let i = 0; i < card.items.length; i++) {
          const item = card.items[i]!;
          const c = i % cols;
          ctx.font = labelFont;
          const lw = ctx.measureText(item.label).width;
          ctx.font = valueFont;
          const vw = ctx.measureText(item.value).width;
          colWidths[c] = Math.max(colWidths[c]!, lw + kvGap + vw);
        }
        const gridW = colWidths.reduce((s, w) => s + w, 0) + (cols - 1) * colGap;
        const totalW = Math.ceil(Math.max(headTextW, noteTextW, gridW) + 2 * padX);
        return { cols, colWidths, totalW };
      };

      let grid = measureGrid(card.items.length >= 2 ? 2 : 1);
      if (grid.cols === 2 && width > 16 && grid.totalW > width - 8) {
        grid = measureGrid(1);
      }

      const rows = Math.ceil(card.items.length / grid.cols);
      const cardW = grid.totalW;
      const cardH = Math.ceil(headH + padY * 2 + rows * rowH + noteH);
      const bx = Math.max(4, Math.min(Math.round(x + scalePx(8, u)), Math.round(width - cardW - 4)));
      const by = Math.max(4, Math.min(Math.round(vp.height - cardH - 4), Math.round(mid - cardH / 2)));

      // Conector breve desde la regla vertical al borde izquierdo de la tarjeta.
      if (bx > x + 1) {
        const cy = Math.round(Math.min(by + cardH - radius, Math.max(by + radius, mid))) + 0.5;
        ctx.strokeStyle = withAlpha(accent, 0.7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.lineTo(bx, cy);
        ctx.stroke();
      }

      // Fondo elevado con sombra sutil.
      ctx.save();
      ctx.shadowColor = withAlpha('#000000', theme.name === 'dark' ? 0.45 : 0.16);
      ctx.shadowBlur = scalePx(10, u);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = scalePx(3, u);
      ctx.fillStyle = withAlpha(theme.color.surfaceRaised, 0.97);
      ctx.beginPath();
      ctx.roundRect(bx, by, cardW, cardH, radius);
      ctx.fill();
      ctx.restore();

      // Contenido recortado al radio de la tarjeta.
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(bx, by, cardW, cardH, radius);
      ctx.clip();

      // Franja de encabezado con tope–base y espesor.
      ctx.fillStyle = accent;
      ctx.fillRect(bx, by, cardW, headH);
      ctx.font = headFont;
      ctx.fillStyle = theme.color.textOnAccent;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(headText, bx + padX, by + headH / 2 + 0.5);

      // Distribuir ancho sobrante del encabezado equitativamente entre las columnas.
      const innerW = cardW - 2 * padX - (grid.cols - 1) * colGap;
      const sumCols = grid.colWidths.reduce((s, w) => s + w, 0);
      const extraPerCol = grid.cols > 0 && innerW > sumCols ? (innerW - sumCols) / grid.cols : 0;
      const effWidths = grid.colWidths.map((w) => w + extraPerCol);

      const bodyTop = by + headH + padY;
      if (grid.cols === 2 && rows > 0) {
        const sepX = Math.round(bx + padX + effWidths[0]! + colGap / 2) + 0.5;
        ctx.strokeStyle = withAlpha(theme.color.border, 0.65);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sepX, bodyTop + scalePx(2, u));
        ctx.lineTo(sepX, bodyTop + rows * rowH - scalePx(2, u));
        ctx.stroke();
      }

      for (let i = 0; i < card.items.length; i++) {
        const item = card.items[i]!;
        const r = Math.floor(i / grid.cols);
        const c = i % grid.cols;
        const colX = bx + padX + (c === 1 ? effWidths[0]! + colGap : 0);
        const colW = effWidths[c]!;
        const ry = bodyTop + r * rowH + rowH / 2 + 0.5;

        ctx.font = labelFont;
        ctx.fillStyle = theme.color.textMuted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.label, colX, ry);

        ctx.font = valueFont;
        ctx.fillStyle = item.accent ? theme.color.accentText : theme.color.text;
        ctx.textAlign = 'right';
        ctx.fillText(item.value, colX + colW, ry);
      }

      if (card.note) {
        ctx.font = noteFont;
        ctx.fillStyle = theme.color.textMuted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(card.note, bx + padX, bodyTop + rows * rowH + noteH / 2 + 0.5);
      }
      ctx.restore();

      // Borde nítido alrededor de la tarjeta.
      ctx.strokeStyle = withAlpha(accent, theme.name === 'dark' ? 0.55 : 0.42);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx + 0.5, by + 0.5, cardW - 1, cardH - 1, radius);
      ctx.stroke();
      ctx.restore();
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
            if (current) {
              const sum = computeSummary(frame);
              const { items } = measureCardItems(sum);
              const detail = items.length > 0 ? ` · ${items.map((it) => `${it.label} ${it.value}`).join(', ')}` : '';
              opts.measured?.(`Intervalo medido: ${measureLabel(current)}${detail}`);
            }
          },
          cancel() {
            current = null;
            summaryCache = null;
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
      summaryCache = null;
      setArmed(true);
      frameRef?.invalidate();
    },
    clear() {
      const had = armed || current !== null;
      current = null;
      summaryCache = null;
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
    get summary() {
      return computeSummary();
    },
  };
}
