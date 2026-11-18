import type { ClientResult } from '../../core/engine/client';
import { sameContext } from '../../core/engine/context';
import type { Project, WellEntry } from '../../core/state/project';
import { convert, parseUnit, sameDimension } from '../../core/units';
import { generateTrainer, trainerMetrics, trainerWellId } from '../../petro/trainer';
import { entryContext, preparedData } from '../preparation/data';

export function trainerCorrection(project: Project, entry: WellEntry, result: ClientResult) {
  const recipe = entry.trainerRecipe;
  if (!recipe || !entry.well.id.startsWith(trainerWellId(recipe) + '-')) {
    throw new Error('La receta no corresponde al pozo activo.');
  }
  if (project.activeWellId !== entry.well.id || !sameContext(result.context, entryContext(entry, project))) {
    throw new Error('Esperá el cálculo de la interpretación vigente antes de corregir.');
  }

  const { well: generated, truth } = generateTrainer(recipe);
  const depth = entry.well.depth.values;
  if (depth.length !== generated.depth.values.length || !depth.every((md, i) => md === generated.depth.values[i])) {
    throw new Error('El eje de profundidad cambió respecto del ejercicio original.');
  }

  const effective = preparedData(entry.well, result)?.well ?? entry.well;
  const valuesOf = (role: 'PHIE' | 'VSH' | 'SW') => {
    const source = result.sources[role];
    if (!source) return null;
    const curve = source.kind === 'curve' ? effective.curves.find(c => c.id === source.curveId) : undefined;
    const output = source.kind === 'module'
      ? result.outputs.find(o => o.active && o.kind === 'curve' && o.moduleId === source.moduleId && o.port === role)
      : undefined;
    const values = curve?.data ?? output?.value;
    const name = curve?.mnemonic ?? output?.label;
    const unit = parseUnit(curve?.unit ?? output?.unit ?? '');
    if (!(values instanceof Float64Array) || values.length !== depth.length || !unit || !sameDimension(unit, 'v/v')) return null;
    return { values: unit === 'v/v' ? values : values.map(v => convert(v, unit, 'v/v')), name };
  };
  const phi = valuesOf('PHIE');
  const sw = valuesOf('SW');
  return {
    depth, truth, phi, sw, vsh: valuesOf('VSH'),
    metrics: trainerMetrics(result.segments, truth, { ...(phi ? { phi: phi.values } : {}), ...(sw ? { sw: sw.values } : {}) }),
  };
}
