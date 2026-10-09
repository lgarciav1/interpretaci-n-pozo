/**
 * Módulo PHIS — porosidad sónica, Raymer-Hunt-Gardner. Ver 0007, C5.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { sonicPorosityRaymerInto } from '../../petro/porosity';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'phi-sonic-raymer',
  name: 'Porosidad sónica — Raymer-Hunt-Gardner',
  description: 'Porosidad a partir del tiempo de tránsito con la relación empírica de Raymer, Hunt y Gardner.',
  category: 'porosity',
  workspace: 'petrophysics',
  inputs: {
    dt: input.curve('DT'),
  },
  params: {
    // Compartido: lo usa también la porosidad sónica de Wyllie.
    dtMa: SHARED_PARAMS.dtMa,
  },
  outputs: {
    phis: output.curve('PHIS'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) sonicPorosityRaymerInto(inputs.dt, out, s.params.dtMa, s.start, s.end);
    return { phis: out };
  },
  docs: {
    summary:
      'Porosidad sónica empírica de Raymer-Hunt-Gardner: no necesita el tiempo de tránsito del fluido y funciona mejor que Wyllie en rocas poco compactadas y con porosidad alta.',
    equations: [
      {
        latex: '\\phi_S = 0{,}625\\,\\frac{\\Delta t - \\Delta t_{ma}}{\\Delta t}',
        description: 'Forma simplificada con coeficiente 0,625. Se recorta a [0, 0,5].',
      },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
      'Raymer, L. L., Hunt, E. R. y Gardner, J. S. (1980). An improved sonic transit time-to-porosity transform. SPWLA 21st Annual Logging Symposium.',
    ],
  },
});
