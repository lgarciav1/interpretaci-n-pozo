/**
 * Perfil radial de invasión escalonada (src/petro/invasion.ts, decisión 0020).
 *
 * Qué se verifica y contra qué:
 *  - J(r): propiedades (J(0) = 0, J(∞) = 1, J(r50) = 0,5, monótona) y valores calculados a mano.
 *  - Aproximación de J: contra el factor geométrico radial de una sonda de dos bobinas (Doll 1949; Moran y Kunz
 *    1962) integrado numéricamente ACÁ, con un código aparte del motor. NO es la respuesta de Schlumberger.
 *  - Modelo directo: valores calculados a mano.
 *  - Inversión: ida y vuelta (modelo directo → inversión) con 3, 4 y 5 curvas, invasión resistiva y conductiva;
 *    sin invasión; datos inválidos; pico aislado; y contra una búsqueda exhaustiva independiente en (ri, σxo, σt).
 *  - Ejemplo de libro (tornado de Asquith y Krygowski 2004 / cartas de Schlumberger): NO se pudo consultar en el
 *    entorno de trabajo; no hay caso de libro. Ver la decisión 0020.
 */
import { describe, expect, it } from 'vitest';
import {
  ARRAY_INDUCTION_R50_IN,
  RADIAL_STEEPNESS,
  forwardStepProfile,
  invasionProfileAtDepth,
  invertStepProfile,
  invertStepProfileInto,
  radialGeometricFactor,
  radialResponseSamples,
  stepProfileReading,
  type InvasionReading,
} from '../src/petro/invasion';

const R50 = [10, 20, 30, 60, 90];
const reads = (di: number, rxo: number, rt: number, r50s: number[] = R50): InvasionReading[] => {
  const v = forwardStepProfile(di, rxo, rt, r50s);
  return r50s.map((r, k) => ({ label: `AT${r}`, r50: r, resistivity: v[k]! }));
};
const relErr = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

