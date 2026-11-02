/**
 * Color del Log Digitizer: CIELAB, distancia ΔE, máscaras de trazo y colores sugeridos. Puro (sin DOM).
 *
 * CIELAB (D65, observador 2°). sRGB 8 bits → lineal con la curva estándar  c_lin = ((c+0.055)/1.055)^2.4  (c/12.92 si
 * c ≤ 0.04045); XYZ = M · c_lin con la matriz sRGB D65 (IEC 61966-2-1); luego
 *     f(t) = t^(1/3)  si t > (6/29)^3,  si no  (t/(3·(6/29)^2)) + 4/29
 *     L* = 116 f(Y/Yn) − 16,  a* = 500 (f(X/Xn) − f(Y/Yn)),  b* = 200 (f(Y/Yn) − f(Z/Zn)),  blanco (0.95047, 1, 1.08883).
 * Referencia: CIE 15:2004. Valores de verificación en tests/digitizer/color.test.ts (blanco, negro, rojo, verde, azul).
 * ΔE*ab (CIE76) = distancia euclídea en L*a*b*. Es simple y suficiente para separar tintas de un registro; no pretende
 * la uniformidad perceptual de CIEDE2000.
 *
 * MÁSCARA DE COLOR. Un píxel anti-aliased es una mezcla  p ≈ bg + α (c − bg)  del papel (bg) y el trazo (c). En L*a*b* se
 * proyecta el píxel sobre el segmento bg→c:  α = ((p−bg)·(c−bg)) / |c−bg|²  y el residuo ρ = |(p−bg) − α (c−bg)| mide cuánto
 * se aparta del tono del trazo. Intensidad = 255 · clamp(α,0,1) · clamp(1 − ρ/tolerancia, 0, 1). Así un trazo fino de 1,5
 * px (cuyos píxeles son mezclas) sigue activo y los bordes suaves aportan cobertura parcial (centroides subpíxel), mientras
 * que el gris de la grilla o un trazo de otro color tienen residuo grande y quedan en cero.
 *
 * MÁSCARA OSCURA ("negro sobre claro"): intensidad = clamp((lightMin − L*)/(lightMin − lightMax), 0, 1) · (1 si croma ≤
 * chromaMax, decrece linealmente hasta 0 en 2·chromaMax). Atención: el borde oscuro de la pista también es "oscuro"; la
 * región de búsqueda debe quedar dentro de la pista.
 *
 * COLORES SUGERIDOS. Se descartan el papel (L* > 88 y croma < 12) y el gris claro de la grilla (croma < 12 y L* > 55); el
 * resto se cuantiza en bins de 6 unidades de L*a*b* y se agrupa con k-means ponderado determinista (inicio por
 * "farthest-first", sin azar). De cada grupo se toma como color representativo el promedio del 40 % más alejado del papel
 * (el trazo pleno, no las mezclas del anti-aliasing).
 */
import { DigitizerError, throwIfAborted, type ProgressOptions } from './errors';
import type { CurveColorSpec, RasterImage, Region, TraceMask } from './types';

export type Lab = [number, number, number];

const LIN = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return t;
})();

const XN = 0.95047;
const YN = 1;
const ZN = 1.08883;
const EPS = 216 / 24389;
const KAPPA_F = 24389 / 27 / 116; // (t·κ + 16)/116 = t·(κ/116) + 16/116

const f = (t: number) => (t > EPS ? Math.cbrt(t) : t * KAPPA_F + 16 / 116);

/** sRGB (0–255) → CIELAB [L*, a*, b*]. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = LIN[r < 0 ? 0 : r > 255 ? 255 : Math.round(r)]!;
  const gl = LIN[g < 0 ? 0 : g > 255 ? 255 : Math.round(g)]!;
  const bl = LIN[b < 0 ? 0 : b > 255 ? 255 : Math.round(b)]!;
  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;
  const fx = f(x / XN);
  const fy = f(y / YN);
  const fz = f(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIELAB → sRGB (0–255, redondeado y acotado). Inversa de `rgbToLab`. */
