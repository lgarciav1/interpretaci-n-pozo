/**
 * Corrección geométrica del escaneo: inclinación (rotación) y perspectiva (homografía de 4 pares de puntos), con
 * remuestreo bilineal. Puro: trabaja sobre buffers RGBA (`RasterImage`), sin DOM.
 *
 * CONVENCIÓN: ver types.ts (centro del píxel (i,j) en (i,j); y hacia abajo).
 *
 * INCLINACIÓN. Con dos puntos p1 (arriba) y p2 (abajo) sobre una línea que debería ser vertical (p. ej. el borde de la
 * pista), el ángulo respecto de la vertical es  θ = atan2(dx, dy)  con (dx, dy) = p2 − p1 (dy > 0). Rotar la imagen
 * +θ alrededor de un centro c con  p ↦ c + R(θ)(p − c),  R = [[cos θ, −sin θ],[sin θ, cos θ]]  deja esa línea vertical.
 *
 * HOMOGRAFÍA. H (3×3, h22 = 1) lleva (x, y) a (u, v) con  u = (h0 x + h1 y + h2)/w,  v = (h3 x + h4 y + h5)/w,
 * w = h6 x + h7 y + 1. Cuatro pares dan 8 ecuaciones lineales en las 8 incógnitas h0..h7:
 *      x h0 + y h1 + h2 − u x h6 − u y h7 = u
 *      x h3 + y h4 + h5 − v x h6 − v y h7 = v
 * Estabilidad numérica (Hartley & Zisserman, "Multiple View Geometry", §4.4.4): antes de resolver se normalizan ambos
 * conjuntos de puntos (centroide al origen, distancia media √2); sin esto, con coordenadas de miles de píxeles el sistema
 * queda mal condicionado. El sistema 8×8 se resuelve por eliminación gaussiana con PIVOTEO PARCIAL (el pivote de mayor
 * valor absoluto de la columna) y se rechaza si un pivote es ~0 (puntos colineales/degenerados). Después se
 * desnormaliza:  H = T_dst⁻¹ · Hn · T_src.
 *
 * REMUESTREO. Para cada píxel de salida se aplica la inversa de H y se interpola bilinealmente entre los 4 píxeles
 * vecinos (los 4 canales). Fuera de la imagen de origen se usa `fill` (blanco opaco por defecto).
 */
import { DigitizerError, throwIfAborted, type ProgressOptions } from './errors';
import type { PixelPoint, RasterImage } from './types';

/** Homografía 3×3 por filas: [h0 h1 h2; h3 h4 h5; h6 h7 h8]. JSON puro. */
export type Homography = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const fail = (message: string): never => {
  throw new DigitizerError('invalid-geometry', message);
};

export function applyHomography(h: Readonly<Homography>, p: PixelPoint): PixelPoint {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

export function multiplyHomography(a: Readonly<Homography>, b: Readonly<Homography>): Homography {
  const o = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j]! += a[i * 3 + k]! * b[k * 3 + j]!;
  return o as Homography;
}

/** Inversa de una 3×3 (adjunta / determinante). Lanza si es singular. */
export function invertHomography(h: Readonly<Homography>): Homography {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) fail('La transformación no es invertible.');
  const inv: Homography = [
    A / det,
    -(b * j - c * i) / det,
    (b * f - c * e) / det,
    B / det,
    (a * j - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * i - b * g) / det,
    (a * e - b * d) / det,
  ];
  return inv;
}

/** Ángulo (rad) respecto de la vertical de la recta p1→p2; positivo si el punto de abajo queda a la derecha. */
export function estimateTiltAngle(p1: PixelPoint, p2: PixelPoint): number {
  let dx = p2.x - p1.x;
  let dy = p2.y - p1.y;
  if (![dx, dy].every(Number.isFinite)) fail('Los puntos de la línea vertical deben ser números.');
  if (dx === 0 && dy === 0) fail('Los dos puntos de la línea vertical coinciden.');
  if (dy < 0) {
    dx = -dx;
    dy = -dy;
  }
  if (Math.abs(dy) < Math.abs(dx) * 0.1) fail('Los dos puntos no definen una línea casi vertical (se separan más en horizontal que en vertical).');
  return Math.atan2(dx, dy);
}

