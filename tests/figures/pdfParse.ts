/**
 * Lector mínimo de PDF para los tests: valida cabecera, `startxref`, tabla `xref` (cada desplazamiento tiene que caer en
 * «N 0 obj»), `trailer`, y recorre Catálogo → Páginas → Página → Contenido/Recursos. Solo entiende lo que escribe
 * `src/io/export/figures/pdf.ts` (diccionarios planos, flujos con /Length directo).
 */
import { unzlibSync } from 'fflate';

export interface PdfObject {
  num: number;
  dict: string;
  stream?: Uint8Array;
}

export interface ParsedPage {
  mediaBox: number[];
  content: string;
  /** Cadenas de los `Tj`, ya sin escapes y en Unicode (WinAnsi → –, —, •). */
  texts: string[];
  fonts: string[];
  images: { name: string; width: number; height: number; rgb: Uint8Array }[];
}

export interface ParsedPdf {
  version: string;
  size: number;
  info: string;
  objects: Map<number, PdfObject>;
  pages: ParsedPage[];
  /** Texto de la tabla xref y desplazamientos leídos. */
  offsets: number[];
}

const latin1 = (b: Uint8Array, start = 0, end = b.length) => {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i]!);
  return s;
};

/** Cadenas literales de los operadores `Tj`: quita escapes `\( \) \\ \ddd` y pasa WinAnsi a Unicode. */
function tjTexts(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/\(((?:\\.|\\[0-7]{3}|[^\\)])*)\) Tj/g)) {
    const raw = m[1]!.replace(/\\([0-7]{3})|\\(.)/g, (_, oct: string | undefined, ch: string | undefined) => {
      if (oct) {
        const b = parseInt(oct, 8);
        return b === 0x96 ? '–' : b === 0x97 ? '—' : b === 0x95 ? '•' : String.fromCharCode(b);
      }
      return ch!;
    });
    out.push(raw);
  }
  return out;
}

export function parsePdf(bytes: Uint8Array): ParsedPdf {
  const text = latin1(bytes);
  const header = /^%PDF-(\d\.\d)\n/.exec(text);
  if (!header) throw new Error('Sin cabecera %PDF-.');
  if (!text.endsWith('%%EOF\n')) throw new Error('El archivo no termina en %%EOF.');
  const sx = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
  if (!sx) throw new Error('Sin startxref.');
  const xrefAt = Number(sx[1]);
  if (text.slice(xrefAt, xrefAt + 5) !== 'xref\n') throw new Error(`startxref (${xrefAt}) no apunta a «xref».`);
  const xm = /^xref\n0 (\d+)\n/.exec(text.slice(xrefAt));
  if (!xm) throw new Error('Tabla xref mal formada.');
  const count = Number(xm[1]);
  const tableStart = xrefAt + xm[0].length;
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const line = text.slice(tableStart + i * 20, tableStart + (i + 1) * 20);
    const m = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(line);
    if (!m) throw new Error(`Entrada xref ${i} mal formada: ${JSON.stringify(line)}.`);
    if (i === 0) {
      if (m[3] !== 'f') throw new Error('La entrada 0 tiene que ser libre.');
      continue;
    }
    offsets.push(Number(m[1]));
  }
  const trailer = /trailer\n<< \/Size (\d+) \/Root (\d+) 0 R(?: \/Info (\d+) 0 R)? >>/.exec(text.slice(tableStart + count * 20));
  if (!trailer) throw new Error('Trailer mal formado.');
  if (Number(trailer[1]) !== count) throw new Error('/Size no coincide con la tabla xref.');

  const objects = new Map<number, PdfObject>();
  offsets.forEach((off, i) => {
    const num = i + 1;
    const head = `${num} 0 obj\n`;
    if (text.slice(off, off + head.length) !== head) throw new Error(`El objeto ${num} no está en su desplazamiento (${off}).`);
    const bodyStart = off + head.length;
    const streamAt = text.indexOf('\nstream\n', bodyStart);
    const endobj = text.indexOf('\nendobj\n', bodyStart);
    if (endobj < 0) throw new Error(`Objeto ${num} sin endobj.`);
    if (streamAt >= 0 && streamAt < endobj) {
      const dict = text.slice(bodyStart, streamAt);
      const len = Number(/\/Length (\d+)/.exec(dict)?.[1]);
      const dataStart = streamAt + '\nstream\n'.length;
      if (text.slice(dataStart + len, dataStart + len + '\nendstream\nendobj\n'.length) !== '\nendstream\nendobj\n') throw new Error(`/Length del objeto ${num} no coincide con el flujo.`);
      objects.set(num, { num, dict, stream: bytes.subarray(dataStart, dataStart + len) });
    } else objects.set(num, { num, dict: text.slice(bodyStart, endobj) });
  });

  const root = objects.get(Number(trailer[2]));
  if (!root || !/\/Type \/Catalog/.test(root.dict)) throw new Error('El catálogo no es un /Catalog.');
  const pagesObj = objects.get(Number(/\/Pages (\d+) 0 R/.exec(root.dict)![1]));
  if (!pagesObj || !/\/Type \/Pages/.test(pagesObj.dict)) throw new Error('Falta el árbol de páginas.');
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(pagesObj.dict)?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  if (Number(/\/Count (\d+)/.exec(pagesObj.dict)![1]) !== kids.length) throw new Error('/Count no coincide con /Kids.');
  const pages: ParsedPage[] = kids.map((id) => {
    const page = objects.get(id)!;
    if (!/\/Type \/Page\b/.test(page.dict)) throw new Error(`El objeto ${id} no es una página.`);
    const box = /\/MediaBox \[([^\]]+)\]/.exec(page.dict)![1]!.split(' ').map(Number);
    const contents = objects.get(Number(/\/Contents (\d+) 0 R/.exec(page.dict)![1]))!;
    if (!contents.stream || !/\/Filter \/FlateDecode/.test(contents.dict)) throw new Error('El contenido no es un flujo Flate.');
    const content = latin1(unzlibSync(contents.stream));
    const fonts = [...page.dict.matchAll(/\/(F\d) (\d+) 0 R/g)].map((m) => objects.get(Number(m[2]))!.dict.match(/\/BaseFont \/([\w-]+)/)![1]!);
    const xo = /\/XObject << ([^>]*) >>/.exec(page.dict)?.[1] ?? '';
    const images = [...xo.matchAll(/\/(\w+) (\d+) 0 R/g)].map((m) => {
      const o = objects.get(Number(m[2]))!;
      const w = Number(/\/Width (\d+)/.exec(o.dict)![1]);
      const h = Number(/\/Height (\d+)/.exec(o.dict)![1]);
      if (!/\/Subtype \/Image/.test(o.dict) || !/\/ColorSpace \/DeviceRGB/.test(o.dict) || !/\/BitsPerComponent 8/.test(o.dict)) throw new Error('Imagen mal declarada.');
      return { name: m[1]!, width: w, height: h, rgb: unzlibSync(o.stream!) };
    });
    return { mediaBox: box, content, texts: tjTexts(content), fonts, images };
  });
  return { version: header[1]!, size: count, info: objects.get(Number(trailer[3]))?.dict ?? '', objects, pages, offsets };
}
