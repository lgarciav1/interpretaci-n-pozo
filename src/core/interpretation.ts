/**
 * Estado de interpretación de un pozo: todo lo que el usuario decide (zonas, parámetros, métodos elegidos).
 * Es JSON puro (sin typed arrays): se guarda en el proyecto, en los snapshots y se manda al worker en cada cambio.
 */
import { emptyParamState, type ParamState } from './params';
import type { PointSetDecisions } from './pointSets';
import type { TrendSpec } from './trends';
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
  /**
   * Líneas de tendencia del pozo (docs/decisiones/0008-tendencias-y-gradientes.md). No las usa el motor: la firma de
   * los módulos no las incluye y `sameEngineInputs` evita pedir un cálculo cuando solo cambiaron ellas.
   */
  trends: TrendSpec[];
  /**
   * Decisiones del usuario sobre los conjuntos de puntos del pozo (`Well.pointSets`), por id de conjunto: puntos
   * descartados o incluidos a mano, etiquetas (fluido), puesta en profundidad, ajustes del módulo. Docs: 0009.
   * Como las tendencias, el motor no las lee (`sameEngineInputs` no las compara).
   */
  pointSets: Record<string, PointSetDecisions>;
}

export function emptyInterpretation(zones: Zone[] = []): Interpretation {
  return { zones, params: emptyParamState(), sources: {}, compare: [], disabled: [], trends: [], pointSets: {} };
}

/**
 * true si dos interpretaciones tienen las mismas entradas del motor (zonas, parámetros, fuentes, comparar,
 * desactivados) por referencia: las recetas comparten estructura, así que un cambio que solo toca `trends` (u otro
 * campo que el motor no lee) da true y el puente no pide un cálculo.
 */
export function sameEngineInputs(a: Interpretation, b: Interpretation): boolean {
  return a.zones === b.zones && a.params === b.params && a.sources === b.sources && a.compare === b.compare && a.disabled === b.disabled;
}

export function sourceRefEquals(a: SourceRef | undefined, b: SourceRef | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'curve' && b.kind === 'curve') return a.curveId === b.curveId;
  if (a.kind === 'module' && b.kind === 'module') return a.moduleId === b.moduleId;
  return false;
}
