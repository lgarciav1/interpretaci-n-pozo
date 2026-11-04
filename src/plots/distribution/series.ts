/**
 * Series de las distribuciones por zona (docs/decisiones/0066): de un contexto de series (pozo según la sarta,
 * interpretación y calculadas de un resultado del motor) a los datos que pide el motor de distribuciones. Puro.
 */
import { sampleThickness, type Well } from '../../core/well';
import { plotCurveOptions, resolvePlotCurve, type CurveOption } from '../data';
import type { SeriesContext } from '../trend/series';
import type { SeriesData, SeriesKind } from './distribution';

/** Propiedades de interpretación, en el orden en que se ofrecen primero. */
export const INTERPRETATION_ROLES = ['PHIE', 'SW', 'VSH', 'BVW', 'PERM'] as const;

/** Grupo del selector con las propiedades de interpretación. */
export const INTERPRETATION_GROUP = 'Interpretación';

/**
 * Opciones del selector de propiedad: las mismas curvas que el histograma (medidas y calculadas, sin banderas), con
 * φe, Sw, Vsh, BVW y k primero (en ese orden) en su propio grupo.
 */
export function propertyOptions(ctx: SeriesContext): CurveOption[] {
  const all = plotCurveOptions(ctx);
  const first: CurveOption[] = [];
  for (const role of INTERPRETATION_ROLES) {
    const o = all.find((x) => x.value === `r:${role}`);
    if (o) first.push({ ...o, group: INTERPRETATION_GROUP });
  }
  const taken = new Set(first.map((o) => o.value));
  return [...first, ...all.filter((o) => !taken.has(o.value)).map((o) => (o.group === INTERPRETATION_GROUP ? { ...o, group: 'Fuentes de interpretación' } : o))];
}

/** Propiedad por defecto: φe si está, si no la primera curva. */
export function defaultProperty(options: readonly CurveOption[]): string | null {
  return options.find((o) => o.value === 'r:PHIE')?.value ?? options[0]?.value ?? null;
}

/** Datos de un puerto calculado activo (banderas del motor), si tiene el largo del pozo. */
function activeData(ctx: SeriesContext, port: string): Float64Array | undefined {
  const c = ctx.computed.find((x) => x.active && x.port === port);
  return c && c.data.length === ctx.well.depth.values.length ? c.data : undefined;
}

const thicknessCache = new WeakMap<object, Float64Array>();
/** Espesor por muestra (el mismo que usa el motor: `sampleThickness`), memorizado por índice de profundidad. */
export function thicknessOf(well: Pick<Well, 'depth'>): Float64Array {
  const d = well.depth.values;
  let t = thicknessCache.get(d);
  if (!t) thicknessCache.set(d, (t = sampleThickness(d)));
  return t;
}

/**
 * Clave de la misma propiedad en otro pozo: `r:<ROL>` vale igual; una medida `m:<id>` se busca por rol y, si no tiene,
 * por mnemónico. null si el otro pozo no la tiene.
 */
export function translateKey(from: Pick<SeriesContext, 'well'>, key: string, to: Pick<SeriesContext, 'well'>): string | null {
  if (!key.startsWith('m:')) return key;
  const c = from.well.curves.find((x) => x.id === key.slice(2));
  if (!c) return null;
  if (to.well.curves.some((x) => x.id === c.id && x.mnemonic === c.mnemonic)) return key;
  const match = (c.role && to.well.curves.find((x) => x.role === c.role)) || to.well.curves.find((x) => x.mnemonic.toUpperCase() === c.mnemonic.toUpperCase());
  return match ? `m:${match.id}` : null;
}

/** Serie lista para el motor de distribuciones a partir de un contexto y la clave de la propiedad. */
export function seriesFromContext(ctx: SeriesContext, key: string | null, meta: { id: string; label: string; kind: SeriesKind }): SeriesData {
  const values = key ? (resolvePlotCurve(ctx, key)?.data ?? null) : null;
  const phi = resolvePlotCurve(ctx, 'r:PHIE')?.data;
  const netRes = activeData(ctx, 'NET_RES');
  const netPay = activeData(ctx, 'NET_PAY');
  const washout = activeData(ctx, 'IND_WASHOUT');
  return {
    ...meta,
    depth: ctx.well.depth.values,
    zones: ctx.interpretation.zones,
    values,
    thickness: thicknessOf(ctx.well),
    ...(netRes ? { netRes } : {}),
    ...(netPay ? { netPay } : {}),
    ...(washout ? { washout } : {}),
    ...(phi ? { phi } : {}),
  };
}

/** true si la interpretación no tiene ningún parámetro elegido (todo por defecto). */
export function usesOnlyDefaults(params: { global: Record<string, unknown>; zones: Record<string, Record<string, unknown>> }): boolean {
  return Object.keys(params.global).length === 0 && Object.values(params.zones).every((z) => Object.keys(z).length === 0);
}
