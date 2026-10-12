/**
 * Pickett interactivo (fase 8b, docs/decisiones/0021, G). Puro y testeado:
 *
 * - **Recta de agua ajustada a la zona acuífera** (`fitWaterLine`): en una zona con Sw = 1, Archie da
 *   ln Rt = ln(a·Rw) − m·ln φ. Criterio:
 *   1. **m** = −pendiente de mínimos cuadrados de ln Rt sobre ln φ (`fitTrend` 'power' de `src/petro/regression.ts`),
 *      recortando iterativamente los puntos a más de 3 desvíos robustos (1,4826·MAD) de la recta: un tramo con
 *      hidrocarburo residual, arcilla o un derrumbe dentro de la «zona acuífera» no tuerce la pendiente.
 *      **Es una cota inferior**: con error en φ (la variable independiente) la pendiente por mínimos cuadrados se atenúa
 *      (sesgo hacia 0 por el cociente var(φ real) / var(φ medida)). Simulación (m = 2, σ ln Rt = 0,08, φ uniforme):
 *      P90/P10 ≈ 1,3 con error de φ 0,01 / 0,02 / 0,03 da m ≈ 1,6 / 1,0 / 0,6; P90/P10 ≈ 1,55: 1,8 / 1,4 / 1,0;
 *      P90/P10 ≈ 2,3: 1,9 / 1,7 / 1,45. La **cota superior** es la pendiente de la regresión inversa de φ sobre Rt,
 *      |m|/R². Cuanto más separadas, menos confiable la m. Con φ de error 0,03 y P90/P10 ≈ 2,9 el ajuste da m = 1,53 y
 *      Rw el doble de la real: ni el error estándar (0,033) ni el R² (0,82) lo delatan.
 *   2. **Rw** = la que deja la MEDIANA de Sw de Archie en 1 sobre los puntos RETENIDOS (los que el recorte no sacó):
 *      a·Rw = exp(mediana(ln Rt + m·ln φ)). Así la zona elegida como acuífera queda, en mediana, con Sw = 1 en el motor
 *      (la mitad de sus muestras de cada lado de la recta). La mediana vale más que la media (que equivale a la ordenada
 *      de mínimos cuadrados con m fija): con hidrocarburo o residuos asimétricos la media se va +40 %.
 *   3. Si la zona no alcanza para estimar m, **se conserva m** y se ajusta solo Rw con el mismo criterio de la mediana (con
 *      recorte análogo de los puntos a más de 3 desvíos robustos de la mediana). Es la práctica habitual: con un solo nivel
 *      de porosidad la pendiente no está determinada. Esa Rw queda **condicionada a m** (se extrapola a φ = 1) y, si la
 *      zona tiene hidrocarburo, tiende a quedar **sobreestimada** (Sw sobreestimada: lado conservador; la mediana con recorte lo contiene, la media no).
 *   4. **Temperatura**: con `lnRwFactor` cada Rt se lleva a la temperatura de referencia con el factor de Arps del motor
 *      (Rt·Rw(Tref)/Rw(T)) antes de ajustar. Entonces `rw` es la Rw de referencia y la mediana de Sw del motor, que aplica
 *      Arps muestra a muestra, queda en 1 (salvo el redondeo del parámetro).
 *   Criterios para aceptar m (**prácticos, no estadísticos**; si no se cumplen se conserva m):
 *   - muestras independientes n_ef = n·(1 − ρ₁)/(1 + ρ₁) ≥ 10, con ρ₁ la autocorrelación de los residuos entre muestras
 *     consecutivas. Cada 0,15 m las muestras son casi copias (ρ₁ = 0,98–0,99 en el pozo del TP: 936 muestras = ~4
 *     independientes), así que el error estándar de MCO subestima ~10 veces; con n_ef se corrige;
 *   - espesor de puntos usados ≥ 5 m (una o dos capas no determinan una pendiente);
 *   - P90/P10 de φ ≥ 2 (con menos, la atenuación puede pasar del 30 % con errores de φ de 0,02);
 *   - error estándar de m (con n_ef) ≤ 0,12: un intervalo de ±0,24 sobre m ≈ 2, ±12 %;
 *   - m dentro del rango del parámetro (1–3,5).
 *   La **dispersión** (1,4826·MAD de ln Rt − recta, sobre todos los puntos) sirve de aviso: una zona acuífera limpia da
 *   0,05–0,2; sobre 0,3 la zona no se comporta como acuífera (en el TP: 0,45–0,58).
 *   Descartado (anotado en 0021): la envolvente inferior (recta por el borde SO de la nube, p. ej. percentil 10 de los
 *   residuos). Es la lectura correcta cuando NO hay una zona acuífera y la nube mezcla agua e hidrocarburo, pero en una
 *   zona elegida como acuífera deja la mayoría de sus muestras con Sw < 1 (la mostraría con hidrocarburo).
 * - **Valores propios por zona** (`ownPickettParams`): qué parámetros de la recta (Rw, m, a, n, T de Rw, corrección)
 *   tiene una zona con valor propio; con alcance global no cambian al arrastrar (se avisa en el rótulo) y, con varias
 *   zonas filtradas, cada una tiene su recta.
 */
