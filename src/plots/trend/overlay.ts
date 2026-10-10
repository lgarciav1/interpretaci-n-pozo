/**
 * Tendencias sobre el visor (docs/decisiones/0008-tendencias-y-gradientes.md, D6). Contrato `ViewerOverlay`, sin
 * stores: lee las tendencias de `frame.data.interpretation` y recibe por `opts` cómo resolver series, el modo de
 * edición y cómo guardar (lo compone `src/app/shell/ViewerSlot.tsx`, como las zonas).
 *
 * - Dibujo: cada tendencia visible en la pista de su curva (banda suave del tramo debajo de las curvas; línea con
 *   halo, extensión punteada, manijas y etiqueta con ecuación, R² y gradiente encima).
 * - Herramienta «elegir tramo» / «dibujar a mano» (`edit.tool()`): `hit` devuelve un arrastre en cualquier punto de
 *   una pista con curvas; ajuste y ecuación en vivo; al soltar, UN solo guardado. Escape cancela el arrastre.
 * - Manijas (tope y base del tramo; los dos puntos a mano): arrastre, ↑/↓ (`nudge`) y teclado (`targets`).
 * - Con una tendencia seleccionada, clic sobre una muestra del tramo la excluye o la vuelve a incluir.
 * - Tooltip con ecuación, R², n y gradientes; clic selecciona; doble clic muestra el tramo.
 */
import type { TrendPatch } from '../../core/state/trends';
import { conversionCoefficients, isKnownUnit, sameDimension } from '../../core/units';
import type { SeriesRef, TrendPoint, TrendSelection, TrendSpec } from '../../core/trends';
import { evalTrend, type TrendModel } from '../../petro/regression';
import { ensureContrast, withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { BASE_TOKENS, type ThemeName, type ThemeTokens } from '../../ui/tokens';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayPointer, OverlayTarget, OverlayTrack, ViewerData, ViewerOverlay } from '../../viewer/overlay';
import { evaluateTrend, excludedIndices, type TrendPreview, type TrendResult } from './compute';
import { distanceToPolylines, drawTrend, drawTrendLabel, trendGeometry, type TrendGeometry, type TrendMapping } from './draw';
import { trendCanvasLabel, trendGradientLabel, trendTooltip } from './format';
import { CURVE_PROVIDER_ID, curveSeriesKey, lowerBound, upperBound, type ResolvedSeries } from './series';

export const TRENDS_OVERLAY_ID = 'trends';
export const TRENDS_BANDS_ID = 'trends-bands';
/**
 * `hit` sobre las líneas (seleccionar, tooltip), con MENOS prioridad que los elementos de otras superposiciones
 * (puntos MDT, plugs): un punto sobre su gradiente responde al punto, no a la línea.
 */
export const TRENDS_LINES_ID = 'trends-lines';
/** Distancia (px) para agarrar una manija, tocar la línea o una muestra. */
export const HANDLE_HIT_PX = 8;
export const LINE_HIT_PX = 5;
export const SAMPLE_HIT_PX = 6;

/** Paleta de tendencias: colores que se distinguen de las curvas clásicas (claro y oscuro). */
export const TREND_PALETTE: Readonly<Record<ThemeName, readonly string[]>> = {
  light: ['#e8590c', '#0f766e', '#c026d3', '#1d4ed8', '#a16207', '#be123c', '#4d7c0f', '#7c3aed'],
  dark: ['#ff8a3d', '#2dd4bf', '#f472b6', '#7aa2ff', '#facc15', '#fb7185', '#a3e635', '#c4a5ff'],
};

/** Color de una tendencia: el propio o el de la paleta por orden, con contraste ≥ 3:1 contra el fondo de pista. */
export function trendColor(spec: Pick<TrendSpec, 'color'>, index: number, theme: ThemeTokens): string {
  const list = TREND_PALETTE[theme.name];
  const base = spec.color ?? list[((index % list.length) + list.length) % list.length]!;
  return ensureContrast(base, theme.viewer.trackBg, 3);
}

/** Herramienta activa del visor. */
export interface TrendTool {
  /** 'fit' = elegir el tramo del ajuste; 'manual' = dibujar a mano de un punto a otro. */
  kind: 'fit' | 'manual';
  /** Tendencia existente a la que se le cambia el tramo o se vuelve a dibujar (si falta, se crea una nueva). */
  trendId?: string;
  /** Modelo para una tendencia nueva (por defecto lineal). */
  model?: TrendModel;
  /**
   * Tendencia nueva sobre ESTA serie en vez de la curva más cercana al puntero (p. ej. «Nuevo gradiente» del panel
   * MDT, sobre la serie de presiones): el arrastre vale en cualquier pista; `name` y `color` van a la tendencia.
   */
  series?: { ref: SeriesRef; label: string; name?: string; color?: string; hint?: string; extend?: boolean };
}

