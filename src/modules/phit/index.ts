/**
 * Módulo PHIT — porosidad total. Un módulo con el método elegido por zona (el gas y los derrumbes cambian de zona
 * a zona). Sus entradas son opcionales: usa las porosidades que haya. Ver 0007, C6.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import {
  densityNeutronGasPorosityInto,
  densityNeutronPorosity,
  densityNeutronPorosityInto,
} from '../../petro/porosity';

const METHOD_NEEDS = {
  densityNeutron: ['PHID', 'PHIN'],
  densityNeutronGas: ['PHID', 'PHIN'],
  density: ['PHID'],
  neutron: ['PHIN'],
  sonic: ['PHIS'],
} as const;

const METHOD_LABEL = {
  densityNeutron: 'densidad–neutrón',
  densityNeutronGas: 'densidad–neutrón (gas)',
  density: 'de densidad',
  neutron: 'neutrónico',
  sonic: 'sónico',
} as const;

function copyRange(src: ArrayLike<number>, out: Float64Array, start: number, end: number): void {
  for (let i = start; i < end; i++) out[i] = src[i]!;
}

export default defineModule({
  id: 'phit',
  name: 'Porosidad total',
  description: 'Combina las porosidades de densidad, neutrón y sónico según el método elegido para cada zona.',
  category: 'porosity',
  workspace: 'petrophysics',
  inputs: {
    phid: input.optionalCurve('PHID'),
    phin: input.optionalCurve('PHIN'),
    phis: input.optionalCurve('PHIS'),
  },
  params: {
    method: param.enum({
      label: 'Método',
      tooltip:
        'Automático usa densidad–neutrón donde hay las dos curvas, si no densidad y si no sónico. En zonas con gas conviene la variante «gas», que no subestima la porosidad.',
      options: [
        { value: 'auto', label: 'Automático' },
        { value: 'densityNeutron', label: 'Densidad–neutrón' },
        { value: 'densityNeutronGas', label: 'Densidad–neutrón (gas)' },
        { value: 'density', label: 'Densidad' },
        { value: 'neutron', label: 'Neutrón' },
        { value: 'sonic', label: 'Sónico' },
      ],
      default: 'auto',
      scope: 'zone',
    }),
  },
  outputs: {
    phit: output.curve('PHIT'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const { phid, phin, phis } = inputs;
    const out = new Float64Array(n);
    const have = { PHID: phid !== undefined, PHIN: phin !== undefined, PHIS: phis !== undefined };
    if (!have.PHID && !have.PHIN && !have.PHIS) {
      warn('No hay ninguna curva de porosidad (densidad, neutrón o sónico): la porosidad total queda sin dato.');
      out.fill(NaN);
      return { phit: out };
    }
    for (const s of segments) {
      const where = s.zoneId ? `la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}` : 'el tramo fuera de las zonas';
      const method = s.params.method;
      if (method === 'auto') {
        for (let i = s.start; i < s.end; i++) {
          const d = phid ? phid[i]! : NaN;
          const nn = phin ? phin[i]! : NaN;
          const so = phis ? phis[i]! : NaN;
          if (!Number.isNaN(d) && !Number.isNaN(nn)) out[i] = densityNeutronPorosity(d, nn);
          else if (!Number.isNaN(d)) out[i] = d;
          else if (!Number.isNaN(so)) out[i] = so;
          else out[i] = NaN;
        }
        continue;
      }
      const missing = METHOD_NEEDS[method].filter((r) => !have[r]);
      if (missing.length > 0) {
        warn(`En ${where} el método ${METHOD_LABEL[method]} necesita ${missing.join(' y ')}, que no está disponible: ese tramo queda sin dato.`);
        out.fill(NaN, s.start, s.end);
        continue;
      }
      switch (method) {
        case 'densityNeutron':
          densityNeutronPorosityInto(phid!, phin!, out, s.start, s.end);
          break;
        case 'densityNeutronGas':
          densityNeutronGasPorosityInto(phid!, phin!, out, s.start, s.end);
          break;
        case 'density':
          copyRange(phid!, out, s.start, s.end);
          break;
        case 'neutron':
          copyRange(phin!, out, s.start, s.end);
          break;
        case 'sonic':
          copyRange(phis!, out, s.start, s.end);
          break;
      }
    }
    return { phit: out };
  },
  docs: {
    summary:
      'Porosidad total a partir de las porosidades de densidad, neutrón y sónico. En modo automático llena huecos muestra a muestra: densidad–neutrón, si no densidad, si no sónico.',
    equations: [
      { latex: '\\phi_{DN} = \\frac{\\phi_D + \\phi_N}{2}', description: 'Densidad–neutrón.' },
      { latex: '\\phi_{DN,gas} = \\sqrt{\\frac{\\phi_D^2 + \\phi_N^2}{2}}', description: 'Densidad–neutrón en zonas con gas.' },
    ],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.'],
  },
});
