/**
 * Lectura automática del pozo (función T): resumen en texto, armado con REGLAS (sin IA), de los tramos candidatos a
 * hidrocarburo (y de los acuíferos) y de por qué lo son. Cada tramo lleva tope y base para que la interfaz salte a él.
 * No calcula curvas nuevas: reúne la evidencia que ya producen los demás módulos (cutoffs, sumario, banderas de
 * crossover de gas, derrumbe, carbón y arcilla, resistividad profunda).
 *
 * Unidades (las canónicas del motor): φ, Sw y Vsh en v/v (fracción, NO %), Rt en ohm·m, profundidades y espesores en m.
 * Las banderas (NET_RES, NET_PAY, IND_*) valen 1, 0 o NaN (sin dato); un NaN nunca cuenta como evidencia a favor.
 * La profundidad de cada muestra es el centro de su espesor: tope = prof − h/2 de la primera, base = prof + h/2 de la última.
 *
 * REGLAS (todas deterministas; los umbrales son parámetros, ver `WELL_READING_DEFAULTS`):
 *  1. Tramos. Por zona (los sellos no se leen), en orden de profundidad:
 *       hidrocarburo  muestras con pay neto (NET_PAY = 1: reservorio con Sw ≤ corte);
 *       acuífero      muestras de reservorio neto sin pay (NET_RES = 1 y NET_PAY = 0: Sw sobre el corte).
 *     Los huecos más cortos que `mergeGap` (1 m, estricto) entre muestras del mismo tipo se fusionan; el espesor del
 *     tramo es la suma de sus muestras netas (sin contar el hueco) y se descartan los de menos de `minThickness` (1 m).
 *  2. Promedios (sumario, `summarizeRanges`): φ y Vsh ponderadas por espesor; Sw ponderada por volumen poral; la
 *     importancia del tramo es h·φ·Sh (m). Rt del tramo = media geométrica ponderada por espesor (la resistividad es
 *     log-normal).
 *  3. Referencia de resistividad Rt_ref (mediana de Rt de las muestras): primero el tramo acuífero de la MISMA zona
 *     (reservorio neto con Sw ≥ `swAquiferMin`, 0,8), si no el acuífero de todo el pozo, si no las arcillas de la zona
 *     (bandera IND_SHALE). Cada referencia necesita al menos `minThickness` de muestras. Las arcillas NO cuentan como
 *     evidencia (su resistividad no es la de un reservorio con agua): solo se informa el cociente.
 *  4. Evidencias de hidrocarburo en un tramo de pay:
 *       Sw baja       Sw media ≤ `swLowMax` (0,4)
 *       Rt alta       Rt / Rt_ref ≥ `rtRatioMin` (3) con referencia acuífera
 *       crossover     fracción del espesor neto con IND_GAS = 1 ≥ `gasFracMin` (0,3)
 *     Sw y Rt NO son independientes (la Sw sale de Rt con la ley de Archie); por eso el petróleo no pasa de lo que
 *     dan estas dos, y solo el crossover aporta información de otra herramienta.
 *  5. Fluido probable (en este orden):
 *       dudoso   si la fracción de carbón (IND_COAL = 1) ≥ `coalFracMin` (0,1) (la densidad baja y el neutrón alto
 *                del carbón imitan porosidad), o si no hay ninguna evidencia (el tramo solo cumple los cortes);
 *       gas      si hay crossover;
 *       petróleo si hay Sw baja o Rt alta y no hay crossover (sin presiones MDT ni gas de lodo no se distingue de un
 *                gas sin efecto en las curvas: se asume petróleo);
 *     Acuífero: agua si Sw media ≥ `swAquiferMin` y no hay crossover; dudoso si la Sw es intermedia (transición o agua
 *     con hidrocarburo residual), si hay crossover con Sw alta, o si hay carbón.
 *  6. Confianza: puntos = evidencias que coinciden con el fluido, sobre las aplicables (gas 3: Sw, Rt, crossover;
 *     petróleo 2: Sw, Rt; agua 2: Sw alta, ausencia confirmada de crossover). Todas = alta; una menos = media; menos
 *     = baja. Un dato que falta (sin Rt, sin referencia, sin bandera) no suma. Dudoso = baja. Derrumbe: si la fracción
 *     del espesor neto con IND_WASHOUT = 1 ≥ `washoutFracMin` (0,2) la confianza baja a «baja» (la densidad y el
 *     neutrón de patín no son confiables con el pozo derrumbado), sea cual sea el puntaje.
 *  7. Orden: primero los tramos de hidrocarburo por importancia h·φ·Sh decreciente (desempate: más somero primero) y
 *     luego los acuíferos por h·φ decreciente. Se listan como máximo `maxCandidates` y `maxWater`.
 *  8. Contacto aparente: un tramo de hidrocarburo seguido hacia abajo por un tramo de AGUA franca (fluido «agua») de la
 *     misma zona, con una separación menor que `mergeGap` y una subida de Sw media ≥ `contactSwJump` (0,3), se informa
 *     como contacto aparente a la profundidad media entre la base del primero y el tope del segundo. A lo sumo uno por
 *     zona (con capas delgadas alternadas, el de mayor espesor de agua debajo). No es un contacto medido: lo confirman
 *     las presiones MDT.
 *  9. Líneas generales (máx. 3): resumen; contactos aparentes (si hay); calidad de dato / evidencia que falta (si hay).
 *
 * Los umbrales son criterios prácticos, NO valores de libro: dependen de la calibración de las herramientas, del
 * modelo de Sw y del criterio del intérprete.
 *
 * Referencias: Asquith y Krygowski (2004), «Basic Well Log Analysis», AAPG Methods in Exploration 16 (cap. 5, efecto
 * del gas en densidad–neutrón y reconocimiento de hidrocarburo por resistividad contra un tramo acuífero; cap. 4,
 * caliper); Schlumberger (1989), «Log Interpretation Principles/Applications» (lectura rápida de perfiles, Rt/Ro);
 * Worthington y Cosentino (2005), SPE Reservoir Evaluation & Engineering 8(4) (cutoffs y espesor neto).
 */
