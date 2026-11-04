/**
 * Distribuciones por zona (docs/decisiones/0066): armado puro de las filas (zonas en orden de profundidad), de las
 * series comparadas (interpretación actual, snapshots, otros pozos con zonas emparejadas por nombre), del eje
 * compartido, de los textos del tooltip y de los CSV. Sin React ni stores; la estadística es la del motor
 * (`src/petro/distribution.ts`), que coincide por construcción con el sumario por zona.
 */
import { csvCell } from '../../io/export/csv';
import { numText } from '../../io/export/prepare';
import { intervalDistribution, suggestDistributionStat, type DistributionFilter, type DistributionInput, type DistributionMean, type DistributionStats } from '../../petro/distribution';
import { formatNumber } from '../../ui/format';
import { layoutZones, type Zone, type ZoneKind } from '../../core/well';
import { niceRange, type XYAxis } from '../xy/axes';
import type { PlugInfo } from './plugs';

// ── filas: zonas ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface IndexRange {
  start: number;
  end: number;
}

/** Una zona del pozo ubicada sobre las muestras ([start, end), puede tener varios tramos si hay solapamientos). */
export interface ZoneRow {
  id: string;
  name: string;
  color: string;
  kind: ZoneKind;
  top: number;
  base: number;
  ranges: IndexRange[];
}

export const ZONE_KIND_LABEL: Record<ZoneKind, string> = { formation: 'Formación', reservoir: 'Reservorio', seal: 'Sello', other: 'Otro' };

/** Zonas válidas en orden de tope, con los tramos de muestras que les tocan (la misma regla que el motor). */
export function zoneRows(depth: ArrayLike<number>, zones: readonly Zone[]): ZoneRow[] {
  const layout = layoutZones(depth, zones);
  const byId = new Map(zones.map((z) => [z.id, z]));
  return layout.spans.map((s) => {
    const z = byId.get(s.id)!;
    return { id: s.id, name: s.name, color: z.color, kind: s.kind, top: s.top, base: s.base, ranges: layout.segments.filter((g) => g.zoneId === s.id).map((g) => ({ start: g.start, end: g.end })) };
  });
}

/** Nombre normalizado para emparejar zonas entre pozos (sin mayúsculas, acentos ni espacios de más). */
export const zoneKey = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** Filas a dibujar: sin las ocultas y, si se pide, solo las de reservorio. */
export function shownRows(rows: readonly ZoneRow[], opts: { reservoirOnly: boolean; hidden: readonly string[] }): ZoneRow[] {
  return rows.filter((r) => !opts.hidden.includes(r.id) && (!opts.reservoirOnly || r.kind === 'reservoir'));
}

// ── series ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** `core`: plugs de corona del pozo activo (puntos con peso 1; `plugs.ts`). */
export type SeriesKind = 'current' | 'snapshot' | 'well' | 'core' | 'coreLog';

/** Datos de una serie lista: curvas alineadas con la profundidad de SU pozo y sus zonas. */
export interface SeriesData {
  id: string;
  label: string;
  kind: SeriesKind;
  depth: ArrayLike<number>;
  zones: readonly Zone[];
  /** null = la propiedad no existe en esta serie (curva borrada, método apagado). */
  values: ArrayLike<number> | null;
  thickness: ArrayLike<number>;
  netRes?: ArrayLike<number>;
  netPay?: ArrayLike<number>;
  washout?: ArrayLike<number>;
  phi?: ArrayLike<number>;
}

/** Qué opciones admite una serie (o el conjunto): el panel deshabilita las otras en vez de dejar que el motor tire. */
export interface Availability {
  netRes: boolean;
  netPay: boolean;
  washout: boolean;
  phi: boolean;
}

export const availabilityOf = (s: Pick<SeriesData, 'netRes' | 'netPay' | 'washout' | 'phi'>): Availability => ({ netRes: !!s.netRes, netPay: !!s.netPay, washout: !!s.washout, phi: !!s.phi });