import type { ParamState } from '../../core/params';
import { fitTrend } from '../../petro/regression';
import { percentile } from '../../petro/stats';
import { formatNumber } from '../../ui/format';
import { normalizeParam, nudgeParam, paramWrite, PLOT_PARAMS, RW_CORRECT_STORAGE, type ParamWrite, type PlotScope } from '../params';
import { mFromRotate, rwAtReference, rwFromTranslate, type PickettPoint } from './drag';

// ── valores propios por zona ─────────────────────────────────────────────────────────────────────────────────────

/** Parámetros de la recta de agua que pueden tener valor propio por zona, con su nombre corto. */
const ZONE_KEYS: readonly { storage: string; short: string }[] = [
  { storage: PLOT_PARAMS.rwRef.storage, short: 'Rw' },
  { storage: PLOT_PARAMS.m.storage, short: 'm' },
  { storage: PLOT_PARAMS.a.storage, short: 'a' },
  { storage: PLOT_PARAMS.n.storage, short: 'n' },
  { storage: PLOT_PARAMS.tRef.storage, short: 'T de Rw' },
  { storage: RW_CORRECT_STORAGE, short: 'corrección por T' },
];

/** Nombres cortos de los parámetros de la recta de agua con valor propio en la zona (vacío si sigue al global). */
export function ownPickettParams(params: ParamState, zoneId: string): string[] {
  const z = params.zones[zoneId];
  if (!z) return [];
  return ZONE_KEYS.filter((k) => z[k.storage] !== undefined).map((k) => k.short);
}

/** Zonas (de las dadas) con algún parámetro propio de la recta de agua. */
export function zonesWithOwnPickett(params: ParamState, zoneIds: readonly string[]): string[] {
  return zoneIds.filter((id) => ownPickettParams(params, id).length > 0);
}

/**
 * ¿Una recta por zona? Con dos o más zonas FILTRADAS en el gráfico y al menos una con valores propios: cada zona se
 * interpreta con sus parámetros y una sola recta global no la representa. Sin filtro (todas) o con una sola zona vale
 * la regla de alcance de 0015 (global o esa zona).
 */
export function pickettByZone(selected: readonly string[], params: ParamState): boolean {
  return selected.length >= 2 && zonesWithOwnPickett(params, selected).length > 0;
}

