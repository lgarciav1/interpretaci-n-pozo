/**
 * Datos de corona (docs/decisiones/0010): modelo puro del módulo (`src/modules/core/model.ts`), proveedor de series
 * `core` (crossplot k–φ), modelo k–φ hacia el motor (`applyKPhiModel`, sincronización) y ejemplo sintético.
 */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import { createPointSet, type PointSet } from '../src/core/pointSets';
import { defaultRoleCatalog } from '../src/core/roles';
import { setPointDecision, setPointSetDepthShift } from '../src/core/state/pointSets';
import { addWell, createProject, getWellEntry } from '../src/core/state/project';
import { createWell } from '../src/core/well';
import {
  addCoreExample,
  EXAMPLE_A,
  EXAMPLE_B,
  EXAMPLE_SHIFTS,
  exampleCoreSet,
  kphiTrendSpec,
} from '../src/modules/core/example';
import {
  applyKPhiModel,
  assessCoreQuality,
  coreGroups,
  coreSets,
  damagedFromText,
  kphiModelOf,
  kphiSeriesKey,
  kphiSync,
  parseCoreSeriesKey,
  permCoreIsSource,
  permCoreParams,
  plugDecisionFor,
  plugStatuses,
  roundModel,
  runColor,
  runLabel,
} from '../src/modules/core/model';
import { coreSeriesProvider, kphiSeries, kphiTrends } from '../src/modules/core/series';
import { suggestDepthShift } from '../src/petro/depthMatch';
import { expTrendToLogLinear } from '../src/petro/permeability';
import { evaluateTrend } from '../src/plots/trend/compute';
import { zone } from './helpers';

const W = 'w';

/** Plugs: 8 puntos en dos coronas. P4 con k ≤ 0, P5 sin φ, P6 fisurado (descripción), P7 con φ fuera de rango. */
function plugs(extra: Partial<Record<'phi' | 'k', number[]>> = {}): PointSet {
  return createPointSet({
    id: 'c1',
    kind: 'core',
    name: 'Corona',
    depth: Float64Array.of(1001, 1002, 1003, 1004, 1011, 1012, 1013, 1014),
    pointIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
    columns: {
      phi: { label: 'φ', unit: 'v/v', values: Float64Array.from(extra.phi ?? [0.1, 0.12, 0.15, 0.18, NaN, 0.2, 0.5, 0.22]) },
      k: { label: 'k', unit: 'mD', values: Float64Array.from(extra.k ?? [1, 3, 20, 0, 100, 300, 50, 900]) },
      rhog: { label: 'ρg', unit: 'g/cm3', values: Float64Array.of(2.65, 2.65, 2.65, 2.65, 2.65, 2.65, 2.65, 3.4) },
      run: { label: 'Corona', values: ['1', '1', '1', '1', '2', '2', '2', '2'] },
      description: { label: 'Descripción', values: ['', '', '', '', '', 'Arenisca fisurada', '', ''] },
    },
  });
}

describe('model: claves y etiquetas', () => {
  it('clave de la serie k–φ: <conjunto>:kphi, ida y vuelta (el id puede tener «:»)', () => {
    expect(kphiSeriesKey('c1')).toBe('c1:kphi');
    expect(parseCoreSeriesKey('c1:kphi')).toEqual({ setId: 'c1', what: 'kphi' });
    expect(parseCoreSeriesKey('a:b:kphi')).toEqual({ setId: 'a:b', what: 'kphi' });
    expect(parseCoreSeriesKey('c1')).toEqual({ setId: 'c1', what: null });
  });

  it('rótulos de corona y color por corona estable en cada tema', () => {
    expect(runLabel('2')).toBe('Corona 2');
    expect(runLabel('A-3')).toBe('A-3');
    expect(runLabel(null)).toBe('Todos los plugs');
    const s = plugs();
    expect(runColor(s, '1', 'light')).not.toBe(runColor(s, '2', 'light'));
    expect(runColor(s, '1', 'light')).not.toBe(runColor(s, '1', 'dark'));
    expect(runColor(s, null, 'light')).toBe(runColor(s, '1', 'light'));
  });

  it('coreSets filtra por kind', () => {
    const other = createPointSet({ id: 'm', kind: 'pressure', name: 'MDT', depth: Float64Array.of(1), pointIds: ['a'], columns: {} });
    expect(coreSets([plugs(), other]).map((s) => s.id)).toEqual(['c1']);
  });
});

