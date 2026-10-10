/**
 * Conexión de los gráficos del dock (histograma, crossplot libre; docs/decisiones/0014) con los stores: contexto del
 * pozo activo, configuración guardada en el proyecto, recetas por `commit` y el cutoff real hacia los parámetros. Los
 * paneles de `src/plots/` no conocen los stores; los `dock.tsx` de los módulos los conectan con esto.
 */
import { useMemo, type ReactNode } from 'react';
import type { CrossplotConfig, HistogramConfig, PlotKind } from '../../core/plots';
import { plotConfig, updatePlotConfig } from '../../core/state/plots';
import { activeWellEntry, setParam } from '../../core/state/project';
import { registry } from '../../modules';
import { SHARED_PARAMS } from '../../modules/sharedParams';
import type { CutoffParamKey } from '../../plots/cutoffs';
import type { SeriesContext } from '../../plots/trend/series';
import type { GuidePhase } from '../../plots/xy/XYPlot';
import { EmptyState } from '../../ui';
import { computedCurves } from '../computed';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';

/** Contexto de series del pozo activo (pozo, interpretación, calculadas activas, roles); null sin pozo. */
export function usePlotContext(): SeriesContext | null {
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  return useMemo(() => {
    if (!entry) return null;
    return { well: entry.well, interpretation: entry.interpretation, computed: computedCurves(result, entry.well), catalog: registry.roles };
  }, [entry, result]);
}

type ConfigOf<K extends PlotKind> = K extends 'histogram' ? HistogramConfig : CrossplotConfig;

/** Configuración guardada del gráfico en el pozo activo (o la de fábrica). */
export function usePlotConfig<K extends PlotKind>(kind: K): ConfigOf<K> | null {
  const project = useProject((s) => s.project);
  const wellId = project.activeWellId;
  const saved = wellId ? project.display.plots?.[wellId]?.[kind] : undefined;
  return useMemo(() => (wellId && project.wells.some((w) => w.well.id === wellId) ? plotConfig(project, wellId, kind) : null), [saved, wellId, kind]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Guarda un cambio de configuración del gráfico (entra en deshacer). */
export function commitPlotConfig<K extends PlotKind>(kind: K, patch: Partial<ConfigOf<K>>, label: string): void {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) return;
  useProject.getState().commit(label, (p) => updatePlotConfig(p, entry.well.id, kind, patch));
}

/**
 * Cutoff real movido desde un gráfico: escribe el parámetro compartido del módulo de cutoffs (global o de la zona).
 * Con la MISMA etiqueta que el slider del inspector («Cambiar Porosidad mínima»): cada movimiento recalcula en vivo
 * (pay, sumario, pista del visor) y los cambios seguidos se agrupan en una sola entrada de deshacer, igual que al
 * arrastrar el slider. Cancelar (Escape) vuelve al valor de antes del arrastre.
 */
export function commitParamCutoff(key: CutoffParamKey, zoneId: string | null, value: number, _phase: GuidePhase): void {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry || !Number.isFinite(value)) return;
  const zone = zoneId && entry.interpretation.zones.some((z) => z.id === zoneId) ? zoneId : null;
  useProject.getState().commit(`Cambiar ${SHARED_PARAMS[key].label}`, (p) => setParam(p, entry.well.id, key, value, zone));
}

/**
 * Monta el panel solo mientras su pestaña está a la vista (con el dock abierto): un gráfico oculto no recalcula ni
 * redibuja con cada cambio de parámetros, y solo lo que está a la vista se ofrece para exportar como figura.
 */
export function PlotDockGate({ id, icon, children }: { id: string; icon: 'histogram' | 'scatter'; children: (ctx: SeriesContext) => ReactNode }) {
  const active = useUi((s) => s.dockTab === id && !s.layout.dockCollapsed);
  const ctx = usePlotContext();
  if (!active) return null;
  if (!ctx) return <EmptyState size="sm" icon={icon} title="Sin pozo" description="Cargá un pozo para graficar sus curvas." />;
  return <>{children(ctx)}</>;
}
