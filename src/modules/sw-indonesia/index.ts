/**
 * Módulo SW — saturación de agua de Indonesia (Poupon–Leveaux). Ver 0007, C15.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { indonesiaSw } from '../../petro/saturation';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'sw-indonesia',
  name: 'Sw — Indonesia',
  description: 'Saturación de agua para formaciones arcillosas con agua dulce (ecuación de Poupon y Leveaux).',
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
    n: SHARED_PARAMS.n,
    rsh: SHARED_PARAMS.rsh,
  },
  outputs: {
    sw: output.curve('SW'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      const { a, m, n: nExp, rsh } = s.params;
      for (let i = s.start; i < s.end; i++) {
        out[i] = indonesiaSw(inputs.rt[i]!, inputs.phi[i]!, inputs.vsh[i]!, inputs.rw[i]!, rsh, a, m, nExp);
      }
    }
    return { sw: out };
  },
  docs: {
    summary: 'Saturación de agua de Indonesia (Poupon–Leveaux): modelo de arenas arcillosas que se comporta bien con arcillas abundantes. Con Vsh = 0 se reduce a Archie.',
    equations: [
      {
        latex: 'S_w = \\left[\\frac{1/\\sqrt{R_t}}{\\dfrac{V_{sh}^{\\,1 - V_{sh}/2}}{\\sqrt{R_{sh}}} + \\dfrac{\\phi^{m/2}}{\\sqrt{a\\,R_w}}}\\right]^{2/n}',
        description: 'Se recorta a [0, 1].',
      },
    ],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.', 'Poupon, A. y Leveaux, J. (1971). Evaluation of water saturation in shaly formations. The Log Analyst 12(4).'],
  },
});
