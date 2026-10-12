/**
 * Segmentación de curvas, zonas sugeridas (L) y electrosecuencias (Geo-1): `src/petro/segmentation.ts`.
 * No hay resultados de libro que reproducir (la forma del GR es un criterio de interpretación: Rider y Kennedy 2011,
 * Serra 1985, Cant 1992): cada caso es una curva SINTÉTICA con respuesta conocida por construcción (profundidad del
 * escalón, signo y valor de la pendiente, forma de la secuencia), con ruido gaussiano de semilla fija donde se indica.
 * Convención de signos: pendiente = dGR/dprofundidad; > 0 el GR baja hacia arriba (embudo), < 0 sube hacia arriba (campana).
 * Después se corre sobre el pozo real del TP (datos/pozo_tp_perfiles.csv): los límites sugeridos se comparan con los
 * topes reales de zona A–E (ver el bloque al final: se informa la distancia, no se fuerza el resultado).
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import {
  ELECTROSEQUENCE_DEFAULTS,
  SEGMENTATION_DEFAULTS,
  ZONE_SUGGESTION_DEFAULTS,
  analyzeElectrosequences,
  classifyInterval,
  segmentCurve,
  segmentCurveBreakpoints,
  suggestZoneBoundaries,
} from '../src/petro/segmentation';

// --------------------------------------------------------------------------------------------------------------
// Generadores sintéticos

const STEP = 0.1524; // m, medio pie, como el pozo del TP
const D0 = 1000;

/** Generador pseudoaleatorio mulberry32 (determinista). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Normal estándar por Box–Muller. */
function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

function depthAxis(n: number): Float64Array {
  return Float64Array.from({ length: n }, (_, i) => D0 + i * STEP);
}

/** Curva por tramos: f(z) con z = metros desde D0, más ruido gaussiano de desvío `noise` (semilla fija). */
function synth(lengthM: number, f: (z: number) => number, noise = 0, seed = 1): { depth: Float64Array; gr: Float64Array } {
  const n = Math.round(lengthM / STEP);
  const depth = depthAxis(n);
  const r = rng(seed);
  const gr = Float64Array.from(depth, (d) => f(d - D0) + (noise > 0 ? noise * gauss(r) : 0));
  return { depth, gr };
}

const near = (x: number, y: number, tol: number) => Math.abs(x - y) <= tol;

// --------------------------------------------------------------------------------------------------------------

describe('parámetros por defecto', () => {
  it('son los documentados', () => {
    expect(SEGMENTATION_DEFAULTS).toMatchObject({ smoothWindow: 1, minThickness: 1.5, penalty: 8, maxGap: 3 });
    expect(ELECTROSEQUENCE_DEFAULTS).toMatchObject({ slopeThreshold: 0.5, minTrendChange: 8, serrationStd: 8, minCrossings: 4 });
    expect(ZONE_SUGGESTION_DEFAULTS).toMatchObject({ mergeContrast: 10, contrastWindow: 2, maxBoundaries: 0 });
  });
});

