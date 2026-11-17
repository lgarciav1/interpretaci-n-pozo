/**
 * Lógica pura del panel y de la superposición de capas de pay (sin React ni canvas): lee la tabla PAY_INTERVALS, da a
 * cada tramo una clave estable, lee y escribe los tramos elegidos (punzados sugeridos) en
 * `interpretation.moduleState['pay-intervals']` y arma las filas de la exportación a Excel.
 *
 * Clave de un tramo: `zoneId|tope|base` con tope y base redondeados al centímetro. No depende del orden (rank) ni de
 * los parámetros mientras el tramo sea el mismo; si un cambio de espesor mínimo o tolerancia lo modifica, la elección
 * queda «huérfana» (se informa y se puede limpiar) en lugar de pasar a otro tramo.
 */
import type { Interpretation, JsonValue } from '../../core/interpretation';
import type { TableCell } from '../../core/module';
import { setModuleState, type Project } from '../../core/state/project';
import type { XlsxCell, XlsxSheet } from '../../io/export/xlsx';

export const MODULE_ID = 'pay-intervals';
export const TABLE_PORT = 'PAY_INTERVALS';

export type Row = Readonly<Record<string, TableCell>>;

/** Tramo listo para la tabla, la superposición y la exportación (NaN = sin dato). */
export interface PayRow {
  key: string;
  rank: number;
  zoneId: string;
  zone: string;
  /** m */
  top: number;
  /** m */
  base: number;
  /** m */
  gross: number;
  /** m */
  net: number;
  gaps: number;
  /** v/v */
  phi: number;
  /** v/v */
  sw: number;
  /** mD */
  k: number;
  /** mD·m */
  kh: number;
  /** m */
  hphi: number;
  /** m */
  hphiSh: number;
  /** % del k·h de los tramos listados */
  khPct: number;
}

const cellNum = (c: TableCell | undefined): number => (typeof c === 'number' && Number.isFinite(c) ? c : NaN);
const cellText = (c: TableCell | undefined): string => (c === null || c === undefined ? '' : String(c));

/** Clave estable de un tramo (zona + tope y base al centímetro). */
export function intervalKey(zoneId: string, top: number, base: number): string {
  return `${zoneId}|${top.toFixed(2)}|${base.toFixed(2)}`;
}

/** Filas de PAY_INTERVALS como tramos (en el orden de la tabla: por rank). Descarta las que no tienen tope/base. */
export function payRowsFrom(rows: readonly Row[]): PayRow[] {
  const out: PayRow[] = [];
  for (const r of rows) {
    const top = cellNum(r.top);
    const base = cellNum(r.base);
    if (!Number.isFinite(top) || !Number.isFinite(base)) continue;
    const zoneId = cellText(r.zoneId);
    out.push({
      key: intervalKey(zoneId, top, base),
      rank: cellNum(r.rank),
      zoneId,
      zone: cellText(r.zone),
      top,
      base,
      gross: cellNum(r.gross),
      net: cellNum(r.net),
      gaps: Number.isFinite(cellNum(r.gaps)) ? cellNum(r.gaps) : 0,
      phi: cellNum(r.phi),
      sw: cellNum(r.sw),
      k: cellNum(r.k),
      kh: cellNum(r.kh),
      hphi: cellNum(r.hphi),
      hphiSh: cellNum(r.hphiSh),
      khPct: cellNum(r.khPct),
    });
  }
  return out;
}

/** Totales del encabezado del panel. Sin curva de permeabilidad, `kh` es NaN y `hasPerm` false. */
export interface PaySummary {
  count: number;
  net: number;
  gross: number;
  kh: number;
  hasPerm: boolean;
}

export function summarize(rows: readonly PayRow[]): PaySummary {
  const hasPerm = rows.some((r) => Number.isFinite(r.kh));
  let net = 0;
  let gross = 0;
  let kh = 0;
  for (const r of rows) {
    if (Number.isFinite(r.net)) net += r.net;
    if (Number.isFinite(r.gross)) gross += r.gross;
    if (Number.isFinite(r.kh)) kh += r.kh;
  }
  return { count: rows.length, net, gross, kh: hasPerm ? kh : NaN, hasPerm };
}

// ── selección (punzados sugeridos) ──────────────────────────────────────────────────────────────────────────────

/** Claves elegidas guardadas (en el orden en que se eligieron, sin repetir). Lo inválido se ignora. */
export function readPicks(interpretation: Pick<Interpretation, 'moduleState'> | undefined): string[] {
  const state = interpretation?.moduleState?.[MODULE_ID];
  if (!state || typeof state !== 'object' || Array.isArray(state)) return [];
  const picked = (state as { readonly [k: string]: JsonValue }).picked;
  if (!Array.isArray(picked)) return [];
  return [...new Set(picked.filter((k): k is string => typeof k === 'string'))];
}

