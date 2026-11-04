/**
 * Pestaña «Distribuciones» del dock (docs/decisiones/0066): boxplots por zona de una propiedad, comparando la
 * interpretación actual con snapshots del pozo y con otros pozos del proyecto. El gráfico y sus controles están en
 * `src/plots/distribution/`; acá solo se conectan con los stores. Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { useMemo } from 'react';
import { strToU8 } from 'fflate';
import { commitPlotConfig, PlotDockGate, usePlotConfig } from '../../app/plots/connect';
import { downloadFile } from '../../app/export/exportActions';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import { useTrendsUi } from '../../app/trends/store';
import { safeFileName } from '../../io/export';
import { CURRENT_SERIES, DistributionPanel, type DistributionSeriesItem } from '../../plots/distribution/DistributionPanel';
import type { DockPanelDef } from '../../ui/dockPanel';
import type { DistributionConfig } from '../../core/plots';
import type { SeriesContext } from '../../plots/trend/series';
import { seriesCandidates, useSeriesRuns, type SeriesCandidate } from './useSeries';

export const ZONE_DISTRIBUTION_DOCK_ID = 'zone-distribution';

/** Abre la pestaña (desde el Sumario o la paleta de comandos). */
export function openZoneDistribution(): void {
  useUi.getState().set({ dockTab: ZONE_DISTRIBUTION_DOCK_ID });
  useUi.getState().setLayout({ dockCollapsed: false });
}

const download = (name: string, text: string) => {
  const dot = name.lastIndexOf('.');
  const base = safeFileName(dot > 0 ? name.slice(0, dot) : name);
  // BOM: Excel abre el CSV en UTF-8 (acentos de los nombres de zona).
  downloadFile({ name: `${base}.csv`, mime: 'text/csv;charset=utf-8', bytes: strToU8('﻿' + text) });
};

function DistributionDock() {
  const config = usePlotConfig('distribution');
  const project = useProject((s) => s.project);
  const entry = useProject(selectActiveEntry);
  const candidates = useMemo(() => (entry ? seriesCandidates(project, entry).filter((c) => c.id !== CURRENT_SERIES) : []), [project, entry]);
  const chosen = useMemo(() => (config?.series ?? []).filter((id) => candidates.some((c) => c.id === id)), [config?.series, candidates]);
  return (
    <PlotDockGate id={ZONE_DISTRIBUTION_DOCK_ID} icon="boxplot">
      {(ctx) => config && entry && <Connected ctx={ctx} config={config} candidates={candidates} chosen={chosen} wellName={entry.well.name} />}
    </PlotDockGate>
  );
}

function Connected({ ctx, config, candidates, chosen, wellName }: { ctx: SeriesContext; config: DistributionConfig; candidates: SeriesCandidate[]; chosen: string[]; wellName: string }) {
  const project = useProject((s) => s.project);
  const entry = useProject(selectActiveEntry)!;
  const runs = useSeriesRuns(chosen, project, entry);
  const series = useMemo<DistributionSeriesItem[]>(
    () =>
      candidates.map((c) => {
        const r = runs.get(c.id);
        return {
          ...c,
          status: r?.status ?? 'idle',
          ...(r?.status === 'error' ? { message: r.message } : {}),
          ...(r?.status === 'ready' ? { ctx: r.ctx } : {}),
        };
      }),
    [candidates, runs],
  );
  return (
    <DistributionPanel
      ctx={ctx}
      wellName={wellName}
      config={config}
      series={series}
      onChange={(patch, label) => commitPlotConfig('distribution', patch, label)}
      onGoTo={(top, base) => useTrendsUi.getState().requestRange(top, base)}
      onDownload={download}
    />
  );
}

export const dockPanels: DockPanelDef[] = [{ id: ZONE_DISTRIBUTION_DOCK_ID, title: 'Distribuciones', icon: 'boxplot', component: DistributionDock }];
