/**
 * Usos de las curvas MICP (src/petro/micp.ts): Thomeer, Swanson, Brooks–Corey, laboratorio → reservorio, krel y flujo
 * fraccional, cutoff de Sw y comparación con el CMR.
 * Referencias: cuentas a mano (comentadas en cada caso) y numpy/scipy sobre las 8 muestras del TP
 * (`scripts/qa/micp-usos-reference.py`, que no comparte código con el motor).
 */
import { describe, expect, it } from 'vitest';
import tpCsv from '../datos/pozo_tp_perfiles.csv?raw';
import { TP_MICP_SAMPLES } from '../src/modules/rock-typing/tpMicp';
import {
  cmrBviEquivalentHeights,
  DEFAULT_DELTA_RHO_OIL_WATER_GCC,
  densityFromGradientPsiPerFt,
  entryHeightM,
  fitBrooksCorey,
  fitThomeer,
  fractionalFlowWater,
  gradientPsiPerFtFromDensity,
  heightFromReservoirPc,
  krnwBrooksCorey,
  krwBrooksCorey,
  labPcFromHeight,
  labToReservoirFactor,
  reservoirPcFromHeight,
  summarizeCutoffs,
  swAtFractionalFlow,
  swAtHeightBrooksCorey,
  swAtHeightFromCurve,
  swansonApex,
  swansonPermeability,
  swansonPermeabilityFromCurve,
  SYSTEM_GAS_WATER,
  SYSTEM_HG_AIR,
  SYSTEM_OIL_WATER,
  thomeerBv,
  thomeerPermeability,
  type HeightContext,
  fitBrooksCorey as fitBrooksCoreyFixed,
  swAtCmrCalibration,
  swansonApex as swansonApexCheck,
} from '../src/petro/micp';
import { brooksCoreyPc, KGF_CM2_TO_PSI } from '../src/petro/rockTyping';

const ctxOil: HeightContext = { lab: SYSTEM_HG_AIR, reservoir: SYSTEM_OIL_WATER, deltaRhoGcc: DEFAULT_DELTA_RHO_OIL_WATER_GCC };
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('petro/micp: unidades y sistemas', () => {
  it('Δρ por defecto = 1,05 − 0,80 = 0,25 g/cm³', () => {
    expect(DEFAULT_DELTA_RHO_OIL_WATER_GCC).toBeCloseTo(0.25, 12);
  });

  it('gradiente ↔ densidad: 1 g/cm³ = 0,433528 psi/ft (agua dulce 0,433); zona B del TP 0,4121 psi/ft = 0,9506 g/cm³', () => {
    // 6894,757293 Pa/psi / 0,3048 m/ft = 22 620,6 Pa/m; / 9,80665 = 2306,66 kg/m³ por psi/ft.
    expect(gradientPsiPerFtFromDensity(1)).toBeCloseTo(0.4335275, 6);
    expect(densityFromGradientPsiPerFt(0.4335275040115905)).toBeCloseTo(1, 12);
    expect(densityFromGradientPsiPerFt(0.4121)).toBeCloseTo(0.95057, 4); // 0,4121·2,30666
    expect(densityFromGradientPsiPerFt(0.7313)).toBeCloseTo(1.68686, 4); // no es un fluido de reservorio físico
    expect(densityFromGradientPsiPerFt(0)).toBeNaN();
    expect(densityFromGradientPsiPerFt(-1)).toBeNaN();
  });

  it('factor de paso de laboratorio a reservorio: σ|cosθ| res/lab (a mano: 30·cos30° = 25,981; 480·|cos140°| = 367,70; 50·1 = 50)', () => {
    expect(labToReservoirFactor(SYSTEM_HG_AIR, SYSTEM_OIL_WATER)).toBeCloseTo(25.98076 / 367.7013, 5); // 0,070657
    expect(labToReservoirFactor(SYSTEM_HG_AIR, SYSTEM_GAS_WATER)).toBeCloseTo(50 / 367.7013, 5); // 0,135977
    expect(labToReservoirFactor(SYSTEM_HG_AIR, SYSTEM_HG_AIR)).toBeCloseTo(1, 12);
    expect(labToReservoirFactor(SYSTEM_HG_AIR, { id: 'x', label: 'x', sigmaDynPerCm: 30, thetaDeg: 90 })).toBeNaN();
    expect(labToReservoirFactor(SYSTEM_HG_AIR, { id: 'x', label: 'x', sigmaDynPerCm: -3, thetaDeg: 30 })).toBeNaN();
  });

  it('altura = Pc/(Δρ g): 1 psi con Δρ = 1 g/cm³ → 6894,757/(1000·9,80665) = 0,70307 m = 2,3067 ft; inversa exacta', () => {
    expect(heightFromReservoirPc(1, 1)).toBeCloseTo(0.703070, 5);
    expect(heightFromReservoirPc(1, 1) / 0.3048).toBeCloseTo(2.30666, 4);
    expect(heightFromReservoirPc(10, 0.25)).toBeCloseTo(10 * 0.703070 / 0.25, 4); // 28,12 m
    expect(reservoirPcFromHeight(heightFromReservoirPc(7.3, 0.31), 0.31)).toBeCloseTo(7.3, 12);
    expect(heightFromReservoirPc(-1, 1)).toBeNaN();
    expect(heightFromReservoirPc(1, 0)).toBeNaN();
    expect(heightFromReservoirPc(1, -0.2)).toBeNaN();
    expect(reservoirPcFromHeight(-5, 0.25)).toBeNaN();
  });

  it('altura de entrada: Pd lab 20 psi Hg → 1,41314 psi petróleo–agua → 1,41314·0,70307/0,25 = 3,974 m', () => {
    expect(entryHeightM(20, ctxOil)).toBeCloseTo(3.9742, 3);
    expect(labPcFromHeight(entryHeightM(20, ctxOil), ctxOil)).toBeCloseTo(20, 9);
    expect(entryHeightM(0, ctxOil)).toBeNaN();
    expect(entryHeightM(NaN, ctxOil)).toBeNaN();
  });
});

