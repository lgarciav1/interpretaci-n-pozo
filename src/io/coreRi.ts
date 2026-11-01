/**
 * Tablas de índice de resistividad de corona (ensayo de desaturación RI–Sw) → conjunto de puntos del pozo
 * (`PointSet`, kind 'core-ri'). Decisión: docs/decisiones/0053-exponente-de-saturacion-desde-corona.md.
 * Mismo esquema de dos etapas que los plugs (`./core.ts`):
 *   parseTable(archivo, nombre, { requireDepth: false })   → RawTable (Excel, CSV o LAS)
 *   suggestRiMapping(tabla)                                → qué es cada columna (editable en el asistente)
 *   buildRiSet(tabla, mapeo, opciones)                     → { set, warnings }
 *
 * Una fila por PASO de desaturación (un plug tiene muchos): por eso es un conjunto propio y no columnas del de plugs.
 * Columnas reconocidas por nombre (sin tildes): saturación de agua (SW, «Water Saturation», «Saturación», «Sw fraction
 * pv»; en fracción o %), índice de resistividad (RI, IR, «Resistivity Index», «Índice de resistividad», «Rt/Ro»), o en
 * su lugar Rt y Ro (RI = Rt/Ro), id del plug o muestra (PLUG, MUESTRA, SAMPLE, ID), profundidad (opcional) y el
 * exponente n del laboratorio (opcional, solo para comparar: se guarda en valor absoluto porque el laboratorio informa
 * la pendiente, −n).
 *
 * Unidades canónicas: Sw en v/v (una columna sin unidad cuyo máximo pasa de 1,5 se toma como %), RI adimensional,
 * profundidad en m. La profundidad es OPCIONAL: el núcleo exige una profundidad finita por punto, así que sin dato el
 * conjunto guarda 0 m y la profundidad conocida va en la columna `md` (NaN = sin dato). Ningún consumidor ubica estos
 * puntos en el visor. Puro: corre en Node, navegador y worker.
 */
import { createPointSet, type PointColumn, type PointSet } from '../core/pointSets';
import { convertArray, getUnit, parseUnit, unitLabel, type DimensionId, type UnitId } from '../core/units';
import type { Confidence } from './mnemonics';
import { normalizeColumnName, splitUnitSuffix, unitTextOf } from './pressures';
import type { RawColumn, RawTable } from './table';

export type RiField = 'sw' | 'ri' | 'rt' | 'ro' | 'plug' | 'depth' | 'nlab' | 'ignore';

export const CORE_RI_SET_KIND = 'core-ri';

/** Claves de columna del conjunto (las usa el panel «Calibración»). No cambiarlas: se guardan en el proyecto. */
export const CORE_RI_COLUMNS = {
  sw: 'sw',
  ri: 'ri',
  plug: 'plug',
  /** Profundidad del archivo (m), NaN sin dato. Solo si la tabla trae profundidad. */
  md: 'md',
  /** |n| informado por el laboratorio (opcional, para comparar). */
  nLab: 'nLab',
} as const;

export const RI_FIELD_LABEL: Readonly<Record<RiField, string>> = {
  sw: 'Saturación de agua (Sw)',
  ri: 'Índice de resistividad (RI)',
  rt: 'Resistividad Rt del plug',
  ro: 'Resistividad Ro (100 % agua)',
  plug: 'Id del plug / muestra',
  depth: 'Profundidad',
  nlab: 'n del laboratorio',
  ignore: 'Ignorar',
};

export const RI_FIELD_DIMENSION: Partial<Record<RiField, DimensionId>> = {
  sw: 'fraction',
  ri: 'dimensionless',
  rt: 'resistivity',
  ro: 'resistivity',
  depth: 'length',
  nlab: 'dimensionless',
};

