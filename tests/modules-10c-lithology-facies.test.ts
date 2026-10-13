import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import { registry } from '../src/modules';
import { moduleOverlays } from '../src/app/viewerOverlays';
import { BUILTIN_LAYOUTS, withOverlayTracks } from '../src/viewer/templates';
import { classColors } from '../src/modules/lithology-facies/draw';
import { CLASS_COUNT, IMPORTANCE_TABLE, LITHOLOGY_FACIES_ID, PORT, SUMMARY_TABLE } from '../src/modules/lithology-facies/model';
import { EF_CLUSTERS_TABLE, EF_PORT, EF_SCAN_TABLE, K_VALUES, suggestK } from '../src/modules/electrofacies/model';
import { contrastRatio } from '../src/ui/color';
import { THEMES } from '../src/ui/tokens';
import { curve, interp, well as synthWell } from './helpers';

const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
const engine = new Engine(registry, { checkInputs: true });
engine.setWell(toEngineWell(well));
const result = engine.run(emptyInterpretation(zones));
const out = (port: string, r = result) => r.outputs.find((o) => o.port === port && o.moduleId === LITHOLOGY_FACIES_ID)?.value;
const warnings = (r = result) => r.diagnostics.filter((d) => d.moduleId === LITHOLOGY_FACIES_ID).map((d) => d.message);

