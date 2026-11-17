/**
 * Capas de pay: tramos continuos de pay neto con espesor mínimo y tolerancia a intercalaciones finas, ordenados por
 * capacidad de flujo (base de la tabla de punzados sugeridos).
 *
 * Unidades: profundidades y espesores en m, φ y Sw en v/v (fracción, NO %), permeabilidad en mD, k·h en mD·m.
 * NET_PAY: 1 = pay, 0 = no pay, NaN = sin dato (falta Sw o la muestra no está clasificada).
 *
 * Definiciones. Sea hᵢ el espesor de la muestra i (el mismo `thickness` del motor y del sumario; ver summary.ts) y
 * «pay» una muestra con NET_PAY = 1. Un tramo es un grupo de muestras consecutivas DENTRO DE UN MISMO RANGO (zona):
 *   Intercalación   muestras consecutivas que NO son pay (NET_PAY = 0, NaN o cualquier valor distinto de 1) entre dos
 *                   muestras de pay del mismo rango. Su espesor es g = Σ hᵢ de esas muestras.
 *   Unión           dos grupos de pay separados por una intercalación se unen en un solo tramo si g ≤ maxGap
 *                   (tolerancia, m). Con maxGap = 0 no se une nada. Es un criterio de diseño de punzados (un
 *                   intervalo se punza de corrido aunque tenga una intercalación fina que la herramienta no resuelve);
 *                   no proviene de una norma ni de un autor. El tramo nunca empieza ni termina en una intercalación,
 *                   y nunca cruza el límite de un rango: el pay del otro lado de un límite de zona es otro tramo.
 *   Neto            net = Σ hᵢ sobre las muestras de pay del tramo (las intercalaciones NO suman). Es el «espesor» de la
 *                   tabla y la misma definición de neto pay del sumario (NET_PAY = 1).
 *   Bruto           gross = net + gapThickness = Σ hᵢ de todas las muestras desde la primera hasta la última de pay.
 *   Tope y base     bordes de celda: top = depth(primera muestra de pay) − h/2 y base = depth(última) + h/2, con la h
 *                   de cada una. Son coherentes con `thickness` (una muestra representa ±h/2 alrededor de su
 *                   profundidad): en una grilla regular base − top = gross. Con muestreo irregular gross sigue siendo
 *                   Σ hᵢ (el sumario) y puede diferir de base − top.
 *   Promedios       (solo muestras de pay; las intercalaciones no entran; cada promedio usa las muestras con dato en las
 *                   variables que intervienen, como el sumario)
 *                   φ̄ = Σ hᵢφᵢ / Σ hᵢ        S̄w = Σ hᵢφᵢSwᵢ / Σ hᵢφᵢ        k̄ = Σ hᵢkᵢ / Σ hᵢ
 *   Acumulados      kh = Σ hᵢkᵢ (mD·m);  h·φ = Σ hᵢφᵢ;  h·φ·Sh = Σ hᵢφᵢ(1 − Swᵢ)  (m)
 *                   Sin curva de permeabilidad k̄ y kh son NaN; con curva pero sin ninguna k válida en el tramo,
 *                   k̄ = NaN y kh = 0 (igual que el sumario).
 *
 * Espesor mínimo: se aplica DESPUÉS de unir y sobre `net` (el espesor de pay que se punzaría), no sobre `gross`: un tramo
 * de 3 m brutos con 0,6 m de pay y dos intercalaciones no es una capa de 3 m. Un tramo se descarta si net < minThickness.
 *
 * Orden: por kh decreciente; desempate por net decreciente y luego por profundidad (top creciente). Sin curva de
 * permeabilidad se ordena por h·φ decreciente (misma regla de desempate). `rank` = posición (1 = el mejor) en TODA la lista
 * (todas las zonas), no por zona.
 *
 * Propiedad (testeada): con minThickness = 0, Σ net de los tramos de un rango == netPay de `summarizeRanges` de ese
 * rango para cualquier maxGap (la unión solo agrupa muestras, no cambia cuáles son pay); idem Σ kh, Σ h·φ y Σ h·φ·Sh.
 *
 * Referencias: Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16 (espesor neto,
 * φ ponderada por espesor y Sw ponderada por porosidad); la unión de intercalaciones finas y el espesor mínimo son
 * criterios de diseño de punzados, no una definición de la bibliografía.
 */