const CANONICAL: Partial<Record<RiField, UnitId>> = { sw: 'v/v', ri: 'unitless', rt: 'ohm.m', ro: 'ohm.m', depth: 'm', nlab: 'unitless' };
const TEXT_FIELDS: ReadonlySet<RiField> = new Set(['plug']);
const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1, none: 0 };

export interface RiColumnMapping {
  column: number;
  name: string;
  rawUnit: string;
  kind: RawColumn['kind'];
  field: RiField;
  /** Unidad de los datos (campos numéricos). */
  unit: UnitId | null;
  confidence: Confidence;
}

/** Campo por el nombre (y confianza), o null si el nombre no dice nada. */
function fieldByName(raw: string): { field: RiField; confidence: Confidence } | null {
  const whole = normalizeColumnName(raw);
  const n = normalizeColumnName(splitUnitSuffix(raw).name);
  const t = new Set([...n.split(/[_/]+/), ...whole.split(/[_/]+/)].filter(Boolean));
  const has = (...w: string[]) => w.some((x) => t.has(x));
  const starts = (...w: string[]) => w.some((x) => n.startsWith(x) || whole.startsWith(x));
  // «Rt/Ro» es el índice, no Rt ni Ro.
  if (/(^|_)RT\/RO($|_)/.test(whole) || has('RI', 'IR', 'RESISTIVITYINDEX', 'INDICERESISTIVIDAD') || starts('RESISTIVITY_INDEX', 'INDICE_DE_RESISTIVIDAD', 'INDICE_RESISTIVIDAD', 'RES_INDEX')) {
    return { field: 'ri', confidence: 'high' };
  }
  if (has('SW', 'SWT', 'SAT', 'SATURACION', 'SATURATION', 'SWATER') || starts('WATER_SAT', 'SATURACION', 'SATURATION', 'SW_')) return { field: 'sw', confidence: 'high' };
  if (has('RO', 'R0', 'RO100') || starts('RO_', 'R100')) return { field: 'ro', confidence: 'high' };
  if (has('RT', 'RTRUE') || starts('RT_')) return { field: 'rt', confidence: 'high' };
  if (has('DEPTH', 'DEPT', 'MD', 'PROF', 'PROFUNDIDAD', 'COTA', 'MDKB') || starts('PROFUND', 'MEASURED')) return { field: 'depth', confidence: 'high' };
  if (has('NLAB', 'N_LAB', 'SATURATIONEXPONENT') || starts('SATURATION_EXP', 'EXPONENTE_DE_SAT', 'EXPONENTE_N', 'SAT_EXP')) return { field: 'nlab', confidence: 'high' };
  if (whole === 'N') return { field: 'nlab', confidence: 'medium' };
  if (has('PLUG', 'MUESTRA', 'SAMPLE', 'ID', 'TAPON', 'MUESTRAS', 'SAMPLES')) return { field: 'plug', confidence: 'high' };
  return null;
}

function maxOf(col: RawColumn | undefined): number {
  let m = -Infinity;
  if (col?.numbers) for (const v of col.numbers) if (Number.isFinite(v) && v > m) m = v;
  return m;
}

/** Unidad de un campo numérico: la del archivo si encaja con la magnitud; si no, la canónica (Sw: % si parece %). */
function unitFor(field: RiField, rawUnit: string, col: RawColumn | undefined): UnitId | null {
  const dim = RI_FIELD_DIMENSION[field];
  if (!dim) return null;
  const raw = rawUnit.trim();
  const u = raw ? parseUnit(raw) : null;
  if (u && getUnit(u)?.dimension === dim) return u;
  if (field === 'sw') return maxOf(col) > 1.5 ? '%' : 'v/v';
  return CANONICAL[field] ?? null;
}

