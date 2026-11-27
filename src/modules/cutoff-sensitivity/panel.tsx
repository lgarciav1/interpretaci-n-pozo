/**
 * Panel a medida de `cutoff-sensitivity` (0007, C20): para cada cutoff (Vsh, φ, Sw) una curva de espesor neto pay
 * (y volumen in situ si hay volumen) contra el umbral, con la línea del cutoff vigente que se arrastra: al soltar,
 * escribe el parámetro compartido (global o de la zona elegida). Tooltip con los valores bajo el cursor.
 * Sin ecuaciones (van en el módulo Ecuaciones).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { effectiveWell } from '../../app/preparation/data';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import type { TableCell, TableValue } from '../../core/module';
import { paramStorageKey, type NumberParamSpec } from '../../core/params';
import { convert, unitLabel, type UnitId } from '../../core/units';
import type { Zone } from '../../core/well';
import { SURFACE_PAIRS, stabilityBox2D, type StabilityClass, type SurfacePairId, type SweepVariable } from '../../petro/sensitivity';
import {
  BASE_TOKENS,
  Badge,
  EmptyState,
  SegmentedControl,
  Select,
  contrastRatio,
  curveStyle,
  fillColor,
  formatNumber,
  formatParamValue,
  mix,
  scalePx,
  stepValue,
  useResolvedTheme,
  useThemeTokens,
  useUiScaleFactor,
  withAlpha,
  type ThemeTokens,
} from '../../ui';
import { useCanvas } from '../../ui/canvas';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { clamp, snapToStep } from '../../ui/scale';
import { niceStep } from '../../viewer/ticks';
import { SWEEP_GRIDS } from './index';
import {
  DEFAULT_SURFACE_STEPS,
  VAR_OP,
  VAR_SYMBOL,
  VAR_TICKS,
  availableSurfaceMetrics,
  buildCutoffSurfaceView,
  sampleViewSurface2D,
  setCutoffPairRecipe,
  type CutoffSurfaceView,
  type SurfaceViewMetric,
} from './surfaceModel';
import './panel.css';

type Row = Readonly<Record<string, TableCell>>;
type VolumeKey = 'ooip' | 'ogip';

const TOTAL = '@total';

interface VariableDef {
  variable: SweepVariable;
  param: 'vshCutoff' | 'phiCutoff' | 'swCutoff';
  role: 'VSH' | 'PHIE' | 'SW';
  /** Símbolo del umbral en el tooltip. */
  symbol: string;
  /** Lado que pasa el corte: Vsh y Sw ≤ (izquierda), φ ≥ (derecha). */
  op: '≤' | '≥';
  /** Rótulos del eje x. */
  ticks: readonly number[];
}

const VARIABLES: readonly VariableDef[] = [
  { variable: 'vsh', param: 'vshCutoff', role: 'VSH', symbol: 'Vsh', op: '≤', ticks: [0, 0.25, 0.5, 0.75, 1] },
  { variable: 'phi', param: 'phiCutoff', role: 'PHIE', symbol: 'φ', op: '≥', ticks: [0, 0.1, 0.2, 0.3, 0.4] },
  { variable: 'sw', param: 'swCutoff', role: 'SW', symbol: 'Sw', op: '≤', ticks: [0, 0.25, 0.5, 0.75, 1] },
];

const VOLUME: Record<VolumeKey, { label: string; short: string; unit: UnitId; field: UnitId }> = {
  ooip: { label: 'Petróleo in situ', short: 'Petróleo', unit: 'Mm3', field: 'MMbbl' },
  ogip: { label: 'Gas in situ', short: 'Gas', unit: 'MMm3', field: 'Bcf' },
};

const n = (c: TableCell | undefined): number => (typeof c === 'number' ? c : NaN);
const fmtM = (v: number) => formatNumber(v, { digits: 1 });
const fmtVol = (v: number) => formatNumber(v, { significant: 3 });

/** Valor de una serie en `t` por interpolación lineal entre los umbrales de la grilla. */
function interpolate(grid: readonly Row[], key: string, t: number): number {
  if (grid.length === 0) return NaN;
  const th = (i: number) => n(grid[i]!.threshold);
  if (t <= th(0)) return n(grid[0]![key]);
  const last = grid.length - 1;
  if (t >= th(last)) return n(grid[last]![key]);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (th(mid) <= t) lo = mid;
    else hi = mid;
  }
  const [a, b] = [n(grid[lo]![key]), n(grid[hi]![key])];
  const u = (t - th(lo)) / (th(hi) - th(lo));
  return a + (b - a) * u;
}

interface Readout {
  t: number;
  netPay: number;
  netRes: number;
  volume: number;
  exact: boolean;
}

/** Valores en el umbral `t`: los exactos de la fila vigente si coincide, si no interpolados. */
function readAt(grid: readonly Row[], current: Row | undefined, t: number, volume: VolumeKey | null): Readout {
  if (current && n(current.threshold) === t) {
    return { t, netPay: n(current.netPay), netRes: n(current.netRes), volume: volume ? n(current[volume]) : NaN, exact: true };
  }
  return {
    t,
    netPay: interpolate(grid, 'netPay', t),
    netRes: interpolate(grid, 'netRes', t),
    volume: volume ? interpolate(grid, volume, t) : NaN,
    exact: false,
  };
}

// --- gráfico de una variable ------------------------------------------------------------------------------------

interface ChartProps {
  def: VariableDef;
  spec: NumberParamSpec;
  grid: readonly Row[];
  current: Row | undefined;
  cutoff: number;
  volume: VolumeKey | null;
  /** Unidad de lectura del volumen (Mm³ o MMm³ según la magnitud). */
  volumeUnit: UnitId;
  overrides: readonly string[];
  scopeLabel: string;
  onCommit(value: number): void;
}

/** Márgenes del gráfico en px de Compacto (escalan con el tamaño de interfaz). */
const PAD_BASE = { l: 34, t: 22, b: 20 };
const HANDLE_HIT_BASE = 8;

