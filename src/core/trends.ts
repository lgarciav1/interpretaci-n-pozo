/**
 * Líneas de tendencia del pozo (docs/decisiones/0008-tendencias-y-gradientes.md, D2).
 *
 * Una tendencia es una decisión de interpretación: vive en `Interpretation.trends`, entra en snapshots y en
 * deshacer/rehacer, y no recalcula el motor (la firma de los módulos no la incluye). Es JSON puro.
 *
 * La serie de datos se nombra con `SeriesRef` y la resuelve un proveedor (`src/plots/trend/series.ts`): curvas del
 * visor (`curve`), presiones MDT, crossplots… Los puntos excluidos se guardan por CLAVE estable del punto
 * (profundidad redondeada, id de la medición), nunca por índice.
 */
import type { TrendModel } from '../petro/regression';

export type { TrendModel } from '../petro/regression';

export const TREND_MODELS: readonly TrendModel[] = ['linear', 'log', 'exp', 'power'];

/** Serie de datos de una tendencia: proveedor + clave dentro del proveedor (p. ej. { provider: 'curve', key: 'm:DT' }). */
export interface SeriesRef {
  provider: string;
  key: string;
}

/** Punto en las unidades de la serie (x = variable independiente; en profundidad, m). */
export interface TrendPoint {
  x: number;
  y: number;
}

export interface TrendSelection {
  /** Tramo de profundidad (m). Ausente = sin límite de ese lado. */
  top?: number;
  base?: number;
  /** «Usar zona como tramo»: mientras la zona exista, el tramo es el de la zona (top/base quedan de respaldo). */
  zoneId?: string;
  /** Filtro por la variable independiente (crossplots). */
  xMin?: number;
  xMax?: number;
  /** Claves de los puntos que el usuario sacó del ajuste. */
  excluded: string[];
}

export interface TrendSpec {
  id: string;
  name: string;
  /** Color propio; sin color, uno de la paleta categórica por orden. */
  color?: string;
  visible: boolean;
  series: SeriesRef;
  model: TrendModel;
  /** 'fit' = ajuste por mínimos cuadrados sobre el tramo; 'manual' = dibujada a mano por dos puntos. */
  mode: 'fit' | 'manual';
  selection: TrendSelection;
  /** Los dos puntos de una tendencia a mano (solo mode = 'manual'). */
  manual?: [TrendPoint, TrendPoint];
  /** Dibujar la extensión fuera del tramo (punteada). */
  extend: boolean;
}

export function sameSeries(a: SeriesRef, b: SeriesRef): boolean {
  return a.provider === b.provider && a.key === b.key;
}

/** Tramo efectivo de profundidad: el de la zona si `zoneId` existe; si no, top/base guardados. */
export function trendDepthRange(sel: TrendSelection, zones: readonly { id: string; top: number; base: number }[]): { top: number; base: number } {
  const z = sel.zoneId ? zones.find((zz) => zz.id === sel.zoneId) : undefined;
  if (z) return { top: z.top, base: z.base };
  return { top: sel.top ?? -Infinity, base: sel.base ?? Infinity };
}

/** Nombre libre para una tendencia nueva: «base», «base 2», «base 3»… */
export function nextTrendName(trends: readonly TrendSpec[], base = 'Tendencia'): string {
  const used = new Set(trends.map((t) => t.name));
  if (!used.has(base)) return base;
  for (let k = 2; ; k++) if (!used.has(`${base} ${k}`)) return `${base} ${k}`;
}

// ── saneamiento al abrir un proyecto ────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPoint = (v: unknown): v is TrendPoint => isObj(v) && isNum(v['x']) && isNum(v['y']);

/** Una tendencia guardada, validada; null (con aviso) si no se puede usar. */
export function sanitizeTrend(raw: unknown, where: string, warn: (m: string) => void): TrendSpec | null {
  if (!isObj(raw)) {
    warn(`${where}: no es una tendencia; se descarta.`);
    return null;
  }
  const id = raw['id'];
  const name = raw['name'];
  if (typeof id !== 'string' || !id) {
    warn(`${where}: falta el id; se descarta.`);
    return null;
  }
  const label = `${where} '${typeof name === 'string' && name ? name : id}'`;
  const series = raw['series'];
  if (!isObj(series) || typeof series['provider'] !== 'string' || typeof series['key'] !== 'string') {
    warn(`${label}: la serie de datos es inválida; se descarta.`);
    return null;
  }
  const model = raw['model'];
  if (!TREND_MODELS.includes(model as TrendModel)) {
    warn(`${label}: modelo '${String(model)}' desconocido; se descarta.`);
    return null;
  }
  const mode = raw['mode'] === 'manual' ? 'manual' : raw['mode'] === 'fit' ? 'fit' : null;
  if (!mode) {
    warn(`${label}: modo inválido; se descarta.`);
    return null;
  }
  const sel = isObj(raw['selection']) ? raw['selection'] : {};
  const selection: TrendSelection = { excluded: [] };
  for (const k of ['top', 'base', 'xMin', 'xMax'] as const) {
    const v = sel[k];
    if (v === undefined || v === null) continue;
    if (!isNum(v)) {
      warn(`${label}: el tramo tiene un valor no numérico en '${k}'; se descarta.`);
      return null;
    }
    selection[k] = v;
  }
  if (selection.top !== undefined && selection.base !== undefined && selection.top > selection.base) {
    [selection.top, selection.base] = [selection.base, selection.top];
  }
  if (typeof sel['zoneId'] === 'string' && sel['zoneId']) selection.zoneId = sel['zoneId'];
  if (Array.isArray(sel['excluded'])) {
    const keys = sel['excluded'].filter((k): k is string => typeof k === 'string');
    if (keys.length !== sel['excluded'].length) warn(`${label}: se descartaron puntos excluidos inválidos.`);
    selection.excluded = [...new Set(keys)];
  }
  const spec: TrendSpec = {
    id,
    name: typeof name === 'string' && name.trim() ? name : 'Tendencia',
    visible: raw['visible'] !== false,
    series: { provider: series['provider'], key: series['key'] },
    model: model as TrendModel,
    mode,
    selection,
    extend: raw['extend'] === true,
  };
  if (typeof raw['color'] === 'string' && /^#[0-9a-f]{6}$/i.test(raw['color'])) spec.color = raw['color'];
  if (mode === 'manual') {
    const m = raw['manual'];
    if (!Array.isArray(m) || m.length !== 2 || !isPoint(m[0]) || !isPoint(m[1])) {
      warn(`${label}: una tendencia a mano necesita dos puntos; se descarta.`);
      return null;
    }
    spec.manual = [{ x: m[0].x, y: m[0].y }, { x: m[1].x, y: m[1].y }];
  }
  return spec;
}

/** Lista de tendencias guardada: descarta (con aviso) las inválidas y los ids repetidos. */
export function sanitizeTrends(raw: unknown, where: string, warn: (m: string) => void = () => {}): TrendSpec[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn(`${where}: las tendencias no son una lista; se descartan.`);
    return [];
  }
  const out: TrendSpec[] = [];
  const ids = new Set<string>();
  raw.forEach((t, i) => {
    const s = sanitizeTrend(t, `${where}, tendencia ${i + 1}`, warn);
    if (!s) return;
    if (ids.has(s.id)) {
      warn(`${where}: la tendencia '${s.id}' está repetida; se descarta la segunda.`);
      return;
    }
    ids.add(s.id);
    out.push(s);
  });
  return out;
}