/** Mapeo sugerido. Cada campo va a UNA columna: la de mayor confianza (empate: la primera). */
export function suggestRiMapping(table: RawTable): RiColumnMapping[] {
  const candidates = table.columns.map((col, i) => {
    const byName = fieldByName(col.name) ?? (col.description ? fieldByName(col.description) : null);
    let field: RiField = 'ignore';
    let confidence: Confidence = 'none';
    if (byName && (TEXT_FIELDS.has(byName.field) || col.kind === 'numeric')) {
      field = byName.field;
      confidence = byName.confidence;
    }
    return { column: i, field, confidence };
  });
  const winner = new Map<RiField, number>();
  for (const c of candidates) {
    if (c.field === 'ignore') continue;
    const prev = winner.get(c.field);
    if (prev === undefined || RANK[c.confidence] > RANK[candidates[prev]!.confidence]) winner.set(c.field, c.column);
  }
  return table.columns.map((col, i) => {
    const c = candidates[i]!;
    const field = c.field !== 'ignore' && winner.get(c.field) === i ? c.field : 'ignore';
    return { column: i, name: col.name, rawUnit: col.unit, kind: col.kind, field, unit: unitFor(field, unitTextOf(col), col), confidence: field === 'ignore' ? 'none' : c.confidence };
  });
}

/** Unidad sugerida al elegir un campo a mano en el asistente. */
export function riFieldUnit(field: RiField, table: RawTable, column: number): UnitId | null {
  const col = table.columns[column];
  return unitFor(field, col ? unitTextOf(col) : '', col);
}

export interface BuildRiOptions {
  /** Id del conjunto (único en el pozo). */
  id: string;
  name?: string;
}

export interface BuildRiResult {
  set: PointSet;
  warnings: string[];
  /** Filas descartadas por no tener Sw o RI. */
  dropped: number;
}

