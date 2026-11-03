/**
 * Composición de demostración de Inicio sin pozo (docs/decisiones/0065): una triple combo típica armada con el
 * catálogo, para mostrar la pieza. No sale de ningún pozo y la pantalla lo dice; con un pozo activo, Inicio usa su sarta
 * con la misma derivación que el configurador (`useToolStringView`).
 */
import type { ToolStringEntry } from '../../core/toolString';
import type { ToolCatalog } from '../../core/tools';

/** Herramientas de la composición (el orden en la sarta sale de `typicalOrder`, como en una sarta derivada). */
export const DEMO_TOOL_IDS = ['gr', 'density', 'caliper', 'neutron', 'sonic', 'induction', 'sp'] as const;

/** Entradas «prendidas» de la composición, arriba → abajo. Sin curvas: no hay pozo. */
export function demoToolString(tools: ToolCatalog): ToolStringEntry[] {
  return DEMO_TOOL_IDS.map((id) => tools.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .sort((a, b) => a.typicalOrder - b.typicalOrder)
    .map((tool) => ({ tool, on: true, curveIds: [], roles: [...tool.roles], hasData: true }));
}
