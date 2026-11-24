/**
 * Swi desde SCAL (tarea 8 de la consigna; docs/decisiones/0055-swi-desde-scal.md): ley de potencia Swi = A·(√(k/φ%))^B/100
 * con los seis (A, B) de la cátedra, ajuste log–log y ajuste de la presión de desplazamiento.
 *
 * Los valores esperados son de mano o de `scripts/qa/swi-pc-reference.py` (numpy, fuera del código TS), sobre el
 * fixture `tests/fixtures/tp-corona-electrica-scal.json` (planilla de la cátedra).
 */
import { describe, expect, it } from 'vitest';
import scalFixture from './fixtures/tp-corona-electrica-scal.json';
import {
  SWI_CATEDRA_LEVELS,
  SWI_SCAL_ROOT_RANGE,
  SW_BELOW_SWI_TOLERANCE,
  fitDisplacementPressure,
  fitSwiPowerLaw,
  rootKOverPhi,
  swBelowSwiFlag,
  swiFromPermPhiInto,
  swiPowerLaw,
  swiPowerLawRaw,
  swiPresetById,
} from '../src/petro/swiPc';

const scal = scalFixture.scal;

describe('petro/swiPc: √(k/φ) en la unidad de la planilla', () => {
  it('k = 100 mD, φ = 0,20 (20 %) ⇒ √(100/20) = 2,2360680 (cuenta de mano)', () => {
    expect(rootKOverPhi(100, 0.2)).toBeCloseTo(2.2360680, 7);
  });

  it('k = 1 mD, φ = 0,10 ⇒ √(1/10) = 0,3162278', () => {
    expect(rootKOverPhi(1, 0.1)).toBeCloseTo(0.3162278, 7);
  });

  it('reproduce la columna «raíz» de la tabla de garganta poral de la cátedra (k de gas, φ en %)', () => {
    for (const t of scal.poreThroat) {
      expect(rootKOverPhi(t.kGasMd, t.phiPct / 100), t.sample).toBeCloseTo(t.raizKPhi, 12);
    }
  });

  it('la «raíz» de la tabla de presión de desplazamiento es 10 veces la de la planilla de Swi (φ en fracción)', () => {
    scal.displacement.forEach((d, i) => {
      expect(d.raiz / scal.poreThroat[i]!.raizKPhi, d.sample).toBeCloseTo(10, 12);
    });
  });

  it('dominio: k ≤ 0, φ ≤ 0, φ > 1 o datos no finitos dan NaN', () => {
    for (const [k, phi] of [
      [0, 0.2],
      [-5, 0.2],
      [10, 0],
      [10, -0.1],
      [10, 1.01],
      [NaN, 0.2],
      [10, NaN],
      [Infinity, 0.2],
      [10, Infinity],
    ] as const) {
      expect(rootKOverPhi(k, phi), `${k}, ${phi}`).toBeNaN();
    }
    // φ = 1 es el borde válido
    expect(rootKOverPhi(100, 1)).toBeCloseTo(1, 12);
  });
});

