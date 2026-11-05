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
import { moduleWorkspaces, type TableCell, type TableValue } from '../../core/module';

type Row = Readonly<Record<string, TableCell>>;
import type { SeriesContext } from '../../plots/trend/series';
import { seriesCandidates, useSeriesRuns, type SeriesCandidate } from './useSeries';
import { RUN_COLORS } from '../core/model';
import { dependencySignature } from '../uncertainty/model';
import { useSnapshots } from '../uncertainty/snapshots';
import { registry } from '../index';
import { FLOWS, stepsOfModule } from '../../app/flow/flow';
import { toFlowModule } from '../../app/flow/useFlow';
import { FREE_MODULE_VIEW } from '../../app/shell/freeModuleView';
import { wellCorePlugs } from '../../plots/distribution/corePlugs';
import { zoneVolumes } from '../../plots/distribution/volume';

export const ZONE_DISTRIBUTION_DOCK_ID = 'zone-distribution';

/** Abre la pestaña (desde el Sumario o la paleta de comandos). */
export function openZoneDistribution(): void {
  useUi.getState().openPanel(ZONE_DISTRIBUTION_DOCK_ID);
}

/** Id del módulo de incertidumbre del volumen (Monte Carlo). */
const UNCERTAINTY_ID = 'uncertainty';
const CORE_COLORS = { light: RUN_COLORS.light[0]!, dark: RUN_COLORS.dark[0]! } as const;

/**
 * Abre el módulo de incertidumbre en el inspector (como «Todos los módulos»): su paso del flujo o la vista libre del
 * módulo. NO lo calcula: el Monte Carlo se corre con su botón «Calcular», a pedido del usuario.
 */
export function openUncertainty(): void {
  const m = registry.modules.find((x) => x.id === UNCERTAINTY_ID);
  if (!m) return;
  const ui = useUi.getState();
  const all = moduleWorkspaces(m);
  const workspace = all.includes(ui.workspace) ? ui.workspace : (all[0] ?? ui.workspace);
  const steps = stepsOfModule(FLOWS[workspace], toFlowModule(m));
  ui.set({ workspace, activeModuleId: m.id, activeStepId: steps[0]?.id ?? FREE_MODULE_VIEW });
  if (ui.layout.rightCollapsed) ui.setLayout({ rightCollapsed: false });
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
  const held = useRef<{ ctx: SeriesContext; summary: readonly SummaryRow[] | null; volumetrics: readonly Row[] | null } | null>(null);
  const fresh = !!result && result.wellId === wellId;
  // Pay neto por zona: la tabla del sumario del último resultado del motor para ESTE pozo (se actualiza al recalcular).
  const summary = useMemo(() => {
    if (!fresh) return null;
    const out = result!.outputs.find((o) => o.moduleId === 'zone-summary' && o.port === 'ZONE_SUMMARY');
    return (out?.value as TableValue | undefined)?.rows ?? null;
  }, [result, fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const volumetrics = useMemo(() => {
    if (!fresh) return null;
    const out = result!.outputs.find((o) => o.moduleId === 'volumetrics' && o.port === 'VOLUMETRICS');
    return (out?.value as TableValue | undefined)?.rows ?? null;
  }, [result, fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  if (fresh) held.current = { ctx, summary, volumetrics };
  else if (error || (held.current && (held.current.ctx.well.id !== ctx.well.id || held.current.ctx.well.depth.values !== ctx.well.depth.values))) held.current = null;
  const hold = fresh ? null : held.current;
  const merged = useMemo(() => (!hold ? ctx : hold.ctx.interpretation === ctx.interpretation ? hold.ctx : { ...hold.ctx, interpretation: ctx.interpretation }), [hold?.ctx, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ctx: merged, summary: hold ? hold.summary : summary, volumetrics: hold ? hold.volumetrics : volumetrics };
}

function Connected({ ctx: liveCtx, config, candidates, chosen, wellName }: { ctx: SeriesContext; config: DistributionConfig; candidates: SeriesCandidate[]; chosen: string[]; wellName: string }) {
  const project = useProject((s) => s.project);
  const entry = useProject(selectActiveEntry)!;
  const runs = useSeriesRuns(chosen, project, entry);
  const { ctx, summary, volumetrics } = useHeldContext(liveCtx, entry.well.id);
  const core = useMemo(() => {
    const plugs = wellCorePlugs(ctx.well, ctx.interpretation);
    return plugs ? { plugs, colors: CORE_COLORS } : null;
  }, [ctx.well, ctx.interpretation]);
  // Volumen (D19): determinista del último resultado y la copia del Monte Carlo (si se calculó), con su vigencia.
  const result = useResults((s) => s.result);
  const snap = useSnapshots((s) => s.byWell[entry.well.id]);
  const volume = useMemo(() => {
    const stale = !!snap && (snap.sig !== dependencySignature(ctx.interpretation) || (!!result && result.wellId === snap.wellId && result.gen !== snap.gen));
    return zoneVolumes(volumetrics, ctx.interpretation.zones, snap ? { rows: snap.summary, stale } : null);
  }, [volumetrics, ctx.interpretation, snap, result]);
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
      core={core}
      volume={volume}
      onOpenUncertainty={openUncertainty}
    />
  );
}

export const dockPanels: DockPanelDef[] = [{ id: ZONE_DISTRIBUTION_DOCK_ID, title: 'Distribuciones', icon: 'boxplot', component: DistributionDock }];
