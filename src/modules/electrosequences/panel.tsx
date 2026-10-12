/**
 * Panel de «Electrosecuencias» (Geo-1): leyenda de formas que filtra (con la cantidad de tramos de cada una), la forma
 * del GR de cada zona del usuario (`classifyInterval`) y la lista de tramos de la segmentación. Clic en un tramo = lo
 * resalta en la pista del visor y lleva el visor ahí; el seleccionado muestra descripción e interpretación.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTrendsUi } from '../../app/trends/store';
import { selectActiveEntry, useProject } from '../../app/store/project';
import type { TableValue } from '../../core/module';
import type { SegmentConfidence, SegmentShape } from '../../petro/segmentation';
import { Badge, EmptyState, formatNumber, useThemeTokens, withAlpha } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { shapeColor } from './draw';
import { ELECTROSEQUENCES_TABLE, ZONE_SHAPES_TABLE } from './index';
import { CONFIDENCE_ALPHA, CONFIDENCE_LABEL, countByShape, SHAPE_HINT, SHAPE_LABEL, SHAPES, sequencesFrom, shapeOutline, type SequenceRow } from './model';
import { getSelectedSequence, selectSequence, subscribeSelectedSequence } from './selection';
import './panel.css';

const CONF_TONE: Record<SegmentConfidence, 'ok' | 'info' | 'neutral'> = { high: 'ok', medium: 'info', low: 'neutral' };
const fmt = (v: number, digits = 1) => formatNumber(v, { digits });
const ALL = 'all';

/** Ícono SVG de una forma (misma silueta que la pista del visor). */
export function ShapeGlyph({ shape, confidence = 'high', size = 22 }: { shape: SegmentShape; confidence?: SegmentConfidence; size?: number }) {
  const theme = useThemeTokens();
  const color = shapeColor(shape, theme.name);
  const w = size * 0.72;
  const pts = shapeOutline(shape)
    .map(([u, v]) => `${(1 + u * (w - 2)).toFixed(2)},${(1 + v * (size - 2)).toFixed(2)}`)
    .join(' ');
  return (
    <svg className="eseq-glyph" width={w} height={size} viewBox={`0 0 ${w} ${size}`} aria-hidden="true">
      <polygon
        points={pts}
        fill={withAlpha(color, CONFIDENCE_ALPHA[confidence] * (theme.name === 'dark' ? 0.7 : 0.55))}
        stroke={color}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeDasharray={confidence === 'low' ? '3 2' : undefined}
      />
    </svg>
  );
}

