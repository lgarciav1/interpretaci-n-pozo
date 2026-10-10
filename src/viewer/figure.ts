/**
 * Figura del perfil para el informe (docs/decisiones/0012-exportacion-de-figuras.md): las MISMAS pistas, rellenos,
 * curvas y superposiciones de la pantalla (`ViewerRenderer.drawBase`) dentro de un marco de publicación: título, datos
 * del pozo, encabezado de cada pista con sus curvas (unidad y escala), leyenda de zonas, sumario por zona y créditos.
 *
 * Es puro y recibe el contexto 2D como parámetro: el mismo código dibuja un canvas fuera de pantalla (PNG, PDF) o el
 * grabador de SVG (`src/io/export/figures/svg.ts`). Siempre con el tema claro (impresión) y sin lo que es de la
 * interacción (cursor, manijas, animación de carga). No toca el canvas de la pantalla.
 */
import type { ExportSummary } from '../io/export/types';
import type { FigureParts } from '../io/export/figures/templates';
import type { TextMeasure } from '../io/export/figures/svg';
import { formatNumber } from '../ui/format';
import { FILL_PALETTE } from '../ui/curves';
import { BASE_TOKENS, THEMES } from '../ui/tokens';
import { layoutTracks, type TrackBox } from './layout';
import type { ViewerData, ViewerOverlay, ViewerZone } from './overlay';
import { stackFillColor, ViewerRenderer } from './render';
import type { ResolvedCurve, ResolvedTrack } from './resolve';
import { edgeValues } from './scale';

const FONT = BASE_TOKENS.font.sans;
const W = BASE_TOKENS.weight;
const font = (size: number, weight: number = W.regular) => `${weight} ${size}px ${FONT}`;

/** Tema de las figuras: siempre claro, aunque la app esté en oscuro. */
export const FIGURE_THEME = THEMES.light;

export interface WellField {
  label: string;
  value: string;
}

export interface ViewerFigureInput {
  /** Pistas ya resueltas (las de la pantalla o un subconjunto). */
  tracks: readonly ResolvedTrack[];
  depth: Float64Array;
  /** Datos para las superposiciones (sin zona seleccionada). */
  data: ViewerData;
  overlays: readonly ViewerOverlay[];
  /** Tramo dibujado (m). */
  range: { top: number; base: number };
  /** Zoom vertical, px CSS por metro (96 ppp: 1:N → `pxPerMeterForScale(N)`). */
  pxPerM: number;
  /** Ancho que deben ocupar las pistas (px CSS). Si no alcanzan al ancho mínimo, la figura se ensancha. */
  tracksWidth: number;
  /** Margen blanco alrededor (px CSS). */
  margin: number;
  parts: FigureParts;
  title: string;
  subtitle?: string;
  wellFields: readonly WellField[];
  zones: readonly ViewerZone[];
  summary?: ExportSummary | null;
  credits: string;
  /** Texto de la derecha del pie («Escala vertical 1:500»). */
  scaleText: string;
  stackHints?: Readonly<Record<string, string>>;
  measure: TextMeasure;
}

// ── encabezado de pista ─────────────────────────────────────────────────────────────────────────────────────────

type HeaderRow =
  | { kind: 'title'; text: string; height: number }
  | { kind: 'unit'; text: string; height: number }
  | { kind: 'scale'; left: string; right: string; center?: string; /** Si el centro no entra, solo esto (la unidad). */ centerShort?: string; height: number }
  | { kind: 'curve'; curve: ResolvedCurve; name: string; left: string; right: string; height: number }
  | { kind: 'name'; curve: ResolvedCurve; name: string; height: number }
  | { kind: 'swatch'; color: string; text: string; shortText: string; height: number };

const TITLE_H = 20;
const SCALE_H = 14;
const CURVE_H = 28;
const NAME_H = 16;
const SWATCH_H = 16;
const HEADER_PAD = 6;

