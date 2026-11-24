import { describe, expect, it } from 'vitest';
import { createPointSet, type PointSet } from '../src/core/pointSets';
import { addWell, createProject, getWellEntry, setOverlaySetting, type Project } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { setPointDecision, setPointSetSetting } from '../src/core/state/pointSets';
import { createWell } from '../src/core/well';
import { densityFromPsiPerFt } from '../src/petro/pressure';
import { intersectTrends } from '../src/petro/regression';
import { addExample, EXAMPLE_FWL_M, EXAMPLE_GOC_M, examplePressure, examplePressureSet, gradientSpec } from '../src/modules/mdt/example';
import {
  assessQuality,
  decisionFor,
  findContacts,
  mdtSeriesKey,
  parseMdtSeriesKey,
  pointStatuses,
  qualityFromText,
  type GradientLine,
} from '../src/modules/mdt/model';
import { mdtAnalysis, mdtSeries, mdtSeriesProvider } from '../src/modules/mdt/series';
import { drawdownScale, formatDrawdown } from '../src/modules/mdt/drawdown';
import { pressureTrackScale } from '../src/modules/mdt/overlay';
import { registry } from '../src/modules';

const FT = 0.3048;

function wellWith(sets: PointSet[] = []) {
  const depth = Float64Array.from({ length: 101 }, (_, i) => 7900 + i * 4);
  return createWell({ id: 'w', name: 'Pozo', depth, curves: [], pointSets: sets });
}

function projectWithExample(): Project {
  const p = addWell(createProject(), wellWith());
  return addExample(p, 'w', { set: 'ej', trends: { gas: 'tg', oil: 'to', water: 'tw' } });
}

describe('mdt: claves de serie', () => {
  it('ida y vuelta, con y sin fluido', () => {
    expect(mdtSeriesKey('pts-1')).toBe('pts-1');
    expect(mdtSeriesKey('pts-1', 'oil')).toBe('pts-1:oil');
    expect(parseMdtSeriesKey('pts-1:oil')).toEqual({ setId: 'pts-1', fluid: 'oil' });
    expect(parseMdtSeriesKey('pts-1')).toEqual({ setId: 'pts-1', fluid: null });
    expect(parseMdtSeriesKey('a:b')).toEqual({ setId: 'a:b', fluid: null });
  });
});

