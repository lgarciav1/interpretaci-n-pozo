/**
 * Figura de un gráfico x–y (crossplot, k–φ, y los que vengan) para el informe: el MISMO dibujo de la pantalla
 * (`drawXYScene`) con título, leyenda (series, tendencias con ecuación y R², barra de color por una tercera curva) y
 * créditos. Puro y con el contexto 2D como parámetro: sirve para el canvas fuera de pantalla (PNG, PDF) y para el
 * grabador de SVG. Siempre con el tema claro. docs/decisiones/0012-exportacion-de-figuras.md.
 */
import type { TextMeasure } from '../../io/export/figures/svg';
import type { FigureParts } from '../../io/export/figures/templates';
import { BASE_TOKENS, THEMES } from '../../ui/tokens';
import { plotRectFor, validAxis, xyMapping } from './axes';
import { drawXYScene, type XYScene } from './draw';
import type { XYFigureSource } from './figures';

const FONT = BASE_TOKENS.font.sans;
const W = BASE_TOKENS.weight;
const font = (size: number, weight: number = W.regular) => `${weight} ${size}px ${FONT}`;
export const XY_FIGURE_THEME = THEMES.light;

/** Barra de color por una tercera curva (o por capa): título, extremos y colores de izquierda a derecha. */
export interface XYColorKey {
  title: string;
  min: number;
  max: number;
  /** Al menos dos colores. */
  colors: readonly string[];
  unit?: string;
}

export interface XYFigureInput {
  source: Pick<XYFigureSource, 'x' | 'y' | 'points' | 'lines' | 'trends' | 'guides'>;
  parts: FigureParts;
  title: string;
  subtitle?: string;
  credits: string;
  scaleText?: string;
  colorKey?: XYColorKey;
  /** Ancho y alto totales (px CSS), con márgenes. */
  width: number;
  height: number;
  margin: number;
  measure: TextMeasure;
}

export interface LegendEntry {
  kind: 'point' | 'line' | 'trend';
  color: string;
  text: string;
  dash?: readonly number[];
}

/** Entradas de la leyenda: capas con nombre y tendencias con su ecuación y R². */
export function xyLegendEntries(src: XYFigureInput['source']): LegendEntry[] {
  const out: LegendEntry[] = [];
  for (const l of src.points) if (l.name) out.push({ kind: 'point', color: typeof l.color === 'string' ? l.color : '#6b737e', text: l.name });
  for (const l of src.lines) if (l.name) out.push({ kind: 'line', color: l.color, text: l.name, ...(l.dash ? { dash: l.dash } : {}) });
  for (const t of src.trends) out.push({ kind: 'trend', color: t.color, text: t.label ? `${t.name ?? 'Tendencia'}: ${t.label[0]} · ${t.label[1]}` : (t.name ?? 'Tendencia') });
  return out;
}

export interface XYFigureLayout {
  width: number;
  height: number;
  titleY: number;
  /** Caja del gráfico (ejes incluidos). */
  plot: { x: number; y: number; width: number; height: number };
  legendY: number;
  legendLines: LegendEntry[][];
  keyY: number;
  footerY: number;
}

const LEGEND_LINE = 20;
const KEY_H = 34;

export function layoutXYFigure(input: XYFigureInput): XYFigureLayout {
  const { parts, margin, measure } = input;
  const inner = Math.max(40, input.width - 2 * margin);
  let y = margin;
  const titleY = y;
  if (parts.title && input.title) y += 22 + (input.subtitle ? 18 : 0) + 8;
  const entries = parts.legend ? xyLegendEntries(input.source) : [];
  const legendLines: LegendEntry[][] = [];
  let cur: LegendEntry[] = [];
  let w = 0;
  for (const e of entries) {
    const ew = 30 + measure(font(BASE_TOKENS.text.xs), e.text);
    if (cur.length && w + ew > inner) {
      legendLines.push(cur);
      cur = [];
      w = 0;
    }
    cur.push(e);
    w += ew + 12;
  }
  if (cur.length) legendLines.push(cur);
  const legendBlock = legendLines.length * LEGEND_LINE;
  const hasKey = parts.legend && !!input.colorKey;
  const keyBlock = hasKey ? 4 + KEY_H : 0;
  const creditsBlock = parts.credits ? 12 + 16 : 0;
  // El gráfico ocupa el alto que queda menos separación, leyenda, barra de color y pie.
  const plotH = Math.max(80, input.height - y - margin - 10 - legendBlock - keyBlock - creditsBlock);
  const plot = { x: margin, y, width: inner, height: plotH };
  const legendY = y + plotH + 10;
  const keyY = legendY + legendBlock + (hasKey ? 4 : 0);
  const footerY = keyY + (hasKey ? KEY_H : 0) + 12;
  return { width: input.width, height: Math.ceil((parts.credits ? footerY + 16 : footerY - 12) + margin), plot, legendY, legendLines, keyY, footerY, titleY };
}

