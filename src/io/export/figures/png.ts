/**
 * Resolución física de un PNG: el navegador no escribe el chunk `pHYs`, así que un PNG de 300 ppp se abre en Word o en
 * un programa de maquetación como de 96 ppp (¡tres veces más grande!). `setPngDpi` lo inserta sin recodificar la imagen.
 * Puro.
 */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let table: Uint32Array | null = null;
/** CRC-32 (el de los chunks PNG y zip). */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = table[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Devuelve el PNG con la resolución `dpi` declarada (reemplaza un `pHYs` previo). Lanza si no es un PNG. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (png.length < 33 || SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('El archivo no es un PNG.');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unidad: metro
  cv.setUint32(17, crc32(chunk, 4, 17));
  // Se copian los chunks salvo un pHYs que ya hubiera; el nuevo va después de IHDR (que es el primero y mide 25 bytes).
  const parts: Uint8Array[] = [png.subarray(0, 33), chunk];
  let at = 33;
  while (at + 12 <= png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    const end = at + 12 + len;
    if (end > png.length) throw new Error('PNG truncado.');
    if (type !== 'pHYs') parts.push(png.subarray(at, end));
    at = end;
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** ppp declarados en el `pHYs` de un PNG (null si no hay). */
export function readPngDpi(png: Uint8Array): number | null {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  while (at + 12 <= png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    if (type === 'pHYs' && png[at + 16] === 1) return Math.round(view.getUint32(at + 8) * 0.0254);
    at += 12 + len;
  }
  return null;
}
