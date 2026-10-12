/**
 * Comparación del sumario por zona entre dos fuentes (A y B: snapshot o interpretación actual), con Δ = B − A y la
 * lista de diferencias de parámetros. La lógica de filas es pura (src/core/state/snapshotCompare.ts); acá solo se
 * elige, se espera el cálculo y se dibuja. Ver docs/decisiones/0026.
 */
import { useMemo } from 'react';
import { compareSummaries, type CompareCell, type CompareRow, type MetricDef } from '../../core/state/snapshotCompare';
import { describeDiff, diffInterpretations } from '../../core/state/snapshots';
import type { Snapshot, WellEntry } from '../../core/state/project';
import { registry } from '../../modules';
import { Badge, Callout, DataTable, formatNumber, IconButton, Section, Select, Spinner, type Column } from '../../ui';
import { CURRENT, useSource, useSummary, type SourceState } from './useSource';

const dateFmt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/** Número con signo explícito (+ / − tipográfico); «0» si es cero. */
function signed(v: number, digits: number): string {
  const s = formatNumber(Math.abs(v), { digits });
  if (s === formatNumber(0, { digits })) return s;
  return `${v > 0 ? '+' : '−'}${s}`;
}

function DeltaCell({ cell, metric }: { cell: CompareCell; metric: MetricDef }) {
  const { a, b, delta, pct, sign } = cell;
  if (a === null && b === null) return <span className="snapc-a">—</span>;
  // Sin cambio: un solo valor y Δ = 0 tenue, así lo que cambia salta a la vista.
  if (sign === 0) {
    return (
      <span className="snapc-cell num" title="A = B">
        <span className="snapc-b">{formatNumber(b, { digits: metric.digits })}</span>
        <span className="snapc-delta">0</span>
      </span>
    );
  }
  const dir = sign === 1 ? ' is-up' : sign === -1 ? ' is-down' : '';
  return (
    <span className="snapc-cell num">
      <span className="snapc-ab">
        <span className="snapc-a" title="A">
          {formatNumber(a, { digits: metric.digits })}
        </span>
        <span className="snapc-arrow" aria-hidden="true">
          →
        </span>
        <span className="snapc-b" title="B">
          {formatNumber(b, { digits: metric.digits })}
        </span>
      </span>
      {delta !== null ? (
        <span className={`snapc-delta${dir}`}>
          {signed(delta, metric.digits)}
          {metric.pct && <span className="snapc-pct"> ({pct === null ? 'sin %' : `${signed(pct, 1)} %`})</span>}
        </span>
      ) : (
        <span className="snapc-delta">{a === null ? 'sin dato en A' : 'sin dato en B'}</span>
      )}
    </span>
  );
}

function columns(metrics: readonly MetricDef[]): Column<CompareRow>[] {
  return [
    {
      key: 'zone',
      header: 'Zona',
      render: (r) => (
        <span className="snapc-zone">
          {r.name}
          {r.seal && <span className="snapc-zone__tag">sello</span>}
          {r.presence === 'onlyA' && (
            <Badge tone="neutral" variant="outline" title="La zona está en A y no en B">
              solo en A
            </Badge>
          )}
          {r.presence === 'onlyB' && (
            <Badge tone="accent" variant="outline" title="La zona está en B y no en A">
              solo en B
            </Badge>
          )}
        </span>
      ),
    },
    ...metrics.map(
      (m): Column<CompareRow> => ({
        key: m.id,
        title: `${m.title} (${m.unit})`,
        align: 'num',
        // Columnas de métricas del mismo ancho: los valores se leen en una grilla pareja.
        width: `${(84 / metrics.length).toFixed(2)}%`,
        header: (
          <span className="snapc-head">
            {m.label}
            <span className="snapc-head__unit">{m.unit}</span>
          </span>
        ),
        render: (r) => <DeltaCell cell={r.cells[m.id]} metric={m} />,
      }),
    ),
  ];
}

function Waiting({ sources }: { sources: SourceState[] }) {
  const names = sources.filter((s) => s.status === 'pending').map((s) => `«${s.label}»`);
  return (
    <div className="snap-wait" role="status">
      <Spinner size={16} />
      Calculando el sumario de {names.join(' y ')}…
    </div>
  );
}

