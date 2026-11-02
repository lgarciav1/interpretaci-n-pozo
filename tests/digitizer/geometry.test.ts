/**
 * Corrección geométrica: homografía (4 pares), rotación y rectificación de perspectiva. Las imágenes deformadas las
 * produce el generador sintético transformando los vértices al dibujar (código independiente del motor); se recuperan
 * con el motor y se mide el error de píxel.
 */
import { describe, expect, it } from 'vitest';
import { DigitizerError } from '../../src/digitizer/errors';
import {
  applyHomography,
  estimateTiltAngle,
  homographyFromPoints,
  invertHomography,
  isConvexQuad,
  rectifyQuad,
  rotateImage,
  warpImage,
  type Homography,
} from '../../src/digitizer/geometry';
import type { PixelPoint, RasterImage } from '../../src/digitizer/types';
import { makeTf, renderLog, type Img } from './synth';

const near = (a: PixelPoint, b: PixelPoint, tol: number) => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
};

describe('homografía de 4 pares de puntos', () => {
  it('lleva los 4 puntos de origen a los de destino (error < 1e-9) y es una proyección general', () => {
    const src: PixelPoint[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
    const dst: PixelPoint[] = [{ x: 10, y: 12 }, { x: 118, y: 25 }, { x: 131, y: 230 }, { x: 4, y: 190 }];
    const H = homographyFromPoints(src, dst);
    for (let i = 0; i < 4; i++) near(applyHomography(H, src[i]!), dst[i]!, 1e-9);
    expect(H[8]).toBe(1);
    // un quinto punto (centro) cae dentro del cuadrilátero destino
    const c = applyHomography(H, { x: 50, y: 100 });
    expect(c.x).toBeGreaterThan(40);
    expect(c.x).toBeLessThan(110);
  });

  it('recupera una H conocida con coordenadas de miles de píxeles (la normalización de Hartley evita el mal condicionamiento)', () => {
    // H conocida: escala, giro de ~3°, traslación grande y perspectiva pequeña
    const a = (3 * Math.PI) / 180;
    const Hk: Homography = [Math.cos(a) * 1.1, -Math.sin(a), 1500, Math.sin(a), Math.cos(a) * 0.9, -800, 2e-6, -1e-6, 1];
    const src: PixelPoint[] = [{ x: 200, y: 300 }, { x: 1700, y: 250 }, { x: 1650, y: 11800 }, { x: 150, y: 11700 }];
    const dst = src.map((p) => applyHomography(Hk, p));
    const H = homographyFromPoints(src, dst);
    for (const p of [{ x: 900, y: 6000 }, { x: 300, y: 9000 }, { x: 1600, y: 1000 }]) {
      near(applyHomography(H, p), applyHomography(Hk, p), 1e-6);
    }
    // inversa: H⁻¹ · H = I
    const Hi = invertHomography(H);
    near(applyHomography(Hi, applyHomography(H, { x: 777, y: 4321 })), { x: 777, y: 4321 }, 1e-7);
  });

  it('puntos degenerados (tres alineados, repetidos) o cantidad incorrecta: error en español, sin excepción rara', () => {
    const line: PixelPoint[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, { x: 5, y: 40 }];
    const sq: PixelPoint[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(() => homographyFromPoints(line, sq)).toThrow(DigitizerError);
    expect(() => homographyFromPoints(line, sq)).toThrow(/degenerados/);
    expect(() => homographyFromPoints(sq, [sq[0]!, sq[0]!, sq[0]!, sq[0]!])).toThrow(/degenerados/);
    expect(() => homographyFromPoints(sq.slice(0, 3), sq.slice(0, 3))).toThrow(/exactamente 4 pares/);
    expect(() => homographyFromPoints(sq, [...sq.slice(0, 3), { x: NaN, y: 0 }])).toThrow(/números/);
  });

  it('convexidad del cuadrilátero', () => {
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(true);
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false); // moño
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }, { x: 0, y: 10 }])).toBe(false); // cóncavo
  });
});

