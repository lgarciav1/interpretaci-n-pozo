/**
 * Generador de imágenes sintéticas de registros de pozo para validar el Log Digitizer. Puro: dibuja sobre buffers RGBA
 * (`{ width, height, data }`), sin canvas. Cada imagen viene con su VERDAD CONOCIDA: la función valor(profundidad) con la
 * que se dibujó cada curva y la geometría (fila ↔ profundidad, columnas de la pista).
 *
 * Qué sabe dibujar: grilla gris (líneas más oscuras cada 5), pista con borde, rótulos tipo texto (dentro y fuera de la
 * pista), curvas de trazo grueso con anti-aliasing, punteadas, de varios colores, cruces entre curvas, desenfoque leve,
 * ruido gaussiano, sal y pimienta y artefactos tipo JPEG (cuantización DCT por bloques de 8×8), y una transformación
 * geométrica arbitraria de TODOS los vértices (inclinación, perspectiva) aplicada al dibujar, no al remuestrear (así el
 * motor se prueba contra una deformación que no usa su propio código).
 */
import { valueToFraction, type AxisScale } from '../../src/viewer/scale';

export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export type RGB = [number, number, number];
export type Tf = (x: number, y: number) => [number, number];

/** PRNG determinista (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Normal estándar (Box–Muller). */
export function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

export function newImage(width: number, height: number, bg: RGB = [255, 255, 255]): Img {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Segmento con grosor, anti-aliasing por cobertura analítica (distancia al segmento) y mezcla alfa. */
export function drawSegment(img: Img, x1: number, y1: number, x2: number, y2: number, thickness: number, rgb: RGB): void {
  const half = thickness / 2;
  const pad = half + 1;
  const xa = Math.max(0, Math.floor(Math.min(x1, x2) - pad));
  const xb = Math.min(img.width - 1, Math.ceil(Math.max(x1, x2) + pad));
  const ya = Math.max(0, Math.floor(Math.min(y1, y2) - pad));
  const yb = Math.min(img.height - 1, Math.ceil(Math.max(y1, y2) + pad));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const d = img.data;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      let t = len2 === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      const dist = Math.hypot(x - px, y - py);
      const a = half + 0.5 - dist;
      if (a <= 0) continue;
      const alpha = a >= 1 ? 1 : a;
      const o = (y * img.width + x) * 4;
      d[o] = d[o]! * (1 - alpha) + rgb[0] * alpha;
      d[o + 1] = d[o + 1]! * (1 - alpha) + rgb[1] * alpha;
      d[o + 2] = d[o + 2]! * (1 - alpha) + rgb[2] * alpha;
    }
  }
}

export interface PolylineStyle {
  thickness: number;
  rgb: RGB;
  /** Patrón punteado a lo largo del trazo [px encendido, px apagado]. */
  dash?: [number, number];
  tf?: Tf;
}

/** Polilínea (vértices en el espacio de diseño); `tf` transforma cada vértice al espacio de la imagen. */
export function drawPolyline(img: Img, pts: ReadonlyArray<readonly [number, number]>, style: PolylineStyle): void {
  const tf = style.tf ?? ((x, y) => [x, y] as [number, number]);
  if (!style.dash) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = tf(pts[i - 1]![0], pts[i - 1]![1]);
      const [bx, by] = tf(pts[i]![0], pts[i]![1]);
      drawSegment(img, ax, ay, bx, by, style.thickness, style.rgb);
    }
    return;
  }
  const [on, off] = style.dash;
  let acc = 0; // posición dentro del ciclo
  const period = on + off;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1]!;
    const [x2, y2] = pts[i]!;
    const L = Math.hypot(x2 - x1, y2 - y1);
    let s = 0;
    while (s < L) {
      const inCycle = acc % period;
      const isOn = inCycle < on;
      const remain = (isOn ? on : period) - inCycle;
      const e = Math.min(L, s + remain);
      if (isOn) {
        const [ax, ay] = tf(x1 + ((x2 - x1) * s) / L, y1 + ((y2 - y1) * s) / L);
        const [bx, by] = tf(x1 + ((x2 - x1) * e) / L, y1 + ((y2 - y1) * e) / L);
        drawSegment(img, ax, ay, bx, by, style.thickness, style.rgb);
      }
      acc += e - s;
      s = e;
    }
  }
}

/** Rótulo "tipo texto": racimo de trazos cortos y finos (para ensuciar la imagen sin ser una curva). */
export function drawFakeText(img: Img, x: number, y: number, chars: number, rgb: RGB, r: () => number, tf?: Tf): void {
  const t = tf ?? ((px, py) => [px, py] as [number, number]);
  for (let c = 0; c < chars; c++) {
    const cx = x + c * 7;
    const strokes = 2 + Math.floor(r() * 3);
    for (let s = 0; s < strokes; s++) {
      const a = t(cx + r() * 5, y + r() * 9);
      const b = t(cx + r() * 5, y + r() * 9);
      drawSegment(img, a[0], a[1], b[0], b[1], 1.2, rgb);
    }
  }
}