describe('escalón limpio: el límite cae en la profundidad exacta (± 1 muestra)', () => {
  const ZB = 25; // el escalón está en D0 + 25 m
  for (const noise of [0, 2]) {
    it(`GR 40 → 100 gAPI, ruido ${noise}`, () => {
      const { depth, gr } = synth(50, (z) => (z < ZB ? 40 : 100), noise, 11);
      const segs = segmentCurve(depth, gr);
      expect(segs).toHaveLength(2);
      const trueDepth = D0 + ZB;
      expect(near(segs[0]!.base, trueDepth, STEP)).toBe(true);
      expect(near(segs[1]!.top, trueDepth, STEP)).toBe(true);
      // tope de la primera = prof − h/2 de la primera muestra; base de la última = prof + h/2 de la última
      expect(segs[0]!.top).toBeCloseTo(D0 - STEP / 2, 9);
      expect(segs[1]!.base).toBeCloseTo(depth[depth.length - 1]! + STEP / 2, 9);
      expect(segs[0]!.mean).toBeCloseTo(40, 0);
      expect(segs[1]!.mean).toBeCloseTo(100, 0);

      const z = suggestZoneBoundaries(depth, gr);
      expect(z.boundaries).toHaveLength(1);
      const b = z.boundaries[0]!;
      expect(near(b.depth, trueDepth, STEP)).toBe(true);
      expect(b.contrast).toBeGreaterThan(55); // GR sube 60 al cruzarlo hacia abajo
      expect(b.contrast).toBeLessThan(65);
      expect(b.strength).toBeCloseTo(Math.abs(b.contrast), 9);
      expect(b.rank).toBe(1);
      expect(Math.abs(b.valueAbove - 40)).toBeLessThan(2);
      expect(Math.abs(b.valueBelow - 100)).toBeLessThan(2);
      // el índice es el de la primera muestra por debajo del límite
      expect(depth[b.index]! >= b.depth).toBe(true);
      expect(depth[b.index - 1]! < b.depth).toBe(true);
      expect(z.sections).toHaveLength(2);
    });
  }

  it('un escalón hacia abajo (GR 100 → 40) da contraste negativo', () => {
    const { depth, gr } = synth(40, (z) => (z < 20 ? 100 : 40), 1, 3);
    const b = suggestZoneBoundaries(depth, gr).boundaries;
    expect(b).toHaveLength(1);
    expect(b[0]!.contrast).toBeLessThan(-55);
    expect(near(b[0]!.depth, D0 + 20, STEP)).toBe(true);
  });

  it('dos escalones: se ordenan por fuerza y maxBoundaries conserva el más fuerte', () => {
    // 60 → 70 (salto 10) en 20 m y 70 → 130 (salto 60) en 40 m
    const { depth, gr } = synth(60, (z) => (z < 20 ? 60 : z < 40 ? 70 : 130), 1, 5);
    const all = suggestZoneBoundaries(depth, gr, { mergeContrast: 5 });
    expect(all.boundaries.map((b) => b.rank)).toEqual([2, 1]);
    expect(near(all.boundaries[0]!.depth, D0 + 20, STEP)).toBe(true);
    expect(near(all.boundaries[1]!.depth, D0 + 40, STEP)).toBe(true);
    // con el umbral por defecto (10 gAPI) el salto de ~10 queda borderline: con 15 seguro se fusiona
    const strong = suggestZoneBoundaries(depth, gr, { mergeContrast: 15 });
    expect(strong.boundaries).toHaveLength(1);
    expect(near(strong.boundaries[0]!.depth, D0 + 40, STEP)).toBe(true);
    expect(strong.sections).toHaveLength(2);
    // maxBoundaries = 1 conserva el más fuerte aunque el umbral deje los dos
    const top1 = suggestZoneBoundaries(depth, gr, { mergeContrast: 5, maxBoundaries: 1 });
    expect(top1.boundaries).toHaveLength(1);
    expect(near(top1.boundaries[0]!.depth, D0 + 40, STEP)).toBe(true);
  });
});

