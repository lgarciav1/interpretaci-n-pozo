/**
 * Escritor de PDF mínimo (PDF 1.4) sobre `fflate`: páginas con texto (Helvetica, codificación WinAnsi), líneas,
 * rectángulos e imágenes RGB incrustadas (FlateDecode). Sin dependencias nuevas. Puro: corre en Node y en el navegador.
 * docs/decisiones/0012-exportacion-de-figuras.md.
 *
 * Estructura: cabecera, objetos numerados, tabla `xref` con los desplazamientos exactos en bytes, `trailer` y `startxref`.
 * Coordenadas del usuario: puntos (1/72 in) desde la esquina SUPERIOR izquierda; se convierten al sistema del PDF.
 */
import { zlibSync } from 'fflate';

export interface PdfImage {
  /** Píxeles. */
  width: number;
  height: number;
  /** RGB de 8 bits por canal, fila a fila desde arriba (`width * height * 3` bytes). */
  rgb: Uint8Array;
}

export type PdfColor = readonly [number, number, number];

export type PdfItem =
  | { type: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; color?: PdfColor; align?: 'left' | 'center' | 'right' }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; width?: number; color?: PdfColor }
  | { type: 'rect'; x: number; y: number; w: number; h: number; fill?: PdfColor; stroke?: PdfColor; strokeWidth?: number }
  | { type: 'image'; x: number; y: number; w: number; h: number; image: PdfImage };

export interface PdfPage {
  /** Puntos. */
  width: number;
  height: number;
  items: PdfItem[];
}

export interface PdfDocument {
  pages: PdfPage[];
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  /** Fecha de creación (por defecto, ahora). */
  created?: Date;
}

/** Anchos de Helvetica (milésimas de em) para los caracteres ASCII imprimibles, desde el espacio. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778,
  722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Ancho de `text` en puntos (Helvetica; las negritas se aproximan un 5 % más anchas). */
export function pdfTextWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of toWinAnsi(text)) {
    const code = ch.charCodeAt(0);
    w += code >= 32 && code <= 126 ? HELVETICA[code - 32]! : 556;
  }
  return ((w * size) / 1000) * (bold ? 1.05 : 1);
}

/** Caracteres fuera de WinAnsi (φ, Ω, subíndices…) a su equivalente más cercano o «?». Conserva tildes, ñ, ·, – y —. */
const REPLACEMENTS: Record<string, string> = { '\u2212': '-', '\u2011': '-', '\u2019': "'", '\u2018': "'", '\u201c': '"', '\u201d': '"', '\u2026': '...', '\u2264': '<=', '\u2265': '>=', '\u03c6': 'phi', '\u03a6': 'PHI', '\u03a9': 'ohm', '\u0394': 'D', '\u03bc': 'u', '\u202f': ' ', '\u2009': ' ' };
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 0xa0 && code <= 0xff) out += ch; // Latin-1 coincide con WinAnsi en esa franja
    else if (ch === '–' || ch === '—' || ch === '•') out += ch;
    else out += '?';
  }
  return out;
}

/** Bytes WinAnsi de un texto ya saneado. */
function winAnsiBytes(text: string): number[] {
  const special: Record<string, number> = { '–': 0x96, '—': 0x97, '•': 0x95 };
  return [...text].map((ch) => special[ch] ?? ch.charCodeAt(0));
}

const enc = new TextEncoder();
const ascii = (s: string) => enc.encode(s);

/** Cadena literal de PDF con escapes, a partir de bytes. */
function literal(bytes: number[]): string {
  let s = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += `\\${String.fromCharCode(b)}`;
    else if (b < 32 || b > 126) s += `\\${b.toString(8).padStart(3, '0')}`;
    else s += String.fromCharCode(b);
  }
  return `${s})`;
}

/** Cadena de texto Unicode para el diccionario Info (UTF-16BE con BOM, en hexadecimal). */
function unicodeString(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

const n = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '0');
const rgb = (c: PdfColor) => `${n(c[0])} ${n(c[1])} ${n(c[2])}`;

