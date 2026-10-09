import { describe, expect, it } from 'vitest';
import {
  arpsResistivityC,
  arpsResistivityF,
  arpsResistivityFInto,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  formationTemperature,
  formationTemperatureInto,
} from '../src/petro/temperature';

describe('petro/temperature: conversión °C ↔ °F', () => {
  it('puntos fijos del agua: 0 °C = 32 °F, 100 °C = 212 °F; −40 coincide', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(celsiusToFahrenheit(-40)).toBeCloseTo(-40, 12);
    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(fahrenheitToCelsius(212)).toBeCloseTo(100, 12);
  });

  it('ida y vuelta; 24 °C = 75,2 °F (verificado a mano: 24·1,8 + 32)', () => {
    expect(celsiusToFahrenheit(24)).toBeCloseTo(75.2, 12);
    for (const c of [-10, 0, 24, 93, 150]) expect(fahrenheitToCelsius(celsiusToFahrenheit(c))).toBeCloseTo(c, 10);
  });

  it('NaN se propaga', () => {
    expect(celsiusToFahrenheit(NaN)).toBeNaN();
    expect(fahrenheitToCelsius(NaN)).toBeNaN();
  });
});

describe('petro/temperature: gradiente lineal', () => {
  it('T = Tsurf + grad·z en °F y ft: 60 °F + 0,015 °F/ft · 8000 ft = 180 °F', () => {
    // verificado a mano, no de libro
    expect(formationTemperature(8000, 60, 0.015)).toBeCloseTo(180, 10);
  });

  it('la unidad de profundidad la elige el llamador: °C y m, 15 °C + 0,03 °C/m · 2500 m = 90 °C', () => {
    // verificado a mano, no de libro
    expect(formationTemperature(2500, 15, 0.03)).toBeCloseTo(90, 10);
  });

  it('consistencia entre sistemas: mismo perfil térmico en (°F, ft) y (°C, m)', () => {
    // 8000 ft = 2438,4 m ; Tsurf 60 °F = 15,5556 °C ; 0,015 °F/ft = 0,015/1,8 °C / 0,3048 m = 0,027340 °C/m
    const tF = formationTemperature(8000, 60, 0.015);
    const gC = 0.015 / 1.8 / 0.3048;
    const tC = formationTemperature(8000 * 0.3048, fahrenheitToCelsius(60), gC);
    expect(celsiusToFahrenheit(tC)).toBeCloseTo(tF, 8);
  });

  it('profundidad 0 → Tsurf; gradiente 0 → constante', () => {
    expect(formationTemperature(0, 60, 0.015)).toBe(60);
    expect(formationTemperature(5000, 60, 0)).toBe(60);
  });

  it('NaN en cualquier entrada → NaN', () => {
    expect(formationTemperature(NaN, 60, 0.015)).toBeNaN();
    expect(formationTemperature(100, NaN, 0.015)).toBeNaN();
    expect(formationTemperature(100, 60, NaN)).toBeNaN();
  });

  it('versión por tramo escribe solo [start, end)', () => {
    const out = new Float64Array(4).fill(-1);
    formationTemperatureInto([0, 1000, NaN, 8000], out, 60, 0.015, 1, 3);
    expect(out[0]).toBe(-1);
    expect(out[1]).toBeCloseTo(75, 10);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(-1);
  });
});

describe('petro/temperature: Arps', () => {
  it('75 °F → 200 °F con R=0,5: 0,5·81,77/206,77 = 0,19773', () => {
    // verificado a mano, no de libro: (75+6,77)=81,77 ; (200+6,77)=206,77 ; 81,77/206,77 = 0,39546 ; ·0,5 = 0,19773
    // (el brief mencionaba ≈0,17; la cuenta exacta da 0,1977, mismo orden de magnitud)
    expect(arpsResistivityF(0.5, 75, 200)).toBeCloseTo(0.19773, 4);
  });

  it('75 °F → 150 °F con R=0,5: 0,5·81,77/156,77 = 0,26080', () => {
    // verificado a mano, no de libro
    expect(arpsResistivityF(0.5, 75, 150)).toBeCloseTo(0.2608, 4);
  });

  it('T1 = T2 no cambia R; la resistividad baja al calentar y sube al enfriar', () => {
    expect(arpsResistivityF(0.8, 120, 120)).toBeCloseTo(0.8, 12);
    expect(arpsResistivityF(0.8, 75, 150)).toBeLessThan(0.8);
    expect(arpsResistivityF(0.8, 150, 75)).toBeGreaterThan(0.8);
  });

  it('es invertible: ida y vuelta devuelve R1', () => {
    const r2 = arpsResistivityF(0.5, 75, 200);
    expect(arpsResistivityF(r2, 200, 75)).toBeCloseTo(0.5, 12);
  });

  it('versión °C: 24 °C → 93 °C equivale a 75,2 °F → 199,4 °F', () => {
    // verificado a mano, no de libro. 93 °C = 199,4 °F. (75,2+6,77)=81,97 ; (199,4+6,77)=206,17 ;
    // 0,5·81,97/206,17 = 0,198790
    expect(arpsResistivityC(0.5, 24, 93)).toBeCloseTo(0.19879, 5);
    expect(arpsResistivityC(0.5, 24, 93)).toBeCloseTo(arpsResistivityF(0.5, 75.2, 199.4), 12);
  });

  it('forma redondeada de la carta (21,5 °C) coincide con la exacta con < 0,1 %', () => {
    // 0,5·(24 + 21,5)/(93 + 21,5) = 0,198690 (a mano) vs 0,198790 exacta
    const rounded = (0.5 * (24 + 21.5)) / (93 + 21.5);
    expect(rounded).toBeCloseTo(0.19869, 5);
    expect(Math.abs(arpsResistivityC(0.5, 24, 93) / rounded - 1)).toBeLessThan(1e-3);
  });

  it('bordes: NaN, R ≤ 0, temperatura bajo el cero de la ecuación → NaN', () => {
    expect(arpsResistivityF(NaN, 75, 200)).toBeNaN();
    expect(arpsResistivityF(0.5, NaN, 200)).toBeNaN();
    expect(arpsResistivityF(0.5, 75, NaN)).toBeNaN();
    expect(arpsResistivityF(0, 75, 200)).toBeNaN();
    expect(arpsResistivityF(-1, 75, 200)).toBeNaN();
    expect(arpsResistivityF(0.5, 75, -6.77)).toBeNaN();
    expect(arpsResistivityF(0.5, -10, 200)).toBeNaN();
    expect(arpsResistivityC(0.5, 24, -30)).toBeNaN();
    expect(arpsResistivityC(NaN, 24, 93)).toBeNaN();
  });

  it('versión por tramo: T2 por muestra, escribe solo [start, end)', () => {
    const out = new Float64Array(4).fill(-1);
    arpsResistivityFInto([0.5, 0.5, 0.5, 0.5], [75, 200, NaN, 150], out, 75, 1, 3);
    expect(out[0]).toBe(-1);
    expect(out[1]).toBeCloseTo(0.19773, 4);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(-1);
  });
});