/** Desenfoque de caja 3×3 (una pasada) sobre RGB. */
export function blur3(img: Img): Img {
  const out = newImage(img.width, img.height);
  const { width: w, height: h } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let n = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const xx = x + i;
            const yy = y + j;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            s += img.data[(yy * w + xx) * 4 + c]!;
            n++;
          }
        }
        out.data[(y * w + x) * 4 + c] = s / n;
      }
    }
  }
  return out;
}

export function addGaussianNoise(img: Img, sigma: number, r: () => number): void {
  for (let i = 0; i < img.width * img.height; i++) {
    const n = gauss(r) * sigma;
    for (let c = 0; c < 3; c++) img.data[i * 4 + c] = img.data[i * 4 + c]! + n;
  }
}

/** Sal y pimienta: con probabilidad `p` el píxel pasa a blanco o a negro (mitad y mitad). */
export function addSaltPepper(img: Img, p: number, r: () => number): void {
  for (let i = 0; i < img.width * img.height; i++) {
    if (r() < p) {
      const v = r() < 0.5 ? 0 : 255;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
    }
  }
}

const COS8 = (() => {
  const t: number[][] = [];
  for (let u = 0; u < 8; u++) {
    t.push([]);
    for (let x = 0; x < 8; x++) t[u]!.push(Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1));
  }
  return t;
})();

/**
 * Artefactos tipo JPEG: DCT 8×8 por canal, cuantización con paso q(u,v) = qBase·(1 + (u+v)/2) y transformada inversa.
 * qBase ≈ 4 es calidad alta; 10–14 calidad baja con bloques visibles.
 */
