/**
 * De RawTable a Well: mapeo de columnas (profundidad / curva / zona / ignorar), unidades, validación del índice de
 * profundidad y conversión de la columna de zonas a `Zone[]`.
 */
import { defaultRoleCatalog, type RoleId } from '../core/roles';
import { convertArray, getUnit, sameDimension, type UnitId } from '../core/units';
import { createWell, type Curve, type Well, type Zone } from '../core/well';
import { resolveUnit, suggestRole, type Confidence } from './mnemonics';
import { type RawColumn, type RawTable } from './table';

export type ColumnKind = 'depth' | 'curve' | 'zone' | 'ignore';

/** Qué hacer con una columna del archivo. El asistente de columnas de la interfaz edita esta lista. */
export interface ColumnMapping {
  /** Índice dentro de `RawTable.columns`. */
  column: number;
  /** Nombre en el archivo (informativo). */
  name: string;
  /** Texto de unidad en el archivo (informativo). */
  rawUnit: string;
  kind: ColumnKind;
  /** Rol asignado (solo curvas). */
  role: RoleId | null;
  /** Unidad de los datos del archivo (curvas y profundidad). */
  unit: UnitId | null;
  /** Id de la curva en el pozo (por defecto, el nombre). */
  id: string;
  confidence: Confidence;
}

export interface BuildOptions {
  wellName?: string;
  wellId?: string;
  /** Unidad de profundidad del archivo; por defecto, la de la columna o metros. */
  depthUnit?: UnitId;
}

export interface BuildResult {
  well: Well;
  zones: Zone[];
  /** Mapeo efectivamente usado, una entrada por columna del archivo. */
  columns: ColumnMapping[];
  warnings: string[];
}

const ZONE_NAMES = new Set(['ZONA', 'ZONAS', 'ZONE', 'ZONES', 'FORMACION', 'FORMATION', 'FM', 'UNIT']);

/** Colores de zonas del pozo demo (src/app/demo/syntheticWell.ts), por orden de aparición. */
const ZONE_COLORS = ['#e8c872', '#9ec5e8', '#f2a65a', '#b8d98b', '#c9a3d9', '#e6a1a1', '#8fd1c4', '#d4c28a'];

/** Mapeo sugerido: profundidad, zona (texto llamado ZONA...), curvas con rol por mnemónico, el resto ignorado. */
export function suggestMapping(table: RawTable): ColumnMapping[] {
  let zoneTaken = false;
  return table.columns.map((col, i): ColumnMapping => {
    const base = { column: i, name: col.name, rawUnit: col.unit, id: col.name };
    if (i === table.depthColumn) {
      return { ...base, kind: 'depth', role: null, unit: col.unit.trim() === '' ? 'm' : resolveUnit(col.unit, null), confidence: 'high' };
    }
    if (col.kind === 'text') {
      if (!zoneTaken && ZONE_NAMES.has(col.name.trim().toUpperCase())) {
        zoneTaken = true;
        return { ...base, kind: 'zone', role: null, unit: null, confidence: 'high' };
      }
      return { ...base, kind: 'ignore', role: null, unit: null, confidence: 'none' };
    }
    const s = suggestRole(col.name, col.unit);
    return { ...base, kind: 'curve', role: s.role, unit: s.unit, confidence: s.confidence };
  });
}

function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  return last.replace(/\.[^.]+$/, '');
}

