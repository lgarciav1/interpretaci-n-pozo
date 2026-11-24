/**
 * Panel «Análisis MICP» (src/modules/micp): muestras desde un conjunto `capillary`, ajustes guardados con deshacer,
 * tabla de ajustes y permeabilidad, Sw por altura, permeabilidad relativa y cutoff, y comparación con el CMR. El motor
 * ya está validado contra numpy/scipy en tests/petro-micp-usos.test.ts; acá se prueba el armado del panel.
 */
import { describe, expect, it } from 'vitest';
import tpCsv from '../datos/pozo_tp_perfiles.csv?raw';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { addPointSet } from '../src/core/state/pointSets';
import { addWell, createProject, getWellEntry } from '../src/core/state/project';
import { createWell } from '../src/core/well';
import { registry } from '../src/modules';
import micp, { MICP_ID } from '../src/modules/micp';
import {
  applySwCutoff,
  cmrConclusion,
  cmrRows,
  cutoffSummary,
  DEFAULT_MICP_SETTINGS,
  entryHeights,
  fitRows,
  gradientDensities,
  heightContext,
  heightCurve,
  logHeightPoints,
  measuredBv,
  micpSamples,
  readMicpSettings,
  relpermCurves,
  relpermRows,
  tableVsSwanson,
  thomeerCurve,
  writeMicpSettings,
  zonesWithSamples,
} from '../src/modules/micp/model';
import { tpMicpSet } from '../src/modules/rock-typing/tp';
import { fractionalFlowWater, swAtHeightFromCurve } from '../src/petro/micp';

const W = 'w';
const project = () => addWell(createProject(), createWell({ id: W, name: 'Pozo TP', depth: Float64Array.from({ length: 10 }, (_, i) => 7800 + i), curves: [], pointSets: [] }), []);
const samples = micpSamples([tpMicpSet('m')]);
const by = (name: string) => samples.find((s) => s.label === name)!;
const ctx = heightContext(DEFAULT_MICP_SETTINGS);

describe('micp: registro y muestras', () => {
  it('módulo de panel registrado con documentación de ecuaciones y referencias', () => {
    expect(registry.panels.some((p) => p.id === MICP_ID)).toBe(true);
    expect(micp.docs.equations.length).toBeGreaterThanOrEqual(7);
    expect(micp.docs.references.join(' ')).toMatch(/Thomeer[\s\S]*Swanson[\s\S]*Burdine/);
  });

  it('8 muestras del TP con profundidad, k de la tabla SCAL y k del plug del mismo número (hoja PB)', () => {
    expect(samples).toHaveLength(8);
    expect(by('1-32')).toMatchObject({ plugId: 'C1-32', kTable: 92.4, kPlug: 108, tp: true });
    expect(by('1-32').depthM).toBeCloseTo(7827.391, 3);
    expect(by('2-6L')).toMatchObject({ plugId: 'C2-06', kPlug: 3.67 });
    expect(micpSamples([])).toEqual([]);
  });
});

describe('micp: ajustes del panel (moduleState, un Ctrl+Z)', () => {
  it('de fábrica: petróleo–agua, Δρ 0,25, sin FWL, columna 100 m, μw 0,5 y μo 1 cP', () => {
    expect(readMicpSettings(undefined)).toEqual(DEFAULT_MICP_SETTINGS);
    expect(heightContext(DEFAULT_MICP_SETTINGS).deltaRhoGcc).toBeCloseTo(0.25, 12);
    expect(readMicpSettings({ system: 'x', rhoWater: -1, columnM: 'a' } as never)).toEqual(DEFAULT_MICP_SETTINGS);
  });

  it('guardar y deshacer; al pasar a gas–agua la densidad del hidrocarburo vuelve a 0,25', () => {
    const p0 = project();
    const p1 = writeMicpSettings(p0, W, DEFAULT_MICP_SETTINGS, { fwlM: 7906, system: 'gas-water' });
    const s1 = readMicpSettings(getWellEntry(p1, W).interpretation.moduleState?.[MICP_ID]);
    expect(s1).toMatchObject({ system: 'gas-water', rhoHc: 0.25, fwlM: 7906 });
    const back = undo(recordChange(emptyHistory(), p0, 'Ajustes MICP', 0), p1)!;
    expect(getWellEntry(back.project, W).interpretation.moduleState?.[MICP_ID]).toBeUndefined();
    const p2 = writeMicpSettings(p1, W, s1, { fwlM: null });
    expect(readMicpSettings(getWellEntry(p2, W).interpretation.moduleState?.[MICP_ID]).fwlM).toBeNull();
  });
});

