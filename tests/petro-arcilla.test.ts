import { describe, expect, it } from 'vitest';
import {
  VSH_METHODS,
  vshClavier,
  vshFromIgr,
  vshFromIgrInto,
  vshLarionovOlder,
  vshLarionovTertiary,
  vshLinear,
  vshSteiber,
  type VshMethod,
} from '../src/petro/vsh';

// Las ecuaciones son las de Asquith y Krygowski (2004, cap. 4); los valores de abajo se calcularon a mano
// (no son números impresos en el libro) y se contrastaron con una evaluación independiente en Python.

describe('petro/vsh: valores calculados a mano', () => {
  it('lineal: Vsh = IGR', () => {
    expect(vshLinear(0)).toBe(0);
    expect(vshLinear(0.37)).toBeCloseTo(0.37, 12);
    expect(vshLinear(1)).toBe(1);
  });

  it('Larionov terciario: 0,083·(2^(3,7·IGR) − 1)', () => {
    // verificado a mano, no de libro
    // IGR=0   → 0,083·(1 − 1) = 0
    expect(vshLarionovTertiary(0)).toBe(0);
    // IGR=0,5 → 2^1,85 = e^(1,85·ln2) = e^1,28232 = 3,60500 → 0,083·2,60500 = 0,21622
    expect(vshLarionovTertiary(0.5)).toBeCloseTo(0.21622, 4);
    // IGR=1   → 2^3,7 = 8·2^0,7 = 8·1,62451 = 12,99604 → 0,083·11,99604 = 0,99567 (NO llega a 1)
    expect(vshLarionovTertiary(1)).toBeCloseTo(0.99567, 4);
  });

  it('Larionov rocas antiguas: 0,33·(2^(2·IGR) − 1)', () => {
    // verificado a mano, no de libro
    // IGR=0    → 0
    expect(vshLarionovOlder(0)).toBe(0);
    // IGR=0,25 → 2^0,5 = 1,414214 → 0,33·0,414214 = 0,13669
    expect(vshLarionovOlder(0.25)).toBeCloseTo(0.13669, 4);
    // IGR=0,5  → 2^1 = 2 → 0,33·1 = 0,33
    expect(vshLarionovOlder(0.5)).toBeCloseTo(0.33, 12);
    // IGR=1    → 2^2 = 4 → 0,33·3 = 0,99 (NO llega a 1)
    expect(vshLarionovOlder(1)).toBeCloseTo(0.99, 12);
  });

  it('Clavier: 1,7 − √(3,38 − (IGR + 0,7)²)', () => {
    // verificado a mano, no de libro
    // IGR=0   → 1,7 − √(3,38 − 0,49) = 1,7 − √2,89 = 1,7 − 1,7 = 0
    expect(vshClavier(0)).toBeCloseTo(0, 12);
    // IGR=0,3 → 1,7 − √(3,38 − 1,00) = 1,7 − √2,38 = 1,7 − 1,542725 = 0,157275
    expect(vshClavier(0.3)).toBeCloseTo(0.157275, 5);
    // IGR=0,5 → 1,7 − √(3,38 − 1,44) = 1,7 − √1,94 = 1,7 − 1,392839 = 0,307161
    expect(vshClavier(0.5)).toBeCloseTo(0.307161, 5);
    // IGR=1   → 1,7 − √(3,38 − 2,89) = 1,7 − √0,49 = 1,7 − 0,7 = 1
    expect(vshClavier(1)).toBeCloseTo(1, 12);
  });

  it('Steiber: IGR/(3 − 2·IGR)', () => {
    // verificado a mano, no de libro
    expect(vshSteiber(0)).toBe(0);
    // IGR=0,25 → 0,25/2,5 = 0,1
    expect(vshSteiber(0.25)).toBeCloseTo(0.1, 12);
    // IGR=0,5  → 0,5/2 = 0,25
    expect(vshSteiber(0.5)).toBeCloseTo(0.25, 12);
    // IGR=0,75 → 0,75/1,5 = 0,5
    expect(vshSteiber(0.75)).toBeCloseTo(0.5, 12);
    // IGR=1    → 1/1 = 1
    expect(vshSteiber(1)).toBe(1);
  });
});

