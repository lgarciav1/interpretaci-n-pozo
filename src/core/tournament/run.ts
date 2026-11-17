/** Adaptador de la tarea F22: misma preparación y mismo motor, aislados del motor activo. */
import { sameContext } from '../engine/context';
import type { EngineWell } from '../engine/engine';
import type { Interpretation } from '../interpretation';
import type { Registry } from '../registry';
import { MaskEvaluator } from '../preparation/evaluate';
import { planPreparation, projectedEngineCurves, type PreparationPlan } from '../preparation/plan';
import { evaluateTournament, type TournamentObservation } from '../../petro/modelTournament';

export interface TournamentRequest {
  well: EngineWell;
  interpretation: Interpretation;
  preparation: PreparationPlan;
  observations: TournamentObservation[];
}
export async function runTournamentTask(request: TournamentRequest, registry: Registry) {
  const { well, interpretation, preparation, observations } = request;
  const plan = planPreparation(well, interpretation, preparation.context.inputRevisionId, registry, preparation.bindings, preparation.context.depthKey);
  if (!sameContext(plan.context, preparation.context) || plan.stateKey !== preparation.stateKey || plan.originalKey !== preparation.originalKey || JSON.stringify(plan.artifacts) !== JSON.stringify(preparation.artifacts)) throw new Error('El contexto del torneo no corresponde a sus entradas.');
  const payloads = await new MaskEvaluator().evaluate(well, plan);
  const projected = { ...well, curves: projectedEngineCurves(well, plan, payloads) };
  return { ...evaluateTournament(registry, projected, interpretation, observations), executionContext: preparation.context };
}
