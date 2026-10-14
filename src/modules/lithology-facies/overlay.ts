/**
 * Pista «Litología sugerida» del visor (fase 10c, docs/decisiones/0030-modelos-de-facies.md). Contrato `ViewerOverlay`,
 * descubierta sola: no toca el núcleo del visor. Lee las curvas del módulo `lithology-facies`; no recalcula nada.
 *
 * Escala horizontal de probabilidad 0–1. Por muestra se apilan, desde el borde izquierdo, la clase ganadora (ancho =
 * su probabilidad), la segunda y la tercera más probables (cada vez más tenues). El borde de la ganadora se traza como
 * curva y una vertical rayada marca la probabilidad mínima: debajo de ella la ganadora se atenúa (incierta). Las
 * clases que el modelo apenas distingue también se atenúan. Muestras sin datos suficientes: gris de «sin dato», nunca
 * una clase. Bloques altos llevan su rótulo; el tooltip da las tres clases más probables.
 */
import { contrastRatio, withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { BASE_TOKENS, scalePx, type ThemeTokens } from '../../ui/tokens';
import type { ComputedCurve } from '../../viewer/resolve';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayTrack, ViewerOverlay } from '../../viewer/overlay';
import { classColors } from './draw';
import { CLASS_COUNT, classLabel, LITHOLOGY_FACIES_OVERLAY_ID, LOW_SKILL_CLASSES, minConfidenceOf, PORT } from './model';

const TRACK_SCALE = { kind: 'linear' as const, min: 0, max: 1 };
const AXIS = [
  { position: 0, label: '0' },
  { position: 0.5, label: '0,5' },
  { position: 1, label: '1' },
];
/** Roles con los que el modelo puede sugerir algo (la pista se oculta si el pozo tiene menos de dos). */
const MODEL_ROLES = ['GR', 'RHOB', 'NPHI', 'PEF', 'DT', 'RT'];

const findTrack = (frame: OverlayHitFrame): OverlayTrack | undefined => frame.tracks.find((t) => t.overlayId === LITHOLOGY_FACIES_OVERLAY_ID);
const active = (computed: readonly ComputedCurve[], port: string) => computed.find((c) => c.active && c.port === port)?.data ?? null;

function state(frame: OverlayHitFrame) {
  const n = frame.data.depth.length;
  const get = (port: string) => {
    const d = active(frame.data.computed, port);
    return d && d.length === n ? d : null;
  };
  return {
    cls: get(PORT.cls),
    conf: get(PORT.conf),
    cls2: get(PORT.cls2),
    conf2: get(PORT.conf2),
    cls3: get(PORT.cls3),
    conf3: get(PORT.conf3),
    minP: minConfidenceOf(frame.data.interpretation.params),
  };
}

interface Paints {
  sure: string[];
  unsure: string[];
  second: string[];
  third: string[];
  solid: readonly string[];
}