const endLabel = (v: number) => formatNumber(v, { significant: 4, grouping: false });
const unitText = (c: ResolvedCurve) => (c.unitLabel && c.unitLabel !== '—' ? c.unitLabel : '');
const sameScale = (a: ResolvedCurve, b: ResolvedCurve) => a.axis.kind === b.axis.kind && a.axis.min === b.axis.min && a.axis.max === b.axis.max && a.axis.reversed === b.axis.reversed;

/** Filas del encabezado de una pista: título, y según el tipo, curvas con escala, capas de la pila o banderas. */
export function trackHeaderRows(t: ResolvedTrack, depthUnit = 'm'): HeaderRow[] {
  const rows: HeaderRow[] = [{ kind: 'title', text: t.title, height: TITLE_H }];
  if (t.kind === 'depth') {
    rows.push({ kind: 'unit', text: depthUnit, height: SCALE_H });
    return rows;
  }
  if (t.kind === 'stack') {
    if (t.stack && !t.stack.empty) for (const item of t.stack.legend) rows.push({ kind: 'swatch', color: item.fill, text: item.label, shortText: item.short, height: SWATCH_H });
    return rows;
  }
  if (t.kind === 'overlay') {
    if (t.grid) {
      const [l, r] = edgeValues(t.grid);
      rows.push({ kind: 'scale', left: endLabel(l), right: endLabel(r), ...(t.unit ? { center: t.unit } : {}), height: SCALE_H });
    }
    return rows;
  }
  if (t.kind === 'flags') {
    for (const c of t.curves) rows.push({ kind: 'swatch', color: c.styles.light.color, text: c.short, shortText: c.short, height: SWATCH_H });
    return rows;
  }
  const lines = t.curves.filter((c) => c.kind === 'line');
  const name = (c: ResolvedCurve, withUnit = true) => `${c.name}${withUnit && unitText(c) ? ` (${unitText(c)})` : ''}${c.alternative ? ' · alt.' : ''}`;
  const shared = lines.length > 1 && lines.every((c) => sameScale(c, lines[0]!) && unitText(c) === unitText(lines[0]!));
  if (shared) {
    // Misma escala y unidad (resistividades): los extremos y la unidad una sola vez, después cada curva con su trazo.
    const [l, r] = edgeValues(lines[0]!.axis);
    const u = unitText(lines[0]!);
    const center = [u, lines[0]!.axis.kind === 'log' ? 'log' : ''].filter(Boolean).join(' · ');
    rows.push({ kind: 'scale', left: endLabel(l), right: endLabel(r), ...(center ? { center } : {}), ...(u ? { centerShort: u } : {}), height: SCALE_H });
    for (const c of lines) rows.push({ kind: 'name', curve: c, name: name(c, false), height: NAME_H });
  } else {
    for (const c of lines) {
      const [l, r] = edgeValues(c.axis);
      rows.push({ kind: 'curve', curve: c, name: name(c), left: endLabel(l), right: endLabel(r), height: CURVE_H });
    }
  }
  for (const c of t.curves) if (c.kind === 'band') rows.push({ kind: 'swatch', color: c.styles.light.color, text: c.short, shortText: c.short, height: SWATCH_H });
  return rows;
}

const rowsHeight = (rows: readonly HeaderRow[]) => rows.reduce((s, r) => s + r.height, 0) + HEADER_PAD;

// ── disposición ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface ViewerFigureLayout {
  /** Tamaño total (px CSS). */
  width: number;
  height: number;
  boxes: TrackBox[];
  tracksX: number;
  tracksWidth: number;
  titleY: number;
  fieldsY: number;
  fieldLines: WellField[][];
  headerY: number;
  headerHeight: number;
  bodyY: number;
  bodyHeight: number;
  zoneLegendY: number;
  zoneLines: ViewerZone[][];
  summaryY: number;
  summaryHeight: number;
  footerY: number;
}

const LINE_FIELDS = 16;
const LINE_ZONES = 18;
const TITLE_BLOCK = (f: { title: string; subtitle?: string }) => (f.title ? 22 + (f.subtitle ? 18 : 0) + 8 : 0);

