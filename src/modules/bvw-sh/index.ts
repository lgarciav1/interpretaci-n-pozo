/**
 * Módulo BVW y SH — volumen de agua a granel y saturación de hidrocarburos. Ver 0007, C16.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { bulkVolumeWaterInto, hydrocarbonSaturationInto } from '../../petro/saturation';

export default defineModule({
  id: 'bvw-sh',
  name: 'Volumen de agua y saturación de hidrocarburos',
  description: 'Volumen de agua por volumen de roca (BVW) y saturación de hidrocarburos (Sh).',
  category: 'saturation',
  workspace: 'petrophysics',
  inputs: {
    phi: input.curve('PHIE'),
    sw: input.curve('SW'),
  },
  params: {},
  outputs: {
    bvw: output.curve('BVW'),
    sh: output.curve('SH'),
  },
  compute({ n, inputs }) {
    const bvw = new Float64Array(n);
    const sh = new Float64Array(n);
    bulkVolumeWaterInto(inputs.phi, inputs.sw, bvw);
    hydrocarbonSaturationInto(inputs.sw, sh);
    return { bvw, sh };
  },
  docs: {
    summary: 'Volumen de agua a granel y saturación de hidrocarburos. BVW constante en una zona indica saturación irreducible.',
    equations: [
      { latex: 'BVW = \\phi_e\\,S_w' },
      { latex: 'S_h = 1 - S_w' },
    ],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.', 'Buckles, R. S. (1965). Correlating and averaging connate water saturation data. J. Canadian Petroleum Technology 4(1).'],
  },
});
