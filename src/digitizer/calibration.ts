/**
 * Calibración del Log Digitizer: fila de píxeles ↔ profundidad y columna de píxeles ↔ valor de la curva.
 * Puro (sin DOM). Todo error de entrada lanza `DigitizerError('invalid-calibration', …)` con mensaje en español.
 *
 * PROFUNDIDAD. El usuario marca ≥ 2 amarres (fila de la imagen ↔ profundidad impresa, en m o ft). Dos métodos:
 *   - 'piecewise': profundidad lineal por tramos que pasa EXACTAMENTE por cada amarre; fuera del primer/último amarre se
 *     prolonga con la pendiente del tramo extremo. Absorbe estiramientos no uniformes del escaneo.
 *   - 'linear': una única recta de mínimos cuadrados  z(m) = a + b·y   (b = Σ(y−ȳ)(z−z̄) / Σ(y−ȳ)²). Promedia los errores
 *     al marcar los amarres.
 * En ambos casos se reporta el residuo RMS del ajuste lineal global, en metros y en píxeles (rms_m / |b|):
 *     rms = sqrt( Σ (z_i − (a + b·y_i))² / n )
 * Si es grande (> 2 px) con ≥ 3 amarres, el escaneo está estirado de forma no uniforme (o un amarre está mal puesto).
 * Referencia: ajuste por mínimos cuadrados ordinarios; Press et al., Numerical Recipes, §15.2.
 *
 * VALOR. Dos columnas de la imagen corregida con valor conocido (`ValueFrame`: bordes de la pista o líneas de grilla
 * rotuladas) y una `AxisScale` del visor (lineal/log, normal/invertida). La matemática de escalas se reutiliza de
 * `src/viewer/scale.ts` (`fractionToValue`, `valueToFraction`, `validScale`), sin duplicarla:
 *     f = (x − leftPx) / (rightPx − leftPx),     valor = fractionToValue(f, scale)
 */
import { convert } from '../core/units';
import { fractionToValue, valueToFraction, validScale, type AxisScale } from '../viewer/scale';
import { DigitizerError } from './errors';
import type {
  DepthCalibration,
  DepthCalibrationSpec,
  DepthTie,
  ImageDepthUnit,
  ValueFrame,
} from './types';

const fail = (message: string): never => {
  throw new DigitizerError('invalid-calibration', message);
};

/** Profundidad en la unidad de la imagen → metros. */
export function depthToMeters(depth: number, unit: ImageDepthUnit): number {
  return unit === 'm' ? depth : convert(depth, 'ft', 'm');
}

/** Metros → unidad de la imagen. */
export function metersToDepthUnit(depthM: number, unit: ImageDepthUnit): number {
  return unit === 'm' ? depthM : convert(depthM, 'm', 'ft');
}

/**
 * Problemas de una calibración de profundidad (lista vacía = válida). No lanza: la interfaz lo usa para avisar mientras
 * el usuario marca amarres. Mensajes en español.
 */
export function checkDepthSpec(spec: DepthCalibrationSpec): string[] {
  const problems: string[] = [];
  if (spec.unit !== 'm' && spec.unit !== 'ft') problems.push(`La unidad de profundidad '${String(spec.unit)}' no es válida: usá m o ft.`);
  if (spec.method !== 'piecewise' && spec.method !== 'linear') problems.push(`El método de calibración '${String(spec.method)}' no es válido.`);
  const ties = Array.isArray(spec.ties) ? spec.ties : [];
  if (ties.length < 2) {
    problems.push('Hacen falta al menos 2 amarres de profundidad (fila de la imagen y profundidad impresa).');
    return problems;
  }
  for (let i = 0; i < ties.length; i++) {
    const t = ties[i]!;
    if (!Number.isFinite(t.y) || !Number.isFinite(t.depth)) {
      problems.push(`El amarre ${i + 1} tiene un valor no numérico (fila ${t.y}, profundidad ${t.depth}).`);
    }
  }
  if (problems.length > 0) return problems;
  const sorted = [...ties].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (b.y === a.y) problems.push(`Hay dos amarres en la misma fila (${a.y}).`);
    else if (b.depth <= a.depth) {
      problems.push(
        `La profundidad debe crecer hacia abajo: la fila ${a.y} vale ${a.depth} y la fila ${b.y} vale ${b.depth}. Revisá los amarres.`,
      );
    }
  }
  return problems;
}

