/**
 * Barra superior: marca, proyecto y pozo, espacio de trabajo, estado del motor, acciones agrupadas y preferencias
 * (tamaño de interfaz y tema, en un menú). Si no entra (ventana angosta o tamaño Grande), se compacta por etapas con consultas de
 * contenedor en `em` (shell.css): el umbral sigue al tamaño del texto.
 */
import { useEffect, useRef, useState } from 'react';
import { WORKSPACES, type WorkspaceId } from '../../core/workspaces';
import { BrandMark, BrandName, Button, Icon, IconButton, IS_MAC_PLATFORM, Menu, openCommandPalette, Popover, SegmentedControl, Spinner, StatusDot, ThemeToggle, Tooltip, UiScaleToggle, formatNumber } from '../../ui';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { IS_MAC, REDO_SHORTCUT, UNDO_SHORTCUT, redoChange, undoChange } from './historyActions';
import { openProjectFile, saveProject } from './projectActions';
import { openEquations } from '../ecuaciones/open';
import { openHome } from '../home/actions';
import { formatAgo, formatClock, useAutosave } from '../autosave';

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

/** Reloj que avanza cada `ms` (para «Guardado hace N s»). */
function useNow(ms: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
  return now;
}

/**
 * Estado del autoguardado (docs/decisiones/0071, punto 8): cuenta el navegador y el archivo. Misma familia visual que
 * el estado del motor; en la barra compacta queda solo el punto (el texto sigue en el nombre accesible y el tooltip).
 */
function AutosaveStatus() {
  const { status, autoSavedAt, fileSafe, fileOrigin, autoSafe } = useAutosave();
  const now = useNow(5000, status === 'saved' && autoSavedAt !== null);
  if (status === 'empty') return null;
  const savedLabel = autoSafe && autoSavedAt !== null ? `Guardado ${formatAgo(autoSavedAt, now)}` : fileOrigin === 'saved' ? 'Guardado en archivo' : 'Sin cambios';
  const label = status === 'saving' ? 'Guardando…' : status === 'dirty' ? 'Cambios sin guardar' : status === 'unavailable' ? 'Sin autoguardado' : savedLabel;
  const inFile = fileSafe && fileOrigin !== 'boot';
  const file = inFile ? `Archivo .pozo.json: al día${fileOrigin === 'opened' ? ' (es el que se abrió)' : ''}.` : 'Archivo .pozo.json: no guardado (Proyecto › Guardar proyecto).';
  const browser =
    status === 'unavailable'
      ? 'Este navegador no permite guardar en IndexedDB: al cerrar la pestaña se pide confirmación.'
      : status === 'saving'
        ? 'Guardando en este navegador…'
        : autoSafe && autoSavedAt !== null
          ? `Autoguardado en este navegador a las ${formatClock(autoSavedAt)}.`
          : 'Se guarda en este navegador 3 s después del último cambio.';
  const tone = status === 'dirty' || (status === 'unavailable' && !inFile) ? 'warn' : status === 'unavailable' ? 'neutral' : 'ok';
  return (
    <Tooltip content={`${browser} ${file}`} placement="bottom">
      <span className="shell-autosave" role="img" tabIndex={0} aria-label={`${label}. ${browser} ${file}`} data-testid="autosave-status" data-status={status}>
        {status === 'saving' ? (
          <Spinner size={12} />
        ) : (
          <span className="shell-autosave__icon" aria-hidden="true">
            <Icon name="save" size={14} />
            <span className={`ui-dot ui-dot--${tone} shell-autosave__badge`} />
          </span>
        )}
        <span className="num shell-autosave__label" aria-hidden="true">
          {label}
        </span>
      </span>
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
        <BrandName className="shell-brand__name" />
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
      <AutosaveStatus />
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

