/**
 * Modelo k–φ de corona (docs/decisiones/0010 D4): funciones de petro (log10 k = a + b·φ, conversión desde la
 * tendencia exponencial) y módulo del motor `perm-core` (override por zona, recorte kMin/kMax, no es la fuente por
 * defecto de PERM). Valores calculados a mano.
 */
import { describe, expect, it } from 'vitest';
import { Engine, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import { registry } from '../src/modules';
import permCore, { PERM_CORE_ID } from '../src/modules/perm-core';
import { expTrendToLogLinear, logLinearPermeability, logLinearPermeabilityInto, logLinearToExpTrend } from '../src/petro/permeability';
import { curve, well, zone } from './helpers';

describe('petro/permeabilidad: modelo k–φ de corona', () => {
  it('log10 k = a + b·φ: a = −1,7, b = 22, φ = 0,10 → log k = 0,5 → k = √10 = 3,16228 mD', () => {
    // a mano: −1,7 + 22·0,10 = 0,5; 10^0,5 = 3,1622776601683795
    expect(logLinearPermeability(0.1, -1.7, 22)).toBeCloseTo(3.1622776601683795, 12);
  });

  it('φ = 0,20 → log k = 2,7 → 501,187 mD; φ = 0 → 10^a (válido)', () => {
    expect(logLinearPermeability(0.2, -1.7, 22)).toBeCloseTo(501.18723362727224, 8);
    expect(logLinearPermeability(0, -1.7, 22)).toBeCloseTo(0.0199526231496888, 12);
  });

  it('cada 1/b de porosidad multiplica k por 10 (una década)', () => {
    const k1 = logLinearPermeability(0.1, -1.7, 20);
    const k2 = logLinearPermeability(0.1 + 1 / 20, -1.7, 20);
    expect(k2 / k1).toBeCloseTo(10, 10);
  });

  it('recorte a [kMin, kMax]', () => {
    expect(logLinearPermeability(0.1, -1.7, 22, 5, 1000)).toBe(5); // 3,16 < 5
    expect(logLinearPermeability(0.3, -1.7, 22, 0, 1000)).toBe(1000); // 10^4,9
    expect(logLinearPermeability(0.1, -1.7, 22, 1, 1000)).toBeCloseTo(3.1622776601683795, 12);
  });

  it('exponente enorme: k → ∞ se recorta a kMax; φ negativa, NaN o coeficientes no finitos → NaN', () => {
    expect(logLinearPermeability(0.1, 400, 22, 0, 1e5)).toBe(1e5);
    expect(logLinearPermeability(-0.01, -1.7, 22)).toBeNaN();
    expect(logLinearPermeability(NaN, -1.7, 22)).toBeNaN();
    expect(logLinearPermeability(0.1, NaN, 22)).toBeNaN();
    expect(logLinearPermeability(0.1, -1.7, Infinity)).toBeNaN();
  });

  it('Into: solo [start, end) y el resto intacto', () => {
    const phi = Float64Array.of(0.1, 0.2, NaN, 0.1);
    const out = new Float64Array(4).fill(-9);
    logLinearPermeabilityInto(phi, out, -1.7, 22, 0, Infinity, 1, 3);
    expect(out[0]).toBe(-9);
    expect(out[1]).toBeCloseTo(501.18723362727224, 8);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(-9);
  });

  describe('conversión de la tendencia exponencial k = A·e^(B·φ)', () => {
    it('A = 0,02007 y B = 50,22 → a = log10 A ≈ −1,6975 y b = B / ln 10 ≈ 21,81', () => {
      // a mano: log10(0,02007) = log10(2,007) − 2 = 0,30253 − 2 = −1,69747; b = 50,22 / 2,302585 = 21,8100
      const m = expTrendToLogLinear(0.02007, 50.22)!;
      expect(m.a).toBeCloseTo(-1.6975, 4);
      expect(m.b).toBeCloseTo(21.81, 2);
    });

    it('ida y vuelta exacta (a, b) ↔ (A, B)', () => {
      const { A, B } = logLinearToExpTrend(-1.7, 22);
      expect(A).toBeCloseTo(0.0199526231496888, 12);
      expect(B).toBeCloseTo(22 * Math.LN10, 12);
      const m = expTrendToLogLinear(A, B)!;
      expect(m.a).toBeCloseTo(-1.7, 12);
      expect(m.b).toBeCloseTo(22, 12);
    });

    it('las dos formas dan la misma k: A·e^(B·φ) = 10^(a + b·φ)', () => {
      const A = 0.02007;
      const B = 50.22;
      const m = expTrendToLogLinear(A, B)!;
      for (const phi of [0.05, 0.12, 0.2]) expect(logLinearPermeability(phi, m.a, m.b)).toBeCloseTo(A * Math.exp(B * phi), 9);
    });

    it('A ≤ 0 o no finitos → null', () => {
      expect(expTrendToLogLinear(0, 10)).toBeNull();
      expect(expTrendToLogLinear(-1, 10)).toBeNull();
      expect(expTrendToLogLinear(NaN, 10)).toBeNull();
      expect(expTrendToLogLinear(1, Infinity)).toBeNull();
    });
  });
});

// --- módulo en el motor ----------------------------------------------------------------------------------------
// 20 muestras cada 0,5 m (1000–1009,5), dos zonas de 10 muestras.
const N = 20;
const PHIE = Array.from({ length: N }, (_, i) => 0.05 + 0.01 * i); // 0,05 … 0,24
const ZONES = [zone('za', 1000, 1004.5), zone('zb', 1005, 1009.5)];
const [ZA, ZB] = ZONES.map((z) => z.id) as [string, string];
const W = well([curve('PHIE', 'PHIE', PHIE)], N, 1000, 0.5);

function run(partial: Partial<Interpretation> = {}): EngineRunResult {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(W);
  return engine.run({ ...emptyInterpretation(ZONES), ...partial });
}
const permOf = (r: EngineRunResult) => r.outputs.find((o) => o.key === `${PERM_CORE_ID}:PERM`)!.value as Float64Array;
const warningsOf = (r: EngineRunResult) => r.diagnostics.filter((d) => d.code === 'module-warning' && d.moduleId === PERM_CORE_ID).map((d) => d.message);
const g = (global: Record<string, number>, zones: Record<string, Record<string, number>> = {}) => ({ params: { global, zones } });

describe('módulo perm-core en el motor', () => {
  it('está registrado como PERM, después de Timur y Coates', () => {
    const ids = registry.modules.map((m) => m.id);
    expect(ids).toContain(PERM_CORE_ID);
    expect(ids.indexOf(PERM_CORE_ID)).toBeGreaterThan(ids.indexOf('perm-coates'));
    expect(permCore.outputs.k).toMatchObject({ kind: 'curve', role: 'PERM' });
  });

  it('globales a = −1,7 y b = 22: k = 10^(a + b·PHIE) por muestra', () => {
    const r = run({ compare: [PERM_CORE_ID], ...g({ 'perm-core.kphiA': -1.7, 'perm-core.kphiB': 22 }) });
    const k = permOf(r);
    expect(k).toHaveLength(N);
    for (let i = 0; i < N; i++) expect(k[i]!, `muestra ${i}`).toBeCloseTo(Math.pow(10, -1.7 + 22 * PHIE[i]!), 9);
    // a mano: PHIE 0,10 (muestra 5) → 10^0,5
    expect(k[5]).toBeCloseTo(3.1622776601683795, 9);
  });

  it('override por zona: ZB con otro a y b; ZA conserva los globales', () => {
    const r = run({ compare: [PERM_CORE_ID], ...g({ 'perm-core.kphiA': -1.7, 'perm-core.kphiB': 22 }, { [ZB]: { 'perm-core.kphiA': -2.5, 'perm-core.kphiB': 18 } }) });
    const k = permOf(r);
    for (let i = 0; i < N; i++) {
      const [a, b] = i < 10 ? [-1.7, 22] : [-2.5, 18];
      expect(k[i]!, `muestra ${i}`).toBeCloseTo(Math.pow(10, a + b * PHIE[i]!), 9);
    }
    void ZA;
  });

  it('recorte kMin/kMax (también por zona)', () => {
    const r = run({
      compare: [PERM_CORE_ID],
      ...g({ 'perm-core.kphiA': -1.7, 'perm-core.kphiB': 22, 'perm-core.kMin': 1, 'perm-core.kMax': 100 }, { [ZB]: { 'perm-core.kMax': 10 } }),
    });
    const k = permOf(r);
    for (let i = 0; i < N; i++) {
      const raw = Math.pow(10, -1.7 + 22 * PHIE[i]!);
      const kmax = i < 10 ? 100 : 10;
      expect(k[i]!, `muestra ${i}`).toBeCloseTo(Math.min(kmax, Math.max(1, raw)), 9);
    }
    expect(k[0]).toBe(1); // PHIE 0,05 → 10^−0,6 = 0,25 → piso
    expect(k[19]).toBe(10); // PHIE 0,24 → 10^3,58 → techo de ZB
  });

  it('kMin ≥ kMax: avisa nombrando la zona y deja sin recorte superior', () => {
    const r = run({ compare: [PERM_CORE_ID], ...g({ 'perm-core.kphiA': -1.7, 'perm-core.kphiB': 22 }, { [ZB]: { 'perm-core.kMin': 50, 'perm-core.kMax': 5 } }) });
    const w = warningsOf(r);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/zona ZB/);
    const k = permOf(r);
    expect(k[19]).toBeCloseTo(Math.pow(10, -1.7 + 22 * 0.24), 6); // sin techo
    expect(k[10]!).toBeGreaterThanOrEqual(5); // el piso efectivo es min(kMin, kMax) = 5
  });

  it('PHIE sin dato → NaN', () => {
    const w2 = well([curve('PHIE', 'PHIE', PHIE.map((v, i) => (i === 3 ? NaN : v)))], N, 1000, 0.5);
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(w2);
    const r = engine.run({ ...emptyInterpretation(ZONES), compare: [PERM_CORE_ID] });
    expect((r.outputs.find((o) => o.key === `${PERM_CORE_ID}:PERM`)!.value as Float64Array)[3]).toBeNaN();
  });

  it('NO es la fuente por defecto de PERM: sigue siéndolo perm-timur', () => {
    const r = run({ compare: [PERM_CORE_ID] });
    expect(r.sources['PERM']).toEqual({ kind: 'module', moduleId: 'perm-timur' });
    expect(r.outputs.find((o) => o.key === `${PERM_CORE_ID}:PERM`)!.active).toBe(false);
    expect(r.outputs.find((o) => o.key === 'perm-timur:PERM')!.active).toBe(true);
  });

  it('elegida como fuente de PERM, queda activa', () => {
    const r = run({ sources: { PERM: { kind: 'module', moduleId: PERM_CORE_ID } } });
    expect(r.sources['PERM']).toEqual({ kind: 'module', moduleId: PERM_CORE_ID });
    expect(r.outputs.find((o) => o.key === `${PERM_CORE_ID}:PERM`)!.active).toBe(true);
  });
});
