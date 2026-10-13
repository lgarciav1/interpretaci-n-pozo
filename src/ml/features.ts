/**
 * Características (features) de los modelos de facies y su construcción a partir de curvas de perfil.
 *
 * Los modelos usan SOLO curvas presentes en el dataset de entrenamiento (FORCE 2020) y en el pozo de aplicación (TP):
 *
 *   feature     FORCE 2020   pozo TP         unidad            transformación común
 *   GR          GR           GR              gAPI              ninguna
 *   RHOB        RHOB         ZDEN            g/cm³             ninguna
 *   NPHI        NPHI         NPHI            v/v               si viene en % (p95 > 1,5) se divide por 100
 *   PEF         PEF          PE              b/e               ninguna (ver variante sin PE: decisión 0029/0030)
 *   DTC         DTC          DT              µs/ft             ninguna
 *   LOG_RDEP    RDEP         AT90            log10(ohm·m)      log10 (solo si > 0)
 *   CALI        CALI         CAL             in                ninguna
 *
 * Los valores fuera del rango físico de cada característica se tratan como «sin dato» (NaN): el dataset FORCE tiene
 * picos espurios (GR > 1000, PEF > 300, RHOB < 1) y el TP tiene un caliper de 1,098 in con trépano de 8,5 in y picos
 * de NPHI de 3,3 v/v. Los NaN se manejan dentro del modelo (el árbol aprendió una dirección para el faltante en cada
 * corte), no se imputan.
 */

export type CurveKey = 'GR' | 'RHOB' | 'NPHI' | 'PEF' | 'DTC' | 'RDEP' | 'CALI';
export type FeatureName = 'GR' | 'RHOB' | 'NPHI' | 'PEF' | 'DTC' | 'LOG_RDEP' | 'CALI';

/** Curvas de entrada en las unidades de la tabla de arriba (resistividad en ohm·m, sin log). Las ausentes se omiten. */
export type ModelCurves = Partial<Record<CurveKey, ArrayLike<number>>>;

export interface FeatureDef {
  name: FeatureName;
  /** Curva de entrada de la que sale. */
  curve: CurveKey;
  label: string;
  unit: string;
  /** Rango físico válido de la curva de entrada, en su unidad, incluidos los extremos; fuera de él → NaN. */
  min: number;
  max: number;
  /** Si es true, la característica es log10 de la curva (solo valores > 0). */
  log10: boolean;
}

export const FEATURES: Readonly<Record<FeatureName, FeatureDef>> = {
  GR: { name: 'GR', curve: 'GR', label: 'Rayos gamma', unit: 'gAPI', min: 0, max: 500, log10: false },
  RHOB: { name: 'RHOB', curve: 'RHOB', label: 'Densidad', unit: 'g/cm³', min: 1.0, max: 3.3, log10: false },
  NPHI: { name: 'NPHI', curve: 'NPHI', label: 'Neutrón', unit: 'v/v', min: -0.05, max: 1.0, log10: false },
  PEF: { name: 'PEF', curve: 'PEF', label: 'Factor fotoeléctrico', unit: 'b/e', min: 0, max: 20, log10: false },
  DTC: { name: 'DTC', curve: 'DTC', label: 'Sónico compresional', unit: 'µs/ft', min: 30, max: 250, log10: false },
  LOG_RDEP: { name: 'LOG_RDEP', curve: 'RDEP', label: 'log10 resistividad profunda', unit: 'log10(ohm·m)', min: 0.03, max: 10000, log10: true },
  CALI: { name: 'CALI', curve: 'CALI', label: 'Caliper', unit: 'in', min: 3, max: 40, log10: false },
};

/** Mnemónicos aceptados por curva (mayúsculas), en orden de preferencia: el primero presente se usa. */
export const CURVE_ALIASES: Readonly<Record<CurveKey, readonly string[]>> = {
  GR: ['GR', 'GRC', 'GR_CAL', 'GAMMA'],
  RHOB: ['RHOB', 'ZDEN', 'RHOZ', 'DEN', 'RHOM'],
  NPHI: ['NPHI', 'TNPH', 'NPOR', 'CNL', 'NEUT'],
  PEF: ['PEF', 'PE', 'PEFZ'],
  DTC: ['DTC', 'DT', 'DTCO', 'AC'],
  RDEP: ['RDEP', 'AT90', 'ILD', 'LLD', 'RLA5', 'RT', 'RILD'],
  CALI: ['CALI', 'CAL', 'CALS', 'HCAL', 'CAL1'],
};