describe('petro/micp: hipérbola de Thomeer', () => {
  it('Bv a mano: Pd = 10, G = 0,5, Bv∞ = 20: Pc = 100 → 20·e^(−0,5) = 12,1306; Pc = 1000 → 20·e^(−0,25) = 15,5760; Pc ≤ Pd → 0', () => {
    expect(thomeerBv(100, 10, 0.5, 20)).toBeCloseTo(12.130613, 5);
    expect(thomeerBv(1000, 10, 0.5, 20)).toBeCloseTo(15.576016, 5);
    expect(thomeerBv(10, 10, 0.5, 20)).toBe(0);
    expect(thomeerBv(3, 10, 0.5, 20)).toBe(0);
    expect(thomeerBv(Infinity, 10, 0.5, 20)).toBe(20);
    expect(thomeerBv(100, 0, 0.5, 20)).toBeNaN();
    expect(thomeerBv(-1, 10, 0.5, 20)).toBeNaN();
  });

  it('recupera los parámetros de una curva de Thomeer exacta (Pd 20 psi, G 0,4, Bv∞ 18 %, φ 0,20)', () => {
    const pc = Array.from({ length: 40 }, (_, i) => 1 * Math.pow(10, (4 * i) / 39));
    const sw = pc.map((p) => 1 - thomeerBv(p, 20, 0.4, 18) / 20);
    const fit = fitThomeer(pc, sw, 0.2)!;
    expect(fit.pd).toBeCloseTo(20, 2);
    expect(fit.g).toBeCloseTo(0.4, 3);
    expect(fit.bvInfPct).toBeCloseTo(18, 2);
    expect(fit.rmsePct).toBeLessThan(1e-4);
    expect(fit.r2).toBeGreaterThan(0.999999);
    expect(fit.bvInfAtPorosityCap).toBe(false);
  });

  it('fuera de dominio devuelve null: φ inválida, Sw en %, pocos puntos, curva sin mercurio, Pc no creciente', () => {
    const pc = [1, 10, 100, 1000, 10000];
    const sw = [1, 0.9, 0.5, 0.3, 0.2];
    expect(fitThomeer(pc, sw, 0.2)).not.toBeNull();
    expect(fitThomeer(pc, sw, 0)).toBeNull();
    expect(fitThomeer(pc, sw, 21)).toBeNull(); // φ en %
    expect(fitThomeer(pc, sw.map((s) => s * 100), 0.2)).toBeNull(); // Sw en %
    expect(fitThomeer(pc.slice(0, 4), sw.slice(0, 4), 0.2)).toBeNull();
    expect(fitThomeer(pc, [1, 1, 1, 1, 1], 0.2)).toBeNull();
    expect(fitThomeer([1, 10, 5, 100, 1000], sw, 0.2)).toBeNull();
  });
});

