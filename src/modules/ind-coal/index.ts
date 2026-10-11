/**
 * Indicador de carbón: bandera 0/1/NaN donde la densidad es muy baja y el sónico o el neutrón la confirman. Ver 0017.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { COAL_DT_MIN, COAL_NPHI_MIN, COAL_RHOB_MAX, coalFlagInto } from '../../petro/indicators';

export default defineModule({
  id: 'ind-coal',
  name: 'Indicador de carbón',
  description: 'Marca densidad muy baja con sónico o neutrón altos (la firma del carbón).',
  category: 'indicators',
  categoryLabel: 'Indicadores',
  workspace: 'petrophysics',
  roles: [
    {
      id: 'IND_COAL',
      label: 'Bandera de carbón',
      unit: 'unitless',
      family: 'flag',
      origin: 'computed',
      description: 'Densidad baja con Δt o neutrón altos.',
      display: { color: '#3a3a3a', scale: 'linear', min: 0, max: 1 },
    },
  ],
  inputs: {
    rhob: input.curve('RHOB'),
    dt: input.optionalCurve('DT'),
    nphi: input.optionalCurve('NPHI'),
  },
  params: {
    rhobMax: param.number({
      label: 'Densidad máxima',
      tooltip: 'Por debajo de esta densidad (o igual) la roca puede ser carbón. Los carbones leen 1,2–1,8 g/cm³; 2,0 deja margen.',
      default: COAL_RHOB_MAX,
      min: 1,
      max: 2.4,
      step: 0.01,
      unit: 'g/cm3',
      scope: 'zone',
    }),
    dtMin: param.number({
      label: 'Δt mínimo',
      tooltip: 'Tiempo de tránsito a partir del cual el sónico confirma carbón (≈ 105–140 µs/ft en carbones).',
      default: COAL_DT_MIN,
      min: 60,
      max: 160,
      step: 1,
      unit: 'us/ft',
      scope: 'zone',
    }),
    nphiMin: param.number({
      label: 'Neutrón mínimo',
      tooltip: 'Porosidad neutrónica a partir de la cual el neutrón confirma carbón (alto contenido de hidrógeno).',
      default: COAL_NPHI_MIN,
      min: 0.1,
      max: 0.8,
      step: 0.01,
      unit: 'v/v',
      scope: 'zone',
    }),
  },
  outputs: {
    coal: output.curve('IND_COAL'),
  },
  compute({ n, inputs, segments, warn }) {
    const out = new Float64Array(n);
    if (!inputs.dt && !inputs.nphi) warn('Sin sónico ni neutrón: no se puede confirmar el carbón; la bandera queda sin dato donde la densidad es baja.');
    for (const s of segments) {
      const { rhobMax, dtMin, nphiMin } = s.params;
      coalFlagInto(inputs.rhob, inputs.dt, inputs.nphi, out, rhobMax, dtMin, nphiMin, s.start, s.end);
    }
    return { coal: out };
  },
  docs: {
    summary:
      'Carbón: densidad muy baja (hasta el máximo, inclusive) confirmada por un Δt alto o un neutrón alto (basta uno, inclusive). 0 si la densidad supera el máximo o si, sin que falte ninguna curva, ninguna confirmación se cumple; sin dato si falta la densidad, o si la densidad es baja, nada confirma y falta el sónico o el neutrón. Los umbrales son criterios prácticos de libro (carbones 1,2–1,8 g/cm³, Δt ≈ 105–140 µs/ft, neutrón alto), no cortes universales. Areniscas poco consolidadas y derrumbes pueden dar falsos positivos: compará con el indicador de derrumbe.',
    equations: [
      {
        latex: 'COAL = 1 \\iff \\rho_b \\le \\rho_{max}\\ \\wedge\\ (\\Delta t \\ge \\Delta t_{min}\\ \\vee\\ \\phi_N \\ge \\phi_{N,min})',
        description: 'Si no, 0 (o sin dato si falta una curva de confirmación).',
      },
    ],
    references: [
      'Rider, M. y Kennedy, M. (2011). The Geological Interpretation of Well Logs, 3.ª ed. Rider-French Consulting.',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
    ],
  },
});