describe('model: coronas (grupos de puesta en profundidad)', () => {
  it('una por corona, con los índices de sus plugs', () => {
    const g = coreGroups(plugs());
    expect(g.map((x) => [x.run, x.label, x.indices])).toEqual([
      ['1', 'Corona 1', [0, 1, 2, 3]],
      ['2', 'Corona 2', [4, 5, 6, 7]],
    ]);
  });

  it('sin columna de corona: un solo grupo con todos', () => {
    const s = createPointSet({ id: 'x', kind: 'core', name: 'x', depth: Float64Array.of(1, 2), pointIds: ['a', 'b'], columns: { phi: { label: 'φ', unit: 'v/v', values: Float64Array.of(0.1, 0.2) } } });
    expect(coreGroups(s)).toEqual([{ run: null, label: 'Todos los plugs', indices: [0, 1] }]);
  });

  it('plugs sin corona en un conjunto que sí la tiene: grupo propio «Sin corona»', () => {
    const s = createPointSet({
      id: 'x',
      kind: 'core',
      name: 'x',
      depth: Float64Array.of(1, 2, 3),
      pointIds: ['a', 'b', 'c'],
      columns: { phi: { label: 'φ', unit: 'v/v', values: Float64Array.of(0.1, 0.2, 0.3) }, run: { label: 'Corona', values: ['1', '', '1'] } },
    });
    const g = coreGroups(s);
    expect(g.map((x) => [x.run, x.label, x.indices])).toEqual([
      ['1', 'Corona 1', [0, 2]],
      [null, 'Sin corona', [1]],
    ]);
  });
});

describe('model: calidad de los plugs (reglas que proponen)', () => {
  it('motivos por plug: k ≤ 0, sin φ ni k, φ fuera de [0; 0,45], densidad de grano fuera de [2,5; 3,0], fisurado', () => {
    const q = assessCoreQuality(plugs());
    expect(q.map((x) => x.reasons)).toEqual([
      [],
      [],
      [],
      ['kRange'], // k = 0
      [], // sin φ pero con k: tiene dato
      ['damaged'],
      ['phiRange'], // φ = 0,5
      ['rhogRange'], // ρg = 3,4
    ]);
    expect(q.map((x) => x.proposeExclude)).toEqual([false, false, false, true, false, true, true, true]);
  });

  it('sin φ ni k: «sin φ ni k»', () => {
    const s = plugs({ phi: [NaN, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], k: [NaN, 1, 1, 1, 1, 1, 1, 1] });
    expect(assessCoreQuality(s)[0]!.reasons).toEqual(['noData']);
  });

  it('descripciones de daño en español e inglés; sin acentos y con mayúsculas', () => {
    for (const t of ['Arenisca fisurada', 'plug FRACTURADO', 'broken at end', 'Se desmoronó', 'Roto', 'friable', 'no representativo', 'Unconsolidated']) expect(damagedFromText(t), t).toBe(true);
    for (const t of ['Arenisca media', '', undefined, 'bien seleccionada']) expect(damagedFromText(t), String(t)).toBe(false);
    expect(damagedFromText('Dañado')).toBe(true);
  });

  it('estado efectivo: la propuesta, salvo que el usuario decida; caché por identidad', () => {
    const s = plugs();
    const st = plugStatuses(s, undefined);
    expect(st.map((x) => x.included)).toEqual([true, true, true, false, true, false, false, false]);
    expect(plugStatuses(s, undefined)).toBe(st);
    const dec = { points: { p1: { status: 'exclude' as const }, p4: { status: 'include' as const } } };
    const st2 = plugStatuses(s, dec);
    expect(st2.map((x) => x.included)).toEqual([false, true, true, true, true, false, false, false]);
    expect(st2[0]!.decided).toBe('exclude');
    expect(st2[3]!.decided).toBe('include');
    expect(plugStatuses(s, dec)).toBe(st2);
  });

  it('decisión a guardar: null si coincide con la propuesta', () => {
    const q = assessCoreQuality(plugs());
    expect(plugDecisionFor(q[0]!, true)).toBeNull();
    expect(plugDecisionFor(q[0]!, false)).toEqual({ status: 'exclude' });
    expect(plugDecisionFor(q[3]!, false)).toBeNull();
    expect(plugDecisionFor(q[3]!, true)).toEqual({ status: 'include' });
  });
});