/** Construye el conjunto RI–Sw con el mapeo dado. Lanza un Error en español si falta lo indispensable. */
export function buildRiSet(table: RawTable, mapping: readonly RiColumnMapping[], opts: BuildRiOptions): BuildRiResult {
  const warnings: string[] = [];
  const byField = new Map<RiField, RiColumnMapping>();
  for (const m of mapping) {
    if (m.field === 'ignore') continue;
    if (byField.has(m.field)) {
      warnings.push(`Hay dos columnas marcadas como «${RI_FIELD_LABEL[m.field]}»: se usa '${byField.get(m.field)!.name}' y se ignora '${m.name}'.`);
      continue;
    }
    byField.set(m.field, m);
  }
  const swMap = byField.get('sw');
  if (!swMap) throw new Error('Falta la columna de saturación de agua (Sw). Marcala en el paso Columnas.');
  const riMap = byField.get('ri');
  const rtMap = byField.get('rt');
  const roMap = byField.get('ro');
  if (!riMap && !(rtMap && roMap)) throw new Error('Falta el índice de resistividad (RI), o en su lugar Rt y Ro del plug. Marcalos en el paso Columnas.');

  const numeric = (m: RiColumnMapping): Float64Array => {
    const canonical = CANONICAL[m.field]!;
    const col = table.columns[m.column];
    if (!col || col.kind !== 'numeric' || !col.numbers) throw new Error(`La columna '${m.name}' (${RI_FIELD_LABEL[m.field]}) no es numérica.`);
    const from = m.unit ?? canonical;
    if (getUnit(from)?.dimension !== getUnit(canonical)?.dimension) throw new Error(`La unidad '${unitLabel(from)}' no sirve para ${RI_FIELD_LABEL[m.field].toLowerCase()}.`);
    return convertArray(col.numbers, from, canonical);
  };
  const text = (m: RiColumnMapping): string[] => {
    const col = table.columns[m.column]!;
    if (col.kind === 'text') return col.text!.map((s) => s.trim());
    return Array.from(col.numbers!, (v) => (Number.isFinite(v) ? String(v) : ''));
  };

  const swAll = numeric(swMap);
  let riAll: Float64Array;
  if (riMap) riAll = numeric(riMap);
  else {
    const rt = numeric(rtMap!);
    const ro = numeric(roMap!);
    riAll = Float64Array.from(rt, (v, i) => (v > 0 && ro[i]! > 0 && Number.isFinite(v) && Number.isFinite(ro[i]!) ? v / ro[i]! : NaN));
    warnings.push('El índice de resistividad se calculó como Rt/Ro de cada fila.');
  }
  const keep: number[] = [];
  for (let i = 0; i < table.rowCount; i++) if (Number.isFinite(swAll[i]!) && Number.isFinite(riAll[i]!)) keep.push(i);
  const dropped = table.rowCount - keep.length;
  if (dropped > 0) warnings.push(`${dropped} ${dropped === 1 ? 'fila no tiene' : 'filas no tienen'} Sw o RI: se ${dropped === 1 ? 'descarta' : 'descartan'}.`);
  if (keep.length === 0) throw new Error('Ninguna fila tiene Sw y RI: no hay pasos de desaturación para cargar.');
  const pickNum = (a: Float64Array) => Float64Array.from(keep, (i) => a[i]!);

  const sw = pickNum(swAll);
  const ri = pickNum(riAll);
  let over = 0;
  let bad = 0;
  for (let k = 0; k < sw.length; k++) {
    if (sw[k]! > 1) over++;
    if (!(sw[k]! > 0) || !(ri[k]! > 0)) bad++;
  }
  if (over) warnings.push(`${over} ${over === 1 ? 'paso tiene' : 'pasos tienen'} Sw mayor que 1 v/v: ¿la columna está en %? Elegí la unidad en el paso Columnas.`);
  if (bad) warnings.push(`${bad} ${bad === 1 ? 'paso tiene' : 'pasos tienen'} Sw o RI no positivos: no entran en el ajuste.`);

  const columns: Record<string, PointColumn> = {
    [CORE_RI_COLUMNS.sw]: { label: 'Saturación de agua', unit: 'v/v', values: sw },
    [CORE_RI_COLUMNS.ri]: { label: 'Índice de resistividad', unit: 'unitless', values: ri },
  };
  const nMap = byField.get('nlab');
  if (nMap) {
    const nl = pickNum(numeric(nMap));
    if (nl.some((v) => v < 0)) warnings.push('La columna n del laboratorio trae valores negativos (es la pendiente, −n): se toma su valor absoluto.');
    columns[CORE_RI_COLUMNS.nLab] = { label: 'n del laboratorio', unit: 'unitless', values: nl.map(Math.abs) };
  }
  const depthMap = byField.get('depth');
  let depth = new Float64Array(keep.length);
  if (depthMap) {
    const md = pickNum(numeric(depthMap));
    columns[CORE_RI_COLUMNS.md] = { label: 'Profundidad', unit: 'm', values: md };
    depth = md.map((v) => (Number.isFinite(v) ? v : 0));
  }

  // Plug de cada paso: el de la columna, o uno solo con el nombre del conjunto. Ids de punto: «plug·01», «plug·02»…
  const name = opts.name?.trim() || table.sourceName.replace(/\.[^.]+$/, '') || 'Índice de resistividad';
  const plugMap = byField.get('plug');
  const plugText = plugMap ? text(plugMap) : null;
  const rawPlugs = plugText ? keep.map((i) => plugText[i]!) : null;
  const plugs = keep.map((_, k) => rawPlugs?.[k] || (plugMap ? 'Sin id' : 'Muestra'));
  if (!plugMap) warnings.push('La tabla no tiene id de plug: todos los pasos se toman como una sola muestra.');
  columns[CORE_RI_COLUMNS.plug] = { label: 'Plug', values: plugs };
  const step = new Map<string, number>();
  const ids = plugs.map((p) => {
    const k = (step.get(p) ?? 0) + 1;
    step.set(p, k);
    return `${p}·${String(k).padStart(2, '0')}`;
  });

  const set = createPointSet({ id: opts.id, kind: CORE_RI_SET_KIND, name, source: table.sourceName, depth, pointIds: ids, columns });
  return { set, warnings, dropped };
}
