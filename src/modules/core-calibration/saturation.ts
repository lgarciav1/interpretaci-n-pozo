/**
 * Exponente de saturación n desde el ensayo de índice de resistividad de corona: modelo PURO del panel «Calibración»
 * (docs/decisiones/0053-exponente-de-saturacion-desde-corona.md).
 *
 * - Datos: conjuntos de puntos `core-ri` (un punto por paso de desaturación, columnas `sw`, `ri`, `plug`; ver
 *   `src/io/coreRi.ts`). Viven en el pozo como los plugs; lo que decide el usuario (descartar un plug) va en
 *   `Interpretation.pointSets[conjunto]` como decisión `exclude` sobre TODOS los pasos del plug.
 * - Ajustes con el motor puro (`fitSaturationExponent`): todos los pasos incluidos juntos (por el origen, recomendado,
 *   y libre) y uno por plug (por el origen; con un solo paso es el n puntual −ln RI / ln Sw).
 * - Recetas «Aplicar n» y «Aplicar a, m y n» (parámetros compartidos de los modelos de Sw), en `./model.ts`.
 *
 * Sin React, stores ni `src/plots`: lo importan el panel y los tests.
 */
import { pointNumbers, pointTexts, type PointSet, type PointSetDecisions } from '../../core/pointSets';
import { setPointDecisions } from '../../core/state/pointSets';
import type { Project } from '../../core/state/project';
import { CORE_RI_COLUMNS, CORE_RI_SET_KIND } from '../../io/coreRi';
import { fitSaturationExponent, type SaturationResult } from '../../petro/coreCalibration';

export const CORE_RI_KIND = CORE_RI_SET_KIND;
export const RI_COL = CORE_RI_COLUMNS;

export const riSets = (sets: readonly PointSet[]): PointSet[] => sets.filter((s) => s.kind === CORE_RI_KIND);

/** Plug de cada paso (el nombre del conjunto si no hay columna de plug). */
export function riPlugOf(set: PointSet): readonly string[] {
  return pointTexts(set, RI_COL.plug) ?? set.pointIds.map(() => set.name);
}

/** Plugs del conjunto en el orden en que aparecen, con los índices de sus pasos. */
export function riPlugGroups(set: PointSet): { plug: string; idx: number[] }[] {
  const plugs = riPlugOf(set);
  const out = new Map<string, number[]>();
  plugs.forEach((p, i) => {
    const list = out.get(p);
    if (list) list.push(i);
    else out.set(p, [i]);
  });
  return [...out].map(([plug, idx]) => ({ plug, idx }));
}

/** ¿El paso entra en el ajuste? Sí, salvo que el usuario lo haya descartado. */
export function riIncluded(set: PointSet, dec: PointSetDecisions | undefined): boolean[] {
  return set.pointIds.map((id) => dec?.points[id]?.status !== 'exclude');
}

export interface RiPlugRow {
  plug: string;
  /** Índices de sus pasos en el conjunto. */
  idx: number[];
  /** Algún paso incluido (el plug entra en el ajuste conjunto). */
  included: boolean;
  /** Ajuste por el origen del plug (null sin pasos válidos con Sw < 1). */
  fit: SaturationResult;
  /** Sw mínima alcanzada en la desaturación (v/v). */
  swMin: number;
  /** |n| informado por el laboratorio, si la tabla lo trae (primer valor finito del plug). */
  nLab: number;
}

export interface RiSaturation {
  /** Ajuste conjunto con todos los pasos incluidos (por el origen y libre). */
  pooled: SaturationResult;
  /** Por plug, en el orden del conjunto. */
  plugs: RiPlugRow[];
  /** Media de los n por plug (incluidos, con n finito) y cuántos plugs la forman. */
  meanPerPlug: { n: number; count: number };
  /** Pasos incluidos (para el gráfico): índice en el conjunto, Sw y RI. */
  idx: number[];
  sw: Float64Array;
  ri: Float64Array;
}

const cache = new WeakMap<PointSet, WeakMap<object, RiSaturation>>();
const NO_DEC = {};

/** n desde los pasos RI–Sw de un conjunto, con las decisiones del usuario. null si faltan las columnas sw o ri. */
export function riSaturation(set: PointSet, dec: PointSetDecisions | undefined): RiSaturation | null {
  const sw = pointNumbers(set, RI_COL.sw);
  const ri = pointNumbers(set, RI_COL.ri);
  if (!sw || !ri) return null;
  let byDec = cache.get(set);
  if (!byDec) cache.set(set, (byDec = new WeakMap()));
  const hit = byDec.get(dec ?? NO_DEC);
  if (hit) return hit;
  const inc = riIncluded(set, dec);
  const nLab = pointNumbers(set, RI_COL.nLab);
  const plugs: RiPlugRow[] = riPlugGroups(set).map(({ plug, idx }) => {
    const use = idx.filter((i) => inc[i]);
    const s = Float64Array.from(use, (i) => sw[i]!);
    const r = Float64Array.from(use, (i) => ri[i]!);
    let swMin = NaN;
    for (const v of s) if (v > 0 && v <= 1 && !(v >= swMin)) swMin = v;
    const lab = nLab ? (idx.map((i) => nLab[i]!).find(Number.isFinite) ?? NaN) : NaN;
    return { plug, idx, included: use.length > 0, fit: fitSaturationExponent(s, r), swMin, nLab: lab };
  });
  const idx = set.pointIds.map((_, i) => i).filter((i) => inc[i]);
  const s = Float64Array.from(idx, (i) => sw[i]!);
  const r = Float64Array.from(idx, (i) => ri[i]!);
  let sum = 0;
  let count = 0;
  for (const p of plugs) {
    const n = p.fit.origin?.n;
    if (p.included && n !== undefined && Number.isFinite(n)) {
      sum += n;
      count++;
    }
  }
  const out: RiSaturation = { pooled: fitSaturationExponent(s, r), plugs, meanPerPlug: { n: count ? sum / count : NaN, count }, idx, sw: s, ri: r };
  byDec.set(dec ?? NO_DEC, out);
  return out;
}

/** Curva RI = intercept·Sw^(−n) en [lo, hi] de Sw (dos puntos: es una recta en log–log). */
export function riLine(n: number, intercept: number, lo: number, hi: number): { x: Float64Array; y: Float64Array } {
  return { x: Float64Array.of(lo, hi), y: Float64Array.of(intercept * Math.pow(lo, -n), intercept * Math.pow(hi, -n)) };
}

/**
 * Incluir o descartar un plug entero: `exclude` en todos sus pasos, o borrar esas decisiones. Una receta (un Ctrl+Z).
 */
export function setRiPlugIncluded(project: Project, wellId: string, set: PointSet, plug: string, include: boolean): Project {
  const group = riPlugGroups(set).find((g) => g.plug === plug);
  if (!group) return project;
  const patches: Record<string, { status: 'exclude' } | null> = {};
  for (const i of group.idx) patches[set.pointIds[i]!] = include ? null : { status: 'exclude' };
  return setPointDecisions(project, wellId, set.id, patches);
}
