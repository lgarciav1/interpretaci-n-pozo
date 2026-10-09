/**
 * Columna derecha: el paso abierto del flujo guiado (estado, completar/saltar, siguiente) y su contenido:
 * carga, calidad, zonas o los módulos del paso con el panel del módulo activo.
 */
import type { ReactNode } from 'react';
import type { AnyModule } from '../../core/module';
import { portOf } from '../../core/module';
import { registry } from '../../modules';
import { Badge, Button, Callout, DataTable, EmptyState, IconButton, Menu, Spinner, StatusDot, formatNumber, type IconName, type MenuEntry, type Tone } from '../../ui';
import { BoreholeSummary, QcCounts, QcDot, QC_STATUS_LABEL } from '../components/Qc';
import { ModulePanelView } from '../components/ModulePanelView';
import { STEP_STATUS_LABEL, stepsOfModule, FLOWS, type StepState, type StepStatus } from '../flow/flow';
import { markStep, openStep, toFlowModule, useFlow, workspaceModules } from '../flow/useFlow';
import { selectActiveEntry, useProject } from '../store/project';
import { useWellQc } from '../store/qc';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';

/** Valor de `activeStepId` cuando se eligió un módulo que no pertenece a ningún paso. */
export const FREE_MODULE_VIEW = '@module';

const STATUS_TONE: Record<StepStatus, Tone> = { done: 'ok', partial: 'accent', todo: 'neutral', skipped: 'neutral', empty: 'neutral', locked: 'neutral' };
const STEP_ICON: Record<string, IconName> = {
  load: 'upload',
  qc: 'check-circle',
  zones: 'layers',
  shale: 'layers',
  porosity: 'droplet',
  rw: 'droplet',
  saturation: 'droplet',
  cutoffs: 'filter',
  summary: 'sigma',
  lithology: 'layers',
  geology: 'mountain',
};

const fmt = (v: number, d = 2) => formatNumber(v, { digits: d });

function ModulePicker() {
  const workspace = useUi((s) => s.workspace);
  const setUi = useUi((s) => s.set);
  const modules = workspaceModules(workspace);
  const items: MenuEntry[] = [];
  for (const c of registry.categories) {
    const inCat = modules.filter((m) => m.category === c.id);
    if (inCat.length === 0) continue;
    items.push({ type: 'label', id: `c-${c.id}`, label: c.label });
    for (const m of inCat) {
      items.push({
        id: m.id,
        label: m.name,
        onSelect: () => {
          const steps = stepsOfModule(FLOWS[workspace], toFlowModule(m));
          setUi({ activeModuleId: m.id, activeStepId: steps[0]?.id ?? FREE_MODULE_VIEW });
        },
      });
    }
  }
  if (items.length === 0) items.push({ id: 'none', label: 'No hay módulos en este espacio de trabajo', disabled: true, onSelect: () => {} });
  return (
    <span className="inspector-tools">
      <Menu aria-label="Todos los módulos" minWidth={260} trigger={(p) => <IconButton {...p} icon="sliders" label="Todos los módulos" size="sm" />} items={items} />
      <IconButton icon="panel-right" label="Ocultar columna" size="sm" onClick={() => useUi.getState().setLayout({ rightCollapsed: true })} />
    </span>
  );
}

function StepHeader({ state, next, total }: { state: StepState; next: StepState | null; total: number }) {
  const canMark = state.status !== 'locked' && !(state.status === 'done' && state.derived);
  const open = canMark && state.mark === null && state.def.kind !== 'load';
  // Calidad y los pasos sin módulos tienen su acción principal en el cuerpo: acá no se repite.
  const showDone = open && state.def.kind !== 'qc' && state.status !== 'empty';
  const showSkip = open && state.status !== 'empty';
  const showReopen = canMark && state.mark !== null;
  return (
    <header className="inspector-head">
      <div className="inspector-head__top">
        <span className="ui-overline">
          Paso {state.index + 1} de {total}
        </span>
        <Badge tone={STATUS_TONE[state.status]} variant={state.status === 'done' ? 'soft' : 'outline'}>
          {STEP_STATUS_LABEL[state.status]}
        </Badge>
        <span className="shell-spacer" />
        <ModulePicker />
      </div>
      <h2 className="inspector-head__title">{state.def.title}</h2>
      <p className="inspector-head__reason">{state.reason}</p>
      {(showDone || showSkip || showReopen || next) && (
        <div className="inspector-head__actions">
          {showDone && (
            <Button size="sm" icon="check" onClick={() => markStep(state.def.id, 'done')}>
              Marcar completo
            </Button>
          )}
          {showSkip && (
            <Button size="sm" variant="ghost" icon="skip" onClick={() => markStep(state.def.id, 'skipped')}>
              Saltar
            </Button>
          )}
          {showReopen && (
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => markStep(state.def.id, null)}>
              Reabrir paso
            </Button>
          )}
          {next && (
            <Button size="sm" variant="ghost" iconRight="arrow-right" className="inspector-head__next" onClick={() => openStep(next)}>
              {next.def.label}
            </Button>
          )}
        </div>
      )}
    </header>
  );
}