/** Rango de índices de muestra [start, end): una zona o el pozo completo. */
export interface PayRange {
  start: number;
  end: number;
}

/** Curvas muestreadas (mismo índice). */
export interface PaySamples {
  /** m, profundidad de cada muestra. */
  depth: ArrayLike<number>;
  /** m por muestra (ctx.thickness). */
  thickness: ArrayLike<number>;
  /** Bandera 0/1/NaN; solo el valor exactamente 1 es pay. */
  netPay: ArrayLike<number>;
  /** v/v */
  phi: ArrayLike<number>;
  /** v/v */
  sw: ArrayLike<number>;
  /** mD (opcional: sin ella k̄ y kh son NaN y el orden es por h·φ). */
  perm?: ArrayLike<number>;
}

export interface PayOptions {
  /** m (≥ 0): espesor neto mínimo de un tramo, después de unir. Por defecto 0 (no descarta nada). */
  minThickness?: number;
  /** m (≥ 0): una intercalación de espesor ≤ maxGap se une; 0 = no se une nada. Por defecto 0. */
  maxGap?: number;
}

export interface PayInterval {
  /** Posición (1 = primero) en la lista ordenada. */
  rank: number;
  /** Índice del rango (zona) en `ranges`. */
  rangeIndex: number;
  /** Índice de la primera muestra de pay. */
  startIdx: number;
  /** Índice posterior a la última muestra de pay (exclusivo, como los rangos): el tramo es [startIdx, endIdx). */
  endIdx: number;
  /** m, borde superior de la celda de la primera muestra de pay. */
  top: number;
  /** m, borde inferior de la celda de la última muestra de pay. */
  base: number;
  /** m, net + gapThickness. */
  gross: number;
  /** m, Σ h de las muestras de pay. */
  net: number;
  /** m, Σ h de las intercalaciones unidas. */
  gapThickness: number;
  /** Cantidad de intercalaciones unidas dentro del tramo. */
  gaps: number;
  /** v/v, ponderada por espesor (NaN sin φ). */
  phi: number;
  /** v/v, ponderada por h·φ (NaN sin φ y Sw). */
  sw: number;
  /** mD, ponderada por espesor (NaN sin curva k o sin k válida). */
  k: number;
  /** mD·m (NaN sin curva k). */
  kh: number;
  /** m, Σ h·φ. */
  hphi: number;
  /** m, Σ h·φ·(1 − Sw). */
  hphiSh: number;
}

export interface PayIntervalsResult {
  /** Tramos que pasan el espesor mínimo, ordenados y con `rank`. */
  intervals: PayInterval[];
  /** Tramos descartados por espesor mínimo (cantidad y Σ net). */
  discarded: { count: number; net: number };
}

/** Tolerancia numérica (m) al comparar sumas de espesores con maxGap y minThickness. */
const EPS = 1e-9;

const cleanOpt = (x: number | undefined): number => (x !== undefined && Number.isFinite(x) && x > 0 ? x : 0);

/** Espesor utilizable: finito y ≥ 0 (un espesor inválido no aporta). */
const thick = (x: number): number => (Number.isFinite(x) && x > 0 ? x : 0);

/** Acumuladores de un tramo en construcción. */
interface Open {
  startIdx: number;
  lastIdx: number;
  net: number;
  gapThickness: number;
  gaps: number;
  hPhi: number;
  hPhiForAvg: number;
  hPhiSw: number;
  hPhiWithSw: number;
  hPhiSh: number;
  hK: number;
  hWithK: number;
}

/**
 * Tramos de pay de cada rango, unidos, filtrados y ordenados. Ver las definiciones en la cabecera.
 * @param samples curvas muestreadas
 * @param ranges  rangos [start, end) (zonas, sin solaparse); un tramo nunca cruza un límite
 * @param opts    opciones únicas, o un arreglo con las de cada rango (mismo orden que `ranges`)
 */
