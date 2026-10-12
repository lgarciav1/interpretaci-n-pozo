/**
 * Módulo «Zonas sugeridas» (función L; docs/decisiones/0025-zonas-sugeridas-y-electrosecuencias.md). Definición PURA
 * (la ejecuta el Web Worker).
 *
 * Propone límites de zona donde cambia el nivel del GR (y, si se eligen, de la densidad y del log10 de la resistividad
 * profunda): segmentación óptima por tramos (PELT) del motor `src/petro/segmentation.ts`. Publica una tabla con un
 * renglón por límite, ordenada por profundidad, con su fuerza y el salto de GR. El panel la lista por fuerza, la
 * filtra y acepta los límites en el modelo de zonas (una receta del proyecto: se deshace con Ctrl+Z). El motor no
 * escribe zonas: solo propone.
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { SEGMENTATION_DEFAULTS as SD, ZONE_SUGGESTION_DEFAULTS as ZD, suggestZoneBoundaries } from '../../petro/segmentation';

export const ZONE_SUGGESTIONS_ID = 'zone-suggestions';
export const ZONE_SUGGESTIONS_TABLE = 'ZONE_SUGGESTIONS';

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

export default defineModule({
  id: ZONE_SUGGESTIONS_ID,
  name: 'Zonas sugeridas',
  description: 'Propone límites de zona donde cambia el nivel del GR (y, si se eligen, de la densidad y de la resistividad), para aceptarlos de a uno o todos juntos.',
  category: 'geology',
  workspace: ['petrophysics', 'geology'],
  inputs: {
    gr: input.curve('GR'),
    rhob: input.optionalCurve('RHOB'),
    rt: input.optionalCurve('RT'),
  },
  params: {
    useDensity: param.boolean({
      label: 'Sumar la densidad',
      tooltip: 'Usa también la densidad volumétrica para ubicar y conservar límites. En muchos pozos los topes de formación se ven mejor en la densidad que en el GR.',
      default: false,
      group: 'Curvas',
    }),
    useResistivity: param.boolean({
      label: 'Sumar la resistividad profunda (log)',
      tooltip: 'Usa también la resistividad profunda, en escala logarítmica, para ubicar y conservar límites.',
      default: false,
      group: 'Curvas',
    }),
    penalty: param.number({
      label: 'Penalización por límite',
      tooltip: 'Cuánto cuesta agregar un límite: más alto = menos zonas y más gruesas; más bajo = más sensible a cambios chicos.',
      default: SD.penalty,
      min: 1,
      max: 40,
      step: 0.5,
      scale: 'log',
      group: 'Segmentación',
    }),
    minThickness: param.number({
      label: 'Espesor mínimo de zona',
      tooltip: 'Ningún tramo entre dos límites propuestos queda más delgado que esto.',
      default: SD.minThickness,
      min: 0.5,
      max: 20,
      step: 0.1,
      unit: 'm',
      group: 'Segmentación',
    }),
    smoothWindow: param.number({
      label: 'Suavizado',
      tooltip: 'Ventana de la mediana móvil que quita picos y capas finas sin redondear los escalones. 0 = sin suavizado.',
      default: SD.smoothWindow,
      min: 0,
      max: 5,
      step: 0.1,
      unit: 'm',
      group: 'Segmentación',
    }),
    mergeContrast: param.number({
      label: 'Salto mínimo de GR',
      tooltip: 'Los límites con un salto de GR menor que este (y sin salto claro en las curvas sumadas) se fusionan con el tramo vecino.',
      default: ZD.mergeContrast,
      min: 0,
      max: 60,
      step: 1,
      unit: 'gAPI',
      group: 'Fusión',
    }),
    mergeContrastRel: param.number({
      label: 'Salto mínimo de las curvas sumadas',
      tooltip: 'Para la densidad y la resistividad: salto mínimo como fracción de su rango típico en el pozo (entre los percentiles 10 y 90).',
      default: ZD.mergeContrastRel,
      min: 0.05,
      max: 1,
      step: 0.01,
      unit: 'v/v',
      group: 'Fusión',
    }),
  },
  outputs: {
    boundaries: output.table(ZONE_SUGGESTIONS_TABLE, {
      label: 'Límites de zona sugeridos',
      columns: [
        { key: 'rank', label: 'Orden por fuerza' },
        { key: 'depth', label: 'Profundidad', unit: 'm' },
        { key: 'strengthRel', label: 'Fuerza relativa', unit: 'v/v' },
        { key: 'contrast', label: 'Salto de GR (abajo − arriba)', unit: 'gAPI' },
        { key: 'valueAbove', label: 'GR arriba', unit: 'gAPI' },
        { key: 'valueBelow', label: 'GR abajo', unit: 'gAPI' },
        { key: 'contrastRhob', label: 'Salto de densidad', unit: 'g/cm3' },
        { key: 'contrastLogRt', label: 'Salto de log10 Rt', unit: 'unitless' },
        { key: 'slopeChange', label: 'Cambio de pendiente del GR', unit: 'unitless' },
      ],
    }),
  },
  compute({ depth, inputs, params, warn }) {
    const extra: Float64Array[] = [];
    let iRhob = -1;
    let iRt = -1;
    if (params.useDensity) {
      if (inputs.rhob) {
        iRhob = extra.length;
        extra.push(inputs.rhob.slice());
      } else warn('Se pidió sumar la densidad, pero el pozo no tiene densidad volumétrica (RHOB).');
    }
    if (params.useResistivity) {
      if (inputs.rt) {
        iRt = extra.length;
        extra.push(inputs.rt.map((v) => (v > 0 ? Math.log10(v) : NaN)));
      } else warn('Se pidió sumar la resistividad, pero el pozo no tiene resistividad profunda (RT).');
    }
    const { boundaries } = suggestZoneBoundaries(
      depth,
      inputs.gr,
      { penalty: params.penalty, minThickness: params.minThickness, smoothWindow: params.smoothWindow, mergeContrast: params.mergeContrast, mergeContrastRel: params.mergeContrastRel },
      extra,
    );
    return {
      boundaries: {
        rows: boundaries.map((b) => ({
          rank: b.rank,
          depth: num(b.depth),
          strengthRel: num(b.strengthRel),
          contrast: num(b.contrast),
          valueAbove: num(b.valueAbove),
          valueBelow: num(b.valueBelow),
          contrastRhob: iRhob >= 0 ? num(b.contrastExtra[iRhob] ?? NaN) : null,
          contrastLogRt: iRt >= 0 ? num(b.contrastExtra[iRt] ?? NaN) : null,
          slopeChange: num(b.slopeChange),
        })),
      },
    };
  },
  docs: {
    summary:
      'Propone límites de zona donde la curva cambia de nivel. La curva (GR, y si se eligen la densidad y el logaritmo de la resistividad profunda) se suaviza con una mediana móvil, se parte en tramos con una recta por tramo eligiendo la partición que minimiza el error más una penalización por límite (PELT, óptimo) y se fusionan los límites de salto chico. La fuerza de cada límite es el salto entre las medianas de una ventana a cada lado, relativo al rango típico de cada curva. El usuario acepta los límites: el motor nunca escribe zonas.',
    equations: [
      { latex: '\\min_{\\tau} \\sum_{k=0}^{m} \\frac{\\mathrm{RSS}(y_{\\tau_k+1:\\tau_{k+1}})}{\\sigma^2} + m\\,\\beta', description: 'Segmentación óptima: suma de cuadrados residuales de una recta por tramo, normalizada por el ruido, más una penalización por límite.' },
      { latex: '\\beta = p\\,(2C+1)\\ln n', description: 'Penalización tipo BIC: p es la «penalización por límite», C la cantidad de curvas y n la de muestras.' },
      { latex: '\\sigma = 1{,}4826\\,\\mathrm{MAD}(\\Delta^2 y)/\\sqrt{6}', description: 'Desvío del ruido estimado de forma robusta con las segundas diferencias de la curva suavizada.' },
      { latex: 'F = \\max_c \\frac{|\\tilde y_{c,\\,abajo} - \\tilde y_{c,\\,arriba}|}{P_{90,c} - P_{10,c}}', description: 'Fuerza relativa del límite: salto de medianas a cada lado relativo al rango P10–P90 de cada curva.' },
    ],
    references: [
      'Killick, R., Fearnhead, P. y Eckley, I. (2012). Optimal detection of changepoints with a linear computational cost. JASA 107(500), 1590–1598.',
      'Schwarz, G. (1978). Estimating the dimension of a model. Annals of Statistics 6(2), 461–464.',
      'Rider, M. y Kennedy, M. (2011). The Geological Interpretation of Well Logs, 3.ª ed. Rider-French.',
    ],
    notes:
      'Los umbrales son criterios prácticos, no valores de libro. Un tope de formación no siempre es un salto de GR: si los topes no aparecen, sumá la densidad y la resistividad. Un cambio solo de pendiente, sin salto de nivel, no se propone.',
  },
});
