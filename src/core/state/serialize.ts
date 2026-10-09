/**
 * Guardar / abrir proyecto.
 *
 * Formato: JSON con `format` y `version` (para migraciones). Los arrays (profundidad y curvas) se codifican como
 * Float64 little-endian → deflate (CompressionStream nativo) → base64, exacto bit a bit (incluye NaN).
 * Por array se prueba también con "byte shuffle" antes del deflate y se queda la variante más chica: el shuffle
 * gana en series suaves (profundidad: 7×) y pierde en perfiles con valores decimales redondeados (GR, RHOB...),
 * donde el deflate directo deja el pozo del TP en ~40 % del binario.
 * Si el entorno no tiene CompressionStream se usa 'f64le-b64' (sin compresión). Todas se leen siempre.
 */
import type { Interpretation } from '../interpretation';
import { createWell, type Curve, type Well } from '../well';
import { emptyProgress, type FlowProgress, type Project, type Snapshot } from './project';

export const PROJECT_FORMAT = 'pozo-proyecto';
/**
 * Historial del formato:
 * - v1 (fase 1): pozos, interpretación y snapshots.
 * - v2 (fase 3): `progress` por pozo (marcas del flujo guiado). Migración: v1 → progreso vacío.
 */
export const PROJECT_VERSION = 2;

export type ArrayCodec = 'f64le-b64' | 'f64le-deflate-b64' | 'f64le-shuffle-deflate-b64';
/** 'auto' = la variante comprimida más chica para cada array. */
export type CodecChoice = ArrayCodec | 'auto';

export interface EncodedArray {
  codec: ArrayCodec;
  length: number;
  data: string;
}

interface SavedCurve extends Omit<Curve, 'data'> {
  data: EncodedArray;
}

interface SavedWell extends Omit<Well, 'depth' | 'curves'> {
  depth: { unit: 'm'; sourceUnit?: string; values: EncodedArray };
  curves: SavedCurve[];
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
  project: {
    name: string;
    activeWellId: string | null;
    wells: { well: SavedWell; interpretation: Interpretation; progress: FlowProgress }[];
    snapshots: Snapshot[];
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Codificación de arrays

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function toBytes(values: Float64Array): Uint8Array {
  if (!LITTLE_ENDIAN) {
    const out = new Uint8Array(values.length * 8);
    const view = new DataView(out.buffer);
    values.forEach((v, i) => view.setFloat64(i * 8, v, true));
    return out;
  }
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength).slice();
}

function fromBytes(bytes: Uint8Array, length: number): Float64Array {
  if (bytes.length !== length * 8) throw new Error(`Array corrupto: se esperaban ${length * 8} bytes y hay ${bytes.length}.`);
  const out = new Float64Array(length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < length; i++) out[i] = view.getFloat64(i * 8, true);
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

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart]);
  const buffer = await new Response(blob.stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buffer);
}

export function compressionAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export async function encodeArray(values: Float64Array, choice: CodecChoice = defaultCodec()): Promise<EncodedArray> {
  const bytes = toBytes(values);
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

export async function decodeArray(enc: EncodedArray): Promise<Float64Array> {
  const raw = fromBase64(enc.data);
  switch (enc.codec) {
    case 'f64le-b64':
      return fromBytes(raw, enc.length);
    case 'f64le-deflate-b64':
    case 'f64le-shuffle-deflate-b64': {
      if (!compressionAvailable()) throw new Error('Este navegador no puede descomprimir el proyecto (falta DecompressionStream).');
      const bytes = await pipeThrough(raw, new DecompressionStream('deflate'));
      return fromBytes(enc.codec === 'f64le-deflate-b64' ? bytes : unshuffle(bytes, 8), enc.length);
    }
    default:
      throw new Error(`Codificación de array desconocida: '${(enc as { codec: string }).codec}'.`);
  }
}

function defaultCodec(): CodecChoice {
  return compressionAvailable() ? 'auto' : 'f64le-b64';
}

// ---------------------------------------------------------------------------------------------------------------
// Proyecto

export async function serializeProject(project: Project, opts: { codec?: CodecChoice; savedAt?: string } = {}): Promise<string> {
  const codec = opts.codec ?? defaultCodec();
  const wells = await Promise.all(
    project.wells.map(async ({ well, interpretation, progress }) => {
      const saved: SavedWell = {
        id: well.id,
        name: well.name,
        header: well.header,
        depth: {
          unit: 'm',
          ...(well.depth.sourceUnit ? { sourceUnit: well.depth.sourceUnit } : {}),
          values: await encodeArray(well.depth.values, codec),
        },
        curves: await Promise.all(well.curves.map(async (c) => ({ ...c, data: await encodeArray(c.data, codec) }))),
      };
      return { well: saved, interpretation, progress };
    }),
  );
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: opts.savedAt ?? new Date().toISOString(),
    project: { name: project.name, activeWellId: project.activeWellId, wells, snapshots: project.snapshots },
  };
  return JSON.stringify(file);
}

/** Migra archivos de versiones anteriores a la actual, de a una versión por vez. */
function migrate(file: ProjectFile): ProjectFile {
  if (file.version > PROJECT_VERSION) {
    throw new Error(`El proyecto es de una versión más nueva de la app (v${file.version}); actualizá la app para abrirlo.`);
  }
  let f = file;
  if (f.version < 2) {
    // v1 → v2: progreso del flujo guiado vacío.
    f = { ...f, version: 2, project: { ...f.project, wells: (f.project.wells ?? []).map((w) => ({ ...w, progress: emptyProgress() })) } };
  }
  return f;
}

export async function deserializeProject(text: string): Promise<Project> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un proyecto válido (no es JSON).');
  }
  const file = parsed as ProjectFile;
  if (!file || file.format !== PROJECT_FORMAT || typeof file.version !== 'number' || !file.project) {
    throw new Error('El archivo no es un proyecto de esta app.');
  }
  const { project } = migrate(file);
  const wells = await Promise.all(
    project.wells.map(async ({ well, interpretation, progress }) => {
      const depth = await decodeArray(well.depth.values);
      const curves: Curve[] = await Promise.all(well.curves.map(async (c) => ({ ...c, data: await decodeArray(c.data) })));
      const restored = createWell({
        id: well.id,
        name: well.name,
        header: well.header,
        depth,
        ...(well.depth.sourceUnit ? { depthSourceUnit: well.depth.sourceUnit } : {}),
        curves,
      });
      return { well: restored, interpretation, progress: progress ?? emptyProgress() };
    }),
  );
  return { name: project.name, activeWellId: project.activeWellId, wells, snapshots: project.snapshots ?? [] };
}
