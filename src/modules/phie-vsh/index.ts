/**
 * Módulo PHIE — porosidad efectiva φt·(1 − Vsh). Ver 0007, C7.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { effectivePorosityInto } from '../../petro/porosity';

export default defineModule({
  id: 'phie-vsh',
  name: 'Porosidad efectiva — φt·(1 − Vsh)',
  description: 'Porosidad efectiva descontando el volumen de arcilla de la porosidad total.',
  category: 'porosity',
  workspace: 'petrophysics',
  inputs: {
    phit: input.curve('PHIT'),
    vsh: input.curve('VSH'),
  },
  params: {},
  outputs: {
    phie: output.curve('PHIE'),
  },
  compute({ n, inputs }) {
    const out = new Float64Array(n);
    effectivePorosityInto(inputs.phit, inputs.vsh, out);
    return { phie: out };
  },
  docs: {
    summary: 'Porosidad efectiva descontando el volumen de arcilla de la porosidad total.',
    equations: [{ latex: '\\phi_e = \\phi_t\\,(1 - V_{sh})' }],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.'],
  },
});