import { summarizeRanges } from './summary';

export type WellReadingFluid = 'gas' | 'oil' | 'water' | 'doubtful';
export type WellReadingConfidence = 'high' | 'medium' | 'low';
export type WellReadingRefKind = 'aquiferZone' | 'aquiferWell' | 'shale';

export interface WellReadingParams {
  /** Espesor neto mínimo de un tramo (m). */
  minThickness: number;
  /** Hueco máximo que se fusiona (m, estricto). */
  mergeGap: number;
  /** Rt / Rt_ref mínimo para contar como evidencia (adimensional). */
  rtRatioMin: number;
  /** Sw media máxima para «Sw baja» (v/v). */
  swLowMax: number;
  /** Sw mínima de las muestras del acuífero de referencia y del tramo «agua» (v/v). */
  swAquiferMin: number;
  /** Fracción mínima del espesor neto con crossover de gas (v/v). */
  gasFracMin: number;
  /** Fracción mínima del espesor neto con derrumbe que baja la confianza (v/v). */
  washoutFracMin: number;
  /** Fracción mínima del espesor neto con carbón que vuelve dudoso el fluido (v/v). */
  coalFracMin: number;
  /** Subida mínima de Sw media entre el pay y el acuífero vecino para informar un contacto aparente (v/v). */
  contactSwJump: number;
  /** Máximo de tramos de hidrocarburo listados. */
  maxCandidates: number;
  /** Máximo de tramos acuíferos listados (0 = no se listan). */
  maxWater: number;
}

export const WELL_READING_DEFAULTS: Readonly<WellReadingParams> = {
  minThickness: 1,
  mergeGap: 1,
  rtRatioMin: 3,
  swLowMax: 0.4,
  swAquiferMin: 0.8,
  gasFracMin: 0.3,
  washoutFracMin: 0.2,
  coalFracMin: 0.1,
  contactSwJump: 0.3,
  maxCandidates: 12,
  maxWater: 3,
};