/** Aviso del rótulo con alcance global: «2 zonas visibles con Rw o m propios: no cambian». Vacío si no hay. */
export function ownValuesNotice(params: ParamState, visibleZones: readonly { id: string; name: string }[], keys: readonly string[]): string {
  const hit = visibleZones.filter((z) => ownPickettParams(params, z.id).some((k) => keys.includes(k)));
  if (hit.length === 0) return '';
  const what = keys.join(' o ');
  return hit.length === 1 ? `la zona ${hit[0]!.name} tiene ${what} propio: no cambia` : `${hit.length} zonas visibles (${hit.map((z) => z.name).join(', ')}) tienen ${what} propio: no cambian`;
}

// ── ajuste de la recta de agua ───────────────────────────────────────────────────────────────────────────────────

/** Umbrales prácticos (no estadísticos) para aceptar la m de una zona acuífera; ver la cabecera. */
export const WATER_FIT_DEFAULTS = {
  /** Muestras independientes mínimas (n_ef). */
  minNeff: 10,
  /** Espesor mínimo de los puntos usados (m). */
  minThickness: 5,
  /** Cociente mínimo entre los percentiles 90 y 10 de φ. */
  minPhiRatio: 2,
  /** Error estándar máximo de m (con n_ef). */
  maxMSe: 0.12,
  /** Dispersión de ln Rt sobre la que la zona no se comporta como acuífera. */
  maxSpread: 0.3,
} as const;

export interface WaterFitOptions {
  /** Factor de tortuosidad del alcance (Rw = a·Rw / a). */
  a: number;
  /** m vigente: se conserva si la zona no alcanza para estimarla. */
  mCurrent: number;
  /** Rango admisible de m (el del parámetro). */
  mRange: [number, number];
  /** Índice de muestra del pozo de cada posición de la nube (para saber qué puntos son vecinos). Por defecto, la identidad. */
  sample?: ArrayLike<number>;
  /** Paso de muestreo (m), para el espesor de los puntos usados. Sin él no se exige espesor. */
  sampleStep?: number;
  /**
   * ln[Rw(T)/Rw(Tref)] de cada posición (Arps, la fórmula del motor): lleva cada Rt a la temperatura de referencia. Con él
   * `rw` es la Rw de referencia; sin él, la Rw a la temperatura de los puntos. Posiciones sin factor finito se descartan.
   */
  lnRwFactor?: ArrayLike<number>;
  /** Redondeo de m (el del parámetro): Rw se calcula con la m que se escribiría. */
  normalizeM?: (m: number) => number;
  /** Muestras independientes mínimas (por defecto 10). */
  minNeff?: number;
  /** Espesor mínimo de los puntos usados, m (por defecto 5). */
  minThickness?: number;
  /** Cociente mínimo entre los percentiles 90 y 10 de φ para estimar m (por defecto 2). */
  minPhiRatio?: number;
  /** Error estándar máximo de m, con n_ef (por defecto 0,12). */
  maxMSe?: number;
}

export interface WaterFit {
  /** 'm-rw': se estimaron m y Rw; 'rw': se conservó m y se ajustó Rw. */
  mode: 'm-rw' | 'rw';
  m: number;
  /** Cota inferior de m por mínimos cuadrados (aunque se haya rechazado); NaN si no se pudo ajustar. */
  mOls: number;
  /** Cota superior de m: pendiente de la regresión inversa, |m|/R²; NaN si no se pudo ajustar. */
  mUpper: number;
  /** Rw, ohm·m: a la temperatura de referencia de `lnRwFactor`, o de los puntos si no se dio. */
  rw: number;
  /** Puntos válidos de la zona (Rt > 0, 0 < φ < 1). */
  n: number;
  /** Puntos retenidos tras el recorte (los que fijan m, en 'm-rw', o Rw, en 'rw'). */
  used: number;
  /** R² de la regresión de ln Rt sobre ln φ (con los puntos usados); NaN en modo 'rw'. */
  r2: number;
  /** Error estándar de m con muestras independientes (n_ef); NaN si no se estimó. */
  mSe: number;
  /** Muestras independientes equivalentes de los puntos usados en la regresión de m. */
  nEff: number;
  /** Autocorrelación de los residuos entre muestras consecutivas (0 si hay pocos pares). */
  rho: number;
  /** Espesor de los puntos usados (m); NaN sin `sampleStep`. */
  thickness: number;
  /** P90/P10 de φ en la zona. */
  phiRatio: number;
  /** Dispersión de ln Rt alrededor de la recta final, sobre todos los puntos (1,4826·MAD). */
  spread: number;
  /** Por qué se conservó m (modo 'rw'). */
  reason?: string;
}

