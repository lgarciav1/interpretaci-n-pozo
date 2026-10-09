/** Guardar y abrir proyecto (con avisos). Sin React: se llaman desde menús y atajos. */
import { deserializeProject, serializeProject } from '../../core/state/serialize';
import { toast } from '../../ui';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

export async function saveProject(): Promise<void> {
  const project = useProject.getState().project;
  try {
    const text = await serializeProject(project);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name || 'proyecto'}.pozo.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast({ title: 'Proyecto guardado', description: `${a.download} · ${(text.length / 1024).toLocaleString('es-AR', { maximumFractionDigits: 0 })} kB`, tone: 'ok' });
  } catch (err) {
    toast({ title: 'No se pudo guardar el proyecto', description: err instanceof Error ? err.message : String(err), tone: 'error' });
  }
}

export async function openProjectFile(file: File): Promise<void> {
  try {
    useProject.getState().replace(await deserializeProject(await file.text()));
    useUi.getState().set({ activeStepId: null, activeModuleId: null, editingZoneId: null });
    toast({ title: 'Proyecto abierto', description: file.name, tone: 'ok' });
  } catch (err) {
    toast({ title: 'No se pudo abrir el proyecto', description: err instanceof Error ? err.message : String(err), tone: 'error' });
  }
}