export interface NewTrendInput {
  series: SeriesRef;
  seriesLabel: string;
  /** Nombre y color propios (si faltan, la app los elige). */
  name?: string;
  color?: string;
  /** false: no abrir el panel «Tendencias» (la creó otro panel que ya muestra el resultado, p. ej. MDT). */
  openPanel?: boolean;
  /** Dibujar la extensión (por defecto, solo a mano). Gradientes MDT: sí, para ver dónde se cortan. */
  extend?: boolean;
  mode: 'fit' | 'manual';
  model: TrendModel;
  selection: TrendSelection;
  manual?: [TrendPoint, TrendPoint];
}

export interface TrendsEditOptions {
  /**
   * Tendencias ACTUALES del pozo activo (del store): las ediciones (↑/↓, arrastres) parten del estado al día aunque
   * el visor todavía no haya redibujado. Sin esto se usan las del último cuadro.
   */
  trends?(): readonly TrendSpec[];
  tool(): TrendTool | null;
  /** Otra herramienta del visor tiene el puntero (p. ej. «marcar zona»): las tendencias no responden. */
  blocked?(): boolean;
  selected(): string | null;
  select(id: string | null): void;
  /** Guarda una tendencia nueva (la app pone id, nombre y color) y la selecciona. */
  create(input: NewTrendInput): void;
  /** Guarda un cambio de una tendencia (por `commit`, con esa etiqueta). */
  update(id: string, patch: TrendPatch, label: string): void;
  /** Excluye o vuelve a incluir un punto. */
  togglePoint(id: string, key: string, exclude: boolean): void;
  /** Terminó la herramienta (se soltó el arrastre). */
  finishTool(): void;
  /** No se pudo guardar (mensaje en español). */
  error?(message: string): void;
}

export interface TrendsOverlayOptions {
  /** Serie de una tendencia con los datos del visor (null si ya no existe). */
  resolve(data: ViewerData, ref: SeriesRef): ResolvedSeries | null;
  edit?: TrendsEditOptions;
  /** Estado propio (herramienta, selección): avisa cuándo redibujar. */
  subscribe?(invalidate: () => void): () => void;
}

/** Tendencia ubicada en el visor para este cuadro. */
interface Placed {
  spec: TrendSpec;
  index: number;
  series: ResolvedSeries;
  track: OverlayTrack;
  key: string | null;
  result: TrendResult;
  mapping: TrendMapping;
  geom: TrendGeometry | null;
  /** Manijas en datos (x = profundidad) y su clave. */
  handles: { key: string; x: number; y: number; edge: 'top' | 'base' | 'p0' | 'p1' }[];
  color: string;
}

const m1 = (d: number) => `${formatNumber(d, { digits: 1 })} m`;

/** Manija más cercana al puntero (a menos de HANDLE_HIT_PX; la de la seleccionada gana los empates). */
function nearestHandle(placed: readonly Placed[], p: OverlayPointer, selected: string | null): { pl: Placed; i: number } | null {
  let best: { pl: Placed; i: number; d: number } | null = null;
  for (const pl of placed) {
    pl.geom?.handles.forEach((h, i) => {
      if (!h) return;
      const d = Math.hypot(h[0] - p.x, h[1] - p.y) - (pl.spec.id === selected ? 1.5 : 0);
      if (d <= HANDLE_HIT_PX && (!best || d < best.d)) best = { pl, i, d };
    });
  }
  return best;
}

/** Vistas de pista que convierten de la unidad de la serie a la de la pista (caché por pista y unidades). */
const convertedTracks = new WeakMap<OverlayTrack, Map<string, OverlayTrack>>();

/**
 * Pista propia en otra unidad que la serie (presiones en psi en una pista en bar): una vista de la pista cuyos
 * `xOf`/`valueOf` reciben y devuelven valores en la unidad de la SERIE. Sin conversión posible, la misma pista.
 */
function inSeriesUnit(t: OverlayTrack, seriesUnit: string): OverlayTrack {
  const tu = t.unit;
  if (!tu || tu === seriesUnit || !isKnownUnit(tu) || !isKnownUnit(seriesUnit) || !sameDimension(tu, seriesUnit)) return t;
  let byUnit = convertedTracks.get(t);
  if (!byUnit) convertedTracks.set(t, (byUnit = new Map()));
  let v = byUnit.get(seriesUnit);
  if (!v) {
    const [a, b] = conversionCoefficients(seriesUnit, tu);
    v = {
      ...t,
      xOf: (k, value) => t.xOf(k, value * a + b),
      valueOf: (k, x) => {
        const r = t.valueOf(k, x);
        return r === null ? null : (r - b) / a;
      },
    };
    byUnit.set(seriesUnit, v);
  }
  return v;
}

