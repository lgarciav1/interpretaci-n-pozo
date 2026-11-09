/**
 * Barra superior: marca, proyecto y pozo, espacio de trabajo, estado del motor, acciones agrupadas y preferencias
 * (tamaño de interfaz y tema, en un menú). Si no entra (ventana angosta o tamaño Grande), se compacta por etapas con consultas de
 * contenedor en `em` (shell.css): el umbral sigue al tamaño del texto.
 */
import { useRef, useState } from 'react';
import { WORKSPACES, type WorkspaceId } from '../../core/workspaces';
import { BrandMark, Button, Icon, IconButton, IS_MAC_PLATFORM, Menu, openCommandPalette, Popover, SegmentedControl, Spinner, StatusDot, ThemeToggle, Tooltip, UiScaleToggle, formatNumber } from '../../ui';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { IS_MAC, REDO_SHORTCUT, UNDO_SHORTCUT, redoChange, undoChange } from './historyActions';
import { openProjectFile, saveProject } from './projectActions';
import { openEquations } from '../ecuaciones/open';
import { openHome } from '../home/actions';

const WORKSPACE_ICON: Record<WorkspaceId, 'sliders' | 'mountain'> = { petrophysics: 'sliders', geology: 'mountain' };

function EngineStatus() {
  const { busy, error, result, mode } = useResults();
  const where = mode === 'worker' ? 'en un Web Worker' : mode === 'in-process' ? 'en el hilo principal (sin worker)' : '';
  const label = error ? 'Error del motor' : busy ? 'Calculando…' : result ? `Listo · ${formatNumber(result.stats.ms, { digits: result.stats.ms < 10 ? 1 : 0 })} ms` : 'Motor listo';
  return (
    <Tooltip content={error ?? `Motor de cálculo ${where}. Clic para ver el detalle.`} placement="bottom">
      <button
        type="button"
        className="shell-engine"
        data-testid="engine-status"
        onClick={() => {
          useUi.getState().openPanel('engine');
        }}
      >
        {busy ? <Spinner size={12} /> : <StatusDot tone={error ? 'error' : 'ok'} label={error ? 'Con error' : 'Listo'} />}
        <span className="num shell-engine__label">{label}</span>
      </button>
    </Tooltip>
  );
}

/** Deshacer y rehacer: qué cambio deshace cada uno en el tooltip, deshabilitados sin nada que hacer. */
function HistoryButtons() {
  const undoLabel = useProject((s) => s.undoLabel);
  const redoLabel = useProject((s) => s.redoLabel);
  return (
    <div className="shell-history" role="group" aria-label="Historial de cambios">
      <IconButton
        icon="undo"
        label={undoLabel ? `Deshacer: ${undoLabel}` : 'Nada para deshacer'}
        hint={UNDO_SHORTCUT}
        aria-keyshortcuts={IS_MAC ? 'Meta+Z' : 'Control+Z'}
        disabled={!undoLabel}
        onClick={undoChange}
        data-testid="undo"
      />
      <IconButton
        icon="redo"
        label={redoLabel ? `Rehacer: ${redoLabel}` : 'Nada para rehacer'}
        hint={REDO_SHORTCUT}
        aria-keyshortcuts={IS_MAC ? 'Meta+Shift+Z' : 'Control+Shift+Z Control+Y'}
        disabled={!redoLabel}
        onClick={redoChange}
        data-testid="redo"
      />
    </div>
  );
}

/**
 * Preferencias de este navegador (tamaño de interfaz y tema) detrás de un botón: se cambian una vez, no merecen siete
 * botones fijos en la barra (docs/decisiones/0069). El espacio lo gana el nombre del pozo.
 */
function Preferences() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={anchor} icon="settings" label="Preferencias: tamaño de interfaz y tema" aria-haspopup="dialog" aria-expanded={open} pressed={open} onClick={() => setOpen((o) => !o)} data-testid="prefs-open" />
      <Popover open={open} anchorRef={anchor} onClose={() => setOpen(false)} label="Preferencias" align="end" width={248} className="shell-prefs-pop">
        <div className="shell-prefs-pop__row">
          <span className="shell-prefs-pop__label">Tamaño</span>
          <UiScaleToggle />
        </div>
        <div className="shell-prefs-pop__row">
          <span className="shell-prefs-pop__label">Tema</span>
          <ThemeToggle />
        </div>
        <p className="shell-prefs-pop__note">Se guardan en este navegador, no en el proyecto.</p>
      </Popover>
    </>
  );
}