describe('petro/swiPc: ley de potencia y presets de la cátedra', () => {
  it('los seis presets de la hoja SCAL, en orden; el rótulo lleva la presión reconstruida de las curvas MICP (petro-micp)', () => {
    expect(SWI_CATEDRA_LEVELS.map((p) => [p.A, p.B])).toEqual(scal.swiPowerLaw.coef.map((c) => [c.A, c.B]));
    expect(SWI_CATEDRA_LEVELS.map((p) => p.id)).toEqual(['level1', 'level2', 'level3', 'level4', 'level5', 'level6']);
    expect(SWI_CATEDRA_LEVELS[0]!.label).toBe('Nivel 1 · Pc ≈ 28 kg/cm² (menor)');
    expect(SWI_CATEDRA_LEVELS[5]!.label).toBe('Nivel 6 · Pc ≈ 700 kg/cm² (mayor)');
    // La presión del rótulo es la de `pcKgCm2` redondeada (sin presiones que no salgan de los datos).
    for (const p of SWI_CATEDRA_LEVELS) expect(p.label).toContain(`Pc ≈ ${Math.round(p.pcKgCm2!)} kg/cm²`);
    // A decrece con el nivel (Swi decrece al subir la presión capilar)
    for (let i = 1; i < 6; i++) expect(SWI_CATEDRA_LEVELS[i]!.A).toBeLessThan(SWI_CATEDRA_LEVELS[i - 1]!.A);
    expect(swiPresetById('level3')).toMatchObject({ A: 15.102, B: -0.403 });
    expect(swiPresetById('manual')).toBeUndefined();
  });

  it('k = 100 mD, φ = 20 %: Swi de los seis niveles contra numpy (swi-pc-reference.py)', () => {
    const x = rootKOverPhi(100, 0.2);
    const expected = [0.22129414724670962, 0.16325964919397873, 0.10919229901897949, 0.06168618766734745, 0.04340874656694675, 0.01740819992106007];
    SWI_CATEDRA_LEVELS.forEach((p, i) => expect(swiPowerLaw(x, p.A, p.B), p.id).toBeCloseTo(expected[i]!, 12));
    // cuenta de mano del nivel 1: 2,236068^−0,333 = e^(−0,333·0,804719) = 0,76493 ⇒ 28,93·0,76493/100 = 0,22129
    expect(swiPowerLaw(x, 28.93, -0.333)).toBeCloseTo(0.22129, 5);
  });

  it('k = 1 mD, φ = 10 %: Swi de los seis niveles contra numpy; decrece al subir el nivel', () => {
    const x = rootKOverPhi(1, 0.1);
    const expected = [0.4244713999424127, 0.30648768561739437, 0.24017868679086884, 0.14644019608798822, 0.10737144595211408, 0.0543443172467464];
    const got = SWI_CATEDRA_LEVELS.map((p) => swiPowerLaw(x, p.A, p.B));
    got.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 12));
    for (let i = 1; i < 6; i++) expect(got[i]!).toBeLessThan(got[i - 1]!);
  });

  it('x = 1 ⇒ Swi = A/100 para cualquier B', () => {
    for (const p of SWI_CATEDRA_LEVELS) expect(swiPowerLaw(1, p.A, p.B)).toBeCloseTo(p.A / 100, 14);
  });

  it('Swi baja al mejorar la roca (B < 0): monótona decreciente en x', () => {
    for (const p of SWI_CATEDRA_LEVELS) {
      let prev = Infinity;
      for (const x of [0.4, 0.8, 1.2, 1.6, 2, 4]) {
        const v = swiPowerLaw(x, p.A, p.B);
        expect(v).toBeLessThan(prev);
        prev = v;
      }
    }
  });

  it('recorte: roca muy cerrada da Swi > 1 sin recortar y 1 recortado; nunca negativa', () => {
    // k = 0,01 mD, φ = 5 %: x = 0,04472; nivel 1 → 0,8142 (sin recorte); con x = 1e-4 el nivel 1 supera 1
    expect(swiPowerLaw(rootKOverPhi(0.01, 0.05), 28.93, -0.333)).toBeCloseTo(0.8141922035028004, 12);
    const raw = swiPowerLawRaw(1e-4, 28.93, -0.333);
    expect(raw).toBeCloseTo((28.93 * Math.pow(1e-4, -0.333)) / 100, 12);
    expect(raw).toBeGreaterThan(1);
    expect(swiPowerLaw(1e-4, 28.93, -0.333)).toBe(1);
    // desborde numérico: sigue siendo un 1 físico, no NaN
    expect(swiPowerLaw(1e-300, 28.93, -5)).toBe(1);
    expect(swiPowerLaw(2, 28.93, -0.333)).toBeGreaterThanOrEqual(0);
  });

  it('fuera de dominio da NaN (no se recorta a nada): x ≤ 0, A ≤ 0, B o A no finitos, NaN', () => {
    for (const [x, A, B] of [
      [0, 10, -0.4],
      [-1, 10, -0.4],
      [NaN, 10, -0.4],
      [Infinity, 10, -0.4],
      [1, 0, -0.4],
      [1, -3, -0.4],
      [1, NaN, -0.4],
      [1, Infinity, -0.4],
      [1, 10, NaN],
      [1, 10, Infinity],
    ] as const) {
      expect(swiPowerLaw(x, A, B), `${x}, ${A}, ${B}`).toBeNaN();
      expect(swiPowerLawRaw(x, A, B), `raw ${x}, ${A}, ${B}`).toBeNaN();
    }
  });

  it('swiFromPermPhiInto: por tramo, NaN sin dato y fuera de dominio, y no toca fuera del tramo', () => {
    const k = [100, 1, 0, -2, NaN, 100, 5];
    const phi = [0.2, 0.1, 0.2, 0.2, 0.2, NaN, 0.2];
    const out = new Float64Array(k.length).fill(-7);
    swiFromPermPhiInto(k, phi, out, 28.93, -0.333, 1, 6);
    expect(out[0]).toBe(-7);
    expect(out[6]).toBe(-7);
    expect(out[1]).toBeCloseTo(0.4244713999424127, 12);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBeNaN();
    expect(out[4]).toBeNaN();
    expect(out[5]).toBeNaN();
  });
});

