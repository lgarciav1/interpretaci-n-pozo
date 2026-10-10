/** Escritor de PDF (src/io/export/figures/pdf.ts), marco de página, y PNG con resolución: estructura válida y que se lee de vuelta. */
import { describe, expect, it } from 'vitest';
import { crc32, framePdfPage, pageContentBox, pdfTextWidth, readPngDpi, rgbaToRgb, setPngDpi, toWinAnsi, wrapFields, writePdf } from '../../src/io/export/figures';
import { parsePdf } from './pdfParse';
import { tinyPng } from './support';

const rgb2x2 = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
const hexOf = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join('');

describe('writePdf', () => {
  const doc = writePdf({
    title: 'Registros del pozo X',
    created: new Date(Date.UTC(2026, 9, 10, 12, 30, 5)),
    pages: [
      {
        width: 595.28,
        height: 841.89,
        items: [
          { type: 'text', x: 40, y: 50, text: 'Hola (mundo) \\ ñ φ', size: 12, bold: true, color: [1, 0, 0] },
          { type: 'line', x1: 40, y1: 60, x2: 200, y2: 60, width: 1 },
          { type: 'rect', x: 10, y: 10, w: 20, h: 30, fill: [0, 0, 1] },
          { type: 'image', x: 40, y: 100, w: 100, h: 50, image: { width: 2, height: 2, rgb: rgb2x2 } },
        ],
      },
    ],
  });
  const pdf = parsePdf(doc);

  it('cabecera, marca binaria, %%EOF y tabla xref con los desplazamientos exactos', () => {
    expect(pdf.version).toBe('1.4');
    expect(doc[10]!).toBeGreaterThan(127); // comentario binario
    expect(pdf.size).toBe(pdf.objects.size + 1);
    // parsePdf ya verificó que cada desplazamiento cae en «N 0 obj», /Length de cada flujo y startxref.
    expect(pdf.offsets).toEqual([...pdf.offsets].sort((a, b) => a - b));
  });

  it('una página A4 con los recursos y el contenido que se pidió', () => {
    expect(pdf.pages).toHaveLength(1);
    const p = pdf.pages[0]!;
    expect(p.mediaBox).toEqual([0, 0, 595.28, 841.89]);
    expect(p.fonts.sort()).toEqual(['Helvetica', 'Helvetica-Bold']);
    // Texto con escapes de paréntesis y barra; φ no existe en WinAnsi → «phi»; la ñ va como byte 0xF1 (octal 361).
    expect(p.content).toContain('BT /F2 12 Tf 1 0 0 rg 40 791.89 Td (Hola \\(mundo\\) \\\\ \\361 phi) Tj ET');
    // y se invierte: 841.89 − 60 = 781.89
    expect(p.content).toContain('40 781.89 m 200 781.89 l S');
    expect(p.content).toContain('0 0 1 rg 10 801.89 20 30 re f');
    expect(p.content).toContain('q 100 0 0 50 40 691.89 cm /Im1 Do Q');
  });

  it('la imagen incrustada se lee de vuelta idéntica (Flate, RGB de 8 bits)', () => {
    const img = pdf.pages[0]!.images[0]!;
    expect(img).toMatchObject({ name: 'Im1', width: 2, height: 2 });
    expect([...img.rgb]).toEqual([...rgb2x2]);
  });

  it('Info: título en UTF-16 con BOM y fecha', () => {
    expect(pdf.info).toContain(`/Title <FEFF${hexOf('Registros del pozo X')}>`);
    expect(pdf.info).toContain('/CreationDate (D:20261010123005Z)');
  });

  it('varias páginas, cada una con sus imágenes; sin páginas o con una imagen de tamaño incorrecto lanza', () => {
    const two = parsePdf(
      writePdf({
        pages: [
          { width: 100, height: 100, items: [{ type: 'image', x: 0, y: 0, w: 10, h: 10, image: { width: 2, height: 2, rgb: rgb2x2 } }] },
          { width: 200, height: 100, items: [{ type: 'text', x: 5, y: 5, text: 'dos', size: 8 }] },
        ],
      }),
    );
    expect(two.pages.map((p) => p.mediaBox[2])).toEqual([100, 200]);
    expect(two.pages[0]!.images).toHaveLength(1);
    expect(two.pages[1]!.images).toHaveLength(0);
    expect(() => writePdf({ pages: [] })).toThrow(/al menos una página/);
    expect(() => writePdf({ pages: [{ width: 1, height: 1, items: [{ type: 'image', x: 0, y: 0, w: 1, h: 1, image: { width: 2, height: 2, rgb: new Uint8Array(3) } }] }] })).toThrow(/width·height·3/);
  });

  it('un PDF corrompido lo detecta el lector de los tests (xref desplazado)', () => {
    const bad = doc.slice();
    const text = new TextDecoder('latin1').decode(bad);
    const at = text.indexOf('1 0 obj');
    bad[at] = '9'.charCodeAt(0);
    expect(() => parsePdf(bad)).toThrow(/desplazamiento/);
  });
});