describe('petro/micp: permeabilidad desde la curva', () => {
  it('Swanson a mano: k = 399·x^1,691 → x = 1: 399 mD; x = 2: 399·2^1,691 = 1288,29 mD; x ≤ 0 → NaN', () => {
    expect(swansonPermeability(1)).toBeCloseTo(399, 10);
    expect(swansonPermeability(2)).toBeCloseTo(1288.2929, 3);
    expect(swansonPermeability(0)).toBeNaN();
    expect(swansonPermeability(-1)).toBeNaN();
  });

  it('ápice a mano: φ = 0,20; Pc [10, 50, 100, 500] psi con Sw [1, 0,8, 0,6, 0,5]: Sb = [0, 4, 8, 10] → Sb/Pc = [0; 0,08; 0,08; 0,02]', () => {
    // Empate exacto 0,08 en 50 y 100 psi: queda el primero. Se cambia 100 psi → 0,55: Sb = 9 → 0,09 (gana).
    const a = swansonApex([10, 50, 100, 500], [1, 0.8, 0.55, 0.5], 0.2)!;
    expect(a.index).toBe(2);
    expect(a.pcPsi).toBe(100);
    expect(a.sbPct).toBeCloseTo(9, 12);
    expect(a.sbOverPc).toBeCloseTo(0.09, 12);
    expect(swansonPermeabilityFromCurve([10, 50, 100, 500], [1, 0.8, 0.55, 0.5], 0.2)).toBeCloseTo(399 * 0.09 ** 1.691, 8);
    expect(swansonApex([10, 50], [1, 1], 0.2)).toBeNull();
    expect(swansonPermeabilityFromCurve([10, 50], [1, 1], 0.2)).toBeNaN();
  });

  it('Thomeer a mano: k = 3,8068·G^−1,3334·(Bv∞/Pd)²: G = 1, Bv∞ = Pd → 3,8068; G = 0,5, Bv∞ = 20, Pd = 10 → 38,372 mD', () => {
    expect(thomeerPermeability(1, 5, 5)).toBeCloseTo(3.8068, 10);
    expect(thomeerPermeability(0.5, 10, 20)).toBeCloseTo(38.37191, 4);
    expect(thomeerPermeability(0, 10, 20)).toBeNaN();
    expect(thomeerPermeability(0.5, -1, 20)).toBeNaN();
  });
});

describe('petro/micp: Brooks–Corey por curva', () => {
  it('recupera una curva Brooks–Corey exacta (Pd 5 psi, λ 2, Swirr 0,20)', () => {
    const sw = Array.from({ length: 20 }, (_, i) => 0.97 - i * 0.0385); // 0,97 … 0,2385: > Swirr
    const pc = sw.map((s) => brooksCoreyPc(s, 5, 2, 0.2));
    const fit = fitBrooksCorey(pc, sw)!;
    expect(fit.swirr).toBeCloseTo(0.2, 4);
    expect(fit.lambda).toBeCloseTo(2, 3);
    expect(fit.pd).toBeCloseTo(5, 3);
    expect(fit.r2).toBeGreaterThan(0.999999);
    expect(fit.swirrAtBound).toBeNull();
    expect(fit.n).toBe(20);
  });

  it('con Swirr = 0 y la cola en la rama, el ajuste lo pega al límite inferior y lo avisa', () => {
    const sw = Array.from({ length: 16 }, (_, i) => 0.95 - i * 0.05);
    const pc = sw.map((s) => brooksCoreyPc(s, 3, 1.5, 0));
    const fit = fitBrooksCorey(pc, sw)!;
    expect(fit.swirr).toBe(0);
    expect(fit.swirrAtBound).toBe('lower');
    expect(fit.lambda).toBeCloseTo(1.5, 6);
    expect(fit.pd).toBeCloseTo(3, 6);
  });

  it('opciones y dominio: pcMax y swFitMin recortan la rama; pocos puntos → null', () => {
    const sw = Array.from({ length: 20 }, (_, i) => 0.97 - i * 0.0385);
    const pc = sw.map((s) => brooksCoreyPc(s, 5, 2, 0.2));
    expect(fitBrooksCorey(pc, sw, { pcMax: pc[9]! })!.n).toBe(10);
    expect(fitBrooksCorey(pc, sw, { swFitMin: 0.5 })!.n).toBe(sw.filter((s) => s >= 0.5).length);
    expect(fitBrooksCorey(pc, sw, { pcMax: pc[2]! })).toBeNull();
    expect(fitBrooksCorey([1, 2], [0.9, 0.5])).toBeNull();
  });
});