describe('micp: ajustes y permeabilidad', () => {
  const rows = fitRows(samples);

  it('Thomeer y Brooks–Corey en las 8 muestras; k de Swanson y de Thomeer positivas', () => {
    for (const r of rows) {
      expect(r.thomeer, r.sample.label).not.toBeNull();
      expect(r.brooksCorey, r.sample.label).not.toBeNull();
      expect(r.kSwanson).toBeGreaterThan(0);
      expect(r.kThomeer).toBeGreaterThan(0);
    }
  });

  it('la k de la tabla SCAL coincide con Swanson dentro del 0,7 % en 6 de 8 muestras', () => {
    expect(tableVsSwanson(rows)).toEqual({ within: 6, n: 8 });
  });

  it('Bv medido = (1 − Sw)·φ·100 y la hipérbola ajustada parte de Pd y sube hasta casi Bv∞', () => {
    const s = by('1-32');
    expect(measuredBv(s)[0]).toBe(0);
    expect(measuredBv(s).at(-1)!).toBeCloseTo((1 - 0.0178) * s.phi * 100, 9);
    const t = rows.find((r) => r.sample.label === '1-32')!.thomeer!;
    const c = thomeerCurve(t, s.pcPsi.at(-1)!);
    expect(c.pc[0]).toBeGreaterThan(t.pd);
    for (let i = 1; i < c.bv.length; i++) expect(c.bv[i]!).toBeGreaterThanOrEqual(c.bv[i - 1]!);
    expect(c.bv.at(-1)!).toBeLessThanOrEqual(t.bvInfPct);
  });
});

describe('micp: altura sobre el agua libre', () => {
  it('curva Sw–altura: h = 0 con Sw = 1, cada escalón medido a su altura y Sw igual a la del motor', () => {
    const s = by('1-2');
    const c = heightCurve(s, ctx);
    expect(c.h[0]).toBe(0);
    expect(c.sw[0]).toBe(1);
    for (let i = 1; i < c.h.length; i++) expect(c.h[i]!).toBeGreaterThan(c.h[i - 1]!);
    const k = 20;
    expect(swAtHeightFromCurve(s.pcPsi, s.sw, c.h[k]!, ctx)).toBeCloseTo(c.sw[k]!, 9);
  });

  it('altura de entrada con la Pd de Thomeer; gas–agua da alturas distintas que petróleo–agua', () => {
    const rows = fitRows(samples);
    const h = entryHeights(rows, ctx);
    expect(h.every((v) => v > 0)).toBe(true);
    const hg = entryHeights(rows, heightContext({ ...DEFAULT_MICP_SETTINGS, system: 'gas-water', rhoHc: 0.25 }));
    expect(hg[0]).not.toBeCloseTo(h[0]!, 3);
  });

  it('puntos del perfil: solo en las zonas con muestras, sobre el FWL, h = FWL − profundidad', () => {
    const zones = [
      { id: 'a', name: 'A', top: 7700, base: 7800 },
      { id: 'b', name: 'B', top: 7800, base: 7900 },
    ];
    expect(zonesWithSamples(zones, samples).map((z) => z.id)).toEqual(['b']);
    const pts = logHeightPoints([7750, 7820, 7850, 7950], [0.5, 0.4, 2, 0.3], zonesWithSamples(zones, samples), 7880);
    expect([...pts.sw]).toEqual([0.4]);
    expect(pts.h[0]).toBeCloseTo(60, 9);
  });

  it('densidad de los gradientes MDT del TP: zona B 0,95 g/cm³ (crudo pesado o agua dulce); zona D 1,69 (no es un fluido)', () => {
    const [b, d] = gradientDensities();
    expect(b!.densityGcc).toBeCloseTo(0.9506, 3);
    expect(d!.densityGcc).toBeGreaterThan(1.6);
  });
});

