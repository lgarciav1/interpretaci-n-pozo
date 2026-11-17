/**
 * Autoguardado del proyecto en IndexedDB (docs/decisiones/0071). `installAutosave()` se llama una vez en el arranque:
 * abre la base (si el navegador la da), escucha los cambios del proyecto por referencia (nada de esto entra en el
 * store del proyecto ni en el historial), publica el estado para la interfaz y pide confirmación al cerrar si el
 * proyecto no está a salvo. Nunca tira: si algo falla, la app sigue sin autoguardado.
 */
import { toast } from '../../ui';
import { autosaveFiles } from '../projectFiles';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import type { Project } from '../../core/state/project';
import { AutosaveSession } from './session';
import { openStorage } from './storage';
import { useAutosave } from './store';
import { RESTORE_SESSION_LABEL } from '../flow/stopwatch';

let session: AutosaveSession | null = null;

/** Sesión instalada (null antes de `installAutosave` o si falló). */
export function autosave(): AutosaveSession | null {
  return session;
}

export async function installAutosave(): Promise<void> {
  if (session) return;
  try {
    const s = new AutosaveSession({
      storage: null,
      files: autosaveFiles,
      getProject: () => useProject.getState().project,
      isDragging: () => useViewer.getState().dragging,
      applyRestored: (project: Project) => {
        useProject.getState().replace(project, RESTORE_SESSION_LABEL);
        useUi.getState().set({ activeStepId: null, activeModuleId: null, editingZoneId: null });
      },
      notify: (n) => toast({ title: n.title, description: n.description, tone: n.tone }),
      onChange: (snap) => useAutosave.setState(snap),
    });
    session = s;
    useProject.subscribe((state, prev) => {
      if (state.project !== prev.project) s.projectChanged(state.project);
    });
    window.addEventListener('beforeunload', (e) => {
      if (!s.isProjectSafe()) {
        e.preventDefault();
        // Navegadores viejos: hace falta asignar `returnValue` para que pregunten.
        e.returnValue = '';
      }
    });
    useAutosave.setState(s.snapshot());
    // La base se abre después: el arranque no espera a IndexedDB. Sin base, la barra dice «Sin autoguardado».
    const storage = await openStorage();
    if (storage) await s.attachStorage(storage);
    else s.storageUnavailable();
  } catch (err) {
    console.warn('Autoguardado: no se pudo iniciar', err);
  }
}

/** «Guardar proyecto» terminó con ese proyecto. */
export function notifySavedToFile(project: Project): void {
  session?.savedToFile(project);
}

/** Se va a publicar un proyecto abierto desde un archivo: sesión de trabajo nueva. */
export function notifyOpenedFromFile(project: Project): void {
  session?.openedFromFile(project);
}

export { useAutosave, formatAgo, formatClock, sessionTitle } from './store';
