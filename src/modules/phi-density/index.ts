/**
 * Módulo PHID — porosidad por densidad. Ver 0007, C2.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { densityPorosityInto } from '../../petro/porosity';

export default defineModule({
  id: 'phi-density',
  name: 'Porosidad por densidad',
  description: 'Porosidad a partir de la densidad de formación, la de la matriz y la del fluido.',
  category: 'porosity',
  workspace: 'petrophysics',
  inputs: {
    rhob: input.curve('RHOB'),
  },
  params: {
    rhoMa: param.number({
      label: 'Densidad de la matriz',
      tooltip: 'Arenisca 2,65; caliza 2,71; dolomía 2,87 g/cm³.',
      default: 2.65,
      min: 2,
      max: 3.2,
      step: 0.01,
      unit: 'g/cm3',
      scope: 'zone',
    }),
    rhoFl: param.number({
      label: 'Densidad del fluido',
      tooltip: 'Fluido que satura la zona investigada: agua dulce 1,0; agua salada hasta 1,15; petróleo ≈ 0,8 g/cm³.',
      default: 1,
      min: 0.6,
      max: 1.3,
      step: 0.01,
      unit: 'g/cm3',
      scope: 'zone',
    }),
  },
  outputs: {
    phid: output.curve('PHID'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      if (s.params.rhoMa <= s.params.rhoFl) {
        const where = s.zoneId ? `en la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}` : 'fuera de las zonas';
        warn(`${where}, la densidad de la matriz no supera a la del fluido: la porosidad por densidad no es válida.`);
      }
      densityPorosityInto(inputs.rhob, out, s.params.rhoMa, s.params.rhoFl, s.start, s.end);
    }
    return { phid: out };
  },
  docs: {
    summary: 'Porosidad por densidad: relación entre la densidad de la matriz, la del fluido y la leída por la herramienta.',
    equations: [{ latex: '\\phi_D = \\frac{\\rho_{ma} - \\rho_b}{\\rho_{ma} - \\rho_{fl}}', description: 'Se recorta a [0, 0,5].' }],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.'],
  },
});
