import { describe, expect, it } from 'vitest';
import { netFlagsInto } from '../src/petro/cutoffs';
import {
  intervalDistribution,
  suggestDistributionStat,
  weightedQuantiles,
  type DistributionInput,
} from '../src/petro/distribution';
import { summarizeRanges } from '../src/petro/summary';

describe('petro/distribution: weightedQuantiles con pesos iguales = Hazen (tipo 5)', () => {
  it('[15,1,7,3,9] → P10..P90 = [1; 2,5; 7; 10,5; 15] (np.percentile(method="hazen"), numpy 2.5.3)', () => {
    // Ordenado 1,3,7,9,15; posición 1-indexada = n·p + 0,5: P25 → 1,75 → 1 + 0,75·2 = 2,5; P75 → 4,25 → 9 + 0,25·6 = 10,5.
    const q = weightedQuantiles([15, 1, 7, 3, 9], [1, 1, 1, 1, 1]);
    [1, 2.5, 7, 10.5, 15].forEach((e, i) => expect(q[i]).toBeCloseTo(e, 12));
  });

  it('n par (8 valores): [0,58; 1,75; 4; 6,5; 8,4] (numpy hazen) y no depende de la escala de los pesos', () => {
    const x = [2.5, 0.4, 9, 4, 4, 7, 1, 6];
    const expected = [0.58, 1.75, 4, 6.5, 8.4];
    const a = weightedQuantiles(x, x.map(() => 1));
    const b = weightedQuantiles(x, x.map(() => 3.7));
    expected.forEach((e, i) => {
      expect(a[i]).toBeCloseTo(e, 12);
      expect(b[i]).toBeCloseTo(e, 12);
    });
  });
});

describe('petro/distribution: weightedQuantiles con pesos desiguales', () => {
  // x = [1,2,3], w = [1,2,1], W = 4 → c = [0,125; 0,5; 0,875] (puntos medios de cada peso). Verificado con np.interp.
  it('interpola sobre la CDF en los puntos medios y satura en los extremos', () => {
    const q = weightedQuantiles([1, 2, 3], [1, 2, 1], [0.1, 0.3, 0.5, 0.75, 0.9]);
    // P30: t = (0,3 − 0,125)/0,375 = 7/15 → 1 + 7/15; P75: t = 0,25/0,375 = 2/3 → 2 + 2/3
    [1, 1 + 7 / 15, 2, 2 + 2 / 3, 3].forEach((e, i) => expect(q[i]).toBeCloseTo(e, 12));
  });

  it('el orden de entrada no importa', () => {
    const q = weightedQuantiles([3, 1, 2], [1, 1, 2], [0.3, 0.75]);
    expect(q[0]).toBeCloseTo(1 + 7 / 15, 12);
    expect(q[1]).toBeCloseTo(2 + 2 / 3, 12);
  });
});

