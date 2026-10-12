/**
 * Tipos de roca (fase 8, función P; docs/decisiones/0024): módulo del motor `rock-typing` (FZI, R35 y clase por
 * muestra, tabla por clase) contra cuentas de libro, cadena con el motor en el pozo de demostración, modelo puro del
 * panel (`src/modules/rock-typing/model.ts`: plugs en profundidad corregida, Winland/Pittman, unidades de flujo, recetas
 * «Llevar al pozo», presión capilar de ejemplo y digitalizada) y tramos de la pista.
 */
import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell, type EngineCurve, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import { createPointSet, type PointSet } from '../src/core/pointSets';
import { setPointDecision, setPointSetDepthShift, setPointSetSetting } from '../src/core/state/pointSets';
import { addWell, createProject, getWellEntry } from '../src/core/state/project';
import { createWell } from '../src/core/well';
import { getUnit, parseUnit } from '../src/core/units';
import { registry } from '../src/modules';
import { DEFAULT_BOUNDS, ROCK_TYPES_TABLE, ROCK_TYPING_ID } from '../src/modules/rock-typing';
import {
  applyFlowUnits,
  applyWinland,
  boundsToApply,
  CAPILLARY_KIND,
  capillaryCurves,
  classRangeText,
  curveFlowUnit,
  curveThroats,
  decodeBounds,
  encodeBounds,
  examplePcCurves,
  flowUnitRows,
  flowUnitsApplied,
  leverettCurve,
  pcCurvesFromPointSet,
  plugFlowUnits,
  plugThroatRadii,
  portClassCounts,
  portClasses,
  rockModuleParams,
  rockPlugs,
  rockSettings,
  roundBound,
  rqiLine,
  RT_BOUNDS_SETTING,
  RT_MODE_SETTING,
  RT_THROAT_SETTING,
  RT_UNITS_SETTING,
  throatIsoline,
} from '../src/modules/rock-typing/model';
import { classColor } from '../src/modules/rock-typing/draw';
import { classRuns } from '../src/modules/rock-typing/overlay';
import { flowZoneIndex, PITTMAN_COEFFICIENTS, throatRadius, winlandR35, EXAMPLE_J_DISPLACEMENT } from '../src/petro/rockTyping';
import { SEQUENTIAL_PALETTE } from '../src/ui/curves';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { curve, well, zone } from './helpers';

// ── módulo del motor: 8 muestras cada 0,5 m ─────────────────────────────────────────────────────────────────────
const PHI = [0.2, 0.2, 0.2, 0.2, 0.1, 0.25, NaN, 0.3];
const K = [1, 10, 100, 1000, 5, 500, 10, -1];
const N = PHI.length;

const run = (partial: Partial<Interpretation> = {}, curves: EngineCurve[] = [curve('PHIE_X', 'PHIE', PHI), curve('K_X', 'PERM', K)]): EngineRunResult => {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(well(curves, N, 1000, 0.5));
  return engine.run({ ...emptyInterpretation([zone('za', 1000, 1003.5)]), ...partial });
};
function out<T = Float64Array>(r: EngineRunResult, port: string): T {
  const o = r.outputs.find((x) => x.key === `${ROCK_TYPING_ID}:${port}`);
  if (!o) throw new Error(`Falta la salida ${ROCK_TYPING_ID}:${port}`);
  return o.value as T;
}
const warnings = (r: EngineRunResult) => r.diagnostics.filter((d) => d.level === 'warning' && d.moduleId === ROCK_TYPING_ID).map((d) => d.message);
const params = (g: Record<string, number | string>) => ({ params: { global: Object.fromEntries(Object.entries(g).map(([k, v]) => [`${ROCK_TYPING_ID}.${k}`, v])), zones: {} } });

