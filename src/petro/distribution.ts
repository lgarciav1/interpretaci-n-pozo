/**
 * Distribuciones por zona: percentiles ponderados por espesor y media según la propiedad, para boxplots.
 *
 * Unidades y convenciones idénticas a `summary.ts` (`summarizeRanges`): espesores en m, φ, Sw y Vsh en v/v (NO %),
 * k en mD; banderas netRes/netPay/washout 0/1/NaN; NaN = sin dato (nunca 0); hᵢ = `thickness[i]`; los intervalos son
 * rangos de índices [start, end) y varios rangos se acumulan (no deben solaparse).
 *
 * Cuantil ponderado (convención de este módulo). Con las muestras ordenadas por valor x₍₁₎ ≤ … ≤ x₍ₙ₎ y pesos wⱼ
 * (W = Σ wⱼ), cada muestra ocupa el tramo [Sⱼ₋₁/W, Sⱼ/W] de la CDF (Sⱼ = Σₖ≤ⱼ wₖ) y se ubica en su punto medio:
 *
 *   cⱼ = (Sⱼ₋₁ + wⱼ/2) / W
 *
 * El cuantil p se obtiene por interpolación lineal entre los puntos (cⱼ, x₍ⱼ₎); por debajo de c₁ vale x₍₁₎ y por
 * encima de cₙ vale x₍ₙ₎ (sin extrapolar). Con pesos iguales cⱼ = (j − 0,5)/n: es el método de Hazen (tipo 5 de
 * Hyndman y Fan; `np.percentile(..., method='hazen')`). Con pesos distintos cada muestra es una capa de espesor wⱼ cuyo
 * valor se asigna al centro de la capa; NO equivale a repetir la muestra wⱼ veces (esa equivalencia solo vale en
 * pesos iguales). Se ignoran valores no finitos y pesos ≤ 0 o no finitos.
 *
 * Estadística de un intervalo (`intervalDistribution`). Una muestra i del intervalo:
 *   1. entra al filtro: 'all' (todas), 'netRes' (netRes = 1) o 'netPay' (netRes = 1 y netPay = 1, como el sumario, si viene netRes). Una bandera NaN NO entra
 *      (igual que en el sumario); el espesor de esas muestras no se cuenta en ningún campo de salida;
 *   2. si `excludeWashout` y washout = 1, se descarta y su espesor suma a `excludedWashout` (washout NaN = sin dato
 *      de calidad: no se excluye);
 *   3. sin dato (valor NaN/no finito, h inválido, φ NaN con 'poreVolume', o valor ≤ 0 con 'geometric', porque el
 *      boxplot va en eje log) → su espesor suma a `noData`;
 *   4. el resto está "usada": suma a n y a `thickness`, y define min, max, percentiles y media.
 * Pesos de los percentiles: wᵢ = hᵢ ('thickness' y 'geometric') o wᵢ = hᵢ·φᵢ ('poreVolume'), siempre coherentes con
 * la media:
 *   'thickness'   x̄ = Σ hᵢxᵢ / Σ hᵢ            (φ, Vsh, k aritmética; mismo número que el sumario)
 *   'poreVolume'  x̄ = Σ hᵢφᵢxᵢ / Σ hᵢφᵢ        (Sw; mismo número que S̄w del sumario)
 *   'geometric'   x̄ = exp(Σ hᵢ·ln xᵢ / Σ hᵢ)   (k, solo xᵢ > 0)
 * `geoMean` se calcula siempre (solo con xᵢ > 0 y hᵢ > 0, aunque la media pedida sea otra) para poder mostrar ambas.
 * Sin datos → todo NaN (nunca 0); los espesores sí valen 0.
 *
 * Referencias: Hyndman, R.J. y Fan, Y. (1996), "Sample quantiles in statistical packages", The American Statistician
 * 50(4), definición 5 (Hazen); Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16
 * (φ promedio ponderada por espesor, Sw promedio ponderada por porosidad; k promedio en eje log).
 */

/** Percentiles por defecto de un boxplot: P10, P25, P50, P75, P90. */
export const DEFAULT_QUANTILES: readonly number[] = [0.1, 0.25, 0.5, 0.75, 0.9];

