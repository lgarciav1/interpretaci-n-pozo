/**
 * Módulo «Electrosecuencias» (función Geo-1; docs/decisiones/0025-zonas-sugeridas-y-electrosecuencias.md).
 * Definición PURA (la ejecuta el Web Worker).
 *
 * Segmenta el GR y clasifica la forma de cada tramo (cilindro, embudo, campana, serrado, simétrico) con su confianza,
 * descripción e interpretación depositacional posible (`src/petro/segmentation.ts`). Publica dos tablas: los tramos
 * de la segmentación y la clasificación de cada zona del usuario. La pista del visor de Geología (overlay.ts) usa la
 * misma función y los mismos parámetros, así que muestra exactamente los mismos tramos.
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import {
  ELECTROSEQUENCE_DEFAULTS as ED,
  SEGMENTATION_DEFAULTS as SD,
  analyzeElectrosequences,
  classifyInterval,
  type Electrosequence,
  type ElectrosequenceParams,
  type SegmentationParams,
} from '../../petro/segmentation';

export const ELECTROSEQUENCES_ID = 'electrosequences';
export const ELECTROSEQUENCES_TABLE = 'ELECTROSEQUENCES';
export const ZONE_SHAPES_TABLE = 'ZONE_ELECTROSEQUENCES';

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);
const CONFIDENCE_LABEL = { high: 'alta', medium: 'media', low: 'baja' } as const;

/** Parámetros del motor a partir de los del módulo (los usa también la pista del visor). */
export function engineParams(p: {
  penalty: number;
  minThickness: number;
  smoothWindow: number;
  slopeThreshold: number;
  minTrendChange: number;
  serrationStd: number;
  mergeSymmetric: boolean;
}): Partial<SegmentationParams & ElectrosequenceParams> {
  return {
    penalty: p.penalty,
    minThickness: p.minThickness,
    smoothWindow: p.smoothWindow,
    slopeThreshold: p.slopeThreshold,
    minTrendChange: p.minTrendChange,
    serrationStd: p.serrationStd,
    mergeSymmetric: p.mergeSymmetric,
  };
}

const COLUMNS = [
  { key: 'top', label: 'Tope', unit: 'm' },
  { key: 'base', label: 'Base', unit: 'm' },
  { key: 'thickness', label: 'Espesor', unit: 'm' },
  { key: 'shape', label: 'Forma (cylinder | funnel | bell | serrated | symmetric | unclear)', kind: 'text' },
  { key: 'shapeLabel', label: 'Forma', kind: 'text' },
  { key: 'confidence', label: 'Confianza (high | medium | low)', kind: 'text' },
  { key: 'confidenceLabel', label: 'Confianza', kind: 'text' },
  { key: 'serrated', label: 'Con serrado (1 = sí)' },
  { key: 'level', label: 'Nivel (low | medium | high)', kind: 'text' },
  { key: 'mean', label: 'GR medio', unit: 'gAPI' },
  { key: 'trendChange', label: 'Variación del GR a lo largo del tramo (base − tope)', unit: 'gAPI' },
  { key: 'r2', label: 'R² del ajuste lineal', unit: 'unitless' },
  { key: 'description', label: 'Descripción', kind: 'text' },
  { key: 'interpretation', label: 'Interpretación posible', kind: 'text' },
] as const;

function row(e: Electrosequence): Record<string, TableCell> {
  return {
    top: num(e.top),
    base: num(e.base),
    thickness: num(e.thickness),
    shape: e.shape,
    shapeLabel: e.shapeLabel,
    confidence: e.confidence,
    confidenceLabel: CONFIDENCE_LABEL[e.confidence],
    serrated: e.serrated ? 1 : 0,
    level: e.level,
    mean: num(e.mean),
    trendChange: num(e.trendChange),
    r2: num(e.r2),
    description: e.description,
    interpretation: e.interpretation,
  };
}