/** Elige las muestras válidas y su orden: descarta profundidades vacías e invierte si viene de punta a punta decreciente. */
function depthOrder(
  depth: Float64Array,
  sourceRows: Int32Array,
  warnings: string[],
): { order: Int32Array | null; depth: Float64Array } {
  const n = depth.length;
  let valid = 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(depth[i]!)) valid++;
  if (valid === 0) throw new Error('Ninguna fila tiene una profundidad válida.');
  let idx: Int32Array | null = null;
  if (valid < n) {
    warnings.push(`${n - valid} filas sin profundidad válida se descartaron.`);
    idx = new Int32Array(valid);
    let k = 0;
    for (let i = 0; i < n; i++) if (Number.isFinite(depth[i]!)) idx[k++] = i;
  }
  const at = (k: number): number => (idx ? idx[k]! : k);
  const m = valid;
  const d = (k: number): number => depth[at(k)]!;

  let decreasing = m > 1;
  for (let k = 1; k < m; k++) {
    if (!(d(k) < d(k - 1))) {
      decreasing = false;
      break;
    }
  }
  if (decreasing) {
    warnings.push('La profundidad venía decreciente de punta a punta: se invirtió el orden de las filas.');
    const rev = new Int32Array(m);
    for (let k = 0; k < m; k++) rev[k] = at(m - 1 - k);
    idx = rev;
  } else {
    for (let k = 1; k < m; k++) {
      if (!(d(k) > d(k - 1))) {
        const row = sourceRows[at(k)]!;
        const kind = d(k) === d(k - 1) ? 'duplicada' : 'no creciente';
        throw new Error(
          `Profundidad ${kind} en la fila ${row}: ${d(k - 1)} → ${d(k)}. ` +
            'La profundidad debe ser estrictamente creciente (o decreciente de punta a punta).',
        );
      }
    }
  }
  const out = new Float64Array(m);
  for (let k = 0; k < m; k++) out[k] = depth[idx ? idx[k]! : k]!;
  return { order: idx, depth: out };
}

function take(src: Float64Array, order: Int32Array | null): Float64Array {
  if (!order) return src;
  const out = new Float64Array(order.length);
  for (let k = 0; k < order.length; k++) out[k] = src[order[k]!]!;
  return out;
}

function buildZones(labels: readonly string[], depthM: Float64Array, warnings: string[]): Zone[] {
  const ranges = new Map<string, { top: number; base: number; runs: number }>();
  let prev = '';
  for (let i = 0; i < labels.length; i++) {
    const name = labels[i]!.trim();
    if (name === '') {
      prev = '';
      continue;
    }
    const r = ranges.get(name);
    const d = depthM[i]!;
    if (!r) ranges.set(name, { top: d, base: d, runs: 1 });
    else {
      r.top = Math.min(r.top, d);
      r.base = Math.max(r.base, d);
      if (prev !== name) r.runs++;
    }
    prev = name;
  }
  const zones: Zone[] = [];
  const used = new Set<string>();
  let k = 0;
  for (const [name, r] of ranges) {
    if (r.runs > 1) {
      warnings.push(`La zona '${name}' aparece en ${r.runs} tramos separados: se usa el rango completo, de tope a base.`);
    }
    if (!(r.top < r.base)) {
      warnings.push(`La zona '${name}' tiene una sola muestra: se descarta.`);
      continue;
    }
    let id = `zone-${slug(name) || k + 1}`;
    while (used.has(id)) id += '-2';
    used.add(id);
    zones.push({ id, name, top: r.top, base: r.base, color: ZONE_COLORS[k % ZONE_COLORS.length]!, kind: 'formation' });
    k++;
  }
  return zones.sort((a, b) => a.top - b.top);
}

