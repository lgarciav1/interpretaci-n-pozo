/**
 * Pestaña «Crossplot» del dock (docs/decisiones/0014): crossplot libre, módulo obligatorio del profesor. El gráfico y
 * sus controles están en `src/plots/crossplot/`; acá solo se conectan con los stores (configuración, cutoffs,
 * tendencias, cursor del visor). Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { commitParamCutoff, commitPlotConfig, PlotDockGate, usePlotConfig } from '../../app/plots/connect';
import { useViewer } from '../../app/store/viewer';
import { commitTrends } from '../../app/trends/actions';
import { useTrendsUi } from '../../app/trends/store';
import { makeId } from '../../core/state/project';
import { addTrend, removeTrend } from '../../core/state/trends';
import { nextTrendName } from '../../core/trends';
import { CrossplotPanel } from '../../plots/crossplot/CrossplotPanel';
import type { DockPanelDef } from '../../ui/dockPanel';

export const CROSSPLOT_DOCK_ID = 'crossplot';

function CrossplotDock() {
  const config = usePlotConfig('crossplot');
  const cursorDepth = useViewer((s) => s.cursorDepth);
  return (
    <PlotDockGate id={CROSSPLOT_DOCK_ID} icon="scatter">
      {(ctx) =>
        config && (
          <CrossplotPanel
            ctx={ctx}
            config={config}
            cursorDepth={cursorDepth}
            onChange={(patch, label) => commitPlotConfig('crossplot', patch, label)}
            onParamCutoff={commitParamCutoff}
            onShowDepth={(d) => useTrendsUi.getState().requestRange(d - 15, d + 15)}
            onAddTrend={(spec) => {
              const id = makeId('tend');
              commitTrends('Agregar tendencia al crossplot', (p, w) => {
                const name = nextTrendName(p.wells.find((e) => e.well.id === w)?.interpretation.trends ?? [], spec.name);
                return addTrend(p, w, { ...spec, id, name });
              });
              useTrendsUi.getState().set({ selectedId: id });
            }}
            onRemoveTrend={(id) => commitTrends('Borrar tendencia del crossplot', (p, w) => removeTrend(p, w, id))}
          />
        )
      }
    </PlotDockGate>
  );
}

export const dockPanels: DockPanelDef[] = [{ id: CROSSPLOT_DOCK_ID, title: 'Crossplot', icon: 'scatter', component: CrossplotDock }];
