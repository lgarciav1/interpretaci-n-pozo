/**
 * Gráfico antes/después de «Preparar datos» (0058): canvas con el original (gris), la preparada o la vista previa (color
 * de la curva), las muestras afectadas, zonas, escala de profundidad, cursor y la barra de banderas debajo. Arrastrar
 * sobre el gráfico marca el tramo de las herramientas (Escape cancela el arrastre). Debajo, la lectura bajo el cursor y
 * la leyenda de banderas con sus conteos en la vista.
 */
import { useMemo, useRef, useState } from 'react';
import { useThemeTokens, useUiScaleFactor, formatNumber } from '../../ui';
import { useCanvas } from '../../ui/canvas';
import { chartLayout, depthScale, drawBeforeAfter, flagColor, type ChartInput } from './draw';
import { flagCounts, QUALITY_FLAGS } from './flags';
import type { DepthRange } from './types';

export interface ChartProps extends Omit<ChartInput, 'brush' | 'hoverDepth'> {
  mnemonic: string;
  afterLabel: string | null;
  onSelect(range: DepthRange): void;
  height: number;
}

const f = (v: number, d = 2) => formatNumber(v, { digits: d });

export function BeforeAfterChart(props: ChartProps) {
  const { onSelect, height, mnemonic, afterLabel, ...input } = props;
  const theme = useThemeTokens();
  const ui = useUiScaleFactor();
  const [hover, setHover] = useState<number | null>(null);
  const [brush, setBrush] = useState<DepthRange | null>(null);
  const drag = useRef<{ from: number; pointer: number } | null>(null);
  const size = useRef({ width: 0, height: 0 });

  const ref = useCanvas(
    (ctx, s, t, scale) => {
      size.current = s;
      drawBeforeAfter(ctx, s, t, scale, { ...input, brush, hoverDepth: hover });
    },
    [input.depth, input.start, input.end, input.original, input.after, input.lower, input.upper, input.quality, input.color, input.log, input.zones, input.selection, input.viewerDepth, input.stale, brush, hover],
  );

  const scaleAt = () => {
    const el = ref.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    const L = chartLayout(w, h, ui);
    return { L, S: depthScale(input, L) };
  };
  const depthAt = (clientX: number): number | null => {
    const el = ref.current;
    if (!el) return null;
    const { L, S } = scaleAt();
    const x = clientX - el.getBoundingClientRect().left;
    if (x < L.gutter || x > L.gutter + S.plotWidth) return null;
    return Math.min(S.base, Math.max(S.top, S.depthAt(x)));
  };

  const readout = useMemo(() => {
    if (hover === null) return null;
    const d = input.depth;
    let lo = input.start, hi = input.end - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (d[mid]! < hover) lo = mid + 1;
      else hi = mid;
    }
    const i = lo > input.start && Math.abs(d[lo - 1]! - hover) < Math.abs(d[lo]! - hover) ? lo - 1 : lo;
    const q = input.quality[i - input.start] ?? 0;
    return {
      depth: d[i]!,
      original: input.original[i]!,
      after: input.after ? input.after[i]! : null,
      flags: QUALITY_FLAGS.filter((fl) => q & fl.bit).map((fl) => fl.label),
    };
  }, [hover, input.depth, input.start, input.end, input.original, input.after, input.lower, input.upper, input.quality]);

  const counts = useMemo(() => flagCounts(input.quality), [input.quality]);
  const v = (x: number) => (Number.isFinite(x) ? f(x, 3) : 'sin dato');

  return (
    <div className="prep-chart">
      <div className="prep-chart__legend" aria-hidden="true">
        <span className="prep-key">
          <span className="prep-key__line" style={{ background: input.after ? theme.color.textSubtle : input.color }} />
          {mnemonic} original
        </span>
        {afterLabel && (
          <span className="prep-key">
            <span className="prep-key__line prep-key__line--bold" style={{ background: input.color }} />
            {afterLabel}
          </span>
        )}
        {input.lower && <span className="prep-key">Banda nominal 90 % · calibración global</span>}
        <span className="prep-key">
          <span className="prep-key__dot" style={{ background: theme.color.error }} />
          excluidas
        </span>
        <span className="prep-key">
          <span className="prep-key__dot" style={{ background: theme.color.info }} />
          interpoladas
        </span>
        <span className="prep-key">
          <span className="prep-key__dot" style={{ background: theme.color.warn }} />
          sospechosas
        </span>
      </div>
      <canvas
        ref={ref}
        className="prep-chart__canvas"
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={`Antes y después de ${mnemonic} entre ${f(input.depth[input.start] ?? 0)} y ${f(input.depth[Math.max(input.start, input.end - 1)] ?? 0)} m MD, con banderas de calidad. Arrastrá para marcar un tramo.`}
        onPointerMove={(e) => {
          const d = depthAt(e.clientX);
          setHover(d);
          const g = drag.current;
          if (g && d !== null) setBrush({ top: Math.min(g.from, d), base: Math.max(g.from, d) });
        }}
        onPointerLeave={() => {
          if (!drag.current) setHover(null);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const d = depthAt(e.clientX);
          if (d === null) return;
          drag.current = { from: d, pointer: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.focus();
        }}
        onPointerUp={(e) => {
          const g = drag.current;
          drag.current = null;
          if (!g) return;
          e.currentTarget.releasePointerCapture(g.pointer);
          const b = brush;
          setBrush(null);
          if (!b) return;
          const { S } = scaleAt();
          if ((b.base - b.top) * S.pxPerM >= 4) onSelect(b);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && drag.current) {
            e.preventDefault();
            e.stopPropagation();
            drag.current = null;
            setBrush(null);
          }
        }}
      />
      <div className="prep-chart__readout num" aria-live="off">
        {readout ? (
          <>
            <span>
              MD <strong>{f(readout.depth)} m</strong>
            </span>
            <span>Original {v(readout.original)}</span>
            {readout.after !== null && (
              <span style={{ color: input.color }}>
                {afterLabel ?? 'Preparada'} {v(readout.after)}
              </span>
            )}
            {readout.flags.length > 0 && <span className="prep-muted">{readout.flags.join(' · ')}</span>}
          </>
        ) : brush ? (
          <span>
            Tramo <strong>{f(brush.top)} – {f(brush.base)} m</strong> · soltá para usarlo, Escape para cancelar
          </span>
        ) : (
          <span className="prep-muted">Pasá el puntero para leer valores; arrastrá para marcar el tramo de la herramienta.</span>
        )}
      </div>
      <ul className="prep-flags" aria-label="Banderas de calidad en la vista">
        {QUALITY_FLAGS.map((fl) => (
          <li key={fl.key} className={counts[fl.key] ? 'prep-flag' : 'prep-flag is-empty'} title={fl.description}>
            <span className="prep-flag__swatch" style={{ background: flagColor(fl.key, theme) }} />
            <span className="prep-flag__label">{fl.label}</span>
            <span className="prep-flag__count num">{counts[fl.key].toLocaleString('es-AR')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
