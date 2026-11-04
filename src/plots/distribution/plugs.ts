/**
 * Plugs de corona como serie de las distribuciones por zona (docs/decisiones/0066, D15–D17). Puro y testeado.
 *
 * - Mapeo por ROL de la propiedad elegida (nunca por mnemónico): φ de corona ↔ PHIE, PHIT y sus versiones RMN; k ↔
 *   PERM; densidad de grano ↔ RHOMAA (densidad de matriz aparente). Los mismos roles sobre los que el visor dibuja los
 *   plugs (`src/modules/core/overlay.ts`), salvo la densidad de grano, que allí va sobre RHOB por legibilidad.
 * - Cada plug se ata a la muestra de perfil más cercana a su profundidad CORRIDA (`nearestSample`: tolerancia de un
 *   paso de muestreo, 0,1524 m en el pozo del TP). Fuera de tolerancia queda «fuera del perfil» y no entra. Con esa
 *   muestra se elige la zona (la misma regla que las muestras: `layoutZones`) y se lee la bandera de reservorio / pay.
 *   El derrumbe NO se aplica: es un problema del pozo que afecta al perfil, no al plug medido en el laboratorio.
 * - Estadística: la del motor (`intervalDistribution`) con peso 1 por plug (los plugs son puntos, no espesores): Hazen
 *   con pesos iguales; media aritmética para φ y densidad de grano, geométrica para k (eje log, como el perfil).
 */
import { convertArray, getUnit, unitLabel, type UnitId } from '../../core/units';
import { intervalDistribution, type DistributionFilter, type DistributionInput, type DistributionMean } from '../../petro/distribution';
import { nearestSample } from '../data';
import { formatNumber } from '../../ui/format';
import { fmtValue, type DistributionCell, type ZoneRow } from './distribution';
import { forEachUsed } from './interact';

/** Id de la serie de plugs (se guarda en `DistributionConfig.series`). */
export const CORE_SERIES = '#core';
/**
 * Id de la serie «Perfil en plugs»: la curva de la serie actual en las MISMAS muestras a las que se ata cada plug
 * (D21). Se activa junto con la corona y se puede apagar.
 */
export const CORE_LOG_SERIES = '#core-log';

/** Con menos plugs que esto en una zona se dibujan los puntos y no la caja (una caja de 3 plugs engaña). */
export const CORE_MIN_BOX = 5;

export type CoreProperty = 'phi' | 'k' | 'rhog';

/** Roles del perfil que tienen equivalente en corona. */
export const CORE_PROPERTY_ROLES: Readonly<Record<CoreProperty, readonly string[]>> = {
  phi: ['PHIE', 'PHIT', 'PHIE_NMR', 'PHIT_NMR'],
  k: ['PERM'],
  rhog: ['RHOMAA'],
};

export const CORE_PROPERTY_LABEL: Readonly<Record<CoreProperty, string>> = { phi: 'φ de corona', k: 'k de corona', rhog: 'densidad de grano' };

/** Propiedad de corona equivalente a un rol del perfil (null si no hay). */
export function corePropertyOf(role: string | null | undefined): CoreProperty | null {
  if (!role) return null;
  const r = role.toUpperCase();
  for (const p of Object.keys(CORE_PROPERTY_ROLES) as CoreProperty[]) if (CORE_PROPERTY_ROLES[p].includes(r)) return p;
  return null;
}

/** Media de los plugs: geométrica para k (eje log), aritmética para el resto. */
export const plugMean = (p: CoreProperty): DistributionMean => (p === 'k' ? 'geometric' : 'thickness');

/** Plugs INCLUIDOS de los conjuntos de corona del pozo, con la profundidad ya corrida (la que dibuja el visor). */
export interface CorePlugs {
  ids: readonly string[];
  /** Profundidad corrida (m). */
  depth: ArrayLike<number>;
  columns: Partial<Record<CoreProperty, { values: ArrayLike<number>; unit: UnitId }>>;
  /** Nombres de los conjuntos (tooltip). */
  sets: readonly string[];
  /** Curva del perfil contra la que el conjunto correlaciona su φ (ajuste del panel «Corona»), p. ej. «PHIE». */
  phiMatch?: string | null;
}

export interface PlugColumn {
  /** Valores en la unidad de la curva del perfil. */
  values: Float64Array;
  /** Unidad original si se convirtió («%» → v/v), para avisar. */
  convertedFrom: UnitId | null;
}

/**
 * Valores de una propiedad de corona en la unidad de la curva del perfil: se convierte si es la misma magnitud (% →
 * v/v, D → mD); null si no hay columna o las unidades no son comparables (otra magnitud).
 */
export function plugColumn(plugs: CorePlugs | null | undefined, prop: CoreProperty | null, curveUnit: UnitId | null | undefined): PlugColumn | null {
  const col = prop ? plugs?.columns[prop] : undefined;
  if (!col) return null;
  const v = Float64Array.from(col.values);
  if (!curveUnit || curveUnit === col.unit || curveUnit === 'unitless') return { values: v, convertedFrom: null };
  const a = getUnit(col.unit)?.dimension;
  const b = getUnit(curveUnit)?.dimension;
  if (!a || a !== b) return null;
  return { values: convertArray(v, col.unit, curveUnit), convertedFrom: col.unit };
}