/**
 * Elige, para cada curva del modelo, la primera serie disponible entre sus alias (comparación sin distinguir
 * mayúsculas). Devuelve las curvas con los nombres canónicos de `ModelCurves`. No convierte unidades.
 */
export function resolveCurveAliases(named: Readonly<Record<string, ArrayLike<number>>>): ModelCurves {
  const upper = new Map<string, ArrayLike<number>>();
  for (const [k, v] of Object.entries(named)) upper.set(k.toUpperCase(), v);
  const out: ModelCurves = {};
  for (const key of Object.keys(CURVE_ALIASES) as CurveKey[]) {
    for (const alias of CURVE_ALIASES[key]) {
      const found = upper.get(alias);
      if (found) {
        out[key] = found;
        break;
      }
    }
  }
  return out;
}

export type NphiUnit = 'fraction' | 'percent' | 'auto';

export interface FeatureOptions {
  /** Unidad del neutrón de entrada. 'auto' (por defecto): porcentaje si el percentil 95 de los valores finitos > 1,5. */
  nphiUnit?: NphiUnit;
}

/** Percentil 95 de los valores finitos (tipo 1, sin interpolación). NaN si no hay ninguno. */
function percentile95(values: ArrayLike<number>): number {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) finite.push(values[i]!);
  if (finite.length === 0) return NaN;
  finite.sort((a, b) => a - b);
  return finite[Math.min(finite.length - 1, Math.floor(0.95 * finite.length))]!;
}

/** Detecta si el neutrón está en % (true) o en v/v (false) mirando el percentil 95 (robusto a picos espurios). */
export function nphiIsPercent(nphi: ArrayLike<number>): boolean {
  const p95 = percentile95(nphi);
  return Number.isFinite(p95) && p95 > 1.5;
}

export interface FeatureMatrix {
  /** Matriz fila a fila (n × d), Float32; NaN = sin dato. */
  X: Float32Array;
  n: number;
  d: number;
  featureNames: FeatureName[];
  /** Características pedidas cuya curva no se proporcionó (columna entera NaN). */
  missingCurves: CurveKey[];
}

/** Transforma un valor de la curva de entrada en su característica (NaN fuera del rango físico). */
export function featureValue(def: FeatureDef, raw: number): number {
  if (!Number.isFinite(raw) || raw < def.min || raw > def.max) return NaN;
  return def.log10 ? Math.log10(raw) : raw;
}

/**
 * Construye la matriz de características. Todas las curvas deben tener la misma longitud (si no, error). Si ninguna
 * de las curvas pedidas está presente, `n` sale 0.
 */
export function buildFeatureMatrix(
  curves: ModelCurves,
  featureNames: readonly FeatureName[],
  opts: FeatureOptions = {},
): FeatureMatrix {
  const d = featureNames.length;
  let n = -1;
  for (const name of featureNames) {
    const series = curves[FEATURES[name].curve];
    if (!series) continue;
    if (n < 0) n = series.length;
    else if (series.length !== n) throw new Error(`Las curvas tienen longitudes distintas (${n} y ${series.length}).`);
  }
  if (n < 0) n = 0;
  const X = new Float32Array(n * d).fill(NaN);
  const missingCurves: CurveKey[] = [];
  const nphiUnit = opts.nphiUnit ?? 'auto';
  for (let j = 0; j < d; j++) {
    const def = FEATURES[featureNames[j]!];
    const series = curves[def.curve];
    if (!series) {
      missingCurves.push(def.curve);
      continue;
    }
    let scale = 1;
    if (def.curve === 'NPHI') {
      const percent = nphiUnit === 'percent' || (nphiUnit === 'auto' && nphiIsPercent(series));
      if (percent) scale = 0.01;
    }
    for (let i = 0; i < n; i++) X[i * d + j] = featureValue(def, series[i]! * scale);
  }
  return { X, n, d, featureNames: [...featureNames], missingCurves };
}
