/**
 * Plantilla de crossplot «RMN vs. densidad–neutrón» (fase 8a, docs/decisiones/0019): ejes, rango, color por Swirr,
 * recta 1:1 y umbral de déficit con la tolerancia del módulo `nmr-fluids`.
 */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation } from '../../src/core/interpretation';
import { CROSSPLOT_TEMPLATES, sanitizePlots } from '../../src/core/plots';
import { defaultRoleCatalog } from '../../src/core/roles';
import { createWell } from '../../src/core/well';
import { NMR_DEFICIT_TOLERANCE_DEFAULT } from '../../src/petro/nmr';
import { crossplotTemplatePatch } from '../../src/plots/crossplot/applyTemplate';
import { nmrDnLines, NMR_DN_RANGE, templateDef } from '../../src/plots/crossplot/templates';
import { PLOT_PARAMS } from '../../src/plots/params';
import type { SeriesContext } from '../../src/plots/trend/series';

const n = 20;
const depth = Float64Array.from({ length: n }, (_, i) => 2000 + i);
const series = (f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i));
const well = createWell({
  id: 'w',
  name: 'W',
  depth,
  curves: [{ id: 'PHIE_CMR', mnemonic: 'PHIE_CMR', role: 'PHIE_NMR', unit: 'v/v', data: series((i) => 0.1 + i * 0.005), origin: { kind: 'measured' as const } }],
});
const computed = [
  { port: 'PHIE', moduleId: 'phie-vsh', label: 'PHIE', data: series((i) => 0.12 + i * 0.005), active: true },
  { port: 'SWIRR_NMR', moduleId: 'nmr-fluids', label: 'Swirr', data: series(() => 0.4), active: true },
];
const ctx = (list = computed): SeriesContext => ({ well, interpretation: { ...emptyInterpretation([]) }, computed: list, catalog: defaultRoleCatalog });

describe('plantilla «RMN vs. densidad–neutrón»', () => {
  it('X = PHIE, Y = PHIE_NMR, lineales en 0–0,4, color por Swirr', () => {
    const def = templateDef('nmr-dn')!;
    expect(def.label).toBe('RMN vs. densidad–neutrón');
    expect([def.x.role, def.y.role, def.colorRole]).toEqual(['PHIE', 'PHIE_NMR', 'SWIRR_NMR']);
    expect([def.x.scale, def.y.scale, def.x.reversed ?? false, def.y.reversed ?? false]).toEqual(['linear', 'linear', false, false]);
    expect(def.x.range).toEqual([0, 0.4]);
    expect(def.y.range).toEqual([0, 0.4]);
  });

  it('aplicada a un pozo con RMN y PHIE: ejes, rango y color por la curva de Swirr', () => {
    const r = crossplotTemplatePatch(ctx(), 'nmr-dn');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch).toMatchObject({ xScale: 'linear', yScale: 'linear', xRange: [0, 0.4], yRange: [0, 0.4], template: 'nmr-dn' });
    expect(r.patch.color).toEqual({ kind: 'curve', curve: expect.stringContaining('SWIRR_NMR') });
  });

  it('sin PHIE explica qué falta', () => {
    const r = crossplotTemplatePatch(ctx([]), 'nmr-dn');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.description).toContain('PHIE');
  });

  it('recta 1:1 y umbral PHIE_NMR = PHIE − tol dentro del rango', () => {
    const l = nmrDnLines(0.03);
    expect(l.oneToOne).toEqual({ x: [0, 0.4], y: [0, 0.4] });
    expect(l.deficit.x[0]).toBeCloseTo(0.03, 12);
    expect(l.deficit.y[0]).toBe(0);
    expect(l.deficit.x[1]).toBe(0.4);
    expect(l.deficit.y[1]).toBeCloseTo(0.37, 12);
    // todos sus puntos cumplen y = x − tol
    l.deficit.x.forEach((x, k) => expect(l.deficit.y[k]).toBeCloseTo(x - 0.03, 12));
    // tol 0 → coincide con la 1:1; tol negativa no tiene sentido y se toma 0
    expect(nmrDnLines(0)).toEqual({ oneToOne: l.oneToOne, deficit: l.oneToOne });
    expect(nmrDnLines(-1).deficit).toEqual(l.oneToOne);
    expect(NMR_DN_RANGE).toEqual([0, 0.4]);
  });

  it('la tolerancia es la del módulo nmr-fluids (por zona) y la plantilla se guarda en el proyecto', () => {
    expect(PLOT_PARAMS.nmrTolerance.storage).toBe('nmr-fluids.tolerance');
    expect(PLOT_PARAMS.nmrTolerance.spec.default).toBe(NMR_DEFICIT_TOLERANCE_DEFAULT);
    expect(CROSSPLOT_TEMPLATES).toContain('nmr-dn');
    const plots = sanitizePlots({ w: { crossplot: { template: 'nmr-dn' } } });
    expect(plots?.['w']?.crossplot?.template).toBe('nmr-dn');
  });
});
