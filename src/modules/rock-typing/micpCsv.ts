/**
 * Lector genérico de curvas MICP (inyección de mercurio) en CSV o TSV (docs/decisiones/0024-rock-typing.md,
 * 0087-micp-del-tp.md). Produce un `PointSet` de tipo `capillary` compatible con «Tipos de roca» y «Análisis MICP».
 *
 * Puro (sin React, stores ni `src/plots`). Acepta separador coma, punto y coma o tabulación, coma decimal cuando el
 * separador no es coma, presiones en psi, kg/cm², bar, kPa o MPa (detectadas en el encabezado), Sw o SHg en v/v o %,
 * y columnas opcionales `sample`, `k` (mD), `phi` (v/v o %) y `depth` (m).
 */
import { createPointSet, type PointColumn, type PointSet } from '../../core/pointSets';
import { KGF_CM2_TO_PSI } from '../../petro/rockTyping';
import { CAPILLARY_KIND } from './model';

const BAR_TO_PSI = 14.503773773020923;
const KPA_TO_PSI = 0.14503773773020923;
const MPA_TO_PSI = 145.03773773020923;

export type MicpPressureUnit = 'psi' | 'kg/cm²' | 'bar' | 'kPa' | 'MPa';

export interface MicpCsvImport {
  set: PointSet;
  sampleCount: number;
  rowCount: number;
  pressureUnit: MicpPressureUnit;
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const cleanCell = (s: string) => s.trim().replace(/^["']|["']$/g, '').trim();
const normHeader = (s: string) => stripAccents(cleanCell(s)).toLowerCase();

function detectDelimiter(headerLine: string): ',' | ';' | '\t' {
  const counts: Record<',' | ';' | '\t', number> = {
    '\t': (headerLine.match(/\t/g) ?? []).length,
    ';': (headerLine.match(/;/g) ?? []).length,
    ',': (headerLine.match(/,/g) ?? []).length,
  };
  if (counts['\t'] > 0 && counts['\t'] >= counts[';'] && counts['\t'] >= counts[',']) return '\t';
  if (counts[';'] > 0 && counts[';'] >= counts[',']) return ';';
  return ',';
}

function parseNumber(raw: string | undefined, commaDecimal: boolean): number {
  if (!raw) return NaN;
  const s = cleanCell(raw);
  if (!s) return NaN;
  const normalized = commaDecimal ? s.replace(/\s+/g, '').replace(',', '.') : s.replace(/\s+/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function detectPressureUnit(header: string): { unit: MicpPressureUnit; toPsi: number } {
  const h = normHeader(header);
  if (h.includes('kg/cm') || h.includes('kgcm') || h.includes('kgf')) return { unit: 'kg/cm²', toPsi: KGF_CM2_TO_PSI };
  if (h.includes('mpa')) return { unit: 'MPa', toPsi: MPA_TO_PSI };
  if (h.includes('kpa')) return { unit: 'kPa', toPsi: KPA_TO_PSI };
  if (/\bbar\b/.test(h) || h.includes('(bar)') || h.includes('_bar')) return { unit: 'bar', toPsi: BAR_TO_PSI };
  return { unit: 'psi', toPsi: 1 };
}

function findColumn(headers: readonly string[], match: (h: string) => boolean): number {
  return headers.findIndex((h) => match(h));
}

/** Parsea un archivo CSV/TSV de ensayos MICP a un `PointSet` de tipo `capillary`. */
export function parseMicpCsv(text: string, filename: string, id: string): MicpCsvImport {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 3) {
    throw new Error('El archivo debe tener encabezado y al menos dos filas de datos.');
  }

  const delim = detectDelimiter(lines[0]!);
  const commaDecimal = delim !== ',';
  const rawHeaders = lines[0]!.split(delim).map(cleanCell);
  const headers = rawHeaders.map(normHeader);

  const iSample = findColumn(headers, (h) => /^(sample|muestra|plug|id|name|nombre)\b/.test(h));
  const iPc = findColumn(headers, (h) => /^(pc|presion|pressure)\b/.test(h) || h.startsWith('pc_') || h.startsWith('pc('));
  const iSw = findColumn(headers, (h) => /^(sw|sw_|sw\(|sw%|saturacion|saturation)\b/.test(h) || h === 'sw%' || h.startsWith('sw_'));
  const iShg = findColumn(headers, (h) => /^(shg|hg|mercurio|mercury)\b/.test(h) || h.startsWith('shg') || h.includes('mercury'));
  const iK = findColumn(headers, (h) => /^(k|perm|permeabilidad|permeability|kgas)\b/.test(h) || h.startsWith('k_') || h.startsWith('k('));
  const iPhi = findColumn(headers, (h) => /^(phi|poro|porosidad|porosity)\b/.test(h) || h.startsWith('phi_') || h.startsWith('phi('));
  const iDepth = findColumn(headers, (h) => /^(depth|prof|profundidad|md|z)\b/.test(h));

  if (iPc < 0) {
    throw new Error('Falta la columna de presión capilar (por ejemplo: pc, pc_psi o pc_kgcm2).');
  }
  if (iSw < 0 && iShg < 0) {
    throw new Error('Falta la columna de saturación (sw o shg, en fracción v/v o en %).');
  }

  const useShg = iSw < 0;
  const iSat = useShg ? iShg : iSw;
  const { unit: pressureUnit, toPsi } = detectPressureUnit(rawHeaders[iPc]!);
  const satHeaderPct = headers[iSat]!.includes('%') || headers[iSat]!.includes('pct');
  const phiHeaderPct = iPhi >= 0 && (headers[iPhi]!.includes('%') || headers[iPhi]!.includes('pct'));

  const baseName = filename.replace(/\.[^.]+$/, '').trim() || 'MICP';

  interface ParsedRow {
    sample: string;
    pcPsi: number;
    satRaw: number;
    k: number;
    phiRaw: number;
    depth: number;
  }

  const parsed: ParsedRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = lines[li]!.split(delim);
    const pcVal = parseNumber(cols[iPc], commaDecimal);
    const satVal = parseNumber(cols[iSat], commaDecimal);
    if (!(pcVal > 0) || !Number.isFinite(satVal)) continue;
    const sample = iSample >= 0 ? cleanCell(cols[iSample] ?? '') || baseName : baseName;
    const k = iK >= 0 ? parseNumber(cols[iK], commaDecimal) : NaN;
    const phiRaw = iPhi >= 0 ? parseNumber(cols[iPhi], commaDecimal) : NaN;
    const depth = iDepth >= 0 ? parseNumber(cols[iDepth], commaDecimal) : 0;
    parsed.push({
      sample,
      pcPsi: pcVal * toPsi,
      satRaw: satVal,
      k,
      phiRaw,
      depth: Number.isFinite(depth) ? depth : 0,
    });
  }

  if (parsed.length < 2) {
    throw new Error('No se encontraron al menos dos puntos válidos con Pc > 0 y saturación finita.');
  }

  const satIsPct = satHeaderPct || parsed.some((r) => r.satRaw > 1.0001);
  const phiIsPct = phiHeaderPct || parsed.some((r) => Number.isFinite(r.phiRaw) && r.phiRaw > 1);

  const valid = parsed
    .map((r) => {
      const satFrac = satIsPct ? r.satRaw / 100 : r.satRaw;
      const sw = useShg ? 1 - satFrac : satFrac;
      const phi = Number.isFinite(r.phiRaw) ? (phiIsPct ? r.phiRaw / 100 : r.phiRaw) : NaN;
      return { ...r, sw, phi };
    })
    .filter((r) => r.sw >= -1e-6 && r.sw <= 1 + 1e-6)
    .map((r) => ({ ...r, sw: Math.min(1, Math.max(0, r.sw)) }));

  if (valid.length < 2) {
    throw new Error('Los valores de saturación quedaron fuera de [0, 1] (o [0, 100] %).');
  }

  const counts = new Map<string, number>();
  const pointIds = valid.map((r) => {
    const n = (counts.get(r.sample) ?? 0) + 1;
    counts.set(r.sample, n);
    return `${r.sample}·${String(n).padStart(2, '0')}`;
  });

  const columns: Record<string, PointColumn> = {
    sample: { label: 'Muestra', values: valid.map((r) => r.sample) },
    pc: { label: 'Presión capilar Hg–aire', unit: 'psi', values: Float64Array.from(valid, (r) => r.pcPsi) },
    sw: { label: 'Saturación mojante', unit: 'v/v', values: Float64Array.from(valid, (r) => r.sw) },
  };
  if (valid.some((r) => Number.isFinite(r.k) && r.k > 0)) {
    columns['k'] = { label: 'Permeabilidad', unit: 'mD', values: Float64Array.from(valid, (r) => r.k) };
  }
  if (valid.some((r) => Number.isFinite(r.phi) && r.phi > 0 && r.phi < 1)) {
    columns['phi'] = { label: 'Porosidad', unit: 'v/v', values: Float64Array.from(valid, (r) => r.phi) };
  }

  const set = createPointSet({
    id,
    kind: CAPILLARY_KIND,
    name: filename,
    source: `CSV importado · ${filename}`,
    depth: Float64Array.from(valid, (r) => r.depth),
    pointIds,
    columns,
  });

  return { set, sampleCount: counts.size, rowCount: valid.length, pressureUnit };
}