describe('series: proveedor «core» (crossplot k–φ)', () => {
  const interp = (partial: Partial<Interpretation> = {}): Interpretation => ({ ...emptyInterpretation([zone('za', 1000, 1006), zone('zb', 1010, 1016)]), ...partial });

  it('x = φ (v/v, lineal), y = k (mD, log), no es profundidad; claves de punto = ids', () => {
    const s = kphiSeries(plugs(), interp())!;
    expect(s.xIsDepth).toBe(false);
    expect(s.ref).toEqual({ provider: 'core', key: 'c1:kphi' });
    expect([s.xUnit, s.yUnit, s.xScale, s.yScale, s.xLabel, s.label]).toEqual(['v/v', 'mD', 'linear', 'log', 'φ', 'k']);
    // Incluidos con φ finito y k > 0: p1, p2, p3 y (p5 sin φ no; p4 k = 0 no; p6 fisurado no; p7 φ fuera no; p8 ρg no).
    expect(Array.from(s.x)).toEqual([0.1, 0.12, 0.15]);
    expect(Array.from(s.y)).toEqual([1, 3, 20]);
    expect(s.pointKey!(1)).toBe('p2');
    expect(s.indexOfKey!('p3')).toBe(2);
    expect(s.indexOfKey!('p6')).toBe(-1);
  });

  it('los plugs descartados a mano salen de la serie y los incluidos a mano entran', () => {
    const s = kphiSeries(plugs(), interp({ pointSets: { c1: { points: { p1: { status: 'exclude' }, p6: { status: 'include' } } } } }))!;
    expect(Array.from(s.x)).toEqual([0.12, 0.15, 0.2]);
    expect(Array.from(s.y)).toEqual([3, 20, 300]);
  });

  it('la profundidad de la serie es la CORREGIDA (por corona) y la serie conserva identidad mientras no cambian datos ni decisiones', () => {
    const set = plugs();
    const i1 = interp({ pointSets: { c1: { points: {}, depthShift: 1, runShifts: { '2': -2 } } } });
    const s = kphiSeries(set, i1)!;
    expect(Array.from(s.depth!)).toEqual([1002, 1003, 1004]);
    const s2 = kphiSeries(set, i1)!;
    expect(s2).toBe(s);
    const i2 = interp({ pointSets: { c1: { points: {}, depthShift: 5 } } });
    expect(kphiSeries(set, i2)).not.toBe(s);
    expect(Array.from(kphiSeries(set, i2)!.depth!)).toEqual([1006, 1007, 1008]);
  });

  it('sin columna φ o k: sin serie', () => {
    const s = createPointSet({ id: 'x', kind: 'core', name: 'x', depth: Float64Array.of(1, 2), pointIds: ['a', 'b'], columns: { phi: { label: 'φ', unit: 'v/v', values: Float64Array.of(0.1, 0.2) } } });
    expect(kphiSeries(s, interp())).toBeNull();
  });

  it('el proveedor lista y resuelve por clave; el sintético se rotula en la lista', () => {
    const well = createWell({ id: W, name: 'P', depth: Float64Array.of(1000, 1001), curves: [], pointSets: [plugs()] });
    const ctx = { well, interpretation: interp(), computed: [], catalog: defaultRoleCatalog };
    const list = coreSeriesProvider.list(ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: 'c1:kphi', label: 'Corona · k vs. φ', group: 'Corona', unit: 'mD' });
    expect(coreSeriesProvider.resolve(ctx, 'c1:kphi')).toBe(kphiSeries(well.pointSets[0]!, ctx.interpretation));
    expect(coreSeriesProvider.resolve(ctx, 'c1:otra')).toBeNull();
    expect(coreSeriesProvider.resolve(ctx, 'zz:kphi')).toBeNull();
    const syn = createWell({ id: W, name: 'P', depth: Float64Array.of(1000, 1001), curves: [], pointSets: [createPointSet({ ...{ id: 's', kind: 'core', name: 'Plugs', depth: Float64Array.of(1), pointIds: ['a'], synthetic: true, columns: { phi: { label: 'φ', unit: 'v/v', values: Float64Array.of(0.1) }, k: { label: 'k', unit: 'mD', values: Float64Array.of(1) } } } })] });
    expect(coreSeriesProvider.list({ ...ctx, well: syn })[0]!.label).toBe('Plugs (ejemplo sintético) · k vs. φ');
  });

  it('filtro por zona con profundidad corregida: el ajuste de una zona usa los plugs que CAEN en ella después de poner en profundidad', () => {
    // 4 plugs de la corona 1 (1001–1004) y 3 de la 2 (1011–1013, p5 sin φ). Zona ZA = 1000–1006.
    const set = plugs({ phi: [0.1, 0.12, 0.15, 0.18, 0.2, 0.22, 0.25, 0.3], k: [1, 3, 20, 60, 100, 300, 900, 2000] });
    const dockSpec = { ...kphiTrendSpec('t1', 'c1'), selection: { zoneId: 'za', excluded: [] } };
    const mk = (pointSets: Interpretation['pointSets']) => ({ ...emptyInterpretation([zone('za', 1000, 1006), zone('zb', 1010, 1016)]), trends: [dockSpec], pointSets });
    // Sin puesta en profundidad: ZA contiene la corona 1 (p1–p4; p4 k=60 incluido, p4 ρg ok).
    const i0 = mk({});
    const r0 = evaluateTrend(dockSpec, kphiSeries(set, i0)!, i0.zones);
    expect(r0.n).toBe(4);
    // La corona 2 se corre −8 m: cae en ZA (1003–1006) y la corona 1 sigue ahí. Incluidos: p1–p4 y p5, p7 (p6 fisurado y
    // p8 con ρg = 3,4 se proponen descartar) = 6.
    const i1 = mk({ c1: { points: {}, runShifts: { '2': -8 } } });
    const r1 = evaluateTrend(dockSpec, kphiSeries(set, i1)!, i1.zones);
    expect(r1.n).toBe(6);
    // La corona 1 se corre +20 m: sale de ZA; queda sin plugs.
    const i2 = mk({ c1: { points: {}, runShifts: { '1': 20 } } });
    const r2 = evaluateTrend(dockSpec, kphiSeries(set, i2)!, i2.zones);
    expect(r2.n).toBe(0);
  });

  it('modelo k–φ: datos exactos k = 0,02007·e^(50,22·φ) → tendencia exp recupera A y B; el modelo log10 es a ≈ −1,6975, b ≈ 21,81', () => {
    const phi = [0.06, 0.09, 0.12, 0.15, 0.18, 0.21];
    const k = phi.map((p) => 0.02007 * Math.exp(50.22 * p));
    const set = createPointSet({
      id: 'c1',
      kind: 'core',
      name: 'Exacto',
      depth: Float64Array.from(phi, (_, i) => 1000 + i),
      pointIds: phi.map((_, i) => `e${i}`),
      columns: { phi: { label: 'φ', unit: 'v/v', values: Float64Array.from(phi) }, k: { label: 'k', unit: 'mD', values: Float64Array.from(k) } },
    });
    const i = { ...emptyInterpretation(), trends: [kphiTrendSpec('t1', 'c1')] };
    const [t] = kphiTrends(set, i);
    expect(t!.result!.coeffs!.model).toBe('exp');
    expect(t!.result!.coeffs!.a).toBeCloseTo(0.02007, 8);
    expect(t!.result!.coeffs!.b).toBeCloseTo(50.22, 6);
    expect(t!.result!.r2).toBeCloseTo(1, 10);
    expect(t!.model).toEqual({ a: -1.6975, b: 21.81 }); // redondeado a 4 y 3 decimales
    expect(t!.index).toBe(0);
  });

  it('kphiTrends solo toma las tendencias de este conjunto y de esta serie', () => {
    const set = plugs();
    const other = { ...kphiTrendSpec('t2', 'otro'), name: 'otro' };
    const curveTrend = { ...kphiTrendSpec('t3', 'c1'), series: { provider: 'curve', key: 'm:GR' } };
    const i = { ...emptyInterpretation(), trends: [other, kphiTrendSpec('t1', 'c1'), curveTrend] };
    expect(kphiTrends(set, i).map((t) => [t.spec.id, t.index])).toEqual([['t1', 1]]);
  });
});