describe('petro/swiPc: ajuste log–log de la ley de potencia', () => {
  const xs = Array.from({ length: 12 }, (_, i) => 0.4 + (i * 1.6) / 11);

  it('ida y vuelta: Swi generado con (A, B) conocidos se recupera con error < 1e-9 en los seis niveles', () => {
    for (const p of SWI_CATEDRA_LEVELS) {
      const swi = xs.map((x) => swiPowerLaw(x, p.A, p.B));
      const f = fitSwiPowerLaw(xs, swi)!;
      expect(f, p.id).not.toBeNull();
      expect(Math.abs(f.A - p.A), `A ${p.id}`).toBeLessThan(1e-9);
      expect(Math.abs(f.B - p.B), `B ${p.id}`).toBeLessThan(1e-9);
      expect(f.r2).toBeCloseTo(1, 12);
      expect(f.rmse).toBeLessThan(1e-12);
      expect(f.n).toBe(12);
    }
  });

  it('coincide con numpy.polyfit en log–log (ida y vuelta del nivel 3: A = 15,102, B = −0,403)', () => {
    const p = swiPresetById('level3')!;
    const f = fitSwiPowerLaw(xs, xs.map((x) => swiPowerLaw(x, p.A, p.B)))!;
    expect(Math.abs(f.A - 15.102000000000004)).toBeLessThan(1e-9);
    expect(Math.abs(f.B - -0.40300000000000064)).toBeLessThan(1e-9);
  });

  it('con ruido: R² < 1, rmse > 0 y los coeficientes quedan cerca (regresión, no interpolación)', () => {
    const p = swiPresetById('level1')!;
    const noise = [1.03, 0.97, 1.02, 0.98, 1.04, 0.96, 1.01, 0.99, 1.02, 0.98, 1.03, 0.97];
    const swi = xs.map((x, i) => swiPowerLaw(x, p.A, p.B) * noise[i]!);
    const f = fitSwiPowerLaw(xs, swi)!;
    expect(f.r2).toBeLessThan(1);
    expect(f.r2).toBeGreaterThan(0.9);
    expect(f.rmse).toBeGreaterThan(0);
    expect(Math.abs(f.B - p.B)).toBeLessThan(0.1);
    expect(Math.abs(f.A - p.A) / p.A).toBeLessThan(0.1);
  });

  it('descarta puntos inválidos (NaN, x ≤ 0, Swi ≤ 0) y cuenta solo los válidos', () => {
    const p = swiPresetById('level2')!;
    const x = [...xs, NaN, 0, -1, 1];
    const y = [...xs.map((v) => swiPowerLaw(v, p.A, p.B)), 0.2, 0.2, 0.2, 0];
    const f = fitSwiPowerLaw(x, y)!;
    expect(f.n).toBe(12);
    expect(Math.abs(f.A - p.A)).toBeLessThan(1e-9);
  });

  it('null con menos de 3 puntos válidos o con x constante (varianza cero)', () => {
    expect(fitSwiPowerLaw([], [])).toBeNull();
    expect(fitSwiPowerLaw([1, 2], [0.3, 0.2])).toBeNull();
    expect(fitSwiPowerLaw([1, 2, NaN, -1], [0.3, 0.2, 0.2, 0.2])).toBeNull();
    expect(fitSwiPowerLaw([1.5, 1.5, 1.5, 1.5], [0.3, 0.25, 0.2, 0.28])).toBeNull();
    expect(fitSwiPowerLaw([1, 2, 3], [0.3, 0.2, 0.15])).not.toBeNull();
  });
});