const pdfDate = (d: Date) => `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;

interface Obj {
  /** Texto del diccionario (sin `obj`/`endobj`) y, si es un flujo, sus bytes. */
  dict: string;
  stream?: Uint8Array;
}

/** Escribe el documento. Devuelve los bytes del archivo. */
export function writePdf(doc: PdfDocument): Uint8Array {
  if (doc.pages.length === 0) throw new Error('Un PDF necesita al menos una página.');
  const objs: Obj[] = [];
  const add = (o: Obj): number => objs.push(o);
  // Reserva de números fijos: 1 = catálogo, 2 = páginas, 3 = Helvetica, 4 = Helvetica-Bold, 5 = Info; el resto, dinámico.
  add({ dict: '' }); // 1 (se completa abajo)
  add({ dict: '' }); // 2
  add({ dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' }); // 3
  add({ dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>' }); // 4
  const created = doc.created ?? new Date();
  const info = [
    doc.title ? `/Title ${unicodeString(doc.title)}` : '',
    doc.author ? `/Author ${unicodeString(doc.author)}` : '',
    doc.subject ? `/Subject ${unicodeString(doc.subject)}` : '',
    `/Creator ${unicodeString(doc.creator ?? 'Interpretación de pozo')}`,
    `/CreationDate (${pdfDate(created)})`,
  ].join(' ');
  add({ dict: `<< ${info} >>` }); // 5

  const pageIds: number[] = [];
  for (const page of doc.pages) {
    const images: { name: string; id: number }[] = [];
    let content = '';
    for (const it of page.items) {
      if (it.type === 'text') {
        const t = toWinAnsi(it.text);
        const w = pdfTextWidth(t, it.size, it.bold);
        const x = it.align === 'right' ? it.x - w : it.align === 'center' ? it.x - w / 2 : it.x;
        content += `BT /${it.bold ? 'F2' : 'F1'} ${n(it.size)} Tf ${rgb(it.color ?? [0, 0, 0])} rg ${n(x)} ${n(page.height - it.y)} Td ${literal(winAnsiBytes(t))} Tj ET\n`;
      } else if (it.type === 'line') {
        content += `q ${n(it.width ?? 0.5)} w ${rgb(it.color ?? [0, 0, 0])} RG ${n(it.x1)} ${n(page.height - it.y1)} m ${n(it.x2)} ${n(page.height - it.y2)} l S Q\n`;
      } else if (it.type === 'rect') {
        const paint = it.fill && it.stroke ? 'B' : it.fill ? 'f' : 'S';
        content += `q ${it.fill ? `${rgb(it.fill)} rg ` : ''}${it.stroke || !it.fill ? `${rgb(it.stroke ?? [0, 0, 0])} RG ${n(it.strokeWidth ?? 0.5)} w ` : ''}${n(it.x)} ${n(page.height - it.y - it.h)} ${n(it.w)} ${n(it.h)} re ${paint} Q\n`;
      } else {
        const img = it.image;
        if (img.rgb.length !== img.width * img.height * 3) throw new Error('La imagen no tiene width·height·3 bytes.');
        const id = add({
          dict: `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
          stream: zlibSync(img.rgb, { level: 6 }),
        });
        const name = `Im${images.length + 1}`;
        images.push({ name, id });
        content += `q ${n(it.w)} 0 0 ${n(it.h)} ${n(it.x)} ${n(page.height - it.y - it.h)} cm /${name} Do Q\n`;
      }
    }
    const contentId = add({ dict: '<<', stream: zlibSync(ascii(content), { level: 6 }) });
    // El diccionario de flujo se completa con /Filter y /Length al serializar (ver abajo).
    objs[contentId - 1]!.dict = '<< /Filter /FlateDecode';
    const xobjects = images.length ? ` /XObject << ${images.map((i) => `/${i.name} ${i.id} 0 R`).join(' ')} >>` : '';
    const pageId = add({
      dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects} >> >>`,
    });
    pageIds.push(pageId);
  }
  objs[0]!.dict = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1]!.dict = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  // Serialización con los desplazamientos exactos.
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (b: Uint8Array) => {
    chunks.push(b);
    offset += b.length;
  };
  push(ascii('%PDF-1.4\n'));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // comentario binario: marca el archivo como binario
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(offset);
    if (o.stream) {
      push(ascii(`${i + 1} 0 obj\n${o.dict} /Length ${o.stream.length} >>\nstream\n`));
      push(o.stream);
      push(ascii('\nendstream\nendobj\n'));
    } else push(ascii(`${i + 1} 0 obj\n${o.dict}\nendobj\n`));
  });
  const xref = offset;
  let table = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) table += `${String(o).padStart(10, '0')} 00000 n \n`;
  table += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(ascii(table));
  const out = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** RGBA (ImageData) → RGB, mezclando con blanco lo que sea translúcido. */
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
    const a = rgba[i + 3]! / 255;
    out[j] = Math.round(rgba[i]! * a + 255 * (1 - a));
    out[j + 1] = Math.round(rgba[i + 1]! * a + 255 * (1 - a));
    out[j + 2] = Math.round(rgba[i + 2]! * a + 255 * (1 - a));
  }
  return out;
}
