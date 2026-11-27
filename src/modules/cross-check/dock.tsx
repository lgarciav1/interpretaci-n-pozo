/**
 * Panel «Coherencia» del dock (G08, docs/decisiones/0092): semáforo de coherencia cruzada entre herramientas zona por
 * zona, capacidad de sello MICP/SCAL y navegación directa al tramo crítico del visor o al panel/módulo involucrado.
 *
 * Solo lectura sobre las salidas vigentes; lógica pura en `src/petro/crossCheck.ts` y `./model.ts`. Las ecuaciones no
 * se muestran acá (viven en `./index.ts` para el módulo Ecuaciones). Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { useMemo, useState } from 'react';
import { openModuleInspector } from '../../app/shell/moduleNavigation';
import { effectiveWell } from '../../app/preparation/data';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { useUi } from '../../app/store/ui';
import { useTrendsUi } from '../../app/trends/store';
import { registry } from '../index';
import {
  CROSS_CHECK_META,
  CROSS_CHECK_STATUS_LABEL,
  ZONE_CHECK_IDS,
  type CrossCheckItem,
  type CrossCheckStatus,
  type CrossCheckTarget,
} from '../../petro/crossCheck';
import { Badge, Button, Callout, DataTable, EmptyState, Section, StatusDot, formatNumber, type Column, type Tone } from '../../ui';
import type { DockPanelDef } from '../../ui/dockPanel';
import { buildCrossCheckReport, CROSS_CHECK_DOCK_ID } from './model';
import './cross-check.css';

const STATUS_TONE: Readonly<Record<CrossCheckStatus, Tone>> = {
  ok: 'ok',
  warn: 'warn',
  tension: 'error',
  unsupported: 'neutral',
};

const SEVERITY_ORDER: Readonly<Record<CrossCheckStatus, number>> = {
  tension: 0,
  warn: 1,
  ok: 2,
  unsupported: 3,
};

type FilterMode = 'alerts' | 'all' | CrossCheckStatus;

const itemKey = (it: Pick<CrossCheckItem, 'zoneId' | 'id'>) => `${it.zoneId ?? '__well__'}:${it.id}`;
const zoneHeading = (name: string) => (/^(?:zona|pozo)\b/i.test(name) ? name : `Zona ${name}`);
const f1 = (v: number) => (Number.isFinite(v) ? formatNumber(v, { digits: 1 }) : 'n/d');
const f2 = (v: number) => (Number.isFinite(v) ? formatNumber(v, { digits: 2 }) : 'n/d');

/** Abre la pestaña «Coherencia» en el dock (usable desde Sumario o la paleta de comandos). */
export function openCrossCheck(): void {
  useUi.getState().openPanel(CROSS_CHECK_DOCK_ID);
}

function jumpToRange(range: [number, number] | null): void {
  if (!range) return;
  useTrendsUi.getState().requestRange(range[0], range[1]);
}

function openTarget(target: CrossCheckTarget | null): void {
  if (!target) return;
  if (target.kind === 'dock') {
    useUi.getState().openPanel(target.panelId);
    return;
  }
  const mod = registry.get(target.moduleId);
  if (mod) openModuleInspector(mod);
}

