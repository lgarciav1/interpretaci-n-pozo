/**
 * Arma el pedido de una figura del perfil (`ViewerFigureInput`) a partir de lo que el usuario eligió en «Exportar» y de
 * lo que la app tiene del pozo. Puro (sin stores): la app le pasa los valores. docs/decisiones/0012-exportacion-de-figuras.md.
 */
import { cmToPx, formatScale, pxPerMeterForScale, scaleDenominatorFor } from '../io/export/figures/sizing';
import { creditsLine, type FigureTemplate } from '../io/export/figures/templates';
import type { TextMeasure } from '../io/export/figures/svg';
import type { ExportSummary } from '../io/export/types';
import type { Well } from '../core/well';
import { formatNumber } from '../ui/format';
import { layoutViewerFigure, type ViewerFigureInput, type ViewerFigureLayout } from './figure';
import type { ViewerLook } from './look';
import type { ViewerData, ViewerOverlay, ViewerZone } from './overlay';
import type { ResolvedTrack } from './resolve';
import { wellHeaderFields } from './wellHeader';

/** Qué tramo se exporta. */
export type FigureRange = { kind: 'well' } | { kind: 'visible'; top: number; base: number } | { kind: 'zone'; zoneId: string };

export interface ViewerFigureRequest {
  template: FigureTemplate;
  range: FigureRange;
  /** Escala vertical 1:N elegida. */
  verticalScale: number;
  /** Ancho de la figura en cm (con márgenes). */
  widthCm: number;
  marginCm: number;
  /** Ids de pista a incluir (la de profundidad siempre va); null = todas. */
  trackIds: readonly string[] | null;
  /** Título; vacío = el de la plantilla. */
  title?: string;
}

export interface ViewerFigureContext {
  well: Pick<Well, 'name' | 'header'>;
  /** Todas las pistas resueltas del espacio de trabajo activo. */
  tracks: readonly ResolvedTrack[];
  depth: Float64Array;
  data: ViewerData;
  overlays: readonly ViewerOverlay[];
  zones: readonly ViewerZone[];
  summary: ExportSummary | null;
  stackHints?: Readonly<Record<string, string>>;
  date: Date;
  measure: TextMeasure;
  /** Estilo del visor (el de la pantalla); ausente = «Moderno». */
  look?: ViewerLook;
}

/** Tramo en metros: el pedido recortado al pozo. Lanza (en español) si no hay nada que dibujar. */
export function resolveRange(range: FigureRange, depth: ArrayLike<number>, zones: readonly ViewerZone[]): { top: number; base: number } {
  if (depth.length < 2) throw new Error('El pozo no tiene muestras para dibujar.');
  const lo = depth[0]!;
  const hi = depth[depth.length - 1]!;
  let top = lo;
  let base = hi;
  if (range.kind === 'visible') {
    top = range.top;
    base = range.base;
  } else if (range.kind === 'zone') {
    const z = zones.find((x) => x.id === range.zoneId);
    if (!z) throw new Error('La zona elegida ya no existe.');
    top = z.top;
    base = z.base;
  }
  top = Math.max(lo, top);
  base = Math.min(hi, base);
  if (!(base - top > 0)) throw new Error('El tramo elegido no tiene profundidad para dibujar.');
  return { top, base };
}

/** Pista sin nada que dibujar: sin curvas (ni capas de pila) y que no es la de profundidad ni una pista propia. */
export const isEmptyTrack = (t: ResolvedTrack): boolean => (t.kind === 'curves' || t.kind === 'flags') && t.curves.length === 0 ? true : t.kind === 'stack' && !!t.stack?.empty;

/** Pistas de la figura: las elegidas (la de profundidad siempre va) o, sin elección, todas las que tienen algo que mostrar. */
export function selectTracks(tracks: readonly ResolvedTrack[], ids: readonly string[] | null): ResolvedTrack[] {
  if (!ids) return tracks.filter((t) => !isEmptyTrack(t));
  const keep = new Set(ids);
  return tracks.filter((t) => t.kind === 'depth' || keep.has(t.id));
}

