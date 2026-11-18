import { FORMULA_NAME, sanitizeFormulas, formulaModuleId, type CurveFormula } from '../formulas';
import type { Interpretation } from '../interpretation';
import type { Registry } from '../registry';
import { planGraph, type CurveMeta } from './graph';

export function withCurveFormula(
  registry: Registry, curves: readonly CurveMeta[], current: Interpretation, formula: CurveFormula,
): Interpretation {
  const { mnemonic } = formula;
  if (!FORMULA_NAME.test(mnemonic)) throw new Error('Usá de 1 a 32 caracteres para el mnemónico. Empezá con una letra y seguí con letras, números o guiones bajos.');
  const formulas = sanitizeFormulas(
    [...(current.formulas ?? []).filter(f => f.mnemonic !== mnemonic), formula],
    message => { throw new Error(message); },
  );
  const next = { ...current, formulas: formulas! };
  const plan = planGraph(registry, curves, next);
  const id = formulaModuleId(mnemonic);
  const invalid = plan.diagnostics.find(d => d.code === 'formula' && d.moduleId === id);
  if (invalid) throw new Error(invalid.message);
  const dependencies = new Set<string>();
  const visit = (id: string) => {
    if (dependencies.has(id)) return;
    dependencies.add(id);
    for (const dependency of plan.nodes.get(id)?.deps ?? []) visit(dependency);
  };
  visit(id);
  const problem = plan.diagnostics.find(d => d.code === 'cycle' && d.moduleId && dependencies.has(d.moduleId)) ??
    plan.diagnostics.find(d => d.code === 'missing-input' && d.moduleId && dependencies.has(d.moduleId) && plan.nodes.get(d.moduleId)?.status !== 'ready');
  if (problem) throw new Error(problem.message);
  if (plan.nodes.get(id)?.status !== 'ready') throw new Error(`No se puede calcular ${mnemonic}. Revisá la disponibilidad de sus fuentes.`);
  return next;
}