export function SummaryCompare({ entry, snapshots, a, b, onChange }: { entry: WellEntry; snapshots: readonly Snapshot[]; a: string; b: string; onChange(a: string, b: string): void }) {
  const srcA = useSource(a, entry, snapshots);
  const srcB = useSource(b, entry, snapshots);
  const depth = entry.well.depth.values;
  const sumA = useSummary(srcA, depth);
  const sumB = useSummary(srcB, depth);
  const comparison = useMemo(() => (sumA && sumB && !sumA.missing && !sumB.missing ? compareSummaries(sumA, sumB) : null), [sumA, sumB]);
  const cols = useMemo(() => (comparison ? columns(comparison.metrics) : []), [comparison]);

  const diffLines = useMemo(() => {
    if (!srcA.interpretation || !srcB.interpretation) return null;
    const zones = [...srcB.interpretation.zones, ...srcA.interpretation.zones.filter((z) => !srcB.interpretation!.zones.some((x) => x.id === z.id))];
    return diffInterpretations(srcA.interpretation, srcB.interpretation, registry).map((d) => describeDiff(d, { registry, zones }));
  }, [srcA.interpretation, srcB.interpretation]);

  const options = [
    { value: CURRENT, label: 'Interpretación actual' },
    ...[...snapshots].reverse().map((s) => ({ value: s.id, label: `${s.name} · ${dateFmt.format(new Date(s.createdAt))}` })),
  ];
  const pending = srcA.status === 'pending' || srcB.status === 'pending';

  const problems: { side: string; label: string; message: string }[] = [];
  for (const [side, src, sum] of [
    ['A', srcA, sumA],
    ['B', srcB, sumB],
  ] as const) {
    if (src.status === 'error') problems.push({ side, label: src.label, message: src.message });
    else if (sum?.missing) problems.push({ side, label: src.label, message: sum.missing });
  }

  return (
    <>
      <Section className="snap-section" title="Comparar sumario por zona" meta={comparison ? `${comparison.changed} ${comparison.changed === 1 ? 'zona cambia' : 'zonas cambian'}` : undefined}>
        <div className="snap-pick">
          <span className="snap-pick__side">
            <span className="snap-letter" aria-hidden="true">
              A
            </span>
            <Select size="sm" value={a} onChange={(v) => onChange(v, b)} options={options} aria-label="Estado A (antes)" data-testid="snap-pick-a" />
          </span>
          <IconButton icon="reverse" label="Intercambiar A y B" size="sm" onClick={() => onChange(b, a)} />
          <span className="snap-pick__side">
            <span className="snap-letter" aria-hidden="true">
              B
            </span>
            <Select size="sm" value={b} onChange={(v) => onChange(a, v)} options={options} aria-label="Estado B (después)" data-testid="snap-pick-b" />
          </span>
          {pending && comparison && (
            <span className="snap-pick__status" role="status">
              <Spinner size={12} />
              Calculando…
            </span>
          )}
        </div>
        {a === b && <Callout tone="info">A y B son el mismo estado: todas las diferencias dan cero.</Callout>}
        {problems.length > 0 ? (
          <Callout tone="warn" title="No se puede armar el sumario para comparar">
            <ul className="snap-diff">
              {problems.map((p) => (
                <li key={p.side}>
                  <strong>
                    {p.side} · {p.label}:
                  </strong>{' '}
                  {p.message}
                </li>
              ))}
            </ul>
          </Callout>
        ) : pending && !comparison ? (
          <Waiting sources={[srcA, srcB]} />
        ) : comparison ? (
          <>
            <DataTable
              className="snapc-table"
              dense
              rows={comparison.rows}
              rowKey={(r) => r.key}
              maxHeight={300}
              caption="Sumario por zona: A, B y diferencia"
              rowProps={(r) => ({
                'data-total': r.total ? '' : undefined,
                'data-changed': !r.total && (r.presence !== 'both' || comparison.metrics.some((m) => r.cells[m.id].sign === 1 || r.cells[m.id].sign === -1)) ? '' : undefined,
              })}
              columns={cols}
              data-testid="snap-compare-table"
            />
            <div className="snapc-legend">
              <span>Cada celda: A → B y debajo Δ = B − A.</span>
              <span>% relativo a A en espesores, k y volúmenes; en φe, Sw y Vsh, solo la diferencia (v/v).</span>
              <span>Promedios del pay.</span>
            </div>
          </>
        ) : null}
      </Section>
      <Section className="snap-section" title="Cambios de parámetros, zonas y métodos (A → B)" meta={diffLines ? String(diffLines.length) : undefined}>
        {!diffLines ? null : diffLines.length === 0 ? (
          <p className="snap-diff-none">Ninguno: los dos estados tienen los mismos parámetros, zonas y métodos.</p>
        ) : (
          <ul className="snap-diff" data-testid="snap-diff">
            {diffLines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