describe('mdt: reglas de calidad', () => {
  it('textos en español e inglés', () => {
    expect(qualityFromText('Seca')).toBe('dry');
    expect(qualityFromText('DRY TEST')).toBe('dry');
    expect(qualityFromText('Sobrecargada')).toBe('supercharged');
    expect(qualityFromText('Supercharged')).toBe('supercharged');
    expect(qualityFromText('Tight')).toBe('tight');
    expect(qualityFromText('Lost seal')).toBe('lostSeal');
    expect(qualityFromText('Pérdida de sello')).toBe('lostSeal');
    expect(qualityFromText('No estabilizó')).toBe('unstable');
    expect(qualityFromText('Buena')).toBe('good');
    expect(qualityFromText('Valid')).toBe('good');
    expect(qualityFromText('Pretest')).toBeNull();
    expect(qualityFromText('')).toBeNull();
  });

  const set = createPointSet({
    id: 's',
    kind: 'pressure',
    name: 'S',
    depth: Float64Array.of(1000, 1010, 1020, 1030, 1040),
    pointIds: ['a', 'b', 'c', 'd', 'e'],
    columns: {
      pressure: { label: 'P', unit: 'psi', values: Float64Array.of(1450, NaN, 1465, 1700, 1480) },
      mobility: { label: 'M', unit: 'mD/cP', values: Float64Array.of(50, 0.01, 0.5, 30, 80) },
      mudBefore: { label: 'H', unit: 'psi', values: Float64Array.of(1650, 1660, 1670, 1680, NaN) },
      quality: { label: 'Q', values: ['Buena', 'Seca', '', 'Buena', 'Tight'] },
    },
  });

  it('sin presión, texto, movilidad baja y presión ≥ lodo', () => {
    const q = assessQuality(set, 1);
    expect(q.map((x) => x.reasons)).toEqual([[], ['noPressure', 'dry', 'lowMobility'], ['lowMobility'], ['overMud'], ['tight']]);
    expect(q.map((x) => x.proposeExclude)).toEqual([false, true, true, true, true]);
    // umbral de movilidad 0,1: la c (0,5 mD/cP) ya no se propone
    expect(assessQuality(set, 0.1)[2]!.reasons).toEqual([]);
  });

  it('compara con el lodo en la unidad de la presión de formación (lodo en bar, formación en psi)', () => {
    const mk = (pPsi: number, mudBar: number) =>
      createPointSet({
        id: 'u',
        kind: 'pressure',
        name: 'U',
        depth: Float64Array.of(1000),
        pointIds: ['a'],
        columns: {
          pressure: { label: 'P', unit: 'psi', values: Float64Array.of(pPsi) },
          mudBefore: { label: 'H', unit: 'bar', values: Float64Array.of(mudBar) },
        },
      });
    // 1650 psi = 113,76 bar. 1450 psi (99,98 bar) está por debajo del lodo; 1700 psi (117,2 bar), por encima.
    expect(assessQuality(mk(1450, 113.76))[0]!.reasons).toEqual([]);
    expect(assessQuality(mk(1700, 113.76))[0]!.reasons).toEqual(['overMud']);
  });

  it('la decisión del usuario manda; sin presión nunca entra; decisionFor guarda solo lo distinto a la propuesta', () => {
    expect(pointStatuses(set, undefined).map((s) => s.included)).toEqual([true, false, false, false, false]);
    const st = pointStatuses(set, { points: { c: { status: 'include' }, a: { status: 'exclude' }, b: { status: 'include' } } });
    expect(st.map((s) => s.included)).toEqual([false, false, true, false, false]);
    expect(st[2]!.decided).toBe('include');
    const q = assessQuality(set);
    expect(decisionFor(q[0]!, true)).toBeNull();
    expect(decisionFor(q[0]!, false)).toEqual({ status: 'exclude' });
    expect(decisionFor(q[3]!, true)).toEqual({ status: 'include' });
    expect(decisionFor(q[3]!, false)).toBeNull();
  });

  it('caché por identidad de conjunto y decisiones', () => {
    const d = { points: {} };
    expect(pointStatuses(set, d)).toBe(pointStatuses(set, d));
    expect(pointStatuses(set, { points: {} })).not.toBe(pointStatuses(set, d));
  });
});

describe('mdt: ejemplo sintético', () => {
  const set = examplePressureSet('ej');

  it('está rotulado como sintético y dentro del pozo del TP', () => {
    expect(set.synthetic).toBe(true);
    expect(set.name).toMatch(/ejemplo sintético/);
    expect(set.depth[0]).toBeGreaterThan(7633);
    expect(set.depth[set.depth.length - 1]).toBeLessThan(8518);
  });

  it('presión de diseño continua en los contactos y gradientes de libro', () => {
    expect(examplePressure(EXAMPLE_FWL_M - 1e-9)).toBeCloseTo(examplePressure(EXAMPLE_FWL_M), 6);
    expect(examplePressure(EXAMPLE_GOC_M - 1e-9)).toBeCloseTo(examplePressure(EXAMPLE_GOC_M), 6);
    const g = (a: number, b: number) => ((examplePressure(b) - examplePressure(a)) / (b - a)) * FT; // psi/ft
    expect(g(8100, 8200)).toBeCloseTo(0.45, 9);
    expect(g(8020, 8080)).toBeCloseTo(0.33, 9);
    expect(g(7970, 8000)).toBeCloseTo(0.08, 9);
  });

  it('las reglas proponen descartar exactamente las tres pruebas malas', () => {
    const q = assessQuality(set);
    const bad = set.pointIds.filter((_, i) => q[i]!.proposeExclude);
    expect(bad).toHaveLength(3);
    const qual = set.columns['quality']!.values as readonly string[];
    expect(bad.map((id) => qual[set.pointIds.indexOf(id)])).toEqual(['Seca', 'Tight', 'Sobrecargada']);
  });

  it('el ruido es ±2 psi en las pruebas buenas y reproducible', () => {
    const p = set.columns['pressure']!.values as Float64Array;
    const q = assessQuality(set);
    for (let i = 0; i < p.length; i++) if (!q[i]!.proposeExclude) expect(Math.abs(p[i]! - examplePressure(set.depth[i]!))).toBeLessThanOrEqual(2.05);
    expect(examplePressureSet('otro').columns['pressure']!.values).toEqual(p);
  });
});