describe('rock-typing: registro, roles y unidades', () => {
  const m = registry.modules.find((x) => x.id === ROCK_TYPING_ID)!;

  it('registrado detrás de perm-core, categoría Permeabilidad, único productor de FZI, R35 y ROCK_TYPE', () => {
    const ids = registry.modules.map((x) => x.id);
    expect(ids.indexOf(ROCK_TYPING_ID)).toBe(ids.indexOf('perm-core') + 1);
    expect(m.category).toBe('permeability');
    for (const role of ['FZI', 'R35', 'ROCK_TYPE']) {
      expect(registry.modules.filter((x) => Object.values(x.outputs).some((o) => o.kind === 'curve' && o.role === role)).map((x) => x.id)).toEqual([ROCK_TYPING_ID]);
    }
    expect(registry.roles.get('FZI')).toMatchObject({ unit: 'um', family: 'permeability', display: { scale: 'log' } });
    expect(registry.roles.get('ROCK_TYPE')).toMatchObject({ unit: 'unitless', family: 'lithology' });
  });

  it('µm es una longitud y se reconoce en los archivos', () => {
    expect(getUnit('um')).toMatchObject({ dimension: 'length', factor: 1e-6, label: 'µm' });
    for (const t of ['um', 'UM', 'µm', 'μm', 'micron']) expect(parseUnit(t), t).toBe('um');
  });

  it('entradas PHIE y PERM; parámetros globales con límites de fábrica crecientes', () => {
    expect(Object.values(m.inputs).map((i) => ('role' in i ? i.role : null))).toEqual(['PHIE', 'PERM']);
    expect(m.params['method']).toMatchObject({ type: 'enum', default: 'fzi' });
    expect(m.params['nUnits']).toMatchObject({ type: 'number', default: 4, min: 2, max: 6 });
    expect(DEFAULT_BOUNDS.every((v, i) => i === 0 || v > DEFAULT_BOUNDS[i - 1]!)).toBe(true);
    expect(m.docs.equations.length).toBeGreaterThanOrEqual(6);
    expect(m.docs.references.join(' ')).toContain('Amaefule');
  });
});

describe('rock-typing: valores por muestra', () => {
  const r = run();

  it('FZI y R35 de libro (φ 0,20, k 100 mD: FZI 2,8085 µm, R35 6,08 µm); sin dato con φ o k inválidas', () => {
    const fzi = out(r, 'FZI');
    const r35 = out(r, 'R35');
    // RQI = 0,0314·√(100/0,2) = 0,70212; φz = 0,25 → FZI = 2,80848
    expect(fzi[2]).toBeCloseTo(2.80848, 4);
    // log R35 = 0,732 + 0,588·2 − 0,864·log 20 = 0,78388
    expect(r35[2]).toBeCloseTo(10 ** 0.78388, 3);
    for (let i = 0; i < N; i++) {
      const e = flowZoneIndex(PHI[i]!, K[i]!);
      if (Number.isNaN(e)) expect(fzi[i]).toBeNaN();
      else expect(fzi[i]).toBeCloseTo(e, 12);
      const w = winlandR35(PHI[i]!, K[i]!);
      if (Number.isNaN(w)) expect(r35[i]).toBeNaN();
      else expect(r35[i]).toBeCloseTo(w, 12);
    }
    expect(fzi[6]).toBeNaN();
    expect(fzi[7]).toBeNaN();
  });

  it('clase por FZI con los límites de fábrica (4 unidades: 0,25 · 0,6 · 1,5)', () => {
    const cls = out(r, 'ROCK_TYPE');
    const fzi = out(r, 'FZI');
    const bounds = DEFAULT_BOUNDS.slice(0, 3);
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(fzi[i]!)) expect(cls[i]).toBeNaN();
      else expect(cls[i]).toBe(bounds.filter((b) => fzi[i]! >= b).length);
    }
    // φ 0,2: k 1 → FZI 0,28 (UF 2); k 1000 → FZI 8,9 (UF 4)
    expect(cls[0]).toBe(1);
    expect(cls[3]).toBe(3);
  });

  it('número de unidades y límites del usuario; un límite fuera de orden avisa y se ordena', () => {
    const two = out(run(params({ nUnits: 2, fzi1: 1 })), 'ROCK_TYPE');
    expect([...two.slice(0, 6)]).toEqual([0, 0, 1, 1, 1, 1]); // φ 0,1 y k 5: FZI 2,0
    const r2 = run(params({ nUnits: 3, fzi1: 2, fzi2: 0.5 }));
    expect(warnings(r2).some((w) => w.includes('orden creciente'))).toBe(true);
    const fzi = out(r2, 'FZI');
    const cls = out(r2, 'ROCK_TYPE');
    for (let i = 0; i < 6; i++) expect(cls[i]).toBe((fzi[i]! >= 0.5 ? 1 : 0) + (fzi[i]! >= 2 ? 1 : 0));
  });

  it('método Winland: clase de garganta por R35 (nano … mega)', () => {
    const r2 = run(params({ method: 'winland' }));
    const r35 = out(r2, 'R35');
    const cls = out(r2, 'ROCK_TYPE');
    const edges = [0.1, 0.5, 2, 10];
    for (let i = 0; i < 6; i++) expect(cls[i]).toBe(edges.filter((e) => r35[i]! > e).length);
    expect(out<TableValue>(r2, ROCK_TYPES_TABLE).rows.map((x) => x['rockType'])).toEqual(['Nano', 'Micro', 'Meso', 'Macro', 'Mega']);
  });

  it('tabla por clase: muestras, espesor, φ media y k media geométrica', () => {
    const rows = out<TableValue>(r, ROCK_TYPES_TABLE).rows;
    expect(rows.map((x) => x['rockType'])).toEqual(['UF 1', 'UF 2', 'UF 3', 'UF 4']);
    const cls = out(r, 'ROCK_TYPE');
    rows.forEach((row, c) => {
      const idx = [...cls.keys()].filter((i) => cls[i] === c);
      expect(row['n']).toBe(idx.length);
      if (!idx.length) return;
      expect(row['phi'] as number).toBeCloseTo(idx.reduce((s, i) => s + PHI[i]!, 0) / idx.length, 12);
      expect(row['k'] as number).toBeCloseTo(10 ** (idx.reduce((s, i) => s + Math.log10(K[i]!), 0) / idx.length), 9);
      expect(row['thickness'] as number).toBeGreaterThan(0);
    });
    expect(rows[0]!['lower']).toBeNull();
    expect(rows[3]!['upper']).toBeNull();
    expect(warnings(r)).toEqual([]);
  });

  it('sin muestras válidas avisa', () => {
    const r2 = run({}, [curve('PHIE_X', 'PHIE', PHI.map(() => NaN)), curve('K_X', 'PERM', K)]);
    expect(warnings(r2).some((w) => w.includes('Ninguna muestra'))).toBe(true);
  });
});

