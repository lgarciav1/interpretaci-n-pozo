/**
 * Lógica pura del menú contextual del perfil y de la herramienta de medir (docs/decisiones/0067, D12): qué curva se
 * edita, qué se copia y cómo se rotula un intervalo medido. El menú en sí (React) está en WellViewer.tsx.
 */
import { NOTE_MAX_LENGTH } from '../core/notes';
import type { DepthIntervalSummary } from '../petro/summary';
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

/**
 * Clave de la salida del motor (`<moduleId>:<puerto>`) de una curva calculada del visor (`c:<moduleId>:<puerto>`), para
 * «¿De dónde sale este número?» (docs/decisiones/0074). null si la curva es medida o preparada.
 */
export function outputKeyOfViewerCurve(curve: Pick<ResolvedCurve, 'key' | 'origin'>): string | null {
  return curve.origin === 'computed' && curve.key.startsWith('c:') ? curve.key.slice(2) : null;
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

export interface MeasureCardItem {
  label: string;
  value: string;
  /** Destacar el valor con color de acento (p. ej. espesor pay positivo). */
  accent?: boolean;
}

export interface MeasureCardContent {
  items: MeasureCardItem[];
  /** Aviso breve al pie de la tarjeta (p. ej. sin cutoffs o falta Sw en el reservorio). */
  note?: string;
}

const fmtK = (v: number) => (Math.abs(v) >= 100 ? formatNumber(v, { digits: 1 }) : formatNumber(v, { significant: 3 }));

/**
 * Métricas disponibles para la tarjeta compacta de la regla viva (G01). Nunca inventa ceros cuando faltan curvas:
 * si no hay métricas petrofísicas disponibles, devuelve `items: []` y la regla dibuja solo `tope–base · Δh`.
 */
export function measureCardItems(summary: DepthIntervalSummary | null | undefined): MeasureCardContent {
  if (!summary || summary.sampleCount === 0) return { items: [] };
  const items: MeasureCardItem[] = [];
  if (summary.hasNetRes) {
    if (Number.isFinite(summary.netRes)) {
      items.push({ label: 'Res.', value: `${formatNumber(summary.netRes, { digits: 2 })} m` });
    }
    if (summary.hasNetPay && Number.isFinite(summary.netPay)) {
      const ntg = Number.isFinite(summary.ntgPay) ? ` · NTG ${formatNumber(summary.ntgPay, { digits: 2 })}` : '';
      items.push({ label: 'Pay', value: `${formatNumber(summary.netPay, { digits: 2 })} m${ntg}`, accent: summary.netPay > 0 });
    }
    if (Number.isFinite(summary.phiRes)) {
      items.push({ label: 'φe (res.)', value: `${formatNumber(summary.phiRes, { digits: 3 })} v/v` });
    }
    if (Number.isFinite(summary.swPay)) {
      items.push({ label: 'Sw (pay)', value: `${formatNumber(summary.swPay, { digits: 3 })} v/v` });
    }
    if (Number.isFinite(summary.kGeoPay)) {
      items.push({ label: 'k geom.', value: `${fmtK(summary.kGeoPay)} mD` });
    }
    if (summary.hasNetPay && summary.netPay > 0 && Number.isFinite(summary.khPay)) {
      items.push({ label: 'k·h', value: `${fmtK(summary.khPay)} mD·m` });
    }
    if (summary.hasNetPay && summary.netPay > 0 && Number.isFinite(summary.hphiShPay)) {
      items.push({ label: 'h·φ·Sh', value: `${formatNumber(summary.hphiShPay, { digits: 2 })} m` });
    }
    const note = !summary.hasNetPay && Number.isFinite(summary.noDataPay) && summary.noDataPay > 0 ? 'Sin dato de pay (falta Sw)' : undefined;
    return { items, ...(note ? { note } : {}) };
  }

  const g = summary.grossMetrics;
  if (Number.isFinite(g.phi)) items.push({ label: 'φe', value: `${formatNumber(g.phi, { digits: 3 })} v/v` });
  if (Number.isFinite(g.sw)) items.push({ label: 'Sw', value: `${formatNumber(g.sw, { digits: 3 })} v/v` });
  if (Number.isFinite(g.kGeo)) items.push({ label: 'k geom.', value: `${fmtK(g.kGeo)} mD` });
  if (Number.isFinite(g.kh)) items.push({ label: 'k·h', value: `${fmtK(g.kh)} mD·m` });
  if (Number.isFinite(g.hphiSh)) items.push({ label: 'h·φ·Sh', value: `${formatNumber(g.hphiSh, { digits: 2 })} m` });
  const unclassified = Number.isFinite(summary.noData) && summary.noData > 0;
  return items.length > 0
    ? { items, note: unclassified ? 'Tramo sin clasificar · promedios brutos' : 'Sin cutoffs · promedios del tramo' }
    : { items: [] };
}

/**
 * Ficha TSV del intervalo medido (dos columnas separadas por tabulador, lista para pegar en una planilla). Incluye
 * solo las magnitudes disponibles según las curvas activas vigentes, sin inventar ceros.
 */
export function measurementSheetText(x: Measurement, summary?: DepthIntervalSummary | null): string {
  const lines = [`Tope MD\t${m(x.top)}`, `Base MD\t${m(x.base)}`, `Espesor MD\t${m(x.thickness)}`];
  if (x.vertical !== undefined && Math.abs(x.vertical - x.thickness) > 0.005) {
    lines.push(`Espesor vertical (TVD)\t${m(x.vertical)}`);
  }
  if (!summary || summary.sampleCount === 0) return lines.join('\n');

  lines.push(`Muestras\t${formatNumber(summary.sampleCount, { digits: 0, grouping: false })}`);
  if (summary.hasNetRes) {
    if (Number.isFinite(summary.netRes)) lines.push(`Reservorio neto (NET_RES)\t${formatNumber(summary.netRes, { digits: 2 })} m`);
    if (Number.isFinite(summary.ntgRes)) lines.push(`N/G reservorio\t${formatNumber(summary.ntgRes, { digits: 2 })} v/v`);
    if (summary.hasNetPay && Number.isFinite(summary.netPay)) {
      lines.push(`Pay neto (NET_PAY)\t${formatNumber(summary.netPay, { digits: 2 })} m`);
    }
    if (summary.hasNetPay && Number.isFinite(summary.ntgPay)) {
      lines.push(`NTG pay\t${formatNumber(summary.ntgPay, { digits: 2 })} v/v`);
    }
    if (Number.isFinite(summary.phiRes)) lines.push(`φe media en reservorio\t${formatNumber(summary.phiRes, { digits: 3 })} v/v`);
    if (Number.isFinite(summary.swPay)) lines.push(`Sw media en pay (pond. φ·h)\t${formatNumber(summary.swPay, { digits: 3 })} v/v`);
    if (Number.isFinite(summary.kGeoPay)) lines.push(`k media geométrica en pay\t${fmtK(summary.kGeoPay)} mD`);
    if (summary.hasNetPay && Number.isFinite(summary.khPay)) lines.push(`k·h en pay\t${fmtK(summary.khPay)} mD·m`);
    if (summary.hasNetPay && Number.isFinite(summary.hphiShPay)) lines.push(`h·φ·Sh en pay\t${formatNumber(summary.hphiShPay, { digits: 2 })} m`);
  } else {
    const g = summary.grossMetrics;
    const scope = Number.isFinite(summary.noData) && summary.noData > 0 ? 'tramo sin clasificar' : 'tramo, sin cutoffs';
    if (Number.isFinite(g.phi)) lines.push(`φe media (${scope})\t${formatNumber(g.phi, { digits: 3 })} v/v`);
    if (Number.isFinite(g.sw)) lines.push(`Sw media (${scope}, pond. φ·h)\t${formatNumber(g.sw, { digits: 3 })} v/v`);
    if (Number.isFinite(g.kGeo)) lines.push(`k media geométrica (${scope})\t${fmtK(g.kGeo)} mD`);
    if (Number.isFinite(g.kh)) lines.push(`k·h (${scope})\t${fmtK(g.kh)} mD·m`);
    if (Number.isFinite(g.hphiSh)) lines.push(`h·φ·Sh (${scope})\t${formatNumber(g.hphiSh, { digits: 2 })} m`);
  }
  return lines.join('\n');
}

/** Texto inicial conciso para crear una nota de profundidad en el intervalo medido. */
export function measurementNoteText(x: Measurement, summary?: DepthIntervalSummary | null): string {
  const f = (v: number) => formatNumber(v, { digits: 2, grouping: false });
  const vertical = x.vertical !== undefined && Math.abs(x.vertical - x.thickness) > 0.005 ? ` (TVD ${f(x.vertical)} m)` : '';
  const head = `Espesor ${f(x.thickness)} m${vertical}`;
  const { items, note } = measureCardItems(summary);
  if (items.length === 0) return head.slice(0, NOTE_MAX_LENGTH);
  const body = items.map((it) => `${it.label} ${it.value}`).join(' · ');
  const full = note ? `${head}\n${body} (${note.toLowerCase()})` : `${head}\n${body}`;
  return full.slice(0, NOTE_MAX_LENGTH);
}

/** Acota [top, base] de una medición al rango válido del pozo para que `saveNote` siempre la acepte. */
export function clampMeasurementForNote(x: Measurement, depth: ArrayLike<number>): { top: number; base: number } | null {
  const n = depth.length;
  if (n === 0 || !Number.isFinite(x.top) || !Number.isFinite(x.base)) return null;
  const minD = depth[0]!;
  const maxD = depth[n - 1]!;
  const clamp = (v: number) => Math.min(maxD, Math.max(minD, v));
  const rawTop = clamp(Math.min(x.top, x.base));
  const rawBase = clamp(Math.max(x.top, x.base));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const rt = r2(rawTop);
  const rb = r2(rawBase);
  const top = rt >= minD && rt <= maxD ? rt : rawTop;
  const base = rb >= top && rb <= maxD ? rb : Math.max(top, rawBase);
  return { top, base };
}
