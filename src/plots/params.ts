/**
 * Parámetros petrofísicos elegidos SOBRE los gráficos (fase 7b; docs/decisiones/0015). Puro y testeado: qué
 * parámetro mueve cada elemento arrastrable, dónde se guarda, qué alcance tiene (la regla de los cutoffs de 0014, D3),
 * cómo se acota y redondea (igual que el slider del inspector) y si el módulo que lo usa alimenta la cadena.
 *
 * Los paneles convierten un arrastre en `ParamWrite[]`; `src/app/plots/connect.tsx` los escribe con `setParam` en un
 * solo `commit` por movimiento, agrupados por gesto (un Ctrl+Z por arrastre).
 */
import type { SourceRef } from '../core/interpretation';
import { paramScope, paramStorageKey, type NumberParamSpec, type ParamSpec, type ParamState, type ParamValue } from '../core/params';
import type { Zone } from '../core/well';
import nmrFluids from '../modules/nmr-fluids';
import phiDensity from '../modules/phi-density';
import phiNeutron from '../modules/phi-neutron';
import rwManual from '../modules/rw-manual';
import { SHARED_PARAMS } from '../modules/sharedParams';
import { formatParamValue } from '../ui/format';
import { clamp, snapToStep, stepValue } from '../ui/scale';
import { unitLabel } from '../core/units';
import type { XYGuide } from './xy/layers';

/** Un parámetro numérico que se puede elegir sobre un gráfico. */
export interface PlotParam {
  /** Módulo que lo declara (para un compartido, uno cualquiera de los que lo usan). */
  moduleId: string;
  /** Clave local en el módulo. */
  key: string;
  spec: NumberParamSpec;
  /** Clave de almacenamiento: la clave si es compartido; `módulo.clave` si no (`paramStorageKey`). */
  storage: string;
  /** Nombre corto en los rótulos («Rw», «GR limpio», «m»). */
  short: string;
}

function plotParam(moduleId: string, key: string, spec: ParamSpec, short: string): PlotParam {
  if (spec.type !== 'number') throw new Error(`El parámetro ${moduleId}.${key} no es numérico.`);
  return { moduleId, key, spec, storage: paramStorageKey(moduleId, key, spec), short };
}

/** Los parámetros que mueven el histograma y el crossplot. */
export const PLOT_PARAMS = {
  grClean: plotParam('igr', 'grClean', SHARED_PARAMS.grClean, 'GR limpio'),
  grShale: plotParam('igr', 'grShale', SHARED_PARAMS.grShale, 'GR arcilla'),
  rhoMa: plotParam('phi-density', 'rhoMa', phiDensity.params.rhoMa, 'ρma'),
  rhoFl: plotParam('phi-density', 'rhoFl', phiDensity.params.rhoFl, 'ρf'),
  matrixOffset: plotParam('phi-neutron', 'matrixOffset', phiNeutron.params.matrixOffset, 'Corrección del neutrón'),
  rwRef: plotParam('rw-manual', 'rwRef', rwManual.params.rwRef, 'Rw'),
  tRef: plotParam('rw-manual', 'tRef', rwManual.params.tRef, 'T de Rw'),
  a: plotParam('sw-archie', 'a', SHARED_PARAMS.a, 'a'),
  m: plotParam('sw-archie', 'm', SHARED_PARAMS.m, 'm'),
  n: plotParam('sw-archie', 'n', SHARED_PARAMS.n, 'n'),
  /** Solo lectura (recta del umbral de déficit en la plantilla RMN vs. densidad–neutrón, 0019). */
  nmrTolerance: plotParam('nmr-fluids', 'tolerance', nmrFluids.params.tolerance, 'Tolerancia RMN'),
} as const;

/** Clave de almacenamiento de «Corregir por temperatura» de `rw-manual` (booleano). */
export const RW_CORRECT_STORAGE = paramStorageKey('rw-manual', 'correct', rwManual.params.correct);