const range1 = (r: { top: number; base: number }) => `${formatNumber(r.top, { digits: 0, grouping: false })}–${formatNumber(r.base, { digits: 0, grouping: false })} m`;

/** Pedido completo de la figura del perfil. `pxPerM` y `tracksWidth` se pueden forzar (el PDF los ajusta a la página). */
export function buildViewerFigure(req: ViewerFigureRequest, ctx: ViewerFigureContext, override: { pxPerM?: number; tracksWidth?: number; margin?: number; parts?: Partial<ViewerFigureInput['parts']> } = {}): ViewerFigureInput {
  const range = resolveRange(req.range, ctx.depth, ctx.zones);
  const tracks = selectTracks(ctx.tracks, req.trackIds);
  if (!tracks.some((t) => t.kind !== 'depth')) throw new Error('Elegí al menos una pista para la figura.');
  const margin = override.margin ?? Math.round(cmToPx(req.marginCm));
  const pxPerM = override.pxPerM ?? pxPerMeterForScale(req.verticalScale);
  const tracksWidth = override.tracksWidth ?? Math.max(1, Math.round(cmToPx(req.widthCm)) - 2 * margin);
  const where = req.range.kind === 'zone' ? `Zona ${ctx.zones.find((z) => z.id === (req.range as { zoneId: string }).zoneId)?.name ?? ''} · ` : '';
  return {
    tracks,
    depth: ctx.depth,
    data: { ...ctx.data, selectedZoneId: null },
    overlays: ctx.overlays,
    range,
    pxPerM,
    tracksWidth,
    margin,
    parts: { ...req.template.parts, ...override.parts },
    title: req.title?.trim() || `Registros del pozo ${ctx.well.name.trim().replace(/^pozo\s+/i, '')}`,
    subtitle: `${where}${range1(range)} · escala vertical ${formatScale(Math.round(scaleDenominatorFor(pxPerM)))}`,
    wellFields: wellHeaderFields(ctx.well).primary.slice(0, 9).map((f) => ({ label: f.label, value: f.value })),
    zones: ctx.zones,
    summary: ctx.summary,
    credits: creditsLine(ctx.well.name, ctx.date),
    scaleText: `Escala vertical ${formatScale(Math.round(scaleDenominatorFor(pxPerM)))}`,
    ...(ctx.stackHints ? { stackHints: ctx.stackHints } : {}),
    measure: ctx.measure,
    ...(ctx.look ? { look: ctx.look } : {}),
  };
}

/**
 * Ajusta el perfil a una caja de `heightPx` px CSS (la zona útil de la página de un PDF). Si la figura entera no entra, se
 * achica la escala vertical hasta que entre; si no, se deja como está. `zoom` (< 1) es lo que después se achica TODA la figura
 * para que entre a lo ancho: la escala que queda impresa es `pxPerM · zoom`, y es la que dicen el subtítulo y el pie.
 * Lanza (en español) si ni el marco (encabezados, tabla) entra en ese alto.
 */
export function fitViewerFigure(input: ViewerFigureInput, heightPx: number, zoom = 1): { input: ViewerFigureInput; layout: ViewerFigureLayout } {
  const first = layoutViewerFigure(input);
  const fixed = first.height - first.bodyHeight;
  const length = input.range.base - input.range.top;
  const room = heightPx - fixed - 2;
  if (!(room > 20)) throw new Error('La página no tiene lugar para el perfil con los encabezados y la tabla elegidos: probá con horizontal o sin sumario.');
  const tooTall = first.height > heightPx;
  if (!tooTall && zoom >= 1) return { input, layout: first };
  const pxPerM = tooTall ? room / length : input.pxPerM;
  const scale = formatScale(Math.round(scaleDenominatorFor(pxPerM * zoom)));
  const fitted: ViewerFigureInput = {
    ...input,
    pxPerM,
    subtitle: input.subtitle?.replace(/escala vertical 1:[\d.]+/, `escala vertical ${scale} (ajustada a la página)`),
    scaleText: `Escala vertical ${scale}`,
  };
  return { input: fitted, layout: layoutViewerFigure(fitted) };
}
