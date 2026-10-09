/**
 * Dibujo del visor en canvas 2D (sin React). docs/decisiones/0005-visor-multipista.md, D1–D2 y D6.
 *
 * Canvas base, en este orden: fondo de pistas → grilla → superposiciones 'under' → rellenos → curvas (recortadas a su
 * pista, con curva de respaldo si corresponde) → superposiciones 'over' → bordes y profundidad.
 * Canvas de cursor: línea, puntos sobre las curvas y rótulo de profundidad (mover el mouse no redibuja curvas).
 *
 * Cada cuadro: búsqueda binaria del tramo visible, reducción M4 por fila de píxel si hay más de 1,5 muestras por
 * fila (sobre fracciones precalculadas en caché) y buffers reusados: no se asigna memoria por curva y por cuadro
 * salvo los Path2D de los rellenos.
 */
import { mix, withAlpha } from '../ui/color';
import { FILL_PALETTE, fillColor, type FillId } from '../ui/curves';
import { formatNumber } from '../ui/format';
import { BASE_TOKENS, type ThemeTokens } from '../ui/tokens';
import { blockSummary, decimateWithBounds, DECIMATE_THRESHOLD, ensureRowBuffers, ROW_DATA, ROW_GAP, rowBounds, visibleRange, type RowBuffers } from './decimate';
import { fillBetween } from './fills';
import type { TrackBox } from './layout';
import { guard, type OverlayFrame, type OverlayTrack, type OverlayViewport, type ViewerData, type ViewerOverlay } from './overlay';
import { formatDepth, nearestIndex } from './readout';
import { findCurve, type ResolvedCurve, type ResolvedTrack } from './resolve';
import { stackHint } from './stack';
import { fractionArray, fractionToValue, scaleKey, valueToFraction, wrapFractionArray, type AxisScale } from './scale';
import { depthTicks, linearGrid, logGrid } from './ticks';
import { baseOf, depthOf, yOf, type Viewport } from './viewport';

export interface FrameInput {
  tracks: readonly ResolvedTrack[];
  boxes: readonly TrackBox[];
  viewport: Viewport;
  theme: ThemeTokens;
  depth: Float64Array;
  /** Ancho total del canvas (px CSS). */
  width: number;
  overlays: readonly ViewerOverlay[];
  data: ViewerData;
  /** Pide otro cuadro (lo usan las superposiciones durante una vista previa). */
  invalidate?: () => void;
  /**
   * Animación de carga: fracción del alto ya "registrada" (0–1). Las pistas se recortan a ese alto y se dibuja el
   * frente. Ausente = cuadro normal (sin costo extra).
   */
  reveal?: number;
  /** Elemento de superposición activo (teclado o último clic), para que su dueño lo resalte. */
  active?: { overlayId: string; key: string } | null;
  /** Textos de ayuda por rol para el estado vacío de las pilas («VSH (paso Arcilla)»). */
  stackHints?: Readonly<Record<string, string>>;
}

const FONT = BASE_TOKENS.font.sans;
const TEXT_XS = BASE_TOKENS.text.xs;
const FLAG_COLUMN = 18;

const crisp = (v: number) => Math.round(v) + 0.5;
/** Clave de buffers: la misma curva puede estar en dos pistas con escalas distintas. */
const curveKey = (c: ResolvedCurve) => `${c.key}|${scaleKey(c.axis)}`;

/** Color opaco de una capa de pila (el de la paleta mezclado con el fondo de pista a su opacidad). */
export function stackFillColor(fill: string, theme: ThemeTokens): string {
  // Un relleno desconocido (proyecto de otra versión) cae en el neutro en vez de romper el dibujo.
  const c = fillColor((fill in FILL_PALETTE ? fill : 'undivided') as FillId, theme.name);
  return mix(theme.viewer.trackBg, c.color, Math.min(1, c.alpha + 0.15));
}

export function overlayViewport(vp: Viewport): OverlayViewport {
  return { top: vp.top, base: baseOf(vp), pxPerM: vp.pxPerM, height: vp.height, yOf: (d) => yOf(vp, d), depthOf: (y) => depthOf(vp, y) };
}