export default defineModule({
  id: ELECTROSEQUENCES_ID,
  name: 'Electrosecuencias',
  description: 'Forma del GR de cada tramo (cilindro, embudo, campana, serrado o simétrico), con su confianza y una interpretación depositacional posible.',
  category: 'geology',
  workspace: 'geology',
  inputs: {
    gr: input.curve('GR'),
  },
  params: {
    penalty: param.number({
      label: 'Penalización por tramo',
      tooltip: 'Más alto = menos tramos y más gruesos; más bajo = tramos más finos.',
      default: SD.penalty,
      min: 1,
      max: 40,
      step: 0.5,
      scale: 'log',
      group: 'Segmentación',
    }),
    minThickness: param.number({
      label: 'Espesor mínimo del tramo',
      tooltip: 'Ningún tramo queda más delgado que esto.',
      default: SD.minThickness,
      min: 0.5,
      max: 20,
      step: 0.1,
      unit: 'm',
      group: 'Segmentación',
    }),
    smoothWindow: param.number({
      label: 'Suavizado',
      tooltip: 'Ventana de la mediana móvil que quita picos sin redondear los escalones. 0 = sin suavizado.',
      default: SD.smoothWindow,
      min: 0,
      max: 5,
      step: 0.1,
      unit: 'm',
      group: 'Segmentación',
    }),
    slopeThreshold: param.number({
      label: 'Pendiente mínima de una tendencia',
      tooltip: 'Cuánto tiene que cambiar el GR por metro para hablar de embudo o campana.',
      default: ED.slopeThreshold,
      min: 0.05,
      max: 5,
      step: 0.05,
      scale: 'log',
      group: 'Forma',
    }),
    minTrendChange: param.number({
      label: 'Variación mínima de una tendencia',
      tooltip: 'Cuánto tiene que cambiar el GR de punta a punta del tramo para hablar de embudo o campana.',
      default: ED.minTrendChange,
      min: 1,
      max: 60,
      step: 1,
      unit: 'gAPI',
      group: 'Forma',
    }),
    serrationStd: param.number({
      label: 'Dispersión mínima para serrado',
      tooltip: 'Desvío del GR alrededor de su tendencia a partir del cual el tramo se lee serrado (alternancias finas).',
      default: ED.serrationStd,
      min: 1,
      max: 40,
      step: 0.5,
      unit: 'gAPI',
      group: 'Forma',
    }),
    mergeSymmetric: param.boolean({
      label: 'Reunir campana y embudo en un simétrico',
      tooltip: 'Un par campana–embudo contiguo, continuo y de espesores parecidos se lee como un solo ciclo simétrico.',
      default: ED.mergeSymmetric,
      group: 'Forma',
    }),
  },
  outputs: {
    sequences: output.table(ELECTROSEQUENCES_TABLE, { label: 'Electrosecuencias', columns: COLUMNS }),
    zones: output.table(ZONE_SHAPES_TABLE, {
      label: 'Forma del GR por zona',
      columns: [{ key: 'zoneId', label: 'Id de zona', kind: 'text' }, { key: 'zone', label: 'Zona', kind: 'text' }, ...COLUMNS],
    }),
  },
  compute({ depth, inputs, zones, params }) {
    const ep = engineParams(params);
    const sequences = analyzeElectrosequences(depth, inputs.gr, ep);
    const zoneRows: Record<string, TableCell>[] = [];
    for (const z of zones) {
      if (!(z.base > z.top)) continue;
      const c = classifyInterval(depth, inputs.gr, z.top, z.base, ep);
      if (c) zoneRows.push({ zoneId: z.id, zone: z.name, ...row(c), top: num(z.top), base: num(z.base), thickness: num(z.base - z.top) });
    }
    return { sequences: { rows: sequences.map(row) }, zones: { rows: zoneRows } };
  },
  docs: {
    summary:
      'Segmenta el GR en tramos (el mismo método que Zonas sugeridas: recta por tramo, partición óptima con penalización) y clasifica la forma de cada uno con la recta de ajuste del GR suavizado: embudo si el GR baja hacia arriba (engrosamiento hacia arriba), campana si sube hacia arriba (afinamiento hacia arriba), cilindro si no hay tendencia y el tramo es liso, serrado si el GR alterna a ambos lados de la recta, simétrico si hay un extremo interior con tendencias opuestas. La confianza sale de los márgenes respecto de los umbrales. La forma del GR no es diagnóstica por sí sola: hay que confirmarla con testigos, buzamientos y el contexto regional.',
    equations: [
      { latex: 'GR(z) \\approx a + b\\,z', description: 'Recta de ajuste del GR suavizado en el tramo (z crece hacia abajo).' },
      { latex: 'b > 0 \\Rightarrow \\text{embudo}, \\quad b < 0 \\Rightarrow \\text{campana}', description: 'Con |b| y la variación total |b·h| por encima de sus umbrales.' },
      { latex: '\\Delta = b\\,h', description: 'Variación total del GR a lo largo del tramo de espesor h.' },
      { latex: 's = \\sqrt{\\mathrm{RSS}/(n-2)}', description: 'Desvío residual: con muchos cruces de la recta indica serrado.' },
    ],
    references: [
      'Rider, M. y Kennedy, M. (2011). The Geological Interpretation of Well Logs, 3.ª ed. Rider-French.',
      'Rider, M. (1990). Gamma-ray log shape used as a facies indicator: critical analysis of an oversimplified methodology. Geol. Soc. London Spec. Publ. 48, 27–37.',
      'Serra, O. (1985). Sedimentary Environments from Wireline Logs. Schlumberger.',
      'Cant, D. J. (1992). Subsurface facies analysis. En Walker y James (eds.), Facies Models: Response to Sea Level Change. Geol. Assoc. Canada, 27–45.',
    ],
    notes:
      'Los umbrales son criterios prácticos, no valores de libro: dependen de la resolución vertical y del criterio del intérprete. Un embudo puede ser barra de desembocadura, frente deltaico, playa o lóbulo turbidítico; una campana, relleno de canal o barra de meandro.',
  },
});
