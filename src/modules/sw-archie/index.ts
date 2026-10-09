/**
 * Módulo SW — saturación de agua de Archie. Ver 0007, C13.
 * Bucle por segmento con la función escalar: Rw varía muestra a muestra (curva RW, corregida por temperatura).
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { archieSw } from '../../petro/saturation';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'sw-archie',
  name: 'Sw — Archie',
  description: 'Saturación de agua para arenas limpias a partir de la resistividad profunda, la porosidad y Rw.',
  category: 'saturation',
  workspace: 'petrophysics',
  inputs: {
    rt: input.curve('RT'),
    phi: input.curve('PHIE'),
    rw: input.curve('RW'),
  },
  params: {
    a: SHARED_PARAMS.a,
    m: SHARED_PARAMS.m,
    n: SHARED_PARAMS.n,
  },
  outputs: {
    sw: output.curve('SW'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      const { a, m, n: nExp } = s.params;
      for (let i = s.start; i < s.end; i++) out[i] = archieSw(inputs.rt[i]!, inputs.phi[i]!, inputs.rw[i]!, a, m, nExp);
    }
    return { sw: out };
  },
  docs: {
    summary: 'Saturación de agua de Archie, válida en arenas limpias (sin arcilla). En formaciones arcillosas sobrestima Sw.',
    equations: [{ latex: 'S_w = \\left(\\frac{a\\,R_w}{\\phi^{m}\\,R_t}\\right)^{1/n}', description: 'Se recorta a [0, 1].' }],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.', 'Archie, G. E. (1942). The electrical resistivity log as an aid in determining some reservoir characteristics. Trans. AIME 146.'],
  },
});
