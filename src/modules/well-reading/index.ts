/**
 * Módulo «Lectura automática del pozo» (función T): resumen en texto, armado con reglas (sin IA), de los tramos
 * candidatos a hidrocarburo y de los acuíferos, con tope y base para saltar a cada uno. Reúne la evidencia de los
 * demás módulos (cutoffs, crossover de gas, derrumbe, carbón, arcilla, resistividad profunda) y publica dos tablas:
 *   WELL_READING          un renglón por tramo, ordenado por importancia (h·φ·Sh); hidrocarburo antes que agua;
 *   WELL_READING_GENERAL  1–3 líneas generales del pozo (resumen, contactos aparentes, calidad de dato).
 * Los sellos no se leen. Las reglas y los umbrales están en `src/petro/wellReading.ts`. Definición PURA (la ejecuta el
 * Web Worker).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { readWell, WELL_READING_DEFAULTS as D, type WellReadingConfidence, type WellReadingFluid, type WellReadingInterval } from '../../petro/wellReading';

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

const FLUID_LABEL: Record<WellReadingFluid, string> = { gas: 'gas', oil: 'petróleo', water: 'agua', doubtful: 'dudoso' };
const CONFIDENCE_LABEL: Record<WellReadingConfidence, string> = { high: 'alta', medium: 'media', low: 'baja' };

export default defineModule({
  id: 'well-reading',
  name: 'Lectura automática del pozo',
  description: 'Resume en texto qué tramos son candidatos a hidrocarburo (gas, petróleo, agua o dudoso), por qué y con qué confianza, con reglas explícitas.',
  category: 'summary',
  workspace: 'petrophysics',
  inputs: {
    phi: input.curve('PHIE'),
    sw: input.curve('SW'),
    netRes: input.curve('NET_RES'),
    netPay: input.curve('NET_PAY'),
    vsh: input.optionalCurve('VSH'),
    rt: input.optionalCurve('RT'),
    gas: input.optionalCurve('IND_GAS'),
    washout: input.optionalCurve('IND_WASHOUT'),
    coal: input.optionalCurve('IND_COAL'),
    shale: input.optionalCurve('IND_SHALE'),
  },
  params: {
    minThickness: param.number({
      label: 'Espesor mínimo del tramo',
      tooltip: 'Los tramos con menos espesor neto que este valor no se informan.',
      default: D.minThickness,
      min: 0.1,
      max: 20,
      step: 0.1,
      unit: 'm',
    }),
    mergeGap: param.number({
      label: 'Hueco que se fusiona',
      tooltip: 'Dos tramos del mismo tipo separados por menos que esto se leen como uno solo.',
      default: D.mergeGap,
      min: 0,
      max: 5,
      step: 0.1,
      unit: 'm',
    }),
    rtRatioMin: param.number({
      label: 'Resistividad relativa mínima',
      tooltip: 'Cuántas veces debe superar la resistividad profunda del tramo a la de un tramo acuífero de referencia para contar como indicio de hidrocarburo.',
      default: D.rtRatioMin,
      min: 1.5,
      max: 20,
      step: 0.1,
      scale: 'log',
    }),
    swLowMax: param.number({
      label: 'Sw baja hasta',
      tooltip: 'Saturación de agua media hasta la cual el tramo cuenta como «de Sw baja».',
      default: D.swLowMax,
      min: 0.05,
      max: 0.9,
      step: 0.01,
      unit: 'v/v',
    }),
    swAquiferMin: param.number({
      label: 'Sw mínima del acuífero',
      tooltip: 'Saturación de agua desde la cual un reservorio se toma como acuífero (referencia de resistividad y tramo «agua»).',
      default: D.swAquiferMin,
      min: 0.5,
      max: 1,
      step: 0.01,
      unit: 'v/v',
    }),
    gasFracMin: param.number({
      label: 'Fracción con cruce para gas',
      tooltip: 'Parte del espesor neto del tramo con cruce densidad–neutrón a partir de la cual se lee gas.',
      default: D.gasFracMin,
      min: 0.05,
      max: 1,
      step: 0.01,
      unit: 'v/v',
    }),
    washoutFracMin: param.number({
      label: 'Fracción con derrumbe que baja la confianza',
      tooltip: 'Si el derrumbe afecta a esta parte del tramo, la confianza queda en baja: la densidad y el neutrón no son confiables.',
      default: D.washoutFracMin,
      min: 0.01,
      max: 1,
      step: 0.01,
      unit: 'v/v',
    }),
    coalFracMin: param.number({
      label: 'Fracción con carbón que vuelve dudoso',
      tooltip: 'Si el indicador de carbón afecta a esta parte del tramo, el fluido se marca como dudoso.',
      default: D.coalFracMin,
      min: 0.01,
      max: 1,
      step: 0.01,
      unit: 'v/v',
    }),
    contactSwJump: param.number({
      label: 'Salto de Sw para un contacto',
      tooltip: 'Aumento mínimo de la Sw media entre un tramo con hidrocarburo y el acuífero que le sigue hacia abajo para informar un contacto aparente.',
      default: D.contactSwJump,
      min: 0.05,
      max: 0.9,
      step: 0.01,
      unit: 'v/v',
    }),
    maxCandidates: param.number({
      label: 'Tramos de hidrocarburo a listar',
      tooltip: 'Máximo de tramos con hidrocarburo (los más importantes).',
      default: D.maxCandidates,
      min: 1,
      max: 500,
      step: 1,
    }),
    maxWater: param.number({
      label: 'Tramos acuíferos a listar',
      tooltip: 'Máximo de tramos acuíferos (los de mayor φ·h). 0 = no listar.',
      default: D.maxWater,
      min: 0,
      max: 20,
      step: 1,
    }),
  },
  outputs: {
    reading: output.table('WELL_READING', {
      label: 'Lectura automática del pozo',
      columns: [
        { key: 'rank', label: 'Orden' },
        { key: 'top', label: 'Tope', unit: 'm' },
        { key: 'base', label: 'Base', unit: 'm' },
        { key: 'zoneId', label: 'Id de zona', kind: 'text' },
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'kind', label: 'Tipo (hydrocarbon | water)', kind: 'text' },
        { key: 'fluid', label: 'Fluido (gas | oil | water | doubtful)', kind: 'text' },
        { key: 'fluidLabel', label: 'Fluido probable', kind: 'text' },
        { key: 'confidence', label: 'Confianza (high | medium | low)', kind: 'text' },
        { key: 'confidenceLabel', label: 'Confianza', kind: 'text' },
        { key: 'text', label: 'Lectura', kind: 'text' },
        { key: 'evidence', label: 'Evidencias', kind: 'text' },
        { key: 'h', label: 'Espesor neto', unit: 'm' },
        { key: 'phi', label: 'φ media', unit: 'v/v' },
        { key: 'sw', label: 'Sw media', unit: 'v/v' },
        { key: 'vsh', label: 'Vsh media', unit: 'v/v' },
        { key: 'rt', label: 'Rt media', unit: 'ohm.m' },
        { key: 'rtRef', label: 'Rt de referencia', unit: 'ohm.m' },
        { key: 'rtRatio', label: 'Rt / Rt de referencia', unit: 'unitless' },
        { key: 'refKind', label: 'Referencia (aquiferZone | aquiferWell | shale)', kind: 'text' },
        { key: 'gasFrac', label: 'Fracción con cruce', unit: 'v/v' },
        { key: 'washoutFrac', label: 'Fracción con derrumbe', unit: 'v/v' },
        { key: 'importance', label: 'Importancia (h·φ·Sh en hidrocarburo, h·φ en agua)', unit: 'm' },
      ],
    }),
    general: output.table('WELL_READING_GENERAL', {
      label: 'Lectura general del pozo',
      columns: [
        { key: 'order', label: 'Orden' },
        { key: 'kind', label: 'Tipo (summary | contacts | quality)', kind: 'text' },
        { key: 'top', label: 'Tope', unit: 'm' },
        { key: 'base', label: 'Base', unit: 'm' },
        { key: 'text', label: 'Lectura', kind: 'text' },
      ],
    }),
  },
  compute({ n, depth, thickness, inputs, zones, params, warn }) {
    // Sin zonas se lee el pozo completo; los sellos no se leen.
    const intervals: WellReadingInterval[] =
      zones.length > 0
        ? zones.filter((z) => z.kind !== 'seal' && z.end > z.start).map((z) => ({ id: z.id, name: z.name, start: z.start, end: z.end }))
        : [{ id: '', name: 'Pozo completo', start: 0, end: n }];
    if (!inputs.rt) warn('Sin resistividad profunda (RT): la lectura no compara la resistividad con un tramo acuífero.');

    const result = readWell(
      { depth, thickness, phi: inputs.phi, sw: inputs.sw, netRes: inputs.netRes, netPay: inputs.netPay, vsh: inputs.vsh, rt: inputs.rt, gas: inputs.gas, washout: inputs.washout, coal: inputs.coal, shale: inputs.shale },
      intervals,
      params,
    );

    return {
      reading: {
        rows: result.candidates.map((c) => ({
          rank: c.rank,
          top: num(c.top),
          base: num(c.base),
          zoneId: c.zoneId,
          zone: c.zone,
          kind: c.kind,
          fluid: c.fluid,
          fluidLabel: FLUID_LABEL[c.fluid],
          confidence: c.confidence,
          confidenceLabel: CONFIDENCE_LABEL[c.confidence],
          text: c.text,
          evidence: c.evidence.join(' · '),
          h: num(c.h),
          phi: num(c.phi),
          sw: num(c.sw),
          vsh: num(c.vsh),
          rt: num(c.rt),
          rtRef: num(c.rtRef),
          rtRatio: num(c.rtRatio),
          refKind: c.refKind,
          gasFrac: num(c.gasFrac),
          washoutFrac: num(c.washoutFrac),
          importance: num(c.importance),
        })),
      },
      general: {
        rows: result.general.map((g, i) => ({ order: i + 1, kind: g.kind, top: num(g.top), base: num(g.base), text: g.text })),
      },
    };
  },
  docs: {
    summary:
      'Lectura automática hecha con reglas, sin inteligencia artificial: detecta los tramos contiguos de pay neto (y de reservorio acuífero), fusiona los huecos cortos, descarta los de poco espesor y, para cada uno, junta la evidencia (Sw baja, resistividad profunda relativa a un tramo acuífero, cruce densidad–neutrón) para decir si es probable gas, petróleo, agua o dudoso, con una confianza alta, media o baja. El derrumbe baja la confianza a baja; el carbón vuelve dudoso el fluido. Los tramos se ordenan por h·φ·Sh. Un pay seguido por agua dentro del mismo reservorio continuo se informa como contacto aparente.',
    equations: [
      { latex: 'I = h \\cdot \\phi \\cdot (1 - S_w)', description: 'Importancia del tramo (m): espesor neto por porosidad media por saturación de hidrocarburo.' },
      { latex: 'R_t / R_{t,ref} \\ge r_{min}', description: 'Resistividad profunda del tramo contra la mediana de un tramo acuífero (misma zona, si no el del pozo).' },
      { latex: '\\phi_D - \\phi_N \\ge \\Delta_{min} \\ \\text{en} \\ \\ge f_{gas} \\ \\text{del espesor neto}', description: 'Cruce densidad–neutrón: indicio de gas.' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16, caps. 4 y 5.',
      'Schlumberger (1989). Log Interpretation Principles/Applications.',
      'Worthington, P. F. y Cosentino, L. (2005). The role of cut-offs in integrated reservoir studies. SPE Reservoir Evaluation & Engineering 8(4).',
    ],
    notes:
      'Los umbrales son criterios prácticos, no valores de libro. Sw y resistividad no son evidencias independientes (la Sw sale de la resistividad), por eso el petróleo no pasa de lo que dan ambas y solo el cruce aporta información de otra herramienta. Sin presiones MDT ni gas de lodo, un gas sin efecto en las curvas se lee como petróleo. Los contactos son aparentes: los confirman las presiones MDT. Los sellos no se leen.',
  },
});
