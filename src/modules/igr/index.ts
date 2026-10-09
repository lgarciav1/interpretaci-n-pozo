/**
 * Módulo IGR — índice de rayos gamma.
 *
 * EJEMPLO DE FASE 1: demuestra el contrato de módulo (entradas por rol, parámetros por zona, salida de curva).
 * La petrofísica real (y su validación contra ejemplos de libro) es la fase 5.
 *
 * Definición PURA: no importar React ni nada de la interfaz (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { gammaRayIndexInto } from '../../petro/igr';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'igr',
  name: 'Índice de rayos gamma',
  description: 'Normaliza el perfil de rayos gamma entre la línea de arena limpia y la de arcilla.',
  category: 'shale',
  workspace: 'petrophysics',
  inputs: {
    gr: input.curve('GR'),
  },
  params: {
    // Compartidos: los usan también otros métodos de arcillosidad (ver sharedParams.ts).
    grClean: SHARED_PARAMS.grClean,
    grShale: SHARED_PARAMS.grShale,
  },
  outputs: {
    igr: output.curve('IGR'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      if (s.params.grShale <= s.params.grClean) {
        const where = s.zoneId ? `en la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}` : 'fuera de las zonas';
        warn(`${where}, el GR de arcilla no supera al de arena limpia: el índice queda sin dato.`);
      }
      gammaRayIndexInto(inputs.gr, out, s.params.grClean, s.params.grShale, s.start, s.end);
    }
    return { igr: out };
  },
  docs: {
    summary: 'Índice de rayos gamma: posición relativa de la lectura de GR entre la arena limpia y la arcilla.',
    equations: [
      {
        latex: 'I_{GR} = \\frac{GR - GR_{limpia}}{GR_{arcilla} - GR_{limpia}}',
        description: 'Se recorta al intervalo [0, 1].',
      },
    ],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.'],
  },
});