describe('factor geométrico radial J(r)', () => {
  it('J(0) = 0, J(∞) = 1, J(r50) = 0,5 para cada profundidad de la herramienta', () => {
    for (const r50 of R50) {
      expect(radialGeometricFactor(0, r50)).toBe(0);
      expect(radialGeometricFactor(-3, r50)).toBe(0);
      expect(radialGeometricFactor(Infinity, r50)).toBe(1);
      expect(radialGeometricFactor(r50, r50)).toBeCloseTo(0.5, 14);
      expect(radialGeometricFactor(1e-9, r50)).toBeLessThan(1e-12);
      expect(radialGeometricFactor(1e12, r50)).toBeGreaterThan(1 - 1e-12);
    }
  });

  it('es estrictamente creciente en r y decrece al aumentar r50 (más profunda = menos señal cercana)', () => {
    for (const r50 of R50) {
      let prev = -1;
      for (let i = 0; i < 200; i++) {
        const j = radialGeometricFactor(0.5 * Math.pow(1.04, i), r50);
        expect(j).toBeGreaterThan(prev);
        prev = j;
      }
    }
    for (let k = 1; k < R50.length; k++) expect(radialGeometricFactor(20, R50[k]!)).toBeLessThan(radialGeometricFactor(20, R50[k - 1]!));
  });

  it('valores calculados a mano con p = 1,5: J(30; r50 = 10) = 1/(1 + 3^−1,5) = 0,83861 y J(30; r50 = 90) = 1/(1 + 3^1,5) = 0,16139', () => {
    expect(RADIAL_STEEPNESS).toBe(1.5);
    // 3^1,5 = 3·√3 = 5,196152; su inversa 0,192450
    expect(radialGeometricFactor(30, 10)).toBeCloseTo(1 / (1 + 0.19245009), 7);
    expect(radialGeometricFactor(30, 10)).toBeCloseTo(0.83861, 5);
    expect(radialGeometricFactor(30, 90)).toBeCloseTo(1 / (1 + 5.19615242), 7);
    expect(radialGeometricFactor(30, 90)).toBeCloseTo(0.16139, 5);
  });

  it('entradas inválidas → NaN', () => {
    expect(radialGeometricFactor(NaN, 10)).toBeNaN();
    expect(radialGeometricFactor(5, 0)).toBeNaN();
    expect(radialGeometricFactor(5, NaN)).toBeNaN();
    expect(radialGeometricFactor(5, 10, -1)).toBeNaN();
  });

  it('muestras para dibujar: grilla logarítmica creciente que cubre el rango y J monótona', () => {
    const { r, j } = radialResponseSamples(30, 1, 300, 60);
    expect(r[0]).toBeCloseTo(1, 12);
    expect(r[59]).toBeCloseTo(300, 9);
    for (let i = 1; i < 60; i++) {
      expect(r[i]!).toBeGreaterThan(r[i - 1]!);
      expect(j[i]!).toBeGreaterThan(j[i - 1]!);
    }
    expect(radialResponseSamples(30, 10, 1).r.every(Number.isNaN)).toBe(true);
  });

  /**
   * Factor geométrico radial integrado de una sonda de dos bobinas en medio homogéneo (sin efecto pelicular), con
   * g(ρ, z) ∝ ρ² / (ρT³ ρR³) (Doll 1949), integrado en z (sustitución z = s·sinh t) y acumulado en ρ (trapezoides
   * en grilla logarítmica). Espaciamiento L = 1; se compara en unidades de r50.
   */
  function twoCoilRadialJ(): { rho: number[]; j: number[]; r50: number } {
    const L = 1;
    const gr = (rho: number): number => {
      const s = Math.max(rho, L);
      const T = Math.asinh(2000); // cubre |z| ≤ 2000·máx(ρ, L)
      const N = 1600;
      let acc = 0;
      for (let i = 0; i <= N; i++) {
        const t = -T + (2 * T * i) / N;
        const z = s * Math.sinh(t);
        const dz = s * Math.cosh(t);
        const a = Math.hypot(rho, z + L / 2);
        const b = Math.hypot(rho, z - L / 2);
        acc += ((rho * rho) / (a ** 3 * b ** 3)) * dz * (i === 0 || i === N ? 0.5 : 1);
      }
      return (acc * 2 * T) / N;
    };
    const M = 300;
    const lo = Math.log(1e-3);
    const hi = Math.log(1e3);
    const rho: number[] = [];
    const g: number[] = [];
    for (let i = 0; i <= M; i++) {
      rho.push(Math.exp(lo + ((hi - lo) * i) / M));
      g.push(gr(rho[i]!));
    }
    const cum = [0];
    for (let i = 1; i <= M; i++) cum.push(cum[i - 1]! + 0.5 * (g[i]! + g[i - 1]!) * (rho[i]! - rho[i - 1]!));
    const total = cum[M]! + g[M]! * rho[M]!; // cola ∝ 1/ρ²
    const j = cum.map((c) => c / total);
    let r50 = NaN;
    for (let i = 1; i <= M; i++) {
      if (j[i]! >= 0.5) {
        const t = (0.5 - j[i - 1]!) / (j[i]! - j[i - 1]!);
        r50 = Math.exp(Math.log(rho[i - 1]!) + t * (Math.log(rho[i]!) - Math.log(rho[i - 1]!)));
        break;
      }
    }
    return { rho, j, r50 };
  }

  it('la logística con p = 1,5 reproduce el J de dos bobinas (Doll) a menos de 0,045; con p = 1 o p = 2 el error es mayor', () => {
    const { rho, j, r50 } = twoCoilRadialJ();
    expect(r50).toBeGreaterThan(0.3);
    expect(r50).toBeLessThan(0.45); // r50 ≈ 0,378·L
    const maxErr = (p: number): number => Math.max(...rho.map((r, i) => Math.abs(radialGeometricFactor(r, r50, p) - j[i]!)));
    expect(maxErr(1.5)).toBeLessThan(0.045);
    expect(maxErr(1.5)).toBeGreaterThan(0.03); // el error documentado es 0,040, no es despreciable
    expect(maxErr(1)).toBeGreaterThan(maxErr(1.5));
    expect(maxErr(2)).toBeGreaterThan(maxErr(1.5));
  });
});

