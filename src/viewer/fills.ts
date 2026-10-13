/**
 * Geometría de rellenos entre dos perfiles x(y) sobre la misma grilla de y (muestras o filas de píxel). Puro.
 *
 * `fillBetween` recorre los tramos i → i+1 y emite cuadriláteros (o dos triángulos si las curvas se cruzan, con el
 * punto de cruce interpolado) a uno de dos destinos según qué curva queda a la izquierda EN PANTALLA:
 *   - `aLeft`: x_a < x_b (densidad a la izquierda del neutrón → cruce de gas)
 *   - `bLeft`: x_b < x_a (neutrón a la izquierda → separación de arcilla)
 * Los destinos son `Path2D` (en el visor) o cualquier objeto con moveTo/lineTo/closePath (en los tests). Rellenar
 * todos los polígonos de un destino con un solo `fill()` evita costuras entre tramos vecinos.
 * Un NaN en cualquiera de las dos curvas corta el relleno.
 */

export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

type Profile = ArrayLike<number> | number;

const at = (p: Profile, i: number): number => (typeof p === 'number' ? p : p[i]!);

// Puntos del tramo en curso (reusados entre llamadas: sin asignar memoria por cuadro).
const runA: number[] = [];
const runB: number[] = [];

/**
 * Rellena entre `xa` y `xb` (arrays o un valor fijo: borde de pista o línea base) para i en [0, n).
 * `lo`/`hi` acotan las x (bordes de la pista): un valor fuera de escala rellena hasta el borde.
 *
 * Emite UN polígono por tramo continuo del mismo lado (ida por `a`, vuelta por `b`), no uno por muestra: el
 * rasterizado de pocos polígonos grandes es mucho más barato que el de cientos de cuadriláteros.
 */
export function fillBetween(
  n: number,
  y: ArrayLike<number>,
  xa: Profile,
  xb: Profile,
  aLeft: PathSink | null,
  bLeft: PathSink | null,
  lo = -Infinity,
  hi = Infinity,
  /**
   * Opcional: diferencia a − b EN VALORES por punto. Si se da, decide el lado (y el punto de cruce) en vez de la
   * posición en pantalla: `aLeft` = a < b. Para rellenos que no deben depender de la escala (caliper vs. trépano).
   */
  valueDiff?: ArrayLike<number>,
): void {
  const clampX = (v: number) => (v < lo ? lo : v > hi ? hi : v);
  let side = 0; // −1: a a la izquierda; +1: b a la izquierda; 0: todavía iguales
  let pd = NaN; // diferencia a − b del punto anterior
  let pa = NaN;
  let pb = NaN;
  let py = NaN;
  runA.length = 0;
  runB.length = 0;
  const flush = () => {
    const sink = side < 0 ? aLeft : side > 0 ? bLeft : null;
    if (sink && runA.length >= 4) {
      sink.moveTo(runA[0]!, runA[1]!);
      for (let k = 2; k < runA.length; k += 2) sink.lineTo(runA[k]!, runA[k + 1]!);
      for (let k = runB.length - 2; k >= 0; k -= 2) sink.lineTo(runB[k]!, runB[k + 1]!);
      sink.closePath();
    }
    runA.length = 0;
    runB.length = 0;
  };
  for (let i = 0; i < n; i++) {
    const ca = clampX(at(xa, i));
    const cb = clampX(at(xb, i));
    const cy = y[i]!;
    const d = valueDiff ? valueDiff[i]! : ca - cb;
    if (ca !== ca || cb !== cb || cy !== cy || d !== d) {
      flush();
      side = 0;
      pd = NaN;
      continue;
    }
    const s = d < 0 ? -1 : d > 0 ? 1 : 0;
    if (pd === pd && s !== 0 && side !== 0 && s !== side) {
      // Cruce entre el punto anterior y este: se cierra el polígono en el punto de cruce y se abre otro.
      const t = pd / (pd - d);
      // Con valueDiff, x del cruce en cada curva por separado (pueden no coincidir en pantalla).
      const yc = py + t * (cy - py);
      const xc = pa + t * (ca - pa);
      const xcb = valueDiff ? pb + t * (cb - pb) : xc;
      runA.push(xc, yc);
      runB.push(xcb, yc);
      flush();
      runA.push(xc, yc);
      runB.push(xcb, yc);
      side = s;
    } else if (side === 0) side = s;
    runA.push(ca, cy);
    runB.push(cb, cy);
    pd = d;
    pa = ca;
    pb = cb;
    py = cy;
  }
  flush();
}

