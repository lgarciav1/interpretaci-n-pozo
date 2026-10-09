/**
 * Estado de interpretación de un pozo: todo lo que el usuario decide (zonas, parámetros, métodos elegidos).
 * Es JSON puro (sin typed arrays): se guarda en el proyecto, en los snapshots y se manda al worker en cada cambio.
 */
import { emptyParamState, type ParamState } from './params';
import type { Zone } from './well';

/** Fuente elegida para un puerto: una curva medida del pozo o un módulo. */
export type SourceRef = { kind: 'curve'; curveId: string } | { kind: 'module'; moduleId: string };

export interface Interpretation {
  zones: Zone[];
  params: ParamState;
  /**
   * Fuente elegida por puerto (rol de curva o id de escalar/tabla). Lo ausente usa la regla por defecto.
   * Una curva elegida explícitamente puede tener OTRO rol (p. ej. usar AT60 como RT): es intencional, el motor la
   * acepta si es de la misma magnitud (la convierte a la unidad del puerto) y emite un diagnóstico `info`.
   */
  sources: Record<string, SourceRef>;
  /** Módulos alternativos que se calculan para comparar, aunque no alimenten la cadena. */
  compare: string[];
  /** Módulos desactivados (no se calculan ni pueden ser fuente). */
  disabled: string[];
}

export function emptyInterpretation(zones: Zone[] = []): Interpretation {
  return { zones, params: emptyParamState(), sources: {}, compare: [], disabled: [] };
}

export function sourceRefEquals(a: SourceRef | undefined, b: SourceRef | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'curve' && b.kind === 'curve') return a.curveId === b.curveId;
  if (a.kind === 'module' && b.kind === 'module') return a.moduleId === b.moduleId;
  return false;
}