describe('Fase 10c: litología sugerida por random forest', () => {
  it('corre sobre el pozo del TP con el modelo sin PE por el PE sospechoso', () => {
    expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    const w = warnings();
    expect(w.some((m) => m.includes('PE sospechoso de baritina') && m.includes('sin PE'))).toBe(true);
    expect(w.some((m) => m.includes('Mar del Norte') && m.includes('no una litología medida'))).toBe(true);
  });

  it('produce clases FORCE válidas, probabilidades en [0, 1] y ordenadas', () => {
    const cls = out(PORT.cls) as Float64Array;
    const p1 = out(PORT.conf) as Float64Array;
    const p2 = out(PORT.conf2) as Float64Array;
    const p3 = out(PORT.conf3) as Float64Array;
    const cls2 = out(PORT.cls2) as Float64Array;
    const n = well.depth.values.length;
    expect(cls).toHaveLength(n);
    let valid = 0;
    const counts = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(cls[i]!)) {
        expect(Number.isNaN(p1[i]!)).toBe(true); // sin dato: sin probabilidad, no una clase
        continue;
      }
      valid++;
      expect(Number.isInteger(cls[i]!) && cls[i]! >= 0 && cls[i]! < CLASS_COUNT).toBe(true);
      expect(p1[i]!).toBeGreaterThan(0);
      expect(p1[i]!).toBeLessThanOrEqual(1);
      expect(p2[i]!).toBeLessThanOrEqual(p1[i]! + 1e-7);
      expect(p3[i]!).toBeLessThanOrEqual(p2[i]! + 1e-7);
      expect(p1[i]! + p2[i]! + p3[i]!).toBeLessThanOrEqual(1 + 1e-5);
      expect(cls2[i]).not.toBe(cls[i]);
      counts.set(cls[i]!, (counts.get(cls[i]!) ?? 0) + 1);
    }
    expect(valid / n).toBeGreaterThan(0.95);
    // Pozo clástico: arenisca y lutita dominan la sugerencia.
    const top2 = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
    expect(new Set(top2)).toEqual(new Set([0, 2]));
  });

  it('el resumen por clase cierra en espesor y proporción', () => {
    const rows = (out(SUMMARY_TABLE) as TableValue).rows;
    expect(rows.length).toBeGreaterThan(1);
    const pct = rows.reduce((s, r) => s + (r.percent as number), 0);
    expect(pct).toBeCloseTo(100, 6);
    for (const r of rows) {
      expect(r.meanP as number).toBeGreaterThan(0);
      expect(r.meanP as number).toBeLessThanOrEqual(1);
      expect(r.uncertain as number).toBeGreaterThanOrEqual(0);
    }
  });

  it('«usar PE» fuerza el modelo con PE y lo avisa', () => {
    const r = engine.run({ ...emptyInterpretation(zones), params: { global: { [`${LITHOLOGY_FACIES_ID}.peUsage`]: 'use' }, zones: {} } });
    expect(warnings(r).some((m) => m.includes('PE usado por elección del usuario'))).toBe(true);
  });

  it('sin curvas suficientes la salida queda vacía y avisada', () => {
    const e = new Engine(registry, { checkInputs: true });
    e.setWell(synthWell([curve('GR', 'GR', Array.from({ length: 50 }, (_, i) => 40 + i))]));
    const r = e.run(interp());
    const cls = out(PORT.cls, r) as Float64Array;
    expect(cls.every((v) => Number.isNaN(v))).toBe(true);
    expect((out(SUMMARY_TABLE, r) as TableValue).rows).toEqual([]);
    expect(warnings(r).some((m) => m.includes('Faltan curvas'))).toBe(true);
  });

  it('avisa las curvas que el modelo usa y faltan', () => {
    const e = new Engine(registry, { checkInputs: true });
    const n = 60;
    e.setWell(synthWell([
      curve('GR', 'GR', Array.from({ length: n }, (_, i) => (i < 30 ? 30 : 110))),
      curve('RHOB', 'RHOB', Array.from({ length: n }, (_, i) => (i < 30 ? 2.3 : 2.55))),
    ]));
    const r = e.run(interp());
    expect(warnings(r).some((m) => m.includes('usa también') && m.includes('neutrón'))).toBe(true);
    const cls = out(PORT.cls, r) as Float64Array;
    expect(cls.some((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('Pista de litología sugerida', () => {
  it('aparece en Geología con el pozo del TP, junto a la columna sedimentológica', () => {
    const tracks = withOverlayTracks(BUILTIN_LAYOUTS.geology, moduleOverlays([]), 'geology', { well, settings: {} } as never);
    const ids = tracks.map((t) => t.id);
    expect(ids).toContain('ov:lithology-facies');
    expect(ids.indexOf('ov:lithology-facies')).toBe(ids.indexOf('ov:sed-column') + 1);
    const petro = withOverlayTracks(BUILTIN_LAYOUTS.petrophysics, moduleOverlays([]), 'petrophysics', { well, settings: {} } as never);
    expect(petro.map((t) => t.id)).not.toContain('ov:lithology-facies');
  });

  it('12 colores distintos y visibles sobre el fondo de pista en claro y oscuro', () => {
    for (const theme of [THEMES.light, THEMES.dark]) {
      const colors = classColors(theme);
      expect(colors).toHaveLength(CLASS_COUNT);
      expect(new Set(colors).size).toBe(CLASS_COUNT);
      for (const c of colors) expect(contrastRatio(c, theme.viewer.trackBg)).toBeGreaterThanOrEqual(1.25);
    }
  });
});

describe('Fase 10c-2: importancia y electrofacies', () => {
  const rows = (port: string, r = result) => (r.outputs.find((o) => o.port === port)?.value as TableValue | undefined)?.rows ?? [];

  it('publica la importancia MDI del modelo en uso (sin PE en el TP), ordenada y que suma 1', () => {
    const imp = rows(IMPORTANCE_TABLE);
    expect(imp.map((r) => r.feature)).not.toContain('PEF');
    expect(imp.length).toBe(5);
    expect(imp.every((r) => r.variant === 'noPe' && typeof r.reason === 'string')).toBe(true);
    const v = imp.map((r) => r.importance as number);
    expect(v.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 5);
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeLessThanOrEqual(v[i - 1]!);
    expect(imp[0]!.feature).toBe('GR');
    expect(imp.every((r) => typeof r.label === 'string' && r.label !== r.feature)).toBe(true);
  });

  it('suggestK: mínimo interior del BIC, si no el codo; null sin datos', () => {
    expect(suggestK([2, 3, 4, 5], [10, 6, 7, 8])).toBe(3);
    expect(suggestK([2, 3, 4, 5, 6], [100, 90, 30, 25, 20])).toBe(4);
    expect(suggestK([2, 3], [1, 0])).toBeNull();
    expect(suggestK([2, 3, 4], [NaN, NaN, 1])).toBeNull();
  });

  it('el barrido de k da BIC e inercia para 2…8 y marca un k sugerido por método', () => {
    const scan = rows(EF_SCAN_TABLE);
    expect(scan.map((r) => r.k)).toEqual(K_VALUES);
    expect(scan.every((r) => Number.isFinite(r.bic) && Number.isFinite(r.inertia))).toBe(true);
    expect(scan.filter((r) => r.suggestedGmm === 1)).toHaveLength(1);
    expect(scan.filter((r) => r.suggestedKmeans === 1)).toHaveLength(1);
  });

  it('electrofacies automáticas: k sugerido, grupos 0…k−1, probabilidades en [0, 1], tabla que cierra', () => {
    const scan = rows(EF_SCAN_TABLE);
    const k = scan.find((r) => r.suggestedGmm === 1)!.k as number;
    const cls = result.outputs.find((o) => o.port === EF_PORT.cls)!.value as Float64Array;
    const p = result.outputs.find((o) => o.port === EF_PORT.conf)!.value as Float64Array;
    const seen = new Set<number>();
    for (let i = 0; i < cls.length; i++) {
      if (!Number.isFinite(cls[i]!)) continue;
      expect(Number.isInteger(cls[i]!) && cls[i]! >= 0 && cls[i]! < k).toBe(true);
      expect(p[i]!).toBeGreaterThan(0);
      expect(p[i]!).toBeLessThanOrEqual(1 + 1e-6);
      seen.add(cls[i]!);
    }
    expect(seen.size).toBe(k);
    const groups = rows(EF_CLUSTERS_TABLE);
    expect(groups).toHaveLength(k);
    expect(groups.reduce((s, r) => s + (r.percent as number), 0)).toBeCloseTo(100, 6);
    // Numeradas de menor a mayor GR del centro.
    const gr = groups.map((r) => r.gr as number);
    for (let i = 1; i < gr.length; i++) expect(gr[i]!).toBeGreaterThanOrEqual(gr[i - 1]!);
  });

  it('determinístico con semilla y k manual / k-means respetados', () => {
    const params = { global: { 'electrofacies.k': '3', 'electrofacies.method': 'kmeans' }, zones: {} };
    const e1 = new Engine(registry);
    e1.setWell(toEngineWell(well));
    const e2 = new Engine(registry);
    e2.setWell(toEngineWell(well));
    const a = e1.run({ ...emptyInterpretation(zones), params }).outputs.find((o) => o.port === EF_PORT.cls)!.value as Float64Array;
    const b = e2.run({ ...emptyInterpretation(zones), params }).outputs.find((o) => o.port === EF_PORT.cls)!.value as Float64Array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(new Set(Array.from(a).filter(Number.isFinite)).size).toBe(3);
  });

  it('las pistas quedan en orden: columna, litología sugerida, electrofacies', () => {
    const ids = withOverlayTracks(BUILTIN_LAYOUTS.geology, moduleOverlays([]), 'geology', { well, settings: {} } as never).map((t) => t.id);
    const at = ids.indexOf('ov:sed-column');
    expect(ids.slice(at, at + 3)).toEqual(['ov:sed-column', 'ov:lithology-facies', 'ov:electrofacies']);
  });
});