/**
 * Cuantiles ponderados (ver convención en la cabecera: interpolación sobre la CDF en los puntos medios de cada peso;
 * con pesos iguales, Hazen / tipo 5).
 *
 * @param values  valores (cualquier unidad); se ignoran los no finitos.
 * @param weights pesos ≥ 0 (p. ej. espesor en m); mismo largo que `values`. Se ignoran pesos ≤ 0 o no finitos.
 * @param probs   probabilidades en [0, 1]; por defecto [0,1; 0,25; 0,5; 0,75; 0,9]. Una p fuera de [0, 1] o NaN da NaN.
 * @returns un cuantil por cada p, en el mismo orden. Sin datos válidos → NaN en todos. No muta la entrada.
 */
export function weightedQuantiles(
  values: ArrayLike<number>,
  weights: ArrayLike<number>,
  probs: readonly number[] = DEFAULT_QUANTILES,
): number[] {
  const n = Math.min(values.length, weights.length);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = values[i]!;
    const w = weights[i]!;
    if (Number.isFinite(x) && Number.isFinite(w) && w > 0) idx.push(i);
  }
  idx.sort((a, b) => values[a]! - values[b]!);
  return quantilesOfSorted(
    idx.map((i) => values[i]!),
    idx.map((i) => weights[i]!),
    probs,
  );
}

/** Núcleo: `xs` ordenado ascendente, `ws` > 0 y finitos, mismo largo. */
function quantilesOfSorted(xs: readonly number[], ws: readonly number[], probs: readonly number[]): number[] {
  const m = xs.length;
  if (m === 0) return probs.map(() => NaN);
  let total = 0;
  for (let j = 0; j < m; j++) total += ws[j]!;
  const c = new Array<number>(m);
  let before = 0;
  for (let j = 0; j < m; j++) {
    c[j] = (before + ws[j]! / 2) / total;
    before += ws[j]!;
  }
  return probs.map((p) => {
    if (!(p >= 0 && p <= 1)) return NaN;
    if (p <= c[0]!) return xs[0]!;
    if (p >= c[m - 1]!) return xs[m - 1]!;
    // Búsqueda binaria: último j con c[j] <= p (existe j+1 porque p < c[m-1]).
    let lo = 0;
    let hi = m - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid]! <= p) lo = mid;
      else hi = mid;
    }
    const t = (p - c[lo]!) / (c[lo + 1]! - c[lo]!);
    return xs[lo]! + t * (xs[lo + 1]! - xs[lo]!);
  });
}

/** Cómo se promedia (y se ponderan los percentiles) de una propiedad. */
export type DistributionMean = 'thickness' | 'poreVolume' | 'geometric';

/** Qué muestras entran: todas, solo reservorio neto (netRes = 1) o solo pay neto (netPay = 1). */
export type DistributionFilter = 'all' | 'netRes' | 'netPay';

export interface DistributionInput {
  /** Valores de la curva (unidad canónica de su rol). NaN = sin dato. */
  values: ArrayLike<number>;
  /** m por muestra (ctx.thickness). */
  thickness: ArrayLike<number>;
  /** Banderas 0/1/NaN. Obligatoria si filter = 'netRes'. */
  netRes?: ArrayLike<number>;
  /** Obligatoria si filter = 'netPay'. */
  netPay?: ArrayLike<number>;
  /** IND_WASHOUT 0/1/NaN. Sin ella `excludeWashout` no excluye nada. */
  washout?: ArrayLike<number>;
  /** Porosidad v/v. Obligatoria si mean = 'poreVolume'. */
  phi?: ArrayLike<number>;
}

export interface DistributionOptions {
  filter: DistributionFilter;
  /** Descartar las muestras con IND_WASHOUT = 1. */
  excludeWashout: boolean;
  mean: DistributionMean;
}

export interface DistributionStats {
  /** Cantidad de muestras usadas. */
  n: number;
  /** m: Σh de las muestras usadas. */
  thickness: number;
  /** m: espesor (de las muestras que pasan el filtro) excluido por derrumbe. 0 si no se excluye. */
  excludedWashout: number;
  /** m: espesor (filtrado, sin derrumbe excluido) sin dato en la curva (o en φ con 'poreVolume'; o ≤ 0 con 'geometric'). */
  noData: number;
  min: number;
  max: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  /** Media según `options.mean` (para 'geometric', igual a `geoMean`). */
  mean: number;
  /** Media geométrica ponderada por espesor (solo valores > 0); NaN si no hay ninguno. */
  geoMean: number;
}

/**
 * Estadística de la curva `input.values` sobre la unión de `ranges` ([start, end), sin solaparse). Ver reglas en la
 * cabecera. Lanza un Error si falta una entrada requerida por las opciones (netRes, netPay o phi).
 */
