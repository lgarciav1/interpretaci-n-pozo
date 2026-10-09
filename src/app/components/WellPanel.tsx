/**
 * Columna izquierda: pozo, curvas medidas (con su semáforo de calidad), resumen del control de calidad,
 * curvas calculadas y zonas. El detalle de calidad vive en el paso Calidad del inspector y en el informe.
 */
import { setActiveWell, updateCurveMeta } from '../../core/state/project';
import type { Curve } from '../../core/well';
import { unitLabel } from '../../core/units';
import type { OutputRecord } from '../../core/engine/engine';
import { registry } from '../../modules';
import {
  Badge,
  Button,
  Chip,
  DataTable,
  EmptyState,
  Icon,
  Section,
  Select,
  Tooltip,
  formatNumber,
  type Column,
  type SelectOption,
} from '../../ui';
import { openStep, useFlow } from '../flow/useFlow';
import { selectActiveEntry, useProject } from '../store/project';
import { useWellQc } from '../store/qc';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { QcCounts, QcDot } from './Qc';
import './well-panel.css';

const fmt = (v: number, d = 2) => formatNumber(v, { digits: d });

export function WellPanel() {
  const entry = useProject(selectActiveEntry);
  const wells = useProject((s) => s.project.wells);
  const qc = useWellQc(entry?.well ?? null);
  const commit = useProject((s) => s.commit);
  const result = useResults((s) => s.result);
  const editingZoneId = useUi((s) => s.editingZoneId);
  const setUi = useUi((s) => s.set);
  const { states, suggested } = useFlow();

  if (!entry) {
    return (
      <EmptyState
        size="sm"
        icon="well"
        title="No hay pozo cargado"
        description="Cargá un Excel, LAS o CSV, o usá los datos del TP."
        actions={
          <Button size="sm" variant="primary" icon="upload" onClick={() => setUi({ loadDialog: {} })}>
            Cargar pozo
          </Button>
        }
      />
    );
  }

  const { well, interpretation } = entry;
  const d = well.depth.values;
  const computed = result?.outputs.filter((o) => o.kind === 'curve') ?? [];
  const roleOptions: SelectOption[] = [{ value: '', label: '—' }, ...registry.roles.all().map((r) => ({ value: r.id, label: r.id }))];
  const qcOf = (id: string) => qc?.curves.find((x) => x.curveId === id);
  const reviewed = entry.progress.marks['qc'] === 'done';
  const qcStep = states.find((s) => s.def.kind === 'qc');
  const editingZone = interpretation.zones.find((z) => z.id === editingZoneId) ?? null;

  const curveColumns: Column<Curve>[] = [
    {
      key: 'curve',
      header: 'Curva',
      render: (c) => {
        const q = qcOf(c.id);
        const name = <span className="mono">{c.mnemonic}</span>;
        return (
          <span className="well-panel__curve">
            {q ? <QcDot status={q.status} reasons={q.reasons.map((r) => r.message)} /> : <span className="well-panel__nodot" />}
            {c.description ? (
              <Tooltip content={c.description} placement="right">
                {name}
              </Tooltip>
            ) : (
              name
            )}
          </span>
        );
      },
    },
    {
      key: 'role',
      header: 'Rol',
      title: 'Rol de la curva: define qué módulos la usan',
      width: '44%',
      render: (c) => (
        <Select
          size="sm"
          block
          aria-label={`Rol de ${c.mnemonic}`}
          value={c.role ?? ''}
          options={roleOptions}
          onChange={(v) => commit('Asignar rol', (p) => updateCurveMeta(p, well.id, c.id, { role: v || null }))}
        />
      ),
    },
    { key: 'unit', header: 'Unidad', render: (c) => <span className="well-panel__unit">{unitLabel(c.unit)}</span> },
  ];

  const computedColumns: Column<OutputRecord>[] = [
    {
      key: 'curve',
      header: 'Curva',
      render: (o) => (
        <span className="well-panel__computed">
          <span className="well-panel__curve">
            <Icon name="sigma" size={12} strokeWidth={2} className="well-panel__calc" label="Calculada" />
            <span className="mono">{o.port}</span>
            {!o.active && (
              <Badge tone="neutral" variant="outline" title="Calculada pero no alimenta la cadena: otro módulo es la fuente elegida">
                alternativa
              </Badge>
            )}
          </span>
          <span className="well-panel__source">
            {registry.get(o.moduleId)?.name ?? o.moduleId}
          </span>
        </span>
      ),
    },
    { key: 'unit', header: 'Unidad', render: (o) => <span className="well-panel__unit">{o.unit ? unitLabel(o.unit) : '—'}</span> },
  ];

  return (
    <div className="well-panel">
      <Section title="Pozo" meta={wells.length > 1 ? `${wells.length} pozos` : undefined}>
        {wells.length > 1 ? (
          <Select
            aria-label="Pozo activo"
            block
            value={well.id}
            options={wells.map((w) => ({ value: w.well.id, label: w.well.name }))}
            onChange={(v) => commit('Cambiar de pozo', (p) => setActiveWell(p, v))}
          />
        ) : (
          <div className="well-panel__name">{well.name}</div>
        )}
        <p className="well-panel__summary num" data-testid="well-summary">
          {fmt(d[0]!)} – {fmt(d[d.length - 1]!)} m · {d.length.toLocaleString('es-AR')} muestras
          {well.depth.step ? ` · paso ${fmt(well.depth.step, 4)} m` : ''}
        </p>
      </Section>

      <Section
        title="Calidad"
        meta={reviewed ? <Badge tone="ok">revisada</Badge> : <Badge tone="warn" variant="outline">sin revisar</Badge>}
        actions={
          <Button size="sm" variant="ghost" icon="table" onClick={() => setUi({ qcReportOpen: true })} disabled={!qc}>
            Informe
          </Button>
        }
      >
        {qc ? (
          <div className="well-panel__qc">
            <QcCounts report={qc} />
            <p className="well-panel__hint">{boreholeLine(qc)}</p>
            {qcStep && (
              <Button size="sm" variant="ghost" iconRight="arrow-right" className="well-panel__link" onClick={() => openStep(qcStep)}>
                Ver por curva en el paso Calidad
              </Button>
            )}
          </div>
        ) : (
          <p className="well-panel__hint">Analizando las curvas…</p>
        )}
      </Section>

      <Section title="Curvas medidas" meta={well.curves.length}>
        {well.curves.length === 0 ? (
          <EmptyState size="sm" icon="curve" title="Sin curvas" description="El archivo no trajo curvas. Volvé a cargarlo revisando el mapeo de columnas." />
        ) : (
          <DataTable
            dense
            className="well-panel__table"
            data-testid="curves-table"
            caption="Curvas medidas"
            rows={well.curves}
            rowKey={(c) => c.id}
            rowProps={(c) => ({ 'data-curve': c.id, 'data-qc': qcOf(c.id)?.status })}
            columns={curveColumns}
          />
        )}
      </Section>

      <Section title="Curvas calculadas" meta={computed.length || undefined}>
        {computed.length === 0 ? (
          <EmptyState
            size="sm"
            icon="sigma"
            title="Todavía no hay curvas calculadas"
            description="Cada método del flujo (Arcilla, Porosidad, Saturación…) agrega acá sus curvas."
            actions={
              suggested && suggested.def.kind === 'modules' ? (
                <Button size="sm" iconRight="arrow-right" onClick={() => openStep(suggested)}>
                  Ir a {suggested.def.label}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            dense
            className="well-panel__table"
            data-testid="computed-table"
            caption="Curvas calculadas"
            rows={computed}
            rowKey={(o) => o.key}
            rowProps={(o) => ({ 'data-port': o.port, 'data-active': String(o.active) })}
            columns={computedColumns}
          />
        )}
      </Section>

      <Section title="Zonas" meta={interpretation.zones.length || undefined}>
        {interpretation.zones.length === 0 ? (
          <EmptyState
            size="sm"
            icon="layers"
            title="El pozo no tiene zonas"
            description="Cargá un archivo con una columna de zona (p. ej. ZONA). Sin zonas, los parámetros valen para todo el pozo."
          />
        ) : (
          <>
            <DataTable
              dense
              className="well-panel__table"
              data-testid="zones-table"
              caption="Zonas: elegí una para editar sus parámetros"
              rows={interpretation.zones}
              rowKey={(z) => z.id}
              selectedKey={editingZoneId}
              onRowClick={(z) => setUi({ editingZoneId: z.id === editingZoneId ? null : z.id })}
              columns={[
                {
                  key: 'name',
                  header: 'Zona',
                  render: (z) => (
                    <span className="well-panel__zone">
                      <span className="well-panel__swatch" style={{ background: z.color }} aria-hidden="true" />
                      {z.name}
                    </span>
                  ),
                },
                { key: 'top', header: 'Tope (m)', align: 'num', render: (z) => fmt(z.top) },
                { key: 'base', header: 'Base (m)', align: 'num', render: (z) => fmt(z.base) },
              ]}
            />
            <div className="well-panel__editing">
              {editingZone ? (
                <>
                  <span className="well-panel__hint">Parámetros de</span>
                  <Chip color={editingZone.color} selected onRemove={() => setUi({ editingZoneId: null })} removeLabel={`Dejar de editar la zona ${editingZone.name} (volver a los parámetros globales)`}>
                    Zona {editingZone.name}
                  </Chip>
                </>
              ) : (
                <span className="well-panel__hint">Elegí una zona para editar sus parámetros; sin elegir, se editan los globales.</span>
              )}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

/** Una línea sobre el estado del pozo (derrumbes y caliper inválido). */
function boreholeLine(qc: NonNullable<ReturnType<typeof useWellQc>>): string {
  const b = qc.borehole;
  if (!b) return 'Sin caliper: no se evaluaron derrumbes.';
  const parts: string[] = [];
  if (b.washouts.length > 0) parts.push(`derrumbe en ${b.washouts.length} ${b.washouts.length === 1 ? 'tramo' : 'tramos'} (≈ ${fmt(b.washoutThicknessM, 0)} m)`);
  if (b.invalidCaliper.length > 0) parts.push(`caliper inválido en ${b.invalidCaliper.length} ${b.invalidCaliper.length === 1 ? 'tramo' : 'tramos'}`);
  if (parts.length === 0) return `Caliper ${b.caliperId}: sin derrumbes.`;
  const text = parts.join(' y ');
  return `Caliper ${b.caliperId}: ${text}.`;
}