/**
 * Media y escala de la propiedad: la sugerida por el rol, con la media por espesor si falta φ para ponderar Sw. El eje
 * es logarítmico también si la curva se lee en escala log (resistividades, como en el visor y el histograma); la media
 * de esas curvas sigue siendo la sugerida por el rol.
 */
export function propertyStat(roleOrMnemonic: string, phiAvailable: boolean, curveScale: 'linear' | 'log' = 'linear'): { mean: DistributionMean; scale: 'linear' | 'log'; fallback: boolean } {
  const s = suggestDistributionStat(roleOrMnemonic);
  const scale = s.scale === 'log' || curveScale === 'log' ? 'log' : 'linear';
  if (s.mean === 'poreVolume' && !phiAvailable) return { mean: 'thickness', scale, fallback: true };
  return { mean: s.mean, scale, fallback: false };
}

/** Por qué una celda no tiene caja. */
export type CellMissing = 'zone' | 'curve' | 'flags' | 'phi' | 'plugs';

export interface DistributionCell {
  stats: DistributionStats | null;
  missing?: CellMissing;
  /** m: espesor de las muestras que pasan el filtro (usadas + derrumbe excluido + sin dato). Plugs: cantidad. */
  filtered: number;
  /** Solo la serie de corona: los plugs de la zona (la estadística es por plug, no por espesor). */
  plugs?: PlugInfo;
}

export interface DistributionSettings {
  filter: DistributionFilter;
  excludeWashout: boolean;
  mean: DistributionMean;
}

/**
 * La zona de cada fila en cada serie (sobre las muestras de SU pozo): por id en el mismo pozo o, si no, por nombre
 * (otro pozo). `undefined` si la serie no tiene esa zona.
 */
export function matchZones(rows: readonly ZoneRow[], series: readonly Pick<SeriesData, 'kind' | 'depth' | 'zones'>[]): (ZoneRow | undefined)[][] {
  const finders = series.map((s) => {
    const own = zoneRows(s.depth, s.zones);
    const byId = new Map(own.map((r) => [r.id, r]));
    const byName = new Map<string, ZoneRow>();
    for (const r of own) if (!byName.has(zoneKey(r.name))) byName.set(zoneKey(r.name), r);
    return (row: ZoneRow) => (s.kind === 'well' ? undefined : byId.get(row.id)) ?? byName.get(zoneKey(row.name));
  });
  return rows.map((row) => finders.map((f) => f(row)));
}

/**
 * Una celda por (zona, serie). La zona de una serie se busca por id (mismo pozo) o, si no, por nombre (otro pozo);
 * si falta la zona, la curva o una bandera que pide el filtro, la celda no tiene estadística y dice por qué.
 */
export function buildCells(rows: readonly ZoneRow[], series: readonly SeriesData[], settings: DistributionSettings): DistributionCell[][] {
  const matched = matchZones(rows, series);
  return rows.map((_row, i) =>
    series.map((s, k): DistributionCell => {
      const zone = matched[i]![k];
      if (!zone) return { stats: null, missing: 'zone', filtered: 0 };
      if (!s.values) return { stats: null, missing: 'curve', filtered: 0 };
      if ((settings.filter === 'netRes' && !s.netRes) || (settings.filter === 'netPay' && !s.netPay)) return { stats: null, missing: 'flags', filtered: 0 };
      if (settings.mean === 'poreVolume' && !s.phi) return { stats: null, missing: 'phi', filtered: 0 };
      const input: DistributionInput = {
        values: s.values,
        thickness: s.thickness,
        ...(s.netRes ? { netRes: s.netRes } : {}),
        ...(s.netPay ? { netPay: s.netPay } : {}),
        ...(s.washout ? { washout: s.washout } : {}),
        ...(s.phi ? { phi: s.phi } : {}),
      };
      const stats = intervalDistribution(input, settings, zone.ranges);
      return { stats, filtered: stats.thickness + stats.excludedWashout + stats.noData };
    }),
  );
}

