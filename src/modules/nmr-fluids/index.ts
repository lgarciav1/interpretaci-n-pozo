/**
 * Módulo RMN — fluido libre y ligado, agua ligada a la arcilla y comparación con la porosidad de densidad–neutrón.
 * Fase 8a, función X. Definición PURA (la ejecuta el Web Worker). La permeabilidad de Timur–Coates vive en `perm-coates`.
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import {
  NMR_DEFICIT_TOLERANCE_DEFAULT,
  boundFluidFractionInto,
  clayBoundWaterInto,
  freeFluidVolumeInto,
  nmrDeficitFlagInto,
  nmrPorosityDifferenceInto,
} from '../../petro/nmr';

export default defineModule({
  id: 'nmr-fluids',
  name: 'Resonancia magnética — fluido libre y ligado',
  description:
    'Con las curvas del CMR separa el fluido libre del ligado, calcula el agua ligada a la arcilla y compara la porosidad de RMN con la de densidad–neutrón.',
  category: 'nmr',
  categoryLabel: 'Resonancia magnética',
  workspace: 'petrophysics',
  inputs: {
    phieNmr: input.curve('PHIE_NMR'),
    bvi: input.curve('BVI_NMR'),
    phitNmr: input.optionalCurve('PHIT_NMR'),
    phie: input.optionalCurve('PHIE'),
  },
  params: {
    tolerance: param.number({
      label: 'Tolerancia de la diferencia de porosidad',
      tooltip:
        'Se marca déficit de RMN donde la porosidad de RMN queda por debajo de la de densidad–neutrón en más que este valor. Es un criterio práctico: combina la incertidumbre de las dos mediciones; subila si las curvas son ruidosas.',
      default: NMR_DEFICIT_TOLERANCE_DEFAULT,
      min: 0,
      max: 0.1,
      step: 0.005,
      unit: 'v/v',
      scope: 'zone',
    }),
  },
  outputs: {
    ffi: output.curve('FFI_NMR'),
    cbw: output.curve('CBW_NMR'),
    swirr: output.curve('SWIRR_NMR'),
    dphi: output.curve('DPHI_NMR'),
    deficit: output.curve('IND_NMR_DEFICIT'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const ffi = new Float64Array(n);
    const cbw = new Float64Array(n);
    const swirr = new Float64Array(n);
    const dphi = new Float64Array(n);
    const deficit = new Float64Array(n);
    for (const s of segments) {
      const where = s.zoneId ? `en la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}` : 'fuera de las zonas';
      freeFluidVolumeInto(inputs.phieNmr, inputs.bvi, ffi, s.start, s.end);
      boundFluidFractionInto(inputs.bvi, inputs.phieNmr, swirr, s.start, s.end);
      if (inputs.phitNmr) {
        clayBoundWaterInto(inputs.phitNmr, inputs.phieNmr, cbw, s.start, s.end);
      } else {
        warn(`${where} no hay porosidad total de RMN: el agua ligada a la arcilla queda sin dato.`);
        cbw.fill(NaN, s.start, s.end);
      }
      if (inputs.phie) {
        nmrPorosityDifferenceInto(inputs.phieNmr, inputs.phie, dphi, s.start, s.end);
        nmrDeficitFlagInto(dphi, deficit, s.params.tolerance, s.start, s.end);
      } else {
        warn(`${where} no hay porosidad efectiva de perfiles: la diferencia con la RMN y el indicador de déficit quedan sin dato.`);
        dphi.fill(NaN, s.start, s.end);
        deficit.fill(NaN, s.start, s.end);
      }
    }
    return { ffi, cbw, swirr, dphi, deficit };
  },
  docs: {
    summary:
      'Separa la porosidad de la resonancia magnética en agua ligada a la arcilla (CBW), fluido irreducible (BVI) y fluido libre (FFI), y compara la porosidad efectiva de RMN con la de densidad–neutrón. La RMN no depende de la matriz: donde lee menos que densidad–neutrón (diferencia negativa mayor que la tolerancia) hay una alerta de gas o petróleo liviano (índice de hidrógeno bajo y polarización incompleta), de crudo muy viscoso o de microporosidad que la RMN deja fuera de la porosidad efectiva. Es una alerta, no un diagnóstico: conviene contrastarla con el indicador de crossover de gas y con la resistividad. Una diferencia positiva no se marca (suele indicar una matriz mal elegida en densidad–neutrón). Valores en v/v; sin dato → sin dato; FFI y CBW se recortan a 0 si el ruido las vuelve negativas. La tolerancia es un criterio práctico, no un valor de libro.',
    equations: [
      { latex: 'FFI = \\max\\left(0,\\ \\phi_{e,RMN} - BVI\\right)', description: 'Fluido libre (v/v). Si BVI > φe,RMN, FFI = 0.' },
      { latex: 'CBW = \\max\\left(0,\\ \\phi_{t,RMN} - \\phi_{e,RMN}\\right)', description: 'Agua ligada a la arcilla (v/v): lo que la RMN ve en la porosidad total y no en la efectiva.' },
      { latex: 'S_{wirr,RMN} = \\min\\left(1,\\ \\frac{BVI}{\\phi_{e,RMN}}\\right)', description: 'Fracción de fluido ligado de la porosidad efectiva (v/v); sin dato si φe,RMN = 0.' },
      { latex: '\\Delta\\phi = \\phi_{e,RMN} - \\phi_{e}', description: 'Diferencia entre la porosidad efectiva de RMN y la de densidad–neutrón (v/v). Negativa: la RMN lee menos.' },
      { latex: 'DEF = 1 \\iff \\Delta\\phi < -tol', description: 'Indicador de déficit de RMN; si no, 0. Con Δφ = −tol no se marca.' },
    ],
    references: [
      'Coates, G. R., Xiao, L. y Prammer, M. G. (1999). NMR Logging: Principles and Applications. Halliburton Energy Services.',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
    ],
  },
});
