/**
 * Topes de zona desde una planilla (F09): pegado del portapapeles (texto tabulado de Excel o Sheets) o archivo
 * (.csv/.xlsx) con una tabla nombre–tope(–base).
 *
 * Todo es puro: `gridFromText` parte el texto en celdas (separador `;`, tabulación o coma, con los lectores de
 * `csv.ts`) y `parseZoneTops` detecta el encabezado y las columnas, lee los números (decimal coma o punto), arma
 * las zonas y las valida contra el rango de profundidad del pozo y contra las zonas que se conservan.
 *
 * Convenciones (las mismas que las zonas del TP, `core/state/zones.ts`):
 * - Tope y base se ajustan a la MUESTRA más cercana.
 * - Sin base, la zona llega a la muestra anterior al tope de la siguiente (dos zonas contiguas quedan separadas por
 *   una muestra); la última llega al fondo del pozo o hasta la próxima zona que se conserva.
 * - Una base explícita igual al tope de la siguiente es un contacto compartido, no un solape.
 * - Los errores bloquean el aplicado; los avisos no (huecos, zonas muy finas, muestras sin zona).
 */
import type { Zone } from '../core/well';
import { MIN_ZONE_THICKNESS, nearestSample } from '../core/state/zones';
import { detectDelimiter, splitCsv, stripBom } from './csv';

export type ZoneTopsSeverity = 'error' | 'warning';

export interface ZoneTopsProblem {
  /** Fila de la planilla (desde 1, como la cuenta el usuario); null si el problema es de toda la tabla. */
  row: number | null;
  severity: ZoneTopsSeverity;
  message: string;
}

/** Una fila de datos de la planilla, con lo que se entendió de ella. */
export interface ZoneTopsRow {
  row: number;
  name: string;
  /** Tope ajustado a la muestra más cercana; null si no se pudo leer. */
  top: number | null;
  /** Base ajustada a la muestra (la explícita o la derivada del tope siguiente); null si no se pudo resolver. */
  base: number | null;
  /** true si la fila traía una base propia. */
  explicitBase: boolean;
  problems: ZoneTopsProblem[];
}

/** Zona lista para crear (ya validada), en orden de tope. */
export interface ZoneDraft {
  row: number;
  name: string;
  top: number;
  base: number;
}

export interface ZoneTopsContext {
  /** Profundidad de las muestras del pozo (creciente). */
  depth: ArrayLike<number>;
  /** Zonas que se conservan (modo «agregar»): cuentan para solapes, nombres repetidos y el límite de la última. */
  keep?: readonly Zone[];
}

export interface ZoneTopsResult {
  /** Filas de datos en el orden de la planilla. */
  rows: ZoneTopsRow[];
  /** Zonas sin errores, ordenadas por tope. Con `errors > 0` no se deben aplicar. */
  drafts: ZoneDraft[];
  /** Todos los problemas, ordenados por fila (los de toda la tabla primero). */
  problems: ZoneTopsProblem[];
  errors: number;
  warnings: number;
  /** La primera fila era un encabezado. */
  hasHeader: boolean;
}

export type CellGrid = { rows: string[][]; rowNumbers: number[]; /** Separador del texto de origen (si vino de texto). */ delimiter?: string };

/**
 * Separador de una tabla de topes. Lo pegado desde Excel o Sheets viene SIEMPRE tabulado, y con decimal coma cada
 * celda numérica trae una coma: si hay tabulaciones manda la tabulación, y si no, el «;» antes que la coma.
 */
