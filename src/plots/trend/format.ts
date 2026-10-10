/**
 * Textos de una tendencia para el visor, el tooltip y el panel (coma decimal). Puro.
 * La ecuación numérica del ajuste SÍ se muestra (docs/decisiones/0008, D1): es un resultado, no la ecuación de un
 * método.
 */
import type { TrendSpec } from '../../core/trends';
import type { GradientReading } from '../../petro/gradients';
import { formatTrendEquation, TREND_MODEL_DOCS, type TrendModel } from '../../petro/regression';
import { formatNumber } from '../../ui/format';
import type { TrendResult } from './compute';
import type { ResolvedSeries } from './series';

export const MODEL_LABEL: Readonly<Record<TrendModel, string>> = {
  linear: TREND_MODEL_DOCS.linear.label,
  log: TREND_MODEL_DOCS.log.label,
  exp: TREND_MODEL_DOCS.exp.label,
  power: TREND_MODEL_DOCS.power.label,
};

/** Ecuación con los nombres de la serie (z = profundidad en m). */
export function trendEquation(r: TrendResult, s: ResolvedSeries | null): string {
  if (!r.coeffs) return '—';
  return formatTrendEquation(r.coeffs, { x: s?.xIsDepth ? 'z' : s?.ref.key ?? 'x', y: s?.label ?? 'y', digits: 4 });
}

export function formatR2(r2: number | null): string {
  return r2 === null || !Number.isFinite(r2) ? '—' : formatNumber(r2, { digits: 3 });
}

/** Valor de un gradiente con 3–4 cifras significativas (y signo menos tipográfico). */
export function formatGradientValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const text = abs >= 1000 ? formatNumber(v, { digits: 0 }) : formatNumber(v, { significant: abs >= 1 ? 4 : 3, grouping: false });
  return text.replace(/^-/, '−');
}

export function formatGradient(g: GradientReading): string {
  return `${formatGradientValue(g.value)} ${g.unit}`;
}

export function primaryGradient(r: TrendResult): GradientReading | null {
  return r.gradients.find((g) => g.primary) ?? r.gradients[0] ?? null;
}

/** Rótulo de la pendiente: «Gradiente» (lineal) o «Gradiente en el centro del tramo (7 850 m)». */
export function gradientCaption(r: TrendResult, s: ResolvedSeries | null): string {
  const what = s?.xIsDepth ? 'Gradiente' : 'Pendiente';
  if (!r.slope?.local) return what;
  const at = s?.xIsDepth ? `${formatNumber(r.slope.at, { digits: 1 })} m` : formatNumber(r.slope.at, { significant: 4 });
  return `${what} en el centro del tramo (${at})`;
}

/** Dos líneas para la etiqueta del visor: ecuación; R² · gradiente primario. */
export function trendCanvasLabel(spec: TrendSpec, r: TrendResult, s: ResolvedSeries | null): [string, string] {
  const eq = trendEquation(r, s);
  const g = primaryGradient(r);
  const r2 = spec.mode === 'manual' ? 'a mano' : `R² ${formatR2(r.r2)}`;
  const grad = g ? `${formatGradient(g)}${r.slope?.local ? ' (centro)' : ''}` : '';
  return [eq, grad ? `${r2} · ${grad}` : r2];
}

/**
 * Etiqueta de una línea para pistas angostas: gradiente primario y, si es de presión, la densidad equivalente
 * («0,453 psi/ft · 1,04 g/cm³»). Segunda línea vacía (`drawTrendLabel` la dibuja de una sola línea).
 */
export function trendGradientLabel(spec: TrendSpec, r: TrendResult): [string, string] {
  const g = primaryGradient(r);
  if (!g) return [spec.name, ''];
  const dens = r.gradients.find((x) => x.unit.startsWith('g/cm³'));
  const d = dens && Number.isFinite(dens.value) ? ` · ${formatNumber(dens.value, { digits: 2 })} g/cm³` : '';
  return [`${formatGradient(g)}${d}${spec.mode === 'manual' ? ' · a mano' : ''}`, ''];
}

/** Tooltip (varias líneas): nombre, ecuación, R² y n, gradientes. */
export function trendTooltip(spec: TrendSpec, r: TrendResult, s: ResolvedSeries | null, hint?: string): string {
  const lines = [`${spec.name} · ${MODEL_LABEL[spec.model]}${spec.mode === 'manual' ? ' a mano' : ''}`];
  if (!r.coeffs) lines.push(r.problem ?? 'Sin ajuste');
  else {
    lines.push(trendEquation(r, s));
    const parts = [`R² ${formatR2(r.r2)}`, `n ${formatNumber(r.n, { digits: 0 })}`];
    if (r.excluded) parts.push(`${formatNumber(r.excluded, { digits: 0 })} excluidos`);
    if (r.skipped) parts.push(`${formatNumber(r.skipped, { digits: 0 })} sin dato`);
    lines.push(parts.join(' · '));
    if (r.gradients.length) lines.push(`${gradientCaption(r, s)}: ${r.gradients.map(formatGradient).join(' · ')}`);
  }
  if (hint) lines.push(hint);
  return lines.join('\n');
}