describe('petro/micp: Sw a una altura sobre el FWL', () => {
  const pcLab = [1, 10, 100];
  const swLab = [1, 0.5, 0.2];
  const same: HeightContext = { lab: SYSTEM_HG_AIR, reservoir: SYSTEM_HG_AIR, deltaRhoGcc: 1 };

  it('curva medida: interpola en log Pc sin extrapolar (h ↔ Pc con factor 1 y Δρ = 1 g/cm³)', () => {
    const h = (pc: number) => heightFromReservoirPc(pc, 1);
    expect(swAtHeightFromCurve(pcLab, swLab, h(Math.sqrt(10)), same)).toBeCloseTo(0.75, 9); // punto medio en log: (1 + 0,5)/2
    expect(swAtHeightFromCurve(pcLab, swLab, h(10), same)).toBeCloseTo(0.5, 9);
    expect(swAtHeightFromCurve(pcLab, swLab, h(100), same)).toBeCloseTo(0.2, 9);
    expect(swAtHeightFromCurve(pcLab, swLab, h(101), same)).toBeNaN(); // más allá de la curva: no extrapola
    expect(swAtHeightFromCurve(pcLab, swLab, h(0.5), same)).toBe(1); // bajo la primera Pc, la curva arranca en Sw = 1
    expect(swAtHeightFromCurve(pcLab, swLab, 0, same)).toBe(1);
    expect(swAtHeightFromCurve(pcLab, swLab, -3, same)).toBeNaN();
  });

  it('con petróleo–agua la altura sube 1/0,0707: la misma Sw se alcanza 14,15 veces más arriba', () => {
    const hOil = labPcFromHeight(1, ctxOil); // Pc lab a 1 m
    expect(hOil).toBeCloseTo((0.25 * 1000 * 9.80665 * 1) / 6894.757293 / 0.070657, 3);
    const mid = Math.sqrt(10); // psi lab
    const hAt = heightFromReservoirPc(mid * 0.0706572, 0.25);
    expect(swAtHeightFromCurve(pcLab, swLab, hAt, ctxOil)).toBeCloseTo(0.75, 6);
  });

  it('Brooks–Corey: Sw = Swirr + (1 − Swirr)(Pd_res/Pc_res)^λ; 1 bajo la altura de entrada', () => {
    // Pd lab 20 psi, λ 2, Swirr 0,2, petróleo–agua: h_d = 3,9742 m; a 2·h_d: Sw = 0,2 + 0,8·(1/2)² = 0,4.
    const hd = entryHeightM(20, ctxOil);
    expect(swAtHeightBrooksCorey(20, 2, 0.2, 2 * hd, ctxOil)).toBeCloseTo(0.4, 9);
    expect(swAtHeightBrooksCorey(20, 2, 0.2, 0.5 * hd, ctxOil)).toBe(1);
    expect(swAtHeightBrooksCorey(20, 2, 0.2, -1, ctxOil)).toBeNaN();
    expect(swAtHeightBrooksCorey(20, -2, 0.2, 10, ctxOil)).toBeNaN();
  });
});

describe('petro/micp: Brooks–Corey–Burdine y flujo fraccional', () => {
  it('a mano (λ = 2, Swirr = 0,2, Sw = 0,6 → Se = 0,5): krw = 0,5^4 = 0,0625; krnw = 0,25·(1 − 0,5²) = 0,1875', () => {
    expect(krwBrooksCorey(0.6, 2, 0.2)).toBeCloseTo(0.0625, 12);
    expect(krnwBrooksCorey(0.6, 2, 0.2)).toBeCloseTo(0.1875, 12);
  });

  it('extremos: krw(Swirr) = 0, krnw(Swirr) = 1; krw(1) = 1, krnw(1) = 0; Sw < Swirr → 0 y 1', () => {
    expect(krwBrooksCorey(0.2, 2, 0.2)).toBe(0);
    expect(krnwBrooksCorey(0.2, 2, 0.2)).toBe(1);
    expect(krwBrooksCorey(1, 2, 0.2)).toBe(1);
    expect(krnwBrooksCorey(1, 2, 0.2)).toBe(0);
    expect(krwBrooksCorey(0.1, 2, 0.2)).toBe(0);
    expect(krnwBrooksCorey(0.1, 2, 0.2)).toBe(1);
    expect(krwBrooksCorey(1.1, 2, 0.2)).toBeNaN();
    expect(krwBrooksCorey(0.5, 0, 0.2)).toBeNaN();
    expect(krnwBrooksCorey(0.5, 2, 1)).toBeNaN();
  });

  it('exponentes: 3 + 2/λ y 1 + 2/λ (λ = 0,5 → 7 y 5; Se = 0,5 → krw = 0,0078125)', () => {
    expect(krwBrooksCorey(0.5, 0.5, 0)).toBeCloseTo(0.5 ** 7, 12);
    expect(krnwBrooksCorey(0.5, 0.5, 0)).toBeCloseTo(0.25 * (1 - 0.5 ** 5), 12);
  });

  it('fw a mano: λ = 2, Se = 0,5, μw = μo → 0,0625/(0,0625 + 0,1875) = 0,25; μw = 0,5, μo = 1 → 0,125/(0,125 + 0,1875) = 0,4', () => {
    expect(fractionalFlowWater(0.6, 2, 0.2, 1, 1)).toBeCloseTo(0.25, 12);
    expect(fractionalFlowWater(0.6, 2, 0.2, 0.5, 1)).toBeCloseTo(0.4, 12);
    expect(fractionalFlowWater(0.2, 2, 0.2, 0.5, 1)).toBe(0);
    expect(fractionalFlowWater(1, 2, 0.2, 0.5, 1)).toBe(1);
    expect(fractionalFlowWater(0.6, 2, 0.2, 0, 1)).toBeNaN();
  });

  it('cutoff: fw(cutoff) = umbral; a mano λ = 2, Swirr = 0, μ iguales: Se⁴ = (1 − Se)³(1 + Se) tiene su raíz entre 0,5 y 0,6', () => {
    const c = swAtFractionalFlow(2, 0, 1, 1);
    // λ = 2, Swirr = 0, μ iguales: Se⁴ = (1 − Se)³(1 + Se); scipy brentq → 0,5825222078.
    expect(c).toBeCloseTo(0.5825222078104774, 8);
    expect(c).toBeGreaterThan(0.5);
    expect(c).toBeLessThan(0.6);
    expect(fractionalFlowWater(c, 2, 0, 1, 1)).toBeCloseTo(0.5, 12);
    // Un agua más viscosa (μw = 2) necesita más agua para moverse igual: sube el cutoff; un umbral mayor también.
    expect(swAtFractionalFlow(2, 0, 2, 1)).toBeGreaterThan(c);
    expect(swAtFractionalFlow(2, 0, 1, 1, 0.8)).toBeGreaterThan(c);
    expect(swAtFractionalFlow(2, 0.2, 1, 1)).toBeGreaterThan(swAtFractionalFlow(2, 0, 1, 1)); // desplazado por Swirr
    expect(swAtFractionalFlow(2, 0, 1, 1, 0)).toBeNaN();
    expect(swAtFractionalFlow(2, 0, 1, 1, 1)).toBeNaN();
    expect(swAtFractionalFlow(-1, 0, 1, 1)).toBeNaN();
  });

  it('resumen: mediana y rango; ignora NaN; vacío → null', () => {
    const a = summarizeCutoffs([0.6, NaN, 0.5, 0.7, 0.9])!;
    expect([a.n, a.min, a.max]).toEqual([4, 0.5, 0.9]);
    expect(a.median).toBeCloseTo(0.65, 12); // promedio de 0,6 y 0,7
    expect(summarizeCutoffs([0.3, 0.1, 0.2])).toEqual({ n: 3, median: 0.2, min: 0.1, max: 0.3 });
    expect(summarizeCutoffs([NaN])).toBeNull();
  });
});