/** Muestra de perfil de cada plug (−1 = fuera del perfil: a más de un paso de muestreo). */
export function tiePlugs(logDepth: ArrayLike<number>, plugDepth: ArrayLike<number>): Int32Array {
  const out = new Int32Array(plugDepth.length);
  for (let j = 0; j < plugDepth.length; j++) out[j] = nearestSample(logDepth, plugDepth[j]!);
  return out;
}

/** Detalle de los plugs de una zona (además de la estadística de la celda). */
export interface PlugInfo {
  /** Qué valores son: los del laboratorio (`core`) o los del perfil en la muestra de cada plug (`log`). */
  source: 'core' | 'log';
  /** Plugs de la zona (atados a una muestra de la zona), con o sin valor. */
  inZone: number;
  /** Valores de los plugs que entran (filtro aplicado), en orden de profundidad, con su profundidad e id. */
  values: number[];
  depths: number[];
  ids: string[];
  /** Plugs de la zona con valor que el filtro deja afuera (bandera de la muestra cercana). */
  filteredOut: number;
  /** Plugs de la zona sin valor de esta propiedad (o k ≤ 0 en eje log). */
  noValue: number;
}

export interface PlugCellsResult {
  cells: DistributionCell[];
  /** Plugs a más de un paso de muestreo del perfil (no entran en ninguna zona). */
  outside: number;
}

/**
 * Una celda por zona con los plugs que caen en ella. `flags`: banderas del perfil (alineadas con `logDepth`); si el
 * filtro pide una que no está, la celda dice «sin banderas netas» como las demás series.
 */
export function plugCells(
  rows: readonly ZoneRow[],
  plugs: Pick<CorePlugs, 'ids' | 'depth'>,
  column: PlugColumn,
  prop: CoreProperty,
  logDepth: ArrayLike<number>,
  flags: { netRes?: ArrayLike<number>; netPay?: ArrayLike<number> },
  filter: DistributionFilter,
): PlugCellsResult {
  const tie = tiePlugs(logDepth, plugs.depth);
  let outside = 0;
  for (let j = 0; j < tie.length; j++) if (tie[j]! < 0) outside++;
  // Orden por profundidad corrida (dos coronas corridas distinto pueden pisarse).
  const order = Array.from(tie.keys()).sort((a, b) => plugs.depth[a]! - plugs.depth[b]!);
  const mean = plugMean(prop);
  const cells = rows.map((row): DistributionCell => {
    const inRow = (s: number) => s >= 0 && row.ranges.some((r) => s >= r.start && s < r.end);
    const idx = order.filter((j) => inRow(tie[j]!));
    const info: PlugInfo = { source: 'core', inZone: idx.length, values: [], depths: [], ids: [], filteredOut: 0, noValue: 0 };
    if (idx.length === 0) return { stats: null, missing: 'plugs', filtered: 0, plugs: info };
    if ((filter === 'netRes' && !flags.netRes) || (filter === 'netPay' && !flags.netPay)) return { stats: null, missing: 'flags', filtered: 0, plugs: info };
    const at = (f: ArrayLike<number> | undefined) => (f ? Float64Array.from(idx, (j) => f[tie[j]!]!) : undefined);
    const netRes = at(flags.netRes);
    const netPay = at(flags.netPay);
    const input: DistributionInput = {
      values: Float64Array.from(idx, (j) => column.values[j]!),
      thickness: new Float64Array(idx.length).fill(1),
      ...(netRes ? { netRes } : {}),
      ...(netPay ? { netPay } : {}),
    };
    const options = { filter, excludeWashout: false, mean };
    const stats = intervalDistribution(input, options, [{ start: 0, end: idx.length }]);
    forEachUsed(input, options, [{ start: 0, end: idx.length }], (i, x) => {
      info.values.push(x);
      info.depths.push(plugs.depth[idx[i]!]!);
      info.ids.push(plugs.ids[idx[i]!]!);
    });
    info.noValue = stats.noData;
    const valued = idx.reduce((s, j) => s + (Number.isFinite(column.values[j]!) && (mean !== 'geometric' || column.values[j]! > 0) ? 1 : 0), 0);
    info.filteredOut = valued - stats.n;
    return { stats, filtered: stats.n + stats.noData, plugs: info };
  });
  return { cells, outside };
}

/**
 * «Perfil en plugs» (D21): la curva del perfil evaluada en la muestra a la que se ata cada plug con valor de corona
 * válido (los mismos plugs que entran en la caja de la corona antes del filtro), con peso 1 por plug, la misma media
 * que la corona (aritmética φ, geométrica k) y el mismo filtro (bandera de esa muestra). El derrumbe se aplica como en
 * las demás series de perfil (afecta a la lectura del perfil). Así la diferencia caja a caja es corona contra perfil
 * en las mismas profundidades, no contra toda la zona (que suma tramos sin cortar).
 */
