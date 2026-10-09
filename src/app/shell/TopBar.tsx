/** Barra superior: marca, proyecto y pozo, espacio de trabajo, estado del motor y acciones agrupadas. */
import { useRef } from 'react';
import { WORKSPACES, type WorkspaceId } from '../../core/workspaces';
import { BrandMark, Button, Icon, Menu, SegmentedControl, Spinner, StatusDot, ThemeToggle, Tooltip, formatNumber } from '../../ui';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { openProjectFile, saveProject } from './projectActions';

const WORKSPACE_ICON: Record<WorkspaceId, 'sliders' | 'mountain'> = { petrophysics: 'sliders', geology: 'mountain' };

function EngineStatus() {
  const { busy, error, result, mode } = useResults();
  const setUi = useUi((s) => s.set);
  const setLayout = useUi((s) => s.setLayout);
  const where = mode === 'worker' ? 'en un Web Worker' : mode === 'in-process' ? 'en el hilo principal (sin worker)' : '';
  const label = error ? 'Error del motor' : busy ? 'Calculando…' : result ? `Listo · ${formatNumber(result.stats.ms, { digits: result.stats.ms < 10 ? 1 : 0 })} ms` : 'Motor listo';
  return (
    <Tooltip content={error ?? `Motor de cálculo ${where}. Clic para ver el detalle.`} placement="bottom">
      <button
        type="button"
        className="shell-engine"
        data-testid="engine-status"
        onClick={() => {
          setUi({ dockTab: 'engine' });
          setLayout({ dockCollapsed: false });
        }}
      >
        {busy ? <Spinner size={12} /> : <StatusDot tone={error ? 'error' : 'ok'} label={error ? 'Con error' : 'Listo'} />}
        <span className="num">{label}</span>
      </button>
    </Tooltip>
  );
}

export function TopBar() {
  const workspace = useUi((s) => s.workspace);
  const setUi = useUi((s) => s.set);
  const projectName = useProject((s) => s.project.name);
  const snapshotCount = useProject((s) => s.project.snapshots.filter((x) => x.wellId === s.project.activeWellId).length);
  const entry = useProject(selectActiveEntry);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="shell-topbar">
      <div className="shell-brand">
        <BrandMark />
        <span className="shell-brand__name">Interpretación de pozo</span>
      </div>
      <nav className="shell-context" aria-label="Proyecto y pozo">
        <span className="shell-context__project" title="Proyecto">
          {projectName}
        </span>
        <Icon name="chevron-right" size={14} className="shell-context__sep" />
        <span className="shell-context__well" title="Pozo activo">
          <Icon name="well" size={14} />
          {entry?.well.name ?? 'Sin pozo'}
        </span>
      </nav>
      <SegmentedControl<WorkspaceId>
        aria-label="Espacio de trabajo"
        value={workspace}
        onChange={(w) => setUi({ workspace: w, activeModuleId: null, activeStepId: null })}
        options={WORKSPACES.map((w) => ({ value: w.id, label: w.label, icon: WORKSPACE_ICON[w.id] }))}
      />
      <span className="shell-spacer" />
      <EngineStatus />
      <div className="shell-actions">
        <Button variant="primary" icon="upload" onClick={() => setUi({ loadDialog: {} })}>
          Cargar pozo
        </Button>
        <Button icon="bookmark" onClick={() => setUi({ snapshotsOpen: true })} disabled={!entry}>
          Snapshots
          {snapshotCount > 0 && <span className="shell-count num">{snapshotCount}</span>}
        </Button>
        <Menu
          aria-label="Proyecto"
          trigger={(p) => (
            <Button {...p} icon="folder" iconRight="chevron-down">
              Proyecto
            </Button>
          )}
          items={[
            { id: 'save', label: 'Guardar proyecto', description: 'Descarga un archivo .pozo.json', icon: 'download', onSelect: () => void saveProject() },
            { id: 'open', label: 'Abrir proyecto…', description: 'Desde un archivo guardado', icon: 'folder', onSelect: () => fileRef.current?.click() },
          ]}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void openProjectFile(f);
          }}
        />
      </div>
      <span className="shell-topbar__divider" aria-hidden="true" />
      <ThemeToggle />
    </header>
  );
}