describe('petro/swiPc: presión de desplazamiento contra √(k/φ) (scal.displacement)', () => {
  const x = scal.displacement.map((d) => d.raiz);
  const pd = scal.displacement.map((d) => d.pDesplazKgCm2);

  it('Pd = c·x^−d contra numpy.polyfit en log–log (swi-pc-reference.py): c, d, R² y RMSE', () => {
    const f = fitDisplacementPressure(x, pd)!;
    expect(f.n).toBe(8);
    expect(f.c).toBeCloseTo(27.96458906410524, 9);
    expect(f.d).toBeCloseTo(1.189152502919038, 12);
    expect(f.r2).toBeCloseTo(0.43103434445451716, 12);
    expect(f.rmse).toBeCloseTo(1.0885551378293876, 9);
    // la presión de desplazamiento baja al mejorar la roca
    expect(f.d).toBeGreaterThan(0);
  });

  it('ida y vuelta: Pd = 12·x^−0,8 se recupera exacto', () => {
    const xx = [1, 2, 3.5, 5, 8, 13];
    const f = fitDisplacementPressure(xx, xx.map((v) => 12 * Math.pow(v, -0.8)))!;
    expect(Math.abs(f.c - 12)).toBeLessThan(1e-9);
    expect(Math.abs(f.d - 0.8)).toBeLessThan(1e-9);
    expect(f.r2).toBeCloseTo(1, 12);
  });

  it('null con menos de 3 puntos válidos o x constante', () => {
    expect(fitDisplacementPressure([1, 2], [3, 2])).toBeNull();
    expect(fitDisplacementPressure([4, 4, 4], [3, 2, 1])).toBeNull();
  });
});

describe('petro/swiPc: rango de la cátedra y bandera Sw < Swi', () => {
  it('el rango declarado cubre las 8 muestras de la tabla de garganta y sin holgura exagerada', () => {
    const r = scal.poreThroat.map((t) => t.raizKPhi);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(SWI_SCAL_ROOT_RANGE.min);
    expect(Math.max(...r)).toBeLessThanOrEqual(SWI_SCAL_ROOT_RANGE.max);
    expect(Math.min(...r) - SWI_SCAL_ROOT_RANGE.min).toBeLessThan(0.001);
    expect(SWI_SCAL_ROOT_RANGE.max - Math.max(...r)).toBeLessThan(0.001);
  });

  it('bandera: 1 si Sw < Swi − tolerancia (estricto), 0 si no, NaN sin dato', () => {
    expect(SW_BELOW_SWI_TOLERANCE).toBe(0.02);
    expect(swBelowSwiFlag(0.1, 0.3)).toBe(1);
    expect(swBelowSwiFlag(0.29, 0.3)).toBe(0); // dentro de la tolerancia
    expect(swBelowSwiFlag(0.28, 0.3, 0.02)).toBe(0); // justo en el borde no se marca
    expect(swBelowSwiFlag(0.279, 0.3, 0.02)).toBe(1);
    expect(swBelowSwiFlag(0.29, 0.3, 0)).toBe(1);
    expect(swBelowSwiFlag(0.5, 0.3)).toBe(0);
    expect(swBelowSwiFlag(NaN, 0.3)).toBeNaN();
    expect(swBelowSwiFlag(0.2, NaN)).toBeNaN();
    // tolerancia negativa o NaN no endurece el criterio
    expect(swBelowSwiFlag(0.29, 0.3, -1)).toBe(1);
    expect(swBelowSwiFlag(0.3, 0.3, NaN)).toBe(0);
  });
});
