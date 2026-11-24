/**
 * Tablas de presiones de formación (MDT, RFT, XPT…) → conjunto de puntos del pozo (`PointSet`, kind 'pressure').
 * Decisión: docs/decisiones/0009-presiones-mdt-y-conjuntos-de-puntos.md.
 *
 * Dos etapas, como los perfiles, para que la interfaz muestre un asistente de columnas entre ellas:
 *   parseTable(archivo, nombre, { requireDepth: false })   → RawTable (Excel, CSV o LAS)
 *   suggestPressureMapping(tabla)                          → qué es cada columna (editable)
 *   buildPressureSet(tabla, mapeo, opciones)               → { set, warnings }
 *
 * Reconocimiento de columnas por nombre (sin tildes, mayúsculas) y, si el nombre no alcanza, por unidad: profundidad
 * MD y TVD, presión de formación, drawdown, movilidad (mD/cP), presión hidrostática del lodo antes y después de la prueba,
 * calidad o resultado de la prueba, tipo de prueba, comentario e identificador de la prueba.
 *
 * Unidades canónicas del conjunto: profundidad en m, presiones en psi, movilidad en mD/cP. Las filas sin
 * profundidad se descartan con aviso; las que no tienen presión se conservan (se ven en la tabla y la regla de
 * calidad las propone para descartar). Puro: corre en Node, navegador y worker.
 */
import { createPointSet, type PointColumn, type PointSet } from '../core/pointSets';
import { convertArray, getUnit, parseUnit, unitLabel, type DimensionId, type UnitId } from '../core/units';
import type { Confidence } from './mnemonics';
import type { RawColumn, RawTable } from './table';

/** Qué representa una columna de la tabla de presiones. */
export type PressureField =
  | 'depth'
  | 'tvd'
  | 'pressure'
  | 'drawdown'
  | 'mobility'
  | 'mudBefore'
  | 'mudAfter'
  | 'quality'
  | 'testType'
  | 'comment'
  | 'test'
  | 'ignore';

/** Claves de columna del conjunto (las usa el módulo MDT). La profundidad MD va en `PointSet.depth`. */
export const PRESSURE_COLUMNS = {
  tvd: 'tvd',
  pressure: 'pressure',
  drawdown: 'drawdown',
  mobility: 'mobility',
  mudBefore: 'mudBefore',
  mudAfter: 'mudAfter',
  quality: 'quality',
  testType: 'testType',
  comment: 'comment',
} as const;

export const PRESSURE_SET_KIND = 'pressure';
/** Unidades canónicas de un conjunto de presiones. */
export const PRESSURE_UNIT: UnitId = 'psi';
export const MOBILITY_UNIT: UnitId = 'mD/cP';

export const PRESSURE_FIELD_LABEL: Readonly<Record<PressureField, string>> = {
  depth: 'Profundidad MD',
  tvd: 'Profundidad TVD',
  pressure: 'Presión de formación',
  drawdown: 'Caída de presión (drawdown)',
  mobility: 'Movilidad',
  mudBefore: 'Presión hidrostática (antes)',
  mudAfter: 'Presión hidrostática (después)',
  quality: 'Calidad / resultado',
  testType: 'Tipo de prueba',
  comment: 'Comentario',
  test: 'Id de la prueba',
  ignore: 'Ignorar',
};

/** Campos numéricos y su dimensión (para elegir la unidad). */
export const PRESSURE_FIELD_DIMENSION: Partial<Record<PressureField, DimensionId>> = {
  depth: 'length',
  tvd: 'length',
  pressure: 'pressure',
  drawdown: 'pressure',
  mobility: 'mobility',
  mudBefore: 'pressure',
  mudAfter: 'pressure',
};

const TEXT_FIELDS: ReadonlySet<PressureField> = new Set(['quality', 'testType', 'comment', 'test']);

export interface PressureColumnMapping {
  column: number;
  name: string;
  rawUnit: string;
  kind: RawColumn['kind'];
  field: PressureField;
  /** Unidad de los datos (campos numéricos). */
  unit: UnitId | null;
  confidence: Confidence;
}

/** Nombre normalizado: sin tildes, mayúsculas, separadores → '_'. */
export function normalizeColumnName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9/]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const tokensOf = (norm: string) => norm.split(/[_/]+/).filter(Boolean);

/**
 * Unidad escrita pegada al nombre, sin paréntesis: «Depth ft», «DEPTH_FT», «Perm mD», «PHI %», «K/mD», «Movilidad mD/cP».
 * Cuenta como unidad el último token (o los dos últimos unidos por «/») si es una unidad conocida y queda algo de
 * nombre. Así «MD» sola sigue siendo profundidad medida, y «Perm mD» no deja que el MD le gane a PERM.
 */
