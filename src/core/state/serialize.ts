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
import { emptyDisplay, sanitizeDisplay, type DisplaySettings } from '../display';
import type { Interpretation } from '../interpretation';
import { createPointSet, isNumericColumn, sanitizePointSetDecisions, type PointColumn, type PointSet } from '../pointSets';
import { sanitizeToolString } from '../toolString';
import { sanitizeTrends } from '../trends';
import { createWell, type Curve, type Well } from '../well';
import { emptyProgress, type FlowProgress, type Project, type Snapshot } from './project';

export const PROJECT_FORMAT = 'pozo-proyecto';
/**
 * Historial del formato:
 * - v1 (fase 1): pozos, interpretación y snapshots.
 * - v2 (fase 3): `progress` por pozo (marcas del flujo guiado). Migración: v1 → progreso vacío.
 * - v3 (fase 4): `display` del proyecto (pistas propias y overrides del visor). Migración: v2 → `display` vacío.
 * - v4 (fase 6b-1): `interpretation.trends` (líneas de tendencia) en cada pozo y snapshot. Migración: v3 → `[]`.
 * - v5 (fase 6b-2): `well.pointSets` (presiones MDT, plugs de corona) e `interpretation.pointSets` (decisiones sobre
 *   sus puntos) en cada pozo y snapshot. Migración: v4 → `[]` y `{}`.
 * - v6 (fase 7a): `display.plots` (configuración del histograma y del crossplot libre por pozo). Migración: v5 → sin
 *   configuración (valores por defecto); el campo es opcional, así que no hay que tocar nada.
 *   La fase 7b (docs/decisiones/0016) suma, sin cambiar la versión, dos campos opcionales: `display.trackTemplates`
 *   (plantillas de pistas propias) y `TrackSpec.hidden` (pistas de superposición quitadas). Ausentes = ninguna.
 *   La fase 11a (docs/decisiones/0032) suma, también sin cambiar la versión, `interpretation.toolString` (sarta de
 *   perfilaje, en cada pozo y snapshot). Ausente = modo datos sin nada apagado; se valida al abrir.
 */
export const PROJECT_VERSION = 6;

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

/** Columna de un conjunto de puntos: numérica (array codificado, con unidad) o de texto (lista de strings). */
type SavedPointColumn = { label: string; unit: string; values: EncodedArray } | { label: string; text: string[] };

interface SavedPointSet extends Omit<PointSet, 'depth' | 'columns'> {
  depth: EncodedArray;
  columns: Record<string, SavedPointColumn>;
}

interface SavedWell extends Omit<Well, 'depth' | 'curves' | 'pointSets'> {
  depth: { unit: 'm'; sourceUnit?: string; values: EncodedArray };
  curves: SavedCurve[];
  pointSets: SavedPointSet[];
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
    display: DisplaySettings;
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
        pointSets: await Promise.all(well.pointSets.map((ps) => encodePointSet(ps, codec))),
      };
      return { well: saved, interpretation, progress };
    }),
  );
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: opts.savedAt ?? new Date().toISOString(),
    project: { name: project.name, activeWellId: project.activeWellId, wells, snapshots: project.snapshots, display: project.display },
  };
  return JSON.stringify(file);
}

async function encodePointSet(ps: PointSet, codec: CodecChoice): Promise<SavedPointSet> {
  const columns: Record<string, SavedPointColumn> = {};
  for (const [key, c] of Object.entries(ps.columns)) {
    columns[key] = isNumericColumn(c) ? { label: c.label, unit: c.unit, values: await encodeArray(c.values, codec) } : { label: c.label, text: [...c.values] };
  }
  return { ...ps, pointIds: [...ps.pointIds], depth: await encodeArray(ps.depth, codec), columns };
}