const median = (xs: number[]): number => percentile(xs, 0.5);
const f1 = (v: number) => formatNumber(v, { digits: 1 });
const f2 = (v: number) => formatNumber(v, { digits: 2 });

/**
 * Ajusta la recta de agua del Pickett a los puntos (`rt[k]`, `phi[k]`) de los índices `idx` (la zona acuífera). Ver
 * el criterio en la cabecera. null (con `problem`) si quedan menos de 5 puntos válidos.
 */
export function fitWaterLine(rt: ArrayLike<number>, phi: ArrayLike<number>, idx: ArrayLike<number>, o: WaterFitOptions): WaterFit | { problem: string } {
  const valid: number[] = [];
  const rtEff = new Float64Array(rt.length); // Rt llevada a la temperatura de referencia (solo en los puntos válidos)
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]!;
    const r = rt[i]!;
    const f = phi[i]!;
    const lf = o.lnRwFactor ? o.lnRwFactor[i]! : 0;
    if (r > 0 && Number.isFinite(r) && f > 0 && f < 1 && Number.isFinite(lf)) {
      valid.push(i);
      rtEff[i] = o.lnRwFactor ? r / Math.exp(lf) : r;
    }
  }
  if (valid.length < 5) return { problem: valid.length === 0 ? 'La zona acuífera no tiene puntos con Rt y φ en este gráfico.' : `Solo ${valid.length} puntos en la zona acuífera: hacen falta al menos 5.` };
  const lnR = new Map<number, number>();
  const lnF = new Map<number, number>();
  for (const i of valid) {
    lnR.set(i, Math.log(rtEff[i]!));
    lnF.set(i, Math.log(phi[i]!));
  }
  const phis = valid.map((i) => phi[i]!);
  const phiRatio = percentile(phis, 0.9) / percentile(phis, 0.1);

  // 1. m: mínimos cuadrados de ln Rt sobre ln φ con recorte robusto iterativo (3 · 1,4826 · MAD).
  let out = new Set<number>();
  let fit = fitTrend(phi, rtEff, 'power', { indices: valid });
  for (let iter = 0; iter < 6 && fit; iter++) {
    const c = Math.log(fit.a);
    const b = fit.b;
    const res = valid.map((i) => lnR.get(i)! - c - b * lnF.get(i)!);
    const med = median(res);
    const s = 1.4826 * median(res.map((r) => Math.abs(r - med)));
    const next = new Set<number>();
    if (s > 0) valid.forEach((i, k) => Math.abs(res[k]! - med) > 3 * s && next.add(i));
    if (next.size === out.size && [...next].every((i) => out.has(i))) break;
    if (valid.length - next.size < 5) break;
    out = next;
    fit = fitTrend(phi, rtEff, 'power', { indices: valid, exclude: (i) => out.has(i) });
  }
  let mFit = NaN;
  let mUpper = NaN;
  let mSe = NaN;
  let r2 = NaN;
  let nEff = NaN;
  let rho = 0;
  let used = valid.length - out.size;
  const usedIdx = valid.filter((i) => !out.has(i));
  if (fit) {
    mFit = -fit.b;
    r2 = fit.r2;
    used = fit.n;
    mUpper = r2 > 0 ? Math.abs(fit.b) / r2 : NaN;
    // Error estándar de la pendiente en el espacio ln–ln: √(SSE/(n−2) / Σ(u − ū)²), corregido por la correlación entre
    // muestras vecinas: con n_ef = n·(1−ρ₁)/(1+ρ₁) muestras independientes, se multiplica por √(n/n_ef).
    const us = usedIdx.map((i) => lnF.get(i)!);
    const ub = us.reduce((a, b) => a + b, 0) / us.length;
    const suu = us.reduce((a, u) => a + (u - ub) ** 2, 0);
    const c = Math.log(fit.a);
    const resOf = new Map<number, number>();
    for (const i of usedIdx) resOf.set(i, lnR.get(i)! - c - fit.b * lnF.get(i)!);
    const sse = [...resOf.values()].reduce((a, r) => a + r * r, 0);
    const seNaive = used > 2 && suu > 0 ? Math.sqrt(sse / (used - 2) / suu) : NaN;
    // ρ₁: correlación de los residuos de muestras consecutivas del pozo (ambas retenidas).
    const bySample = new Map<number, number>();
    for (const i of usedIdx) bySample.set(o.sample ? o.sample[i]! : i, resOf.get(i)!);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    let pairs = 0;
    for (const [smp, r] of bySample) {
      const nx = bySample.get(smp + 1);
      if (nx === undefined) continue;
      sxy += r * nx;
      sxx += r * r;
      syy += nx * nx;
      pairs++;
    }
    // Con residuos del orden del redondeo (datos sin ruido) la correlación no significa nada: ρ = 0.
    rho = pairs >= 5 && sxx > 0 && syy > 0 && Math.sqrt(sse / used) > 1e-9 ? Math.min(0.99, Math.max(0, sxy / Math.sqrt(sxx * syy))) : 0;
    nEff = used * ((1 - rho) / (1 + rho));
    mSe = seNaive * Math.sqrt(used / nEff);
  }
  const minNeff = o.minNeff ?? WATER_FIT_DEFAULTS.minNeff;
  const minThickness = o.minThickness ?? WATER_FIT_DEFAULTS.minThickness;
  const minRatio = o.minPhiRatio ?? WATER_FIT_DEFAULTS.minPhiRatio;
  const maxSe = o.maxMSe ?? WATER_FIT_DEFAULTS.maxMSe;
  const thickness = o.sampleStep && o.sampleStep > 0 && fit ? used * o.sampleStep : NaN;
  let reason: string | undefined;
  if (!Number.isFinite(mFit)) reason = 'las porosidades no varían';
  else if (Number.isFinite(thickness) && thickness < minThickness) reason = `poco espesor de puntos limpios (${f1(thickness)} m; hacen falta ${f1(minThickness)} m)`;
  else if (!(nEff >= minNeff)) reason = `pocas muestras independientes (${f1(nEff)} equivalentes de ${used}, porque las vecinas son casi iguales; hacen falta ${f1(minNeff)})`;
  else if (!(phiRatio >= minRatio)) reason = `porosidades en un rango angosto (P90/P10 = ${f2(phiRatio)}; hace falta ${f2(minRatio)})`;
  else if (!(mSe <= maxSe)) reason = `m incierta (error estándar ${f2(mSe)} con muestras independientes)`;
  else if (mFit < o.mRange[0] || mFit > o.mRange[1]) reason = `m ajustada (${f2(mFit)}) fuera del rango ${f2(o.mRange[0])}–${f2(o.mRange[1])}`;
  const mode: WaterFit['mode'] = reason ? 'rw' : 'm-rw';
  const m = mode === 'm-rw' ? (o.normalizeM ? o.normalizeM(mFit) : mFit) : o.mCurrent;

  // 2. Rw: mediana de ln Rt + m·ln φ sobre los puntos retenidos (mediana de Sw de Archie = 1). Con m estimada, los que dejó
  //    el recorte de la regresión; con m conservada, los que están a menos de 3 desvíos robustos de la mediana.
  const all = valid.map((i) => lnR.get(i)! + m * lnF.get(i)!);
  const allMed = median(all);
  const spread = 1.4826 * median(all.map((c) => Math.abs(c - allMed)));
  let kept: number[];
  if (mode === 'm-rw') kept = valid.map((_, k) => k).filter((k) => !out.has(valid[k]!));
  else {
    kept = spread > 0 ? valid.map((_, k) => k).filter((k) => Math.abs(all[k]! - allMed) <= 3 * spread) : valid.map((_, k) => k);
    if (kept.length < 5) kept = valid.map((_, k) => k);
  }
  const cMed = median(kept.map((k) => all[k]!));
  const rw = Math.exp(cMed) / o.a;
  return {
    mode,
    m,
    mOls: mFit,
    mUpper,
    rw,
    n: valid.length,
    used: mode === 'm-rw' ? used : kept.length,
    r2: mode === 'm-rw' ? r2 : NaN,
    mSe: mode === 'm-rw' ? mSe : NaN,
    nEff,
    rho,
    thickness,
    phiRatio,
    spread,
    ...(reason ? { reason } : {}),
  };
}

