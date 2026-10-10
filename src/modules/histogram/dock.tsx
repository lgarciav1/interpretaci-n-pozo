/**
 * Pestaña «Histograma» del dock (docs/decisiones/0014): módulo obligatorio del profesor. El gráfico y sus controles
 * están en `src/plots/histogram/`; acá solo se conectan con los stores. Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { commitParamCutoff, commitPlotConfig, PlotDockGate, usePlotConfig } from '../../app/plots/connect';
import { HistogramPanel } from '../../plots/histogram/HistogramPanel';
import type { DockPanelDef } from '../../ui/dockPanel';

export const HISTOGRAM_DOCK_ID = 'histogram';

function HistogramDock() {
  const config = usePlotConfig('histogram');
  return (
    <PlotDockGate id={HISTOGRAM_DOCK_ID} icon="histogram">
      {(ctx) => config && <HistogramPanel ctx={ctx} config={config} onChange={(patch, label) => commitPlotConfig('histogram', patch, label)} onParamCutoff={commitParamCutoff} />}
    </PlotDockGate>
  );
}

export const dockPanels: DockPanelDef[] = [{ id: HISTOGRAM_DOCK_ID, title: 'Histograma', icon: 'histogram', component: HistogramDock }];