/**
 * true si la celda tiene caja que dibujar. Con la media por volumen poral, muestras usadas con φ = 0 pesan 0: una zona
 * donde todas tienen φ = 0 (lutita) tiene n > 0 pero ni percentiles ni media, y se lee «sin dato» (no un carril vacío).
 */
export const hasBox = (c: DistributionCell): boolean => !!c.stats && c.stats.n > 0 && Number.isFinite(c.stats.p50);

/**
 * Fracciones (0–1) del espesor filtrado en derrumbe (se excluya o no; `washoutExcluded` dice cuál) y sin dato; NaN si no
 * pasó ninguna muestra.
 */
export function cellQuality(c: DistributionCell): { washout: number; washoutExcluded: boolean; noData: number } {
  if (!c.stats || !(c.filtered > 0)) return { washout: NaN, washoutExcluded: false, noData: NaN };
  return { washout: c.stats.washoutThickness / c.filtered, washoutExcluded: c.stats.excludedWashout > 0, noData: c.stats.noData / c.filtered };
}

// ── eje ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Eje compartido: contiene P10–P90 y las medias de todas las cajas visibles (lineal con margen y extremos «lindos»;
 * log en décadas). Si todos los valores son ≥ 0, el eje lineal no baja de 0. null si no hay ninguna caja.
 * `extra`: valores que también tienen que verse (los cutoffs, para que su manija siempre se pueda agarrar).
 */
export function distributionAxis(cells: readonly (readonly DistributionCell[])[], scale: 'linear' | 'log', label: string, unit?: string, extra: readonly number[] = []): XYAxis | null {
  const vals: number[] = [];
  for (const row of cells)
    for (const c of row) {
      const s = c.stats;
      if (!s || !(s.n > 0)) continue;
      vals.push(s.p10, s.p90, s.mean, s.p50);
      if (scale === 'log') vals.push(s.geoMean);
    }
  const ok = (v: number) => Number.isFinite(v) && (scale === 'linear' || v > 0);
  // Sin ninguna caja no hay eje, aunque haya cutoffs.
  if (!vals.some(ok)) return null;
  const finite = [...vals, ...extra].filter(ok);
  const r = niceRange([finite], scale, { pad: 0.06 });
  if (!r) return null;
  const min = scale === 'linear' && finite.every((v) => v >= 0) ? Math.max(0, r.min) : r.min;
  return { kind: scale, min, max: r.max, label, ...(unit ? { unit } : {}) };
}

// ── textos ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Valor con 3 cifras significativas (coma decimal) y unidad. */
export function fmtValue(v: number, unit?: string): string {
  if (!Number.isFinite(v)) return 'sin dato';
  const t = formatNumber(v, { significant: 3 }).replace(/^-/, '−');
  return unit ? `${t} ${unit}` : t;
}

const pct = (f: number) => (f >= 0.995 ? '100' : f > 0 && f < 0.01 ? '<1' : formatNumber(f * 100, { digits: 0 }));

/**
 * Avisos concretos de una zona (debajo del nombre): n de la serie principal, % del espesor excluido por derrumbe y
 * % sin dato (solo si son > 0). Vacío si no hay nada que decir.
 */
export function zoneNotes(c: DistributionCell | undefined): { text: string; tone: 'muted' | 'warn' }[] {
  if (!c) return [];
  if (!c.stats) return [{ text: MISSING_TEXT[c.missing ?? 'curve'], tone: 'muted' }];
  const s = c.stats;
  if (c.plugs) return [{ text: plugCountText(c), tone: s.n > 0 && s.n < 5 ? 'warn' : 'muted' }];
  const out: { text: string; tone: 'muted' | 'warn' }[] = [{ text: s.n > 0 ? `n ${formatNumber(s.n, { digits: 0 })} · ${formatNumber(s.thickness, { digits: 1 })} m` : 'sin muestras', tone: 'muted' }];
  const q = cellQuality(c);
  if (q.washout > 0) out.push({ text: `${pct(q.washout)} % derrumbe${q.washoutExcluded ? ' (excluido)' : ''}`, tone: q.washout >= 0.2 ? 'warn' : 'muted' });
  if (q.noData > 0) out.push({ text: `${pct(q.noData)} % sin dato`, tone: q.noData >= 0.2 ? 'warn' : 'muted' });
  return out;
}