describe('petro/micp: CMR (BVI/PHIE) contra la curva capilar', () => {
  const curve = { pcPsi: [1, 10, 100], swFrac: [1, 0.5, 0.2] };

  it('cociente de sumas en la ventana, Pc de la curva y altura (caso a mano)', () => {
    // Ventana ±0,5 m en 10 m: cuentan 9,6 · 10 · 10,4; 11,0 queda afuera. BVI/PHIE = (0,06 + 0,05 + 0,04)/(0,10 + 0,10 + 0,10) = 0,5.
    const depth = [9.0, 9.6, 10, 10.4, 11.0];
    const bvi = [0.99, 0.06, 0.05, 0.04, 0.99];
    const phie = [0.1, 0.1, 0.1, 0.1, 0.1];
    const same: HeightContext = { lab: SYSTEM_HG_AIR, reservoir: SYSTEM_HG_AIR, deltaRhoGcc: 1 };
    const [r] = cmrBviEquivalentHeights(depth, bvi, phie, [{ depthM: 10, ...curve }], same);
    expect(r!.nWindow).toBe(3);
    expect(r!.bviOverPhie).toBeCloseTo(0.5, 12);
    expect(r!.pcLabPsi).toBeCloseTo(10, 9); // Sw = 0,5 a 10 psi
    expect(r!.heightM).toBeCloseTo(heightFromReservoirPc(10, 1), 9);
  });

  it('sin datos en la ventana, PHIE = 0, o BVI/PHIE fuera de la curva → NaN sin inventar', () => {
    const same: HeightContext = { lab: SYSTEM_HG_AIR, reservoir: SYSTEM_HG_AIR, deltaRhoGcc: 1 };
    const [far] = cmrBviEquivalentHeights([1, 2], [0.05, 0.05], [0.1, 0.1], [{ depthM: 50, ...curve }], same);
    expect(far!.nWindow).toBe(0);
    expect(far!.heightM).toBeNaN();
    const [zero] = cmrBviEquivalentHeights([10], [0], [0], [{ depthM: 10, ...curve }], same);
    expect(zero!.bviOverPhie).toBeNaN();
    const [low] = cmrBviEquivalentHeights([10], [0.01], [0.1], [{ depthM: 10, ...curve }], same); // 0,1 < Sw mínima 0,2
    expect(low!.bviOverPhie).toBeCloseTo(0.1, 12);
    expect(low!.heightM).toBeNaN();
  });
});

