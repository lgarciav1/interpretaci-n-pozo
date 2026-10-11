/**
 * Indicador de derrumbe: bandera 0/1/NaN donde el caliper supera al trépano más una tolerancia. Mismo criterio que
 * el control de calidad (`io/qc.ts`, función `isWashout`). Ver 0017. Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { MIN_VALID_CALIPER_IN, WASHOUT_TOLERANCE_IN, washoutFlagInto } from '../../petro/indicators';

export default defineModule({
  id: 'ind-washout',
  name: 'Indicador de derrumbe',
  description: 'Marca los tramos donde el caliper supera al diámetro del trépano.',
  category: 'indicators',
  categoryLabel: 'Indicadores',
  workspace: 'petrophysics',
  roles: [
    {
      id: 'IND_WASHOUT',
      label: 'Bandera de derrumbe',
      unit: 'unitless',
      family: 'flag',
      origin: 'computed',
      description: 'Caliper por encima del trépano más la tolerancia.',
      display: { color: '#5f87a8', scale: 'linear', min: 0, max: 1 },
    },
  ],
  inputs: {
    cali: input.curve('CALI'),
    bs: input.optionalCurve('BS'),
  },
  params: {
    tolerance: param.number({
      label: 'Tolerancia de derrumbe',
      tooltip: 'Cuánto debe superar el caliper al trépano para marcar derrumbe. 1 pulgada es el criterio del control de calidad.',
      default: WASHOUT_TOLERANCE_IN,
      min: 0,
      max: 4,
      step: 0.05,
      unit: 'in',
      scope: 'zone',
    }),
    bitSize: param.number({
      label: 'Trépano nominal',
      tooltip: 'Diámetro del trépano que se usa donde el pozo no tiene curva de trépano (BS).',
      default: 8.5,
      min: 4,
      max: 26,
      step: 0.125,
      unit: 'in',
      scope: 'zone',
    }),
  },
  outputs: {
    washout: output.curve('IND_WASHOUT'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) washoutFlagInto(inputs.cali, inputs.bs, out, s.params.bitSize, s.params.tolerance, MIN_VALID_CALIPER_IN, s.start, s.end);
    return { washout: out };
  },
  docs: {
    summary:
      'Derrumbe: 1 donde el caliper supera al trépano en más que la tolerancia; 0 donde no; sin dato donde el caliper falta o es inválido (menor que 5 in, que el control de calidad informa aparte). Es el mismo criterio que el control de calidad, con borde ESTRICTO: caliper − trépano exactamente igual a la tolerancia no es derrumbe. Donde no hay curva de trépano se usa el diámetro nominal. Las curvas de patín (densidad, PE) no son confiables en estos tramos.',
    equations: [{ latex: 'WASHOUT = 1 \\iff CALI - BS > \\delta', description: 'Si no, 0. CALI ≥ 5 in; sin BS se usa el trépano nominal.' }],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16, cap. 4 (caliper).',
      'Schlumberger (1989). Log Interpretation Principles/Applications.',
    ],
  },
});
