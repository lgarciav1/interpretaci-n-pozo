/**
 * Panel a medida de `cutoff-sensitivity` (0007, C20): para cada cutoff (Vsh, φ, Sw) una curva de espesor neto pay
 * (y volumen in situ si hay volumen) contra el umbral, con la línea del cutoff vigente que se arrastra: al soltar,
 * escribe el parámetro compartido (global o de la zona elegida). Tooltip con los valores bajo el cursor.
 * Sin ecuaciones (van en el módulo Ecuaciones).
 */
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useUi } from '../../app/store/ui';
import type { TableCell, TableValue } from '../../core/module';
import { paramStorageKey, type NumberParamSpec } from '../../core/params';
import { convert, unitLabel, type UnitId } from '../../core/units';
import type { Zone } from '../../core/well';
import type { SweepVariable } from '../../petro/sensitivity';
import {
  BASE_TOKENS,
  EmptyState,
  SegmentedControl,
  Select,
  contrastRatio,
  curveStyle,
  fillColor,
  formatNumber,
  formatParamValue,
  scalePx,
  stepValue,
  useResolvedTheme,
  useUiScaleFactor,
  withAlpha,
  type ThemeTokens,
} from '../../ui';
import { useCanvas } from '../../ui/canvas';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { clamp, snapToStep } from '../../ui/scale';
import { niceStep } from '../../viewer/ticks';
import { SWEEP_GRIDS } from './index';
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

// --- panel ------------------------------------------------------------------------------------------------------

const STEP_PRESETS = [21, 41, 81, 161];

function SensitivityPanel({ module, interpretation, zoneId, setParam, result }: ModulePanelProps) {
  const themeName = useResolvedTheme();
  const setUi = useUi((s) => s.set);
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

  return (
    <div className="cs-panel">
      {zones.length > 0 && (
        <div className="cs-panel__zones">
          {zoneOptions.length <= 7 ? (
            <SegmentedControl aria-label="Ver la sensibilidad de" size="sm" block wrap value={zone?.id ?? TOTAL} onChange={pickZone} options={zoneOptions} />
          ) : (
            <Select aria-label="Ver la sensibilidad de" size="sm" block value={zone?.id ?? TOTAL} onChange={pickZone} options={zoneOptions.map((o) => ({ ...o, label: o.value === TOTAL ? 'Total (todas las zonas)' : `Zona ${o.label}` }))} />
          )}
          <p className="cs-panel__hint">
            {zone
              ? `Arrastrá la línea de un cutoff para cambiarlo en la zona ${zone.name}.${zone.kind === 'seal' ? ' Es una zona de tipo sello: no aporta volumen.' : ''}`
              : 'Arrastrá la línea de un cutoff para cambiar su valor global (lo usan las zonas sin valor propio).'}
          </p>
        </div>
      )}

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
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'cutoff-sensitivity', component: SensitivityPanel, mode: 'replace' };
