/**
 * Configuración de los gráficos del dock (histograma, crossplot libre y distribuciones por zona) que se GUARDA en el proyecto
 * (docs/decisiones/0014-histograma-y-crossplot.md, D2): curvas elegidas, escalas, color, zonas filtradas, plantilla y
 * cutoffs libres. Es trabajo del usuario y viaja con el archivo, igual que las pistas del visor: vive en
 * `Project.display.plots[pozo]`, fuera de `Interpretation` (no recalcula el motor ni entra en snapshots) y entra en
 * deshacer/rehacer por `commit`. JSON puro; recetas en `state/plots.ts`.
 *
 * Las curvas se nombran con la misma clave que las series de tendencias: `m:<id de curva medida>` o `r:<ROL>` (la
 * fuente activa de ese rol: sigue al método elegido).
 */

/** Clave de curva de un gráfico: `m:<curva>` (medida) o `r:<ROL>` (fuente activa del rol). */
export type PlotCurveKey = string;

/** Escala de un eje: automática (según el rol: log para resistividades y permeabilidad), o forzada. */
export type AxisScaleChoice = 'auto' | 'linear' | 'log';

/**
 * Cutoffs dibujados en un gráfico, por curva. `true` = mostrar el cutoff REAL del módulo de cutoffs (VSH, PHIE, SW:
 * el valor sale de los parámetros); un número = línea libre (no cambia la petrofísica).
 */
export type PlotCutoffs = Record<PlotCurveKey, number | true>;

/** Operadores de una regla de filtro de muestras sobre una curva o bandera. */
export const PLOT_FILTER_OPS = ['le', 'lt', 'ge', 'gt', 'between', 'eq', 'neq'] as const;
export type PlotFilterOp = (typeof PLOT_FILTER_OPS)[number];

/**
 * Regla de filtro de muestras para cualquier gráfico del dock (histograma, crossplot, distribuciones).
 * Permite filtrar por cualquier curva medida (`m:<id>`), calculada (`r:<ROL>`) o bandera (`r:NET_PAY`, `r:NET_RES`,
 * `r:IND_WASHOUT`, etc.). Varias reglas activas se combinan por intersección (AND). JSON puro.
 */
export interface PlotFilterRule {
  id: string;
  curve: PlotCurveKey;
  op: PlotFilterOp;
  /** Umbral de comparación (o extremo inferior en `between`). Para banderas: `1` (Sí) o `0` (No). */
  value: number;
  /** Extremo superior solo cuando `op === 'between'`. */
  max?: number;
  enabled: boolean;
}

export interface HistogramConfig {
  /** null = la curva por defecto del pozo (GR si hay). */
  curve: PlotCurveKey | null;
  scale: AxisScaleChoice;
  /** Cantidad de clases; null = automática (Freedman–Diaconis). */
  bins: number | null;
  /** Zonas incluidas (ids); vacío = todas. */
  zones: string[];
  /** Un histograma por zona, superpuestos con el color de cada zona. */
  byZone: boolean;
  /** Frecuencia en % de las muestras de cada serie (comparar zonas de distinto espesor). */
  normalize: boolean;
  /** Curva acumulada (0–100 %, eje derecho). */
  cumulative: boolean;
  cutoffs: PlotCutoffs;
  /** Reglas de filtro por curva o bandera; ausente o vacío = sin filtros adicionales. */
  filters?: PlotFilterRule[];
}

export const CROSSPLOT_TEMPLATES = ['density-neutron', 'pickett', 'phi-sw', 'gr-rt', 'nmr-dn', 'th-k', 'pe-density', 'sonic-neutron', 'density-sonic', 'm-n', 'rhomaa-umaa', 'mid', 'pe-k', 'pe-thk', 'thomas-stieber'] as const;
export type CrossplotTemplateId = (typeof CROSSPLOT_TEMPLATES)[number];

export type CrossplotColor = { kind: 'none' } | { kind: 'zone' } | { kind: 'curve'; curve: PlotCurveKey };

export interface CrossplotConfig {
  x: PlotCurveKey | null;
  y: PlotCurveKey | null;
  xScale: AxisScaleChoice;
  yScale: AxisScaleChoice;
  /** Eje invertido (densidad en el crossplot densidad–neutrón). */
  xReversed: boolean;
  yReversed: boolean;
  /** Rango fijo (plantillas); ausente = automático según los datos. */
  xRange?: [number, number];
  yRange?: [number, number];
  color: CrossplotColor;
  zones: string[];
  /** Plantilla aplicada (líneas guía calculadas en vivo con los parámetros del proyecto); null = ninguna. */
  template: CrossplotTemplateId | null;
  cutoffs: PlotCutoffs;
  /**
   * Zonas que el usuario toma como ACUÍFERAS (Sw = 1) en el Pickett (fase 8b, docs/decisiones/0021, G): sus puntos se
   * resaltan y «Ajustar recta a la zona acuífera» estima m y Rw de ellos. Ausente o vacío = ninguna. Es una elección del
   * gráfico, no un tipo de zona del núcleo (`ZoneKind` no cambia).
   */
  pickettWaterZones?: string[];
  /** Reglas de filtro por curva o bandera; ausente o vacío = sin filtros adicionales. */
  filters?: PlotFilterRule[];
}