const paintCache = new Map<string, Paints>();
/** Rellenos por clase y nivel (precalculados: el bucle de dibujo no arma strings). */
function paints(theme: ThemeTokens): Paints {
  const k = `${theme.name}|${theme.viewer.trackBg}`;
  const hit = paintCache.get(k);
  if (hit) return hit;
  const solid = classColors(theme);
  const dim = (c: number) => (LOW_SKILL_CLASSES.has(c) ? 0.62 : 1);
  const p: Paints = {
    solid,
    sure: solid.map((col, c) => withAlpha(col, 0.95 * dim(c))),
    unsure: solid.map((col, c) => withAlpha(col, 0.5 * dim(c))),
    second: solid.map((col) => withAlpha(col, 0.42)),
    third: solid.map((col) => withAlpha(col, 0.22)),
  };
  paintCache.set(k, p);
  return p;
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

/**
 * Si la curva tiene al menos una clase. El módulo publica curvas todas NaN cuando no pudo sugerir (faltan curvas, o el
 * motor corre en proceso sin el modelo, ver predict.main-thread.ts): la pista lo dice en vez de pintarse de «sin dato».
 * Cacheado por identidad del array (el motor publica uno nuevo en cada cálculo).
 */
const anyClass = new WeakMap<Float64Array, boolean>();
function hasAnyClass(cls: Float64Array): boolean {
  let v = anyClass.get(cls);
  if (v === undefined) {
    v = false;
    for (let i = 0; i < cls.length; i++) if (Number.isFinite(cls[i]!)) { v = true; break; }
    anyClass.set(cls, v);
  }
  return v;
}

const pct = (p: number) => `${formatNumber(p * 100, { digits: 0 })} %`;

export const overlays: ViewerOverlay[] = [
  {
    id: LITHOLOGY_FACIES_OVERLAY_ID,
    label: 'Litología sugerida',
    layer: 'under',
    order: 61,
    track: {
      title: 'Litología (ML)',
      scale: TRACK_SCALE,
      unit: 'v/v',
      width: 1.2,
      // Tras la pista Litología: como las superposiciones se insertan en orden alfabético, la mineralogía y la
      // columna sedimentológica (que piden ir después de esa misma pista) quedan antes, y esta pista al lado de la columna.
      after: 'lithology',
      workspaces: ['geology'],
      axisLabels: AXIS,
      headerLabel: 'Probabilidad',
      resolve({ well }) {
        const have = MODEL_ROLES.filter((r) => well.curves.some((c) => c.role === r)).length;
        return have >= 2 ? { scale: TRACK_SCALE, unit: 'v/v', title: 'Litología (ML)' } : null;
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
      if (!st.cls || !st.conf || !hasAnyClass(st.cls)) {
        ctx.fillStyle = theme.viewer.axisText;
        ctx.font = `${BASE_TOKENS.weight.regular} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = ['Sin litología sugerida:', 'revisá los avisos', 'del módulo.'];
        lines.forEach((l, k) => ctx.fillText(l, t.x + t.width / 2, vp.height / 2 + (k - 1) * scalePx(15, u)));
        ctx.restore();
        return;
      }
      const { cls, conf, cls2, conf2, cls3, conf3 } = st;
      const pt = paints(theme);
      const noData = withAlpha(theme.viewer.gridMajor, 0.55);
      const depth = frame.data.depth;
      const n = depth.length;
      const edge = (i: number) => (i <= 0 ? depth[0]! : i >= n ? depth[n - 1]! : (depth[i - 1]! + depth[i]!) / 2);
      const i0 = Math.max(0, lowerBound(depth, vp.top) - 1);
      const i1 = Math.min(n, lowerBound(depth, vp.base) + 1);
      const W = t.width;
      const xOf = (p: number) => Math.max(0, Math.min(W, p * W));

      // Filas de dibujo: una por muestra si la muestra ocupa al menos un píxel; si no (pozo entero en pantalla), una
      // por píxel con la probabilidad media de las muestras que caen en él (sumando las tres clases publicadas). Así
      // la pista se lee igual a cualquier escala y no se dibujan miles de rectángulos superpuestos.
      const pxPerSample = vp.pxPerM * ((depth[n - 1]! - depth[0]!) / Math.max(1, n - 1));
      const perSample = pxPerSample >= 1;
      const acc = new Float64Array(CLASS_COUNT);
      const line: number[] = [];
      let first = i0;
      let rowKey = NaN;
      let count = 0;
      let valid = 0;
      const add = (k: number, v: number) => {
        if (Number.isFinite(k) && v > 0) acc[k]! += v;
      };
      const flush = (last: number) => {
        if (count === 0) return;
        const y0 = (edge(first) - vp.top) * vp.pxPerM;
        const h = Math.max(1, (edge(last + 1) - vp.top) * vp.pxPerM - y0);
        if (valid * 2 < count) {
          ctx.fillStyle = noData;
          ctx.fillRect(t.x, y0, W, h);
          line.push(NaN, NaN);
        } else {
          // Las tres clases con más probabilidad media en la fila.
          let a = -1, b = -1, c = -1;
          for (let k = 0; k < CLASS_COUNT; k++) {
            const v = acc[k]!;
            if (!(v > 0)) continue;
            if (a < 0 || v > acc[a]!) { c = b; b = a; a = k; }
            else if (b < 0 || v > acc[b]!) { c = b; b = k; }
            else if (c < 0 || v > acc[c]!) c = k;
          }
          const p1 = acc[a]! / valid;
          const x1 = xOf(p1);
          ctx.fillStyle = p1 < st.minP ? pt.unsure[a]! : pt.sure[a]!;
          ctx.fillRect(t.x, y0, x1, h);
          if (b >= 0) {
            const x2 = xOf(p1 + acc[b]! / valid);
            ctx.fillStyle = pt.second[b]!;
            ctx.fillRect(t.x + x1, y0, x2 - x1, h);
            if (c >= 0) {
              ctx.fillStyle = pt.third[c]!;
              ctx.fillRect(t.x + x2, y0, xOf((acc[a]! + acc[b]! + acc[c]!) / valid) - x2, h);
            }
          }
          line.push(t.x + x1, y0 + h / 2);
        }
        acc.fill(0);
        count = 0;
        valid = 0;
      };
      for (let i = i0; i < i1; i++) {
        const key = perSample ? i : Math.floor((depth[i]! - vp.top) * vp.pxPerM);
        if (key !== rowKey) {
          flush(i - 1);
          first = i;
          rowKey = key;
        }
        count++;
        if (!Number.isFinite(cls[i]!)) continue;
        valid++;
        add(cls[i]!, conf[i]!);
        add(cls2?.[i] ?? NaN, conf2?.[i] ?? NaN);
        add(cls3?.[i] ?? NaN, conf3?.[i] ?? NaN);
      }
      flush(i1 - 1);

      // Probabilidad mínima.
      const xm = Math.round(t.x + xOf(st.minP)) + 0.5;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = withAlpha(theme.color.textMuted, 0.75);
      ctx.beginPath();
      ctx.moveTo(xm, 0);
      ctx.lineTo(xm, vp.height);
      ctx.stroke();
      ctx.setLineDash([]);

      // Borde de la clase ganadora: la probabilidad como curva fina (no tapa los colores). Solo con al menos 2 px por
      // muestra: más comprimida, la curva serrucha y ensucia la lectura; el límite de color ya muestra la probabilidad.
      if (pxPerSample < 2) line.length = 0;
      ctx.strokeStyle = withAlpha(theme.color.text, 0.6);
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      let pen = false;
      for (let k = 0; k < line.length; k += 2) {
        const x = line[k]!;
        if (!Number.isFinite(x)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(x, line[k + 1]!);
        else ctx.moveTo(x, line[k + 1]!);
        pen = true;
      }
      ctx.stroke();

      // Rótulos de los bloques de clase constante con alto suficiente (a la derecha, sobre la zona tenue).
      const minH = scalePx(20, u);
      ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const px = scalePx(4, u);
      const ph = scalePx(15, u);
      let start = i0;
      for (let i = i0 + 1; i <= i1; i++) {
        if (i < i1 && cls[i] === cls[start]) continue;
        const c = cls[start]!;
        if (Number.isFinite(c)) {
          const y0 = Math.max(0, (edge(start) - vp.top) * vp.pxPerM);
          const y1 = Math.min(vp.height, (edge(i) - vp.top) * vp.pxPerM);
          if (y1 - y0 >= minH) {
            const text = classLabel(c);
            const w = ctx.measureText(text).width;
            const x = t.x + W - px;
            const y = (y0 + y1) / 2;
            const color = pt.solid[c]!;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(x - w - 2 * px, y - ph / 2, w + 2 * px, ph, ph / 2);
            ctx.fill();
            ctx.fillStyle = contrastRatio(color, '#ffffff') >= 3.2 ? '#ffffff' : '#111418';
            ctx.fillText(text, x - px, y + 0.5);
          }
        }
        start = i;
      }
      ctx.restore();
    },
    hit(frame: OverlayHitFrame, p): OverlayHit | null {
      if (!p.track || p.track.overlayId !== LITHOLOGY_FACIES_OVERLAY_ID) return null;
      const st = state(frame);
      if (!st.cls || !st.conf) return null;
      const depth = frame.data.depth;
      let i = lowerBound(depth, p.depth);
      if (i > 0 && (i >= depth.length || Math.abs(depth[i - 1]! - p.depth) < Math.abs(depth[i]! - p.depth))) i--;
      const z = `${formatNumber(depth[i], { digits: 2 })} m`;
      const c = st.cls[i];
      if (c === undefined || !Number.isFinite(c)) return { label: `Sin datos suficientes para sugerir litología\n${z}`, cursor: 'default' };
      const p1 = st.conf[i]!;
      const others: string[] = [];
      for (const [cc, pp] of [[st.cls2, st.conf2], [st.cls3, st.conf3]] as const) {
        const k = cc?.[i] ?? NaN;
        const v = pp?.[i] ?? NaN;
        if (Number.isFinite(k) && v >= 0.005) others.push(`${classLabel(k)} ${pct(v)}`);
      }
      const notes: string[] = [];
      if (p1 < st.minP) notes.push('incierta (bajo la probabilidad mínima)');
      if (LOW_SKILL_CLASSES.has(c)) notes.push('clase que el modelo apenas distingue');
      const lines = [
        `${classLabel(c)} ${pct(p1)}${notes.length ? ` · ${notes.join(' · ')}` : ''}`,
        ...(others.length ? [`Después: ${others.join(' · ')}`] : []),
        `${z} · sugerencia del modelo, no medida`,
      ];
      return { label: lines.join('\n'), cursor: 'default' };
    },
  },
];
