/**
 * Puesta en profundidad corona–perfil: desplazamiento sugerido por correlación.
 *
 * La profundidad de la corona (del perforador) y la del perfil (del cable) difieren en metros. Se barre un
 * desplazamiento s en [−maxShift, +maxShift] con paso `step` y, para cada s, se compara la propiedad medida en los
 * plugs (p. ej. φ de corona) con la curva del perfil (p. ej. PHIE) interpolada linealmente a z_plug + s. El
 * desplazamiento sugerido es el que maximiza el coeficiente de correlación de Pearson:
 *
 *   r(s) = Σ(cᵢ − c̄)(lᵢ − l̄) / √(Σ(cᵢ − c̄)² · Σ(lᵢ − l̄)²),   lᵢ = log(zᵢ + s)
 *
 * Convención de signo: la profundidad corregida es z_archivo + s (s > 0 = la corona baja).
 *
 * Se usa la correlación (no la diferencia cuadrática) porque es insensible a un sesgo o una escala entre las dos
 * mediciones (la φ de laboratorio suele diferir de la del perfil por presión de confinamiento y arcillas): lo que
 * se alinea es la FORMA de la curva.
 *
 * Calidad de la sugerencia (advertencias, en español):
 * - pocos puntos comparables (< `minPoints`) en todos los desplazamientos → sin sugerencia;
 * - máximo en el borde del barrido (el verdadero puede estar más allá: ampliar `maxShift`);
 * - máximo plano o ambiguo: otro máximo local a menos de `ambiguity` de r, separado más de 1 m;
 * - correlación débil (r < 0,5).
 * Un desplazamiento solo cuenta si compara al menos el 70 % de los plugs válidos (los que caen afuera del perfil o en
 * un tramo sin dato no pueden inflar r con pocos puntos).
 *
 * Referencias: Bateman, R.M. (1985), "Openhole Log Analysis and Formation Evaluation", cap. de calibración con
 * corona (depth matching por correlación de φ o GR de corona contra el perfil); Asquith y Krygowski (2004), cap. 1.
 */

export interface DepthShiftOptions {
  /** Desplazamiento máximo a probar, en m (por defecto 5). */
  maxShift?: number;
  /** Paso del barrido, en m (por defecto 0,05). */
  step?: number;
  /** Mínimo de plugs comparables para calcular r (por defecto 5). */
  minPoints?: number;
  /** Diferencia de r por debajo de la cual otro máximo local vuelve ambigua la sugerencia (por defecto 0,02). */
  ambiguity?: number;
}

export interface DepthShiftResult {
  /** Desplazamiento sugerido (m), o null si no hay ninguno calculable. */
  best: number | null;
  /** r en el desplazamiento sugerido (NaN si no hay). */
  r: number;
  /** Plugs comparados en el desplazamiento sugerido. */
  n: number;
  /** Desplazamientos probados (m) y r de cada uno (NaN = no se pudo calcular): la curva r(s). */
  shifts: Float64Array;
  rs: Float64Array;
  /** El máximo cayó en el borde del barrido. */
  atEdge: boolean;
  /** Hay otro máximo casi igual a más de 1 m: la sugerencia es ambigua. */
  ambiguous: boolean;
  /** Advertencias para el usuario (español). */
  warnings: string[];
}

/**
 * Valor de la curva interpolado linealmente en z (profundidad creciente). NaN fuera del rango, si un vecino no tiene
 * dato, o si z no es finito.
 */
export function interpolateAt(depth: ArrayLike<number>, values: ArrayLike<number>, z: number): number {
  const n = Math.min(depth.length, values.length);
  if (n === 0 || !Number.isFinite(z) || z < depth[0]! || z > depth[n - 1]!) return NaN;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (depth[mid]! <= z) lo = mid;
    else hi = mid;
  }
  const z0 = depth[lo]!;
  const z1 = depth[hi]!;
  const v0 = values[lo]!;
  const v1 = values[hi]!;
  if (z === z0) return Number.isFinite(v0) ? v0 : NaN;
  if (z === z1) return Number.isFinite(v1) ? v1 : NaN;
  if (!Number.isFinite(v0) || !Number.isFinite(v1) || !(z1 > z0)) return NaN;
  return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
}

/** Coeficiente de correlación de Pearson de los pares finitos (NaN si hay menos de 2 o alguna varianza es nula). */
export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): { r: number; n: number } {
  const len = Math.min(x.length, y.length);
  let n = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < len; i++) {
    const a = x[i]!;
    const b = y[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n++;
    mx += a;
    my += b;
  }
  if (n < 2) return { r: NaN, n };
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < len; i++) {
    const a = x[i]!;
    const b = y[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const da = a - mx;
    const db = b - my;
    sxx += da * da;
    syy += db * db;
    sxy += da * db;
    sa += a * a;
    sb += b * b;
  }
  // Varianza nula con tolerancia relativa: una serie constante deja ~1e-33 por redondeo de la media, no cero exacto, y
  // daría un r de ruido (±1e-16) en vez de NaN.
  if (!(sxx > 1e-20 * sa) || !(syy > 1e-20 * sb)) return { r: NaN, n };
  return { r: Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))), n };
}

