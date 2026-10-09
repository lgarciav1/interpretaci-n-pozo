/**
 * Sumario de espesores netos y promedios por intervalo (zona o pozo completo).
 *
 * Unidades: espesores en m, φ, Sw y Vsh en v/v (fracción, NO %), permeabilidad en mD. Banderas netRes/netPay:
 * 1 (neto), 0 (no neto), NaN (sin dato). NaN = sin dato en todas las variables.
 *
 * Definiciones (docs/decisiones/0007-modulos-fase-6a.md, D6). Sea hᵢ el espesor de la muestra i:
 *   Bruto             gross = Σ hᵢ                       (todas las muestras del intervalo)
 *   Sin dato          noData = Σ hᵢ donde netRes = NaN   (falta Vsh o φ: no se pudo clasificar)
 *   Neto reservorio   netRes = Σ hᵢ donde NET_RES = 1;   neto pay   netPay = Σ hᵢ donde NET_PAY = 1
 *   Neto/bruto        N/G = neto / bruto                  (NaN si bruto = 0)
 *   Porosidad media   φ̄ = Σ hᵢφᵢ / Σ hᵢ                  (sobre el neto)
 *   Sw media          S̄w = Σ hᵢφᵢSwᵢ / Σ hᵢφᵢ            (ponderada por volumen poral; sobre el neto)
 *   Vsh y k medias    x̄ = Σ hᵢxᵢ / Σ hᵢ
 *   Capacidad de flujo kh = Σ hᵢ·kᵢ                       (mD·m)
 *   Acumulados        h·φ = Σ hᵢφᵢ;   h·φ·Sh = Σ hᵢφᵢ(1 − Swᵢ)    (m)
 * Cada promedio usa solo las muestras netas CON dato en las variables que intervienen. Con la ponderación por
 * volumen poral se cumple h·φ̄·(1 − S̄w) = h·φ·Sh cuando todas las muestras netas tienen φ y Sw (siempre en el pay).
 * Neto cero → promedios NaN y sumas 0. Varios rangos se acumulan (sumas) y los promedios se recalculan desde las
 * sumas, no promediando promedios; los rangos no deben solaparse.
 *
 * Referencias: Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16, cap. 6
 * (espesor neto, φ promedio ponderada por espesor, Sw promedio ponderada por porosidad); Worthington y Cosentino
 * (2005), SPE Reservoir Evaluation & Engineering 8(4).
 */

export interface SummaryInput {
  /** m por muestra (ctx.thickness). */
  thickness: ArrayLike<number>;
  /** Banderas 0/1/NaN. */
  netRes: ArrayLike<number>;
  netPay: ArrayLike<number>;
  /** v/v */
  phi: ArrayLike<number>;
  sw: ArrayLike<number>;
  /** v/v, mD */
  vsh?: ArrayLike<number>;
  perm?: ArrayLike<number>;
}

export interface IntervalSummary {
  /** m */
  gross: number;
  noData: number;
  netRes: number;
  netPay: number;
  /** v/v (NaN si gross = 0) */
  ntgRes: number;
  ntgPay: number;
  /** Promedios sobre el neto de reservorio. */
  phiRes: number;
  swRes: number;
  vshRes: number;
  /** Promedios sobre el neto pay. */
  phiPay: number;
  swPay: number;
  vshPay: number;
  kPay: number;
  /** mD·m */
  khPay: number;
  /** m */
  hphiRes: number;
  hphiShRes: number;
  hphiPay: number;
  hphiShPay: number;
}

/** Acumuladores sobre un conjunto de muestras netas. */
interface NetSums {
  h: number; // Σ h (neto)
  hPhi: number; // Σ h·φ (muestras con φ)
  hPhiForAvg: number; // Σ h (muestras con φ) — denominador de φ̄
  hPhiSw: number; // Σ h·φ·Sw (muestras con φ y Sw)
  hPhiWithSw: number; // Σ h·φ (muestras con φ y Sw) — denominador de S̄w
  hPhiSh: number; // Σ h·φ·(1 − Sw)
  hVsh: number; // Σ h·vsh
  hWithVsh: number; // Σ h (muestras con vsh)
  hK: number; // Σ h·k
  hWithK: number; // Σ h (muestras con k)
}

function emptySums(): NetSums {
  return { h: 0, hPhi: 0, hPhiForAvg: 0, hPhiSw: 0, hPhiWithSw: 0, hPhiSh: 0, hVsh: 0, hWithVsh: 0, hK: 0, hWithK: 0 };
}

function ratio(num: number, den: number): number {
  return den > 0 ? num / den : NaN;
}

/**
 * Sumario sobre la unión de los `ranges` ([start, end), sin solaparse). Ver definiciones en la cabecera.
 * `vshRes`/`vshPay` son NaN si no hay `vsh`; `kPay`/`khPay` son NaN si no hay `perm`.
 */
export function summarizeRanges(
  input: SummaryInput,
  ranges: readonly { start: number; end: number }[],
): IntervalSummary {
  const { thickness, netRes, netPay, phi, sw, vsh, perm } = input;
  let gross = 0;
  let noData = 0;
  const res = emptySums();
  const pay = emptySums();

  const add = (s: NetSums, h: number, p: number, w: number, v: number, k: number): void => {
    s.h += h;
    if (!Number.isNaN(p)) {
      s.hPhi += h * p;
      s.hPhiForAvg += h;
      if (!Number.isNaN(w)) {
        s.hPhiSw += h * p * w;
        s.hPhiWithSw += h * p;
        s.hPhiSh += h * p * (1 - w);
      }
    }
    if (!Number.isNaN(v)) {
      s.hVsh += h * v;
      s.hWithVsh += h;
    }
    if (!Number.isNaN(k)) {
      s.hK += h * k;
      s.hWithK += h;
    }
  };

  for (const { start, end } of ranges) {
    for (let i = start; i < end; i++) {
      const h = thickness[i]!;
      gross += h;
      const r = netRes[i]!;
      if (Number.isNaN(r)) {
        noData += h;
        continue;
      }
      if (r !== 1) continue;
      const p = phi[i]!;
      const w = sw[i]!;
      const v = vsh ? vsh[i]! : NaN;
      const k = perm ? perm[i]! : NaN;
      add(res, h, p, w, v, k);
      if (netPay[i] === 1) add(pay, h, p, w, v, k);
    }
  }

  return {
    gross,
    noData,
    netRes: res.h,
    netPay: pay.h,
    ntgRes: ratio(res.h, gross),
    ntgPay: ratio(pay.h, gross),
    phiRes: ratio(res.hPhi, res.hPhiForAvg),
    swRes: ratio(res.hPhiSw, res.hPhiWithSw),
    vshRes: vsh ? ratio(res.hVsh, res.hWithVsh) : NaN,
    phiPay: ratio(pay.hPhi, pay.hPhiForAvg),
    swPay: ratio(pay.hPhiSw, pay.hPhiWithSw),
    vshPay: vsh ? ratio(pay.hVsh, pay.hWithVsh) : NaN,
    kPay: perm ? ratio(pay.hK, pay.hWithK) : NaN,
    khPay: perm ? pay.hK : NaN,
    hphiRes: res.hPhi,
    hphiShRes: res.hPhiSh,
    hphiPay: pay.hPhi,
    hphiShPay: pay.hPhiSh,
  };
}
