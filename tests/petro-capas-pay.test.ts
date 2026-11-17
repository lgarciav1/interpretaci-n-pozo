/**
 * Capas de pay y punzados sugeridos (src/petro/payIntervals.ts y módulo pay-intervals).
 * Los valores esperados son cuentas a mano (muestras de 1 m, salvo el caso de espesor variable) y la propiedad
 * definitoria: con espesor mínimo 0, Σ net de los tramos == pay neto del sumario (summarizeRanges) para cualquier
 * tolerancia de intercalaciones. La unión de intercalaciones y el espesor mínimo son criterios de diseño de punzados
 * (no hay valores de libro); el neto, φ̄, S̄w y kh siguen a Asquith y Krygowski (2004).
 */
import { describe, expect, it } from 'vitest';
import { Engine, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import type { Zone } from '../src/core/well';
import { registry } from '../src/modules';
import { payIntervals, rankPayIntervals, type PayInterval, type PaySamples } from '../src/petro/payIntervals';
import { summarizeRanges } from '../src/petro/summary';
import { curve, well, zone } from './helpers';

const NaN_ = NaN;

/** Muestras de 1 m (profundidad 1000, 1001, …) con φ, Sw y k constantes salvo que se den. */
function mk(flags: number[], extra: Partial<PaySamples> & { h?: number[] } = {}): PaySamples {
  const n = flags.length;
  const { h, ...rest } = extra;
  return {
    depth: Array.from({ length: n }, (_, i) => 1000 + i),
    thickness: h ?? flags.map(() => 1),
    netPay: flags,
    phi: flags.map(() => 0.2),
    sw: flags.map(() => 0.5),
    perm: flags.map(() => 10),
    ...rest,
  };
}
const ALL = (s: PaySamples) => [{ start: 0, end: s.netPay.length }];
const nets = (r: { intervals: PayInterval[] }) => r.intervals.map((t) => t.net);

describe('payIntervals: tramo simple y promedios (a mano)', () => {
  // idx 1..3 pay: φ 0,1/0,2/0,3; Sw 0,6/0,5/0,4; k 1/10/100; h = 1 → net 3
  //   φ̄ = 0,6/3 = 0,2; S̄w = Σφ·Sw/Σφ = (0,06+0,10+0,12)/0,6 = 0,28/0,6 = 0,466667
  //   k̄ = 111/3 = 37; kh = 111; h·φ = 0,6; h·φ·Sh = 0,6 − 0,28 = 0,32
  const s = mk([0, 1, 1, 1, 0], { phi: [0.9, 0.1, 0.2, 0.3, 0.9], sw: [0.1, 0.6, 0.5, 0.4, 0.1], perm: [999, 1, 10, 100, 999] });
  const r = payIntervals(s, ALL(s));

  it('un tramo con tope y base en los bordes de la celda', () => {
    expect(r.intervals).toHaveLength(1);
    const t = r.intervals[0]!;
    expect(t).toMatchObject({ rank: 1, rangeIndex: 0, startIdx: 1, endIdx: 4, gaps: 0 });
    expect(t.top).toBeCloseTo(1000.5, 12); // 1001 − 0,5
    expect(t.base).toBeCloseTo(1003.5, 12); // 1003 + 0,5
    expect(t.net).toBeCloseTo(3, 12);
    expect(t.gross).toBeCloseTo(3, 12);
    expect(t.gapThickness).toBe(0);
  });

  it('φ̄, S̄w, k̄, kh, h·φ y h·φ·Sh solo con las muestras de pay', () => {
    const t = r.intervals[0]!;
    expect(t.phi).toBeCloseTo(0.2, 12);
    expect(t.sw).toBeCloseTo(0.28 / 0.6, 12);
    expect(t.k).toBeCloseTo(37, 10);
    expect(t.kh).toBeCloseTo(111, 10);
    expect(t.hphi).toBeCloseTo(0.6, 12);
    expect(t.hphiSh).toBeCloseTo(0.32, 12);
    expect(r.discarded).toEqual({ count: 0, net: 0 });
  });

  it('sin pay: lista vacía', () => {
    const z = mk([0, 0, NaN_]);
    expect(payIntervals(z, ALL(z)).intervals).toEqual([]);
  });
});

describe('payIntervals: intercalaciones', () => {
  // [1,1,0,1,1] con una muestra de 1 m de intercalación (con φ y k enormes que NO deben contar)
  const s = mk([1, 1, 0, 1, 1], { phi: [0.2, 0.2, 0.9, 0.2, 0.2], perm: [10, 10, 5000, 10, 10] });

  it('se une con tolerancia ≥ su espesor: net 4, gross 5, 1 intercalación; la intercalación no aporta', () => {
    for (const maxGap of [1, 1.5, 10]) {
      const r = payIntervals(s, ALL(s), { maxGap });
      expect(r.intervals).toHaveLength(1);
      const t = r.intervals[0]!;
      expect(t).toMatchObject({ startIdx: 0, endIdx: 5, gaps: 1 });
      expect(t.net).toBeCloseTo(4, 12);
      expect(t.gross).toBeCloseTo(5, 12);
      expect(t.gapThickness).toBeCloseTo(1, 12);
      expect(t.top).toBeCloseTo(999.5, 12);
      expect(t.base).toBeCloseTo(1004.5, 12);
      expect(t.phi).toBeCloseTo(0.2, 12);
      expect(t.kh).toBeCloseTo(40, 10); // 4 m × 10 mD, sin los 5000 mD de la intercalación
      expect(t.hphi).toBeCloseTo(0.8, 12);
    }
  });

  it('no se une con tolerancia 0 ni con una menor que su espesor', () => {
    for (const maxGap of [0, 0.5, 0.99]) {
      const r = payIntervals(s, ALL(s), { maxGap });
      expect(r.intervals).toHaveLength(2);
      expect(nets(r)).toEqual([2, 2]);
      expect(r.intervals.every((t) => t.gaps === 0 && t.gross === t.net)).toBe(true);
    }
  });

  it('opciones omitidas equivalen a tolerancia 0 y espesor mínimo 0', () => {
    expect(payIntervals(s, ALL(s)).intervals).toHaveLength(2);
  });

  it('intercalación más gruesa que la tolerancia: [1,0,0,1] se une con 2 m pero no con 1,5 m', () => {
    const z = mk([1, 0, 0, 1]);
    expect(payIntervals(z, ALL(z), { maxGap: 1.5 }).intervals).toHaveLength(2);
    const j = payIntervals(z, ALL(z), { maxGap: 2 }).intervals;
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ net: 2, gross: 4, gapThickness: 2, gaps: 1 });
  });

  it('varias intercalaciones se cuentan por separado: [1,0,1,0,1] con 1 m → 1 tramo, 2 intercalaciones, net 3, gross 5', () => {
    const z = mk([1, 0, 1, 0, 1]);
    const t = payIntervals(z, ALL(z), { maxGap: 1 }).intervals[0]!;
    expect(t).toMatchObject({ net: 3, gross: 5, gaps: 2, gapThickness: 2 });
  });

  it('la tolerancia es por intercalación, no acumulada: [1,0,1,0,0,1] con 1 m une las dos primeras y no la tercera', () => {
    const z = mk([1, 0, 1, 0, 0, 1]);
    const r = payIntervals(z, ALL(z), { maxGap: 1 });
    expect(r.intervals.map((t) => [t.startIdx, t.endIdx])).toEqual(
      expect.arrayContaining([
        [0, 3],
        [5, 6],
      ]),
    );
    expect(r.intervals).toHaveLength(2);
  });

  it('un tramo no empieza ni termina en intercalación: [0,1,0] → net = gross = 1', () => {
    const z = mk([0, 1, 0, 0, 1, 0]);
    const r = payIntervals(z, ALL(z), { maxGap: 5 });
    expect(r.intervals).toHaveLength(1);
    expect(r.intervals[0]).toMatchObject({ startIdx: 1, endIdx: 5, net: 2, gross: 4, gaps: 1 });
  });

  it('tolerancia con espesores de coma flotante (0,1524 m): 2 muestras = 0,3048 m se unen con maxGap 0,3048', () => {
    const h = 0.1524;
    const z = mk([1, 0, 0, 1], { h: [h, h, h, h] });
    expect(payIntervals(z, ALL(z), { maxGap: 0.3048 }).intervals).toHaveLength(1);
    expect(payIntervals(z, ALL(z), { maxGap: 0.3 }).intervals).toHaveLength(2);
  });
});