describe('texto en PDF', () => {
  it('anchos de Helvetica (milésimas de em) y negrita', () => {
    expect(pdfTextWidth('Hola', 10)).toBeCloseTo((722 + 556 + 222 + 556) / 100, 6);
    expect(pdfTextWidth('Hola', 10, true)).toBeCloseTo(((722 + 556 + 222 + 556) / 100) * 1.05, 6);
    expect(pdfTextWidth('ñ', 10)).toBeCloseTo(pdfTextWidth('n', 10), 6);
  });
  it('toWinAnsi conserva tildes, ñ, · y guiones; reemplaza lo que no existe', () => {
    expect(toWinAnsi('Perfil · Zona C – 7 906 m ¿qué? ñandú')).toBe('Perfil · Zona C – 7 906 m ¿qué? ñandú');
    expect(toWinAnsi('φ ≥ 0,2 Ω·m … 日')).toBe('phi >= 0,2 ohm·m ... ?');
  });
  it('rgbaToRgb mezcla con blanco lo translúcido', () => {
    expect([...rgbaToRgb(Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 0, 100, 100, 100, 128]), 3, 1)]).toEqual([0, 0, 0, 255, 255, 255, 177, 177, 177]);
  });
});

describe('marco de la página', () => {
  it('A4 vertical con margen de 12 mm: la caja de la figura queda dentro, bajo el encabezado y sobre el pie', () => {
    const f = framePdfPage({ title: 'Registros del pozo X', subtitle: '7633–8519 m · escala 1:3.500', fields: ['Yacimiento: A', 'Compañía: B'], credits: 'Pozo X · 10/10/2026', scaleText: 'Escala vertical 1:3.500' }, 'a4', 'portrait', 12);
    const box = pageContentBox('a4', 'portrait', 12);
    expect(f.width).toBeCloseTo(595.28, 1);
    expect(f.height).toBeCloseTo(841.89, 1);
    expect(f.figure.x).toBeCloseTo(box.x, 6);
    expect(f.figure.width).toBeCloseTo(box.width, 6);
    expect(f.figure.y).toBeGreaterThan(box.y + 30);
    expect(f.figure.y + f.figure.height).toBeLessThan(box.y + box.height - 10);
    const texts = f.items.filter((i) => i.type === 'text').map((i) => (i.type === 'text' ? i.text : ''));
    expect(texts).toEqual(['Registros del pozo X', '7633–8519 m · escala 1:3.500', 'Yacimiento: A   Compañía: B', 'Pozo X · 10/10/2026', 'Escala vertical 1:3.500']);
  });
  it('los datos del pozo se acomodan en renglones del ancho disponible', () => {
    const fields = Array.from({ length: 12 }, (_, i) => `Campo ${i}: valor largo ${i}`);
    const lines = wrapFields(fields, 300);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(pdfTextWidth(l, 8)).toBeLessThanOrEqual(300 + 1);
    expect(lines.join('   ').split('   ')).toEqual(fields);
  });
  it('horizontal: la figura es más ancha que alta', () => {
    const f = framePdfPage({ title: 't', fields: [], credits: 'c' }, 'a4', 'landscape', 15);
    expect(f.width).toBeGreaterThan(f.height);
    expect(f.figure.width).toBeGreaterThan(f.figure.height);
  });
});

const chunkTypes = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: string[] = [];
  for (let at = 8; at < png.length; ) {
    const len = v.getUint32(at);
    out.push(String.fromCharCode(...png.subarray(at + 4, at + 8)));
    expect(v.getUint32(at + 8 + len)).toBe(crc32(png, at + 4, at + 8 + len)); // cada CRC es válido
    at += 12 + len;
  }
  return out;
};

describe('PNG con resolución física (pHYs)', () => {
  it('crc32 de referencia: «123456789» = 0xCBF43926', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('inserta pHYs después de IHDR, con CRC válido, y se lee de vuelta', () => {
    const png = tinyPng();
    expect(readPngDpi(png)).toBeNull();
    const out = setPngDpi(png, 300);
    expect(chunkTypes(out)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect(readPngDpi(out)).toBe(300);
    // 300 ppp = 11 811 píxeles por metro
    expect(new DataView(out.buffer).getUint32(33 + 8)).toBe(11811);
  });
  it('es idempotente (reemplaza el pHYs anterior) y rechaza lo que no es PNG', () => {
    const once = setPngDpi(tinyPng(), 150);
    const twice = setPngDpi(once, 600);
    expect(chunkTypes(twice)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect(readPngDpi(twice)).toBe(600);
    expect(() => setPngDpi(new Uint8Array(50), 300)).toThrow(/no es un PNG/);
  });
});
