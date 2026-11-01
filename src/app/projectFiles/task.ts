/** Frontera de archivos: sin stores. Publicar el proyecto queda a cargo del llamador tras validar todo. */
import type { Project } from '../../core/state/project';
import { deserializeProject, serializeProject } from '../../core/state/serialize';
export type ProjectFileTask = { kind: 'save'; project: Project } | { kind: 'open'; text: string };
export type ProjectFileResult = { kind: 'save'; text: string } | { kind: 'open'; project: Project; warnings: string[] };
export type ProjectFileResponse = { ok: true; result: ProjectFileResult } | { ok: false; error: string };
export async function runProjectFileTask(task: ProjectFileTask): Promise<ProjectFileResult> {
  if (task.kind === 'save') return { kind: 'save', text: await serializeProject(task.project) };
  if (task.kind !== 'open') throw new Error('Operación de archivo desconocida.');
  const warnings: string[] = [];
  const project = await deserializeProject(task.text, { onWarning: (m) => warnings.push(m) });
  return { kind: 'open', project, warnings };
}
