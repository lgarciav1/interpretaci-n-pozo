/** Frontera de archivos: sin stores. Publicar el proyecto queda a cargo del llamador tras validar todo. */
import type { Project } from '../../core/state/project';
import type { ArchiveIssue } from '../../core/state/archive/projectV7';
import { deserializeProject, recoverProject, serializeProject } from '../../core/state/serialize';
/** `recover`: recuperación explícita de un v7 que no abrió entero (autoguardado, docs/decisiones/0071). */
export type ProjectFileTask = { kind: 'save'; project: Project } | { kind: 'open'; text: string } | { kind: 'recover'; text: string };
export type ProjectFileResult =
  | { kind: 'save'; text: string }
  | { kind: 'open'; project: Project; warnings: string[] }
  | { kind: 'recover'; project: Project | null; issues: ArchiveIssue[] };
/** `infra`: el error no es del contenido del archivo (worker ocupado), así que no dice nada sobre el texto. */
export type ProjectFileResponse = { ok: true; result: ProjectFileResult } | { ok: false; error: string; infra?: boolean };

/**
 * Error que viene del contenido del archivo (no es JSON, no es un proyecto, v7 dañado, límites): lo tiró la tarea misma.
 * Los demás errores del cliente (worker ocupado o caído, tiempo agotado, respuesta mal formada) son de infraestructura
 * y no permiten concluir que el texto esté roto (el autoguardado no borra una sesión por ellos, docs/decisiones/0071).
 */
export class ProjectFileContentError extends Error {
  override readonly name = 'ProjectFileContentError';
}

export const isContentError = (err: unknown): boolean => err instanceof ProjectFileContentError || (err instanceof Error && err.name === 'ProjectFileContentError');
export async function runProjectFileTask(task: ProjectFileTask): Promise<ProjectFileResult> {
  if (task.kind === 'save') return { kind: 'save', text: await serializeProject(task.project) };
  if (task.kind === 'recover') return { kind: 'recover', ...(await recoverProject(task.text)) };
  if (task.kind !== 'open') throw new Error('Operación de archivo desconocida.');
  const warnings: string[] = [];
  const project = await deserializeProject(task.text, { onWarning: (m) => warnings.push(m) });
  return { kind: 'open', project, warnings };
}
