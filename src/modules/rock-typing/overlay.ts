/**
 * Pista «Tipo de roca» del visor (docs/decisiones/0024-rock-typing.md, D5). Contrato `ViewerOverlay`, descubierto solo:
 * no toca el núcleo del visor.
 *
 * Pista propia con escala log 0,01–100 µm (la de FZI y R35, que viven en el mismo rango): cada muestra se tiñe con el
 * color de su clase (fondo tenue a todo el ancho) y se rellena desde el borde izquierdo hasta el valor que clasifica
 * —FZI para las unidades de flujo, R35 para las clases de garganta—, con esa curva encima y los límites de clase como
 * verticales rayadas. Bloques altos llevan su rótulo («UF 3», «Meso»). Tooltip con la clase, su rango, FZI y R35.
 * Mismos colores que el panel (`classColor`). Solo aparece si el pozo tiene plugs de corona.
 */
import { formatNumber } from '../../ui/format';
import { contrastRatio, withAlpha } from '../../ui/color';
import { BASE_TOKENS, scalePx } from '../../ui/tokens';
import type { ComputedCurve } from '../../viewer/resolve';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayTrack, ViewerOverlay } from '../../viewer/overlay';
import { coreSets } from '../core/model';
import { classColor } from './draw';
import { classCount, classLabel, classRangeText, ISO_RADII, ROCK_OVERLAY_ID, rockModuleParams } from './model';

/** Escala de la pista (µm). */
export const TRACK_SCALE = { kind: 'log' as const, min: 0.01, max: 100 };

const fmt = (v: number) => formatNumber(v, { significant: 2 });

interface Runs {
  /** Inicio (índice de muestra), fin (exclusivo) y clase de cada tramo de clase constante. */
  start: Int32Array;
  end: Int32Array;
  cls: Int32Array;
}

const runsCache = new WeakMap<Float64Array, Runs>();

/** Tramos de clase constante de una curva de clases (NaN = sin clase, no forma tramo). Puro; caché por identidad. */
export function classRuns(data: Float64Array): Runs {
  const hit = runsCache.get(data);
  if (hit) return hit;
  const s: number[] = [];
  const e: number[] = [];
  const c: number[] = [];
  let cur = NaN;
  let from = -1;
  for (let i = 0; i <= data.length; i++) {
    const v = i < data.length ? data[i]! : NaN;
    if (v === cur) continue;
    if (from >= 0 && Number.isFinite(cur)) {
      s.push(from);
      e.push(i);
      c.push(cur);
    }
    cur = v;
    from = i;
  }
  const out = { start: Int32Array.from(s), end: Int32Array.from(e), cls: Int32Array.from(c) };
  runsCache.set(data, out);
  return out;
}

/** Primer índice con depth[i] ≥ z (depth creciente). */
function lowerBound(depth: Float64Array, z: number): number {
  let lo = 0;
  let hi = depth.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (depth[m]! < z) lo = m + 1;
    else hi = m;
  }
  return lo;
}

const findTrack = (frame: OverlayHitFrame): OverlayTrack | undefined => frame.tracks.find((t) => t.overlayId === ROCK_OVERLAY_ID);
const active = (computed: readonly ComputedCurve[], port: string) => computed.find((c) => c.active && c.port === port)?.data ?? null;

function state(frame: OverlayHitFrame) {
  const params = rockModuleParams(frame.data.interpretation.params);
  const n = frame.data.depth.length;
  const ok = (d: Float64Array | null) => (d && d.length === n ? d : null);
  const cls = ok(active(frame.data.computed, 'ROCK_TYPE'));
  const fzi = ok(active(frame.data.computed, 'FZI'));
  const r35 = ok(active(frame.data.computed, 'R35'));
  const value = params.method === 'winland' ? r35 : fzi;
  const edges = params.method === 'winland' ? ISO_RADII : params.bounds;
  return { params, cls, fzi, r35, value, edges, count: classCount(params) };
}