export function splitUnitSuffix(raw: string): { name: string; unitText: string } {
  const parts = raw.trim().split(/[\s_/]+/).filter(Boolean);
  for (const take of [1, 2]) {
    if (parts.length <= take) break;
    const suffix = parts.slice(-take).join('/');
    if (parseUnit(suffix)) return { name: parts.slice(0, -take).join(' '), unitText: suffix };
  }
  return { name: raw, unitText: '' };
}

/** Texto de unidad de una columna: la de la línea de unidades o la de paréntesis; si no, la pegada al nombre. */
export function unitTextOf(col: RawColumn): string {
  return col.unit.trim() || splitUnitSuffix(col.name).unitText;
}

/** Campo por el nombre (y confianza), o null si el nombre no dice nada. */
function fieldByName(name: string): { field: PressureField; confidence: Confidence } | null {
  const n = normalizeColumnName(splitUnitSuffix(name).name);
  const t = new Set(tokensOf(n));
  const has = (...w: string[]) => w.some((x) => t.has(x));
  const starts = (...w: string[]) => w.some((x) => n.startsWith(x));
  // Lodo / hidrostática antes que «presión» (una columna «Presión hidrostática» no es la de formación).
  const mud = has('HYDROSTATIC', 'HIDROSTATICA', 'HIDROSTATICO', 'HYDRO', 'HYD', 'HP', 'MUD', 'LODO', 'PHYD', 'PMUD', 'HSP', 'HPB', 'HPA') || starts('HYDROST', 'HIDROST', 'HYD', 'PHYD', 'PMUD', 'HP_');
  if (mud) {
    // «después»: palabra o sufijo A/AFT en un mnemónico corto (HYDA, HP_A, HPA); «antes» (B, BEF) es el valor por defecto.
    const after = has('AFTER', 'DESPUES', 'POST', 'FINAL', 'FIN', 'HPA', 'END') || /(_|^)(A|AFT)$/.test(n) || /^(HYD|PHYD|PMUD|HP)_?A(FT)?$/.test(n);
    return { field: after ? 'mudAfter' : 'mudBefore', confidence: 'high' };
  }
  if (has('TVD', 'TVDKB', 'TVDRT', 'TVDBRT', 'PVV') || starts('TVD_', 'TRUE_VERTICAL')) return { field: 'tvd', confidence: has('TVDSS') ? 'low' : 'high' };
  if (has('MOBILITY', 'MOVILIDAD', 'MOB', 'KMU', 'K/MU', 'DDMOB') || starts('MOBIL', 'MOVIL', 'DD_MOB', 'K_MU')) return { field: 'mobility', confidence: 'high' };
  if (has('QUALITY', 'CALIDAD', 'QC', 'STATUS', 'ESTADO', 'RESULT', 'RESULTADO', 'VALIDEZ', 'VALID', 'CLASIFICACION')) return { field: 'quality', confidence: 'high' };
  if (has('COMMENT', 'COMMENTS', 'COMENTARIO', 'COMENTARIOS', 'OBS', 'OBSERVACION', 'OBSERVACIONES', 'REMARK', 'REMARKS', 'NOTE', 'NOTES', 'NOTA', 'NOTAS')) return { field: 'comment', confidence: 'high' };
  if (has('TYPE', 'TIPO')) return { field: 'testType', confidence: 'high' };
  if (has('DRAWDOWN', 'DRAWDN') || /(?:^|_)(DRAW_DOWN|CAIDA_(?:DE_)?PRESION|PRESSURE_(?:DROP|DRAWDOWN))(?:_|$)/.test(n)) {
    return { field: 'drawdown', confidence: 'high' };
  }
  if (
    has('FORMATION', 'FORMACION', 'PFORM', 'PF', 'FP', 'FPRES', 'PRES', 'PRESSURE', 'PRESION', 'PORE', 'PORAL', 'PP', 'PSTAB', 'PSTABLE', 'BUILDUP') ||
    starts('FORM_PRES', 'PRESION', 'PRESSURE', 'P_FORM', 'PFORM', 'FORMATION_P')
  ) {
    return { field: 'pressure', confidence: has('FORMATION', 'FORMACION', 'PFORM', 'FP', 'PF', 'PORE', 'PORAL', 'FPRES') || starts('P_FORM', 'FORM_PRES') ? 'high' : 'medium' };
  }
  if (has('MD', 'DEPTH', 'DEPT', 'PROF', 'PROFUNDIDAD', 'MDKB', 'MDRT', 'COTA') || starts('MEASURED', 'PROFUND')) return { field: 'depth', confidence: 'high' };
  if (has('TEST', 'PRUEBA', 'ENSAYO', 'ID', 'NRO', 'NUMERO', 'N', 'NO', 'POINT', 'PUNTO', 'STATION', 'ESTACION', 'SEQ', 'PRETEST')) return { field: 'test', confidence: 'high' };
  return null;
}

