/**
 * Tablas de plugs de corona → conjunto de puntos del pozo (`PointSet`, kind 'core').
 * Decisión: docs/decisiones/0010-datos-de-corona.md (D2). Mismo esquema de dos etapas que las presiones:
 *   parseTable(archivo, nombre, { requireDepth: false })   → RawTable (Excel, CSV o LAS)
 *   suggestCoreMapping(tabla)                              → qué es cada columna (editable en el asistente)
 *   buildCoreSet(tabla, mapeo, opciones)                   → { set, warnings }
 *
 * Columnas reconocidas (por nombre sin tildes; si no alcanza, por unidad): profundidad (DEPTH, PROF, MD…),
 * porosidad (PHI, POR, POROSIDAD, CPOR, PHIHE…; en % o v/v), permeabilidad (K, PERM, KAIR, KLINK, KH…; mD o D),
 * densidad de grano (RHOG, GD, GRAIN DENSITY, DENSIDAD DE GRANO…), número de corona o corrida (CORE, CORONA, RUN,
 * CORRIDA), id del plug (PLUG, MUESTRA, SAMPLE, ID) y descripción (DESC, LITOLOGIA, OBS…). Si dos columnas dicen
 * ser permeabilidad, gana la de mayor confianza (Klinkenberg antes que aire; la vertical se ignora).
 *
 * Unidades canónicas del conjunto: profundidad m, φ v/v, k mD, densidad de grano g/cm³. Una porosidad sin unidad cuyo
 * máximo pasa de 1,5 se toma como % (las planillas de laboratorio la informan así). Filas sin profundidad: se
 * descartan con aviso. Puro: corre en Node, navegador y worker.
 */
import { createPointSet, RUN_COLUMN, type PointColumn, type PointSet } from '../core/pointSets';
import { convertArray, getUnit, parseUnit, unitLabel, type DimensionId, type UnitId } from '../core/units';
import type { Confidence } from './mnemonics';
import { normalizeColumnName } from './pressures';
import type { RawColumn, RawTable } from './table';

export type CoreField = 'depth' | 'phi' | 'k' | 'rhog' | 'run' | 'plug' | 'description' | 'ignore';

/** Claves de columna del conjunto (las usa el módulo de corona). La profundidad va en `PointSet.depth`. */
export const CORE_COLUMNS = {
  phi: 'phi',
  k: 'k',
  rhog: 'rhog',
  run: RUN_COLUMN,
  description: 'description',
} as const;

export const CORE_SET_KIND = 'core';
export const CORE_UNITS = { depth: 'm', phi: 'v/v', k: 'mD', rhog: 'g/cm3' } as const satisfies Record<string, UnitId>;

export const CORE_FIELD_LABEL: Readonly<Record<CoreField, string>> = {
  depth: 'Profundidad',
  phi: 'Porosidad',
  k: 'Permeabilidad',
  rhog: 'Densidad de grano',
  run: 'Corona / corrida',
  plug: 'Id del plug',
  description: 'Descripción',
  ignore: 'Ignorar',
};

export const CORE_FIELD_DIMENSION: Partial<Record<CoreField, DimensionId>> = {
  depth: 'length',
  phi: 'fraction',
  k: 'permeability',
  rhog: 'density',
};

const TEXT_FIELDS: ReadonlySet<CoreField> = new Set(['run', 'plug', 'description']);

export interface CoreColumnMapping {
  column: number;
  name: string;
  rawUnit: string;
  kind: RawColumn['kind'];
  field: CoreField;
  /** Unidad de los datos (campos numéricos). */
  unit: UnitId | null;
  confidence: Confidence;
}

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1, none: 0 };