function wrapItems<T>(items: readonly T[], maxWidth: number, widthOf: (t: T) => number, gap: number): T[][] {
  const lines: T[][] = [];
  let cur: T[] = [];
  let w = 0;
  for (const it of items) {
    const iw = widthOf(it);
    if (cur.length && w + gap + iw > maxWidth) {
      lines.push(cur);
      cur = [];
      w = 0;
    }
    w += (cur.length ? gap : 0) + iw;
    cur.push(it);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

const fieldWidth = (m: TextMeasure, f: WellField) => m(font(BASE_TOKENS.text.xs, W.semibold), `${f.label}: `) + m(font(BASE_TOKENS.text.xs), f.value);
const zoneText = (z: ViewerZone) => `Zona ${z.name} · ${formatNumber(z.top, { digits: 0, grouping: false })}–${formatNumber(z.base, { digits: 0, grouping: false })} m`;
const zoneWidth = (m: TextMeasure, z: ViewerZone) => 14 + m(font(BASE_TOKENS.text.xs), zoneText(z));

const SUMMARY_HEAD = 34;
const SUMMARY_ROW = 18;

/** Calcula posiciones y tamaño total de la figura. Puro. */
export function layoutViewerFigure(input: ViewerFigureInput): ViewerFigureLayout {
  const { parts, margin, measure } = input;
  const trackLayout = layoutTracks(
    input.tracks.map((t) => ({ width: t.width, ...(t.fixed !== undefined ? { fixed: t.fixed } : {}) })),
    input.tracksWidth,
  );
  const tracksWidth = Math.max(trackLayout.total, 1);
  const inner = tracksWidth;
  const width = inner + 2 * margin;
  let y = margin;
  const titleY = y;
  if (parts.title) y += TITLE_BLOCK(input);
  const fieldsY = y;
  const fieldLines = parts.wellHeader ? wrapItems(input.wellFields, inner, (f) => fieldWidth(measure, f), 18) : [];
  if (fieldLines.length) y += fieldLines.length * LINE_FIELDS + 10;
  const headerY = y;
  const headerHeight = parts.trackHeaders ? Math.max(...input.tracks.map((t) => rowsHeight(trackHeaderRows(t))), 0) : 0;
  y += headerHeight;
  const bodyY = y;
  const bodyHeight = Math.max(1, Math.round((input.range.base - input.range.top) * input.pxPerM));
  y += bodyHeight;
  const zoneLegendY = y + 10;
  const visibleZones = input.zones.filter((z) => z.base >= input.range.top && z.top <= input.range.base);
  const zoneLines = parts.zoneLegend && visibleZones.length ? wrapItems(visibleZones, inner, (z) => zoneWidth(measure, z), 16) : [];
  if (zoneLines.length) y += 10 + zoneLines.length * LINE_ZONES;
  const summaryY = y + 14;
  const summaryHeight = parts.summary && input.summary && input.summary.rows.length ? SUMMARY_HEAD + input.summary.rows.length * SUMMARY_ROW : 0;
  if (summaryHeight) y += 14 + summaryHeight;
  const footerY = y + (parts.credits ? 12 : 0);
  if (parts.credits) y = footerY + 16;
  return {
    width,
    height: Math.ceil(y + margin),
    boxes: trackLayout.boxes.map((b) => ({ x: b.x, width: b.width })),
    tracksX: margin,
    tracksWidth,
    titleY,
    fieldsY,
    fieldLines,
    headerY,
    headerHeight,
    bodyY,
    bodyHeight,
    zoneLegendY,
    zoneLines,
    summaryY,
    summaryHeight,
    footerY,
  };
}

// ── dibujo ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Recorta con «…» hasta que entre en `max` px. */
export function fitText(measure: TextMeasure, f: string, text: string, max: number): string {
  if (measure(f, text) <= max) return text;
  let t = text;
  while (t.length > 1 && measure(f, `${t}…`) > max) t = t.slice(0, -1);
  return `${t}…`;
}

function drawHeaders(ctx: CanvasRenderingContext2D, input: ViewerFigureInput, L: ViewerFigureLayout): void {
  const th = FIGURE_THEME;
  const v = th.viewer;
  const { measure } = input;
  ctx.save();
  ctx.fillStyle = v.trackBgAlt;
  ctx.fillRect(L.tracksX, L.headerY, L.tracksWidth, L.headerHeight);
  input.tracks.forEach((t, i) => {
    const b = L.boxes[i]!;
    const x0 = L.tracksX + b.x + 5;
    const x1 = L.tracksX + b.x + b.width - 5;
    const inner = x1 - x0;
    let y = L.headerY + 3;
    for (const row of trackHeaderRows(t)) {
      const mid = y + row.height / 2;
      if (row.kind === 'title') {
        const f = font(BASE_TOKENS.text.xs, W.semibold);
        ctx.font = f;
        ctx.fillStyle = th.color.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fitText(measure, f, row.text, inner), (x0 + x1) / 2, mid);
      } else if (row.kind === 'unit') {
        ctx.font = font(10);
        ctx.fillStyle = v.axisText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(row.text, (x0 + x1) / 2, mid);
      } else if (row.kind === 'scale') {
        ctx.font = font(10);
        ctx.fillStyle = v.axisText;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(row.left, x0, mid);
        ctx.textAlign = 'right';
        ctx.fillText(row.right, x1, mid);
        const free = inner - measure(font(10), row.left) - measure(font(10), row.right) - 10;
        const center = [row.center, row.centerShort].find((c) => c && measure(font(10), c) <= free);
        if (center) {
          ctx.textAlign = 'center';
          ctx.fillText(center, (x0 + x1) / 2, mid);
        }
      } else if (row.kind === 'curve') {
        // Nombre y unidad arriba; abajo, extremo izquierdo, trazo de la curva y extremo derecho.
        const st = row.curve.styles.light;
        const f = font(10, W.semibold);
        ctx.font = f;
        ctx.fillStyle = st.color;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(fitText(measure, f, row.name, inner), (x0 + x1) / 2, y + 7);
        ctx.font = font(10);
        ctx.fillStyle = v.axisText;
        ctx.textAlign = 'left';
        ctx.fillText(row.left, x0, y + 20);
        ctx.textAlign = 'right';
        ctx.fillText(row.right, x1, y + 20);
        sampleLine(ctx, row.curve, x0 + measure(font(10), row.left) + 5, x1 - measure(font(10), row.right) - 5, y + 20);
      } else if (row.kind === 'name') {
        const f = font(10, W.semibold);
        ctx.font = f;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        sampleLine(ctx, row.curve, x0, x0 + 18, mid);
        ctx.fillStyle = row.curve.styles.light.color;
        ctx.fillText(fitText(measure, f, row.name, inner - 24), x0 + 24, mid);
      } else {
        const color = row.color in FILL_PALETTE ? stackFillColor(row.color, th) : row.color;
        ctx.fillStyle = color;
        ctx.fillRect(x0, mid - 5, 10, 10);
        ctx.strokeStyle = v.trackBorder;
        ctx.lineWidth = 0.75;
        ctx.strokeRect(x0 + 0.5, mid - 4.5, 9, 9);
        const f = font(10);
        ctx.font = f;
        ctx.fillStyle = th.color.text;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const room = inner - 16;
        ctx.fillText(measure(f, row.text) <= room ? row.text : fitText(measure, f, row.shortText, room), x0 + 16, mid);
      }
      y += row.height;
    }
  });
  // Separadores de pista y filete inferior.
  ctx.strokeStyle = v.trackBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < L.boxes.length; i++) {
    const x = Math.round(L.tracksX + L.boxes[i]!.x) - 0.5;
    ctx.moveTo(x, L.headerY);
    ctx.lineTo(x, L.headerY + L.headerHeight);
  }
  ctx.stroke();
  ctx.restore();
}

