/**
 * Banderas discretas 0/1 creadas por el usuario desde una selección (docs/decisiones/0088-del-lazo-a-la-accion.md).
 *
 * JSON puro dentro de `Interpretation.userFlags?`: nunca muta `Well.curves`, no invalida revisiones de entrada y no
 * recalcula el motor petrofísico. Al proyectarse sobre la profundidad del pozo se evalúa como serie discreta 0/1 con
 * rol de familia `flag` (`UFLAG_<id>`), visible en filtros de gráficos, pista de banderas y «Armar pistas».
 */

export interface UserFlagInterval {
  top: number;
  base: number;
}

export interface UserFlagDef {
  /** Identificador único dentro del pozo (`[a-zA-Z0-9_-]{1,64}`). */
  id: string;
  /** Nombre corto legible en filtros, leyenda y pistas (1–64 caracteres). */
  name: string;
  /** Color hex `#rrggbb` sugerido para la franja en el visor (opcional). */
  color?: string;
  /** Tramos MD cerrados `[top, base]` en metros (ordenados y sin solapar) donde la bandera vale 1. */
  intervals: readonly UserFlagInterval[];
  /** Origen informativo breve (p. ej. «Lazo en el crossplot»). */
  source?: string;
}

export const USER_FLAG_ROLE_PREFIX = 'UFLAG_';
export const USER_FLAG_MODULE_ID = 'user-flags';
export const MAX_USER_FLAGS = 64;
export const USER_FLAG_NAME_MAX = 64;
export const USER_FLAG_SOURCE_MAX = 120;
export const MAX_USER_FLAG_INTERVALS = 32768;

const USER_FLAG_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Paleta accesible por defecto para banderas de usuario (distintas de pay/reservorio/indicadores). */
export const USER_FLAG_PALETTE: readonly string[] = [
  '#0891b2',
  '#7c3aed',
  '#db2777',
  '#059669',
  '#d97706',
  '#2563eb',
  '#be185d',
  '#4d7c0f',
];

export const userFlagRoleId = (id: string): string => `${USER_FLAG_ROLE_PREFIX}${id}`;

export const isUserFlagRole = (role: string | null | undefined): role is string =>
  typeof role === 'string' && role.startsWith(USER_FLAG_ROLE_PREFIX) && role.length > USER_FLAG_ROLE_PREFIX.length;

export const userFlagIdFromRole = (role: string | null | undefined): string | null =>
  isUserFlagRole(role) ? role.slice(USER_FLAG_ROLE_PREFIX.length) : null;

export const userFlagColor = (index: number): string =>
  USER_FLAG_PALETTE[((index % USER_FLAG_PALETTE.length) + USER_FLAG_PALETTE.length) % USER_FLAG_PALETTE.length]!;

/** Clave normalizada de nombre para comparar unicidad sin distinguir mayúsculas ni espacios sobrantes. */
export const normalizeUserFlagName = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Recorta un texto de origen al límite admitido (`USER_FLAG_SOURCE_MAX`), sin romper el guardado. */
export function clipUserFlagSource(source: string): string {
  const trimmed = source.trim();
  if (trimmed.length <= USER_FLAG_SOURCE_MAX) return trimmed;
  return `${trimmed.slice(0, USER_FLAG_SOURCE_MAX - 1).trimEnd()}…`;
}

/**
 * Convierte una máscara 0/1 sobre `depth` creciente en intervalos MD cerrados exactos (`gap = 0`), sin puentear
 * huecos de una muestra ni ensanchar medio paso fuera de `[depth[0], depth[n-1]]`.
 */
