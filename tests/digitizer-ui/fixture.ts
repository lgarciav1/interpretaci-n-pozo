/** Registro sintético chico para las pruebas de la interfaz del Log Digitizer (usa el generador del motor). */
import type { RasterImage } from '../../src/digitizer';
import { renderLog, type SynthLog } from '../digitizer/synth';

export const FIX = { W: 420, H: 900, LEFT: 40, RIGHT: 380, TOP_M: 1500, DZ: 0.05 } as const;
export const grTruth = (d: number) => 75 + 40 * Math.sin(d / 3) + 15 * Math.sin(d / 0.9 + 1);

export function smallLog(seed = 3): { log: SynthLog; image: RasterImage } {
  const log = renderLog({
    width: FIX.W,
    height: FIX.H,
    left: FIX.LEFT,
    right: FIX.RIGHT,
    topDepthM: FIX.TOP_M,
    dzMPerPx: FIX.DZ,
    gridRows: 20,
    gridCols: 10,
    seed,
    curves: [{ id: 'GR', rgb: [30, 140, 60], thickness: 3, scale: { kind: 'linear', min: 0, max: 150, reversed: false }, valueAt: grTruth }],
  });
  return { log, image: log.image as RasterImage };
}