/** Conjunto guardado → `PointSet` validado; null (con aviso) si está roto: no tira abajo el proyecto. */
async function decodePointSet(raw: SavedPointSet, where: string, warn: (m: string) => void): Promise<PointSet | null> {
  const label = `${where}, conjunto de puntos '${raw?.name ?? raw?.id ?? '?'}'`;
  try {
    if (!raw || typeof raw !== 'object' || !raw.depth || !Array.isArray(raw.pointIds)) throw new Error('le faltan la profundidad o los ids');
    const depth = await decodeArray(raw.depth);
    const columns: Record<string, PointColumn> = {};
    const cols = raw.columns && typeof raw.columns === 'object' && !Array.isArray(raw.columns) ? raw.columns : {};
    for (const [key, c] of Object.entries(cols)) {
      // Una columna rota (forma, unidad o largo) se descarta sola: el resto del conjunto se conserva.
      let col: PointColumn | null = null;
      if (c && typeof c === 'object' && 'values' in c && c.values && typeof c.values === 'object' && 'codec' in c.values) {
        const unit = typeof c.unit === 'string' && c.unit ? c.unit : 'unitless';
        const values = await decodeArray(c.values).catch(() => null);
        if (values) col = { label: String(c.label ?? key), unit, values };
      } else if (c && typeof c === 'object' && 'text' in c && Array.isArray(c.text)) {
        col = { label: String(c.label ?? key), values: c.text.map((v) => (typeof v === 'string' ? v : String(v ?? ''))) };
      }
      if (!col) warn(`${label}: la columna '${key}' es inválida; se descarta.`);
      else if (col.values.length !== depth.length) warn(`${label}: la columna '${key}' tiene ${col.values.length} valores y hay ${depth.length} puntos; se descarta la columna.`);
      else columns[key] = col;
    }
    return createPointSet({
      id: raw.id,
      kind: raw.kind,
      name: raw.name,
      ...(typeof raw.source === 'string' ? { source: raw.source } : {}),
      ...(raw.synthetic === true ? { synthetic: true } : {}),
      depth,
      pointIds: raw.pointIds,
      columns,
    });
  } catch (err) {
    warn(`${label}: ${(err instanceof Error ? err.message : String(err)).replace(/\.$/, '')}; se descarta el conjunto.`);
    return null;
  }
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
  if (f.version < 3) {
    // v2 → v3: sin pistas propias ni overrides del visor.
    f = { ...f, version: 3, project: { ...f.project, display: emptyDisplay() } };
  }
  if (f.version < 4) {
    // v3 → v4: sin líneas de tendencia (en cada pozo y en cada snapshot).
    const withTrends = (i: Interpretation): Interpretation => ({ ...i, trends: [] });
    f = {
      ...f,
      version: 4,
      project: {
        ...f.project,
        wells: (f.project.wells ?? []).map((w) => ({ ...w, interpretation: withTrends(w.interpretation) })),
        snapshots: (f.project.snapshots ?? []).map((s) => ({ ...s, interpretation: withTrends(s.interpretation) })),
      },
    };
  }
  if (f.version < 5) {
    // v4 → v5: sin conjuntos de puntos en los pozos ni decisiones sobre ellos.
    const withPoints = (i: Interpretation): Interpretation => ({ ...i, pointSets: {} });
    f = {
      ...f,
      version: 5,
      project: {
        ...f.project,
        wells: (f.project.wells ?? []).map((w) => ({ ...w, well: { ...w.well, pointSets: [] }, interpretation: withPoints(w.interpretation) })),
        snapshots: (f.project.snapshots ?? []).map((s) => ({ ...s, interpretation: withPoints(s.interpretation) })),
      },
    };
  }
  if (f.version < 6) {
    // v5 → v6: sin configuración de gráficos (`display.plots` ausente = valores por defecto).
    f = { ...f, version: 6 };
  }
  return f;
}

export interface DeserializeOptions {
  /** Avisos de lo que se descartó por inválido (por defecto, a la consola). */
  onWarning?: (message: string) => void;
}

export async function deserializeProject(text: string, opts: DeserializeOptions = {}): Promise<Project> {
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
  const warn = opts.onWarning ?? ((m: string) => console.warn(`Proyecto: ${m}`));
  /** Tendencias y decisiones sobre puntos validadas al abrir: lo inválido se descarta con aviso (como `display`). */
  const cleanInterp = (i: Interpretation, where: string): Interpretation => {
    const { toolString: rawToolString, ...rest } = i;
    const toolString = sanitizeToolString(rawToolString, where, warn);
    return {
      ...rest,
      trends: sanitizeTrends(i.trends, where, warn),
      pointSets: sanitizePointSetDecisions(i.pointSets, where, warn),
      ...(toolString ? { toolString } : {}),
    };
  };
  const wells = await Promise.all(
    project.wells.map(async ({ well, interpretation, progress }) => {
      const depth = await decodeArray(well.depth.values);
      const curves: Curve[] = await Promise.all(well.curves.map(async (c) => ({ ...c, data: await decodeArray(c.data) })));
      const where = `Pozo '${well.name}'`;
      const decoded = await Promise.all((Array.isArray(well.pointSets) ? well.pointSets : []).map((ps) => decodePointSet(ps, where, warn)));
      const ids = new Set<string>();
      const pointSets = decoded.filter((ps): ps is PointSet => {
        if (!ps) return false;
        if (ids.has(ps.id)) {
          warn(`${where}: el conjunto de puntos '${ps.id}' está repetido; se descarta el segundo.`);
          return false;
        }
        ids.add(ps.id);
        return true;
      });
      const restored = createWell({
        id: well.id,
        name: well.name,
        header: well.header,
        depth,
        ...(well.depth.sourceUnit ? { depthSourceUnit: well.depth.sourceUnit } : {}),
        curves,
        pointSets,
      });
      return { well: restored, interpretation: cleanInterp(interpretation, where), progress: progress ?? emptyProgress() };
    }),
  );
  return {
    name: project.name,
    activeWellId: project.activeWellId,
    wells,
    snapshots: (project.snapshots ?? []).map((s) => ({ ...s, interpretation: cleanInterp(s.interpretation, `Snapshot '${s.name}'`) })),
    display: sanitizeDisplay(project.display, warn),
  };
}
