/** Decodificación pura compartida por el panel y la pista; no recalcula clasificación. */
import type { ReadonlyTableValue } from '../../core/module';
import { SED_LITHOLOGY_LABELS, SED_GRAIN_LABELS, type SedLayer, type SedLithology, type SedGrain, type SedSource } from '../../petro/sedColumn';
export { SED_LITHOLOGY_LABELS, SED_GRAIN_LABELS, SED_COLUMN_DEFAULTS } from '../../petro/sedColumn';
export type { SedLayer, SedLithology, SedGrain } from '../../petro/sedColumn';
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const SOURCES: readonly string[] = ['minerals', 'vsh', 'gr', 'coal', 'shale', 'unknown', 'mixed'];
export function decodeSedLayers(table: ReadonlyTableValue | undefined): SedLayer[] {
  return (table?.rows ?? []).flatMap(row => {
    const top = number(row.top), base = number(row.base), width = number(row.width);
    if (top === null || base === null || base <= top || width === null || width < 0 || width > 1 || typeof row.lithology !== 'string' || !Object.hasOwn(SED_LITHOLOGY_LABELS, row.lithology) || typeof row.grain !== 'string' || !Object.hasOwn(SED_GRAIN_LABELS, row.grain)) return [];
    return [{ top, base, thickness: base - top, width, lithology: row.lithology as SedLithology, grain: row.grain as SedGrain,
      zoneId: typeof row.zoneId === 'string' ? row.zoneId : null, source: SOURCES.includes(String(row.source)) ? row.source as SedSource : 'unknown', belowMinimum: row.belowMinimum === 1,
      quartz: number(row.quartz), calcite: number(row.calcite), dolomite: number(row.dolomite), clay: number(row.clay), phi: number(row.phi), vsh: number(row.vsh) }];
  });
}
export interface SedSummary { zoneId: string | null; zone: string; lithology: SedLithology; thickness: number; percent: number; layerCount: number }
export function decodeSedSummary(table: ReadonlyTableValue | undefined): SedSummary[] {
  return (table?.rows ?? []).flatMap(r => typeof r.zone === 'string' && typeof r.lithology === 'string' && Object.hasOwn(SED_LITHOLOGY_LABELS, r.lithology) && number(r.thickness) !== null ? [{ zoneId: typeof r.zoneId === 'string' ? r.zoneId : null, zone: r.zone, lithology: r.lithology as SedLithology, thickness: number(r.thickness)!, percent: number(r.percent) ?? 0, layerCount: number(r.layerCount) ?? 0 }] : []);
}
