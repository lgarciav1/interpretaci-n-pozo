/**
 * De las trazas a datos: serie física (con suavizado y quitar picos opcionales), calidad, metadatos de importación con
 * su política de conflictos, pozo existente / pozo nuevo y exportación LAS/CSV (docs/decisiones/0063). Puro.
 */
import {
  addDigitizedCurveToWell,
  assessQuality,
  createWellFromDigitized,
  digitizedExportInput,
  medianFilter,
  removeSpikes,
  resampleSeries,
  traceToSeries,
  uniformDepthGrid,
  type AddCurveResult,
  type DepthCalibration,
  type DigitizedCurveMeta,
  type DigitizedSeries,
  type ImageDepthUnit,
  type QualityReport,
} from '../../../digitizer';
import type { RoleId } from '../../../core/roles';
import type { Well } from '../../../core/well';
import type { ExportInput } from '../../../io/export/types';
import { frameOf, type CurveDraft } from './form';

/** Serie física de una curva (null si falta calibración, marco o traza). Suavizado y picos: solo si se piden. */
export function seriesOf(c: CurveDraft, cal: DepthCalibration | null): DigitizedSeries | null {
  if (!cal || !c.trace) return null;
  const { frame } = frameOf(c);
  if (!frame) return null;
  let s = traceToSeries(c.trace, cal, frame);
  if (s.depthM.length === 0) return s;
  if (c.despike) s = removeSpikes(s, { mode: 'remove' });
  if (c.median > 1 && s.depthM.length >= c.median) s = medianFilter(s, c.median);
  return s;
}

export function qualityOf(c: CurveDraft, cal: DepthCalibration | null): QualityReport | null {
  if (!cal || !c.trace) return null;
  const { frame } = frameOf(c);
  if (!frame) return null;
  return assessQuality(c.trace, cal, frame);
}

export const QUALITY_LABEL: Record<QualityReport['level'], string> = { good: 'Buena', warning: 'Revisar', poor: 'Mala' };
export const QUALITY_TONE: Record<QualityReport['level'], 'ok' | 'warn' | 'error'> = { good: 'ok', warning: 'warn', poor: 'error' };

// ---------------------------------------------------------------------------------------------------------------
// Metadatos al importar: roles y mnemónicos repetidos

export interface ImportChoice {
  /** Conservar el rol aunque el pozo ya tenga una curva con ese rol. */
  keepRole: boolean;
}

export interface ImportPlan {
  meta: DigitizedCurveMeta;
  /** Explicaciones de lo que se ajustó (en español). */
  notes: string[];
  /** El pozo ya tiene una curva con el rol de la digitalizada. */
  roleConflict: string | null;
}

/** Mnemónico libre: el pedido, o con sufijo _DIG (_DIG2, …) si el pozo ya tiene uno igual. */
export function freeMnemonic(used: readonly string[], base: string): string {
  const set = new Set(used.map((m) => m.toUpperCase()));
  if (!set.has(base.toUpperCase())) return base;
  for (let k = 1; ; k++) {
    const m = `${base}_DIG${k === 1 ? '' : k}`;
    if (!set.has(m.toUpperCase())) return m;
  }
}

/**
 * Política por defecto (decisión 0063): si el pozo ya tiene una curva con ese rol, la digitalizada entra SIN rol (los
 * cálculos no cambian solos) salvo que la persona pida conservarlo; si el mnemónico existe, se agrega «_DIG».
 */
export function importPlan(c: CurveDraft, well: Well | null, choice: ImportChoice = { keepRole: false }): ImportPlan {
  const notes: string[] = [];
  const base = (c.mnemonic || c.id).trim();
  const used = well ? well.curves.flatMap((k) => [k.mnemonic, k.id]) : [];
  const mnemonic = freeMnemonic(used, base);
  if (mnemonic !== base) notes.push(`El pozo ya tiene una curva ${base}: entra como ${mnemonic}.`);
  let role: RoleId | null = c.role;
  let roleConflict: string | null = null;
  if (role && well) {
    const other = well.curves.find((k) => k.role === role);
    if (other) {
      roleConflict = other.mnemonic;
      if (!choice.keepRole) {
        notes.push(`El pozo ya usa ${other.mnemonic} como ${role}: la digitalizada entra sin rol para no cambiar los cálculos.`);
        role = null;
      } else {
        notes.push(`Con rol ${role}: el motor sigue usando ${other.mnemonic} por defecto; elegí la digitalizada como fuente si querés usarla.`);
      }
    }
  }
  return {
    meta: { id: mnemonic, mnemonic, unit: c.unit, role, description: c.description.trim() || 'Digitalizada con Log Digitizer' },
    notes,
    roleConflict,
  };
}

export interface ImportItem {
  series: DigitizedSeries;
  meta: DigitizedCurveMeta;
}

/** Agrega todas las curvas al pozo (remuestreadas a su índice). Lanza `DigitizerError('no-overlap')` en español. */
export function addCurvesToWell(well: Well, items: readonly ImportItem[]): { well: Well; added: AddCurveResult[] } {
  let w = well;
  const added: AddCurveResult[] = [];
  for (const it of items) {
    const r = addDigitizedCurveToWell(w, it.series, it.meta);
    w = r.well;
    added.push(r);
  }
  return { well: w, added };
}

export function newWellFrom(items: readonly ImportItem[], o: { id: string; name: string; step: number; unit: ImageDepthUnit; imageName?: string }): Well {
  return createWellFromDigitized({
    id: o.id,
    name: o.name,
    step: o.step,
    unit: o.unit,
    curves: items,
    ...(o.imageName ? { header: { IMG: { value: o.imageName, description: 'Imagen digitalizada' } } } : {}),
  });
}

/** Entrada para `writeLas`/`writeCsv`: todas las curvas en una grilla uniforme común (unión de los tramos). */
export function exportInputFor(items: readonly ImportItem[], o: { wellName: string; step: number; unit: ImageDepthUnit; generatedAt?: Date }): ExportInput {
  let top = Infinity;
  let base = -Infinity;
  for (const { series } of items) {
    const n = series.depthM.length;
    if (n === 0) continue;
    top = Math.min(top, series.depthM[0]!);
    base = Math.max(base, series.depthM[n - 1]!);
  }
  if (!Number.isFinite(top)) throw new Error('Las curvas no tienen puntos digitalizados para exportar.');
  const depthM = uniformDepthGrid({ step: o.step, unit: o.unit, topM: top, baseM: base });
  return digitizedExportInput({
    wellName: o.wellName,
    depthM,
    depthUnit: o.unit,
    columns: items.map((it) => ({ meta: it.meta, values: resampleSeries(it.series, depthM) })),
    header: { SRC: { value: 'Log Digitizer', description: 'Curvas digitalizadas de un registro escaneado' } },
    ...(o.generatedAt ? { generatedAt: o.generatedAt } : {}),
  });
}