describe('inclinación', () => {
  it('ángulo de una línea que debería ser vertical: (100,0)→(110,100) = atan(0,1)', () => {
    expect(estimateTiltAngle({ x: 100, y: 0 }, { x: 110, y: 100 })).toBeCloseTo(Math.atan(0.1), 12);
    // el orden de los puntos no importa
    expect(estimateTiltAngle({ x: 110, y: 100 }, { x: 100, y: 0 })).toBeCloseTo(Math.atan(0.1), 12);
    expect(estimateTiltAngle({ x: 5, y: 0 }, { x: -5, y: 100 })).toBeCloseTo(-Math.atan(0.1), 12);
    expect(estimateTiltAngle({ x: 3, y: 0 }, { x: 3, y: 50 })).toBe(0);
  });

  it('puntos inválidos: error', () => {
    expect(() => estimateTiltAngle({ x: 1, y: 1 }, { x: 1, y: 1 })).toThrow(/coinciden/);
    expect(() => estimateTiltAngle({ x: 0, y: 0 }, { x: 100, y: 5 })).toThrow(/casi vertical/);
    expect(() => estimateTiltAngle({ x: NaN, y: 0 }, { x: 1, y: 5 })).toThrow(DigitizerError);
  });

  it('imagen sintética inclinada 2,5° (vértices rotados por el generador): se endereza y el borde de la pista vuelve a ser vertical (error ≤ 0,5 px)', () => {
    const W = 600;
    const H = 1500;
    const angle = (2.5 * Math.PI) / 180;
    const cx = (W - 1) / 2;
    const cy = (H - 1) / 2;
    // El generador rota el espacio de diseño +ang alrededor del centro (y hacia abajo): el borde vertical queda inclinado.
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // un punto de arriba y otro de abajo del borde izquierdo de diseño (x = 150), según la rotación del generador
    const tf = makeTf([c, s, cx - c * cx - s * cy, -s, c, cy + s * cx - c * cy, 0, 0, 1]);
    const log = renderLog({ width: W, height: H, left: 150, right: 450, topDepthM: 0, dzMPerPx: 0.1, curves: [], gridCols: 10, tf, seed: 3 });
    const [x1, y1] = tf(150, 100);
    const [x2, y2] = tf(150, 1400);
    const est = estimateTiltAngle({ x: x1, y: y1 }, { x: x2, y: y2 });
    expect(Math.abs(est)).toBeCloseTo(angle, 6);
    const fixed = rotateImage(log.image as RasterImage, est);
    // el borde izquierdo (gris 90, 2 px) debe caer en x = 150 en todas las filas del centro
    const dev = edgeCentroids(fixed.image, 130, 170, 200, 1300).map((x) => x - 150);
    const maxDev = Math.max(...dev.map(Math.abs));
    const rms = Math.sqrt(dev.reduce((a, d) => a + d * d, 0) / dev.length);
    expect(maxDev).toBeLessThanOrEqual(0.5);
    expect(rms).toBeLessThanOrEqual(0.3);
    // y forward/inverse son coherentes
    near(applyHomography(fixed.inverse, applyHomography(fixed.forward, { x: 321, y: 654 })), { x: 321, y: 654 }, 1e-9);
    // con la imagen sin corregir el error es de varios píxeles (la prueba tiene dientes)
    const raw = edgeCentroids(log.image, 100, 230, 200, 1300).map((x) => x - 150);
    expect(Math.max(...raw.map(Math.abs))).toBeGreaterThan(5);
  });
});

/** Centroide horizontal (px) de la línea oscura del borde en cada fila, entre las columnas [xa, xb]. */
function edgeCentroids(img: Img | RasterImage, xa: number, xb: number, ya: number, yb: number): number[] {
  const out: number[] = [];
  for (let y = ya; y <= yb; y++) {
    let sw = 0;
    let sx = 0;
    for (let x = xa; x <= xb; x++) {
      const dark = 255 - img.data[(y * img.width + x) * 4 + 1]!;
      const w = dark > 60 ? dark : 0; // solo el borde (gris 90 → 165), no la grilla (≤ 95)
      sw += w;
      sx += w * x;
    }
    if (sw > 0) out.push(sx / sw);
  }
  return out;
}