/** Campo por el nombre (y confianza), o null si el nombre no dice nada. */
function fieldByName(name: string): { field: CoreField; confidence: Confidence } | null {
  const n = normalizeColumnName(name);
  const t = new Set(n.split(/[_/]+/).filter(Boolean));
  const has = (...w: string[]) => w.some((x) => t.has(x));
  const starts = (...w: string[]) => w.some((x) => n.startsWith(x));
  // Densidad de grano antes que profundidad o porosidad («GRAIN DENSITY», «Densidad de grano»).
  if (has('RHOG', 'GD', 'GDEN', 'RHOMA', 'DGRANO', 'GRAIN', 'GRANO', 'RHO_G', 'MATRIX') || starts('RHOG', 'RHO_G', 'GRAIN_DEN', 'DENSIDAD_DE_GRANO', 'DENS_GRANO')) return { field: 'rhog', confidence: 'high' };
  if (has('DEPTH', 'DEPT', 'MD', 'PROF', 'PROFUNDIDAD', 'COTA', 'MDKB') || starts('PROFUND', 'MEASURED')) return { field: 'depth', confidence: 'high' };
  // Vertical: no es la k del modelo (horizontal); se ignora salvo que el usuario la elija.
  if (has('KV', 'KVERT', 'KVERTICAL', 'VERTICAL') || starts('KV_', 'K_V')) return null;
  if (has('PHI', 'POR', 'PORO', 'POROSIDAD', 'POROSITY', 'CPOR', 'CPHI', 'PHIC', 'PHIHE', 'PHI_HE', 'HEPOR', 'PHICORE') || starts('PHI', 'PORO', 'CPOR')) {
    return { field: 'phi', confidence: 'high' };
  }
  if (has('KLINK', 'KL', 'KLINKENBERG', 'KKLINK')) return { field: 'k', confidence: 'high' };
  // Al aire: sirve, pero si también está la corregida por Klinkenberg, gana esa.
  if (has('KAIR', 'KA', 'AIR', 'AIRE', 'KAIRE') || starts('KAIR')) return { field: 'k', confidence: 'medium' };
  if (has('K', 'PERM', 'PERMEABILIDAD', 'PERMEABILITY', 'KH', 'KHOR', 'KMAX', 'KCORE', 'CPERM', 'KPLUG') || starts('PERM', 'KH_')) return { field: 'k', confidence: 'high' };
  if (has('CORE', 'CORONA', 'RUN', 'CORRIDA', 'CORENO', 'CORE#') || starts('CORE', 'CORON')) return { field: 'run', confidence: 'high' };
  if (has('DESC', 'DESCRIPCION', 'DESCRIPTION', 'LITO', 'LITOLOGIA', 'LITHOLOGY', 'LITH', 'OBS', 'OBSERVACIONES', 'COMENTARIO', 'COMENTARIOS', 'COMMENT', 'COMMENTS', 'REMARKS', 'NOTAS')) {
    return { field: 'description', confidence: 'high' };
  }
  if (has('PLUG', 'MUESTRA', 'SAMPLE', 'ID', 'NRO', 'N', 'NO', 'NUMERO', 'TAPON')) return { field: 'plug', confidence: 'high' };
  return null;
}

/** Máximo finito de una columna numérica (−∞ si no hay). */
function maxOf(col: RawColumn): number {
  let m = -Infinity;
  if (col.numbers) for (const v of col.numbers) if (Number.isFinite(v) && v > m) m = v;
  return m;
}

/** Unidad de un campo numérico: la del archivo si encaja con la magnitud; si no, la canónica (φ: % si parece %). */
function unitFor(field: CoreField, rawUnit: string, col: RawColumn | undefined): UnitId | null {
  const dim = CORE_FIELD_DIMENSION[field];
  if (!dim) return null;
  const raw = rawUnit.trim();
  const u = raw ? parseUnit(raw) : null;
  // «MD» en una columna de profundidad es «measured depth», no milidarcy.
  if (u && getUnit(u)?.dimension === dim) return u;
  if (field === 'phi') return col && maxOf(col) > 1.5 ? '%' : 'v/v';
  return CORE_UNITS[field as keyof typeof CORE_UNITS];
}

