import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_PC_CLASSES,
  FZI_PERM_CONSTANT,
  LEVERETT_J_FIELD,
  PITTMAN_COEFFICIENTS,
  PITTMAN_PERCENTILES,
  PORT_CLASSES,
  RQI_CONSTANT,
  autoFlowUnits,
  brooksCoreyCurve,
  brooksCoreyPc,
  brooksCoreySw,
  classifyByBounds,
  classifyByBoundsInto,
  describeFlowUnits,
  flowZoneIndex,
  flowZoneIndexInto,
  fziPermCurve,
  leverettJ,
  leverettJSI,
  leverettPcFromJ,
  leverettPcFromJSI,
  normalizedPorosity,
  permFromFzi,
  pittmanPermForRadius,
  pittmanRadius,
  portClassIndex,
  portClassIndexInto,
  reservoirQualityIndex,
  rqiFromFzi,
  throatSizeDistribution,
  washburnPressure,
  washburnRadius,
  winlandPermForR35,
  winlandR35,
  winlandR35Into,
} from '../src/petro/rockTyping';

// Valores esperados: ecuaciones publicadas (Kolodzie 1980, Pittman 1992, Amaefule et al. 1993, Leverett 1941, Washburn
// 1921) evaluadas con Python independiente (python3 -I, sin importar el repo) o a mano. Ningún caso proviene de un
// dato de pozo: "verificado a mano, no de libro" salvo donde se cita la fuente.

describe('petro/rockTyping: Winland R35', () => {
  it('k = 100 mD, φ = 20 % → R35 = 6,0801 µm (log R35 = 0,732 + 1,176 − 0,864·log 20)', () => {
    expect(winlandR35(0.2, 100)).toBeCloseTo(6.080091061473722, 9);
  });

  it('k = 1 mD, φ = 10 % → 0,7379 µm (10^(0,732 − 0,864)); k = 10 mD, φ = 15 % → 2,0131 µm', () => {
    expect(winlandR35(0.1, 1)).toBeCloseTo(0.737904230129101, 9);
    expect(winlandR35(0.15, 10)).toBeCloseTo(2.0130620060697617, 9);
  });

  it('φ en v/v: 0,2 equivale a 20 % en la ecuación; φ en % por error (20) → NaN', () => {
    expect(winlandR35(0.2, 100)).toBeCloseTo(Math.pow(10, 0.732 + 0.588 * 2 - 0.864 * Math.log10(20)), 12);
    expect(Number.isNaN(winlandR35(20, 100))).toBe(true);
  });

  it('isolínea: k para R35 = 2 µm y φ = 15 % es 9,8899 mD y reproduce R35 = 2 (ida y vuelta)', () => {
    const k = winlandPermForR35(2, 0.15);
    expect(k).toBeCloseTo(9.889900236094585, 9);
    expect(winlandR35(0.15, k)).toBeCloseTo(2, 12);
  });

  it('guardas: k ≤ 0, φ ∉ (0,1), NaN → NaN', () => {
    expect(Number.isNaN(winlandR35(0.2, 0))).toBe(true);
    expect(Number.isNaN(winlandR35(0.2, -5))).toBe(true);
    expect(Number.isNaN(winlandR35(0, 10))).toBe(true);
    expect(Number.isNaN(winlandR35(NaN, 10))).toBe(true);
    expect(Number.isNaN(winlandPermForR35(0, 0.2))).toBe(true);
    expect(Number.isNaN(winlandPermForR35(2, 1.2))).toBe(true);
  });

  it('Into escribe el tramo y deja NaN donde falta dato', () => {
    const out = new Float64Array(3).fill(-1);
    winlandR35Into([0.2, 0.2, 0.1], [100, NaN, 1], out, 0, 3);
    expect(out[0]).toBeCloseTo(6.080091061473722, 9);
    expect(Number.isNaN(out[1]!)).toBe(true);
    expect(out[2]).toBeCloseTo(0.737904230129101, 9);
  });
});