/** Pista de una serie según su `placement`. */
function findTrack(tracks: readonly OverlayTrack[], s: ResolvedSeries): { track: OverlayTrack; key: string | null } | null {
  const pl = s.placement;
  if (!pl) return null;
  if ('overlayId' in pl) {
    const t = tracks.find((tr) => tr.overlayId === pl.overlayId);
    return t ? { track: inSeriesUnit(t, s.yUnit), key: null } : null;
  }
  const k = pl.roleOrKey;
  const t =
    tracks.find((tr) => tr.kind === 'curves' && tr.curves.some((c) => c.key === k)) ??
    tracks.find((tr) => tr.kind === 'curves' && tr.curves.some((c) => c.role === k && !c.alternative && c.origin === 'computed')) ??
    tracks.find((tr) => tr.kind === 'curves' && tr.curves.some((c) => c.role === k && !c.alternative));
  return t ? { track: t, key: k } : null;
}

function trackMapping(frame: OverlayHitFrame, t: OverlayTrack, key: string | null): TrendMapping {
  return {
    x: (d) => frame.viewport.yOf(d),
    y: (v) => {
      const r = t.xOf(key, v);
      return r === null ? NaN : t.x + r;
    },
    transpose: true,
  };
}

/** Curva de línea de la pista más cercana al puntero a esa profundidad (para crear una tendencia nueva). */
function nearestCurve(frame: OverlayHitFrame, p: OverlayPointer): { ref: SeriesRef; label: string } | null {
  const t = p.track;
  if (!t || t.kind !== 'curves') return null;
  const depth = frame.data.depth;
  const i = Math.min(depth.length - 1, Math.max(0, lowerBound(depth, p.depth)));
  let best: { ref: SeriesRef; label: string; d: number } | null = null;
  for (const c of t.curves) {
    if (c.kind !== 'line' || c.alternative) continue;
    const key = curveSeriesKey(c);
    if (!key) continue;
    const v = c.data[i]!;
    const x = Number.isFinite(v) ? t.xOf(c.key, v) : null;
    const d = x === null ? 1e6 : Math.abs(t.x + x - p.x);
    if (!best || d < best.d) best = { ref: { provider: CURVE_PROVIDER_ID, key }, label: c.name, d };
  }
  return best ? { ref: best.ref, label: best.label } : null;
}

