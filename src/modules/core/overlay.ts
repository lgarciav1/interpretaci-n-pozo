/**
 * Plugs de corona sobre el visor (docs/decisiones/0010-datos-de-corona.md, D5). Contrato `ViewerOverlay`, descubierto
 * solo; escribe únicamente por `frame.data.commit` (recetas puras del núcleo).
 *
 * - Cada plug se dibuja en su profundidad CORREGIDA (`shiftedDepth`) sobre la pista más específica que tiene la
 *   curva comparable: φ sobre la escala de PHIE (o PHIT, PHIE/PHIT RMN), k sobre la de PERM (log) y la densidad de
 *   grano sobre la de RHOB. Marcador: círculo con borde del color de su corona (φ y k) o rombo (densidad de grano);
 *   descartados vacíos con ×; fuera de escala, triángulo en el borde.
 * - En la pista de profundidad, una barra por corona con el tramo cortado (sigue a la puesta en profundidad).
 * - Puntero: tooltip con todos los valores; CLIC incluye o descarta el plug; ARRASTRAR verticalmente mueve toda su
 *   corona (o el conjunto, si no hay columna de corona) con vista previa en vivo y un solo `commit` al soltar (Esc
 *   cancela); el plug queda activo y ↑/↓ corren la corona (Mayús ×10). Tab recorre los plugs.
 * - Dos superposiciones, como MDT: `core` (orden 15: entre los puntos MDT y la herramienta de tendencias, que sigue
 *   teniendo prioridad para elegir un tramo sobre cualquier pista) atiende el puntero y dibuja las barras; `core-points`
 *   (orden 31) dibuja los plugs encima de las líneas de tendencia.
 */
import { pointNumbers, pointRuns, pointTexts, shiftedDepth, shiftOf, type PointSet } from '../../core/pointSets';
import { setPointDecision, setPointSetDepthShift } from '../../core/state/pointSets';
import type { Project } from '../../core/state/project';
import { contrastRatio, ensureContrast, withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { BASE_TOKENS, scalePx, type ThemeTokens } from '../../ui/tokens';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayTarget, OverlayTrack, ViewerOverlay } from '../../viewer/overlay';
import { COL, CORE_OVERLAY_ID, CORE_REASON_LABEL, coreSets, plugDecisionFor, plugStatuses, runColor, runLabel } from './model';

export const CORE_POINTS_OVERLAY_ID = 'core-points';
export const PLUG_RADIUS = 3.5;
export const PLUG_HIT_PX = 7;

/** Qué columna va sobre qué curva (la primera que tenga la pista). */
export const PLACEMENTS: readonly { col: string; roles: readonly string[]; shape: 'circle' | 'diamond' }[] = [
  { col: COL.phi, roles: ['PHIE', 'PHIT', 'PHIE_NMR', 'PHIT_NMR'], shape: 'circle' },
  { col: COL.k, roles: ['PERM'], shape: 'circle' },
  { col: COL.rhog, roles: ['RHOB'], shape: 'diamond' },
];

/** Arrastre en curso (vista previa): corre la corona `run` del conjunto `setId` `delta` m. */
interface Preview {
  setId: string;
  run: string | null;
  delta: number;
}
let preview: Preview | null = null;

/** Solo para tests: estado de la vista previa. */
export const corePreview = (): Readonly<Preview> | null => preview;