export function intervalDistribution(
  input: DistributionInput,
  options: DistributionOptions,
  ranges: readonly { start: number; end: number }[],
): DistributionStats {
  const { values, thickness, netRes, netPay, washout, phi } = input;
  const { filter, excludeWashout, mean } = options;
  if (filter === 'netRes' && !netRes) throw new Error("El filtro 'netRes' requiere la bandera netRes.");
  if (filter === 'netPay' && !netPay) throw new Error("El filtro 'netPay' requiere la bandera netPay.");
  if (mean === 'poreVolume' && !phi) throw new Error("La media 'poreVolume' requiere la porosidad (phi).");
  const flag = filter === 'netRes' ? netRes : filter === 'netPay' ? netPay : undefined;
  const useWashout = excludeWashout && washout !== undefined;

  let excludedWashout = 0;
  let noData = 0;
  let sumH = 0;
  let sumW = 0; // Σ w
  let sumWX = 0; // Σ w·x
  let sumHLn = 0; // Σ h·ln x (x > 0)
  let sumHPos = 0; // Σ h (x > 0)
  let min = Infinity;
  let max = -Infinity;
  const xs: number[] = [];
  const ws: number[] = [];

  for (const { start, end } of ranges) {
    for (let i = start; i < end; i++) {
      if (flag && flag[i] !== 1) continue;
      // Pay = reservorio y pay, como en summarizeRanges (si viene netRes).
      if (filter === 'netPay' && netRes && netRes[i] !== 1) continue;
      const h = thickness[i]!;
      if (useWashout && washout![i] === 1) {
        if (Number.isFinite(h) && h > 0) excludedWashout += h;
        continue;
      }
      if (!Number.isFinite(h) || h <= 0) continue;
      const x = values[i]!;
      const p = phi ? phi[i]! : NaN;
      const valid =
        Number.isFinite(x) && (mean !== 'poreVolume' || Number.isFinite(p)) && (mean !== 'geometric' || x > 0);
      if (!valid) {
        noData += h;
        continue;
      }
      // Media geométrica sobre las mismas muestras válidas que el resto (solo x > 0).
      if (x > 0) {
        sumHLn += h * Math.log(x);
        sumHPos += h;
      }
      const w = mean === 'poreVolume' ? h * p : h;
      sumH += h;
      xs.push(x);
      ws.push(w);
      sumW += w;
      sumWX += w * x;
      if (x < min) min = x;
      if (x > max) max = x;
    }
  }

  const n = xs.length;
  const geoMean = sumHPos > 0 ? Math.exp(sumHLn / sumHPos) : NaN;
  const order = xs.map((_, j) => j).sort((a, b) => xs[a]! - xs[b]!);
  const q = quantilesOfSorted(
    order.filter((j) => ws[j]! > 0).map((j) => xs[j]!),
    order.filter((j) => ws[j]! > 0).map((j) => ws[j]!),
    DEFAULT_QUANTILES,
  );
  const arith = sumW > 0 ? sumWX / sumW : NaN;
  return {
    n,
    thickness: sumH,
    excludedWashout,
    noData,
    min: n > 0 ? min : NaN,
    max: n > 0 ? max : NaN,
    p10: q[0]!,
    p25: q[1]!,
    p50: q[2]!,
    p75: q[3]!,
    p90: q[4]!,
    mean: mean === 'geometric' ? geoMean : arith,
    geoMean,
  };
}

/** Media y escala de eje sugeridas para una propiedad. */
export interface SuggestedDistributionStat {
  mean: DistributionMean;
  scale: 'linear' | 'log';
}

/**
 * Media (y escala del eje) por defecto según el rol o mnemónico de la propiedad (sin distinguir mayúsculas):
 *   Sw, SWE, SW*, SXO (roles `SW`, `SXO`)   → 'poreVolume' (S̄w ponderada por volumen poral), eje lineal;
 *   k: PERM*, K, K_*, KLINK*, KAIR* (rol `PERM`) → 'geometric', eje log;
 *   resto (PHIE, PHIT, VSH, GR, RT, …)       → 'thickness', eje lineal.
 * El caso de φ/Vsh/k aritmética del sumario se obtiene pasando mean = 'thickness' explícitamente.
 */
export function suggestDistributionStat(roleOrMnemonic: string): SuggestedDistributionStat {
  const id = roleOrMnemonic.trim().toUpperCase();
  if (/^(SW|SXO)/.test(id)) return { mean: 'poreVolume', scale: 'linear' };
  if (/^(PERM|K$|K_|KLINK|KAIR)/.test(id)) return { mean: 'geometric', scale: 'log' };
  return { mean: 'thickness', scale: 'linear' };
}