export function jpegLike(img: Img, qBase: number): void {
  const { width: w, height: h } = img;
  const blk = new Float64Array(64);
  const co = new Float64Array(64);
  for (let by = 0; by + 8 <= h; by += 8) {
    for (let bx = 0; bx + 8 <= w; bx += 8) {
      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = img.data[((by + y) * w + bx + x) * 4 + c]! - 128;
        for (let v = 0; v < 8; v++) {
          for (let u = 0; u < 8; u++) {
            let s = 0;
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += blk[y * 8 + x]! * COS8[u]![x]! * COS8[v]![y]!;
            const q = qBase * (1 + (u + v) / 2);
            co[v * 8 + u] = Math.round((s / 4) / q) * q;
          }
        }
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            let s = 0;
            for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) s += co[v * 8 + u]! * COS8[u]![x]! * COS8[v]![y]!;
            img.data[((by + y) * w + bx + x) * 4 + c] = s / 4 + 128;
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Registro sintético con verdad conocida
// ---------------------------------------------------------------------------------------------------------------

export interface SynthCurve {
  id: string;
  rgb: RGB;
  thickness: number;
  dash?: [number, number];
  scale: AxisScale;
  /** VERDAD: valor de la curva a la profundidad dada (m). */
  valueAt: (depthM: number) => number;
  /** Una muestra de la polilínea cada `every` filas (por defecto 1). */
  every?: number;
  /** Rango de profundidad en el que se dibuja (por defecto todo el tramo). */
  depthRange?: [number, number];
  /** Filas [desde, hasta) en las que se omite el trazo (huecos, p. ej. tapado por texto). */
  gaps?: Array<[number, number]>;
}

export interface SynthLogOptions {
  width: number;
  height: number;
  /** Columnas de los bordes izquierdo y derecho de la pista (espacio de diseño). */
  left: number;
  right: number;
  /** Profundidad (m) de la fila 0 y metros por fila. */
  topDepthM: number;
  dzMPerPx: number;
  curves: SynthCurve[];
  /** Separación (px) de las líneas horizontales de la grilla (cada 5.ª más oscura). 0 = sin grilla horizontal. */
  gridRows?: number;
  /** Divisiones verticales de la pista (cada 5.ª más oscura). 0 = sin grilla vertical. */
  gridCols?: number;
  /** Rótulos tipo texto fuera de la pista (cantidad) y dentro de ella (cantidad). */
  textOutside?: number;
  textInside?: number;
  blur?: boolean;
  noiseSigma?: number;
  saltPepper?: number;
  jpegQ?: number;
  tf?: Tf;
  seed?: number;
  /** Color del fondo. */
  bg?: RGB;
}

export interface SynthLog {
  image: Img;
  options: SynthLogOptions;
  /** Columna (espacio de diseño) de la curva verdadera en la fila `y`. */
  trueX: (curveId: string, y: number) => number;
  /** Valor verdadero de la curva en la fila `y`. */
  trueValue: (curveId: string, y: number) => number;
  depthAtRow: (y: number) => number;
}

const GRID_LIGHT: RGB = [222, 222, 222];
const GRID_DARK: RGB = [160, 160, 160];

export function renderLog(o: SynthLogOptions): SynthLog {
  const r = rng(o.seed ?? 1);
  const img = newImage(o.width, o.height, o.bg ?? [255, 255, 255]);
  const tf = o.tf;
  const depthAtRow = (y: number) => o.topDepthM + y * o.dzMPerPx;
  const line = (x1: number, y1: number, x2: number, y2: number, t: number, rgb: RGB) => drawPolyline(img, [[x1, y1], [x2, y2]], { thickness: t, rgb, ...(tf ? { tf } : {}) });

  if (o.gridRows) {
    for (let y = 0, k = 0; y < o.height; y += o.gridRows, k++) line(o.left, y, o.right, y, 1, k % 5 === 0 ? GRID_DARK : GRID_LIGHT);
  }
  if (o.gridCols) {
    for (let k = 0; k <= o.gridCols; k++) {
      const x = o.left + ((o.right - o.left) * k) / o.gridCols;
      line(x, 0, x, o.height - 1, 1, k % 5 === 0 ? GRID_DARK : GRID_LIGHT);
    }
  }
  // borde de la pista
  line(o.left, 0, o.left, o.height - 1, 2, [90, 90, 90]);
  line(o.right, 0, o.right, o.height - 1, 2, [90, 90, 90]);

  const trueX = (id: string, y: number): number => {
    const c = o.curves.find((k) => k.id === id)!;
    return o.left + valueToFraction(c.valueAt(depthAtRow(y)), c.scale) * (o.right - o.left);
  };
  for (const c of o.curves) {
    const every = c.every ?? 1;
    const pts: Array<[number, number]> = [];
    const flush = () => {
      if (pts.length > 1) drawPolyline(img, pts, { thickness: c.thickness, rgb: c.rgb, ...(c.dash ? { dash: c.dash } : {}), ...(tf ? { tf } : {}) });
      pts.length = 0;
    };
    for (let y = 0; y < o.height; y += every) {
      const d = depthAtRow(y);
      const inGap = (c.gaps ?? []).some(([a, b]) => y >= a && y < b);
      const outside = c.depthRange && (d < c.depthRange[0] || d > c.depthRange[1]);
      if (inGap || outside) {
        flush();
        continue;
      }
      pts.push([trueX(c.id, y), y]);
    }
    flush();
  }
  const text: RGB = [50, 50, 50];
  for (let k = 0; k < (o.textOutside ?? 0); k++) {
    drawFakeText(img, 4 + r() * Math.max(1, o.left - 60), r() * (o.height - 12), 5, text, r, tf);
  }
  for (let k = 0; k < (o.textInside ?? 0); k++) {
    drawFakeText(img, o.left + 10 + r() * (o.right - o.left - 60), r() * (o.height - 12), 6, text, r, tf);
  }
  let out = img;
  if (o.blur) out = blur3(out);
  if (o.noiseSigma) addGaussianNoise(out, o.noiseSigma, r);
  if (o.saltPepper) addSaltPepper(out, o.saltPepper, r);
  if (o.jpegQ) jpegLike(out, o.jpegQ);
  return {
    image: out,
    options: o,
    trueX,
    trueValue: (id, y) => o.curves.find((k) => k.id === id)!.valueAt(depthAtRow(y)),
    depthAtRow,
  };
}

/** Homografía independiente (aplicada en el generador): rotación + perspectiva suaves, como función de un punto. */
export function makeTf(m: readonly number[]): Tf {
  return (x, y) => {
    const w = m[6]! * x + m[7]! * y + m[8]!;
    return [(m[0]! * x + m[1]! * y + m[2]!) / w, (m[3]! * x + m[4]! * y + m[5]!) / w];
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Métricas de comparación
// ---------------------------------------------------------------------------------------------------------------

export interface FitStats {
  n: number;
  rmse: number;
  correlation: number;
  maxAbs: number;
}

/** Compara dos arrays ignorando los pares con NaN. */
export function compareArrays(a: ArrayLike<number>, b: ArrayLike<number>): FitStats {
  let n = 0;
  let sa = 0;
  let sb = 0;
  let ss = 0;
  let maxAbs = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    n++;
    sa += x;
    sb += y;
    ss += (x - y) ** 2;
    maxAbs = Math.max(maxAbs, Math.abs(x - y));
  }
  if (n === 0) return { n: 0, rmse: NaN, correlation: NaN, maxAbs: NaN };
  const ma = sa / n;
  const mb = sb / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    sab += (x - ma) * (y - mb);
    saa += (x - ma) ** 2;
    sbb += (y - mb) ** 2;
  }
  return { n, rmse: Math.sqrt(ss / n), correlation: sab / Math.sqrt(saa * sbb), maxAbs };
}
