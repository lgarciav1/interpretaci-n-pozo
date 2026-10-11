/**
 * Indicador de crossover de gas: bandera 0/1/NaN donde la porosidad por densidad supera a la neutrónica y la roca
 * no es arcillosa. Ver 0017. Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { GAS_CROSSOVER_MIN, gasCrossoverFlagInto } from '../../petro/indicators';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'ind-gas-crossover',
  name: 'Indicador de crossover de gas',
  description: 'Marca donde el neutrón lee menos que la densidad (efecto del gas), fuera de las zonas arcillosas.',
  category: 'indicators',
  categoryLabel: 'Indicadores',
  workspace: 'petrophysics',
  roles: [
    {
      id: 'IND_GAS',
      label: 'Bandera de gas',
      unit: 'unitless',
      family: 'flag',
      origin: 'computed',
      description: 'Crossover densidad–neutrón fuera de zonas arcillosas.',
      display: { color: '#e8a317', scale: 'linear', min: 0, max: 1 },
    },
  ],
  inputs: {
    phid: input.curve('PHID'),
    phin: input.curve('PHIN'),
    vsh: input.optionalCurve('VSH'),
  },
  params: {
    crossoverMin: param.number({
      label: 'Cruce mínimo (φD − φN)',
      tooltip:
        'Diferencia entre la porosidad por densidad y la neutrónica a partir de la cual se marca gas. Las dos deben estar en la misma escala de matriz (corrección de matriz del neutrón en el paso Porosidad); si no, la diferencia no mide gas.',
      default: GAS_CROSSOVER_MIN,
      min: 0,
      max: 0.15,
      step: 0.005,
      unit: 'v/v',
      scope: 'zone',
    }),
    vshCutoff: SHARED_PARAMS.vshCutoff,
  },
  outputs: {
    gas: output.curve('IND_GAS'),
  },
  compute({ n, inputs, segments, warn }) {
    const out = new Float64Array(n);
    if (!inputs.vsh) warn('Sin curva de Vsh: el crossover de gas no excluye las zonas arcillosas.');
    for (const s of segments) {
      const { crossoverMin, vshCutoff } = s.params;
      gasCrossoverFlagInto(inputs.phid, inputs.phin, inputs.vsh, out, crossoverMin, vshCutoff, s.start, s.end);
    }
    return { gas: out };
  },
  docs: {
    summary:
      'Crossover de gas: el gas hace que la densidad lea de menos (porosidad por densidad alta) y el neutrón también (por su menor índice de hidrógeno), de modo que el neutrón queda por debajo de la densidad. Se marca 1 donde φD − φN alcanza el mínimo y Vsh no supera el máximo; 0 si la diferencia es menor o la roca es arcillosa; sin dato si falta una porosidad o Vsh y no se puede decidir. Los bordes son inclusivos: φD − φN = mínimo marca gas y Vsh = máximo no es arcilla. Sin curva de Vsh no se excluye arcilla. Es un criterio práctico, no un valor de libro: el umbral depende del ruido de las curvas y de la escala de matriz del neutrón.',
    equations: [
      {
        latex: 'GAS = 1 \\iff (\\phi_D - \\phi_N) \\ge \\Delta_{min}\\ \\wedge\\ V_{sh} \\le V_{sh,max}',
        description: 'Si no, 0. Con Vsh > Vsh,max la bandera es 0 aunque falte una porosidad.',
      },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16, cap. 5 (efecto del gas en densidad–neutrón).',
      'Schlumberger (1989). Log Interpretation Principles/Applications, cap. 4.',
    ],
  },
});
