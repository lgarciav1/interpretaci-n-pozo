/**
 * Puente entre la serie digitalizada y el modelo del pozo de la app (src/core/well.ts) y los exportadores (src/io/export).
 * Puro (sin DOM): devuelve objetos nuevos y no modifica el pozo recibido.
 *
 * DECISIÓN: el índice de profundidad de la app es COMÚN a todas las curvas de un pozo (`Well.depth`), así que una curva
 * digitalizada entra de dos maneras:
 *   1. `addDigitizedCurveToWell`: se REMUESTREA al índice del pozo existente (NaN fuera del tramo digitalizado, sin
 *      extrapolar; huecos mayores que `maxGapM` → NaN). Falla con un error claro si no hay superposición.
 *   2. `createWellFromDigitized`: se crea un pozo nuevo con un índice UNIFORME (paso en m o ft) que abarca las curvas.
 * La curva resultante es `origin.kind = 'measured'` con fuente «Log Digitizer» (es un dato adquirido, no un cálculo).
 *
 * EXPORTACIÓN: `digitizedExportInput` arma el `ExportInput` que consumen `writeLas` y `writeCsv`.
 */
import type { RoleId } from '../core/roles';
import type { UnitId } from '../core/units';
import { createWell, type Curve, type HeaderEntry, type Well } from '../core/well';
import type { ExportColumn, ExportInput } from '../io/export/types';
import { DigitizerError } from './errors';
import { resampleSeries, uniformDepthGrid, type ResampleOptions } from './sampling';
import type { DigitizedSeries, ImageDepthUnit } from './types';

/** Fuente que queda registrada en `Curve.origin.source`. */
export const DIGITIZER_SOURCE = 'Log Digitizer';

export interface DigitizedCurveMeta {
  /** Id deseado; si ya existe en el pozo se le agrega _2, _3… */
  id: string;
  mnemonic: string;
  /** Unidad de los valores (id de src/core/units.ts: gAPI, ohm.m, g/cm3…). */
  unit: UnitId;
  role?: RoleId | null;
  description?: string;
}

function checkMeta(meta: DigitizedCurveMeta): void {
  if (!meta.id.trim() || !meta.mnemonic.trim()) throw new DigitizerError('invalid-options', 'La curva digitalizada necesita un nombre (id y mnemónico).');
  if (!meta.unit.trim()) throw new DigitizerError('invalid-options', 'La curva digitalizada necesita una unidad.');
}

/** `base` si está libre; si no, base_2, base_3… */
export function uniqueCurveId(existing: readonly string[], base: string): string {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  for (let k = 2; ; k++) if (!used.has(`${base}_${k}`)) return `${base}_${k}`;
}

function makeCurve(id: string, meta: DigitizedCurveMeta, data: Float64Array): Curve {
  return {
    id,
    mnemonic: meta.mnemonic,
    ...(meta.description !== undefined ? { description: meta.description } : { description: 'Digitalizada con Log Digitizer' }),
    role: meta.role ?? null,
    unit: meta.unit,
    data,
    origin: { kind: 'measured', source: DIGITIZER_SOURCE },
  };
}

export interface AddCurveResult {
  well: Well;
  curve: Curve;
  /** Fracción de muestras del pozo con dato en la curva nueva. */
  coverage: number;
  /** Profundidad (m) de la primera y la última muestra con dato. */
  topM: number;
  baseM: number;
}

/**
 * Agrega la serie como curva del pozo, remuestreada a su índice de profundidad. No modifica `well`: devuelve uno nuevo.
 * Lanza `DigitizerError('no-overlap')` si la serie no cae dentro del tramo del pozo.
 */
export function addDigitizedCurveToWell(well: Well, series: DigitizedSeries, meta: DigitizedCurveMeta, opts: ResampleOptions = {}): AddCurveResult {
  checkMeta(meta);
  const data = resampleSeries(series, well.depth.values, opts);
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    if (Number.isNaN(data[i]!)) continue;
    if (first < 0) first = i;
    last = i;
    count++;
  }
  if (count === 0) {
    const n = series.depthM.length;
    const range = n > 0 ? `${series.depthM[0]!.toFixed(1)}–${series.depthM[n - 1]!.toFixed(1)} m` : 'sin puntos';
    const wr = `${well.depth.values[0]!.toFixed(1)}–${well.depth.values[well.depth.values.length - 1]!.toFixed(1)} m`;
    throw new DigitizerError('no-overlap', `La curva digitalizada (${range}) no se superpone con el índice de profundidad del pozo (${wr}). Revisá la calibración de profundidad.`);
  }
  const id = uniqueCurveId(well.curves.map((c) => c.id), meta.id);
  const curve = makeCurve(id, meta, data);
  return {
    well: { ...well, curves: [...well.curves, curve] },
    curve,
    coverage: count / data.length,
    topM: well.depth.values[first]!,
    baseM: well.depth.values[last]!,
  };
}

