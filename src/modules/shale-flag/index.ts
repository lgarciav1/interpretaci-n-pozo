/**
 * Módulo "Bandera de arcilla" — consume IGR y produce una bandera, un escalar y una tabla por zona.
 *
 * EJEMPLO DE FASE 1: existe para demostrar el encadenamiento (IGR → bandera), la invalidación incremental
 * (mover el corte no recalcula IGR) y las salidas no-curva (escalar y tabla por zona). No es un cutoff real:
 * los cutoffs de reservorio y pay son de una fase posterior.
 */
import { defineModule, input, output, type TableValue } from '../../core/module';
import { param } from '../../core/params';
import { thresholdFlagInto } from '../../petro/flags';
import { intervalStats, thicknessWhere } from '../../petro/stats';

export default defineModule({
  id: 'shale-flag',
  name: 'Bandera de arcilla (ejemplo)',
  description: 'Marca como arcilla las muestras con IGR mayor o igual al corte y resume por zona.',
  category: 'cutoffs',
  workspace: ['petrophysics', 'geology'],
  roles: [
    {
      id: 'SHALE_FLAG',
      label: 'Bandera de arcilla',
      unit: 'unitless',
      family: 'flag',
      origin: 'computed',
      display: { color: '#8b5a2b', scale: 'linear', min: 0, max: 1 },
    },
  ],
  inputs: {
    igr: input.curve('IGR'),
  },
  params: {
    cutoff: param.number({
      label: 'Corte de IGR',
      tooltip: 'Desde este índice, la muestra se considera arcilla.',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      unit: 'v/v',
      scope: 'zone',
    }),
  },
  outputs: {
    flag: output.curve('SHALE_FLAG'),
    cleanFraction: output.scalar('CLEAN_FRACTION', { label: 'Fracción limpia del pozo', unit: 'v/v' }),
    byZone: output.table('IGR_BY_ZONE', {
      label: 'IGR por zona',
      columns: [
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'meanIgr', label: 'IGR medio', unit: 'v/v' },
        { key: 'shaleFraction', label: 'Fracción arcillosa', unit: 'v/v' },
        { key: 'cleanThickness', label: 'Espesor limpio', unit: 'm' },
        { key: 'thickness', label: 'Espesor', unit: 'm' },
      ],
    }),
  },
  compute({ n, inputs, segments, zones, thickness }) {
    const flag = new Float64Array(n);
    for (const s of segments) thresholdFlagInto(inputs.igr, flag, s.params.cutoff, s.start, s.end);

    const rows: TableValue['rows'] = zones.map((z) => {
      const igr = intervalStats(inputs.igr, thickness, z.start, z.end);
      const clean = thicknessWhere(flag, thickness, 0, z.start, z.end);
      const shale = thicknessWhere(flag, thickness, 1, z.start, z.end);
      const withData = clean + shale;
      return {
        zone: z.name,
        meanIgr: Number.isNaN(igr.mean) ? null : igr.mean,
        shaleFraction: withData > 0 ? shale / withData : null,
        cleanThickness: clean,
        thickness: igr.thickness,
      };
    });
    const clean = thicknessWhere(flag, thickness, 0);
    const shale = thicknessWhere(flag, thickness, 1);
    return {
      flag,
      cleanFraction: clean + shale > 0 ? clean / (clean + shale) : NaN,
      byZone: { rows },
    };
  },
  docs: {
    summary: 'Bandera binaria de arcilla a partir de IGR y un corte por zona, con resumen por zona.',
    equations: [{ latex: 'F_{arcilla} = \\begin{cases} 1 & I_{GR} \\geq I_{corte} \\\\ 0 & I_{GR} < I_{corte} \\end{cases}' }],
    references: [],
    notes: 'Módulo de ejemplo de la fase 1.',
  },
});
