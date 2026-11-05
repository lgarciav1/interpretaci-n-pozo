/**
 * Lógica pura del menú contextual del perfil y de la herramienta de medir (docs/decisiones/0067, D12): qué curva se
 * edita, qué se copia y cómo se rotula un intervalo medido. El menú en sí (React) está en WellViewer.tsx.
 */
import { formatNumber } from '../ui/format';
import type { TrackBox } from './layout';
import { formatReadout, valueAt } from './readout';
import type { ResolvedCurve, ResolvedTrack } from './resolve';
import { valueToFraction } from './scale';

/** Curva de línea de la pista más cercana al puntero en la muestra `idx` (o la de arriba si ninguna tiene dato). */
export function nearestCurveAt(track: ResolvedTrack, box: Pick<TrackBox, 'x' | 'width'>, idx: number, x: number): ResolvedCurve | null {
  const lines = track.curves.filter((c) => c.kind === 'line');
  if (!lines.length) return track.curves[track.curves.length - 1] ?? null;
  let best: ResolvedCurve | null = null;
  let bestD = Infinity;
  for (const c of lines) {
    const f = valueToFraction(valueAt(c.data, idx), c.axis);
    if (!Number.isFinite(f)) continue;
    const d = Math.abs(box.x + Math.min(1, Math.max(0, f)) * box.width - x);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best ?? lines[lines.length - 1]!;
}

const m = (d: number) => `${formatNumber(d, { digits: 2, grouping: false })} m`;

/**
 * Texto para el portapapeles: profundidad (MD y TVDSS si hay) y la lectura de cada curva a la vista en esa muestra,
 * una por línea y separada por tabulador (se pega en una planilla como dos columnas). Una curva que está en dos pistas
 * va una sola vez.
 */
export function readingsText(tracks: readonly ResolvedTrack[], idx: number, depth: number, tvdss?: ArrayLike<number> | null): string {
  const lines = [`MD\t${m(depth)}`];
  const tv = tvdss && idx >= 0 ? tvdss[idx] : undefined;
  if (tv !== undefined && Number.isFinite(tv)) lines.push(`TVDSS\t${m(tv)}`);
  const seen = new Set<string>();
  for (const t of tracks) {
    if (t.kind === 'stack' && t.stack && !t.stack.empty) continue;
    for (const c of t.curves) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      const unit = c.kind === 'line' && c.unitLabel && c.unitLabel !== '—' ? ` ${c.unitLabel}` : '';
      const v = formatReadout(valueAt(c.data, idx), c.kind);
      lines.push(`${c.name}${c.alternative ? ' (alternativa)' : ''}\t${v}${v === '—' ? '' : unit}`);
    }
  }
  return lines.join('\n');
}

/** Interpolación lineal de la TVDSS en una MD (acotada a los extremos). */
function tvdssAt(md: ArrayLike<number>, tvdss: ArrayLike<number>, d: number): number {
  const n = Math.min(md.length, tvdss.length);
  if (n === 0) return NaN;
  if (d <= md[0]!) return tvdss[0]! + (d - md[0]!);
  if (d >= md[n - 1]!) return tvdss[n - 1]! + (d - md[n - 1]!);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (md[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return tvdss[lo]! + ((d - md[lo]!) / (md[hi]! - md[lo]!)) * (tvdss[hi]! - tvdss[lo]!);
}

export interface Measurement {
  top: number;
  base: number;
  /** Espesor en MD (m). */
  thickness: number;
  /** Espesor vertical (TVD), si hay TVDSS. */
  vertical?: number;
}

/** Intervalo medido entre dos profundidades (en cualquier orden), con su espesor vertical si hay TVDSS. */
export function measureInterval(a: number, b: number, md?: ArrayLike<number> | null, tvdss?: ArrayLike<number> | null): Measurement {
  const top = Math.min(a, b);
  const base = Math.max(a, b);
  const out: Measurement = { top, base, thickness: base - top };
  if (md && tvdss && tvdss.length) {
    const v = tvdssAt(md, tvdss, base) - tvdssAt(md, tvdss, top);
    if (Number.isFinite(v)) out.vertical = v;
  }
  return out;
}

/** «7.906,20–7.931,05 m · espesor 24,85 m» (+ «· vertical 24,10 m» si el pozo está desviado). */
export function measureLabel(x: Measurement): string {
  const f = (v: number) => formatNumber(v, { digits: 2, grouping: false });
  const vertical = x.vertical !== undefined && Math.abs(x.vertical - x.thickness) > 0.005 ? ` · vertical ${f(x.vertical)} m` : '';
  return `${f(x.top)}–${f(x.base)} m · espesor ${f(x.thickness)} m${vertical}`;
}