/** Qué muestras entran en las distribuciones por zona: toda la zona, solo reservorio neto o solo pay neto. */
export type DistributionSampleFilter = 'all' | 'netRes' | 'netPay';

/**
 * Distribuciones por zona (boxplots; docs/decisiones/0066): propiedad, filtro de muestras, series comparadas y zonas
 * ocultas. Las series se nombran `#current` (interpretación actual), `#core` (plugs de corona), `snap-…` (snapshot del
 * pozo) o `well:<id>` (otro pozo del proyecto, zonas emparejadas por nombre).
 */
export interface DistributionConfig {
  /** null = la propiedad por defecto (φe si hay). */
  curve: PlotCurveKey | null;
  filter: DistributionSampleFilter;
  /** Solo las zonas de tipo reservorio. */
  reservoirOnly: boolean;
  /** Descartar las muestras con IND_WASHOUT = 1 (si la curva existe). */
  excludeWashout: boolean;
  /** Series elegidas, en el orden de los chips. Vacío = solo la interpretación actual. */
  series: string[];
  /** Zonas ocultas (ids del pozo activo). */
  hiddenZones: string[];
  /**
   * Líneas libres por curva (V2): solo para propiedades SIN cutoff del módulo de cutoffs (las de rol VSH, PHIE, SW y
   * PERM muestran siempre el parámetro real). No cambian la petrofísica.
   */
  cutoffs: Record<PlotCurveKey, number>;
  /** Vista (V2): cajas o histogramas apilados por zona sobre el mismo eje. */
  view: DistributionView;
  /** Franja del volumen in situ por zona (determinista y P90–P10 de la incertidumbre). */
  volume: boolean;
  /** Reglas de filtro por curva o bandera; ausente o vacío = sin filtros adicionales. */
  filters?: PlotFilterRule[];
}

/** Vista de las distribuciones por zona. */
export type DistributionView = 'box' | 'hist';

export interface WellPlots {
  histogram?: HistogramConfig;
  crossplot?: CrossplotConfig;
  distribution?: DistributionConfig;
}

export type PlotKind = keyof WellPlots;

/** Configuración de un tipo de gráfico. */
export type PlotConfigOf<K extends PlotKind> = NonNullable<WellPlots[K]>;

export function defaultHistogram(): HistogramConfig {
  return { curve: null, scale: 'auto', bins: null, zones: [], byZone: true, normalize: true, cumulative: false, cutoffs: {} };
}

export function defaultCrossplot(): CrossplotConfig {
  return { x: null, y: null, xScale: 'auto', yScale: 'auto', xReversed: false, yReversed: false, color: { kind: 'zone' }, zones: [], template: null, cutoffs: {} };
}

export function defaultDistribution(): DistributionConfig {
  return { curve: null, filter: 'all', reservoirOnly: false, excludeWashout: false, series: ['#current'], hiddenZones: [], cutoffs: {}, view: 'box', volume: false };
}

/** Configuración de fábrica de un tipo de gráfico. */
export function defaultPlotConfig<K extends PlotKind>(kind: K): PlotConfigOf<K> {
  const d: { [P in PlotKind]: () => PlotConfigOf<P> } = { histogram: defaultHistogram, crossplot: defaultCrossplot, distribution: defaultDistribution };
  return d[kind]() as PlotConfigOf<K>;
}

/** Límites de la cantidad de clases elegida a mano. */
export const HISTOGRAM_BINS = { min: 3, max: 200 } as const;

// ── saneamiento al abrir un proyecto ────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isKey = (v: unknown): v is string => typeof v === 'string' && /^(m|r):.+/.test(v);
const scaleOf = (v: unknown): AxisScaleChoice => (v === 'linear' || v === 'log' ? v : 'auto');
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : []);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

function sanitizeCutoffs(v: unknown): PlotCutoffs {
  const out: PlotCutoffs = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (isKey(k) && (x === true || isNum(x))) out[k] = x;
  return out;
}

function sanitizeRange(v: unknown): [number, number] | undefined {
  return Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[1] > v[0] ? [v[0], v[1]] : undefined;
}

function sanitizeFilters(v: unknown): PlotFilterRule[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PlotFilterRule[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (!isObj(item)) continue;
    const id = item['id'];
    const curve = item['curve'];
    const op = item['op'];
    const value = item['value'];
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    if (!isKey(curve) || !PLOT_FILTER_OPS.includes(op as PlotFilterOp) || !isNum(value)) continue;
    const enabled = bool(item['enabled'], true);
    if (op === 'between') {
      const max = item['max'];
      if (!isNum(max)) continue;
      seen.add(id);
      const lo = Math.min(value, max);
      const hi = Math.max(value, max);
      out.push({ id, curve, op, value: lo, max: hi, enabled });
    } else {
      seen.add(id);
      out.push({ id, curve, op: op as PlotFilterOp, value, enabled });
    }
  }
  return out.length ? out : undefined;
}