/** Unidad de un campo numérico a partir del texto de unidad del archivo (o la canónica si no dice). */
function unitFor(field: PressureField, rawUnit: string): UnitId | null {
  const dim = PRESSURE_FIELD_DIMENSION[field];
  if (!dim) return null;
  const raw = rawUnit.trim();
  // «MD» como unidad en una columna de profundidad no es milidarcy.
  const u = raw ? parseUnit(raw) : null;
  if (u && getUnit(u)?.dimension === dim) return u;
  if (dim === 'length') return 'm';
  if (dim === 'pressure') return PRESSURE_UNIT;
  if (dim === 'mobility') return MOBILITY_UNIT;
  return null;
}

/** Mapeo sugerido. Cada campo se asigna una sola vez (la primera columna que lo reconoce); el resto se ignora. */
export function suggestPressureMapping(table: RawTable): PressureColumnMapping[] {
  const taken = new Set<PressureField>();
  const out: PressureColumnMapping[] = table.columns.map((col, i) => {
    const base = { column: i, name: col.name, rawUnit: unitTextOf(col), kind: col.kind };
    // Por el nombre y, si no dice nada, por la descripción (LAS: «PFORM.PSIA : Presión de formación»).
    const byName = fieldByName(col.name) ?? (col.description ? fieldByName(col.description) : null);
    let field: PressureField = 'ignore';
    let confidence: Confidence = 'none';
    if (byName) {
      const numericField = !TEXT_FIELDS.has(byName.field);
      // Un campo numérico en una columna de texto (o al revés, salvo el id) no encaja.
      if (numericField === (col.kind === 'numeric') || byName.field === 'test') {
        field = byName.field;
        confidence = byName.confidence;
      }
    }
    if (field === 'ignore' && col.kind === 'numeric') {
      // Por unidad: una presión o una movilidad sin nombre reconocible.
      const u = parseUnit(base.rawUnit);
      const dim = u ? getUnit(u)?.dimension : undefined;
      if (dim === 'pressure') {
        field = 'pressure';
        confidence = 'low';
      } else if (dim === 'mobility') {
        field = 'mobility';
        confidence = 'medium';
      }
    }
    if (field !== 'ignore' && taken.has(field)) {
      field = 'ignore';
      confidence = 'none';
    }
    if (field !== 'ignore') taken.add(field);
    return { ...base, field, unit: unitFor(field, base.rawUnit), confidence };
  });
  // Sin columna de profundidad reconocida: la que el lector marcó como tal (o la primera numérica).
  if (!taken.has('depth')) {
    const k = table.depthColumn >= 0 && out[table.depthColumn]?.field === 'ignore' ? table.depthColumn : out.findIndex((m) => m.field === 'ignore' && m.kind === 'numeric');
    if (k >= 0) out[k] = { ...out[k]!, field: 'depth', unit: unitFor('depth', out[k]!.rawUnit), confidence: 'low' };
  }
  return out;
}

export interface BuildPressureOptions {
  /** Id del conjunto (único en el pozo). */
  id: string;
  name?: string;
}

export interface BuildPressureResult {
  set: PointSet;
  /** Avisos de la lectura (filas descartadas, columnas repetidas…). */
  warnings: string[];
  /** Filas descartadas por no tener profundidad. */
  dropped: number;
}