describe('forma de la secuencia (electrosecuencias)', () => {
  /** lutita (100) arriba y abajo con un cuerpo en [20, 50] m. */
  const body = (g: (u: number) => number) => (z: number) => (z >= 20 && z < 50 ? g((z - 20) / 30) : 100);

  it('rampa con GR que DISMINUYE hacia arriba (aumenta con la profundidad) → embudo, pendiente positiva', () => {
    // arriba 40, abajo 100 (continuo con la lutita de abajo); tope neto contra la lutita de arriba
    const { depth, gr } = synth(70, body((u) => 40 + 60 * u), 2, 21);
    const es = analyzeElectrosequences(depth, gr);
    const f = es.filter((e) => e.shape === 'funnel');
    expect(f).toHaveLength(1);
    const e = f[0]!;
    expect(e.slope).toBeGreaterThan(1.7); // 60 gAPI en 30 m = +2 gAPI/m
    expect(e.slope).toBeLessThan(2.3);
    expect(e.r2).toBeGreaterThan(0.9);
    expect(near(e.top, D0 + 20, 0.5)).toBe(true);
    expect(near(e.base, D0 + 50, 0.5)).toBe(true);
    expect(e.valueTop).toBeCloseTo(40, -1);
    expect(e.valueBase).toBeCloseTo(100, -1);
    expect(e.confidence).toBe('high');
    expect(e.trendChange).toBeGreaterThan(50);
    expect(e.shapeLabel).toMatch(/Embudo/);
    expect(e.interpretation).toMatch(/progradante/);
    expect(e.interpretation).toMatch(/Rider/);
    expect(e.description).toMatch(/disminuye hacia arriba/);
    // el techo es neto contra la lutita de arriba (salto ≈ −60 al pasar de lutita a arena)
    expect(e.topContrast).toBeLessThan(-40);
  });

  it('rampa con GR que AUMENTA hacia arriba (disminuye con la profundidad) → campana, pendiente negativa', () => {
    const { depth, gr } = synth(70, body((u) => 100 - 60 * u), 2, 22);
    const es = analyzeElectrosequences(depth, gr);
    const b = es.filter((e) => e.shape === 'bell');
    expect(b).toHaveLength(1);
    const e = b[0]!;
    expect(e.slope).toBeLessThan(-1.7);
    expect(e.slope).toBeGreaterThan(-2.3);
    expect(e.r2).toBeGreaterThan(0.9);
    expect(near(e.top, D0 + 20, 0.5)).toBe(true);
    expect(near(e.base, D0 + 50, 0.5)).toBe(true);
    expect(e.confidence).toBe('high');
    expect(e.interpretation).toMatch(/canal/);
    expect(e.description).toMatch(/aumenta hacia arriba/);
    // base neta contra la lutita de abajo
    expect(e.baseContrast).toBeGreaterThan(40);
    expect(e.interpretation).toMatch(/erosiva/);
  });

  it('bloque bajo y plano entre lutitas → cilindro de GR bajo', () => {
    const { depth, gr } = synth(70, body(() => 35), 2, 23);
    const es = analyzeElectrosequences(depth, gr);
    const c = es.filter((e) => e.shape === 'cylinder' && e.level === 'low');
    expect(c).toHaveLength(1);
    const e = c[0]!;
    expect(Math.abs(e.slope)).toBeLessThan(0.3);
    expect(e.mean).toBeCloseTo(35, 0);
    expect(near(e.top, D0 + 20, 0.5)).toBe(true);
    expect(near(e.base, D0 + 50, 0.5)).toBe(true);
    expect(e.confidence).toBe('high');
    expect(e.interpretation).toMatch(/arena/);
    // la lutita de arriba y la de abajo son cilindros de GR alto
    const shales = es.filter((x) => x.shape === 'cylinder' && x.level === 'high');
    expect(shales.length).toBe(2);
    expect(shales[0]!.interpretation).toMatch(/lutita/);
  });

  it('alternancias sin tendencia → UN solo tramo serrado (sin límites internos)', () => {
    // capas de 2,5 m de GR 30 / 90 de 20 a 60 m, entre lutitas planas de GR 90
    const alt = (z: number) => (z >= 20 && z < 60 ? (Math.floor((z - 20) / 2.5) % 2 === 0 ? 30 : 90) : 90);
    const { depth, gr } = synth(80, alt, 2, 24);
    const es = analyzeElectrosequences(depth, gr);
    const s = es.filter((e) => e.shape === 'serrated');
    expect(s).toHaveLength(1);
    const e = s[0]!;
    expect(e.thickness).toBeGreaterThan(36);
    expect(e.thickness).toBeLessThan(44);
    expect(near(e.top, D0 + 20, 3)).toBe(true);
    expect(Math.abs(e.slope)).toBeLessThan(0.5);
    expect(e.crossings).toBeGreaterThanOrEqual(ELECTROSEQUENCE_DEFAULTS.minCrossings);
    expect(e.residualStd).toBeGreaterThan(ELECTROSEQUENCE_DEFAULTS.serrationStd);
    expect(e.interpretation).toMatch(/Alternancia/);
    // sin la fusión, la racha se parte en varias capas delgadas
    const raw = segmentCurve(depth, gr, { mergeSerrated: false });
    expect(raw.length).toBeGreaterThan(8);
    const merged = segmentCurve(depth, gr);
    expect(merged.length).toBeLessThan(5);
    // y la sugerencia de zonas no propone límites dentro de la alternancia
    const z = suggestZoneBoundaries(depth, gr);
    // (la última capa de la alternancia, de GR 90, se funde con la lutita de abajo: el límite cae a ~57,5 m)
    expect(z.boundaries.every((b) => b.depth < D0 + 22 || b.depth > D0 + 55)).toBe(true);
  });

  it('campana sobre embudo con GR mínimo en el medio (unión continua) → un tramo simétrico «arena al centro»', () => {
    // 100 (lutita) hasta 20 m; baja a 40 en 35 m (campana arriba: GR sube hacia arriba), vuelve a 100 en 55 m; lutita.
    const sym = (z: number) => (z < 20 ? 100 : z < 35 ? 100 - 4 * (z - 20) : z < 50 ? 40 + 4 * (z - 35) : 100);
    const { depth, gr } = synth(70, sym, 1.5, 25);
    const es = analyzeElectrosequences(depth, gr);
    const s = es.filter((e) => e.shape === 'symmetric');
    expect(s).toHaveLength(1);
    expect(s[0]!.symmetry).toBe('sandCenter');
    expect(near(s[0]!.top, D0 + 20, 0.6)).toBe(true);
    expect(near(s[0]!.base, D0 + 50, 0.6)).toBe(true);
    expect(s[0]!.interpretation).toMatch(/retrogradación/);
    // sin la fusión simétrica quedan una campana arriba y un embudo abajo
    const split = analyzeElectrosequences(depth, gr, { mergeSymmetric: false });
    const shapes = split.map((e) => e.shape).filter((x) => x === 'bell' || x === 'funnel');
    expect(shapes).toEqual(['bell', 'funnel']);
  });

  it('classifyInterval sobre un intervalo dado: simétrico con arcilla al centro y forma de un embudo', () => {
    const shaleCenter = synth(30, (z) => (z < 15 ? 50 + 4 * z : 110 - 4 * (z - 15)), 1.5, 26);
    const sc = classifyInterval(shaleCenter.depth, shaleCenter.gr, D0, D0 + 30)!;
    expect(sc.shape).toBe('symmetric');
    expect(sc.symmetry).toBe('shaleCenter');
    expect(sc.interpretation).toMatch(/condensado/);
    const ramp = synth(30, (z) => 40 + 2 * z, 1.5, 27);
    const f = classifyInterval(ramp.depth, ramp.gr, D0 + 2, D0 + 28)!;
    expect(f.shape).toBe('funnel');
    expect(f.slope).toBeCloseTo(2, 0);
    expect(Number.isNaN(f.topContrast)).toBe(true);
    expect(classifyInterval(ramp.depth, ramp.gr, D0 + 1000, D0 + 1010)).toBeNull();
  });

  it('un tramo muy delgado o con un pico solitario queda «sin forma clara» con confianza baja', () => {
    const flat = synth(30, () => 60, 0, 1);
    expect(classifyInterval(flat.depth, flat.gr, D0 + 5, D0 + 5.3)).toBeNull(); // 2 muestras
    const thin = classifyInterval(flat.depth, flat.gr, D0 + 5, D0 + 5.6)!; // 4 muestras (< 5)
    expect(thin.shape).toBe('unclear');
    expect(thin.confidence).toBe('low');
    expect(thin.interpretation).toMatch(/demasiado delgado/);
    // un pico de 1 m (+90 gAPI) sin suavizar, en 20 m: variación fuerte sin alternancia ni tendencia
    const peak = synth(20, (z) => (z > 9 && z < 10 ? 150 : 60), 0, 1);
    const p = classifyInterval(peak.depth, peak.gr, D0, D0 + 20, { smoothWindow: 0 })!;
    expect(p.shape).toBe('unclear');
    expect(p.confidence).toBe('low');
    expect(p.crossings).toBe(0);
  });

  it('los textos usan coma decimal y la unidad configurada', () => {
    const { depth, gr } = synth(70, body((u) => 40 + 60 * u), 2, 21);
    const e = analyzeElectrosequences(depth, gr, { unit: 'cps' }).find((x) => x.shape === 'funnel')!;
    expect(e.description).toMatch(/\d,\d/);
    expect(e.description).toContain('cps');
    expect(e.description).not.toContain('gAPI');
  });
});

