/**
 * Dibujo de una tendencia, independiente de los ejes (docs/decisiones/0008-tendencias-y-gradientes.md, D5).
 *
 * Recibe DOS mapeos dato→px (`x`: variable independiente, `y`: dependiente) y `transpose`:
 * - visor: x = profundidad → px vertical (`viewport.yOf`), y = valor → px horizontal con la escala de la pista (lineal
 *   o log, invertida o no) → `transpose: true`;
 * - crossplot / histograma (fase 7): x → px horizontal, y → px vertical → `transpose: false`.
 *
 * La curva del modelo se MUESTREA EN PÍXELES de forma adaptativa: se subdivide hasta que los puntos intermedios
 * queden a menos de `tolerance` px de la cuerda. Una recta lineal en una pista log es curva; en ejes lineales son 2
 * puntos. Los valores fuera de dominio (NaN) cortan el trazo. `trendGeometry` es pura (testeada); `drawTrend` solo
 * hace las llamadas al canvas.
 */
import { evalTrend, type TrendCoefficients } from '../../petro/regression';

export interface TrendMapping {
  /** Variable independiente → px a lo largo de su eje (NaN si no se puede ubicar). */
  x(v: number): number;
  /** Variable dependiente → px a lo largo de su eje (NaN si no se puede ubicar). Recibe `x` opcional para proyecciones dependientes de la profundidad (p. ej. exceso de presión o EMW en MDT). */
  y(v: number, x?: number): number;
  /** true: x va vertical y y horizontal (el visor, con la profundidad hacia abajo). */
  transpose: boolean;
}

/** Polilínea en px: [x0, y0, x1, y1, …]. */
export type Polyline = number[];

/** Coordenada máxima (px) que se pasa al canvas: más allá se recorta (el canvas pierde precisión con valores enormes). */
const PX_LIMIT = 1e5;
const MAX_DEPTH = 16;
const MAX_POINTS = 4000;

/** Punto (dato) → px, o null si no se puede ubicar. */
export function projectPoint(m: TrendMapping, x: number, y: number): [number, number] | null {
  const a = m.x(x);
  const b = m.y(y, x);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ca = Math.max(-PX_LIMIT, Math.min(PX_LIMIT, a));
  const cb = Math.max(-PX_LIMIT, Math.min(PX_LIMIT, b));
  return m.transpose ? [cb, ca] : [ca, cb];
}

function chordDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / len;
}

/**
 * Muestrea la tendencia entre x0 y x1 en px (adaptativo). Devuelve una o más polilíneas (se corta donde el modelo o
 * la escala no dan un valor: ln de x ≤ 0, valor ≤ 0 en una escala log).
 */
export function sampleTrendPath(c: TrendCoefficients, x0: number, x1: number, m: TrendMapping, tolerance = 0.35): Polyline[] {
  const out: Polyline[] = [];
  if (!(Number.isFinite(x0) && Number.isFinite(x1)) || x0 === x1) return out;
  let cur: Polyline | null = null;
  let count = 0;
  const at = (x: number) => projectPoint(m, x, evalTrend(c, x));
  const push = (p: [number, number]) => {
    if (!cur) out.push((cur = []));
    cur.push(p[0], p[1]);
    count++;
  };
  const brk = () => {
    cur = null;
  };
  const seg = (xa: number, pa: [number, number] | null, xb: number, pb: [number, number] | null, depth: number): void => {
    const xm = (xa + xb) / 2;
    const pm = at(xm);
    if (pa && pb && pm) {
      // Recto si el medio y los cuartos quedan sobre la cuerda.
      let ok = depth >= MAX_DEPTH || count >= MAX_POINTS || chordDistance(pm, pa, pb) <= tolerance;
      if (ok && depth < 2) {
        const q1 = at((xa + xm) / 2);
        const q3 = at((xm + xb) / 2);
        ok = !!q1 && !!q3 && chordDistance(q1, pa, pb) <= tolerance && chordDistance(q3, pa, pb) <= tolerance;
      }
      if (ok) {
        push(pb);
        return;
      }
    } else if (depth >= MAX_DEPTH || count >= MAX_POINTS || (!pa && !pb && !pm && depth >= 4)) {
      // Tramo sin valor (o no se puede refinar más): se corta el trazo.
      brk();
      if (pb) push(pb);
      return;
    }
    seg(xa, pa, xm, pm, depth + 1);
    seg(xm, pm, xb, pb, depth + 1);
  };
  const p0 = at(x0);
  if (p0) push(p0);
  seg(x0, p0, x1, at(x1), 0);
  return out.filter((l) => l.length >= 4);
}

