/**
 * Pickett interactivo (fase 8b, docs/decisiones/0021, G). Puro y testeado:
 *
 * - **Recta de agua ajustada a la zona acuífera** (`fitWaterLine`): en una zona con Sw = 1, Archie da
 *   ln Rt = ln(a·Rw) − m·ln φ. Criterio:
 *   1. **m** = −pendiente de mínimos cuadrados de ln Rt sobre ln φ (`fitTrend` 'power' de `src/petro/regression.ts`),
 *      recortando iterativamente los puntos a más de 3 desvíos robustos (1,4826·MAD) de la recta: un tramo con
 *      hidrocarburo residual, arcilla o un derrumbe dentro de la «zona acuífera» no tuerce la pendiente.
 *   2. **Rw** = la que deja la MEDIANA de Sw de Archie en 1 sobre todos los puntos de la zona:
 *      a·Rw = exp(mediana(ln Rt + m·ln φ)). Así la zona elegida como acuífera queda, en mediana, con Sw = 1 en el motor
 *      (la mitad de sus muestras de cada lado de la recta), que es lo que significa elegirla.
 *   3. Si la zona no alcanza para estimar m (menos de `minUsed` puntos, porosidades en un rango angosto, error estándar
 *      de m grande o m fuera del rango del parámetro), **se conserva m** y se ajusta solo Rw con el mismo criterio de la
 *      mediana. Es la práctica habitual: con un solo nivel de porosidad la pendiente no está determinada.
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

export interface WaterFitOptions {
  /** Factor de tortuosidad del alcance (Rw = a·Rw / a). */
  a: number;
  /** m vigente: se conserva si la zona no alcanza para estimarla. */
  mCurrent: number;
  /** Rango admisible de m (el del parámetro). */
  mRange: [number, number];
  /** Puntos usados mínimos para estimar m (por defecto 20). */
  minUsed?: number;
  /** Cociente mínimo entre los percentiles 90 y 10 de φ para estimar m (por defecto 1,35). */
  minPhiRatio?: number;
  /** Error estándar máximo de m (por defecto 0,12). */
  maxMSe?: number;
}

export interface WaterFit {
  /** 'm-rw': se estimaron m y Rw; 'rw': se conservó m y se ajustó Rw. */
  mode: 'm-rw' | 'rw';
  m: number;
  /** Rw de formación (a la temperatura de los puntos), ohm·m. */
  rw: number;
  /** Puntos válidos de la zona (Rt > 0, 0 < φ < 1). */
  n: number;
  /** Puntos que quedaron en la regresión de m después del recorte. */
  used: number;
  /** R² de la regresión de ln Rt sobre ln φ (con los puntos usados); NaN en modo 'rw'. */
  r2: number;
  /** Error estándar de m (NaN si no se estimó). */
  mSe: number;
  /** P90/P10 de φ en la zona. */
  phiRatio: number;
  /** Desvío robusto de ln Rt alrededor de la recta final (1,4826·MAD). */
  spread: number;
  /** Por qué se conservó m (modo 'rw'). */
  reason?: string;
}

const median = (xs: number[]): number => percentile(xs, 0.5);
const f2 = (v: number) => formatNumber(v, { digits: 2 });

/**
 * Ajusta la recta de agua del Pickett a los puntos (`rt[k]`, `phi[k]`) de los índices `idx` (la zona acuífera). Ver
 * el criterio en la cabecera. null (con `problem`) si quedan menos de 5 puntos válidos.
 */