// ── arrastre de una recta (global, de una zona o una de varias) ───────────────────────────────────────────────────

/** Lo que hace falta de una recta de agua para convertir un arrastre en parámetros. */
export interface WaterLineUnit {
  a: number;
  m: number;
  /** Rw de formación de la recta. */
  rw: number;
  rwRef: number;
  tRef: number;
  /** Temperatura a la que se lee la recta (°C). */
  tRep: number;
  correct: boolean;
  /** Rw sale de `rw-manual` (si no, trasladar no escribe nada). */
  manual: boolean;
  /** Alcance: global, la zona filtrada o, con una recta por zona, SU zona. */
  scope: PlotScope;
}

/** Id de una manija de recta de agua: 'water-move' / 'water-rotate' (una recta) o con ':<zona>' (una por zona). */
export function parseWaterHandle(id: string): { which: 'move' | 'rotate'; key: string } | null {
  const m = /^water-(move|rotate)(?::(.+))?$/.exec(id);
  return m ? { which: m[1] as 'move' | 'rotate', key: m[2] ?? '' } : null;
}

/**
 * Escrituras de un arrastre de la recta de agua hasta `pt`: trasladar = Rw de referencia (Rw de formación llevada de la
 * temperatura de la recta a la de referencia, como el motor); rotar = m alrededor de φ = 1. Con el alcance de la
 * recta: arrastrar la recta de una zona escribe solo esa zona.
 */
