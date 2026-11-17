import type { Project } from '../../core/state/project';
import { getWellEntry } from '../../core/state/project';
import { entryPreparationPlan } from '../../core/state/preparation';
import { curveProvenance } from '../../core/engine/context';
import { toEngineWell } from '../../core/engine/engine';
import type { TournamentObservation, TournamentResult } from '../../petro/modelTournament';
import { registry } from '../../modules';
import TournamentWorker from './tournament.worker?worker&inline';

/** No cálculo sincrónico de respaldo: un worker bloqueado se informa al usuario. */
export function runModelTournament(project: Project, wellId: string, observations: TournamentObservation[]): Promise<TournamentResult> {
  return new Promise((resolve, reject) => {
    const entry = getWellEntry(project, wellId);
    const preparation = entryPreparationPlan(project, entry, registry);
    const raw = toEngineWell(entry.well);
    const well = { ...raw, curves: raw.curves.map(c => ({ ...c, provenance: curveProvenance(c, preparation.context.depthKey) })) };
    const worker = new TournamentWorker({ name: 'torneo-modelos' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('El torneo agotó el tiempo de espera.')); }, 120_000);
    const close = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = (event: MessageEvent<{ result?: TournamentResult; error?: string }>) => {
      close();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.result) resolve(event.data.result);
      else reject(new Error('Respuesta inválida del torneo.'));
    };
    worker.onerror = () => { close(); reject(new Error('No se pudo ejecutar el worker del torneo.')); };
    try { worker.postMessage({ well, interpretation: entry.interpretation, preparation, observations }); }
    catch (error) { close(); reject(error); }
  });
}
