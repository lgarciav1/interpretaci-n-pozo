/**
 * Módulo VSH — volumen de arcilla a partir del índice de rayos gamma.
 * Un solo módulo con el método elegido por zona (la edad de la roca cambia de zona a zona). Ver 0007, C1.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { vshFromIgrInto } from '../../petro/vsh';

export default defineModule({
  id: 'vsh',
  name: 'Volumen de arcilla',
  description: 'Transforma el índice de rayos gamma en volumen de arcilla con el método elegido para cada zona.',
  category: 'shale',
  workspace: ['petrophysics', 'geology'],
  inputs: {
    igr: input.curve('IGR'),
  },
  params: {
    method: param.enum({
      label: 'Método',
      tooltip:
        'Lineal es el más pesimista (más arcilla). Larionov para rocas terciarias y Clavier reducen la arcilla en rocas jóvenes; Larionov para rocas antiguas y Steiber, en rocas más consolidadas.',
      options: [
        { value: 'linear', label: 'Lineal (IGR)' },
        { value: 'larionovTertiary', label: 'Larionov — rocas terciarias' },
        { value: 'larionovOlder', label: 'Larionov — rocas antiguas' },
        { value: 'clavier', label: 'Clavier' },
        { value: 'steiber', label: 'Steiber' },
      ],
      default: 'linear',
      scope: 'zone',
    }),
  },
  outputs: {
    vsh: output.curve('VSH'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) vshFromIgrInto(inputs.igr, out, s.params.method, s.start, s.end);
    return { vsh: out };
  },
  docs: {
    summary:
      'Volumen de arcilla a partir del índice de rayos gamma. El método se elige por zona: el lineal es el límite superior; las transformadas no lineales de Larionov, Clavier y Steiber lo reducen según la edad y la consolidación de la roca.',
    equations: [
      { latex: 'V_{sh} = I_{GR}', description: 'Lineal.' },
      { latex: 'V_{sh} = 0{,}083\\,(2^{3{,}7\\,I_{GR}} - 1)', description: 'Larionov, rocas terciarias.' },
      { latex: 'V_{sh} = 0{,}33\\,(2^{2\\,I_{GR}} - 1)', description: 'Larionov, rocas antiguas.' },
      { latex: 'V_{sh} = 1{,}7 - \\sqrt{3{,}38 - (I_{GR} + 0{,}7)^2}', description: 'Clavier.' },
      { latex: 'V_{sh} = \\frac{I_{GR}}{3 - 2\\,I_{GR}}', description: 'Steiber.' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
      'Larionov, V. V. (1969). Borehole Radiometry. Moscú: Nedra.',
      'Clavier, C., Hoyle, W. y Meunier, D. (1971). Quantitative interpretation of thermal neutron decay time logs. JPT.',
      'Steiber, R. G. (1970). Optimization of shale volumes in open hole logs. JPT.',
    ],
  },
});