/** Receta: deja elegidas exactamente `keys` (vacío = quita el estado del módulo). */
export function picksRecipe(wellId: string, keys: readonly string[]): (p: Project) => Project {
  const unique = [...new Set(keys)];
  return (p) => {
    // Misma selección (p. ej. «Elegir primeros» dos veces): el proyecto no cambia y no se suma un paso de deshacer.
    const entry = p.wells.find((e) => e.well.id === wellId);
    const current = entry ? readPicks(entry.interpretation) : null;
    if (current && current.length === unique.length && current.every((k, i) => k === unique[i])) {
      const raw = entry!.interpretation.moduleState?.[MODULE_ID];
      // Solo si lo guardado ya es exactamente { picked } (sin claves inválidas que limpiar).
      if (unique.length === 0 ? raw === undefined : isPlainPicks(raw, unique.length)) return p;
    }
    return setModuleState(p, wellId, MODULE_ID, unique.length ? { picked: unique } : undefined);
  };
}

function isPlainPicks(raw: JsonValue | undefined, n: number): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as { readonly [k: string]: JsonValue };
  return Object.keys(o).length === 1 && Array.isArray(o.picked) && o.picked.length === n;
}

/** Alterna un tramo en la selección. */
export function togglePick(picks: readonly string[], key: string): string[] {
  return picks.includes(key) ? picks.filter((k) => k !== key) : [...picks, key];
}

/** Elige los `n` primeros (por rank) y deja de lado el resto, incluidas las elecciones huérfanas. */
export function firstN(rows: readonly PayRow[], n: number): string[] {
  return [...rows]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.max(0, Math.floor(n)))
    .map((r) => r.key);
}

/** Tramos elegidos que existen hoy, y cuántas claves guardadas ya no coinciden con ningún tramo. */
export function resolvePicks(rows: readonly PayRow[], picks: readonly string[]): { picked: PayRow[]; orphans: number } {
  const set = new Set(picks);
  const picked = rows.filter((r) => set.has(r.key));
  return { picked, orphans: set.size - picked.length };
}

// ── visor ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Tramo a mostrar en el visor al hacer clic: centrado en el tramo, con al menos `minSpan` m de contexto. */
export function viewRangeFor(top: number, base: number, minSpan = 20): { top: number; base: number } {
  const mid = (top + base) / 2;
  const span = Math.max(minSpan, (base - top) * 1.6);
  return { top: mid - span / 2, base: mid + span / 2 };
}

// ── exportación ─────────────────────────────────────────────────────────────────────────────────────────────────

const n = (v: number): XlsxCell => (Number.isFinite(v) ? v : null);
const round = (v: number, digits: number): XlsxCell => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null);

/** Hoja «Capas de pay» (y, si hay elegidos, «Punzados sugeridos» con solo esos, por profundidad). */
export function exportSheets(rows: readonly PayRow[], picks: readonly string[], meta: { wellName: string }): XlsxSheet[] {
  const set = new Set(picks);
  const hasPerm = rows.some((r) => Number.isFinite(r.kh));
  const head: XlsxCell[] = [
    'Orden',
    'Elegido',
    'Zona',
    'Tope (m)',
    'Base (m)',
    'Espesor neto (m)',
    'Espesor bruto (m)',
    'Intercalaciones',
    'φ (v/v)',
    'Sw (v/v)',
    ...(hasPerm ? ['k (mD)', 'k·h (mD·m)', 'k·h del total (%)'] : []),
    'h·φ (m)',
    'h·φ·Sh (m)',
  ];
  const line = (r: PayRow): XlsxCell[] => [
    n(r.rank),
    set.has(r.key) ? 'Sí' : 'No',
    r.zone,
    round(r.top, 2),
    round(r.base, 2),
    round(r.net, 2),
    round(r.gross, 2),
    r.gaps,
    round(r.phi, 3),
    round(r.sw, 3),
    ...(hasPerm ? [round(r.k, 2), round(r.kh, 1), round(r.khPct, 1)] : []),
    round(r.hphi, 3),
    round(r.hphiSh, 3),
  ];
  const widths = [8, 9, 16, 11, 11, 16, 16, 15, 10, 10, ...(hasPerm ? [10, 13, 17] : []), 11, 12];
  const sheets: XlsxSheet[] = [{ name: 'Capas de pay', rows: [head, ...rows.map(line)], widths }];
  const picked = rows.filter((r) => set.has(r.key)).sort((a, b) => a.top - b.top);
  if (picked.length) sheets.push({ name: 'Punzados sugeridos', rows: [head, ...picked.map(line)], widths });
  const s = summarize(rows);
  const info: XlsxCell[][] = [
    ['Campo', 'Valor', 'Unidad'],
    ['Pozo', meta.wellName, null],
    ['Tramos', s.count, null],
    ['Σ espesor neto', round(s.net, 2), 'm'],
    ['Σ k·h', hasPerm ? round(s.kh, 1) : 'sin permeabilidad', hasPerm ? 'mD·m' : null],
    ['Tramos elegidos', picked.length, null],
    ['Orden', hasPerm ? 'k·h decreciente' : 'h·φ decreciente (sin permeabilidad)', null],
    ['Tope y base', 'bordes de la celda de la primera y la última muestra de pay', null],
  ];
  sheets.push({ name: 'Notas', rows: info, widths: [18, 56, 10] });
  return sheets;
}
