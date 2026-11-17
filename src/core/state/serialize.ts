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
import { sanitizeModuleState, type Interpretation } from '../interpretation';
import { createPointSet, isNumericColumn, sanitizePointSetDecisions, type PointColumn, type PointSet } from '../pointSets';
import { sanitizeToolString } from '../toolString';
import { sanitizeTrends } from '../trends';
import { createWell, type Curve, type Well } from '../well';
import { emptyProgress, readSeenDiagnostics, type FlowProgress, type Project, type Snapshot } from './project';
import { containsInputRevisions, enableProjectInputRevisions, projectInputState } from './inputRevisions';
import { encodeArray, decodeArray, defaultCodec, type CodecChoice, type EncodedArray } from './archive/arrayCodec';
import { ArchiveLimitError, archiveLimits, checkFileSize, DecodeBudget, type ArchiveLimits } from './archive/limits';
import { readProjectV7, REVISION_PROJECT_VERSION, serializeProjectV7, type RecoveryResult } from './archive/projectV7';
export { REVISION_PROJECT_VERSION, type RevisionProjectFile, ArchiveReadError } from './archive/projectV7';
export { ARCHIVE_LIMITS, ArchiveLimitError } from './archive/limits';
export { encodeArray, decodeArray, compressionAvailable, type ArrayCodec, type CodecChoice, type EncodedArray } from './archive/arrayCodec';

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
/** Versión de escritura de proyectos legados. v7 se usa cuando hay revisiones explícitas. */
export const PROJECT_VERSION = 6;

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
    wells: { well: SavedWell; interpretation: Interpretation; progress: FlowProgress; seenDiagnostics?: string[] }[];
    snapshots: Snapshot[];
    display: DisplaySettings;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Proyecto

export async function serializeProject(project: Project, opts: { codec?: CodecChoice; savedAt?: string; version?: 6 | 7 } = {}): Promise<string> {
  if ([...project.wells, ...project.snapshots].some(e => e.interpretation.preparation !== undefined)) projectInputState(project);
  if (project.wells.some(e => e.well.curves.some(c => c.origin.kind === 'prepared' || c.provenance))) throw new Error('La proyección preparada no se guarda como datos originales.');
  const version = opts.version ?? (containsInputRevisions(project) ? REVISION_PROJECT_VERSION : PROJECT_VERSION);
  if (version === REVISION_PROJECT_VERSION) return serializeProjectV7(project, opts.codec ?? defaultCodec(), opts.savedAt ?? new Date().toISOString());
  if (version !== 6) throw new Error('Versión de escritura no admitida.');
  if (containsInputRevisions(project)) throw new Error('El formato v6 no puede conservar revisiones de entradas; no se guardó una copia incompleta.');
  const codec = opts.codec ?? defaultCodec();
  const wells = await Promise.all(
    project.wells.map(async ({ well, interpretation, progress, seenDiagnostics }) => {
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
      return { well: saved, interpretation, progress, ...(seenDiagnostics?.length ? { seenDiagnostics } : {}) };
    }),
  );
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: opts.savedAt ?? new Date().toISOString(),
    project: { name: project.name, activeWellId: project.activeWellId, wells, snapshots: project.snapshots, display: project.display },
  };
  const text = JSON.stringify(file);
  checkFileSize(text, archiveLimits().fileBytes);
  return text;
}

async function encodePointSet(ps: PointSet, codec: CodecChoice): Promise<SavedPointSet> {
  const columns: Record<string, SavedPointColumn> = {};
  for (const [key, c] of Object.entries(ps.columns)) {
    columns[key] = isNumericColumn(c) ? { label: c.label, unit: c.unit, values: await encodeArray(c.values, codec) } : { label: c.label, text: [...c.values] };
  }
  return { ...ps, pointIds: [...ps.pointIds], depth: await encodeArray(ps.depth, codec), columns };
}

