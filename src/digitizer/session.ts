/**
 * Sesión del digitalizador: modelo serializable (JSON puro) + validación al abrir. Puro (sin DOM).
 *
 * La sesión (imagen + calibración + curvas + trazos) se guarda APARTE del proyecto; la fase 2 la persistirá. La imagen
 * no va dentro: solo sus metadatos y una huella (`fingerprintImage`) para comprobar al reabrir que es la misma. Nada de
 * funciones ni arrays tipados dentro del modelo: los trazos se guardan como arrays de números con `null` en lugar de NaN
 * (JSON no admite NaN) y `serializeTrace` / `deserializeTrace` hacen la conversión.
 */
import { checkDepthSpec, checkValueFrame } from './calibration';
import { DigitizerError } from './errors';
import type { CurveColorSpec, DigitizerCurveSpec, DigitizerSession, GeometryStep, RasterImage, SerializedTrace, TracedCurve } from './types';

/** Huella barata y determinista de la imagen: dimensiones + FNV-1a de 32 bits sobre una muestra de ≈ 200.000 bytes. */
export function fingerprintImage(image: RasterImage): string {
  const len = image.data.length;
  const step = Math.max(1, Math.floor(len / 200_000));
  let h = 0x811c9dc5;
  for (let i = 0; i < len; i += step) {
    h ^= image.data[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${image.width}x${image.height}:${h.toString(16).padStart(8, '0')}`;
}

export function createSession(name: string, imageName: string, image: RasterImage): DigitizerSession {
  return {
    version: 1,
    name,
    image: { name: imageName, width: image.width, height: image.height, fingerprint: fingerprintImage(image) },
    geometry: [],
    depth: null,
    curves: [],
    traces: {},
  };
}

/** true si la huella de la imagen coincide con la guardada en la sesión. */
export function sessionMatchesImage(session: DigitizerSession, image: RasterImage): boolean {
  return session.image.fingerprint === fingerprintImage(image) && session.image.width === image.width && session.image.height === image.height;
}

export function serializeTrace(t: TracedCurve): SerializedTrace {
  const nn = (v: number) => (Number.isNaN(v) ? null : v);
  return {
    y0: t.y0,
    x: Array.from(t.x, nn),
    width: Array.from(t.width, nn),
    confidence: Array.from(t.confidence),
    observed: Array.from(t.observed),
  };
}

export function deserializeTrace(s: SerializedTrace): TracedCurve {
  const n = s.x.length;
  if (s.width.length !== n || s.confidence.length !== n || s.observed.length !== n) {
    throw new DigitizerError('invalid-session', 'Un trazo guardado tiene arrays de largos distintos.');
  }
  return {
    y0: s.y0,
    x: Float64Array.from(s.x, (v) => (v === null ? NaN : v)),
    width: Float64Array.from(s.width, (v) => (v === null ? NaN : v)),
    confidence: Float64Array.from(s.confidence),
    observed: Uint8Array.from(s.observed),
    warnings: [],
  };
}

/** true si el valor es JSON puro: null, booleanos, números finitos, strings, arrays y objetos simples (sin funciones, typed arrays, NaN ni undefined). */
export function isJsonPure(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (Array.isArray(value)) return value.every(isJsonPure);
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.values(value as Record<string, unknown>).every(isJsonPure);
    }
    default:
      return false;
  }
}

export const serializeSession = (session: DigitizerSession): string => JSON.stringify(session);

const bad = (message: string): never => {
  throw new DigitizerError('invalid-session', `Sesión inválida: ${message}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validateColor(c: unknown, where: string): CurveColorSpec {
  if (!isObj(c)) return bad(`${where}: falta el color.`);
  if (c['mode'] === 'dark') return c as unknown as CurveColorSpec;
  if (c['mode'] === 'color') {
    const rgb = c['rgb'];
    if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every((v) => isNum(v) && v >= 0 && v <= 255)) bad(`${where}: el color RGB debe tener 3 valores entre 0 y 255.`);
    return c as unknown as CurveColorSpec;
  }
  return bad(`${where}: el modo de color '${String(c['mode'])}' no existe.`);
}

function validateGeometry(steps: unknown): GeometryStep[] {
  if (!Array.isArray(steps)) return bad('la geometría debe ser una lista.');
  for (const [i, s] of (steps as unknown[]).entries()) {
    if (!isObj(s)) return bad(`el paso de geometría ${i + 1} no es un objeto.`);
    if (s['kind'] === 'rotate') {
      if (!isNum(s['angleRad'])) bad(`el paso de geometría ${i + 1} (rotación) no tiene un ángulo numérico.`);
    } else if (s['kind'] === 'perspective') {
      const q = s['quad'];
      if (!Array.isArray(q) || q.length !== 4 || !q.every((p) => isObj(p) && isNum(p['x']) && isNum(p['y']))) bad(`el paso de geometría ${i + 1} (perspectiva) necesita 4 esquinas numéricas.`);
      if (!isNum(s['outWidth']) || !isNum(s['outHeight'])) bad(`el paso de geometría ${i + 1} (perspectiva) necesita el tamaño de salida.`);
    } else bad(`el paso de geometría ${i + 1} es de un tipo desconocido ('${String(s['kind'])}').`);
  }
  return steps as GeometryStep[];
}

/** Valida una sesión leída de JSON. Lanza `DigitizerError('invalid-session')` con el primer problema, en español. */
export function validateSession(raw: unknown): DigitizerSession {
  if (!isObj(raw)) return bad('no es un objeto.');
  if (raw['version'] !== 1) bad(`la versión ${String(raw['version'])} no es compatible (se esperaba 1).`);
  if (typeof raw['name'] !== 'string') bad('falta el nombre.');
  const img = raw['image'];
  if (!isObj(img) || typeof img['name'] !== 'string' || !isNum(img['width']) || !isNum(img['height']) || typeof img['fingerprint'] !== 'string') bad('faltan los datos de la imagen (nombre, tamaño y huella).');
  validateGeometry(raw['geometry']);
  const depth = raw['depth'];
  if (depth !== null) {
    if (!isObj(depth)) bad('la calibración de profundidad no es un objeto.');
    const problems = checkDepthSpec(depth as never);
    if (problems.length > 0) bad(`calibración de profundidad: ${problems[0]}`);
  }
  if (!Array.isArray(raw['curves'])) bad('las curvas deben ser una lista.');
  const ids = new Set<string>();
  for (const [i, c] of (raw['curves'] as unknown[]).entries()) {
    const where = `curva ${i + 1}`;
    if (!isObj(c)) return bad(`${where} no es un objeto.`);
    if (typeof c['id'] !== 'string' || c['id'] === '') bad(`${where}: falta el id.`);
    if (ids.has(c['id'] as string)) bad(`hay dos curvas con el id '${String(c['id'])}'.`);
    ids.add(c['id'] as string);
    if (typeof c['mnemonic'] !== 'string' || typeof c['unit'] !== 'string') bad(`${where}: faltan el mnemónico o la unidad.`);
    if (!isObj(c['frame'])) bad(`${where}: falta la escala.`);
    const fp = checkValueFrame(c['frame'] as never);
    if (fp.length > 0) bad(`${where}: ${fp[0]}`);
    validateColor(c['color'], where);
    const r = c['region'];
    if (!isObj(r) || !['x0', 'y0', 'x1', 'y1'].every((k) => isNum(r[k]))) bad(`${where}: la región de búsqueda no es válida.`);
    if (c['mode'] !== 'auto' && c['mode'] !== 'guided') bad(`${where}: el modo '${String(c['mode'])}' no existe.`);
    if (c['mode'] === 'guided' && !(isObj(c['guide']) && Array.isArray(c['guide']['points']))) bad(`${where}: el modo guiado necesita una guía.`);
  }
  const traces = raw['traces'];
  if (!isObj(traces)) bad('faltan los trazos guardados (puede ser un objeto vacío).');
  for (const [id, t] of Object.entries(traces as Record<string, unknown>)) {
    if (!ids.has(id)) bad(`hay un trazo guardado de una curva que no existe ('${id}').`);
    if (!isObj(t) || !isNum(t['y0']) || !Array.isArray(t['x']) || !Array.isArray(t['width']) || !Array.isArray(t['confidence']) || !Array.isArray(t['observed'])) bad(`el trazo de '${id}' está incompleto.`);
    const tt = t as unknown as SerializedTrace;
    if (tt.width.length !== tt.x.length || tt.confidence.length !== tt.x.length || tt.observed.length !== tt.x.length) bad(`el trazo de '${id}' tiene arrays de largos distintos.`);
  }
  return raw as unknown as DigitizerSession;
}

/** Texto JSON → sesión validada. */
export function parseSession(text: string): DigitizerSession {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad('el archivo no es un JSON válido.');
  }
  return validateSession(raw);
}

/** Curva de la sesión por id (lanza si no existe). */
export function getSessionCurve(session: DigitizerSession, id: string): DigitizerCurveSpec {
  const c = session.curves.find((k) => k.id === id);
  if (!c) throw new DigitizerError('invalid-session', `La sesión no tiene la curva '${id}'.`);
  return c;
}
