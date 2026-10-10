/**
 * Marco de una página de PDF para una figura: título, subtítulo y datos del pozo arriba (texto real, seleccionable),
 * pie con créditos y escala abajo, y la caja que queda para la figura. Puro. docs/decisiones/0012-exportacion-de-figuras.md.
 */
import { pdfTextWidth, type PdfColor, type PdfItem } from './pdf';
import { mmToPt, pageSizePt, type Box, type Orientation, type PageSize } from './sizing';

export interface PdfPageMeta {
  title: string;
  subtitle?: string;
  /** «Yacimiento: Cerro Dragón», uno por elemento; se acomodan en líneas. */
  fields: readonly string[];
  credits: string;
  scaleText?: string;
}

const INK: PdfColor = [0.08, 0.09, 0.11];
const MUTED: PdfColor = [0.35, 0.39, 0.43];
const RULE: PdfColor = [0.8, 0.82, 0.85];
const TITLE = 14;
const SUB = 9;
const FIELD = 8;
const LINE = 11;
const FOOT = 8;
const GAP = 8;

/** Pone los elementos en renglones de ancho `max` (pt). */
export function wrapFields(fields: readonly string[], max: number, size = FIELD): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const f of fields) {
    const next = cur ? `${cur}   ${f}` : f;
    if (cur && pdfTextWidth(next, size) > max) {
      lines.push(cur);
      cur = f;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Recorta con «…» hasta que entre en `max` pt. */
function clip(text: string, max: number, size: number, bold = false): string {
  if (pdfTextWidth(text, size, bold) <= max) return text;
  let t = text;
  while (t.length > 1 && pdfTextWidth(`${t}…`, size, bold) > max) t = t.slice(0, -1);
  return `${t}…`;
}

export interface FramedPage {
  width: number;
  height: number;
  items: PdfItem[];
  /** Lo que queda para la figura (pt). */
  figure: Box;
}

export function framePdfPage(meta: PdfPageMeta, size: PageSize, orientation: Orientation, marginMm: number): FramedPage {
  const { width, height } = pageSizePt(size, orientation);
  const m = mmToPt(marginMm);
  const inner = width - 2 * m;
  const items: PdfItem[] = [];
  let y = m + TITLE;
  items.push({ type: 'text', x: m, y, text: clip(meta.title, inner, TITLE, true), size: TITLE, bold: true, color: INK });
  if (meta.subtitle) {
    y += SUB + 5;
    items.push({ type: 'text', x: m, y, text: clip(meta.subtitle, inner, SUB), size: SUB, color: MUTED });
  }
  for (const line of wrapFields(meta.fields, inner)) {
    y += LINE;
    items.push({ type: 'text', x: m, y, text: line, size: FIELD, color: INK });
  }
  y += 5;
  items.push({ type: 'line', x1: m, y1: y, x2: m + inner, y2: y, width: 0.5, color: RULE });
  const figureTop = y + GAP;
  const footY = height - m;
  items.push({ type: 'line', x1: m, y1: footY - FOOT - 4, x2: m + inner, y2: footY - FOOT - 4, width: 0.5, color: RULE });
  items.push({ type: 'text', x: m, y: footY, text: clip(meta.credits, inner * 0.65, FOOT), size: FOOT, color: MUTED });
  if (meta.scaleText) items.push({ type: 'text', x: m + inner, y: footY, text: meta.scaleText, size: FOOT, color: MUTED, align: 'right' });
  const figureBottom = footY - FOOT - 4 - GAP;
  return { width, height, items, figure: { x: m, y: figureTop, width: inner, height: Math.max(0, figureBottom - figureTop) } };
}