export function createTrendsOverlays(opts: TrendsOverlayOptions): ViewerOverlay[] {
  const edit = opts.edit;
  /** Vista previa de un arrastre: la tendencia (nueva o existente) con su cambio. */
  type Preview = { id: string | null; spec: TrendSpec; series: ResolvedSeries; change: TrendPreview };
  let preview = null as Preview | null;
  /** Versión de la vista previa (invalida la caché de `layout`). */
  let previewSeq = 0;
  const setPreview = (p: Preview | null) => {
    preview = p;
    previewSeq++;
  };
  let frameRef: OverlayHitFrame | null = null;
  const invalidate = () => frameRef?.invalidate();

  const zonesOf = (data: ViewerData) => data.interpretation.zones ?? [];

  /** Ubica una tendencia (con su vista previa si corresponde). */
  const place = (frame: OverlayHitFrame, spec: TrendSpec, index: number, series: ResolvedSeries, change?: TrendPreview): Placed | null => {
    if (!series.xIsDepth) return null;
    const where = findTrack(frame.tracks, series);
    if (!where) return null;
    const result = evaluateTrend(spec, series, zonesOf(frame.data), change);
    const mapping = trackMapping(frame, where.track, where.key);
    const vp = frame.viewport;
    const pad = 24 / Math.max(vp.pxPerM, 1e-9);
    const handles: Placed['handles'] = [];
    let geom: TrendGeometry | null = null;
    if (result.coeffs && result.span) {
      const c = result.coeffs;
      const manual = change?.manual ?? spec.manual;
      if (spec.mode === 'manual' && manual) {
        handles.push({ key: `${spec.id}:p0`, edge: 'p0', ...manual[0] }, { key: `${spec.id}:p1`, edge: 'p1', ...manual[1] });
      } else {
        const ev = (x: number) => evalTrend(c, x);
        handles.push({ key: `${spec.id}:top`, edge: 'top', x: result.span[0], y: ev(result.span[0]) }, { key: `${spec.id}:base`, edge: 'base', x: result.span[1], y: ev(result.span[1]) });
      }
      geom = trendGeometry({
        coeffs: c,
        span: result.span,
        visible: [vp.top - pad, vp.base + pad],
        extend: spec.extend,
        mapping,
        handles,
      });
      // Manijas siempre agarrables: dentro de la caja de la pista aunque el valor quede fuera de escala.
      geom.handles = geom.handles.map((h) => (h ? [Math.max(where.track.x + 4, Math.min(where.track.x + where.track.width - 4, h[0])), h[1]] : h));
    }
    return { spec, index, series, track: where.track, key: where.key, result, mapping, geom, handles, color: trendColor(spec, index, frame.theme) };
  };

  /**
   * Todas las tendencias visibles del pozo activo, ubicadas (la que se arrastra, con su vista previa). Las dos capas
   * de un mismo cuadro comparten `frame.tracks`: el ajuste y el muestreo se hacen una vez por cuadro.
   */
  let layoutCache: { tracks: readonly OverlayTrack[]; data: ViewerData; theme: ThemeTokens; seq: number; out: Placed[] } | null = null;
  const layout = (frame: OverlayHitFrame): Placed[] => {
    const c = layoutCache;
    if (c && c.tracks === frame.tracks && c.data === frame.data && c.theme === frame.theme && c.seq === previewSeq) return c.out;
    const out = computeLayout(frame);
    layoutCache = { tracks: frame.tracks, data: frame.data, theme: frame.theme, seq: previewSeq, out };
    return out;
  };
  const computeLayout = (frame: OverlayHitFrame): Placed[] => {
    const trends = frame.data.interpretation.trends ?? [];
    const out: Placed[] = [];
    trends.forEach((spec, index) => {
      if (!spec.visible && preview?.id !== spec.id) return;
      if (preview && preview.id === spec.id) {
        const pl = place(frame, spec, index, preview.series, preview.change);
        if (pl) out.push(pl);
        return;
      }
      const series = opts.resolve(frame.data, spec.series);
      if (!series) return;
      const pl = place(frame, spec, index, series);
      if (pl) out.push(pl);
    });
    if (preview && preview.id === null) {
      const pl = place(frame, preview.spec, trends.length, preview.series, preview.change);
      if (pl) out.push(pl);
    }
    return out;
  };

  const specById = (frame: OverlayHitFrame, id: string) => (edit?.trends?.() ?? frame.data.interpretation.trends ?? []).find((t) => t.id === id) ?? null;

  // ── herramientas: elegir tramo y dibujar a mano ──────────────────────────────────────────────────────────────

  const toolHit = (frame: OverlayHitFrame, p: OverlayPointer, tool: TrendTool): OverlayHit | null => {
    const existing = tool.trendId ? specById(frame, tool.trendId) : null;
    if (tool.trendId && !existing) return null; // la tendencia ya no existe (deshacer)
    let series: ResolvedSeries | null = null;
    let seriesLabel = '';
    let base: TrendSpec;
    if (existing) {
      series = opts.resolve(frame.data, existing.series);
      if (!series) return null;
      seriesLabel = series.label;
      base = existing;
    } else {
      const near = tool.series ?? nearestCurve(frame, p);
      if (!near) return null;
      series = opts.resolve(frame.data, near.ref);
      if (!series) return null;
      seriesLabel = near.label;
      base = {
        id: '__nueva__',
        name: tool.series?.name ?? near.label,
        ...(tool.series?.color ? { color: tool.series.color } : {}),
        visible: true,
        series: near.ref,
        model: tool.model ?? 'linear',
        mode: tool.kind,
        selection: { excluded: [] },
        extend: tool.kind === 'manual',
      };
    }
    const s = series;
    const where = findTrack(frame.tracks, s);
    if (!where) return null;
    const t = where.track;
    const valueAt = (q: OverlayPointer) => t.valueOf(where.key, q.x - t.x);
    const manualMode = tool.kind === 'manual';
    const what = manualMode ? `Arrastrá de un punto a otro para dibujar la tendencia sobre ${seriesLabel}` : `Arrastrá para elegir el tramo del ajuste sobre ${seriesLabel}`;
    let pending: { change: TrendPreview; spec: TrendSpec } | null = null;
    const build = (q: OverlayPointer, start: OverlayPointer) => {
      if (!Number.isFinite(q.depth) || !Number.isFinite(start.depth)) return null;
      const top = Math.min(start.depth, q.depth);
      const bottom = Math.max(start.depth, q.depth);
      const { zoneId: _z, ...sel } = base.selection;
      const selection: TrendSelection = { ...sel, top, base: bottom };
      if (manualMode) {
        const y0 = valueAt(start);
        const y1 = valueAt(q);
        if (y0 === null || y1 === null) return null;
        const manual: [TrendPoint, TrendPoint] = [
          { x: start.depth, y: y0 },
          { x: q.depth, y: y1 },
        ];
        const spec: TrendSpec = { ...base, mode: 'manual', manual, selection };
        return { spec, change: { selection, manual } };
      }
      return { spec: { ...base, mode: 'fit' as const, selection }, change: { selection } };
    };
    return {
      label: what,
      cursor: 'crosshair',
      drag: {
        cursor: 'crosshair',
        move(q, start) {
          const b = build(q, start);
          if (!b) return;
          pending = b;
          setPreview({ id: existing?.id ?? null, spec: b.spec, series: s, change: b.change });
          invalidate();
        },
        end(q, start) {
          const b = build(q, start) ?? pending;
          setPreview(null);
          pending = null;
          invalidate();
          if (!b || !edit) return;
          const r = evaluateTrend(b.spec, s, zonesOf(frame.data), b.change);
          if (!r.coeffs) {
            edit.error?.(r.problem ?? 'No se pudo ajustar una tendencia en ese tramo.');
            return;
          }
          if (existing) {
            const patch: TrendPatch = manualMode ? { mode: 'manual', manual: b.change.manual!, selection: b.change.selection! } : { mode: 'fit', manual: undefined, selection: b.change.selection! };
            edit.update(existing.id, patch, manualMode ? 'Dibujar la tendencia a mano' : 'Mover tramo de la tendencia');
          } else {
            edit.create({
              series: base.series,
              seriesLabel,
              mode: manualMode ? 'manual' : 'fit',
              model: base.model,
              selection: b.change.selection!,
              ...(manualMode ? { manual: b.change.manual! } : {}),
              ...(tool.series?.name ? { name: tool.series.name } : {}),
              ...(tool.series?.color ? { color: tool.series.color } : {}),
              ...(tool.series ? { openPanel: false } : {}),
              ...(tool.series?.extend !== undefined ? { extend: tool.series.extend } : {}),
            });
          }
          edit.finishTool();
        },
        cancel() {
          setPreview(null);
          pending = null;
          invalidate();
        },
      },
    };
  };

  // ── manijas ─────────────────────────────────────────────────────────────────────────────────────────────────

  const handleLabel = (spec: TrendSpec, edge: Placed['handles'][number]['edge'], x: number) =>
    `${edge === 'top' ? 'Tope del tramo' : edge === 'base' ? 'Base del tramo' : edge === 'p0' ? 'Primer punto' : 'Segundo punto'} de «${spec.name}» · ${m1(x)}`;

  const handleHit = (pl: Placed, h: Placed['handles'][number]): OverlayHit & { key: string } => {
    const id = pl.spec.id;
    const isManual = h.edge === 'p0' || h.edge === 'p1';
    const t = pl.track;
    const changeFor = (spec: TrendSpec, x: number, y: number | null): TrendPreview | null => {
      if (!Number.isFinite(x)) return null;
      const { zoneId: _z, ...sel } = spec.selection;
      if (isManual) {
        const pts = spec.manual;
        if (!pts || y === null || !Number.isFinite(y)) return null;
        const manual: [TrendPoint, TrendPoint] = h.edge === 'p0' ? [{ x, y }, pts[1]] : [pts[0], { x, y }];
        return { manual, selection: { ...sel, top: Math.min(manual[0].x, manual[1].x), base: Math.max(manual[0].x, manual[1].x) } };
      }
      const r = evaluateTrend(spec, pl.series, zonesOf(frameRef!.data));
      let top = h.edge === 'top' ? x : r.span?.[0] ?? x;
      let base = h.edge === 'base' ? x : r.span?.[1] ?? x;
      if (top > base) [top, base] = [base, top];
      return { selection: { ...sel, top, base } };
    };
    const label = isManual ? 'Mover punto de la tendencia' : 'Mover tramo de la tendencia';
    const patchOf = (c: TrendPreview): TrendPatch => (isManual ? { manual: c.manual!, selection: c.selection! } : { selection: c.selection! });
    return {
      key: h.key,
      label: `${handleLabel(pl.spec, h.edge, h.x)} · arrastrá para moverlo`,
      cursor: isManual ? 'move' : 'ns-resize',
      drag: {
        cursor: isManual ? 'grabbing' : 'ns-resize',
        move(q) {
          const spec = specById(frameRef!, id) ?? pl.spec;
          const y = isManual ? t.valueOf(pl.key, q.x - t.x) : null;
          const c = changeFor(spec, q.depth, y);
          if (!c) return;
          setPreview({ id, spec, series: pl.series, change: c });
          invalidate();
        },
        end() {
          const p = preview;
          setPreview(null);
          invalidate();
          if (!p || p.id !== id || !edit) return;
          const r = evaluateTrend(p.spec, p.series, zonesOf(frameRef!.data), p.change);
          if (!r.coeffs) {
            edit.error?.(r.problem ?? 'No se pudo ajustar la tendencia en ese tramo.');
            return;
          }
          edit.update(id, patchOf(p.change), label);
        },
        cancel() {
          setPreview(null);
          invalidate();
        },
      },
      nudge(deltaM) {
        if (!edit || !frameRef) return;
        const spec = specById(frameRef, id);
        if (!spec) return;
        const series = opts.resolve(frameRef.data, spec.series) ?? pl.series;
        const r = evaluateTrend(spec, series, zonesOf(frameRef.data));
        let x: number;
        let y: number | null = null;
        if (isManual) {
          const pt = spec.manual?.[h.edge === 'p0' ? 0 : 1];
          if (!pt) return;
          x = pt.x + deltaM;
          y = pt.y;
        } else {
          const cur = h.edge === 'top' ? r.span?.[0] : r.span?.[1];
          if (cur === undefined) return;
          x = cur + deltaM;
        }
        const c = changeFor(spec, x, y);
        if (!c) return;
        if (!evaluateTrend(spec, series, zonesOf(frameRef.data), c).coeffs) return;
        edit.update(id, patchOf(c), label);
      },
    };
  };

  // ── muestras (excluir / incluir) ───────────────────────────────────────────────────────────────────────────

  const sampleHit = (frame: OverlayHitFrame, pl: Placed, p: OverlayPointer): OverlayHit | null => {
    if (!edit || pl.spec.mode !== 'fit' || p.track?.id !== pl.track.id || !pl.result.span || pl.series.pickSamples === false) return null;
    const s = pl.series;
    const vp = frame.viewport;
    const [x0, x1] = pl.result.span;
    if (p.depth < x0 - 1e-9 || p.depth > x1 + 1e-9) return null;
    const a = Math.max(lowerBound(s.x, vp.depthOf(p.y - SAMPLE_HIT_PX)), lowerBound(s.x, x0));
    const b = Math.min(upperBound(s.x, vp.depthOf(p.y + SAMPLE_HIT_PX)), upperBound(s.x, x1));
    let best = -1;
    let bestD = SAMPLE_HIT_PX + 0.01;
    // Curvas densas: a lo sumo ~2000 muestras por consulta (12 px de alto con escala muy comprimida).
    const step = Math.max(1, Math.floor((b - a) / 2000));
    for (let i = a; i < b; i += step) {
      const v = s.y[i]!;
      if (!Number.isFinite(v)) continue;
      const xr = pl.track.xOf(pl.key, v);
      if (xr === null) continue;
      const d = Math.hypot(pl.track.x + xr - p.x, vp.yOf(s.x[i]!) - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const key = s.pointKey(best);
    const isExcluded = pl.spec.selection.excluded.includes(key);
    const v = s.y[best]!;
    return {
      label: `${s.label} ${formatNumber(v, { significant: 4 })} a ${m1(s.x[best]!)}\n${isExcluded ? 'Excluida del ajuste · clic para volver a incluirla' : 'Clic para excluirla del ajuste'}`,
      cursor: 'pointer',
      activate: () => edit.togglePoint(pl.spec.id, key, !isExcluded),
    };
  };

  // ── superposiciones ─────────────────────────────────────────────────────────────────────────────────────────

  const bands: ViewerOverlay = {
    id: TRENDS_BANDS_ID,
    label: 'Tendencias (tramos)',
    layer: 'under',
    order: -5,
    draw(frame: OverlayFrame) {
      frameRef = frame;
      const { ctx, viewport: vp } = frame;
      const selected = edit?.selected() ?? null;
      for (const pl of layout(frame)) {
        if (!pl.result.span) continue;
        const y0 = vp.yOf(pl.result.span[0]);
        const y1 = vp.yOf(pl.result.span[1]);
        if (y1 < 0 || y0 > vp.height) continue;
        const strong = pl.spec.id === selected || preview?.id === pl.spec.id || (preview && preview.id === null && pl.spec === preview.spec);
        ctx.fillStyle = withAlpha(pl.color, strong ? 0.11 : 0.05);
        ctx.fillRect(pl.track.x, y0, pl.track.width, Math.max(1, y1 - y0));
        if (strong) {
          ctx.fillStyle = withAlpha(pl.color, 0.55);
          ctx.fillRect(pl.track.x, Math.round(y0), pl.track.width, 1);
          ctx.fillRect(pl.track.x, Math.round(y1), pl.track.width, 1);
        }
      }
    },
  };

  const over: ViewerOverlay = {
    id: TRENDS_OVERLAY_ID,
    label: 'Tendencias',
    layer: 'over',
    order: 20,
    draw(frame: OverlayFrame) {
      frameRef = frame;
      const { ctx, viewport: vp, theme } = frame;
      const selected = edit?.selected() ?? null;
      const placed = [...layout(frame)];
      const width = frame.tracks.reduce((mx, t) => Math.max(mx, t.x + t.width), 0);
      const labels: { x: number; y: number; w: number; h: number }[] = [];
      const font = `${BASE_TOKENS.weight.medium} ${BASE_TOKENS.text.xs}px ${BASE_TOKENS.font.sans}`;
      const fontStrong = `${BASE_TOKENS.weight.semibold} ${BASE_TOKENS.text.xs}px ${BASE_TOKENS.font.sans}`;
      const active = frame.active?.overlayId === TRENDS_OVERLAY_ID ? frame.active.key : null;
      // La seleccionada y la que se arrastra, al final (encima).
      const isHot = (pl: Placed) => pl.spec.id === selected || (preview !== null && (preview.id === pl.spec.id || (preview.id === null && pl.spec === preview.spec)));
      placed.sort((a, b) => Number(isHot(a)) - Number(isHot(b)));
      for (const pl of placed) {
        const hot = isHot(pl);
        const t = pl.track;
        ctx.save();
        ctx.beginPath();
        ctx.rect(t.x, 0, t.width, vp.height);
        ctx.clip();
        // Muestras excluidas (×) y, con zoom, las muestras del tramo de la seleccionada (para elegir cuál excluir).
        drawSamples(ctx, frame, pl, hot);
        if (pl.geom) {
          const ai = active ? pl.handles.findIndex((h) => h.key === active) : -1;
          drawTrend(ctx, pl.geom, { color: pl.color, halo: theme.viewer.trackBg, emphasis: hot, activeHandle: ai >= 0 ? ai : null });
        }
        ctx.restore();
      }
      // Etiquetas después de todas las líneas: no tapan manijas y la de la seleccionada se ubica primero (las demás
      // la esquivan).
      for (const pl of placed) for (const h of pl.geom?.handles ?? []) if (h) labels.push({ x: h[0] - 7, y: h[1] - 7, w: 14, h: 14 });
      for (const pl of [...placed].reverse()) {
        // Etiqueta de una línea (pistas angostas): al costado del medio del tramo, lejos de los extremos (donde se
        // cruzan los gradientes de una pista de presiones).
        const compact = pl.series.canvasLabel === 'gradient';
        const anchor = compact ? (pl.geom?.middle ?? pl.geom?.anchor) : pl.geom?.anchor;
        if (!anchor || !pl.result.coeffs) continue;
        const hot = isHot(pl);
        labels.push(
          drawTrendLabel(ctx, compact ? trendGradientLabel(pl.spec, pl.result) : trendCanvasLabel(pl.spec, pl.result, pl.series), anchor, { x0: 0, x1: width, y0: 0, y1: vp.height }, {
            color: pl.color,
            bg: withAlpha(theme.color.surfaceRaised, hot ? 0.97 : 0.9),
            border: hot ? withAlpha(pl.color, 0.7) : theme.color.border,
            ink: theme.color.text,
            muted: theme.color.textMuted,
            font,
            fontStrong,
          }, labels, compact ? 'beside' : 'above'),
        );
      }
      // Vista previa sin ajuste posible: aviso junto al puntero del tramo.
      if (preview) {
        const pl = placed.find((x) => x.spec === preview!.spec || x.spec.id === preview!.id);
        if (pl && !pl.result.coeffs && pl.result.problem && pl.result.range) {
          const y = Math.max(14, Math.min(vp.height - 14, vp.yOf(Number.isFinite(pl.result.range.base) ? pl.result.range.base : vp.top) + 16));
          ctx.save();
          ctx.font = font;
          const text = 'Tramo sin datos suficientes para ajustar';
          const w = ctx.measureText(text).width + 16;
          const x = Math.min(width - w - 4, pl.track.x + 6);
          ctx.fillStyle = theme.color.error;
          ctx.beginPath();
          ctx.roundRect(x, y - 10, w, 20, 10);
          ctx.fill();
          ctx.fillStyle = theme.color.textOnAccent;
          ctx.textBaseline = 'middle';
          ctx.fillText(text, x + 8, y + 0.5);
          ctx.restore();
        }
      }
    },
    hit(frame, p) {
      frameRef = frame;
      if (edit?.blocked?.()) return null;
      const tool = edit?.tool();
      if (tool) return toolHit(frame, p, tool);
      const placed = layout(frame);
      const selected = edit?.selected() ?? null;
      // 1) Manijas (la seleccionada primero). Las de series cuyos puntos maneja otra superposición van en `lines`,
      // con menos prioridad que esos puntos.
      const bestH = nearestHandle(placed.filter((pl) => pl.series.pickSamples !== false), p, selected);
      if (bestH && edit) return handleHit(bestH.pl, bestH.pl.handles[bestH.i]!);
      // 2) Muestras del tramo de la seleccionada (excluir / incluir).
      const sel = placed.find((pl) => pl.spec.id === selected);
      if (sel) {
        const h = sampleHit(frame, sel, p);
        if (h) return h;
      }
      // 3) La línea: en `lines`, con menos prioridad que los elementos de otras superposiciones.
      return null;
    },
    targets(frame): OverlayTarget[] {
      frameRef = frame;
      if (!edit) return [];
      const out: OverlayTarget[] = [];
      for (const pl of layout(frame)) for (const h of pl.handles) if (Number.isFinite(h.x)) out.push({ depth: h.x, hit: { ...handleHit(pl, h), label: handleLabel(pl.spec, h.edge, h.x) } });
      return out;
    },
    ...(opts.subscribe ? { subscribe: opts.subscribe } : {}),
  };

  const lines: ViewerOverlay = {
    id: TRENDS_LINES_ID,
    label: 'Tendencias (líneas)',
    layer: 'over',
    order: 5,
    draw() {},
    hit(frame, p) {
      frameRef = frame;
      if (edit?.blocked?.() || edit?.tool()) return null;
      const placed = layout(frame);
      const selected = edit?.selected() ?? null;
      const owned = nearestHandle(placed.filter((pl) => pl.series.pickSamples === false), p, selected);
      if (owned && edit) return handleHit(owned.pl, owned.pl.handles[owned.i]!);
      let bestL: { pl: Placed; d: number } | null = null;
      for (const pl of placed) {
        if (!pl.geom || p.track?.id !== pl.track.id) continue;
        const d = distanceToPolylines([...pl.geom.solid, ...pl.geom.dashed], p.x, p.y);
        if (d <= LINE_HIT_PX && (!bestL || d < bestL.d)) bestL = { pl, d };
      }
      if (!bestL) return null;
      const pl = (bestL as { pl: Placed }).pl;
      const isSel = pl.spec.id === selected;
      const hint = isSel
        ? pl.series.pickSamples === false
          ? 'Clic: deseleccionar · doble clic: ver el tramo'
          : 'Clic en una muestra del tramo: excluirla o incluirla · doble clic: ver el tramo'
        : 'Clic: seleccionar · doble clic: ver el tramo';
      return {
        label: trendTooltip(pl.spec, pl.result, pl.series, hint),
        cursor: 'pointer',
        ...(edit ? { activate: () => edit.select(isSel ? null : pl.spec.id), doubleClick: () => edit.select(pl.spec.id) } : {}),
        ...(pl.result.span ? { range: { top: pl.result.span[0], base: pl.result.span[1] } } : {}),
      };
    },
  };
  return [bands, over, lines];
}

/** × sobre las muestras excluidas; con zoom (≥ 5 px por muestra), puntos sobre las muestras del tramo seleccionado. */
function drawSamples(ctx: CanvasRenderingContext2D, frame: OverlayFrame, pl: Placed, hot: boolean): void {
  const s = pl.series;
  const vp = frame.viewport;
  const span = pl.result.span;
  const t = pl.track;
  const px = (i: number): [number, number] | null => {
    const v = s.y[i]!;
    if (!Number.isFinite(v)) return null;
    const xr = t.xOf(pl.key, v);
    return xr === null ? null : [t.x + xr, vp.yOf(s.x[i]!)];
  };
  const a = lowerBound(s.x, Math.max(vp.top, span ? span[0] : vp.top));
  const b = upperBound(s.x, Math.min(vp.base, span ? span[1] : vp.base));
  if (hot && span && pl.spec.mode === 'fit' && pl.series.pickSamples !== false && b - a > 1 && b - a < 2000) {
    const gap = (vp.yOf(s.x[b - 1]!) - vp.yOf(s.x[a]!)) / (b - a - 1);
    if (gap >= 5) {
      ctx.fillStyle = withAlpha(pl.color, 0.55);
      for (let i = a; i < b; i++) {
        const q = px(i);
        if (!q) continue;
        ctx.beginPath();
        ctx.arc(q[0], q[1], 1.75, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
  const keys = pl.spec.selection.excluded;
  if (!keys.length) return;
  ctx.strokeStyle = pl.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Por `excludedIndices` (caché por lista): sirve también para proveedores sin `indexOfKey` (MDT, plugs).
  for (const i of excludedIndices(keys, s)) {
    const q = px(i);
    if (!q || q[1] < -4 || q[1] > vp.height + 4) continue;
    ctx.moveTo(q[0] - 3, q[1] - 3);
    ctx.lineTo(q[0] + 3, q[1] + 3);
    ctx.moveTo(q[0] + 3, q[1] - 3);
    ctx.lineTo(q[0] - 3, q[1] + 3);
  }
  ctx.stroke();
}