const round2 = (v: number) => Math.round(v * 100) / 100;
const m2 = (v: number) => formatNumber(v, { digits: 2 });
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${m2(Math.abs(v))}`;

/** Grupo de puesta en profundidad de un plug: su corona, o null (todo el conjunto / sin corona). */
const runOf = (set: PointSet, i: number): string | null => pointRuns(set)?.[i] || null;

interface PlacedPlug {
  set: PointSet;
  i: number;
  key: string;
  track: OverlayTrack;
  col: string;
  shape: 'circle' | 'diamond';
  x: number;
  y: number;
  depth: number;
  clamp: -1 | 0 | 1;
  included: boolean;
  run: string | null;
}

/**
 * Pista de cada columna: la MÁS ESPECÍFICA que tiene la curva (la de menos curvas; empate: la primera), así los plugs
 * van a «Porosidad» y «Permeabilidad» y no también a la pista recolectora «Interpretación», que tiene todas las
 * calculadas. Una pista recibe una sola columna. Caché por identidad de la lista de pistas.
 */
let tracksCache: { tracks: readonly OverlayTrack[]; out: { track: OverlayTrack; role: string; pl: (typeof PLACEMENTS)[number] }[] } | null = null;
export function plugTracks(tracks: readonly OverlayTrack[]): { track: OverlayTrack; role: string; pl: (typeof PLACEMENTS)[number] }[] {
  if (tracksCache?.tracks === tracks) return tracksCache.out;
  const out: { track: OverlayTrack; role: string; pl: (typeof PLACEMENTS)[number] }[] = [];
  const used = new Set<string>();
  for (const pl of PLACEMENTS) {
    let best: { track: OverlayTrack; role: string; n: number } | null = null;
    for (const role of pl.roles) {
      for (const t of tracks) {
        if (used.has(t.id) || !t.hasRole(role)) continue;
        if (!best || t.curves.length < best.n) best = { track: t, role, n: t.curves.length };
      }
      if (best) break; // el primer rol que aparece (PHIE antes que PHIT)
    }
    if (best) {
      used.add(best.track.id);
      out.push({ track: best.track, role: best.role, pl });
    }
  }
  tracksCache = { tracks, out };
  return out;
}

const isDragged = (set: PointSet, run: string | null) => !!preview && preview.setId === set.id && preview.run === run;

/** Profundidad de cada plug con la vista previa del arrastre aplicada. */
function depthsOf(set: PointSet, frame: OverlayHitFrame): Float64Array {
  const z = shiftedDepth(set, frame.data.interpretation.pointSets?.[set.id]);
  if (!preview || preview.setId !== set.id || preview.delta === 0) return z;
  const out = Float64Array.from(z);
  for (let i = 0; i < out.length; i++) if (runOf(set, i) === preview.run) out[i] = out[i]! + preview.delta;
  return out;
}

let placedCache: { tracks: readonly OverlayTrack[]; data: OverlayHitFrame['data']; top: number; px: number; preview: Preview | null; out: PlacedPlug[] } | null = null;

/** Plugs ubicados en px para este cuadro (caché por pistas, datos, viewport y vista previa). */
function placePlugs(frame: OverlayHitFrame): PlacedPlug[] {
  const c = placedCache;
  const vp = frame.viewport;
  if (c && c.tracks === frame.tracks && c.data === frame.data && c.top === vp.top && c.px === vp.pxPerM && c.preview === preview) return c.out;
  const out: PlacedPlug[] = [];
  const sets = coreSets(frame.data.well.pointSets);
  for (const { track: t, role, pl } of plugTracks(frame.tracks)) {
    for (const set of sets) {
      const v = pointNumbers(set, pl.col);
      if (!v) continue;
      const z = depthsOf(set, frame);
      const st = plugStatuses(set, frame.data.interpretation.pointSets?.[set.id]);
      for (let i = 0; i < v.length; i++) {
        const val = v[i]!;
        if (!Number.isFinite(val)) continue;
        const xr = t.xOf(role, val);
        if (xr === null || !Number.isFinite(xr)) continue;
        out.push({
          set,
          i,
          key: `${set.id}|${set.pointIds[i]}`,
          track: t,
          col: pl.col,
          shape: pl.shape,
          x: t.x + Math.max(5, Math.min(t.width - 5, xr)),
          y: vp.yOf(z[i]!),
          depth: z[i]!,
          clamp: xr < 0 ? -1 : xr > t.width ? 1 : 0,
          included: st[i]!.included,
          run: runOf(set, i),
        });
      }
    }
  }
  placedCache = { tracks: frame.tracks, data: frame.data, top: vp.top, px: vp.pxPerM, preview, out };
  return out;
}

const colorOf = (set: PointSet, run: string | null, theme: ThemeTokens) => ensureContrast(runColor(set, run, theme.name), theme.viewer.trackBg, 3);

/** Texto del tooltip de un plug. */
function plugLabel(frame: OverlayHitFrame, d: PlacedPlug): string {
  const { set, i } = d;
  const dec = frame.data.interpretation.pointSets?.[set.id];
  const st = plugStatuses(set, dec)[i]!;
  const shift = shiftOf(dec, d.run);
  const lines = [`${set.pointIds[i]} · ${runLabel(d.run)}${set.synthetic ? ' · ejemplo sintético' : ''}`];
  lines.push(`${m2(d.depth)} m${shift !== 0 ? ` (archivo ${m2(set.depth[i]!)} m, ${signed(shift)} m)` : ' (sin poner en profundidad)'}`);
  const parts: string[] = [];
  const phi = pointNumbers(set, COL.phi)?.[i];
  const k = pointNumbers(set, COL.k)?.[i];
  const g = pointNumbers(set, COL.rhog)?.[i];
  if (phi !== undefined && Number.isFinite(phi)) parts.push(`φ ${formatNumber(phi, { digits: 3 })}`);
  if (k !== undefined && Number.isFinite(k)) parts.push(`k ${formatNumber(k, { significant: 3 })} mD`);
  if (g !== undefined && Number.isFinite(g)) parts.push(`ρg ${formatNumber(g, { digits: 2 })} g/cm³`);
  if (parts.length) lines.push(parts.join(' · '));
  const desc = pointTexts(set, COL.description)?.[i];
  if (desc) lines.push(desc);
  if (st.quality.reasons.length) lines.push(`Propuesta: descartar (${st.quality.reasons.map((r) => CORE_REASON_LABEL[r]).join(', ')})`);
  lines.push(st.included ? `${st.decided === 'include' ? 'Incluido a mano' : 'Incluido'} · clic para descartarlo` : `${st.decided === 'exclude' ? 'Descartado a mano' : 'Descartado'} · clic para incluirlo`);
  lines.push(`Arrastrá arriba o abajo para mover ${d.run ? `la ${runLabel(d.run).toLowerCase()}` : 'la corona'} (↑/↓ con el plug activo)`);
  return lines.join('\n');
}

/** Receta: nueva puesta en profundidad de un grupo, a partir de la ACTUAL del proyecto más `delta`. */
function shiftRecipe(wellId: string, setId: string, run: string | null, delta: number) {
  return (p: Project): Project => {
    const entry = p.wells.find((w) => w.well.id === wellId);
    if (!entry || !entry.well.pointSets.some((s) => s.id === setId)) return p;
    const cur = shiftOf(entry.interpretation.pointSets[setId], run);
    return setPointSetDepthShift(p, wellId, setId, round2(cur + delta), run ?? undefined);
  };
}

function plugHit(frame: OverlayHitFrame, d: PlacedPlug): OverlayHit & { key: string } {
  const commit = frame.data.commit;
  const wellId = frame.data.wellId;
  const { set, i, run } = d;
  const pid = set.pointIds[i]!;
  const what = run ? runLabel(run).toLowerCase() : 'corona';
  return {
    key: d.key,
    label: plugLabel(frame, d),
    cursor: commit ? 'ns-resize' : 'default',
    ...(commit
      ? {
          activate: () => {
            const st = plugStatuses(set, frame.data.interpretation.pointSets?.[set.id])[i]!;
            const include = !st.included;
            commit(include ? 'Incluir plug' : 'Descartar plug', (p) => {
              const entry = p.wells.find((w) => w.well.id === wellId);
              const cur = entry?.well.pointSets.find((s) => s.id === set.id);
              if (!entry || !cur || !cur.pointIds.includes(pid)) return p;
              const q = plugStatuses(cur, entry.interpretation.pointSets[cur.id])[cur.pointIds.indexOf(pid)]!;
              if (q.included === include) return p;
              return setPointDecision(p, wellId, cur.id, pid, plugDecisionFor(q.quality, include));
            });
          },
          drag: {
            cursor: 'ns-resize' as const,
            move(p, start) {
              preview = { setId: set.id, run, delta: round2(p.depth - start.depth) };
              frame.invalidate();
            },
            end(p, start) {
              const delta = round2(p.depth - start.depth);
              preview = null;
              if (delta !== 0) commit(`Poner en profundidad la ${what}`, shiftRecipe(wellId, set.id, run, delta));
              frame.invalidate();
            },
            cancel() {
              preview = null;
              frame.invalidate();
            },
          },
          nudge: (deltaM: number) => commit(`Poner en profundidad la ${what}`, shiftRecipe(wellId, set.id, run, deltaM)),
        }
      : {}),
  };
}

/** Barra del tramo cortado de cada corona en la pista de profundidad. */
function drawCoreBars(ctx: CanvasRenderingContext2D, frame: OverlayFrame): void {
  const dt = frame.tracks.find((t) => t.kind === 'depth');
  if (!dt) return;
  const { viewport: vp, theme } = frame;
  const u = frame.uiScale ?? 1;
  ctx.save();
  ctx.font = `${BASE_TOKENS.weight.bold} ${scalePx(10, u)}px ${BASE_TOKENS.font.sans}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const set of coreSets(frame.data.well.pointSets)) {
    const z = depthsOf(set, frame);
    const groups = new Map<string, { run: string | null; lo: number; hi: number }>();
    for (let i = 0; i < z.length; i++) {
      const run = runOf(set, i);
      const g = groups.get(run ?? '');
      if (g) {
        g.lo = Math.min(g.lo, z[i]!);
        g.hi = Math.max(g.hi, z[i]!);
      } else groups.set(run ?? '', { run, lo: z[i]!, hi: z[i]! });
    }
    for (const g of groups.values()) {
      const y0 = vp.yOf(g.lo) - 2;
      const y1 = vp.yOf(g.hi) + 2;
      if (y1 < 0 || y0 > vp.height) continue;
      const color = colorOf(set, g.run, theme);
      const x = dt.x + dt.width - 7;
      ctx.fillStyle = withAlpha(color, isDragged(set, g.run) ? 0.95 : 0.75);
      ctx.beginPath();
      ctx.roundRect(x, y0, 4, Math.max(4, y1 - y0), 2);
      ctx.fill();
      // Sigla de la corona al costado del tope de la barra.
      const tag = g.run ? (/^\d+$/.test(g.run) ? `C${g.run}` : g.run.slice(0, 3)) : 'C';
      const w = (8 + tag.length * 6) * u;
      const th = scalePx(14, u);
      const ty = Math.max(9, Math.min(vp.height - 9, y0 + 8));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x - w - 3, ty - th / 2, w, th, th / 2);
      ctx.fill();
      ctx.fillStyle = contrastRatio(color, '#ffffff') >= 3 ? '#ffffff' : '#111418';
      ctx.fillText(tag, x - 3 - w / 2, ty + 0.5);
    }
  }
  ctx.restore();
}