// ── alcance ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PlotScope {
  /** Zona cuyo valor se lee y se escribe; null = global. */
  zoneId: string | null;
  /** «global» o «zona C» (va en los rótulos: «Rw global», «GR limpio zona C»). */
  text: string;
}

/**
 * Alcance de un parámetro elegido sobre un gráfico: la regla de los cutoffs (0014, D3). Con exactamente una zona en
 * el filtro del gráfico se lee y se escribe el valor de esa zona; si no, el global. Un parámetro sin alcance por zona
 * (`scope: 'global'`) siempre es global.
 */
export function plotScope(selected: readonly string[], zones: readonly Pick<Zone, 'id' | 'name'>[], spec?: ParamSpec): PlotScope {
  if (spec && paramScope(spec) !== 'zone') return { zoneId: null, text: 'global' };
  const valid = selected.filter((id) => zones.some((z) => z.id === id));
  if (valid.length === 1) {
    const z = zones.find((zz) => zz.id === valid[0])!;
    return { zoneId: z.id, text: `zona ${z.name}` };
  }
  return { zoneId: null, text: 'global' };
}

/**
 * Valor efectivo guardado de un parámetro (como lo resuelve el motor): el override de la zona si el parámetro es por
 * zona y lo hay, si no el global guardado, si no el de fábrica. Valores de otro tipo se ignoran.
 */
export function storedParamValue(params: ParamState, storage: string, spec: ParamSpec, zoneId: string | null): ParamValue {
  const ok = (v: unknown): v is ParamValue =>
    spec.type === 'number' ? typeof v === 'number' && Number.isFinite(v) : spec.type === 'boolean' ? typeof v === 'boolean' : typeof v === 'string';
  const zoned = zoneId && paramScope(spec) === 'zone' ? params.zones[zoneId]?.[storage] : undefined;
  if (ok(zoned)) return zoned;
  const g = params.global[storage];
  return ok(g) ? g : spec.default;
}

/** Valor efectivo numérico de un `PlotParam` en el alcance. */
export function plotParamValue(params: ParamState, p: PlotParam, zoneId: string | null): number {
  return storedParamValue(params, p.storage, p.spec, zoneId) as number;
}

/**
 * Valor acotado al rango del parámetro y redondeado a su paso, igual que el slider del inspector
 * (`positionToValue` de `src/ui/scale.ts`): lineal con el paso contado desde `min`; log con el paso desde 0. NaN si
 * el valor no es finito (el arrastre se ignora).
 */
export function normalizeParam(spec: NumberParamSpec, v: number): number {
  if (!Number.isFinite(v)) return NaN;
  const c = clamp(v, spec.min, spec.max);
  if (!spec.step) return c;
  const snapped = spec.scale === 'log' ? snapToStep(c, spec.step) : snapToStep(c, spec.step, spec.min);
  return clamp(snapped, spec.min, spec.max);
}

/** Un paso de teclado (flechas; Mayús = paso largo), igual que el slider. */
export function nudgeParam(spec: NumberParamSpec, v: number, direction: 1 | -1, big = false): number {
  return stepValue(v, direction, { min: spec.min, max: spec.max, ...(spec.step ? { step: spec.step } : {}), ...(spec.scale ? { scale: spec.scale } : {}) }, big);
}

/** Una escritura de parámetro que resulta de un arrastre. */
export interface ParamWrite {
  storage: string;
  value: number;
  zoneId: string | null;
}

export const paramWrite = (p: PlotParam, value: number, scope: PlotScope): ParamWrite => ({
  storage: p.storage,
  value,
  zoneId: paramScope(p.spec) === 'zone' ? scope.zoneId : null,
});

/** Etiqueta de deshacer: la MISMA que el slider del inspector («Cambiar Rw»), así se agrupan igual. */
export const paramChangeLabel = (p: PlotParam): string => `Cambiar ${p.spec.label}`;