export function TopBar() {
  const workspace = useUi((s) => s.workspace);
  const readingMode = useUi((s) => s.readingMode);
  const editingLayout = useUi((s) => s.trackBuilder || s.toolStringOpen);
  const viewerDragging = useViewer((s) => s.dragging);
  const setUi = useUi((s) => s.set);
  const projectName = useProject((s) => s.project.name);
  const snapshotCount = useProject((s) => s.project.snapshots.filter((x) => x.wellId === s.project.activeWellId).length);
  const entry = useProject(selectActiveEntry);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="shell-topbar">
      <button type="button" className="shell-brand" onClick={openHome} aria-label="Inicio" title="Inicio: la sarta en 3D y la entrada al pozo (el trabajo queda como está)" data-testid="open-home">
        <BrandMark />
        <span className="shell-brand__name">fiubaLog</span>
        <span className="shell-brand__home">Inicio</span>
      </button>
      <nav className="shell-context" aria-label="Proyecto y pozo">
        <span className="shell-context__project" title="Proyecto">
          {projectName}
        </span>
        <Icon name="chevron-right" size={14} className="shell-context__sep" />
        <span className="shell-context__well" title="Pozo activo">
          <Icon name="well" size={14} />
          <span className="shell-context__well-name">{entry?.well.name ?? 'Sin pozo'}</span>
        </span>
      </nav>
      <div className="shell-workspace">
        <SegmentedControl<WorkspaceId>
          aria-label="Espacio de trabajo"
          value={workspace}
          onChange={(w) => setUi({ workspace: w, activeModuleId: null, activeStepId: null })}
          options={WORKSPACES.map((w) => ({ value: w.id, label: w.label, icon: WORKSPACE_ICON[w.id] }))}
        />
      </div>
      <span className="shell-spacer" />
      <EngineStatus />
      <HistoryButtons />
      <span className="shell-topbar__divider" aria-hidden="true" />
      <div className="shell-actions">
        <Button variant="primary" icon="upload" title="Cargar pozo" onClick={() => setUi({ loadDialog: {} })}>
          Cargar pozo
        </Button>
        <Button icon="bookmark" title="Snapshots" onClick={() => setUi({ snapshotsOpen: true })} disabled={!entry}>
          Snapshots
          {snapshotCount > 0 && <span className="shell-count num">{snapshotCount}</span>}
        </Button>
        <Button icon="download" title="Exportar" onClick={() => setUi({ exportOpen: true })} disabled={!entry} data-testid="export-open">
          Exportar
        </Button>
        <Menu
          aria-label="Proyecto"
          trigger={(p) => (
            <Button {...p} icon="folder" iconRight="chevron-down" title="Proyecto">
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
      <div className="shell-prefs">
        <IconButton
          icon={readingMode ? 'restore-view' : 'expand-view'}
          label={readingMode ? 'Volver a la disposición anterior' : 'Activar lectura amplia'}
          pressed={readingMode}
          variant={readingMode ? 'primary' : 'ghost'}
          disabled={!entry || editingLayout || viewerDragging}
          onClick={() => useUi.getState().toggleReadingMode()}
          data-testid="reading-mode-toggle"
        />
        <IconButton icon="sigma" label="Ecuaciones de los métodos" onClick={() => openEquations()} data-testid="equations-open" />
        <IconButton icon="search" label="Paleta de comandos" hint={IS_MAC_PLATFORM ? '⌘K' : 'Ctrl+K'} aria-keyshortcuts={IS_MAC_PLATFORM ? 'Meta+K' : 'Control+K'} onClick={openCommandPalette} data-testid="command-open" />
        <Preferences />
      </div>
    </header>
  );
}