const main: ViewerOverlay = {
  id: CORE_OVERLAY_ID,
  label: 'Plugs de corona',
  layer: 'over',
  order: 15,
  draw(frame) {
    if (coreSets(frame.data.well.pointSets).length === 0) return;
    drawCoreBars(frame.ctx, frame);
  },
  hit(frame, p) {
    if (!p.track || coreSets(frame.data.well.pointSets).length === 0) return null;
    let best: PlacedPlug | null = null;
    let bestD = PLUG_HIT_PX * (frame.uiScale ?? 1);
    for (const d of placePlugs(frame)) {
      if (d.track.id !== p.track.id) continue;
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist <= bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best ? plugHit(frame, best) : null;
  },
  targets(frame): OverlayTarget[] {
    const placed = placePlugs(frame);
    if (placed.length === 0) return [];
    // Un elemento por plug, en la primera pista donde aparece (la de porosidad si está).
    const seen = new Set<string>();
    const out: OverlayTarget[] = [];
    for (const d of [...placed].sort((a, b) => (a.col === COL.phi ? 0 : 1) - (b.col === COL.phi ? 0 : 1))) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      out.push({ depth: d.depth, hit: plugHit(frame, d) });
    }
    return out;
  },
};

const points: ViewerOverlay = {
  id: CORE_POINTS_OVERLAY_ID,
  label: 'Plugs de corona (puntos)',
  layer: 'over',
  order: 31,
  draw(frame) {
    const placed = placePlugs(frame);
    if (placed.length === 0) return;
    const { ctx, viewport: vp, theme } = frame;
    const halo = theme.viewer.trackBg;
    const muted = theme.color.textMuted;
    const active = frame.active?.overlayId === CORE_OVERLAY_ID ? frame.active.key : null;
    ctx.save();
    for (const pass of [false, true]) {
      for (const d of placed) {
        if (d.included !== pass || d.y < -8 || d.y > vp.height + 8) continue;
        const t = d.track;
        ctx.save();
        ctx.beginPath();
        ctx.rect(t.x, 0, t.width, vp.height);
        ctx.clip();
        const color = colorOf(d.set, d.run, theme);
        const r = PLUG_RADIUS;
        if (d.clamp !== 0) {
          const dir = d.clamp;
          ctx.fillStyle = d.included ? color : muted;
          ctx.beginPath();
          ctx.moveTo(d.x + dir * 4, d.y);
          ctx.lineTo(d.x - dir * 3, d.y - 4);
          ctx.lineTo(d.x - dir * 3, d.y + 4);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          if (d.shape === 'diamond') {
            ctx.moveTo(d.x, d.y - r - 0.5);
            ctx.lineTo(d.x + r + 0.5, d.y);
            ctx.lineTo(d.x, d.y + r + 0.5);
            ctx.lineTo(d.x - r - 0.5, d.y);
            ctx.closePath();
          } else ctx.arc(d.x, d.y, r, 0, 2 * Math.PI);
          if (d.included) {
            // Relleno translúcido + borde del color de la corona: se distingue de las curvas y deja verlas debajo.
            ctx.fillStyle = withAlpha(color, 0.55);
            ctx.strokeStyle = halo;
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          } else {
            ctx.fillStyle = withAlpha(halo, 0.85);
            ctx.strokeStyle = muted;
            ctx.lineWidth = 1.25;
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(d.x - 2.2, d.y - 2.2);
            ctx.lineTo(d.x + 2.2, d.y + 2.2);
            ctx.moveTo(d.x + 2.2, d.y - 2.2);
            ctx.lineTo(d.x - 2.2, d.y + 2.2);
            ctx.stroke();
          }
        }
        if (active === d.key || isDragged(d.set, d.run)) {
          ctx.strokeStyle = active === d.key ? theme.color.accent : withAlpha(color, 0.6);
          ctx.lineWidth = active === d.key ? 2 : 1;
          ctx.beginPath();
          ctx.arc(d.x, d.y, r + 3.5, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    // Durante el arrastre: pastilla con la puesta en profundidad resultante junto a la corona.
    if (preview) {
      const p = preview;
      const set = coreSets(frame.data.well.pointSets).find((s) => s.id === p.setId);
      const moved = placed.filter((d) => d.set === set && d.run === p.run);
      if (set && moved.length) {
        const cur = shiftOf(frame.data.interpretation.pointSets?.[set.id], p.run);
        const text = `${runLabel(p.run)} · ${signed(round2(cur + p.delta))} m`;
        const top = moved.reduce((a, d) => (d.y < a.y ? d : a));
        const u = frame.uiScale ?? 1;
        ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
        const w = ctx.measureText(text).width + scalePx(16, u);
        const ph = scalePx(20, u);
        const x = Math.max(4, Math.min(top.track.x + top.track.width - w - 4, top.x - w / 2));
        const y = Math.max(4, top.y - scalePx(30, u));
        const color = colorOf(set, p.run, theme);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y, w, ph, ph / 2);
        ctx.fill();
        ctx.fillStyle = contrastRatio(color, '#ffffff') >= 3 ? '#ffffff' : '#111418';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + w / 2, y + ph / 2 + 0.5);
      }
    }
    ctx.restore();
  },
};

export const overlays: ViewerOverlay[] = [main, points];
