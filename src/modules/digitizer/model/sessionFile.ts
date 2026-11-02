/**
 * Archivo de sesión del Log Digitizer (docs/decisiones/0063): se guarda APARTE del proyecto, como JSON.
 *
 * Contenido: la `DigitizerSession` del motor (JSON puro, validada con `parseSession` al abrir), la imagen ORIGINAL
 * incrustada en base64 con sus bytes tal como se cargaron (JPG/PNG/WebP: mucho más chica que los píxeles), y
 * `extras` con lo que la sesión del motor no modela: curvas a medio definir, amarres sin profundidad todavía,
 * suavizado/picos y si la geometría se omitió. Al abrir, la huella de la imagen decodificada se compara con la
 * guardada (`sessionMatchesImage`).
 */
import {
  deserializeTrace,
  serializeTrace,
  validateSession,
  type DigitizerCurveSpec,
  type DigitizerSession,
  type GeometryStep,
  type SerializedTrace,
} from '../../../digitizer';
import { calibrationOf, depthSpecOf, emptyWork, specOf, type CurveDraft, type TieDraft, type WorkState } from './form';

export const SESSION_FORMAT = 'pozo-log-digitizer';
export const SESSION_VERSION = 1;
/** A partir de este tamaño se avisa al guardar (la imagen va incrustada). */
export const SESSION_WARN_BYTES = 5 * 1024 * 1024;

type DraftExtra = Omit<CurveDraft, 'trace'>;

export interface SessionExtras {
  depthUnit: WorkState['depthUnit'];
  method: WorkState['method'];
  ties: TieDraft[];
  curves: DraftExtra[];
  /** Trazos de curvas que todavía no tienen spec válida (no entran en `session.traces`). */
  looseTraces: Record<string, SerializedTrace>;
  geometrySkipped: boolean;
}

export interface SessionFile {
  format: typeof SESSION_FORMAT;
  version: number;
  savedAt: string;
  session: DigitizerSession;
  image: { mime: string; base64: string };
  extras: SessionExtras;
}

export interface SessionInput {
  name: string;
  imageName: string;
  imageSize: { width: number; height: number };
  fingerprint: string;
  geometry: GeometryStep[];
  geometrySkipped: boolean;
  work: WorkState;
  /** Imagen corregida (para validar los specs). */
  corrected: { width: number; height: number };
  image: { mime: string; base64: string };
  savedAt?: string;
}

export function buildSessionFile(i: SessionInput): SessionFile {
  const cal = calibrationOf(i.work);
  const curves: DigitizerCurveSpec[] = [];
  const traces: Record<string, SerializedTrace> = {};
  const looseTraces: Record<string, SerializedTrace> = {};
  for (const c of i.work.curves) {
    const { spec } = specOf(c, i.corrected);
    if (spec) {
      curves.push(spec);
      if (c.trace) traces[c.id] = serializeTrace(c.trace);
    } else if (c.trace) looseTraces[c.id] = serializeTrace(c.trace);
  }
  const session: DigitizerSession = {
    version: 1,
    name: i.name,
    image: { name: i.imageName, width: i.imageSize.width, height: i.imageSize.height, fingerprint: i.fingerprint },
    geometry: i.geometry,
    depth: cal.calibration ? depthSpecOf(i.work) : null,
    curves,
    traces,
  };
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    savedAt: i.savedAt ?? new Date().toISOString(),
    session,
    image: i.image,
    extras: {
      depthUnit: i.work.depthUnit,
      method: i.work.method,
      ties: i.work.ties,
      curves: i.work.curves.map(({ trace: _t, ...rest }) => rest),
      looseTraces,
      geometrySkipped: i.geometrySkipped,
    },
  };
}

export const serializeSessionFile = (f: SessionFile): string => JSON.stringify(f);

const bad = (m: string): never => {
  throw new Error(`No se pudo abrir la sesión: ${m}`);
};

/** Texto → archivo de sesión validado (la sesión del motor con `validateSession`). Errores en español. */
export function parseSessionFile(text: string): SessionFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad('el archivo no es un JSON válido.');
  }
  const o = raw as Partial<SessionFile> | null;
  if (!o || typeof o !== 'object' || o.format !== SESSION_FORMAT) return bad('no es una sesión del Log Digitizer (¿es un proyecto?).');
  if (o.version !== SESSION_VERSION) bad(`la versión ${String(o.version)} no es compatible.`);
  if (!o.image || typeof o.image.base64 !== 'string' || typeof o.image.mime !== 'string' || o.image.base64.length === 0) bad('falta la imagen incrustada.');
  let session: DigitizerSession;
  try {
    session = validateSession(o.session);
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e));
  }
  const ex = (o.extras ?? {}) as Partial<SessionExtras>;
  const extras: SessionExtras = {
    depthUnit: ex.depthUnit === 'ft' ? 'ft' : 'm',
    method: ex.method === 'linear' ? 'linear' : 'piecewise',
    ties: Array.isArray(ex.ties) ? ex.ties.filter((t) => t && Number.isFinite(t.y) && (t.depth === null || Number.isFinite(t.depth))) : [],
    curves: Array.isArray(ex.curves) ? ex.curves : [],
    looseTraces: ex.looseTraces && typeof ex.looseTraces === 'object' ? ex.looseTraces : {},
    geometrySkipped: ex.geometrySkipped === true,
  };
  return { format: SESSION_FORMAT, version: SESSION_VERSION, savedAt: String(o.savedAt ?? ''), session, image: o.image!, extras };
}

/** Rearma el estado de trabajo de la mesa desde un archivo de sesión. */
export function restoreWork(f: SessionFile): WorkState {
  const work = emptyWork();
  const { session, extras } = f;
  work.depthUnit = session.depth?.unit ?? extras.depthUnit;
  work.method = session.depth?.method ?? extras.method;
  work.ties = extras.ties.length
    ? extras.ties
    : (session.depth?.ties ?? []).map((t, i) => ({ id: `t${i + 1}`, y: t.y, depth: t.depth }));
  const traceOf = (id: string) => {
    const s = session.traces[id] ?? extras.looseTraces[id];
    return s ? deserializeTrace(s) : null;
  };
  if (extras.curves.length) {
    work.curves = extras.curves.map((c) => ({ ...c, trace: traceOf(c.id) }));
  } else {
    work.curves = session.curves.map((s) => ({
      id: s.id,
      mnemonic: s.mnemonic,
      unit: s.unit,
      role: s.role ?? null,
      description: s.description ?? '',
      leftPx: s.frame.leftPx,
      rightPx: s.frame.rightPx,
      leftValue: s.frame.scale.reversed ? s.frame.scale.max : s.frame.scale.min,
      rightValue: s.frame.scale.reversed ? s.frame.scale.min : s.frame.scale.max,
      scaleKind: s.frame.scale.kind,
      color: s.color,
      region: s.region,
      mode: s.mode,
      guide: s.guide?.points ?? [],
      corridor: s.guide?.corridor ?? 12,
      median: 1,
      despike: false,
      trace: traceOf(s.id),
      warnings: [],
      include: true,
    }));
  }
  return work;
}

// ---------------------------------------------------------------------------------------------------------------
// base64 sin dependencias (btoa/atob existen en navegadores y en Node ≥ 16)

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024)).toLocaleString('es-AR')} kB`;
  return `${(n / (1024 * 1024)).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
}
