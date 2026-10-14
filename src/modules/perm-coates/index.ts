/**
 * Módulo PERM — permeabilidad de Timur–Coates (RMN). Ver 0007, C18.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { timurCoatesPermeabilityInto } from '../../petro/permeability';

export default defineModule({
  id: 'perm-coates',
  name: 'Permeabilidad — Timur–Coates (RMN)',
  description: 'Permeabilidad a partir de la porosidad y el fluido irreducible (BVI) de la resonancia magnética.',
  category: 'permeability',
  workspace: 'petrophysics',
  inputs: {
    phiNmr: input.optionalCurve('PHIE_NMR'),
    phie: input.optionalCurve('PHIE'),
    bvi: input.curve('BVI_NMR'),
  },
  // Sin porosidad (RMN ni efectiva) la permeabilidad queda sin dato: hace falta alguna (0032).
  inputGroups: [{ inputs: ['phiNmr', 'phie'], label: 'una porosidad (RMN o efectiva de perfiles)' }],
  params: {
    porosity: param.enum({
      label: 'Porosidad',
      tooltip:
        'La forma original usa la porosidad de la resonancia (BVI y porosidad de la misma herramienta). La porosidad efectiva de perfiles mezcla herramientas y puede dar FFI inconsistente.',
      options: [
        { value: 'nmr', label: 'Porosidad RMN' },
        { value: 'phie', label: 'Porosidad efectiva de perfiles' },
      ],
      default: 'nmr',
      scope: 'zone',
    }),
    c: param.number({
      label: 'Constante C',
      tooltip: 'Constante de calibración de Timur–Coates (en unidades de porosidad). Se ajusta con la permeabilidad de corona.',
      default: 10,
      min: 1,
      max: 50,
      step: 0.1,
      scope: 'zone',
    }),
  },
  outputs: {
    k: output.curve('PERM'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      const where = s.zoneId ? `en la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}` : 'fuera de las zonas';
      const wantNmr = s.params.porosity === 'nmr';
      const chosen = wantNmr ? inputs.phiNmr : inputs.phie;
      const other = wantNmr ? inputs.phie : inputs.phiNmr;
      const names = wantNmr ? { want: 'RMN', alt: 'efectiva de perfiles' } : { want: 'efectiva de perfiles', alt: 'RMN' };
      let phi = chosen;
      if (!phi) {
        if (other) {
          warn(`${where} no hay porosidad ${names.want}: se usa la porosidad ${names.alt}.`);
          phi = other;
        } else {
          warn(`${where} no hay porosidad RMN ni efectiva: la permeabilidad queda sin dato.`);
          out.fill(NaN, s.start, s.end);
          continue;
        }
      }
      timurCoatesPermeabilityInto(phi, inputs.bvi, out, s.params.c, s.start, s.end);
    }
    return { k: out };
  },
  docs: {
    summary: 'Permeabilidad de Timur–Coates con datos de resonancia magnética: depende de la relación entre fluido libre (FFI) y fluido irreducible (BVI).',
    equations: [
      { latex: 'k = \\left(\\frac{100\\,\\phi}{C}\\right)^{4}\\left(\\frac{FFI}{BVI}\\right)^{2}, \\quad FFI = \\phi - BVI', description: 'k en mD; φ, FFI y BVI en v/v.' },
    ],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.', 'Coates, G. R. y Dumanoir, J. L. (1974). A new approach to improved log-derived permeability. The Log Analyst 15(1).'],
  },
});