/** Rotación de ángulo `angleRad` (convención de arriba) alrededor de (cx, cy), como homografía origen → destino. */
export function rotationHomography(angleRad: number, cx: number, cy: number): Homography {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy, 0, 0, 1];
}

function normalization(pts: readonly PixelPoint[]): Homography {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let d = 0;
  for (const p of pts) d += Math.hypot(p.x - cx, p.y - cy);
  d /= pts.length;
  if (!(d > 1e-9)) fail('Los puntos coinciden: no definen un cuadrilátero.');
  const s = Math.SQRT2 / d;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

function cross(o: PixelPoint, a: PixelPoint, b: PixelPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** true si los 4 puntos (en orden) forman un cuadrilátero convexo y no degenerado. */
export function isConvexQuad(q: readonly PixelPoint[]): boolean {
  if (q.length !== 4) return false;
  const signs = [0, 1, 2, 3].map((i) => cross(q[i]!, q[(i + 1) % 4]!, q[(i + 2) % 4]!));
  return signs.every((s) => s > 0) || signs.every((s) => s < 0);
}

/** true si hay tres puntos (de los 4) casi alineados o repetidos: seno del ángulo < 1e-4 respecto del tamaño. */
function hasCollinearTriple(p: readonly PixelPoint[]): boolean {
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (let k = j + 1; k < 4; k++) {
        const a = p[i]!;
        const b = p[j]!;
        const c = p[k]!;
        const area2 = Math.abs(cross(a, b, c));
        const scale = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y), Math.hypot(c.x - b.x, c.y - b.y));
        if (!(area2 > 1e-4 * scale * scale)) return true;
      }
    }
  }
  return false;
}

/** Resuelve A·x = b (n×n) por eliminación gaussiana con pivoteo parcial. Devuelve null si es singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  let scale = 0;
  for (const row of A) for (const v of row) scale = Math.max(scale, Math.abs(v));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12 * scale) return null;
    if (piv !== col) [M[piv], M[col]] = [M[col]!, M[piv]!];
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / M[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= M[r]![c]! * x[c]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

/**
 * Homografía que lleva 4 puntos de origen a 4 de destino (mismo orden). Lanza `DigitizerError` si los puntos son
 * degenerados (tres colineales, repetidos). No exige convexidad (eso lo exige `rectifyQuad`).
 */
export function homographyFromPoints(src: readonly PixelPoint[], dst: readonly PixelPoint[]): Homography {
  if (src.length !== 4 || dst.length !== 4) fail('Se necesitan exactamente 4 pares de puntos.');
  for (const p of [...src, ...dst]) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) fail('Los puntos deben ser números.');
  for (const [name, pts] of [['origen', src], ['destino', dst]] as const) {
    if (hasCollinearTriple(pts)) fail(`Los 4 puntos de ${name} son degenerados (hay tres alineados o repetidos): no definen una transformación.`);
  }
  const Ts = normalization(src);
  const Td = normalization(dst);
  const A: number[][] = [];
  const b: number[] = [];
  for (let k = 0; k < 4; k++) {
    const p = applyHomography(Ts, src[k]!);
    const q = applyHomography(Td, dst[k]!);
    A.push([p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y]);
    b.push(q.x);
    A.push([0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y]);
    b.push(q.y);
  }
  const h = solveLinear(A, b);
  if (!h || !h.every(Number.isFinite)) fail('Los 4 puntos son degenerados (hay tres alineados o repetidos): no definen una transformación.');
  const Hn: Homography = [h![0]!, h![1]!, h![2]!, h![3]!, h![4]!, h![5]!, h![6]!, h![7]!, 1];
  const H = multiplyHomography(invertHomography(Td), multiplyHomography(Hn, Ts));
  const k = H[8];
  return H.map((v) => v / k) as Homography;
}

