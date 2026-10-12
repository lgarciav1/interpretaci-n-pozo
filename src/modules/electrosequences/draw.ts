/**
 * Dibujo en canvas de la silueta de cada electrosecuencia (pista del visor). El panel usa los íconos normalizados de
 * `shapeOutline` (model.ts), con la misma lógica: borde izquierdo = trazo del GR. Colores: paleta categórica del sistema de diseño, por forma.
 */
import { withAlpha } from '../../ui/color';
import { CATEGORICAL } from '../../ui/curves';
import type { ThemeName } from '../../ui/tokens';
import type { Electrosequence, SegmentConfidence, SegmentShape } from '../../petro/segmentation';
import { CONFIDENCE_ALPHA, SHAPE_COLOR_INDEX } from './model';

export const shapeColor = (shape: SegmentShape, theme: ThemeName): string => CATEGORICAL[theme][SHAPE_COLOR_INDEX[shape]]!;

/** Polígono de la silueta de un tramo en px del canvas. */
export type Outline = readonly (readonly [number, number])[];

/**
 * Silueta de un tramo sobre la escala de GR de la pista: anclada al borde derecho y con el borde izquierdo en el GR
 * AJUSTADO del tramo (embudo: GR bajo arriba → ancho arriba; campana: al revés; cilindro: el GR medio). El simétrico
 * lleva un vértice en el medio (más ancho si la arena está al centro, cintura si es arcilla) y el serrado, dientes de
 * la amplitud de su desvío residual. Un ancho mínimo mantiene visible el ícono de un tramo arcilloso.
 */
export function segmentOutline(
  s: Pick<Electrosequence, 'shape' | 'serrated' | 'symmetry' | 'mean' | 'valueTop' | 'valueBase' | 'residualStd'>,
  box: { x: number; y0: number; y1: number; right: number; minWidth: number },
  xOf: (gr: number) => number,
): Outline {
  const xL = (v: number) => Math.max(box.x, Math.min(box.right - box.minWidth, xOf(v)));
  const { y0, y1, right } = box;
  const h = y1 - y0;
  const amp = Math.max(4, Math.min(20, Number.isFinite(s.residualStd) ? s.residualStd : 6));
  const teeth = Math.max(2, Math.min(10, Math.round(h / 10)));
  const zigzag = (vTop: number, vBase: number, a: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let k = 0; k <= teeth * 2; k++) {
      const f = k / (teeth * 2);
      const v = vTop + (vBase - vTop) * f + (k % 2 === 0 ? a : -a);
      pts.push([xL(v), y0 + f * h]);
    }
    return pts;
  };
  let left: [number, number][];
  switch (s.shape) {
    case 'funnel':
    case 'bell':
      left = s.serrated ? zigzag(s.valueTop, s.valueBase, amp * 0.6) : [[xL(s.valueTop), y0], [xL(s.valueBase), y1]];
      break;
    case 'symmetric': {
      const ends = s.symmetry === 'shaleCenter' ? Math.min(s.valueTop, s.valueBase) : Math.max(s.valueTop, s.valueBase);
      const mid = s.symmetry === 'shaleCenter' ? ends + 2.5 * amp : ends - 2.5 * amp;
      left = [[xL(s.valueTop), y0], [xL(mid), y0 + h / 2], [xL(s.valueBase), y1]];
      break;
    }
    case 'serrated':
      left = zigzag(s.mean, s.mean, amp);
      break;
    default:
      left = [[xL(s.mean), y0], [xL(s.mean), y1]];
  }
  // Borde derecho de arriba abajo y vuelta por el trazo del GR de abajo arriba.
  return [[right, y0], [right, y1], ...[...left].reverse()];
}

/**
 * Dibuja una silueta: relleno con opacidad según la confianza y trazo del color de la forma (discontinuo si la
 * confianza es baja).
 */
export function drawShapeIcon(
  ctx: CanvasRenderingContext2D,
  shape: SegmentShape,
  confidence: SegmentConfidence,
  pts: Outline,
  theme: ThemeName,
  opts: { selected?: boolean } = {},
): void {
  const color = shapeColor(shape, theme);
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, CONFIDENCE_ALPHA[confidence] * (theme === 'dark' ? 0.7 : 0.55));
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = opts.selected ? 2 : 1.25;
  ctx.strokeStyle = withAlpha(color, confidence === 'low' ? 0.75 : 1);
  if (confidence === 'low') ctx.setLineDash([3, 2]);
  ctx.stroke();
  ctx.restore();
}
