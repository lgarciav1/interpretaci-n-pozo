/**
 * Pista «Electrofacies» del visor (fase 10c-2). Contrato `ViewerOverlay`, descubierta sola. Lee las curvas del módulo
 * `electrofacies`: color categórico por grupo, más tenue cuanto menor la probabilidad de pertenencia; sin dato en gris.
 * Con el pozo entero en pantalla, una fila por píxel con el grupo más frecuente. Tooltip con el centro del grupo.
 */
import type { ReadonlyTableValue } from '../../core/module';
import { contrastRatio, withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { BASE_TOKENS, scalePx } from '../../ui/tokens';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayTrack, ViewerOverlay } from '../../viewer/overlay';
import { efColor } from './draw';
import { EF_CLUSTERS_TABLE, EF_PORT, efLabel, K_MAX } from './model';

export const EF_OVERLAY_ID = 'electrofacies';
const MODEL_ROLES = ['GR', 'RHOB', 'NPHI', 'DT', 'RT'];

const findTrack = (frame: OverlayHitFrame): OverlayTrack | undefined => frame.tracks.find((t) => t.overlayId === EF_OVERLAY_ID);

function state(frame: OverlayHitFrame) {
  const n = frame.data.depth.length;
  const get = (port: string) => {
    const d = frame.data.computed.find((c) => c.active && c.port === port)?.data ?? null;
    return d && d.length === n ? d : null;
  };
  const table = frame.data.tables?.find((t) => t.port === EF_CLUSTERS_TABLE && t.active)?.value;
  return { cls: get(EF_PORT.cls), conf: get(EF_PORT.conf), table };
}

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

const f = (v: unknown, digits: number) => (typeof v === 'number' && Number.isFinite(v) ? formatNumber(v, { digits }) : '—');

/** Centro del grupo en una línea (unidades de campo). */
export function centerText(table: ReadonlyTableValue | undefined, c: number): string | null {
  const r = table?.rows[c];
  if (!r) return null;
  return `Centro: GR ${f(r.gr, 0)} gAPI · ρb ${f(r.rhob, 2)} g/cm³ · φN ${f(r.nphi, 2)} · DT ${f(r.dt, 0)} µs/ft · Rt ${f(r.rt, 1)} ohm·m`;
}

