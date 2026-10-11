/**
 * Acciones del crossplot libre para la paleta de comandos (docs/decisiones/0018): una por plantilla (densidad–neutrón,
 * Pickett, φ–Sw, GR–Rt). Aplican la misma receta que el menú «Plantilla» del panel (`crossplotTemplatePatch`) y abren
 * la pestaña. Se descubre solo (`src/modules/<id>/commands.ts`), como `dock.tsx`.
 */
import { computedCurves } from '../../app/computed';
import { commitPlotConfig } from '../../app/plots/connect';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { useUi } from '../../app/store/ui';
import { registry } from '../index';
import { crossplotTemplatePatch } from '../../plots/crossplot/applyTemplate';
import { CROSSPLOT_TEMPLATE_DEFS } from '../../plots/crossplot/templates';
import { toast, type Command, type CommandSource } from '../../ui';
import { CROSSPLOT_DOCK_ID } from './dock';

export const commands: CommandSource = () => {
  const hasWell = !!selectActiveEntry(useProject.getState());
  return CROSSPLOT_TEMPLATE_DEFS.map(
    (t): Command => ({
      id: `crossplot:template:${t.id}`,
      title: `Crossplot: plantilla ${t.label}`,
      group: 'Crossplot',
      keywords: ['grafico', 'cruzado', 'plantilla', t.description, t.id],
      icon: 'scatter',
      enabled: () => hasWell,
      run: () => {
        const entry = selectActiveEntry(useProject.getState());
        if (!entry) return;
        const ctx = { well: entry.well, interpretation: entry.interpretation, computed: computedCurves(useResults.getState().result, entry.well), catalog: registry.roles };
        const r = crossplotTemplatePatch(ctx, t.id);
        if (!r.ok) {
          toast({ tone: 'warn', title: r.title, description: r.description });
          return;
        }
        commitPlotConfig('crossplot', r.patch, r.label);
        useUi.getState().set({ dockTab: CROSSPLOT_DOCK_ID });
        useUi.getState().setLayout({ dockCollapsed: false });
      },
    }),
  );
};