describe('modelo directo escalonado', () => {
  it('valores a mano: ri = 30 in (di = 60), Rxo = 10, Rt = 1', () => {
    // σ = J/10 + (1 − J)/1
    // AT30: J = 0,5 → σ = 0,55 → R = 1,81818
    expect(stepProfileReading(60, 10, 1, 30)).toBeCloseTo(1 / 0.55, 10);
    // AT10: J = 0,83861 → σ = 0,083861 + 0,161391 = 0,245252 → R = 4,0774
    expect(stepProfileReading(60, 10, 1, 10)).toBeCloseTo(4.0774, 3);
    // AT90: J = 0,16139 → σ = 0,016139 + 0,838612 = 0,854751 → R = 1,16995
    expect(stepProfileReading(60, 10, 1, 90)).toBeCloseTo(1.16995, 4);
  });

  it('invasión resistiva (Rxo > Rt): las lecturas bajan con la profundidad; conductiva: suben; todas entre Rt y Rxo', () => {
    const res = forwardStepProfile(50, 20, 2, R50);
    const con = forwardStepProfile(50, 0.5, 5, R50);
    for (let k = 1; k < 5; k++) {
      expect(res[k]!).toBeLessThan(res[k - 1]!);
      expect(con[k]!).toBeGreaterThan(con[k - 1]!);
    }
    for (const v of res) expect(v > 2 && v < 20).toBe(true);
    for (const v of con) expect(v > 0.5 && v < 5).toBe(true);
  });

  it('límites: di = 0 → Rt; Rxo = Rt → Rt; invasión muy profunda → Rxo; datos inválidos → NaN', () => {
    expect(stepProfileReading(0, 10, 2, 30)).toBeCloseTo(2, 12);
    expect(stepProfileReading(80, 3, 3, 30)).toBeCloseTo(3, 12);
    expect(stepProfileReading(1e6, 10, 2, 90)).toBeCloseTo(10, 3);
    expect(stepProfileReading(40, 0, 2, 30)).toBeNaN();
    expect(stepProfileReading(40, 10, -2, 30)).toBeNaN();
    expect(stepProfileReading(-1, 10, 2, 30)).toBeNaN();
    expect(stepProfileReading(NaN, 10, 2, 30)).toBeNaN();
  });
});

describe('inversión: ida y vuelta (modelo directo → inversión)', () => {
  const cases: [string, number, number, number][] = [
    ['resistiva moderada', 40, 20, 2],
    ['resistiva profunda', 90, 8, 1.5],
    ['resistiva somera', 18, 6, 1],
    ['conductiva moderada', 50, 0.5, 5],
    ['conductiva profunda', 100, 0.8, 12],
    ['conductiva somera', 20, 2, 10],
  ];
  const sets: [string, number[]][] = [
    ['5 curvas (AT10-20-30-60-90)', [10, 20, 30, 60, 90]],
    ['4 curvas (AT10-30-60-90, como el TP)', [10, 30, 60, 90]],
    ['3 curvas (AT10-30-90)', [10, 30, 90]],
  ];
  for (const [setName, r50s] of sets) {
    for (const [name, di, rxo, rt] of cases) {
      it(`${name} (di ${di}, Rxo ${rxo}, Rt ${rt}) con ${setName}: recupera Rxo, di y Rt a menos de 0,1 %`, () => {
        const fit = invertStepProfile(reads(di, rxo, rt, r50s));
        expect(fit.status).toBe('ok');
        expect(fit.nCurves).toBe(r50s.length);
        expect(relErr(fit.di, di)).toBeLessThan(1e-3);
        expect(relErr(fit.rxo, rxo)).toBeLessThan(1e-3);
        expect(relErr(fit.rt, rt)).toBeLessThan(1e-3);
        expect(fit.misfit).toBeLessThan(1e-4);
        expect(fit.atBound).toBeNull();
      });
    }
  }

  it('el orden de las lecturas no importa', () => {
    const a = reads(40, 20, 2);
    const b = [...a].reverse();
    const fa = invertStepProfile(a);
    const fb = invertStepProfile(b);
    expect(fb.di).toBeCloseTo(fa.di, 6);
    expect(fb.rxo).toBeCloseTo(fa.rxo, 6);
    expect(fb.rt).toBeCloseTo(fa.rt, 6);
  });

  it('con ruido proporcional del 3 % el perfil se recupera con error acotado y el misfit refleja el ruido', () => {
    const noise = [1.03, 0.98, 1.02, 0.97, 1.01]; // determinista
    const r = reads(40, 20, 2).map((x, k) => ({ ...x, resistivity: x.resistivity * noise[k]! }));
    const fit = invertStepProfile(r);
    expect(fit.status).toBe('ok');
    expect(relErr(fit.rt, 2)).toBeLessThan(0.1);
    expect(fit.misfit).toBeGreaterThan(0.005);
    expect(fit.misfit).toBeLessThan(0.04);
  });

  it('el diámetro nunca es menor que el trépano (cota inferior) y se puede cambiar', () => {
    const fit = invertStepProfile(reads(40, 20, 2), { bitSize: 12.25 });
    expect(fit.status).toBe('ok');
    expect(fit.di).toBeGreaterThanOrEqual(12.25 - 1e-9);
    // invasión verdadera somera (di = 9) con trépano de 8,5: no baja del trépano
    const shallow = invertStepProfile(reads(9, 5, 1));
    expect(shallow.di).toBeGreaterThanOrEqual(8.5 - 1e-9);
  });
});

