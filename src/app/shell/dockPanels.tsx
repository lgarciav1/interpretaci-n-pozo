/**
 * PANELES DEL DOCK — la lista de pestañas de la franja inferior del centro: los de la app (una entrada acá) y los que
 * aporten los módulos en `src/modules/<id>/dock.tsx` (`dockPanels: DockPanelDef[]`, descubiertos solos; van antes de
 * «Motor»). `useBadge` es un hook opcional (contador junto al título). Contrato: `src/ui/dockPanel.ts`.
 */
import type { ReactNode } from 'react';
import type { OutputRecord } from '../../core/engine/engine';
import type { TableValue, ZoneScalarValue } from '../../core/module';
import { convert, unitLabel, type UnitId } from '../../core/units';
import { registry } from '../../modules';
import { Badge, DataTable, EmptyState, Section, StatusDot, formatNumber, useFlash, type Tone } from '../../ui';
import type { DockPanelDef } from '../../ui/dockPanel';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { TrendsPanel } from '../trends/TrendsPanel';

export type { DockPanelDef } from '../../ui/dockPanel';

function Flash({ value, children }: { value: unknown; children: ReactNode }) {
  const flash = useFlash(value);
  return (
    <span className="ui-flash dock-flash" data-flash={flash}>
      {children}
    </span>
  );
}

const num = (v: unknown, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? formatNumber(v, { digits: d }) : '—');
const unitSuffix = (u: string | undefined) => (u && u !== 'unitless' ? ` (${unitLabel(u)})` : '');

/**
 * Cómo mostrar valores de una unidad: los volúmenes en m³ se pasan a Mm³ o MMm³ según el mayor valor (un OOIP
 * de millones de m³ con tres decimales no se lee); el resto, con decimales según la unidad.
 */
interface Display {
  unit: UnitId | undefined;
  digits: number;
  value(v: unknown): unknown;
}
function displayFor(unit: UnitId | undefined, values: readonly unknown[]): Display {
  if (unit === 'm3') {
    const max = Math.max(0, ...values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : 0)));
    const to: UnitId = max >= 1e9 ? 'MMm3' : 'Mm3';
    return { unit: to, digits: to === 'MMm3' ? 2 : 1, value: (v) => (typeof v === 'number' ? convert(v, 'm3', to) : v) };
  }
  const digits = unit === 'm' || unit === 'mD' || unit === 'Mm3' ? 1 : unit === 'MMm3' || unit === 'MMbbl' || unit === 'Bcf' || unit === 'km2' ? 2 : 3;
  return { unit, digits, value: (v) => v };
}

interface ZoneRow {
  id: string;
  name: string;
}

/** Valores por zona (salidas `zoneScalar`): una tabla con una fila por zona y una columna por salida. */
function ZoneScalarsTable({ outputs }: { outputs: readonly OutputRecord[] }) {
  const zones = useProject((s) => selectActiveEntry(s)?.interpretation.zones);
  const rows: ZoneRow[] = [...(zones ?? [])].sort((a, b) => a.top - b.top).map((z) => ({ id: z.id, name: z.name }));
  return (
    <Section title="Valores por zona">
      <DataTable<ZoneRow>
        dense
        data-testid="zone-scalars"
        rows={rows}
        rowKey={(r) => r.id}
        empty="No hay zonas definidas."
        columns={[
          { key: 'zone', header: 'Zona', align: 'left', render: (r) => r.name },
          ...outputs.map((o) => {
            const d = displayFor(o.unit, Object.values(o.value as ZoneScalarValue));
            return {
              key: o.key,
              header: `${o.label}${unitSuffix(d.unit)}${o.active ? '' : ' · alternativa'}`,
              title: registry.get(o.moduleId)?.name ?? o.moduleId,
              align: 'num' as const,
              render: (r: ZoneRow) => {
                const v = (o.value as ZoneScalarValue)[r.id];
                return <Flash value={v}>{num(d.value(v), d.digits)}</Flash>;
              },
            };
          }),
        ]}
      />
    </Section>
  );
}

// Una tabla por muestra puede tener decenas de miles de celdas. Animarlas juntas bloquea
// los frames al restaurar/recalcular; las tablas grandes conservan todos sus valores sin destellos.
const MAX_TABLE_FLASH_CELLS = 200;