describe('payIntervals: NaN en NET_PAY', () => {
  it('cuenta como intercalación, no como pay: [1,NaN,1] se une con 1 m (net 2) y no con 0', () => {
    const z = mk([1, NaN_, 1]);
    const j = payIntervals(z, ALL(z), { maxGap: 1 }).intervals;
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ net: 2, gross: 3, gaps: 1 });
    expect(payIntervals(z, ALL(z), { maxGap: 0 }).intervals).toHaveLength(2);
  });

  it('un tramo de solo NaN no es pay; un valor 0,9 o 2 tampoco (solo el 1 exacto)', () => {
    const z = mk([NaN_, NaN_, 0.9, 2]);
    expect(payIntervals(z, ALL(z), { maxGap: 5 }).intervals).toEqual([]);
  });
});

describe('payIntervals: límites de rango (zona)', () => {
  it('el pay continuo se corta en el límite aunque siga del otro lado', () => {
    const z = mk([1, 1, 1, 1, 1, 1]);
    const r = payIntervals(z, [{ start: 0, end: 3 }, { start: 3, end: 6 }], { maxGap: 100 });
    expect(r.intervals).toHaveLength(2);
    expect(r.intervals.map((t) => [t.rangeIndex, t.startIdx, t.endIdx])).toEqual([
      [0, 0, 3],
      [1, 3, 6],
    ]);
  });

  it('la intercalación no se une a través del límite: [1,1,0 | 1,1]', () => {
    const z = mk([1, 1, 0, 1, 1]);
    const r = payIntervals(z, [{ start: 0, end: 3 }, { start: 3, end: 5 }], { maxGap: 100 });
    expect(r.intervals).toHaveLength(2);
    expect(nets(r)).toEqual([2, 2]);
    // la intercalación final de la zona 0 y la inicial de la 1 no son parte de ningún tramo
    const r2 = payIntervals(mk([1, 0, 1, 1]), [{ start: 0, end: 2 }, { start: 2, end: 4 }], { maxGap: 100 });
    // [1,0 | 1,1]: el pay de la zona 0 es la muestra 0 (net 1) y el de la zona 1 las muestras 2-3 (net 2); no se une
    expect(r2.intervals.map((t) => [t.rangeIndex, t.net])).toEqual([[1, 2], [0, 1]]);
  });

  it('pay desde la primera muestra hasta la última del rango', () => {
    const z = mk([1, 1, 0, 1, 1]);
    const t = payIntervals(z, ALL(z), { maxGap: 1 }).intervals[0]!;
    expect(t.startIdx).toBe(0);
    expect(t.endIdx).toBe(5);
    expect(t.top).toBeCloseTo(999.5, 12);
    expect(t.base).toBeCloseTo(1004.5, 12);
  });

  it('un rango que no empieza en 0 solo mira sus muestras', () => {
    const z = mk([1, 1, 0, 1, 1, 0]);
    const r = payIntervals(z, [{ start: 3, end: 6 }], { maxGap: 1 });
    expect(r.intervals).toHaveLength(1);
    expect(r.intervals[0]).toMatchObject({ rangeIndex: 0, startIdx: 3, endIdx: 5, net: 2 });
  });

  it('opciones por rango: tolerancia 1 en la zona 0 y 0 en la zona 1', () => {
    const z = mk([1, 0, 1, 1, 0, 1]);
    const r = payIntervals(z, [{ start: 0, end: 3 }, { start: 3, end: 6 }], [{ maxGap: 1 }, { maxGap: 0 }]);
    expect(r.intervals.filter((t) => t.rangeIndex === 0)).toHaveLength(1);
    expect(r.intervals.filter((t) => t.rangeIndex === 1)).toHaveLength(2);
  });
});

