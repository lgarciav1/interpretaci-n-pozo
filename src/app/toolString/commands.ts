/**
 * Atajos de la sarta de perfilaje en la paleta de comandos (Ctrl/Cmd+K, buscar «sarta»; docs/decisiones/0032 y 0033):
 * abrir la pantalla de la sarta (lista + vista 3D), prender y apagar herramientas, planificar y volver al modo datos.
 * Cada acción sobre la sarta es un `commit` (se deshace con Ctrl+Z).
 */
import { activeWellEntry } from '../../core/state/project';
import { addPlannedTool, removePlannedTool, resetToolString, setToolOn, setToolStringMode, startPlanning } from '../../core/state/toolString';
import { isDefaultToolString } from '../../core/toolString';
import { registry } from '../../modules';
import type { Command, CommandSource } from '../../ui';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { toolStringView } from './select';

const GROUP = 'Sarta';
const KEYWORDS = ['sarta', 'herramienta', 'perfilaje', 'tool string'];

export const commands: CommandSource = () => {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) return [];
  const wellId = entry.well.id;
  const commit = useProject.getState().commit;
  const { resolved } = toolStringView(entry.well, entry.interpretation);
  const planning = resolved.mode === 'planning';
  const open = useUi.getState().toolStringOpen;
  const out: Command[] = [
    {
      id: 'tool-string:open',
      title: open ? 'Cerrar la sarta y volver al perfil' : 'Abrir la sarta (lista y vista 3D)',
      group: GROUP,
      keywords: [...KEYWORDS, '3d', 'profundidad de investigacion', 'ficha'],
      run: () => useUi.getState().set({ toolStringOpen: !useUi.getState().toolStringOpen }),
    },
  ];
  out.push(...resolved.entries.map((e): Command => ({
    id: `tool-string:toggle:${e.tool.id}`,
    title: `${e.on ? 'Apagar' : 'Prender'} ${e.tool.name} en la sarta`,
    group: GROUP,
    keywords: [...KEYWORDS, e.tool.short, ...e.tool.roles],
    detail: e.on ? (e.hasData ? 'prendida' : 'prendida, sin datos') : 'apagada',
    run: () => commit(`${e.on ? 'Apagar' : 'Prender'} ${e.tool.name}`, (p) => setToolOn(p, wellId, e.tool.id, !e.on)),
  })));
  if (planning) {
    const inPlan = new Set(resolved.entries.map((e) => e.tool.id));
    for (const t of registry.tools.all()) {
      out.push(
        inPlan.has(t.id)
          ? {
              id: `tool-string:remove:${t.id}`,
              title: `Quitar ${t.name} de la sarta planificada`,
              group: GROUP,
              keywords: [...KEYWORDS, 'planificar', t.short],
              run: () => commit(`Quitar ${t.name} de la sarta`, (p) => removePlannedTool(p, wellId, t.id)),
            }
          : {
              id: `tool-string:add:${t.id}`,
              title: `Agregar ${t.name} a la sarta planificada`,
              group: GROUP,
              keywords: [...KEYWORDS, 'planificar', t.short, ...t.roles],
              run: () => commit(`Agregar ${t.name} a la sarta`, (p) => addPlannedTool(p, wellId, t.id)),
            },
      );
    }
    out.push({
      id: 'tool-string:mode-data',
      title: 'Volver a la sarta de los datos',
      group: GROUP,
      keywords: [...KEYWORDS, 'modo datos'],
      run: () => commit('Volver a la sarta de los datos', (p) => setToolStringMode(p, wellId, 'data')),
    });
  } else {
    out.push(
      {
        id: 'tool-string:plan-from-data',
        title: 'Planificar la sarta desde la de los datos',
        group: GROUP,
        keywords: [...KEYWORDS, 'planificacion', 'modo'],
        run: () => commit('Planificar la sarta', (p) => startPlanning(p, wellId, 'data', registry.tools)),
      },
      {
        id: 'tool-string:plan-empty',
        title: 'Planificar una sarta desde cero',
        group: GROUP,
        keywords: [...KEYWORDS, 'planificacion', 'vacia'],
        run: () => commit('Planificar una sarta desde cero', (p) => startPlanning(p, wellId, 'empty', registry.tools)),
      },
    );
  }
  out.push({
    id: 'tool-string:reset',
    title: 'Restablecer la sarta (todas las herramientas de los datos prendidas)',
    group: GROUP,
    keywords: [...KEYWORDS, 'restablecer'],
    enabled: () => !isDefaultToolString(activeWellEntry(useProject.getState().project)?.interpretation.toolString),
    run: () => commit('Restablecer la sarta', (p) => resetToolString(p, wellId)),
  });
  return out;
};