/** Ajuste lineal global z = a + b·y de los amarres (en metros). */
function linearFit(ties: readonly DepthTie[]): { a: number; b: number; rmsM: number; maxM: number } {
  const n = ties.length;
  let my = 0;
  let mz = 0;
  for (const t of ties) {
    my += t.y;
    mz += t.depth;
  }
  my /= n;
  mz /= n;
  let sxy = 0;
  let sxx = 0;
  for (const t of ties) {
    sxy += (t.y - my) * (t.depth - mz);
    sxx += (t.y - my) ** 2;
  }
  const b = sxy / sxx;
  const a = mz - b * my;
  let ss = 0;
  let maxM = 0;
  for (const t of ties) {
    const r = t.depth - (a + b * t.y);
    ss += r * r;
    maxM = Math.max(maxM, Math.abs(r));
  }
  return { a, b, rmsM: Math.sqrt(ss / n), maxM };
}

/**
 * Resuelve una calibración de profundidad. Lanza `DigitizerError` si es inválida (ver `checkDepthSpec`).
 * Las advertencias (amarres muy juntos, residuo alto) quedan en `warnings` sin bloquear.
 */
export function buildDepthCalibration(spec: DepthCalibrationSpec): DepthCalibration {
  const problems = checkDepthSpec(spec);
  if (problems.length > 0) fail(problems[0]!);
  const ties: DepthTie[] = [...spec.ties]
    .sort((a, b) => a.y - b.y)
    .map((t) => ({ y: t.y, depth: depthToMeters(t.depth, spec.unit) }));
  const fit = linearFit(ties);
  if (!(fit.b > 0)) fail('El ajuste lineal de la profundidad no crece hacia abajo; revisá los amarres.');
  const warnings: string[] = [];
  const span = ties[ties.length - 1]!.y - ties[0]!.y;
  if (span < 50) warnings.push(`Los amarres abarcan solo ${span.toFixed(0)} px: la escala de profundidad será poco precisa. Separalos más.`);
  const rmsPx = fit.rmsM / fit.b;
  const maxPx = fit.maxM / fit.b;
  if (ties.length >= 3 && rmsPx > 2) {
    warnings.push(
      `Los amarres se apartan de una recta ${rmsPx.toFixed(1)} px (RMS): el escaneo puede estar estirado o un amarre está mal ubicado.`,
    );
  }
  return {
    unit: spec.unit,
    method: spec.method,
    ties,
    slopeMPerPx: fit.b,
    interceptM: fit.a,
    rmsResidualM: fit.rmsM,
    rmsResidualPx: rmsPx,
    maxResidualPx: maxPx,
    warnings,
  };
}

/** Índice del tramo [ties[k], ties[k+1]] que contiene (o prolonga) la fila `y`. */
function segmentForRow(ties: readonly DepthTie[], y: number): number {
  const last = ties.length - 2;
  if (y <= ties[1]!.y) return 0;
  if (y >= ties[last]!.y) return last;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ties[mid]!.y <= y) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Profundidad (m) de la fila `y` (px). Prolonga fuera del primer/último amarre. NaN si `y` no es finito. */
export function depthAtRow(cal: DepthCalibration, y: number): number {
  if (!Number.isFinite(y)) return NaN;
  if (cal.method === 'linear') return cal.interceptM + cal.slopeMPerPx * y;
  const k = segmentForRow(cal.ties, y);
  const a = cal.ties[k]!;
  const b = cal.ties[k + 1]!;
  return a.depth + ((y - a.y) * (b.depth - a.depth)) / (b.y - a.y);
}