function LoadView() {
  const entry = useProject(selectActiveEntry);
  const setUi = useUi((s) => s.set);
  const actions = (
    <>
      <Button variant="primary" icon="upload" onClick={() => setUi({ loadDialog: {} })}>
        {entry ? 'Cargar otro pozo' : 'Cargar pozo'}
      </Button>
      <Button icon="table" onClick={() => setUi({ loadDialog: { source: 'tp' } })}>
        Usar datos del TP
      </Button>
    </>
  );
  if (!entry) {
    return (
      <EmptyState
        icon="upload"
        title="Empezá cargando un pozo"
        description="Excel (.xlsx), LAS 2.0 o CSV. El asistente reconoce las columnas por su nombre, convierte unidades y revisa la calidad."
        actions={actions}
      />
    );
  }
  const { well, interpretation } = entry;
  const d = well.depth.values;
  return (
    <div className="inspector-pad">
      <dl className="kv">
        <dt>Pozo</dt>
        <dd>{well.name}</dd>
        <dt>Profundidad</dt>
        <dd className="num">
          {fmt(d[0]!)} – {fmt(d[d.length - 1]!)} m
        </dd>
        <dt>Muestras</dt>
        <dd className="num">
          {d.length.toLocaleString('es-AR')}
          {well.depth.step ? ` · cada ${fmt(well.depth.step, 4)} m` : ''}
        </dd>
        <dt>Curvas</dt>
        <dd className="num">{well.curves.length}</dd>
        <dt>Zonas</dt>
        <dd className="num">{interpretation.zones.length}</dd>
      </dl>
      <div className="inspector-row">{actions}</div>
    </div>
  );
}

function QcView({ state }: { state: StepState }) {
  const entry = useProject(selectActiveEntry);
  const qc = useWellQc(entry?.well ?? null);
  const setUi = useUi((s) => s.set);
  if (!qc) {
    return (
      <div className="inspector-pad inspector-busy">
        <Spinner size={14} /> Analizando las curvas…
      </div>
    );
  }
  const issues = qc.curves.filter((c) => c.status !== 'ok').sort((a, b) => (a.status === b.status ? 0 : a.status === 'bad' ? -1 : 1));
  return (
    <div className="inspector-pad">
      <div className="qc-summary">
        <QcCounts report={qc} />
      </div>
      <BoreholeSummary report={qc} compact />
      {issues.length > 0 && (
        <div className="issue-list" role="list" aria-label="Curvas con observaciones">
          {issues.map((c) => (
            <div key={c.curveId} className="issue" role="listitem">
              <QcDot status={c.status} />
              <span className="mono issue__name">{c.mnemonic}</span>
              <span className="issue__text">{c.reasons.find((r) => r.severity === c.status)?.message ?? c.reasons[0]?.message ?? QC_STATUS_LABEL[c.status]}</span>
            </div>
          ))}
        </div>
      )}
      <div className="inspector-row">
        <Button icon="table" onClick={() => setUi({ qcReportOpen: true })}>
          Ver informe completo
        </Button>
        {state.status !== 'done' && (
          <Button variant="primary" icon="check" onClick={() => markStep('qc', 'done')}>
            Marcar como revisada
          </Button>
        )}
      </div>
    </div>
  );
}

function ZonesView() {
  const entry = useProject(selectActiveEntry);
  const editingZoneId = useUi((s) => s.editingZoneId);
  const setUi = useUi((s) => s.set);
  if (!entry) return null;
  const zones = entry.interpretation.zones;
  if (zones.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon="layers"
        title="El pozo no tiene zonas"
        description="Cargá un archivo con una columna de zona (p. ej. ZONA) o seguí sin zonas: los parámetros se aplican a todo el pozo."
      />
    );
  }
  return (
    <div className="inspector-pad">
      <DataTable
        dense
        rows={zones}
        rowKey={(z) => z.id}
        selectedKey={editingZoneId}
        onRowClick={(z) => setUi({ editingZoneId: z.id === editingZoneId ? null : z.id })}
        columns={[
          {
            key: 'name',
            header: 'Zona',
            render: (z) => (
              <span className="zone-name">
                <span className="zone-swatch" style={{ background: z.color }} />
                {z.name}
              </span>
            ),
          },
          { key: 'top', header: 'Tope (m)', align: 'num', render: (z) => fmt(z.top) },
          { key: 'base', header: 'Base (m)', align: 'num', render: (z) => fmt(z.base) },
          { key: 'h', header: 'Espesor', align: 'num', render: (z) => fmt(z.base - z.top, 1) },
        ]}
      />
      <Callout tone="neutral" icon="info">
        Elegí una zona para editar sus parámetros en los pasos siguientes. Marcar topes arrastrando sobre el perfil llega con el visor.
      </Callout>
    </div>
  );
}

