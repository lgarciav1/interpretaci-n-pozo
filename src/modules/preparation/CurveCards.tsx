/**
 * Selector de curva de «Preparar datos» como tarjetas (0058): cada curva medida con su mini-gráfico en el color
 * convencional, el semáforo del control de calidad y la franja de banderas por profundidad. Flechas ← → recorren.
 */
import { memo, useRef } from 'react';
import type { Curve } from '../../core/well';
import type { CurveQc } from '../../io/qc';
import { registry } from '../../modules';
import { Badge, StatusDot, curveStyle, useResolvedTheme, type Tone } from '../../ui';
import { useCanvas } from '../../ui/canvas';
import { drawSparkline } from './draw';

export interface CardInfo {
  curve: Curve;
  quality: Uint16Array;
  qc: CurveQc | undefined;
  prepared: boolean;
  inUse: boolean;
}

const QC_TONE: Record<string, Tone> = { ok: 'ok', warning: 'warn', bad: 'error' };
const QC_LABEL: Record<string, string> = { ok: 'Calidad sin observaciones', warning: 'Calidad con observaciones', bad: 'Calidad con problemas' };

const Spark = memo(function Spark({ curve, quality }: { curve: Curve; quality: Uint16Array }) {
  const theme = useResolvedTheme();
  const style = curveStyle(curve.role, theme, registry.roles, curve.id);
  const ref = useCanvas((ctx, size, t) => drawSparkline(ctx, size, t, { data: curve.data, quality, color: style.color, log: style.scale === 'log' }), [curve, quality, style.color]);
  return <canvas ref={ref} className="prep-card__spark" aria-hidden="true" />;
});

export function CurveCards({ cards, value, onChange }: { cards: readonly CardInfo[]; value: string; onChange(id: string): void }) {
  const theme = useResolvedTheme();
  const list = useRef<HTMLDivElement>(null);
  const move = (dir: number) => {
    const i = cards.findIndex((c) => c.curve.id === value);
    const next = cards[(i + dir + cards.length) % cards.length];
    if (!next) return;
    onChange(next.curve.id);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-curve="${CSS.escape(next.curve.id)}"]`)?.focus());
  };
  if (!cards.length) return null;
  return (
    <div
      ref={list}
      className="prep-cards"
      role="radiogroup"
      aria-label="Curva a preparar"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {cards.map(({ curve, quality, qc, prepared, inUse }) => {
        const selected = curve.id === value;
        const color = curveStyle(curve.role, theme, registry.roles, curve.id).color;
        const status = qc?.status ?? 'ok';
        const reason = qc?.reasons.find((r) => r.severity === status)?.message ?? qc?.reasons[0]?.message;
        return (
          <button
            key={curve.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-curve={curve.id}
            className={`prep-card${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(curve.id)}
            title={`${curve.mnemonic} · ${curve.role ? (registry.roles.get(curve.role)?.label ?? curve.role) : 'sin rol'}${reason ? `\n${reason}` : ''}`}
          >
            <span className="prep-card__head">
              <span className="prep-card__name" style={{ color }}>
                {curve.mnemonic}
              </span>
              {prepared && (
                <Badge tone={inUse ? 'accent' : 'neutral'} variant={inUse ? 'soft' : 'outline'}>
                  {inUse ? 'preparada' : 'receta'}
                </Badge>
              )}
              <StatusDot tone={QC_TONE[status] ?? 'neutral'} label={QC_LABEL[status] ?? 'Calidad'} nativeTitle={false} />
            </span>
            <span className="ui-visually-hidden">{curve.role ? (registry.roles.get(curve.role)?.label ?? curve.role) : 'Sin rol'}</span>
            <Spark curve={curve} quality={quality} />
          </button>
        );
      })}
    </div>
  );
}