export interface WellReadingSamples {
  /** m, centro de cada muestra */
  depth: ArrayLike<number>;
  /** m por muestra */
  thickness: ArrayLike<number>;
  /** φ efectiva (v/v) */
  phi: ArrayLike<number>;
  /** Sw (v/v) */
  sw: ArrayLike<number>;
  /** Banderas 0/1/NaN de reservorio y pay neto */
  netRes: ArrayLike<number>;
  netPay: ArrayLike<number>;
  vsh?: ArrayLike<number>;
  /** Resistividad profunda (ohm·m) */
  rt?: ArrayLike<number>;
  /** Banderas 0/1/NaN de crossover de gas, derrumbe, carbón y arcilla */
  gas?: ArrayLike<number>;
  washout?: ArrayLike<number>;
  coal?: ArrayLike<number>;
  shale?: ArrayLike<number>;
}

/** Intervalo de lectura (una zona, o el pozo completo): índices de muestra [start, end). */
export interface WellReadingInterval {
  id: string;
  name: string;
  start: number;
  end: number;
}

export interface WellReadingCandidate {
  /** 1 = el más importante (hidrocarburo antes que agua). */
  rank: number;
  kind: 'hydrocarbon' | 'water';
  zoneId: string;
  zone: string;
  /** m */
  top: number;
  base: number;
  /** Espesor neto (m, suma de las muestras del tramo). */
  h: number;
  phi: number;
  sw: number;
  /** NaN sin curva de Vsh. */
  vsh: number;
  /** Rt media geométrica del tramo y la de referencia (ohm·m); NaN si no hay dato. */
  rt: number;
  rtRef: number;
  rtRatio: number;
  refKind: WellReadingRefKind | null;
  /** Fracciones del espesor neto (v/v); NaN si no hay bandera con dato. */
  gasFrac: number;
  washoutFrac: number;
  coalFrac: number;
  /** h·φ·Sh en hidrocarburo, h·φ en agua (m). */
  importance: number;
  fluid: WellReadingFluid;
  confidence: WellReadingConfidence;
  /** Evidencias a favor y reparos, frases cortas. */
  evidence: string[];
  /** Frase en español natural. */
  text: string;
}

export interface WellReadingContact {
  zoneId: string;
  zone: string;
  /** m, profundidad aparente del contacto. */
  depth: number;
  /** Fluido del tramo de arriba. */
  fluid: WellReadingFluid;
  swAbove: number;
  swBelow: number;
  text: string;
}

export interface WellReadingGeneralLine {
  kind: 'summary' | 'contacts' | 'quality';
  /** Rango al que saltar (m); NaN si la línea no tiene profundidad. */
  top: number;
  base: number;
  text: string;
}

export interface WellReading {
  candidates: WellReadingCandidate[];
  contacts: WellReadingContact[];
  general: WellReadingGeneralLine[];
  /** Tramos detectados que no se listaron por `maxCandidates` / `maxWater`. */
  omitted: number;
}

// --------------------------------------------------------------------------------------------------------------
// Formato en español (separador de miles «.» y decimal «,»; sin depender de Intl para que sea determinista)

const EPS = 1e-9;

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Número con `dec` decimales fijos: 0,18. */
function fixed(x: number, dec: number): string {
  const [i, d] = Math.abs(x).toFixed(dec).split('.');
  return `${x < 0 ? '-' : ''}${group(i!)}${d ? `,${d}` : ''}`;
}

/** Número con hasta `dec` decimales, sin ceros finales: 8.012; 2,3. */
function trimmed(x: number, dec: number): string {
  const f = fixed(x, dec);
  return f.includes(',') ? f.replace(/0+$/, '').replace(/,$/, '') : f;
}

function depthText(x: number): string {
  return trimmed(x, 1);
}

function ratioText(r: number): string {
  return r >= 10 ? fixed(Math.round(r), 0) : trimmed(r, 1);
}

