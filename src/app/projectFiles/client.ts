/** Una sola tarea de persistencia a la vez; no se transfieren buffers del proyecto activo. */
import { freezeRevisionMetadata } from '../../core/state/archive/projectV7';
import { ProjectFileContentError, runProjectFileTask, type ProjectFileTask, type ProjectFileResult, type ProjectFileResponse } from './task';
export interface FileWorker {
  onmessage: ((event: { data: ProjectFileResponse }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?(): void }) => void) | null;
  postMessage(data: ProjectFileTask): void;
  terminate(): void;
}
export class ProjectFileClient {
  private busy = false;
  constructor(private readonly createWorker: () => FileWorker | null, private readonly timeoutMs = 120000) {}
  async run(task: ProjectFileTask): Promise<ProjectFileResult> {
    if (this.busy) throw new Error('Ya se está guardando o abriendo un proyecto. Esperá a que termine.');
    this.busy = true;
    let worker: FileWorker | null = null;
    try {
      try { worker = this.createWorker(); } catch { /* Worker no disponible: alternativa offline en proceso. */ }
      if (!worker) {
        try {
          return await runProjectFileTask(task);
        } catch (err) {
          throw new ProjectFileContentError(err instanceof Error ? err.message : String(err));
        }
      }
      const port = worker;
      return await new Promise<ProjectFileResult>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('La operación de archivo tardó demasiado; el proyecto activo no se modificó.')); }, this.timeoutMs);
        port.onmessage = ({ data }) => {
          clearTimeout(timer);
          try {
            if (data?.ok === false) throw data.infra ? new Error(data.error) : new ProjectFileContentError(data.error);
            if (data?.ok !== true || data.result?.kind !== task.kind) throw new Error('Respuesta de archivo inválida.');
            const result = data.result;
            if (result.kind === 'save' && typeof result.text !== 'string') throw new Error('Respuesta de guardado inválida.');
            if (result.kind === 'open') {
              if (!result.project || !Array.isArray(result.warnings) || result.warnings.some((m) => typeof m !== 'string')) throw new Error('Respuesta de apertura inválida.');
              freezeRevisionMetadata(result.project.inputRevisions);
            }
            if (result.kind === 'recover') {
              const issuesOk = Array.isArray(result.issues) && result.issues.every((i) => i && typeof i.where === 'string' && typeof i.message === 'string');
              if (!issuesOk || (result.project !== null && (typeof result.project !== 'object' || !Array.isArray(result.project.wells)))) throw new Error('Respuesta de recuperación inválida.');
              if (result.project) freezeRevisionMetadata(result.project.inputRevisions);
            }
            resolve(result);
          } catch (err) { reject(err); }
        };
        port.onerror = (event) => { clearTimeout(timer); event.preventDefault?.(); reject(new Error(event.message || 'No se pudo procesar el archivo.')); };
        try { port.postMessage(task); } catch (err) { clearTimeout(timer); reject(err); }
      });
    } finally { worker?.terminate(); this.busy = false; }
  }
}