/** Pistas tal como las ven las superposiciones. */
export function overlayTracks(tracks: readonly ResolvedTrack[], boxes: readonly TrackBox[]): OverlayTrack[] {
  return tracks.map((t, i) => {
    const box = boxes[i]!;
    const axisOf = (k: string | null): AxisScale | null => (k === null ? t.grid : (findCurve(t.curves, k)?.axis ?? null));
    return {
      id: t.id,
      kind: t.kind,
      title: t.title,
      ...(t.overlayId ? { overlayId: t.overlayId } : {}),
      x: box.x,
      width: box.width,
      curves: t.curves,
      scale: t.grid,
      hasRole: (role) => t.curves.some((c) => c.role === role),
      xOf: (k, v) => {
        const axis = axisOf(k);
        if (!axis) return null;
        const f = valueToFraction(v, axis);
        return Number.isFinite(f) ? f * box.width : null;
      },
      valueOf: (k, x) => {
        const axis = axisOf(k);
        if (!axis || !(box.width > 0)) return null;
        const v = fractionToValue(x / box.width, axis);
        return Number.isFinite(v) ? v : null;
      },
    };
  });
}

/** Modo de dibujo del cuadro: muestras directas o filas reducidas. */
interface Sampling {
  i0: number;
  i1: number;
  rows: number;
  decimated: boolean;
  /** y de cada punto del perfil (muestras: n = i1 − i0; filas: n = rows). */
  y: Float32Array;
  n: number;
  /** Límites de fila por índice (solo si decimated). */
  bounds: Int32Array | null;
}

export class ViewerRenderer {
  private rowBufs = new Map<string, RowBuffers>();
  /** Cuadro en que se calculó cada buffer: una curva con relleno y línea se reduce una sola vez por cuadro. */
  private rowStamp = new Map<string, number>();
  private frameId = 0;
  private yBuf = new Float32Array(1024);
  private boundsBuf: Int32Array = new Int32Array(1025);
  private xa = new Float32Array(1024);
  private xb = new Float32Array(1024);
  private va = new Float32Array(1024);
  private vb = new Float32Array(1024);

  /** Olvida los buffers (al cambiar de pozo). */
  reset(): void {
    this.rowBufs.clear();
    this.rowStamp.clear();
  }

  private ensure(n: number) {
    if (this.yBuf.length < n) {
      const size = Math.max(n, this.yBuf.length * 2);
      this.yBuf = new Float32Array(size);
      this.xa = new Float32Array(size);
      this.xb = new Float32Array(size);
      this.va = new Float32Array(size);
      this.vb = new Float32Array(size);
    }
  }

  private computeSampling(f: FrameInput): Sampling {
    const { depth, viewport: vp } = f;
    const [i0, i1] = visibleRange(depth, vp.top, baseOf(vp));
    const rows = Math.max(1, Math.ceil(vp.height));
    const decimated = i1 - i0 > rows * DECIMATE_THRESHOLD;
    const n = decimated ? rows : i1 - i0;
    this.ensure(n);
    const y = this.yBuf;
    let bounds: Int32Array | null = null;
    if (decimated) {
      for (let r = 0; r < rows; r++) y[r] = r + 0.5;
      bounds = this.boundsBuf = rowBounds(depth, i0, i1, vp.top, vp.pxPerM, rows, this.boundsBuf);
    } else for (let k = 0; k < n; k++) y[k] = (depth[i0 + k]! - vp.top) * vp.pxPerM;
    return { i0, i1, rows, decimated, y, n, bounds };
  }

  private rows(key: string, values: Float32Array | Float64Array, s: Sampling): RowBuffers {
    const cached = this.rowBufs.get(key);
    if (cached && this.rowStamp.get(key) === this.frameId) return cached;
    this.rowStamp.set(key, this.frameId);
    const b = decimateWithBounds(values, s.bounds!, s.rows, ensureRowBuffers(this.rowBufs.get(key), s.rows), blockSummary(values));
    this.rowBufs.set(key, b);
    return b;
  }

  /** Valores de la curva (unidad de la curva) en los puntos del perfil, en `out`. */
  private values(c: ResolvedCurve, s: Sampling, out: Float32Array): void {
    if (s.decimated) {
      const b = this.rows(`${c.key}:value`, c.data, s);
      for (let r = 0; r < s.rows; r++) out[r] = b.state[r] === ROW_DATA ? b.mean[r]! : NaN;
    } else for (let k = 0; k < s.n; k++) out[k] = c.data[s.i0 + k]!;
  }