describe('mdt: proveedor de series', () => {
  const set = examplePressureSet('ej');
  const well = wellWith([set]);
  const ctx = { well, interpretation: { ...getWellEntry(addWell(createProject(), well), 'w').interpretation }, computed: [], catalog: registry.roles };

  it('lista el conjunto y un gradiente por fluido', () => {
    const keys = mdtSeriesProvider.list(ctx).map((o) => o.key);
    expect(keys).toEqual(['ej', 'ej:gas', 'ej:oil', 'ej:water']);
  });

  it('serie: solo puntos incluidos, en profundidad, con clave = id de la prueba', () => {
    const s = mdtSeriesProvider.resolve(ctx, 'ej:water')!;
    expect(s.xIsDepth).toBe(true);
    expect(s.placement).toEqual({ overlayId: 'mdt' });
    expect(s.yUnit).toBe('psi');
    expect(s.x.length).toBe(set.depth.length - 3);
    for (let i = 1; i < s.x.length; i++) expect(s.x[i]!).toBeGreaterThanOrEqual(s.x[i - 1]!);
    const k = s.pointKey(4);
    expect(set.pointIds).toContain(k);
    expect(s.indexOfKey!(k)).toBe(4);
    expect(s.indexOfKey!('no-existe')).toBe(-1);
    // misma identidad mientras no cambien datos ni decisiones (cachés de ajuste)
    expect(mdtSeriesProvider.resolve(ctx, 'ej:water')).toBe(s);
    expect(mdtSeriesProvider.resolve(ctx, 'nada')).toBeNull();
  });

  it('descartar un punto lo saca de la serie (y de todo ajuste)', () => {
    const id = set.pointIds[0]!;
    const s0 = mdtSeries(set, ctx.interpretation, null)!;
    const s1 = mdtSeries(set, { pointSets: { ej: { points: { [id]: { status: 'exclude' } } } } }, null)!;
    expect(s1).not.toBe(s0);
    expect(s1.x.length).toBe(s0.x.length - 1);
    expect(s1.indexOfKey!(id)).toBe(-1);
  });
});

