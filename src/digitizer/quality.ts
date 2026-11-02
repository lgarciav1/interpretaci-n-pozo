/**
 * Calidad de la digitalización: métricas y banderas con umbrales documentados, para que la interfaz avise «la calidad
 * es baja». Puro (sin DOM). Todas las métricas se calculan sobre el trazo en píxeles (donde están las causas: huecos,
 * temblor, saltos) más la calibración de profundidad.
 *
 * MÉTRICAS
 * - coverage: filas con dato / filas esperadas (el tramo del trazo, o `expectedRows` si el usuario pidió un tramo mayor).
 * - observedFraction: filas observadas en el trazo (no interpoladas dentro de huecos) / filas esperadas.
 * - jumps: pares de filas consecutivas con dato cuya posición cambia más de `jumpFraction` (0,15) del ancho de la pista.
 *   Un escalón real (cambio de capa) cuenta como salto; son esperables pocos, por eso la bandera usa una tasa.
 * - jumpsPer1000Rows = jumps / filas con dato × 1000.
 * - roughnessPx: temblor estimado = RMS de la segunda diferencia x[i-1] − 2x[i] + x[i+1] (tripletas de filas consecutivas
 *   con dato, sin saltos) dividido por √6, que es el RMS de esa diferencia para ruido blanco de desvío 1 px. Una curva
 *   suave da ≈ 0; ruido de ±σ px da ≈ σ.
 * - meanConfidence: confianza media de los puntos con dato.
 * - calibrationRmsPx / calibrationRmsM: residuo RMS de los amarres de profundidad contra una recta (escaneo estirado).
 *   Solo levanta bandera con el método 'linear' y ≥ 3 amarres: con 'piecewise' el estiramiento ya está absorbido (la
 *   advertencia queda en `DepthCalibration.warnings`).
 *
 * BANDERAS (umbrales por defecto en `DEFAULT_QUALITY_THRESHOLDS`)
 *   warning  cobertura < 80 %          | saltos > 5 por 1000 filas | temblor > 1,5 px | confianza media < 0,5 | calibración > 2 px
 *   poor     cobertura < 50 %          | saltos > 20 por 1000 filas | temblor > 4 px  | confianza media < 0,3 | calibración > 5 px
 * `level` = el peor nivel de las banderas ('good' si no hay ninguna). `isLowQuality` = level ≠ 'good'.
 */
import { DigitizerError } from './errors';
import type { DepthCalibration, TracedCurve, ValueFrame } from './types';

