/**
 * Estadísticas agregadas del sumario (src/petro/summary.ts + positiveMeans de src/petro/stats.ts): media geométrica y
 * armónica ponderadas por espesor (k, RT), percentiles P10/P50/P90 ponderados por espesor y nulos.
 * Casos a mano (cuentas en cada `it`) y pozo del TP contra un cálculo independiente en Python/NumPy
 * (numpy 2.5.3; mismas entradas, ver `tpInputs`). Script: scripts/qa/sumario-estadisticas-referencia.py, que implementa el
 * cuantil ponderado desde la definición (acumulada en el punto medio de cada peso + np.interp) y lo valida contra
 * `np.percentile(method='hazen')` con pesos iguales. Pesos: espesor h en φ, Vsh, k y RT; volumen poral h·φ en Sw.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { positiveMeans } from '../src/petro/stats';
import { summarizeRanges, type SummaryInput } from '../src/petro/summary';

describe('petro/stats: positiveMeans (geométrica y armónica ponderadas)', () => {
  it('geométrica de [1, 10, 100] con pesos iguales = 10 (exp((0 + ln10 + 2·ln10)/3) = 10)', () => {
    expect(positiveMeans([1, 10, 100]).geo).toBeCloseTo(10, 12);
  });
  it('geométrica con pesos [1, 1, 2] = exp((ln10 + 2·2·ln10)/4) = 10^(5/4)', () => {
    expect(positiveMeans([1, 10, 100], [1, 1, 2]).geo).toBeCloseTo(10 ** 1.25, 12);
  });
  it('armónica de [1, 100] con pesos iguales = 2/(1 + 1/100) = 200/101', () => {
    const m = positiveMeans([1, 100]);
    expect(m.harm).toBeCloseTo(200 / 101, 12);
    expect(m.geo).toBeCloseTo(10, 12);
    expect(m.arith).toBeCloseTo(50.5, 12);
  });
  it('armónica ponderada: [1, 100] con pesos [3, 1] = 4/(3 + 0,01)', () => {
    expect(positiveMeans([1, 100], [3, 1]).harm).toBeCloseTo(4 / 3.01, 12);
  });
  it('valores ≤ 0 y NaN son nulos: no entran en las medias y se cuentan con su peso', () => {
    const m = positiveMeans([1, 0, -5, NaN, 100], [1, 2, 3, 4, 1]);
    expect(m.n).toBe(2);
    expect(m.nullCount).toBe(3);
    expect(m.nullWeight).toBe(9);
    expect(m.geo).toBeCloseTo(10, 12);
  });
  it('un valor repetido: las tres medias coinciden', () => {
    const m = positiveMeans([7, 7, 7], [1, 2, 3]);
    expect(m.geo).toBeCloseTo(7, 12);
    expect(m.harm).toBeCloseTo(7, 12);
    expect(m.arith).toBeCloseTo(7, 12);
  });
  it('sin muestras positivas → NaN (no 0) y sin excepción; pesos ≤ 0 se ignoran por completo', () => {
    for (const m of [positiveMeans([]), positiveMeans([0, -1, NaN]), positiveMeans([5], [0])]) {
      expect(m.geo).toBeNaN();
      expect(m.harm).toBeNaN();
      expect(m.arith).toBeNaN();
      expect(m.n).toBe(0);
    }
    expect(positiveMeans([5, 0], [0, 1]).nullCount).toBe(1); // el 5 con peso 0 no es nulo ni usado
  });
});

// Diez muestras de 1 m, todas reservorio y pay: k = 1..10 → percentiles de Hazen evidentes.
const ones = (n: number) => Array(n).fill(1);
const TEN: SummaryInput = {
  thickness: ones(10),
  netRes: ones(10),
  netPay: ones(10),
  phi: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5],
  sw: ones(10).map(() => 0.5),
  vsh: ones(10).map(() => 0.2),
  perm: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  rt: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
};
const ALL10 = [{ start: 0, end: 10 }];

describe('petro/summary: percentiles ponderados por espesor', () => {
  const s = summarizeRanges(TEN, ALL10);

  it('k = 1..10, pesos iguales: c_j = (j − 0,5)/10 → P10 = 1,5; P50 = 5,5; P90 = 9,5 (Hazen)', () => {
    expect(s.statsPay.k.p10).toBeCloseTo(1.5, 12);
    expect(s.statsPay.k.p50).toBeCloseTo(5.5, 12);
    expect(s.statsPay.k.p90).toBeCloseTo(9.5, 12);
    expect(s.statsPay.k.n).toBe(10);
    expect(s.statsPay.k.thickness).toBeCloseTo(10, 12);
  });
  it('φ lineal en [0,05; 0,5]: P50 = 0,275; el conjunto de reservorio da lo mismo si todo es pay', () => {
    expect(s.statsRes.phi.p50).toBeCloseTo(0.275, 12);
    expect(s.statsPay.phi.p50).toBeCloseTo(0.275, 12);
  });
  it('variable constante (Sw = 0,5, Vsh = 0,2, RT = 10): P10 = P50 = P90 = el valor', () => {
    for (const d of [s.statsRes.sw, s.statsPay.sw]) expect([d.p10, d.p50, d.p90]).toEqual([0.5, 0.5, 0.5]);
    expect(s.statsPay.vsh.p50).toBeCloseTo(0.2, 12);
    expect(s.statsPay.rt.p90).toBe(10);
  });
  it('pesos desiguales: k = [1, 2, 3] con h = [1, 2, 1] → c = [0,125; 0,5; 0,875] y P50 = 2 (la mediana de las capas)', () => {
    const t = summarizeRanges(
      { thickness: [1, 2, 1], netRes: [1, 1, 1], netPay: [1, 1, 1], phi: [0.2, 0.2, 0.2], sw: [0.3, 0.3, 0.3], perm: [1, 2, 3] },
      [{ start: 0, end: 3 }],
    );
    expect(t.statsPay.k.p50).toBeCloseTo(2, 12);
    expect(t.statsPay.k.p10).toBe(1); // por debajo de c₁ = 0,125 vale el mínimo (no extrapola)
    expect(t.statsPay.k.p90).toBe(3);
    expect(t.statsPay.k.thickness).toBeCloseTo(4, 12);
  });
  it('solo cuentan las muestras del conjunto: el no pay no entra en statsPay pero sí en statsRes', () => {
    const t = summarizeRanges({ ...TEN, netPay: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] }, ALL10);
    expect(t.statsPay.k.n).toBe(5);
    expect(t.statsPay.k.p50).toBeCloseTo(3, 12); // k = 1..5, Hazen: c = 0,1; 0,3; 0,5; 0,7; 0,9 → P50 = 3
    expect(t.statsRes.phi.n).toBe(10);
  });
});

describe('petro/summary: media geométrica y armónica de k y RT', () => {
  it('k = [1, 100] con h iguales: geo = 10, armónica = 200/101, aritmética (kPay) = 50,5; kh no cambia', () => {
    const t = summarizeRanges(
      { thickness: [1, 1], netRes: [1, 1], netPay: [1, 1], phi: [0.2, 0.2], sw: [0.3, 0.3], perm: [1, 100], rt: [1, 100] },
      [{ start: 0, end: 2 }],
    );
    expect(t.kMeansPay.geo).toBeCloseTo(10, 12);
    expect(t.kMeansPay.harm).toBeCloseTo(200 / 101, 12);
    expect(t.kPay).toBeCloseTo(50.5, 12);
    expect(t.khPay).toBeCloseTo(101, 12);
    expect(t.rtMeansPay.geo).toBeCloseTo(10, 12);
  });
  it('k con NaN, 0 y negativo: percentiles con los finitos, medias solo con los positivos; nulos informados', () => {
    const t = summarizeRanges(
      { thickness: ones(5), netRes: ones(5), netPay: ones(5), phi: ones(5).map(() => 0.2), sw: ones(5).map(() => 0.3), perm: [NaN, 0, -1, 4, 16] },
      [{ start: 0, end: 5 }],
    );
    expect(t.kMeansPay.n).toBe(2);
    expect(t.kMeansPay.geo).toBeCloseTo(8, 12);
    expect(t.kMeansPay.harm).toBeCloseTo(2 / (1 / 4 + 1 / 16), 12);
    expect(t.kMeansPay.nullCount).toBe(3); // NaN, 0 y −1
    expect(t.kMeansPay.nullWeight).toBeCloseTo(3, 12);
    expect(t.statsPay.k.nullCount).toBe(1); // para los percentiles solo el NaN es nulo
    expect(t.statsPay.k.nullThickness).toBeCloseTo(1, 12);
    expect(t.statsPay.k.n).toBe(4); // −1, 0, 4, 16
    expect(t.statsPay.k.p50).toBeCloseTo(2, 12); // Hazen sobre [−1, 0, 4, 16]: c = .125 .375 .625 .875 → 0 + (0,5 − 0,375)/0,25·4 = 2
  });
  it('cantidades de la muestra Sw sin φ: una muestra con Sw pero sin φ es nula para los percentiles de Sw (conjunto de S̄w)', () => {
    const t = summarizeRanges(
      { thickness: [1, 1, 1], netRes: [1, 1, 1], netPay: [1, 1, 1], phi: [0.2, NaN, 0.2], sw: [0.2, 0.4, 0.6] },
      [{ start: 0, end: 3 }],
    );
    expect(t.statsRes.sw.n).toBe(2);
    expect(t.statsRes.sw.nullCount).toBe(1);
    expect(t.statsRes.sw.p50).toBeCloseTo(0.4, 12); // [0,2; 0,6]
    expect(t.statsRes.phi.nullCount).toBe(1);
  });
});

describe('petro/summary: percentiles de Sw por volumen poral h·φ', () => {
  // h = [1, 1, 2], φ = [0,1; 0,2; 0,3], Sw = [0,2; 0,4; 0,8] → w = h·φ = [0,1; 0,2; 0,6], W = 0,9
  // c = [0,05/0,9; 0,2/0,9; 0,6/0,9] = [1/18, 2/9, 2/3]. P50: entre c₂ y c₃ → 0,4 + (1/2 − 2/9)/(2/3 − 2/9)·0,4 = 0,4 + 0,625·0,4 = 0,65
  const t = summarizeRanges(
    { thickness: [1, 1, 2], netRes: [1, 1, 1], netPay: [1, 1, 1], phi: [0.1, 0.2, 0.3], sw: [0.2, 0.4, 0.8] },
    [{ start: 0, end: 3 }],
  );
  it('P50 = 0,65 con peso h·φ (con peso h, c = [0,125; 0,375; 0,75], daría 0,4 + (0,125/0,375)·0,4 = 0,5333)', () => {
    expect(t.statsRes.sw.p50).toBeCloseTo(0.65, 12);
    expect(t.statsRes.sw.p10).toBeCloseTo(0.2 + ((0.1 - 1 / 18) / (2 / 9 - 1 / 18)) * 0.2, 12); // entre c₁ y c₂ = 0,25333…
  });
  it('el espesor con dato sigue siendo Σh (4 m), no Σh·φ', () => {
    expect(t.statsRes.sw.thickness).toBeCloseTo(4, 12);
    expect(t.statsRes.phi.thickness).toBeCloseTo(4, 12);
  });
  it('φ = 0 → peso 0: no entra al percentil ni divide por cero, pero cuenta como muestra con dato', () => {
    const z = summarizeRanges(
      { thickness: [1, 1, 1], netRes: [1, 1, 1], netPay: [1, 1, 1], phi: [0, 0.2, 0.2], sw: [1, 0.3, 0.5] },
      [{ start: 0, end: 3 }],
    );
    expect(z.statsRes.sw.n).toBe(3);
    expect(z.statsRes.sw.p50).toBeCloseTo(0.4, 12); // solo [0,3; 0,5] con pesos iguales
    expect(z.swRes).toBeCloseTo(0.4, 12); // mismo conjunto efectivo que S̄w
    const all0 = summarizeRanges({ thickness: [1, 1], netRes: [1, 1], netPay: [1, 1], phi: [0, 0], sw: [0.3, 0.5] }, [{ start: 0, end: 2 }]);
    expect(all0.statsRes.sw.p50).toBeNaN();
    expect(all0.swRes).toBeNaN();
  });
});

describe('petro/summary: RT en el reservorio (statsRes.rt) y media armónica de RT', () => {
  // RT = [1, 2, 3, 4] con h iguales; todo reservorio, pay solo las dos primeras.
  const s = summarizeRanges(
    { thickness: [1, 1, 1, 1], netRes: [1, 1, 1, 1], netPay: [1, 1, 0, 0], phi: [0.2, 0.2, 0.2, 0.2], sw: [0.3, 0.3, 0.8, 0.8], rt: [1, 2, 3, 4] },
    [{ start: 0, end: 4 }],
  );
  it('Hazen con pesos iguales: c = [0,125; 0,375; 0,625; 0,875] → P10 = 1 (extremo), P50 = 2,5, P90 = 4 (extremo)', () => {
    expect(s.statsRes.rt.p10).toBe(1);
    expect(s.statsRes.rt.p50).toBeCloseTo(2.5, 12);
    expect(s.statsRes.rt.p90).toBe(4);
    expect(s.statsRes.rt.n).toBe(4);
    expect(s.statsRes.rt.thickness).toBe(4);
    expect(s.statsRes.rt.nullCount).toBe(0);
  });
  it('el pay solo ve sus muestras: P50 de RT del pay = 1,5; armónica = 2/(1 + 1/2) = 4/3 (capas en paralelo)', () => {
    expect(s.statsPay.rt.p50).toBeCloseTo(1.5, 12);
    expect(s.rtMeansPay.harm).toBeCloseTo(4 / 3, 12);
    expect(s.rtMeansPay.geo).toBeCloseTo(Math.SQRT2, 12);
  });
  it('RT sin dato en el reservorio es nulo con su espesor; sin curva RT, nulos NaN', () => {
    const t = summarizeRanges({ thickness: [1, 2, 1], netRes: [1, 1, 0], netPay: [0, 0, 0], phi: [0.2, 0.2, 0.2], sw: [1, 1, 1], rt: [5, NaN, 9] }, [{ start: 0, end: 3 }]);
    expect(t.statsRes.rt).toMatchObject({ n: 1, thickness: 1, nullCount: 1, nullThickness: 2, p50: 5 });
    const u = summarizeRanges({ thickness: [1], netRes: [1], netPay: [1], phi: [0.2], sw: [0.3] }, [{ start: 0, end: 1 }]);
    expect(u.statsRes.rt.nullCount).toBeNaN();
    expect(u.statsRes.rt.p50).toBeNaN();
  });
});

describe('petro/summary: opción distributions = false', () => {
  it('deja las estadísticas sin dato (n = 0, NaN) y no cambia ningún otro campo', () => {
    const full = summarizeRanges(TEN, ALL10);
    const lean = summarizeRanges(TEN, ALL10, { distributions: false });
    const { statsRes: _a, statsPay: _b, kMeansPay: _c, rtMeansPay: _d, ...restFull } = full;
    const { statsRes, statsPay, kMeansPay, rtMeansPay, ...restLean } = lean;
    expect(restLean).toEqual(restFull);
    for (const d of [statsRes.phi, statsRes.sw, statsRes.vsh, statsRes.rt, statsPay.phi, statsPay.sw, statsPay.vsh, statsPay.k, statsPay.rt]) {
      expect(d.n).toBe(0);
      expect(d.p50).toBeNaN();
    }
    expect(kMeansPay.geo).toBeNaN();
    expect(rtMeansPay.harm).toBeNaN();
    expect(full.statsPay.k.p50).toBeCloseTo(5.5, 12); // por defecto sí se calculan
  });
});

describe('petro/summary: sin datos → NaN, sin excepción', () => {
  it('rango vacío y zona sin neto: percentiles y medias NaN, n = 0', () => {
    for (const ranges of [[{ start: 3, end: 3 }], [] as { start: number; end: number }[], [{ start: 0, end: 4 }]]) {
      const t = summarizeRanges({ ...TEN, netRes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], netPay: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, ranges);
      for (const d of [t.statsRes.phi, t.statsRes.sw, t.statsRes.vsh, t.statsPay.k, t.statsPay.rt]) {
        expect(d.n).toBe(0);
        expect(d.p10).toBeNaN();
        expect(d.p50).toBeNaN();
        expect(d.p90).toBeNaN();
        expect(d.nullCount).toBe(0);
      }
      expect(t.kMeansPay.geo).toBeNaN();
      expect(t.kMeansPay.harm).toBeNaN();
      expect(t.rtMeansPay.geo).toBeNaN();
    }
  });
  it('sin curvas opcionales (vsh, perm, rt): sus estadísticas son NaN, con nulos NaN (no 0); el resto no cambia', () => {
    const t = summarizeRanges({ ...TEN, vsh: undefined, perm: undefined, rt: undefined }, ALL10);
    expect(t.statsPay.k.p50).toBeNaN();
    expect(t.statsPay.k.nullCount).toBeNaN();
    expect(t.statsPay.vsh.p50).toBeNaN();
    expect(t.statsPay.rt.p50).toBeNaN();
    expect(t.kMeansPay.geo).toBeNaN();
    expect(t.rtMeansPay.geo).toBeNaN();
    expect(t.statsPay.phi.p50).toBeCloseTo(0.275, 12);
  });
});

// ── Pozo del TP ────────────────────────────────────────────────────────────────────────────────────────────────
// Entradas (idénticas en el script NumPy de referencia): φ = PHIE_CMR; RT = AT90; k = Timur–Coates (C = 10) con
// BVI = PHI_BVI (0 si φ ≤ BVI; NaN si φ o BVI ≤ 0); Vsh = clip((GR − 30)/90, 0, 1); Sw = min(1, √(0,02/(φ²·RT)))
// (Archie, a = 1, m = n = 2, Rw = 0,02); reservorio = φ ≥ 0,08; pay = reservorio y RT ≥ 2; h = 0,1524 m.
function tpInputs() {
  const lines = csvText.trim().split(/\r?\n/);
  const head = lines[0]!.split(',');
  const col = (name: string) => head.indexOf(name);
  const num = (s: string | undefined) => (s === undefined || s === '' ? NaN : Number(s));
  const rows = lines.slice(1).map((l) => l.split(','));
  const get = (name: string) => rows.map((r) => num(r[col(name)]));
  const phi = get('PHIE_CMR');
  const bvi = get('PHI_BVI');
  const rt = get('AT90');
  const gr = get('GR');
  const zona = rows.map((r) => r[col('ZONA')]!);
  const n = rows.length;
  const perm = phi.map((p, i) => {
    const b = bvi[i]!;
    if (!(p > 0) || !(b > 0)) return NaN;
    const ffi = p - b;
    return ffi <= 0 ? 0 : (100 * p / 10) ** 4 * (ffi / b) ** 2;
  });
  const vsh = gr.map((g) => Math.min(1, Math.max(0, (g - 30) / 90)));
  const sw = phi.map((p, i) => Math.min(1, Math.sqrt(0.02 / (p * p * rt[i]!))));
  const netRes = phi.map((p) => (p >= 0.08 ? 1 : 0));
  const netPay = phi.map((_, i) => (netRes[i] === 1 && rt[i]! >= 2 ? 1 : 0));
  const input: SummaryInput = { thickness: Array(n).fill(0.1524), netRes, netPay, phi, sw, vsh, perm, rt };
  const range = (z: string) => {
    const idx = zona.map((x, i) => (x === z ? i : -1)).filter((i) => i >= 0);
    return [{ start: idx[0]!, end: idx[idx.length - 1]! + 1 }];
  };
  return { input, n, zones: ['A', 'B', 'C', 'D', 'E'].map((z) => ({ z, ranges: range(z) })) };
}

describe('petro/summary: pozo del TP (datos/pozo_tp_perfiles.csv)', () => {
  const tp = tpInputs();
  const whole = summarizeRanges(tp.input, [{ start: 0, end: tp.n }]);

  it('armónica ≤ geométrica ≤ aritmética para k y RT, en el pozo y en cada zona', () => {
    const sets = [whole, ...tp.zones.map(({ ranges }) => summarizeRanges(tp.input, ranges))];
    for (const s of sets) {
      if (s.kMeansPay.n === 0) continue; // zona sin pay
      expect(s.kMeansPay.harm).toBeLessThanOrEqual(s.kMeansPay.geo);
      expect(s.kMeansPay.geo).toBeLessThanOrEqual(s.kPay);
      expect(s.rtMeansPay.harm).toBeLessThanOrEqual(s.rtMeansPay.geo);
      expect(s.rtMeansPay.geo).toBeLessThanOrEqual(s.rtMeansPay.arith);
    }
    expect(sets.some((s) => s.kMeansPay.n > 0)).toBe(true);
    // El pozo tiene dispersión real de k: las desigualdades son estrictas
    expect(whole.kMeansPay.harm).toBeLessThan(whole.kMeansPay.geo);
    expect(whole.kMeansPay.geo).toBeLessThan(whole.kPay);
  });

  it('pozo completo contra NumPy: medias de k y RT, y P10/P50/P90 de φ, Vsh, Sw, k y RT', () => {
    expect(whole.netRes / 0.1524).toBeCloseTo(3213, 6);
    expect(whole.netPay / 0.1524).toBeCloseTo(995, 6);
    expect(whole.kMeansPay.geo).toBeCloseTo(1.4856195403329102, 9);
    expect(whole.kMeansPay.harm).toBeCloseTo(0.2745393489851414, 9);
    expect(whole.kPay).toBeCloseTo(2.8799190534131593, 9);
    expect(whole.rtMeansPay.geo).toBeCloseTo(3.3072423816021033, 9);
    expect(whole.rtMeansPay.harm).toBeCloseTo(3.1187616768311504, 9);
    const p = (d: { p10: number; p50: number; p90: number }) => [d.p10, d.p50, d.p90];
    const near = (got: number[], want: number[]) => want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 9));
    near(p(whole.statsRes.phi), [0.093, 0.155, 0.202]);
    near(p(whole.statsRes.vsh), [0.23850888888888888, 0.4155333333333333, 0.6453222222222221]);
    // Sw ponderada por h·φ (con peso h daría [0,39888…; 0,93661…; 1], el valor anterior a ponderar por volumen poral)
    near(p(whole.statsRes.sw), [0.3714595011380647, 0.8126554006541726, 1.0]);
    near(p(whole.statsPay.sw), [0.30736194860343363, 0.44185160635346216, 0.6469386641332276]);
    expect(whole.statsRes.sw.thickness / 0.1524).toBeCloseTo(3213, 6); // el espesor con dato sigue siendo espesor, no h·φ
    near(p(whole.statsPay.k), [0.25401600000000013, 1.8745101572001275, 6.138734948096887]);
    near(p(whole.statsPay.rt), [2.168, 3.148, 5.433]);
    // RT en todo el reservorio neto (NumPy, scripts/qa/sumario-estadisticas-referencia.py «rt res»).
    near(p(whole.statsRes.rt), [0.521, 1.362, 3.8522000000000025]);
    expect(whole.statsRes.rt.nullCount).toBe(0);
    expect(whole.statsPay.k.nullCount).toBe(0);
    expect(whole.kMeansPay.nullCount).toBe(0);
  });

  it('zona A contra NumPy', () => {
    const a = summarizeRanges(tp.input, tp.zones[0]!.ranges);
    expect(a.netRes / 0.1524).toBeCloseTo(140, 6);
    expect(a.netPay / 0.1524).toBeCloseTo(14, 6);
    expect(a.kMeansPay.geo).toBeCloseTo(3.016182806057563, 9);
    expect(a.kMeansPay.harm).toBeCloseTo(2.19064728295687, 9);
    expect(a.kPay).toBeCloseTo(3.531631606851403, 9);
    expect(a.rtMeansPay.geo).toBeCloseTo(2.9119675010340593, 9);
    expect(a.rtMeansPay.harm).toBeCloseTo(2.7627430185266135, 9);
    [0.084, 0.1595, 0.3395].forEach((w, i) => expect([a.statsRes.phi.p10, a.statsRes.phi.p50, a.statsRes.phi.p90][i]).toBeCloseTo(w, 9));
    [0.4435511104431689, 0.7222120393941867, 1.0].forEach((w, i) => expect([a.statsRes.sw.p10, a.statsRes.sw.p50, a.statsRes.sw.p90][i]).toBeCloseTo(w, 9));
    [0.30791907621579484, 0.4972949636361411, 0.5914470724010171].forEach((w, i) => expect([a.statsPay.sw.p10, a.statsPay.sw.p50, a.statsPay.sw.p90][i]).toBeCloseTo(w, 9));
    [1.60123903012737, 3.4850188846787007, 5.732011643934247].forEach((w, i) => expect([a.statsPay.k.p10, a.statsPay.k.p50, a.statsPay.k.p90][i]).toBeCloseTo(w, 9));
    [2.1776, 2.4595000000000002, 5.4223].forEach((w, i) => expect([a.statsPay.rt.p10, a.statsPay.rt.p50, a.statsPay.rt.p90][i]).toBeCloseTo(w, 9));
    [0.3995, 0.5845, 2.0545].forEach((w, i) => expect([a.statsRes.rt.p10, a.statsRes.rt.p50, a.statsRes.rt.p90][i]).toBeCloseTo(w, 9));
  });
});
