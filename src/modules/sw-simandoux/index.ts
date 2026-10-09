/**
 * Módulo SW — saturación de agua de Simandoux (arenas arcillosas). Ver 0007, C14.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { simandouxSw } from '../../petro/saturation';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'sw-simandoux',
  name: 'Sw — Simandoux',
  description: 'Saturación de agua para arenas arcillosas: descuenta la conducción de la arcilla. Usa n = 2.',
  category: 'saturation',
  workspace: 'petrophysics',
  inputs: {
    rt: input.curve('RT'),
    phi: input.curve('PHIE'),
    vsh: input.curve('VSH'),
    rw: input.curve('RW'),
  },
  params: {
    a: SHARED_PARAMS.a,
    m: SHARED_PARAMS.m,
    rsh: SHARED_PARAMS.rsh,
  },
  outputs: {
    sw: output.curve('SW'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      const { a, m, rsh } = s.params;
      for (let i = s.start; i < s.end; i++) {
        out[i] = simandouxSw(inputs.rt[i]!, inputs.phi[i]!, inputs.vsh[i]!, inputs.rw[i]!, rsh, a, m);
      }
    }
    return { sw: out };
  },
  docs: {
    summary:
      'Saturación de agua de Simandoux para arenas arcillosas. Esta forma fija el exponente de saturación en 2; con Vsh = 0 se reduce a Archie con n = 2.',
    equations: [
      {
        latex: 'S_w = \\frac{a\\,R_w}{2\\,\\phi^{m}}\\left[\\sqrt{\\left(\\frac{V_{sh}}{R_{sh}}\\right)^2 + \\frac{4\\,\\phi^{m}}{a\\,R_w\\,R_t}} - \\frac{V_{sh}}{R_{sh}}\\right]',
        description: 'Se recorta a [0, 1].',
      },
    ],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.', 'Simandoux, P. (1963). Mesures diélectriques en milieu poreux, application à la mesure des saturations en eau. Revue de l’Institut Français du Pétrole 18.'],
  },
});