export interface TrendGeometryInput {
  coeffs: TrendCoefficients;
  /** Tramo sólido (ajustado o entre los dos puntos), en unidades de x. */
  span: [number, number];
  /** Rango de x visible (para recortar el muestreo y la extensión). */
  visible: [number, number];
  /** Dibujar la extensión (punteada) hasta el borde visible. */
  extend: boolean;
  mapping: TrendMapping;
  /** Manijas en datos (en el ajuste, los extremos del tramo sobre la curva; a mano, los dos puntos). */
  handles: readonly { x: number; y: number }[];
  tolerance?: number;
}

export interface TrendGeometry {
  solid: Polyline[];
  dashed: Polyline[];
  /** Manijas en px (null si no se pueden ubicar). */
  handles: ([number, number] | null)[];
  /** Ancla para la etiqueta: el primer punto visible del tramo sólido (null si no se ve). */
  anchor: [number, number] | null;
  /** Punto medio (en x de datos) del tramo sólido visible, en px: ancla de las etiquetas «al costado». */
  middle: [number, number] | null;
}

export function trendGeometry(g: TrendGeometryInput): TrendGeometry {
  const [s0, s1] = g.span[0] <= g.span[1] ? g.span : [g.span[1], g.span[0]];
  const [v0, v1] = g.visible[0] <= g.visible[1] ? g.visible : [g.visible[1], g.visible[0]];
  const tol = g.tolerance ?? 0.35;
  const a = Math.max(s0, v0);
  const b = Math.min(s1, v1);
  const solid = a < b ? sampleTrendPath(g.coeffs, a, b, g.mapping, tol) : [];
  const dashed: Polyline[] = [];
  if (g.extend) {
    if (v0 < s0) dashed.push(...sampleTrendPath(g.coeffs, v0, Math.min(s0, v1), g.mapping, tol));
    if (v1 > s1) dashed.push(...sampleTrendPath(g.coeffs, Math.max(s1, v0), v1, g.mapping, tol));
  }
  const first = solid[0];
  return {
    solid,
    dashed,
    handles: g.handles.map((h) => projectPoint(g.mapping, h.x, h.y)),
    anchor: first ? [first[0]!, first[1]!] : null,
    middle: a < b ? projectPoint(g.mapping, (a + b) / 2, evalTrend(g.coeffs, (a + b) / 2)) : null,
  };
}

/** Distancia (px) de un punto a la polilínea más cercana (para el `hit` sobre la línea). */
export function distanceToPolylines(lines: readonly Polyline[], px: number, py: number): number {
  let best = Infinity;
  for (const l of lines) {
    for (let k = 0; k + 3 < l.length; k += 2) {
      const ax = l[k]!;
      const ay = l[k + 1]!;
      const bx = l[k + 2]!;
      const by = l[k + 3]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best) best = d;
    }
  }
  return best;
}

// ── canvas ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TrendStyle {
  color: string;
  /** Color de fondo para el halo de la línea y el relleno de las manijas. */
  halo: string;
  width?: number;
  /** Seleccionada o en edición: más gruesa y manijas grandes. */
  emphasis?: boolean;
  /** Manija activa (teclado o último arrastre): índice en `handles`. */
  activeHandle?: number | null;
  /** Atenuada (vista previa de un tramo con error, o la original mientras se arrastra su copia). */
  dim?: boolean;
}

function strokePolylines(ctx: CanvasRenderingContext2D, lines: readonly Polyline[]): void {
  ctx.beginPath();
  for (const l of lines) {
    ctx.moveTo(l[0]!, l[1]!);
    for (let k = 2; k + 1 < l.length; k += 2) ctx.lineTo(l[k]!, l[k + 1]!);
  }
  ctx.stroke();
}

