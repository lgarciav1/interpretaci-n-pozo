/**
 * Configuración de los gráficos del dock en el proyecto (docs/decisiones/0014, D2): recetas puras, deshacer,
 * saneamiento al abrir y compatibilidad con proyectos guardados antes de la fase 7a (formato v5).
 */
import { describe, expect, it } from 'vitest';
import { defaultCrossplot, defaultDistribution, defaultHistogram, sanitizeCrossplot, sanitizeDistribution, sanitizeHistogram, sanitizePlots } from '../src/core/plots';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { plotConfig, setPlotCutoff, updatePlotConfig } from '../src/core/state/plots';
import { addWell, createProject } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createWell } from '../src/core/well';

const well = createWell({ id: 'w', name: 'W', depth: Float64Array.from([1, 2, 3]), curves: [] });
const base = () => addWell(createProject(), well);

describe('recetas', () => {
  it('sin configuración guardada, la de fábrica; un parche la guarda', () => {
    const p = base();
    expect(plotConfig(p, 'w', 'histogram')).toEqual(defaultHistogram());
    const q = updatePlotConfig(p, 'w', 'histogram', { curve: 'm:GR', bins: 30 });
    expect(q.display.plots?.['w']?.histogram).toMatchObject({ curve: 'm:GR', bins: 30, normalize: true });
    // La interpretación no cambia (no recalcula el motor ni entra en snapshots).
    expect(q.wells[0]!.interpretation).toBe(p.wells[0]!.interpretation);
  });
  it('un parche que no cambia nada devuelve el mismo proyecto', () => {
    const p = base();
    expect(updatePlotConfig(p, 'w', 'crossplot', { zones: [] })).toBe(p);
    const q = updatePlotConfig(p, 'w', 'crossplot', { zones: ['a'] });
    expect(updatePlotConfig(q, 'w', 'crossplot', { zones: ['a'] })).toBe(q);
  });
  it('`undefined` quita un rango fijo', () => {
    const q = updatePlotConfig(base(), 'w', 'crossplot', { xRange: [0, 1] });
    expect(plotConfig(q, 'w', 'crossplot').xRange).toEqual([0, 1]);
    expect('xRange' in plotConfig(updatePlotConfig(q, 'w', 'crossplot', { xRange: undefined }), 'w', 'crossplot')).toBe(false);
  });
  it('cutoffs: real (true), libre (número) y quitar (null)', () => {
    let p = setPlotCutoff(base(), 'w', 'crossplot', 'r:PHIE', true);
    p = setPlotCutoff(p, 'w', 'crossplot', 'm:GR', 75);
    expect(plotConfig(p, 'w', 'crossplot').cutoffs).toEqual({ 'r:PHIE': true, 'm:GR': 75 });
    expect(setPlotCutoff(p, 'w', 'crossplot', 'm:GR', 75)).toBe(p);
    p = setPlotCutoff(p, 'w', 'crossplot', 'r:PHIE', null);
    expect(plotConfig(p, 'w', 'crossplot').cutoffs).toEqual({ 'm:GR': 75 });
  });
  it('pozo inexistente → error', () => {
    expect(() => updatePlotConfig(base(), 'nope', 'histogram', { bins: 10 })).toThrow();
  });
  it('entra en deshacer como cualquier receta', () => {
    const p = base();
    const q = updatePlotConfig(p, 'w', 'histogram', { curve: 'm:GR' });
    const h = recordChange(emptyHistory(), p, 'Cambiar la curva del histograma', 0);
    expect(undo(h, q)!.project).toBe(p);
  });
});