export function plugLogCells(
  rows: readonly ZoneRow[],
  plugs: Pick<CorePlugs, 'ids' | 'depth'>,
  column: PlugColumn,
  prop: CoreProperty,
  logDepth: ArrayLike<number>,
  logValues: ArrayLike<number>,
  flags: { netRes?: ArrayLike<number>; netPay?: ArrayLike<number>; washout?: ArrayLike<number> },
  filter: DistributionFilter,
  excludeWashout: boolean,
): DistributionCell[] {
  const tie = tiePlugs(logDepth, plugs.depth);
  const mean = plugMean(prop);
  const validCore = (j: number) => Number.isFinite(column.values[j]!) && (mean !== 'geometric' || column.values[j]! > 0);
  const order = Array.from(tie.keys()).sort((a, b) => plugs.depth[a]! - plugs.depth[b]!);
  return rows.map((row): DistributionCell => {
    const idx = order.filter((j) => validCore(j) && tie[j]! >= 0 && row.ranges.some((r) => tie[j]! >= r.start && tie[j]! < r.end));
    const info: PlugInfo = { source: 'log', inZone: idx.length, values: [], depths: [], ids: [], filteredOut: 0, noValue: 0 };
    if (idx.length === 0) return { stats: null, missing: 'plugs', filtered: 0, plugs: info };
    if ((filter === 'netRes' && !flags.netRes) || (filter === 'netPay' && !flags.netPay)) return { stats: null, missing: 'flags', filtered: 0, plugs: info };
    const at = (f: ArrayLike<number> | undefined) => (f ? Float64Array.from(idx, (j) => f[tie[j]!]!) : undefined);
    const netRes = at(flags.netRes);
    const netPay = at(flags.netPay);
    const washout = at(flags.washout);
    const input: DistributionInput = {
      values: at(logValues)!,
      thickness: new Float64Array(idx.length).fill(1),
      ...(netRes ? { netRes } : {}),
      ...(netPay ? { netPay } : {}),
      ...(washout ? { washout } : {}),
    };
    const options = { filter, excludeWashout, mean };
    const ranges = [{ start: 0, end: idx.length }];
    const stats = intervalDistribution(input, options, ranges);
    forEachUsed(input, options, ranges, (i, x) => {
      info.values.push(x);
      info.depths.push(plugs.depth[idx[i]!]!);
      info.ids.push(plugs.ids[idx[i]!]!);
    });
    info.noValue = stats.noData;
    info.filteredOut = idx.length - stats.n - stats.noData - stats.excludedWashout;
    return { stats, filtered: stats.n + stats.noData, plugs: info };
  });
}

/**
 * Diferencia de medias corona − perfil en plugs (con signo y unidad); para k (media geométrica) también el cociente,
 * que es lo que se lee en un eje log. null si falta alguna de las dos.
 */
export function plugDiffText(core: DistributionCell | undefined, log: DistributionCell | undefined, prop: CoreProperty, unit?: string): string | null {
  const a = core?.stats?.mean;
  const b = log?.stats?.mean;
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = a - b;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const base = `Corona − perfil en plugs: ${sign}${fmtValue(Math.abs(d), unit)}`;
  const t = prop === 'k' && b > 0 ? `${base} (×${formatNumber(a / b, { significant: 3 })})` : base;
  // Si el perfil no tiene dato en algún plug (NaN, k ≤ 0 o derrumbe excluido) las medias salen de conjuntos distintos.
  const na = core?.stats?.n ?? 0;
  const nb = log?.stats?.n ?? 0;
  return na !== nb ? `${t} · n ${formatNumber(na, { digits: 0 })} vs ${formatNumber(nb, { digits: 0 })} plugs` : t;
}

/**
 * Avisos de la serie de corona para el tooltip y los controles: unidad convertida y base de la φ. El modelo de corona
 * no guarda si la φ del laboratorio es total o efectiva; lo único que se sabe es contra qué curva la correlaciona el
 * conjunto (`phiMatch`). Si es otra base que la propiedad elegida, se advierte.
 */
export function plugWarnings(prop: CoreProperty, column: PlugColumn, curveRole: string | null, phiMatch: string | null | undefined): { text: string; tone: 'muted' | 'warn' }[] {
  const out: { text: string; tone: 'muted' | 'warn' }[] = [];
  if (column.convertedFrom) out.push({ text: `Unidad de corona ${unitLabel(column.convertedFrom)}, convertida`, tone: 'muted' });
  if (prop === 'phi') {
    const match = (phiMatch ?? 'PHIE').replace(/^r:/, '').toUpperCase();
    const total = (r: string) => r.startsWith('PHIT');
    const role = (curveRole ?? '').toUpperCase();
    if (role && /^PHI[TE]/.test(match) && total(match) !== total(role))
      out.push({ text: `La corona se calibra contra ${match} (φ ${total(match) ? 'total' : 'efectiva'}); acá se compara con ${role}`, tone: 'warn' });
    else out.push({ text: `φ de laboratorio: la base (total o efectiva) no viene en el archivo; el conjunto la compara con ${match}`, tone: 'muted' });
  }
  return out;
}
