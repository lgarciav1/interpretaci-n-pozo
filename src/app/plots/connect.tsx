import { effectiveWell } from '../preparation/data';
/**
 * Conexión de los gráficos del dock (histograma, crossplot libre; docs/decisiones/0014) con los stores: contexto del
 * pozo activo, configuración guardada en el proyecto, recetas por `commit` y el cutoff real hacia los parámetros. Los
 * paneles de `src/plots/` no conocen los stores; los `dock.tsx` de los módulos los conectan con esto.
 */
import { useMemo, type ReactNode } from 'react';
import type { SourceRef } from '../../core/interpretation';
import type { CrossplotConfig, HistogramConfig, PlotKind } from '../../core/plots';
import { plotConfig, updatePlotConfig } from '../../core/state/plots';
import { activeWellEntry, makeId, setModuleEnabled, setParam, setSource } from '../../core/state/project';
import { showTool } from '../../core/state/toolString';
import { showToolLabel, type HiddenCurve } from '../../core/toolString';
import { SHARED_PARAMS } from '../../modules/sharedParams';
import { CUTOFF_TOGGLES, type CutoffParamKey } from '../../plots/cutoffs';
import type { ParamWrite } from '../../plots/params';
import type { SeriesContext } from '../../plots/trend/series';
import type { GuidePhase } from '../../plots/xy/XYPlot';
import { EmptyState } from '../../ui';
import { computedCurves } from '../computed';
import { plotContextOf } from './context';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';

/**
 * Contexto de series del pozo activo (pozo según la sarta, interpretación, calculadas activas, roles, curvas ocultas);
 * null sin pozo.
 */
export function usePlotContext(): SeriesContext | null {
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  return useMemo(() => {
    if (!entry) return null;
    return plotContextOf(effectiveWell(entry.well, result), entry.interpretation, computedCurves(result, entry.well));
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
 * Gesto en curso (un arrastre con el mouse desde un gráfico): sus cambios van con el mismo `group` y se funden en UNA
 * entrada de deshacer aunque haya pausas largas (docs/decisiones/0015). Se abre con el primer 'preview' y se cierra
 * con 'commit'; 'cancel' (Escape) vuelve al proyecto de antes del gesto. Las flechas mandan solo 'commit' (sin
 * gesto): se agrupan por la ventana de 800 ms, como el slider del inspector.
 */
let gesture: { id: string; label: string } | null = null;

/**
 * Parámetros elegidos sobre un gráfico (fase 7b): todas las escrituras de un movimiento en un solo `commit` (el punto
 * de matriz mueve ρma y la corrección del neutrón a la vez), con la etiqueta dada —la del slider del inspector para un
 * solo parámetro, así se agrupan igual—. Cada movimiento recalcula en vivo; el gesto entero es un solo deshacer.
 * Una zona que ya no existe escribe el global.
 */
/** Escritura de un parámetro: numérica (ParamWrite) o el interruptor booleano de un cutoff opcional (0054). */
type AnyParamWrite = Omit<ParamWrite, 'value'> & { value: number | boolean };

export function commitPlotParams(label: string, writes: readonly AnyParamWrite[], phase: GuidePhase): void {
  const store = useProject.getState();
  if (phase === 'cancel') {
    if (gesture) store.cancelGroup(gesture.id);
    gesture = null;
    return;
  }
  if (phase === 'preview' && (!gesture || gesture.label !== label)) gesture = { id: makeId('gesto'), label };
  const group = gesture?.label === label ? gesture.id : undefined;
  if (phase === 'commit') gesture = null;
  const entry = activeWellEntry(store.project);
  const valid = writes.filter((w) => typeof w.value === 'boolean' || Number.isFinite(w.value));
  if (!entry || valid.length === 0) return;
  const zoneOk = (z: string | null) => (z && entry.interpretation.zones.some((q) => q.id === z) ? z : null);
  store.commit(label, (p) => valid.reduce((acc, w) => setParam(acc, entry.well.id, w.storage, w.value, zoneOk(w.zoneId)), p), group ? { group } : undefined);
}

/**
 * Cutoff real movido desde un gráfico: escribe el parámetro compartido del módulo de cutoffs (global o de la zona).
 * Con la MISMA etiqueta que el slider del inspector («Cambiar Porosidad mínima»): cada movimiento recalcula en vivo
 * (pay, sumario, pista del visor) y el arrastre entero es una sola entrada de deshacer (gesto). Cancelar (Escape)
 * vuelve al valor de antes del arrastre.
 */
export function commitParamCutoff(key: CutoffParamKey, zoneId: string | null, value: number, phase: GuidePhase): void {
  // Un cutoff opcional (k, 0054) se activa al arrastrar su línea, en el mismo alcance y en el mismo deshacer.
  const toggle = CUTOFF_TOGGLES[key];
  const writes: AnyParamWrite[] = [{ storage: key, value, zoneId }, ...(toggle ? [{ storage: toggle, value: true, zoneId }] : [])];
  commitPlotParams(`Cambiar ${SHARED_PARAMS[key].label}`, writes, phase);
}

/** Fuentes activas por puerto del último resultado del motor para el pozo activo (null mientras no hay). */
export function useEngineSources(): Readonly<Record<string, SourceRef>> | null {
  const wellId = useProject((s) => s.project.activeWellId);
  const result = useResults((s) => s.result);
  return result && result.wellId === wellId ? result.sources : null;
}

/** Usa un módulo como fuente de un puerto (lo activa si estaba desactivado): «Usar Rw manual». */
export function chooseModuleSource(port: string, moduleId: string, label: string): void {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) return;
  useProject.getState().commit(label, (p) => setSource(setModuleEnabled(p, entry.well.id, moduleId, true), entry.well.id, port, { kind: 'module', moduleId }));
}

/**
 * Vuelve a mostrar los datos de una herramienta oculta por la sarta (atajo de «RHOB está oculta»): la prende o, en
 * planificación, la agrega a la sarta planificada. Entra en deshacer; la configuración del gráfico no cambió, así que
 * la curva elegida vuelve sola.
 */
export function showHiddenTool(h: Pick<HiddenCurve, 'toolId' | 'toolName' | 'reason'>): void {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) return;
  useProject.getState().commit(showToolLabel(h), (p) => showTool(p, entry.well.id, h.toolId));
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