describe('inversión: casos borde', () => {
  it('lecturas casi iguales (separación < 10 %): sin invasión, Rt = lectura más profunda, Rxo, di y misfit sin dato', () => {
    const r: InvasionReading[] = [
      { r50: 10, resistivity: 2.08 },
      { r50: 30, resistivity: 2.05 },
      { r50: 60, resistivity: 2.02 },
      { r50: 90, resistivity: 2.0 },
    ];
    const fit = invertStepProfile(r);
    expect(fit.status).toBe('no-invasion');
    expect(fit.rt).toBe(2.0);
    expect(fit.rxo).toBeNaN();
    expect(fit.di).toBeNaN();
    expect(fit.misfit).toBeNaN();
    expect(fit.separation).toBeCloseTo(0.04, 12);
    expect(fit.nCurves).toBe(4);
    // la lectura profunda se elige por r50, no por posición
    expect(invertStepProfile([...r].reverse()).rt).toBe(2.0);
  });

  it('el umbral de separación decide: 20 % es invasión con umbral 0,10 y sin invasión con 0,30', () => {
    const r: InvasionReading[] = [
      { r50: 10, resistivity: 1.2 },
      { r50: 30, resistivity: 1.12 },
      { r50: 90, resistivity: 1.0 },
    ];
    expect(invertStepProfile(r, { minSeparation: 0.1 }).status).toBe('ok');
    expect(invertStepProfile(r, { minSeparation: 0.3 }).status).toBe('no-invasion');
  });

  it('menos de 3 curvas válidas → sin dato (todo NaN), incluida Rt', () => {
    const two = invertStepProfile([
      { r50: 30, resistivity: 5 },
      { r50: 90, resistivity: 1 },
    ]);
    expect(two.status).toBe('insufficient');
    for (const v of [two.rxo, two.rt, two.di, two.misfit]) expect(v).toBeNaN();
    expect(two.nCurves).toBe(2);
    expect(invertStepProfile([]).status).toBe('insufficient');
  });

  it('NaN, 0, negativos e infinitos se descartan: con 4 curvas y una inválida quedan 3 y sigue ajustando; con 2 válidas no', () => {
    const good = reads(40, 20, 2, [10, 30, 60, 90]);
    for (const bad of [NaN, 0, -1.5, Infinity]) {
      const r = good.map((x, k) => (k === 1 ? { ...x, resistivity: bad } : x));
      const fit = invertStepProfile(r);
      expect(fit.nCurves).toBe(3);
      expect(fit.status).toBe('ok');
      expect(relErr(fit.rt, 2)).toBeLessThan(1e-3);
    }
    const r2 = good.map((x, k) => (k < 2 ? { ...x, resistivity: NaN } : x));
    expect(invertStepProfile(r2).status).toBe('insufficient');
    // r50 inválido también se descarta
    expect(invertStepProfile([...good.slice(0, 2), { r50: 0, resistivity: 3 }, { r50: NaN, resistivity: 3 }]).status).toBe('insufficient');
  });

  it('pico aislado en AT10 (≈ 110 ohm·m sobre ≈ 1): no se filtra y el misfit lo delata', () => {
    const clean = reads(40, 3, 1, [10, 30, 60, 90]);
    const cleanFit = invertStepProfile(clean);
    expect(cleanFit.misfit).toBeLessThan(1e-4);
    const spiked = clean.map((x, k) => (k === 0 ? { ...x, resistivity: 110 } : x));
    const fit = invertStepProfile(spiked);
    expect(fit.status).toBe('ok');
    expect(fit.misfit).toBeGreaterThan(0.15); // umbral por defecto del módulo
    expect(fit.misfit).toBeGreaterThan(100 * cleanFit.misfit);
    // Con 4 curvas y un pico queda 1 grado de libertad: Rt de esa muestra NO es confiable (en la prueba se desvía
    // 30-60 %); por eso el misfit alto es la señal para descartarla. Sigue siendo un valor físico (finito, > 0).
    expect(fit.rt).toBeGreaterThan(0);
    expect(Number.isFinite(fit.rt)).toBe(true);
  });

  it('el ri óptimo en una cota se informa (invasión somera por debajo del trépano: atBound = min)', () => {
    // Solo AT10 se aparta de las demás un 15 %: el mejor ajuste es la invasión mínima
    const r: InvasionReading[] = [
      { r50: 10, resistivity: 1.15 },
      { r50: 30, resistivity: 1.0 },
      { r50: 60, resistivity: 1.0 },
      { r50: 90, resistivity: 1.0 },
    ];
    const fit = invertStepProfile(r);
    expect(fit.status).toBe('ok');
    expect(fit.atBound).toBe('min');
    expect(fit.di).toBeCloseTo(8.5, 2);
  });
});