export const MISSING_TEXT: Record<CellMissing, string> = {
  zone: 'la zona no está',
  curve: 'sin la propiedad',
  flags: 'sin banderas netas',
  phi: 'sin porosidad',
  plugs: 'sin plugs',
};

export const MEAN_LABEL: Record<DistributionMean, string> = {
  thickness: 'Media (por espesor)',
  poreVolume: 'Media (por volumen poral)',
  geometric: 'Media geométrica',
};

/** «n 12 plugs» (y cuántos deja afuera el filtro) de una celda de corona. */
export function plugCountText(c: DistributionCell): string {
  const p = c.plugs;
  if (!p) return '';
  const n = c.stats?.n ?? 0;
  const what = p.source === 'log' ? (n === 1 ? 'muestra (una por plug)' : 'muestras (una por plug)') : n === 1 ? 'plug' : 'plugs';
  const base = n > 0 ? `n ${formatNumber(n, { digits: 0 })} ${what}` : p.inZone > 0 ? 'ningún plug pasa el filtro' : 'sin plugs';
  return p.filteredOut > 0 && n > 0 ? `${base} (${formatNumber(p.filteredOut, { digits: 0 })} fuera del filtro)` : base;
}

/** Líneas del tooltip de una caja. `notes`: avisos de la serie (corona: unidad y base de φ). */
export function cellTooltip(zone: string, series: string, c: DistributionCell, mean: DistributionMean, unit?: string, notes: readonly string[] = []): string[] {
  const head = series ? `${zone} · ${series}` : zone;
  if (c.plugs) return [...plugTooltip(head, c, mean, unit), ...(c.stats && c.stats.n > 0 ? notes : [])];
  if (!c.stats) return [head, MISSING_TEXT[c.missing ?? 'curve']];
  const s = c.stats;
  if (!(s.n > 0)) return [head, 'Sin muestras con dato en el filtro'];
  const lines = [
    head,
    `n ${formatNumber(s.n, { digits: 0 })} · ${formatNumber(s.thickness, { digits: 1 })} m`,
    `P10 ${fmtValue(s.p10)} · P50 ${fmtValue(s.p50)} · P90 ${fmtValue(s.p90, unit)}`,
    `${MEAN_LABEL[mean]} ${fmtValue(s.mean, unit)}`,
  ];
  if (mean !== 'geometric' && Number.isFinite(s.geoMean) && unit === 'mD') lines.push(`Media geométrica ${fmtValue(s.geoMean, unit)}`);
  const q = cellQuality(c);
  const extra = [q.washout > 0 ? `${pct(q.washout)} % ${q.washoutExcluded ? 'excluido por derrumbe' : 'en derrumbe (incluido)'}` : '', q.noData > 0 ? `${pct(q.noData)} % sin dato` : ''].filter(Boolean);
  if (extra.length) lines.push(extra.join(' · '));
  return lines;
}