  /** Perfil x (px, acotado a la pista) para rellenos, en `out`. */
  private profile(c: ResolvedCurve, box: TrackBox, s: Sampling, out: Float32Array): void {
    this.fracProfile(curveKey(c), fractionArray(c.data, c.axis), box, s, out);
  }

  /** Perfil x (px, acotado a la pista) de un array de fracciones, en `out`. */
  private fracProfile(key: string, frac: Float32Array, box: TrackBox, s: Sampling, out: Float32Array): void {
    const lo = box.x;
    const w = box.width;
    if (s.decimated) {
      const b = this.rows(key, frac, s);
      for (let r = 0; r < s.rows; r++) out[r] = b.state[r] === ROW_DATA ? lo + Math.min(1, Math.max(0, b.mean[r]!)) * w : NaN;
    } else {
      for (let k = 0; k < s.n; k++) {
        const v = frac[s.i0 + k]!;
        out[k] = v === v ? lo + Math.min(1, Math.max(0, v)) * w : NaN;
      }
    }
  }

  private strokeFractions(ctx: CanvasRenderingContext2D, key: string, frac: Float32Array, box: TrackBox, s: Sampling): void {
    const x0 = box.x;
    const w = box.width;
    ctx.beginPath();
    let down = false;
    if (s.decimated) {
      const b = this.rows(key, frac, s);
      for (let r = 0; r < s.rows; r++) {
        const st = b.state[r]!;
        if (st === ROW_GAP) {
          down = false;
          continue;
        }
        if (st !== ROW_DATA) continue;
        const y = r + 0.5;
        const xf = x0 + b.first[r]! * w;
        if (down) ctx.lineTo(xf, y);
        else ctx.moveTo(xf, y);
        down = true;
        ctx.lineTo(x0 + b.min[r]! * w, y);
        ctx.lineTo(x0 + b.max[r]! * w, y);
        ctx.lineTo(x0 + b.last[r]! * w, y);
      }
    } else {
      const y = s.y;
      for (let k = 0; k < s.n; k++) {
        const v = frac[s.i0 + k]!;
        if (v !== v) {
          down = false;
          continue;
        }
        const x = x0 + v * w;
        if (down) ctx.lineTo(x, y[k]!);
        else ctx.moveTo(x, y[k]!);
        down = true;
      }
    }
    ctx.stroke();
  }

  private drawFills(ctx: CanvasRenderingContext2D, t: ResolvedTrack, box: TrackBox, f: FrameInput, s: Sampling): void {
    const theme = f.theme.name;
    for (const fill of t.fills) {
      this.profile(fill.a, box, s, this.xa);
      let xb: Float32Array | number;
      if (fill.kind === 'between' && fill.b) {
        this.profile(fill.b, box, s, this.xb);
        xb = this.xb;
      } else if (fill.kind === 'edge') {
        xb = fill.side === 'left' ? box.x : box.x + box.width;
      } else {
        const bf = valueToFraction(fill.baseline ?? NaN, fill.a.axis);
        if (!Number.isFinite(bf)) continue;
        xb = box.x + Math.min(1, Math.max(0, bf)) * box.width;
      }
      let diff: Float32Array | undefined;
      if (fill.kind === 'between' && fill.b && fill.compare === 'value') {
        // Lado por VALOR (a − b), no por posición: correcto aunque las dos curvas tengan escalas distintas.
        this.values(fill.a, s, this.va);
        this.values(fill.b, s, this.vb);
        for (let k = 0; k < s.n; k++) this.va[k] = this.va[k]! - this.vb[k]!;
        diff = this.va;
      }
      const aPath = fill.aLeft ? new Path2D() : null;
      const bPath = fill.bLeft ? new Path2D() : null;
      fillBetween(s.n, s.y, this.xa, xb, aPath, bPath, box.x, box.x + box.width, diff);
      if (aPath && fill.aLeft) {
        const c = fillColor(fill.aLeft, theme);
        ctx.fillStyle = withAlpha(c.color, c.alpha * fill.opacity);
        ctx.fill(aPath);
      }
      if (bPath && fill.bLeft) {
        const c = fillColor(fill.bLeft, theme);
        ctx.fillStyle = withAlpha(c.color, c.alpha * fill.opacity);
        ctx.fill(bPath);
      }
    }
  }