export function payIntervals(
  samples: PaySamples,
  ranges: readonly PayRange[],
  opts: PayOptions | readonly PayOptions[] = {},
): PayIntervalsResult {
  const { depth, thickness, netPay, phi, sw, perm } = samples;
  const all: PayInterval[] = [];
  const discarded = { count: 0, net: 0 };

  ranges.forEach((range, rangeIndex) => {
    const o = Array.isArray(opts) ? ((opts as readonly PayOptions[])[rangeIndex] ?? {}) : (opts as PayOptions);
    const minThickness = cleanOpt(o.minThickness);
    const maxGap = cleanOpt(o.maxGap);

    let cur: Open | null = null;
    let gapH = 0; // espesor de la intercalación pendiente (no pay desde la última muestra de pay)
    let hasGap = false;

    const close = () => {
      if (!cur) return;
      const c: Open = cur;
      cur = null;
      if (c.net < minThickness - EPS) {
        discarded.count++;
        discarded.net += c.net;
        return;
      }
      const hFirst = thick(thickness[c.startIdx]!);
      const hLast = thick(thickness[c.lastIdx]!);
      all.push({
        rank: 0,
        rangeIndex,
        startIdx: c.startIdx,
        endIdx: c.lastIdx + 1,
        top: depth[c.startIdx]! - hFirst / 2,
        base: depth[c.lastIdx]! + hLast / 2,
        gross: c.net + c.gapThickness,
        net: c.net,
        gapThickness: c.gapThickness,
        gaps: c.gaps,
        phi: c.hPhiForAvg > 0 ? c.hPhi / c.hPhiForAvg : NaN,
        sw: c.hPhiWithSw > 0 ? c.hPhiSw / c.hPhiWithSw : NaN,
        k: perm && c.hWithK > 0 ? c.hK / c.hWithK : NaN,
        kh: perm ? c.hK : NaN,
        hphi: c.hPhi,
        hphiSh: c.hPhiSh,
      });
    };

    for (let i = range.start; i < range.end; i++) {
      const h = thick(thickness[i]!);
      if (netPay[i] !== 1) {
        if (cur) {
          gapH += h;
          hasGap = true;
        }
        continue;
      }
      if (cur && hasGap) {
        if (maxGap > 0 && gapH <= maxGap + EPS) {
          cur.gapThickness += gapH;
          cur.gaps++;
        } else {
          close();
        }
      }
      gapH = 0;
      hasGap = false;
      if (!cur) {
        cur = { startIdx: i, lastIdx: i, net: 0, gapThickness: 0, gaps: 0, hPhi: 0, hPhiForAvg: 0, hPhiSw: 0, hPhiWithSw: 0, hPhiSh: 0, hK: 0, hWithK: 0 };
      }
      const c: Open = cur;
      c.lastIdx = i;
      c.net += h;
      const p = phi[i]!;
      const w = sw[i]!;
      if (!Number.isNaN(p)) {
        c.hPhi += h * p;
        c.hPhiForAvg += h;
        if (!Number.isNaN(w)) {
          c.hPhiSw += h * p * w;
          c.hPhiWithSw += h * p;
          c.hPhiSh += h * p * (1 - w);
        }
      }
      if (perm) {
        const k = perm[i]!;
        if (!Number.isNaN(k)) {
          c.hK += h * k;
          c.hWithK += h;
        }
      }
    }
    close(); // la intercalación final pendiente (si la hay) se descarta: el tramo termina en pay
  });

  return { intervals: rankPayIntervals(all, perm !== undefined), discarded };
}

/**
 * Ordena (sin modificar la entrada) y numera los tramos: por kh decreciente, o por h·φ decreciente si `hasPerm` es false;
 * desempate por net decreciente y luego por profundidad (top, después startIdx) creciente. Un kh/h·φ no finito va al final.
 */
export function rankPayIntervals(list: readonly PayInterval[], hasPerm: boolean): PayInterval[] {
  const key = (t: PayInterval) => {
    const v = hasPerm ? t.kh : t.hphi;
    return Number.isFinite(v) ? v : -Infinity;
  };
  return list
    .map((t) => ({ ...t }))
    .sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka !== kb) return ka > kb ? -1 : 1;
      if (a.net !== b.net) return a.net > b.net ? -1 : 1;
      return a.top !== b.top ? a.top - b.top : a.startIdx - b.startIdx;
    })
    .map((t, i) => ({ ...t, rank: i + 1 }));
}
