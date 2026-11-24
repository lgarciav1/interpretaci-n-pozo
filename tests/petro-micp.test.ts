/**
 * Curvas MICP medidas (docs/decisiones/0087-micp-del-tp.md): interpolación Pc–Sw, R35 medido (Washburn a SHg = 35 %)
 * y reconstrucción de la presión de los seis niveles de Swi de la cátedra con las curvas del TP.
 * Referencias: cuentas a mano y numpy 2 (`np.polyfit` en log–log, `scripts/qa/tp-micp-data.py` para los datos).
 */
import { describe, expect, it } from 'vitest';
import { TP_MICP_SAMPLES } from '../src/modules/rock-typing/tpMicp';
import { KGF_CM2_TO_PSI, measuredR35, pcAtWettingSaturation, washburnRadius, wettingSaturationAtPc, winlandR35 } from '../src/petro/rockTyping';
import { matchSwiLevel, SWI_CATEDRA_LEVELS, swiLevelFits, type SwiPcSample } from '../src/petro/swiPc';

const PC = [1, 10, 100];
const SW = [1, 0.5, 0.2];

describe('petro/rockTyping: interpolación de curvas Pc–Sw medidas', () => {
  it('kg/cm² → psi = 98,0665 / 6,894757 = 14,2233', () => {
    expect(KGF_CM2_TO_PSI).toBeCloseTo(14.22334330746688, 12);
  });

  it('Sw a una Pc: lineal en Sw y logarítmica en Pc; en los nodos devuelve el nodo; sin extrapolar', () => {
    expect(wettingSaturationAtPc(PC, SW, Math.sqrt(10))).toBeCloseTo(0.75, 12);
    expect(wettingSaturationAtPc(PC, SW, 10 ** 1.5)).toBeCloseTo(0.35, 12);
    expect(wettingSaturationAtPc(PC, SW, 1)).toBe(1);
    expect(wettingSaturationAtPc(PC, SW, 100)).toBeCloseTo(0.2, 12);
    expect(wettingSaturationAtPc(PC, SW, 0.5)).toBeNaN();
    expect(wettingSaturationAtPc(PC, SW, 101)).toBeNaN();
    expect(wettingSaturationAtPc(PC, SW, 0)).toBeNaN();
    expect(wettingSaturationAtPc([1], [1], 1)).toBeNaN();
  });

  it('Pc a una Sw: inversa de la anterior; primer cruce; en una meseta, la menor presión', () => {
    expect(pcAtWettingSaturation(PC, SW, 0.75)).toBeCloseTo(Math.sqrt(10), 12);
    expect(pcAtWettingSaturation(PC, SW, 0.35)).toBeCloseTo(10 ** 1.5, 10);
    expect(pcAtWettingSaturation(PC, SW, 0.5)).toBeCloseTo(10, 12);
    expect(pcAtWettingSaturation([1, 2, 4], [1, 1, 0.5], 1)).toBe(1);
    expect(pcAtWettingSaturation(PC, SW, 0.1)).toBeNaN(); // la curva no llega
    for (const p of [1.7, 23, 88]) expect(pcAtWettingSaturation(PC, SW, wettingSaturationAtPc(PC, SW, p))).toBeCloseTo(p, 10);
  });

  it('casos borde: nodo exacto, vecino sin dato, Sw = 0 al final, objetivo fuera de la curva, Pc no creciente', () => {
    expect(wettingSaturationAtPc([1, 3, 100], [0.9, 0.1, 0.05], 3)).toBe(0.1);
    expect(wettingSaturationAtPc([1, 10, 100], [1, NaN, 0.2], 1)).toBe(1);
    expect(wettingSaturationAtPc([1, 10, 100], [1, NaN, 0.2], 50)).toBeNaN();
    expect(pcAtWettingSaturation([1, 10, 100], [1, 0.3, 0], 0)).toBe(100);
    expect(pcAtWettingSaturation([1, 10, 100], [0.9, 0.5, 0.2], 0.95)).toBeNaN();
    expect(pcAtWettingSaturation(PC, SW, 0.2)).toBeCloseTo(100, 10);
    // Pc no creciente: se saltea el intervalo inválido (10 → 5) sin avisar; 7 cae en el primero válido (1 → 10) y 50 en 5 → 100.
    expect(wettingSaturationAtPc([1, 10, 5, 100], [1, 0.5, 0.4, 0.2], 7)).toBeCloseTo(1 - 0.5 * (Math.log(7) / Math.log(10)), 12);
    expect(wettingSaturationAtPc([1, 10, 5, 100], [1, 0.5, 0.4, 0.2], 50)).toBeCloseTo(0.4 - 0.2 * (Math.log(10) / Math.log(20)), 12);
  });

  it('R35 medido = Washburn a la Pc de Sw = 0,65 (SHg = 35 %): con Sw 0,65 a 10 psi da 106,66/10 µm', () => {
    expect(measuredR35([1, 10, 100], [1, 0.65, 0.2])).toBeCloseTo(washburnRadius(10), 12);
    expect(washburnRadius(10)).toBeCloseTo(10.666, 3);
    expect(measuredR35([1, 10], [1, 0.8])).toBeNaN();
    expect(measuredR35([1, 10, 100], [100, 65, 20])).toBeNaN(); // Sw en % por error: no inventa un radio
  });
});

const tpSamples = TP_MICP_SAMPLES.map((s) => ({
  ...s,
  pcPsi: s.pcKgCm2.map((p) => p * KGF_CM2_TO_PSI),
  swFrac: s.swPct.map((v) => v / 100),
  rootKPhi: Math.sqrt(s.kGasMd / s.phiPct),
}));

