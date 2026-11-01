/**
 * Módulo de cutoffs — banderas de arena neta, reservorio neto (permeable) y pay neto (útil). Ver 0007 (C19, D6) y
 * 0054 (arena neta y corte opcional de permeabilidad).
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { netFlagsInto } from '../../petro/cutoffs';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'cutoffs',
  name: 'Cutoffs de reservorio y pay',
  description: 'Marca la arena neta (poco arcillosa), dentro de ella el reservorio neto (poroso y, si se pide, permeable) y, dentro de él, el pay neto (con poca agua).',
  category: 'cutoffs',
  workspace: 'petrophysics',
  roles: [
    { id: 'NET_SAND', label: 'Bandera de arena neta', unit: 'unitless', family: 'flag', origin: 'computed', display: { color: '#b89a6a', scale: 'linear', min: 0, max: 1 } },
  ],
  inputs: {
    vsh: input.curve('VSH'),
    phi: input.curve('PHIE'),
    sw: input.curve('SW'),
    perm: input.optionalCurve('PERM', { label: 'Permeabilidad (solo para el corte de k)' }),
  },
  params: {
    vshCutoff: SHARED_PARAMS.vshCutoff,
    phiCutoff: SHARED_PARAMS.phiCutoff,
    swCutoff: SHARED_PARAMS.swCutoff,
    permCutoffOn: SHARED_PARAMS.permCutoffOn,
    permCutoff: SHARED_PARAMS.permCutoff,
  },
  outputs: {
    netSand: output.curve('NET_SAND'),
    netRes: output.curve('NET_RES'),
    netPay: output.curve('NET_PAY'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const netSand = new Float64Array(n);
    const netRes = new Float64Array(n);
    const netPay = new Float64Array(n);
    const missingK = new Set<string>();
    for (const s of segments) {
      const { vshCutoff, phiCutoff, swCutoff, permCutoffOn, permCutoff } = s.params;
      const kCut = permCutoffOn && Number.isFinite(permCutoff);
      if (kCut && !inputs.perm) missingK.add(s.zoneId ?? '');
      netFlagsInto(
        inputs.vsh,
        inputs.phi,
        inputs.sw,
        netRes,
        netPay,
        { vshMax: vshCutoff, phiMin: phiCutoff, swMax: swCutoff, ...(kCut ? { permMin: permCutoff } : {}) },
        s.start,
        s.end,
        { ...(inputs.perm ? { perm: inputs.perm } : {}), outSand: netSand },
      );
    }
    if (missingK.size > 0) {
      const names = zones.filter((z) => missingK.has(z.id)).map((z) => z.name);
      const where = names.length > 0 ? `en ${names.length === 1 ? 'la zona' : 'las zonas'} ${names.join(', ')}` : 'en el pozo';
      warn(
        `El corte de permeabilidad está activo ${where} pero no hay curva de permeabilidad: el reservorio que no descartan Vsh y φ queda sin dato. Calculá k (Timur, Coates o corona) o desactivá el corte.`,
      );
    }
    return { netSand, netRes, netPay };
  },
  docs: {
    summary:
      'Arena neta: Vsh no mayor que el máximo. Reservorio neto (permeable): arena neta con porosidad no menor que el mínimo y, si se activa el corte de permeabilidad, k no menor que el mínimo. Pay neto (útil): reservorio neto con Sw no mayor que el máximo. Los cortes son inclusivos y pueden cambiar por zona. Si una curva conocida no pasa su corte, la muestra no es reservorio aunque falte otra; solo queda sin dato si ninguna la descarta y falta alguna (con el corte de k activo, también k). Un reservorio sin Sw queda sin dato de pay (no se cuenta como no pay). Con el corte de k desactivado la permeabilidad no interviene.',
    equations: [
      { latex: 'NET_{arena} = 1 \\iff V_{sh} \\le V_{sh,max}', description: 'Si no, 0.' },
      {
        latex: 'NET_{res} = 1 \\iff NET_{arena} = 1\\ \\wedge\\ \\phi_e \\ge \\phi_{min}\\ \\wedge\\ (k \\ge k_{min})',
        description: 'El término de k solo cuenta con el corte de permeabilidad activo. Si no, 0.',
      },
      { latex: 'NET_{pay} = 1 \\iff NET_{res} = 1\\ \\wedge\\ S_w \\le S_{w,max}', description: 'Si no, 0.' },
      { latex: 'H_{pay} \\le H_{res} \\le H_{arena} \\le H_{bruto}', description: 'Por construcción, cada espesor está contenido en el anterior.' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
      'Worthington, P. F. y Cosentino, L. (2005). The role of cut-offs in integrated reservoir studies. SPE Reservoir Evaluation & Engineering 8(4).',
      'Worthington, P. F. (2010). Net pay — what is it? What does it do? How do we quantify it? How do we use it? SPE Reservoir Evaluation & Engineering 13(5).',
    ],
  },
});