describe('micp: permeabilidad relativa y cutoff de Sw', () => {
  const rows = relpermRows(samples, DEFAULT_MICP_SETTINGS, ctx);

  it('Swirr = Sw de la curva a la altura de la columna; λ ajustado con ese Swirr fijo', () => {
    for (const r of rows) {
      const want = swAtHeightFromCurve(r.sample.pcPsi, r.sample.sw, 100, ctx);
      if (Number.isNaN(want)) expect(r.swirr).toBeNaN();
      else expect(r.swirr).toBeCloseTo(want, 12);
      if (Number.isFinite(r.swirr)) {
        expect(r.fit?.swirrAtBound).toBe('fixed');
        expect(r.fit!.lambda).toBeGreaterThan(0);
      }
    }
  });

  it('fw(cutoff) = 0,5; la banda μw/μo 0,25 → 2 contiene el cutoff (μw/μo = 0,5) y sube con μw', () => {
    for (const r of rows.filter((x) => x.fit)) {
      expect(fractionalFlowWater(r.cutoff, r.fit!.lambda, r.fit!.swirr, 0.5, 1)).toBeCloseTo(0.5, 9);
      expect(r.band[0]).toBeLessThan(r.cutoff);
      expect(r.band[1]).toBeGreaterThan(r.cutoff);
    }
    const sum = cutoffSummary(rows)!;
    expect(sum.n).toBeGreaterThanOrEqual(6);
    expect(sum.median).toBeGreaterThan(0.3);
    expect(sum.median).toBeLessThan(0.9);
  });

  it('curvas krw (0 → 1), kro (1 → 0) y fw (0 → 1) de Swirr a 1', () => {
    const f = rows.find((r) => r.fit)!.fit!;
    const c = relpermCurves(f, 0.5, 1);
    expect(c.sw[0]).toBeCloseTo(f.swirr, 12);
    expect(c.krw[0]).toBe(0);
    expect(c.kro[0]).toBe(1);
    expect(c.krw.at(-1)).toBe(1);
    expect(c.kro.at(-1)).toBe(0);
    expect(c.fw.at(-1)).toBe(1);
  });

  it('«Usar Sw cutoff»: escribe el swCutoff global redondeado a 0,01 (un Ctrl+Z)', () => {
    const p0 = project();
    const p1 = applySwCutoff(p0, W, 0.6537);
    expect(getWellEntry(p1, W).interpretation.params.global['swCutoff']).toBe(0.65);
    const back = undo(recordChange(emptyHistory(), p0, 'Usar Sw cutoff', 0), p1)!;
    expect(getWellEntry(back.project, W).interpretation.params.global['swCutoff']).toBeUndefined();
  });
});

describe('micp: CMR contra la curva capilar (perfil del TP)', () => {
  const lines = tpCsv.trim().split(/\r?\n/);
  const head = lines[0]!.split(',');
  const col = (name: string) =>
    lines.slice(1).map((l) => {
      const v = l.split(',')[head.indexOf(name)];
      return v === undefined || v === '' ? NaN : Number(v);
    });
  const rows = cmrRows(col('DEPTH'), col('PHI_BVI'), col('PHIE_CMR'), samples, ctx);

  it('ventana de ±1 m (13 muestras del perfil); Sw a la calibración del CMR 0,21–0,36; la 2-15 no llega', () => {
    for (const r of rows) expect(r.nWindow).toBeGreaterThanOrEqual(12);
    expect(by('2-15') && Number.isNaN(rows.find((r) => r.sample.label === '2-15')!.swCal)).toBe(true);
    const c = cmrConclusion(rows)!;
    expect(c.n).toBe(7);
    expect(c.lab[0]).toBeGreaterThan(0.2);
    expect(c.lab[1]).toBeLessThan(0.37);
    expect(c.cmr[0]).toBeGreaterThan(0.6);
    expect(c.cmr[1]).toBeLessThan(0.85);
    // El CMR declara entre 1,9 y 3,5 veces (ventana ±1 m) más agua ligada que la curva a la presión de calibración.
    expect(c.ratio[0]).toBeGreaterThan(1.8);
    expect(c.ratio[1]).toBeLessThan(3.6);
  });

  it('sin datos del CMR no hay conclusión', () => {
    expect(cmrConclusion(cmrRows([], [], [], samples, ctx))).toBeNull();
  });
});

describe('micp: integración con el conjunto del pozo', () => {
  it('las muestras salen de cualquier conjunto `capillary` del pozo', () => {
    const p = addPointSet(project(), W, tpMicpSet('micp-1'));
    expect(micpSamples(getWellEntry(p, W).well.pointSets)).toHaveLength(8);
  });
});