function SweepChart({ def, spec, grid, current, cutoff, volume, volumeUnit, overrides, scopeLabel, onCommit }: ChartProps) {
  const themeName = useResolvedTheme();
  const ui = useUiScaleFactor();
  const PAD = { l: scalePx(PAD_BASE.l, ui), t: scalePx(PAD_BASE.t, ui), b: scalePx(PAD_BASE.b, ui) };
  const HANDLE_HIT = scalePx(HANDLE_HIT_BASE, ui);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDragState] = useState<number | null>(null);
  // El valor en arrastre también en un ref: `pointerup` y `lostpointercapture` llegan juntos y no deben confirmar dos veces.
  const dragRef = useRef<number | null>(null);
  const setDrag = (v: number | null) => {
    dragRef.current = v;
    setDragState(v);
  };
  const [hover, setHover] = useState<{ t: number; px: number } | null>(null);
  const [nearLine, setNearLine] = useState(false);
  const { min, max } = SWEEP_GRIDS[def.variable];
  const shown = drag ?? cutoff;
  const vol = volume ? { ...VOLUME[volume], unit: volumeUnit } : null;
  const toVol = (m3: number) => (vol ? convert(m3, 'm3', vol.unit) : NaN);
  const varColor = curveStyle(def.role, themeName).color;
  const at = readAt(grid, drag === null ? current : undefined, shown, volume);

  const padR = scalePx(vol ? 42 : 10, ui);
  const layout = (width: number, height: number) => {
    const w = Math.max(1, width - PAD.l - padR);
    const h = Math.max(1, height - PAD.t - PAD.b);
    return { w, h, x: (t: number) => PAD.l + ((t - min) / (max - min)) * w, t: (px: number) => min + ((px - PAD.l) / w) * (max - min) };
  };

  const maxPay = useMemo(() => grid.reduce((m, r) => Math.max(m, n(r.netPay) || 0), 0), [grid]);
  const maxVol = useMemo(() => (volume ? grid.reduce((m, r) => Math.max(m, n(r[volume]) || 0), 0) : 0), [grid, volume]);

  const ref = useCanvas(
    (ctx, { width, height }, theme: ThemeTokens) => {
      const { w, h, x } = layout(width, height);
      const v = theme.viewer;
      const pay = fillColor('netPay', theme.name).color;
      const hc = fillColor('hydrocarbon', theme.name).color;
      const color = curveStyle(def.role, theme.name).color;
      const font = `${scalePx(BASE_TOKENS.text.xs, ui)}px ${BASE_TOKENS.font.sans}`;
      const y0 = PAD.t + h;

      // Escalas verticales «lindas» (1-2-5).
      const axis = (top: number) => {
        if (!(top > 0)) return { max: 1, step: 1 };
        const step = niceStep(h / top, 26);
        return { max: Math.max(step, Math.ceil(top / step - 1e-9) * step), step };
      };
      const ay = axis(maxPay);
      const yPay = (m: number) => y0 - (m / ay.max) * h;
      const av = axis(toVol(maxVol));
      const yVol = (m3: number) => y0 - (toVol(m3) / av.max) * h;

      // Lado que pasa el corte (sombreado suave en el color de la curva).
      const xc = x(clamp(shown, min, max));
      ctx.fillStyle = withAlpha(color, theme.name === 'dark' ? 0.1 : 0.07);
      if (def.op === '≤') ctx.fillRect(PAD.l, PAD.t, xc - PAD.l, h);
      else ctx.fillRect(xc, PAD.t, PAD.l + w - xc, h);

      // Grilla y ejes.
      ctx.font = font;
      ctx.lineWidth = 1;
      ctx.textBaseline = 'middle';
      for (let m = 0; m <= ay.max + 1e-9; m += ay.step) {
        const y = Math.round(yPay(m)) + 0.5;
        ctx.strokeStyle = m === 0 ? v.gridMajor : v.gridMinor;
        ctx.beginPath();
        ctx.moveTo(PAD.l, y);
        ctx.lineTo(PAD.l + w, y);
        ctx.stroke();
        ctx.fillStyle = v.axisText;
        ctx.textAlign = 'right';
        ctx.fillText(formatNumber(m, { significant: 3 }), PAD.l - scalePx(6, ui), y);
      }
      if (vol) {
        ctx.textAlign = 'left';
        for (let m = 0; m <= av.max + 1e-9; m += av.step) {
          ctx.fillStyle = v.axisText;
          ctx.fillText(formatNumber(+m.toPrecision(12), { significant: 3 }), PAD.l + w + scalePx(6, ui), y0 - (m / av.max) * h);
        }
      }
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      for (const t of def.ticks) {
        const xx = Math.round(x(t)) + 0.5;
        ctx.strokeStyle = v.gridMinor;
        ctx.beginPath();
        ctx.moveTo(xx, PAD.t);
        ctx.lineTo(xx, y0);
        ctx.stroke();
        ctx.fillStyle = v.axisText;
        ctx.textAlign = t === min ? 'left' : t === max ? 'right' : 'center';
        ctx.fillText(formatNumber(t, { digits: t === 0 || t === 1 ? 0 : def.variable === 'phi' ? 1 : 2 }), t === min ? xx - 0.5 : t === max ? xx + 0.5 : xx, y0 + scalePx(5, ui));
      }

      // Neto pay: área + línea.
      const pts = grid.map((r) => [x(n(r.threshold)), yPay(n(r.netPay))] as const).filter(([, y]) => Number.isFinite(y));
      if (pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(pts[0]![0], y0);
        for (const [px, py] of pts) ctx.lineTo(px, py);
        ctx.lineTo(pts[pts.length - 1]![0], y0);
        ctx.closePath();
        ctx.fillStyle = withAlpha(pay, theme.name === 'dark' ? 0.22 : 0.16);
        ctx.fill();
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.strokeStyle = pay;
        ctx.lineWidth = 1.75;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // Volumen in situ (eje derecho), a trazos.
      if (volume) {
        const vp = grid.map((r) => [x(n(r.threshold)), yVol(n(r[volume]))] as const).filter(([, y]) => Number.isFinite(y));
        if (vp.length > 1) {
          ctx.beginPath();
          vp.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
          ctx.strokeStyle = hc;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Guía del cursor (si no se arrastra).
      if (hover && drag === null) {
        const hx = Math.round(x(hover.t)) + 0.5;
        ctx.strokeStyle = v.cursor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, PAD.t);
        ctx.lineTo(hx, y0);
        ctx.stroke();
        ctx.setLineDash([]);
        const hr = readAt(grid, undefined, hover.t, volume);
        dot(ctx, hx, yPay(hr.netPay), pay, v.trackBg, 3);
        if (volume) dot(ctx, hx, yVol(hr.volume), hc, v.trackBg, 3);
      }

      // Línea del cutoff vigente con su manija.
      ctx.strokeStyle = color;
      ctx.lineWidth = drag === null ? 1.5 : 2;
      ctx.beginPath();
      ctx.moveTo(Math.round(xc) + 0.5, PAD.t - 2);
      ctx.lineTo(Math.round(xc) + 0.5, y0);
      ctx.stroke();
      dot(ctx, xc, yPay(at.netPay), pay, v.trackBg, 4);
      if (volume) dot(ctx, xc, yVol(at.volume), hc, v.trackBg, 4);

      const label = formatParamValue(shown, spec);
      ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, ui)}px ${BASE_TOKENS.font.sans}`;
      const tw = ctx.measureText(label).width + scalePx(12, ui);
      const th = scalePx(17, ui);
      const hx = clamp(xc - tw / 2, 1, width - tw - 1);
      const onColor = contrastRatio(theme.color.textOnAccent, color) >= contrastRatio(theme.color.textInverse, color) ? theme.color.textOnAccent : theme.color.textInverse;
      ctx.fillStyle = color;
      roundRect(ctx, hx, 2, tw, th, BASE_TOKENS.radius.xs);
      ctx.fill();
      ctx.fillStyle = onColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, hx + tw / 2, 2 + th / 2 + 0.5);
    },
    [grid, current, shown, drag, hover, volume, volumeUnit, maxPay, maxVol, spec, def, ui],
  );

  const pointerT = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const L = layout(rect.width, rect.height);
    return { px, py: e.clientY - rect.top, t: clamp(L.t(px), min, max), xc: L.x(clamp(cutoff, min, max)) };
  };
  const snap = (t: number) => clamp(snapToStep(t, spec.step ?? 0.01, spec.min), spec.min, spec.max);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = pointerT(e);
    const onHandle = p.py <= PAD.t && Math.abs(p.px - p.xc) <= scalePx(28, ui);
    if (Math.abs(p.px - p.xc) > HANDLE_HIT && !onHandle) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(snap(p.t));
    setHover(null);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = pointerT(e);
    if (dragRef.current !== null) {
      setDrag(snap(p.t));
      return;
    }
    setNearLine(Math.abs(p.px - p.xc) <= HANDLE_HIT || (p.py <= PAD.t && Math.abs(p.px - p.xc) <= scalePx(28, ui)));
    const rect = e.currentTarget.getBoundingClientRect();
    const L = layout(rect.width, rect.height);
    const inside = p.px >= PAD.l && p.px <= PAD.l + L.w && p.py >= PAD.t && p.py <= PAD.t + L.h;
    setHover(inside ? { t: p.t, px: p.px } : null);
  };
  const endDrag = (commit: boolean) => {
    const v = dragRef.current;
    if (v === null) return;
    setDrag(null);
    if (commit && v !== cutoff) onCommit(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const s = { min: spec.min, max: spec.max, step: spec.step ?? 0.01 };
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = stepValue(cutoff, 1, s, e.shiftKey);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = stepValue(cutoff, -1, s, e.shiftKey);
    else if (e.key === 'PageUp') next = stepValue(cutoff, 1, s, true);
    else if (e.key === 'PageDown') next = stepValue(cutoff, -1, s, true);
    else if (e.key === 'Home') next = spec.min;
    else if (e.key === 'End') next = spec.max;
    else if (e.key === 'Escape' && drag !== null) {
      setDrag(null);
      e.preventDefault();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    if (next !== cutoff) onCommit(next);
  };

  const tip = hover && drag === null ? readAt(grid, undefined, hover.t, volume) : null;
  const wrapW = wrapRef.current?.clientWidth ?? 0;
  const approx = at.exact ? '' : '≈ ';

  return (
    <div className="cs-chart">
      <div className="cs-chart__head">
        <span className="cs-chart__swatch" style={{ background: varColor }} aria-hidden />
        <span className="cs-chart__title">{spec.label}</span>
        <span className="cs-chart__cut num">
          {def.symbol} {def.op} {formatParamValue(shown, spec)}
        </span>
        <span className="cs-spacer" />
        <span className="cs-chart__read num" aria-live="polite">
          <span className="cs-chart__read-pay">
            {approx}
            {fmtM(at.netPay)} m
          </span>
          {vol && (
            <span className="cs-chart__read-vol">
              {approx}
              {fmtVol(toVol(at.volume))} {unitLabel(vol.unit)}
            </span>
          )}
        </span>
      </div>
      <div
        ref={wrapRef}
        className={`cs-chart__plot${drag !== null ? ' is-dragging' : nearLine ? ' is-near' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label={`${spec.label} (${scopeLabel})`}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={shown}
        aria-valuetext={`${def.symbol} ${def.op} ${formatParamValue(shown, spec)}: neto pay ${fmtM(at.netPay)} m`}
        onKeyDown={onKeyDown}
      >
        <canvas
          ref={ref}
          className="cs-chart__canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => endDrag(true)}
          onPointerCancel={() => endDrag(false)}
          onLostPointerCapture={() => endDrag(true)}
          onPointerLeave={() => drag === null && setHover(null)}
        />
        {tip && hover && (
          <div className="cs-tip num" style={{ left: hover.px > wrapW / 2 ? undefined : hover.px + 12, right: hover.px > wrapW / 2 ? wrapW - hover.px + 12 : undefined }}>
            <div className="cs-tip__head">
              {def.symbol} {def.op} {formatNumber(tip.t, { digits: def.variable === 'phi' ? 3 : 2 })}
            </div>
            <div className="cs-tip__row">
              <span>Neto pay</span>
              <span>{fmtM(tip.netPay)} m</span>
            </div>
            <div className="cs-tip__row">
              <span>Neto reservorio</span>
              <span>{fmtM(tip.netRes)} m</span>
            </div>
            {vol && (
              <div className="cs-tip__row">
                <span>{vol.short}</span>
                <span>
                  {fmtVol(toVol(tip.volume))} {unitLabel(vol.unit)} · {fmtVol(convert(tip.volume, 'm3', vol.field))} {unitLabel(vol.field)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      {overrides.length > 0 && (
        <p className="cs-chart__note">
          {overrides.length === 1 ? 'La zona' : 'Las zonas'} {overrides.join(', ')} {overrides.length === 1 ? 'tiene' : 'tienen'} valor propio: el total la{overrides.length === 1 ? '' : 's'} barre con el mismo umbral.
        </p>
      )}
    </div>
  );
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, stroke: string, fill: string, r: number) {
  if (!Number.isFinite(y)) return;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- superficie 2D ------------------------------------------------------------------------------------------------

const STABILITY_META: Record<StabilityClass, { label: string; tone: 'ok' | 'warn' | 'error' | 'neutral'; detail: string }> = {
  stable: {
    label: 'Meseta estable',
    tone: 'ok',
    detail: 'Pequeños ajustes simultáneos en ambos cortes cambian ≤ 10 % el resultado.',
  },
  sensitive: {
    label: 'Zona sensible',
    tone: 'warn',
    detail: 'Cambios locales moderados de ambos cortes alteran entre 10 % y 25 % el resultado.',
  },
  critical: {
    label: 'Barranco crítico',
    tone: 'error',
    detail: 'Alta pendiente cerca del punto vigente (> 25 % de variación): conviene revisar el margen.',
  },
  empty: {
    label: 'Sin espesor neto',
    tone: 'neutral',
    detail: 'Todo el entorno operativo evaluado queda en cero para la métrica elegida.',
  },
  'no-data': {
    label: 'Sin datos en el entorno',
    tone: 'neutral',
    detail: 'Faltan curvas clasificadas o Sw en las muestras dentro del entorno operativo.',
  },
};

function surfaceRampColor(theme: ThemeTokens, t: number): string {
  const c = clamp(t, 0, 1);
  const base = theme.viewer.trackBg;
  if (theme.name === 'light') {
    const s0 = mix(base, theme.color.info, 0.06);
    const s1 = mix(base, theme.color.info, 0.28);
    const s2 = mix(base, theme.color.ok, 0.42);
    const s3 = mix(base, theme.color.warn, 0.50);
    if (c < 0.35) return mix(s0, s1, c / 0.35);
    if (c < 0.7) return mix(s1, s2, (c - 0.35) / 0.35);
    return mix(s2, s3, (c - 0.7) / 0.3);
  }
  const s0 = mix(base, theme.color.surfaceHover, 0.45);
  const s1 = mix(base, theme.color.info, 0.34);
  const s2 = mix(base, theme.color.ok, 0.48);
  const s3 = mix(base, theme.color.warn, 0.58);
  if (c < 0.35) return mix(s0, s1, c / 0.35);
  if (c < 0.7) return mix(s1, s2, (c - 0.35) / 0.35);
  return mix(s2, s3, (c - 0.7) / 0.3);
}

function toneTokenColor(theme: ThemeTokens, status: StabilityClass): string {
  if (status === 'stable') return theme.color.ok;
  if (status === 'sensitive') return theme.color.warn;
  if (status === 'critical') return theme.color.error;
  return theme.color.textMuted;
}

interface Surface2DChartProps {
  view: CutoffSurfaceView;
  specX: NumberParamSpec;
  specY: NumberParamSpec;
  scopeLabel: string;
  onCommitPair: (nextX: number, nextY: number) => void;
}

function Surface2DChart({ view, specX, specY, scopeLabel, onCommitPair }: Surface2DChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ui = useUiScaleFactor();
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const setDragSync = (next: { x: number; y: number } | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  const [hover, setHover] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [nearHandle, setNearHandle] = useState(false);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onEscape = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === 'Escape') {
        dragRef.current = null;
        setDrag(null);
        ev.preventDefault();
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [dragging]);

  const PAD = useMemo(
    () => ({
      l: scalePx(46, ui),
      r: scalePx(48, ui),
      t: scalePx(22, ui),
      b: scalePx(38, ui),
    }),
    [ui],
  );
  const HANDLE_HIT = scalePx(16, ui);

  const { xThresholds: tx, yThresholds: ty, nx, ny, values, minValue, maxValue } = view;
  const xMin = tx[0] ?? 0;
  const xMax = tx[nx - 1] ?? 1;
  const yMin = ty[0] ?? 0;
  const yMax = ty[ny - 1] ?? 1;

  const shownX = drag ? drag.x : clamp(view.xCurrent, xMin, xMax);
  const shownY = drag ? drag.y : clamp(view.yCurrent, yMin, yMax);

  const layout = (width: number, height: number) => {
    const w = Math.max(10, width - PAD.l - PAD.r);
    const h = Math.max(10, height - PAD.t - PAD.b);
    const xPx = (xv: number) => PAD.l + ((xv - xMin) / Math.max(1e-9, xMax - xMin)) * w;
    const yPx = (yv: number) => PAD.t + (1 - (yv - yMin) / Math.max(1e-9, yMax - yMin)) * h;
    const xVal = (px: number) => xMin + ((px - PAD.l) / w) * (xMax - xMin);
    const yVal = (py: number) => yMin + (1 - (py - PAD.t) / h) * (yMax - yMin);
    return { w, h, xPx, yPx, xVal, yVal };
  };

  const canvasRef = useCanvas(
    (ctx, { width, height }, theme: ThemeTokens) => {
      const v = theme.viewer;
      const L = layout(width, height);
      ctx.clearRect(0, 0, width, height);

      // 1. Mapa de calor 2×2 subcelda (alineado al vértice de los contornos) y celdas NaN.
      const lut = Array.from({ length: 65 }, (_, k) => surfaceRampColor(theme, k / 64));
      const span = maxValue - minValue;
      const hasRange = Number.isFinite(minValue) && Number.isFinite(maxValue);
      const nanRects: { x: number; y: number; w: number; h: number }[] = [];

      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, PAD.t, L.w, L.h);
      ctx.clip();

      for (let jy = 0; jy < ny - 1; jy++) {
        const py0 = L.yPx(ty[jy + 1]!);
        const py1 = L.yPx(ty[jy]!);
        const ch = py1 - py0;
        for (let ix = 0; ix < nx - 1; ix++) {
          const px0 = L.xPx(tx[ix]!);
          const px1 = L.xPx(tx[ix + 1]!);
          const cw = px1 - px0;
          const v00 = values[jy * nx + ix]!;
          const v10 = values[jy * nx + ix + 1]!;
          const v11 = values[(jy + 1) * nx + ix + 1]!;
          const v01 = values[(jy + 1) * nx + ix]!;
          if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v11) || !Number.isFinite(v01)) {
            nanRects.push({ x: px0, y: py0, w: cw, h: ch });
            continue;
          }
          const subW = cw * 0.5 + 0.6;
          const subH = ch * 0.5 + 0.6;
          for (let sy = 0; sy < 2; sy++) {
            const fy = sy === 0 ? 0.75 : 0.25;
            const ry = sy === 0 ? py0 : py0 + ch * 0.5;
            for (let sx = 0; sx < 2; sx++) {
              const fx = sx === 0 ? 0.25 : 0.75;
              const rx = sx === 0 ? px0 : px0 + cw * 0.5;
              const val = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
              const tNorm = !hasRange ? 0 : span > 1e-12 ? (val - minValue) / span : maxValue > 0 ? 0.65 : 0.05;
              const idx = Math.round(clamp(tNorm, 0, 1) * 64);
              ctx.fillStyle = lut[idx]!;
              ctx.fillRect(rx, ry, subW, subH);
            }
          }
        }
      }

      if (nanRects.length > 0) {
        ctx.fillStyle = theme.color.surfaceSubtle;
        for (const r of nanRects) ctx.fillRect(r.x, r.y, r.w + 0.5, r.h + 0.5);
        ctx.save();
        ctx.beginPath();
        for (const r of nanRects) ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.strokeStyle = withAlpha(v.nullPattern, 0.72);
        ctx.lineWidth = 1;
        const step = scalePx(6, ui);
        ctx.beginPath();
        for (let d = -L.h; d < L.w + L.h; d += step) {
          ctx.moveTo(PAD.l + d, PAD.t);
          ctx.lineTo(PAD.l + d - L.h, PAD.t + L.h);
        }
        ctx.stroke();
        ctx.restore();
      }

      // 2. Grilla tenue sobre el mapa de calor.
      ctx.strokeStyle = withAlpha(v.gridMinor, 0.45);
      ctx.lineWidth = 1;
      for (const xt of VAR_TICKS[view.pair.xVar]) {
        const px = Math.round(L.xPx(xt)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, PAD.t);
        ctx.lineTo(px, PAD.t + L.h);
        ctx.stroke();
      }
      for (const yt of VAR_TICKS[view.pair.yVar]) {
        const py = Math.round(L.yPx(yt)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(PAD.l, py);
        ctx.lineTo(PAD.l + L.w, py);
        ctx.stroke();
      }

      // 3. Curvas de nivel (Marching Squares) y etiquetas sin solape.
      const contourHalo = withAlpha(v.trackBg, 0.72);
      const contourInk = withAlpha(theme.color.text, 0.78);
      const cStep = view.contours.length >= 2 ? Math.abs(view.contours[1]!.level - view.contours[0]!.level) : 0;
      const singleSmall = view.contours.length === 1 ? Math.abs(view.contours[0]!.level) : 0;
      const refMag = cStep > 0 ? cStep : singleSmall;
      const labelDigits = refMag > 0 && refMag < 1 ? Math.min(4, Math.max(1, Math.ceil(-Math.log10(refMag) - 1e-9))) : 0;
      const xc = L.xPx(shownX);
      const yc = L.yPx(shownY);
      const placedLabels: { x0: number; y0: number; x1: number; y1: number }[] = [
        { x0: xc - scalePx(14, ui), y0: yc - scalePx(14, ui), x1: xc + scalePx(14, ui), y1: yc + scalePx(14, ui) },
      ];

      ctx.font = `${BASE_TOKENS.weight.medium} ${scalePx(10, ui)}px ${BASE_TOKENS.font.sans}`;
      for (const level of view.contours) {
        if (level.lines.length === 0) continue;
        let longest = level.lines[0]!;
        for (const poly of level.lines) {
          if (poly.points.length > longest.points.length) longest = poly;
          ctx.beginPath();
          poly.points.forEach((pt, idx) => {
            const px = L.xPx(pt.x);
            const py = L.yPx(pt.y);
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          if (poly.closed) ctx.closePath();
          ctx.strokeStyle = contourHalo;
          ctx.lineWidth = 2.4;
          ctx.stroke();
          ctx.strokeStyle = contourInk;
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }

        const midPt = longest.points[Math.floor(longest.points.length * 0.5)];
        if (midPt) {
          const lx = L.xPx(midPt.x);
          const ly = L.yPx(midPt.y);
          const text = formatNumber(level.level, { digits: labelDigits });
          const lw = ctx.measureText(text).width + scalePx(6, ui);
          const lh = scalePx(13, ui);
          const box = { x0: lx - lw / 2, y0: ly - lh / 2, x1: lx + lw / 2, y1: ly + lh / 2 };
          const inside = box.x0 >= PAD.l + 4 && box.x1 <= PAD.l + L.w - 4 && box.y0 >= PAD.t + 4 && box.y1 <= PAD.t + L.h - 4;
          const hits = placedLabels.some((r) => !(box.x1 < r.x0 || box.x0 > r.x1 || box.y1 < r.y0 || box.y0 > r.y1));
          if (inside && !hits) {
            placedLabels.push(box);
            ctx.fillStyle = withAlpha(v.trackBg, 0.86);
            roundRect(ctx, box.x0, box.y0, lw, lh, 3);
            ctx.fill();
            ctx.fillStyle = theme.color.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, lx, ly + 0.5);
          }
        }
      }

      // 4. Caja operativa de estabilidad alrededor del punto vigente (o vista previa durante el arrastre).
      const activeBox = drag
        ? stabilityBox2D(view.pair, shownX, shownY, { min: xMin, max: xMax }, { min: yMin, max: yMax })
        : view.stability.box;
      const boxTone = drag ? theme.color.accent : toneTokenColor(theme, view.stability.status);
      const bx0 = L.xPx(activeBox.xLow);
      const bx1 = L.xPx(activeBox.xHigh);
      const by0 = L.yPx(activeBox.yHigh);
      const by1 = L.yPx(activeBox.yLow);
      ctx.fillStyle = withAlpha(boxTone, 0.14);
      ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      ctx.strokeStyle = boxTone;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.round(bx0) + 0.5, Math.round(by0) + 0.5, Math.max(2, bx1 - bx0), Math.max(2, by1 - by0));
      ctx.setLineDash([]);

      // 5. Mira 2D y cursor de hover.
      const cursorColor = theme.color.accent;
      ctx.strokeStyle = withAlpha(cursorColor, 0.85);
      ctx.lineWidth = drag ? 1.75 : 1.25;
      ctx.beginPath();
      ctx.moveTo(Math.round(xc) + 0.5, PAD.t);
      ctx.lineTo(Math.round(xc) + 0.5, PAD.t + L.h);
      ctx.moveTo(PAD.l, Math.round(yc) + 0.5);
      ctx.lineTo(PAD.l + L.w, Math.round(yc) + 0.5);
      ctx.stroke();
      dot(ctx, xc, yc, cursorColor, v.trackBg, drag ? 6 : 5);

      if (hover && !drag) {
        const hx = Math.round(L.xPx(hover.x)) + 0.5;
        const hy = Math.round(L.yPx(hover.y)) + 0.5;
        ctx.strokeStyle = withAlpha(v.cursor, 0.65);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, PAD.t);
        ctx.lineTo(hx, PAD.t + L.h);
        ctx.moveTo(PAD.l, hy);
        ctx.lineTo(PAD.l + L.w, hy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();

      // Borde exterior del recuadro y ejes/etiquetas.
      ctx.strokeStyle = v.trackBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD.l - 0.5, PAD.t - 0.5, L.w + 1, L.h + 1);

      ctx.font = `${scalePx(BASE_TOKENS.text.xs, ui)}px ${BASE_TOKENS.font.sans}`;
      ctx.fillStyle = v.axisText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const xt of VAR_TICKS[view.pair.xVar]) {
        ctx.fillText(formatNumber(xt, { digits: 2 }), L.xPx(xt), PAD.t + L.h + scalePx(4, ui));
      }
      ctx.font = `${BASE_TOKENS.weight.medium} ${scalePx(BASE_TOKENS.text.xs, ui)}px ${BASE_TOKENS.font.sans}`;
      ctx.fillText(
        `${VAR_SYMBOL[view.pair.xVar]} (${specX.unit ? unitLabel(specX.unit) : 'v/v'})`,
        PAD.l + L.w * 0.5,
        PAD.t + L.h + scalePx(20, ui),
      );

      ctx.font = `${scalePx(BASE_TOKENS.text.xs, ui)}px ${BASE_TOKENS.font.sans}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const yt of VAR_TICKS[view.pair.yVar]) {
        ctx.fillText(formatNumber(yt, { digits: 2 }), PAD.l - scalePx(6, ui), L.yPx(yt));
      }

      ctx.save();
      ctx.translate(scalePx(12, ui), PAD.t + L.h * 0.5);
      ctx.rotate(-Math.PI / 2);
      ctx.font = `${BASE_TOKENS.weight.medium} ${scalePx(BASE_TOKENS.text.xs, ui)}px ${BASE_TOKENS.font.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${VAR_SYMBOL[view.pair.yVar]} (${specY.unit ? unitLabel(specY.unit) : 'v/v'})`, 0, 0);
      ctx.restore();

      // Píldoras en los márgenes superior (X) y derecho (Y) para no tapar ticks ni celdas.
      const onPill =
        contrastRatio(theme.color.textOnAccent, cursorColor) >= contrastRatio(theme.color.textInverse, cursorColor)
          ? theme.color.textOnAccent
          : theme.color.textInverse;
      ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, ui)}px ${BASE_TOKENS.font.sans}`;

      const xLabel = `${VAR_SYMBOL[view.pair.xVar]} ${formatParamValue(shownX, specX)}`;
      const xW = ctx.measureText(xLabel).width + scalePx(10, ui);
      const pillH = scalePx(17, ui);
      const xPillLeft = clamp(xc - xW * 0.5, PAD.l, width - PAD.r - xW);
      ctx.fillStyle = cursorColor;
      roundRect(ctx, xPillLeft, 2, xW, pillH, BASE_TOKENS.radius.xs);
      ctx.fill();
      ctx.fillStyle = onPill;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(xLabel, xPillLeft + xW * 0.5, 2 + pillH * 0.5 + 0.5);

      const yLabel = `${formatParamValue(shownY, specY)}`;
      const yW = Math.min(PAD.r - scalePx(4, ui), ctx.measureText(yLabel).width + scalePx(10, ui));
      const yPillTop = clamp(yc - pillH * 0.5, PAD.t, PAD.t + L.h - pillH);
      const yPillLeft = PAD.l + L.w + scalePx(4, ui);
      ctx.fillStyle = cursorColor;
      roundRect(ctx, yPillLeft, yPillTop, yW, pillH, BASE_TOKENS.radius.xs);
      ctx.fill();
      ctx.fillStyle = onPill;
      ctx.fillText(yLabel, yPillLeft + yW * 0.5, yPillTop + pillH * 0.5 + 0.5);
    },
    [view, shownX, shownY, drag, hover, specX, specY, ui, PAD],
  );

  const snapX = (v: number) => clamp(snapToStep(v, specX.step ?? 0.01, specX.min), specX.min, specX.max);
  const snapY = (v: number) => clamp(snapToStep(v, specY.step ?? 0.01, specY.min), specY.min, specY.max);

  const pointerCoords = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const L = layout(rect.width, rect.height);
    const inside = px >= PAD.l && px <= PAD.l + L.w && py >= PAD.t && py <= PAD.t + L.h;
    const x = snapX(L.xVal(px));
    const y = snapY(L.yVal(py));
    const dist = Math.hypot(px - L.xPx(shownX), py - L.yPx(shownY));
    return { px, py, x, y, inside, dist };
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = pointerCoords(e);
    if (!p.inside && p.dist > HANDLE_HIT) return;
    wrapRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragSync({ x: p.x, y: p.y });
    setHover(null);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = pointerCoords(e);
    if (dragRef.current) {
      setDragSync({ x: p.x, y: p.y });
      return;
    }
    setNearHandle(p.dist <= HANDLE_HIT);
    setHover(p.inside ? { x: p.x, y: p.y, px: p.px, py: p.py } : null);
  };

  const endDrag = (commit: boolean) => {
    const cur = dragRef.current;
    if (!cur) return;
    setDragSync(null);
    if (commit && (cur.x !== view.xCurrent || cur.y !== view.yCurrent)) {
      onCommitPair(cur.x, cur.y);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && dragRef.current) {
      setDragSync(null);
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const sx = { min: specX.min, max: specX.max, step: specX.step ?? 0.01 };
    const sy = { min: specY.min, max: specY.max, step: specY.step ?? 0.01 };
    let nxVal = view.xCurrent;
    let nyVal = view.yCurrent;
    if (e.key === 'ArrowRight') nxVal = stepValue(nxVal, 1, sx, e.shiftKey);
    else if (e.key === 'ArrowLeft') nxVal = stepValue(nxVal, -1, sx, e.shiftKey);
    else if (e.key === 'ArrowUp') nyVal = stepValue(nyVal, 1, sy, e.shiftKey);
    else if (e.key === 'ArrowDown') nyVal = stepValue(nyVal, -1, sy, e.shiftKey);
    else if (e.key === 'Home') nxVal = sx.min;
    else if (e.key === 'End') nxVal = sx.max;
    else return;
    e.preventDefault();
    if (nxVal !== view.xCurrent || nyVal !== view.yCurrent) onCommitPair(nxVal, nyVal);
  };

  const theme = useThemeTokens();
  const rampStops = [0, 0.35, 0.7, 1].map((t) => surfaceRampColor(theme, t)).join(', ');
  const hoverVal = hover && !drag ? sampleViewSurface2D(view, hover.x, hover.y) : NaN;
  const hasOverrides = view.xOverrides.length > 0 || view.yOverrides.length > 0;
  const centerRefVal = hasOverrides ? sampleViewSurface2D(view, view.xCurrent, view.yCurrent) : view.stability.centerValue;
  const hoverDelta = Number.isFinite(hoverVal) && Number.isFinite(centerRefVal) ? hoverVal - centerRefVal : NaN;
  const hoverPct = Number.isFinite(hoverDelta) && Math.abs(centerRefVal) > 1e-12 ? (hoverDelta / Math.abs(centerRefVal)) * 100 : null;

  const wrapW = wrapRef.current?.clientWidth ?? 0;
  const wrapH = wrapRef.current?.clientHeight ?? scalePx(256, ui);
  const tipW = scalePx(196, ui);
  const tipH = scalePx(72, ui);
  const tipOffset = scalePx(10, ui);
  const tipLeft = hover
    ? wrapW > 0
      ? clamp(hover.px > wrapW * 0.5 ? hover.px - tipW - tipOffset : hover.px + tipOffset, 4, Math.max(4, wrapW - tipW - 4))
      : hover.px + tipOffset
    : 0;
  const tipTop = hover ? clamp(hover.py - scalePx(18, ui), 4, Math.max(4, wrapH - tipH - 4)) : 0;
  const valDigits = view.metric === 'hphiShPay' ? 2 : 1;
  const valueText = `${VAR_SYMBOL[view.pair.xVar]} ${formatParamValue(shownX, specX)}, ${VAR_SYMBOL[view.pair.yVar]} ${formatParamValue(shownY, specY)}, ${view.metricLabel} ${
    Number.isFinite(view.stability.centerValue) ? `${formatNumber(view.stability.centerValue, { digits: valDigits })} ${unitLabel(view.unit)}` : 'sin dato'
  }`;

  return (
    <div className="cs-surface__card">
      <div
        ref={wrapRef}
        className={`cs-surface__plot${drag ? ' is-dragging' : nearHandle ? ' is-near' : ''}`}
        tabIndex={0}
        role="application"
        aria-label={`Superficie 2D ${view.pair.label} (${scopeLabel}). Usá las flechas para mover ambos cutoffs (Shift para paso rápido).`}
        aria-valuetext={valueText}
        onKeyDown={onKeyDown}
      >
        <canvas
          ref={canvasRef}
          className="cs-surface__canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => endDrag(true)}
          onPointerCancel={() => endDrag(false)}
          onLostPointerCapture={() => endDrag(false)}
          onPointerLeave={() => {
            if (!dragRef.current) setHover(null);
            setNearHandle(false);
          }}
        />
        {hover && !drag && (
          <div className="cs-tip num" style={{ left: tipLeft, top: tipTop }}>
            <div className="cs-tip__head">
              {VAR_SYMBOL[view.pair.xVar]} {VAR_OP[view.pair.xVar]} {formatParamValue(hover.x, specX)} ·{' '}
              {VAR_SYMBOL[view.pair.yVar]} {VAR_OP[view.pair.yVar]} {formatParamValue(hover.y, specY)}
            </div>
            <div className="cs-tip__row">
              <span>{view.metricLabel}</span>
              <span>
                {Number.isFinite(hoverVal)
                  ? `${formatNumber(hoverVal, { digits: valDigits })} ${unitLabel(view.unit)}`
                  : 'sin dato'}
              </span>
            </div>
            <div className="cs-tip__row">
              <span>{hasOverrides ? 'Δ vs global' : 'Δ vs vigente'}</span>
              <span>
                {Number.isFinite(hoverDelta)
                  ? `${hoverDelta >= 0 ? '+' : ''}${formatNumber(hoverDelta, { digits: valDigits })} ${unitLabel(view.unit)}${
                      hoverPct !== null ? ` (${hoverPct >= 0 ? '+' : ''}${formatNumber(hoverPct, { digits: 1 })} %)` : ''
                    }`
                  : '—'}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="cs-surface__bar">
        <span>{Number.isFinite(minValue) ? `${formatNumber(minValue, { digits: valDigits })} ${unitLabel(view.unit)}` : 'sin dato'}</span>
        <span className="cs-surface__ramp" style={{ background: `linear-gradient(90deg, ${rampStops})` }} aria-hidden />
        <span>{Number.isFinite(maxValue) ? `${formatNumber(maxValue, { digits: valDigits })} ${unitLabel(view.unit)}` : 'sin dato'}</span>
        <span className="cs-surface__nan-key" title="Combinaciones sin muestras clasificadas o sin dato">
          <span className="cs-surface__nan-swatch" aria-hidden />
          sin dato
        </span>
      </div>

      {hasOverrides && (
        <div className="cs-surface__note">
          Con valor propio por zona:{' '}
          {[...new Set([...view.xOverrides, ...view.yOverrides])].join(', ')} (el mapa barre valores globales; el semáforo evalúa cada zona con sus cortes vigentes).
        </div>
      )}
    </div>
  );
}

// --- panel ------------------------------------------------------------------------------------------------------

const STEP_PRESETS = [21, 41, 81, 161];

function SensitivityPanel({ module, interpretation, zoneId, setParam, result }: ModulePanelProps) {
  const themeName = useResolvedTheme();
  const entry = useProject(selectActiveEntry);
  const commitProject = useProject((s) => s.commit);
  const setUi = useUi((s) => s.set);
  const [viewMode, setViewMode] = useState<'1d' | '2d'>('1d');
  const [pairId, setPairId] = useState<SurfacePairId>('phi-sw');
  const [surfaceMetric, setSurfaceMetric] = useState<SurfaceViewMetric>('netPay');
  const [fluidPick, setFluidPick] = useState<VolumeKey>('ooip');
  const zones: Zone[] = useMemo(() => [...interpretation.zones].sort((a, b) => a.top - b.top), [interpretation.zones]);
  const zone = zoneId ? zones.find((z) => z.id === zoneId) : undefined;
  const viewId = zone?.id ?? '';

  const out = result?.outputs.find((o) => o.moduleId === module.id && o.port === 'CUTOFF_SWEEP');
  const rows = (out?.value as TableValue | undefined)?.rows;
  const node = result?.nodes.find((x) => x.moduleId === module.id);

  const view = useMemo(() => {
    const byVar = new Map<SweepVariable, { grid: Row[]; current: Row | undefined }>();
    for (const d of VARIABLES) byVar.set(d.variable, { grid: [], current: undefined });
    for (const r of rows ?? []) {
      if (r.zoneId !== viewId) continue;
      const s = byVar.get(r.variable as SweepVariable);
      if (!s) continue;
      if (r.current === 1) s.current = r;
      else s.grid.push(r);
    }
    let oil = false;
    let gas = false;
    for (const s of byVar.values()) {
      for (const r of s.grid) {
        if (n(r.ooip) > 0) oil = true;
        if (n(r.ogip) > 0) gas = true;
      }
    }
    return { byVar, oil, gas };
  }, [rows, viewId]);

  const effective = useMemo(() => (entry ? effectiveWell(entry.well, result) : null), [entry, result]);
  const surfaceView = useMemo(() => {
    if (viewMode !== '2d' || !effective) return null;
    return buildCutoffSurfaceView({
      well: effective,
      interpretation,
      result,
      zoneId: zone?.id ?? null,
      pairId,
      metric: surfaceMetric,
      fluidPick,
      steps: DEFAULT_SURFACE_STEPS,
    });
  }, [viewMode, effective, interpretation, result, zone?.id, pairId, surfaceMetric, fluidPick]);

  if (!rows || node?.status !== 'ok') {
    return (
      <EmptyState
        size="sm"
        icon="filter"
        title="Todavía no hay barrido"
        description="La sensibilidad necesita Vsh, porosidad efectiva y Sw. Completá los pasos de arcilla, porosidad y saturación."
      />
    );
  }

  const volume: VolumeKey | null = view.oil && view.gas ? fluidPick : view.oil ? 'ooip' : view.gas ? 'ogip' : null;
  // Petróleo en Mm³ salvo que pase de 1000 Mm³ (entonces MMm³); gas siempre en MMm³.
  let maxVol = 0;
  if (volume) for (const s of view.byVar.values()) for (const r of s.grid) maxVol = Math.max(maxVol, n(r[volume]) || 0);
  const volumeUnit: UnitId = volume === 'ooip' && maxVol < 1e6 ? 'Mm3' : 'MMm3';
  const valueOf = (key: string): number => {
    const spec = module.params[key] as NumberParamSpec;
    const storage = paramStorageKey(module.id, key, spec);
    const zv = zone ? interpretation.params.zones[zone.id]?.[storage] : undefined;
    const gv = interpretation.params.global[storage];
    return Number(zv ?? gv ?? spec.default);
  };
  const overridesOf = (key: string): string[] => {
    if (zone) return [];
    const spec = module.params[key]!;
    const storage = paramStorageKey(module.id, key, spec);
    return zones.filter((z) => interpretation.params.zones[z.id]?.[storage] !== undefined).map((z) => z.name);
  };
  const scopeLabel = zone ? `zona ${zone.name}` : zones.length ? 'total, valor global' : 'pozo completo';
  const pay = fillColor('netPay', themeName).color;
  const hc = fillColor('hydrocarbon', themeName).color;
  const steps = valueOf('steps');

  const zoneOptions = [{ value: TOTAL, label: 'Total' }, ...zones.map((z) => ({ value: z.id, label: z.name }))];
  const pickZone = (v: string) => setUi({ editingZoneId: v === TOTAL ? null : v });

  const commitSurfacePair = (nextX: number, nextY: number) => {
    if (!effective || !surfaceView) return;
    commitProject(`Mover ${surfaceView.pair.label} en superficie 2D`, (p) =>
      setCutoffPairRecipe(p, effective.id, zone?.id ?? null, [
        { key: surfaceView.xParam, value: nextX },
        { key: surfaceView.yParam, value: nextY },
      ]),
    );
  };

  const renderSurface2D = () => {
    if (!surfaceView) {
      return (
        <EmptyState
          size="sm"
          icon="filter"
          title="No se pudo construir la superficie 2D"
          description="Falta alguna de las curvas de Vsh, porosidad efectiva o Sw en el pozo activo."
        />
      );
    }
    const specX = module.params[surfaceView.xParam] as NumberParamSpec;
    const specY = module.params[surfaceView.yParam] as NumberParamSpec;
    const specFixed = module.params[surfaceView.fixedParam] as NumberParamSpec;
    const specPerm = module.params['permCutoff'] as NumberParamSpec;
    const st = surfaceView.stability;
    const meta = STABILITY_META[st.status];
    const metricOpts = availableSurfaceMetrics(surfaceView.hasOil, surfaceView.hasGas);
    const digits = surfaceView.metric === 'hphiShPay' ? 2 : 1;
    const unitStr = unitLabel(surfaceView.unit);
    const fixedVar = surfaceView.pair.fixedVar;
    const deltaLabel =
      st.zeroCenterWithGain
        ? `0 ${unitStr} en el centro · hasta ${formatNumber(st.maxValue, { digits })} ${unitStr} en la caja`
        : st.maxRelDelta !== null
          ? `var. máx. ±${formatNumber(st.maxRelDelta * 100, { digits: 1 })} % (${formatNumber(st.minValue, { digits })}–${formatNumber(st.maxValue, { digits })} ${unitStr})`
          : null;

    return (
      <div className="cs-surface">
        <div className="cs-surface__controls">
          <div className="cs-surface__row">
            <SegmentedControl
              aria-label="Par de cutoffs de la superficie"
              size="sm"
              value={pairId}
              onChange={(v) => setPairId(v as SurfacePairId)}
              options={SURFACE_PAIRS.map((p) => ({ value: p.id, label: p.label }))}
            />
            <span className="cs-spacer" />
            <SegmentedControl
              aria-label="Métrica de la superficie 2D"
              size="sm"
              value={surfaceView.metric}
              onChange={(v) => {
                const m = v as SurfaceViewMetric;
                setSurfaceMetric(m);
                if (m === 'ooip' || m === 'ogip') setFluidPick(m);
              }}
              options={metricOpts}
            />
          </div>

          <div className="cs-surface__fixed">
            <span>
              Fijo:{' '}
              <strong>
                {VAR_SYMBOL[fixedVar]} {VAR_OP[fixedVar]} {formatParamValue(surfaceView.fixedCurrent, specFixed)}
              </strong>
            </span>
            <span>
              Corte k:{' '}
              <strong>
                {surfaceView.permCutoff !== null ? `k ≥ ${formatParamValue(surfaceView.permCutoff, specPerm)}` : 'desactivado'}
              </strong>
            </span>
            {zone?.kind === 'seal' && <span>Zona sello (sin aporte de volumen)</span>}
          </div>
        </div>

        <div className="cs-stability" aria-live="polite">
          <div className="cs-stability__head">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <span className="cs-stability__value">
              {Number.isFinite(st.centerValue) ? `${formatNumber(st.centerValue, { digits })} ${unitStr}` : 'sin dato'}
            </span>
            {deltaLabel && <span className="cs-stability__delta">{deltaLabel}</span>}
          </div>
          <div className="cs-stability__desc">
            {st.zeroCenterWithGain
              ? 'En el borde del corte vigente: un desplazamiento local dentro de la caja activa espesor neto positivo.'
              : meta.detail}
          </div>
        </div>

        <Surface2DChart
          view={surfaceView}
          specX={specX}
          specY={specY}
          scopeLabel={scopeLabel}
          onCommitPair={commitSurfacePair}
        />
      </div>
    );
  };

  return (
    <div className="cs-panel">
      <div className="cs-mode-bar">
        <SegmentedControl
          aria-label="Modo de visualización de sensibilidad"
          size="sm"
          block
          value={viewMode}
          onChange={(v) => setViewMode(v as '1d' | '2d')}
          options={[
            { value: '1d', label: 'Curvas 1D' },
            { value: '2d', label: 'Superficie 2D' },
          ]}
        />
      </div>

      {zones.length > 0 && (
        <div className="cs-panel__zones">
          {zoneOptions.length <= 7 ? (
            <SegmentedControl aria-label="Ver la sensibilidad de" size="sm" block wrap value={zone?.id ?? TOTAL} onChange={pickZone} options={zoneOptions} />
          ) : (
            <Select aria-label="Ver la sensibilidad de" size="sm" block value={zone?.id ?? TOTAL} onChange={pickZone} options={zoneOptions.map((o) => ({ ...o, label: o.value === TOTAL ? 'Total (todas las zonas)' : `Zona ${o.label}` }))} />
          )}
          <p className="cs-panel__hint">
            {viewMode === '2d'
              ? (() => {
                  const pDef = SURFACE_PAIRS.find((p) => p.id === pairId) ?? SURFACE_PAIRS[0]!;
                  return zone
                    ? `Hacé clic o arrastrá la mira 2D para ajustar ${VAR_SYMBOL[pDef.xVar]} y ${VAR_SYMBOL[pDef.yVar]} en la zona ${zone.name} (un Ctrl+Z deshace ambos).`
                    : `Hacé clic o arrastrá la mira 2D para ajustar ${VAR_SYMBOL[pDef.xVar]} y ${VAR_SYMBOL[pDef.yVar]} globales (un Ctrl+Z deshace ambos).`;
                })()
              : zone
                ? `Arrastrá la línea de un cutoff para cambiarlo en la zona ${zone.name}.${zone.kind === 'seal' ? ' Es una zona de tipo sello: no aporta volumen.' : ''}`
                : 'Arrastrá la línea de un cutoff para cambiar su valor global (lo usan las zonas sin valor propio).'}
          </p>
        </div>
      )}

      {viewMode === '2d' ? (
        renderSurface2D()
      ) : (
        <>
          <div className="cs-legend">
            <span className="cs-legend__item">
              <span className="cs-legend__area" style={{ background: withAlpha(pay, 0.25), borderTopColor: pay }} aria-hidden />
              Neto pay (m)
            </span>
            {volume && (
              <span className="cs-legend__item">
                <span className="cs-legend__dash" style={{ borderTopColor: hc }} aria-hidden />
                {VOLUME[volume].label} ({unitLabel(volumeUnit)})
              </span>
            )}
            {view.oil && view.gas && (
              <>
                <span className="cs-spacer" />
                <SegmentedControl
                  aria-label="Volumen a mostrar"
                  size="sm"
                  value={fluidPick}
                  onChange={(v) => setFluidPick(v as VolumeKey)}
                  options={[
                    { value: 'ooip', label: 'Petróleo' },
                    { value: 'ogip', label: 'Gas' },
                  ]}
                />
              </>
            )}
          </div>

          <div className="cs-charts">
            {VARIABLES.map((d) => {
              const s = view.byVar.get(d.variable)!;
              const spec = module.params[d.param] as NumberParamSpec;
              return (
                <SweepChart
                  key={d.variable}
                  def={d}
                  spec={spec}
                  grid={s.grid}
                  current={s.current}
                  cutoff={valueOf(d.param)}
                  volume={volume}
                  volumeUnit={volumeUnit}
                  overrides={overridesOf(d.param)}
                  scopeLabel={scopeLabel}
                  onCommit={(v) => setParam(d.param, v)}
                />
              );
            })}
          </div>

          <div className="cs-panel__foot">
            <label className="cs-panel__steps">
              <span>Puntos del barrido</span>
              <Select
                size="sm"
                value={String(steps)}
                onChange={(v) => setParam('steps', Number(v))}
                options={[...new Set([...STEP_PRESETS, steps])].sort((a, b) => a - b).map((k) => ({ value: String(k), label: String(k) }))}
              />
            </label>
            {!volume && zones.length === 0 && <span className="cs-panel__hint">Definí zonas para ver el volumen in situ.</span>}
          </div>
        </>
      )}
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'cutoff-sensitivity', component: SensitivityPanel, mode: 'replace' };