export function maskToExactIntervals(depth: ArrayLike<number>, mask: ArrayLike<number>): UserFlagInterval[] {
  const n = Math.min(depth.length, mask.length);
  const out: UserFlagInterval[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  let inRun = false;
  for (let i = 0; i < n; i++) {
    const d = depth[i]!;
    if (mask[i] === 1 && Number.isFinite(d)) {
      if (!inRun) {
        lo = d;
        hi = d;
        inRun = true;
      } else {
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    } else if (inRun) {
      out.push({ top: lo, base: hi });
      inRun = false;
    }
  }
  if (inRun) out.push({ top: lo, base: hi });
  return out;
}

/** Ordena y funde intervalos MD cerrados solapados (`r.top <= prev.base`). Descarta no finitos o invertidos. */
export function normalizeFlagIntervals(intervals: readonly UserFlagInterval[]): UserFlagInterval[] {
  const valid = intervals
    .filter((r) => Number.isFinite(r.top) && Number.isFinite(r.base) && r.top <= r.base)
    .map(({ top, base }) => ({ top, base }))
    .sort((a, b) => a.top - b.top || a.base - b.base);
  const out: UserFlagInterval[] = [];
  for (const r of valid) {
    const prev = out.at(-1);
    if (prev && r.top <= prev.base) prev.base = Math.max(prev.base, r.base);
    else out.push(r);
  }
  return out;
}

function lowerBound(depth: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = depth.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (depth[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(depth: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = depth.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (depth[mid]! <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Cuenta cuántas muestras de `depth` (estrictamente creciente) caen dentro de los intervalos cerrados. */
export function countIntervalSamples(depth: ArrayLike<number>, intervals: readonly UserFlagInterval[]): number {
  const norm = normalizeFlagIntervals(intervals);
  let total = 0;
  for (const r of norm) {
    const a = lowerBound(depth, r.top);
    const b = upperBound(depth, r.base);
    if (b > a) total += b - a;
  }
  return total;
}

function isFiniteNonDecreasing(depth: ArrayLike<number>): boolean {
  for (let i = 0; i < depth.length; i++) {
    const v = depth[i]!;
    if (!Number.isFinite(v)) return false;
    if (i > 0 && v < depth[i - 1]!) return false;
  }
  return true;
}

/**
 * Evalúa una bandera de usuario sobre una grilla de profundidad (`depth`): devuelve un `Float64Array` de
 * largo exacto `depth.length` con valores `1` en los intervalos cerrados `[top, base]` y `0` en el resto.
 */
export function evaluateUserFlag(depth: ArrayLike<number>, flag: Pick<UserFlagDef, 'intervals'>): Float64Array {
  const n = depth.length;
  const out = new Float64Array(n);
  if (n === 0 || flag.intervals.length === 0) return out;
  if (isFiniteNonDecreasing(depth)) {
    for (const r of flag.intervals) {
      if (!Number.isFinite(r.top) || !Number.isFinite(r.base) || r.top > r.base) continue;
      const a = lowerBound(depth, r.top);
      const b = upperBound(depth, r.base);
      for (let i = a; i < b; i++) out[i] = 1;
    }
    return out;
  }
  for (let i = 0; i < n; i++) {
    const d = depth[i]!;
    if (!Number.isFinite(d)) continue;
    for (const r of flag.intervals) {
      if (Number.isFinite(r.top) && Number.isFinite(r.base) && d >= r.top && d <= r.base) {
        out[i] = 1;
        break;
      }
    }
  }
  return out;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);

const ALLOWED_FLAG_KEYS = new Set(['id', 'name', 'color', 'intervals', 'source']);
const ALLOWED_INTERVAL_KEYS = new Set(['top', 'base']);

export interface SanitizeUserFlagsOptions {
  /** En modo estricto (v7), exige lista no vacía y forma canónica ya normalizada (sin recortes ni reordenamientos implícitos). */
  strict?: boolean;
}

/** Valida y sanea `Interpretation.userFlags` al abrir proyectos v6 (aviso + descarte) o v7 (estricto vía `warn`). */
export function sanitizeUserFlags(
  raw: unknown,
  where: string,
  warn: (m: string) => void,
  opts: SanitizeUserFlagsOptions = {},
): UserFlagDef[] | undefined {
  if (raw === undefined) return undefined;
  const strict = opts.strict === true;
  if (!Array.isArray(raw) || raw.length > MAX_USER_FLAGS || (strict && raw.length === 0)) {
    warn(`${where}: lista de banderas de usuario inválida o excede el límite de ${MAX_USER_FLAGS}.`);
    return undefined;
  }
  const out: UserFlagDef[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of raw) {
    if (!isPlainObject(item) || Object.keys(item).some((k) => !ALLOWED_FLAG_KEYS.has(k))) {
      warn(`${where}: bandera de usuario con estructura inválida.`);
      continue;
    }
    const id = item.id;
    const rawName = item.name;
    const rawColor = item.color;
    const rawSource = item.source;
    const rawIntervals = item.intervals;
    if (typeof id !== 'string' || !USER_FLAG_ID_RE.test(id) || ids.has(id)) {
      warn(`${where}: bandera de usuario con id inválido o repetido.`);
      continue;
    }
    if (typeof rawName !== 'string') {
      warn(`${where}: bandera '${id}' sin nombre válido.`);
      continue;
    }
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (!name || name.length > USER_FLAG_NAME_MAX || (strict && rawName !== name) || names.has(name.toLowerCase())) {
      warn(`${where}: bandera '${id}' con nombre vacío, sin normalizar, demasiado largo o repetido.`);
      continue;
    }
    if (rawColor !== undefined && (typeof rawColor !== 'string' || !HEX_COLOR_RE.test(rawColor))) {
      warn(`${where}: bandera '${name}' con color inválido.`);
      continue;
    }
    let source: string | undefined;
    if (rawSource !== undefined) {
      if (typeof rawSource !== 'string') {
        warn(`${where}: bandera '${name}' con origen inválido.`);
        continue;
      }
      const trimmed = rawSource.trim();
      if (!trimmed || trimmed.length > USER_FLAG_SOURCE_MAX || (strict && rawSource !== trimmed)) {
        warn(`${where}: bandera '${name}' con origen vacío, sin normalizar o demasiado largo.`);
        continue;
      }
      source = trimmed;
    }
    if (!Array.isArray(rawIntervals) || rawIntervals.length === 0 || rawIntervals.length > MAX_USER_FLAG_INTERVALS) {
      warn(`${where}: bandera '${name}' sin intervalos válidos.`);
      continue;
    }
    let intervalsOk = true;
    const parsedIntervals: UserFlagInterval[] = [];
    for (const r of rawIntervals) {
      if (
        !isPlainObject(r) ||
        Object.keys(r).some((k) => !ALLOWED_INTERVAL_KEYS.has(k)) ||
        typeof r.top !== 'number' ||
        typeof r.base !== 'number' ||
        !Number.isFinite(r.top) ||
        !Number.isFinite(r.base) ||
        r.top > r.base
      ) {
        intervalsOk = false;
        break;
      }
      if (strict && parsedIntervals.length > 0 && r.top <= parsedIntervals[parsedIntervals.length - 1]!.base) {
        intervalsOk = false;
        break;
      }
      parsedIntervals.push({ top: r.top, base: r.base });
    }
    if (!intervalsOk) {
      warn(`${where}: bandera '${name}' contiene intervalos MD inválidos, desordenados o solapados.`);
      continue;
    }
    const intervals = strict ? parsedIntervals : normalizeFlagIntervals(parsedIntervals);
    if (intervals.length === 0) {
      warn(`${where}: bandera '${name}' sin intervalos válidos.`);
      continue;
    }
    ids.add(id);
    names.add(name.toLowerCase());
    out.push({
      id,
      name,
      ...(rawColor !== undefined ? { color: rawColor } : {}),
      intervals,
      ...(source !== undefined ? { source } : {}),
    });
  }
  return out;
}