/** Muestra del trazo de una curva (color, grosor y rayas reales). */
function sampleLine(ctx: CanvasRenderingContext2D, c: ResolvedCurve, x0: number, x1: number, y: number): void {
  const st = c.styles.light;
  ctx.save();
  ctx.strokeStyle = st.color;
  ctx.lineWidth = Math.max(1.25, st.width);
  ctx.setLineDash(st.dash);
  if (c.alternative) ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

function drawSummary(ctx: CanvasRenderingContext2D, input: ViewerFigureInput, L: ViewerFigureLayout): void {
  const s = input.summary;
  if (!s || !L.summaryHeight) return;
  const th = FIGURE_THEME;
  const { measure } = input;
  const x0 = L.tracksX;
  const total = L.tracksWidth;
  const cols = s.columns;
  const cellText = (col: (typeof cols)[number], row: Readonly<Record<string, number | string | null>>) => {
    const v = row[col.key];
    if (v === null || v === undefined) return '—';
    return typeof v === 'number' ? formatNumber(v, { significant: 4, grouping: false }) : String(v);
  };
  // Anchos: lo que pide el contenido, repartido proporcionalmente si no entra.
  const want = cols.map((c) => Math.max(measure(font(10, W.semibold), c.label), c.unit ? measure(font(9), `(${c.unit})`) : 0, ...s.rows.map((r) => measure(font(10), cellText(c, r)))) + 14);
  const sum = want.reduce((a, b) => a + b, 0);
  const k = sum > total ? total / sum : 1;
  const widths = want.map((w) => w * k);
  const extra = (total - widths.reduce((a, b) => a + b, 0)) / cols.length;
  const xs: number[] = [];
  let acc = x0;
  for (const w of widths) {
    xs.push(acc);
    acc += w + extra;
  }
  const colW = widths.map((w) => w + extra);
  ctx.save();
  ctx.fillStyle = th.viewer.trackBgAlt;
  ctx.fillRect(x0, L.summaryY, total, SUMMARY_HEAD);
  ctx.textBaseline = 'middle';
  cols.forEach((c, i) => {
    const text = c.kind === 'text' ? 'left' : 'right';
    ctx.textAlign = text;
    const tx = text === 'left' ? xs[i]! + 7 : xs[i]! + colW[i]! - 7;
    ctx.font = font(10, W.semibold);
    ctx.fillStyle = th.color.text;
    ctx.fillText(fitText(measure, font(10, W.semibold), c.label, colW[i]! - 12), tx, L.summaryY + (c.unit ? 11 : 17));
    if (c.unit) {
      ctx.font = font(9);
      ctx.fillStyle = th.viewer.axisText;
      ctx.fillText(`(${c.unit})`, tx, L.summaryY + 24);
    }
  });
  s.rows.forEach((row, r) => {
    const y = L.summaryY + SUMMARY_HEAD + r * SUMMARY_ROW;
    if (r % 2 === 1) {
      ctx.fillStyle = th.viewer.trackBgAlt;
      ctx.fillRect(x0, y, total, SUMMARY_ROW);
    }
    cols.forEach((c, i) => {
      const left = c.kind === 'text';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.font = font(10);
      ctx.fillStyle = th.color.text;
      ctx.fillText(fitText(measure, font(10), cellText(c, row), colW[i]! - 12), left ? xs[i]! + 7 : xs[i]! + colW[i]! - 7, y + SUMMARY_ROW / 2);
    });
  });
  ctx.strokeStyle = th.viewer.trackBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, L.summaryY + 0.5, total - 1, L.summaryHeight - 1);
  ctx.restore();
}

