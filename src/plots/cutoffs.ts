/**
 * Cutoffs arrastrables de los gráficos (docs/decisiones/0014, D3). Puro y testeado.
 *
 * - Si la curva del eje tiene rol VSH, PHIE o SW, la línea ES el cutoff del módulo `cutoffs` (parámetros compartidos
 *   `vshCutoff`, `phiCutoff`, `swCutoff`): arrastrarla recalcula el pay, el sumario y la pista del visor.
 * - Alcance: con exactamente una zona en el filtro del gráfico se escribe el valor de esa zona; si no, el global.
 * - En cualquier otra curva es una línea libre que solo se guarda en la configuración del gráfico.
 */
import type { ParamState } from '../core/params';
import type { Zone } from '../core/well';
import { SHARED_PARAMS } from '../modules/sharedParams';

/** Rol de curva → parámetro compartido del módulo de cutoffs. */
export const CUTOFF_PARAMS = {
  VSH: 'vshCutoff',
  PHIE: 'phiCutoff',
  SW: 'swCutoff',
} as const;

export type CutoffParamKey = (typeof CUTOFF_PARAMS)[keyof typeof CUTOFF_PARAMS];

/** Parámetro de cutoff de un rol, o null si la curva no tiene cutoff real. */
export function cutoffParamFor(role: string | null): CutoffParamKey | null {
  return role && role in CUTOFF_PARAMS ? CUTOFF_PARAMS[role as keyof typeof CUTOFF_PARAMS] : null;
}

/** Qué lado del cutoff es reservorio o pay: Vsh y Sw son máximos (≤ pasa), φ es mínimo (≥ pasa). */
export const CUTOFF_PASSES: Readonly<Record<CutoffParamKey, 'below' | 'above'>> = { vshCutoff: 'below', phiCutoff: 'above', swCutoff: 'below' };

export interface CutoffScope {
  /** Zona cuyo valor se lee y se escribe; null = global. */
  zoneId: string | null;
  /** Rótulo junto a la línea: «Cutoff global» o «Cutoff zona C». */
  label: string;
}

/** Alcance del cutoff según el filtro de zonas del gráfico: una sola zona → esa zona; si no, global. */
export function cutoffScope(selected: readonly string[], zones: readonly Pick<Zone, 'id' | 'name'>[]): CutoffScope {
  const valid = selected.filter((id) => zones.some((z) => z.id === id));
  if (valid.length === 1) {
    const z = zones.find((zz) => zz.id === valid[0])!;
    return { zoneId: z.id, label: `Cutoff zona ${z.name}` };
  }
  return { zoneId: null, label: 'Cutoff global' };
}

/**
 * Valor efectivo de un parámetro compartido numérico (clave de almacenamiento = la clave, por ser compartido): el
 * override de la zona si hay, si no el global guardado, si no el de fábrica. Valores no numéricos se ignoran.
 */
export function sharedParamValue(params: ParamState, key: keyof typeof SHARED_PARAMS, zoneId: string | null): number {
  const spec = SHARED_PARAMS[key];
  const pick = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const zoned = zoneId && spec.scope === 'zone' ? pick(params.zones[zoneId]?.[key]) : undefined;
  return zoned ?? pick(params.global[key]) ?? (spec.default as number);
}

/** Valor acotado al rango del parámetro (un arrastre fuera del eje no deja un cutoff inválido). */
export function clampCutoff(key: CutoffParamKey, v: number): number {
  const spec = SHARED_PARAMS[key];
  if (spec.type !== 'number') return v;
  return Math.min(spec.max, Math.max(spec.min, v));
}

/** Valor acotado al rango del parámetro y redondeado a su paso (el mismo que da el slider del inspector). */
export function normalizeCutoff(key: CutoffParamKey, v: number): number {
  const spec = SHARED_PARAMS[key];
  const c = clampCutoff(key, v);
  const step = spec.type === 'number' ? spec.step : undefined;
  return step ? +(Math.round(c / step) * step).toFixed(6) : c;
}

/** Una línea de cutoff de un gráfico, ya resuelta. */
export interface CutoffLine {
  /** Id de la guía (`cut:<curva>`). */
  id: string;
  curveKey: string;
  axis: 'x' | 'y';
  value: number;
  /** Parámetro real del módulo de cutoffs, o null (línea libre). */
  param: CutoffParamKey | null;
  /** Zona del valor (solo con `param`). */
  zoneId: string | null;
  /** «Cutoff global», «Cutoff zona C» o «Cutoff libre». */
  title: string;
}

export const cutoffGuideId = (curveKey: string) => `cut:${curveKey}`;

/**
 * Línea de cutoff de la curva de un eje, si el gráfico la muestra (`cutoffs[curva]`): real si el rol tiene parámetro
 * (el valor sale de los parámetros, en la zona del alcance), libre si no. `preview` reemplaza el valor durante un
 * arrastre. null si el gráfico no tiene cutoff en esa curva.
 */
export function resolveCutoffLine(
  axis: 'x' | 'y',
  curve: { key: string; role: string | null },
  cutoffs: Readonly<Record<string, number | true>>,
  params: ParamState,
  scope: CutoffScope,
  preview?: { id: string; value: number } | null,
): CutoffLine | null {
  const stored = cutoffs[curve.key];
  if (stored === undefined) return null;
  const id = cutoffGuideId(curve.key);
  const param = cutoffParamFor(curve.role);
  const base = param ? sharedParamValue(params, param, scope.zoneId) : typeof stored === 'number' ? stored : NaN;
  const value = preview && preview.id === id ? preview.value : base;
  if (!Number.isFinite(value)) return null;
  return { id, curveKey: curve.key, axis, value, param, zoneId: param ? scope.zoneId : null, title: param ? scope.label : 'Cutoff libre' };
}

/** Paso del parámetro (el del slider): las flechas mueven el cutoff de a un paso. */
export function paramStep(key: CutoffParamKey): number {
  const spec = SHARED_PARAMS[key];
  return spec.type === 'number' && spec.step ? spec.step : 0.01;
}
