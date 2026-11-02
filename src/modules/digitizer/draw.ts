/**
 * Dibujo del lienzo de la mesa (docs/decisiones/0063): imagen, guías de calibración, marcos y regiones de las curvas,
 * guía del modo guiado, trazas, puntos de geometría y cruz de lectura. Solo canvas 2D y tokens del tema.
 */
import { depthToMeters, rowAtDepth, type DepthCalibration, type PixelPoint } from '../../digitizer';
import { BASE_TOKENS, canvasFont, type ThemeTokens } from '../../ui';
import { formatNumber } from '../../ui/format';
import { overlayColor, regionOf, type CurveDraft, type TieDraft } from './model/form';
import { tracePolylines } from './model/traceEdit';
import { imageToScreen, visibleRows, type Viewport } from './model/viewport';
import type { ViewMode } from './store';

export interface DeskScene {
  width: number;
  height: number;
  vp: Viewport;
  view: ViewMode;
  bitmap: ImageBitmap | null;
  imgW: number;
  imgH: number;
  mask: { bitmap: ImageBitmap; x0: number; y0: number } | null;
  /** Puntos de geometría (solo en la vista original). */
  tilt: PixelPoint[];
  quad: PixelPoint[];
  ties: TieDraft[];
  tieUnit: 'm' | 'ft';
  cal: DepthCalibration | null;
  curves: CurveDraft[];
  selectedId: string | null;
  cursor: { sx: number; sy: number; label: string[] } | null;
  preview: { kind: 'rect'; a: PixelPoint; b: PixelPoint } | { kind: 'band'; y0: number; y1: number } | null;
  showTraces: boolean;
  focusTieId: string | null;
}

const niceStep = (raw: number): number => {
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};

function pill(ctx: CanvasRenderingContext2D, t: ThemeTokens, text: string, x: number, y: number, align: 'left' | 'right', ui: number, color?: string): void {
  const padX = 5 * ui;
  const h = 17 * ui;
  const w = ctx.measureText(text).width + padX * 2;
  const x0 = align === 'left' ? x : x - w;
  ctx.fillStyle = t.color.surfaceRaised;
  ctx.strokeStyle = color ?? t.color.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x0, y - h / 2, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = t.color.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, x0 + padX, y + 0.5);
}

function polyline(ctx: CanvasRenderingContext2D, vp: Viewport, pts: readonly PixelPoint[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = imageToScreen(vp, p.x, p.y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
}

function handle(ctx: CanvasRenderingContext2D, t: ThemeTokens, s: PixelPoint, color: string, label: string | null, ui: number): void {
  ctx.beginPath();
  ctx.arc(s.x, s.y, 5.5 * ui, 0, Math.PI * 2);
  ctx.fillStyle = t.color.surfaceRaised;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  if (label) {
    ctx.fillStyle = t.color.text;
    ctx.font = canvasFont(BASE_TOKENS.text.xs, 600, ui);
    pill(ctx, t, label, s.x + 9 * ui, s.y - 12 * ui, 'left', ui, color);
  }
}

export function drawDesk(ctx: CanvasRenderingContext2D, sc: DeskScene, t: ThemeTokens, ui: number): void {
  const { vp, width, height } = sc;
  ctx.fillStyle = t.color.bg;
  ctx.fillRect(0, 0, width, height);
  if (!sc.bitmap) return;

  // Imagen (con sombra de hoja sobre la mesa); píxeles nítidos al acercar.
  const x0 = vp.ox;
  const y0 = vp.oy;
  const w = sc.imgW * vp.scale;
  const h = sc.imgH * vp.scale;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0, y0, w, h);
  ctx.restore();
  ctx.imageSmoothingEnabled = vp.scale < 2;
  ctx.imageSmoothingQuality = 'high';
  if (sc.view === 'mask') ctx.globalAlpha = 0.28;
  ctx.drawImage(sc.bitmap, x0, y0, w, h);
  ctx.globalAlpha = 1;
  if (sc.view === 'mask' && sc.mask) {
    const m = sc.mask;
    const s = imageToScreen(vp, m.x0 - 0.5, m.y0 - 0.5);
    ctx.drawImage(m.bitmap, s.x, s.y, m.bitmap.width * vp.scale, m.bitmap.height * vp.scale);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.font = canvasFont(BASE_TOKENS.text.xs, 500, ui);

  if (sc.view === 'original') {
    drawGeometryPicks(ctx, sc, t, ui);
  } else {
    drawDepth(ctx, sc, t, ui);
    drawCurves(ctx, sc, t, ui);
  }

  // Vista previa de un gesto (rectángulo de región o banda a borrar).
  const pv = sc.preview;
  if (pv?.kind === 'rect') {
    const a = imageToScreen(vp, Math.min(pv.a.x, pv.b.x), Math.min(pv.a.y, pv.b.y));
    const b = imageToScreen(vp, Math.max(pv.a.x, pv.b.x), Math.max(pv.a.y, pv.b.y));
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = t.color.accent;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = t.color.accentSoft;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.globalAlpha = 1;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.restore();
  } else if (pv?.kind === 'band') {
    const a = imageToScreen(vp, -0.5, Math.min(pv.y0, pv.y1));
    const b = imageToScreen(vp, sc.imgW - 0.5, Math.max(pv.y0, pv.y1));
    ctx.save();
    ctx.fillStyle = t.color.errorSoft;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(a.x, a.y, b.x - a.x, Math.max(2, b.y - a.y));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = t.color.error;
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x, a.y, b.x - a.x, Math.max(2, b.y - a.y));
    ctx.restore();
  }

  // Cruz de lectura con su rótulo.
  if (sc.cursor) {
    const { sx, sy } = sc.cursor;
    ctx.save();
    ctx.strokeStyle = t.viewer.cursor;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(sy) + 0.5);
    ctx.lineTo(width, Math.round(sy) + 0.5);
    ctx.moveTo(Math.round(sx) + 0.5, 0);
    ctx.lineTo(Math.round(sx) + 0.5, height);
    ctx.stroke();
    ctx.restore();
    if (sc.cursor.label.length) {
      ctx.font = canvasFont(BASE_TOKENS.text.xs, 600, ui);
      const lines = sc.cursor.label;
      const lh = 16 * ui;
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12 * ui;
      const bh = lines.length * lh + 6 * ui;
      let bx = sx + 14 * ui;
      let by = sy + 14 * ui;
      if (bx + bw > width - 4) bx = sx - 14 * ui - bw;
      if (by + bh > height - 4) by = sy - 14 * ui - bh;
      ctx.fillStyle = t.viewer.cursorLabelBg;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 5);
      ctx.fill();
      ctx.fillStyle = t.viewer.cursorLabelText;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      lines.forEach((l, i) => ctx.fillText(l, bx + 6 * ui, by + 3 * ui + lh * (i + 0.5)));
    }
  }
}

