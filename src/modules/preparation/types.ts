/** Tipos compartidos por el panel y sus herramientas (0058). Puros. */
import type { Project } from '../../core/state/project';
import type { ToolId } from './pipeline';

/** Operación que propone una herramienta (la misma receta que guardaba el diálogo anterior). */
export type Operation = 'exclude' | 'interpolate' | 'filter' | 'shift' | 'normalize';

/**
 * Borrador de una herramienta: la receta pura que se previsualiza. `key` resume sus parámetros (si no cambia, no se
 * vuelve a calcular). `build` puede lanzar un Error en español: es el motivo que se muestra.
 */
export interface Draft {
  operation: Operation;
  key: string;
  build(project: Project): Project;
  /** Ids de nodo que deben tener cobertura (alineación de una corrida entera). */
  batchCurveIds?: readonly string[];
}

/** Lo que reporta una herramienta: un borrador listo, o por qué todavía no lo hay. */
export type DraftReport = { draft: Draft; reason?: undefined } | { draft: null; reason: string };

export interface DepthRange {
  top: number;
  base: number;
}

export const TOOL_OPERATION: Readonly<Record<ToolId, Operation>> = {
  exclude: 'exclude',
  suspects: 'exclude',
  interpolate: 'interpolate',
  filter: 'filter',
  shift: 'shift',
  normalize: 'normalize',
};
