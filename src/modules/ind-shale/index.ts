/**
 * Indicador de arcilla: bandera 0/1/NaN donde Vsh supera el máximo del reservorio. Ver 0017.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { shaleFlagInto } from '../../petro/indicators';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'ind-shale',
  name: 'Indicador de arcilla',
  description: 'Marca las muestras con más arcilla que el máximo del reservorio.',
  category: 'indicators',
  categoryLabel: 'Indicadores',
  workspace: 'petrophysics',
  roles: [
    {
      id: 'IND_SHALE',
      label: 'Bandera de arcilla',
      unit: 'unitless',
      family: 'flag',
      origin: 'computed',
      description: 'Vsh por encima de la Vsh máxima.',
      display: { color: '#8a6d4b', scale: 'linear', min: 0, max: 1 },
    },
  ],
  inputs: {
    vsh: input.curve('VSH'),
  },
  params: {
    vshCutoff: SHARED_PARAMS.vshCutoff,
  },
  outputs: {
    shale: output.curve('IND_SHALE'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) shaleFlagInto(inputs.vsh, out, s.params.vshCutoff, s.start, s.end);
    return { shale: out };
  },
  docs: {
    summary:
      'Arcilla: 1 donde el volumen de arcilla supera el máximo, 0 donde no, sin dato donde falta Vsh. Usa la misma Vsh máxima que los cutoffs de reservorio (un solo control): es el complemento exacto del corte de Vsh, así que Vsh = máximo no es arcilla (es reservorio por Vsh). El valor por defecto (0,4) es el del módulo de cutoffs.',
    equations: [{ latex: 'SHALE = 1 \\iff V_{sh} > V_{sh,max}', description: 'Si no, 0.' }],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
      'Worthington, P. F. y Cosentino, L. (2005). The role of cut-offs in integrated reservoir studies. SPE Reservoir Evaluation & Engineering 8(4).',
    ],
  },
});
