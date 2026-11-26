/**
 * G06 — Índice de rayos gamma desde CGR (docs/decisiones/0090).
 *
 * Segunda fuente del puerto IGR, con extremos propios por zona. Va después de `igr` en MODULES: el IGR por defecto
 * sigue saliendo del GR total; el usuario elige esta fuente o la compara. Definición PURA (Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { gammaRayIndexInto } from '../../petro/igr';

export default defineModule({
  id: 'igr-cgr',
  name: 'Índice de rayos gamma desde CGR',
  description: 'Normaliza el GR sin uranio entre la arena limpia y la arcilla: el uranio no infla el volumen de arcilla.',
  category: 'shale',
  workspace: 'petrophysics',
  inputs: {
    cgr: input.curve('CGR'),
  },
  params: {
    cgrClean: param.number({
      label: 'CGR de arena limpia',
      tooltip: 'Lectura de GR sin uranio en la arena más limpia de la zona.',
      default: 20,
      min: 0,
      max: 150,
      step: 0.5,
      unit: 'gAPI',
      scope: 'zone',
    }),
    cgrShale: param.number({
      label: 'CGR de arcilla',
      tooltip: 'Lectura de GR sin uranio en las arcillas de la zona.',
      default: 100,
      min: 10,
      max: 300,
      step: 0.5,
      unit: 'gAPI',
      scope: 'zone',
    }),
  },
  outputs: {
    igr: output.curve('IGR'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      if (s.params.cgrShale <= s.params.cgrClean) {
        const where = s.zoneId
          ? `en la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}`
          : 'fuera de las zonas';
        warn(`${where}, el CGR de arcilla no supera al de arena limpia: el índice queda sin dato.`, {
          zoneId: s.zoneId ?? undefined,
        });
      }
      gammaRayIndexInto(inputs.cgr, out, s.params.cgrClean, s.params.cgrShale, s.start, s.end);
    }
    return { igr: out };
  },
  docs: {
    summary:
      'Índice de rayos gamma calculado con el GR sin uranio (CGR): posición relativa entre la arena limpia y la arcilla, con extremos propios porque la escala de CGR es menor que la del GR total.',
    equations: [
      {
        latex: 'I_{GR} = \\frac{CGR - CGR_{limpia}}{CGR_{arcilla} - CGR_{limpia}}',
        description: 'Se recorta al intervalo [0, 1]. Extremos por zona, independientes de los del GR total.',
      },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
      'Ellis, D. V. y Singer, J. M. (2007). Well Logging for Earth Scientists, 2.ª ed. Springer, cap. 7.',
    ],
    notes:
      'No reemplaza al índice desde GR total: es otra fuente del mismo puerto. Elegila en el paso Arcilla o comparala para ver el impacto en Vsh, porosidad efectiva y pay (ADR 0090).',
  },
});