describe('datos faltantes (NaN)', () => {
  it('un hueco corto dentro de una zona plana no corta ni mueve el límite', () => {
    const base = synth(50, (z) => (z < 25 ? 40 : 100), 1, 31);
    const gapped = { depth: base.depth, gr: base.gr.slice() };
    const i0 = Math.round(10 / STEP);
    for (let i = i0; i < i0 + 6; i++) gapped.gr[i] = NaN; // 0,9 m sin dato
    const a = segmentCurve(base.depth, base.gr);
    const b = segmentCurve(gapped.depth, gapped.gr);
    expect(b).toHaveLength(2);
    expect(near(b[0]!.base, a[0]!.base, STEP)).toBe(true);
    expect(b[0]!.block).toBe(0);
    expect(b[1]!.block).toBe(0);
    // las muestras sin dato no cuentan
    expect(b[0]!.samples).toBeLessThan(a[0]!.samples);
    expect(b[0]!.mean).toBeCloseTo(40, 0);
  });

  it('un hueco corto justo sobre el escalón: el límite cae dentro del hueco', () => {
    const base = synth(50, (z) => (z < 25 ? 40 : 100), 1, 32);
    const gr = base.gr.slice();
    const i0 = Math.round(25 / STEP) - 3;
    for (let i = i0; i < i0 + 6; i++) gr[i] = NaN;
    const segs = segmentCurve(base.depth, gr);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.base).toBeGreaterThanOrEqual(base.depth[i0 - 1]!);
    expect(segs[0]!.base).toBeLessThanOrEqual(base.depth[i0 + 6]!);
    expect(segs[0]!.base).toBeCloseTo(segs[1]!.top, 9); // contiguos: sin vacío entre tramos
  });

  it('un hueco largo (> maxGap) separa bloques: no hay límite a través de él', () => {
    const base = synth(60, (z) => (z < 10 ? 40 : 100), 1, 33);
    const gr = base.gr.slice();
    const i0 = Math.round(30 / STEP);
    const gapLen = Math.round(10 / STEP);
    for (let i = i0; i < i0 + gapLen; i++) gr[i] = NaN;
    const segs = segmentCurve(base.depth, gr);
    expect(segs.map((s) => s.block)).toEqual([0, 0, 1]);
    const z = suggestZoneBoundaries(base.depth, gr);
    expect(z.boundaries).toHaveLength(1); // solo el escalón de 10 m
    expect(near(z.boundaries[0]!.depth, D0 + 10, STEP)).toBe(true);
    for (const b of z.boundaries) expect(b.depth < D0 + 30 || b.depth > D0 + 40).toBe(true);
    expect(z.sections).toHaveLength(3);
  });

  it('todo NaN o menos de 3 muestras válidas → sin tramos', () => {
    const depth = depthAxis(100);
    expect(segmentCurve(depth, new Float64Array(100).fill(NaN))).toEqual([]);
    const gr = new Float64Array(100).fill(NaN);
    gr[0] = 50;
    gr[1] = 51;
    expect(segmentCurve(depth, gr)).toEqual([]);
    expect(suggestZoneBoundaries(depth, gr).boundaries).toEqual([]);
    expect(analyzeElectrosequences(depth, gr)).toEqual([]);
  });

  it('una profundidad NaN equivale a una muestra sin dato', () => {
    const { depth, gr } = synth(50, (z) => (z < 25 ? 40 : 100), 1, 34);
    const d2 = depth.slice();
    d2[100] = NaN;
    const segs = segmentCurve(d2, gr);
    expect(segs).toHaveLength(2);
  });
});