describe('inversión: contra una búsqueda exhaustiva independiente', () => {
  /**
   * Búsqueda exhaustiva en (ri, σxo, σt) con el mismo objetivo (residuo relativo con piso del 5 % de σmax), escrita
   * acá sin reutilizar el motor: la inversión no puede quedar peor que el mínimo de la grilla.
   */
  function bruteForceSsr(r: InvasionReading[]): number {
    const sigma = r.map((x) => 1 / x.resistivity);
    const sMax = Math.max(...sigma);
    const w = sigma.map((s) => 1 / Math.max(s, 0.05 * sMax));
    let best = Infinity;
    for (let i = 0; i < 160; i++) {
      const ri = 4.25 * Math.pow(150 / 4.25, i / 159);
      const J = r.map((x) => 1 / (1 + Math.pow(x.r50 / ri, 1.5)));
      for (let a = -3; a <= 1; a += 0.04) {
        const sa = Math.pow(10, a);
        for (let b = -3; b <= 1; b += 0.04) {
          const sb = Math.pow(10, b);
          let ssr = 0;
          for (let k = 0; k < r.length; k++) ssr += (w[k]! * (J[k]! * sa + (1 - J[k]!) * sb - sigma[k]!)) ** 2;
          if (ssr < best) best = ssr;
        }
      }
    }
    return best;
  }

  it('con lecturas ruidosas e incoherentes el objetivo de la inversión es ≤ el mínimo de la grilla', () => {
    const samples: number[][] = [
      [3.1, 2.4, 2.0, 1.4, 1.2],
      [0.8, 0.9, 1.1, 1.0, 1.3],
      [12, 7, 6.5, 3, 2.9],
      [1.5, 1.52, 1.4, 1.1, 1.0],
      [5, 2, 4, 1.5, 2.5], // zig-zag: no es un perfil escalonado
    ];
    for (const s of samples) {
      const r = s.map((v, k) => ({ r50: R50[k]!, resistivity: v }));
      const fit = invertStepProfile(r);
      expect(fit.status).toBe('ok');
      const ssrFit = fit.misfit * fit.misfit * r.length;
      const ssrBrute = bruteForceSsr(r);
      expect(ssrFit).toBeLessThanOrEqual(ssrBrute * (1 + 1e-9) + 1e-12);
    }
  });
});

