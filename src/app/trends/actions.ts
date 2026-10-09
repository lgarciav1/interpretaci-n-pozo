/**
 * Conexión de las tendencias con los stores: la superposición del visor (pura, `src/plots/trend/overlay.ts`) recibe
 * acá cómo leer la herramienta y la selección y cómo guardar (`commit` con etiquetas en español). Lo usan
 * `ViewerSlot` (superposición, botón de la barra) y el panel «Tendencias».
 */
import { activeWellEntry, makeId, type Project } from '../../core/state/project';
import { addTrend, updateTrend, type TrendPatch } from '../../core/state/trends';
import { nextTrendName, type TrendSpec } from '../../core/trends';
import { createTrendsOverlays, type NewTrendInput, type TrendTool } from '../../plots/trend/overlay';
import { toast } from '../../ui';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { resolveSeries } from './providers';
import { useTrendsUi } from './store';

const activeWellId = () => activeWellEntry(useProject.getState().project)?.well.id ?? null;

/** Guarda una receta sobre el pozo activo. */
export function commitTrends(label: string, recipe: (p: Project, wellId: string) => Project): void {
  const wellId = activeWellId();
  if (!wellId) return;
  useProject.getState().commit(label, (p) => recipe(p, wellId));
}

/** Entra en una herramienta del visor (sale de «marcar zona»). */
export function startTrendTool(tool: TrendTool): void {
  useUi.getState().set({ zoneMarking: false });
  useTrendsUi.getState().set({ tool });
}

export function stopTrendTool(): void {
  if (useTrendsUi.getState().tool) useTrendsUi.getState().set({ tool: null });
}

export function createTrend(input: NewTrendInput): TrendSpec | null {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) return null;
  const spec: TrendSpec = {
    id: makeId('tend'),
    name: nextTrendName(entry.interpretation.trends, `${input.seriesLabel} · ${input.mode === 'manual' ? 'a mano' : 'tendencia'}`),
    visible: true,
    series: input.series,
    model: input.model,
    mode: input.mode,
    selection: input.selection,
    ...(input.manual ? { manual: input.manual } : {}),
    extend: input.mode === 'manual',
  };
  commitTrends(input.mode === 'manual' ? 'Dibujar tendencia a mano' : 'Agregar tendencia', (p, w) => addTrend(p, w, spec));
  useTrendsUi.getState().set({ selectedId: spec.id });
  // El panel muestra la ecuación y los gradientes: se abre (sin robar el foco).
  const ui = useUi.getState();
  if (ui.dockTab !== 'trends' || ui.layout.dockCollapsed) {
    ui.set({ dockTab: 'trends' });
    if (ui.layout.dockCollapsed) ui.setLayout({ dockCollapsed: false });
  }
  return spec;
}

export function patchTrend(id: string, patch: TrendPatch, label: string): void {
  commitTrends(label, (p, w) => updateTrend(p, w, id, patch));
}

/** Superposiciones del visor (bandas debajo, líneas encima), conectadas a los stores. */
export const TREND_OVERLAYS = createTrendsOverlays({
  resolve: resolveSeries,
  edit: {
    trends: () => activeWellEntry(useProject.getState().project)?.interpretation.trends ?? [],
    tool: () => useTrendsUi.getState().tool,
    blocked: () => useUi.getState().zoneMarking,
    selected: () => useTrendsUi.getState().selectedId,
    select: (id) => useTrendsUi.getState().set({ selectedId: id }),
    create: (input) => void createTrend(input),
    update: patchTrend,
    togglePoint: (id, key, exclude) =>
      commitTrends(exclude ? 'Excluir punto de la tendencia' : 'Incluir punto en la tendencia', (p, w) => {
        const t = activeWellEntry(p)?.interpretation.trends.find((x) => x.id === id);
        if (!t) return p;
        const has = t.selection.excluded.includes(key);
        if (has === exclude) return p;
        const excluded = exclude ? [...t.selection.excluded, key] : t.selection.excluded.filter((k) => k !== key);
        return updateTrend(p, w, id, { selection: { ...t.selection, excluded } });
      }),
    finishTool: stopTrendTool,
    error: (message) => toast({ tone: 'warn', title: 'No se guardó la tendencia', description: message }),
  },
  subscribe: (invalidate) => useTrendsUi.subscribe((s, prev) => (s.tool !== prev.tool || s.selectedId !== prev.selectedId) && invalidate()),
});