// ── sobre las 8 muestras del TP (referencia numpy/scipy: scripts/qa/micp-usos-reference.py) ───────────────────────

describe('petro/micp: 8 muestras del TP contra numpy/scipy', () => {
  const samples = TP_MICP_SAMPLES.map((s) => ({
    ...s,
    pcPsi: s.pcKgCm2.map((p) => p * KGF_CM2_TO_PSI),
    swFrac: s.swPct.map((v) => v / 100),
    phi: s.phiPct / 100,
  }));
  const names = samples.map((s) => s.sample);
  const ref = (o: Record<string, number>) => names.map((n) => o[n]!);

  // scipy.optimize.least_squares (multiarranque, cotas Bv∞ ∈ [Bv máx, φ]) en Bv.
  const PD = ref({ '1-2': 33.1126, '1-2L': 32.8158, '1-32': 19.078, '1-33CK': 18.2065, '1-33': 14.6972, '2-15': 27.9053, '2-17': 30.3132, '2-6L': 64.0782 });
  const G = ref({ '1-2': 0.353809, '1-2L': 0.245834, '1-32': 0.198149, '1-33CK': 0.405906, '1-33': 0.319281, '2-15': 0.157965, '2-17': 0.331321, '2-6L': 0.328024 });
  const BV = ref({ '1-2': 21.0653, '1-2L': 21.2593, '1-32': 22.8205, '1-33CK': 21.2414, '1-33': 23.1821, '2-15': 14.3055, '2-17': 16.3025, '2-6L': 15.5937 });
  const RMSE = ref({ '1-2': 0.857314, '1-2L': 0.870958, '1-32': 1.08475, '1-33CK': 0.939027, '1-33': 0.862351, '2-15': 0.0652171, '2-17': 0.666966, '2-6L': 0.560586 });
  const K_SW = ref({ '1-2': 11.0772, '1-2L': 18.6373, '1-32': 79.9986, '1-33CK': 19.4716, '1-33': 54.5299, '2-15': 17.1061, '2-17': 9.3562, '2-6L': 2.08716 });
  const K_TH = ref({ '1-2': 6.15716, '1-2L': 10.3755, '1-32': 47.1558, '1-33CK': 17.2424, '1-33': 43.4044, '2-15': 11.7174, '2-17': 4.8029, '2-6L': 0.99662 });
  // numpy.polyfit en ln–ln + minimize_scalar para Swirr.
  const BC_PD = ref({ '1-2': 47.6575, '1-2L': 35.4863, '1-32': 17.9803, '1-33CK': 30.8307, '1-33': 19.5094, '2-15': 23.711, '2-17': 38.7843, '2-6L': 92.1846 });
  const BC_L = ref({ '1-2': 0.53031, '1-2L': 0.578612, '1-32': 0.555232, '1-33CK': 0.512879, '1-33': 0.517031, '2-15': 1.15737, '2-17': 0.52008, '2-6L': 0.59835 });
  const BC_SWIRR = ref({ '1-2': 0, '1-2L': 0, '1-32': 0, '1-33CK': 0, '1-33': 0, '2-15': 0.255864, '2-17': 0, '2-6L': 0 });
  const H_ENTRY = ref({ '1-2': 6.57973, '1-2L': 6.52076, '1-32': 3.79095, '1-33CK': 3.61777, '1-33': 2.92044, '2-15': 5.545, '2-17': 6.02347, '2-6L': 12.7328 });
  const H_ENTRY_BC = ref({ '1-2': 9.46992, '1-2L': 7.0514, '1-32': 3.57283, '1-33CK': 6.12631, '1-33': 3.87667, '2-15': 4.71155, '2-17': 7.70674, '2-6L': 18.3178 });
  // brentq sobre fw(Sw) = 0,5, μw = 0,5 cP, μo = 1 cP.
  const CUT = ref({ '1-2': 0.649256, '1-2L': 0.639872, '1-32': 0.644293, '1-33CK': 0.652892, '1-33': 0.652013, '2-15': 0.681773, '2-17': 0.651373, '2-6L': 0.636304 });
  const BVI_PHIE = ref({ '1-2': 0.677134, '1-2L': 0.677134, '1-32': 0.817502, '1-33CK': 0.804505, '1-33': 0.804505, '2-15': 0.761269, '2-17': 0.714801, '2-6L': 0.70582 });
  const PC_BVI = ref({ '1-2': 65.1773, '1-2L': 51.41, '1-32': 26.1694, '1-33CK': 31.4592, '1-33': 23.3799, '2-15': 38.0242, '2-17': 51.531, '2-6L': 116.715 });
  const H_BVI = ref({ '1-2': 12.9512, '1-2L': 10.2156, '1-32': 5.20007, '1-33CK': 6.25118, '1-33': 4.64576, '2-15': 7.5557, '2-17': 10.2396, '2-6L': 23.1921 });

  const thomeer = samples.map((s) => fitThomeer(s.pcPsi, s.swFrac, s.phi)!);
  const bc = samples.map((s) => fitBrooksCorey(s.pcPsi, s.swFrac)!);

  it('Thomeer: Pd, G y Bv∞ coinciden con scipy (0,5 %); error RMS de Bv < 1,1 % del volumen total', () => {
    thomeer.forEach((f, i) => {
      expect(f, names[i]).not.toBeNull();
      expect(rel(f.pd, PD[i]!), `Pd ${names[i]}`).toBeLessThan(5e-3);
      expect(rel(f.g, G[i]!), `G ${names[i]}`).toBeLessThan(5e-3);
      expect(rel(f.bvInfPct, BV[i]!), `Bv∞ ${names[i]}`).toBeLessThan(5e-3);
      expect(Math.abs(f.rmsePct - RMSE[i]!), `rmse ${names[i]}`).toBeLessThan(5e-3);
      expect(f.rmsePct).toBeLessThan(1.1);
      expect(f.r2).toBeGreaterThan(0.985);
    });
  });

  it('Thomeer: Bv∞ cae en el tope de porosidad en 6 de 8 muestras; la 2-15 (cortada a 21 kg/cm²) llega a 87 % de su Bv∞', () => {
    expect(thomeer.filter((f) => f.bvInfAtPorosityCap).length).toBe(6); // todas menos la 1-32 y la 2-15
    const i = names.indexOf('2-15');
    expect(thomeer[i]!.bvInfAtPorosityCap).toBe(false);
    expect(thomeer[i]!.reachedFraction).toBeCloseTo(12.4116 / 14.3055, 2);
  });

  it('Swanson con 399 y 1,691 coincide con scipy/numpy y con la k de gas de la hoja SCAL (7 de 8 dentro del 5 %; la 1-32 da 13 % menos)', () => {
    samples.forEach((s, i) => {
      const k = swansonPermeabilityFromCurve(s.pcPsi, s.swFrac, s.phi);
      expect(rel(k, K_SW[i]!), s.sample).toBeLessThan(1e-4);
      if (s.sample === '1-32') expect(rel(k, s.kGasMd)).toBeGreaterThan(0.1);
      else expect(rel(k, s.kGasMd), s.sample).toBeLessThan(0.05);
    });
  });

  it('Thomeer: k desde G, Pd y Bv∞ coincide con scipy; subestima la k de gas (entre 0,45 y 0,9 veces)', () => {
    thomeer.forEach((f, i) => {
      const k = thomeerPermeability(f.g, f.pd, f.bvInfPct);
      expect(rel(k, K_TH[i]!), names[i]).toBeLessThan(2e-2);
      const ratio = k / samples[i]!.kGasMd;
      expect(ratio, names[i]).toBeGreaterThan(0.4);
      expect(ratio, names[i]).toBeLessThan(0.95);
    });
  });

  it('Brooks–Corey: Pd, λ y Swirr contra numpy; Swirr = 0 (límite inferior) en 7 de 8 (la 2-15, cortada, sí tiene Swirr interior)', () => {
    bc.forEach((f, i) => {
      expect(rel(f.pd, BC_PD[i]!), `Pd ${names[i]}`).toBeLessThan(5e-3);
      expect(rel(f.lambda, BC_L[i]!), `λ ${names[i]}`).toBeLessThan(5e-3);
      expect(Math.abs(f.swirr - BC_SWIRR[i]!), `Swirr ${names[i]}`).toBeLessThan(2e-3);
    });
    expect(bc.filter((f) => f.swirrAtBound === 'lower').length).toBe(7);
    expect(bc[names.indexOf('2-15')]!.swirrAtBound).toBeNull();
  });

  it('altura de entrada petróleo–agua (Δρ 0,25 g/cm³) con Pd de Thomeer y con Pd de Brooks–Corey contra numpy en SI', () => {
    thomeer.forEach((f, i) => expect(rel(entryHeightM(f.pd, ctxOil), H_ENTRY[i]!), names[i]).toBeLessThan(5e-3));
    // con el Pd exacto de la referencia, el motor reproduce las cuentas en SI a 1e-5
    PD.forEach((pd, i) => expect(rel(entryHeightM(pd, ctxOil), H_ENTRY[i]!), names[i]).toBeLessThan(1e-5));
    bc.forEach((f, i) => expect(rel(entryHeightM(f.pd, ctxOil), H_ENTRY_BC[i]!), names[i]).toBeLessThan(5e-3));
  });

  it('cutoff de Sw (fw = 0,5, μw 0,5 cP, μo 1 cP) contra brentq; resumen 0,64–0,68 con mediana 0,65', () => {
    const cuts = bc.map((f) => swAtFractionalFlow(f.lambda, f.swirr));
    cuts.forEach((c, i) => expect(Math.abs(c - CUT[i]!), names[i]).toBeLessThan(2e-3));
    const sum = summarizeCutoffs(cuts)!;
    expect(sum.n).toBe(8);
    expect(sum.median).toBeCloseTo(0.6515, 2);
    expect(sum.min).toBeGreaterThan(0.63);
    expect(sum.max).toBeLessThan(0.69);
  });

  it('CMR del TP: BVI/PHIE entre 0,65 y 0,85 a las profundidades de las coronas; Pc y altura equivalente contra numpy', () => {
    const lines = tpCsv.trim().split(/\r?\n/);
    const head = lines[0]!.split(',');
    const col = (name: string) => lines.slice(1).map((l) => {
      const v = l.split(',')[head.indexOf(name)];
      return v === undefined || v === '' ? NaN : Number(v);
    });
    const depth = col('DEPTH');
    const out = cmrBviEquivalentHeights(depth, col('PHI_BVI'), col('PHIE_CMR'), samples.map((s) => ({ depthM: s.depthM, pcPsi: s.pcPsi, swFrac: s.swFrac })), ctxOil);
    out.forEach((r, i) => {
      expect(r.bviOverPhie, names[i]).toBeGreaterThan(0.65);
      expect(r.bviOverPhie, names[i]).toBeLessThan(0.85);
      expect(Math.abs(r.bviOverPhie - BVI_PHIE[i]!), names[i]).toBeLessThan(1e-5);
      expect(rel(r.pcLabPsi, PC_BVI[i]!), names[i]).toBeLessThan(1e-4);
      expect(rel(r.heightM, H_BVI[i]!), names[i]).toBeLessThan(1e-4);
    });
    // Ventana de ±0,5 m con paso de 0,1524 m: 6 o 7 muestras del perfil.
    expect(out.every((r) => r.nWindow === 6 || r.nWindow === 7)).toBe(true);
  });
});

