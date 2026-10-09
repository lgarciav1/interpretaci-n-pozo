/**
 * Encabezado de pozo (fase 4b): qué campos de `Well.header` se muestran y con qué nombre. Los LAS usan mnemónicos
 * (FLD, COMP, EKB…); un Excel puede traer nombres en español. Puro.
 */
import { unitLabel } from '../core/units';
import type { HeaderEntry, Well } from '../core/well';
import { formatNumber } from '../ui/format';

export interface HeaderField {
  key: string;
  label: string;
  value: string;
}

/** Campos conocidos, en el orden en que se muestran. Las claves se comparan sin mayúsculas ni acentos. */
const KNOWN: readonly { label: string; keys: readonly string[] }[] = [
  { label: 'Yacimiento', keys: ['FLD', 'FIELD', 'YACIMIENTO', 'CAMPO'] },
  { label: 'Compañía', keys: ['COMP', 'COMPANY', 'COMPANIA', 'OPERADOR', 'OPERATOR'] },
  { label: 'KB', keys: ['EKB', 'KB', 'ELEV_KB', 'KB_ELEV', 'ELEVKB'] },
  { label: 'Mesa (DF)', keys: ['EDF', 'DF', 'ELEV_DF'] },
  { label: 'Terreno', keys: ['EGL', 'GL', 'ELEV_GL', 'GLE'] },
  { label: 'Ubicación', keys: ['LOC', 'LOCATION', 'UBICACION'] },
  { label: 'Provincia', keys: ['PROV', 'STAT', 'STATE', 'PROVINCIA'] },
  { label: 'País', keys: ['CTRY', 'COUNTRY', 'PAIS'] },
  { label: 'Identificador', keys: ['UWI', 'API'] },
  { label: 'Servicio', keys: ['SRVC', 'SERVICE', 'SERVICIO'] },
  { label: 'Fecha', keys: ['DATE', 'FECHA'] },
  { label: 'Prof. final', keys: ['TD', 'TDD', 'TDL'] },
  { label: 'Temp. de fondo', keys: ['BHT'] },
];

/** Claves que ya se muestran de otra forma (nombre, intervalo, paso) o que no le dicen nada al usuario. */
const SKIP = new Set(['WELL', 'STRT', 'STOP', 'STEP', 'NULL', 'VERS', 'WRAP']);

const norm = (k: string) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

function formatEntry(e: HeaderEntry): string {
  const v = typeof e.value === 'number' ? formatNumber(e.value, { significant: 6, grouping: true }) : String(e.value).trim();
  if (!v) return '';
  const u = e.unit ? unitLabel(e.unit) : '';
  return u && u !== '—' ? `${v} ${u}` : v;
}

/** Campos del encabezado: `primary` (conocidos, en orden) y `others` (el resto, con su descripción o mnemónico). */
export function wellHeaderFields(well: Pick<Well, 'header'>): { primary: HeaderField[]; others: HeaderField[] } {
  const entries = Object.entries(well.header ?? {}).map(([k, e]) => ({ k, n: norm(k), e }));
  const used = new Set<string>();
  const primary: HeaderField[] = [];
  for (const f of KNOWN) {
    const hit = entries.find((x) => f.keys.includes(x.n) && !used.has(x.k) && formatEntry(x.e));
    if (!hit) continue;
    used.add(hit.k);
    // Un mismo concepto con varias claves (EKB y KB): se usa la primera y se descartan las demás.
    for (const x of entries) if (f.keys.includes(x.n)) used.add(x.k);
    primary.push({ key: hit.k, label: f.label, value: formatEntry(hit.e) });
  }
  const others: HeaderField[] = [];
  for (const x of entries) {
    if (used.has(x.k) || SKIP.has(x.n)) continue;
    const value = formatEntry(x.e);
    if (!value) continue;
    const desc = x.e.description?.trim();
    others.push({ key: x.k, label: desc ? `${desc} (${x.k})` : x.k, value });
  }
  return { primary, others };
}