/** Mapeo sugerido. Cada campo va a UNA columna: la de mayor confianza (empate: la primera). */
export function suggestCoreMapping(table: RawTable): CoreColumnMapping[] {
  const candidates = table.columns.map((col, i) => {
    const byName = fieldByName(col.name) ?? (col.description ? fieldByName(col.description) : null);
    let field: CoreField = 'ignore';
    let confidence: Confidence = 'none';
    if (byName) {
      const numericField = !TEXT_FIELDS.has(byName.field);
      // Un campo numérico en una columna de texto no encaja; corona, plug y descripción aceptan números.
      if (!numericField || col.kind === 'numeric') {
        field = byName.field;
        confidence = byName.confidence;
      }
    }
    if (field === 'ignore' && col.kind === 'numeric') {
      const u = parseUnit(col.unit.trim());
      const dim = u ? getUnit(u)?.dimension : undefined;
      if (dim === 'permeability') {
        field = 'k';
        confidence = 'medium';
      } else if (dim === 'density') {
        field = 'rhog';
        confidence = 'low';
      }
    }
    return { column: i, field, confidence };
  });
  const winner = new Map<CoreField, number>();
  for (const c of candidates) {
    if (c.field === 'ignore') continue;
    const prev = winner.get(c.field);
    if (prev === undefined || RANK[c.confidence] > RANK[candidates[prev]!.confidence]) winner.set(c.field, c.column);
  }
  const out: CoreColumnMapping[] = table.columns.map((col, i) => {
    const c = candidates[i]!;
    const field = c.field !== 'ignore' && winner.get(c.field) === i ? c.field : 'ignore';
    return { column: i, name: col.name, rawUnit: col.unit, kind: col.kind, field, unit: unitFor(field, col.unit, col), confidence: field === 'ignore' ? 'none' : c.confidence };
  });
  if (!winner.has('depth')) {
    const k = table.depthColumn >= 0 && out[table.depthColumn]?.field === 'ignore' ? table.depthColumn : out.findIndex((m) => m.field === 'ignore' && m.kind === 'numeric');
    if (k >= 0) out[k] = { ...out[k]!, field: 'depth', unit: unitFor('depth', out[k]!.rawUnit, table.columns[k]), confidence: 'low' };
  }
  return out;
}

/** Unidad sugerida al elegir un campo a mano en el asistente. */
export function coreFieldUnit(field: CoreField, table: RawTable, column: number): UnitId | null {
  return unitFor(field, table.columns[column]?.unit ?? '', table.columns[column]);
}

export interface BuildCoreOptions {
  /** Id del conjunto (único en el pozo). */
  id: string;
  name?: string;
}

export interface BuildCoreResult {
  set: PointSet;
  warnings: string[];
  /** Filas descartadas por no tener profundidad. */
  dropped: number;
}