describe('petro/vsh: propiedades', () => {
  const fns: Record<VshMethod, (x: number) => number> = {
    linear: vshLinear,
    larionovTertiary: vshLarionovTertiary,
    larionovOlder: vshLarionovOlder,
    clavier: vshClavier,
    steiber: vshSteiber,
  };

  it('cada método es estrictamente creciente en IGR y está en [0, 1]', () => {
    for (const m of VSH_METHODS) {
      let prev = -Infinity;
      for (let k = 0; k <= 100; k++) {
        const v = fns[m](k / 100);
        expect(v, `${m} IGR=${k / 100}`).toBeGreaterThanOrEqual(0);
        expect(v, `${m} IGR=${k / 100}`).toBeLessThanOrEqual(1);
        expect(v, `${m} creciente en IGR=${k / 100}`).toBeGreaterThan(prev);
        prev = v;
      }
    }
  });

  it('Vsh(0) = 0 en todos; Vsh(1) = 1 en lineal, Clavier y Steiber', () => {
    for (const m of VSH_METHODS) expect(fns[m](0), m).toBeCloseTo(0, 12);
    expect(vshLinear(1)).toBe(1);
    expect(vshClavier(1)).toBeCloseTo(1, 12);
    expect(vshSteiber(1)).toBe(1);
    // Larionov queda ligeramente por debajo de 1 (propiedad de la ecuación original)
    expect(vshLarionovTertiary(1)).toBeLessThan(1);
    expect(vshLarionovOlder(1)).toBeLessThan(1);
  });

  it('en el interior los métodos no lineales dan menos arcilla que el lineal', () => {
    for (const g of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      expect(vshClavier(g)).toBeLessThan(g);
      expect(vshSteiber(g)).toBeLessThan(g);
      expect(vshLarionovOlder(g)).toBeLessThan(g);
    }
  });
});

describe('petro/vsh: bordes, despacho y variante Into', () => {
  it('NaN se propaga en todos los métodos', () => {
    for (const m of VSH_METHODS) expect(vshFromIgr(NaN, m), m).toBeNaN();
  });

  it('IGR fuera de [0, 1] se recorta (sin NaN por dominio de Clavier ni polo de Steiber)', () => {
    for (const m of VSH_METHODS) {
      expect(vshFromIgr(-0.5, m), m).toBeCloseTo(0, 12);
      expect(vshFromIgr(1.5, m), m).toBe(vshFromIgr(1, m));
      expect(vshFromIgr(2, m), m).toBe(vshFromIgr(1, m));
    }
    expect(Number.isNaN(vshClavier(1.2))).toBe(false);
    expect(Number.isNaN(vshSteiber(1.5))).toBe(false);
  });

  it('vshFromIgr despacha por nombre y método desconocido → NaN', () => {
    expect(vshFromIgr(0.5, 'linear')).toBeCloseTo(0.5, 12);
    expect(vshFromIgr(0.5, 'larionovTertiary')).toBeCloseTo(0.21622, 4);
    expect(vshFromIgr(0.5, 'larionovOlder')).toBeCloseTo(0.33, 12);
    expect(vshFromIgr(0.5, 'clavier')).toBeCloseTo(0.307161, 5);
    expect(vshFromIgr(0.5, 'steiber')).toBeCloseTo(0.25, 12);
    expect(vshFromIgr(0.5, 'nope' as VshMethod)).toBeNaN();
  });

  it('versión por tramo escribe solo [start, end) y propaga NaN', () => {
    const out = new Float64Array(5).fill(-1);
    vshFromIgrInto([0, 0.5, NaN, 1, 0.25], out, 'steiber', 1, 4);
    expect(out[0]).toBe(-1);
    expect(out[1]).toBeCloseTo(0.25, 12);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(1);
    expect(out[4]).toBe(-1);
  });

  it('versión por tramo con método desconocido → NaN en el tramo', () => {
    const out = new Float64Array(3).fill(-1);
    vshFromIgrInto([0.1, 0.2, 0.3], out, 'x' as VshMethod, 0, 2);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(-1);
  });
});
