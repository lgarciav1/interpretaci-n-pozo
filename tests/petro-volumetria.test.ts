import { describe, expect, it } from 'vitest';
import { convert } from '../src/core/units';
import { inPlaceVolume, zoneInPlace } from '../src/petro/volumetrics';

const ACRE_M2 = 4046.8564224; // 1 acre en m² (definición internacional: 43 560 ft²)
const FT_M = 0.3048;

describe('petro/volumetrics: caso de libro', () => {
  it('1 acre · 1 ft · (φSh = 1) / (B = 1) = 1233,48 m³ = 7758,4 bbl (Dake 1978: 7758 bbl/acre-ft)', () => {
    const v = inPlaceVolume(ACRE_M2, FT_M, 1);
    expect(v).toBeCloseTo(1233.4818, 3);
    expect(convert(v, 'm3', 'bbl')).toBeCloseTo(7758.37, 1);
  });

  it('gas: 1 acre-ft con Bg = 1 ft³/scf son 43 560 scf (= 43 560 ft³)', () => {
    const { ogip, ooip } = zoneInPlace('gas', ACRE_M2, FT_M, 1.2, 1);
    expect(ooip).toBe(0);
    expect(convert(ogip, 'm3', 'ft3')).toBeCloseTo(43560, 3);
  });

  it('Bo divide: Bo = 1,25 → 7758,4/1,25 = 6206,7 STB', () => {
    const { ooip } = zoneInPlace('oil', ACRE_M2, FT_M, 1.25, 0.005);
    expect(convert(ooip, 'm3', 'bbl')).toBeCloseTo(7758.37 / 1.25, 1);
  });
});

describe('petro/volumetrics: cuentas a mano en SI', () => {
  it('A = 2 km² (2e6 m²), hφSh = 3 m, Bo = 1,2 → 5e6 m³ = 5 MMm³', () => {
    const { ooip, ogip } = zoneInPlace('oil', 2e6, 3, 1.2, 0.005);
    expect(ooip).toBeCloseTo(5e6, 6);
    expect(ogip).toBe(0);
    expect(convert(ooip, 'm3', 'MMm3')).toBeCloseTo(5, 12);
    expect(convert(ooip, 'm3', 'MMbbl')).toBeCloseTo(31.449, 3); // 5e6 / 158 987,29 m³ por MMbbl
  });

  it('gas: A = 1 km², hφSh = 2 m, Bg = 0,005 → 4e8 m³ = 14,126 Bcf', () => {
    const { ooip, ogip } = zoneInPlace('gas', 1e6, 2, 1.2, 0.005);
    expect(ooip).toBe(0);
    expect(ogip).toBeCloseTo(4e8, 4);
    expect(convert(ogip, 'm3', 'Bcf')).toBeCloseTo(4e8 / 28316846.592, 9);
  });

  it("'none' → ambos 0 aunque los datos sean NaN", () => {
    expect(zoneInPlace('none', 1e6, NaN, 1.2, 0.005)).toEqual({ ooip: 0, ogip: 0 });
  });

  it('hφSh = 0 → 0; hφSh NaN → NaN (el otro fluido queda 0)', () => {
    expect(inPlaceVolume(1e6, 0, 1.2)).toBe(0);
    const r = zoneInPlace('oil', 1e6, NaN, 1.2, 0.005);
    expect(r.ooip).toBeNaN();
    expect(r.ogip).toBe(0);
  });

  it('B ≤ 0, B no finito, área o hφSh negativos → NaN', () => {
    expect(inPlaceVolume(1e6, 2, 0)).toBeNaN();
    expect(inPlaceVolume(1e6, 2, -1)).toBeNaN();
    expect(inPlaceVolume(1e6, 2, NaN)).toBeNaN();
    expect(inPlaceVolume(1e6, 2, Infinity)).toBeNaN();
    expect(inPlaceVolume(-1, 2, 1.2)).toBeNaN();
    expect(inPlaceVolume(1e6, -2, 1.2)).toBeNaN();
    expect(inPlaceVolume(NaN, 2, 1.2)).toBeNaN();
  });
});
