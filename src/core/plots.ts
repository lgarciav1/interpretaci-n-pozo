/**
 * Configuración de los gráficos del dock (histograma y crossplot libre) que se GUARDA en el proyecto
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
}

export const CROSSPLOT_TEMPLATES = ['density-neutron', 'pickett', 'phi-sw', 'gr-rt', 'nmr-dn', 'th-k', 'pe-density', 'sonic-neutron', 'density-sonic', 'm-n', 'rhomaa-umaa', 'pe-k', 'pe-thk'] as const;
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
}

export interface WellPlots {
  histogram?: HistogramConfig;
  crossplot?: CrossplotConfig;
}

export type PlotKind = keyof WellPlots;

export function defaultHistogram(): HistogramConfig {
  return { curve: null, scale: 'auto', bins: null, zones: [], byZone: true, normalize: true, cumulative: false, cutoffs: {} };
}

export function defaultCrossplot(): CrossplotConfig {
  return { x: null, y: null, xScale: 'auto', yScale: 'auto', xReversed: false, yReversed: false, color: { kind: 'zone' }, zones: [], template: null, cutoffs: {} };
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

export function sanitizeHistogram(raw: unknown): HistogramConfig {
  const d = defaultHistogram();
  if (!isObj(raw)) return d;
  const bins = raw['bins'];
  return {
    curve: isKey(raw['curve']) ? raw['curve'] : null,
    scale: scaleOf(raw['scale']),
    bins: isNum(bins) && Number.isInteger(bins) && bins >= HISTOGRAM_BINS.min && bins <= HISTOGRAM_BINS.max ? bins : null,
    zones: strings(raw['zones']),
    byZone: bool(raw['byZone'], d.byZone),
    normalize: bool(raw['normalize'], d.normalize),
    cumulative: bool(raw['cumulative'], d.cumulative),
    cutoffs: sanitizeCutoffs(raw['cutoffs']),
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
  };
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
    if (w.histogram || w.crossplot) out[wellId] = w;
  }
  return Object.keys(out).length ? out : undefined;
}

