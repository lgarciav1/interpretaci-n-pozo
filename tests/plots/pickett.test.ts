/**
 * Pickett interactivo (fase 8b, docs/decisiones/0021, G): ajuste de la recta de agua a la zona acuífera contra casos
 * sintéticos con m y Rw conocidos (con ruido, hidrocarburo residual, rango de φ angosto, residuos autocorrelacionados,
 * temperatura por punto), un caso a mano y el pozo del TP (valores calculados aparte), valores propios por zona,
 * una recta por zona (arrastrar la de una zona escribe solo esa zona) y deshacer por gesto.
 */
import { describe, expect, it } from 'vitest';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import { emptyHistory, recordChange, undo } from '../../src/core/state/history';
import { addWell, createProject, setParam } from '../../src/core/state/project';
import { sanitizeCrossplot } from '../../src/core/plots';
import { archieRt } from '../../src/plots/crossplot/templates';
import { rwAtFormation, waterLineRt } from '../../src/plots/crossplot/drag';
import { fitWaterLine, WATER_FIT_DEFAULTS, ownPickettParams, ownValuesNotice, parseWaterHandle, pickettByZone, waterLineDragWrites, waterLineNudgeWrites, type WaterFit, type WaterLineUnit } from '../../src/plots/crossplot/pickett';
import { nudgeParam, plotParamValue, PLOT_PARAMS } from '../../src/plots/params';
import { emptyParamState } from '../../src/core/params';
import { percentile } from '../../src/petro/stats';
import { archieSw as engineArchieSw } from '../../src/petro/saturation';
import { arpsResistivityC } from '../../src/petro/temperature';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { Engine, toEngineWell } from '../../src/core/engine/engine';
import { emptyInterpretation } from '../../src/core/interpretation';
import { readWellFile } from '../../src/io';
import { registry } from '../../src/modules';
import { fitTrend } from '../../src/petro/regression';

