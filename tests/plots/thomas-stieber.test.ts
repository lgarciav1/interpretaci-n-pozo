/**
 * Plantilla Thomas–Stieber del crossplot libre (docs/decisiones/0061): registro, deshabilitada sin VSH o PHIT, capas
 * con los extremos del proyecto, arrastre de los extremos (escrituras, alcance, orden y un solo deshacer por gesto),
 * «Estimar de los datos» y el pozo del TP.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { historyClock, useProject } from '../../src/app/store/project';
import { commitPlotParams } from '../../src/app/plots/connect';
import { Engine, toEngineWell } from '../../src/core/engine/engine';
import { emptyInterpretation } from '../../src/core/interpretation';
import { emptyParamState } from '../../src/core/params';
import { CROSSPLOT_TEMPLATES, sanitizeCrossplot } from '../../src/core/plots';
import { addWell, createProject, getWellEntry } from '../../src/core/state/project';
import { createWell } from '../../src/core/well';
import { readWellFile } from '../../src/io';
import { registry } from '../../src/modules';
import { estimateClayEndpoints } from '../../src/petro/clayDistribution';
import { crossplotTemplatePatch } from '../../src/plots/crossplot/applyTemplate';
import { CROSSPLOT_TEMPLATE_DEFS, templateDef, thomasStieberLayers } from '../../src/plots/crossplot/templates';
import { clayEndpointWrite, clayEstimateWrites, normalizeClayEndpoint, plotParamValue, PLOT_PARAMS } from '../../src/plots/params';
import type { SeriesContext } from '../../src/plots/trend/series';
import { depthRange, zone } from '../helpers';

const GLOBAL = { zoneId: null, text: 'global' };

describe('registro de la plantilla', () => {
  it('está en el tipo del núcleo, en las definiciones (sección litología) y sobrevive al saneamiento', () => {
    expect(CROSSPLOT_TEMPLATES).toContain('thomas-stieber');
    const d = templateDef('thomas-stieber')!;
    expect(d.group).toBe('lithology');
    expect([d.x.role, d.x.range, d.y.role, d.y.range, d.colorRole]).toEqual(['VSH', [0, 1], 'PHIT', [0, 0.5], 'GR']);
    expect(sanitizeCrossplot({ template: 'thomas-stieber' }).template).toBe('thomas-stieber');
    expect(CROSSPLOT_TEMPLATE_DEFS.filter((t) => t.id === 'thomas-stieber')).toHaveLength(1);
  });
});

describe('deshabilitada sin VSH o PHIT', () => {
  const n = 12;
  const series = (v: number) => Float64Array.from({ length: n }, () => v);
  const emptyWell = createWell({ id: 'w', name: 'W', depth: Float64Array.from({ length: n }, (_, i) => 1000 + i), curves: [] });
  const ctxOf = (computed: SeriesContext['computed'] = []): SeriesContext => ({ well: emptyWell, interpretation: emptyInterpretation([]), computed, catalog: registry.roles });

  it('sin curvas: falta VSH, con el módulo que la calcula en el motivo', () => {
    const r = crossplotTemplatePatch(ctxOf(), 'thomas-stieber');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('falta VSH');
    expect(r.title).toContain('Thomas–Stieber');
    expect(r.description).toContain('Volumen de arcilla');
  });

  it('con VSH y sin PHIT: falta PHIT; con las dos se arma con color por GR o por zona', () => {
    const vsh = { port: 'VSH', moduleId: 'vsh', label: 'Vsh', data: series(0.3), active: true };
    const r = crossplotTemplatePatch(ctxOf([vsh]), 'thomas-stieber');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('falta PHIT');
    const ok = crossplotTemplatePatch(ctxOf([vsh, { port: 'PHIT', moduleId: 'phit', label: 'PHIT', data: series(0.2), active: true }]), 'thomas-stieber');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.patch).toMatchObject({ xRange: [0, 1], yRange: [0, 0.5], xScale: 'linear', yScale: 'linear', template: 'thomas-stieber' });
  });
});

describe('capas del diagrama', () => {
  it('cinco rectas con rótulo, banda laminar y regiones A y B con los vértices del motor', () => {
    const l = thomasStieberLayers(0.3, 0.1, 0.02);
    const drawn = l.lines.filter((x) => x.x.length === 2 && !x.id.startsWith('ts-band'));
    expect(drawn.map((x) => x.id)).toEqual(['ts-dispersed-pore', 'ts-dispersed-grain', 'ts-structural-grain', 'ts-structural-pore', 'ts-laminated']);
    expect(l.lines.filter((x) => x.label).map((x) => x.label)).toEqual(['Dispersa · relleno de poros', 'Dispersa · reemplazo de granos', 'Estructural · reemplazo de granos', 'Estructural · relleno de poros', 'Laminada', 'A · arcilla dispersa', 'B · arcilla estructural']);
    const pore = l.lines.find((x) => x.id === 'ts-dispersed-pore')!;
    expect(pore.x[1]).toBeCloseTo(0.3, 12);
    expect(pore.y[1]).toBeCloseTo(0.03, 12);
    const str = l.lines.find((x) => x.id === 'ts-structural-grain')!;
    expect(str.x[1]).toBeCloseTo(0.7, 12);
    expect(str.y[1]).toBeCloseTo(0.37, 12);
    const up = l.lines.find((x) => x.id === 'ts-band-up')!;
    expect(up.y[0]).toBeCloseTo(0.32, 12);
    expect(up.y[1]).toBeCloseTo(0.12, 12);
    expect(l.polygons.map((p) => p.name)).toEqual(['Región A · arcilla dispersa', 'Región B · arcilla estructural']);
    // Región A debajo de la diagonal, B encima (vértices del motor).
    expect(l.polygons[0]!.vertices[1]![1]).toBeLessThan(0.3 * 0.7 + 0.1 * 0.3);
    expect(l.polygons[1]!.vertices[1]![1]).toBeGreaterThan(0.3 * 0.3 + 0.1 * 0.7);
    for (const line of l.lines) for (const v of [...Array.from(line.x), ...Array.from(line.y)]) expect(Number.isFinite(v)).toBe(true);
  });
  it('extremos inválidos: sin capas', () => {
    expect(thomasStieberLayers(0.1, 0.3, 0.02)).toEqual({ polygons: [], lines: [] });
  });
});

describe('arrastre de los extremos → parámetros de clay-distribution', () => {
  const params = emptyParamState();
  it('φ de la arena: acotada y redondeada al paso, en la clave del módulo', () => {
    const w = clayEndpointWrite('phiSand', 0.2734, params, GLOBAL)!;
    expect(w).toEqual({ storage: 'clay-distribution.phiSand', value: 0.275, zoneId: null });
    expect(clayEndpointWrite('phiSand', 0.9, params, GLOBAL)!.value).toBe(0.45);
    expect(clayEndpointWrite('phiSand', NaN, params, GLOBAL)).toBeNull();
  });
  it('la lutita queda al menos un paso por debajo de la arena (y viceversa)', () => {
    // Por defecto φarena 0,25: arrastrar la lutita a 0,30 la deja en 0,245.
    expect(clayEndpointWrite('phiShale', 0.3, params, GLOBAL)!.value).toBeCloseTo(0.245, 12);
    // Arrastrar la arena por debajo de la lutita (0,10) la deja en 0,105.
    expect(clayEndpointWrite('phiSand', 0.02, params, GLOBAL)!.value).toBeCloseTo(0.105, 12);
    expect(normalizeClayEndpoint('phiShale', 0.08, 0.3)).toBeCloseTo(0.08, 12);
  });
  it('alcance por zona: con una zona filtrada escribe el valor de esa zona', () => {
    const w = clayEndpointWrite('phiShale', 0.12, params, { zoneId: 'c', text: 'zona C' })!;
    expect(w.zoneId).toBe('c');
    const p2 = { global: {}, zones: { c: { 'clay-distribution.phiShale': 0.12 } } };
    expect(plotParamValue(p2, PLOT_PARAMS.phiShale, 'c')).toBe(0.12);
    expect(plotParamValue(p2, PLOT_PARAMS.phiShale, null)).toBe(0.1);
  });
  it('«Estimar de los datos»: las dos escrituras, o ninguna si ya coinciden', () => {
    const w = clayEstimateWrites(0.2912, 0.0838, params, GLOBAL);
    expect(w.map((x) => [x.storage, x.value])).toEqual([['clay-distribution.phiSand', 0.29], ['clay-distribution.phiShale', 0.085]]);
    expect(clayEstimateWrites(0.25, 0.1, params, GLOBAL)).toEqual([]);
  });
});

describe('un solo deshacer por gesto', () => {
  beforeEach(() => {
    let now = 0;
    historyClock.now = () => (now += 5000);
    const w = createWell({ id: 'w1', name: 'Pozo 1', depth: depthRange(40), curves: [] });
    useProject.getState().replace(addWell(createProject('Demo'), w, [zone('a', 1000, 1005), zone('b', 1005.5, 1010)]));
  });
  const value = () => getWellEntry(useProject.getState().project, 'w1').interpretation.params.global['clay-distribution.phiSand'];

  it('arrastrar el extremo de la arena (varios movimientos) es una entrada; Ctrl+Z vuelve al de fábrica', () => {
    const label = `Cambiar ${PLOT_PARAMS.phiSand.spec.label}`;
    const p = emptyParamState();
    for (const y of [0.26, 0.28, 0.3]) commitPlotParams(label, [clayEndpointWrite('phiSand', y, p, GLOBAL)!], 'preview');
    commitPlotParams(label, [clayEndpointWrite('phiSand', 0.31, p, GLOBAL)!], 'commit');
    expect(value()).toBe(0.31);
    expect(useProject.getState().undo()).toBe(label);
    expect(value()).toBeUndefined();
    expect(useProject.getState().canUndo).toBe(false);
  });

  it('«Estimar de los datos» escribe los dos extremos en un commit (un Ctrl+Z)', () => {
    commitPlotParams('Estimar φ de arena y de lutita de los datos', clayEstimateWrites(0.29, 0.085, emptyParamState(), GLOBAL), 'commit');
    const g = getWellEntry(useProject.getState().project, 'w1').interpretation.params.global;
    expect([g['clay-distribution.phiSand'], g['clay-distribution.phiShale']]).toEqual([0.29, 0.085]);
    useProject.getState().undo();
    expect(value()).toBeUndefined();
  });
});

describe('con los perfiles del TP', () => {
  const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(toEngineWell(well));
  const result = engine.run(emptyInterpretation(zones));
  const active = (port: string) => result.outputs.find((o) => o.port === port && o.active)?.value as Float64Array;

  it('la plantilla se arma y los extremos se pueden estimar', () => {
    const computed = result.outputs.flatMap((o) => (o.kind === 'curve' && o.value instanceof Float64Array ? [{ port: o.port, moduleId: o.moduleId, label: o.label, data: o.value, active: o.active }] : []));
    expect(crossplotTemplatePatch({ well, interpretation: emptyInterpretation(zones), computed, catalog: registry.roles }, 'thomas-stieber').ok).toBe(true);
    const e = estimateClayEndpoints(active('VSH'), active('PHIT'));
    expect(e.problem).toBeNull();
    expect(e.phiSand!).toBeGreaterThan(e.phiShale!);
    expect(e.phiSand!).toBeGreaterThan(0.1);
    expect(e.phiSand!).toBeLessThan(0.4);
  });
});