export const overlays: ViewerOverlay[] = [
  {
    id: ROCK_OVERLAY_ID,
    label: 'Tipos de roca',
    layer: 'under',
    order: 60,
    track: {
      title: 'Tipo de roca',
      scale: TRACK_SCALE,
      unit: 'um',
      width: 0.75,
      after: 'permeability',
      workspaces: ['petrophysics'],
      resolve({ well }) {
        return coreSets(well.pointSets).length > 0 ? { scale: TRACK_SCALE, unit: 'um', title: 'Tipo de roca' } : null;
      },
    },
    draw(frame: OverlayFrame) {
      const t = findTrack(frame);
      if (!t) return;
      const { ctx, viewport: vp, theme } = frame;
      const u = frame.uiScale ?? 1;
      const st = state(frame);
      ctx.save();
      ctx.beginPath();
      ctx.rect(t.x, 0, t.width, vp.height);
      ctx.clip();
      if (!st.cls) {
        ctx.fillStyle = theme.viewer.axisText;
        ctx.font = `${BASE_TOKENS.weight.regular} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = ['Sin tipos de roca:', 'faltan φ efectiva', 'o permeabilidad.'];
        lines.forEach((l, k) => ctx.fillText(l, t.x + t.width / 2, vp.height / 2 + (k - 1) * scalePx(15, u)));
        ctx.restore();
        return;
      }
      const depth = frame.data.depth;
      const n = depth.length;
      const edge = (i: number) => (i <= 0 ? depth[0]! : i >= n ? depth[n - 1]! : (depth[i - 1]! + depth[i]!) / 2);
      const i0 = Math.max(0, lowerBound(depth, vp.top) - 1);
      const i1 = Math.min(n, lowerBound(depth, vp.base) + 1);
      const colors = Array.from({ length: st.count }, (_, k) => classColor(k, st.count, theme.name));
      const tint = theme.name === 'dark' ? 0.26 : 0.2;
      const xOf = (v: number) => {
        const x = t.xOf(null, v);
        return x === null ? 0 : Math.max(0, Math.min(t.width, x));
      };
      // Fondo tenue y relleno hasta el valor, muestra a muestra (decenas de miles de rectángulos siguen siendo baratos).
      for (let i = i0; i < i1; i++) {
        const c = st.cls[i]!;
        if (!Number.isFinite(c)) continue;
        const color = colors[c] ?? colors[colors.length - 1]!;
        const y0 = (edge(i) - vp.top) * vp.pxPerM;
        const h = Math.max(1, (edge(i + 1) - vp.top) * vp.pxPerM - y0);
        ctx.fillStyle = withAlpha(color, tint);
        ctx.fillRect(t.x, y0, t.width, h);
        const v = st.value?.[i] ?? NaN;
        if (v > 0) {
          ctx.fillStyle = withAlpha(color, 0.9);
          ctx.fillRect(t.x, y0, xOf(v), h);
        }
      }
      // Límites de clase.
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = withAlpha(theme.color.textMuted, 0.7);
      for (const b of st.edges) {
        const x = Math.round(t.x + xOf(b)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, vp.height);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // La curva que clasifica, encima.
      if (st.value) {
        ctx.strokeStyle = theme.color.text;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let pen = false;
        for (let i = i0; i < i1; i++) {
          const v = st.value[i]!;
          if (!(v > 0)) {
            pen = false;
            continue;
          }
          const x = t.x + xOf(v);
          const y = (depth[i]! - vp.top) * vp.pxPerM;
          if (pen) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          pen = true;
        }
        ctx.stroke();
      }
      // Rótulos de los bloques que tienen alto suficiente.
      const runs = classRuns(st.cls);
      const minH = scalePx(18, u);
      ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < runs.cls.length; r++) {
        if (runs.end[r]! <= i0 || runs.start[r]! >= i1) continue;
        const y0 = Math.max(0, (edge(runs.start[r]!) - vp.top) * vp.pxPerM);
        const y1 = Math.min(vp.height, (edge(runs.end[r]!) - vp.top) * vp.pxPerM);
        if (y1 - y0 < minH) continue;
        const text = classLabel(st.params.method, runs.cls[r]!);
        const w = ctx.measureText(text).width;
        const px = scalePx(4, u);
        const ph = scalePx(15, u);
        const x = t.x + t.width - px;
        const y = (y0 + y1) / 2;
        const color = colors[runs.cls[r]!] ?? colors[0]!;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x - w - 2 * px, y - ph / 2, w + 2 * px, ph, ph / 2);
        ctx.fill();
        ctx.fillStyle = contrastRatio(color, '#ffffff') >= 3.2 ? '#ffffff' : '#111418';
        ctx.fillText(text, x - px, y + 0.5);
      }
      ctx.restore();
    },
    hit(frame: OverlayHitFrame, p): OverlayHit | null {
      if (!p.track || p.track.overlayId !== ROCK_OVERLAY_ID) return null;
      const st = state(frame);
      if (!st.cls) return null;
      const depth = frame.data.depth;
      let i = lowerBound(depth, p.depth);
      if (i > 0 && (i >= depth.length || Math.abs(depth[i - 1]! - p.depth) < Math.abs(depth[i]! - p.depth))) i--;
      const c = st.cls[i];
      if (c === undefined || !Number.isFinite(c)) return { label: `Sin tipo de roca a ${formatNumber(depth[i], { digits: 1 })} m (falta φ efectiva o permeabilidad)`, cursor: 'default' };
      const lines = [
        `${classLabel(st.params.method, c)} · ${classRangeText(st.params.method, c, st.params.bounds, fmt)}`,
        `FZI ${fmt(st.fzi?.[i] ?? NaN)} µm · R35 ${fmt(st.r35?.[i] ?? NaN)} µm`,
        `${formatNumber(depth[i], { digits: 2 })} m`,
      ];
      return { label: lines.join('\n'), cursor: 'default' };
    },
  },
];