describe('petro/micp: Swirr fijo en Brooks–Corey, Sw en % y calibración del CMR (revisión independiente)', () => {
  // Brooks–Corey exacta: Pd 10, λ 1,5, Swirr 0,2 (Sw = 0,2 + 0,8·(10/Pc)^1,5).
  const pc = [12, 15, 20, 30, 50, 80, 120, 200];
  const sw = pc.map((p) => 0.2 + 0.8 * (10 / p) ** 1.5);

  it('con Swirr fijo recupera Pd y λ y marca el ajuste como «fixed»', () => {
    const f = fitBrooksCoreyFixed(pc, sw, { swirr: 0.2 })!;
    expect(f.swirrAtBound).toBe('fixed');
    expect(f.swirr).toBe(0.2);
    expect(f.pd).toBeCloseTo(10, 8);
    expect(f.lambda).toBeCloseTo(1.5, 8);
    expect(f.r2).toBeCloseTo(1, 10);
  });

  it('con Swirr fijo excluye los puntos con Sw ≤ Swirr; Swirr fuera de [0, 1) da null', () => {
    const f = fitBrooksCoreyFixed([...pc, 400, 800], [...sw, 0.2, 0.19], { swirr: 0.2 })!;
    expect(f.n).toBe(pc.length);
    expect(fitBrooksCoreyFixed(pc, sw, { swirr: 1 })).toBeNull();
    expect(fitBrooksCoreyFixed(pc, sw, { swirr: -0.1 })).toBeNull();
    expect(fitBrooksCoreyFixed(pc, sw, { swirr: NaN })).toBeNull();
  });

  it('Sw en % (> 1) da null en Brooks–Corey y en el ápice de Swanson, como en Thomeer', () => {
    const pct = sw.map((v) => v * 100);
    expect(fitBrooksCoreyFixed(pc, pct)).toBeNull();
    expect(swansonApexCheck(pc, pct, 0.2)).toBeNull();
  });

  it('Sw a 100 psi aire–salmuera (≈ 510,7 psi Hg): 0,21–0,36 en el TP; la 2-15 no llega (scipy)', () => {
    const expected: Record<string, number> = { '1-2': 0.32857, '1-2L': 0.25633, '1-32': 0.21199, '1-33CK': 0.30802, '1-33': 0.24487, '2-17': 0.2963, '2-6L': 0.36082 };
    for (const s of TP_MICP_SAMPLES) {
      const v = swAtCmrCalibration(s.pcKgCm2.map((p) => p * KGF_CM2_TO_PSI), s.swPct.map((x) => x / 100));
      if (s.sample === '2-15') expect(v).toBeNaN();
      else expect(v).toBeCloseTo(expected[s.sample]!, 4);
    }
  });
});