function listText(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

const FLUID_PHRASE: Record<WellReadingFluid, string> = {
  gas: 'probable gas',
  oil: 'probable petróleo',
  water: 'probable agua',
  doubtful: 'fluido dudoso',
};

const CONFIDENCE_LABEL: Record<WellReadingConfidence, string> = { high: 'alta', medium: 'media', low: 'baja' };

const REF_PHRASE: Record<WellReadingRefKind, string> = {
  aquiferZone: 'la de la base acuífera de la zona',
  aquiferWell: 'la del tramo acuífero del pozo',
  shale: 'la de las arcillas de la zona',
};

const REF_SHORT: Record<WellReadingRefKind, string> = {
  aquiferZone: 'la base acuífera',
  aquiferWell: 'el acuífero del pozo',
  shale: 'las arcillas',
};

// --------------------------------------------------------------------------------------------------------------
// Auxiliares numéricos

const validH = (t: number): number => (Number.isFinite(t) && t > 0 ? t : 0);

interface Run {
  s: number;
  /** exclusivo */
  e: number;
  /** espesor neto (suma de las muestras miembro) */
  h: number;
}

/**
 * Rachas de muestras miembro en [start, end), fusionando huecos de espesor < mergeGap (estricto) y descartando las de
 * espesor neto < minThickness (inclusivo).
 */
function findRuns(
  isMember: (i: number) => boolean,
  thickness: ArrayLike<number>,
  start: number,
  end: number,
  mergeGap: number,
  minThickness: number,
): Run[] {
  const runs: Run[] = [];
  let s = -1;
  let last = -1;
  let h = 0;
  let gap = 0;
  const close = () => {
    if (s >= 0 && h >= minThickness - EPS) runs.push({ s, e: last + 1, h });
    s = -1;
  };
  for (let i = start; i < end; i++) {
    const t = validH(thickness[i]!);
    if (isMember(i)) {
      if (s >= 0 && gap < mergeGap - EPS) {
        h += t;
      } else {
        close();
        s = i;
        h = t;
      }
      last = i;
      gap = 0;
    } else {
      gap += t;
    }
  }
  close();
  return runs;
}

/** Fracción del espesor de las muestras elegidas con bandera = 1, entre las que tienen bandera 0 o 1. NaN si ninguna. */
function flagFraction(flag: ArrayLike<number> | undefined, member: (i: number) => boolean, s: number, e: number, thickness: ArrayLike<number>): number {
  if (!flag) return NaN;
  let known = 0;
  let on = 0;
  for (let i = s; i < e; i++) {
    if (!member(i)) continue;
    const f = flag[i]!;
    if (f !== 0 && f !== 1) continue;
    const t = validH(thickness[i]!);
    known += t;
    if (f === 1) on += t;
  }
  return known > 0 ? on / known : NaN;
}

/** Media geométrica de Rt ponderada por espesor sobre las muestras elegidas (NaN sin dato). */
function geoMeanRt(rt: ArrayLike<number> | undefined, member: (i: number) => boolean, s: number, e: number, thickness: ArrayLike<number>): number {
  if (!rt) return NaN;
  let hs = 0;
  let acc = 0;
  for (let i = s; i < e; i++) {
    if (!member(i)) continue;
    const r = rt[i]!;
    if (!(r > 0) || !Number.isFinite(r)) continue;
    const t = validH(thickness[i]!);
    hs += t;
    acc += t * Math.log(r);
  }
  return hs > 0 ? Math.exp(acc / hs) : NaN;
}

/** Mediana de Rt de las muestras elegidas, si suman al menos `minH` de espesor (NaN si no). */
function medianRt(
  rt: ArrayLike<number>,
  member: (i: number) => boolean,
  ranges: readonly { start: number; end: number }[],
  thickness: ArrayLike<number>,
  minH: number,
): number {
  let vals = new Float64Array(64);
  let nv = 0;
  let h = 0;
  for (const { start, end } of ranges) {
    for (let i = start; i < end; i++) {
      if (!member(i)) continue;
      const r = rt[i]!;
      if (!(r > 0) || !Number.isFinite(r)) continue;
      if (nv === vals.length) {
        const bigger = new Float64Array(2 * nv);
        bigger.set(vals);
        vals = bigger;
      }
      vals[nv++] = r;
      h += validH(thickness[i]!);
    }
  }
  if (nv === 0 || h < minH - EPS) return NaN;
  const sorted = vals.subarray(0, nv).sort(); // numérico (Float64Array)
  const m = nv >> 1;
  return nv % 2 ? sorted[m]! : Math.sqrt(sorted[m - 1]! * sorted[m]!);
}

// --------------------------------------------------------------------------------------------------------------
// Lectura

/**
 * Lee el pozo: tramos candidatos, contactos aparentes y líneas generales. Función pura y determinista.
 * @param samples   curvas y banderas del pozo (todas del mismo largo)
 * @param intervals zonas a leer (sin los sellos), en orden de profundidad; vacío = nada que leer
 * @param params    umbrales (ver `WELL_READING_DEFAULTS`)
 */
export function readWell(
  samples: WellReadingSamples,
  intervals: readonly WellReadingInterval[],
  params: Readonly<WellReadingParams> = WELL_READING_DEFAULTS,
): WellReading {
  const { depth, thickness, phi, sw, netRes, netPay, vsh, rt, gas, washout, coal, shale } = samples;
  const p = params;
  const n = depth.length;
  const named = intervals.length > 1 || (intervals.length === 1 && intervals[0]!.id !== '');

  const isAquifer = (i: number) => netRes[i] === 1 && sw[i]! >= p.swAquiferMin;
  const wellRanges = intervals.map((iv) => ({ start: iv.start, end: iv.end }));
  const rtWell = rt ? medianRt(rt, isAquifer, wellRanges, thickness, p.minThickness) : NaN;

  const all: WellReadingCandidate[] = [];
  const contacts: WellReadingContact[] = [];

  for (const iv of intervals) {
    const where = named ? ` (zona ${iv.name})` : '';
    const isPay = (i: number) => netPay[i] === 1 && validH(thickness[i]!) > 0;
    const isWater = (i: number) => netRes[i] === 1 && netPay[i] === 0 && validH(thickness[i]!) > 0;
    const hcRuns = findRuns(isPay, thickness, iv.start, iv.end, p.mergeGap, p.minThickness);
    const waterRuns = p.maxWater > 0 || hcRuns.length > 0 ? findRuns(isWater, thickness, iv.start, iv.end, p.mergeGap, p.minThickness) : [];
    if (hcRuns.length === 0 && waterRuns.length === 0) continue;

    // Referencia de resistividad de la zona.
    let rtRef = NaN;
    let refKind: WellReadingRefKind | null = null;
    if (rt) {
      const z = medianRt(rt, isAquifer, [{ start: iv.start, end: iv.end }], thickness, p.minThickness);
      if (Number.isFinite(z)) {
        rtRef = z;
        refKind = 'aquiferZone';
      } else if (Number.isFinite(rtWell)) {
        rtRef = rtWell;
        refKind = 'aquiferWell';
      } else if (shale) {
        const sh = medianRt(rt, (i) => shale[i] === 1, [{ start: iv.start, end: iv.end }], thickness, p.minThickness);
        if (Number.isFinite(sh)) {
          rtRef = sh;
          refKind = 'shale';
        }
      }
    }

    let waterFlag: Float64Array | undefined;
    const build = (run: Run, kind: 'hydrocarbon' | 'water'): WellReadingCandidate => {
      const member = kind === 'hydrocarbon' ? isPay : isWater;
      // Sumario del tramo. En agua se pasa una bandera propia para que los promedios de «pay» sean los del agua.
      let flagRes: ArrayLike<number> = netRes;
      let flagPay: ArrayLike<number> = netPay;
      if (kind === 'water') {
        waterFlag ??= new Float64Array(n);
        const wf = waterFlag;
        for (let i = run.s; i < run.e; i++) wf[i] = isWater(i) ? 1 : 0;
        flagRes = wf;
        flagPay = wf;
      }
      const sum = summarizeRanges({ thickness, netRes: flagRes, netPay: flagPay, phi, sw, vsh }, [{ start: run.s, end: run.e }], {
        distributions: false, // solo usa promedios; los percentiles ordenarían las muestras de cada tramo sin necesidad
      });
      const phiM = sum.phiPay;
      const swM = sum.swPay;
      const vshM = sum.vshPay;
      const importance = kind === 'hydrocarbon' ? sum.hphiShPay : sum.hphiPay;

      const rtM = geoMeanRt(rt, member, run.s, run.e, thickness);
      const ratio = Number.isFinite(rtM) && Number.isFinite(rtRef) ? rtM / rtRef : NaN;
      const gasFrac = flagFraction(gas, member, run.s, run.e, thickness);
      const washFrac = flagFraction(washout, member, run.s, run.e, thickness);
      const coalFrac = flagFraction(coal, member, run.s, run.e, thickness);

      const gasEv = gasFrac >= p.gasFracMin;
      const coalBad = coalFrac >= p.coalFracMin;
      const washBad = washFrac >= p.washoutFracMin;
      const aquiferRef = refKind === 'aquiferZone' || refKind === 'aquiferWell';

      let fluid: WellReadingFluid;
      let points: number;
      let applicable: number;
      const evidence: string[] = [];
      const phrases: string[] = [];
      let reason = '';

      if (kind === 'hydrocarbon') {
        const swEv = swM <= p.swLowMax;
        const rtEv = aquiferRef && ratio >= p.rtRatioMin;
        if (swEv) evidence.push('Sw baja');
        if (rtEv) {
          evidence.push(`Rt ${ratioText(ratio)} veces ${REF_SHORT[refKind!]}`);
          phrases.push(`resistividad ${ratioText(ratio)} veces ${REF_PHRASE[refKind!]}`);
        } else if (refKind === 'shale' && ratio > 1) {
          phrases.push(`resistividad ${ratioText(ratio)} veces ${REF_PHRASE.shale}`);
        }
        if (gasEv) {
          evidence.push('cruce densidad–neutrón');
          phrases.push('cruce densidad–neutrón');
        }
        points = (swEv ? 1 : 0) + (rtEv ? 1 : 0) + (gasEv ? 1 : 0);
        if (coalBad) {
          fluid = 'doubtful';
          reason = 'posible carbón';
        } else if (gasEv) {
          fluid = 'gas';
        } else if (swEv || rtEv) {
          fluid = 'oil';
        } else {
          fluid = 'doubtful';
          reason = 'solo cumple los cortes de pay';
        }
        applicable = fluid === 'gas' ? 3 : 2;
      } else {
        const swHigh = swM >= p.swAquiferMin;
        const noGas = Number.isFinite(gasFrac) && !gasEv;
        if (swHigh) evidence.push('Sw alta');
        if (noGas) {
          evidence.push('sin cruce densidad–neutrón');
          phrases.push('sin cruce densidad–neutrón');
        }
        points = (swHigh ? 1 : 0) + (noGas ? 1 : 0);
        applicable = 2;
        if (coalBad) {
          fluid = 'doubtful';
          reason = 'posible carbón';
        } else if (gasEv) {
          fluid = 'doubtful';
          reason = 'cruce densidad–neutrón con Sw alta';
          evidence.push('cruce densidad–neutrón');
        } else if (swHigh) {
          fluid = 'water';
        } else {
          fluid = 'doubtful';
          reason = 'Sw intermedia: transición o agua con hidrocarburo residual';
        }
      }

      let confidence: WellReadingConfidence;
      if (fluid === 'doubtful') confidence = 'low';
      else if (points >= applicable) confidence = 'high';
      else if (points >= applicable - 1 && points >= 1) confidence = 'medium';
      else confidence = 'low';

      const caveats: string[] = [];
      if (reason) caveats.push(reason);
      if (coalBad && !reason.includes('carbón')) caveats.push('posible carbón');
      if (washBad) {
        confidence = 'low';
        caveats.push(`derrumbe en el ${Math.round(100 * washFrac)} % del tramo`);
      }
      for (const c of caveats) evidence.push(c);

      const top = depth[run.s]! - validH(thickness[run.s]!) / 2;
      const base = depth[run.e - 1]! + validH(thickness[run.e - 1]!) / 2;
      const head = `${depthText(top)}–${depthText(base)} m${where}: ${trimmed(run.h, 1)} m de reservorio con φ ${fixed(phiM, 2)} y Sw ${fixed(swM, 2)}`;
      const tail = `${FLUID_PHRASE[fluid]}, confianza ${CONFIDENCE_LABEL[confidence]}${caveats.length ? ` (${caveats.join('; ')})` : ''}.`;
      const text = `${head}${phrases.length ? `; ${listText(phrases)}` : ''}: ${tail}`;

      return {
        rank: 0,
        kind,
        zoneId: iv.id,
        zone: iv.name,
        top,
        base,
        h: run.h,
        phi: phiM,
        sw: swM,
        vsh: vshM,
        rt: rtM,
        rtRef,
        rtRatio: ratio,
        refKind,
        gasFrac,
        washoutFrac: washFrac,
        coalFrac,
        importance: Number.isFinite(importance) ? importance : 0,
        fluid,
        confidence,
        evidence,
        text,
      };
    };

    const hc = hcRuns.map((run) => ({ run, cand: build(run, 'hydrocarbon') }));
    const wt = waterRuns.map((run) => ({ run, cand: build(run, 'water') }));
    for (const x of hc) all.push(x.cand);
    for (const x of wt) all.push(x.cand);

    // Contacto aparente (a lo sumo uno por zona): pay seguido hacia abajo por un tramo de agua franca, con un hueco
    // corto y un salto claro de Sw. Si hay varios pares (capas delgadas alternadas) se queda el de mayor agua debajo.
    let best: { a: WellReadingCandidate; b: WellReadingCandidate } | null = null;
    for (const a of hc) {
      for (const b of wt) {
        if (b.cand.fluid !== 'water' || b.run.s < a.run.e) continue;
        let gap = 0;
        for (let i = a.run.e; i < b.run.s && gap < p.mergeGap - EPS; i++) gap += validH(thickness[i]!);
        if (gap >= p.mergeGap - EPS) continue;
        if (!(b.cand.sw - a.cand.sw >= p.contactSwJump - EPS)) continue;
        if (!best || b.cand.h > best.b.h + EPS) best = { a: a.cand, b: b.cand };
      }
    }
    if (best) {
      const d = (best.a.base + best.b.top) / 2;
      const label = best.a.fluid === 'gas' ? 'gas–agua' : best.a.fluid === 'oil' ? 'petróleo–agua' : 'hidrocarburo–agua';
      contacts.push({
        zoneId: iv.id,
        zone: iv.name,
        depth: d,
        fluid: best.a.fluid,
        swAbove: best.a.sw,
        swBelow: best.b.sw,
        text: `${label} a ${depthText(d)} m${where}, donde la Sw pasa de ${fixed(best.a.sw, 2)} a ${fixed(best.b.sw, 2)} dentro del mismo reservorio continuo`,
      });
    }
  }

  // Orden y recorte.
  const hcAll = all.filter((c) => c.kind === 'hydrocarbon').sort((a, b) => b.importance - a.importance || a.top - b.top);
  const waterAll = all.filter((c) => c.kind === 'water').sort((a, b) => b.importance - a.importance || a.top - b.top);
  const hcShown = hcAll.slice(0, Math.max(0, Math.floor(p.maxCandidates)));
  const waterShown = waterAll.slice(0, Math.max(0, Math.floor(p.maxWater)));
  const candidates = [...hcShown, ...waterShown];
  candidates.forEach((c, i) => (c.rank = i + 1));
  const omitted = hcAll.length - hcShown.length + waterAll.length - waterShown.length;

  const general = generalLines(hcAll, hcShown, waterAll, contacts, omitted, p, { rt: !!rt, gas: !!gas, washout: !!washout });
  return { candidates, contacts, general, omitted };
}

function generalLines(
  hcAll: readonly WellReadingCandidate[],
  hcShown: readonly WellReadingCandidate[],
  waterAll: readonly WellReadingCandidate[],
  contacts: readonly WellReadingContact[],
  omitted: number,
  p: Readonly<WellReadingParams>,
  have: { rt: boolean; gas: boolean; washout: boolean },
): WellReadingGeneralLine[] {
  const lines: WellReadingGeneralLine[] = [];

  // 1. Resumen
  if (hcAll.length === 0) {
    lines.push({
      kind: 'summary',
      top: NaN,
      base: NaN,
      text: `No se encontraron tramos candidatos a hidrocarburo con los criterios actuales (pay neto de al menos ${trimmed(p.minThickness, 1)} m)${waterAll.length ? `; sí ${waterAll.length === 1 ? 'un tramo acuífero' : `${waterAll.length} tramos acuíferos`}` : ''}.`,
    });
  } else {
    const count = (f: WellReadingFluid) => hcAll.filter((c) => c.fluid === f).length;
    const kinds: string[] = [];
    const g = count('gas');
    const o = count('oil');
    const d = count('doubtful');
    if (g) kinds.push(`${g} de gas`);
    if (o) kinds.push(`${o} de petróleo`);
    if (d) kinds.push(`${d} ${d === 1 ? 'dudoso' : 'dudosos'}`);
    const zones: string[] = [];
    for (const c of [...hcAll].sort((a, b) => a.top - b.top)) if (!zones.includes(c.zone)) zones.push(c.zone);
    const total = hcAll.reduce((s, c) => s + c.h, 0);
    const best = hcAll[0]!;
    const nTxt = hcAll.length === 1 ? 'Se identificó 1 tramo candidato' : `Se identificaron ${hcAll.length} tramos candidatos`;
    const zTxt = zones.length === 1 ? `la zona ${zones[0]}` : `las zonas ${listText(zones)}`;
    const shownTxt = omitted > 0 && hcShown.length < hcAll.length ? `; se listan los ${hcShown.length} más importantes` : '';
    lines.push({
      kind: 'summary',
      top: Math.min(...hcAll.map((c) => c.top)),
      base: Math.max(...hcAll.map((c) => c.base)),
      text: `${nTxt} a hidrocarburo en ${zTxt} (${listText(kinds)}), con ${trimmed(total, 1)} m de pay neto en total; el más importante es ${depthText(best.top)}–${depthText(best.base)} m, ${FLUID_PHRASE[best.fluid]}${shownTxt}.`,
    });
  }

  // 2. Contactos aparentes
  if (contacts.length > 0) {
    const shown = contacts.slice(0, 3);
    const ds = contacts.map((c) => c.depth);
    lines.push({
      kind: 'contacts',
      top: Math.min(...ds),
      base: Math.max(...ds),
      text: `${contacts.length === 1 ? 'Contacto aparente' : 'Contactos aparentes'}: ${shown.map((c) => c.text).join('; ')}${contacts.length > shown.length ? `; y ${contacts.length - shown.length} más` : ''}. Hay que confirmarlo con las presiones MDT.`,
    });
  }

  // 3. Calidad de dato y evidencia que falta
  const notes: string[] = [];
  const doubtedData = hcAll.filter((c) => c.confidence === 'low' && (c.washoutFrac >= p.washoutFracMin || c.coalFrac >= p.coalFracMin));
  if (doubtedData.length > 0) {
    notes.push(`${doubtedData.length === 1 ? '1 tramo tiene' : `${doubtedData.length} tramos tienen`} confianza baja por calidad de dato (derrumbe o carbón): revisá el caliper antes de usar la densidad y el neutrón`);
  }
  const missing: string[] = [];
  if (!have.rt) missing.push('la resistividad profunda');
  if (!have.gas) missing.push('el indicador de crossover de gas');
  if (!have.washout) missing.push('el indicador de derrumbe');
  if (missing.length > 0) notes.push(`falta ${listText(missing)}, así que la lectura tiene menos evidencias`);
  if (notes.length > 0) {
    const bad = doubtedData.length > 0 ? doubtedData : [];
    lines.push({
      kind: 'quality',
      top: bad.length ? Math.min(...bad.map((c) => c.top)) : NaN,
      base: bad.length ? Math.max(...bad.map((c) => c.base)) : NaN,
      text: `${notes.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()),
    });
  }
  return lines;
}
