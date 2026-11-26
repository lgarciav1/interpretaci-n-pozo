/**
 * Rayos gamma espectrales: GR ≈ a·Th + b·K + c·U y curva sin uranio (CGR). Ver decisión 0090.
 *
 * Funciones puras, sin UI y sin mutar las entradas. Ajuste por mínimos cuadrados ordinarios SIN intercepto,
 * resuelto con QR de Householder sobre columnas escaladas (sin formar las ecuaciones normales) y con
 * chequeo de condición: un sistema mal condicionado (p. ej. Th ∝ K) se declara `singular`.
 */

/** Coeficientes de conversión: gAPI/ppm de Th, gAPI/% de K y gAPI/ppm de U. */
export interface SpectralCoeffs {
  a: number;
  b: number;
  c: number;
}

/** Coeficientes estándar orientativos (herramientas NGS; dependen del fabricante y la calibración). */
export const STANDARD_SPECTRAL_COEFFS: Readonly<SpectralCoeffs> = Object.freeze({ a: 4, b: 16, c: 8 });

/** Mínimo de muestras válidas para ajustar. */
export const MIN_FIT_SAMPLES = 30;
/** R² por debajo del cual el ajuste se considera incoherente (se avisa, pero se usa). */
export const MIN_FIT_R2 = 0.85;

/** Recíproco mínimo del número de condición de Frobenius (columnas escaladas) para considerar identificable el ajuste. */
const MIN_RCOND = 1e-8;
const SQRT3 = Math.sqrt(3);

/** Muestra válida: las cuatro finitas, GR, Th y K ≥ 0; U puede ser levemente negativo (ruido de conteo). */
export function isValidSpectralSample(gr: number, th: number, k: number, u: number): boolean {
  return (
    Number.isFinite(gr) && Number.isFinite(th) && Number.isFinite(k) && Number.isFinite(u) && gr >= 0 && th >= 0 && k >= 0
  );
}

export interface SpectralFitOptions {
  start?: number;
  end?: number;
  /** Si se da, solo cuentan las muestras con mask[i] === 1. */
  mask?: ArrayLike<number>;
}

export interface SpectralFit extends SpectralCoeffs {
  n: number;
  r2: number;
  rmse: number;
  status: 'ok' | 'low-r2' | 'non-positive' | 'insufficient' | 'singular';
}

export interface SpectralFitStats {
  n: number;
  r2: number;
  rmse: number;
}

function range(len: number, opts?: SpectralFitOptions): [number, number] {
  const start = Math.max(0, opts?.start ?? 0);
  const end = Math.min(len, opts?.end ?? len);
  return [start, end];
}

function validIndices(
  gr: ArrayLike<number>,
  th: ArrayLike<number>,
  k: ArrayLike<number>,
  u: ArrayLike<number>,
  opts?: SpectralFitOptions,
): number[] {
  const len = Math.min(gr.length, th.length, k.length, u.length);
  const [start, end] = range(len, opts);
  const mask = opts?.mask;
  const idx: number[] = [];
  for (let i = start; i < end; i++) {
    if (mask && mask[i] !== 1) continue;
    if (isValidSpectralSample(gr[i]!, th[i]!, k[i]!, u[i]!)) idx.push(i);
  }
  return idx;
}

function stats(
  gr: ArrayLike<number>,
  th: ArrayLike<number>,
  k: ArrayLike<number>,
  u: ArrayLike<number>,
  idx: number[],
  { a, b, c }: SpectralCoeffs,
): SpectralFitStats {
  const n = idx.length;
  if (n === 0) return { n, r2: NaN, rmse: NaN };
  let mean = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const i of idx) {
    const g = gr[i]!;
    mean += g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  mean /= n;
  let sse = 0;
  let sst = 0;
  for (const i of idx) {
    const g = gr[i]!;
    const r = g - (a * th[i]! + b * k[i]! + c * u[i]!);
    sse += r * r;
    const d = g - mean;
    sst += d * d;
  }
  return { n, r2: n < 2 || min === max || !(sst > 0) ? NaN : 1 - sse / sst, rmse: Math.sqrt(sse / n) };
}

