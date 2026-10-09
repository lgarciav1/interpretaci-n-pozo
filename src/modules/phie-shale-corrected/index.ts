/**
 * Módulo PHIE — porosidad efectiva con corrección por arcilla. Ver 0007, C8.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { shaleCorrectedPorosityInto } from '../../petro/porosity';

export default defineModule({
  id: 'phie-shale-corrected',
  name: 'Porosidad efectiva — corrección por arcilla',
  description: 'Resta de la porosidad total la porosidad aparente de la arcilla, ponderada por su volumen.',
  category: 'porosity',
  workspace: 'petrophysics',
  inputs: {
    phit: input.curve('PHIT'),
    vsh: input.curve('VSH'),
  },
  params: {
    phiSh: param.number({
      label: 'Porosidad aparente de la arcilla',
      tooltip: 'Lectura de la porosidad total en las arcillas vecinas a la zona.',
      default: 0.2,
      min: 0,
      max: 0.5,
      step: 0.005,
      unit: 'v/v',
      scope: 'zone',
    }),
  },
  outputs: {
    phie: output.curve('PHIE'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) shaleCorrectedPorosityInto(inputs.phit, inputs.vsh, out, s.params.phiSh, s.start, s.end);
    return { phie: out };
  },
  docs: {
    summary: 'Porosidad efectiva que resta la porosidad aparente de la arcilla, ponderada por el volumen de arcilla.',
    equations: [{ latex: '\\phi_e = \\phi_t - V_{sh}\\,\\phi_{sh}', description: 'Se recorta a [0, 0,5].' }],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.'],
  },
});