describe('rock-typing: cadena con el motor (pozo de demostración)', () => {
  const demo = syntheticWell();
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(toEngineWell(demo.well));
  const r1 = engine.run(emptyInterpretation(demo.zones));

  it('corre detrás de PHIE y PERM calculadas y clasifica la mayoría de las muestras con porosidad', () => {
    expect(r1.nodes.find((x) => x.moduleId === ROCK_TYPING_ID)?.status).toBe('ok');
    const cls = r1.outputs.find((o) => o.key === `${ROCK_TYPING_ID}:ROCK_TYPE`)!.value as Float64Array;
    const n = cls.filter(Number.isFinite).length;
    expect(n).toBeGreaterThan(cls.length * 0.3);
  });

  it('cambiar los límites recalcula solo este módulo', () => {
    const r2 = engine.run({ ...emptyInterpretation(demo.zones), ...params({ fzi2: 0.8 }) });
    expect(r2.stats.recomputed).toEqual([ROCK_TYPING_ID]);
  });
});

// ── modelo del panel ─────────────────────────────────────────────────────────────────────────────────────────

const W = 'w';
/** 9 plugs en tres familias de FZI de diseño (0,3 · 1,2 · 5 µm), con φ variadas; el 9 sin k. */
const FAM = [0.3, 0.3, 0.3, 1.2, 1.2, 1.2, 5, 5, 5];
const PPHI = [0.08, 0.12, 0.16, 0.1, 0.15, 0.2, 0.14, 0.2, 0.26];
const kFor = (fzi: number, phi: number) => (phi ** 3 * fzi ** 2) / (0.0314 ** 2 * (1 - phi) ** 2);

