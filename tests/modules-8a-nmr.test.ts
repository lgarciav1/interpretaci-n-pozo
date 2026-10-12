/**
 * Módulo nmr-fluids (fase 8a, X): valores por muestra contra cuentas escritas en el test (no las funciones de petro),
 * tolerancia por zona, entradas opcionales ausentes (NaN y aviso por zona) y corrida sobre el pozo real del TP
 * (datos/pozo_tp_perfiles.csv). Ver src/petro/nmr.ts para las ecuaciones y su respaldo.
 */
import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell, type EngineCurve, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import type { Zone } from '../src/core/well';
import { registry } from '../src/modules';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { curve, well, zone } from './helpers';

// --- pozo sintético: 12 muestras cada 0,5 m (1000–1005,5 m), dos zonas de 6 -----------------------------------------
const N = 12;
const ZONES: Zone[] = [zone('za', 1000, 1002.5), zone('zb', 1003, 1005.5)];
const ZB = ZONES[1]!.id;

//                  0     1     2     3     4     5     6     7     8     9     10    11
const PHIT_NMR = [0.30, 0.25, 0.22, 0.20, 0.18, 0.12, 0.30, 0.25, 0.22, 0.20, NaN, 0.12];
const PHIE_NMR = [0.24, 0.20, 0.19, 0.18, 0.15, 0.00, 0.24, 0.20, 0.19, 0.18, 0.15, 0.00];
const BVI = [0.10, 0.08, 0.19, 0.20, 0.05, 0.00, 0.10, 0.08, 0.19, 0.20, 0.05, 0.00];
//   Muestra 3 y 9: BVI > PHIE_NMR (ruido). Muestra 5 y 11: PHIE_NMR = 0 (lutita). Muestra 10: sin PHIT_NMR.
const PHIE = [0.25, 0.20, 0.25, 0.14, 0.15, 0.00, 0.25, 0.20, 0.25, 0.14, NaN, 0.02];
//   Δφ = PHIE_NMR − PHIE:
//     0: −0,01  1: 0  2: −0,06 (déficit)  3: +0,04  4: 0  5: 0
//     6: −0,01  7: 0  8: −0,06            9: +0,04  10: sin PHIE → NaN  11: −0,02

const run = (curves: EngineCurve[], partial: Partial<Interpretation> = {}): EngineRunResult => {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(well(curves, N, 1000, 0.5));
  return engine.run({ ...emptyInterpretation(ZONES), compare: ['nmr-fluids'], ...partial });
};

const allCurves = () => [
  curve('PHIT_CMR', 'PHIT_NMR', PHIT_NMR),
  curve('PHIE_CMR', 'PHIE_NMR', PHIE_NMR),
  curve('PHI_BVI', 'BVI_NMR', BVI),
  curve('PHIE_DN', 'PHIE', PHIE),
];

function out(r: EngineRunResult, role: string): Float64Array {
  const o = r.outputs.find((x) => x.key === `nmr-fluids:${role}`);
  if (!o) throw new Error(`Falta la salida nmr-fluids:${role}`);
  return o.value as Float64Array;
}
// Avisos y errores del propio módulo (los demás módulos del registro, sin sus curvas de entrada, informan lo suyo).
const warnings = (r: EngineRunResult) => r.diagnostics.filter((d) => d.level === 'warning' && d.moduleId === 'nmr-fluids').map((d) => d.message);
const errors = (r: EngineRunResult) => r.diagnostics.filter((d) => d.level === 'error' && d.moduleId === 'nmr-fluids');
function same(actual: Float64Array, expected: number[]) {
  expect(actual.length).toBe(expected.length);
  expected.forEach((e, i) => {
    if (Number.isNaN(e)) expect(actual[i], `muestra ${i}`).toBeNaN();
    else expect(actual[i], `muestra ${i}`).toBeCloseTo(e, 12);
  });
}