describe('curva constante y ruido sin estructura', () => {
  it('curva constante → un solo tramo, plano, cilindro', () => {
    const { depth, gr } = synth(100, () => 55, 0);
    const segs = segmentCurve(depth, gr);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.slope).toBe(0);
    expect(segs[0]!.r2).toBe(0);
    expect(segs[0]!.residualStd).toBe(0);
    expect(suggestZoneBoundaries(depth, gr).boundaries).toEqual([]);
    const es = analyzeElectrosequences(depth, gr);
    expect(es).toHaveLength(1);
    expect(es[0]!.shape).toBe('cylinder');
    expect(es[0]!.confidence).toBe('high');
  });

  it('ruido gaussiano independiente con semilla: ningún límite espurio con la penalización por defecto', () => {
    // 6 semillas × 2 amplitudes de ruido (el resultado no depende de la escala de la curva) × 3.000 muestras (457 m)
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const sigma of [5, 20]) {
        const { depth, gr } = synth(3000 * STEP, () => 70, sigma, seed);
        expect(segmentCurve(depth, gr), `semilla ${seed}, σ ${sigma}`).toHaveLength(1);
        expect(suggestZoneBoundaries(depth, gr).boundaries).toEqual([]);
      }
    }
  });

  it('con penalización muy baja el ruido sí se corta (la penalización actúa)', () => {
    const { depth, gr } = synth(300 * STEP, () => 70, 5, 1);
    expect(segmentCurve(depth, gr, { penalty: 0.01, noiseFloor: 0.1 }).length).toBeGreaterThan(3);
  });
});

