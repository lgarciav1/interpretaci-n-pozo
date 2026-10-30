/** Codificación binaria compartida por los formatos legados y v7. */
import { ArchiveLimitError, DecodeBudget } from './limits';
export type ArrayCodec = 'f64le-b64' | 'f64le-deflate-b64' | 'f64le-shuffle-deflate-b64';
/** 'auto' = la variante comprimida más chica para cada array. */
export type CodecChoice = ArrayCodec | 'auto';

export interface EncodedArray {
  codec: ArrayCodec;
  length: number;
  data: string;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function float64Bytes(values: Float64Array): Uint8Array {
  if (!LITTLE_ENDIAN) {
    const input = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    const out = new Uint8Array(values.byteLength);
    for (let i = 0; i < out.length; i += 8) for (let k = 0; k < 8; k++) out[i + k] = input[i + 7 - k]!;
    return out;
  }
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength).slice();
}

export function float64FromBytes(bytes: Uint8Array, length: number): Float64Array {
  if (bytes.length !== length * 8) throw new Error(`Array corrupto: se esperaban ${length * 8} bytes y hay ${bytes.length}.`);
  const out = new Float64Array(length);
  const target = new Uint8Array(out.buffer);
  // Copiar los bytes evita canonicalizar payloads NaN al pasar por números de JS.
  if (LITTLE_ENDIAN) target.set(bytes);
  else for (let i = 0; i < bytes.length; i += 8) for (let k = 0; k < 8; k++) target[i + k] = bytes[i + 7 - k]!;
  return out;
}

/** Byte shuffle: agrupa el byte k de todos los valores (mejora mucho la compresión de floats). */
function shuffle(bytes: Uint8Array, width: number): Uint8Array {
  const n = bytes.length / width;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < n; i++) for (let k = 0; k < width; k++) out[k * n + i] = bytes[i * width + k]!;
  return out;
}

function unshuffle(bytes: Uint8Array, width: number): Uint8Array {
  const n = bytes.length / width;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < n; i++) for (let k = 0; k < width; k++) out[i * width + k] = bytes[k * n + i]!;
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit?: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (limit !== undefined && total > limit) {
        void reader.cancel().catch(() => {});
        throw new ArchiveLimitError('La descompresión supera el límite declarado del array.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

export function compressionAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export async function encodeArray(values: Float64Array, choice: CodecChoice = defaultCodec()): Promise<EncodedArray> {
  const bytes = float64Bytes(values);
  const length = values.length;
  if (choice === 'f64le-b64') return { codec: choice, length, data: toBase64(bytes) };
  const deflate = (b: Uint8Array) => pipeThrough(b, new CompressionStream('deflate'));
  if (choice === 'f64le-deflate-b64') return { codec: choice, length, data: toBase64(await deflate(bytes)) };
  if (choice === 'f64le-shuffle-deflate-b64') return { codec: choice, length, data: toBase64(await deflate(shuffle(bytes, 8))) };
  const [plain, shuffled] = await Promise.all([deflate(bytes), deflate(shuffle(bytes, 8))]);
  return shuffled.length < plain.length
    ? { codec: 'f64le-shuffle-deflate-b64', length, data: toBase64(shuffled) }
    : { codec: 'f64le-deflate-b64', length, data: toBase64(plain) };
}

export async function decodeArray(enc: EncodedArray, budget = new DecodeBudget()): Promise<Float64Array> {
  if (!enc || typeof enc !== 'object' || typeof enc.data !== 'string') throw new Error('Descriptor de array inválido.');
  const limit = budget.reserve(enc.length);
  if (enc.data.length > budget.limits.fileBytes) throw new ArchiveLimitError('El array codificado supera el límite de archivo.');
  const raw = fromBase64(enc.data);
  switch (enc.codec) {
    case 'f64le-b64':
      return float64FromBytes(raw, enc.length);
    case 'f64le-deflate-b64':
    case 'f64le-shuffle-deflate-b64': {
      if (!compressionAvailable()) throw new Error('Este navegador no puede descomprimir el proyecto (falta DecompressionStream).');
      const bytes = await pipeThrough(raw, new DecompressionStream('deflate'), limit);
      return float64FromBytes(enc.codec === 'f64le-deflate-b64' ? bytes : unshuffle(bytes, 8), enc.length);
    }
    default:
      throw new Error(`Codificación de array desconocida: '${(enc as { codec: string }).codec}'.`);
  }
}

export function defaultCodec(): CodecChoice {
  return compressionAvailable() ? 'auto' : 'f64le-b64';
}