export function CrossCheckPanel() {
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  const [filter, setFilter] = useState<FilterMode>('alerts');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const well = entry?.well ?? null;
  const interpretation = entry?.interpretation ?? null;

  const hasCurrentResult = !!well && result?.wellId === well.id;

  const report = useMemo(() => {
    if (!well || !interpretation) return null;
    const current = result?.wellId === well.id ? result : null;
    const eff = effectiveWell(well, current);
    return buildCrossCheckReport(eff, interpretation, current, registry);
  }, [well, interpretation, result]);

  const allItems = useMemo(() => {
    if (!report) return [] as CrossCheckItem[];
    const list: CrossCheckItem[] = [];
    for (const z of report.zones) {
      for (const id of ZONE_CHECK_IDS) list.push(z.checks[id]);
    }
    return list.sort((a, b) => SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status]);
  }, [report]);

  if (!well || !interpretation || !report) {
    return (
      <EmptyState
        size="sm"
        icon="check"
        title="Sin pozo activo"
        description="Cargá un pozo para auditar la coherencia física entre perfiles, SCAL, RMN, corona, MDT y MICP."
      />
    );
  }

  const visibleItems = allItems.filter((it) => {
    if (selectedKey && itemKey(it) === selectedKey) return true;
    if (filter === 'all') return true;
    if (filter === 'alerts') return it.status === 'tension' || it.status === 'warn';
    return it.status === filter;
  });

  const orderedVisible = selectedKey
    ? [...visibleItems].sort((a, b) => (itemKey(a) === selectedKey ? -1 : itemKey(b) === selectedKey ? 1 : 0))
    : visibleItems;

  const toggleFilter = (mode: FilterMode) => {
    setSelectedKey(null);
    setFilter((cur) => (cur === mode ? 'all' : mode));
  };

  const selectCell = (item: CrossCheckItem) => {
    const k = itemKey(item);
    setSelectedKey((cur) => (cur === k ? null : k));
    if (item.focusRange) jumpToRange(item.focusRange);
  };

  const sealCols: Column<(typeof report.sealSamples)[number]>[] = [
    { key: 'label', header: 'Muestra', render: (r) => <span className="mono">{r.label}</span> },
    { key: 'depth', header: 'Prof. (m)', align: 'num', render: (r) => f1(r.depthM) },
    { key: 'zone', header: 'Zona', render: (r) => (r.zoneName ? `${r.zoneName}${r.isSeal ? ' (sello)' : ''}` : r.isSeal ? 'Sello' : 'Reservorio') },
    { key: 'pd', header: 'Pd Hg (psi)', align: 'num', render: (r) => f1(r.pdLabPsi) },
    { key: 'hmax', header: 'h_max (m)', align: 'num', render: (r) => f1(r.hMaxM) },
  ];

  const sa = report.sealAssumptions;

  return (
    <div className="xchk" data-testid="cross-check-panel">
      <div className="xchk-header">
        <div className="xchk-summary" role="group" aria-label="Resumen del semáforo">
          <Badge tone={STATUS_TONE[report.overallStatus]} icon="check" data-testid="xchk-overall">
            Estado: {CROSS_CHECK_STATUS_LABEL[report.overallStatus]}
          </Badge>
          {(['tension', 'warn', 'ok', 'unsupported'] as const).map((st) => (
            <button
              key={st}
              type="button"
              className={`xchk-kpi${filter === st && !selectedKey ? ' is-active' : ''}`}
              aria-pressed={filter === st && !selectedKey}
              onClick={() => toggleFilter(st)}
              data-testid={`xchk-filter-${st}`}
            >
              <StatusDot tone={STATUS_TONE[st]} label={CROSS_CHECK_STATUS_LABEL[st]} nativeTitle={false} />
              <span>{CROSS_CHECK_STATUS_LABEL[st]}</span>
              <span className="num">{report.counts[st]}</span>
            </button>
          ))}
          <button
            type="button"
            className={`xchk-kpi${filter === 'alerts' && !selectedKey ? ' is-active' : ''}`}
            aria-pressed={filter === 'alerts' && !selectedKey}
            onClick={() => {
              setSelectedKey(null);
              setFilter('alerts');
            }}
          >
            Solo alertas
          </button>
          <button
            type="button"
            className={`xchk-kpi${filter === 'all' && !selectedKey ? ' is-active' : ''}`}
            aria-pressed={filter === 'all' && !selectedKey}
            onClick={() => {
              setSelectedKey(null);
              setFilter('all');
            }}
          >
            Todos
          </button>
        </div>
      </div>

      <p className="xchk-disclaimer">
        Auditoría de solo lectura entre mediciones independientes. Los umbrales son criterios operativos de revisión (ADR 0092), no leyes universales; ningún ensayo faltante se oculta. Clic en una celda para saltar al tramo crítico en el perfil y ver su diagnóstico.
      </p>

      {!hasCurrentResult && (
        <Callout tone="info">
          Todavía no hay una corrida vigente del motor para este pozo: los chequeos que requieren curvas calculadas aparecen sin soporte hasta completar el cálculo.
        </Callout>
      )}

      <div className="xchk-matrix-wrap">
        <table className="xchk-matrix" data-testid="xchk-matrix">
          <thead>
            <tr>
              <th>Zona</th>
              {ZONE_CHECK_IDS.map((id) => (
                <th key={id} title={CROSS_CHECK_META[id].subtitle}>
                  {CROSS_CHECK_META[id].shortTitle}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.zones.map((z) => (
              <tr key={z.zoneId} data-testid={`xchk-row-${z.zoneName}`}>
                <td>
                  <button
                    type="button"
                    className="xchk-zone-btn"
                    title={`Centrar visor en ${z.zoneName} (${f1(z.top)}–${f1(z.base)} m)`}
                    onClick={() => jumpToRange([z.top, z.base])}
                  >
                    <StatusDot tone={STATUS_TONE[z.worstStatus]} label={`${z.zoneName}: ${CROSS_CHECK_STATUS_LABEL[z.worstStatus]}`} nativeTitle={false} />
                    <span>{z.zoneName}</span>
                    {z.zoneKind === 'seal' && <span className="xchk-zone-kind">sello</span>}
                  </button>
                </td>
                {ZONE_CHECK_IDS.map((id) => {
                  const item = z.checks[id];
                  const k = itemKey(item);
                  const isSel = selectedKey === k;
                  return (
                    <td key={id}>
                      <button
                        type="button"
                        className={`xchk-cell-btn is-${item.status}${isSel ? ' is-selected' : ''}`}
                        title={`${CROSS_CHECK_META[id].title} · ${CROSS_CHECK_STATUS_LABEL[item.status]}: ${item.detail}`}
                        aria-pressed={isSel}
                        onClick={() => selectCell(item)}
                        data-testid={`xchk-cell-${z.zoneName}-${id}`}
                      >
                        <StatusDot tone={STATUS_TONE[item.status]} label={CROSS_CHECK_STATUS_LABEL[item.status]} nativeTitle={false} />
                        <span className="xchk-cell-text num">{item.headline}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="xchk-seal" aria-label="Capacidad de sello contra columna" data-testid="xchk-seal-card">
        <div className="xchk-seal__head">
          <span className="xchk-seal__title">
            <StatusDot tone={STATUS_TONE[report.seal.status]} label={CROSS_CHECK_STATUS_LABEL[report.seal.status]} />
            <span>{CROSS_CHECK_META['seal-capacity'].title}</span>
            <Badge tone={STATUS_TONE[report.seal.status]}>{CROSS_CHECK_STATUS_LABEL[report.seal.status]}</Badge>
            <span className="num">{report.seal.headline}</span>
          </span>
          <div className="xchk-item__actions">
            {report.seal.focusRange && (
              <Button size="sm" variant="ghost" icon="eye" onClick={() => jumpToRange(report.seal.focusRange)}>
                Ver muestra en perfil
              </Button>
            )}
            {report.seal.action && (
              <Button size="sm" variant="secondary" icon="activity" onClick={() => openTarget(report.seal.action)}>
                {report.seal.action.label}
              </Button>
            )}
          </div>
        </div>
        <p className="xchk-item__detail">{report.seal.detail}</p>
        <div className="xchk-seal__assumptions">
          <span>Sistema MICP: {sa.systemLabel}</span>
          <span className="num">σ = {f1(sa.sigmaDynPerCm)} dyn/cm</span>
          <span className="num">θ = {f1(sa.thetaDeg)}°</span>
          <span className="num">Δρ = {f2(sa.deltaRhoGcc)} g/cm³</span>
          <span className="num">
            (ρw {f2(sa.rhoWaterGcc)} · ρhc {f2(sa.rhoHcGcc)})
          </span>
        </div>
        {report.sealSamples.length > 0 && (
          <DataTable
            dense
            columns={sealCols}
            rows={report.sealSamples.slice(0, 5)}
            rowKey={(r) => r.id}
            caption="Muestras con mayor presión de desplazamiento Pd"
            onRowClick={(r) => {
              if (Number.isFinite(r.depthM)) jumpToRange([r.depthM - 10, r.depthM + 10]);
            }}
          />
        )}
      </section>

      <Section
        title={selectedKey ? 'Detalle seleccionado y hallazgos' : filter === 'alerts' ? 'Alertas y tensiones detectadas' : 'Detalle de chequeos'}
        defaultOpen
      >
        {orderedVisible.length === 0 ? (
          <p className="xchk-disclaimer">
            No hay chequeos en esta categoría. Elegí «Todos» o hacé clic en cualquier celda de la matriz para inspeccionar su detalle.
          </p>
        ) : (
          <div className="xchk-list" data-testid="xchk-list">
            {orderedVisible.map((item) => {
              const k = itemKey(item);
              const isSel = selectedKey === k;
              return (
                <article
                  key={k}
                  className={`xchk-item xchk-item--${item.status}${isSel ? ' is-selected' : ''}`}
                  data-testid={`xchk-item-${item.zoneName}-${item.id}`}
                >
                  <div className="xchk-item__top">
                    <span className="xchk-item__who">
                      <StatusDot tone={STATUS_TONE[item.status]} label={CROSS_CHECK_STATUS_LABEL[item.status]} nativeTitle={false} />
                      <Badge tone={STATUS_TONE[item.status]}>{CROSS_CHECK_STATUS_LABEL[item.status]}</Badge>
                      <span>{zoneHeading(item.zoneName)}</span>
                      <span>·</span>
                      <span>{CROSS_CHECK_META[item.id].title}</span>
                      <span className="num">({item.headline})</span>
                    </span>
                    <div className="xchk-item__actions">
                      {item.focusRange && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="eye"
                          onClick={() => jumpToRange(item.focusRange)}
                          title={`Saltar en el visor a ${f1(item.focusRange[0])}–${f1(item.focusRange[1])} m`}
                        >
                          Ver tramo
                        </Button>
                      )}
                      {item.action && (
                        <Button size="sm" variant="secondary" icon="sliders" onClick={() => openTarget(item.action)}>
                          {item.action.label}
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="xchk-item__detail">{item.detail}</p>
                </article>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

export const dockPanels: DockPanelDef[] = [
  {
    id: CROSS_CHECK_DOCK_ID,
    title: 'Coherencia',
    icon: 'check',
    component: CrossCheckPanel,
  },
];