describe('modelo k–φ hacia el motor', () => {
  it('kphiModelOf: solo el exponencial, redondeado; lineal, nulo o inválido → null', () => {
    expect(kphiModelOf({ model: 'exp', a: 0.02007, b: 50.22 })).toEqual({ a: -1.6975, b: 21.81 });
    expect(kphiModelOf({ model: 'linear', a: 1, b: 2 })).toBeNull();
    expect(kphiModelOf({ model: 'exp', a: -1, b: 2 })).toBeNull();
    expect(kphiModelOf(null)).toBeNull();
    expect(kphiModelOf(undefined)).toBeNull();
  });

  it('roundModel: a con 4 decimales y b con 3', () => {
    expect(roundModel({ a: -1.697471, b: 21.80999 })).toEqual({ a: -1.6975, b: 21.81 });
  });

  const base = () => addWell(createProject(), createWell({ id: W, name: 'P', depth: Float64Array.of(1000, 1001), curves: [] }), [zone('za', 1000, 1000.5)]);

  it('sin aplicar: valores por defecto del módulo y estado «unapplied»', () => {
    const i = getWellEntry(base(), W).interpretation;
    expect(permCoreParams(i, null)).toEqual({ a: -2, b: 20, set: false });
    expect(kphiSync(i, { a: -1.7, b: 22 }, null)).toEqual({ state: 'unapplied', params: { a: -2, b: 20 } });
    expect(permCoreIsSource(i)).toBe(false);
  });

  it('«Aplicar al pozo»: escribe a y b globales (redondeados) en una sola receta; «synced» y luego «stale» si el ajuste cambia', () => {
    const p = applyKPhiModel(base(), W, { a: -1.69747, b: 21.8099 });
    const i = getWellEntry(p, W).interpretation;
    expect(i.params.global['perm-core.kphiA']).toBe(-1.6975);
    expect(i.params.global['perm-core.kphiB']).toBe(21.81);
    expect(i.sources['PERM']).toBeUndefined(); // no cambia la fuente si no se pide
    expect(permCoreParams(i, null)).toEqual({ a: -1.6975, b: 21.81, set: true });
    expect(kphiSync(i, { a: -1.69747, b: 21.8099 }, null).state).toBe('synced');
    expect(kphiSync(i, { a: -1.6, b: 21.81 }, null).state).toBe('stale');
    expect(kphiSync(i, null, null).state).toBe('stale'); // el ajuste ya no existe
  });

  it('con `useAsSource`, perm-core pasa a ser la fuente de PERM', () => {
    const p = applyKPhiModel(base(), W, { a: -1.7, b: 22 }, { useAsSource: true });
    const i = getWellEntry(p, W).interpretation;
    expect(i.sources['PERM']).toEqual({ kind: 'module', moduleId: 'perm-core' });
    expect(permCoreIsSource(i)).toBe(true);
  });

  it('por zona: escribe en la zona, los globales quedan; la zona lee lo suyo y las demás los globales', () => {
    let p = applyKPhiModel(base(), W, { a: -1.7, b: 22 });
    p = applyKPhiModel(p, W, { a: -2.5, b: 18 }, { zoneId: 'za' });
    const i = getWellEntry(p, W).interpretation;
    expect(i.params.zones['za']).toEqual({ 'perm-core.kphiA': -2.5, 'perm-core.kphiB': 18 });
    expect(permCoreParams(i, 'za')).toEqual({ a: -2.5, b: 18, set: true });
    expect(permCoreParams(i, null)).toEqual({ a: -1.7, b: 22, set: true });
    expect(kphiSync(i, { a: -2.5, b: 18 }, 'za').state).toBe('synced');
    expect(kphiSync(i, { a: -2.5, b: 18 }, null).state).toBe('stale');
  });

  it('zona inexistente: error', () => {
    expect(() => applyKPhiModel(base(), W, { a: 1, b: 1 }, { zoneId: 'nope' })).toThrow(/No existe la zona/);
  });

  it('el modelo ajustado sobre los datos de ejemplo se traduce al motor con la conversión de petro', () => {
    expect(expTrendToLogLinear(Math.pow(10, EXAMPLE_A), EXAMPLE_B * Math.LN10)).toEqual({ a: expect.closeTo(EXAMPLE_A, 12), b: expect.closeTo(EXAMPLE_B, 12) });
  });
});