export interface QualityThresholds {
  coverageWarn: number;
  coveragePoor: number;
  jumpFraction: number;
  jumpsPer1000Warn: number;
  jumpsPer1000Poor: number;
  roughnessWarnPx: number;
  roughnessPoorPx: number;
  confidenceWarn: number;
  confidencePoor: number;
  calibrationWarnPx: number;
  calibrationPoorPx: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: Readonly<QualityThresholds> = {
  coverageWarn: 0.8,
  coveragePoor: 0.5,
  jumpFraction: 0.15,
  jumpsPer1000Warn: 5,
  jumpsPer1000Poor: 20,
  roughnessWarnPx: 1.5,
  roughnessPoorPx: 4,
  confidenceWarn: 0.5,
  confidencePoor: 0.3,
  calibrationWarnPx: 2,
  calibrationPoorPx: 5,
};

export interface QualityMetrics {
  /** Filas esperadas / con dato. */
  rows: number;
  rowsWithData: number;
  coverage: number;
  observedFraction: number;
  jumps: number;
  jumpsPer1000Rows: number;
  roughnessPx: number;
  meanConfidence: number;
  calibrationRmsPx: number;
  calibrationRmsM: number;
}

export type QualityCode = 'low-coverage' | 'jumps' | 'rough' | 'low-confidence' | 'calibration';
export type QualityLevel = 'good' | 'warning' | 'poor';

export interface QualityFlag {
  code: QualityCode;
  level: 'warning' | 'poor';
  /** Mensaje en español, listo para mostrar. */
  message: string;
}

export interface QualityReport {
  metrics: QualityMetrics;
  flags: QualityFlag[];
  level: QualityLevel;
  isLowQuality: boolean;
}

export interface AssessOptions {
  thresholds?: Partial<QualityThresholds>;
  /** Tramo de filas que el usuario quería digitalizar (inclusive); por defecto, el del trazo. */
  expectedRows?: { y0: number; y1: number };
}

const pct = (v: number) => `${(100 * v).toFixed(0)} %`;

export function assessQuality(trace: TracedCurve, depth: DepthCalibration, frame: ValueFrame, opts: AssessOptions = {}): QualityReport {
  const T: QualityThresholds = { ...DEFAULT_QUALITY_THRESHOLDS, ...(opts.thresholds ?? {}) };
  const width = frame.rightPx - frame.leftPx;
  if (!(width > 0)) throw new DigitizerError('invalid-calibration', 'El marco de la curva no tiene ancho: no se puede evaluar la calidad.');
  const n = trace.x.length;
  const exp = opts.expectedRows;
  const rows = exp ? Math.max(0, Math.floor(exp.y1) - Math.ceil(exp.y0) + 1) : n;
  let withData = 0;
  let observed = 0;
  let confSum = 0;
  let jumps = 0;
  let ss2 = 0;
  let n2 = 0;
  const jumpPx = T.jumpFraction * width;
  for (let i = 0; i < n; i++) {
    const y = trace.y0 + i;
    if (exp && (y < exp.y0 || y > exp.y1)) continue;
    const x = trace.x[i]!;
    if (Number.isNaN(x)) continue;
    withData++;
    if (trace.observed[i]) observed++;
    confSum += trace.confidence[i]!;
    if (i > 0 && !Number.isNaN(trace.x[i - 1]!)) {
      const dx = Math.abs(x - trace.x[i - 1]!);
      if (dx > jumpPx) jumps++;
      if (i > 1 && !Number.isNaN(trace.x[i - 2]!) && dx <= jumpPx && Math.abs(trace.x[i - 1]! - trace.x[i - 2]!) <= jumpPx) {
        const d2 = trace.x[i - 2]! - 2 * trace.x[i - 1]! + x;
        ss2 += d2 * d2;
        n2++;
      }
    }
  }
  const metrics: QualityMetrics = {
    rows,
    rowsWithData: withData,
    coverage: rows > 0 ? withData / rows : 0,
    observedFraction: rows > 0 ? observed / rows : 0,
    jumps,
    jumpsPer1000Rows: withData > 0 ? (1000 * jumps) / withData : 0,
    roughnessPx: n2 > 0 ? Math.sqrt(ss2 / n2) / Math.sqrt(6) : 0,
    meanConfidence: withData > 0 ? confSum / withData : 0,
    calibrationRmsPx: depth.rmsResidualPx,
    calibrationRmsM: depth.rmsResidualM,
  };

  const flags: QualityFlag[] = [];
  const add = (code: QualityCode, poor: boolean, message: string) => flags.push({ code, level: poor ? 'poor' : 'warning', message });
  if (metrics.coverage < T.coverageWarn) {
    add('low-coverage', metrics.coverage < T.coveragePoor, `Solo se recuperó dato en el ${pct(metrics.coverage)} de las filas: la curva tiene huecos grandes. Probá otro color, más tolerancia o el modo guiado.`);
  }
  if (metrics.jumpsPer1000Rows > T.jumpsPer1000Warn) {
    add('jumps', metrics.jumpsPer1000Rows > T.jumpsPer1000Poor, `Hay ${metrics.jumps} saltos bruscos (${metrics.jumpsPer1000Rows.toFixed(1)} cada 1000 filas): el trazo pudo saltar a otra curva o a texto. Revisalo en el modo guiado.`);
  }
  if (metrics.roughnessPx > T.roughnessWarnPx) {
    add('rough', metrics.roughnessPx > T.roughnessPoorPx, `El trazo tiembla ${metrics.roughnessPx.toFixed(1)} px (estimado): imagen con ruido o desenfocada. Podés suavizarlo con la mediana móvil.`);
  }
  if (withData > 0 && metrics.meanConfidence < T.confidenceWarn) {
    add('low-confidence', metrics.meanConfidence < T.confidencePoor, `La confianza media del trazo es ${metrics.meanConfidence.toFixed(2)}: muchos puntos son dudosos o interpolados.`);
  }
  if (depth.method === 'linear' && depth.ties.length >= 3 && metrics.calibrationRmsPx > T.calibrationWarnPx) {
    add('calibration', metrics.calibrationRmsPx > T.calibrationPoorPx, `Los amarres de profundidad se apartan ${metrics.calibrationRmsPx.toFixed(1)} px de una recta: el escaneo puede estar estirado o un amarre está mal puesto.`);
  }
  const level: QualityLevel = flags.some((f) => f.level === 'poor') ? 'poor' : flags.length > 0 ? 'warning' : 'good';
  return { metrics, flags, level, isLowQuality: level !== 'good' };
}

/** Fracción de muestras con dato (no NaN) de un array ya remuestreado; opcionalmente solo del tramo [i0, i1). */
export function coverageOf(values: ArrayLike<number>, i0 = 0, i1 = values.length): number {
  const a = Math.max(0, i0);
  const b = Math.min(values.length, i1);
  if (b <= a) return 0;
  let c = 0;
  for (let i = a; i < b; i++) if (!Number.isNaN(values[i]!)) c++;
  return c / (b - a);
}