/** Destino que acumula el área (fórmula del área de Gauss) — para tests y para medir rellenos. */
export class AreaSink implements PathSink {
  area = 0;
  polygons = 0;
  private pts: number[] = [];
  moveTo(x: number, y: number) {
    this.pts = [x, y];
  }
  lineTo(x: number, y: number) {
    this.pts.push(x, y);
  }
  closePath() {
    const p = this.pts;
    let a = 0;
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      a += p[i]! * p[j + 1]! - p[j]! * p[i + 1]!;
    }
    this.area += Math.abs(a) / 2;
    this.polygons++;
    this.pts = [];
  }
}

/** Mosaico geométrico genérico en píxeles CSS; no depende de una escala de datos ni del ancho del relleno. */
export interface TilePattern {
  id: string;
  width: number;
  height: number;
  lines?: readonly (readonly [number, number, number, number])[];
  dots?: readonly (readonly [number, number, number])[];
  lineWidth?: number;
}
export interface PatternBox { x: number; y: number; width: number; height: number }
/** Extensión opcional de un grabador vectorial, sin acoplar el visor a ningún exportador. */
export interface PatternPainter {
  fillTiledRect(box: PatternBox, tile: TilePattern, background: string, stroke: string, scale: number): void;
}
const patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

/**
 * Rellena con CanvasPattern de un lienzo fuera de pantalla. La resolución sigue la transformación real (DPR o
 * exportación a alta densidad); setTransform devuelve el mosaico a unidades CSS. El origen es estable y nunca se
 * estira el dibujo al cambiar el ancho de una capa. Los exportadores pueden conservarlo vectorial con PatternPainter.
 */
export function fillPatternRect(ctx: CanvasRenderingContext2D, box: PatternBox, tile: TilePattern, background: string, stroke: string, scale = 1): void {
  if (![box.x, box.y, box.width, box.height, tile.width, tile.height, scale].every(Number.isFinite) || box.width <= 0 || box.height <= 0 || tile.width <= 0 || tile.height <= 0 || scale <= 0) return;
  const vector = ctx as CanvasRenderingContext2D & Partial<PatternPainter>;
  if (vector.fillTiledRect) { vector.fillTiledRect(box, tile, background, stroke, scale); return; }
  const transform = ctx.getTransform();
  const density = Math.max(1, Math.min(8, Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d))));
  const w = tile.width * scale, h = tile.height * scale;
  const key = JSON.stringify([tile, background, stroke, scale, density]);
  let cache = patternCache.get(ctx);
  if (!cache) { cache = new Map(); patternCache.set(ctx, cache); }
  let pattern = cache.get(key);
  if (!pattern) {
    const pw = Math.max(1, Math.ceil(w * density)), ph = Math.max(1, Math.ceil(h * density));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(pw, ph) : document.createElement('canvas');
    canvas.width = pw; canvas.height = ph;
    const scratch = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!scratch) throw new Error('No se pudo crear el mosaico del relleno.');
    scratch.scale(pw / tile.width, ph / tile.height);
    scratch.fillStyle = background;
    scratch.fillRect(0, 0, tile.width, tile.height);
    scratch.strokeStyle = stroke; scratch.fillStyle = stroke;
    scratch.lineWidth = tile.lineWidth ?? 0.8;
    scratch.beginPath();
    for (const [x0, y0, x1, y1] of tile.lines ?? []) { scratch.moveTo(x0, y0); scratch.lineTo(x1, y1); }
    scratch.stroke();
    for (const [x, y, r] of tile.dots ?? []) { scratch.beginPath(); scratch.arc(x, y, r, 0, Math.PI * 2); scratch.fill(); }
    pattern = ctx.createPattern(canvas, 'repeat') ?? undefined;
    if (!pattern) throw new Error('No se pudo repetir el mosaico del relleno.');
    pattern.setTransform({ a: w / pw, d: h / ph });
    // Cota de caché por lienzo: cambios continuos de tema, zoom o color no acumulan mosaicos sin límite.
    if (cache.size >= 64) cache.clear();
    cache.set(key, pattern);
  }
  ctx.save(); ctx.fillStyle = pattern; ctx.fillRect(box.x, box.y, box.width, box.height); ctx.restore();
}