const WHITE: readonly [number, number, number, number] = [255, 255, 255, 255];

/**
 * Remuestrea `src` con la transformación origen → destino `h` en una imagen de `outWidth × outHeight` (bilineal).
 * Fuera de la imagen de origen: `fill`. No modifica `src`. Admite progreso y cancelación (por bloques de filas).
 */
export function warpImage(
  src: RasterImage,
  h: Readonly<Homography>,
  outWidth: number,
  outHeight: number,
  opts: ProgressOptions & { fill?: readonly [number, number, number, number] } = {},
): RasterImage {
  checkImage(src);
  if (!Number.isInteger(outWidth) || !Number.isInteger(outHeight) || outWidth < 1 || outHeight < 1) {
    fail(`El tamaño de salida ${outWidth}×${outHeight} no es válido.`);
  }
  if (outWidth * outHeight > 120e6) fail('La imagen de salida es demasiado grande (más de 120 millones de píxeles).');
  const inv = invertHomography(h);
  const fill = opts.fill ?? WHITE;
  const out: RasterImage = { width: outWidth, height: outHeight, data: new Uint8ClampedArray(outWidth * outHeight * 4) };
  const sd = src.data;
  const od = out.data;
  const sw = src.width;
  const sh = src.height;
  const maxX = sw - 1;
  const maxY = sh - 1;
  for (let v = 0; v < outHeight; v++) {
    if ((v & 255) === 0) {
      throwIfAborted(opts.signal);
      opts.onProgress?.(v / outHeight);
    }
    let o = v * outWidth * 4;
    // numeradores y denominador afines en u para esta fila
    const nx0 = inv[1] * v + inv[2];
    const ny0 = inv[4] * v + inv[5];
    const w0 = inv[7] * v + inv[8];
    for (let u = 0; u < outWidth; u++, o += 4) {
      const w = inv[6] * u + w0;
      const x = (inv[0] * u + nx0) / w;
      const y = (inv[3] * u + ny0) / w;
      if (!(x >= -0.5 && x <= sw - 0.5 && y >= -0.5 && y <= sh - 0.5)) {
        od[o] = fill[0];
        od[o + 1] = fill[1];
        od[o + 2] = fill[2];
        od[o + 3] = fill[3];
        continue;
      }
      const xc = x < 0 ? 0 : x > maxX ? maxX : x;
      const yc = y < 0 ? 0 : y > maxY ? maxY : y;
      const x0 = Math.floor(xc);
      const y0 = Math.floor(yc);
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = xc - x0;
      const fy = yc - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      od[o] = sd[i00]! * w00 + sd[i10]! * w10 + sd[i01]! * w01 + sd[i11]! * w11;
      od[o + 1] = sd[i00 + 1]! * w00 + sd[i10 + 1]! * w10 + sd[i01 + 1]! * w01 + sd[i11 + 1]! * w11;
      od[o + 2] = sd[i00 + 2]! * w00 + sd[i10 + 2]! * w10 + sd[i01 + 2]! * w01 + sd[i11 + 2]! * w11;
      od[o + 3] = sd[i00 + 3]! * w00 + sd[i10 + 3]! * w10 + sd[i01 + 3]! * w01 + sd[i11 + 3]! * w11;
    }
  }
  opts.onProgress?.(1);
  return out;
}

export function checkImage(img: RasterImage): void {
  if (!img || !Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width < 1 || img.height < 1) {
    throw new DigitizerError('invalid-image', 'La imagen está vacía o su tamaño no es válido.');
  }
  if (img.data.length !== img.width * img.height * 4) {
    throw new DigitizerError('invalid-image', `La imagen declara ${img.width}×${img.height} píxeles pero trae ${img.data.length} bytes (se esperaban ${img.width * img.height * 4}, RGBA).`);
  }
}

