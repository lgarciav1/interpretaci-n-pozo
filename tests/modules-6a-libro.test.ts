/**
 * Casos de libro de la fase 6a reproducidos con la cadena de módulos (motor completo, no solo las funciones):
 * Archie (1942), corrección de Arps (Schlumberger Gen-9), Simandoux en la forma de Asquith y Krygowski (2004),
 * Indonesia (Poupon y Leveaux, 1971) y volumétrico de petróleo y de gas (constantes 7758 bbl/acre-pie y
 * 43 560 ft³/acre-pie, Dake 1978).
 *
 * Los números NO están copiados de un ejemplo impreso (no se pudo consultar el libro): son las ecuaciones de libro
 * evaluadas a mano con entradas redondas, escritas acá con aritmética independiente de src/petro (sin las
 * funciones del motor ni `convert`). Ver docs/decisiones/0007-modulos-fase-6a.md.
 */
import { describe, expect, it } from 'vitest';
import { Engine, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import type { Zone } from '../src/core/well';
import { registry } from '../src/modules';
import { curve, well, zone } from './helpers';

function run(w: ReturnType<typeof well>, partial: Partial<Interpretation> = {}, zones: Zone[] = []): EngineRunResult {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(w);
  return engine.run({ ...emptyInterpretation(zones), ...partial });
}
const out = (r: EngineRunResult, key: string) => {
  const o = r.outputs.find((x) => x.key === key);
  if (!o) throw new Error(`Falta la salida ${key}`);
  return o.value;
};
const status = (r: EngineRunResult, id: string) => r.nodes.find((x) => x.moduleId === id)?.status;
const filled = (n: number, v: number) => Array.from({ length: n }, () => v);

describe('libro: Archie y Arps a través de rw-manual → sw-archie → bvw-sh', () => {
  const N = 8;

  it('Archie: φ = 0,20, Rw = 0,05, Rt = 20, a = 1, m = 2, n = 2 → F = 25, Ro = 1,25, Sw = √(1,25/20) = 0,25', () => {
    const w = well([curve('RT', 'RT', filled(N, 20)), curve('PHIE', 'PHIE', filled(N, 0.2)), curve('TEMP', 'TEMP', filled(N, 24))], N);
    const r = run(w);
    for (const id of ['rw-manual', 'sw-archie', 'bvw-sh']) expect(status(r, id), id).toBe('ok');
    const rw = out(r, 'rw-manual:RW') as Float64Array;
    const sw = out(r, 'sw-archie:SW') as Float64Array;
    const bvw = out(r, 'bvw-sh:BVW') as Float64Array;
    const sh = out(r, 'bvw-sh:SH') as Float64Array;
    for (let i = 0; i < N; i++) {
      expect(rw[i]).toBeCloseTo(0.05, 12); // Rw ya está a 24 °C: Arps no cambia nada
      expect(sw[i]).toBeCloseTo(0.25, 12);
      expect(bvw[i]).toBeCloseTo(0.2 * 0.25, 12); // BVW = φ·Sw = 0,05
      expect(sh[i]).toBeCloseTo(0.75, 12);
    }
  });

  it('Arps (Gen-9): Rw = 0,05 a 75 °F llevada a 200 °F → 0,05·(75 + 6,77)/(200 + 6,77) = 0,019773 y Sw con esa Rw', () => {
    const t75 = (75 - 32) / 1.8;
    const t200 = (200 - 32) / 1.8;
    const w = well([curve('RT', 'RT', filled(N, 20)), curve('PHIE', 'PHIE', filled(N, 0.2)), curve('TEMP', 'TEMP', filled(N, t200))], N);
    const r = run(w, { params: { global: { 'rw-manual.tRef': t75 }, zones: {} } });
    expect(status(r, 'sw-archie')).toBe('ok');
    const rwBook = (0.05 * (75 + 6.77)) / (200 + 6.77);
    expect(rwBook).toBeCloseTo(0.0197732, 6);
    const rw = out(r, 'rw-manual:RW') as Float64Array;
    const sw = out(r, 'sw-archie:SW') as Float64Array;
    expect(rw[3]).toBeCloseTo(rwBook, 10);
    expect(sw[3]).toBeCloseTo(Math.sqrt(rwBook / (0.04 * 20)), 10); // 0,15720
    expect(sw[3]).toBeCloseTo(0.1572, 4);
  });
});

describe('libro: arenas arcillosas (Simandoux e Indonesia) con Rw por Arps', () => {
  const N = 6;
  const rt = 20;
  const phi = 0.2;
  const vsh = 0.3;
  const rsh = 2; // default compartido
  const rw = 0.05;
  const w = well(
    [curve('RT', 'RT', filled(N, rt)), curve('PHIE', 'PHIE', filled(N, phi)), curve('VSH', 'VSH', filled(N, vsh)), curve('TEMP', 'TEMP', filled(N, 24))],
    N,
  );

  it('Simandoux (a = 0,81, m = 2): coincide con la forma de Asquith y Krygowski 0,4·Rw/φ²·[√((Vsh/Rsh)² + 5φ²/(Rw·Rt)) − Vsh/Rsh] a < 1 % y resuelve la ecuación de conductividad', () => {
    const r = run(w, { sources: { SW: { kind: 'module', moduleId: 'sw-simandoux' } }, params: { global: { a: 0.81 }, zones: {} } });
    expect(status(r, 'sw-simandoux')).toBe('ok');
    const sw = (out(r, 'sw-simandoux:SW') as Float64Array)[2]!;
    const b = vsh / rsh;
    const book = ((0.4 * rw) / phi ** 2) * (Math.sqrt(b * b + (5 * phi ** 2) / (rw * rt)) - b);
    expect(book).toBeCloseTo(0.16085, 4);
    expect(Math.abs(sw - book) / book).toBeLessThan(0.01);
    // la raíz positiva de 1/Rt = φ^m·Sw²/(a·Rw) + Vsh·Sw/Rsh
    expect(phi ** 2 * sw * sw / (0.81 * rw) + (vsh * sw) / rsh).toBeCloseTo(1 / rt, 12);
    expect(sw).toBeCloseTo(0.161531, 5);
    // y es menor que Archie (n = 2) con los mismos parámetros: la arcilla conduce
    expect(sw).toBeLessThan(Math.sqrt((0.81 * rw) / (phi ** 2 * rt)));
  });

  it('Indonesia (a = 1, m = 2, n = 2): cumple 1/√Rt = [Vsh^(1 − Vsh/2)/√Rsh + φ^(m/2)/√(a·Rw)]·Sw^(n/2)', () => {
    const r = run(w, { sources: { SW: { kind: 'module', moduleId: 'sw-indonesia' } } });
    expect(status(r, 'sw-indonesia')).toBe('ok');
    const sw = (out(r, 'sw-indonesia:SW') as Float64Array)[2]!;
    const k = vsh ** (1 - vsh / 2) / Math.sqrt(rsh) + phi / Math.sqrt(rw);
    expect(k * sw).toBeCloseTo(1 / Math.sqrt(rt), 12);
    expect(sw).toBeCloseTo(1 / (Math.sqrt(rt) * k), 12);
    expect(sw).toBeCloseTo(0.19469, 4);
  });
});

describe('libro: volumétrico (Dake) a través de cutoffs → zone-summary → volumetrics', () => {
  const FT = 0.3048;
  const ACRE_KM2 = 4046.8564224 / 1e6;

  /** Pozo de `nFt` muestras de 1 pie, una zona de reservorio con φ, Sw y Vsh constantes (todo pasa los cutoffs). */
  function reservoir(nFt: number, phi: number, sw: number, params: Record<string, number | string>): EngineRunResult {
    const w = well(
      [curve('PHIE', 'PHIE', filled(nFt, phi)), curve('SW', 'SW', filled(nFt, sw)), curve('VSH', 'VSH', filled(nFt, 0.1))],
      nFt,
      2000,
      FT,
    );
    const z: Zone = { ...zone('r', 2000, 2000 + (nFt - 1) * FT + 0.01), kind: 'reservoir' };
    const r = run(w, { params: { global: {}, zones: { [z.id]: params } } }, [z]);
    for (const id of ['cutoffs', 'zone-summary', 'volumetrics']) expect(status(r, id), id).toBe('ok');
    return r;
  }

  it('petróleo: A = 600 acres, h = 28 ft, φ = 0,205, Sw = 0,20, Bo = 1,56 → 7758·A·h·φ·(1 − Sw)/Bo = 13,70 MMSTB (13 701 822 STB)', () => {
    const r = reservoir(28, 0.205, 0.2, { area: 600 * ACRE_KM2, fluid: 'oil', bo: 1.56 });
    // h·φ·Sh = 28 ft · 0,205 · 0,8 = 4,592 ft
    expect(out(r, 'zone-summary:HPHISH_TOTAL') as number).toBeCloseTo(28 * FT * 0.205 * 0.8, 10);
    expect(out(r, 'zone-summary:NET_PAY_TOTAL') as number).toBeCloseTo(28 * FT, 10);
    const stb = (out(r, 'volumetrics:OOIP_TOTAL') as number) / 0.158987294928; // m³ → STB (1 bbl = 0,158987294928 m³)
    const book7758 = 7758 * 600 * 28 * 0.205 * 0.8 / 1.56; // 13 701 822 STB con la constante redondeada
    expect(book7758).toBeCloseTo(13_701_821.5, 0);
    expect(Math.abs(stb - book7758) / book7758).toBeLessThan(1e-4); // 7758,37 vs 7758: 0,005 %
    expect(stb).toBeCloseTo((43560 / 5.614583333) * 600 * 28 * 0.205 * 0.8 / 1.56, -2); // 43 560 ft³ ÷ 5,6146 ft³/bbl
    // la tabla en unidades de campo
    const row = (out(r, 'volumetrics:VOLUMETRICS') as { rows: Record<string, number | string | null>[] }).rows[0]!;
    expect(row['ooipField'] as number).toBeCloseTo(stb / 1e6, 6);
    expect(row['ogipField']).toBeNull();
  });

  it('gas: A = 640 acres, h = 20 ft, φ = 0,15, Sw = 0,25, Bg = 0,005 → 43 560·A·h·φ·(1 − Sw)/Bg = 12,545 Bcf', () => {
    const r = reservoir(20, 0.15, 0.25, { area: 640 * ACRE_KM2, fluid: 'gas', bg: 0.005 });
    const scf = (out(r, 'volumetrics:OGIP_TOTAL') as number) / 0.028316846592; // m³ → ft³ estándar
    const book = (43560 * 640 * 20 * 0.15 * 0.75) / 0.005; // 1,254528e10 scf
    expect(book).toBeCloseTo(1.254528e10, -3);
    expect(Math.abs(scf - book) / book).toBeLessThan(1e-9);
    expect(out(r, 'volumetrics:OOIP_TOTAL') as number).toBe(0);
    const row = (out(r, 'volumetrics:VOLUMETRICS') as { rows: Record<string, number | string | null>[] }).rows[0]!;
    expect(row['ogipField'] as number).toBeCloseTo(12.54528, 9);
    expect(row['ooipField']).toBeNull();
  });
});

describe('libro: neutrón en unidades de caliza leído en arenisca', () => {
  it('la corrección de matriz se SUMA: NPHI = 0,16 con +0,04 → φN = 0,20', () => {
    const N = 4;
    const w = well([curve('NPHI', 'NPHI', filled(N, 0.16))], N);
    const r = run(w, { params: { global: { 'phi-neutron.matrixOffset': 0.04 }, zones: {} } });
    expect(status(r, 'phi-neutron')).toBe('ok');
    expect((out(r, 'phi-neutron:PHIN') as Float64Array)[1]).toBeCloseTo(0.2, 12);
  });
});