function plugSet(): PointSet {
  const k = PPHI.map((p, i) => kFor(FAM[i]!, p));
  k[8] = NaN;
  return createPointSet({
    id: 'c1',
    kind: 'core',
    name: 'Corona',
    depth: Float64Array.from(PPHI, (_, i) => 1000 + i),
    pointIds: PPHI.map((_, i) => `p${i + 1}`),
    columns: {
      phi: { label: 'φ', unit: 'v/v', values: Float64Array.from(PPHI) },
      k: { label: 'k', unit: 'mD', values: Float64Array.from(k) },
      run: { label: 'Corona', values: PPHI.map(() => '1') },
      description: { label: 'Descripción', values: PPHI.map(() => '') },
    },
  });
}
function project(set: PointSet) {
  let p = addWell(createProject(), createWell({ id: W, name: 'P', depth: Float64Array.from({ length: 100 }, (_, i) => 995 + i * 0.2), curves: [] }));
  p = { ...p, wells: p.wells.map((e) => ({ ...e, well: { ...e.well, pointSets: [set] } })) };
  return p;
}
const decOf = (p: ReturnType<typeof project>) => getWellEntry(p, W).interpretation.pointSets['c1'];

describe('panel: ajustes y plugs', () => {
  it('ajustes por defecto y guardados (modo, unidades, límites, radio)', () => {
    let p = project(plugSet());
    expect(rockSettings(decOf(p))).toEqual({ mode: 'auto', nUnits: 4, manualBounds: null, throat: 'winland' });
    p = setPointSetSetting(p, W, 'c1', RT_MODE_SETTING, 'manual');
    p = setPointSetSetting(p, W, 'c1', RT_UNITS_SETTING, 9);
    p = setPointSetSetting(p, W, 'c1', RT_BOUNDS_SETTING, encodeBounds([0.5, 2]));
    p = setPointSetSetting(p, W, 'c1', RT_THROAT_SETTING, 'p50');
    expect(rockSettings(decOf(p))).toEqual({ mode: 'manual', nUnits: 6, manualBounds: [0.5, 2], throat: 'p50' });
    expect(decodeBounds('2;0.5')).toBeNull();
    expect(decodeBounds('0.5;x')).toBeNull();
  });

  it('plugs incluidos con φ y k válidas, en la profundidad corregida (shiftedDepth)', () => {
    const set = plugSet();
    let p = setPointSetDepthShift(project(set), W, 'c1', 1.5);
    p = setPointDecision(p, W, 'c1', 'p2', { status: 'exclude' });
    const pl = rockPlugs(set, decOf(p));
    expect(pl.idx).toEqual([0, 2, 3, 4, 5, 6, 7]);
    expect(pl.skipped).toBe(1);
    expect(pl.depth[0]).toBeCloseTo(1001.5, 12);
    pl.idx.forEach((i, j) => expect(pl.fzi[j]).toBeCloseTo(FAM[i]!, 9));
    expect(pl.phiZ[0]).toBeCloseTo(0.08 / 0.92, 12);
  });
});

describe('panel: Winland y Pittman', () => {
  const pl = rockPlugs(plugSet(), undefined);

  it('radios con Winland y con Pittman; clases y cuentas', () => {
    const w = plugThroatRadii(pl, 'winland');
    const p50 = plugThroatRadii(pl, 'p50');
    pl.idx.forEach((_, j) => {
      expect(w[j]).toBeCloseTo(winlandR35(pl.phi[j]!, pl.k[j]!), 12);
      expect(p50[j]).toBeCloseTo(throatRadius(PITTMAN_COEFFICIENTS[50]!, pl.phi[j]!, pl.k[j]!), 12);
    });
    const cls = portClasses(w);
    expect(portClassCounts(cls).reduce((a, b) => a + b, 0)).toBe(pl.idx.length);
  });

  it('isolínea: cada punto tiene exactamente el radio pedido', () => {
    const iso = throatIsoline('winland', 2, 0.05, 0.3);
    for (let i = 0; i < iso.x.length; i++) expect(winlandR35(iso.x[i]!, iso.y[i]!)).toBeCloseTo(2, 9);
    const p25 = throatIsoline('p25', 0.5, 0.05, 0.3);
    for (let i = 0; i < p25.x.length; i++) expect(throatRadius(PITTMAN_COEFFICIENTS[25]!, p25.x[i]!, p25.y[i]!)).toBeCloseTo(0.5, 9);
  });
});

