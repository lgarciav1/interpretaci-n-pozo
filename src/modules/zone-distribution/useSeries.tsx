/**
 * Series candidatas de las distribuciones por zona (docs/decisiones/0066) y su cálculo: la interpretación actual usa
 * el resultado del motor principal; cada snapshot del pozo activo y cada otro pozo del proyecto se calculan en el
 * motor de comparación de snapshots (`snapshotRunner`, un segundo motor en su worker, con caché por clave). Solo se
 * piden las series elegidas; las demás quedan como candidatas en los chips.
 * Va en .tsx porque usa React y la app (los .ts de `src/modules/` los carga el worker y no pueden).
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { toEngineWell } from '../../core/engine/engine';
import type { Interpretation } from '../../core/interpretation';
import { entryPreparationPlan } from '../../core/state/preparation';
import type { Project, WellEntry } from '../../core/state/project';
import type { Well } from '../../core/well';
import { computedCurves } from '../../app/computed';
import { plotContextOf } from '../../app/plots/context';
import { effectiveWell } from '../../app/preparation/data';
import { snapshotRunRequest } from '../../app/snapshots/request';
import { runKey } from '../../app/snapshots/runner';
import { snapshotRunner } from '../../app/snapshots/snapshotEngine';
import { CURRENT } from '../../app/snapshots/useSource';
import type { SeriesKind } from '../../plots/distribution/distribution';
import type { SeriesContext } from '../../plots/trend/series';
import { registry } from '../index';

export interface SeriesCandidate {
  id: string;
  label: string;
  kind: SeriesKind;
  /** Texto secundario del chip (fecha del snapshot, «otro pozo»). */
  detail?: string;
}

export type SeriesState = { status: 'pending' } | { status: 'error'; message: string } | { status: 'ready'; ctx: SeriesContext };

const dateFmt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/** Candidatas: «Actual», los snapshots del pozo activo (más nuevos primero) y los otros pozos del proyecto. */
export function seriesCandidates(project: Project, active: WellEntry): SeriesCandidate[] {
  const snaps = project.snapshots.filter((s) => s.wellId === active.well.id);
  return [
    { id: CURRENT, label: 'Actual', kind: 'current' },
    ...[...snaps].reverse().map((s): SeriesCandidate => ({ id: s.id, label: s.name, kind: 'snapshot', detail: dateFmt.format(new Date(s.createdAt)) })),
    ...project.wells.filter((w) => w.well.id !== active.well.id).map((w): SeriesCandidate => ({ id: `well:${w.well.id}`, label: w.well.name, kind: 'well', detail: 'otro pozo' })),
  ];
}

interface RunSpec {
  id: string;
  key: string;
  engineWell: ReturnType<typeof toEngineWell>;
  interpretation: Interpretation;
  context: ReturnType<typeof entryPreparationPlan>['context'];
  preparation: ReturnType<typeof entryPreparationPlan> | undefined;
  /** Pozo (antes de la preparación) e interpretación para armar el contexto con el resultado. */
  well: Well;
}

/** Pedido aislado de otro pozo del proyecto: su interpretación actual sobre sus datos (como la de un snapshot). */
function wellRunSpec(project: Project, entry: WellEntry): RunSpec {
  const plan = entryPreparationPlan(project, entry, registry);
  return {
    id: `well:${entry.well.id}`,
    key: runKey(`well:${entry.well.id}`, entry.interpretation, { id: entry.well.id, depth: entry.well.depth.values, curves: entry.well.curves }, entry.inputRevisionId ?? null, plan.context),
    engineWell: toEngineWell(entry.well),
    interpretation: entry.interpretation,
    context: plan.context,
    preparation: entry.interpretation.preparation?.nodes.length ? plan : undefined,
    well: entry.well,
  };
}

const subscribe = (cb: () => void) => snapshotRunner.subscribe(cb);

/**
 * Estado de cada serie elegida (sin la actual, que la resuelve el panel con el contexto del pozo activo). Los pedidos
 * se mantienen mientras estén elegidos y el panel a la vista; la caché del motor de snapshots evita recalcular.
 */
export function useSeriesRuns(ids: readonly string[], project: Project, active: WellEntry): Map<string, SeriesState> {
  const specs = useMemo(() => {
    const out: (RunSpec | { id: string; error: string })[] = [];
    for (const id of ids) {
      if (id === CURRENT) continue;
      try {
        if (id.startsWith('well:')) {
          const entry = project.wells.find((w) => `well:${w.well.id}` === id);
          if (!entry) out.push({ id, error: 'El pozo ya no está en el proyecto.' });
          else out.push(wellRunSpec(project, entry));
        } else {
          const snap = project.snapshots.find((s) => s.id === id && s.wellId === active.well.id);
          if (!snap) out.push({ id, error: 'El snapshot ya no existe.' });
          else {
            const r = snapshotRunRequest(project, snap);
            out.push({ id, key: r.key, engineWell: r.engineWell, interpretation: snap.interpretation, context: r.context, preparation: r.preparation, well: r.well });
          }
        }
      } catch (err) {
        out.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  }, [ids, project, active]);

  const runs = specs.filter((s): s is RunSpec => 'key' in s);
  const keys = runs.map((r) => r.key).join('\n');
  const latest = useRef(runs);
  latest.current = runs;
  useEffect(() => {
    const releases = latest.current.map((r) => snapshotRunner.acquire(r.key, r.engineWell, r.interpretation, r.context, r.preparation));
    return () => releases.forEach((release) => release());
    // La clave resume pozo, interpretación, curvas y contexto: no hace falta depender de los objetos.
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Firma primitiva de los estados (estable entre renders mientras nada cambie).
  const signature = useSyncExternalStore(subscribe, () => runs.map((r) => snapshotRunner.get(r.key)?.status ?? 'pending').join(','));

  return useMemo(() => {
    const out = new Map<string, SeriesState>();
    for (const s of specs) {
      if (!('key' in s)) {
        out.set(s.id, { status: 'error', message: s.error });
        continue;
      }
      const e = snapshotRunner.get(s.key);
      if (!e || e.status === 'pending') out.set(s.id, { status: 'pending' });
      else if (e.status === 'error') out.set(s.id, { status: 'error', message: e.message });
      else {
        const well = effectiveWell(s.well, e.result);
        out.set(s.id, { status: 'ready', ctx: plotContextOf(well, s.interpretation, computedCurves(e.result, well)) });
      }
    }
    return out;
  }, [specs, signature]); // eslint-disable-line react-hooks/exhaustive-deps
}