/** Dibuja la figura completa en (0, 0) del contexto, de `layout.width` × `layout.height` px. */
export function drawViewerFigure(ctx: CanvasRenderingContext2D, input: ViewerFigureInput, layout: ViewerFigureLayout = layoutViewerFigure(input), renderer: ViewerRenderer = new ViewerRenderer()): void {
  const th = FIGURE_THEME;
  const { parts, measure } = input;
  const L = layout;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, L.width, L.height);

  if (parts.title && input.title) {
    ctx.fillStyle = th.color.text;
    ctx.font = font(BASE_TOKENS.text.xl, W.semibold);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fitText(measure, font(BASE_TOKENS.text.xl, W.semibold), input.title, L.tracksWidth), L.tracksX, L.titleY);
    if (input.subtitle) {
      ctx.fillStyle = th.color.textMuted;
      ctx.font = font(BASE_TOKENS.text.sm);
      ctx.fillText(fitText(measure, font(BASE_TOKENS.text.sm), input.subtitle, L.tracksWidth), L.tracksX, L.titleY + 22);
    }
  }

  L.fieldLines.forEach((line, i) => {
    let x = L.tracksX;
    const y = L.fieldsY + i * LINE_FIELDS;
    for (const f of line) {
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.font = font(BASE_TOKENS.text.xs, W.semibold);
      ctx.fillStyle = th.color.textMuted;
      ctx.fillText(`${f.label}: `, x, y);
      const lw = measure(font(BASE_TOKENS.text.xs, W.semibold), `${f.label}: `);
      ctx.font = font(BASE_TOKENS.text.xs);
      ctx.fillStyle = th.color.text;
      ctx.fillText(f.value, x + lw, y);
      x += fieldWidth(measure, f) + 18;
    }
  });

  if (parts.trackHeaders) drawHeaders(ctx, input, L);

  // Cuerpo: el mismo dibujo de la pantalla, recortado a su caja.
  ctx.save();
  ctx.translate(L.tracksX, L.bodyY);
  ctx.beginPath();
  ctx.rect(0, 0, L.tracksWidth, L.bodyHeight);
  ctx.clip();
  renderer.drawBase(ctx, {
    tracks: input.tracks,
    boxes: L.boxes,
    viewport: { top: input.range.top, pxPerM: input.pxPerM, height: L.bodyHeight },
    theme: th,
    depth: input.depth,
    width: L.tracksWidth,
    overlays: input.overlays,
    data: input.data,
    ...(input.stackHints ? { stackHints: input.stackHints } : {}),
  });
  ctx.restore();

  // Marco del encabezado + cuerpo.
  ctx.strokeStyle = th.viewer.trackBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(L.tracksX - 0.5, L.headerY - 0.5, L.tracksWidth + 1, L.headerHeight + L.bodyHeight + 1);
  if (L.headerHeight) {
    ctx.beginPath();
    ctx.moveTo(L.tracksX, L.bodyY - 0.5);
    ctx.lineTo(L.tracksX + L.tracksWidth, L.bodyY - 0.5);
    ctx.stroke();
  }

  // Zonas.
  L.zoneLines.forEach((line, i) => {
    let x = L.tracksX;
    const y = L.zoneLegendY + i * LINE_ZONES + 8;
    for (const z of line) {
      ctx.fillStyle = z.color;
      ctx.fillRect(x, y - 5, 10, 10);
      ctx.strokeStyle = th.viewer.trackBorder;
      ctx.lineWidth = 0.75;
      ctx.strokeRect(x + 0.5, y - 4.5, 9, 9);
      ctx.fillStyle = th.color.text;
      ctx.font = font(BASE_TOKENS.text.xs);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(zoneText(z), x + 14, y);
      x += zoneWidth(measure, z) + 16;
    }
  });

  drawSummary(ctx, input, L);

  if (parts.credits) {
    ctx.strokeStyle = th.viewer.trackBorder;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(L.tracksX, L.footerY - 4.5);
    ctx.lineTo(L.tracksX + L.tracksWidth, L.footerY - 4.5);
    ctx.stroke();
    ctx.fillStyle = th.color.textMuted;
    ctx.font = font(10);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(fitText(measure, font(10), input.credits, L.tracksWidth * 0.62), L.tracksX, L.footerY);
    ctx.textAlign = 'right';
    ctx.fillText(input.scaleText, L.tracksX + L.tracksWidth, L.footerY);
  }
  ctx.restore();
}
