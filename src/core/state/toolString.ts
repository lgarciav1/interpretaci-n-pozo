/**
 * Recetas puras de la sarta de perfilaje (docs/decisiones/0032-sarta-de-perfilaje.md). Se aplican con
 * `commit(etiqueta, receta)`, así que todo se puede deshacer. La sarta vive en `Interpretation.toolString`: cambiarla
 * recalcula el motor (las curvas apagadas dejan de ser candidatas) y entra en los snapshots.
 *
 * Un estado igual al de por defecto se borra (campo ausente): un proyecto que nunca tocó la sarta se guarda igual que
 * antes de la fase 11.
 */
import type { Interpretation } from '../interpretation';
import { isDefaultToolString, resolveToolString, toolStringOf, type ToolStringMode, type ToolStringState } from '../toolString';
import type { ToolCatalog } from '../tools';
import { getWellEntry, updateInterpretation, type Project } from './project';

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameState = (a: ToolStringState, b: ToolStringState) =>
  a.mode === b.mode && sameIds(a.off, b.off) && sameIds(a.order, b.order) && sameIds(a.plan, b.plan) && sameIds(a.planOff, b.planOff);

/** Aplica `fn` al estado de la sarta de un pozo. Sin cambios devuelve el mismo proyecto. */
function updateToolString(project: Project, wellId: string, fn: (s: ToolStringState) => ToolStringState): Project {
  return updateInterpretation(project, wellId, (i): Interpretation => {
    const prev = toolStringOf(i);
    const next = fn(prev);
    if (sameState(prev, next)) return i;
    const { toolString: _old, ...rest } = i;
    return isDefaultToolString(next) ? rest : { ...rest, toolString: next };
  });
}

/**
 * Prende o apaga una herramienta en la sarta del modo vigente: en datos cambia el cálculo; en planificación solo el
 * plan (`planOff`), así volver al modo datos no arrastra lo que se ensayó.
 */
export function setToolOn(project: Project, wellId: string, toolId: string, on: boolean): Project {
  return updateToolString(project, wellId, (s) => {
    const key = s.mode === 'planning' ? 'planOff' : 'off';
    const isOff = s[key].includes(toolId);
    if (isOff === !on) return s;
    return { ...s, [key]: on ? s[key].filter((id) => id !== toolId) : [...s[key], toolId] };
  });
}

/** Cambia de modo conservando la sarta planificada (volver a «datos» no la borra). */
export function setToolStringMode(project: Project, wellId: string, mode: ToolStringMode): Project {
  return updateToolString(project, wellId, (s) => (s.mode === mode ? s : { ...s, mode }));
}

/**
 * Pasa a planificación empezando de cero (`'empty'`) o desde la sarta de datos tal como se ve (`'data'`: mismas
 * herramientas y orden; las apagadas en los datos empiezan apagadas en el plan). Reemplaza el plan anterior.
 */
export function startPlanning(project: Project, wellId: string, from: 'data' | 'empty', tools: ToolCatalog): Project {
  const entry = getWellEntry(project, wellId);
  const current = toolStringOf(entry.interpretation);
  const entries = from === 'empty' ? [] : resolveToolString(entry.well.curves, { ...current, mode: 'data' }, tools).entries;
  const plan = entries.map((e) => e.tool.id);
  const planOff = entries.filter((e) => !e.on).map((e) => e.tool.id);
  return updateToolString(project, wellId, (s) => ({ ...s, mode: 'planning', plan, planOff }));
}

function requirePlanning(s: ToolStringState, what: string): void {
  if (s.mode !== 'planning') throw new Error(`${what}: solo se puede en modo planificación (en modo datos la sarta sale de las curvas).`);
}

/** Agrega una herramienta a la sarta planificada (prendida) en `index` (por defecto, abajo). Si ya está, la prende. */
export function addPlannedTool(project: Project, wellId: string, toolId: string, index?: number): Project {
  return updateToolString(project, wellId, (s) => {
    requirePlanning(s, 'Agregar una herramienta');
    const planOff = s.planOff.filter((id) => id !== toolId);
    if (s.plan.includes(toolId)) return { ...s, planOff };
    const plan = [...s.plan];
    plan.splice(index === undefined ? plan.length : Math.max(0, Math.min(plan.length, index)), 0, toolId);
    return { ...s, planOff, plan };
  });
}

/** Quita una herramienta de la sarta planificada. */
export function removePlannedTool(project: Project, wellId: string, toolId: string): Project {
  return updateToolString(project, wellId, (s) => {
    requirePlanning(s, 'Quitar una herramienta');
    return s.plan.includes(toolId) ? { ...s, plan: s.plan.filter((id) => id !== toolId), planOff: s.planOff.filter((id) => id !== toolId) } : s;
  });
}

/**
 * Mueve una herramienta a la posición `toIndex` de la sarta que se ve (arriba = 0). En modo datos guarda el orden
 * completo resultante; en planificación reordena la sarta planificada.
 */
export function moveTool(project: Project, wellId: string, toolId: string, toIndex: number, tools: ToolCatalog): Project {
  const entry = getWellEntry(project, wellId);
  const s = toolStringOf(entry.interpretation);
  const shown = s.mode === 'planning' ? s.plan.filter((id) => tools.has(id)) : resolveToolString(entry.well.curves, s, tools).entries.map((e) => e.tool.id);
  const from = shown.indexOf(toolId);
  if (from < 0) throw new Error(`La herramienta '${toolId}' no está en la sarta.`);
  const to = Math.max(0, Math.min(shown.length - 1, toIndex));
  if (from === to) return project;
  const next = [...shown];
  next.splice(from, 1);
  next.splice(to, 0, toolId);
  return updateToolString(project, wellId, (st) => {
    if (st.mode === 'data') return { ...st, order: next };
    // Las de la sarta planificada que la app no conoce (módulo quitado) quedan al final, para no perderlas.
    return { ...st, plan: [...next, ...st.plan.filter((id) => !tools.has(id))] };
  });
}

/** Vuelve a la sarta que sale de los datos: modo datos, nada apagado, orden típico, sin sarta planificada. */
export function resetToolString(project: Project, wellId: string): Project {
  return updateInterpretation(project, wellId, (i) => {
    if (!i.toolString) return i;
    const { toolString: _old, ...rest } = i;
    return rest;
  });
}
