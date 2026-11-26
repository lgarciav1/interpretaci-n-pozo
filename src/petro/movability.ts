/**
 * Saturación en zona lavada (Sxo), hidrocarburo móvil (MOS), hidrocarburo residual (SHR) e índice de movilidad (MHI).
 *
 * Motor petrofísico puro (sin dependencias de UI ni React; ejecutable en Web Worker). Implementa el ADR 0091:
 *   - Método de cocientes (`ratio`, independiente de φ):
 *       r = ((Rxo / Rt) / (Rmf / Rw))^(1/n),        Sxo_bruto = Sw / r
 *   - Archie en zona lavada (`archie`):
 *       Sxo_bruto = (a · Rmf(T) / (φ^m · Rxo))^(1/n)
 *     con corrección opcional de Rmf a temperatura de formación por Arps (`arpsResistivityC`).
 *   - Recorte físico Sxo ∈ [Sw, 1] cuando Sw es finito:
 *       MOS = max(0, Sxo − Sw) = Sxo − Sw
 *       SHR = 1 − Sxo
 *       MHI = Sw / Sxo   (NaN si Sxo = 0)
 *     garantizando el cierre volumétrico exacto Sw + MOS + SHR = 1 y MOS + SHR = 1 − Sw = Sh.
 *
 * Unidades: resistividades (Rxo, Rt, Rmf, Rw) en Ω·m; temperaturas en °C; porosidad (φ) y saturaciones (Sw, Sxo,
 * MOS, SHR) en v/v (fracción, NO %); MHI y Rmf/Rw adimensionales; espesores en m (o unidad consistente).
 *
 * Guardas: todo parámetro físico que deba ser positivo (Rxo, Rt, Rmf, Rmf/Rw, φ, a, m, n, espesor) exige ser finito
 * y estrictamente mayor que cero; valores ≤ 0, NaN o ±Infinity producen NaN.
 *
 * Referencias:
 *   - Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed., AAPG Methods in Exploration 16, cap. 6.
 *   - Schlumberger (1989). Log Interpretation Principles/Applications, cap. 8.
 *   - Archie, G. E. (1942). Trans. AIME 146.
 */

import { arpsResistivityC } from './temperature';

/** Relación Rmf / Rw por defecto (coherente con Rmf = 0,5 Ω·m y Rw = 0,05 Ω·m). */
export const DEFAULT_RMF_OVER_RW = 10;

/** Umbral clásico de hidrocarburo móvil en areniscas (MHI = Sw / Sxo < 0,7; Asquith y Krygowski, cap. 6). */
export const MHI_MOVABLE_SANDSTONE = 0.7;

/** Referencia de movilidad alta de hidrocarburos (MHI = Sw / Sxo < 0,5). */
export const MHI_HIGH_MOBILITY = 0.5;

/** Tolerancia numérica para detectar anomalías Sxo_bruto < Sw o recorte superior Sxo_bruto > 1. */
export const SXO_BELOW_SW_TOL = 1e-6;

/** Método de estimación de Sxo en la zona lavada. */
export type MovabilityMethod = 'ratio' | 'archie';

/** Resultado por muestra de la evaluación de movilidad de hidrocarburos. */
export interface MovabilitySampleResult {
  /** Saturación de agua en zona lavada recortada a [Sw, 1] (o [0, 1] en Archie sin Sw), v/v. */
  sxo: number;
  /** Saturación en zona lavada sin recortar (para diagnóstico de anomalías), v/v. */
  sxoRaw: number;
  /** Saturación de hidrocarburo móvil: MOS = max(0, Sxo − Sw), v/v. */
  mos: number;
  /** Saturación de hidrocarburo residual: SHR = 1 − Sxo, v/v. */
  shr: number;
  /** Índice de movilidad de hidrocarburos: MHI = Sw / Sxo (adimensional; NaN si Sxo ≤ 0). */
  mhi: number;
  /** Verdadero si Sxo_bruto < Sw − SXO_BELOW_SW_TOL (posible lodo OBM o Rmf/Rw subestimado). */
  belowSw: boolean;
  /** Verdadero si Sxo_bruto > 1 + SXO_BELOW_SW_TOL (recortado a 1). */
  clippedHigh: boolean;
}