describe('ejemplo sintético', () => {
  // PHIE sintética del perfil del TP: 7900–8200 m cada 0,1524 m, con estructura de capas (suma de senos).
  const logDepth = Float64Array.from({ length: 1969 }, (_, i) => 7900 + i * 0.1524);
  const phie = Float64Array.from(logDepth, (z) => 0.12 + 0.06 * Math.sin(z / 2.9) + 0.035 * Math.sin(z / 1.15 + 1) + 0.02 * Math.sin(z / 7.1 + 2));
  const set = exampleCoreSet('ej', { depth: logDepth, phie })!;

  it('está rotulado como sintético, con dos coronas y columnas completas', () => {
    expect(set.synthetic).toBe(true);
    expect(set.kind).toBe('core');
    expect(set.name).toMatch(/sintético/);
    expect(set.pointIds.length).toBeGreaterThanOrEqual(30);
    expect(coreGroups(set).map((g) => g.run)).toEqual(['1', '2']);
    for (const c of ['phi', 'k', 'rhog', 'run', 'description']) expect(set.columns[c], c).toBeDefined();
  });

  it('es reproducible (semilla fija)', () => {
    const again = exampleCoreSet('ej', { depth: logDepth, phie })!;
    expect([...again.depth]).toEqual([...set.depth]);
    expect([...(again.columns['phi']!.values as Float64Array)]).toEqual([...(set.columns['phi']!.values as Float64Array)]);
  });

  it('el archivo está corrido −2,4 m y −1,6 m respecto de la profundidad verdadera (diseño)', () => {
    expect(EXAMPLE_SHIFTS).toEqual({ '1': 2.4, '2': 1.6 });
    const first = coreGroups(set)[0]!.indices[0]!;
    expect(set.depth[first]).toBeCloseTo(7986 - 2.4, 6);
  });

  it('el plug fisurado y el desmoronado se proponen descartar', () => {
    const q = assessCoreQuality(set);
    const bad = q.filter((x) => x.proposeExclude);
    expect(bad).toHaveLength(2);
    expect(bad.flatMap((x) => x.reasons).sort()).toEqual(['damaged', 'damaged', 'phiRange'].sort());
  });

  it('la sugerencia de desplazamiento recupera el de diseño de cada corona (± 0,15 m: el ruido de φ, σ = 0,008, corre el máximo unos pasos de 0,05 m)', () => {
    const st = plugStatuses(set, undefined);
    const phi = set.columns['phi']!.values as Float64Array;
    for (const g of coreGroups(set)) {
      const idx = g.indices.filter((i) => st[i]!.included);
      const r = suggestDepthShift(
        idx.map((i) => set.depth[i]!),
        idx.map((i) => phi[i]!),
        logDepth,
        phie,
        { maxShift: 6, step: 0.05 },
      );
      expect(Math.abs(r.best! - EXAMPLE_SHIFTS[g.run!]!), `corona ${g.run}: ${r.best}`).toBeLessThanOrEqual(0.15 + 1e-9);
      expect(r.r).toBeGreaterThan(0.9);
    }
  });

  it('con los desplazamientos de diseño, los plugs quedan en la profundidad verdadera y el modelo k–φ ajustado recupera a ≈ −1,7 y b ≈ 22', () => {
    let p = addWell(createProject(), createWell({ id: W, name: 'P', depth: logDepth, curves: [] }));
    p = addCoreExample(p, W, set, 't1');
    for (const [run, s] of Object.entries(EXAMPLE_SHIFTS)) p = setPointSetDepthShift(p, W, 'ej', s, run);
    const i = getWellEntry(p, W).interpretation;
    expect(i.trends).toHaveLength(1);
    expect(i.trends[0]).toMatchObject({ model: 'exp', series: { provider: 'core', key: 'ej:kphi' } });
    const [t] = kphiTrends(getWellEntry(p, W).well.pointSets[0]!, i);
    // Los dos plugs malos no entran; el resto sigue k = 10^(a + b·φ + ε) con ε ~ N(0; 0,22).
    expect(t!.result!.n).toBe(set.pointIds.length - 2);
    expect(t!.model!.a).toBeGreaterThan(EXAMPLE_A - 0.4);
    expect(t!.model!.a).toBeLessThan(EXAMPLE_A + 0.4);
    expect(t!.model!.b).toBeGreaterThan(EXAMPLE_B - 4);
    expect(t!.model!.b).toBeLessThan(EXAMPLE_B + 4);
    expect(t!.result!.r2!).toBeGreaterThan(0.8);
  });

  it('ruido/decisiones: descartar un plug a mano lo saca del modelo (receta del núcleo)', () => {
    let p = addWell(createProject(), createWell({ id: W, name: 'P', depth: logDepth, curves: [] }));
    p = addCoreExample(p, W, set, 't1');
    const n0 = kphiTrends(getWellEntry(p, W).well.pointSets[0]!, getWellEntry(p, W).interpretation)[0]!.result!.n;
    const id = set.pointIds[0]!;
    p = setPointDecision(p, W, 'ej', id, { status: 'exclude' });
    const n1 = kphiTrends(getWellEntry(p, W).well.pointSets[0]!, getWellEntry(p, W).interpretation)[0]!.result!.n;
    expect(n1).toBe(n0 - 1);
  });

  it('en un pozo sin porosidad en las coronas no se arma el ejemplo', () => {
    expect(exampleCoreSet('x', { depth: Float64Array.from({ length: 100 }, (_, i) => 1000 + i), phie: new Float64Array(100).fill(0.1) })).toBeNull();
    expect(exampleCoreSet('x', { depth: logDepth, phie: new Float64Array(logDepth.length).fill(NaN) })).toBeNull();
  });
});
