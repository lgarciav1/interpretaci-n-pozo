import { pointNumbers, type PointSet } from '../../core/pointSets';
import { conversionCoefficients, unitLabel } from '../../core/units';
import { PRESSURE_COLUMNS, PRESSURE_UNIT } from '../../io/pressures';
import { formatNumber } from '../../ui/format';
import type { OverlayColorLegend, ViewerData } from '../../viewer/overlay';
import { MDT_OVERLAY_ID, PRESSURE_KIND, type DisplayUnit } from './model';

const COLORS = ['#3167aa', '#5d5eac', '#8557a3', '#a65490', '#bd5a75', '#c66858', '#bd772f'] as const;
const MISSING_COLOR = '#78818b';
const MISSING_LABEL = 'Sin dato';

export type MdtPointColor = 'fluid' | 'drawdown';

export function pointColorOf(settings: Readonly<Record<string, unknown>> | undefined): MdtPointColor {
  return settings?.['pointColor'] === 'drawdown' ? 'drawdown' : 'fluid';
}

export function formatDrawdown(psi: number | undefined, unit: DisplayUnit): string {
  if (psi === undefined || !Number.isFinite(psi)) return MISSING_LABEL;
  const [factor] = conversionCoefficients(PRESSURE_UNIT, unit);
  return formatNumber(psi * factor, { significant: 4, grouping: false });
}

type DrawdownRange = readonly [min: number, max: number];
const ranges = new WeakMap<readonly PointSet[], DrawdownRange | null>();

/** Dominio en psi de todas las series de la pista, independiente del zoom, los topes y los descartes. */
function drawdownRange(sets: readonly PointSet[]): DrawdownRange | null {
  const cached = ranges.get(sets);
  if (cached !== undefined) return cached;
  let min = Infinity;
  let max = -Infinity;
  for (const set of sets) {
    if (set.kind !== PRESSURE_KIND) continue;
    const values = pointNumbers(set, PRESSURE_COLUMNS.drawdown);
    if (!values) continue;
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  const range: DrawdownRange | null = min <= max ? [min, max] : null;
  ranges.set(sets, range);
  return range;
}

/** Un mismo dominio, paleta y formato para puntos, encabezado interactivo y figuras. */
export function drawdownScale(data: ViewerData, unit: DisplayUnit): {
  colorOf: (value: number | undefined) => string;
  legend: OverlayColorLegend;
} | null {
  if (pointColorOf(data.overlaySettings?.[MDT_OVERLAY_ID]) !== 'drawdown') return null;
  const range = drawdownRange(data.well.pointSets);
  const single = range !== null && range[0] === range[1];
  const middle = Math.floor(COLORS.length / 2);
  const colorOf = (value: number | undefined): string => {
    if (!range || value === undefined || !Number.isFinite(value)) return MISSING_COLOR;
    if (single) return COLORS[middle]!;
    const fraction = (value - range[0]) / (range[1] - range[0]);
    const index = Math.max(0, Math.min(COLORS.length - 1, Math.floor(fraction * COLORS.length)));
    return COLORS[index]!;
  };
  return {
    colorOf,
    legend: {
      title: `Drawdown (${unitLabel(unit)})`,
      colors: range ? (single ? [COLORS[middle]!] : COLORS) : [],
      minLabel: range ? formatDrawdown(range[0], unit) : '',
      maxLabel: range && !single ? formatDrawdown(range[1], unit) : '',
      missing: { label: MISSING_LABEL, color: MISSING_COLOR },
    },
  };
}