function drawGeometryPicks(ctx: CanvasRenderingContext2D, sc: DeskScene, t: ThemeTokens, ui: number): void {
  const { vp } = sc;
  if (sc.quad.length) {
    ctx.save();
    ctx.strokeStyle = t.color.info;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    polyline(ctx, vp, sc.quad.length === 4 ? [...sc.quad, sc.quad[0]!] : sc.quad);
    ctx.stroke();
    ctx.restore();
    const names = ['Arriba izq.', 'Arriba der.', 'Abajo der.', 'Abajo izq.'];
    sc.quad.forEach((p, i) => handle(ctx, t, imageToScreen(vp, p.x, p.y), t.color.info, names[i]!, ui));
  }
  if (sc.tilt.length) {
    if (sc.tilt.length === 2) {
      ctx.save();
      ctx.strokeStyle = t.color.accent;
      ctx.lineWidth = 2;
      polyline(ctx, vp, sc.tilt);
      ctx.stroke();
      // Vertical de referencia desde el primer punto.
      const a = sc.tilt[0]!.y < sc.tilt[1]!.y ? sc.tilt[0]! : sc.tilt[1]!;
      const b = sc.tilt[0]!.y < sc.tilt[1]!.y ? sc.tilt[1]! : sc.tilt[0]!;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = t.color.textMuted;
      ctx.lineWidth = 1;
      polyline(ctx, vp, [a, { x: a.x, y: b.y }]);
      ctx.stroke();
      ctx.restore();
      const ang = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
      ctx.font = canvasFont(BASE_TOKENS.text.xs, 600, ui);
      const m = imageToScreen(vp, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pill(ctx, t, `${formatNumber(ang, { digits: 2 })}°`, m.x + 10 * ui, m.y, 'left', ui, t.color.accent);
    }
    sc.tilt.forEach((p, i) => handle(ctx, t, imageToScreen(vp, p.x, p.y), t.color.accent, i === 0 ? '1' : '2', ui));
  }
}

function drawDepth(ctx: CanvasRenderingContext2D, sc: DeskScene, t: ThemeTokens, ui: number): void {
  const { vp, cal } = sc;
  const left = vp.ox;
  const right = vp.ox + sc.imgW * vp.scale;
  ctx.font = canvasFont(BASE_TOKENS.text.xs, 500, ui);

  // Regla de profundidad a la izquierda de la hoja (cada paso «redondo»).
  if (cal && Math.abs(cal.slopeMPerPx) > 0) {
    const unitPerPx = Math.abs(cal.slopeMPerPx) / (cal.unit === 'ft' ? 0.3048 : 1);
    const step = niceStep((unitPerPx / vp.scale) * 56 * ui);
    const [ra, rb] = visibleRows(vp, sc.imgH, sc.height);
    const da = (cal.interceptM + cal.slopeMPerPx * ra) / (cal.unit === 'ft' ? 0.3048 : 1);
    const db = (cal.interceptM + cal.slopeMPerPx * rb) / (cal.unit === 'ft' ? 0.3048 : 1);
    const lo = Math.ceil(Math.min(da, db) / step) * step;
    const hi = Math.max(da, db);
    const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    ctx.save();
    for (let d = lo, k = 0; d <= hi && k < 400; d += step, k++) {
      const y = rowAtDepth(cal, depthToMeters(d, cal.unit));
      if (!Number.isFinite(y)) continue;
      const sy = imageToScreen(vp, 0, y).y;
      ctx.strokeStyle = t.color.textMuted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left - 6 * ui, Math.round(sy) + 0.5);
      ctx.lineTo(left, Math.round(sy) + 0.5);
      ctx.stroke();
      ctx.fillStyle = t.color.textMuted;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      if (left > 60 * ui) ctx.fillText(formatNumber(d, { digits }), left - 9 * ui, sy);
    }
    ctx.restore();
  }

  // Amarres: línea horizontal a todo el ancho y su rótulo.
  for (const tie of sc.ties) {
    const sy = imageToScreen(vp, 0, tie.y).y;
    const pending = tie.depth === null;
    const color = pending ? t.color.warn : t.color.info;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = tie.id === sc.focusTieId ? 2 : 1.25;
    ctx.setLineDash(pending ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(left - 10 * ui, Math.round(sy) + 0.5);
    ctx.lineTo(right + 10 * ui, Math.round(sy) + 0.5);
    ctx.stroke();
    ctx.restore();
    const text = pending ? '¿profundidad?' : `${formatNumber(tie.depth, { digits: 2 })} ${sc.tieUnit}`;
    ctx.font = canvasFont(BASE_TOKENS.text.xs, 600, ui);
    // A la derecha de la hoja si hay lugar; si no, adentro, contra el borde visible.
    const tw = ctx.measureText(text).width + 10 * ui;
    if (right + 12 * ui + tw < sc.width - 4) pill(ctx, t, text, right + 12 * ui, sy, 'left', ui, color);
    else pill(ctx, t, text, Math.min(right, sc.width) - 8 * ui, sy - 12 * ui, 'right', ui, color);
  }
}

function drawCurves(ctx: CanvasRenderingContext2D, sc: DeskScene, t: ThemeTokens, ui: number): void {
  const { vp } = sc;
  const [ra, rb] = visibleRows(vp, sc.imgH, sc.height);
  const ordered = [...sc.curves].sort((a, b) => Number(a.id === sc.selectedId) - Number(b.id === sc.selectedId));
  for (const c of ordered) {
    const sel = c.id === sc.selectedId;
    const color = overlayColor(c);
    ctx.save();
    ctx.globalAlpha = sel ? 1 : 0.55;
    // Bordes de la pista con sus valores.
    for (const [px, val] of [
      [c.leftPx, c.leftValue],
      [c.rightPx, c.rightValue],
    ] as const) {
      if (px === null) continue;
      const sx = imageToScreen(vp, px, 0).x;
      ctx.strokeStyle = color;
      ctx.lineWidth = sel ? 1.5 : 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(sx) + 0.5, vp.oy);
      ctx.lineTo(Math.round(sx) + 0.5, vp.oy + sc.imgH * vp.scale);
      ctx.stroke();
      ctx.setLineDash([]);
      if (sel) {
        ctx.font = canvasFont(BASE_TOKENS.text.xs, 600, ui);
        pill(ctx, t, `${c.mnemonic} ${formatNumber(val, { significant: 4 })}`, sx, Math.max(14 * ui, vp.oy - 12 * ui), px === c.leftPx ? 'left' : 'right', ui, color);
      }
    }
    // Región de búsqueda (solo la elegida por la persona, o la de la curva seleccionada).
    const region = sel || c.region ? regionOf(c, { width: sc.imgW, height: sc.imgH }) : null;
    if (region && sel) {
      const a = imageToScreen(vp, region.x0 - 0.5, region.y0 - 0.5);
      const b = imageToScreen(vp, region.x1 - 0.5, region.y1 - 0.5);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
    }
    // Guía del modo guiado y su corredor.
    if (c.mode === 'guided' && c.guide.length) {
      const pts = [...c.guide].sort((p, q) => p.y - q.y);
      ctx.globalAlpha = sel ? 0.16 : 0.08;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, c.corridor * 2 * vp.scale);
      polyline(ctx, vp, pts);
      ctx.stroke();
      ctx.globalAlpha = sel ? 1 : 0.55;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      polyline(ctx, vp, pts);
      ctx.stroke();
      ctx.setLineDash([]);
      if (sel) for (const p of pts) handle(ctx, t, imageToScreen(vp, p.x, p.y), color, null, ui * 0.8);
    }
    // Traza: halo del color de la mesa + color complementario de la tinta.
    if (c.trace && sc.showTraces) {
      const step = Math.max(1, Math.floor(0.6 / vp.scale));
      const lines = tracePolylines(c.trace, ra, rb, step);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass === 0 ? t.color.surface : color;
        ctx.lineWidth = pass === 0 ? (sel ? 4.5 : 3) : sel ? 2 : 1.25;
        ctx.globalAlpha = pass === 0 ? 0.7 : sel ? 1 : 0.6;
        for (const l of lines) {
          if (l.length === 1) {
            const s = imageToScreen(vp, l[0]!.x, l[0]!.y);
            ctx.beginPath();
            ctx.arc(s.x, s.y, ctx.lineWidth, 0, Math.PI * 2);
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();
            continue;
          }
          polyline(ctx, vp, l);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}