describe('payIntervals: espesor mínimo (sobre net, después de unir)', () => {
  // [1,0,0,0,1,1,0,1]: tramo A = idx 0 (net 1); tramo B = idx 4-5 + intercalación idx 6 + idx 7 (net 3, gross 4) con maxGap 1
  const s = mk([1, 0, 0, 0, 1, 1, 0, 1]);

  it('descarta el tramo fino y lo informa', () => {
    const r = payIntervals(s, ALL(s), { maxGap: 1, minThickness: 2 });
    expect(r.intervals).toHaveLength(1);
    expect(r.intervals[0]).toMatchObject({ startIdx: 4, endIdx: 8, net: 3, gross: 4 });
    expect(r.discarded).toEqual({ count: 1, net: 1 });
  });

  it('el filtro va sobre net: [1,0,1,0,1] unido tiene gross 5 pero net 3; con mínimo 3 queda, con 3,5 se descarta', () => {
    const z = mk([1, 0, 1, 0, 1]);
    expect(payIntervals(z, ALL(z), { maxGap: 1, minThickness: 3 }).intervals).toHaveLength(1);
    const r = payIntervals(z, ALL(z), { maxGap: 1, minThickness: 3.5 });
    expect(r.intervals).toEqual([]);
    expect(r.discarded).toEqual({ count: 1, net: 3 });
  });

  it('el filtro va después de unir: dos muestras de 1 m separadas por 1 m valen 2 m ≥ mínimo 2 solo si se unen', () => {
    const z = mk([1, 0, 1]);
    expect(payIntervals(z, ALL(z), { maxGap: 0, minThickness: 2 }).intervals).toEqual([]);
    expect(payIntervals(z, ALL(z), { maxGap: 1, minThickness: 2 }).intervals).toHaveLength(1);
  });

  it('mínimo exacto (con redondeo de coma flotante) se conserva', () => {
    const h = 0.1524;
    const z = mk([1, 1], { h: [h, h] });
    expect(payIntervals(z, ALL(z), { minThickness: 0.3048 }).intervals).toHaveLength(1);
  });

  it('opciones inválidas (NaN, negativas) se toman como 0', () => {
    const z = mk([1, 0, 1]);
    expect(payIntervals(z, ALL(z), { maxGap: NaN, minThickness: -3 }).intervals).toHaveLength(2);
  });

  it('rank se asigna después de filtrar', () => {
    const r = payIntervals(s, ALL(s), { maxGap: 1, minThickness: 2 });
    expect(r.intervals.map((t) => t.rank)).toEqual([1]);
  });
});

