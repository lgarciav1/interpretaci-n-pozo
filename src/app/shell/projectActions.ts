/** Guardar y abrir proyecto (con avisos). Sin React: se llaman desde menús y atajos. */
import { ARCHIVE_LIMITS } from '../../core/state/serialize';
import { projectFiles } from '../projectFiles';
import { notifyOpenedFromFile, notifySavedToFile } from '../autosave';
import { toast } from '../../ui';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

export async function saveProject(): Promise<void> {
  const project = useProject.getState().project;
  try {
    const result = await projectFiles.run({ kind: 'save', project });
    if (result.kind !== 'save') throw new Error('Respuesta de guardado inválida.');
    const text = result.text;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name || 'proyecto'}.pozo.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // Ese objeto quedó en un archivo: la barra lo cuenta como guardado mientras no cambie (docs/decisiones/0071).
    notifySavedToFile(project);
    toast({ title: 'Proyecto guardado', description: `${a.download} · ${(text.length / 1024).toLocaleString('es-AR', { maximumFractionDigits: 0 })} kB`, tone: 'ok' });
  } catch (err) {
    toast({ title: 'No se pudo guardar el proyecto', description: err instanceof Error ? err.message : String(err), tone: 'error' });
  }
}

export async function openProjectFile(file: File): Promise<void> {
  try {
    if (file.size > ARCHIVE_LIMITS.fileBytes) throw new Error('El proyecto supera el límite de tamaño de archivo.');
    const result = await projectFiles.run({ kind: 'open', text: await file.text() });
    if (result.kind !== 'open') throw new Error('Respuesta de apertura inválida.');
    const { warnings, project } = result;
    // Antes de publicarlo: sesión de trabajo nueva, para que el cambio no se guarde sobre la anterior.
    notifyOpenedFromFile(project);
    useProject.getState().replace(project);
    useUi.getState().set({ activeStepId: null, activeModuleId: null, editingZoneId: null });
    toast({ title: 'Proyecto abierto', description: file.name, tone: 'ok' });
    if (warnings.length) {
      console.warn(warnings.join('\n'));
      toast({ title: 'Avisos al abrir el proyecto', description: warnings.length === 1 ? warnings[0]! : `${warnings[0]} (y ${warnings.length - 1} más; detalle en la consola)`, tone: 'warn' });
    }
  } catch (err) {
    toast({ title: 'No se pudo abrir el proyecto', description: err instanceof Error ? err.message : String(err), tone: 'error' });
  }
}

/** Abre el selector de archivos del sistema para elegir un proyecto guardado (atajo y paleta de comandos). */
export function pickProjectFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void openProjectFile(f);
  };
  input.click();
}

