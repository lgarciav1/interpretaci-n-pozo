/**
 * Calculadora de agua de formación (src/petro/brine.ts + inversa de Arps en temperature.ts).
 *
 * Fuentes de los casos:
 *  - FÍSICOS: conductividad de soluciones de NaCl a 25 °C (CRC Handbook of Chemistry and Physics, conductividad
 *    equivalente; Robinson y Stokes 1959): 0,01 M → 1,185 mS/cm, 0,1 M → 10,67 mS/cm, 1 M → 85,8 mS/cm. La
 *    concentración en ppm (peso/peso) sale de la molaridad y la densidad de la solución. Es una verificación
 *    INDEPENDIENTE de la correlación (que ajusta la carta Gen-9). Tolerancia declarada: 5 %.
 *  - A MANO: Arps y la correlación de Bateman y Konen evaluadas por separado (script de Python, no de este código).
 *    Tolerancia: 0,1 % (aritmética de punto flotante, valores redondeados a 5 cifras).
 *  No se pudo consultar la carta Gen-9 impresa en este entorno: los valores de carta NO se transcribieron de memoria.
 */
import { describe, expect, it } from 'vitest';
import {
  BK_CONST,
  naclResistivity75F,
  naclResistivityC,
  naclSalinityFrom75F,
  naclSalinityFromResistivityC,
  naclTemperatureC,
  NACL_REF_TEMP_C,
  valueAtDepth,
  waterResistivityProfile,
  waterWarnings,
} from '../src/petro/brine';
import { arpsResistivityC, arpsResistivityF, arpsTemperatureC, arpsTemperatureF } from '../src/petro/temperature';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('Bateman y Konen a 75 °F', () => {
  it('valores calculados a mano (tolerancia 0,1 %)', () => {
    const casos: [number, number][] = [
      [1_000, 4.98962],
      [20_000, 0.29708],
      [35_000, 0.17918],
      [100_000, 0.07353],
      [150_000, 0.05387],
      [250_000, 0.03782],
    ];
    for (const [ppm, rw] of casos) expect(rel(naclResistivity75F(ppm), rw), `${ppm} ppm`).toBeLessThan(1e-3);
  });

  it('contra conductividades medidas de NaCl a 25 °C (CRC; tolerancia 5 %)', () => {
    // [ppm p/p, Rw medida a 25 °C (Ω·m)]
    const casos: [number, number][] = [
      [585, 1 / 0.1185], // 0,01 M: κ = 0,1185 S/m
      [5_824, 1 / 1.067], // 0,1 M: κ = 1,067 S/m
      [56_400, 1 / 8.58], // 1 M: κ = 8,58 S/m
    ];
    for (const [ppm, rw] of casos) expect(rel(naclResistivityC(ppm, 25), rw), `${ppm} ppm`).toBeLessThan(0.05);
  });

  it('la salinidad no aplica con Rw75 ≤ 0,0123 Ω·m (asíntota) ni con datos inválidos', () => {
    expect(naclSalinityFrom75F(BK_CONST)).toBeNaN();
    expect(naclSalinityFrom75F(0.01)).toBeNaN();
    expect(naclSalinityFrom75F(-1)).toBeNaN();
    expect(naclSalinityFrom75F(NaN)).toBeNaN();
    expect(naclResistivity75F(0)).toBeNaN();
    expect(naclResistivity75F(-100)).toBeNaN();
    expect(naclResistivity75F(NaN)).toBeNaN();
    expect(naclResistivity75F(Infinity)).toBeNaN();
  });

  it('ida y vuelta salinidad → Rw75 → salinidad', () => {
    for (const ppm of [500, 1_000, 8_000, 35_000, 120_000, 250_000]) expect(rel(naclSalinityFrom75F(naclResistivity75F(ppm)), ppm)).toBeLessThan(1e-9);
  });

  it('es monótona: más sal, menos resistividad', () => {
    let prev = Infinity;
    for (const ppm of [1_000, 5_000, 20_000, 80_000, 250_000]) {
      const r = naclResistivity75F(ppm);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });
});

describe('temperatura (Arps)', () => {
  it('75 °F ≈ 23,889 °C', () => {
    expect(NACL_REF_TEMP_C).toBeCloseTo(23.8889, 4);
  });

  it('Rw 0,5 Ω·m a 75 °F llevada a 150 °F = 0,5·81,77/156,77 = 0,26080 Ω·m (a mano)', () => {
    expect(arpsResistivityF(0.5, 75, 150)).toBeCloseTo(0.260796, 5);
  });

  it('salinidad + temperatura → Rw (a mano): 20 000 ppm a 50, 100, 150 y 200 °C', () => {
    const casos: [number, number][] = [
      [50, 0.18865],
      [100, 0.11104],
      [150, 0.07867],
      [200, 0.06092],
    ];
    for (const [t, rw] of casos) expect(rel(naclResistivityC(20_000, t), rw), `${t} °C`).toBeLessThan(1e-3);
  });

  it('Rw + temperatura → salinidad (a mano): 0,1 Ω·m a 25 °C = 66 701 ppm; 0,05 Ω·m a 100 °C = 48 809 ppm', () => {
    expect(rel(naclSalinityFromResistivityC(0.1, 25), 66_701)).toBeLessThan(1e-3);
    expect(rel(naclSalinityFromResistivityC(0.05, 100), 48_809)).toBeLessThan(1e-3);
  });

  it('salinidad + Rw → temperatura (a mano): 20 000 ppm con Rw 0,15 Ω·m ocurre a 155,18 °F = 68,43 °C', () => {
    expect(naclTemperatureC(20_000, 0.15)).toBeCloseTo(68.4328, 2);
  });

  it('las tres conversiones son inversas entre sí', () => {
    for (const [ppm, t] of [
      [3_000, 30],
      [35_000, 80],
      [120_000, 140],
      [250_000, 200],
    ] as const) {
      const rw = naclResistivityC(ppm, t);
      expect(rel(naclSalinityFromResistivityC(rw, t), ppm)).toBeLessThan(1e-9);
      expect(Math.abs(naclTemperatureC(ppm, rw) - t)).toBeLessThan(1e-9);
    }
  });

  it('la inversa de Arps deshace a Arps en °F y en °C', () => {
    const r2 = arpsResistivityF(0.3, 75, 190);
    expect(arpsTemperatureF(0.3, 75, r2)).toBeCloseTo(190, 9);
    const r2c = arpsResistivityC(0.3, 24, 85);
    expect(arpsTemperatureC(0.3, 24, r2c)).toBeCloseTo(85, 9);
  });

  it('casos degenerados dan NaN', () => {
    expect(arpsTemperatureF(0, 75, 0.1)).toBeNaN();
    expect(arpsTemperatureF(0.3, 75, 0)).toBeNaN();
    expect(arpsTemperatureF(0.3, -10, 0.1)).toBeNaN(); // T1 + 6,77 ≤ 0
    expect(arpsTemperatureC(NaN, 25, 0.1)).toBeNaN();
    expect(naclResistivityC(20_000, -30)).toBeNaN(); // −30 °C = −22 °F < −6,77 °F
    expect(naclResistivityC(NaN, 25)).toBeNaN();
    expect(naclSalinityFromResistivityC(0.1, NaN)).toBeNaN();
    expect(naclTemperatureC(20_000, 0)).toBeNaN();
  });
});

describe('avisos de validez', () => {
  it('bordes inclusivos: 1 000, 150 000 y 250 000 ppm; 0 y 200 °C no avisan', () => {
    expect(waterWarnings(1_000, 0)).toEqual([]);
    expect(waterWarnings(150_000, 200)).toEqual([]);
    expect(waterWarnings(250_000, 100)).toEqual(['salinity-accuracy']);
  });

  it('fuera de rango', () => {
    expect(waterWarnings(999, 50)).toEqual(['salinity-low']);
    expect(waterWarnings(150_001, 50)).toEqual(['salinity-accuracy']);
    expect(waterWarnings(250_001, 50)).toEqual(['salinity-high']);
    expect(waterWarnings(30_000, 200.5)).toEqual(['temperature-high']);
    expect(waterWarnings(30_000, -1)).toEqual(['temperature-low']);
    expect(waterWarnings(500, 220)).toEqual(['salinity-low', 'temperature-high']);
  });

  it('NaN no avisa', () => {
    expect(waterWarnings(NaN, NaN)).toEqual([]);
  });
});

describe('Rw a lo largo del pozo', () => {
  it('perfil de Arps: la Rw baja al subir la temperatura y respeta NaN', () => {
    const t = Float64Array.from([24, 60, NaN, 120]);
    const rw = waterResistivityProfile(0.1, 24, t);
    expect(rw[0]).toBeCloseTo(0.1, 12);
    expect(rw[1]).toBeCloseTo((0.1 * (24 * 1.8 + 32 + 6.77)) / (60 * 1.8 + 32 + 6.77), 12);
    expect(rw[2]).toBeNaN();
    expect(rw[3]!).toBeLessThan(rw[1]!);
  });
});

describe('valueAtDepth', () => {
  const depth = [100, 110, 120, 130];
  const temp = [20, 30, NaN, 50];
  it('interpola linealmente', () => {
    expect(valueAtDepth(depth, temp, 105)).toBeCloseTo(25, 12);
    expect(valueAtDepth(depth, temp, 110)).toBe(30);
    expect(valueAtDepth(depth, temp, 100)).toBe(20);
    expect(valueAtDepth(depth, temp, 130)).toBe(50);
  });
  it('NaN fuera de rango o con una vecina sin dato', () => {
    expect(valueAtDepth(depth, temp, 99.9)).toBeNaN();
    expect(valueAtDepth(depth, temp, 130.1)).toBeNaN();
    expect(valueAtDepth(depth, temp, 115)).toBeNaN();
    expect(valueAtDepth(depth, temp, 125)).toBeNaN();
    expect(valueAtDepth([], [], 1)).toBeNaN();
    expect(valueAtDepth(depth, temp, NaN)).toBeNaN();
  });
});
