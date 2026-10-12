/**
 * Incertidumbre del volumen in situ (Monte Carlo + tornado). Casos de resultado conocido:
 *  - Φ y Φ⁻¹ contra valores de tabla (Abramowitz y Stegun) y de math.erfc de Python (referencia independiente);
 *  - cuantiles de uniforme/triangular/normal truncada contra fórmula cerrada;
 *  - h·φ·Sh perturbado: cuenta a mano y contra el sumario (summarizeRanges + netFlagsInto);
 *  - parámetros fijos → P10 = P50 = P90 = A·hφSh/B; A uniforme → percentiles de la uniforme; producto de dos uniformes
 *    (CDF por integración numérica independiente); tornado con orden y amplitudes calculadas a mano;
 *  - convención de la industria P90 < P50 < P10, reproducibilidad por semilla, suma de zonas (correlacionadas e
 *    independientes), rendimiento 5000 iteraciones × 5 zonas < 1 s;
 *  - el módulo `uncertainty` en el motor: determinista = módulo volumétrico y forma de las salidas.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { Engine, toEngineWell, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import type { TableValue, ZoneScalarValue } from '../src/core/module';
import type { Zone } from '../src/core/well';
import { netFlagsInto } from '../src/petro/cutoffs';
import { summarizeRanges } from '../src/petro/summary';
import {
  describeSample,
  distQuantile,
  fixedDist,
  mulberry32,
  normalCdf,
  normalQuantile,
  perturbedHphiSh,
  quantileSorted,
  runUncertainty,
  spearman,
  type Dist,
  type UncertainZone,
} from '../src/petro/uncertainty';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import { curve, well, zone } from './helpers';

// ---------------------------------------------------------------------------------------------------------------
// Zona de cuentas a mano: 5 muestras de 0,5 m. Cutoffs Vsh ≤ 0,4; φ ≥ 0,08; Sw ≤ 0,6.
//   1 (0,1; 0,20; 0,3) pay      → 0,5·0,20·0,7  = 0,0700
//   2 (0,5; 0,20; 0,1) Vsh>0,4  → no reservorio
//   3 (0,1; 0,05; 0,2) φ<0,08   → no reservorio
//   4 (0,2; 0,10; 0,8) reservorio, Sw>0,6 → no pay
//   5 (0,3; 0,15; 0,5) pay      → 0,5·0,15·0,5  = 0,0375
// hφSh = 0,1075 m
const H = [0.5, 0.5, 0.5, 0.5, 0.5];
const VSH = [0.1, 0.5, 0.1, 0.2, 0.3];
const PHI = [0.2, 0.2, 0.05, 0.1, 0.15];
const SW = [0.3, 0.1, 0.2, 0.8, 0.5];
const CUT = { vshMax: 0.4, phiMin: 0.08, swMax: 0.6 };
const HPHISH = 0.1075;
const A0 = 2e6; // m²
const B0 = 1.2;
const V0 = (A0 * HPHISH) / B0; // 179 166,67 m³

function handZone(over: Partial<UncertainZone> = {}): UncertainZone {
  return { id: 'z1', name: 'Z1', fluid: 'oil', h: H, vsh: VSH, phi: PHI, sw: SW, cutoffs: CUT, area: fixedDist(A0), b: fixedDist(B0), ...over };
}
const uni = (min: number, mode: number, max: number): Dist => ({ kind: 'uniform', min, mode, max });
const tri = (min: number, mode: number, max: number): Dist => ({ kind: 'triangular', min, mode, max });

function target(r: ReturnType<typeof runUncertainty>, key: string) {
  const t = r.targets.find((x) => x.key === key);
  if (!t) throw new Error(`Falta el objetivo ${key}`);
  return t;
}

describe('normal estándar', () => {
  it('Φ contra valores de tabla y erfc de Python', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 15);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 13);
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145707, 13);
    expect(normalCdf(3)).toBeCloseTo(0.9986501019683699, 13);
    expect(normalCdf(-6) / 9.865876450377012e-10).toBeCloseTo(1, 8);
  });
  it('Φ⁻¹: 0,975 → 1,959964 (A&S); 0,1 → −1,2815516; colas', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.9599639845400532, 10);
    expect(normalQuantile(0.1)).toBeCloseTo(-1.2815515655446008, 10);
    expect(normalQuantile(1e-8)).toBeCloseTo(-5.612001244174788, 8);
    expect(normalQuantile(0.999999)).toBeCloseTo(4.7534243088058705, 8);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 14);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
  });
});

describe('PRNG mulberry32', () => {
  it('misma semilla, misma secuencia; distinta semilla, otra', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const c = mulberry32(124);
    const sa = Array.from({ length: 10 }, a);
    expect(Array.from({ length: 10 }, b)).toEqual(sa);
    expect(Array.from({ length: 10 }, c)).not.toEqual(sa);
  });
  it('u ∈ [0,1), media 1/2 y varianza 1/12 (N = 100 000)', () => {
    const r = mulberry32(7);
    const n = 100000;
    let s = 0;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const u = r();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      s += u;
      ss += u * u;
    }
    expect(s / n).toBeCloseTo(0.5, 2);
    expect(ss / n - (s / n) ** 2).toBeCloseTo(1 / 12, 3);
  });
});

describe('cuantiles de las distribuciones', () => {
  it('uniforme U(1, 3): F⁻¹(u) = 1 + 2u', () => {
    expect(distQuantile(uni(1, 2, 3), 0)).toBe(1);
    expect(distQuantile(uni(1, 2, 3), 0.25)).toBe(1.5);
    expect(distQuantile(uni(1, 2, 3), 1)).toBe(3);
  });
  it('triangular (0, 1, 4): mediana 4 − √6, F(moda) = 1/4, media 5/3', () => {
    const d = tri(0, 1, 4);
    expect(distQuantile(d, 0.5)).toBeCloseTo(4 - Math.sqrt(6), 12);
    expect(distQuantile(d, 0.25)).toBeCloseTo(1, 12);
    expect(distQuantile(d, 0)).toBe(0);
    expect(distQuantile(d, 1)).toBeCloseTo(4, 12);
    const n = 100000;
    let s = 0;
    for (let i = 0; i < n; i++) s += distQuantile(d, (i + 0.5) / n);
    expect(s / n).toBeCloseTo(5 / 3, 4);
  });
  it('normal truncada ±1, σ = 1: F⁻¹(0,75) = 0,44177054668658 y σ_trunc = 0,53956009375 (Python/erfc)', () => {
    const d: Dist = { kind: 'normal', min: -1, mode: 0, max: 1, sd: 1 };
    expect(distQuantile(d, 0.75)).toBeCloseTo(0.44177054668658133, 10);
    expect(distQuantile(d, 0.5)).toBeCloseTo(0, 12);
    const n = 200000;
    let s = 0;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const x = distQuantile(d, (i + 0.5) / n);
      s += x;
      ss += x * x;
    }
    expect(s / n).toBeCloseTo(0, 6);
    expect(Math.sqrt(ss / n - (s / n) ** 2)).toBeCloseTo(0.5395600937548969, 4);
  });
  it('normal truncada asimétrica N(1, 2) en [−3, 4]: cuantiles 0,1 y 0,9 (Python/erfc)', () => {
    const d: Dist = { kind: 'normal', min: -3, mode: 1, max: 4, sd: 2 };
    expect(distQuantile(d, 0.9)).toBeCloseTo(3.0066547344308345, 9);
    expect(distQuantile(d, 0.1)).toBeCloseTo(-1.413186657268768, 9);
  });
  it('normal sin sd: σ = (max − min)/6; casi sin truncar → F⁻¹(0,975) ≈ μ + 1,96σ', () => {
    const d: Dist = { kind: 'normal', min: -10, mode: 0, max: 10, sd: 1 };
    expect(distQuantile(d, 0.975)).toBeCloseTo(1.9599639845400532, 8);
    const d2: Dist = { kind: 'normal', min: 0, mode: 5, max: 12 }; // σ = 2
    expect(distQuantile(d2, 0.5)).toBeGreaterThan(5); // truncada asimétrica: la mediana sube
  });
  it('distribuciones inválidas lanzan RangeError', () => {
    const z = (a: Dist) => () => runUncertainty({ zones: [handZone({ area: a })], iterations: 10 });
    expect(z(uni(3, 2, 1))).toThrow(RangeError);
    expect(z(tri(1, 5, 3))).toThrow(RangeError);
    expect(z(uni(NaN, 1, 2))).toThrow(RangeError);
  });
});

describe('cuantiles de la muestra (convención de la industria)', () => {
  it('1…101: P90 = 11, P50 = 51, P10 = 91 (interpolación tipo 7)', () => {
    const v = Array.from({ length: 101 }, (_, i) => i + 1);
    const s = describeSample(v)!;
    expect(s.p90).toBeCloseTo(11, 12);
    expect(s.p50).toBeCloseTo(51, 12);
    expect(s.p10).toBeCloseTo(91, 12);
    expect(s.mean).toBeCloseTo(51, 12);
    expect(s.sd).toBeCloseTo(Math.sqrt((101 * 102) / 12), 10); // sd muestral de 1…n = √(n(n+1)/12)
  });
  it('interpolación entre vecinos y NaN fuera de la muestra', () => {
    expect(quantileSorted([0, 10], 0.25)).toBe(2.5);
    expect(quantileSorted([], 0.5)).toBeNaN();
    expect(describeSample([NaN, NaN])).toBeNull();
  });
  it('histograma: cuentas suman n, bordes de min a max; curva monótona de 0 a 100 %', () => {
    const r = mulberry32(5);
    const v = Array.from({ length: 1000 }, () => r());
    const s = describeSample(v, 20)!;
    expect(s.histogram.edges).toHaveLength(21);
    expect(s.histogram.counts).toHaveLength(20);
    expect(s.histogram.counts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(s.histogram.edges[0]).toBe(s.min);
    expect(s.histogram.edges[20]).toBe(s.max);
    expect(s.curve.prob).toHaveLength(101);
    expect(s.curve.value[0]).toBe(s.min);
    expect(s.curve.value[100]).toBe(s.max);
    for (let i = 1; i <= 100; i++) expect(s.curve.value[i]!).toBeGreaterThanOrEqual(s.curve.value[i - 1]!);
  });
  it('muestra constante: una sola clase', () => {
    const s = describeSample([3, 3, 3])!;
    expect(s.histogram).toEqual({ edges: [3, 3], counts: [3] });
    expect(s.sd).toBe(0);
  });
});

describe('Spearman', () => {
  it('caso a mano con empates: ρ = 8/√95 = 0,82076', () => {
    expect(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])).toBeCloseTo(8 / Math.sqrt(95), 12);
  });
  it('monótona creciente = 1, decreciente = −1, serie constante = NaN', () => {
    expect(spearman([1, 2, 3, 4], [1, 8, 27, 1000])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [9, 5, 2, 1])).toBeCloseTo(-1, 12);
    expect(spearman([1, 2, 3], [4, 4, 4])).toBeNaN();
  });
});

describe('h·φ·Sh perturbado', () => {
  const hp = (factors: Partial<{ phiMult: number; swMult: number; vshCutoffDelta: number; phiCutoffDelta: number; swCutoffDelta: number }>) =>
    perturbedHphiSh(H, VSH, PHI, SW, CUT, { phiMult: 1, swMult: 1, vshCutoffDelta: 0, phiCutoffDelta: 0, swCutoffDelta: 0, ...factors });

  it('caso base: 0,0700 + 0,0375 = 0,1075 m', () => {
    expect(hp({})).toBeCloseTo(0.1075, 14);
  });
  it('Sw máx +0,25 (0,85): entra la muestra 4 → 0,1075 + 0,5·0,10·0,2 = 0,1175', () => {
    expect(hp({ swCutoffDelta: 0.25 })).toBeCloseTo(0.1175, 14);
  });
  it('Sw máx −0,25 (0,35): sale la muestra 5 → 0,0700', () => {
    expect(hp({ swCutoffDelta: -0.25 })).toBeCloseTo(0.07, 14);
  });
  it('Vsh máx +0,2 (0,6): entra la muestra 2 → 0,1075 + 0,5·0,20·0,9 = 0,1975', () => {
    expect(hp({ vshCutoffDelta: 0.2 })).toBeCloseTo(0.1975, 14);
  });
  it('φ mín +0,06 (0,14): sale la muestra 4 (no era pay) y sigue la 5 (0,15) → 0,1075; +0,08 (0,16) → solo la 1: 0,07', () => {
    expect(hp({ phiCutoffDelta: 0.06 })).toBeCloseTo(0.1075, 14);
    expect(hp({ phiCutoffDelta: 0.08 })).toBeCloseTo(0.07, 14);
  });
  it('φ × 1,5: s1 0,30 → 0,105; s5 0,225 → 0,05625; s3 sigue bajo el corte (0,075); s4 (Sw 0,8) sigue sin ser pay → 0,16125', () => {
    expect(hp({ phiMult: 1.5 })).toBeCloseTo(0.16125, 14);
  });
  it('Sw × 1,5: s1 0,45 → 0,055; s5 0,75 > 0,6 → fuera → 0,055', () => {
    expect(hp({ swMult: 1.5 })).toBeCloseTo(0.055, 14);
  });
  it('φ topa en 0,5 y Sw en 1 (rango físico)', () => {
    expect(perturbedHphiSh([1], [0.1], [0.4], [0.2], CUT, { phiMult: 2, swMult: 1, vshCutoffDelta: 0, phiCutoffDelta: 0, swCutoffDelta: 0 })).toBeCloseTo(0.5 * 0.8, 14);
    expect(perturbedHphiSh([1], [0.1], [0.2], [0.9], { ...CUT, swMax: 1 }, { phiMult: 1, swMult: 2, vshCutoffDelta: 0, phiCutoffDelta: 0, swCutoffDelta: 0 })).toBeCloseTo(0, 14);
  });
  it('coincide con summarizeRanges + netFlagsInto en datos con NaN (400 muestras sintéticas, 3 juegos de cutoffs)', () => {
    const rnd = mulberry32(99);
    const n = 400;
    const noisy = (lo: number, hi: number, pNaN: number) => Float64Array.from({ length: n }, () => (rnd() < pNaN ? NaN : lo + (hi - lo) * rnd()));
    const vsh = noisy(0, 0.8, 0.05);
    const phi = noisy(0.02, 0.3, 0.05);
    const sw = noisy(0.05, 1, 0.1);
    const h = Float64Array.from({ length: n }, () => 0.1 + 0.1 * rnd());
    for (const cut of [CUT, { vshMax: 0.25, phiMin: 0.12, swMax: 0.45 }, { vshMax: 0.7, phiMin: 0.03, swMax: 0.95 }]) {
      const netRes = new Float64Array(n);
      const netPay = new Float64Array(n);
      netFlagsInto(vsh, phi, sw, netRes, netPay, cut);
      const ref = summarizeRanges({ thickness: h, netRes, netPay, phi, sw }, [{ start: 0, end: n }]).hphiShPay;
      expect(perturbedHphiSh(h, vsh, phi, sw, cut)).toBeCloseTo(ref, 12);
    }
  });
  it('datos faltantes: sin ninguna muestra clasificada o sin Sw en el reservorio → NaN', () => {
    expect(perturbedHphiSh([1, 1], [NaN, NaN], [0.2, 0.2], [0.3, 0.3], CUT)).toBeNaN(); // falta Vsh en todas
    expect(perturbedHphiSh([1, 1], [0.1, 0.1], [0.2, 0.2], [NaN, NaN], CUT)).toBeNaN(); // reservorio sin Sw
    expect(perturbedHphiSh([1, 1], [0.1, 0.9], [0.2, 0.2], [NaN, 0.3], CUT)).toBeNaN();
    expect(perturbedHphiSh([1], [0.9], [0.2], [0.3], CUT)).toBe(0); // clasificada, no reservorio → 0
  });
});

describe('Monte Carlo: casos de resultado conocido', () => {
  it('parámetros fijos: P10 = P50 = P90 = media = A·hφSh/B y sd = 0', () => {
    const r = runUncertainty({ zones: [handZone()], iterations: 500 });
    const t = target(r, 'z1');
    expect(V0).toBeCloseTo(179166.6667, 3);
    for (const x of [t.stats.p90, t.stats.p50, t.stats.p10, t.stats.mean, t.stats.min, t.stats.max, t.deterministic]) expect(x).toBeCloseTo(V0, 6);
    expect(t.stats.sd).toBe(0);
    expect(t.tornado).toEqual([]);
    expect(t.spearman).toEqual([]);
    expect(target(r, 'TOTAL_OIL').stats.p50).toBeCloseTo(V0, 6);
  });

  it('A ~ U(1e6, 3e6) con el resto fijo: V ~ U(V₁, V₂) → P90 = V₁ + 0,1Δ, P50 = mitad, P10 = V₁ + 0,9Δ; media y sd analíticos', () => {
    const r = runUncertainty({ zones: [handZone({ area: uni(1e6, 2e6, 3e6) })], iterations: 20000, seed: 11 });
    const t = target(r, 'z1');
    const k = HPHISH / B0;
    const v1 = 1e6 * k;
    const v2 = 3e6 * k;
    const d = v2 - v1;
    expect(Math.abs(t.stats.p90 - (v1 + 0.1 * d))).toBeLessThan(0.01 * d);
    expect(Math.abs(t.stats.p50 - (v1 + 0.5 * d))).toBeLessThan(0.01 * d);
    expect(Math.abs(t.stats.p10 - (v1 + 0.9 * d))).toBeLessThan(0.01 * d);
    expect(Math.abs(t.stats.mean - (v1 + 0.5 * d))).toBeLessThan(0.005 * d);
    expect(Math.abs(t.stats.sd - d / Math.sqrt(12)) / (d / Math.sqrt(12))).toBeLessThan(0.02);
    expect(t.stats.min).toBeGreaterThanOrEqual(v1);
    expect(t.stats.max).toBeLessThanOrEqual(v2);
    expect(t.deterministic).toBeCloseTo(V0, 6); // el determinista usa la moda (2e6)
  });

  it('convención de la industria: P90 < P50 < P10 con dispersión', () => {
    const r = runUncertainty({ zones: [handZone({ area: tri(1e6, 2e6, 3e6), b: tri(1.1, 1.2, 1.4) })], iterations: 3000 });
    const s = target(r, 'z1').stats;
    expect(s.p90).toBeLessThan(s.p50);
    expect(s.p50).toBeLessThan(s.p10);
  });

  it('producto de dos uniformes: A ~ U(1e6, 3e6) × mφ ~ U(0,8; 1,2): media, sd y P90/P50/P10 contra integración numérica', () => {
    const [a, b, c, d] = [1e6, 3e6, 0.8, 1.2];
    const K = HPHISH / B0; // V = A·m·K  (hφSh es lineal en mφ: ninguna muestra cambia de clase)
    const r = runUncertainty({
      zones: [handZone({ area: uni(a, 2e6, b) })],
      factors: { phiMult: uni(c, 1, d) },
      iterations: 40000,
      seed: 2026,
    });
    const s = target(r, 'z1').stats;
    // E[AM] = E[A]E[M];  E[A²M²] = E[A²]E[M²]
    const ea = (a + b) / 2;
    const em = (c + d) / 2;
    const ea2 = (b ** 3 - a ** 3) / (3 * (b - a));
    const em2 = (d ** 3 - c ** 3) / (3 * (d - c));
    const mean = ea * em * K;
    const sd = Math.sqrt(ea2 * em2 - (ea * em) ** 2) * K;
    expect(Math.abs(s.mean - mean) / mean).toBeLessThan(0.005);
    expect(Math.abs(s.sd - sd) / sd).toBeLessThan(0.02);
    // CDF de S = A·M:  F(s) = (1/(b−a)) ∫ₐᵇ clamp((s/x − c)/(d − c), 0, 1) dx  (regla del punto medio, 20 000 pasos)
    const cdf = (x: number) => {
      const n = 20000;
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const t = a + ((i + 0.5) * (b - a)) / n;
        acc += Math.min(1, Math.max(0, (x / t - c) / (d - c)));
      }
      return acc / n;
    };
    const inv = (p: number) => {
      let lo = a * c;
      let hi = b * d;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (cdf(mid) < p) lo = mid;
        else hi = mid;
      }
      return ((lo + hi) / 2) * K;
    };
    for (const [got, p] of [[s.p90, 0.1], [s.p50, 0.5], [s.p10, 0.9]] as const) {
      const exp = inv(p);
      expect(Math.abs(got - exp) / exp, `cuantil ${p}`).toBeLessThan(0.01);
    }
  });

  it('semilla: misma → idéntico (estadísticos, histograma, tornado); distinta → otra muestra con P50 parecido', () => {
    const cfg = {
      zones: [handZone({ area: tri(1e6, 2e6, 3e6), b: tri(1.1, 1.2, 1.4) })],
      factors: { phiMult: tri(0.9, 1, 1.1), swCutoff: tri(-0.1, 0, 0.1) },
      iterations: 2000,
    };
    const a = runUncertainty({ ...cfg, seed: 5 });
    const b = runUncertainty({ ...cfg, seed: 5 });
    const c = runUncertainty({ ...cfg, seed: 6 });
    expect(b).toEqual(a);
    expect(c.targets[0]!.stats.p50).not.toBe(a.targets[0]!.stats.p50);
    expect(Math.abs(c.targets[0]!.stats.p50 / a.targets[0]!.stats.p50 - 1)).toBeLessThan(0.03);
  });

  it('cada parámetro consume un número aleatorio por iteración: ensanchar un rango no cambia los sorteos de los demás', () => {
    // Con φ fijo el hphi es el mismo; el área sale de la misma secuencia aunque cambie el rango de B.
    const base = { iterations: 300, seed: 9, zones: [handZone({ area: uni(1e6, 2e6, 3e6), b: uni(1.1, 1.2, 1.3) })] };
    const wide = { ...base, zones: [handZone({ area: uni(1e6, 2e6, 3e6), b: uni(1.0, 1.2, 1.5) })] };
    const ra = target(runUncertainty(base), 'z1').spearman.find((x) => x.param === 'area')!.rho;
    const rb = target(runUncertainty(wide), 'z1').spearman.find((x) => x.param === 'area')!.rho;
    expect(rb).toBeLessThan(ra); // la misma secuencia de A, más ruido de B: la correlación baja, no cambia de signo
    expect(rb).toBeGreaterThan(0.5);
  });

  it('rango de Spearman: solo A → +1; solo B → −1; área más ancha que B → |ρ_A| > |ρ_B|', () => {
    const onlyA = target(runUncertainty({ zones: [handZone({ area: uni(1e6, 2e6, 3e6) })], iterations: 1000 }), 'z1');
    expect(onlyA.spearman).toHaveLength(1);
    expect(onlyA.spearman[0]!.rho).toBeCloseTo(1, 12);
    const onlyB = target(runUncertainty({ zones: [handZone({ b: uni(1.1, 1.2, 1.4) })], iterations: 1000 }), 'z1');
    expect(onlyB.spearman[0]!.rho).toBeCloseTo(-1, 12);
    const both = target(runUncertainty({ zones: [handZone({ area: uni(1e6, 2e6, 3e6), b: uni(1.15, 1.2, 1.25) })], iterations: 3000 }), 'z1');
    expect(both.spearman[0]!.param).toBe('area');
    expect(Math.abs(both.spearman[0]!.rho)).toBeGreaterThan(Math.abs(both.spearman[1]!.rho));
    expect(both.spearman[1]!.rho).toBeLessThan(0);
  });
});

describe('tornado', () => {
  const cfg = () => ({
    zones: [handZone({ area: tri(1e6, 2e6, 3e6), b: tri(1.14, 1.2, 1.26) })],
    factors: { phiMult: tri(0.9, 1, 1.1), swCutoff: tri(-0.25, 0, 0.25) },
    iterations: 500,
  });

  it('orden y amplitudes a mano: Área (V₀) > Cutoff de Sw (0,4419·V₀) > φ (0,2·V₀) > B (0,1003·V₀)', () => {
    const t = target(runUncertainty(cfg()), 'z1');
    expect(t.tornado.map((r) => r.param)).toEqual(['area', 'swCutoff', 'phiMult', 'b']);
    const by = Object.fromEntries(t.tornado.map((r) => [r.param, r]));
    // Área: V = A·K → de 1e6 a 3e6
    expect(by.area!.vLow).toBeCloseTo((1e6 * HPHISH) / B0, 6);
    expect(by.area!.vHigh).toBeCloseTo((3e6 * HPHISH) / B0, 6);
    expect(by.area!.swing / V0).toBeCloseTo(1, 12);
    // Sw máx 0,35 → hφSh = 0,07; 0,85 → 0,1175
    expect(by.swCutoff!.vLow).toBeCloseTo((A0 * 0.07) / B0, 6);
    expect(by.swCutoff!.vHigh).toBeCloseTo((A0 * 0.1175) / B0, 6);
    expect(by.swCutoff!.swing / V0).toBeCloseTo(0.0475 / 0.1075, 12);
    expect(by.swCutoff!.low).toBeCloseTo(0.35, 12);
    expect(by.swCutoff!.high).toBeCloseTo(0.85, 12);
    // φ ± 10 %: hφSh de 0,9 a 1,1 veces
    expect(by.phiMult!.swing / V0).toBeCloseTo(0.2, 12);
    // B: V ∝ 1/B → 1,2/1,14 − 1,2/1,26
    expect(by.b!.vLow).toBeCloseTo((A0 * HPHISH) / 1.14, 6); // «bajo» es el parámetro, no el volumen
    expect(by.b!.swing / V0).toBeCloseTo(1.2 / 1.14 - 1.2 / 1.26, 12);
    for (const r of t.tornado) expect(r.base).toBeCloseTo(V0, 6);
  });

  it('extremos P10/P90 de cada parámetro: uniforme U(1e6, 3e6) → 1,2e6 y 2,8e6 (swing 0,8·V₀)', () => {
    const r = runUncertainty({ zones: [handZone({ area: uni(1e6, 2e6, 3e6) })], iterations: 100, tornadoQuantiles: [0.1, 0.9] });
    const row = target(r, 'z1').tornado[0]!;
    expect(row.low).toBeCloseTo(1.2e6, 6);
    expect(row.high).toBeCloseTo(2.8e6, 6);
    expect(row.swing / V0).toBeCloseTo(0.8, 12);
  });

  it('parámetro con rango nulo no aparece', () => {
    const t = target(runUncertainty({ zones: [handZone({ area: tri(1e6, 2e6, 3e6) })], factors: { phiMult: fixedDist(1) }, iterations: 50 }), 'z1');
    expect(t.tornado.map((r) => r.param)).toEqual(['area']);
  });
});

describe('zonas y totales', () => {
  const zones3 = (): UncertainZone[] => [
    handZone({ id: 'a', name: 'A', area: tri(1e6, 2e6, 3e6) }),
    handZone({ id: 'b', name: 'B', area: tri(0.5e6, 1e6, 2.5e6), h: [1, 1, 1, 1, 1] }),
    handZone({ id: 'c', name: 'C', fluid: 'gas', area: tri(1e6, 1.5e6, 2e6), b: tri(0.004, 0.005, 0.006) }),
  ];

  it('correlacionadas: V crece con el mismo cuantil en todas las zonas → cuantiles del total = suma de cuantiles de las zonas', () => {
    const r = runUncertainty({ zones: zones3(), iterations: 4000, seed: 3, zoneCorrelation: 'full' });
    const tot = target(r, 'TOTAL_OIL').stats;
    const a = target(r, 'a').stats;
    const b = target(r, 'b').stats;
    for (const k of ['p90', 'p50', 'p10', 'mean', 'min', 'max'] as const) expect(tot[k]).toBeCloseTo(a[k] + b[k], 5);
    expect(r.targets.map((t) => t.key)).toEqual(['a', 'b', 'c', 'TOTAL_OIL', 'TOTAL_GAS']);
    expect(target(r, 'TOTAL_OIL').zoneIds).toEqual(['a', 'b']);
    expect(target(r, 'TOTAL_GAS').stats.p50).toBeCloseTo(target(r, 'c').stats.p50, 6);
  });

  it('independientes: media del total = Σ medias; sd del total ≈ √Σ sd²; diversificación P90 total > ΣP90 y P10 total < ΣP10', () => {
    const r = runUncertainty({ zones: zones3(), iterations: 20000, seed: 4, zoneCorrelation: 'independent' });
    const tot = target(r, 'TOTAL_OIL').stats;
    const a = target(r, 'a').stats;
    const b = target(r, 'b').stats;
    expect(tot.mean).toBeCloseTo(a.mean + b.mean, 5);
    expect(Math.abs(tot.sd / Math.sqrt(a.sd ** 2 + b.sd ** 2) - 1)).toBeLessThan(0.03);
    expect(tot.p90).toBeGreaterThan(a.p90 + b.p90);
    expect(tot.p10).toBeLessThan(a.p10 + b.p10);
    // Spearman: el total depende del sorteo de área de cada zona; la zona a solo del suyo
    expect(target(r, 'a').spearman.every((s) => s.zoneId === null || s.zoneId === 'a')).toBe(true);
    expect(target(r, 'TOTAL_OIL').spearman.some((s) => s.zoneId === 'b')).toBe(true);
  });

  it('zonas sin hidrocarburo o sin dato quedan fuera y se informa por qué', () => {
    const r = runUncertainty({
      zones: [
        handZone({ id: 'n', name: 'N', fluid: 'none' }),
        handZone({ id: 'd', name: 'D', sw: [NaN, NaN, NaN, NaN, NaN] }),
        handZone({ id: 'ok', name: 'OK', area: tri(1e6, 2e6, 3e6) }),
      ],
      iterations: 100,
    });
    expect(r.skipped).toEqual([
      { id: 'n', name: 'N', reason: 'no-fluid' },
      { id: 'd', name: 'D', reason: 'no-data' },
    ]);
    expect(r.targets.map((t) => t.key)).toEqual(['ok', 'TOTAL_OIL']);
  });

  it('sin zonas con volumen: sin objetivos', () => {
    expect(runUncertainty({ zones: [handZone({ fluid: 'none' })], iterations: 10 }).targets).toEqual([]);
  });

  it('entradas inválidas', () => {
    expect(() => runUncertainty({ zones: [handZone()], iterations: 0 })).toThrow(RangeError);
    expect(() => runUncertainty({ zones: [handZone()], iterations: 10.5 })).toThrow(RangeError);
    expect(() => runUncertainty({ zones: [handZone()], tornadoQuantiles: [0.9, 0.1] })).toThrow(RangeError);
  });
});

describe('rendimiento', () => {
  it('5000 iteraciones × 5 zonas (5810 muestras) con todos los factores a nivel muestra < 1 s', () => {
    const rnd = mulberry32(1);
    const per = 1162;
    const zones: UncertainZone[] = Array.from({ length: 5 }, (_, k) => ({
      id: `z${k}`,
      name: `Z${k}`,
      fluid: 'oil' as const,
      h: new Float64Array(per).fill(0.1524),
      vsh: Float64Array.from({ length: per }, () => rnd() * 0.8),
      phi: Float64Array.from({ length: per }, () => 0.02 + rnd() * 0.25),
      sw: Float64Array.from({ length: per }, () => 0.1 + rnd() * 0.9),
      cutoffs: CUT,
      area: tri(0.7e6, 1e6, 1.3e6),
      b: tri(1.14, 1.2, 1.26),
    }));
    const t0 = performance.now();
    const r = runUncertainty({
      zones,
      iterations: 5000,
      factors: { phiMult: tri(0.9, 1, 1.1), swMult: tri(0.9, 1, 1.1), vshCutoff: tri(-0.05, 0, 0.05), phiCutoff: tri(-0.01, 0, 0.01), swCutoff: tri(-0.05, 0, 0.05) },
    });
    const ms = performance.now() - t0;
    console.info(`[incertidumbre] 5000 it × 5 zonas × ${per} muestras: ${ms.toFixed(0)} ms`);
    expect(r.targets).toHaveLength(6);
    expect(ms).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Módulo `uncertainty` en el motor

describe('módulo uncertainty', () => {
  const N = 30;
  const ZONES: Zone[] = [
    { ...zone('za', 1000, 1004.5), kind: 'reservoir' },
    { ...zone('zb', 1005, 1009.5), kind: 'seal' },
    { ...zone('zc', 1010, 1014.5), kind: 'formation' },
  ];
  const [ZA, ZB, ZC] = ZONES.map((z) => z.id) as [string, string, string];
  const zoneOf = (i: number) => (i < 10 ? 0 : i < 20 ? 1 : 2);
  const series = (perZone: [number, number, number], ex: Record<number, number> = {}) => Array.from({ length: N }, (_, i) => (i in ex ? ex[i]! : perZone[zoneOf(i)]!));
  const VSHC = series([0.1, 0.1, 0.2], { 5: 0.4, 6: 0.41, 24: NaN, 27: 0.8, 28: 0.8, 29: 0.8 });
  const PHIC = series([0.2, 0.15, 0.25], { 7: 0.08, 8: 0.05, 25: NaN, 26: 0.1, 27: 0.2, 28: 0.2, 29: 0.02 });
  const SWC = series([0.3, 0.2, 0.4], { 2: 0.6, 3: 0.61, 9: 0.9, 26: NaN, 27: 0.3, 28: 0.9, 29: 0.3 });
  const WELL = well([curve('VSH', 'VSH', VSHC), curve('PHIE', 'PHIE', PHIC), curve('SW', 'SW', SWC)], N, 1000, 0.5);
  type P = Record<string, number | string | boolean>;
  const FIXED: P = { calculate: true, areaLow: 1, areaHigh: 1, bLow: 1, bHigh: 1, phiLow: 1, phiHigh: 1, swLow: 1, swHigh: 1, vshCutoffHalf: 0, phiCutoffHalf: 0, swCutoffHalf: 0 };

  // Los parámetros propios del módulo se guardan como `uncertainty.<clave>`; los compartidos (area, bo, fluid…), sin prefijo.
  const SHARED = new Set(['area', 'fluid', 'bo', 'bg', 'vshCutoff', 'phiCutoff', 'swCutoff']);
  const own = (p: P): P => Object.fromEntries(Object.entries(p).map(([k, v]) => [SHARED.has(k) ? k : `uncertainty.${k}`, v]));
  function run(globalP: P, zonesIn: Record<string, P> = {}): EngineRunResult {
    const global = own(globalP);
    const zonesP = Object.fromEntries(Object.entries(zonesIn).map(([id, p]) => [id, own(p)]));
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(WELL);
    const interp: Interpretation = { ...emptyInterpretation(ZONES), params: { global, zones: zonesP } };
    return engine.run(interp);
  }
  const out = (r: EngineRunResult, key: string) => {
    const o = r.outputs.find((x) => x.key === key);
    if (!o) throw new Error(`Falta la salida ${key}`);
    return o.value;
  };

  it('rangos neutros: P90 = P50 = P10 = volumen del módulo volumétrico (petróleo en za y zc; el sello queda fuera)', () => {
    const r = run({ ...FIXED, area: 2, bo: 1.25 }, { [ZC]: { area: 3 } });
    const ooip = out(r, 'volumetrics:OOIP') as ZoneScalarValue;
    const p90 = out(r, 'uncertainty:UNC_P90') as ZoneScalarValue;
    const p50 = out(r, 'uncertainty:UNC_P50') as ZoneScalarValue;
    const p10 = out(r, 'uncertainty:UNC_P10') as ZoneScalarValue;
    expect(Object.keys(p50).sort()).toEqual([ZA, ZB, ZC].sort());
    for (const id of [ZA, ZC]) {
      expect(ooip[id]!).toBeGreaterThan(0);
      expect(p90[id]!).toBeCloseTo(ooip[id]!, 6);
      expect(p50[id]!).toBeCloseTo(ooip[id]!, 6);
      expect(p10[id]!).toBeCloseTo(ooip[id]!, 6);
    }
    expect(p50[ZB]).toBeNaN(); // sello
    const tot = out(r, 'volumetrics:OOIP_TOTAL') as number;
    expect(out(r, 'uncertainty:UNC_OOIP_P50') as number).toBeCloseTo(tot, 6);
    expect(out(r, 'uncertainty:UNC_OGIP_P50') as number).toBeNaN();
    // Determinista de la tabla = volumétrico
    const rows = (out(r, 'uncertainty:UNCERTAINTY') as TableValue).rows;
    expect(rows.map((x) => x.key)).toEqual([ZA, ZC, 'TOTAL_OIL']);
    expect(rows[0]!.det as number).toBeCloseTo(ooip[ZA]!, 6);
  });

  it('con rangos: P90 < determinista-ish < P10, tornado ordenado, CDF/histograma consistentes y reproducible', () => {
    const global: P = { calculate: true, area: 2, bo: 1.25, areaLow: 0.5, areaHigh: 1.5, iterations: 2000, seed: 7, bins: 25 };
    const r = run(global);
    const r2 = run(global);
    const rows = (out(r, 'uncertainty:UNCERTAINTY') as TableValue).rows;
    const za = rows.find((x) => x.key === ZA)!;
    expect(za.p90 as number).toBeLessThan(za.p50 as number);
    expect(za.p50 as number).toBeLessThan(za.p10 as number);
    expect(za.fieldUnit).toBe('MMbbl');
    expect(za.p50Field as number).toBeCloseTo((za.p50 as number) / 158987.294928, 8);
    expect(out(r2, 'uncertainty:UNCERTAINTY')).toEqual(out(r, 'uncertainty:UNCERTAINTY'));

    const torn = (out(r, 'uncertainty:UNCERTAINTY_TORNADO') as TableValue).rows.filter((x) => x.key === 'TOTAL_OIL');
    expect(torn.map((x) => x.rank)).toEqual(torn.map((_, i) => i + 1));
    const swings = torn.map((x) => x.swing as number);
    expect([...swings].sort((a, b) => b - a)).toEqual(swings);
    expect(torn[0]!.param).toBe('area'); // el rango de área (×0,5–×1,5) domina
    expect(torn[0]!.swingPct as number).toBeCloseTo(1, 6); // V lineal en el área: (1,5 − 0,5)·V₀ / V₀

    const hist = (out(r, 'uncertainty:UNCERTAINTY_HIST') as TableValue).rows.filter((x) => x.key === ZA);
    expect(hist).toHaveLength(25);
    expect(hist.reduce((s, x) => s + (x.count as number), 0)).toBe(2000);
    expect(hist[hist.length - 1]!.cum).toBeCloseTo(1, 12);
    const cdf = (out(r, 'uncertainty:UNCERTAINTY_CDF') as TableValue).rows.filter((x) => x.key === ZA);
    expect(cdf).toHaveLength(101);
    expect(cdf[10]!.value as number).toBeCloseTo(za.p90 as number, 6);
    expect(cdf[90]!.value as number).toBeCloseTo(za.p10 as number, 6);
    const sp = (out(r, 'uncertainty:UNCERTAINTY_SPEARMAN') as TableValue).rows.filter((x) => x.key === ZA);
    expect(sp[0]!.param).toBe('area');
  });

  it('apagado (defecto): salidas vacías y NaN por zona, sin simulación', () => {
    const r = run({ calculate: false });
    expect((out(r, 'uncertainty:UNCERTAINTY') as TableValue).rows).toEqual([]);
    expect(Object.values(out(r, 'uncertainty:UNC_P50') as ZoneScalarValue).every(Number.isNaN)).toBe(true);
    expect(out(r, 'uncertainty:UNC_OOIP_P50') as number).toBeNaN();
    const e = new Engine(registry);
    e.setWell(WELL);
    const rr = e.run({ ...emptyInterpretation(ZONES), params: { global: {}, zones: {} } });
    expect(rr.nodes.find((x) => x.moduleId === 'uncertainty')!.ms).toBeLessThan(5);
  });

  it('gas en una zona: el total de gas es aparte y se publica en UNC_OGIP_*', () => {
    const r = run({ ...FIXED, areaLow: 0.8, areaHigh: 1.2 }, { [ZC]: { fluid: 'gas' } });
    const rows = (out(r, 'uncertainty:UNCERTAINTY') as TableValue).rows;
    expect(rows.map((x) => x.key)).toEqual([ZA, ZC, 'TOTAL_OIL', 'TOTAL_GAS']);
    expect(rows.find((x) => x.key === ZC)!.fieldUnit).toBe('Bcf');
    expect(out(r, 'uncertainty:UNC_OGIP_P50') as number).toBeGreaterThan(0);
    expect(out(r, 'uncertainty:UNC_OOIP_P50') as number).toBeGreaterThan(0);
  });
});

describe('módulo uncertainty sobre el pozo del TP (datos/pozo_tp_perfiles.csv)', () => {
  const { well: tp, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(toEngineWell(tp));
  const first = engine.run({ ...emptyInterpretation(zones), params: { global: { 'uncertainty.calculate': true }, zones: {} } });
  const val = (key: string) => first.outputs.find((x) => x.key === key)!.value;

  it('módulo en ok; hay un objetivo por zona de petróleo y el total; el determinista coincide con el volumétrico', () => {
    expect(first.nodes.find((x) => x.moduleId === 'uncertainty')?.status).toBe('ok');
    const rows = (val('uncertainty:UNCERTAINTY') as TableValue).rows;
    const ooip = val('volumetrics:OOIP') as ZoneScalarValue;
    for (const z of zones) {
      const row = rows.find((x) => x.key === z.id);
      if (row) {
        expect(row.det as number).toBeCloseTo(ooip[z.id]!, 3);
        expect(row.p90 as number).toBeLessThan(row.p10 as number);
      }
    }
    expect(rows.find((x) => x.key === 'TOTAL_OIL')!.det as number).toBeCloseTo(val('volumetrics:OOIP_TOTAL') as number, 3);
  });

  it('5000 iteraciones sobre el pozo del TP: < 1 s (sin checkInputs, mediana de 3)', () => {
    const times: number[] = [];
    for (let k = 0; k < 3; k++) {
      const e = new Engine(registry);
      e.setWell(toEngineWell(tp));
      const r = e.run({ ...emptyInterpretation(zones), params: { global: { 'uncertainty.calculate': true, 'uncertainty.seed': 1 + k }, zones: {} } });
      times.push(r.nodes.find((x) => x.moduleId === 'uncertainty')!.ms);
    }
    const med = [...times].sort((a, b) => a - b)[1]!;
    console.info(`[incertidumbre TP] ${zones.length} zonas, 5000 iteraciones: ${med.toFixed(0)} ms`);
    expect(med).toBeLessThan(1000);
  });
});
