/**
 * Módulo de cutoffs — banderas de reservorio neto y pay neto. Ver 0007, C19 y D6.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { netFlagsInto } from '../../petro/cutoffs';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'cutoffs',
  name: 'Cutoffs de reservorio y pay',
  description: 'Marca el reservorio neto (poco arcilloso y poroso) y, dentro de él, el pay neto (con poca agua).',
  category: 'cutoffs',
  workspace: 'petrophysics',
  inputs: {
    vsh: input.curve('VSH'),
    phi: input.curve('PHIE'),
    sw: input.curve('SW'),
  },
  params: {
    vshCutoff: SHARED_PARAMS.vshCutoff,
    phiCutoff: SHARED_PARAMS.phiCutoff,
    swCutoff: SHARED_PARAMS.swCutoff,
  },
  outputs: {
    netRes: output.curve('NET_RES'),
    netPay: output.curve('NET_PAY'),
  },
  compute({ n, inputs, segments }) {
    const netRes = new Float64Array(n);
    const netPay = new Float64Array(n);
    for (const s of segments) {
      const { vshCutoff, phiCutoff, swCutoff } = s.params;
      netFlagsInto(
        inputs.vsh,
        inputs.phi,
        inputs.sw,
        netRes,
        netPay,
        { vshMax: vshCutoff, phiMin: phiCutoff, swMax: swCutoff },
        s.start,
        s.end,
      );
    }
    return { netRes, netPay };
  },
  docs: {
    summary:
      'Reservorio neto: Vsh no mayor que el máximo y porosidad no menor que el mínimo. Pay neto: reservorio neto con Sw no mayor que el máximo. Los cortes son inclusivos y pueden cambiar por zona. Si una curva conocida no pasa su corte, la muestra no es reservorio aunque falte otra; solo queda sin dato si ninguna la descarta y falta alguna. Un reservorio sin Sw queda sin dato de pay (no se cuenta como no pay).',
    equations: [
      { latex: 'NET_{res} = 1 \\iff V_{sh} \\le V_{sh,max}\\ \\wedge\\ \\phi_e \\ge \\phi_{min}', description: 'Si no, 0.' },
      { latex: 'NET_{pay} = 1 \\iff NET_{res} = 1\\ \\wedge\\ S_w \\le S_{w,max}', description: 'Si no, 0.' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
      'Worthington, P. F. y Cosentino, L. (2005). The role of cut-offs in integrated reservoir studies. SPE Reservoir Evaluation & Engineering 8(4).',
    ],
  },
});