export interface GeometryResult {
  image: RasterImage;
  /** Posición en la imagen original → posición en la corregida. */
  forward: Homography;
  /** Posición en la imagen corregida → posición en la original. */
  inverse: Homography;
}

/**
 * Rota la imagen `angleRad` (positivo = el punto de abajo de una línea inclinada hacia la derecha vuelve a la vertical,
 * ver `estimateTiltAngle`). Con `expand` el lienzo crece para que no se recorten las esquinas; si no, mantiene el tamaño
 * y rota alrededor del centro. `forward` permite llevar puntos marcados en la original a la imagen corregida.
 */
export function rotateImage(
  src: RasterImage,
  angleRad: number,
  opts: ProgressOptions & { expand?: boolean; fill?: readonly [number, number, number, number] } = {},
): GeometryResult {
  checkImage(src);
  if (!Number.isFinite(angleRad) || Math.abs(angleRad) > Math.PI / 4) {
    fail('El ángulo de corrección debe estar entre -45° y 45°; para inclinaciones mayores, girá la imagen antes.');
  }
  const cx = (src.width - 1) / 2;
  const cy = (src.height - 1) / 2;
  let H = rotationHomography(angleRad, cx, cy);
  let w = src.width;
  let h = src.height;
  if (opts.expand) {
    const corners = [
      { x: -0.5, y: -0.5 },
      { x: src.width - 0.5, y: -0.5 },
      { x: src.width - 0.5, y: src.height - 0.5 },
      { x: -0.5, y: src.height - 0.5 },
    ].map((p) => applyHomography(H, p));
    const minX = Math.min(...corners.map((p) => p.x));
    const maxX = Math.max(...corners.map((p) => p.x));
    const minY = Math.min(...corners.map((p) => p.y));
    const maxY = Math.max(...corners.map((p) => p.y));
    w = Math.ceil(maxX - minX);
    h = Math.ceil(maxY - minY);
    H = multiplyHomography([1, 0, -(minX + 0.5), 0, 1, -(minY + 0.5), 0, 0, 1], H);
  }
  const image = warpImage(src, H, w, h, opts);
  return { image, forward: H, inverse: invertHomography(H) };
}

/**
 * Rectifica la perspectiva: el cuadrilátero `quad` (sup-izq, sup-der, inf-der, inf-izq, en la imagen de entrada) pasa a
 * ser el rectángulo completo de `outWidth × outHeight` (esquinas en (0,0), (W-1,0), (W-1,H-1), (0,H-1)). Pensado para
 * marcar las 4 esquinas del marco de una pista o de la página.
 */
export function rectifyQuad(
  src: RasterImage,
  quad: readonly [PixelPoint, PixelPoint, PixelPoint, PixelPoint],
  outWidth: number,
  outHeight: number,
  opts: ProgressOptions & { fill?: readonly [number, number, number, number] } = {},
): GeometryResult {
  checkImage(src);
  if (!Number.isInteger(outWidth) || !Number.isInteger(outHeight) || outWidth < 2 || outHeight < 2) {
    fail(`El tamaño de salida ${outWidth}×${outHeight} no es válido (mínimo 2×2 enteros).`);
  }
  if (!isConvexQuad(quad)) fail('Las 4 esquinas deben formar un cuadrilátero convexo, marcadas en orden: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda.');
  const dst: PixelPoint[] = [
    { x: 0, y: 0 },
    { x: outWidth - 1, y: 0 },
    { x: outWidth - 1, y: outHeight - 1 },
    { x: 0, y: outHeight - 1 },
  ];
  const H = homographyFromPoints(quad, dst);
  const image = warpImage(src, H, outWidth, outHeight, opts);
  return { image, forward: H, inverse: invertHomography(H) };
}
