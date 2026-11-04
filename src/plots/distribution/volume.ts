/**
 * Franja del volumen in situ por zona en las distribuciones (docs/decisiones/0066, D19). Puro: tipos que recibe el
 * panel, escala compartida por fluido y textos. Los números NO se calculan acá: el determinista es el del módulo de
 * volumen in situ y P90/P50/P10 los del Monte Carlo del módulo de incertidumbre (convención SPE-PRMS: P90 = bajo,
 * P10 = alto), ambos ya en la unidad de campo que usa la app (MMbbl para petróleo, Bcf para gas). `zoneVolumes` los
 * lee de las tablas: VOLUMETRICS del último resultado (por nombre de zona, como las tarjetas de zona) y UNCERTAINTY de la
 * última copia del Monte Carlo (por id de zona), con su estado (sin calcular, vigente o desactualizada).
 */
import type { TableCell } from '../../core/module';
import { formatNumber } from '../../ui/format';

export type VolumeFluid = 'oil' | 'gas';

export const VOLUME_UNIT: Readonly<Record<VolumeFluid, string>> = { oil: 'MMbbl', gas: 'Bcf' };
export const VOLUME_LABEL: Readonly<Record<VolumeFluid, string>> = { oil: 'Petróleo in situ', gas: 'Gas in situ' };

export interface VolumeValue {
  /** Determinista (módulo de volumen in situ). NaN = sin dato. */
  det: number;
  /** Percentiles del Monte Carlo (solo si la incertidumbre está calculada). */
  p90?: number;
  p50?: number;
  p10?: number;
}

export interface ZoneVolume {
  oil?: VolumeValue;
  gas?: VolumeValue;
  /** Zona sin volumen: «sello» o «sin hidrocarburo». */
  note?: string;
}

export type UncertaintyState = 'none' | 'fresh' | 'stale';

export interface VolumeData {
  /** Por id de zona. */
  byZone: Readonly<Record<string, ZoneVolume>>;
  total: Partial<Record<VolumeFluid, VolumeValue>>;
  /** Fluidos con alguna zona (petróleo primero). */
  fluids: readonly VolumeFluid[];
  uncertainty: UncertaintyState;
}

/** Máximo de la escala de un fluido sobre las zonas dadas (el mayor de det y P10), con 6 % de aire; NaN si no hay. */
export function volumeMax(data: VolumeData, fluid: VolumeFluid, zoneIds: readonly string[]): number {
  let m = 0;
  for (const id of zoneIds) {
    const v = data.byZone[id]?.[fluid];
    if (!v) continue;
    for (const x of [v.det, v.p10, v.p50, v.p90]) if (x !== undefined && Number.isFinite(x) && x > m) m = x;
  }
  return m > 0 ? m * 1.06 : NaN;
}

/** Fracción (0–1) de un volumen en la escala 0–max; NaN si no se puede ubicar. */
export const volumeFraction = (v: number | undefined, max: number): number => (v !== undefined && Number.isFinite(v) && max > 0 ? Math.min(1, Math.max(0, v / max)) : NaN);

/** Volumen con 3 cifras significativas (sin decimales desde 100), coma decimal; «—» sin dato. */
export const volumeText = (v: number | undefined): string => (v !== undefined && Number.isFinite(v) ? formatNumber(v, Math.abs(v) >= 100 ? { digits: 0 } : { significant: 3 }) : '—');

/** true si la zona tiene P90–P10. */
export const hasRange = (v: VolumeValue | undefined): v is VolumeValue & { p90: number; p10: number } => !!v && Number.isFinite(v.p90) && Number.isFinite(v.p10);

/** Texto del tooltip de un volumen. */
export function volumeTitle(zone: string, fluid: VolumeFluid, v: VolumeValue, state: UncertaintyState): string {
  const u = VOLUME_UNIT[fluid];
  const lines = [`${zone} · ${VOLUME_LABEL[fluid].toLowerCase()}`, `Determinista ${volumeText(v.det)} ${u}`];
  if (hasRange(v)) lines.push(`P90 ${volumeText(v.p90)} · P50 ${volumeText(v.p50)} · P10 ${volumeText(v.p10)} ${u} (P90 = estimación baja)`);
  if (state === 'stale') lines.push('Incertidumbre desactualizada: cambiaron parámetros después del cálculo');
  return lines.join('\n');
}

// ── lectura de las tablas de los módulos ─────────────────────────────────────────────────────────────────────────

type Row = Readonly<Record<string, TableCell>>;

const num = (c: TableCell | undefined): number => (typeof c === 'number' && Number.isFinite(c) ? c : NaN);

const FLUID_OF: Readonly<Record<string, VolumeFluid>> = { Petróleo: 'oil', Gas: 'gas' };

/** Percentiles (campo) de una fila de la tabla UNCERTAINTY. */
function rangeOf(row: Row | undefined): Pick<VolumeValue, 'p90' | 'p50' | 'p10'> {
  if (!row) return {};
  const p90 = num(row['p90Field']);
  const p50 = num(row['p50Field']);
  const p10 = num(row['p10Field']);
  return Number.isFinite(p90) && Number.isFinite(p10) ? { p90, p50, p10 } : {};
}

const fluidOfUnc = (row: Row): VolumeFluid => (row['fieldUnit'] === 'Bcf' ? 'gas' : 'oil');

/**
 * Volumen por zona y total. `volumetrics`: filas de VOLUMETRICS del último resultado (null si no hay resultado o el
 * módulo no corrió → null). `uncertainty`: filas de la copia del Monte Carlo y si está vigente (null = sin calcular).
 */
export function zoneVolumes(
  volumetrics: readonly Row[] | null | undefined,
  zones: readonly { id: string; name: string }[],
  uncertainty: { rows: readonly Row[]; stale: boolean } | null,
): VolumeData | null {
  if (!volumetrics || volumetrics.length === 0) return null;
  const unc = uncertainty?.rows ?? [];
  const byZone: Record<string, ZoneVolume> = {};
  const fluids = new Set<VolumeFluid>();
  for (const z of zones) {
    const r = volumetrics.find((x) => x['zone'] === z.name && x['zone'] !== 'Total');
    if (!r) continue;
    const label = String(r['fluid'] ?? '');
    const fluid = FLUID_OF[label];
    if (!fluid) {
      byZone[z.id] = { note: label === 'Sello' ? 'sello' : 'sin hidrocarburo' };
      continue;
    }
    fluids.add(fluid);
    const det = num(r[fluid === 'oil' ? 'ooipField' : 'ogipField']);
    const u = unc.find((x) => x['key'] === z.id && fluidOfUnc(x) === fluid);
    byZone[z.id] = { [fluid]: { det, ...rangeOf(u) } };
  }
  const tot = volumetrics.find((x) => x['zone'] === 'Total');
  const total: Partial<Record<VolumeFluid, VolumeValue>> = {};
  for (const f of fluids) {
    const det = num(tot?.[f === 'oil' ? 'ooipField' : 'ogipField']);
    total[f] = { det, ...rangeOf(unc.find((x) => x['key'] === (f === 'oil' ? 'TOTAL_OIL' : 'TOTAL_GAS'))) };
  }
  const state: UncertaintyState = !uncertainty || unc.length === 0 ? 'none' : uncertainty.stale ? 'stale' : 'fresh';
  return { byZone, total, fluids: (['oil', 'gas'] as const).filter((f) => fluids.has(f)), uncertainty: state };
}
