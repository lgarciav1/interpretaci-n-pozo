/**
 * Módulo PHIS — porosidad sónica de Wyllie con factor de compactación opcional. Ver 0007, C4.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { sonicPorosityWyllie } from '../../petro/porosity';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'phi-sonic-wyllie',
  name: 'Porosidad sónica — Wyllie',
  description: 'Porosidad a partir del tiempo de tránsito compresional, con promedio en tiempo y factor de compactación.',
  category: 'porosity',
  workspace: 'petrophysics',
  inputs: {
    dt: input.curve('DT'),
  },
  params: {
    dtMa: SHARED_PARAMS.dtMa,
    dtFl: param.number({
      label: 'Δt del fluido',
      tooltip: 'Tiempo de tránsito del fluido que satura la roca investigada: 189 µs/ft para lodo dulce, ~185 para lodo salado.',
      default: 189,
      min: 150,
      max: 240,
      step: 1,
      unit: 'us/ft',
      scope: 'zone',
    }),
    cp: param.number({
      label: 'Factor de compactación (Cp)',
      tooltip: 'Corrige la sobreestimación en arenas poco consolidadas (lecturas de Δt altas en la arcilla vecina). 1 = sin corrección.',
      default: 1,
      min: 1,
      max: 2,
      step: 0.01,
      unit: 'unitless',
      scope: 'zone',
    }),
  },
  outputs: {
    phis: output.curve('PHIS'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      const { dtMa, dtFl, cp } = s.params;
      if (dtFl <= dtMa) {
        const where = s.zoneId ? `en la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}` : 'fuera de las zonas';
        warn(`${where}, el Δt del fluido no supera al de la matriz: la porosidad sónica queda sin dato.`);
      }
      for (let i = s.start; i < s.end; i++) out[i] = sonicPorosityWyllie(inputs.dt[i]!, dtMa, dtFl, cp);
    }
    return { phis: out };
  },
  docs: {
    summary:
      'Porosidad sónica de Wyllie (promedio en tiempo). Con el factor de compactación Cp > 1 se corrige la sobreestimación en arenas poco consolidadas.',
    equations: [
      {
        latex: '\\phi_S = \\frac{1}{C_p}\\,\\frac{\\Delta t - \\Delta t_{ma}}{\\Delta t_{f} - \\Delta t_{ma}}',
        description: 'Se recorta a [0; 0,5]. Δt en µs/ft; Cp = 1 sin corrección.',
      },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16, cap. 5.',
      'Wyllie, M. R. J., Gregory, A. R. y Gardner, L. W. (1956). Elastic wave velocities in heterogeneous and porous media. Geophysics 21(1).',
    ],
  },
});