const fmt = (v: number) => v.toFixed(2).replace('.', ',').replace('-', '−');

/**
 * Barre desplazamientos y devuelve el que maximiza la correlación entre la propiedad de corona y el perfil.
 *
 * @param coreDepth  profundidad de cada plug (m, la del archivo SIN corregir)
 * @param coreValue  propiedad del plug (misma unidad que el perfil: p. ej. φ en v/v)
 * @param logDepth   profundidad del perfil (m, creciente)
 * @param logValue   curva del perfil (NaN = sin dato)
 */
export function suggestDepthShift(
  coreDepth: ArrayLike<number>,
  coreValue: ArrayLike<number>,
  logDepth: ArrayLike<number>,
  logValue: ArrayLike<number>,
  opts: DepthShiftOptions = {},
): DepthShiftResult {
  const maxShift = Math.abs(opts.maxShift ?? 5);
  const step = opts.step && opts.step > 0 ? opts.step : 0.05;
  const minPoints = Math.max(2, opts.minPoints ?? 5);
  const ambiguity = opts.ambiguity ?? 0.02;
  const k = Math.max(0, Math.round(maxShift / step));
  const count = 2 * k + 1;
  const shifts = new Float64Array(count);
  const rs = new Float64Array(count).fill(NaN);
  const ns = new Int32Array(count);

  // Plugs con valor y profundidad válidos.
  const zs: number[] = [];
  const cs: number[] = [];
  const len = Math.min(coreDepth.length, coreValue.length);
  for (let i = 0; i < len; i++) {
    const z = coreDepth[i]!;
    const c = coreValue[i]!;
    if (Number.isFinite(z) && Number.isFinite(c)) {
      zs.push(z);
      cs.push(c);
    }
  }
  const valid = zs.length;
  const need = Math.max(minPoints, Math.ceil(0.7 * valid));
  const logs = new Float64Array(valid);
  for (let j = 0; j < count; j++) {
    const s = +((j - k) * step).toFixed(10);
    shifts[j] = s;
    for (let i = 0; i < valid; i++) logs[i] = interpolateAt(logDepth, logValue, zs[i]! + s);
    const { r, n } = pearson(cs, logs);
    ns[j] = n;
    if (n >= need && Number.isFinite(r)) rs[j] = r;
  }

  let bestJ = -1;
  for (let j = 0; j < count; j++) {
    const r = rs[j]!;
    if (!Number.isFinite(r)) continue;
    // Empates: el de menor |s| (no mover la corona sin motivo).
    if (bestJ < 0 || r > rs[bestJ]! + 1e-12 || (Math.abs(r - rs[bestJ]!) <= 1e-12 && Math.abs(shifts[j]!) < Math.abs(shifts[bestJ]!))) bestJ = j;
  }

  const warnings: string[] = [];
  if (bestJ < 0) {
    warnings.push(
      valid < minPoints
        ? `Hacen falta al menos ${minPoints} plugs con dato para sugerir un desplazamiento (hay ${valid}).`
        : 'La curva del perfil no tiene datos (o es constante) frente a los plugs: no se puede correlacionar.',
    );
    return { best: null, r: NaN, n: 0, shifts, rs, atEdge: false, ambiguous: false, warnings };
  }
  const best = shifts[bestJ]!;
  const rBest = rs[bestJ]!;
  // Borde: el máximo está en un extremo del barrido o al lado de un tramo sin r (el verdadero puede estar más allá).
  const atEdge = bestJ === 0 || bestJ === count - 1 || !Number.isFinite(rs[bestJ - 1]!) || !Number.isFinite(rs[bestJ + 1]!);
  // Ambigüedad: otro máximo local casi igual, separado más de 1 m.
  let ambiguous = false;
  for (let j = 1; j < count - 1; j++) {
    const r = rs[j]!;
    if (j === bestJ || !Number.isFinite(r)) continue;
    const prev = Number.isFinite(rs[j - 1]!) ? rs[j - 1]! : -Infinity;
    const next = Number.isFinite(rs[j + 1]!) ? rs[j + 1]! : -Infinity;
    const isPeak = r >= prev && r >= next;
    if (isPeak && rBest - r <= ambiguity && Math.abs(shifts[j]! - best) > 1) {
      ambiguous = true;
      break;
    }
  }
  if (atEdge) warnings.push(`El máximo de correlación quedó en el borde de la búsqueda (${fmt(best)} m): el desplazamiento real puede ser mayor; ampliá el rango o revisá los datos.`);
  if (ambiguous) warnings.push('La correlación tiene otro máximo casi igual a más de 1 m: la sugerencia es ambigua; elegí el desplazamiento mirando los plugs sobre el perfil.');
  if (rBest < 0.5) warnings.push(`La correlación es débil (r = ${fmt(rBest)}): la sugerencia es poco confiable.`);
  return { best, r: rBest, n: ns[bestJ]!, shifts, rs, atEdge, ambiguous, warnings };
}
