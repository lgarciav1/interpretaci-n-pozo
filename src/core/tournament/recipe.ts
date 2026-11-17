/** F22: una sola receta aceptada, con snapshot de entradas fijadas. */
import { sameContext } from '../engine/context';
import { entryPreparationPlan } from '../state/preparation';
import { registry } from '../../modules';
import { isJsonValue } from '../interpretation';
import { enableProjectInputRevisions } from '../state/inputRevisions';
import { createSnapshot } from '../state/snapshots';
import { getWellEntry, updateInterpretation, type Project, type WellEntry } from '../state/project';
import { TOURNAMENT_CANDIDATES, tournamentInterpretation, type TournamentCandidate, type TournamentResult } from '../../petro/modelTournament';

export function applyTournament(project: Project, wellId: string, capturedEntry: WellEntry, candidate: TournamentCandidate, result: TournamentResult): Project {
  const current = getWellEntry(project, wellId);
  if (current.well !== capturedEntry.well || current.interpretation !== capturedEntry.interpretation || current.inputRevisionId !== capturedEntry.inputRevisionId) throw new Error('El torneo está obsoleto: volvé a calcular con las entradas actuales.');
  if (!sameContext(entryPreparationPlan(project, current, registry).context, result.executionContext)) throw new Error('El resultado pertenece a otro contexto de entradas.');
  const known = TOURNAMENT_CANDIDATES.find(c => c.id === candidate.id);
  if (!known || JSON.stringify(known) !== JSON.stringify(candidate)) throw new Error('Combinación de métodos inválida.');
  const row = result.rows.find(r => r.candidate.id === candidate.id);
  if (result.version !== 1 || result.assessment !== 'exploratory' || !row?.applicable || !row.phi.supported || !row.commonPhi.supported || row.commonPhi.n < 5 || row.commonPhi.coverage < 0.8 || !isJsonValue(result)) throw new Error('No hay soporte común suficiente para aplicar esta combinación.');
  const revisioned = enableProjectInputRevisions(project);
  const applied = updateInterpretation(revisioned, wellId, interpretation => ({
    ...tournamentInterpretation(interpretation, known),
    moduleState: { ...interpretation.moduleState, 'model-tournament': { candidate: { ...known }, result } },
  }));
  return createSnapshot(applied, wellId, `Torneo exploratorio · ${known.id}`).project;
}