/** Conjunto guardado → `PointSet` validado; null (con aviso) si está roto: no tira abajo el proyecto. */
async function decodePointSet(raw: SavedPointSet, where: string, warn: (m: string) => void, budget: DecodeBudget): Promise<PointSet | null> {
  const label = `${where}, conjunto de puntos '${raw?.name ?? raw?.id ?? '?'}'`;
  try {
    if (!raw || typeof raw !== 'object' || !raw.depth || !Array.isArray(raw.pointIds)) throw new Error('le faltan la profundidad o los ids');
    const depth = await decodeArray(raw.depth, budget);
    const columns: Record<string, PointColumn> = {};
    const cols = raw.columns && typeof raw.columns === 'object' && !Array.isArray(raw.columns) ? raw.columns : {};
    for (const [key, c] of Object.entries(cols)) {
      // Una columna rota (forma, unidad o largo) se descarta sola: el resto del conjunto se conserva.
      let col: PointColumn | null = null;
      if (c && typeof c === 'object' && 'values' in c && c.values && typeof c.values === 'object' && 'codec' in c.values) {
        const unit = typeof c.unit === 'string' && c.unit ? c.unit : 'unitless';
        const values = await decodeArray(c.values, budget).catch((err) => { if (err instanceof ArchiveLimitError) throw err; return null; });
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
    if (err instanceof ArchiveLimitError) throw err;
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
  /** Migración explícita v1–v6 → revisiones; por defecto conserva el flujo legado. */
  upgradeInputs?: boolean;
  limits?: Partial<ArchiveLimits>;
}

export async function deserializeProject(text: string, opts: DeserializeOptions = {}): Promise<Project> {
  const limits = archiveLimits(opts.limits);
  checkFileSize(text, limits.fileBytes);
  const budget = new DecodeBudget(limits);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un proyecto válido (no es JSON).');
  }
  const file = parsed as ProjectFile;
  if (!file || file.format !== PROJECT_FORMAT || !Number.isInteger(file.version) || file.version < 1 || !file.project) {
    throw new Error('El archivo no es un proyecto de esta app.');
  }
  if (file.version === REVISION_PROJECT_VERSION) {
    const result = await readProjectV7(parsed, { limits, onWarning: opts.onWarning ?? ((m) => console.warn(`Proyecto: ${m}`)) });
    if (!result.project) throw new Error('El archivo v7 no contiene un proyecto recuperable.');
    return result.project;
  }
  if (file.version <= PROJECT_VERSION && containsInputRevisions(file.project)) throw new Error('El archivo declara v6 o anterior pero contiene referencias a revisiones de entradas. No se pueden descartar esas referencias al abrirlo.');
  const { project } = migrate(file);
  const warn = opts.onWarning ?? ((m: string) => console.warn(`Proyecto: ${m}`));
  /** Tendencias y decisiones sobre puntos validadas al abrir: lo inválido se descarta con aviso (como `display`). */
  const cleanInterp = (i: Interpretation, where: string): Interpretation => {
    if (i.preparation !== undefined) throw new Error('Una receta de preparación requiere un archivo con revisiones de entradas.');
    const { toolString: rawToolString, moduleState: rawModuleState, ...rest } = i;
    const toolString = sanitizeToolString(rawToolString, where, warn);
    const moduleState = sanitizeModuleState(rawModuleState, where, warn);
    return {
      ...rest,
      trends: sanitizeTrends(i.trends, where, warn),
      pointSets: sanitizePointSetDecisions(i.pointSets, where, warn),
      ...(toolString ? { toolString } : {}),
      ...(moduleState ? { moduleState } : {}),
    };
  };
  const wells = await Promise.all(
    project.wells.map(async ({ well, interpretation, progress, seenDiagnostics }) => {
      if (well.curves.some(c => c.origin?.kind === 'prepared' || c.provenance)) throw new Error('El archivo contiene una proyección preparada como datos originales.');
      const depth = await decodeArray(well.depth.values, budget);
      const curves: Curve[] = await Promise.all(well.curves.map(async (c) => ({ ...c, data: await decodeArray(c.data, budget) })));
      const where = `Pozo '${well.name}'`;
      const decoded = await Promise.all((Array.isArray(well.pointSets) ? well.pointSets : []).map((ps) => decodePointSet(ps, where, warn, budget)));
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
      const seen = readSeenDiagnostics(seenDiagnostics);
      return { well: restored, interpretation: cleanInterp(interpretation, where), progress: progress ?? emptyProgress(), ...(seen ? { seenDiagnostics: seen } : {}) };
    }),
  );
  const restored: Project = {
    name: project.name,
    activeWellId: project.activeWellId,
    wells,
    snapshots: (project.snapshots ?? []).map((s) => ({ ...s, interpretation: cleanInterp(s.interpretation, `Snapshot '${s.name}'`) })),
    display: sanitizeDisplay(project.display, warn),
  };
  if (!opts.upgradeInputs) return restored;
  const upgraded = enableProjectInputRevisions(restored);
  for (const s of upgraded.snapshots) warn(`Snapshot '${s.name}': el archivo antiguo no conservaba entradas históricas; se asocia a los datos disponibles al migrar.`);
  return upgraded;
}

/** No se usa automáticamente al abrir: la recuperación requiere una elección explícita del llamador. */
export async function recoverProject(text: string, opts: Pick<DeserializeOptions, 'limits' | 'onWarning'> = {}): Promise<RecoveryResult> {
  const limits = archiveLimits(opts.limits);
  checkFileSize(text, limits.fileBytes);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('El archivo no es un proyecto válido (no es JSON).'); }
  return readProjectV7(raw, { ...opts, limits, recover: true });
}