describe('módulo nmr-fluids: registro y esquema', () => {
  const m = registry.modules.find((x) => x.id === 'nmr-fluids')!;

  it('está registrado después de perm-coates, en la categoría propia «Resonancia magnética» del espacio Petrofísica', () => {
    const ids = registry.modules.map((x) => x.id);
    expect(ids.indexOf('nmr-fluids')).toBe(ids.indexOf('perm-coates') + 1);
    expect(m.category).toBe('nmr');
    expect(m.workspace).toBe('petrophysics');
    expect(m.name).toBe('Resonancia magnética — fluido libre y ligado');
  });

  it('tolerancia por zona con 0,03 v/v por defecto; documentación con ecuaciones y referencias', () => {
    expect(m.params['tolerance']).toMatchObject({ type: 'number', default: 0.03, scope: 'zone', unit: 'v/v' });
    expect(m.docs.equations.length).toBeGreaterThanOrEqual(5);
    expect(m.docs.references.join(' ')).toContain('Coates');
    expect(m.docs.references.join(' ')).toContain('Asquith');
  });
});

describe('módulo nmr-fluids: valores por muestra (pozo sintético)', () => {
  const r = run(allCurves());

  it('corre en ok y sin errores', () => {
    expect(errors(r)).toEqual([]);
    expect(r.nodes.find((x) => x.moduleId === 'nmr-fluids')?.status).toBe('ok');
  });

  it('FFI = PHIE_NMR − BVI, con 0 donde BVI ≥ PHIE_NMR', () => {
    same(out(r, 'FFI_NMR'), [0.14, 0.12, 0, 0, 0.1, 0, 0.14, 0.12, 0, 0, 0.1, 0]);
  });

  it('CBW = PHIT_NMR − PHIE_NMR; NaN donde falta PHIT_NMR', () => {
    same(out(r, 'CBW_NMR'), [0.06, 0.05, 0.03, 0.02, 0.03, 0.12, 0.06, 0.05, 0.03, 0.02, NaN, 0.12]);
  });

  it('Swirr RMN = BVI / PHIE_NMR (1 si BVI > PHIE_NMR; NaN si PHIE_NMR = 0)', () => {
    same(out(r, 'SWIRR_NMR'), [10 / 24, 0.4, 1, 1, 1 / 3, NaN, 10 / 24, 0.4, 1, 1, 1 / 3, NaN]);
  });

  it('Δφ = PHIE_NMR − PHIE; NaN donde falta PHIE', () => {
    same(out(r, 'DPHI_NMR'), [-0.01, 0, -0.06, 0.04, 0, 0, -0.01, 0, -0.06, 0.04, NaN, -0.02]);
  });

  it('déficit con tolerancia 0,03: solo Δφ < −0,03 (muestras 2 y 8); NaN sin PHIE', () => {
    same(out(r, 'IND_NMR_DEFICIT'), [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, NaN, 0]);
  });

  it('PHIT_NMR − (CBW + BVI + FFI) = 0 donde BVI ≤ PHIE_NMR ≤ PHIT_NMR (partición de libro)', () => {
    const cbw = out(r, 'CBW_NMR');
    const ffi = out(r, 'FFI_NMR');
    for (const i of [0, 1, 2, 4, 5, 6, 7, 8, 11]) {
      if (BVI[i]! > PHIE_NMR[i]!) continue;
      expect(cbw[i]! + BVI[i]! + ffi[i]!, `muestra ${i}`).toBeCloseTo(PHIT_NMR[i]!, 12);
    }
  });

  it('sin avisos cuando están todas las entradas', () => {
    expect(warnings(r)).toEqual([]);
  });
});

describe('módulo nmr-fluids: tolerancia por zona', () => {
  it('con 0,08 en la zona B el déficit de la muestra 8 desaparece y la A no cambia; con 0,005 marca más', () => {
    const r = run(allCurves(), { params: { global: {}, zones: { [ZB]: { 'nmr-fluids.tolerance': 0.08 } } } });
    same(out(r, 'IND_NMR_DEFICIT'), [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, NaN, 0]);
    const r2 = run(allCurves(), { params: { global: { 'nmr-fluids.tolerance': 0.005 }, zones: {} } });
    // Δφ < −0,005: muestras 0 (−0,01), 2, 6, 8 y 11 (−0,02)
    same(out(r2, 'IND_NMR_DEFICIT'), [1, 0, 1, 0, 0, 0, 1, 0, 1, 0, NaN, 1]);
  });

  it('borde: Δφ exactamente −tolerancia no marca (0,24 − 0,27 con tolerancia 0,03)', () => {
    const c = [
      curve('PHIE_CMR', 'PHIE_NMR', Array(N).fill(0.24)),
      curve('PHI_BVI', 'BVI_NMR', Array(N).fill(0.1)),
      curve('PHIE_DN', 'PHIE', Array(N).fill(0.27)),
    ];
    const f = out(run(c), 'IND_NMR_DEFICIT');
    expect(Array.from(f)).toEqual(Array(N).fill(0));
  });
});

