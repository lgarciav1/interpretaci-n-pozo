/**
 * Recetas puras sobre la configuración de los gráficos del dock (histograma y crossplot libre;
 * docs/decisiones/0014-histograma-y-crossplot.md, D2). Se aplican con `useProject.getState().commit(etiqueta, …)`
 * y entran en deshacer/rehacer. Si nada cambia devuelven el mismo proyecto (no se registra en el historial).
 */
import { defaultCrossplot, defaultHistogram, type CrossplotConfig, type HistogramConfig, type PlotCurveKey, type PlotKind, type WellPlots } from '../plots';
import { getWellEntry, type Project } from './project';

type ConfigOf<K extends PlotKind> = K extends 'histogram' ? HistogramConfig : CrossplotConfig;

/** Configuración guardada de un gráfico de un pozo, o la de fábrica. */
export function plotConfig<K extends PlotKind>(project: Project, wellId: string, kind: K): ConfigOf<K> {
  const saved = project.display.plots?.[wellId]?.[kind];
  return (saved ?? (kind === 'histogram' ? defaultHistogram() : defaultCrossplot())) as ConfigOf<K>;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Aplica un parche a la configuración de un gráfico. Claves con `undefined` se quitan (rangos fijos). */
export function updatePlotConfig<K extends PlotKind>(project: Project, wellId: string, kind: K, patch: Partial<ConfigOf<K>>): Project {
  getWellEntry(project, wellId);
  const prev = plotConfig(project, wellId, kind) as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = { ...prev };
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (same(next[k], v)) continue;
    changed = true;
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  if (!changed) return project;
  const forWell: WellPlots = { ...(project.display.plots?.[wellId] ?? {}), [kind]: next };
  return { ...project, display: { ...project.display, plots: { ...(project.display.plots ?? {}), [wellId]: forWell } } };
}

/**
 * Cutoff de un gráfico sobre una curva: `true` muestra el cutoff real (parámetro del módulo de cutoffs), un número es
 * una línea libre y `null` lo quita.
 */
export function setPlotCutoff(project: Project, wellId: string, kind: PlotKind, curve: PlotCurveKey, value: number | true | null): Project {
  const cfg = plotConfig(project, wellId, kind);
  const cur = cfg.cutoffs[curve];
  if (value === null ? cur === undefined : cur === value) return project;
  const cutoffs = { ...cfg.cutoffs };
  if (value === null) delete cutoffs[curve];
  else cutoffs[curve] = value;
  return updatePlotConfig(project, wellId, kind, { cutoffs } as Partial<ConfigOf<typeof kind>>);
}