describe('payIntervals: orden por k·h y por h·φ', () => {
  // tramos (h = 1 m, φ 0,2): A idx0-1 k 10 → kh 20; B idx3 k 50 → kh 50; C idx5-7 k 10 → kh 30; D idx9-10 k 15 → kh 30
  const flags = [1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1];
  const perm = [10, 10, 0, 50, 0, 10, 10, 10, 0, 15, 15];
  const s = mk(flags, { perm });

  it('kh decreciente; desempate por net decreciente (C 3 m antes que D 2 m, ambos 30)', () => {
    const r = payIntervals(s, ALL(s));
    expect(r.intervals.map((t) => [t.rank, t.startIdx, t.kh])).toEqual([
      [1, 3, 50],
      [2, 5, 30],
      [3, 9, 30],
      [4, 0, 20],
    ]);
  });

  it('empate total (kh y net): el más somero primero', () => {
    const z = mk([1, 0, 0, 1]);
    const r = payIntervals(z, ALL(z));
    expect(r.intervals.map((t) => t.startIdx)).toEqual([0, 3]);
  });

  it('el orden es global (varias zonas) y rank va de 1 a N', () => {
    const r = payIntervals(s, [{ start: 0, end: 4 }, { start: 4, end: 11 }]);
    expect(r.intervals.map((t) => t.rank)).toEqual([1, 2, 3, 4]);
    expect(r.intervals.map((t) => t.rangeIndex)).toEqual([0, 1, 1, 0]);
  });

  it('sin perm: k y kh son NaN y se ordena por h·φ decreciente', () => {
    // φ distinto por tramo: A φ 0,10 (h·φ 0,2); B φ 0,30 (0,3); C φ 0,20 (0,6); D φ 0,05 (0,1)
    const phi = [0.1, 0.1, 0, 0.3, 0, 0.2, 0.2, 0.2, 0, 0.05, 0.05];
    const z: PaySamples = { ...mk(flags, { phi }), perm: undefined };
    const r = payIntervals(z, ALL(z));
    expect(r.intervals.map((t) => t.startIdx)).toEqual([5, 3, 0, 9]);
    expect(r.intervals.every((t) => Number.isNaN(t.k) && Number.isNaN(t.kh))).toBe(true);
    expect(r.intervals[0]!.hphi).toBeCloseTo(0.6, 12);
  });

  it('rankPayIntervals no modifica la entrada', () => {
    const base = payIntervals(s, ALL(s)).intervals;
    const rev = [...base].reverse();
    const ids = rev.map((t) => t.startIdx);
    const out = rankPayIntervals(rev, true);
    expect(rev.map((t) => t.startIdx)).toEqual(ids);
    expect(out.map((t) => t.startIdx)).toEqual(base.map((t) => t.startIdx));
  });
});

describe('payIntervals: datos faltantes en φ, Sw y k dentro del pay', () => {
  it('promedios solo con las muestras con dato, como el sumario; kh suma lo conocido', () => {
    // h = 1: φ [0,2; NaN; 0,4]; Sw [0,5; 0,5; NaN]; k [10; NaN; 30]
    //   φ̄ = (0,2+0,4)/2 = 0,3; S̄w: solo la muestra 0 tiene φ y Sw → 0,5; k̄ = 40/2 = 20; kh = 40
    //   h·φ = 0,6; h·φ·Sh = 0,2·0,5 = 0,1
    const s = mk([1, 1, 1], { phi: [0.2, NaN_, 0.4], sw: [0.5, 0.5, NaN_], perm: [10, NaN_, 30] });
    const t = payIntervals(s, ALL(s)).intervals[0]!;
    expect(t.net).toBe(3);
    expect(t.phi).toBeCloseTo(0.3, 12);
    expect(t.sw).toBeCloseTo(0.5, 12);
    expect(t.k).toBeCloseTo(20, 10);
    expect(t.kh).toBeCloseTo(40, 10);
    expect(t.hphi).toBeCloseTo(0.6, 12);
    expect(t.hphiSh).toBeCloseTo(0.1, 12);
  });

  it('con curva k pero sin ninguna k válida en el tramo: k = NaN y kh = 0 (como el sumario)', () => {
    const s = mk([1, 1], { perm: [NaN_, NaN_] });
    const t = payIntervals(s, ALL(s)).intervals[0]!;
    expect(t.k).toBeNaN();
    expect(t.kh).toBe(0);
  });
});