describe('mdt: gradientes y contactos', () => {
  it('rectas de libro (Dake 1978, §1.4): agua 0,45, petróleo 0,35 y gas 0,08 psi/ft → CAP 5500 ft y CGP 5000 ft', () => {
    // Profundidad en ft (la función no asume unidades): P agua = 15 + 0,45·z; petróleo pasa por (5500, 2490).
    const water: GradientLine = { id: 'w', name: 'Agua', fluid: 'water', coeffs: { model: 'linear', a: 15, b: 0.45 }, span: [5550, 5800] };
    const oil: GradientLine = { id: 'o', name: 'Petróleo', fluid: 'oil', coeffs: { model: 'linear', a: 2490 - 0.35 * 5500, b: 0.35 }, span: [5050, 5450] };
    const pGoc = 2490 - 0.35 * 500;
    const gas: GradientLine = { id: 'g', name: 'Gas', fluid: 'gas', coeffs: { model: 'linear', a: pGoc - 0.08 * 5000, b: 0.08 }, span: [4600, 4950] };
    const c = findContacts([water, gas, oil]);
    expect(c.map((x) => x.kind)).toEqual(['GOC', 'OWC']);
    expect(c[0]!.depth).toBeCloseTo(5000, 9);
    expect(c[0]!.pressure).toBeCloseTo(2315, 9);
    expect(c[1]!.depth).toBeCloseTo(5500, 9);
    expect(c[1]!.pressure).toBeCloseTo(2490, 9);
    expect(c.every((x) => x.problem === null && x.warning === null)).toBe(true);
  });

  it('gas sobre agua sin petróleo → CGA', () => {
    const c = findContacts([
      { id: 'g', name: 'Gas', fluid: 'gas', coeffs: { model: 'linear', a: 100, b: 0.1 }, span: [900, 990] },
      { id: 'w', name: 'Agua', fluid: 'water', coeffs: { model: 'linear', a: 100 - 0.35 * 1000, b: 0.45 }, span: [1010, 1100] },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]!.kind).toBe('GWC');
    expect(c[0]!.depth).toBeCloseTo(1000, 9);
  });

  it('paralelas, fuera de rango, fluido invertido y corte dentro de los puntos', () => {
    const line = (id: string, fluid: GradientLine['fluid'], a: number, b: number, span: [number, number]): GradientLine => ({ id, name: id, fluid, coeffs: { model: 'linear', a, b }, span });
    const par = findContacts([line('o', 'oil', 0, 0.35, [100, 200]), line('w', 'water', 10, 0.35, [300, 400])]);
    expect(par[0]!.depth).toBeNull();
    expect(par[0]!.problem).toMatch(/paralelos/);
    // se cortan a z = 1000, muy lejos de los puntos (100–400 m)
    const far = findContacts([line('o', 'oil', 0, 0.35, [100, 200]), line('w', 'water', -100, 0.45, [300, 400])]);
    expect(far[0]!.depth).toBeNull();
    expect(far[0]!.problem).toMatch(/fuera del rango razonable/);
    const inv = findContacts([line('w', 'water', 0, 0.45, [100, 200]), line('o', 'oil', 0, 0.35, [300, 400])]);
    expect(inv[0]!.depth).toBeNull();
    expect(inv[0]!.problem).toMatch(/más denso no puede estar arriba/);
    // corte a 150 m: dentro de los puntos de petróleo (100–200)
    const inside = findContacts([line('o', 'oil', 0, 0.35, [100, 200]), line('w', 'water', -15, 0.45, [210, 400])]);
    expect(inside[0]!.depth).toBeCloseTo(150, 9);
    expect(inside[0]!.warning).toMatch(/dentro de los puntos de petróleo/);
    // dos gradientes del mismo fluido no dan contacto; sin fluido no participan
    expect(findContacts([line('a', 'water', 0, 0.45, [100, 200]), line('b', 'water', 5, 0.45, [300, 400])])).toEqual([]);
    expect(findContacts([line('a', null, 0, 0.45, [100, 200]), line('b', 'oil', 5, 0.35, [300, 400])])).toEqual([]);
  });

  it('gradientes invertidos (el fluido liviano con más gradiente que el pesado) no dan contacto aunque se corten en el hueco', () => {
    const line = (id: string, fluid: GradientLine['fluid'], a: number, b: number, span: [number, number]): GradientLine => ({ id, name: id, fluid, coeffs: { model: 'linear', a, b }, span });
    // petróleo 0,45 y agua 0,33 psi/m se cortan a z = 250 m, entre los puntos (100–200 y 300–400): físicamente imposible
    const c = findContacts([line('o', 'oil', 0, 0.45, [100, 200]), line('w', 'water', 25, 0.35, [300, 400])]);
    expect(c[0]!.depth).toBeNull();
    expect(c[0]!.problem).toMatch(/más liviano no puede tener más gradiente/);
  });

  it('el aviso distingue contacto por encima/por debajo de todos los puntos y dentro de ellos', () => {
    const line = (id: string, fluid: GradientLine['fluid'], a: number, b: number, span: [number, number]): GradientLine => ({ id, name: id, fluid, coeffs: { model: 'linear', a, b }, span });
    // corte a 90 m (petróleo 100–200, rango razonable desde 70)
    const above = findContacts([line('o', 'oil', 0, 0.35, [100, 200]), line('w', 'water', -9, 0.45, [300, 400])]);
    expect(above[0]!.depth).toBeCloseTo(90, 9);
    expect(above[0]!.warning).toMatch(/por encima de todos los puntos de petróleo/);
    // corte a 420 m (agua 300–400, rango razonable hasta 430)
    const below = findContacts([line('o', 'oil', 0, 0.35, [100, 200]), line('w', 'water', -42, 0.45, [300, 400])]);
    expect(below[0]!.depth).toBeCloseTo(420, 9);
    expect(below[0]!.warning).toMatch(/por debajo de todos los puntos de agua/);
    // corte a 350 m: dentro de los puntos de agua
    const inWater = findContacts([line('o', 'oil', 0, 0.35, [100, 200]), line('w', 'water', -35, 0.45, [300, 400])]);
    expect(inWater[0]!.depth).toBeCloseTo(350, 9);
    expect(inWater[0]!.warning).toMatch(/dentro de los puntos de agua/);
  });

  it('modelos distintos que no se cortan en el rango: no se dice «paralelos»', () => {
    const o: GradientLine = { id: 'o', name: 'o', fluid: 'oil', coeffs: { model: 'linear', a: 0, b: 0.35 }, span: [100, 200] };
    const w: GradientLine = { id: 'w', name: 'w', fluid: 'water', coeffs: { model: 'exp', a: 1000, b: 0.0001 }, span: [300, 400] };
    const c = findContacts([o, w]);
    expect(c[0]!.depth).toBeNull();
    expect(c[0]!.problem).toMatch(/no se cortan entre/);
    expect(c[0]!.problem).not.toMatch(/paralelos/);
  });

  it('ejemplo cargado: tres gradientes con la densidad de diseño y los dos contactos a menos de 5 m de lo diseñado (el ruido de ±2 psi sobre rectas que difieren en ≈ 0,39 psi/m)', () => {
    const p = projectWithExample();
    const e = getWellEntry(p, 'w');
    const an = mdtAnalysis(e.well, e.interpretation);
    expect(an.gradients.map((g) => g.fluid)).toEqual(['gas', 'oil', 'water']);
    const dens = Object.fromEntries(an.gradients.map((g) => [g.fluid, g.density]));
    expect(dens['gas']).toBeCloseTo(densityFromPsiPerFt(0.08), 1);
    expect(dens['oil']).toBeCloseTo(densityFromPsiPerFt(0.33), 1);
    expect(dens['water']).toBeCloseTo(densityFromPsiPerFt(0.45), 1);
    expect(an.gradients.every((g) => !g.mismatch && g.suggestion?.fluid === g.fluid)).toBe(true);
    expect(an.contacts.map((c) => c.kind)).toEqual(['GOC', 'OWC']);
    expect(Math.abs(an.contacts[0]!.depth! - EXAMPLE_GOC_M)).toBeLessThan(5);
    expect(Math.abs(an.contacts[1]!.depth! - EXAMPLE_FWL_M)).toBeLessThan(5);
    expect(an.contacts.every((c) => c.problem === null)).toBe(true);
    // fluido de cada punto según el gradiente que lo usa
    const firstGas = e.well.pointSets[0]!.pointIds[0]!;
    expect(an.fluidOfPoint.get(`ej|${firstGas}`)?.fluid).toBe('gas');
    // caché por identidad
    expect(mdtAnalysis(e.well, e.interpretation)).toBe(an);
  });

  it('incluir la prueba sobrecargada estropea el ajuste de agua (por eso se propone descartarla)', () => {
    let p = projectWithExample();
    const e0 = getWellEntry(p, 'w');
    const set = e0.well.pointSets[0]!;
    const k = (set.columns['quality']!.values as string[]).indexOf('Sobrecargada');
    p = setPointDecision(p, 'w', 'ej', set.pointIds[k]!, { status: 'include' });
    const e1 = getWellEntry(p, 'w');
    const r0 = mdtAnalysis(e0.well, e0.interpretation).gradients[2]!.result!;
    const r1 = mdtAnalysis(e1.well, e1.interpretation).gradients[2]!.result!;
    expect(r1.n).toBe(r0.n + 1);
    expect(r1.r2!).toBeLessThan(r0.r2!);
  });

  it('la movilidad mínima es un ajuste del conjunto en la interpretación', () => {
    let p = projectWithExample();
    p = setPointSetSetting(p, 'w', 'ej', 'minMobility', 0.05);
    const e = getWellEntry(p, 'w');
    const st = pointStatuses(e.well.pointSets[0]!, e.interpretation.pointSets['ej']);
    // la tight (0,08 mD/cP) sigue propuesta por su texto; la seca también; nada más cambió
    expect(st.filter((s) => s.quality.proposeExclude)).toHaveLength(3);
  });

  it('un gradiente sin fluido (serie «todos») no participa de los contactos', () => {
    let p = projectWithExample();
    p = { ...p };
    const e = getWellEntry(p, 'w');
    const extra = gradientSpec('tx', 'Todos', 'ej', 'oil');
    const interp = { ...e.interpretation, trends: [...e.interpretation.trends, { ...extra, series: { provider: 'mdt', key: 'ej' } }] };
    const an = mdtAnalysis(e.well, interp);
    expect(an.gradients).toHaveLength(4);
    expect(an.gradients[3]!.fluid).toBeNull();
    expect(an.contacts).toHaveLength(2);
  });

  it('intersectTrends da lo mismo que findContacts', () => {
    const p = projectWithExample();
    const e = getWellEntry(p, 'w');
    const an = mdtAnalysis(e.well, e.interpretation);
    const [g, o] = an.gradients;
    expect(an.contacts[0]!.depth).toBe(intersectTrends(g!.result!.coeffs!, o!.result!.coeffs!));
  });
});

