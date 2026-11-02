/**
 * Utilidades de las pruebas de recuperación: digitaliza una curva de una imagen sintética y la compara con la verdad.
 */
import { valueAtX } from '../../src/digitizer/calibration';
import { buildMask } from '../../src/digitizer/color';
import { traceCurve, type TraceOptions } from '../../src/digitizer/tracing';
import type { CurveColorSpec, RasterImage, Region, TracedCurve, ValueFrame } from '../../src/digitizer/types';
import type { SynthLog } from './synth';

export interface TraceEval {
  trace: TracedCurve;
  /** Filas con dato / filas del tramo trazado. */
  coverage: number;
  /** Filas observadas (no interpoladas) / filas del tramo. */
  observedFraction: number;
  /** RMS del error de valor (todas las filas con dato) como % del rango de la escala. */
  rmsPct: number;
  /** Máximo error de posición horizontal (px). */
  maxErrPx: number;
  /** RMS del error de posición horizontal (px). */
  rmsPx: number;
  n: number;
}

export function frameOf(log: SynthLog, curveId: string): ValueFrame {
  const c = log.options.curves.find((k) => k.id === curveId)!;
  const t = (log.options.tracks ?? [{ left: log.options.left, right: log.options.right }])[c.track ?? 0]!;
  return { leftPx: t.left, rightPx: t.right, scale: c.scale };
}

/** Traza la curva `curveId` con máscara según `color` en `region` y la compara con la verdad (por fila). */
export function traceAndEvaluate(
  log: SynthLog,
  curveId: string,
  color: CurveColorSpec,
  region: Region,
  options: TraceOptions = {},
  evalRows?: [number, number],
): TraceEval {
  const mask = buildMask(log.image as RasterImage, region, color);
  const trace = traceCurve(mask, options);
  return evaluate(log, curveId, trace, evalRows);
}

export function evaluate(log: SynthLog, curveId: string, trace: TracedCurve, evalRows?: [number, number]): TraceEval {
  const frame = frameOf(log, curveId);
  const curve = log.options.curves.find((k) => k.id === curveId)!;
  const span = curve.scale.max - curve.scale.min;
  let ss = 0;
  let sp = 0;
  let maxPx = 0;
  let n = 0;
  let withData = 0;
  let obs = 0;
  const rows = trace.x.length;
  for (let i = 0; i < rows; i++) {
    const y = trace.y0 + i;
    if (evalRows && (y < evalRows[0] || y > evalRows[1])) continue;
    n++;
    const x = trace.x[i]!;
    if (Number.isNaN(x)) continue;
    withData++;
    if (trace.observed[i]) obs++;
    const v = valueAtX(frame, x);
    const tv = log.trueValue(curveId, y);
    const tx = log.trueX(curveId, y);
    const range = curve.scale.kind === 'log' ? Math.log10(curve.scale.max / curve.scale.min) : span;
    const err = curve.scale.kind === 'log' ? Math.log10(v / tv) : v - tv;
    ss += (err / range) ** 2;
    sp += (x - tx) ** 2;
    maxPx = Math.max(maxPx, Math.abs(x - tx));
  }
  return {
    trace,
    coverage: n ? withData / n : 0,
    observedFraction: n ? obs / n : 0,
    rmsPct: withData ? 100 * Math.sqrt(ss / withData) : NaN,
    rmsPx: withData ? Math.sqrt(sp / withData) : NaN,
    maxErrPx: maxPx,
    n,
  };
}

/**
 * Desfase de profundidad (en filas, con resolución de 0,25) que mejor alinea la curva digitalizada con la verdad:
 * minimiza el RMS entre el valor leído en la fila y la verdad evaluada en la fila + lag. 0 = sin error de profundidad.
 */
export function estimateLagRows(log: SynthLog, curveId: string, trace: TracedCurve): number {
  const frame = frameOf(log, curveId);
  let bestLag = 0;
  let bestRms = Infinity;
  for (let lag = -4; lag <= 4.0001; lag += 0.25) {
    let ss = 0;
    let n = 0;
    for (let i = 0; i < trace.x.length; i++) {
      if (!trace.observed[i]) continue;
      const v = valueAtX(frame, trace.x[i]!);
      const tv = log.trueValue(curveId, trace.y0 + i + lag);
      ss += (v - tv) ** 2;
      n++;
    }
    const rms = Math.sqrt(ss / Math.max(1, n));
    if (rms < bestRms) {
      bestRms = rms;
      bestLag = lag;
    }
  }
  return bestLag;
}

/** Imprime una línea de resultados en la salida estándar (Node); los números se anotan en docs/decisiones/0062. */
export function report(line: string): void {
  const g = globalThis as unknown as { process?: { stdout?: { write(s: string): void } } };
  g.process?.stdout?.write(line + '\n');
}
