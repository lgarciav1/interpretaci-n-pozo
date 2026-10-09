import { describe, expect, it } from 'vitest';
import { netFlagsInto, netPayFlag, netReservoirFlag } from '../src/petro/cutoffs';

// Los cutoffs son decisiones del intérprete: no hay valores de libro. Casos verificados a mano (tabla de verdad).

describe('petro/cutoffs: reservorio neto', () => {
  it('bordes inclusivos: vsh = vshMax y phi = phiMin pasan (verificado a mano)', () => {
    expect(netReservoirFlag(0.4, 0.08, 0.4, 0.08)).toBe(1);
  });

  it('un epsilon por fuera del borde no pasa (vsh o phi)', () => {
    expect(netReservoirFlag(0.4 + 1e-12, 0.1, 0.4, 0.08)).toBe(0);
    expect(netReservoirFlag(0.1, 0.08 - 1e-12, 0.4, 0.08)).toBe(0);
  });

  it('pasa claramente / falla por arcilla / falla por porosidad / falla por las dos', () => {
    expect(netReservoirFlag(0.1, 0.2, 0.4, 0.08)).toBe(1);
    expect(netReservoirFlag(0.6, 0.2, 0.4, 0.08)).toBe(0);
    expect(netReservoirFlag(0.1, 0.02, 0.4, 0.08)).toBe(0);
    expect(netReservoirFlag(0.6, 0.02, 0.4, 0.08)).toBe(0);
  });

  it('NaN en vsh o en phi → NaN (aunque la otra variable ya falle)', () => {
    expect(netReservoirFlag(NaN, 0.2, 0.4, 0.08)).toBeNaN();
    expect(netReservoirFlag(0.1, NaN, 0.4, 0.08)).toBeNaN();
    expect(netReservoirFlag(NaN, NaN, 0.4, 0.08)).toBeNaN();
    expect(netReservoirFlag(0.9, NaN, 0.4, 0.08)).toBeNaN();
  });
});

describe('petro/cutoffs: pay neto', () => {
  it('sw = swMax pasa (inclusivo); un epsilon más no', () => {
    expect(netPayFlag(1, 0.6, 0.6)).toBe(1);
    expect(netPayFlag(1, 0.6 + 1e-12, 0.6)).toBe(0);
  });

  it('netRes = 0 → 0 aunque Sw sea NaN; netRes NaN → NaN; netRes = 1 con Sw NaN → NaN', () => {
    expect(netPayFlag(0, 0.1, 0.6)).toBe(0);
    expect(netPayFlag(0, NaN, 0.6)).toBe(0);
    expect(netPayFlag(NaN, 0.1, 0.6)).toBeNaN();
    expect(netPayFlag(1, NaN, 0.6)).toBeNaN();
  });
});

describe('petro/cutoffs: netFlagsInto', () => {
  const vsh = [0.1, 0.4, 0.5, 0.2, NaN, 0.2, 0.3];
  const phi = [0.2, 0.08, 0.2, 0.05, 0.2, NaN, 0.15];
  const sw = [0.3, 0.6, 0.1, 0.1, 0.1, 0.1, NaN];
  const cut = { vshMax: 0.4, phiMin: 0.08, swMax: 0.6 };

  it('tabla de verdad a mano sobre 7 muestras', () => {
    const res = new Float64Array(7);
    const pay = new Float64Array(7);
    netFlagsInto(vsh, phi, sw, res, pay, cut);
    // 0: pasa todo → 1/1; 1: en los tres bordes → 1/1; 2: vsh alto → 0/0; 3: phi bajo → 0/0;
    // 4: vsh NaN → NaN/NaN; 5: phi NaN → NaN/NaN; 6: reservorio con Sw NaN → 1/NaN
    expect(Array.from(res)).toEqual([1, 1, 0, 0, NaN, NaN, 1]);
    expect(Array.from(pay)).toEqual([1, 1, 0, 0, NaN, NaN, NaN]);
  });

  it('pay ⊆ reservorio: donde NET_PAY = 1, NET_RES = 1 (propiedad, 2000 muestras pseudoaleatorias)', () => {
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const n = 2000;
    const v = Float64Array.from({ length: n }, rnd);
    const p = Float64Array.from({ length: n }, () => rnd() * 0.4);
    const w = Float64Array.from({ length: n }, rnd);
    const res = new Float64Array(n);
    const pay = new Float64Array(n);
    netFlagsInto(v, p, w, res, pay, cut);
    let nPay = 0;
    for (let i = 0; i < n; i++) {
      if (pay[i] === 1) {
        nPay++;
        expect(res[i]).toBe(1);
      }
    }
    expect(nPay).toBeGreaterThan(0);
    expect(nPay).toBeLessThan(n);
  });

  it('solo escribe el tramo [start, end)', () => {
    const res = new Float64Array(7).fill(-9);
    const pay = new Float64Array(7).fill(-9);
    netFlagsInto(vsh, phi, sw, res, pay, cut, 2, 4);
    expect(Array.from(res)).toEqual([-9, -9, 0, 0, -9, -9, -9]);
    expect(Array.from(pay)).toEqual([-9, -9, 0, 0, -9, -9, -9]);
  });
});