/** Generador reproducible (Park–Miller) y normal por Box–Muller. */
function rng(seed: number) {
  let s = seed;
  const u = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return { u, n: () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
}

/** Zona acuífera sintética: Rt = a·Rw/φ^m · e^(σ·ε), φ uniforme en [φ0, φ1]; una fracción con hidrocarburo (Rt × k). */
function waterZone(o: { n: number; a: number; m: number; rw: number; phi: [number, number]; sigma: number; hcFrac?: number; hcFactor?: number; seed?: number }) {
  const r = rng(o.seed ?? 11);
  const phi = new Float64Array(o.n);
  const rt = new Float64Array(o.n);
  for (let i = 0; i < o.n; i++) {
    phi[i] = o.phi[0] + (o.phi[1] - o.phi[0]) * r.u();
    rt[i] = archieRt(phi[i]!, 1, { a: o.a, m: o.m, n: 2, rw: o.rw }) * Math.exp(o.sigma * r.n());
    if (o.hcFrac && r.u() < o.hcFrac) rt[i]! *= o.hcFactor ?? 6;
  }
  return { phi, rt, idx: Int32Array.from({ length: o.n }, (_, i) => i) };
}

/** Argumentos (rt, phi, idx) de una zona sintética. */
const zoneArgs = (z: ReturnType<typeof waterZone>) => [z.rt, z.phi, z.idx] as const;

const OPTS = { a: 1, mCurrent: 2, mRange: [1, 3.5] as [number, number] };
const ok = (f: WaterFit | { problem: string }): WaterFit => {
  if ('problem' in f) throw new Error(f.problem);
  return f;
};

describe('ajuste de la recta de agua a la zona acuífera', () => {
  it('sin ruido recupera m y Rw exactos', () => {
    const z = waterZone({ n: 200, a: 1, m: 2.2, rw: 0.04, phi: [0.08, 0.3], sigma: 0 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, OPTS));
    expect(f.mode).toBe('m-rw');
    expect(f.m).toBeCloseTo(2.2, 10);
    expect(f.mOls).toBeCloseTo(2.2, 10);
    expect(f.mUpper).toBeCloseTo(2.2, 10); // R² = 1: las dos regresiones coinciden
    expect(f.rw).toBeCloseTo(0.04, 10);
    expect(f.r2).toBeCloseTo(1, 10);
    expect(f.spread).toBeCloseTo(0, 10);
  });

  it('con ruido (σ ln Rt = 0,08) y 15 % de muestras con hidrocarburo residual: m ± 0,05 y Rw ± 3 %', () => {
    const z = waterZone({ n: 400, a: 0.81, m: 1.85, rw: 0.032, phi: [0.1, 0.32], sigma: 0.08, hcFrac: 0.15, hcFactor: 8, seed: 5 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, { ...OPTS, a: 0.81 }));
    expect(f.mode).toBe('m-rw');
    expect(Math.abs(f.m - 1.85)).toBeLessThan(0.05);
    expect(Math.abs(f.rw / 0.032 - 1)).toBeLessThan(0.03);
    // El recorte sacó las de hidrocarburo de la regresión de m.
    expect(f.used).toBeLessThan(f.n);
    expect(f.used / f.n).toBeGreaterThan(0.75);
    // Sin recorte (mínimos cuadrados con todos) el hidrocarburo tuerce más la pendiente: el recorte sirve.
    const ols = fitTrend(z.phi, z.rt, 'power')!;
    expect(Math.abs(-ols.b - 1.85)).toBeGreaterThan(Math.abs(f.m - 1.85));
    // La mediana de los retenidos sesga menos que la de todos los puntos (la de todos se corre hacia el hidrocarburo).
    const allMed = Math.exp(percentile(Array.from(z.idx, (i) => Math.log(z.rt[i]!) + f.m * Math.log(z.phi[i]!)), 0.5)) / 0.81;
    expect(Math.abs(f.rw / 0.032 - 1)).toBeLessThan(Math.abs(allMed / 0.032 - 1));
  });

  it('criterio de Rw: con los parámetros ajustados, la mediana de Sw del motor (archieSw de petro) en la zona es exactamente 1', () => {
    // Ruido acotado (uniforme ±0,05 en ln Rt): ningún punto cae a más de 3 desvíos robustos, así que la mediana es de todos.
    const n = 301;
    const r = rng(9);
    const phi = new Float64Array(n);
    const rt = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      phi[i] = 0.1 + 0.2 * r.u();
      rt[i] = archieRt(phi[i]!, 1, { a: 1, m: 2, n: 2, rw: 0.05 }) * Math.exp(0.1 * (r.u() - 0.5));
    }
    const idx = Int32Array.from({ length: n }, (_, i) => i);
    const f = ok(fitWaterLine(rt, phi, idx, OPTS));
    expect(f.mode).toBe('m-rw');
    expect(f.used).toBe(f.n);
    const sw = Array.from(idx, (i) => engineArchieSw(rt[i]!, phi[i]!, f.rw, 1, f.m, 2));
    expect(percentile(sw, 0.5)).toBeCloseTo(1, 10);
  });

  it('con la temperatura de cada punto (Arps del motor), Rw es la de referencia y la mediana de Sw del motor queda en 1', () => {
    // Rw de referencia 0,06 a 24 °C; la zona va de 100 a 112 °C: Rw(T) cambia ~9 % a lo largo de la zona.
    const n = 301;
    const r = rng(21);
    const phi = new Float64Array(n);
    const rt = new Float64Array(n);
    const temp = new Float64Array(n);
    const lnW = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      phi[i] = 0.1 + 0.2 * r.u();
      temp[i] = 100 + (12 * i) / (n - 1);
      const rwT = arpsResistivityC(0.06, 24, temp[i]!); // lo que calcula rw-manual por muestra
      rt[i] = archieRt(phi[i]!, 1, { a: 1, m: 2, n: 2, rw: rwT }) * Math.exp(0.04 * r.n());
      lnW[i] = Math.log(arpsResistivityC(1, 24, temp[i]!));
    }
    const idx = Int32Array.from({ length: n }, (_, i) => i);
    const f = ok(fitWaterLine(rt, phi, idx, { ...OPTS, lnRwFactor: lnW }));
    expect(f.mode).toBe('m-rw');
    expect(Math.abs(f.rw / 0.06 - 1)).toBeLessThan(0.02); // Rw de REFERENCIA, no de formación
    const sw = Array.from(idx, (i) => engineArchieSw(rt[i]!, phi[i]!, arpsResistivityC(f.rw, 24, temp[i]!), 1, f.m, 2));
    expect(percentile(sw, 0.5)).toBeCloseTo(1, 2);
    // Sin la temperatura por punto, la Rw sale a la temperatura mediana y no a la de referencia.
    const g = ok(fitWaterLine(rt, phi, idx, OPTS));
    expect(Math.abs(g.rw / 0.06 - 1)).toBeGreaterThan(0.5);
  });

  it('la Rw se calcula con la m ya redondeada al paso del parámetro', () => {
    const z = waterZone({ n: 201, a: 1, m: 2.234, rw: 0.04, phi: [0.08, 0.3], sigma: 0 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, { ...OPTS, normalizeM: (m) => Math.round(m * 100) / 100 }));
    expect(f.m).toBe(2.23);
    // Con m = 2,23 la mediana de Sw (m, Rw escritos) sigue en 1.
    const sw = Array.from(z.idx, (i) => engineArchieSw(z.rt[i]!, z.phi[i]!, f.rw, 1, f.m, 2));
    expect(percentile(sw, 0.5)).toBeCloseTo(1, 10);
  });

  it('caso a mano de 5 puntos (m vigente = 2): Rw = 0,04 por la mediana de Rt·φ²; con a = 0,5 es 0,08', () => {
    // Rt·φ² = 0,03; 0,04; 0,05; 0,04; 0,04 → mediana 0,04 (sin recorte: el MAD es 0).
    const phi = [0.1, 0.2, 0.2, 0.25, 0.3];
    const rt = [3, 1, 1.25, 0.64, 0.04 / 0.09];
    const idx = [0, 1, 2, 3, 4];
    const f = ok(fitWaterLine(rt, phi, idx, OPTS));
    expect(f.mode).toBe('rw');
    expect(f.used).toBe(5);
    expect(f.rw).toBeCloseTo(0.04, 12);
    expect(ok(fitWaterLine(rt, phi, idx, { ...OPTS, a: 0.5 })).rw).toBeCloseTo(0.08, 12);
    // Sw a mano del primer punto: √(0,04 / (0,1² · 3)) = 1,1547 (sin acotar)
    expect(Math.sqrt(0.04 / (0.1 ** 2 * 3))).toBeCloseTo(1.1547, 4);
  });

  it('con porosidades en un rango angosto conserva m y ajusta solo Rw (con el m vigente)', () => {
    const z = waterZone({ n: 200, a: 1, m: 2.2, rw: 0.04, phi: [0.19, 0.21], sigma: 0.05, seed: 3 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, { ...OPTS, mCurrent: 2.2 }));
    expect(f.mode).toBe('rw');
    expect(f.reason).toMatch(/angosto/);
    expect(f.m).toBe(2.2);
    expect(Math.abs(f.rw / 0.04 - 1)).toBeLessThan(0.02);
  });

  it('modo Rw con a ≠ 1 (Humble 0,62 / 2,15): Rw = exp(mediana) / a', () => {
    const z = waterZone({ n: 200, a: 0.62, m: 2.15, rw: 0.04, phi: [0.19, 0.21], sigma: 0.05, seed: 4 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, { ...OPTS, a: 0.62, mCurrent: 2.15 }));
    expect(f.mode).toBe('rw');
    expect(Math.abs(f.rw / 0.04 - 1)).toBeLessThan(0.02);
  });

  it('pocas muestras independientes: conserva m (también con 8 muestras sueltas); menos de 5: no ajusta', () => {
    const z = waterZone({ n: 8, a: 1, m: 2, rw: 0.04, phi: [0.08, 0.3], sigma: 0.02 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, OPTS));
    expect(f.mode).toBe('rw');
    expect(f.reason).toMatch(/independientes/);
    expect('problem' in fitWaterLine(z.rt, z.phi, [0, 1, 2], OPTS)).toBe(true);
  });

  it('muestras vecinas casi iguales (residuos autocorrelacionados): n_ef << n y se conserva m aunque haya 400 muestras', () => {
    // Residuo AR(1) con ρ = 0,998 (el TP tiene 0,98–0,99 a 0,15 m) sobre una tendencia suave de φ con rango amplio.
    const n = 400;
    const r = rng(33);
    const phi = new Float64Array(n);
    const rt = new Float64Array(n);
    let e = 0;
    for (let i = 0; i < n; i++) {
      phi[i] = 0.19 + 0.1 * Math.sin((2 * Math.PI * i) / 160) + 0.05 * Math.sin((2 * Math.PI * i) / 53);
      e = 0.998 * e + Math.sqrt(1 - 0.998 ** 2) * 0.3 * r.n();
      rt[i] = archieRt(phi[i]!, 1, { a: 1, m: 2, n: 2, rw: 0.04 }) * Math.exp(e);
    }
    const idx = Int32Array.from({ length: n }, (_, i) => i);
    // Umbral de n_ef en 20 (el de fábrica es 10): la tendencia suave absorbe parte de la correlación y deja n_ef ≈ 15.
    const f = ok(fitWaterLine(rt, phi, idx, { ...OPTS, minNeff: 20 }));
    expect(f.rho).toBeGreaterThan(0.9);
    expect(f.nEff).toBeLessThan(0.05 * n);
    expect(f.nEff / f.n).toBeCloseTo((1 - f.rho) / (1 + f.rho), 1); // n_ef = n·(1−ρ)/(1+ρ) (n: puntos de la regresión, tras el recorte)
    expect(f.mode).toBe('rw');
    expect(f.reason).toMatch(/independientes/);
  });

  it('error estándar de m (con n_ef) mayor que 0,12: se conserva m', () => {
    // 200 muestras sin correlación, rango de φ amplio, pero σ ln Rt = 1: SE = σ / (√n · sd ln φ) ≈ 0,19 > 0,12.
    const z = waterZone({ n: 200, a: 1, m: 2, rw: 0.04, phi: [0.08, 0.3], sigma: 1, seed: 17 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, OPTS));
    expect(f.nEff).toBeGreaterThan(100);
    expect(f.phiRatio).toBeGreaterThan(2);
    expect(f.reason).toMatch(/error estándar/);
    expect(f.mode).toBe('rw');
    // Con un umbral más laxo (opción) la misma zona se acepta.
    expect(ok(fitWaterLine(z.rt, z.phi, z.idx, { ...OPTS, maxMSe: 0.3 })).mode).toBe('m-rw');
  });

  it('espesor: con el paso de muestreo dado, menos de 5 m de puntos conserva m', () => {
    const z = waterZone({ n: 200, a: 1, m: 2, rw: 0.04, phi: [0.08, 0.3], sigma: 0.05, seed: 6 });
    const thin = ok(fitWaterLine(z.rt, z.phi, z.idx, { ...OPTS, sampleStep: 0.0152 })); // ~3 m
    expect(thin.mode).toBe('rw');
    expect(thin.reason).toMatch(/espesor/);
    expect(thin.thickness).toBeCloseTo(200 * 0.0152, 1);
    expect(ok(fitWaterLine(z.rt, z.phi, z.idx, { ...OPTS, sampleStep: 0.1524 })).mode).toBe('m-rw'); // ~30 m
  });

  it('m fuera del rango del parámetro: se conserva m', () => {
    const z = waterZone({ n: 200, a: 1, m: 4.2, rw: 0.04, phi: [0.08, 0.3], sigma: 0 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, OPTS));
    expect(f.mode).toBe('rw');
    expect(f.reason).toMatch(/fuera del rango/);
  });

  it('puntos con Rt o φ nulos, negativos, NaN o fuera de (0, 1) se ignoran', () => {
    const z = waterZone({ n: 100, a: 1, m: 2, rw: 0.04, phi: [0.08, 0.3], sigma: 0.02, seed: 8 });
    const rt = Array.from(z.rt);
    const phi = Array.from(z.phi);
    const clean = ok(fitWaterLine(rt, phi, z.idx, OPTS));
    const bad = [
      [NaN, 0.2],
      [-3, 0.2],
      [0, 0.2],
      [5, 0],
      [5, 1.2],
      [5, NaN],
      [Infinity, 0.2],
    ];
    for (const [r, f] of bad) {
      rt.push(r!);
      phi.push(f!);
    }
    const idx = Int32Array.from({ length: rt.length }, (_, i) => i);
    const f = ok(fitWaterLine(rt, phi, idx, OPTS));
    expect(f.n).toBe(100);
    expect(f.m).toBeCloseTo(clean.m, 12);
    expect(f.rw).toBeCloseTo(clean.rw, 12);
    // Todos inválidos: sin puntos.
    expect(fitWaterLine([NaN, -1, 0], [0.2, 0.2, 0.2], [0, 1, 2], OPTS)).toHaveProperty('problem');
  });

  it('m vigente errónea (2,0 con m real 2,3), rango angosto: Rw sale condicionada a esa m (≈ 50 % de más) y se conserva m', () => {
    const z = waterZone({ n: 300, a: 1, m: 2.3, rw: 0.03, phi: [0.17, 0.24], sigma: 0.05, seed: 12 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, { ...OPTS, mCurrent: 2 }));
    expect(f.mode).toBe('rw');
    expect(f.m).toBe(2);
    // Documentado en la cabecera de pickett.ts: la Rw es la ordenada en φ = 1 con la m dada; con m 0,3 menor, φ ≈ 0,2.
    expect(f.rw / 0.03).toBeGreaterThan(1.3);
    expect(f.rw / 0.03).toBeLessThan(1.8);
  });

  it('hidrocarburo con m conservada (la verdadera): Rw sube a lo sumo unos puntos (no baja); la media sería mucho peor', () => {
    const z = waterZone({ n: 300, a: 1, m: 2, rw: 0.03, phi: [0.17, 0.24], sigma: 0.1, seed: 14 });
    const base = ok(fitWaterLine(z.rt, z.phi, z.idx, OPTS));
    expect(base.mode).toBe('rw');
    // La misma zona con 1 de cada 3 muestras con hidrocarburo (Rt × 6).
    const rtHc = Float64Array.from(z.rt, (r, i) => (i % 3 === 0 ? r * 6 : r));
    const f = ok(fitWaterLine(rtHc, z.phi, z.idx, OPTS));
    expect(f.mode).toBe('rw');
    expect(f.rw / base.rw).toBeGreaterThan(0.98); // el hidrocarburo sube Rt: la Rw no baja (Sw sobreestimada, si algo)
    expect(f.rw / base.rw).toBeLessThan(1.15); // el recorte y la mediana la contienen
    // La media de ln Rt + m·ln φ (ordenada de mínimos cuadrados con m fija) sube ≈ 60 %.
    const mean = Math.exp(Array.from(z.idx, (i) => Math.log(rtHc[i]!) + 2 * Math.log(z.phi[i]!)).reduce((a, b) => a + b, 0) / 300);
    expect(mean / base.rw).toBeGreaterThan(1.4);
  });

  it('dispersión alta (zona que no se comporta como acuífera) se informa; una zona limpia no pasa del umbral', () => {
    const limpia = ok(fitWaterLine(...zoneArgs(waterZone({ n: 300, a: 1, m: 2, rw: 0.04, phi: [0.08, 0.3], sigma: 0.08, seed: 2 })), OPTS));
    expect(limpia.spread).toBeLessThan(WATER_FIT_DEFAULTS.maxSpread);
    const sucia = ok(fitWaterLine(...zoneArgs(waterZone({ n: 300, a: 1, m: 2, rw: 0.04, phi: [0.08, 0.3], sigma: 0.6, seed: 2 })), OPTS));
    expect(sucia.spread).toBeGreaterThan(WATER_FIT_DEFAULTS.maxSpread);
    expect(sucia.spread).toBeCloseTo(0.6, 0); // 1,4826·MAD de un ruido normal de σ = 0,6
  });
});