/** Construye el pozo y las zonas a partir de la tabla cruda y un mapeo de columnas. */
export function buildWell(
  table: RawTable,
  mapping: readonly ColumnMapping[] = suggestMapping(table),
  options: BuildOptions = {},
): BuildResult {
  const warnings = [...table.warnings];
  const byColumn = new Map<number, ColumnMapping>();
  for (const m of mapping) {
    if (m.column < 0 || m.column >= table.columns.length) throw new Error(`El mapeo apunta a una columna inexistente (${m.column}).`);
    byColumn.set(m.column, m);
  }
  const depthMaps = mapping.filter((m) => m.kind === 'depth');
  if (depthMaps.length !== 1) {
    throw new Error(
      depthMaps.length === 0
        ? 'Falta indicar cuál es la columna de profundidad.'
        : 'Hay más de una columna marcada como profundidad.',
    );
  }
  const depthMap = depthMaps[0]!;
  const depthCol = table.columns[depthMap.column]!;
  if (depthCol.kind !== 'numeric' || !depthCol.numbers) {
    throw new Error(`La columna de profundidad '${depthCol.name}' no es numérica.`);
  }

  // Unidad de profundidad → metros
  let depthUnit: UnitId | null = options.depthUnit ?? depthMap.unit;
  if (depthUnit === null) {
    const text = depthCol.unit.trim();
    depthUnit = text === '' ? 'm' : resolveUnit(text, null);
    if (depthUnit === null) {
      warnings.push(`Unidad de profundidad '${text}' no reconocida: se asumen metros.`);
      depthUnit = 'm';
    }
  }
  if (!getUnit(depthUnit) || !sameDimension(depthUnit, 'm')) {
    throw new Error(`La unidad de profundidad '${depthUnit}' no es una longitud conocida (m, ft...).`);
  }

  const { order, depth: depthRaw } = depthOrder(depthCol.numbers, table.sourceRows, warnings);
  const depthM = convertArray(depthRaw, depthUnit, 'm');

  // Zonas
  const zoneMaps = mapping.filter((m) => m.kind === 'zone');
  if (zoneMaps.length > 1) throw new Error('Hay más de una columna marcada como zona.');
  let zones: Zone[] = [];
  if (zoneMaps.length === 1) {
    const zc = table.columns[zoneMaps[0]!.column]!;
    const labelsAll: string[] =
      zc.kind === 'text' && zc.text ? zc.text : Array.from(zc.numbers ?? [], (v) => (Number.isNaN(v) ? '' : String(v)));
    const labels = order ? Array.from(order, (i) => labelsAll[i]!) : labelsAll;
    zones = buildZones(labels, depthM, warnings);
  }

  // Curvas
  const curves: Curve[] = [];
  const ids = new Set<string>();
  for (const m of mapping) {
    const col: RawColumn = table.columns[m.column]!;
    if (m.kind === 'ignore') {
      if (col.kind === 'text') warnings.push(`La columna de texto '${col.name}' se descartó (no es una curva ni una zona).`);
      continue;
    }
    if (m.kind !== 'curve') continue;
    if (col.kind !== 'numeric' || !col.numbers) {
      throw new Error(`La columna '${col.name}' tiene texto y no puede ser una curva.`);
    }
    const role = m.role ?? null;
    if (role !== null && !defaultRoleCatalog.has(role)) {
      throw new Error(`La curva '${col.name}' tiene un rol desconocido: '${role}'.`);
    }
    let unit: UnitId | null = m.unit ?? resolveUnit(col.unit, role);
    if (unit === null && role !== null) {
      unit = defaultRoleCatalog.unitOf(role);
      const why = col.unit.trim() !== '' ? `la unidad '${col.unit}' no se reconoce` : 'no tiene unidad';
      warnings.push(`La curva '${col.name}' ${why}: se asume ${unit}, la unidad canónica de ${role}.`);
    }
    if (unit === null) unit = col.unit.trim() !== '' ? col.unit.trim() : 'unitless';
    if (role !== null && !sameDimension(unit, defaultRoleCatalog.unitOf(role))) {
      throw new Error(`La unidad '${unit}' de la curva '${col.name}' no es compatible con el rol ${role}.`);
    }
    let id = (m.id || col.name).trim();
    if (id.startsWith('prep:')) {
      warnings.push(`El id '${id}' está reservado para preparación: se importa como 'import:${id}'.`);
      id = `import:${id}`;
    }
    if (ids.has(id)) {
      let k = 2;
      while (ids.has(`${id}_${k}`)) k++;
      warnings.push(`Hay dos curvas llamadas '${id}': la segunda se renombró '${id}_${k}'.`);
      id = `${id}_${k}`;
    }
    ids.add(id);
    const data = take(col.numbers, order);
    let finite = 0;
    for (let i = 0; i < data.length; i++) if (!Number.isNaN(data[i]!)) finite++;
    if (finite === 0) warnings.push(`La curva '${col.name}' no tiene ningún dato.`);
    curves.push({
      id,
      mnemonic: col.name,
      ...(col.description ? { description: col.description } : {}),
      role,
      unit,
      data,
      origin: { kind: 'measured', source: table.sourceName },
    });
  }

  const wellName = options.wellName ?? headerText(table, 'WELL') ?? baseName(table.sourceName);
  const well = createWell({
    id: options.wellId ?? (slug(wellName) || 'pozo'),
    name: wellName,
    header: table.header,
    depth: depthM,
    depthSourceUnit: depthUnit,
    curves,
  });
  return { well, zones, columns: [...byColumn.values()].sort((a, b) => a.column - b.column), warnings };
}

function headerText(table: RawTable, key: string): string | undefined {
  const v = table.header[key]?.value;
  return v === undefined || String(v).trim() === '' ? undefined : String(v).trim();
}

