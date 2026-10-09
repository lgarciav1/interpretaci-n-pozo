/**
 * Módulo PHIN — porosidad neutrónica. Ver 0007, C3.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { neutronPorosityInto } from '../../petro/porosity';

export default defineModule({
  id: 'phi-neutron',
  name: 'Porosidad neutrónica',
  description: 'Porosidad neutrónica con corrección de matriz opcional.',
  category: 'porosity',
  workspace: 'petrophysics',
  inputs: {
    nphi: input.curve('NPHI'),
  },
  params: {
    matrixOffset: param.number({
      label: 'Corrección de matriz',
      tooltip: 'Se resta a la lectura del neutrón. Con NPHI en unidades de caliza leído en arenisca, ≈ +0,04 v/v.',
      default: 0,
      min: -0.1,
      max: 0.1,
      step: 0.005,
      unit: 'v/v',
      scope: 'zone',
    }),
  },
  outputs: {
    phin: output.curve('PHIN'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) neutronPorosityInto(inputs.nphi, out, s.params.matrixOffset, s.start, s.end);
    return { phin: out };
  },
  docs: {
    summary: 'Porosidad neutrónica: la lectura del neutrón menos la corrección por litología de la matriz.',
    equations: [{ latex: '\\phi_N = \\phi_{N,leida} - \\Delta_{matriz}', description: 'Se recorta a [0, 0,5].' }],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.'],
  },
});