function drawSwatch(ctx: CanvasRenderingContext2D, e: LegendEntry, x: number, y: number): void {
  ctx.save();
  if (e.kind === 'point') {
    ctx.beginPath();
    ctx.arc(x + 11, y, 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = e.color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.25;
    ctx.stroke();
  } else {
    ctx.strokeStyle = e.color;
    ctx.lineWidth = e.kind === 'trend' ? 2 : 1.5;
    ctx.setLineDash(e.dash ? [...e.dash] : []);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 22, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Dibuja la figura en (0, 0), de `layout.width` × `layout.height` px. Un eje inválido deja el cuadro vacío con un aviso. */
export function drawXYFigure(ctx: CanvasRenderingContext2D, input: XYFigureInput, layout: XYFigureLayout = layoutXYFigure(input)): void {
  const th = XY_FIGURE_THEME;
  const { parts } = input;
  const L = layout;
  const left = input.margin;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, L.width, L.height);

  if (parts.title && input.title) {
    ctx.fillStyle = th.color.text;
    ctx.font = font(BASE_TOKENS.text.xl, W.semibold);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(input.title, left, L.titleY);
    if (input.subtitle) {
      ctx.fillStyle = th.color.textMuted;
      ctx.font = font(BASE_TOKENS.text.sm);
      ctx.fillText(input.subtitle, left, L.titleY + 22);
    }
  }

  const { x: xAxis, y: yAxis } = input.source;
  ctx.save();
  ctx.translate(L.plot.x, L.plot.y);
  if (validAxis(xAxis) && validAxis(yAxis)) {
    const scene: XYScene = { points: input.source.points, lines: input.source.lines, trends: input.source.trends, guides: input.source.guides };
    drawXYScene(ctx, xyMapping(xAxis, yAxis, plotRectFor(L.plot.width, L.plot.height, false)), xAxis, yAxis, scene, th, false);
  } else {
    ctx.fillStyle = th.color.textMuted;
    ctx.font = font(BASE_TOKENS.text.sm);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Los ejes del gráfico no son válidos.', L.plot.width / 2, L.plot.height / 2);
  }
  ctx.restore();

  L.legendLines.forEach((line, i) => {
    let x = left;
    const y = L.legendY + i * LEGEND_LINE + 8;
    for (const e of line) {
      drawSwatch(ctx, e, x, y);
      ctx.fillStyle = th.color.text;
      ctx.font = font(BASE_TOKENS.text.xs);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.text, x + 30, y);
      x += 30 + input.measure(font(BASE_TOKENS.text.xs), e.text) + 12;
    }
  });

  const key = parts.legend ? input.colorKey : undefined;
  if (key && key.colors.length >= 2) {
    const kw = Math.min(220, L.plot.width * 0.6);
    const grad = ctx.createLinearGradient(left, 0, left + kw, 0);
    key.colors.forEach((c, i) => grad.addColorStop(i / (key.colors.length - 1), c));
    ctx.fillStyle = th.color.text;
    ctx.font = font(BASE_TOKENS.text.xs, W.medium);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(key.unit ? `${key.title} (${key.unit})` : key.title, left, L.keyY);
    ctx.fillStyle = grad;
    ctx.fillRect(left, L.keyY + 15, kw, 8);
    ctx.strokeStyle = th.viewer.trackBorder;
    ctx.lineWidth = 0.75;
    ctx.strokeRect(left + 0.5, L.keyY + 15.5, kw - 1, 7);
    ctx.fillStyle = th.viewer.axisText;
    ctx.font = font(10);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(String(key.min), left, L.keyY + 25);
    ctx.textAlign = 'right';
    ctx.fillText(String(key.max), left + kw, L.keyY + 25);
  }

  if (parts.credits) {
    ctx.strokeStyle = th.viewer.trackBorder;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(left, L.footerY - 4.5);
    ctx.lineTo(left + L.plot.width, L.footerY - 4.5);
    ctx.stroke();
    ctx.fillStyle = th.color.textMuted;
    ctx.font = font(10);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(input.credits, left, L.footerY);
    if (input.scaleText) {
      ctx.textAlign = 'right';
      ctx.fillText(input.scaleText, left + L.plot.width, L.footerY);
    }
  }
  ctx.restore();
}