describe('petro/rockTyping: clases de tamaño de garganta (Martin et al., 1997)', () => {
  it('nano < 0,1; micro 0,1–0,5; meso 0,5–2; macro 2–10; mega > 10 µm, con límites en la clase inferior', () => {
    expect(PORT_CLASSES.map((c) => c.id)).toEqual(['nano', 'micro', 'meso', 'macro', 'mega']);
    expect(portClassIndex(0.05)).toBe(0);
    expect(portClassIndex(0.1)).toBe(0);
    expect(portClassIndex(0.3)).toBe(1);
    expect(portClassIndex(0.5)).toBe(1);
    expect(portClassIndex(1)).toBe(2);
    expect(portClassIndex(2)).toBe(2);
    expect(portClassIndex(6)).toBe(3);
    expect(portClassIndex(10)).toBe(3);
    expect(portClassIndex(10.0001)).toBe(4);
    expect(portClassIndex(500)).toBe(4);
  });

  it('radio no positivo o no finito → −1 (escalar) y NaN (Into)', () => {
    expect(portClassIndex(0)).toBe(-1);
    expect(portClassIndex(NaN)).toBe(-1);
    expect(portClassIndex(Infinity)).toBe(-1);
    const out = new Float64Array(3);
    portClassIndexInto([1, NaN, 20], out);
    expect(out[0]).toBe(2);
    expect(Number.isNaN(out[1]!)).toBe(true);
    expect(out[2]).toBe(4);
  });
});

describe('petro/rockTyping: Pittman (1992)', () => {
  it('trae R10…R75 cada 5 %, con los coeficientes de R25, R35 y R50 de la tabla', () => {
    expect(PITTMAN_PERCENTILES).toEqual([10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75]);
    expect(PITTMAN_COEFFICIENTS[25]).toEqual({ a: 0.204, b: 0.531, c: -0.35 });
    expect(PITTMAN_COEFFICIENTS[35]).toEqual({ a: 0.255, b: 0.565, c: -0.523 });
    expect(PITTMAN_COEFFICIENTS[50]).toEqual({ a: 0.778, b: 0.626, c: -1.205 });
  });

  it('k = 100 mD, φ = 20 %: R10 = 9,0804; R25 = 6,4661; R35 = 5,0648; R50 = 2,8991; R75 = 0,4803 µm (Python)', () => {
    expect(pittmanRadius(10, 0.2, 100)).toBeCloseTo(9.080368044800048, 8);
    expect(pittmanRadius(25, 0.2, 100)).toBeCloseTo(6.466056595098051, 8);
    expect(pittmanRadius(35, 0.2, 100)).toBeCloseTo(5.0647884749606105, 8);
    expect(pittmanRadius(50, 0.2, 100)).toBeCloseTo(2.8990710240677298, 8);
    expect(pittmanRadius(75, 0.2, 100)).toBeCloseTo(0.4802808066609032, 8);
  });

  it('propiedad estructural (detecta erratas): en pares (φ, k) típicos R decrece con el percentil y el cociente entre percentiles vecinos es suave (1–2,5)', () => {
    // Las regresiones son independientes por percentil, así que pueden cruzarse FUERA de su rango de calibración
    // (φ < 8 % con k incoherente); por eso se prueba sobre la tendencia usual k–φ de areniscas.
    for (const [phi, k] of [[0.1, 1], [0.12, 3], [0.15, 10], [0.18, 30], [0.2, 100], [0.25, 500], [0.3, 2000]] as const) {
      let prev = Infinity;
      for (const x of PITTMAN_PERCENTILES) {
        const r = pittmanRadius(x, phi, k);
        expect(r).toBeLessThan(prev);
        if (Number.isFinite(prev)) {
          expect(prev / r).toBeGreaterThan(1);
          expect(prev / r).toBeLessThan(2.5);
        }
        prev = r;
      }
    }
  });

  it('el R35 de Pittman es del mismo orden que el de Winland (±30 %) en el rango típico (k 1–1000 mD, φ 10–25 %)', () => {
    for (const [phi, k] of [[0.1, 1], [0.15, 10], [0.2, 100], [0.25, 1000]] as const) {
      const ratio = pittmanRadius(35, phi, k) / winlandR35(phi, k);
      expect(ratio).toBeGreaterThan(0.7);
      expect(ratio).toBeLessThan(1.3);
    }
  });

  it('isolínea ida y vuelta; percentil fuera de la tabla → NaN', () => {
    const k = pittmanPermForRadius(35, 2, 0.15);
    expect(pittmanRadius(35, 0.15, k)).toBeCloseTo(2, 12);
    expect(Number.isNaN(pittmanRadius(33, 0.2, 100))).toBe(true);
    expect(Number.isNaN(pittmanPermForRadius(33, 2, 0.2))).toBe(true);
    expect(Number.isNaN(pittmanRadius(35, 0.2, 0))).toBe(true);
  });
});

