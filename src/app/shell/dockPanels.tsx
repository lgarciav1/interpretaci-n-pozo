/**
 * PANELES DEL DOCK — la lista de pestañas de la franja inferior del centro. Agregar un panel (histograma,
 * crossplot en la fase 7) = una entrada más. `useBadge` es un hook opcional (contador junto al título).
 */
import type { ComponentType, ReactNode } from 'react';
import type { TableValue } from '../../core/module';
import { registry } from '../../modules';
import { Badge, DataTable, EmptyState, Section, StatusDot, formatNumber, useFlash, type IconName, type Tone } from '../../ui';
import { useResults } from '../store/results';

export interface DockPanelDef {
  id: string;
  title: string;
  icon: IconName;
  component: ComponentType;
  useBadge?: () => ReactNode;
}

function Flash({ value, children }: { value: unknown; children: ReactNode }) {
  const flash = useFlash(value);
  return (
    <span className="ui-flash dock-flash" data-flash={flash}>
      {children}
    </span>
  );
}

const num = (v: unknown, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? formatNumber(v, { digits: d }) : '—');

function ResultsPanel() {
  const result = useResults((s) => s.result);
  const tables = result?.outputs.filter((o) => o.kind === 'table') ?? [];
  const scalars = result?.outputs.filter((o) => o.kind === 'scalar') ?? [];
  if (tables.length === 0 && scalars.length === 0) {
    return <EmptyState size="sm" icon="table" title="Todavía no hay resultados" description="Abrí un paso con módulos y ajustá sus parámetros: las tablas y los valores calculados aparecen acá." />;
  }
  return (
    <div className="dock-results">
      {scalars.length > 0 && (
        <div className="stat-grid">
          {scalars.map((s) => (
            <div key={s.key} className={`stat${s.active ? '' : ' is-alternative'}`}>
              <div className="stat__label">{s.label}</div>
              <div className="stat__value num">
                <Flash value={s.value}>{num(s.value)}</Flash>
                {s.unit && s.unit !== 'unitless' && <span className="stat__unit">{s.unit}</span>}
              </div>
              <div className="stat__source">
                {registry.get(s.moduleId)?.name ?? s.moduleId}
                {!s.active && (
                  <Badge tone="info" variant="outline">
                    alternativa
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {tables.map((t) => {
        const spec = Object.values(registry.get(t.moduleId)!.outputs).find((s) => s.kind === 'table' && s.port === t.port);
        const columns = spec?.kind === 'table' ? spec.columns : [];
        const rows = (t.value as TableValue).rows;
        return (
          <Section
            key={t.key}
            title={t.label}
            meta={
              <>
                {registry.get(t.moduleId)?.name}
                {!t.active && (
                  <>
                    {' '}
                    <Badge tone="info" variant="outline">
                      alternativa
                    </Badge>
                  </>
                )}
              </>
            }
          >
            <DataTable
              dense
              data-testid={`table-${t.port}`}
              rows={rows}
              rowKey={(_, i) => String(i)}
              columns={columns.map((c) => ({
                key: c.key,
                header: `${c.label}${c.unit && c.unit !== 'unitless' ? ` (${c.unit})` : ''}`,
                align: c.kind === 'text' ? 'left' : 'num',
                render: (r: Record<string, unknown>) =>
                  c.kind === 'text' ? String(r[c.key] ?? '') : <Flash value={r[c.key]}>{num(r[c.key], c.unit === 'm' ? 1 : 3)}</Flash>,
              }))}
            />
          </Section>
        );
      })}
    </div>
  );
}

const LEVEL_TONE: Record<string, Tone> = { error: 'error', warning: 'warn', info: 'info' };

function DiagnosticsPanel() {
  const result = useResults((s) => s.result);
  const error = useResults((s) => s.error);
  const diags = result?.diagnostics ?? [];
  if (diags.length === 0 && !error) return <EmptyState size="sm" icon="check-circle" title="Sin avisos" description="Los módulos no reportaron problemas en el último cálculo." />;
  return (
    <ul className="diag-list">
      {error && (
        <li className="diag-item">
          <StatusDot tone="error" label="Error" />
          {error}
        </li>
      )}
      {diags.map((d, i) => (
        <li key={i} className="diag-item">
          <StatusDot tone={LEVEL_TONE[d.level] ?? 'neutral'} label={d.level} />
          <span>{d.message}</span>
        </li>
      ))}
    </ul>
  );
}

function EnginePanel() {
  const { result, busy, error, mode } = useResults();
  return (
    <div className="dock-pad">
      <dl className="kv kv--wide" data-testid="engine-stats">
        <dt>Ejecución</dt>
        <dd data-testid="engine-mode">{mode === 'worker' ? 'Web Worker' : mode === 'in-process' ? 'hilo principal (sin worker)' : '—'}</dd>
        <dt>Estado</dt>
        <dd>{busy ? 'calculando…' : error ? 'con error' : 'listo'}</dd>
        <dt>Cálculo n.º</dt>
        <dd className="num" data-testid="engine-seq">
          {result?.seq ?? '—'}
        </dd>
        <dt>Tiempo en el motor</dt>
        <dd className="num" data-testid="engine-ms">
          {result ? `${result.stats.ms.toFixed(2)} ms` : '—'}
        </dd>
        <dt>Ida y vuelta</dt>
        <dd className="num">{result ? `${result.roundTripMs.toFixed(1)} ms` : '—'}</dd>
        <dt>Recalculados</dt>
        <dd data-testid="engine-recomputed">{result ? result.stats.recomputed.join(', ') || 'ninguno (caché)' : '—'}</dd>
        <dt>Reusados</dt>
        <dd>{result ? result.stats.reused.join(', ') || '—' : '—'}</dd>
        <dt>Pedidos coalescidos</dt>
        <dd className="num">{result?.coalesced ?? 0}</dd>
      </dl>
    </div>
  );
}

export const DOCK_PANELS: readonly DockPanelDef[] = [
  {
    id: 'results',
    title: 'Resultados',
    icon: 'table',
    component: ResultsPanel,
    useBadge: () => useResults((s) => s.result?.outputs.filter((o) => o.kind !== 'curve').length || null),
  },
  {
    id: 'diagnostics',
    title: 'Avisos',
    icon: 'warning',
    component: DiagnosticsPanel,
    useBadge: () => useResults((s) => s.result?.diagnostics.length || null),
  },
  { id: 'engine', title: 'Motor', icon: 'cpu', component: EnginePanel },
];