describe('saneamiento', () => {
  it('descarta lo inválido y completa con valores por defecto', () => {
    const h = sanitizeHistogram({ curve: 'GR', scale: 'cubic', bins: 2.5, zones: ['a', 3], byZone: 'sí', cutoffs: { 'm:GR': 70, 'r:PHIE': true, 'm:X': 'no', otra: 1 } });
    expect(h).toEqual({ ...defaultHistogram(), zones: ['a'], cutoffs: { 'm:GR': 70, 'r:PHIE': true } });
    const c = sanitizeCrossplot({ x: 'm:NPHI', y: 'r:RHOB', xRange: [1, 0], yRange: [1.9, 2.9], color: { kind: 'curve', curve: 'm:GR' }, template: 'pickett', yReversed: true });
    expect(c).toMatchObject({ x: 'm:NPHI', y: 'r:RHOB', yRange: [1.9, 2.9], color: { kind: 'curve', curve: 'm:GR' }, template: 'pickett', yReversed: true });
    expect('xRange' in c).toBe(false);
    expect(sanitizeCrossplot({ template: 'otra', color: { kind: 'curve' } })).toEqual(defaultCrossplot());
  });
  it('por pozo; lo que no es objeto se descarta con aviso', () => {
    const warns: string[] = [];
    const out = sanitizePlots({ w: { histogram: { bins: 12 } }, x: 3 }, (m) => warns.push(m));
    expect(out?.['w']?.histogram?.bins).toBe(12);
    expect(out?.['x']).toBeUndefined();
    expect(warns).toHaveLength(1);
    expect(sanitizePlots(undefined)).toBeUndefined();
  });
});

describe('distribuciones por zona (0066)', () => {
  it('de fábrica: φe implícita, toda la zona, excluir derrumbe y solo la actual', () => {
    expect(plotConfig(base(), 'w', 'distribution')).toEqual({ curve: null, filter: 'all', reservoirOnly: false, excludeWashout: false, series: ['#current'], hiddenZones: [] });
  });
  it('saneamiento: filtro, series y zonas válidas; series repetidas fuera', () => {
    const d = sanitizeDistribution({ curve: 'PHIE', filter: 'gas', reservoirOnly: 1, excludeWashout: false, series: ['#current', 'snap-1', 'snap-1', 'otra', 'well:w2', 3], hiddenZones: ['za', 'za', ''] });
    expect(d).toEqual({ ...defaultDistribution(), excludeWashout: false, series: ['#current', 'snap-1', 'well:w2'], hiddenZones: ['za'] });
    expect(sanitizeDistribution({ filter: 'netPay', curve: 'r:SW', series: [] })).toMatchObject({ filter: 'netPay', curve: 'r:SW', series: ['#current'] });
    expect(sanitizeDistribution('x')).toEqual(defaultDistribution());
  });
  it('viaja por pozo con los demás gráficos', () => {
    const out = sanitizePlots({ w: { distribution: { filter: 'netRes', hiddenZones: ['zb'] } } });
    expect(out?.['w']?.distribution).toMatchObject({ filter: 'netRes', hiddenZones: ['zb'] });
  });
  it('un parche entra en el proyecto y no toca la interpretación', () => {
    const p = base();
    const q = updatePlotConfig(p, 'w', 'distribution', { curve: 'r:SW', series: ['#current', 'snap-1'] });
    expect(q.display.plots?.['w']?.distribution).toMatchObject({ curve: 'r:SW', series: ['#current', 'snap-1'], excludeWashout: false });
    expect(q.wells[0]!.interpretation).toBe(p.wells[0]!.interpretation);
  });
});

describe('guardar y abrir', () => {
  it('la configuración viaja con el archivo', async () => {
    const p = setPlotCutoff(updatePlotConfig(base(), 'w', 'crossplot', { x: 'm:NPHI', y: 'm:RHOB', template: 'density-neutron', yReversed: true, yRange: [1.9, 2.9] }), 'w', 'crossplot', 'm:GR', 80);
    const back = await deserializeProject(await serializeProject(p, { codec: 'f64le-b64' }));
    expect(back.display.plots).toEqual(p.display.plots);
  });
  it('un proyecto v5 (sin gráficos) se abre con los valores por defecto', async () => {
    const file = JSON.parse(await serializeProject(base(), { codec: 'f64le-b64' }));
    file.version = 5;
    delete file.project.display.plots;
    const back = await deserializeProject(JSON.stringify(file));
    expect(back.display.plots).toBeUndefined();
    expect(plotConfig(back, 'w', 'histogram')).toEqual(defaultHistogram());
  });
});