describe('espesor mínimo, escalamiento e independencia de unidades', () => {
  it('ningún tramo es más delgado que minThickness', () => {
    // una capa de 1 m en medio de una zona plana: no debe aislarse con minThickness = 1,5 m
    const { depth, gr } = synth(60, (z) => (z >= 30 && z < 31 ? 120 : 50), 1, 41);
    for (const mt of [1.5, 3, 6]) {
      const segs = segmentCurve(depth, gr, { minThickness: mt, smoothWindow: 0 });
      for (const s of segs) expect(s.thickness).toBeGreaterThanOrEqual(mt - 1e-9);
    }
    // con 0,5 m sí se puede aislar la capa de 1 m
    const fine = segmentCurve(depth, gr, { minThickness: 0.5, smoothWindow: 0 });
    expect(fine.length).toBeGreaterThanOrEqual(3);
  });

  it('multiplicar la curva por una constante no cambia los límites', () => {
    const { depth, gr } = synth(100, (z) => (z < 30 ? 40 : z < 70 ? 90 : 60), 2, 42);
    const a = segmentCurve(depth, gr).map((s) => s.first);
    const b = segmentCurve(depth, gr.map((v) => v * 3), { noiseFloor: 3 }).map((s) => s.first);
    expect(b).toEqual(a);
  });

  it('entradas inválidas: largos distintos o profundidad no creciente', () => {
    expect(() => segmentCurve(new Float64Array(10), new Float64Array(9))).toThrow(/mismo largo/);
    expect(() => segmentCurve(Float64Array.from([1, 2, 2, 3]), Float64Array.from([1, 2, 3, 4]))).toThrow(/creciente/);
  });
});