/** Conteos de diagnóstico sobre un tramo evaluado con `movabilityInto`. */
export interface MovabilityCounts {
  /** Cantidad total de muestras procesadas en [start, end). */
  total: number;
  /** Muestras con Sxo finito resuelto. */
  resolved: number;
  /** Muestras resueltas con Sxo_bruto < Sw − SXO_BELOW_SW_TOL. */
  belowSw: number;
  /** Muestras resueltas con Sxo_bruto > 1 + SXO_BELOW_SW_TOL. */
  clippedHigh: number;
  /** Muestras sin Rxo válido (NaN, ≤ 0 o ±Infinity). */
  missingRxo: number;
  /** Muestras con Rxo válido donde faltó otra entrada o parámetro (Sw, Rt, φ, Temp o parámetros). */
  missingInputs: number;
}

/** Parámetros del motor de movilidad. */
export interface MovabilityParams {
  method: MovabilityMethod;
  /** Cociente Rmf / Rw en zona acuífera (adimensional, > 0; usado en `ratio`). */
  rmfOverRw: number;
  /** Resistividad del filtrado de lodo medida a `tRmf` (Ω·m, > 0; usado en `archie`). */
  rmf: number;
  /** Temperatura de medición de `rmf` (°C; usado en `archie` si `correctRmfTemp` está activo). */
  tRmf: number;
  /** Si es verdadero y existe curva `temp`, corrige `rmf` a temperatura de formación con Arps. */
  correctRmfTemp: boolean;
  /** Factor de tortuosidad de Archie (> 0). */
  a: number;
  /** Exponente de cementación de Archie (> 0). */
  m: number;
  /** Exponente de saturación (> 0). */
  n: number;
}

/** Curvas de entrada para evaluación por tramo. */
export interface MovabilityInputs {
  sw: ArrayLike<number>;
  phi: ArrayLike<number>;
  rxo: ArrayLike<number>;
  rt?: ArrayLike<number>;
  temp?: ArrayLike<number>;
}

/** Arreglos de salida preasignados para `movabilityInto`. */
export interface MovabilityOutputs {
  sxo: Float64Array;
  mos: Float64Array;
  shr: Float64Array;
  mhi: Float64Array;
}

/** Resumen estadístico de movilidad en una zona o intervalo. */
export interface MovabilityZoneSummary {
  totalSamples: number;
  rxoSamples: number;
  resolvedSamples: number;
  resolvedPct: number;
  swMean: number;
  sxoMean: number;
  mosMean: number;
  shrMean: number;
  mhiMean: number;
  movableHcFraction: number;
  movableSamplesPct: number;
}

/** Recorta a [0, 1] propagando NaN. Interno. */
function clip01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Verdadero si `x` es finito y estrictamente positivo. Interno. */
function isPositiveFinite(x: number): boolean {
  return x > 0 && Number.isFinite(x);
}