export function sanitizeHistogram(raw: unknown): HistogramConfig {
  const d = defaultHistogram();
  if (!isObj(raw)) return d;
  const bins = raw['bins'];
  const filters = sanitizeFilters(raw['filters']);
  return {
    curve: isKey(raw['curve']) ? raw['curve'] : null,
    scale: scaleOf(raw['scale']),
    bins: isNum(bins) && Number.isInteger(bins) && bins >= HISTOGRAM_BINS.min && bins <= HISTOGRAM_BINS.max ? bins : null,
    zones: strings(raw['zones']),
    byZone: bool(raw['byZone'], d.byZone),
    normalize: bool(raw['normalize'], d.normalize),
    cumulative: bool(raw['cumulative'], d.cumulative),
    cutoffs: sanitizeCutoffs(raw['cutoffs']),
    ...(filters ? { filters } : {}),
  };
}

export function sanitizeCrossplot(raw: unknown): CrossplotConfig {
  const d = defaultCrossplot();
  if (!isObj(raw)) return d;
  const c = raw['color'];
  const color: CrossplotColor = isObj(c) && c['kind'] === 'curve' && isKey(c['curve']) ? { kind: 'curve', curve: c['curve'] } : isObj(c) && c['kind'] === 'none' ? { kind: 'none' } : { kind: 'zone' };
  const xRange = sanitizeRange(raw['xRange']);
  const yRange = sanitizeRange(raw['yRange']);
  const t = raw['template'];
  const filters = sanitizeFilters(raw['filters']);
  return {
    x: isKey(raw['x']) ? raw['x'] : null,
    y: isKey(raw['y']) ? raw['y'] : null,
    xScale: scaleOf(raw['xScale']),
    yScale: scaleOf(raw['yScale']),
    xReversed: bool(raw['xReversed'], false),
    yReversed: bool(raw['yReversed'], false),
    ...(xRange ? { xRange } : {}),
    ...(yRange ? { yRange } : {}),
    color,
    zones: strings(raw['zones']),
    template: CROSSPLOT_TEMPLATES.includes(t as CrossplotTemplateId) ? (t as CrossplotTemplateId) : null,
    cutoffs: sanitizeCutoffs(raw['cutoffs']),
    ...(strings(raw['pickettWaterZones']).length ? { pickettWaterZones: [...new Set(strings(raw['pickettWaterZones']))] } : {}),
    ...(filters ? { filters } : {}),
  };
}

/**
 * `#current` (actual), `#core` (plugs de corona), `#core-log` (perfil en las muestras de los plugs), `snap-…` (snapshot)
 * o `well:<id>` (otro pozo).
 */
const SERIES_ID = /^(#current|#core|#core-log|snap-.+|well:.+)$/;

export function sanitizeDistribution(raw: unknown): DistributionConfig {
  const d = defaultDistribution();
  if (!isObj(raw)) return d;
  const f = raw['filter'];
  const series = [...new Set(strings(raw['series']).filter((s) => SERIES_ID.test(s)))];
  const filters = sanitizeFilters(raw['filters']);
  return {
    curve: isKey(raw['curve']) ? raw['curve'] : null,
    filter: f === 'netRes' || f === 'netPay' ? f : 'all',
    reservoirOnly: bool(raw['reservoirOnly'], d.reservoirOnly),
    excludeWashout: bool(raw['excludeWashout'], d.excludeWashout),
    series: series.length ? series : d.series,
    hiddenZones: [...new Set(strings(raw['hiddenZones']))],
    cutoffs: freeLines(raw['cutoffs']),
    view: raw['view'] === 'hist' ? 'hist' : 'box',
    volume: bool(raw['volume'], d.volume),
    ...(filters ? { filters } : {}),
  };
}

/** Líneas libres de las distribuciones: solo números finitos con clave de curva válida (un `true` no aplica acá). */
function freeLines(v: unknown): Record<PlotCurveKey, number> {
  const out: Record<PlotCurveKey, number> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (isKey(k) && isNum(x)) out[k] = x;
  return out;
}

/** Valida `display.plots` leído de un archivo (por pozo). Lo que no es un objeto se descarta con aviso. */
export function sanitizePlots(raw: unknown, warn: (m: string) => void = () => {}): Record<string, WellPlots> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) {
    warn('La configuración de los gráficos es inválida; se usan los valores por defecto.');
    return undefined;
  }
  const out: Record<string, WellPlots> = {};
  for (const [wellId, v] of Object.entries(raw)) {
    if (!isObj(v)) {
      warn(`Gráficos del pozo '${wellId}': configuración inválida; se descarta.`);
      continue;
    }
    const w: WellPlots = {};
    if (v['histogram'] !== undefined) w.histogram = sanitizeHistogram(v['histogram']);
    if (v['crossplot'] !== undefined) w.crossplot = sanitizeCrossplot(v['crossplot']);
    if (v['distribution'] !== undefined) w.distribution = sanitizeDistribution(v['distribution']);
    if (w.histogram || w.crossplot || w.distribution) out[wellId] = w;
  }
  return Object.keys(out).length ? out : undefined;
}