describe('módulo nmr-fluids: entradas opcionales ausentes', () => {
  it('sin PHIT_NMR: CBW queda NaN, el resto se calcula y se avisa por zona', () => {
    const r = run(allCurves().filter((c) => c.id !== 'PHIT_CMR'));
    expect(Array.from(out(r, 'CBW_NMR')).every(Number.isNaN)).toBe(true);
    same(out(r, 'FFI_NMR'), [0.14, 0.12, 0, 0, 0.1, 0, 0.14, 0.12, 0, 0, 0.1, 0]);
    same(out(r, 'DPHI_NMR'), [-0.01, 0, -0.06, 0.04, 0, 0, -0.01, 0, -0.06, 0.04, NaN, -0.02]);
    const w = warnings(r).filter((m) => m.includes('porosidad total de RMN'));
    expect(w).toHaveLength(2);
    expect(w.some((m) => m.includes('zona ZA'))).toBe(true);
    expect(w.some((m) => m.includes('zona ZB'))).toBe(true);
  });

  it('sin PHIE: Δφ y el indicador quedan NaN, FFI, CBW y Swirr se calculan, y se avisa por zona', () => {
    const r = run(allCurves().filter((c) => c.id !== 'PHIE_DN'));
    expect(Array.from(out(r, 'DPHI_NMR')).every(Number.isNaN)).toBe(true);
    expect(Array.from(out(r, 'IND_NMR_DEFICIT')).every(Number.isNaN)).toBe(true);
    same(out(r, 'CBW_NMR'), [0.06, 0.05, 0.03, 0.02, 0.03, 0.12, 0.06, 0.05, 0.03, 0.02, NaN, 0.12]);
    const w = warnings(r).filter((m) => m.includes('porosidad efectiva de perfiles'));
    expect(w).toHaveLength(2);
    expect(w.some((m) => m.includes('zona ZA'))).toBe(true);
    expect(w.some((m) => m.includes('zona ZB'))).toBe(true);
  });

  it('con solo PHIE_NMR y BVI_NMR (obligatorias) corre igual', () => {
    const r = run(allCurves().filter((c) => c.id === 'PHIE_CMR' || c.id === 'PHI_BVI'));
    expect(r.nodes.find((x) => x.moduleId === 'nmr-fluids')?.status).toBe('ok');
    same(out(r, 'SWIRR_NMR'), [10 / 24, 0.4, 1, 1, 1 / 3, NaN, 10 / 24, 0.4, 1, 1, 1 / 3, NaN]);
  });
});