describe('petro/rockTyping: RQI, FZI y unidades de flujo (Amaefule et al., 1993)', () => {
  it('constantes: RQI 0,0314 y 1/0,0314² = 1014,24 (√(1 mD en µm²) = 0,031414 redondeado)', () => {
    expect(RQI_CONSTANT).toBe(0.0314);
    expect(FZI_PERM_CONSTANT).toBeCloseTo(1014.2399285975091, 9);
    expect(Math.sqrt(9.869233e-4)).toBeCloseTo(0.0314, 4);
  });

  it('k = 100 mD, φ = 0,20 → RQI = 0,70213 µm, φz = 0,25, FZI = 2,80850 µm (a mano: 0,0314·√500/0,25)', () => {
    expect(reservoirQualityIndex(0.2, 100)).toBeCloseTo(0.702125344934934, 12);
    expect(normalizedPorosity(0.2)).toBeCloseTo(0.25, 12);
    expect(flowZoneIndex(0.2, 100)).toBeCloseTo(2.808501379739736, 12);
  });

  it('otros casos: (0,15; 10) → 1,452820; (0,10; 1) → 0,893659; (0,25; 500) → 4,212753 µm', () => {
    expect(flowZoneIndex(0.15, 10)).toBeCloseTo(1.4528195829974004, 10);
    expect(flowZoneIndex(0.1, 1)).toBeCloseTo(0.893659666763584, 10);
    expect(flowZoneIndex(0.25, 500)).toBeCloseTo(4.212752069609604, 10);
  });

  it('FZI = RQI/φz y, en el gráfico log RQI–log φz, RQI = FZI·φz es una recta de pendiente 1', () => {
    const fzi = flowZoneIndex(0.18, 40);
    expect(fzi).toBeCloseTo(reservoirQualityIndex(0.18, 40) / normalizedPorosity(0.18), 12);
    const a = rqiFromFzi(fzi, 0.05);
    const b = rqiFromFzi(fzi, 0.5);
    expect((Math.log10(b) - Math.log10(a)) / (Math.log10(0.5) - Math.log10(0.05))).toBeCloseTo(1, 12);
    expect(rqiFromFzi(fzi, 1)).toBeCloseTo(fzi, 12); // corta φz = 1 en RQI = FZI
  });

  it('k = 1014,2·FZI²·φ³/(1−φ)²: ida y vuelta exacta con FZI de (φ, k)', () => {
    for (const [phi, k] of [[0.2, 100], [0.15, 10], [0.1, 1], [0.05, 0.01], [0.3, 2000]] as const) {
      expect(permFromFzi(flowZoneIndex(phi, k), phi)).toBeCloseTo(k, 9);
    }
    // a mano con la constante redondeada: FZI = 1, φ = 0,2 → 1014 · 0,008 / 0,64 = 12,675
    expect((1014 * 0.008) / 0.64).toBeCloseTo(12.675, 9);
    expect(permFromFzi(1, 0.2)).toBeCloseTo(12.678, 2);
  });

  it('curva k(φ) de una clase: dos φ → k crece con φ y cada punto reproduce el FZI de la clase', () => {
    const c = fziPermCurve(2, 0.05, 0.3, 6);
    expect(c.phi.length).toBe(6);
    for (let i = 0; i < 6; i++) expect(flowZoneIndex(c.phi[i]!, c.k[i]!)).toBeCloseTo(2, 10);
    expect(c.k[5]!).toBeGreaterThan(c.k[0]!);
  });

  it('guardas: φ ∉ (0,1), k ≤ 0, NaN → NaN', () => {
    expect(Number.isNaN(flowZoneIndex(0, 10))).toBe(true);
    expect(Number.isNaN(flowZoneIndex(1, 10))).toBe(true);
    expect(Number.isNaN(flowZoneIndex(0.2, 0))).toBe(true);
    expect(Number.isNaN(flowZoneIndex(0.2, NaN))).toBe(true);
    expect(Number.isNaN(permFromFzi(0, 0.2))).toBe(true);
    expect(Number.isNaN(permFromFzi(1, 1))).toBe(true);
    expect(Number.isNaN(reservoirQualityIndex(NaN, 1))).toBe(true);
  });

  it('flowZoneIndexInto: por muestra, NaN en los faltantes, tramo [start, end)', () => {
    const out = new Float64Array(4).fill(-1);
    flowZoneIndexInto([0.2, NaN, 0.15, 0.1], [100, 5, 10, 1], out, 0, 3);
    expect(out[0]).toBeCloseTo(2.808501379739736, 12);
    expect(Number.isNaN(out[1]!)).toBe(true);
    expect(out[2]).toBeCloseTo(1.4528195829974004, 10);
    expect(out[3]).toBe(-1);
  });
});