describe('panel: unidades de flujo', () => {
  const pl = rockPlugs(plugSet(), undefined);

  it('automático con 3 unidades recupera las tres familias de diseño (GVF ≈ 1)', () => {
    const fu = plugFlowUnits(pl, { mode: 'auto', nUnits: 3, manualBounds: null })!;
    expect(fu.classes).toHaveLength(3);
    expect([...fu.labels]).toEqual([0, 0, 0, 1, 1, 1, 2, 2]);
    expect(fu.gvf).toBeGreaterThan(0.999);
    const rows = flowUnitRows(pl, fu);
    expect(rows.map((r) => r.n)).toEqual([3, 3, 2]);
    expect(rows[1]!.fziMean).toBeCloseTo(1.2, 9);
    expect(rows[1]!.phi).toBeCloseTo(0.15, 12);
    expect(rows[2]!.k).toBeCloseTo(Math.sqrt(kFor(5, 0.14) * kFor(5, 0.2)), 6);
  });

  it('manual: los límites del usuario mandan', () => {
    const fu = plugFlowUnits(pl, { mode: 'manual', nUnits: 4, manualBounds: [1] })!;
    expect(fu.bounds).toEqual([1]);
    expect([...fu.labels]).toEqual([0, 0, 0, 1, 1, 1, 1, 1]);
  });

  it('recta de pendiente 1 en log RQI – log φz', () => {
    const l = rqiLine(2, 0.1, 0.5);
    expect(Math.log10(l.y[1]! / l.y[0]!) / Math.log10(l.x[1]! / l.x[0]!)).toBeCloseTo(1, 12);
    expect(l.y[0]).toBeCloseTo(0.2, 12);
  });

  it('redondeo de límites a 3 cifras dentro de 0,01–100 µm; repetidos se descartan', () => {
    expect(roundBound(0.123456)).toBe(0.123);
    expect(roundBound(1234)).toBe(100);
    expect(roundBound(-1)).toBeNaN();
    expect(boundsToApply([0.5004, 0.5001, 2.3456])).toEqual([0.5, 2.35]);
  });
});

describe('panel: «Llevar al pozo»', () => {
  it('escribe método, unidades y límites en una receta, y el motor clasifica igual que el panel', () => {
    const set = plugSet();
    const p0 = project(set);
    const pl = rockPlugs(set, undefined);
    const fu = plugFlowUnits(pl, { mode: 'auto', nUnits: 3, manualBounds: null })!;
    const p1 = applyFlowUnits(p0, W, fu.bounds);
    const prm = getWellEntry(p1, W).interpretation.params;
    expect(prm.global[`${ROCK_TYPING_ID}.method`]).toBe('fzi');
    expect(prm.global[`${ROCK_TYPING_ID}.nUnits`]).toBe(3);
    expect(rockModuleParams(prm).bounds).toEqual(boundsToApply(fu.bounds));
    expect(flowUnitsApplied(prm, fu.bounds)).toBe(true);
    expect(flowUnitsApplied(getWellEntry(p0, W).interpretation.params, fu.bounds)).toBe(false);

    // El motor, con φ y k de los plugs como perfil, da las mismas clases que el panel.
    const engine = new Engine(registry);
    engine.setWell(well([curve('PHIE_X', 'PHIE', pl.phi), curve('K_X', 'PERM', pl.k)], pl.phi.length));
    const r = engine.run({ ...emptyInterpretation(), params: prm });
    const cls = r.outputs.find((o) => o.key === `${ROCK_TYPING_ID}:ROCK_TYPE`)!.value as Float64Array;
    expect([...cls]).toEqual([...fu.labels]);
  });

  it('clases de Winland: cambia solo el método', () => {
    const p = applyWinland(project(plugSet()), W);
    const prm = getWellEntry(p, W).interpretation.params;
    expect(prm.global).toEqual({ [`${ROCK_TYPING_ID}.method`]: 'winland' });
    expect(rockModuleParams(prm)).toMatchObject({ method: 'winland', nUnits: 4 });
  });

  it('valores de fábrica cuando no se aplicó nada', () => {
    expect(rockModuleParams({ global: {} })).toEqual({ method: 'fzi', nUnits: 4, bounds: DEFAULT_BOUNDS.slice(0, 3) });
    expect(classRangeText('fzi', 0, [0.5, 2], (v) => String(v))).toBe('FZI < 0.5 µm');
    expect(classRangeText('fzi', 1, [0.5, 2], (v) => String(v))).toBe('FZI 0.5–2 µm');
    expect(classRangeText('winland', 4, [], (v) => String(v))).toBe('R35 > 10 µm');
  });
});