  private drawCurves(ctx: CanvasRenderingContext2D, t: ResolvedTrack, box: TrackBox, f: FrameInput, s: Sampling): void {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    for (const c of t.curves) {
      if (c.kind !== 'line') continue;
      const st = c.styles[f.theme.name];
      const frac = fractionArray(c.data, c.axis);
      ctx.strokeStyle = st.color;
      ctx.setLineDash(st.dash);
      // Alternativa (método en comparación): translúcida, debajo de la activa (resolve la ordena antes).
      const alpha = c.alternative ? 0.6 : 1;
      if (c.wrap) {
        ctx.globalAlpha = 0.55 * alpha;
        ctx.lineWidth = Math.max(0.75, st.width * 0.75);
        this.strokeFractions(ctx, `${curveKey(c)}:wrap`, wrapFractionArray(frac), box, s);
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = st.width;
      this.strokeFractions(ctx, curveKey(c), frac, box, s);
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash([]);
  }

  private drawFlags(ctx: CanvasRenderingContext2D, t: ResolvedTrack, box: TrackBox, f: FrameInput, s: Sampling): void {
    const { depth, viewport: vp } = f;
    const x0 = box.x + Math.max(4, (box.width - t.curves.length * FLAG_COLUMN) / 2) + 2;
    t.curves.forEach((c, k) => {
      const x = x0 + k * FLAG_COLUMN;
      const w = FLAG_COLUMN - 4;
      const color = c.styles[f.theme.name].color;
      if (s.decimated) {
        // Intensidad = fracción de muestras marcadas en la fila (honesto a cualquier zoom).
        const b = this.rows(`${c.key}:flag`, c.data, s);
        ctx.fillStyle = color;
        for (let r = 0; r < s.rows; r++) {
          if (b.state[r] !== ROW_DATA || !(b.mean[r]! > 0)) continue;
          ctx.globalAlpha = 0.9 * Math.min(1, b.mean[r]!);
          ctx.fillRect(x, r, w, 1);
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = withAlpha(color, 0.9);
        let start = -1;
        const edge = (i: number) => (i <= 0 ? depth[0]! : i >= depth.length ? depth[depth.length - 1]! : (depth[i - 1]! + depth[i]!) / 2);
        for (let i = s.i0; i <= s.i1; i++) {
          const on = i < s.i1 && c.data[i]! >= 0.5;
          if (on && start < 0) start = i;
          if (!on && start >= 0) {
            const y0 = (edge(start) - vp.top) * vp.pxPerM;
            const y1 = (edge(i) - vp.top) * vp.pxPerM;
            ctx.fillRect(x, y0, w, Math.max(1, y1 - y0));
            start = -1;
          }
        }
      }
    });
  }

  /**
   * Pila (pista volumétrica): cada capa entre su borde izquierdo y derecho, en color OPACO (el de la paleta mezclado
   * con el fondo a su opacidad): los hijos tapan exactamente a su padre y los colores no se ensucian al superponerse.
   */
  private drawStack(ctx: CanvasRenderingContext2D, t: ResolvedTrack, box: TrackBox, f: FrameInput, s: Sampling): void {
    const st = t.stack;
    if (!st) return;
    if (st.empty) {
      this.drawEmptyNote(ctx, box, f, stackHint(st, f.stackHints) ?? 'Sin datos para la columna.');
      return;
    }
    for (const l of st.layers) {
      this.fracProfile(`${t.id}:${l.id}:l`, l.left, box, s, this.xa);
      this.fracProfile(`${t.id}:${l.id}:r`, l.right, box, s, this.xb);
      const path = new Path2D();
      fillBetween(s.n, s.y, this.xa, this.xb, path, null, box.x, box.x + box.width);
      ctx.fillStyle = stackFillColor(l.fill, f.theme);
      ctx.fill(path);
    }
  }

  /** Mensaje centrado en una pista sin datos (varias líneas si no entra). */
  private drawEmptyNote(ctx: CanvasRenderingContext2D, box: TrackBox, f: FrameInput, text: string): void {
    const h = f.viewport.height;
    ctx.font = `${TEXT_XS}px ${FONT}`;
    ctx.fillStyle = f.theme.viewer.axisText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const max = Math.max(40, box.width - 16);
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > max) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    const lh = TEXT_XS + 5;
    const y0 = h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => ctx.fillText(l, box.x + box.width / 2, y0 + i * lh));
  }

  private drawGrid(ctx: CanvasRenderingContext2D, f: FrameInput, ticks: ReturnType<typeof depthTicks>): void {
    const v = f.theme.viewer;
    const h = f.viewport.height;
    const curveTracks = f.tracks.map((t, i) => ({ t, b: f.boxes[i]! })).filter(({ t }) => t.kind !== 'depth');
    ctx.lineWidth = 1;
    // Horizontales: subdivisiones y rótulos de profundidad.
    for (const [list, color] of [
      [ticks.minor, v.gridMinor],
      [ticks.major, v.gridMajor],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const d of list) {
        const y = crisp(yOf(f.viewport, d));
        for (const { b } of curveTracks) {
          ctx.moveTo(b.x, y);
          ctx.lineTo(b.x + b.width, y);
        }
      }
      ctx.stroke();
    }
    // Verticales por pista.
    for (const { t, b } of curveTracks) {
      if (!t.grid) continue;
      const lines = t.grid.kind === 'log' ? logGrid(t.grid.min, t.grid.max, t.grid.reversed) : linearGrid(10);
      for (const major of [false, true]) {
        ctx.strokeStyle = major ? v.gridMajor : v.gridMinor;
        ctx.beginPath();
        for (const g of lines) {
          if (g.major !== major) continue;
          const x = crisp(b.x + g.f * b.width);
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        }
        ctx.stroke();
      }
    }
  }

  private drawDepthTrack(ctx: CanvasRenderingContext2D, box: TrackBox, f: FrameInput, ticks: ReturnType<typeof depthTicks>): void {
    const v = f.theme.viewer;
    const h = f.viewport.height;
    const right = box.x + box.width;
    ctx.strokeStyle = v.gridMajor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of ticks.minor) {
      const y = crisp(yOf(f.viewport, d));
      ctx.moveTo(right - 4, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();
    ctx.strokeStyle = v.axisText;
    ctx.beginPath();
    for (const d of ticks.major) {
      const y = crisp(yOf(f.viewport, d));
      ctx.moveTo(right - 8, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();
    ctx.fillStyle = v.depthText;
    ctx.font = `${BASE_TOKENS.weight.medium} ${TEXT_XS}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const d of ticks.major) {
      const y = yOf(f.viewport, d);
      if (y < 7 || y > h - 7) continue;
      ctx.fillText(formatNumber(d, { digits: ticks.decimals, grouping: false }), right - 11, y);
    }
  }

  /** Dibuja el canvas base. Devuelve los ms que tardó. */
  drawBase(ctx: CanvasRenderingContext2D, f: FrameInput): number {
    const t0 = performance.now();
    const v = f.theme.viewer;
    const h = f.viewport.height;
    this.frameId++;
    const s = this.computeSampling(f);
    const ticks = depthTicks(f.viewport.top, baseOf(f.viewport), f.viewport.pxPerM);

    ctx.clearRect(0, 0, f.width, h);
    f.tracks.forEach((t, i) => {
      const b = f.boxes[i]!;
      ctx.fillStyle = t.kind === 'depth' ? v.trackBgAlt : v.trackBg;
      ctx.fillRect(b.x, 0, b.width, h);
    });
    this.drawGrid(ctx, f, ticks);

    const frame: OverlayFrame = {
      ctx,
      theme: f.theme,
      viewport: overlayViewport(f.viewport),
      tracks: overlayTracks(f.tracks, f.boxes),
      data: f.data,
      invalidate: f.invalidate ?? (() => {}),
      active: f.active ?? null,
    };
    const runOverlays = (layer: 'under' | 'over') => {
      for (const o of [...f.overlays].filter((o) => o.layer === layer).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
        ctx.save();
        guard(o.id, 'draw', () => o.draw(frame));
        ctx.restore();
      }
    };
    runOverlays('under');

    // Animación de carga: las pistas se "registran" de arriba hacia abajo hasta `reveal`.
    const reveal = f.reveal !== undefined && f.reveal < 1 ? Math.max(0, f.reveal) : null;
    const clipH = reveal === null ? h : h * reveal;
    f.tracks.forEach((t, i) => {
      const b = f.boxes[i]!;
      if (t.kind === 'depth' || t.kind === 'overlay') return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x, 0, b.width, t.kind === 'stack' && t.stack?.empty ? h : clipH);
      ctx.clip();
      if (t.kind === 'stack') {
        this.drawStack(ctx, t, b, f, s);
      } else if (t.curves.length === 0) {
        ctx.fillStyle = v.axisText;
        ctx.font = `${TEXT_XS}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Sin curvas', b.x + b.width / 2, h / 2);
      } else if (t.kind === 'flags') {
        this.drawFlags(ctx, t, b, f, s);
      } else {
        this.drawFills(ctx, t, b, f, s);
        this.drawCurves(ctx, t, b, f, s);
      }
      ctx.restore();
    });

    if (reveal !== null) this.drawRevealFront(ctx, f, clipH);

    runOverlays('over');

    // Profundidad y bordes al final: quedan nítidos sobre todo lo demás.
    f.tracks.forEach((t, i) => {
      if (t.kind === 'depth') this.drawDepthTrack(ctx, f.boxes[i]!, f, ticks);
    });
    ctx.strokeStyle = v.trackBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < f.boxes.length; i++) {
      const x = crisp(f.boxes[i]!.x) - 1;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
    // Buffers que este cuadro no usó (escala vieja, curva que ya no está): fuera. Mantiene el mapa acotado.
    for (const [k, stamp] of this.rowStamp) {
      if (stamp !== this.frameId) {
        this.rowStamp.delete(k);
        this.rowBufs.delete(k);
      }
    }
    return performance.now() - t0;
  }

  /** Frente de la animación de carga: una línea de acento con un halo que se desvanece hacia arriba. */
  private drawRevealFront(ctx: CanvasRenderingContext2D, f: FrameInput, y: number): void {
    const accent = f.theme.color.accent;
    const grad = ctx.createLinearGradient(0, y - 28, 0, y);
    grad.addColorStop(0, withAlpha(accent, 0));
    grad.addColorStop(1, withAlpha(accent, 0.14));
    for (let i = 0; i < f.tracks.length; i++) {
      const t = f.tracks[i]!;
      if (t.kind === 'depth' || t.kind === 'overlay') continue;
      const b = f.boxes[i]!;
      ctx.fillStyle = grad;
      ctx.fillRect(b.x, y - 28, b.width, 28);
      ctx.fillStyle = withAlpha(accent, 0.85);
      ctx.fillRect(b.x, Math.round(y) - 1, b.width, 1.5);
    }
  }

  /** Buffers de reducción en uso (para tests). */
  get bufferCount(): number {
    return this.rowBufs.size;
  }

  /** Dibuja el canvas de cursor (línea, puntos sobre las curvas y rótulo de profundidad). */
  drawCursor(ctx: CanvasRenderingContext2D, f: FrameInput, depth: number | null): void {
    const h = f.viewport.height;
    ctx.clearRect(0, 0, f.width, h);
    if (depth === null) return;
    const y = yOf(f.viewport, depth);
    if (y < 0 || y > h) return;
    const v = f.theme.viewer;
    const yy = crisp(y);
    ctx.strokeStyle = v.cursor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(f.width, yy);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const idx = nearestIndex(f.depth, depth);
    if (idx >= 0) {
      f.tracks.forEach((t, i) => {
        if (t.kind !== 'curves') return;
        const b = f.boxes[i]!;
        for (const c of t.curves) {
          if (c.kind !== 'line') continue;
          const fr = valueToFraction(c.data[idx]!, c.axis);
          if (!(fr >= 0 && fr <= 1)) continue;
          const x = b.x + fr * b.width;
          ctx.beginPath();
          ctx.arc(x, y, 3.25, 0, Math.PI * 2);
          ctx.fillStyle = c.styles[f.theme.name].color;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = v.trackBg;
          ctx.stroke();
        }
      });
    }

    // Rótulo de profundidad en la pista de profundidad (o a la izquierda si no hay).
    const di = f.tracks.findIndex((t) => t.kind === 'depth');
    const box = di >= 0 ? f.boxes[di]! : { x: 0, width: 72 };
    const label = formatDepth(depth);
    ctx.font = `${BASE_TOKENS.weight.semibold} ${TEXT_XS}px ${FONT}`;
    const tw = ctx.measureText(label).width;
    const bw = Math.min(box.width - 6, tw + 12);
    const bh = 18;
    const bx = box.x + (box.width - bw) / 2;
    const by = Math.min(h - bh - 1, Math.max(1, y - bh / 2));
    ctx.fillStyle = v.cursorLabelBg;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 5);
    ctx.fill();
    ctx.fillStyle = v.cursorLabelText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5);
  }
}