export function fitWaterLine(rt: ArrayLike<number>, phi: ArrayLike<number>, idx: ArrayLike<number>, o: WaterFitOptions): WaterFit | { problem: string } {
  const valid: number[] = [];
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]!;
    const r = rt[i]!;
    const f = phi[i]!;
    if (r > 0 && Number.isFinite(r) && f > 0 && f < 1) valid.push(i);
  }
  if (valid.length < 5) return { problem: valid.length === 0 ? 'La zona acuífera no tiene puntos con Rt y φ en este gráfico.' : `Solo ${valid.length} puntos en la zona acuífera: hacen falta al menos 5.` };
  const lnR = new Map<number, number>();
  const lnF = new Map<number, number>();
  for (const i of valid) {
    lnR.set(i, Math.log(rt[i]!));
    lnF.set(i, Math.log(phi[i]!));
  }
  const phis = valid.map((i) => phi[i]!);
  const phiRatio = percentile(phis, 0.9) / percentile(phis, 0.1);

  // 1. m: mínimos cuadrados de ln Rt sobre ln φ con recorte robusto iterativo (3 · 1,4826 · MAD).
  let out = new Set<number>();
  let fit = fitTrend(phi, rt, 'power', { indices: valid });
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
    fit = fitTrend(phi, rt, 'power', { indices: valid, exclude: (i) => out.has(i) });
  }
  let mFit = NaN;
  let mSe = NaN;
  let r2 = NaN;
  let used = valid.length - out.size;
  if (fit) {
    mFit = -fit.b;
    r2 = fit.r2;
    used = fit.n;
    // Error estándar de la pendiente en el espacio ln–ln: √(SSE/(n−2) / Σ(u − ū)²).
    const us = valid.filter((i) => !out.has(i)).map((i) => lnF.get(i)!);
    const ub = us.reduce((a, b) => a + b, 0) / us.length;
    const suu = us.reduce((a, u) => a + (u - ub) ** 2, 0);
    const c = Math.log(fit.a);
    const sse = valid.filter((i) => !out.has(i)).reduce((a, i) => a + (lnR.get(i)! - c - fit!.b * lnF.get(i)!) ** 2, 0);
    mSe = used > 2 && suu > 0 ? Math.sqrt(sse / (used - 2) / suu) : NaN;
  }
  const minUsed = o.minUsed ?? 20;
  const minRatio = o.minPhiRatio ?? 1.35;
  const maxSe = o.maxMSe ?? 0.12;
  let reason: string | undefined;
  if (!Number.isFinite(mFit)) reason = 'las porosidades no varían';
  else if (used < minUsed) reason = `pocos puntos para estimar m (${used}; hacen falta ${minUsed})`;
  else if (!(phiRatio >= minRatio)) reason = `porosidades en un rango angosto (P90/P10 = ${f2(phiRatio)})`;
  else if (!(mSe <= maxSe)) reason = `m incierta (error estándar ${f2(mSe)})`;
  else if (mFit < o.mRange[0] || mFit > o.mRange[1]) reason = `m ajustada (${f2(mFit)}) fuera del rango ${f2(o.mRange[0])}–${f2(o.mRange[1])}`;
  const mode: WaterFit['mode'] = reason ? 'rw' : 'm-rw';
  const m = mode === 'm-rw' ? mFit : o.mCurrent;

  // 2. Rw: mediana de ln Rt + m·ln φ sobre TODOS los puntos válidos (mediana de Sw de Archie = 1).
  const cs = valid.map((i) => lnR.get(i)! + m * lnF.get(i)!);
  const cMed = median(cs);
  const rw = Math.exp(cMed) / o.a;
  const spread = 1.4826 * median(cs.map((c) => Math.abs(c - cMed)));
  return { mode, m, rw, n: valid.length, used: mode === 'm-rw' ? used : valid.length, r2: mode === 'm-rw' ? r2 : NaN, mSe: mode === 'm-rw' ? mSe : NaN, phiRatio, spread, ...(reason ? { reason } : {}) };
}

/** Sw de Archie de un punto (sin acotar): ((a·Rw) / (φ^m·Rt))^(1/n). */
export function archieSw(rt: number, phi: number, p: { a: number; m: number; n: number; rw: number }): number {
  return ((p.a * p.rw) / (phi ** p.m * rt)) ** (1 / p.n);
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