/** Norma euclídea sin desborde/subdesborde escalando por el máximo absoluto. */
function norm2(col: number[]): number {
  let maxAbs = 0;
  for (let i = 0; i < col.length; i++) {
    const a = Math.abs(col[i]!);
    if (a > maxAbs) maxAbs = a;
  }
  if (!(maxAbs > 0) || !Number.isFinite(maxAbs)) return maxAbs;
  let s = 0;
  for (let i = 0; i < col.length; i++) {
    const q = col[i]! / maxAbs;
    s += q * q;
  }
  return maxAbs * Math.sqrt(s);
}

/**
 * Resuelve min‖X·β − y‖ con X de n×3 por Householder. Devuelve null si no es identificable.
 * Las columnas se escalan a norma 1 antes de factorizar; el chequeo de condición usa el número de condición de
 * Frobenius exacto de R (3×3 triangular superior con ‖R‖_F = √3).
 */
function solveOls3(cols: [number[], number[], number[]], y: number[]): [number, number, number] | null {
  const n = y.length;
  const scale: number[] = [];
  const x = cols.map((col, j) => {
    const s = norm2(col);
    scale[j] = s;
    return s > 0 && Number.isFinite(s) ? col.map((v) => v / s) : col.slice();
  });
  if (scale.some((s) => !(s > 0) || !Number.isFinite(s))) return null;
  const rhs = y.slice();
  for (let j = 0; j < 3; j++) {
    let norm = 0;
    for (let i = j; i < n; i++) norm += x[j]![i]! * x[j]![i]!;
    norm = Math.sqrt(norm);
    if (!(norm > 0)) return null;
    const alpha = x[j]![j]! >= 0 ? -norm : norm;
    // v = x_j[j..] − alpha·e1, normalizado implícitamente por vᵀv.
    const v = new Array<number>(n - j);
    for (let i = j; i < n; i++) v[i - j] = x[j]![i]!;
    v[0] = v[0]! - alpha;
    let vtv = 0;
    for (const e of v) vtv += e * e;
    if (vtv > 0) {
      const apply = (col: number[]) => {
        let dot = 0;
        for (let i = j; i < n; i++) dot += v[i - j]! * col[i]!;
        const f = (2 * dot) / vtv;
        for (let i = j; i < n; i++) col[i] = col[i]! - f * v[i - j]!;
      };
      for (let m = j; m < 3; m++) apply(x[m]!);
      apply(rhs);
    }
  }
  const r00 = x[0]![0]!;
  const r01 = x[1]![0]!;
  const r02 = x[2]![0]!;
  const r11 = x[1]![1]!;
  const r12 = x[2]![1]!;
  const r22 = x[2]![2]!;
  if (r00 === 0 || r11 === 0 || r22 === 0) return null;
  // R⁻¹ exacta para triangular superior 3×3; ‖R‖_F = √3 porque las columnas de X escalado tienen norma 1.
  const inv00 = 1 / r00;
  const inv11 = 1 / r11;
  const inv22 = 1 / r22;
  const inv01 = -r01 / (r00 * r11);
  const inv12 = -r12 / (r11 * r22);
  const inv02 = (r01 * r12 - r02 * r11) / (r00 * r11 * r22);
  const invF = Math.hypot(inv00, inv11, inv22, inv01, inv12, inv02);
  const rcond = 1 / (SQRT3 * invF);
  if (!Number.isFinite(rcond) || !(rcond > MIN_RCOND)) return null;
  // Sustitución hacia atrás sobre R (triangular superior 3×3, columnas escaladas).
  const beta: number[] = [0, 0, 0];
  for (let j = 2; j >= 0; j--) {
    let s = rhs[j]!;
    for (let m = j + 1; m < 3; m++) s -= x[m]![j]! * beta[m]!;
    beta[j] = s / x[j]![j]!;
  }
  const out = beta.map((bj, j) => bj / scale[j]!);
  if (!out.every(Number.isFinite)) return null;
  return [out[0]!, out[1]!, out[2]!];
}

/**
 * Ajuste OLS sin intercepto GR ≈ a·Th + b·K + c·U sobre las muestras válidas de [start, end).
 * R² centrado (1 − SSE/Σ(GR − media)²) y RMSE = √(SSE/n).
 */