export function drawTrend(ctx: CanvasRenderingContext2D, geom: TrendGeometry, style: TrendStyle): void {
  const w = style.width ?? (style.emphasis ? 2.25 : 1.75);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (style.dim) ctx.globalAlpha = 0.45;
  if (geom.dashed.length) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(1, w - 0.5);
    ctx.setLineDash([5, 4]);
    ctx.globalAlpha *= 0.85;
    strokePolylines(ctx, geom.dashed);
    ctx.globalAlpha = style.dim ? 0.45 : 1;
    ctx.setLineDash([]);
  }
  if (geom.solid.length) {
    // Halo del color de fondo: la línea se lee sobre las curvas y los rellenos.
    ctx.strokeStyle = style.halo;
    ctx.lineWidth = w + 3;
    ctx.globalAlpha *= 0.75;
    strokePolylines(ctx, geom.solid);
    ctx.globalAlpha = style.dim ? 0.45 : 1;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = w;
    strokePolylines(ctx, geom.solid);
  }
  geom.handles.forEach((h, i) => {
    if (!h) return;
    const active = style.activeHandle === i;
    const r = active ? 5.5 : style.emphasis ? 4.5 : 3.25;
    ctx.beginPath();
    ctx.arc(h[0], h[1], r, 0, 2 * Math.PI);
    ctx.fillStyle = active ? style.color : style.halo;
    ctx.fill();
    ctx.lineWidth = active ? 2 : 1.75;
    ctx.strokeStyle = style.color;
    ctx.stroke();
    if (active) {
      ctx.beginPath();
      ctx.arc(h[0], h[1], r + 3.5, 0, 2 * Math.PI);
      ctx.lineWidth = 1.25;
      ctx.globalAlpha *= 0.5;
      ctx.stroke();
      ctx.globalAlpha = style.dim ? 0.45 : 1;
    }
  });
  ctx.restore();
}

export interface LabelStyle {
  color: string;
  bg: string;
  border: string;
  ink: string;
  muted: string;
  font: string;
  fontStrong: string;
  /** Factor del tamaño de interfaz para la caja y sus márgenes (por defecto 1; las figuras usan 1). */
  ui?: number;
}

/**
 * Etiqueta compacta (ecuación; R² · gradiente) junto al ancla, dentro de `bounds` (x0, x1). Devuelve la caja
 * dibujada (para no tapar otras etiquetas).
 */
export function drawTrendLabel(
  ctx: CanvasRenderingContext2D,
  lines: readonly [string, string],
  anchor: [number, number],
  bounds: { x0: number; x1: number; y0: number; y1: number },
  style: LabelStyle,
  avoid: readonly { x: number; y: number; w: number; h: number }[] = [],
  /** 'above': arriba a la derecha del ancla (por defecto); 'beside': a la derecha, centrada en el ancla. */
  placement: 'above' | 'beside' = 'above',
): { x: number; y: number; w: number; h: number } {
  ctx.save();
  const u = style.ui ?? 1;
  // Medidas en px de Compacto × factor (sin redondear con factor 1: idéntico a antes en las figuras).
  const k = (n: number) => (u === 1 ? n : n * u);
  ctx.font = style.fontStrong;
  const w1 = ctx.measureText(lines[0]).width;
  ctx.font = style.font;
  const w2 = ctx.measureText(lines[1]).width;
  const single = lines[1] === '';
  const w = Math.ceil(Math.max(w1, single ? 0 : w2)) + k(18);
  const h = Math.round(single ? k(20) : k(34));
  let x = Math.min(bounds.x1 - w - 4, anchor[0] + 10);
  x = Math.max(bounds.x0 + 4, x);
  let y = placement === 'beside' ? anchor[1] - h / 2 : anchor[1] - h - 8;
  if (placement === 'above' && y < bounds.y0 + 4) y = anchor[1] + 10;
  y = Math.min(bounds.y1 - h - 4, Math.max(bounds.y0 + 4, y));
  // Si choca con otra etiqueta, se corre hacia abajo.
  for (let k = 0; k < 10; k++) {
    const hitBox = avoid.find((b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y);
    if (!hitBox) break;
    y = hitBox.y + hitBox.h + 4;
  }
  ctx.fillStyle = style.bg;
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = style.color;
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 6, 3, h - 11, 1.5);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.ink;
  ctx.font = style.fontStrong;
  ctx.fillText(lines[0], x + k(12), single ? y + h / 2 + 0.5 : y + k(11));
  if (!single) {
    ctx.fillStyle = style.muted;
    ctx.font = style.font;
    ctx.fillText(lines[1], x + k(12), y + k(24.5));
  }
  ctx.restore();
  return { x, y, w, h };
}