function ElectrosequencesPanel({ module, result }: ModulePanelProps) {
  const theme = useThemeTokens();
  const entry = useProject(selectActiveEntry);
  const wellId = entry?.well.id ?? null;
  const zoneColors = useMemo(() => new Map((entry?.interpretation.zones ?? []).map((z) => [z.id, z.color])), [entry?.interpretation.zones]);
  const table = (port: string) => (result?.outputs.find((o) => o.moduleId === module.id && o.port === port)?.value as TableValue | undefined)?.rows;
  const seqRows = table(ELECTROSEQUENCES_TABLE);
  const zoneRows = table(ZONE_SHAPES_TABLE);
  const sequences = useMemo(() => sequencesFrom(seqRows ?? []), [seqRows]);
  const zones = useMemo(() => sequencesFrom(zoneRows ?? []), [zoneRows]);
  const counts = useMemo(() => countByShape(sequences), [sequences]);
  const [filter, setFilter] = useState<SegmentShape | typeof ALL>(ALL);
  const [openZone, setOpenZone] = useState<string | null>(null);
  const shown = filter === ALL ? sequences : sequences.filter((s) => s.shape === filter);
  const sel = useSyncExternalStore(subscribeSelectedSequence, getSelectedSequence);
  const selTop = sel && sel.wellId === wellId ? sel.top : null;

  // Un clic en la pista del visor selecciona un tramo: el panel lo trae a la vista.
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (selTop === null) return;
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }, [selTop]);

  if (!result) return null;
  if (!sequences.length) {
    return <EmptyState size="sm" icon="activity" title="Sin tramos" description="No hay rayos gamma con datos suficientes para segmentar." />;
  }

  const pick = (s: SequenceRow) => {
    selectSequence(wellId, s.top);
    const pad = Math.max(10, (s.base - s.top) * 0.5);
    useTrendsUi.getState().requestRange(s.top - pad, s.base + pad);
  };
  const shapeStyle = (shape: SegmentShape): CSSProperties => ({ ['--shape' as string]: shapeColor(shape, theme.name) });

  return (
    <div className="eseq">
      <div className="eseq-legend" role="group" aria-label="Filtrar por forma">
        <button type="button" className={`eseq-chip${filter === ALL ? ' is-on' : ''}`} onClick={() => setFilter(ALL)} aria-pressed={filter === ALL}>
          <span className="eseq-chip__label">Todas</span>
          <span className="eseq-chip__count num">{sequences.length}</span>
        </button>
        {SHAPES.filter((s) => counts[s] > 0).map((s) => (
          <button
            key={s}
            type="button"
            className={`eseq-chip${filter === s ? ' is-on' : ''}`}
            style={shapeStyle(s)}
            title={SHAPE_HINT[s]}
            aria-pressed={filter === s}
            onClick={() => setFilter(filter === s ? ALL : s)}
          >
            <ShapeGlyph shape={s} size={16} />
            <span className="eseq-chip__label">{SHAPE_LABEL[s]}</span>
            <span className="eseq-chip__count num">{counts[s]}</span>
          </button>
        ))}
      </div>

      {zones.length > 0 && (
        <section className="eseq-section" aria-label="Forma del GR por zona">
          <h4 className="eseq-title">Forma por zona</h4>
          <ol className="eseq-list">
            {zones.map((z) => {
              const open = openZone === z.zoneId;
              return (
                <li key={z.zoneId} className={`eseq-row${open ? ' is-selected' : ''}${z.confidence === 'low' ? ' is-low' : ''}`} style={shapeStyle(z.shape)}>
                  <button
                    type="button"
                    className="eseq-row__main eseq-row__main--zone"
                    aria-expanded={open}
                    onClick={() => {
                      setOpenZone(open ? null : z.zoneId);
                      if (!open) useTrendsUi.getState().requestRange(z.top - 5, z.base + 5);
                    }}
                  >
                    <span className="eseq-zone__dot" style={{ background: zoneColors.get(z.zoneId) ?? 'var(--color-text-subtle)' }} aria-hidden="true" />
                    <span className="eseq-zone__name">{z.zone}</span>
                    <ShapeGlyph shape={z.shape} confidence={z.confidence} size={20} />
                    <span className="eseq-row__shape">
                      {SHAPE_LABEL[z.shape]}
                      {z.serrated && z.shape !== 'serrated' ? <span className="eseq-row__mod"> serrado</span> : null}
                    </span>
                    <Badge tone={CONF_TONE[z.confidence]} variant={z.confidence === 'low' ? 'outline' : 'soft'} title="Confianza de la clasificación">
                      {CONFIDENCE_LABEL[z.confidence]}
                    </Badge>
                  </button>
                  {open && (
                    <div className="eseq-row__detail">
                      <p className="eseq-text">{z.description}</p>
                      <p className="eseq-text eseq-text--interp">{z.interpretation}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="eseq-section" aria-label="Tramos">
        <h4 className="eseq-title">
          Tramos <span className="eseq-title__count num">{shown.length}</span>
        </h4>
        <ol className="eseq-list" ref={listRef}>
          {shown.map((s) => {
            const isSel = selTop !== null && Math.abs(s.top - selTop) < 1e-6;
            return (
              <li key={s.top} className={`eseq-row${isSel ? ' is-selected' : ''}${s.confidence === 'low' ? ' is-low' : ''}`} style={shapeStyle(s.shape)}>
                <button type="button" className="eseq-row__main" onClick={() => (isSel ? selectSequence(wellId, null) : pick(s))} aria-expanded={isSel}>
                  <ShapeGlyph shape={s.shape} confidence={s.confidence} size={22} />
                  <span className="eseq-row__shape">
                    {SHAPE_LABEL[s.shape]}
                    {s.serrated && s.shape !== 'serrated' ? <span className="eseq-row__mod"> serrado</span> : null}
                  </span>
                  <span className="eseq-row__depth num">
                    {fmt(s.top)}–{fmt(s.base)} m
                  </span>
                  <span className="eseq-row__h num">{fmt(s.thickness)} m</span>
                  <Badge tone={CONF_TONE[s.confidence]} variant={s.confidence === 'low' ? 'outline' : 'soft'}>
                    {CONFIDENCE_LABEL[s.confidence]}
                  </Badge>
                </button>
                {isSel && (
                  <div className="eseq-row__detail">
                    <p className="eseq-text">{s.description}</p>
                    <p className="eseq-text eseq-text--interp">{s.interpretation}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <p className="eseq-note">La forma del GR no es diagnóstica por sí sola: confirmala con testigos, buzamientos y el contexto regional. La opacidad del ícono indica la confianza.</p>
      </section>
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'electrosequences', component: ElectrosequencesPanel };