// ── fuente activa ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Si el módulo que usa el parámetro NO es la fuente activa de su puerto, mover el elemento no cambiaría el resultado:
 * se avisa y se ofrece usarlo. Devuelve null si alimenta la cadena (o si todavía no hay resultado: no se avisa en
 * falso), o la fuente activa (null = ninguna) si no.
 */
export function inactiveDriver(sources: Readonly<Record<string, SourceRef>> | null, port: string, moduleId: string): { active: SourceRef | null } | null {
  if (!sources) return null;
  const s = sources[port];
  if (s && s.kind === 'module' && s.moduleId === moduleId) return null;
  return { active: s ?? null };
}

// ── GR limpio y GR de arcilla ───────────────────────────────────────────────────────────────────────────────────

/**
 * Valor de GR limpio o GR de arcilla movido: rango y paso del parámetro, y además el limpio queda al menos un paso por
 * debajo del de arcilla (si se cruzaran, el índice de arcilla se daría vuelta).
 */
export function normalizeGr(which: 'grClean' | 'grShale', v: number, other: number): number {
  const p = PLOT_PARAMS[which];
  const step = p.spec.step ?? 0.5;
  const n = normalizeParam(p.spec, v);
  if (!Number.isFinite(n)) return NaN;
  return which === 'grClean' ? Math.min(n, normalizeParam(p.spec, other - step)) : Math.max(n, normalizeParam(p.spec, other + step));
}

/** Id de la guía de un parámetro (`param:grClean`) y su inversa. */
export const paramGuideId = (key: keyof typeof PLOT_PARAMS): string => `param:${key}`;
export const paramOfGuide = (id: string): keyof typeof PLOT_PARAMS | null => {
  const k = id.startsWith('param:') ? id.slice(6) : '';
  return k in PLOT_PARAMS ? (k as keyof typeof PLOT_PARAMS) : null;
};

/** Valor con la unidad del parámetro, formateado según su paso («30,0 gAPI», «0,045 ohm·m»). */
export function formatParam(p: PlotParam, v: number): string {
  const u = p.spec.unit && p.spec.unit !== 'unitless' ? ` ${unitLabel(p.spec.unit)}` : '';
  return `${formatParamValue(v, p.spec)}${u}`;
}

/**
 * Guías verticales de GR limpio y GR de arcilla (histograma de GR, crossplot GR–Rt), con el valor y el alcance en el
 * rótulo («GR limpio global · 30,0 gAPI»). `colors` del tema (arena y arcilla).
 */
export function grGuides(params: ParamState, scope: PlotScope, colors: { clean: string; shale: string }, draggable: boolean, axis: 'x' | 'y' = 'x'): XYGuide[] {
  return (['grClean', 'grShale'] as const).map((k) => {
    const p = PLOT_PARAMS[k];
    const v = plotParamValue(params, p, scope.zoneId);
    return {
      id: paramGuideId(k),
      axis,
      value: v,
      color: k === 'grClean' ? colors.clean : colors.shale,
      width: 1.75,
      dash: draggable ? [] : [3, 3],
      label: `${p.short} ${scope.text} · ${formatParam(p, v)}`,
      removable: false,
      ...(draggable ? { draggable: true, step: p.spec.step ?? 0.5 } : {}),
    };
  });
}

/** GR limpio o de arcilla movido (arrastre o flechas) → escritura en el alcance, o null si el valor no sirve. */
export function grWrite(which: 'grClean' | 'grShale', value: number, params: ParamState, scope: PlotScope): ParamWrite | null {
  const other = plotParamValue(params, PLOT_PARAMS[which === 'grClean' ? 'grShale' : 'grClean'], scope.zoneId);
  const v = normalizeGr(which, value, other);
  return Number.isFinite(v) ? paramWrite(PLOT_PARAMS[which], v, scope) : null;
}