export function fitSpectralGr(
  gr: ArrayLike<number>,
  th: ArrayLike<number>,
  k: ArrayLike<number>,
  u: ArrayLike<number>,
  opts?: SpectralFitOptions,
): SpectralFit {
  const idx = validIndices(gr, th, k, u, opts);
  const n = idx.length;
  if (n < MIN_FIT_SAMPLES) return { a: NaN, b: NaN, c: NaN, n, r2: NaN, rmse: NaN, status: 'insufficient' };
  const sol = solveOls3(
    [idx.map((i) => th[i]!), idx.map((i) => k[i]!), idx.map((i) => u[i]!)],
    idx.map((i) => gr[i]!),
  );
  if (!sol) return { a: NaN, b: NaN, c: NaN, n, r2: NaN, rmse: NaN, status: 'singular' };
  const [a, b, c] = sol;
  const { r2, rmse } = stats(gr, th, k, u, idx, { a, b, c });
  const status = a <= 0 || b <= 0 || c <= 0 ? 'non-positive' : !(r2 >= MIN_FIT_R2) ? 'low-r2' : 'ok';
  return { a, b, c, n, r2, rmse, status };
}

/** Evalúa unos coeficientes dados sobre las muestras válidas de [start, end): n, R² centrado y RMSE. */
export function evaluateSpectralFit(
  gr: ArrayLike<number>,
  th: ArrayLike<number>,
  k: ArrayLike<number>,
  u: ArrayLike<number>,
  coeffs: SpectralCoeffs,
  opts?: SpectralFitOptions,
): SpectralFitStats {
  return stats(gr, th, k, u, validIndices(gr, th, k, u, opts), coeffs);
}

/** CGR = a·max(0, Th) + b·max(0, K); NaN si Th o K no son finitos. Escribe en out[start, end). */
export function cgrThKInto(
  th: ArrayLike<number>,
  k: ArrayLike<number>,
  out: Float64Array,
  coeffs: SpectralCoeffs,
  start = 0,
  end = out.length,
): void {
  const s = Math.max(0, start);
  const e = Math.min(out.length, end);
  const okCoeffs = Number.isFinite(coeffs.a) && Number.isFinite(coeffs.b) && coeffs.a >= 0 && coeffs.b >= 0;
  for (let i = s; i < e; i++) {
    const t = th[i]!;
    const p = k[i]!;
    out[i] = okCoeffs && Number.isFinite(t) && Number.isFinite(p) ? coeffs.a * Math.max(0, t) + coeffs.b * Math.max(0, p) : NaN;
  }
}

/** CGR = max(0, GR − c·U); NaN si GR o U no son finitos. Escribe en out[start, end). */
export function cgrResidualInto(
  gr: ArrayLike<number>,
  u: ArrayLike<number>,
  out: Float64Array,
  c: number,
  start = 0,
  end = out.length,
): void {
  const s = Math.max(0, start);
  const e = Math.min(out.length, end);
  const okC = Number.isFinite(c) && c >= 0;
  for (let i = s; i < e; i++) {
    const g = gr[i]!;
    const uu = u[i]!;
    out[i] = okC && Number.isFinite(g) && Number.isFinite(uu) ? Math.max(0, g - c * uu) : NaN;
  }
}

/**
 * Fracción del GR modelado atribuible al uranio: c·U/(a·Th + b·K + c·U), con Th, K, U recortados a ≥ 0 y el
 * resultado en [0, 1]. NaN si algún dato no es finito o el denominador no es positivo.
 */
export function uraniumGrFractionInto(
  th: ArrayLike<number>,
  k: ArrayLike<number>,
  u: ArrayLike<number>,
  out: Float64Array,
  coeffs: SpectralCoeffs,
  start = 0,
  end = out.length,
): void {
  const s = Math.max(0, start);
  const e = Math.min(out.length, end);
  const okCoeffs =
    Number.isFinite(coeffs.a) &&
    Number.isFinite(coeffs.b) &&
    Number.isFinite(coeffs.c) &&
    coeffs.a >= 0 &&
    coeffs.b >= 0 &&
    coeffs.c >= 0;
  for (let i = s; i < e; i++) {
    const t = th[i]!;
    const p = k[i]!;
    const uu = u[i]!;
    if (!okCoeffs || !Number.isFinite(t) || !Number.isFinite(p) || !Number.isFinite(uu)) {
      out[i] = NaN;
      continue;
    }
    const gu = coeffs.c * Math.max(0, uu);
    const den = coeffs.a * Math.max(0, t) + coeffs.b * Math.max(0, p) + gu;
    if (!(den > 0)) {
      out[i] = NaN;
      continue;
    }
    const f = gu / den;
    out[i] = f < 0 ? 0 : f > 1 ? 1 : f;
  }
}