function slugId(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Construye el conjunto de presiones con el mapeo dado. Lanza un Error en español si falta lo indispensable. */
export function buildPressureSet(table: RawTable, mapping: readonly PressureColumnMapping[], opts: BuildPressureOptions): BuildPressureResult {
  const warnings: string[] = [];
  const byField = new Map<PressureField, PressureColumnMapping>();
  for (const m of mapping) {
    if (m.field === 'ignore') continue;
    if (byField.has(m.field)) {
      warnings.push(`Hay dos columnas marcadas como «${PRESSURE_FIELD_LABEL[m.field]}»: se usa '${byField.get(m.field)!.name}' y se ignora '${m.name}'.`);
      continue;
    }
    byField.set(m.field, m);
  }
  const depthMap = byField.get('depth');
  if (!depthMap) throw new Error('Falta la columna de profundidad (MD). Marcala en el paso Columnas.');
  const pressMap = byField.get('pressure');
  if (!pressMap) throw new Error('Falta la columna de presión de formación. Marcala en el paso Columnas.');

  const numeric = (m: PressureColumnMapping, canonical: UnitId): Float64Array => {
    const col = table.columns[m.column];
    if (!col || col.kind !== 'numeric' || !col.numbers) throw new Error(`La columna '${m.name}' (${PRESSURE_FIELD_LABEL[m.field]}) no es numérica.`);
    const from = m.unit ?? canonical;
    if (getUnit(from)?.dimension !== getUnit(canonical)?.dimension) throw new Error(`La unidad '${unitLabel(from)}' no sirve para ${PRESSURE_FIELD_LABEL[m.field].toLowerCase()}.`);
    return convertArray(col.numbers, from, canonical);
  };
  const text = (m: PressureColumnMapping): string[] => {
    const col = table.columns[m.column]!;
    if (col.kind === 'text') return col.text!.map((s) => s.trim());
    return Array.from(col.numbers!, (v) => (Number.isFinite(v) ? String(v) : ''));
  };

  const depthAll = numeric(depthMap, 'm');
  const keep: number[] = [];
  for (let i = 0; i < table.rowCount; i++) if (Number.isFinite(depthAll[i]!)) keep.push(i);
  const dropped = table.rowCount - keep.length;
  if (dropped > 0) warnings.push(`${dropped} ${dropped === 1 ? 'fila no tiene' : 'filas no tienen'} profundidad: se ${dropped === 1 ? 'descarta' : 'descartan'}.`);
  if (keep.length === 0) throw new Error('Ninguna fila tiene profundidad: no hay puntos para cargar.');
  const pickNum = (a: Float64Array) => Float64Array.from(keep, (i) => a[i]!);
  const pickText = (a: string[]) => keep.map((i) => a[i]!);

  const columns: Record<string, PointColumn> = {};
  const pressure = pickNum(numeric(pressMap, PRESSURE_UNIT));
  columns[PRESSURE_COLUMNS.pressure] = { label: 'Presión de formación', unit: PRESSURE_UNIT, values: pressure };
  const numericFields: [PressureField, string, UnitId, string][] = [
    ['tvd', PRESSURE_COLUMNS.tvd, 'm', 'Profundidad TVD'],
    ['drawdown', PRESSURE_COLUMNS.drawdown, PRESSURE_UNIT, PRESSURE_FIELD_LABEL.drawdown],
    ['mobility', PRESSURE_COLUMNS.mobility, MOBILITY_UNIT, 'Movilidad'],
    ['mudBefore', PRESSURE_COLUMNS.mudBefore, PRESSURE_UNIT, 'Presión hidrostática (antes)'],
    ['mudAfter', PRESSURE_COLUMNS.mudAfter, PRESSURE_UNIT, 'Presión hidrostática (después)'],
  ];
  for (const [field, key, unit, label] of numericFields) {
    const m = byField.get(field);
    if (m) columns[key] = { label, unit, values: pickNum(numeric(m, unit)) };
  }
  const textFields: [PressureField, string, string][] = [
    ['quality', PRESSURE_COLUMNS.quality, 'Calidad'],
    ['testType', PRESSURE_COLUMNS.testType, 'Tipo de prueba'],
    ['comment', PRESSURE_COLUMNS.comment, 'Comentario'],
  ];
  for (const [field, key, label] of textFields) {
    const m = byField.get(field);
    if (m) columns[key] = { label, values: pickText(text(m)) };
  }
  const missingP = pressure.reduce((k, v) => k + (Number.isFinite(v) ? 0 : 1), 0);
  if (missingP > 0) warnings.push(`${missingP} ${missingP === 1 ? 'punto no tiene' : 'puntos no tienen'} presión de formación (pruebas secas o sin estabilizar): se ${missingP === 1 ? 've' : 'ven'} en la tabla pero no en el gráfico.`);

  // Ids: los de la columna de prueba si los hay (únicos), si no P01, P02… en el orden del archivo.
  const testMap = byField.get('test');
  const rawIds = testMap ? pickText(text(testMap)) : null;
  const width = String(keep.length).length < 2 ? 2 : String(keep.length).length;
  const ids: string[] = [];
  const used = new Set<string>();
  let renamed = 0;
  keep.forEach((_, k) => {
    let id = rawIds ? slugId(rawIds[k]!) : '';
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
  if (renamed > 0) warnings.push(`${renamed} ${renamed === 1 ? 'prueba repite' : 'pruebas repiten'} el id de otra: se ${renamed === 1 ? 'le agregó' : 'les agregó'} un número.`);

  const set = createPointSet({
    id: opts.id,
    kind: PRESSURE_SET_KIND,
    name: opts.name?.trim() || table.sourceName.replace(/\.[^.]+$/, '') || 'Presiones',
    source: table.sourceName,
    depth: pickNum(depthAll),
    pointIds: ids,
    columns,
  });
  return { set, warnings, dropped };
}
