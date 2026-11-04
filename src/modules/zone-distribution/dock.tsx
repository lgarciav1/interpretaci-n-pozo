/**
 * Pestaña «Distribuciones» del dock (docs/decisiones/0066): boxplots por zona de una propiedad, comparando la
 * interpretación actual con snapshots del pozo y con otros pozos del proyecto. El gráfico y sus controles están en
 * `src/plots/distribution/`; acá solo se conectan con los stores. Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { useMemo, useRef } from 'react';
import { strToU8 } from 'fflate';
import { commitParamCutoff, commitPlotConfig, PlotDockGate, usePlotConfig } from '../../app/plots/connect';
import { downloadFile } from '../../app/export/exportActions';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { useUi } from '../../app/store/ui';
import { useTrendsUi } from '../../app/trends/store';
import { safeFileName } from '../../io/export';
import { CURRENT_SERIES, DistributionPanel, type DistributionSeriesItem } from '../../plots/distribution/DistributionPanel';
import type { SummaryRow } from '../../plots/distribution/interact';
import type { DockPanelDef } from '../../ui/dockPanel';
import type { DistributionConfig } from '../../core/plots';
import type { TableValue } from '../../core/module';
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

/**
 * Mientras el motor recalcula, el puente deja el resultado en null (cada cambio de parámetro cambia la clave del
 * contexto): sin esto, las calculadas desaparecen un instante, la propiedad elegida (φe) deja de existir y el panel
 * salta a otra curva, desmontando la manija que se está arrastrando. Se sostiene el último contexto con resultado del
 * MISMO pozo y profundidad (con la interpretación nueva: los cutoffs vigentes), hasta que llega el resultado nuevo o
 * un error. No cambia ningún dato: solo evita el parpadeo.
 */
function useHeldContext(ctx: SeriesContext, wellId: string) {
  const result = useResults((s) => s.result);
  const error = useResults((s) => s.error);
  const held = useRef<{ ctx: SeriesContext; summary: readonly SummaryRow[] | null } | null>(null);
  const fresh = !!result && result.wellId === wellId;
  // Pay neto por zona: la tabla del sumario del último resultado del motor para ESTE pozo (se actualiza al recalcular).
  const summary = useMemo(() => {
    if (!fresh) return null;
    const out = result!.outputs.find((o) => o.moduleId === 'zone-summary' && o.port === 'ZONE_SUMMARY');
    return (out?.value as TableValue | undefined)?.rows ?? null;
  }, [result, fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  if (fresh) held.current = { ctx, summary };
  else if (error || (held.current && (held.current.ctx.well.id !== ctx.well.id || held.current.ctx.well.depth.values !== ctx.well.depth.values))) held.current = null;
  const hold = fresh ? null : held.current;
  const merged = useMemo(() => (!hold ? ctx : hold.ctx.interpretation === ctx.interpretation ? hold.ctx : { ...hold.ctx, interpretation: ctx.interpretation }), [hold?.ctx, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ctx: merged, summary: hold ? hold.summary : summary };
}

function Connected({ ctx: liveCtx, config, candidates, chosen, wellName }: { ctx: SeriesContext; config: DistributionConfig; candidates: SeriesCandidate[]; chosen: string[]; wellName: string }) {
  const project = useProject((s) => s.project);
  const entry = useProject(selectActiveEntry)!;
  const runs = useSeriesRuns(chosen, project, entry);
  const { ctx, summary } = useHeldContext(liveCtx, entry.well.id);
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
      onParamCutoff={commitParamCutoff}
      summary={summary}
    />
  );
}

export const dockPanels: DockPanelDef[] = [{ id: ZONE_DISTRIBUTION_DOCK_ID, title: 'Distribuciones', icon: 'boxplot', component: DistributionDock }];