/** Pozo del TP completo con la cadena del motor: PHIE, VSH, TEMP y el Rt medido (AT90). */
describe('regresión con el pozo del TP (datos/pozo_tp_perfiles.csv)', () => {
  const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(toEngineWell(well));
  const r = engine.run(emptyInterpretation(zones));
  const col = (key: string): Float64Array => r.outputs.find((o) => o.key === key)!.value as Float64Array;
  const phie = col('phie-vsh:PHIE');
  const vsh = col('vsh:VSH');
  const temp = col('temp-gradient:TEMP');
  const rt = well.curves.find((c) => c.role === 'RT')!.data;
  const depth = well.depth.values;
  const step = (depth[depth.length - 1]! - depth[0]!) / (depth.length - 1);
  const lnW = Float64Array.from(temp, (t) => Math.log(arpsResistivityC(1, 24, t)));
  const fitZone = (name: string) => {
    const z = zones.find((zz) => zz.name === name)!;
    const idx = Array.from(depth, (_d, i) => i).filter((i) => depth[i]! >= z.top && depth[i]! <= z.base && vsh[i]! <= 0.4);
    return ok(fitWaterLine(rt, phie, idx, { a: 1, mCurrent: 2, mRange: [1, 3.5], sampleStep: step, lnRwFactor: lnW, normalizeM: (m) => Math.round(m * 100) / 100 }));
  };

  // Valores calculados de forma independiente (numpy, mismo criterio; scripts de la revisión): m por MCO, n_ef, Rw de
  // referencia a 24 °C con Rt normalizada por Arps y mediana de los puntos que quedan tras el recorte con m = 2.
  it('zona E (348 puntos limpios): no determina m; Rw de referencia 0,0676 ohm·m a 24 °C; dispersión ×1,6', () => {
    const f = fitZone('E');
    expect(f.n).toBe(348);
    expect(f.mode).toBe('rw');
    expect(f.reason).toMatch(/independientes/);
    expect(f.mOls).toBeCloseTo(0.0205, 3);
    expect(f.rho).toBeGreaterThan(0.97);
    expect(f.nEff).toBeCloseTo(2.69, 1);
    expect(f.rw).toBeCloseTo(0.06758, 4);
    expect(f.spread).toBeCloseTo(0.4726, 3);
    expect(f.spread).toBeGreaterThan(WATER_FIT_DEFAULTS.maxSpread); // se avisa: no se comporta como acuífera
  });

  it('zona D (936 puntos limpios, 143 m): m por MCO 0,47, ninguna zona determina m; Rw de referencia 0,0698', () => {
    const f = fitZone('D');
    expect(f.n).toBe(936);
    expect(f.mode).toBe('rw');
    expect(f.mOls).toBeCloseTo(0.4743, 3);
    expect(f.nEff).toBeCloseTo(4.7, 1);
    expect(f.rw).toBeCloseTo(0.06981, 4);
  });

  it('ninguna zona del TP determina m', () => {
    for (const z of ['A', 'B', 'C', 'D', 'E']) expect(fitZone(z).mode, `zona ${z}`).toBe('rw');
  });
});