export interface NewWellInput {
  id: string;
  name: string;
  curves: ReadonlyArray<{ series: DigitizedSeries; meta: DigitizedCurveMeta }>;
  /** Paso del índice uniforme (en `unit`). */
  step: number;
  unit?: ImageDepthUnit;
  /** Tramo del pozo (m); por defecto la unión de los tramos digitalizados. */
  topM?: number;
  baseM?: number;
  header?: Record<string, HeaderEntry>;
  resample?: ResampleOptions;
}

/** Crea un pozo nuevo con un índice de profundidad uniforme que abarca las curvas digitalizadas. */
export function createWellFromDigitized(input: NewWellInput): Well {
  if (input.curves.length === 0) throw new DigitizerError('invalid-options', 'Hace falta al menos una curva digitalizada para crear el pozo.');
  let top = Infinity;
  let base = -Infinity;
  for (const { series } of input.curves) {
    const n = series.depthM.length;
    if (n === 0) continue;
    top = Math.min(top, series.depthM[0]!);
    base = Math.max(base, series.depthM[n - 1]!);
  }
  const topM = input.topM ?? top;
  const baseM = input.baseM ?? base;
  if (!Number.isFinite(topM) || !Number.isFinite(baseM)) throw new DigitizerError('invalid-series', 'Las curvas digitalizadas no tienen puntos: no hay tramo para el pozo.');
  const unit = input.unit ?? 'm';
  const grid = uniformDepthGrid({ step: input.step, unit, topM, baseM });
  if (grid.length === 0) throw new DigitizerError('invalid-series', 'El tramo digitalizado es más corto que el paso del índice: no hay muestras. Reducí el paso.');
  const ids: string[] = [];
  const curves: Curve[] = input.curves.map(({ series, meta }) => {
    checkMeta(meta);
    const id = uniqueCurveId(ids, meta.id);
    ids.push(id);
    return makeCurve(id, meta, resampleSeries(series, grid, input.resample ?? {}));
  });
  return createWell({
    id: input.id,
    name: input.name,
    header: { SRC: { value: DIGITIZER_SOURCE, description: 'Pozo creado a partir de un registro escaneado' }, ...(input.header ?? {}) },
    depth: grid,
    depthSourceUnit: unit,
    curves,
  });
}

export interface ExportOptions {
  wellName: string;
  /** Profundidades (m) comunes a todas las columnas, estrictamente crecientes. */
  depthM: Float64Array;
  columns: ReadonlyArray<{ meta: DigitizedCurveMeta; values: Float64Array }>;
  depthUnit?: ImageDepthUnit;
  nullValue?: number | null;
  header?: Readonly<Record<string, HeaderEntry>>;
  generatedAt?: Date;
}

/** `ExportInput` para `writeLas` / `writeCsv` a partir de curvas digitalizadas ya remuestreadas a `depthM`. */
export function digitizedExportInput(o: ExportOptions): ExportInput {
  const ids: string[] = [];
  const columns: ExportColumn[] = o.columns.map(({ meta, values }) => {
    checkMeta(meta);
    if (values.length !== o.depthM.length) throw new DigitizerError('invalid-series', `La curva '${meta.id}' tiene ${values.length} muestras y la profundidad ${o.depthM.length}.`);
    const id = uniqueCurveId(ids, meta.id);
    ids.push(id);
    return { id, mnemonic: meta.mnemonic, unit: meta.unit, description: meta.description ?? 'Digitalizada con Log Digitizer', data: values, origin: 'measured' as const };
  });
  return {
    wellName: o.wellName,
    ...(o.header ? { header: o.header } : {}),
    depth: o.depthM,
    columns,
    ...(o.depthUnit ? { depthUnit: o.depthUnit } : {}),
    ...(o.nullValue !== undefined ? { nullValue: o.nullValue } : {}),
    ...(o.generatedAt ? { generatedAt: o.generatedAt } : {}),
  };
}