function topsDelimiter(text: string): ',' | ';' | '\t' {
  if (text.includes('\t')) return '\t';
  const d = detectDelimiter(text);
  return d === ',' && /;/.test(text.replace(/"[^"]*"/g, '')) ? ';' : d;
}

/** Parte un texto pegado o leído de un archivo en celdas. Detecta el separador (tabulación, `;` o coma). */
export function gridFromText(text: string): CellGrid {
  const clean = stripBom(text);
  if (clean.trim() === '') return { rows: [], rowNumbers: [] };
  const delimiter = topsDelimiter(clean);
  const { rows, lineNumbers } = splitCsv(clean, delimiter);
  return { rows, rowNumbers: lineNumbers, delimiter };
}

/** Texto tabulado de una grilla de celdas (lo que se muestra en el cuadro de pegado al cargar un .xlsx). */
export function gridToText(grid: CellGrid): string {
  return grid.rows.map((r) => r.join('\t').replace(/\t+$/, '')).join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Números y encabezados

/**
 * `value` en metros. `alt`: la otra lectura posible cuando un solo signo va seguido de exactamente tres cifras
 * («7.633» = 7,633 o 7633 con separador de miles); la validación se queda con la que cae dentro del pozo.
 */
type Cell = { kind: 'empty' } | { kind: 'bad'; text: string } | { kind: 'ok'; value: number; alt?: number };

const FT = 0.3048;
const UNIT_SUFFIX = /\s*(m|mts?|metros?|ft|pies|feet|')\.?$/i;
/** Encabezado de una columna en pies («Tope (ft)», «Base [pies]», «MD ft»). */
const FEET_HEADER = /(^|[^a-z])(ft|pies|feet)([^a-z]|$)/i;

/**
 * Lee una profundidad: decimal coma o punto, miles con el otro signo («7.633,5», «7,633.5»), unidad al final («m»,
 * «ft», «pies»). Con un solo signo y una sola aparición, ese signo es el decimal (y si van tres cifras detrás, `alt`
 * guarda la lectura como miles). Sin unidad en la celda, `factor` pasa a metros (0,3048 si la columna está en pies).
 */
export function parseDepthCell(raw: string, factor = 1): Cell {
  const trimmed = raw.trim();
  const unit = UNIT_SUFFIX.exec(trimmed);
  const k = unit ? (/^[m]/i.test(unit[1]!) ? 1 : FT) : factor;
  const s = (unit ? trimmed.slice(0, unit.index) : trimmed).replace(/\s/g, '');
  if (s === '') return unit ? { kind: 'bad', text: trimmed } : { kind: 'empty' };
  if (!/^[+-]?[\d.,]+$/.test(s) || !/\d/.test(s)) return { kind: 'bad', text: raw.trim() };
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let t: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thousands = dec === '.' ? ',' : '.';
    t = s.split(thousands).join('');
    if (dec === ',') t = t.replace(',', '.');
  } else if (lastComma >= 0) {
    t = (s.match(/,/g) ?? []).length > 1 ? s.split(',').join('') : s.replace(',', '.');
  } else {
    t = (s.match(/\./g) ?? []).length > 1 ? s.split('.').join('') : s;
  }
  const v = Number(t);
  if (!Number.isFinite(v)) return { kind: 'bad', text: raw.trim() };
  const thousands = /^[+-]?\d{1,3}[.,]\d{3}$/.test(s) ? Number(s.replace(/[.,]/, '')) : null;
  return thousands !== null ? { kind: 'ok', value: v * k, alt: thousands * k } : { kind: 'ok', value: v * k };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(/[_.\-:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const BASE_RE = /\b(base|bottom|piso|hasta|fin|end|fondo)\b|^to$/;
const TOP_RE = /\b(tope|top|techo|desde|from|inicio|start|prof|profundidad|depth|md)\b/;
const NAME_RE = /\b(nombre|zona|formacion|unidad|name|zone|formation|fm|capa|miembro|horizonte|marcador|marker)\b/;

function headerRole(h: string): 'name' | 'top' | 'base' | null {
  const n = norm(h);
  if (BASE_RE.test(n)) return 'base';
  if (TOP_RE.test(n)) return 'top';
  if (NAME_RE.test(n)) return 'name';
  return null;
}

/** Número con coma decimal para los mensajes (máximo 2 decimales). */
const m = (v: number): string => String(Number(v.toFixed(2))).replace('.', ',');
const range = (a: number, b: number) => `${m(a)}–${m(b)} m`;

// ---------------------------------------------------------------------------------------------------------------

interface Item {
  idx: number;
  row: number;
  name: string;
  topRaw: number | null;
  baseRaw: number | null;
  topSnap: number;
  baseSnap: number;
  explicitBase: boolean;
  problems: ZoneTopsProblem[];
  bad: boolean;
}

interface Placed {
  name: string;
  top: number;
  base: number;
  /** Ítem de la planilla; undefined = zona que se conserva. */
  item?: Item;
}

export function parseZoneTops(grid: CellGrid, ctx: ZoneTopsContext): ZoneTopsResult {
  const { depth } = ctx;
  const keep = ctx.keep ?? [];
  const n = depth.length;
  const result = (rows: ZoneTopsRow[], drafts: ZoneDraft[], problems: ZoneTopsProblem[], hasHeader: boolean): ZoneTopsResult => ({
    rows,
    drafts,
    problems,
    errors: problems.filter((p) => p.severity === 'error').length,
    warnings: problems.filter((p) => p.severity === 'warning').length,
    hasHeader,
  });
  const global = (message: string): ZoneTopsProblem => ({ row: null, severity: 'error', message });
  if (n < 2) return result([], [], [global('El pozo no tiene muestras suficientes para crear zonas.')], false);

  const lines = grid.rows
    .map((cells, i) => ({ cells, row: grid.rowNumbers[i] ?? i + 1 }))
    .filter((l) => l.cells.some((c) => c.trim() !== ''));
  if (lines.length === 0) return result([], [], [global('No hay nada para leer: pegá una tabla con el nombre y el tope de cada zona.')], false);

  // Encabezado: la primera fila sin ningún número.
  const hasHeader = lines[0]!.cells.every((c) => parseDepthCell(c).kind !== 'ok') && lines[0]!.cells.some((c) => c.trim() !== '');
  const data = hasHeader ? lines.slice(1) : lines;
  const width = Math.max(...lines.map((l) => l.cells.length));
  const col: { name: number; top: number; base: number } = { name: -1, top: -1, base: -1 };
  const used = new Set<number>();
  if (hasHeader) {
    lines[0]!.cells.forEach((h, j) => {
      const role = headerRole(h);
      if (role && col[role] < 0) {
        col[role] = j;
        used.add(j);
      }
    });
  }
  // Lo que el encabezado no dijo se deduce de los datos: texto = nombre, números = tope y base (en ese orden).
  const isNumeric = (j: number) => {
    let num = 0;
    let all = 0;
    for (const l of data) {
      const c = (l.cells[j] ?? '').trim();
      if (c === '') continue;
      all++;
      if (parseDepthCell(c).kind === 'ok') num++;
    }
    return all > 0 && num * 2 >= all;
  };
  const free = (pred: (j: number) => boolean) => Array.from({ length: width }, (_, j) => j).filter((j) => !used.has(j) && pred(j));
  if (col.name < 0) {
    const j = free((k) => !isNumeric(k))[0];
    if (j !== undefined) (col.name = j), used.add(j);
  }
  if (col.top < 0) {
    const j = free(isNumeric)[0];
    if (j !== undefined) (col.top = j), used.add(j);
  }
  if (col.base < 0 && !hasHeader) {
    const j = free(isNumeric)[0];
    if (j !== undefined) (col.base = j), used.add(j);
  }
  if (col.top < 0) {
    return result([], [], [global('No encontré la columna del tope: tiene que haber una columna con profundidades (encabezado «Tope» o «Top»).')], hasHeader);
  }
  // CSV separado por comas con decimal coma sin comillas: «A,7633,5» parte el número en dos columnas. Es ambiguo,
  // así que no se adivina: si una fila tiene más celdas que el encabezado (o, sin encabezado, números en columnas
  // que no son nombre, tope ni base), se pide otro separador.
  if (grid.delimiter === ',') {
    const roles = new Set([col.name, col.top, col.base]);
    const headerWidth = hasHeader ? lines[0]!.cells.length : 0;
    const extra = data.find((l) =>
      l.cells.some((c, j) => (hasHeader ? j >= headerWidth && c.trim() !== '' : !roles.has(j) && parseDepthCell(c).kind === 'ok')),
    );
    if (extra) {
      return result([], [], [global(`La fila ${extra.row} tiene más números que columnas de tope y base: si los decimales van con coma, separá las columnas con «;» o tabulación (o poné los números entre comillas).`)], hasHeader);
    }
  }
  // Unidad de cada columna: en pies si el encabezado lo dice («Tope (ft)»); si no, metros.
  const factor = (j: number) => (hasHeader && j >= 0 && FEET_HEADER.test(lines[0]!.cells[j] ?? '') ? FT : 1);
  const topFactor = factor(col.top);
  const baseFactor = factor(col.base);

  const d0 = depth[0]!;
  const d1 = depth[n - 1]!;
  const step = (d1 - d0) / (n - 1);
  const span = `${range(d0, d1)}`;
  const items: Item[] = [];
  const err = (it: Item, message: string) => {
    it.problems.push({ row: it.row, severity: 'error', message });
    it.bad = true;
  };
  const warn = (it: Item, message: string) => it.problems.push({ row: it.row, severity: 'warning', message });
  const inWell = (v: number) => v >= d0 - 1e-6 && v <= d1 + 1e-6;
  /** Valor de una celda leída: si la lectura decimal cae fuera del pozo y la de miles adentro, la de miles. */
  const pick = (c: Cell & { kind: 'ok' }) => (!inWell(c.value) && c.alt !== undefined && inWell(c.alt) ? c.alt : c.value);
  /** Pista cuando el número, leído en pies, sí caería dentro del pozo (el pozo se guarda en metros). */
  const feetHint = (v: number, f: number) => (f === 1 && inWell(v * FT) ? ' Si está en pies, indicalo en el encabezado (p. ej. «Tope (ft)») o en la celda («25 040 ft»).' : '');

  // 1. Lectura fila por fila.
  data.forEach((l, idx) => {
    const name = (col.name >= 0 ? (l.cells[col.name] ?? '') : '').trim();
    const top = parseDepthCell(col.top >= 0 ? (l.cells[col.top] ?? '') : '', topFactor);
    const base = col.base >= 0 ? parseDepthCell(l.cells[col.base] ?? '', baseFactor) : ({ kind: 'empty' } as Cell);
    const it: Item = { idx, row: l.row, name, topRaw: null, baseRaw: null, topSnap: NaN, baseSnap: NaN, explicitBase: false, problems: [], bad: false };
    items.push(it);
    if (!name) err(it, `Fila ${l.row}: falta el nombre de la zona.`);
    else if (name.length > 40) err(it, `Fila ${l.row}: el nombre «${name.slice(0, 20)}…» es demasiado largo (máximo 40 caracteres).`);
    const label = name ? `«${name}»` : 'la zona';
    if (top.kind === 'empty') err(it, `Fila ${l.row}: falta el tope de ${label}.`);
    else if (top.kind === 'bad') err(it, `Fila ${l.row}: el tope de ${label} («${top.text}») no es un número.`);
    else {
      it.topRaw = pick(top);
      if (!inWell(it.topRaw)) err(it, `Fila ${l.row}: el tope de ${label} (${m(it.topRaw)} m) está fuera del pozo, que va de ${span}.${feetHint(it.topRaw, topFactor)}`);
    }
    if (base.kind === 'bad') err(it, `Fila ${l.row}: la base de ${label} («${base.text}») no es un número.`);
    else if (base.kind === 'ok') {
      const b = pick(base);
      it.baseRaw = b;
      it.explicitBase = true;
      if (!inWell(b)) err(it, `Fila ${l.row}: la base de ${label} (${m(b)} m) está fuera del pozo, que va de ${span}.${feetHint(b, baseFactor)}`);
      else if (it.topRaw !== null && b <= it.topRaw) err(it, `Fila ${l.row}: la base de ${label} (${m(b)} m) no está por debajo de su tope (${m(it.topRaw)} m).`);
    }
  });

  // 2. Nombres repetidos (entre filas y contra las zonas que se conservan).
  const seen = new Map<string, Item>();
  for (const it of items) {
    if (!it.name) continue;
    const key = it.name.toLowerCase();
    const prev = seen.get(key);
    if (prev) err(it, `Filas ${prev.row} y ${it.row}: el nombre «${it.name}» está repetido.`);
    else seen.set(key, it);
    const kept = keep.find((z) => z.name.trim().toLowerCase() === key);
    if (kept) err(it, `Fila ${it.row}: ya hay una zona «${kept.name}» en el pozo; cambiá el nombre o reemplazá las zonas actuales.`);
  }

  // 3. Resolver bases sobre las filas legibles, ordenadas por tope.
  const ok = items.filter((it) => !it.bad && it.topRaw !== null);
  ok.sort((a, b) => a.topRaw! - b.topRaw! || a.idx - b.idx);
  // Varias filas con el mismo tope: la primera queda y cada una de las demás se compara con ella.
  let anchor: Item | undefined;
  for (const b of ok) {
    if (anchor && Math.abs(anchor.topRaw! - b.topRaw!) < 1e-6) {
      err(b, `Filas ${anchor.row} y ${b.row}: «${anchor.name}» y «${b.name}» empiezan en el mismo tope (${m(anchor.topRaw!)} m).`);
    } else anchor = b;
  }
  const live = ok.filter((it) => !it.bad);
  const tops = [...live.map((it) => it.topRaw!), ...keep.map((z) => z.top)].sort((a, b) => a - b);
  const placed: Placed[] = keep.map((z) => ({ name: z.name, top: z.top, base: z.base }));
  for (const it of live) {
    const next = tops.find((t) => t > it.topRaw! + 1e-6);
    const iNext = next !== undefined ? nearestSample(depth, next) : n;
    let it0 = nearestSample(depth, it.topRaw!);
    // Tope igual a la base de una zona que se conserva: contacto compartido (empieza en la muestra siguiente).
    if (it0 < n - 1 && keep.some((z) => Math.abs(z.base - depth[it0]!) < 1e-6)) it0++;
    // Base explícita en la misma muestra que el tope siguiente: también es un contacto compartido, no un solape.
    const ibx = it.explicitBase ? nearestSample(depth, it.baseRaw!) : -1;
    const ib = it.explicitBase && ibx !== iNext ? ibx : iNext - 1;
    it.topSnap = depth[it0]!;
    if (ib <= it0) {
      err(it, `Fila ${it.row}: «${it.name}» queda sin espesor: su tope y su base (o el tope de la zona siguiente) caen en la misma muestra del pozo.`);
      continue;
    }
    it.baseSnap = depth[ib]!;
    if (it.baseSnap - it.topSnap < MIN_ZONE_THICKNESS - 1e-9) warn(it, `Fila ${it.row}: «${it.name}» tiene solo ${m(it.baseSnap - it.topSnap)} m de espesor (el mínimo al editar zonas es ${m(MIN_ZONE_THICKNESS)} m).`);
    placed.push({ name: it.name, top: it.topSnap, base: it.baseSnap, item: it });
  }

  // 4. Solapes y huecos, de arriba abajo, contra la zona que llega más profundo.
  placed.sort((a, b) => a.top - b.top || (a.item ? 1 : 0) - (b.item ? 1 : 0));
  const label = (p: Placed) => `«${p.name}» (${p.item ? `fila ${p.item.row}, ` : 'ya existe, '}${range(p.top, p.base)})`;
  let deepest: Placed | null = null;
  for (const p of placed) {
    if (deepest && p.top <= deepest.base + 1e-9) {
      const target = p.item ?? deepest.item;
      if (target && !target.bad) err(target, `Fila ${target.row}: ${label(p)} se solapa con ${label(deepest)}.`);
    } else if (deepest && (p.item || deepest.item) && !p.item?.bad && !deepest.item?.bad && p.top - deepest.base > step * 1.5 + 1e-6) {
      // Junto a una fila con error no se avisa de huecos: al corregirla, el hueco suele cambiar o desaparecer.
      const target = p.item ?? deepest.item!;
      warn(target, `Hay un hueco entre «${deepest.name}» y «${p.name}» (${range(deepest.base, p.top)}): esas muestras quedan sin zona.`);
    }
    if (!deepest || p.base > deepest.base) deepest = p;
  }
  if (keep.length === 0 && placed.length > 0) {
    const first = placed[0]!;
    const last = deepest!;
    if (first.item && first.top > d0 + step * 1.5 + 1e-6) warn(first.item, `Las muestras de ${range(d0, first.top)} quedan sin zona (arriba de «${first.name}»).`);
    if (last.item && last.base < d1 - step * 1.5 - 1e-6) warn(last.item, `Las muestras de ${range(last.base, d1)} quedan sin zona (debajo de «${last.name}»).`);
  }

  // 5. Resultado.
  const rows: ZoneTopsRow[] = items.map((it) => ({
    row: it.row,
    name: it.name,
    top: Number.isFinite(it.topSnap) ? it.topSnap : null,
    base: Number.isFinite(it.baseSnap) ? it.baseSnap : null,
    explicitBase: it.explicitBase,
    problems: it.problems,
  }));
  const problems = items.flatMap((it) => it.problems);
  if (items.length === 0) problems.unshift(global('La tabla solo tiene el encabezado: faltan las filas con las zonas.'));
  const drafts: ZoneDraft[] = items
    .filter((it) => !it.bad && Number.isFinite(it.topSnap) && Number.isFinite(it.baseSnap))
    .map((it) => ({ row: it.row, name: it.name, top: it.topSnap, base: it.baseSnap }))
    .sort((a, b) => a.top - b.top);
  problems.sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return result(rows, drafts, problems, hasHeader);
}

/** Atajo: texto pegado → resultado. */
export function parseZoneTopsText(text: string, ctx: ZoneTopsContext): ZoneTopsResult {
  return parseZoneTops(gridFromText(text), ctx);
}