/** Fila (px, real) de la profundidad `depthM` (m). Inversa exacta de `depthAtRow`. NaN si no es finita. */
export function rowAtDepth(cal: DepthCalibration, depthM: number): number {
  if (!Number.isFinite(depthM)) return NaN;
  if (cal.method === 'linear') return (depthM - cal.interceptM) / cal.slopeMPerPx;
  const t = cal.ties;
  const last = t.length - 2;
  let k: number;
  if (depthM <= t[1]!.depth) k = 0;
  else if (depthM >= t[last]!.depth) k = last;
  else {
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid]!.depth <= depthM) lo = mid;
      else hi = mid;
    }
    k = lo;
  }
  const a = t[k]!;
  const b = t[k + 1]!;
  return a.y + ((depthM - a.depth) * (b.y - a.y)) / (b.depth - a.depth);
}

/** Profundidades (m) de las filas y0, y0+1, …, y0+n−1. */
export function depthsOfRows(cal: DepthCalibration, y0: number, n: number): Float64Array {
  const out = new Float64Array(Math.max(0, n));
  for (let i = 0; i < out.length; i++) out[i] = depthAtRow(cal, y0 + i);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Escala de valor
// ---------------------------------------------------------------------------------------------------------------

/**
 * Arma la escala a partir de los valores impresos en el borde izquierdo y derecho de la pista (p. ej. GR: 0 a la
 * izquierda y 150 a la derecha; DT: 140 a la izquierda y 40 a la derecha → invertida). Lanza si no es válida.
 */
export function axisFromEdgeValues(leftValue: number, rightValue: number, kind: 'linear' | 'log'): AxisScale {
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) fail('Los valores de la escala deben ser números.');
  if (leftValue === rightValue) fail('Los valores de los bordes izquierdo y derecho de la escala no pueden ser iguales.');
  const scale: AxisScale = {
    kind,
    min: Math.min(leftValue, rightValue),
    max: Math.max(leftValue, rightValue),
    reversed: leftValue > rightValue,
  };
  if (kind === 'log' && !(scale.min > 0)) {
    fail(`Una escala logarítmica necesita valores positivos (el menor es ${scale.min}).`);
  }
  return scale;
}

/** Problemas de un marco de valor (lista vacía = válido). */
export function checkValueFrame(frame: ValueFrame): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(frame.leftPx) || !Number.isFinite(frame.rightPx)) {
    problems.push('Las columnas de los bordes de la pista deben ser números.');
  } else if (!(frame.rightPx > frame.leftPx)) {
    problems.push(`El borde derecho (columna ${frame.rightPx}) debe estar a la derecha del izquierdo (columna ${frame.leftPx}).`);
  }
  const s = frame.scale;
  if (!s || (s.kind !== 'linear' && s.kind !== 'log')) {
    problems.push('La escala de la curva debe ser lineal o logarítmica.');
  } else if (s.kind === 'log' && Number.isFinite(s.min) && !(s.min > 0)) {
    problems.push(`Una escala logarítmica necesita valores positivos (el menor es ${s.min}).`);
  } else if (validScale(s) === null) {
    problems.push(`La escala es inválida: el mínimo (${s.min}) debe ser menor que el máximo (${s.max}).`);
  }
  return problems;
}

/** Lanza `DigitizerError` si el marco no es válido. */
export function assertValueFrame(frame: ValueFrame): ValueFrame {
  const problems = checkValueFrame(frame);
  if (problems.length > 0) fail(problems[0]!);
  return frame;
}

/** Valor de la curva en la columna `x` (px). Extrapola fuera de la pista; en escala log siempre es > 0. */
export function valueAtX(frame: ValueFrame, x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const f = (x - frame.leftPx) / (frame.rightPx - frame.leftPx);
  return fractionToValue(f, frame.scale);
}

/** Columna (px, real) donde cae `value`. NaN si no hay dato (o ≤ 0 en escala log). Inversa de `valueAtX`. */
export function xAtValue(frame: ValueFrame, value: number): number {
  if (!Number.isFinite(value)) return NaN;
  const f = valueToFraction(value, frame.scale);
  return frame.leftPx + f * (frame.rightPx - frame.leftPx);
}