export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const finv = (t: number) => (t * t * t > EPS ? t * t * t : (t - 16 / 116) / KAPPA_F);
  const X = XN * finv(fx);
  const Y = YN * finv(fy);
  const Z = ZN * finv(fz);
  const rl = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const gl = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const bl = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  const enc = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(v * 255)));
  };
  return [enc(rl), enc(gl), enc(bl)];
}

/** ΔE*ab (CIE76): distancia euclídea entre dos colores L*a*b*. */
export function deltaE(p: Readonly<Lab>, q: Readonly<Lab>): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Recorta la región a la imagen (enteros). Lanza si queda vacía o no es un rectángulo válido. */
export function normalizeRegion(image: RasterImage, region?: Region): Region {
  const r = region ?? { x0: 0, y0: 0, x1: image.width, y1: image.height };
  if (![r.x0, r.y0, r.x1, r.y1].every(Number.isFinite)) throw new DigitizerError('invalid-region', 'La región de búsqueda tiene valores no numéricos.');
  const out: Region = {
    x0: Math.max(0, Math.floor(r.x0)),
    y0: Math.max(0, Math.floor(r.y0)),
    x1: Math.min(image.width, Math.ceil(r.x1)),
    y1: Math.min(image.height, Math.ceil(r.y1)),
  };
  if (!(out.x1 > out.x0) || !(out.y1 > out.y0)) {
    throw new DigitizerError('invalid-region', 'La región de búsqueda está vacía o fuera de la imagen: marcá un rectángulo dentro de la pista.');
  }
  return out;
}