// --- pozo real del TP -----------------------------------------------------------------------------------------------
describe('módulo nmr-fluids sobre el pozo del TP (datos/pozo_tp_perfiles.csv)', () => {
  const { well: tp, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry);
  engine.setWell(toEngineWell(tp));
  const r = engine.run({ ...emptyInterpretation(zones), compare: ['nmr-fluids'] });

  // Columnas leídas del texto crudo del CSV, sin pasar por el lector: independiente de la tabla de mnemónicos.
  const lines = csvText.trim().split(/\r?\n/);
  const header = lines[0]!.split(',');
  const col = (name: string) => lines.slice(1).map((l) => Number(l.split(',')[header.indexOf(name)]));
  const bvi = col('PHI_BVI');
  const phie = col('PHIE_CMR');
  const phit = col('PHIT_CMR');

  it('el módulo corre en ok sobre las 5810 muestras', () => {
    expect(errors(r)).toEqual([]);
    expect(r.nodes.find((x) => x.moduleId === 'nmr-fluids')?.status).toBe('ok');
    expect(out(r, 'FFI_NMR')).toHaveLength(5810);
  });

  it('muestras elegidas: 7633,2588 m (lutita), 8090,4588 m (D), 8395,2588 m (E) y la última (8518,5504 m)', () => {
    const ffi = out(r, 'FFI_NMR');
    const cbw = out(r, 'CBW_NMR');
    const sw = out(r, 'SWIRR_NMR');
    // índice 0: PHI_BVI 0,013, PHIE_CMR 0,04, PHIT_CMR 0,197 → FFI 0,027, CBW 0,157, Swirr 0,325
    expect(ffi[0]).toBeCloseTo(0.027, 12);
    expect(cbw[0]).toBeCloseTo(0.157, 12);
    expect(sw[0]).toBeCloseTo(0.325, 12);
    // índice 3000: 0,123 / 0,177 / 0,179 → FFI 0,054, CBW 0,002, Swirr 0,123/0,177
    expect(ffi[3000]).toBeCloseTo(0.054, 12);
    expect(cbw[3000]).toBeCloseTo(0.002, 12);
    expect(sw[3000]).toBeCloseTo(0.123 / 0.177, 12);
    // índice 5000: 0,101 / 0,167 / 0,173 → FFI 0,066, CBW 0,006
    expect(ffi[5000]).toBeCloseTo(0.066, 12);
    expect(cbw[5000]).toBeCloseTo(0.006, 12);
    expect(sw[5000]).toBeCloseTo(0.101 / 0.167, 12);
    // última: 0,003 / 0,003 / 0,009 → FFI 0, CBW 0,006, Swirr 1
    expect(ffi[5809]).toBeCloseTo(0, 12);
    expect(cbw[5809]).toBeCloseTo(0.006, 12);
    expect(sw[5809]).toBeCloseTo(1, 12);
  });

  it('todas las muestras: FFI, CBW y Swirr salen de las columnas crudas y respetan la partición PHIT = CBW + BVI + FFI', () => {
    const ffi = out(r, 'FFI_NMR');
    const cbw = out(r, 'CBW_NMR');
    const sw = out(r, 'SWIRR_NMR');
    let nanSw = 0;
    for (let i = 0; i < 5810; i++) {
      expect(ffi[i]).toBeCloseTo(Math.max(0, phie[i]! - bvi[i]!), 12);
      expect(cbw[i]).toBeCloseTo(Math.max(0, phit[i]! - phie[i]!), 12);
      if (phie[i] === 0) {
        expect(sw[i]).toBeNaN();
        nanSw++;
      } else {
        expect(sw[i]).toBeCloseTo(Math.min(1, bvi[i]! / phie[i]!), 12);
      }
      // el CSV del TP no tiene BVI > PHIE_CMR ni PHIT_CMR < PHIE_CMR: la partición es exacta
      expect(cbw[i]! + bvi[i]! + ffi[i]!).toBeCloseTo(phit[i]!, 12);
    }
    expect(nanSw).toBe(13); // 13 muestras con PHIE_CMR = 0
  });

  it('Δφ y el indicador usan la PHIE de densidad–neutrón que alimenta la cadena', () => {
    const src = r.sources['PHIE'];
    expect(src).toBeDefined();
    const phieDn = r.outputs.find((o) => o.key === `${(src as { moduleId: string }).moduleId}:PHIE`)?.value as Float64Array;
    expect(phieDn).toBeDefined();
    const dphi = out(r, 'DPHI_NMR');
    const flag = out(r, 'IND_NMR_DEFICIT');
    let marked = 0;
    for (let i = 0; i < 5810; i++) {
      const d = phie[i]! - phieDn[i]!;
      if (Number.isNaN(d)) {
        expect(dphi[i]).toBeNaN();
        expect(flag[i]).toBeNaN();
        continue;
      }
      expect(dphi[i]).toBeCloseTo(d, 12);
      // la tolerancia por defecto es 0,03 en todas las zonas
      expect(flag[i]).toBe(d < -0.03 - 1e-9 ? 1 : 0);
      marked += flag[i]!;
    }
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThan(5810);
  });
});