function ResultsPanel() {
  const result = useResults((s) => s.result);
  const tables = result?.outputs.filter((o) => o.kind === 'table' && !o.hidden) ?? [];
  const scalars = result?.outputs.filter((o) => o.kind === 'scalar') ?? [];
  const zoneScalars = result?.outputs.filter((o) => o.kind === 'zoneScalar') ?? [];
  if (tables.length === 0 && scalars.length === 0 && zoneScalars.length === 0) {
    return <EmptyState size="sm" icon="table" title="Todavía no hay resultados" description="Abrí un paso con módulos y ajustá sus parámetros: las tablas y los valores calculados aparecen acá." />;
  }
  return (
    <div className="dock-results">
      {scalars.length > 0 && (
        <div className="stat-grid">
          {scalars.map((s) => {
            const d = displayFor(s.unit, [s.value]);
            return (
            <div key={s.key} className={`stat${s.active ? '' : ' is-alternative'}`}>
              <div className="stat__label">{s.label}</div>
              <div className="stat__value num">
                <Flash value={s.value}>{num(d.value(s.value), d.digits)}</Flash>
                {d.unit && d.unit !== 'unitless' && <span className="stat__unit">{unitLabel(d.unit)}</span>}
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
            );
          })}
        </div>
      )}
      {zoneScalars.length > 0 && <ZoneScalarsTable outputs={zoneScalars} />}
      {tables.map((t) => {
        const spec = Object.values(registry.get(t.moduleId)!.outputs).find((s) => s.kind === 'table' && s.port === t.port);
        const columns = spec?.kind === 'table' ? spec.columns : [];
        const rows = (t.value as TableValue).rows;
        const flashCells = rows.length * columns.filter((c) => c.kind !== 'text').length <= MAX_TABLE_FLASH_CELLS;
        const totalRow = (r: Record<string, unknown>) => ({ 'data-total': r[columns[0]?.key ?? ''] === 'Total' ? '' : undefined });
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
              className="dock-table"
              rowProps={totalRow}
              columns={columns.map((c) => ({
                key: c.key,
                header: `${c.label}${unitSuffix(c.unit)}`,
                align: c.kind === 'text' ? 'left' : 'num',
                render: (r: Record<string, unknown>) =>
                  c.kind === 'text' ? String(r[c.key] ?? '') : flashCells ? <Flash value={r[c.key]}>{num(r[c.key], displayFor(c.unit, []).digits)}</Flash> : <span className="dock-flash">{num(r[c.key], displayFor(c.unit, []).digits)}</span>,
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

const found = import.meta.glob<{ dockPanels?: DockPanelDef[] }>('../../modules/*/dock.tsx', { eager: true });

/** Paneles de los módulos (válidos y sin ids repetidos con los de la app ni entre sí). */
export function collectDockPanels(files: Record<string, { dockPanels?: DockPanelDef[] }>, reserved: readonly string[]): DockPanelDef[] {
  const ids = new Set(reserved);
  const out: DockPanelDef[] = [];
  for (const [path, mod] of Object.entries(files)) {
    if (!Array.isArray(mod.dockPanels)) {
      console.warn(`${path} no exporta 'dockPanels' (DockPanelDef[]); se ignora.`);
      continue;
    }
    for (const p of mod.dockPanels) {
      if (!p || typeof p.id !== 'string' || typeof p.title !== 'string' || typeof p.component !== 'function') {
        console.warn(`${path}: panel del dock inválido (falta id, título o componente); se ignora.`);
        continue;
      }
      if (ids.has(p.id)) {
        console.warn(`${path}: el panel del dock '${p.id}' está repetido; se ignora.`);
        continue;
      }
      ids.add(p.id);
      out.push(p);
    }
  }
  return out;
}

const APP_PANELS: readonly DockPanelDef[] = [
  {
    id: 'results',
    title: 'Resultados',
    icon: 'table',
    component: ResultsPanel,
    useBadge: () => useResults((s) => s.result?.outputs.filter((o) => o.kind !== 'curve' && !o.hidden).length || null),
  },
  {
    id: 'diagnostics',
    title: 'Avisos',
    icon: 'warning',
    component: DiagnosticsPanel,
    useBadge: () => useResults((s) => s.result?.diagnostics.length || null),
  },
  {
    id: 'trends',
    title: 'Tendencias',
    icon: 'trend',
    component: TrendsPanel,
    useBadge: () => useProject((s) => selectActiveEntry(s)?.interpretation.trends.length || null),
  },
];
const ENGINE_PANEL: DockPanelDef = { id: 'engine', title: 'Motor', icon: 'cpu', component: EnginePanel };

export const DOCK_PANELS: readonly DockPanelDef[] = [...APP_PANELS, ...collectDockPanels(found, [...APP_PANELS, ENGINE_PANEL].map((p) => p.id)), ENGINE_PANEL];

