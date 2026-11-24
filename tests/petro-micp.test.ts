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

  it('R35 medido = Washburn a la Pc de Sw = 0,65 (SHg = 35 %): con Sw 0,65 a 10 psi da 106,66/10 µm', () => {
    expect(measuredR35([1, 10, 100], [1, 0.65, 0.2])).toBeCloseTo(washburnRadius(10), 12);
    expect(washburnRadius(10)).toBeCloseTo(10.666, 3);
    expect(measuredR35([1, 10], [1, 0.8])).toBeNaN();
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
      expect(s.pcKgCm2.length).toBe(s.sample === '2-15' ? 22 : 37);
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

  it('a presiones bajas ninguna roca está invadida (sin ajuste); a 700 kg/cm² entran 7 (la 2-15 se corta en 21)', () => {
    expect(fits[0]!.fit).toBeNull();
    const last = fits[fits.length - 1]!;
    expect(last.pc).toBeCloseTo(700.449, 3);
    expect(last.fit!.n).toBe(7);
  });

  it('cada nivel coincide con un escalón del ensayo (RMS de Swi < 0,004 v/v) y es el `pcKgCm2` del preset', () => {
    // numpy: 28,215 · 69,970 · 122,56 · 245,68 · 351,92 · 700,45 kg/cm², RMS 0,0031 · 0,0018 · 0,0006 · 0,0010 · 0,0013 · 0,0013.
    const rms = [0.00307, 0.00184, 0.00061, 0.00097, 0.00125, 0.00128];
    SWI_CATEDRA_LEVELS.forEach((level, i) => {
      const m = matchSwiLevel(level, fits);
      expect(m.pc).toBeCloseTo(level.pcKgCm2!, 2);
      expect(m.rmsSwi).toBeCloseTo(rms[i]!, 4);
      expect(m.rmsSwi).toBeLessThan(0.004);
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

  it('sin ajustes válidos no hay coincidencia', () => {
    expect(matchSwiLevel(SWI_CATEDRA_LEVELS[0]!, [{ pc: 1, fit: null }])).toEqual({ index: -1, pc: NaN, rmsSwi: NaN });
  });
});