function checkRaster(image: RasterImage): void {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new DigitizerError('invalid-image', 'La imagen está vacía o su tamaño no es válido.');
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new DigitizerError('invalid-image', `La imagen declara ${image.width}×${image.height} píxeles pero trae ${image.data.length} bytes.`);
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Defaults de la máscara de color y oscura (documentados en la decisión 0062). */
export const DEFAULT_COLOR_TOLERANCE = 28;
export const DEFAULT_DARK = { lightMax: 40, lightMin: 75, chromaMax: 30 } as const;

/**
 * Máscara de intensidad (0–255) del trazo de color `rgb` dentro de `region`. `background` = color del papel (blanco por
 * defecto). Devuelve una máscara del tamaño de la región (con su origen para volver a coordenadas de la imagen).
 */
export function colorMask(
  image: RasterImage,
  region: Region | undefined,
  rgb: readonly [number, number, number],
  tolerance: number = DEFAULT_COLOR_TOLERANCE,
  background: readonly [number, number, number] = [255, 255, 255],
  opts: ProgressOptions = {},
): TraceMask {
  checkRaster(image);
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new DigitizerError('invalid-options', 'La tolerancia de color debe ser un número positivo.');
  if (![...rgb, ...background].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) throw new DigitizerError('invalid-options', 'Los colores deben ser RGB entre 0 y 255.');
  const reg = normalizeRegion(image, region);
  const w = reg.x1 - reg.x0;
  const h = reg.y1 - reg.y0;
  const bg = rgbToLab(background[0], background[1], background[2]);
  const c = rgbToLab(rgb[0], rgb[1], rgb[2]);
  const d: Lab = [c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (dd < 100) {
    throw new DigitizerError('invalid-options', 'El color de la curva es casi igual al del papel (ΔE < 10): no se puede separar. Elegí otro color o el modo oscuro.');
  }
  const out = new Uint8Array(w * h);
  const src = image.data;
  let lastKey = -1;
  let lastVal = 0;
  const bgKey = (background[0] << 16) | (background[1] << 8) | background[2];
  for (let y = 0; y < h; y++) {
    if ((y & 1023) === 0) {
      throwIfAborted(opts.signal);
      opts.onProgress?.(y / h);
    }
    let i = ((reg.y0 + y) * image.width + reg.x0) * 4;
    let o = y * w;
    for (let x = 0; x < w; x++, i += 4, o++) {
      const r = src[i]!;
      const g = src[i + 1]!;
      const b = src[i + 2]!;
      const key = (r << 16) | (g << 8) | b;
      if (key === lastKey) {
        out[o] = lastVal;
        continue;
      }
      let val = 0;
      if (key !== bgKey) {
        const lab = rgbToLab(r, g, b);
        const p0 = lab[0] - bg[0];
        const p1 = lab[1] - bg[1];
        const p2 = lab[2] - bg[2];
        const t = (p0 * d[0] + p1 * d[1] + p2 * d[2]) / dd;
        if (t > 0) {
          const rho = Math.hypot(p0 - t * d[0], p1 - t * d[1], p2 - t * d[2]);
          const q = 1 - rho / tolerance;
          if (q > 0) val = Math.round(255 * clamp01(t) * q);
        }
      }
      lastKey = key;
      lastVal = val;
      out[o] = val;
    }
  }
  opts.onProgress?.(1);
  return { x0: reg.x0, y0: reg.y0, width: w, height: h, data: out };
}

/** Máscara de trazo oscuro (negro/gris oscuro sobre fondo claro) dentro de `region`. */
export function darkMask(
  image: RasterImage,
  region: Region | undefined,
  params: { lightMax?: number; lightMin?: number; chromaMax?: number } = {},
  opts: ProgressOptions = {},
): TraceMask {
  checkRaster(image);
  const lightMax = params.lightMax ?? DEFAULT_DARK.lightMax;
  const lightMin = params.lightMin ?? DEFAULT_DARK.lightMin;
  const chromaMax = params.chromaMax ?? DEFAULT_DARK.chromaMax;
  if (!(lightMin > lightMax) || !(chromaMax > 0) || ![lightMax, lightMin, chromaMax].every(Number.isFinite)) {
    throw new DigitizerError('invalid-options', 'Los umbrales del modo oscuro no son válidos (se requiere L* claro mayor que L* oscuro y croma máximo positivo).');
  }
  const reg = normalizeRegion(image, region);
  const w = reg.x1 - reg.x0;
  const h = reg.y1 - reg.y0;
  const out = new Uint8Array(w * h);
  const src = image.data;
  let lastKey = -1;
  let lastVal = 0;
  for (let y = 0; y < h; y++) {
    if ((y & 1023) === 0) {
      throwIfAborted(opts.signal);
      opts.onProgress?.(y / h);
    }
    let i = ((reg.y0 + y) * image.width + reg.x0) * 4;
    let o = y * w;
    for (let x = 0; x < w; x++, i += 4, o++) {
      const r = src[i]!;
      const g = src[i + 1]!;
      const b = src[i + 2]!;
      const key = (r << 16) | (g << 8) | b;
      if (key === lastKey) {
        out[o] = lastVal;
        continue;
      }
      let val = 0;
      if (r < 200 || g < 200 || b < 200) {
        const [L, a, bb] = rgbToLab(r, g, b);
        const dark = clamp01((lightMin - L) / (lightMin - lightMax));
        if (dark > 0) {
          const chroma = Math.hypot(a, bb);
          const chromaOk = chroma <= chromaMax ? 1 : clamp01(2 - chroma / chromaMax);
          val = Math.round(255 * dark * chromaOk);
        }
      }
      lastKey = key;
      lastVal = val;
      out[o] = val;
    }
  }
  opts.onProgress?.(1);
  return { x0: reg.x0, y0: reg.y0, width: w, height: h, data: out };
}

/** Máscara según la especificación de color de una curva. */
export function buildMask(image: RasterImage, region: Region | undefined, spec: CurveColorSpec, opts: ProgressOptions = {}): TraceMask {
  if (spec.mode === 'dark') return darkMask(image, region, spec, opts);
  return colorMask(image, region, spec.rgb, spec.tolerance ?? DEFAULT_COLOR_TOLERANCE, spec.background ?? [255, 255, 255], opts);
}

// ---------------------------------------------------------------------------------------------------------------
// Colores sugeridos
// ---------------------------------------------------------------------------------------------------------------

export interface SuggestedColor {
  rgb: [number, number, number];
  lab: Lab;
  /** Fracción de los píxeles "de tinta" (no papel ni grilla) que pertenecen a este color. */
  fraction: number;
  /** Cantidad de píxeles (de la muestra) del grupo. */
  count: number;
  /** 'dark' = negro/gris oscuro (usar modo oscuro); 'color' = tinta de color. */
  kind: 'dark' | 'color';
  /** Especificación lista para `CurveColorSpec`. */
  spec: CurveColorSpec;
}

export interface ColorSuggestions {
  colors: SuggestedColor[];
  /** Color del papel estimado (RGB). */
  background: [number, number, number];
  /** Píxeles de tinta encontrados / píxeles examinados. */
  inkPixels: number;
  sampledPixels: number;
}

export interface SuggestOptions {
  /** Máximo de colores devueltos. Por defecto 5. */
  maxColors?: number;
  /** Fracción mínima de tinta para conservar un grupo. Por defecto 0,02. */
  minFraction?: number;
  /** Se examina un píxel de cada `stride` en x e y (por defecto se elige para ≈ 1,5 millones de píxeles como máximo). */
  stride?: number;
  /** ΔE por debajo del cual dos grupos se fusionan. Por defecto 20. */
  mergeDeltaE?: number;
}

const BIN = 6;

/**
 * Propone los colores dominantes de trazo en `region` (para que el usuario elija con un clic). Determinista.
 * No lanza por falta de tinta: devuelve `colors: []`.
 */
export function suggestCurveColors(image: RasterImage, region?: Region, options: SuggestOptions = {}): ColorSuggestions {
  checkRaster(image);
  const reg = normalizeRegion(image, region);
  const maxColors = Math.max(1, Math.floor(options.maxColors ?? 5));
  const minFraction = options.minFraction ?? 0.02;
  const mergeDE = options.mergeDeltaE ?? 20;
  const area = (reg.x1 - reg.x0) * (reg.y1 - reg.y0);
  const stride = Math.max(1, Math.floor(options.stride ?? Math.ceil(Math.sqrt(area / 1.5e6))));

  // 1) histograma de bins de tinta + candidatos a papel
  interface Bin {
    n: number;
    sL: number;
    sa: number;
    sb: number;
    key: number;
  }
  const bins = new Map<number, Bin>();
  const paper = new Map<number, number>();
  let ink = 0;
  let sampled = 0;
  const src = image.data;
  for (let y = reg.y0; y < reg.y1; y += stride) {
    for (let x = reg.x0; x < reg.x1; x += stride) {
      sampled++;
      const i = (y * image.width + x) * 4;
      const r = src[i]!;
      const g = src[i + 1]!;
      const b = src[i + 2]!;
      const [L, a, bb] = rgbToLab(r, g, b);
      const chroma = Math.hypot(a, bb);
      if (L > 88 && chroma < 12) {
        const pk = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        paper.set(pk, (paper.get(pk) ?? 0) + 1);
        continue;
      }
      if (chroma < 12 && L > 55) continue; // gris claro de la grilla
      if (L > 92) continue;
      ink++;
      const key = (Math.floor((L + 0) / BIN) + 20) * 1_000_000 + (Math.floor(a / BIN) + 40) * 1000 + (Math.floor(bb / BIN) + 40);
      let bin = bins.get(key);
      if (!bin) bins.set(key, (bin = { n: 0, sL: 0, sa: 0, sb: 0, key }));
      bin.n++;
      bin.sL += L;
      bin.sa += a;
      bin.sb += bb;
    }
  }
  let background: [number, number, number] = [255, 255, 255];
  let bestPaper = 0;
  for (const [pk, n] of paper) {
    if (n > bestPaper) {
      bestPaper = n;
      background = [((pk >> 10) << 3) | 4, (((pk >> 5) & 31) << 3) | 4, ((pk & 31) << 3) | 4];
    }
  }
  if (bestPaper > 0) {
    // promedio exacto de los píxeles de papel dominantes (el bin de 8 niveles es grueso)
    let sr = 0;
    let sg = 0;
    let sb2 = 0;
    let c = 0;
    const target = background;
    for (let y = reg.y0; y < reg.y1; y += stride) {
      for (let x = reg.x0; x < reg.x1; x += stride) {
        const i = (y * image.width + x) * 4;
        if (Math.abs(src[i]! - target[0]) <= 4 && Math.abs(src[i + 1]! - target[1]) <= 4 && Math.abs(src[i + 2]! - target[2]) <= 4) {
          sr += src[i]!;
          sg += src[i + 1]!;
          sb2 += src[i + 2]!;
          c++;
        }
      }
    }
    if (c > 0) background = [Math.round(sr / c), Math.round(sg / c), Math.round(sb2 / c)];
  }
  const result: ColorSuggestions = { colors: [], background, inkPixels: ink, sampledPixels: sampled };
  if (ink === 0) return result;

  // 2) k-means ponderado sobre los bins (determinista)
  const pts = [...bins.values()].sort((p, q) => q.n - p.n || p.key - q.key).map((b) => ({ lab: [b.sL / b.n, b.sa / b.n, b.sb / b.n] as Lab, n: b.n }));
  const k = Math.min(maxColors + 3, pts.length);
  const centers: Lab[] = [pts[0]!.lab];
  while (centers.length < k) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < pts.length; i++) {
      let dmin = Infinity;
      for (const c of centers) dmin = Math.min(dmin, deltaE(pts[i]!.lab, c));
      const score = dmin * Math.sqrt(pts[i]!.n);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0 || bestScore <= 0) break;
    centers.push(pts[best]!.lab);
  }
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 15; it++) {
    for (let i = 0; i < pts.length; i++) {
      let bj = 0;
      let bd = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const dj = deltaE(pts[i]!.lab, centers[j]!);
        if (dj < bd) {
          bd = dj;
          bj = j;
        }
      }
      assign[i] = bj;
    }
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const a = acc[assign[i]!]!;
      const n = pts[i]!.n;
      a[0]! += pts[i]!.lab[0] * n;
      a[1]! += pts[i]!.lab[1] * n;
      a[2]! += pts[i]!.lab[2] * n;
      a[3]! += n;
    }
    for (let j = 0; j < centers.length; j++) if (acc[j]![3]! > 0) centers[j] = [acc[j]![0]! / acc[j]![3]!, acc[j]![1]! / acc[j]![3]!, acc[j]![2]! / acc[j]![3]!];
  }

  // 3) representante de cada grupo: promedio del 40 % más alejado del papel; fusión de grupos parecidos
  const bgLab = rgbToLab(background[0], background[1], background[2]);
  interface Group {
    lab: Lab;
    n: number;
  }
  let groups: Group[] = [];
  for (let j = 0; j < centers.length; j++) {
    const members = pts.filter((_, i) => assign[i] === j).sort((p, q) => deltaE(q.lab, bgLab) - deltaE(p.lab, bgLab));
    const total = members.reduce((s, m) => s + m.n, 0);
    if (total === 0) continue;
    let need = total * 0.4;
    let sL = 0;
    let sa = 0;
    let sb = 0;
    let cnt = 0;
    for (const m of members) {
      const take = Math.min(m.n, need);
      sL += m.lab[0] * take;
      sa += m.lab[1] * take;
      sb += m.lab[2] * take;
      cnt += take;
      need -= take;
      if (need <= 0) break;
    }
    groups.push({ lab: [sL / cnt, sa / cnt, sb / cnt], n: total });
  }
  groups.sort((p, q) => q.n - p.n);
  const merged: Group[] = [];
  for (const g of groups) {
    const near = merged.find((m) => deltaE(m.lab, g.lab) < mergeDE);
    if (near) {
      const t = near.n + g.n;
      near.lab = [(near.lab[0] * near.n + g.lab[0] * g.n) / t, (near.lab[1] * near.n + g.lab[1] * g.n) / t, (near.lab[2] * near.n + g.lab[2] * g.n) / t];
      near.n = t;
    } else merged.push({ ...g });
  }
  groups = merged.filter((g) => g.n / ink >= minFraction).sort((p, q) => q.n - p.n).slice(0, maxColors);
  result.colors = groups.map((g) => {
    const rgb = labToRgb(g.lab[0], g.lab[1], g.lab[2]);
    const chroma = Math.hypot(g.lab[1], g.lab[2]);
    const dark = chroma < 20 && g.lab[0] < 50;
    return {
      rgb,
      lab: g.lab,
      fraction: g.n / ink,
      count: g.n,
      kind: dark ? 'dark' : 'color',
      spec: dark ? ({ mode: 'dark' } as const) : ({ mode: 'color', rgb, background } as const),
    } satisfies SuggestedColor;
  });
  return result;
}