describe('curvas MICP del TP (hoja SCAL, caché de los gráficos)', () => {
  it('8 muestras ubicadas con el plug de corona del mismo número; Pc creciente y Sw no creciente', () => {
    expect(TP_MICP_SAMPLES.map((s) => `${s.sample}→${s.plugId}`)).toEqual(['1-2→C1-02', '1-2L→C1-02', '1-32→C1-32', '1-33CK→C1-33', '1-33→C1-33', '2-15→C2-15', '2-17→C2-17', '2-6L→C2-06']);
    for (const s of TP_MICP_SAMPLES) {
      expect(s.pcKgCm2.length).toBe(37);
      expect(s.swPct[0]).toBe(100);
      for (let i = 1; i < s.pcKgCm2.length; i++) {
        expect(s.pcKgCm2[i]!).toBeGreaterThan(s.pcKgCm2[i - 1]!);
        expect(s.swPct[i]!).toBeLessThanOrEqual(s.swPct[i - 1]!);
      }
    }
  });

  // numpy: Pc a Sw = 65 % interpolada en log Pc, Washburn mercurio–aire (σ 480, θ 140°).
  const R35: Record<string, number> = { '1-2': 1.5782, '1-2L': 2.0348, '1-32': 3.7917, '1-33CK': 2.3907, '1-33': 3.7758, '2-15': 2.4335, '2-17': 1.9593, '2-6L': 0.8248 };

  it('R35 medido de cada muestra (numpy, ±1e-4 µm)', () => {
    for (const s of tpSamples) expect(measuredR35(s.pcPsi, s.swFrac)).toBeCloseTo(R35[s.sample]!, 4);
  });

  // El 10 % depende de σ|cosθ|: con el estándar (480 dyn/cm, 140°). Los diámetros del laboratorio implican 380,2 dyn/cm
  // (3,4 % más de radio): con ese valor quedarían 5 de 8 dentro del 10 % (1-33CK y 2-17 pasan a ~11 %).
  it('Winland R35 desde k y φ coincide con el medido dentro del 10 % en 7 de 8 muestras (la 1-32 lo sobreestima un 35 %)', () => {
    const ratio = Object.fromEntries(tpSamples.map((s) => [s.sample, winlandR35(s.phiPct / 100, s.kGasMd) / measuredR35(s.pcPsi, s.swFrac)]));
    for (const [name, r] of Object.entries(ratio)) {
      if (name === '1-32') expect(r).toBeCloseTo(5.1044 / 3.7917, 3);
      else expect(Math.abs(r - 1)).toBeLessThan(0.1);
    }
  });
});

describe('petro/swiPc: presión de los niveles de Swi de la cátedra desde las curvas MICP', () => {
  const samples: SwiPcSample[] = tpSamples.map((s) => ({ rootKPhi: s.rootKPhi, pc: s.pcKgCm2, sw: s.swFrac }));
  const grid = TP_MICP_SAMPLES.find((s) => s.sample === '1-32')!.pcKgCm2;
  const fits = swiLevelFits(samples, grid);

  it('a presiones bajas ninguna roca está invadida (sin ajuste); a 700 kg/cm² entran las 8 muestras', () => {
    expect(fits[0]!.fit).toBeNull();
    const last = fits[fits.length - 1]!;
    expect(last.pc).toBeCloseTo(700.449, 3);
    expect(last.fit!.n).toBe(8);
  });

  it('cada nivel reproduce exacto un escalón del ensayo (RMS de Swi < 0,0001 v/v) y es el `pcKgCm2` del preset', () => {
    // 28,215 · 69,970 · 122,56 · 245,68 · 351,92 · 700,45 kg/cm² (con las 8 muestras completas, incluida 2-15).
    const rms = [0.000042, 0.000002, 0.000004, 0.000027, 0.000000, 0.000005];
    SWI_CATEDRA_LEVELS.forEach((level, i) => {
      const m = matchSwiLevel(level, fits);
      expect(m.pc).toBeCloseTo(level.pcKgCm2!, 2);
      expect(m.rmsSwi).toBeCloseTo(rms[i]!, 5);
      expect(m.rmsSwi).toBeLessThan(0.0001);
    });
  });

  it('las presiones de los niveles crecen del 1 al 6 y los coeficientes reconstruidos se parecen a los de la cátedra', () => {
    const pcs = SWI_CATEDRA_LEVELS.map((l) => l.pcKgCm2!);
    for (let i = 1; i < pcs.length; i++) expect(pcs[i]!).toBeGreaterThan(pcs[i - 1]!);
    for (const level of SWI_CATEDRA_LEVELS) {
      const f = fits[matchSwiLevel(level, fits).index]!.fit!;
      expect(Math.abs(f.A / level.A - 1)).toBeLessThan(0.05);
      expect(Math.abs(f.B - level.B)).toBeLessThan(0.015);
    }
  });

  it('sin ajustes válidos, o con un nivel o un rango inválido, no hay coincidencia', () => {
    const none = { index: -1, pc: NaN, rmsSwi: NaN };
    expect(matchSwiLevel(SWI_CATEDRA_LEVELS[0]!, [{ pc: 1, fit: null }])).toEqual(none);
    expect(matchSwiLevel({ A: NaN, B: -0.3 }, fits)).toEqual(none);
    expect(matchSwiLevel(SWI_CATEDRA_LEVELS[0]!, fits, { min: 0, max: 2 })).toEqual(none);
  });

  it('a presión baja quedan afuera las rocas todavía sin invadir (Sw = 1): n = 5 a 2,87 y n = 7 a 3,89 kg/cm²', () => {
    const at = (p: number) => fits.find((f) => Math.abs(f.pc - p) < 0.01)!.fit!.n;
    expect(at(2.8685)).toBe(5);
    expect(at(3.8887)).toBe(7);
  });
});