/** Tooltip de una celda de corona: n de plugs, percentiles con pesos iguales y la media (aritmética o geométrica). */
function plugTooltip(head: string, c: DistributionCell, mean: DistributionMean, unit?: string): string[] {
  const s = c.stats;
  if (!s) return [head, c.missing === 'flags' ? MISSING_TEXT.flags : plugCountText(c) || MISSING_TEXT.plugs];
  const lines = [head, plugCountText(c)];
  if (!(s.n > 0)) return lines;
  if (s.n < 5) lines.push(`Valores ${c.plugs!.values.map((v) => fmtValue(v)).join(' · ')}${unit ? ` ${unit}` : ''} (pocos plugs: puntos, sin caja)`);
  else lines.push(`P10 ${fmtValue(s.p10)} · P50 ${fmtValue(s.p50)} · P90 ${fmtValue(s.p90, unit)}`);
  lines.push(`${mean === 'geometric' ? 'Media geométrica' : 'Media aritmética'} ${fmtValue(s.mean, unit)} · cada plug pesa igual`);
  if (c.plugs!.source === 'log') lines.push('Perfil en la muestra de cada plug (no toda la zona)');
  if (c.plugs!.noValue > 0) lines.push(`${formatNumber(c.plugs!.noValue, { digits: 0 })} sin valor de la propiedad`);
  return lines;
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const FILTER_LABEL: Record<DistributionFilter, string> = { all: 'Toda la zona', netRes: 'Reservorio neto', netPay: 'Pay neto' };

// 10 cifras significativas: sin el ruido de coma flotante de las sumas de espesores (57,7596 y no 57,75960000000123).
const n = (v: number) => (Number.isFinite(v) ? numText(+v.toPrecision(10)) : '');

/**
 * CSV de estadísticas (coma como separador, punto decimal, sin dato = vacío; igual que los demás exportadores): una
 * fila por zona y serie.
 */
export function statsCsv(rows: readonly ZoneRow[], series: readonly { label: string }[], cells: readonly (readonly DistributionCell[])[], meta: { property: string; unit: string; filter: DistributionFilter; excludeWashout: boolean; mean: DistributionMean }): string {
  const u = meta.unit ? ` (${meta.unit})` : '';
  const header = ['Zona', 'Serie', 'Propiedad', 'Filtro', 'Excluye derrumbe', 'Media usada', 'n', 'Espesor (m)', `P10${u}`, `P25${u}`, `P50${u}`, `P75${u}`, `P90${u}`, `Media${u}`, `Media geométrica${u}`, 'Excluido por derrumbe (m)', 'Sin dato (m)', 'Observación'];
  const out = [header.map(csvCell).join(',')];
  rows.forEach((r, i) =>
    series.forEach((s, k) => {
      const c = cells[i]?.[k];
      const st = c?.stats;
      out.push(
        [
          csvCell(r.name),
          csvCell(s.label),
          csvCell(meta.property),
          csvCell(FILTER_LABEL[meta.filter]),
          meta.excludeWashout ? 'sí' : 'no',
          csvCell(c?.plugs ? (meta.mean === 'geometric' ? 'Media geométrica' : 'Media aritmética') : MEAN_LABEL[meta.mean]),
          st ? String(st.n) : '',
          st && !c?.plugs ? n(st.thickness) : '',
          ...(st ? [st.p10, st.p25, st.p50, st.p75, st.p90, st.mean, st.geoMean].map(n) : ['', '', '', '', '', '', '']),
          st && !c?.plugs ? n(st.excludedWashout) : '',
          st && !c?.plugs ? n(st.noData) : '',
          csvCell(!c ? '' : c.plugs ? `${c.plugs.source === 'log' ? 'perfil en las muestras de los plugs' : 'plugs de corona'}, pesos iguales${st && st.n > 0 && st.n < 5 ? '; menos de 5 plugs' : ''}${!st ? `; ${MISSING_TEXT[c.missing ?? 'plugs']}` : ''}` : !st ? MISSING_TEXT[c.missing ?? 'curve'] : st.n === 0 ? 'sin muestras' : ''),
        ].join(','),
      );
    }),
  );
  return out.join('\n') + '\n';
}

/** CSV de topes: zona, tope, base, espesor y tipo. */
export function topsCsv(rows: readonly ZoneRow[]): string {
  const out = [['Zona', 'Tope (m)', 'Base (m)', 'Espesor (m)', 'Tipo'].map(csvCell).join(',')];
  for (const r of rows) out.push([csvCell(r.name), n(r.top), n(r.base), n(r.base - r.top), csvCell(ZONE_KIND_LABEL[r.kind])].join(','));
  return out.join('\n') + '\n';
}