function moduleStatus(m: AnyModule, nodes: ReturnType<typeof useResults.getState>['result']): { tone: Tone; text: string } {
  const n = nodes?.nodes.find((x) => x.moduleId === m.id);
  if (!n) return { tone: 'neutral', text: 'No corre' };
  if (n.status === 'ok') return { tone: 'ok', text: 'Calculado' };
  if (n.status === 'missing-input') return { tone: 'warn', text: 'Faltan entradas' };
  return { tone: 'error', text: n.status === 'error' ? 'Error' : 'Bloqueado' };
}

function ModulesView({ state }: { state: StepState }) {
  const activeModuleId = useUi((s) => s.activeModuleId);
  const setUi = useUi((s) => s.set);
  const result = useResults((s) => s.result);
  const modules = state.modules.map((id) => registry.get(id)!);
  if (modules.length === 0) {
    return (
      <EmptyState
        icon={STEP_ICON[state.def.id] ?? 'sliders'}
        title={`Todavía no hay métodos de ${state.def.label.toLowerCase()}`}
        description={
          <>
            {state.def.hint} Cuando se agregue un módulo de este paso va a aparecer acá solo.
          </>
        }
        actions={
          state.mark === null ? (
            <Button icon="skip" onClick={() => markStep(state.def.id, 'skipped')}>
              Saltar este paso
            </Button>
          ) : undefined
        }
      />
    );
  }
  const active = modules.find((m) => m.id === activeModuleId) ?? modules[0]!;
  return (
    <>
      {modules.length > 1 && (
      <div className="method-list" role="radiogroup" aria-label={`Módulos de ${state.def.label}`}>
        {modules.map((m) => {
          const st = moduleStatus(m, result);
          const ports = Object.values(m.outputs).map(portOf);
          const feeds = result?.outputs.some((o) => o.moduleId === m.id && o.active);
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === active.id}
              className="method"
              onClick={() => setUi({ activeModuleId: m.id })}
            >
              <StatusDot tone={st.tone} label={st.text} />
              <span className="method__body">
                <span className="method__name">{m.name}</span>
                <span className="method__ports mono">{ports.join(' · ')}</span>
              </span>
              {feeds === false && <Badge tone="neutral" variant="outline">alternativa</Badge>}
            </button>
          );
        })}
      </div>
      )}
      <ModulePanelView key={active.id} module={active} />
    </>
  );
}

function FreeModuleView() {
  const activeModuleId = useUi((s) => s.activeModuleId);
  const workspace = useUi((s) => s.workspace);
  const module = workspaceModules(workspace).find((m) => m.id === activeModuleId);
  return (
    <>
      <header className="inspector-head">
        <div className="inspector-head__top">
          <span className="ui-overline">Fuera del flujo guiado</span>
          <span className="shell-spacer" />
          <ModulePicker />
        </div>
        <h2 className="inspector-head__title">{module ? registry.categoryLabel(module.category) : 'Módulo'}</h2>
      </header>
      {module ? <ModulePanelView key={module.id} module={module} /> : <EmptyState size="sm" icon="sliders" title="Elegí un módulo" />}
    </>
  );
}

export function Inspector() {
  const { states, active } = useFlow();
  const free = useUi((s) => s.activeStepId === FREE_MODULE_VIEW);
  if (free) return <FreeModuleView />;
  const next = states.slice(active.index + 1).find((s) => s.status !== 'done') ?? null;
  let body: ReactNode;
  if (active.status === 'locked') {
    body = (
      <EmptyState
        icon="lock"
        title="Primero, un pozo"
        description="Este paso necesita un pozo cargado."
        actions={
          <Button variant="primary" icon="upload" onClick={() => useUi.getState().set({ loadDialog: {} })}>
            Cargar pozo
          </Button>
        }
      />
    );
  } else {
    switch (active.def.kind) {
      case 'load':
        body = <LoadView />;
        break;
      case 'qc':
        body = <QcView state={active} />;
        break;
      case 'zones':
        body = <ZonesView />;
        break;
      case 'modules':
        body = <ModulesView state={active} />;
        break;
    }
  }
  return (
    <>
      <StepHeader state={active} next={next} total={states.length} />
      <div className="inspector-body">{body}</div>
    </>
  );
}