describe('panel: presión capilar', () => {
  it('ejemplo de libro: cinco curvas rotuladas, J en la entrada = J de desplazamiento de diseño', () => {
    const cs = examplePcCurves();
    expect(cs).toHaveLength(5);
    for (const c of cs) {
      expect(c.source).toBe('book');
      expect(c.pc[1]!).toBeGreaterThan(c.pc[0]!);
      expect(leverettCurve(c)[0]).toBeCloseTo(EXAMPLE_J_DISPLACEMENT, 9);
      const d = curveThroats(c);
      expect(d.radius.length).toBeGreaterThan(10);
      // El radio mayor es el de entrada (Washburn con la Pd de la curva).
      expect(Math.max(...d.radius)).toBeLessThan(106.66 / c.pc[0]! + 1e-9);
    }
    expect(capillaryCurves([]).book).toBe(true);
    // Ejemplo A (k 1000, φ 0,25: FZI ≈ 6) cae en la unidad más alta con límites 1 y 3.
    expect(curveFlowUnit(cs[0]!, [1, 3])).toBe(2);
  });

  it('preparado para Pc–Sw digitalizado: un conjunto `capillary` da una curva por muestra, ordenada por Pc', () => {
    const set = createPointSet({
      id: 'pc1',
      kind: CAPILLARY_KIND,
      name: 'MICP',
      depth: Float64Array.of(1000, 1000, 1000, 1001, 1001),
      pointIds: ['a', 'b', 'c', 'd', 'e'],
      columns: {
        sample: { label: 'Muestra', values: ['M1', 'M1', 'M1', 'M2', 'M2'] },
        sw: { label: 'Sw', unit: 'v/v', values: Float64Array.of(0.5, 1, 0.3, 1, 0.4) },
        pc: { label: 'Pc', unit: 'psi', values: Float64Array.of(50, 5, 200, 10, 100) },
        k: { label: 'k', unit: 'mD', values: Float64Array.of(100, NaN, NaN, 10, NaN) },
        phi: { label: 'φ', unit: 'v/v', values: Float64Array.of(0.2, NaN, NaN, 0.15, NaN) },
      },
    });
    const cs = pcCurvesFromPointSet(set);
    expect(cs.map((c) => c.label)).toEqual(['M1', 'M2']);
    expect([...cs[0]!.pc]).toEqual([5, 50, 200]);
    expect([...cs[0]!.sw]).toEqual([1, 0.5, 0.3]);
    expect(cs[0]).toMatchObject({ source: 'measured', k: 100, phi: 0.2 });
    expect(capillaryCurves([set])).toMatchObject({ book: false });
    expect(pcCurvesFromPointSet(plugSet())).toEqual([]);
  });
});

describe('pista y colores', () => {
  it('tramos de clase constante (NaN corta el tramo)', () => {
    const r = classRuns(Float64Array.of(0, 0, 1, NaN, 1, 1, 2));
    expect([...r.start]).toEqual([0, 2, 4, 6]);
    expect([...r.end]).toEqual([2, 3, 6, 7]);
    expect([...r.cls]).toEqual([0, 1, 1, 2]);
  });

  it('colores: extremos de la rampa viridis del sistema de diseño (peor violeta, mejor amarillo)', () => {
    expect(classColor(0, 4, 'light').toLowerCase()).toBe(SEQUENTIAL_PALETTE.light[0]);
    expect(classColor(3, 4, 'dark').toLowerCase()).toBe(SEQUENTIAL_PALETTE.dark[SEQUENTIAL_PALETTE.dark.length - 1]);
  });
});
