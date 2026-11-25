/**
 * Estado de interpretación de un pozo: todo lo que el usuario decide (zonas, parámetros, métodos elegidos).
 * Es JSON puro (sin typed arrays): se guarda en el proyecto, en los snapshots y se manda al worker en cada cambio.
 */
import { emptyParamState, type ParamState } from './params';
import type { PointSetDecisions } from './pointSets';
import type { ToolStringState } from './toolString';
import type { TrendSpec } from './trends';
import type { Zone } from './well';
import type { PreparationState } from './preparation/state';

/** Fuente elegida para un puerto: una curva medida del pozo o un módulo. */
export type SourceRef = { kind: 'curve'; curveId: string } | { kind: 'module'; moduleId: string };

export interface Interpretation {
  formulas?: readonly import('./formulas').CurveFormula[];
  /** Notas de lectura en MD; opcionales en proyectos anteriores, fuera del motor. */
  notes?: import('./notes').DepthNote[];
  /** Banderas discretas 0/1 creadas por el usuario desde una selección (0088); opcionales, fuera del motor. */
  userFlags?: readonly import('./userFlags').UserFlagDef[];
  preparation?: PreparationState;
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
  /**
   * Sarta de perfilaje del pozo (docs/decisiones/0032): modo, herramientas apagadas, orden y sarta planificada.
   * Ausente = modo «datos» sin nada apagado (proyectos anteriores a la fase 11). El motor la lee: las curvas de una
   * herramienta apagada (o fuera de la sarta planificada) no son candidatas de ningún puerto.
   */
  toolString?: ToolStringState;
  /**
   * Estado que un módulo guarda con la interpretación, por id de módulo (JSON puro: objetos, listas, textos, números
   * finitos, booleanos y null). Ausente = nada guardado (proyectos anteriores). Lo escribe la interfaz del módulo con
   * `setModuleState` (entra en deshacer, en los snapshots y en el archivo); el motor NO lo lee (`sameEngineInputs` no lo
   * compara). P. ej. los tramos elegidos como punzados sugeridos de `pay-intervals`.
   */
  moduleState?: Readonly<Record<string, JsonValue>>;
}

/** Valor JSON (lo que admite `Interpretation.moduleState`). */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** true si `v` es JSON puro (sin NaN/∞, sin funciones ni typed arrays, objetos planos). */
export function isJsonValue(v: unknown, depth = 0): v is JsonValue {
  if (depth > 32) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJsonValue(x, depth + 1));
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.values(v as object).every((x) => isJsonValue(x, depth + 1));
  return false;
}

/** `moduleState` leído de un archivo: lo que no es JSON puro se descarta con aviso (por módulo). */
export function sanitizeModuleState(raw: unknown, where: string, warn: (m: string) => void): Record<string, JsonValue> | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warn(`${where}: el estado de módulos no es un objeto; se descarta.`);
    return undefined;
  }
  const out: Record<string, JsonValue> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (isJsonValue(v)) out[id] = v;
    else warn(`${where}: el estado guardado del módulo '${id}' no es válido; se descarta.`);
  }
  return Object.keys(out).length ? out : undefined;
}

export function emptyInterpretation(zones: Zone[] = []): Interpretation {
  return { zones, params: emptyParamState(), sources: {}, compare: [], disabled: [], trends: [], pointSets: {} };
}

/**
 * true si dos interpretaciones tienen las mismas entradas del motor (zonas, parámetros, fuentes, comparar,
 * desactivados, sarta, preparación y fórmulas) por referencia: las recetas comparten estructura, así que un cambio que solo toca `trends` (u otro
 * campo que el motor no lee) da true y el puente no pide un cálculo.
 */
export function sameEngineInputs(a: Interpretation, b: Interpretation): boolean {
  return (
    a.zones === b.zones &&
    a.params === b.params &&
    a.sources === b.sources &&
    a.compare === b.compare &&
    a.disabled === b.disabled &&
    a.toolString === b.toolString && a.preparation === b.preparation && a.formulas === b.formulas
  );
}

export function sourceRefEquals(a: SourceRef | undefined, b: SourceRef | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'curve' && b.kind === 'curve') return a.curveId === b.curveId;
  if (a.kind === 'module' && b.kind === 'module') return a.moduleId === b.moduleId;
  return false;
}