export function waterLineDragWrites(u: WaterLineUnit, which: 'move' | 'rotate', pt: PickettPoint): ParamWrite[] {
  if (which === 'move') {
    if (!u.manual) return [];
    const rwRef = rwAtReference(rwFromTranslate(pt, u.a, u.m), u.tRef, u.tRep, u.correct);
    const v = normalizeParam(PLOT_PARAMS.rwRef.spec, rwRef);
    return Number.isFinite(v) ? [paramWrite(PLOT_PARAMS.rwRef, v, u.scope)] : [];
  }
  const m = normalizeParam(PLOT_PARAMS.m.spec, mFromRotate(pt, u.a, u.rw));
  return Number.isFinite(m) ? [paramWrite(PLOT_PARAMS.m, m, u.scope)] : [];
}

/** Flechas sobre una manija de la recta: un paso de Rw de referencia o de m (Mayús ×10), en el alcance de la recta. */
export function waterLineNudgeWrites(u: WaterLineUnit, which: 'move' | 'rotate', dir: 1 | -1, big: boolean): ParamWrite[] {
  if (which === 'move') return u.manual ? [paramWrite(PLOT_PARAMS.rwRef, nudgeParam(PLOT_PARAMS.rwRef.spec, u.rwRef, dir, big), u.scope)] : [];
  return [paramWrite(PLOT_PARAMS.m, nudgeParam(PLOT_PARAMS.m.spec, u.m, dir, big), u.scope)];
}