describe('valores propios por zona y una recta por zona', () => {
  const params = emptyParamState();
  params.global[PLOT_PARAMS.rwRef.storage] = 0.05;
  params.zones['zc'] = { [PLOT_PARAMS.rwRef.storage]: 0.03, [PLOT_PARAMS.m.storage]: 1.9 };
  params.zones['zd'] = {};

  it('qué parámetros de la recta tiene propios cada zona', () => {
    expect(ownPickettParams(params, 'zc')).toEqual(['Rw', 'm']);
    expect(ownPickettParams(params, 'zd')).toEqual([]);
    expect(ownPickettParams(params, 'zx')).toEqual([]);
  });

  it('una recta por zona solo con dos o más zonas filtradas y alguna con valores propios', () => {
    expect(pickettByZone(['zc', 'zd'], params)).toBe(true);
    expect(pickettByZone(['zd', 'ze'], params)).toBe(false);
    expect(pickettByZone(['zc'], params)).toBe(false);
    expect(pickettByZone([], params)).toBe(false);
  });

  it('aviso del rótulo con alcance global: cuántas zonas visibles tienen valor propio', () => {
    const vis = [
      { id: 'zc', name: 'C' },
      { id: 'zd', name: 'D' },
    ];
    expect(ownValuesNotice(params, vis, ['Rw'])).toBe('la zona C tiene Rw propio: no cambia');
    expect(ownValuesNotice(params, vis, ['a'])).toBe('');
    const p2 = { ...params, zones: { ...params.zones, zd: { [PLOT_PARAMS.rwRef.storage]: 0.07 } } };
    expect(ownValuesNotice(p2, vis, ['Rw'])).toBe('2 zonas visibles (C, D) tienen Rw propio: no cambian');
  });

  it('ids de manijas: una recta o una por zona', () => {
    expect(parseWaterHandle('water-move')).toEqual({ which: 'move', key: '' });
    expect(parseWaterHandle('water-rotate:zc')).toEqual({ which: 'rotate', key: 'zc' });
    expect(parseWaterHandle('matrix')).toBeNull();
  });

  it('arrastrar la recta de una zona escribe solo esa zona; las otras y el global no cambian; un Ctrl+Z por gesto', () => {
    const demo = syntheticWell();
    const W = demo.well.id;
    const zc = demo.zones[2]!.id;
    const zd = demo.zones[3]!.id;
    let p = addWell(createProject('P'), demo.well, demo.zones);
    p = setParam(p, W, PLOT_PARAMS.rwRef.storage, 0.03, zc);
    const read = (pp: typeof p, z: string | null) => plotParamValue(pp.wells[0]!.interpretation.params, PLOT_PARAMS.rwRef, z);
    const u: WaterLineUnit = { a: 1, m: 2, rw: rwAtFormation(0.03, 24, 80, true), rwRef: 0.03, tRef: 24, tRep: 80, correct: true, manual: true, scope: { zoneId: zc, text: `zona ${demo.zones[2]!.name}` } };
    const before = p;
    let h = emptyHistory();
    // Tres movimientos del mismo gesto: la recta pasa por puntos con el doble de Rt (Rw de formación × 2).
    for (const f of [1.3, 1.7, 2]) {
      const pt = { rt: waterLineRt(0.2, u) * f, phi: 0.2 };
      const writes = waterLineDragWrites(u, 'move', pt);
      expect(writes).toHaveLength(1);
      expect(writes[0]!.zoneId).toBe(zc);
      const prev = p;
      p = writes.reduce((acc, w) => setParam(acc, W, w.storage, w.value, w.zoneId), p);
      h = recordChange(h, prev, 'Cambiar Rw', f * 5000, undefined, 'gesto-1');
    }
    expect(read(p, zc)).toBeCloseTo(0.06, 3); // Arps es una razón: el doble de Rw de formación = el doble de Rw de referencia
    expect(read(p, zd)).toBe(read(before, zd)); // la otra zona no cambia
    expect(read(p, null)).toBe(read(before, null)); // el global tampoco
    expect(h.past).toHaveLength(1);
    const back = undo(h, p)!;
    expect(back.project).toBe(before);
    // Rotar y flechas, en la misma zona.
    expect(waterLineDragWrites(u, 'rotate', { rt: waterLineRt(0.1, { ...u, m: 2.3 }), phi: 0.1 })[0]).toMatchObject({ storage: PLOT_PARAMS.m.storage, zoneId: zc, value: 2.3 });
    // Un paso del slider de Rw (escala log), en la zona de la recta.
    expect(waterLineNudgeWrites(u, 'move', 1, false)[0]).toMatchObject({ storage: PLOT_PARAMS.rwRef.storage, zoneId: zc, value: nudgeParam(PLOT_PARAMS.rwRef.spec, 0.03, 1) });
    expect(waterLineDragWrites({ ...u, manual: false }, 'move', { rt: 10, phi: 0.2 })).toEqual([]);
  });
});

describe('configuración guardada', () => {
  it('la zona acuífera viaja en display.plots y se valida al abrir', () => {
    expect(sanitizeCrossplot({ pickettWaterZones: ['ze', 'ze', 3, ''] }).pickettWaterZones).toEqual(['ze']);
    expect(sanitizeCrossplot({}).pickettWaterZones).toBeUndefined();
    expect('pickettWaterZones' in sanitizeCrossplot({ pickettWaterZones: 'x' })).toBe(false);
  });
});