describe('mdt: escala automática de la pista', () => {
  const set = examplePressureSet('ej');
  it('cubre las pruebas con sentido (no la seca) con extremos redondos', () => {
    const s = pressureTrackScale([set], 'psi')!;
    const p = set.columns['pressure']!.values as Float64Array;
    const q = assessQuality(set);
    for (let i = 0; i < p.length; i++) {
      if (q[i]!.reasons.includes('dry')) continue;
      expect(p[i]!).toBeGreaterThan(s.min);
      expect(p[i]!).toBeLessThan(s.max);
    }
    expect(s.min).toBeGreaterThan(7000); // la seca (6850) no estira la escala
    expect(s.min % 25).toBe(0);
    expect(s.max % 25).toBe(0);
  });
  it('en bar', () => {
    const s = pressureTrackScale([set], 'bar')!;
    expect(s.min).toBeGreaterThanOrEqual(800);
    expect(s.max).toBeLessThanOrEqual(850);
    expect(s.max - s.min).toBeLessThanOrEqual(40);
  });
  it('sin presiones → null', () => {
    expect(pressureTrackScale([], 'psi')).toBeNull();
  });
});


describe('mdt: el color es un ajuste de vista', () => {
  it('un proyecto v6 sin drawdown conserva sus gradientes, densidades y contactos al cambiar el color', async () => {
    const old = await deserializeProject(await serializeProject(projectWithExample(), { version: 6 }));
    const entry = getWellEntry(old, 'w');
    const data = { wellId: 'w', depth: entry.well.depth.values, zones: [], selectedZoneId: null, qc: null, ...entry, computed: [] };
    expect(drawdownScale(data, 'psi')).toBeNull();
    const formatted = setOverlaySetting(old, 'mdt', 'pointColor', 'drawdown');
    const scale = drawdownScale({ ...data, ...(formatted.display.overlays ? { overlaySettings: formatted.display.overlays } : {}) }, 'psi')!;
    expect(scale.legend.colors).toHaveLength(0);
    expect(scale.legend.missing.label).toBe('Sin dato');
    expect(scale.colorOf(undefined)).toBe(scale.legend.missing.color);
    const after = getWellEntry(formatted, 'w');
    expect(mdtAnalysis(after.well, after.interpretation)).toBe(mdtAnalysis(entry.well, entry.interpretation));
    expect(mdtAnalysis(after.well, after.interpretation).contacts).toHaveLength(2);
  });

  it('un cero y su conversión son datos, mientras que un número no finito queda ausente', () => {
    expect(formatDrawdown(0, 'bar')).toBe('0');
    expect(formatDrawdown(66.59, 'bar')).toBe('4,591');
    expect(formatDrawdown(NaN, 'psi')).toBe('Sin dato');
  });
});
