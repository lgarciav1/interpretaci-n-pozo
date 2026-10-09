/**
 * Formato y parseo de números para la interfaz (es-AR: coma decimal). Puro.
 * Mostrar valores siempre con estas funciones y la clase `num` (cifras tabulares).
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(opts);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('es-AR', opts);
    formatters.set(key, f);
  }
  return f;
}

export interface FormatOptions {
  /** Decimales fijos. */
  digits?: number;
  /** Cifras significativas (si se da, ignora `digits`). */
  significant?: number;
  /** Separador de miles (por defecto sí). */
  grouping?: boolean;
}

/** Número para mostrar; `—` si no es finito. */
export function formatNumber(v: number | null | undefined, opts: FormatOptions = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const grouping = opts.grouping ?? true;
  if (opts.significant !== undefined) {
    return formatter({ maximumSignificantDigits: opts.significant, useGrouping: grouping }).format(v);
  }
  const d = opts.digits ?? 2;
  return formatter({ minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: grouping }).format(v);
}

/** Cantidad de decimales que implica un paso (0,01 → 2; 0,5 → 1; 5 → 0). */
export function decimalsForStep(step: number | undefined): number {
  if (!step || !Number.isFinite(step) || step >= 1) return 0;
  const s = step.toString();
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  return s.split('.')[1]?.length ?? 0;
}

/** Formato de un valor de parámetro según su paso (o 3 cifras significativas en escala log sin paso). */
export function formatParamValue(v: number, spec: { step?: number; scale?: 'linear' | 'log' }, grouping = false): string {
  if (spec.scale === 'log' && !spec.step) return formatNumber(v, { significant: 3, grouping });
  return formatNumber(v, { digits: decimalsForStep(spec.step), grouping });
}

/**
 * Parsea lo que escribe el usuario, con coma o punto decimal: '0,35', '0.35', '-1,5e-3', '1.234,5', '1,234.5',
 * '− 2' (signo menos tipográfico). Devuelve null si no es un número.
 */
export function parseDecimal(text: string): number | null {
  let s = text.trim().replace(/[\s  ]/g, '').replace(/−/g, '-');
  if (!s) return null;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    // El último separador es el decimal; el otro, de miles.
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma >= 0) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replace(',', '.');
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