describe('petro/rockTyping: clasificación por bandas y automática', () => {
  it('classifyByBounds: límites ascendentes, un valor igual al límite va a la clase superior, no finito → −1', () => {
    expect(classifyByBounds(0.5, [1, 3])).toBe(0);
    expect(classifyByBounds(1, [1, 3])).toBe(1);
    expect(classifyByBounds(2.9, [1, 3])).toBe(1);
    expect(classifyByBounds(3, [1, 3])).toBe(2);
    expect(classifyByBounds(100, [1, 3])).toBe(2);
    expect(classifyByBounds(5, [])).toBe(0);
    expect(classifyByBounds(NaN, [1, 3])).toBe(-1);
  });

  it('classifyByBoundsInto ordena los límites y escribe NaN donde no hay valor', () => {
    const out = new Float64Array(4);
    classifyByBoundsInto([0.5, 2, NaN, 7], out, [3, 1]);
    expect(Array.from(out.slice(0, 2))).toEqual([0, 1]);
    expect(Number.isNaN(out[2]!)).toBe(true);
    expect(out[3]).toBe(2);
  });

  it('describeFlowUnits con bandas del usuario: n, medias geométrica y aritmética, mín/máx por clase', () => {
    const fzi = [0.5, 0.8, 2, 4, 8, NaN, -1];
    const r = describeFlowUnits(fzi, [1, 3]);
    expect(r.bounds).toEqual([1, 3]);
    expect(Array.from(r.labels)).toEqual([0, 0, 1, 2, 2, -1, -1]);
    expect(r.classes.map((c) => c.n)).toEqual([2, 1, 2]);
    expect(r.classes[0]!.fziMean).toBeCloseTo(Math.sqrt(0.5 * 0.8), 12);
    expect(r.classes[0]!.fziArithmeticMean).toBeCloseTo(0.65, 12);
    expect(r.classes[2]!.fziMean).toBeCloseTo(Math.sqrt(32), 12);
    expect(r.classes[1]!.fziMin).toBe(2);
    expect(r.classes[0]!.lower).toBe(-Infinity);
    expect(r.classes[2]!.upper).toBe(Infinity);
    expect(r.classes[1]!.lower).toBe(1);
    expect(r.classes[1]!.upper).toBe(3);
  });

  it('una clase vacía queda con n = 0 y medias NaN', () => {
    const r = describeFlowUnits([0.5, 8], [1, 3]);
    expect(r.classes[1]!.n).toBe(0);
    expect(Number.isNaN(r.classes[1]!.fziMean)).toBe(true);
  });

  const clusters = [1, 1.1, 1.2, 4, 4.2, 4.4, 16, 17, 18];

  it('tres nubes bien separadas en log FZI: k = 3 corta en las brechas (punto medio geométrico) y reparte 3/3/3', () => {
    const r = autoFlowUnits(clusters, 3)!;
    expect(r.classes.length).toBe(3);
    expect(r.bounds[0]!).toBeCloseTo(Math.sqrt(1.2 * 4), 10); // 2,190890
    expect(r.bounds[1]!).toBeCloseTo(Math.sqrt(4.4 * 16), 10); // 8,390471
    expect(r.classes.map((c) => c.n)).toEqual([3, 3, 3]);
    expect(r.classes[0]!.fziMean).toBeCloseTo(Math.cbrt(1 * 1.1 * 1.2), 10);
    expect(r.classes[1]!.fziMean).toBeCloseTo(Math.cbrt(4 * 4.2 * 4.4), 10);
    expect(r.classes[2]!.fziMean).toBeCloseTo(Math.cbrt(16 * 17 * 18), 10);
    expect(Array.from(r.labels)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect(r.gvf).toBeGreaterThan(0.99);
  });

  it('coincide con la búsqueda exhaustiva de la partición de mínima suma de cuadrados en log FZI (k = 2, 3, 4)', () => {
    const data = [0.12, 0.2, 0.31, 0.35, 0.9, 1.1, 1.3, 1.6, 2.7, 3.1, 5.5, 6.2, 6.4, 11, 25];
    const x = data.map(Math.log10).sort((a, b) => a - b);
    const ssw = (lo: number, hi: number) => {
      let m = 0;
      for (let i = lo; i < hi; i++) m += x[i]!;
      m /= hi - lo;
      let s = 0;
      for (let i = lo; i < hi; i++) s += (x[i]! - m) ** 2;
      return s;
    };
    const best = (k: number): number[] => {
      // todas las combinaciones de k−1 cortes (índice de inicio de cada clase ≥ 1)
      let bestCost = Infinity;
      let bestCuts: number[] = [];
      const rec = (cuts: number[], from: number) => {
        if (cuts.length === k - 1) {
          const edges = [0, ...cuts, x.length];
          let c = 0;
          for (let i = 0; i < edges.length - 1; i++) c += ssw(edges[i]!, edges[i + 1]!);
          if (c < bestCost) {
            bestCost = c;
            bestCuts = cuts.slice();
          }
          return;
        }
        for (let s = from; s < x.length; s++) rec([...cuts, s], s + 1);
      };
      rec([], 1);
      return bestCuts.map((s) => Math.pow(10, (x[s - 1]! + x[s]!) / 2));
    };
    for (const k of [2, 3, 4]) {
      const expected = best(k);
      const r = autoFlowUnits(data, k)!;
      expect(r.bounds.length).toBe(k - 1);
      r.bounds.forEach((b, i) => expect(b).toBeCloseTo(expected[i]!, 10));
    }
  });

  it('determinista (misma entrada, mismo resultado) e independiente del orden de las muestras', () => {
    const a = autoFlowUnits(clusters, 3)!;
    const b = autoFlowUnits(clusters.slice().reverse(), 3)!;
    expect(b.bounds).toEqual(a.bounds);
    expect(autoFlowUnits(clusters, 3)!.bounds).toEqual(a.bounds);
  });

  it('valores casi iguales (a 1–2 ulp): ninguna clase vacía y cada etiqueta respeta el orden (regresión de revisión)', () => {
    // Antes el límite se reconstruía como 10^(punto medio en log10) y por redondeo caía sobre el valor inferior:
    // con base 0,37 la clase 0 quedaba vacía y con 3,3 la del medio.
    for (const base of [1.2, 0.37, 3.3, 0.0123]) {
      const a = base;
      const b = base * (1 + 2 ** -52);
      const c = base * (1 + 2 ** -51);
      for (const arr of [[a, a, b, b], [a, b, c]]) {
        const r = autoFlowUnits(arr, 3)!;
        for (const cl of r.classes) expect(cl.n).toBeGreaterThan(0);
        for (let i = 1; i < arr.length; i++) expect(r.labels[i]!).toBeGreaterThanOrEqual(r.labels[i - 1]!);
        r.bounds.forEach((bd, i) => {
          expect(bd).toBeGreaterThan(r.classes[i]!.fziMax);
          expect(bd).toBeLessThanOrEqual(r.classes[i + 1]!.fziMin);
        });
      }
    }
  });

  it('casos límite: k = 1 sin límites; más clases que valores distintos se reduce; vacío → null; ignora NaN y ≤ 0', () => {
    const one = autoFlowUnits(clusters, 1)!;
    expect(one.bounds).toEqual([]);
    expect(one.classes.length).toBe(1);
    const few = autoFlowUnits([1, 1, 2, 2], 5)!;
    expect(few.classes.length).toBe(2); // 2 valores distintos
    expect(few.bounds[0]!).toBeCloseTo(Math.sqrt(2), 12);
    expect(Array.from(few.labels)).toEqual([0, 0, 1, 1]);
    expect(autoFlowUnits([], 3)).toBeNull();
    expect(autoFlowUnits([NaN, -1, 0], 3)).toBeNull();
    expect(autoFlowUnits(clusters, 0)).toBeNull();
    const mixed = autoFlowUnits([1, NaN, 4, 0, 16], 3)!;
    expect(Array.from(mixed.labels)).toEqual([0, -1, 1, -1, 2]);
  });
});

describe('petro/rockTyping: función J de Leverett', () => {
  it('la constante de campo es 0,2166: 68 947,57 dyn/cm² por psi × √(9,869233·10⁻¹² cm² por mD)', () => {
    expect(LEVERETT_J_FIELD).toBeCloseTo(0.2166, 4);
    expect(LEVERETT_J_FIELD).toBeCloseTo(0.21660111304834578, 12);
  });

  it('Pc = 100 psi, k = 100 mD, φ = 0,2, mercurio–aire (σ = 480, θ = 140°) → J = 1,31720', () => {
    // J = 0,2166·100·√500 / (480·|cos 140°|) = 1,3172 (Python)
    expect(leverettJ(100, 100, 0.2, 480, 140)).toBeCloseTo(1.3171962397459795, 9);
    expect(0.2166 * 100 * Math.sqrt(500) / (480 * Math.abs(Math.cos((140 * Math.PI) / 180)))).toBeCloseTo(1.31719, 4);
  });

  it('la variante SI da la misma J (Pa, m², N/m): 100 psi = 689 475,7 Pa; 100 mD = 9,869233·10⁻¹⁴ m²; 480 dyn/cm = 0,48 N/m', () => {
    const j = leverettJSI(100 * 6894.757293, 100 * 9.869233e-16, 0.2, 0.48, 140);
    expect(j).toBeCloseTo(1.3171962397459793, 9);
    expect(j).toBeCloseTo(leverettJ(100, 100, 0.2, 480, 140), 8);
  });

  it('Pc desde J es la inversa (campo y SI)', () => {
    const j = leverettJ(37.5, 12, 0.17, 480, 140);
    expect(leverettPcFromJ(j, 12, 0.17, 480, 140)).toBeCloseTo(37.5, 10);
    const jSI = leverettJSI(2.5e5, 1e-14, 0.17, 0.05, 30);
    expect(leverettPcFromJSI(jSI, 1e-14, 0.17, 0.05, 30)).toBeCloseTo(2.5e5, 4);
  });

  it('escalado lab → reservorio con la misma J: Pc_res = Pc_lab·(σ|cosθ|)_res/(σ|cosθ|)_lab (misma roca)', () => {
    const pcLab = 100;
    const j = leverettJ(pcLab, 100, 0.2, 480, 140);
    const pcRes = leverettPcFromJ(j, 100, 0.2, 30, 0); // petróleo–agua: σ = 30 dyn/cm, θ = 0°
    expect(pcRes).toBeCloseTo((pcLab * 30) / (480 * Math.abs(Math.cos((140 * Math.PI) / 180))), 9);
  });

  it('guardas: k ≤ 0, φ ∉ (0,1], σ ≤ 0, cosθ = 0, Pc < 0 o NaN → NaN', () => {
    expect(Number.isNaN(leverettJ(100, 0, 0.2, 480, 140))).toBe(true);
    expect(Number.isNaN(leverettJ(100, 10, 0, 480, 140))).toBe(true);
    expect(Number.isNaN(leverettJ(100, 10, 1.2, 480, 140))).toBe(true);
    expect(Number.isNaN(leverettJ(100, 10, 0.2, 0, 140))).toBe(true);
    expect(Number.isNaN(leverettJ(100, 10, 0.2, 480, 90))).toBe(true);
    expect(Number.isNaN(leverettJ(-1, 10, 0.2, 480, 140))).toBe(true);
    expect(Number.isNaN(leverettJ(NaN, 10, 0.2, 480, 140))).toBe(true);
    expect(leverettJ(0, 10, 0.2, 480, 140)).toBe(0);
  });
});

describe('petro/rockTyping: Brooks–Corey y curvas de EJEMPLO DE LIBRO', () => {
  it('Pc(Sw* = 1) = Pd; con λ = 2 y Sw* = 0,5: Pc = Pd·√2 (Brooks y Corey, 1964); Sw = Swirr → ∞', () => {
    expect(brooksCoreyPc(1, 15, 2, 0.2)).toBe(15);
    expect(brooksCoreyPc(0.6, 15, 2, 0.2)).toBeCloseTo(15 * Math.SQRT2, 12); // Sw* = (0,6 − 0,2)/0,8 = 0,5
    expect(brooksCoreyPc(0.2, 15, 2, 0.2)).toBe(Infinity);
  });

  it('inversa: Sw(Pc) y Sw = 1 bajo la presión de desplazamiento', () => {
    expect(brooksCoreySw(15 * Math.SQRT2, 15, 2, 0.2)).toBeCloseTo(0.6, 12);
    expect(brooksCoreySw(10, 15, 2, 0.2)).toBe(1);
    expect(brooksCoreySw(Infinity, 15, 2, 0.2)).toBe(0.2);
  });

  it('guardas: Sw fuera de [Swirr, 1] o parámetros no positivos → NaN', () => {
    expect(Number.isNaN(brooksCoreyPc(0.1, 15, 2, 0.2))).toBe(true);
    expect(Number.isNaN(brooksCoreyPc(1.1, 15, 2, 0.2))).toBe(true);
    expect(Number.isNaN(brooksCoreyPc(0.5, 0, 2, 0.2))).toBe(true);
    expect(Number.isNaN(brooksCoreyPc(0.5, 15, 0, 0.2))).toBe(true);
    expect(Number.isNaN(brooksCoreySw(NaN, 15, 2, 0.2))).toBe(true);
  });

  it('brooksCoreyCurve: Sw decrece de 1 a Swirr + (1 − Swirr)·0,05; Pc crece desde Pd', () => {
    const c = brooksCoreyCurve(15, 2, 0.2, 10, 0.05);
    expect(c.sw[0]).toBe(1);
    expect(c.sw[9]).toBeCloseTo(0.2 + 0.8 * 0.05, 12);
    expect(c.pc[0]).toBe(15);
    for (let i = 1; i < 10; i++) {
      expect(c.sw[i]!).toBeLessThan(c.sw[i - 1]!);
      expect(c.pc[i]!).toBeGreaterThan(c.pc[i - 1]!);
    }
  });

  it('el conjunto de ejemplo está marcado como ejemplo de libro, ordenado por calidad, con Pd de Leverett (Jd = 0,2)', () => {
    expect(EXAMPLE_PC_CLASSES.length).toBe(5);
    expect(EXAMPLE_PC_CLASSES.every((c) => c.bookExample === true)).toBe(true);
    // Pd (psi, Hg–aire) = 0,2·367,70/(0,2166·√(k/φ)) (Python): 5,368; 15,184; 41,582; 107,365; 262,991
    const pd = [5.368272090747182, 15.183766394487268, 41.58245681074781, 107.36544181494364, 262.9905484550885];
    EXAMPLE_PC_CLASSES.forEach((c, i) => expect(c.pd).toBeCloseTo(pd[i]!, 6));
    // menor calidad (k/φ menor) → mayor Pd, menor λ, mayor Swirr
    for (let i = 1; i < 5; i++) {
      expect(EXAMPLE_PC_CLASSES[i]!.pd).toBeGreaterThan(EXAMPLE_PC_CLASSES[i - 1]!.pd);
      expect(EXAMPLE_PC_CLASSES[i]!.lambda).toBeLessThan(EXAMPLE_PC_CLASSES[i - 1]!.lambda);
      expect(EXAMPLE_PC_CLASSES[i]!.swirr).toBeGreaterThan(EXAMPLE_PC_CLASSES[i - 1]!.swirr);
    }
  });

  it('las cinco clases de ejemplo caen en clases de garganta de Winland decrecientes (mega → micro)', () => {
    const idx = EXAMPLE_PC_CLASSES.map((c) => portClassIndex(winlandR35(c.phi, c.k)));
    expect(idx).toEqual([4, 3, 3, 2, 1]);
  });
});

describe('petro/rockTyping: Washburn y distribución de gargantas', () => {
  it('mercurio–aire (σ = 480 dyn/cm, θ = 140°): r = 106,661 µm / Pc[psi] (no 107,6)', () => {
    expect(washburnRadius(1)).toBeCloseTo(106.66113891214805, 9);
    expect(washburnRadius(10)).toBeCloseTo(10.666113891214804, 9);
    expect(washburnRadius(1000)).toBeCloseTo(0.10666113891214805, 11);
  });

  it('otros valores de uso (σ = 485, θ = 130°) → 90,43 µm·psi; Pc desde r es la inversa', () => {
    expect(washburnRadius(1, 485, 130)).toBeCloseTo(90.43160692965428, 9);
    expect(washburnPressure(washburnRadius(37, 480, 140), 480, 140)).toBeCloseTo(37, 10);
  });

  it('guardas: Pc ≤ 0, σ ≤ 0, NaN → NaN', () => {
    expect(Number.isNaN(washburnRadius(0))).toBe(true);
    expect(Number.isNaN(washburnRadius(-5))).toBe(true);
    expect(Number.isNaN(washburnRadius(10, 0))).toBe(true);
    expect(Number.isNaN(washburnRadius(NaN))).toBe(true);
    expect(Number.isNaN(washburnPressure(0))).toBe(true);
  });

  it('una década de presión (10 → 100 psi) con ΔSHg = 0,5: radio 3,373 µm (media geométrica), dS/dlog r = 0,5', () => {
    const d = throatSizeDistribution([10, 100], [0, 0.5]);
    expect(d.radius.length).toBe(1);
    expect(d.deltaS[0]).toBeCloseTo(0.5, 12);
    expect(d.radius[0]).toBeCloseTo(Math.sqrt(10.666113891214804 * 1.0666113891214804), 10);
    expect(d.dSdLogR[0]).toBeCloseTo(0.5, 10);
  });

  it('curva de ejemplo de Brooks–Corey: Σ ΔS = SHg final − SHg inicial y los radios decrecen al subir la presión', () => {
    const cls = EXAMPLE_PC_CLASSES[1]!;
    const c = brooksCoreyCurve(cls.pd, cls.lambda, cls.swirr, 40, 0.05);
    const sHg = Array.from(c.sw, (s) => 1 - s);
    const d = throatSizeDistribution(c.pc, sHg);
    let total = 0;
    for (const v of d.deltaS) total += v;
    expect(total).toBeCloseTo(sHg[39]! - sHg[0]!, 12);
    for (let i = 1; i < d.radius.length; i++) expect(d.radius[i]!).toBeLessThan(d.radius[i - 1]!);
    // el radio al inicio (Pc = Pd) es el mayor: 106,66/Pd
    expect(washburnRadius(cls.pd)).toBeCloseTo(106.66113891214805 / cls.pd, 8);
    expect(d.radius[0]!).toBeLessThan(washburnRadius(cls.pd));
  });

  it('descarta intervalos con presión no creciente, ΔSHg ≤ 0 o datos no finitos', () => {
    const d = throatSizeDistribution([10, 10, 20, NaN, 40, 80], [0, 0.1, 0.1, 0.3, 0.4, 0.6]);
    // intervalos: (10→10) no crece; (10→20) ΔS = 0; (20→NaN) y (NaN→40) no finitos; (40→80) ΔS = 0,2
    expect(d.radius.length).toBe(1);
    expect(d.deltaS[0]).toBeCloseTo(0.2, 12);
  });
});