describe('petro/distribution: weightedQuantiles, casos borde', () => {
  it('ignora NaN, no finitos y pesos 0/negativos/NaN', () => {
    const q = weightedQuantiles([NaN, 1, 2, 3, Infinity, 99, 98], [1, 1, 2, 1, 1, 0, -1], [0.5]);
    expect(q[0]).toBe(2);
  });
  it('sin datos válidos → NaN en todos (no 0)', () => {
    expect(weightedQuantiles([], [])).toEqual([NaN, NaN, NaN, NaN, NaN]);
    expect(weightedQuantiles([NaN, 1], [1, 0]).every(Number.isNaN)).toBe(true);
  });
  it('un solo dato → ese dato; p fuera de [0,1] o NaN → NaN; no muta la entrada', () => {
    expect(weightedQuantiles([4], [2], [0, 0.3, 1])).toEqual([4, 4, 4]);
    const x = [3, 1, 2];
    const w = [1, 1, 1];
    const q = weightedQuantiles(x, w, [-0.1, 1.1, NaN, 0.5]);
    expect(q.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(q[3]).toBe(2);
    expect(x).toEqual([3, 1, 2]);
    expect(w).toEqual([1, 1, 1]);
  });
});

// Caso a mano de petro-sumario (8 muestras, espesores distintos): cutoffs 0,4 / 0,08 / 0,6.
const h = [0.5, 1, 0.5, 1, 2, 0.5, 1, 0.5];
const vsh = [0.1, 0.2, 0.4, 0.3, NaN, 0.5, 0.1, 0.2];
const phi = [0.2, 0.15, 0.1, 0.12, 0.2, 0.25, 0.05, 0.18];
const sw = [0.3, 0.5, 0.6, 0.8, 0.4, 0.2, 0.3, NaN];
const perm = [100, 50, 10, 5, 1, 1, 1, 20];
const netRes = Float64Array.from([1, 1, 1, 1, NaN, 0, 0, 1]);
const netPay = Float64Array.from([1, 1, 1, 0, NaN, 0, 0, NaN]);
const all8 = [{ start: 0, end: 8 }];
const base = { thickness: h, netRes, netPay, phi };
const opt = { excludeWashout: false } as const;

describe('petro/distribution: la media coincide con la tabla del sumario (caso a mano de 8 muestras)', () => {
  const s = summarizeRanges({ ...base, sw, vsh, perm }, all8);

  it('φ en netRes con mean = thickness == φ̄ del sumario (0,51/3,5)', () => {
    const d = intervalDistribution({ ...base, values: phi }, { ...opt, filter: 'netRes', mean: 'thickness' }, all8);
    expect(d.mean).toBeCloseTo(s.phiRes, 12);
    expect(d.mean).toBeCloseTo(0.51 / 3.5, 12);
    expect(d.thickness).toBeCloseTo(3.5, 12);
    expect(d.n).toBe(5);
    expect(d.noData).toBe(0);
    expect(d.min).toBe(0.1);
    expect(d.max).toBe(0.2);
  });

  it('Sw en netPay con poreVolume == S̄w del sumario (0,135/0,30 = 0,45)', () => {
    const d = intervalDistribution({ ...base, values: sw }, { ...opt, filter: 'netPay', mean: 'poreVolume' }, all8);
    expect(d.mean).toBeCloseTo(s.swPay, 12);
    expect(d.mean).toBeCloseTo(0.45, 12);
    expect(d.thickness).toBeCloseTo(2, 12);
    // Percentiles con pesos hφ = [0,1; 0,15; 0,05] sobre Sw [0,3; 0,5; 0,6]: W = 0,3, c = [1/6; 7/12; 11/12]
    // P50: t = (0,5 − 1/6)/(5/12) = 0,8 → 0,3 + 0,8·0,2 = 0,46; P25: t = (0,25 − 1/6)/(5/12) = 0,2 → 0,34
    expect(d.p50).toBeCloseTo(0.46, 12);
    expect(d.p25).toBeCloseTo(0.34, 12);
    expect(d.p10).toBe(0.3);
    expect(d.p90).toBeCloseTo(0.595, 12); // t = (0,9 − 7/12)/(1/3) = 0,95
  });

  it('Sw en netRes con poreVolume == S̄w del sumario y la muestra con Sw NaN va a noData (0,5 m)', () => {
    const d = intervalDistribution({ ...base, values: sw }, { ...opt, filter: 'netRes', mean: 'poreVolume' }, all8);
    expect(d.mean).toBeCloseTo(s.swRes, 12);
    expect(d.mean).toBeCloseTo(0.55, 12);
    expect(d.noData).toBeCloseTo(0.5, 12);
    expect(d.thickness).toBeCloseTo(3, 12);
  });

  it('k en netPay con thickness (aritmética) == k̄ del sumario (105/2); geoMean aparte', () => {
    const d = intervalDistribution({ ...base, values: perm }, { ...opt, filter: 'netPay', mean: 'thickness' }, all8);
    expect(d.mean).toBeCloseTo(s.kPay, 12);
    expect(d.mean).toBeCloseTo(52.5, 12);
    // exp((0,5·ln100 + 1·ln50 + 0,5·ln10)/2)
    expect(d.geoMean).toBeCloseTo(Math.exp((0.5 * Math.log(100) + Math.log(50) + 0.5 * Math.log(10)) / 2), 12);
  });

  it('Vsh en netRes y en netPay con thickness == Vsh del sumario', () => {
    const r = intervalDistribution({ ...base, values: vsh }, { ...opt, filter: 'netRes', mean: 'thickness' }, all8);
    const p = intervalDistribution({ ...base, values: vsh }, { ...opt, filter: 'netPay', mean: 'thickness' }, all8);
    expect(r.mean).toBeCloseTo(s.vshRes, 12);
    expect(p.mean).toBeCloseTo(s.vshPay, 12);
  });

  it('una bandera NaN no entra al filtro: la muestra 4 (netRes NaN) no aporta a ningún campo', () => {
    const d = intervalDistribution({ ...base, values: phi }, { ...opt, filter: 'netRes', mean: 'thickness' }, all8);
    expect(d.thickness + d.noData + d.excludedWashout).toBeCloseTo(3.5, 12); // sin los 2 m de la muestra 4
    const a = intervalDistribution({ ...base, values: phi }, { ...opt, filter: 'all', mean: 'thickness' }, all8);
    expect(a.thickness).toBeCloseTo(7, 12);
  });
});

describe('petro/distribution: consistencia con el sumario en un set sintético (300 muestras, varios rangos)', () => {
  // Generador LCG determinista.
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const N = 300;
  const hh = Array.from({ length: N }, () => 0.1 + rnd() * 0.3);
  const ph = Array.from({ length: N }, () => (rnd() < 0.05 ? NaN : 0.02 + rnd() * 0.3));
  const sv = Array.from({ length: N }, () => (rnd() < 0.05 ? NaN : rnd()));
  const sww = Array.from({ length: N }, () => (rnd() < 0.05 ? NaN : rnd()));
  const kk = Array.from({ length: N }, () => (rnd() < 0.05 ? NaN : Math.exp(Math.log(0.01) + rnd() * Math.log(1e5))));
  const nr = new Float64Array(N);
  const np = new Float64Array(N);
  netFlagsInto(sv, ph, sww, nr, np, { vshMax: 0.5, phiMin: 0.08, swMax: 0.6 });
  const ranges = [
    { start: 0, end: 100 },
    { start: 150, end: 300 },
  ];
  const s = summarizeRanges({ thickness: hh, netRes: nr, netPay: np, phi: ph, sw: sww, vsh: sv, perm: kk }, ranges);
  const inp = (values: ArrayLike<number>): DistributionInput => ({ values, thickness: hh, netRes: nr, netPay: np, phi: ph });

  it('φ, Vsh, k (aritmética) y Sw (poreVolume) coinciden con el sumario en netRes y netPay', () => {
    const t = { excludeWashout: false, mean: 'thickness' } as const;
    const pv = { excludeWashout: false, mean: 'poreVolume' } as const;
    expect(intervalDistribution(inp(ph), { ...t, filter: 'netRes' }, ranges).mean).toBeCloseTo(s.phiRes, 10);
    expect(intervalDistribution(inp(ph), { ...t, filter: 'netPay' }, ranges).mean).toBeCloseTo(s.phiPay, 10);
    expect(intervalDistribution(inp(sv), { ...t, filter: 'netRes' }, ranges).mean).toBeCloseTo(s.vshRes, 10);
    expect(intervalDistribution(inp(sv), { ...t, filter: 'netPay' }, ranges).mean).toBeCloseTo(s.vshPay, 10);
    expect(intervalDistribution(inp(kk), { ...t, filter: 'netPay' }, ranges).mean).toBeCloseTo(s.kPay, 8);
    expect(intervalDistribution(inp(sww), { ...pv, filter: 'netRes' }, ranges).mean).toBeCloseTo(s.swRes, 10);
    expect(intervalDistribution(inp(sww), { ...pv, filter: 'netPay' }, ranges).mean).toBeCloseTo(s.swPay, 10);
  });

  it('el espesor neto del filtro cubre netRes/netPay del sumario (thickness + noData)', () => {
    const d = intervalDistribution(inp(sv), { excludeWashout: false, mean: 'thickness', filter: 'netRes' }, ranges);
    expect(d.thickness + d.noData).toBeCloseTo(s.netRes, 10);
  });

  it('percentiles ordenados y dentro de [min, max]; media aritmética dentro de [min, max]', () => {
    const d = intervalDistribution(inp(ph), { excludeWashout: false, mean: 'thickness', filter: 'all' }, ranges);
    const seq = [d.min, d.p10, d.p25, d.p50, d.p75, d.p90, d.max];
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThanOrEqual(seq[i - 1]!);
    expect(d.mean).toBeGreaterThanOrEqual(d.min);
    expect(d.mean).toBeLessThanOrEqual(d.max);
  });

  it('rangos: acumular dos rangos == calcular sobre la unión (misma muestra en un solo rango)', () => {
    const a = intervalDistribution(inp(ph), { excludeWashout: false, mean: 'thickness', filter: 'all' }, ranges);
    const solo = intervalDistribution(
      inp(ph.map((x, i) => (i >= 100 && i < 150 ? NaN : x))),
      { excludeWashout: false, mean: 'thickness', filter: 'all' },
      [{ start: 0, end: 300 }],
    );
    expect(a.mean).toBeCloseTo(solo.mean, 12);
    expect(a.p50).toBeCloseTo(solo.p50, 12);
    expect(a.thickness).toBeCloseTo(solo.thickness, 10);
  });
});

describe('petro/distribution: derrumbe, NaN y sin datos', () => {
  const values = [0.1, 0.2, 0.3, NaN, 0.5];
  const hh = [1, 1, 2, 1, 1];
  const wo = [0, 1, 0, 0, NaN]; // la muestra 1 es derrumbe; la 4 tiene derrumbe sin dato (no se excluye)
  const one = [{ start: 0, end: 5 }];

  it('excludeWashout: el espesor excluido suma a excludedWashout y no entra a la estadística', () => {
    const d = intervalDistribution(
      { values, thickness: hh, washout: wo },
      { filter: 'all', excludeWashout: true, mean: 'thickness' },
      one,
    );
    expect(d.excludedWashout).toBe(1);
    expect(d.noData).toBe(1); // la muestra 3 (NaN)
    expect(d.thickness).toBe(4); // muestras 0, 2, 4
    expect(d.n).toBe(3);
    expect(d.max).toBe(0.5);
    expect(d.mean).toBeCloseTo((0.1 + 0.6 + 0.5) / 4, 12);
  });

  it('sin excludeWashout (o sin curva de derrumbe) entra todo', () => {
    const a = intervalDistribution(
      { values, thickness: hh, washout: wo },
      { filter: 'all', excludeWashout: false, mean: 'thickness' },
      one,
    );
    expect(a.excludedWashout).toBe(0);
    expect(a.n).toBe(4);
    const b = intervalDistribution({ values, thickness: hh }, { filter: 'all', excludeWashout: true, mean: 'thickness' }, one);
    expect(b.excludedWashout).toBe(0);
    expect(b.n).toBe(4);
  });

  it('el derrumbe se cuenta solo dentro del filtro (netRes)', () => {
    const d = intervalDistribution(
      { values, thickness: hh, washout: wo, netRes: [1, 0, 1, 1, 1] },
      { filter: 'netRes', excludeWashout: true, mean: 'thickness' },
      one,
    );
    expect(d.excludedWashout).toBe(0); // la muestra con derrumbe no es reservorio
    expect(d.n).toBe(3);
    expect(d.noData).toBe(1);
  });

  it('sin datos → estadísticos NaN (no 0) y espesores 0; solo NaN → todo a noData', () => {
    const e = intervalDistribution(
      { values: [NaN, NaN], thickness: [1, 2] },
      { filter: 'all', excludeWashout: false, mean: 'thickness' },
      [{ start: 0, end: 2 }],
    );
    expect(e.n).toBe(0);
    expect(e.thickness).toBe(0);
    expect(e.noData).toBe(3);
    for (const k of ['min', 'max', 'p10', 'p25', 'p50', 'p75', 'p90', 'mean', 'geoMean'] as const) expect(e[k]).toBeNaN();
    const r = intervalDistribution(
      { values: [1], thickness: [1] },
      { filter: 'all', excludeWashout: false, mean: 'thickness' },
      [],
    );
    expect(r.n).toBe(0);
    expect(r.mean).toBeNaN();
  });

  it('poreVolume con φ NaN: la muestra va a noData', () => {
    const d = intervalDistribution(
      { values: [0.3, 0.5], thickness: [1, 1], phi: [0.2, NaN] },
      { filter: 'all', excludeWashout: false, mean: 'poreVolume' },
      [{ start: 0, end: 2 }],
    );
    expect(d.noData).toBe(1);
    expect(d.mean).toBe(0.3);
  });

  it('exige las entradas que piden las opciones', () => {
    const o = { excludeWashout: false } as const;
    const r = [{ start: 0, end: 1 }];
    expect(() => intervalDistribution({ values: [1], thickness: [1] }, { ...o, filter: 'netRes', mean: 'thickness' }, r)).toThrow();
    expect(() => intervalDistribution({ values: [1], thickness: [1] }, { ...o, filter: 'netPay', mean: 'thickness' }, r)).toThrow();
    expect(() => intervalDistribution({ values: [1], thickness: [1] }, { ...o, filter: 'all', mean: 'poreVolume' }, r)).toThrow();
  });
});

describe('petro/distribution: máscara de filtros por curva o bandera (mask)', () => {
  // 7 muestras. La 5 tiene máscara NaN (no es 1: queda afuera); la 1 es derrumbe pero está enmascarada.
  const values = [0.1, 0.2, 0.3, 0.4, NaN, 0.6, 0.7];
  const hh = [1, 1, 2, 1, 1, 1, 1];
  const wo = [0, 1, 0, 1, 0, 0, 0];
  const netRes = [1, 1, 1, 1, 1, 1, 0];
  const mask = [1, 0, 1, 1, 1, NaN, 1];
  const one = [{ start: 0, end: 7 }];
  const all = { filter: 'all' as const, excludeWashout: false, mean: 'thickness' as const };

  it('solo entran las muestras con mask = 1: media (0,1 + 0,3·2 + 0,4 + 0,7)/5 = 0,36, la 4 va a noData', () => {
    const d = intervalDistribution({ values, thickness: hh, washout: wo, mask }, all, one);
    expect(d.n).toBe(4);
    expect(d.thickness).toBe(5);
    expect(d.noData).toBe(1);
    expect(d.min).toBe(0.1);
    expect(d.max).toBe(0.7);
    expect(d.mean).toBeCloseTo(1.8 / 5, 12);
    expect(d.washoutThickness).toBe(1); // solo la 3: la 1 está enmascarada
  });

  it('equivale a calcular sin máscara sobre los rangos de las muestras que pasan', () => {
    const masked = intervalDistribution({ values, thickness: hh, washout: wo, mask }, all, one);
    const byRanges = intervalDistribution({ values, thickness: hh, washout: wo }, all, [
      { start: 0, end: 1 },
      { start: 2, end: 5 },
      { start: 6, end: 7 },
    ]);
    expect(masked).toEqual(byRanges);
  });

  it('se combina por intersección con netRes y el derrumbe: excluido 1 m (la 3), media (0,1 + 0,3·2)/3', () => {
    const d = intervalDistribution({ values, thickness: hh, washout: wo, netRes, mask }, { filter: 'netRes', excludeWashout: true, mean: 'thickness' }, one);
    expect(d.excludedWashout).toBe(1);
    expect(d.noData).toBe(1);
    expect(d.thickness).toBe(3);
    expect(d.n).toBe(2);
    expect(d.mean).toBeCloseTo(0.7 / 3, 12);
  });

  it('una máscara toda en 1 da lo mismo que no pasar máscara', () => {
    const ones = values.map(() => 1);
    expect(intervalDistribution({ values, thickness: hh, washout: wo, mask: ones }, all, one)).toEqual(
      intervalDistribution({ values, thickness: hh, washout: wo }, all, one),
    );
  });
});

describe('petro/distribution: media geométrica de k', () => {
  const o = { filter: 'all', excludeWashout: false, mean: 'geometric' } as const;

  it('k = [10; 100; 1000], h = [1; 2; 1] → exp((ln10 + 2·ln100 + ln1000)/4) = 100', () => {
    // (1 + 4 + 3)·ln10/4 = 2·ln10 → 100 (verificado con numpy)
    const d = intervalDistribution({ values: [10, 100, 1000], thickness: [1, 2, 1] }, o, [{ start: 0, end: 3 }]);
    expect(d.mean).toBeCloseTo(100, 10);
    expect(d.geoMean).toBeCloseTo(100, 10);
    expect(d.p50).toBe(100);
  });

  it('k ≤ 0 se ignora: no entra a la media, a los percentiles, a min ni a n; su espesor va a noData', () => {
    const d = intervalDistribution(
      { values: [10, 0, 100, -5, 1000], thickness: [1, 0.5, 2, 0.25, 1] },
      o,
      [{ start: 0, end: 5 }],
    );
    expect(d.mean).toBeCloseTo(100, 10);
    expect(d.n).toBe(3);
    expect(d.min).toBe(10);
    expect(d.noData).toBeCloseTo(0.75, 12);
    expect(d.thickness).toBe(4);
  });

  it('solo k ≤ 0 → NaN (no 0 ni log de 0)', () => {
    const d = intervalDistribution({ values: [0, -1], thickness: [1, 1] }, o, [{ start: 0, end: 2 }]);
    expect(d.mean).toBeNaN();
    expect(d.geoMean).toBeNaN();
    expect(d.n).toBe(0);
  });

  it('con mean = thickness, k ≤ 0 sigue en la estadística pero geoMean lo ignora', () => {
    const d = intervalDistribution(
      { values: [0, 100], thickness: [1, 1] },
      { ...o, mean: 'thickness' },
      [{ start: 0, end: 2 }],
    );
    expect(d.mean).toBe(50);
    expect(d.geoMean).toBeCloseTo(100, 10);
  });
});

describe('petro/distribution: percentiles con pesos hφ (poreVolume)', () => {
  it('x = [1,2,3], h = 1, φ = [0,1; 0,2; 0,1] equivale a pesos [1,2,1]: P25 = 4/3, P50 = 2, P75 = 8/3, media 2', () => {
    const d = intervalDistribution(
      { values: [1, 2, 3], thickness: [1, 1, 1], phi: [0.1, 0.2, 0.1] },
      { filter: 'all', excludeWashout: false, mean: 'poreVolume' },
      [{ start: 0, end: 3 }],
    );
    expect(d.p10).toBe(1);
    expect(d.p25).toBeCloseTo(1 + 1 / 3, 12);
    expect(d.p50).toBe(2);
    expect(d.p75).toBeCloseTo(2 + 2 / 3, 12);
    expect(d.p90).toBe(3);
    expect(d.mean).toBeCloseTo(2, 12);
  });
});

describe('petro/distribution: suggestDistributionStat', () => {
  it('Sw/SWE/SW* → poreVolume lineal', () => {
    for (const id of ['SW', 'swe', 'SW_ARCHIE', 'SWT', 'SXO']) {
      expect(suggestDistributionStat(id)).toEqual({ mean: 'poreVolume', scale: 'linear' });
    }
  });
  it('k/PERM* → geometric en escala log', () => {
    for (const id of ['PERM', 'perm_core', 'k_klinkenberg', 'KLINK', 'KAIR']) {
      expect(suggestDistributionStat(id)).toEqual({ mean: 'geometric', scale: 'log' });
    }
  });
  it('resto → thickness lineal (incluye KR, KTH…, VSH, PHIE, RT, GR, NET_RES)', () => {
    for (const id of ['PHIE', 'PHIT', 'VSH', 'GR', 'RT', 'RHOB', 'NET_RES', 'K']) {
      expect(suggestDistributionStat(id)).toEqual({ mean: 'thickness', scale: 'linear' });
    }
  });
});

describe('intervalDistribution: pay exige reservorio (como summarizeRanges)', () => {
  it('una muestra con netPay = 1 y netRes = 0 no entra al filtro netPay', () => {
    const values = [0.2, 0.1, 0.3];
    const thickness = [1, 1, 1];
    const netRes = [1, 0, 1];
    const netPay = [1, 1, 1];
    const s = intervalDistribution({ values, thickness, netRes, netPay }, { filter: 'netPay', excludeWashout: false, mean: 'thickness' }, [{ start: 0, end: 3 }]);
    expect(s.n).toBe(2);
    expect(s.mean).toBeCloseTo(0.25, 12);
  });
});

describe('intervalDistribution: espesor en derrumbe', () => {
  it('washoutThickness se cuenta se excluya o no; excludedWashout solo al excluir', () => {
    const input = { values: [0.1, 0.2, 0.3, 0.4], thickness: [1, 1, 1, 2], washout: [0, 1, NaN, 1] };
    const one = [{ start: 0, end: 4 }];
    const incl = intervalDistribution(input, { filter: 'all', excludeWashout: false, mean: 'thickness' }, one);
    expect(incl.washoutThickness).toBe(3);
    expect(incl.excludedWashout).toBe(0);
    expect(incl.n).toBe(4);
    const excl = intervalDistribution(input, { filter: 'all', excludeWashout: true, mean: 'thickness' }, one);
    expect(excl.washoutThickness).toBe(3);
    expect(excl.excludedWashout).toBe(3);
    expect(excl.n).toBe(2);
  });
});