/** Construye el conjunto de plugs con el mapeo dado. Lanza un Error en español si falta lo indispensable. */
export function buildCoreSet(table: RawTable, mapping: readonly CoreColumnMapping[], opts: BuildCoreOptions): BuildCoreResult {
  const warnings: string[] = [];
  const byField = new Map<CoreField, CoreColumnMapping>();
  for (const m of mapping) {
    if (m.field === 'ignore') continue;
    if (byField.has(m.field)) {
      warnings.push(`Hay dos columnas marcadas como «${CORE_FIELD_LABEL[m.field]}»: se usa '${byField.get(m.field)!.name}' y se ignora '${m.name}'.`);
      continue;
    }
    byField.set(m.field, m);
  }
  const depthMap = byField.get('depth');
  if (!depthMap) throw new Error('Falta la columna de profundidad. Marcala en el paso Columnas.');
  if (!byField.has('phi') && !byField.has('k')) throw new Error('Hace falta al menos la porosidad o la permeabilidad de los plugs. Marcalas en el paso Columnas.');

  const numeric = (m: CoreColumnMapping, canonical: UnitId): Float64Array => {
    const col = table.columns[m.column];
    if (!col || col.kind !== 'numeric' || !col.numbers) throw new Error(`La columna '${m.name}' (${CORE_FIELD_LABEL[m.field]}) no es numérica.`);
    const from = m.unit ?? canonical;
    if (getUnit(from)?.dimension !== getUnit(canonical)?.dimension) throw new Error(`La unidad '${unitLabel(from)}' no sirve para ${CORE_FIELD_LABEL[m.field].toLowerCase()}.`);
    return convertArray(col.numbers, from, canonical);
  };
  const text = (m: CoreColumnMapping): string[] => {
    const col = table.columns[m.column]!;
    if (col.kind === 'text') return col.text!.map((s) => s.trim());
    return Array.from(col.numbers!, (v) => (Number.isFinite(v) ? String(v) : ''));
  };

  const depthAll = numeric(depthMap, 'm');
  const keep: number[] = [];
  for (let i = 0; i < table.rowCount; i++) if (Number.isFinite(depthAll[i]!)) keep.push(i);
  const dropped = table.rowCount - keep.length;
  if (dropped > 0) warnings.push(`${dropped} ${dropped === 1 ? 'fila no tiene' : 'filas no tienen'} profundidad: se ${dropped === 1 ? 'descarta' : 'descartan'}.`);
  if (keep.length === 0) throw new Error('Ninguna fila tiene profundidad: no hay plugs para cargar.');
  const pickNum = (a: Float64Array) => Float64Array.from(keep, (i) => a[i]!);
  const pickText = (a: string[]) => keep.map((i) => a[i]!);

  const columns: Record<string, PointColumn> = {};
  const numericFields: [CoreField, string, UnitId, string][] = [
    ['phi', CORE_COLUMNS.phi, CORE_UNITS.phi, 'Porosidad'],
    ['k', CORE_COLUMNS.k, CORE_UNITS.k, 'Permeabilidad'],
    ['rhog', CORE_COLUMNS.rhog, CORE_UNITS.rhog, 'Densidad de grano'],
  ];
  for (const [field, key, unit, label] of numericFields) {
    const m = byField.get(field);
    if (m) columns[key] = { label, unit, values: pickNum(numeric(m, unit)) };
  }
  const phi = columns[CORE_COLUMNS.phi]?.values as Float64Array | undefined;
  if (phi) {
    let over = 0;
    for (const v of phi) if (v > 1) over++;
    if (over) warnings.push(`${over} ${over === 1 ? 'plug tiene' : 'plugs tienen'} porosidad mayor que 1 v/v: ¿la columna está en %? Elegí la unidad en el paso Columnas.`);
  }
  const textFields: [CoreField, string, string][] = [
    ['run', CORE_COLUMNS.run, 'Corona'],
    ['description', CORE_COLUMNS.description, 'Descripción'],
  ];
  for (const [field, key, label] of textFields) {
    const m = byField.get(field);
    if (m) columns[key] = { label, values: pickText(text(m)) };
  }

  // Ids: los de la columna de plug si la hay; si no, P01, P02… en el orden del archivo. Repetidos: numerados. Con
  // corona y un id que se repite entre coronas (plug 1 de cada corona), se antepone la corona.
  const plugMap = byField.get('plug');
  const rawIds = plugMap ? pickText(text(plugMap)) : null;
  const runs = columns[CORE_COLUMNS.run]?.values as readonly string[] | undefined;
  const width = Math.max(2, String(keep.length).length);
  const ids: string[] = [];
  const used = new Set<string>();
  let renamed = 0;
  const repeated = rawIds ? new Set(rawIds.filter((x, i) => x && rawIds.indexOf(x) !== i)) : new Set<string>();
  keep.forEach((_, k) => {
    let id = rawIds?.[k]?.trim() ?? '';
    if (id && runs?.[k] && repeated.has(id)) id = `C${runs[k]}-${id}`;
    if (!id) id = `P${String(k + 1).padStart(width, '0')}`;
    if (used.has(id)) {
      let j = 2;
      while (used.has(`${id} (${j})`)) j++;
      id = `${id} (${j})`;
      renamed++;
    }
    used.add(id);
    ids.push(id);
  });
  if (renamed > 0) warnings.push(`${renamed} ${renamed === 1 ? 'plug repite' : 'plugs repiten'} el id de otro: se ${renamed === 1 ? 'le agregó' : 'les agregó'} un número.`);

  const set = createPointSet({
    id: opts.id,
    kind: CORE_SET_KIND,
    name: opts.name?.trim() || table.sourceName.replace(/\.[^.]+$/, '') || 'Corona',
    source: table.sourceName,
    depth: pickNum(depthAll),
    pointIds: ids,
    columns,
  });
  return { set, warnings, dropped };
}