describe('invertStepProfileInto', () => {
  const n = 8;
  it('escribe solo el tramo [start, end), cuenta los casos y no toca el resto', () => {
    const cols = [0, 1, 2, 3].map(() => new Float64Array(n));
    const put = (i: number, vals: number[]) => vals.forEach((v, k) => (cols[k]![i] = v));
    const resist = forwardStepProfile(40, 20, 2, [10, 30, 60, 90]);
    const cond = forwardStepProfile(60, 0.5, 5, [10, 30, 60, 90]);
    put(0, [...resist]);
    put(1, [...cond]);
    put(2, [2.02, 2.01, 2.0, 2.0]); // sin invasión
    put(3, [NaN, NaN, 1, 1]); // 2 curvas válidas
    put(4, [...resist]);
    put(5, [110, resist[1]!, resist[2]!, resist[3]!]); // pico en AT10
    put(6, [...resist]);
    put(7, [...resist]);
    const out = { rxo: new Float64Array(n).fill(-7), rt: new Float64Array(n).fill(-7), di: new Float64Array(n).fill(-7), misfit: new Float64Array(n).fill(-7) };
    const curves = [10, 30, 60, 90].map((r50, k) => ({ r50, data: cols[k]! }));
    const counts = invertStepProfileInto(curves, out, {}, 0.15, 1, 7);
    expect(counts).toMatchObject({ ok: 4, noInvasion: 1, insufficient: 1, highMisfit: 1 });
    // fuera del tramo: intacto
    for (const key of ['rxo', 'rt', 'di', 'misfit'] as const) {
      expect(out[key][0]).toBe(-7);
      expect(out[key][7]).toBe(-7);
    }
    expect(relErr(out.rxo[1]!, 0.5)).toBeLessThan(1e-3);
    expect(relErr(out.rt[1]!, 5)).toBeLessThan(1e-3);
    expect(relErr(out.di[1]!, 60)).toBeLessThan(1e-3);
    expect(out.rt[2]).toBe(2.0);
    expect(out.rxo[2]).toBeNaN();
    expect(out.di[2]).toBeNaN();
    expect(out.rt[3]).toBeNaN();
    expect(out.misfit[5]!).toBeGreaterThan(0.15);
    expect(out.misfit[4]!).toBeLessThan(1e-4);
  });

  it('las mismas curvas por defecto cubren todo el arreglo y las constantes de la herramienta son las de la AIT', () => {
    const cols = [10, 30, 60, 90].map((r50) => Float64Array.from([stepProfileReading(40, 20, 2, r50), stepProfileReading(40, 20, 2, r50)]));
    const out = { rxo: new Float64Array(2), rt: new Float64Array(2), di: new Float64Array(2), misfit: new Float64Array(2) };
    const c = invertStepProfileInto(cols.map((d, k) => ({ r50: [10, 30, 60, 90][k]!, data: d })), out);
    expect(c.ok).toBe(2);
    expect(ARRAY_INDUCTION_R50_IN).toEqual({ RA10: 10, RA20: 20, RA30: 30, RM: 60, RT: 90 });
  });
});

describe('perfil a una profundidad (vista)', () => {
  it('invasión: corte pozo / zona lavada / virgen, y el modelo directo reproduce las lecturas (error relativo ≈ 0)', () => {
    const p = invasionProfileAtDepth(reads(40, 20, 2, [30, 10, 90, 60]));
    expect(p.fit.status).toBe('ok');
    expect(p.holeRadius).toBe(4.25);
    expect(p.readings.map((r) => r.r50)).toEqual([10, 30, 60, 90]); // ordenadas
    for (const r of p.readings) {
      expect(r.modelled).toBeCloseTo(r.observed, 3);
      expect(Math.abs(r.relativeError)).toBeLessThan(1e-3);
    }
    expect(p.segments.map((s) => s.kind)).toEqual(['borehole', 'flushed', 'virgin']);
    expect(p.segments[0]).toMatchObject({ from: 0, to: 4.25 });
    expect(p.segments[1]!.from).toBe(4.25);
    expect(p.segments[1]!.to).toBeCloseTo(20, 1); // ri = di/2
    expect(relErr(p.segments[1]!.resistivity, 20)).toBeLessThan(1e-3);
    expect(p.segments[2]!.from).toBe(p.segments[1]!.to);
    expect(p.segments[2]!.to).toBe(Infinity);
    expect(relErr(p.segments[2]!.resistivity, 2)).toBeLessThan(1e-3);
  });

  it('sin invasión: pozo + formación virgen con Rt; sin datos suficientes: solo el pozo y lecturas sin modelo', () => {
    const none = invasionProfileAtDepth([
      { r50: 10, resistivity: 1.01 },
      { r50: 30, resistivity: 1.0 },
      { r50: 90, resistivity: 1.0 },
    ]);
    expect(none.fit.status).toBe('no-invasion');
    expect(none.segments.map((s) => s.kind)).toEqual(['borehole', 'virgin']);
    expect(none.segments[1]).toMatchObject({ from: 4.25, resistivity: 1.0 });
    expect(none.readings.every((r) => Number.isNaN(r.modelled))).toBe(true);
    const few = invasionProfileAtDepth([{ r50: 90, resistivity: 3 }, { r50: 10, resistivity: NaN }]);
    expect(few.fit.status).toBe('insufficient');
    expect(few.segments.map((s) => s.kind)).toEqual(['borehole']);
    expect(few.readings).toHaveLength(1);
  });

  it('el trépano de las opciones fija el borde del pozo', () => {
    expect(invasionProfileAtDepth(reads(40, 20, 2), { bitSize: 12.25 }).segments[0]).toMatchObject({ to: 6.125 });
  });
});