describe('payIntervals: espesor variable por muestra', () => {
  // celdas contiguas de bordes 1000 | 1000,5 | 1001,5 | 1001,75 | 1002 | 1004 → h = 0,5; 1; 0,25; 0,25; 2
  const h = [0.5, 1, 0.25, 0.25, 2];
  const depth = [1000.25, 1001, 1001.625, 1001.875, 1003];
  const s: PaySamples = {
    depth,
    thickness: h,
    netPay: [1, 1, 0, 0, 1],
    phi: [0.1, 0.2, 0.5, 0.5, 0.3],
    sw: [0.5, 0.4, 0.9, 0.9, 0.2],
    perm: [10, 20, 999, 999, 5],
  };

  it('intercalación de 0,5 m (0,25+0,25) se une con 0,5; net 3,5; gross 4 = base − top', () => {
    const r = payIntervals(s, ALL(s), { maxGap: 0.5 });
    expect(r.intervals).toHaveLength(1);
    const t = r.intervals[0]!;
    expect(t.net).toBeCloseTo(3.5, 12);
    expect(t.gapThickness).toBeCloseTo(0.5, 12);
    expect(t.gross).toBeCloseTo(4, 12);
    expect(t.top).toBeCloseTo(1000, 12);
    expect(t.base).toBeCloseTo(1004, 12);
    expect(t.base - t.top).toBeCloseTo(t.gross, 12);
    // Σhφ = 0,05 + 0,2 + 0,6 = 0,85 sobre 3,5 m; Σhφ·Sw = 0,025 + 0,08 + 0,12 = 0,225; Σhk = 5 + 20 + 10 = 35
    expect(t.phi).toBeCloseTo(0.85 / 3.5, 12);
    expect(t.sw).toBeCloseTo(0.225 / 0.85, 12);
    expect(t.k).toBeCloseTo(35 / 3.5, 12);
    expect(t.kh).toBeCloseTo(35, 12);
    expect(t.hphi).toBeCloseTo(0.85, 12);
    expect(t.hphiSh).toBeCloseTo(0.625, 12);
  });

  it('con tolerancia 0,49 m no se une: dos tramos de 1,5 m y 2 m', () => {
    const r = payIntervals(s, ALL(s), { maxGap: 0.49 });
    expect(nets(r).sort()).toEqual([1.5, 2]);
  });
});

// ===============================================================================================================
// Propiedad: con espesor mínimo 0, Σ net == pay neto del sumario, para cualquier tolerancia, en cada zona y en total.

/** PRNG determinista (mulberry32). */
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

interface Synth {
  samples: PaySamples;
  netRes: Float64Array;
  ranges: { start: number; end: number }[];
}

/** Pozo sintético con rachas de pay, espesores irregulares, NaN en NET_PAY, φ, Sw y k, y zonas de largo aleatorio. */
function synth(seed: number, n: number): Synth {
  const rand = rng(seed);
  const depth = new Float64Array(n);
  const thickness = new Float64Array(n);
  let d = 7633;
  for (let i = 0; i < n; i++) {
    thickness[i] = 0.05 + rand() * 0.4;
    depth[i] = d + thickness[i]! / 2;
    d += thickness[i]!;
  }
  const netPay = new Float64Array(n);
  const netRes = new Float64Array(n);
  const phi = new Float64Array(n);
  const sw = new Float64Array(n);
  const perm = new Float64Array(n);
  let state = 1; // 1 = racha de pay, 0 = no pay
  for (let i = 0; i < n; i++) {
    if (rand() < 0.2) state = 1 - state;
    const u = rand();
    netRes[i] = 1;
    netPay[i] = u < 0.04 ? NaN : state; // 4 % sin dato
    if (netPay[i] === 0 && rand() < 0.3) netRes[i] = 0;
    phi[i] = rand() < 0.03 ? NaN : 0.05 + rand() * 0.25;
    sw[i] = rand() < 0.03 ? NaN : rand();
    perm[i] = rand() < 0.03 ? NaN : Math.exp(rand() * 8 - 2);
  }
  // zonas contiguas de largo aleatorio que no cubren todo (la cola queda fuera de toda zona)
  const ranges: { start: number; end: number }[] = [];
  let at = Math.floor(rand() * 10);
  while (at < n - 20) {
    const len = 5 + Math.floor(rand() * 60);
    ranges.push({ start: at, end: Math.min(n, at + len) });
    at += len;
  }
  return { samples: { depth, thickness, netPay, phi, sw, perm }, netRes, ranges };
}