/** Resultado vacío cuando una muestra no tiene entradas o parámetros válidos. Interno. */
function invalidSample(): MovabilitySampleResult {
  return {
    sxo: NaN,
    sxoRaw: NaN,
    mos: NaN,
    shr: NaN,
    mhi: NaN,
    belowSw: false,
    clippedHigh: false,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Funciones puras escalares
// ---------------------------------------------------------------------------------------------------------------

/**
 * Índice de movilidad por método de cocientes (sin recorte):
 *   r = ((Rxo / Rt) / (Rmf / Rw))^(1 / n).
 * Devuelve NaN si algún argumento no es finito positivo.
 */
export function ratioMhi(rxo: number, rt: number, rmfOverRw: number, n = 2): number {
  if (
    !isPositiveFinite(rxo) ||
    !isPositiveFinite(rt) ||
    !isPositiveFinite(rmfOverRw) ||
    !isPositiveFinite(n)
  ) {
    return NaN;
  }
  return Math.pow(rxo / rt / rmfOverRw, 1 / n);
}

/**
 * Saturación en zona lavada sin recortar por método de cocientes: Sxo_bruto = clip01(Sw) / ratioMhi(...).
 * Devuelve NaN si `sw` no es finito o `ratioMhi(...)` no es finito positivo; 0 si `clip01(sw) === 0`;
 * conserva Infinity ante desborde para que el recorte posterior dé 1.
 */
export function ratioSxoRaw(
  sw: number,
  rxo: number,
  rt: number,
  rmfOverRw: number,
  n = 2,
): number {
  if (!Number.isFinite(sw)) return NaN;
  const r = ratioMhi(rxo, rt, rmfOverRw, n);
  if (!isPositiveFinite(r)) return NaN;
  const s = clip01(sw);
  if (s === 0) return 0;
  return s / r;
}

/**
 * Saturación de agua en zona lavada por Archie (sin recorte contra Sw):
 *   Sxo = clip01(((a · Rmf) / (φ^m · Rxo))^(1 / n)).
 * Devuelve NaN si algún argumento no es finito positivo.
 */
export function archieSxo(
  rxo: number,
  phi: number,
  rmf: number,
  a: number,
  m: number,
  n: number,
): number {
  if (
    !isPositiveFinite(rxo) ||
    !isPositiveFinite(phi) ||
    !isPositiveFinite(rmf) ||
    !isPositiveFinite(a) ||
    !isPositiveFinite(m) ||
    !isPositiveFinite(n)
  ) {
    return NaN;
  }
  return clip01(Math.pow((a * rmf) / (Math.pow(phi, m) * rxo), 1 / n));
}

/** Saturación de hidrocarburo móvil: MOS = max(0, clip01(Sxo) − clip01(Sw)); NaN si alguno no es finito. */
export function movableOilSaturation(sw: number, sxo: number): number {
  if (!Number.isFinite(sw) || !Number.isFinite(sxo)) return NaN;
  return Math.max(0, clip01(sxo) - clip01(sw));
}

/** Saturación de hidrocarburo residual: SHR = 1 − clip01(Sxo); NaN si no es finito. */
export function residualHydrocarbonSaturation(sxo: number): number {
  if (!Number.isFinite(sxo)) return NaN;
  return 1 - clip01(sxo);
}

/** Índice de movilidad de hidrocarburos: MHI = clip01(Sw) / clip01(Sxo); NaN si alguno no es finito o clip01(Sxo) ≤ 0. */
export function hydrocarbonMovabilityIndex(sw: number, sxo: number): number {
  if (!Number.isFinite(sw) || !Number.isFinite(sxo)) return NaN;
  const sxoC = clip01(sxo);
  if (sxoC <= 0) return NaN;
  return clip01(sw) / sxoC;
}

/**
 * Fracción móvil del hidrocarburo presente: MOS / (1 − Sw) = clip01(max(0, Sxo − Sw) / (1 − Sw)).
 * Devuelve NaN si algún argumento no es finito o si 1 − clip01(Sw) ≤ 0 (zona 100 % agua).
 */
export function movableHydrocarbonFraction(sw: number, sxo: number): number {
  if (!Number.isFinite(sw) || !Number.isFinite(sxo)) return NaN;
  const swC = clip01(sw);
  const sh = 1 - swC;
  if (sh <= 0) return NaN;
  return clip01(Math.max(0, clip01(sxo) - swC) / sh);
}

/**
 * Ordenada Rxo de una recta de movilidad constante en el gráfico log–log Rt–Rxo:
 *   Rxo = Rt · (Rmf / Rw) · MHI^n.
 * Con `mhi = 1` traza la recta de agua; con `mhi = 0,7` o `0,5`, las guías de movilidad.
 * Devuelve NaN si algún argumento no es finito positivo.
 */
export function rtRxoLineRxo(rt: number, rmfOverRw: number, mhi = 1, n = 2): number {
  if (
    !isPositiveFinite(rt) ||
    !isPositiveFinite(rmfOverRw) ||
    !isPositiveFinite(mhi) ||
    !isPositiveFinite(n)
  ) {
    return NaN;
  }
  const rxo = rt * rmfOverRw * Math.pow(mhi, n);
  return isPositiveFinite(rxo) ? rxo : NaN;
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluación por muestra y por tramo
// ---------------------------------------------------------------------------------------------------------------

/** Crea un objeto de conteos inicializado en cero. */
export function emptyMovabilityCounts(): MovabilityCounts {
  return {
    total: 0,
    resolved: 0,
    belowSw: 0,
    clippedHigh: 0,
    missingRxo: 0,
    missingInputs: 0,
  };
}

/**
 * Evalúa Sxo, MOS, SHR, MHI y banderas de recorte físico para una muestra individual según el método elegido.
 */
export function evaluateMovabilitySample(
  input: { sw: number; phi: number; rxo: number; rt?: number; temp?: number },
  params: MovabilityParams,
): MovabilitySampleResult {
  let sxoRaw: number;

  if (params.method === 'ratio') {
    if (
      !Number.isFinite(input.sw) ||
      !isPositiveFinite(input.rxo) ||
      input.rt === undefined ||
      !isPositiveFinite(input.rt) ||
      !isPositiveFinite(params.rmfOverRw) ||
      !isPositiveFinite(params.n)
    ) {
      return invalidSample();
    }
    sxoRaw = ratioSxoRaw(input.sw, input.rxo, input.rt, params.rmfOverRw, params.n);
    if (Number.isNaN(sxoRaw) || sxoRaw < 0) return invalidSample();
  } else if (params.method === 'archie') {
    if (
      !isPositiveFinite(input.rxo) ||
      !isPositiveFinite(input.phi) ||
      !isPositiveFinite(params.rmf) ||
      !isPositiveFinite(params.a) ||
      !isPositiveFinite(params.m) ||
      !isPositiveFinite(params.n)
    ) {
      return invalidSample();
    }
    let rmfAtT = params.rmf;
    if (params.correctRmfTemp && input.temp !== undefined) {
      if (!Number.isFinite(input.temp) || !Number.isFinite(params.tRmf)) {
        return invalidSample();
      }
      rmfAtT = arpsResistivityC(params.rmf, params.tRmf, input.temp);
      if (!isPositiveFinite(rmfAtT)) {
        return invalidSample();
      }
    }
    sxoRaw = Math.pow((params.a * rmfAtT) / (Math.pow(input.phi, params.m) * input.rxo), 1 / params.n);
    if (Number.isNaN(sxoRaw) || sxoRaw < 0) return invalidSample();
  } else {
    return invalidSample();
  }

  if (Number.isFinite(input.sw)) {
    const s = clip01(input.sw);
    const belowSw = sxoRaw < s - SXO_BELOW_SW_TOL;
    const clippedHigh = sxoRaw > 1 + SXO_BELOW_SW_TOL;
    const sxo = Math.max(s, Math.min(1, sxoRaw));
    const mos = Math.max(0, sxo - s);
    const shr = Math.max(0, 1 - sxo);
    const mhi = sxo > 0 ? s / sxo : NaN;
    return { sxo, sxoRaw, mos, shr, mhi, belowSw, clippedHigh };
  }

  // Modo `archie` sin Sw finito: Sxo y SHR siguen siendo válidos; MOS y MHI quedan NaN.
  const sxo = clip01(sxoRaw);
  return {
    sxo,
    sxoRaw,
    mos: NaN,
    shr: 1 - sxo,
    mhi: NaN,
    belowSw: false,
    clippedHigh: sxoRaw > 1 + SXO_BELOW_SW_TOL,
  };
}

/**
 * Evalúa la movilidad de hidrocarburos sobre el tramo `[start, end)`, escribiendo en `out` sin mutar `inputs`.
 * Devuelve los conteos de resolución y anomalías del tramo.
 */
export function movabilityInto(
  inputs: MovabilityInputs,
  out: MovabilityOutputs,
  params: MovabilityParams,
  start = 0,
  end = inputs.sw.length,
): MovabilityCounts {
  const counts = emptyMovabilityCounts();
  const from = Math.max(0, start);
  const to = Math.min(
    end,
    out.sxo.length,
    out.mos.length,
    out.shr.length,
    out.mhi.length,
  );
  if (!(from < to)) return counts;

  const hasRt = inputs.rt !== undefined;
  const hasTemp = inputs.temp !== undefined;

  for (let i = from; i < to; i++) {
    counts.total++;
    const rxo = inputs.rxo[i] ?? NaN;
    const res = evaluateMovabilitySample(
      {
        sw: inputs.sw[i] ?? NaN,
        phi: inputs.phi[i] ?? NaN,
        rxo,
        rt: hasRt ? (inputs.rt![i] ?? NaN) : undefined,
        temp: hasTemp ? (inputs.temp![i] ?? NaN) : undefined,
      },
      params,
    );
    out.sxo[i] = res.sxo;
    out.mos[i] = res.mos;
    out.shr[i] = res.shr;
    out.mhi[i] = res.mhi;

    if (Number.isFinite(res.sxo)) {
      counts.resolved++;
      if (res.belowSw) counts.belowSw++;
      if (res.clippedHigh) counts.clippedHigh++;
    } else if (!isPositiveFinite(rxo)) {
      counts.missingRxo++;
    } else {
      counts.missingInputs++;
    }
  }

  return counts;
}

/**
 * Resume la movilidad de hidrocarburos sobre el tramo `[start, end)`.
 *
 * Pondera los promedios por volumen poral `w = h · φ` sobre las muestras donde `sw` y `sxo` son finitas
 * (con `h = thickness[i]` o `1` si no se pasa `thickness`, exigiendo `h > 0` y `φ > 0` finitos). Si el volumen
 * poral resuelto es nulo (p. ej. sin curva `phi`), respalda con pesos por espesor `h`.
 */
export function summarizeMovability(
  input: {
    rxo: ArrayLike<number>;
    sw: ArrayLike<number>;
    sxo: ArrayLike<number>;
    mos: ArrayLike<number>;
    shr: ArrayLike<number>;
    mhi: ArrayLike<number>;
    phi?: ArrayLike<number>;
    thickness?: ArrayLike<number>;
  },
  start = 0,
  end = input.sw.length,
): MovabilityZoneSummary {
  const from = Math.max(0, start);
  const to = Math.min(end, input.sw.length);

  if (!(from < to)) {
    return {
      totalSamples: 0,
      rxoSamples: 0,
      resolvedSamples: 0,
      resolvedPct: NaN,
      swMean: NaN,
      sxoMean: NaN,
      mosMean: NaN,
      shrMean: NaN,
      mhiMean: NaN,
      movableHcFraction: NaN,
      movableSamplesPct: NaN,
    };
  }

  let totalSamples = 0;
  let rxoSamples = 0;
  let resolvedSamples = 0;
  let movableSamples = 0;

  // Acumuladores ponderados por volumen poral (h · φ)
  let pvW = 0;
  let pvSw = 0;
  let pvSxo = 0;
  let pvMos = 0;
  let pvMosW = 0;
  let pvShr = 0;
  let pvShrW = 0;
  let pvMhi = 0;
  let pvMhiW = 0;

  // Acumuladores de respaldo ponderados por espesor (h)
  let hW = 0;
  let hSw = 0;
  let hSxo = 0;
  let hMos = 0;
  let hMosW = 0;
  let hShr = 0;
  let hShrW = 0;
  let hMhi = 0;
  let hMhiW = 0;

  const hasPhi = input.phi !== undefined;
  const hasThickness = input.thickness !== undefined;

  for (let i = from; i < to; i++) {
    totalSamples++;
    const rxo = input.rxo[i] ?? NaN;
    if (isPositiveFinite(rxo)) rxoSamples++;

    const sw = input.sw[i] ?? NaN;
    const sxo = input.sxo[i] ?? NaN;
    if (!Number.isFinite(sw) || !Number.isFinite(sxo)) continue;

    resolvedSamples++;
    const swC = clip01(sw);
    const sxoC = clip01(sxo);
    const mos = input.mos[i] ?? NaN;
    const shr = input.shr[i] ?? NaN;
    const mhi = input.mhi[i] ?? NaN;

    if (Number.isFinite(mhi) && mhi < MHI_MOVABLE_SANDSTONE) {
      movableSamples++;
    }

    const h = hasThickness ? (input.thickness![i] ?? NaN) : 1;
    if (!isPositiveFinite(h)) continue;

    hW += h;
    hSw += h * swC;
    hSxo += h * sxoC;
    if (Number.isFinite(mos)) {
      hMos += h * mos;
      hMosW += h;
    }
    if (Number.isFinite(shr)) {
      hShr += h * shr;
      hShrW += h;
    }
    if (Number.isFinite(mhi)) {
      hMhi += h * mhi;
      hMhiW += h;
    }

    if (hasPhi) {
      const phi = input.phi![i] ?? NaN;
      if (isPositiveFinite(phi)) {
        const w = h * phi;
        if (isPositiveFinite(w)) {
          pvW += w;
          pvSw += w * swC;
          pvSxo += w * sxoC;
          if (Number.isFinite(mos)) {
            pvMos += w * mos;
            pvMosW += w;
          }
          if (Number.isFinite(shr)) {
            pvShr += w * shr;
            pvShrW += w;
          }
          if (Number.isFinite(mhi)) {
            pvMhi += w * mhi;
            pvMhiW += w;
          }
        }
      }
    }
  }

  let swMean = NaN;
  let sxoMean = NaN;
  let mosMean = NaN;
  let shrMean = NaN;
  let mhiMean = NaN;

  if (pvW > 0) {
    swMean = pvSw / pvW;
    sxoMean = pvSxo / pvW;
    mosMean = pvMosW > 0 ? pvMos / pvMosW : NaN;
    shrMean = pvShrW > 0 ? pvShr / pvShrW : NaN;
    mhiMean = pvMhiW > 0 ? pvMhi / pvMhiW : NaN;
  } else if (hW > 0) {
    swMean = hSw / hW;
    sxoMean = hSxo / hW;
    mosMean = hMosW > 0 ? hMos / hMosW : NaN;
    shrMean = hShrW > 0 ? hShr / hShrW : NaN;
    mhiMean = hMhiW > 0 ? hMhi / hMhiW : NaN;
  }

  const movableHcFraction =
    Number.isFinite(swMean) && Number.isFinite(mosMean) && 1 - swMean > 1e-12
      ? clip01(mosMean / (1 - swMean))
      : NaN;

  return {
    totalSamples,
    rxoSamples,
    resolvedSamples,
    resolvedPct: totalSamples > 0 ? (100 * resolvedSamples) / totalSamples : NaN,
    swMean,
    sxoMean,
    mosMean,
    shrMean,
    mhiMean,
    movableHcFraction,
    movableSamplesPct: resolvedSamples > 0 ? (100 * movableSamples) / resolvedSamples : NaN,
  };
}