describe('perspectiva', () => {
  /** Dibuja una pista con perspectiva (vértices transformados), rectifica con 4 esquinas marcadas y mide el error de líneas de la grilla. */
  function runPerspective(pickNoise: number): { vertMax: number; horizMax: number; rawSpread: number } {
    const W = 700;
    const H = 1800;
    // Homografía "de cámara": giro 1,5°, estrechamiento hacia arriba y traslación (independiente del motor)
    const a = (1.5 * Math.PI) / 180;
    const m = [Math.cos(a), -Math.sin(a), 30, Math.sin(a), Math.cos(a), 20, 1.2e-4, 2e-5, 1];
    const tf = makeTf(m);
    const left = 120;
    const right = 520;
    const log = renderLog({ width: W, height: H, left, right, topDepthM: 0, dzMPerPx: 0.1, curves: [], gridRows: 100, gridCols: 10, tf, seed: 4 });
    // El usuario marca las 4 esquinas del marco (tf de las esquinas de diseño) con un error de pick de ± pickNoise px.
    const corners: Array<[number, number]> = [[left, 0], [right, 0], [right, H - 1], [left, H - 1]];
    const quad = corners.map(([x, y], i) => {
      const [u, v] = tf(x, y);
      return { x: u + (i % 2 ? pickNoise : -pickNoise), y: v + (i < 2 ? pickNoise : -pickNoise) };
    }) as [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
    const outW = right - left + 1;
    const res = rectifyQuad(log.image as RasterImage, quad, outW, H);
    expect(res.image.width).toBe(outW);
    expect(res.image.height).toBe(H);
    // columnas de las líneas verticales de la grilla (cada 5.ª oscura) en la imagen rectificada: x = (diseño − left)
    let vertMax = 0;
    for (const xt of [2, 5, 8].map((k) => (right - left) * (k / 10))) {
      const xs = verticalLineCentroids(res.image, xt, 6, 200, 1600, 100);
      expect(xs.length).toBeGreaterThan(1200);
      vertMax = Math.max(vertMax, ...xs.map((x) => Math.abs(x - xt)));
    }
    // filas de la grilla horizontal (cada 100 px): y diseño = 100·k
    let horizMax = 0;
    for (const yt of [300, 500, 1000, 1500]) horizMax = Math.max(horizMax, Math.abs(horizontalLineCentroid(res.image, yt, 6, 100, outW - 100) - yt));
    // sin rectificar, las líneas están torcidas varios píxeles (la prueba tiene dientes)
    const raw = verticalLineCentroids(log.image, tf(left, 900)[0], 40, 200, 1600);
    return { vertMax, horizMax, rawSpread: Math.max(...raw) - Math.min(...raw) };
  }

  it('esquinas exactas: la pista rectificada queda con error de píxel ≤ 0,5 en líneas verticales y horizontales', () => {
    const r = runPerspective(0);
    expect(r.vertMax).toBeLessThanOrEqual(0.5);
    expect(r.horizMax).toBeLessThanOrEqual(0.5);
    expect(r.rawSpread).toBeGreaterThan(10);
  });

  it('esquinas marcadas con ±0,3 px de error: el error de las líneas queda acotado (≤ 1,5 px; la perspectiva amplifica el error de pick)', () => {
    const r = runPerspective(0.3);
    expect(r.vertMax).toBeLessThanOrEqual(1.5);
    expect(r.horizMax).toBeLessThanOrEqual(1.5);
  });

  it('rechaza esquinas fuera de orden o tamaños inválidos', () => {
    const img: RasterImage = { width: 50, height: 50, data: new Uint8ClampedArray(50 * 50 * 4).fill(255) };
    const bow: [PixelPoint, PixelPoint, PixelPoint, PixelPoint] = [{ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 40, y: 0 }, { x: 0, y: 40 }];
    expect(() => rectifyQuad(img, bow, 20, 20)).toThrow(/convexo/);
    const ok: [PixelPoint, PixelPoint, PixelPoint, PixelPoint] = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
    expect(() => rectifyQuad(img, ok, 1, 20)).toThrow(/no es válido/);
    expect(() => rectifyQuad(img, ok, 20.5, 20)).toThrow(/no es válido/);
    expect(() => rotateImage(img, 2)).toThrow(/entre -45° y 45°/);
    expect(() => rotateImage(img, NaN)).toThrow(DigitizerError);
    expect(() => warpImage({ width: 0, height: 5, data: new Uint8ClampedArray(0) }, [1, 0, 0, 0, 1, 0, 0, 0, 1], 5, 5)).toThrow(/imagen está vacía/);
    expect(() => warpImage({ width: 5, height: 5, data: new Uint8ClampedArray(10) }, [1, 0, 0, 0, 1, 0, 0, 0, 1], 5, 5)).toThrow(/bytes/);
  });
});

/** Centroide horizontal de la línea vertical en cada fila; se saltean las filas cercanas a líneas horizontales de la grilla. */
function verticalLineCentroids(img: Img | RasterImage, xTrue: number, halfWin: number, ya: number, yb: number, skipEvery = 0): number[] {
  const out: number[] = [];
  for (let y = ya; y <= yb; y++) {
    if (skipEvery && Math.min(y % skipEvery, skipEvery - (y % skipEvery)) <= 3) continue;
    let sw = 0;
    let sx = 0;
    for (let x = Math.max(0, Math.round(xTrue) - halfWin); x <= Math.min(img.width - 1, Math.round(xTrue) + halfWin); x++) {
      const dark = 255 - img.data[(y * img.width + x) * 4 + 1]!;
      const w = dark > 5 ? dark : 0;
      sw += w;
      sx += w * x;
    }
    if (sw > 0) out.push(sx / sw);
  }
  return out;
}

function horizontalLineCentroid(img: Img | RasterImage, yTrue: number, halfWin: number, xa: number, xb: number): number {
  const rows: number[] = [];
  for (let y = yTrue - halfWin; y <= yTrue + halfWin; y++) {
    let dark = 0;
    for (let x = xa; x <= xb; x++) dark += 255 - img.data[(y * img.width + x) * 4 + 1]!;
    rows.push(dark / (xb - xa + 1));
  }
  // las líneas verticales de la grilla aportan un fondo constante: se descuenta el mínimo
  const base = Math.min(...rows);
  let sw = 0;
  let sy = 0;
  rows.forEach((d, k) => {
    sw += d - base;
    sy += (d - base) * (yTrue - halfWin + k);
  });
  return sy / sw;
}

describe('remuestreo bilineal', () => {
  it('desplazar medio píxel promedia vecinos; identidad conserva la imagen; fuera de la imagen usa el relleno', () => {
    const img: RasterImage = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 200, 100, 50, 255]) };
    const half = warpImage(img, [1, 0, 0.5, 0, 1, 0, 0, 0, 1], 3, 1, { fill: [7, 8, 9, 10] });
    // salida x=0 muestrea la origen en -0,5 → borde (fuera: está justo en -0,5, dentro) = píxel 0; x=1 → 0,5 → promedio; x=2 → 1,5 → fuera
    expect(Array.from(half.data.slice(4, 8))).toEqual([100, 50, 25, 255]);
    expect(Array.from(half.data.slice(8, 12))).toEqual([200, 100, 50, 255]);
    const id = warpImage(img, [1, 0, 0, 0, 1, 0, 0, 0, 1], 2, 1);
    expect(Array.from(id.data)).toEqual(Array.from(img.data));
    const far = warpImage(img, [1, 0, 10, 0, 1, 0, 0, 0, 1], 3, 1, { fill: [7, 8, 9, 10] });
    expect(Array.from(far.data.slice(0, 4))).toEqual([7, 8, 9, 10]);
  });

  it('cancelación y progreso', () => {
    const img: RasterImage = { width: 20, height: 600, data: new Uint8ClampedArray(20 * 600 * 4).fill(255) };
    const ctl = new AbortController();
    ctl.abort();
    expect(() => warpImage(img, [1, 0, 0, 0, 1, 0, 0, 0, 1], 20, 600, { signal: ctl.signal })).toThrow(/se canceló/);
    const seen: number[] = [];
    warpImage(img, [1, 0, 0, 0, 1, 0, 0, 0, 1], 20, 600, { onProgress: (f) => seen.push(f) });
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.length).toBeGreaterThan(2);
  });
});