describe('payIntervals: Σ net == netPay del sumario (propiedad, datos sintéticos aleatorios)', () => {
  const GAPS = [0, 0.1, 0.3, 1, 5, 1000];
  for (const seed of [1, 2, 3, 17, 42, 1234, 99999]) {
    it(`semilla ${seed}: por zona y total, para toda tolerancia (y sumas de kh, h·φ, h·φ·Sh)`, () => {
      const { samples, netRes, ranges } = synth(seed, 400);
      expect(Array.from(samples.netPay).filter((x) => x === 1).length).toBeGreaterThan(50); // el caso no es trivial
      const input = { thickness: samples.thickness, netRes, netPay: samples.netPay, phi: samples.phi, sw: samples.sw, perm: samples.perm };
      const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));
      for (const maxGap of GAPS) {
        const r = payIntervals(samples, ranges, { maxGap, minThickness: 0 });
        expect(r.discarded.count).toBe(0);
        const finiteOr0 = (x: number) => (Number.isFinite(x) ? x : 0);
        // por zona
        ranges.forEach((range, ri) => {
          const own = r.intervals.filter((t) => t.rangeIndex === ri);
          const s = summarizeRanges(input, [range], { distributions: false });
          near(own.reduce((a, t) => a + t.net, 0), finiteOr0(s.netPay)); // sumario NaN = «sin dato de pay» → 0 tramos
          near(own.reduce((a, t) => a + t.kh, 0), finiteOr0(s.khPay));
          near(own.reduce((a, t) => a + t.hphi, 0), finiteOr0(s.hphiPay));
          near(own.reduce((a, t) => a + t.hphiSh, 0), finiteOr0(s.hphiShPay));
          // geometría: dentro del rango, empieza y termina en pay, sin solaparse
          let prevEnd = range.start;
          for (const t of own.sort((a, b) => a.startIdx - b.startIdx)) {
            expect(t.startIdx).toBeGreaterThanOrEqual(prevEnd);
            expect(t.endIdx).toBeLessThanOrEqual(range.end);
            expect(samples.netPay[t.startIdx]).toBe(1);
            expect(samples.netPay[t.endIdx - 1]).toBe(1);
            near(t.gross, t.net + t.gapThickness);
            prevEnd = t.endIdx;
          }
        });
        // total
        const total = summarizeRanges(input, ranges, { distributions: false });
        near(r.intervals.reduce((a, t) => a + t.net, 0), finiteOr0(total.netPay));
        // el número de tramos no crece al subir la tolerancia (se verifica abajo) y nunca supera las muestras de pay
        expect(r.intervals.length).toBeLessThanOrEqual(samples.netPay.length);
      }
    });

    it(`semilla ${seed}: más tolerancia → menos o igual cantidad de tramos; el mismo net total`, () => {
      const { samples, ranges } = synth(seed, 400);
      let prev = Infinity;
      let prevNet = NaN;
      for (const maxGap of GAPS) {
        const r = payIntervals(samples, ranges, { maxGap });
        expect(r.intervals.length).toBeLessThanOrEqual(prev);
        prev = r.intervals.length;
        const net = r.intervals.reduce((a, t) => a + t.net, 0);
        if (!Number.isNaN(prevNet)) expect(Math.abs(net - prevNet)).toBeLessThan(1e-9);
        prevNet = net;
      }
    });
  }
});

// ===============================================================================================================
// Módulo pay-intervals sobre un pozo sintético de 16 muestras de 1 m (1000–1015 m) y tres zonas.
//   za (reservorio) 0–5   NET_PAY [1,1,0,1,1,1]   φ 0,2  Sw 0,5  k 10 (muestra 2: intercalación con k 999)
//   zb (sello)      6–9   NET_PAY [1,1,0,0]        φ 0,1  Sw 0,5  k 1 → pay en el sello, como lo cuenta el sumario
//   zc (formación)  10–15 NET_PAY [0,1,1,NaN,1,0] φ 0,3  Sw 0,4  k 20
const ZONES: Zone[] = [
  { ...zone('za', 1000, 1005), kind: 'reservoir' },
  { ...zone('zb', 1006, 1009), kind: 'seal' },
  { ...zone('zc', 1010, 1015), kind: 'formation' },
];
const [ZA, ZB, ZC] = ZONES.map((z) => z.id) as [string, string, string];
const NET_PAY = [1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, NaN_, 1, 0];
const NET_RES = NET_PAY.map(() => 1);
const PHI = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3];
const SW = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4];
const PERM = [10, 10, 999, 10, 10, 10, 1, 1, 1, 1, 20, 20, 20, 20, 20, 20];
const CURVES = [curve('NET_PAY', 'NET_PAY', NET_PAY), curve('NET_RES', 'NET_RES', NET_RES), curve('PHIE', 'PHIE', PHI), curve('SW', 'SW', SW)];
const WELL = well([...CURVES, curve('PERM', 'PERM', PERM)], 16, 1000, 1);
const WELL_NO_K = well(CURVES, 16, 1000, 1);