describe('PELT con poda frente a programación dinámica completa', () => {
  it('mismos límites en series sintéticas aleatorias (bloques cortos)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = rng(seed);
      // 6 niveles aleatorios con pendientes aleatorias
      const edges = [0, 18, 30, 52, 70, 90, 120];
      const levels = edges.slice(0, -1).map(() => 30 + 80 * r());
      const slopes = edges.slice(0, -1).map(() => (r() - 0.5) * 3);
      const f = (z: number) => {
        let k = 0;
        while (k < edges.length - 2 && z >= edges[k + 1]!) k++;
        return levels[k]! + slopes[k]! * (z - edges[k]!);
      };
      const { depth, gr } = synth(120, f, 3, seed + 100); // 787 muestras
      const fast = segmentCurveBreakpoints(depth, gr, { penalty: 3 }, false);
      const exact = segmentCurveBreakpoints(depth, gr, { penalty: 3 }, true);
      expect(fast, `semilla ${seed}`).toEqual(exact);
      expect(exact.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('curvas adicionales', () => {
  it('un cambio que solo se ve en otra curva aparece con ella y no sin ella', () => {
    const { depth, gr } = synth(80, () => 70, 3, 51);
    const r = rng(52);
    const den = Float64Array.from(depth, (d) => (d - D0 < 40 ? 2.3 : 2.6) + 0.02 * gauss(r)); // densidad: salto de 0,3 g/cm³
    expect(suggestZoneBoundaries(depth, gr).boundaries).toEqual([]);
    const z = suggestZoneBoundaries(depth, gr, {}, [den]);
    expect(z.boundaries).toHaveLength(1);
    const b = z.boundaries[0]!;
    expect(near(b.depth, D0 + 40, 0.4)).toBe(true);
    expect(b.contrastExtra).toHaveLength(1);
    expect(b.contrastExtra[0]!).toBeCloseTo(0.3, 1);
    expect(Math.abs(b.contrast)).toBeLessThan(5); // el GR no cambia
    expect(b.strengthRel).toBeGreaterThan(0.9);
  });
});

// --------------------------------------------------------------------------------------------------------------
// Pozo del TP

interface TpWell {
  depth: Float64Array;
  gr: Float64Array;
  den: Float64Array;
  logRt: Float64Array;
  /** Topes reales de zona (m): el límite entre la última muestra de una zona y la primera de la siguiente. */
  tops: { zone: string; depth: number }[];
}

function loadTp(): TpWell {
  const lines = csvText.trim().split('\n');
  const head = lines[0]!.split(',');
  const col = (name: string) => head.indexOf(name);
  const rows = lines.slice(1).map((l) => l.split(','));
  const num = (name: string) => Float64Array.from(rows, (r) => (r[col(name)] === '' ? NaN : Number(r[col(name)])));
  const depth = num('DEPTH');
  const zonas = rows.map((r) => r[col('ZONA')]!);
  const tops: TpWell['tops'] = [];
  for (let i = 1; i < rows.length; i++) {
    if (zonas[i] !== zonas[i - 1]) tops.push({ zone: `${zonas[i - 1]}/${zonas[i]}`, depth: 0.5 * (depth[i - 1]! + depth[i]!) });
  }
  return { depth, gr: num('GR'), den: num('ZDEN'), logRt: num('AT90').map(Math.log10), tops };
}

describe('pozo del TP (datos/pozo_tp_perfiles.csv)', () => {
  const tp = loadTp();

  it('el CSV trae 5.810 muestras y los 4 contactos A/B, B/C, C/D, D/E', () => {
    expect(tp.depth).toHaveLength(5810);
    expect(tp.tops.map((t) => t.zone)).toEqual(['A/B', 'B/C', 'C/D', 'D/E']);
    expect(tp.tops[0]!.depth).toBeCloseTo(7724.47, 1);
    expect(tp.tops[3]!.depth).toBeCloseTo(8247.05, 1);
  });

  it('segmentación: tramos contiguos que cubren todo el pozo, de espesor ≥ mínimo, en menos de 100 ms', () => {
    const times: number[] = [];
    let segs = segmentCurve(tp.depth, tp.gr);
    for (let k = 0; k < 7; k++) {
      const t0 = performance.now();
      segs = segmentCurve(tp.depth, tp.gr);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[3]!).toBeLessThan(100); // mediana de 7 (≈ 10–20 ms en una PC común)
    expect(segs.length).toBeGreaterThan(15);
    expect(segs.length).toBeLessThan(120);
    expect(segs[0]!.top).toBeCloseTo(tp.depth[0]! - STEP / 2, 6);
    expect(segs[segs.length - 1]!.base).toBeCloseTo(tp.depth[5809]! + STEP / 2, 6);
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i]!.thickness).toBeGreaterThanOrEqual(SEGMENTATION_DEFAULTS.minThickness - 1e-6);
      if (i > 0) expect(segs[i]!.top).toBeCloseTo(segs[i - 1]!.base, 9);
      expect(Number.isFinite(segs[i]!.slope)).toBe(true);
    }
  });

  it('la búsqueda rápida (grilla) coincide con la programación dinámica completa en casi todos los límites', () => {
    const fast = segmentCurveBreakpoints(tp.depth, tp.gr, undefined, false);
    const exact = segmentCurveBreakpoints(tp.depth, tp.gr, undefined, true);
    const matched = fast.filter((f) => exact.some((e) => Math.abs(e - f) <= 1)).length;
    // medido: 36 de 38 a ±1 muestra (la rápida tiene 37 límites)
    expect(Math.abs(fast.length - exact.length)).toBeLessThanOrEqual(3);
    expect(matched / exact.length).toBeGreaterThan(0.85);
  });

  it('electrosecuencias: todas las formas con texto y estadísticas coherentes', () => {
    const es = analyzeElectrosequences(tp.depth, tp.gr);
    expect(es.length).toBeGreaterThan(15);
    const shapes = new Set(es.map((e) => e.shape));
    expect(shapes.size).toBeGreaterThanOrEqual(3);
    for (const e of es) {
      expect(['cylinder', 'funnel', 'bell', 'serrated', 'symmetric', 'unclear']).toContain(e.shape);
      expect(['high', 'medium', 'low']).toContain(e.confidence);
      expect(e.r2).toBeGreaterThanOrEqual(0);
      expect(e.r2).toBeLessThanOrEqual(1);
      expect(e.description.length).toBeGreaterThan(20);
      expect(e.interpretation).toMatch(/Rider/);
      if (e.shape === 'funnel' && !e.serrated) expect(e.slope).toBeGreaterThan(0);
      if (e.shape === 'bell' && !e.serrated) expect(e.slope).toBeLessThan(0);
      if (e.shape === 'cylinder') expect(Math.abs(e.slope)).toBeLessThan(ELECTROSEQUENCE_DEFAULTS.slopeThreshold + 1);
    }
  });

  it('zonas sugeridas vs topes reales (informe; ver tolerancias)', () => {
    // TOLERANCIAS (documentadas): «cerca» = a ≤ 5 m de un tope real (≈ 33 muestras, unas 5 veces la ventana de
    // suavizado de 1 m; los topes de la cátedra se pusieron a ojo sobre varias curvas). «Muy cerca» = ≤ 2 m.
    const NEAR = 5;
    const VERY_NEAR = 2;
    const nearest = (z: ReturnType<typeof suggestZoneBoundaries>) =>
      tp.tops.map((t) => {
        let best = Infinity;
        let rank = 0;
        for (const b of z.boundaries) {
          const d = Math.abs(b.depth - t.depth);
          if (d < best) {
            best = d;
            rank = b.rank;
          }
        }
        return { zone: t.zone, top: t.depth, dist: best, rank };
      });

    // (a) solo con el GR. Los contactos de zona del TP casi no se ven en el GR (contrastes de 0–24 gAPI): se informa.
    const grOnly = suggestZoneBoundaries(tp.depth, tp.gr);
    const a = nearest(grOnly);
    // eslint-disable-next-line no-console
    console.info(
      `[zonas sugeridas, solo GR] ${grOnly.boundaries.length} límites; distancia al tope real más cercano: ` +
        a.map((x) => `${x.zone} ${x.dist.toFixed(1)} m (rank ${x.rank})`).join('; '),
    );
    expect(grOnly.boundaries.length).toBeGreaterThan(5);
    expect(a.filter((x) => x.dist <= NEAR).length).toBeGreaterThanOrEqual(1); // D/E queda a ~4 m
    for (const x of a) expect(Number.isFinite(x.dist)).toBe(true);

    // (b) GR + densidad + log10(Rt): ahí sí aparecen los contactos de la cátedra
    const multi = suggestZoneBoundaries(tp.depth, tp.gr, {}, [tp.den, tp.logRt]);
    const m = nearest(multi);
    // eslint-disable-next-line no-console
    console.info(
      `[zonas sugeridas, GR+ZDEN+log AT90] ${multi.boundaries.length} límites; ` +
        m.map((x) => `${x.zone} ${x.dist.toFixed(1)} m (rank ${x.rank})`).join('; '),
    );
    expect(m.filter((x) => x.dist <= VERY_NEAR).length).toBeGreaterThanOrEqual(3); // A/B, C/D y D/E a ≤ 1,4 m
    // maxBoundaries limita la cantidad y conserva el orden por profundidad
    const top10 = suggestZoneBoundaries(tp.depth, tp.gr, { maxBoundaries: 10 });
    expect(top10.boundaries).toHaveLength(10);
    for (let i = 1; i < top10.boundaries.length; i++) expect(top10.boundaries[i]!.depth).toBeGreaterThan(top10.boundaries[i - 1]!.depth);
  });
});