export const overlays: ViewerOverlay[] = [
  {
    id: EF_OVERLAY_ID,
    label: 'Electrofacies',
    layer: 'under',
    order: 62,
    track: {
      title: 'Electrofacies',
      scale: { kind: 'linear', min: 0, max: 1 },
      unit: 'unitless',
      width: 0.8,
      // Se inserta tras «Litología» antes que la pista de litología sugerida (orden alfabético): queda a su derecha.
      after: 'lithology',
      workspaces: ['geology'],
      axisLabels: [],
      headerLabel: 'Grupos',
      resolve({ well }) {
        const have = MODEL_ROLES.filter((r) => well.curves.some((c) => c.role === r)).length;
        return have >= 2 ? { scale: { kind: 'linear', min: 0, max: 1 }, unit: 'unitless', title: 'Electrofacies' } : null;
      },
    },
    draw(frame: OverlayFrame) {
      const t = findTrack(frame);
      if (!t) return;
      const { ctx, viewport: vp, theme } = frame;
      const u = frame.uiScale ?? 1;
      const { cls, conf } = state(frame);
      ctx.save();
      ctx.beginPath();
      ctx.rect(t.x, 0, t.width, vp.height);
      ctx.clip();
      if (!cls || !conf) {
        ctx.fillStyle = theme.viewer.axisText;
        ctx.font = `${BASE_TOKENS.weight.regular} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
        ctx.textAlign = 'center';
        ctx.fillText('Sin grupos', t.x + t.width / 2, vp.height / 2);
        ctx.restore();
        return;
      }
      const depth = frame.data.depth;
      const n = depth.length;
      const edge = (i: number) => (i <= 0 ? depth[0]! : i >= n ? depth[n - 1]! : (depth[i - 1]! + depth[i]!) / 2);
      const i0 = Math.max(0, lowerBound(depth, vp.top) - 1);
      const i1 = Math.min(n, lowerBound(depth, vp.base) + 1);
      const perSample = vp.pxPerM * ((depth[n - 1]! - depth[0]!) / Math.max(1, n - 1)) >= 1;
      const colors = Array.from({ length: K_MAX }, (_, i) => efColor(i, theme.name));
      // Cuatro niveles de opacidad por probabilidad (cacheados por cuadro: el bucle no arma strings).
      const levels = [0.3, 0.5, 0.72, 0.95];
      const fills = colors.map((c) => levels.map((a) => withAlpha(c, a)));
      const noData = withAlpha(theme.viewer.gridMajor, 0.55);
      const count = new Float64Array(K_MAX);
      const sumP = new Float64Array(K_MAX);
      let first = i0, rowKey = NaN, total = 0, valid = 0;
      const flush = (last: number) => {
        if (total === 0) return;
        const y0 = (edge(first) - vp.top) * vp.pxPerM;
        const h = Math.max(1, (edge(last + 1) - vp.top) * vp.pxPerM - y0);
        if (valid * 2 < total) ctx.fillStyle = noData;
        else {
          let best = 0;
          for (let c = 1; c < K_MAX; c++) if (count[c]! > count[best]!) best = c;
          const p = sumP[best]! / count[best]!;
          ctx.fillStyle = fills[best]![Math.min(3, Math.max(0, Math.floor((p - 0.25) / 0.1875)))]!;
        }
        ctx.fillRect(t.x, y0, t.width, h);
        count.fill(0);
        sumP.fill(0);
        total = 0;
        valid = 0;
      };
      for (let i = i0; i < i1; i++) {
        const key = perSample ? i : Math.floor((depth[i]! - vp.top) * vp.pxPerM);
        if (key !== rowKey) {
          flush(i - 1);
          first = i;
          rowKey = key;
        }
        total++;
        const c = cls[i]!;
        if (!Number.isFinite(c)) continue;
        valid++;
        count[c]!++;
        sumP[c]! += conf[i]!;
      }
      flush(i1 - 1);
      // Rótulos de bloques altos.
      const minH = scalePx(20, u);
      ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let start = i0;
      for (let i = i0 + 1; i <= i1; i++) {
        if (i < i1 && cls[i] === cls[start]) continue;
        const c = cls[start]!;
        const y0 = Math.max(0, (edge(start) - vp.top) * vp.pxPerM);
        const y1 = Math.min(vp.height, (edge(i) - vp.top) * vp.pxPerM);
        if (Number.isFinite(c) && y1 - y0 >= minH) {
          const text = efLabel(c);
          const w = ctx.measureText(text).width + scalePx(8, u);
          const ph = scalePx(15, u);
          const x = t.x + t.width / 2;
          const y = (y0 + y1) / 2;
          ctx.fillStyle = theme.viewer.trackBg;
          ctx.beginPath();
          ctx.roundRect(x - w / 2, y - ph / 2, w, ph, ph / 2);
          ctx.fill();
          ctx.fillStyle = contrastRatio(colors[c]!, theme.viewer.trackBg) >= 3 ? colors[c]! : theme.color.text;
          ctx.fillText(text, x, y + 0.5);
        }
        start = i;
      }
      ctx.restore();
    },
    hit(frame: OverlayHitFrame, p): OverlayHit | null {
      if (!p.track || p.track.overlayId !== EF_OVERLAY_ID) return null;
      const st = state(frame);
      if (!st.cls || !st.conf) return null;
      const depth = frame.data.depth;
      let i = lowerBound(depth, p.depth);
      if (i > 0 && (i >= depth.length || Math.abs(depth[i - 1]! - p.depth) < Math.abs(depth[i]! - p.depth))) i--;
      const z = `${formatNumber(depth[i], { digits: 2 })} m`;
      const c = st.cls[i];
      if (c === undefined || !Number.isFinite(c)) return { label: `Sin datos para agrupar\n${z}`, cursor: 'default' };
      const center = centerText(st.table, c);
      const lines = [`${efLabel(c)} · pertenencia ${formatNumber(st.conf[i]! * 100, { digits: 0 })} %`, ...(center ? [center] : []), `${z} · grupo de respuesta, no litología`];
      return { label: lines.join('\n'), cursor: 'default' };
    },
  },
];