type P = Record<string, number | string | boolean>;
/** `disabled`: módulos apagados (para probar la falta de PERM hay que apagar los que la calculan: perm-timur, etc.). */
function run(global: P = {}, zones: Record<string, P> = {}, w = WELL, zs: Zone[] = ZONES, disabled: string[] = []): EngineRunResult {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(w);
  return engine.run({ ...emptyInterpretation(zs), compare: ['pay-intervals', 'zone-summary'], disabled, params: { global, zones } });
}
const out = (r: EngineRunResult, key: string) => {
  const o = r.outputs.find((x) => x.key === key);
  if (!o) throw new Error(`Falta la salida ${key}`);
  return o.value;
};
const rowsOf = (r: EngineRunResult) => (out(r, 'pay-intervals:PAY_INTERVALS') as TableValue).rows;
const warnings = (r: EngineRunResult) => r.diagnostics.filter((d) => d.code === 'module-warning' && d.moduleId === 'pay-intervals').map((d) => d.message);

describe('módulo pay-intervals', () => {
  it('está registrado después de flow-capacity, en el sumario/petrofísica, y sin errores propios', () => {
    const ids = registry.modules.map((m) => m.id);
    expect(ids.indexOf('pay-intervals')).toBe(ids.indexOf('flow-capacity') + 1);
    const m = registry.get('pay-intervals')!;
    expect(m).toMatchObject({ name: 'Capas de pay y punzados', category: 'summary', workspace: 'petrophysics' });
    expect(m.params['minThickness']).toMatchObject({ default: 1, unit: 'm', step: 0.1, scope: 'zone' });
    expect(m.params['maxGap']).toMatchObject({ default: 0.3, unit: 'm', scope: 'zone' });
    const r = run();
    expect(r.diagnostics.filter((d) => d.level === 'error' && d.moduleId === 'pay-intervals')).toEqual([]);
  });

  it('valores por defecto (mínimo 1 m, tolerancia 0,3 m): tramos y orden a mano', () => {
    // za: [1,1,0,1,1,1]: intercalación 1 m > 0,3 → dos tramos: A idx0-1 (net 2, kh 20), B idx3-5 (net 3, kh 30)
    // zb: [1,1,0,0]: tramo idx 6-7 net 2, kh 2
    // zc: [0,1,1,NaN,1,0]: tramo idx11-12 net 2 (kh 40); idx14 net 1 (kh 20); el NaN separa (1 m > 0,3)
    const rows = rowsOf(run());
    expect(rows.map((x) => [x.rank, x.zoneId, x.net, x.kh])).toEqual([
      [1, ZC, 2, 40],
      [2, ZA, 3, 30],
      [3, ZA, 2, 20], // empate de kh con zc idx14 (20): gana el de mayor net
      [4, ZC, 1, 20],
      [5, ZB, 2, 2],
    ]);
    const first = rows[0]!;
    expect(first).toMatchObject({ zone: ZC.toUpperCase(), gaps: 0, k: 20, phi: 0.3, sw: 0.4 });
    expect(first.top).toBeCloseTo(1010.5, 12); // muestra 11 en 1011 − 0,5
    expect(first.base).toBeCloseTo(1012.5, 12);
    expect(first.hphi).toBeCloseTo(0.6, 12);
    expect(first.hphiSh).toBeCloseTo(0.36, 12); // 2·0,3·(1 − 0,4)
    // k·h del total: 40+30+20+20+2 = 112
    expect((first.khPct as number)).toBeCloseTo((100 * 40) / 112, 10);
    expect(rows.reduce((s, x) => s + (x.khPct as number), 0)).toBeCloseTo(100, 10);
  });

  it('tolerancia 1 m y mínimo 0: se unen las intercalaciones de 1 m; Σ net == NET_PAY_TOTAL del sumario y por zona', () => {
    const r = run({ 'pay-intervals.minThickness': 0, 'pay-intervals.maxGap': 1 });
    const rows = rowsOf(r);
    const sum = (out(r, 'zone-summary:ZONE_SUMMARY') as TableValue).rows;
    const byZone = (id: string) => rows.filter((x) => x.zoneId === id).reduce((s, x) => s + (x.net as number), 0);
    // sumario: filas za, zb, zc, Total (pay neto: 5, 2, 3)
    expect(byZone(ZA)).toBeCloseTo(sum[0]!.netPay as number, 12);
    expect(byZone(ZB)).toBeCloseTo(sum[1]!.netPay as number, 12);
    expect(byZone(ZC)).toBeCloseTo(sum[2]!.netPay as number, 12);
    const total = rows.reduce((s, x) => s + (x.net as number), 0);
    expect(total).toBeCloseTo(out(r, 'zone-summary:NET_PAY_TOTAL') as number, 12);
    expect(total).toBeCloseTo(10, 12);
    // za un solo tramo con la intercalación; zc: idx11-14 con el NaN unido (net 3, gross 4)
    expect(rows.filter((x) => x.zoneId === ZA).map((x) => [x.net, x.gross, x.gaps])).toEqual([[5, 6, 1]]);
    expect(rows.filter((x) => x.zoneId === ZC).map((x) => [x.net, x.gross, x.gaps])).toEqual([[3, 4, 1]]);
  });

  it('el sello entra con su pay (como en el sumario); un tramo no cruza el límite za|zb aunque haya pay a ambos lados', () => {
    const r = run({ 'pay-intervals.minThickness': 0, 'pay-intervals.maxGap': 5 });
    const rows = rowsOf(r);
    const zb = rows.filter((x) => x.zoneId === ZB);
    expect(zb).toHaveLength(1);
    expect(zb[0]!.net).toBe(2);
    const za = rows.filter((x) => x.zoneId === ZA);
    expect(za).toHaveLength(1); // muestra 5 (za) y 6 (zb) son pay, pero son tramos distintos
    expect(za[0]!.base).toBeCloseTo(1005.5, 12);
    expect(zb[0]!.top).toBeCloseTo(1005.5, 12);
  });

  it('parámetros por zona: mínimo 2,5 m solo en za descarta el tramo de 2 m de za y deja los demás', () => {
    const rows = rowsOf(run({}, { [ZA]: { 'pay-intervals.minThickness': 2.5 } }));
    expect(rows.filter((x) => x.zoneId === ZA).map((x) => x.net)).toEqual([3]);
    expect(rows.filter((x) => x.zoneId === ZC).map((x) => x.net)).toEqual([2, 1]); // zc con su mínimo de 1 m: ambos tramos quedan
  });

  it('sin la curva PERM: avisa, ordena por h·φ y deja k, k·h y % vacíos', () => {
    const r = run({}, {}, WELL_NO_K, ZONES, ['perm-timur', 'perm-coates', 'perm-core']);
    expect(warnings(r).some((m) => m.includes('PERM'))).toBe(true);
    const rows = rowsOf(r);
    expect(rows.every((x) => x.k === null && x.kh === null && x.khPct === null)).toBe(true);
    // h·φ por tramo: zc idx11-12 0,6; za idx3-5 0,6; zc idx14 0,3; za idx0-1 0,4; zb 0,2 → desempate net: za (3 m) antes que zc (2 m) en 0,6
    expect(rows.map((x) => [x.zoneId, x.net])).toEqual([
      [ZA, 3],
      [ZC, 2],
      [ZA, 2],
      [ZC, 1],
      [ZB, 2],
    ]);
  });

  it('sin zonas: un único rango con el pozo completo y las mismas definiciones', () => {
    const r = run({ 'pay-intervals.minThickness': 0, 'pay-intervals.maxGap': 0 }, {}, WELL, []);
    const rows = rowsOf(r);
    // sin zonas el tramo za|zb (muestras 5-6) es continuo: idx3-7 net 5
    expect(rows.every((x) => x.zone === 'Pozo completo' && x.zoneId === '')).toBe(true);
    // tolerancia 0: za [1,1,0,1,1,1 | 1,1,0,0 | 0,1,1,NaN,1,0] → idx 0-1 (2), idx 3-7 (5), idx 11-12 (2), idx 14 (1)
    // k·h: idx 11-12 → 2·20 = 40; idx 3-7 → 3·10 + 2·1 = 32; idx 0-1 → 20 (net 2, antes que idx 14: 20, net 1)
    expect(rows.map((x) => [x.net, x.kh])).toEqual([[2, 40], [5, 32], [2, 20], [1, 20]]);
    expect(rows[1]!.top).toBeCloseTo(1002.5, 12);
    expect(rows[1]!.base).toBeCloseTo(1007.5, 12);
  });

  it('sin pay: avisa; con mínimo mayor que todo el pay: avisa con la cantidad descartada', () => {
    const noPay = well([curve('NET_PAY', 'NET_PAY', NET_PAY.map(() => 0)), curve('NET_RES', 'NET_RES', NET_RES), curve('PHIE', 'PHIE', PHI), curve('SW', 'SW', SW), curve('PERM', 'PERM', PERM)], 16, 1000, 1);
    const r = run({}, {}, noPay);
    expect(rowsOf(r)).toEqual([]);
    expect(warnings(r).some((m) => m.includes('No hay pay'))).toBe(true);
    const r2 = run({ 'pay-intervals.minThickness': 20 });
    expect(rowsOf(r2)).toEqual([]);
    expect(warnings(r2).some((m) => m.includes('espesor mínimo'))).toBe(true);
  });
});
