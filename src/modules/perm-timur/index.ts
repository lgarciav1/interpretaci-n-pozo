/**
 * Módulo PERM — permeabilidad de Timur. Ver 0007, C17.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { timurPermeability, timurPermeabilityInto } from '../../petro/permeability';

export default defineModule({
  id: 'perm-timur',
  name: 'Permeabilidad — Timur',
  description: 'Permeabilidad empírica a partir de la porosidad efectiva y la saturación de agua irreducible.',
  category: 'permeability',
  workspace: 'petrophysics',
  inputs: {
    phi: input.curve('PHIE'),
    sw: input.optionalCurve('SW'),
  },
  params: {
    swirrFrom: param.enum({
      label: 'Origen de Swirr',
      tooltip: 'Valor fijo usa el número de abajo. Sw calculada solo es válida si la zona está a saturación irreducible (sin agua móvil).',
      options: [
        { value: 'param', label: 'Valor fijo' },
        { value: 'sw', label: 'Sw calculada (zona a saturación irreducible)' },
      ],
      default: 'param',
      scope: 'zone',
    }),
    swirr: param.number({
      label: 'Saturación de agua irreducible',
      tooltip: 'Saturación de agua que no se mueve. Valores bajos dan permeabilidades muy altas: es el parámetro más sensible.',
      default: 0.25,
      min: 0.05,
      max: 0.9,
      step: 0.01,
      unit: 'v/v',
      scope: 'zone',
    }),
  },
  outputs: {
    k: output.curve('PERM'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      if (s.params.swirrFrom === 'sw') {
        const sw = inputs.sw;
        if (sw) {
          for (let i = s.start; i < s.end; i++) out[i] = timurPermeability(inputs.phi[i]!, sw[i]!);
          continue;
        }
        const where = s.zoneId ? `en la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}` : 'fuera de las zonas';
        warn(`${where} se pidió usar la Sw calculada pero no hay curva de Sw: se usa la saturación irreducible fija.`);
      }
      timurPermeabilityInto(inputs.phi, out, s.params.swirr, s.start, s.end);
    }
    return { k: out };
  },
  docs: {
    summary: 'Permeabilidad de Timur: relación empírica entre porosidad y saturación de agua irreducible, calibrada en areniscas. Es una estimación de orden de magnitud: calibrar con la corona.',
    equations: [{ latex: 'k = \\left(\\frac{100\\,\\phi^{2{,}25}}{S_{wirr}}\\right)^{2}', description: 'k en mD, φ y Swirr en v/v.' }],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.', 'Timur, A. (1968). An investigation of permeability, porosity, and residual water saturation relationships for sandstone reservoirs. The Log Analyst 9(4).'],
  },
});
