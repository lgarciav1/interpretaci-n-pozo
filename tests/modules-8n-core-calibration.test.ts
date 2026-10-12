/**
 * Calibración con corona (fase 8, función N; docs/decisiones/0023): módulo del motor `core-calibration` (ρmaa por
 * muestra, tabla y valor por zona) contra cuentas escritas en el test, cadena con el motor sobre el pozo de
 * demostración y el del TP, y modelo puro del panel (`src/modules/core-calibration/model.ts`): plugs en su profundidad
 * corregida, φ perfil vs. corona, densidad de matriz, exponente m y recetas «Aplicar».
 */
import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell, type EngineCurve, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import { createPointSet, type PointSet } from '../src/core/pointSets';
import { setPointDecision, setPointSetDepthShift, setPointSetSetting } from '../src/core/state/pointSets';
import { addWell, createProject, getWellEntry, setParam } from '../src/core/state/project';
import { createWell, type Zone } from '../src/core/well';
import { buildCoreSet, parseTable, readWellFile, suggestCoreMapping } from '../src/io';
import { registry } from '../src/modules';
import { CORE_CALIBRATION_ID, RHOMAA_ZONE, RHOMAA_ZONES } from '../src/modules/core-calibration';
import {
  applyCementation,
  applyMatrixDensity,
  archieLine,
  CALIB_CURVE_SETTING,
  CALIB_PARAMS,
  CALIB_WINDOW_SETTING,
  calibCurveKey,
  calibWindow,
  DEFAULT_WINDOW,
  depthMatchState,
  includedPlugs,
  isApplied,
  logCementation,
  matrixDensityEstimates,
  paramValue,
  plugCementation,
  porosityCalibration,
  rhomaaZoneRows,
  roundedParam,
  zonesWithOwnValue,
} from '../src/modules/core-calibration/model';
import { EXAMPLE_M, EXAMPLE_SHIFTS, exampleCoreSet } from '../src/modules/core/example';
import { MATCH_CURVE_SETTING } from '../src/modules/core/model';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { normalizeParam, PLOT_PARAMS } from '../src/plots/params';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { curve, well, zone } from './helpers';

// ── módulo del motor: pozo sintético de 12 muestras cada 0,5 m (1000–1005,5 m), dos zonas de 6 ─────────────────────
const N = 12;
const ZONES: Zone[] = [zone('za', 1000, 1002.5), zone('zb', 1003, 1005.5)];
const ZB = ZONES[1]!.id;

//                 0     1     2     3     4     5     6     7     8     9     10    11
const PHIT = [0.10, 0.15, 0.20, 0.25, 0.30, 0.05, 0.10, 0.15, 0.20, 0.25, NaN, 1.0];
// ρmaa de diseño: zona A arenisca con dos muestras arcillosas (3 y 5); zona B caliza 2,71. Muestra 10 sin φ, 11 con φ = 1.
const RHOMAA_DESIGN = [2.6, 2.64, 2.66, 2.9, 2.68, 2.95, 2.71, 2.71, 2.71, 2.71, NaN, NaN];
// ρb = ρmaa·(1 − φ) + φ·ρf con ρf = 1 (muestra 10: cualquier ρb; 11: ρb = 1, φ = 1 → sin dato por la guarda).
const RHOB = RHOMAA_DESIGN.map((m, i) => (i === 10 ? 2.4 : i === 11 ? 1 : m * (1 - PHIT[i]!) + PHIT[i]!));
const VSH = [0, 0.1, 0.2, 0.5, 0.1, 0.6, 0, 0, 0.1, 0.1, 0, 0];

const run = (curves: EngineCurve[], partial: Partial<Interpretation> = {}): EngineRunResult => {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(well(curves, N, 1000, 0.5));
  return engine.run({ ...emptyInterpretation(ZONES), ...partial });
};
const allCurves = () => [curve('RHOZ', 'RHOB', RHOB), curve('PHIT_DN', 'PHIT', PHIT), curve('VSH_X', 'VSH', VSH)];

function out<T = Float64Array>(r: EngineRunResult, port: string): T {
  const o = r.outputs.find((x) => x.key === `${CORE_CALIBRATION_ID}:${port}`);
  if (!o) throw new Error(`Falta la salida ${CORE_CALIBRATION_ID}:${port}`);
  return o.value as T;
}
const warnings = (r: EngineRunResult) => r.diagnostics.filter((d) => d.level === 'warning' && d.moduleId === CORE_CALIBRATION_ID).map((d) => d.message);
function same(actual: Float64Array, expected: number[], digits = 12) {
  expect(actual.length).toBe(expected.length);
  expected.forEach((e, i) => {
    if (Number.isNaN(e)) expect(actual[i], `muestra ${i}`).toBeNaN();
    else expect(actual[i], `muestra ${i}`).toBeCloseTo(e, digits);
  });
}

describe('módulo core-calibration: registro y esquema', () => {
  const m = registry.modules.find((x) => x.id === CORE_CALIBRATION_ID)!;

  it('registrado detrás de phie-shale-corrected, categoría Porosidad, único productor de RHOMAA', () => {
    const ids = registry.modules.map((x) => x.id);
    expect(ids.indexOf(CORE_CALIBRATION_ID)).toBe(ids.indexOf('phie-shale-corrected') + 1);
    expect(m.category).toBe('porosity');
    expect(registry.modules.filter((x) => Object.values(x.outputs).some((o) => o.kind === 'curve' && o.role === 'RHOMAA')).map((x) => x.id)).toEqual([CORE_CALIBRATION_ID]);
    expect(registry.roles.get('RHOMAA')).toMatchObject({ unit: 'g/cm3', origin: 'computed' });
  });

  it('entradas por rol (PHIT, no PHIE) y parámetros por zona con valores de libro', () => {
    expect(Object.values(m.inputs).map((i) => ('role' in i ? i.role : null))).toEqual(['RHOB', 'PHIT', 'PHID', 'VSH']);
    expect(m.params['rhoFl']).toMatchObject({ type: 'number', default: 1, scope: 'zone', unit: 'g/cm3' });
    expect(m.params['vshMax']).toMatchObject({ type: 'number', default: 0.3, scope: 'zone' });
    expect(m.docs.equations.length).toBeGreaterThanOrEqual(5);
    expect(m.docs.references.join(' ')).toContain('Asquith');
  });
});

describe('módulo core-calibration: valores (pozo sintético)', () => {
  const r = run(allCurves());

  it('ρmaa = (ρb − φ·ρf)/(1 − φ) por muestra; sin dato con φ sin dato o φ ≥ 1', () => {
    same(out(r, 'RHOMAA'), RHOMAA_DESIGN);
  });

  it('tabla por zona: mediana y P10–P90 (tipo 7) de las muestras con Vsh ≤ 0,3; fila del pozo completo al final', () => {
    const rows = out<TableValue>(r, RHOMAA_ZONES).rows;
    expect(rows.map((x) => x['zone'])).toEqual(['ZA', 'ZB', 'Pozo completo']);
    // Zona A limpias: 2,60 2,64 2,66 2,68 → mediana 2,65; P10 = 2,60 + 0,3·0,04; P90 = 2,66 + 0,7·0,02.
    expect(rows[0]).toMatchObject({ zoneId: 'za', n: 4 });
    expect(rows[0]!['median'] as number).toBeCloseTo(2.65, 12);
    expect(rows[0]!['p10'] as number).toBeCloseTo(2.612, 12);
    expect(rows[0]!['p90'] as number).toBeCloseTo(2.674, 12);
    expect(rows[1]).toMatchObject({ zoneId: 'zb', n: 4 });
    expect(rows[1]!['median'] as number).toBeCloseTo(2.71, 12);
    expect(rows[2]).toMatchObject({ zoneId: '', n: 8 });
    expect(out<Record<string, number>>(r, RHOMAA_ZONE)).toEqual({ za: expect.closeTo(2.65, 12), zb: expect.closeTo(2.71, 12) });
  });

  it('Vsh máxima por zona: con 1 en la zona A entran las arcillosas (mediana 2,67) y la B no cambia', () => {
    const r2 = run(allCurves(), { params: { global: {}, zones: { za: { 'core-calibration.vshMax': 1 } } } });
    const rows = out<TableValue>(r2, RHOMAA_ZONES).rows;
    expect(rows[0]).toMatchObject({ n: 6 });
    expect(rows[0]!['median'] as number).toBeCloseTo(2.67, 12);
    expect(rows[1]!['median'] as number).toBeCloseTo(2.71, 12);
  });

  it('densidad del fluido por zona: con 1,10 en la B, ρmaa = (ρb − 1,1·φ)/(1 − φ) solo ahí', () => {
    const r2 = run(allCurves(), { params: { global: {}, zones: { [ZB]: { 'core-calibration.rhoFl': 1.1 } } } });
    const v = out(r2, 'RHOMAA');
    for (const i of [0, 1, 2, 3, 4, 5]) expect(v[i]).toBeCloseTo(RHOMAA_DESIGN[i]!, 12);
    for (const i of [6, 7, 8, 9]) expect(v[i]).toBeCloseTo((RHOB[i]! - 1.1 * PHIT[i]!) / (1 - PHIT[i]!), 12);
    // 2,71 − 0,1·φ/(1 − φ): con φ = 0,2 → 2,685
    expect(v[8]).toBeCloseTo(2.685, 12);
  });

  it('sin avisos con todas las entradas', () => {
    expect(warnings(r)).toEqual([]);
  });

  it('sin VSH: avisa y el valor por zona usa todas las muestras', () => {
    const r2 = run(allCurves().filter((c) => c.role !== 'VSH'));
    expect(warnings(r2).some((w) => w.includes('volumen de arcilla'))).toBe(true);
    expect(out<TableValue>(r2, RHOMAA_ZONES).rows[0]).toMatchObject({ n: 6 });
  });

  it('circularidad: si PHIT es la porosidad por densidad en una zona, avisa en esa zona', () => {
    const phid = PHIT.map((p, i) => (i < 6 ? p + 0.02 : p));
    const r2 = run([...allCurves(), curve('PHID_X', 'PHID', phid)]);
    const w = warnings(r2).filter((m) => m.includes('sale solo de la densidad'));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('zona ZB');
  });
});

describe('módulo core-calibration: cadena con el motor (pozo de demostración)', () => {
  const demo = syntheticWell();
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(toEngineWell(demo.well));
  const base = emptyInterpretation(demo.zones);
  const r1 = engine.run(base);
  const rho = r1.outputs.find((o) => o.key === `${CORE_CALIBRATION_ID}:RHOMAA`)!.value as Float64Array;
  const phit = r1.outputs.find((o) => o.key === 'phit:PHIT')!.value as Float64Array;
  const rhob = demo.well.curves.find((c) => c.role === 'RHOB')!.data;

  it('corre detrás de phit con la PHIT calculada y repite la cuenta del motor puro', () => {
    expect(r1.nodes.find((x) => x.moduleId === CORE_CALIBRATION_ID)?.status).toBe('ok');
    let checked = 0;
    for (let i = 0; i < rho.length; i += 97) {
      const p = phit[i]!;
      if (!Number.isFinite(p) || p >= 1 || p < 0) continue;
      expect(rho[i]).toBeCloseTo((rhob[i]! - p) / (1 - p), 10);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('en las arenas limpias del demo (ρb 2,32, densidad–neutrón ≈ 0,2) la mediana de ρmaa ronda el cuarzo', () => {
    const zc = demo.zones.find((z) => z.name === 'C')!;
    const v = out<Record<string, number>>(r1, RHOMAA_ZONE)[zc.id]!;
    expect(v).toBeGreaterThan(2.55);
    expect(v).toBeLessThan(2.75);
  });

  it('mover la ρf del módulo recalcula solo este módulo (incremental)', () => {
    const r2 = engine.run({ ...base, params: { global: { 'core-calibration.rhoFl': 1.05 }, zones: {} } });
    expect(r2.stats.recomputed).toEqual([CORE_CALIBRATION_ID]);
  });
});

describe('módulo core-calibration: pozo del TP', () => {
  it('corre sobre los perfiles reales con valores por zona en un rango físico', () => {
    const { well: w, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
    const engine = new Engine(registry);
    engine.setWell(toEngineWell(w));
    const r = engine.run(emptyInterpretation(zones));
    const per = r.outputs.find((o) => o.key === `${CORE_CALIBRATION_ID}:${RHOMAA_ZONE}`)!.value as Record<string, number>;
    const finite = Object.values(per).filter(Number.isFinite);
    expect(finite.length).toBeGreaterThanOrEqual(3);
    for (const v of finite) {
      expect(v).toBeGreaterThan(2.3);
      expect(v).toBeLessThan(3.1);
    }
  });
});

// ── modelo del panel ─────────────────────────────────────────────────────────────────────────────────────────

const W = 'w';
/** Perfil: 1000–1040 m cada 0,1 m. φ del perfil = rampa suave; ρb con matriz 2,68 y ρf 1. */
const LOG_DEPTH = Float64Array.from({ length: 401 }, (_, i) => 1000 + i * 0.1);
const LOG_PHI = Float64Array.from(LOG_DEPTH, (z) => 0.08 + 0.004 * (z - 1000) + 0.03 * Math.sin(z));
const RHOMA_TRUE = 2.68;
const LOG_RHOB = Float64Array.from(LOG_PHI, (p) => RHOMA_TRUE - p * (RHOMA_TRUE - 1));

/** Plugs: profundidad del archivo 2 m ARRIBA de la verdadera (puesta en profundidad +2); φ de corona = φ del perfil. */
function plugSet(opts: { ff?: boolean } = {}): PointSet {
  const trueZ = [1005, 1008, 1011, 1014, 1017, 1020, 1023, 1026];
  const phi = trueZ.map((z) => LOG_PHI[Math.round((z - 1000) / 0.1)]!);
  return createPointSet({
    id: 'c1',
    kind: 'core',
    name: 'Corona',
    depth: Float64Array.from(trueZ, (z) => z - 2),
    pointIds: trueZ.map((_, i) => `p${i + 1}`),
    columns: {
      phi: { label: 'φ', unit: 'v/v', values: Float64Array.from(phi) },
      k: { label: 'k', unit: 'mD', values: Float64Array.from(phi, (p) => 10 ** (-1.7 + 22 * p)) },
      rhog: { label: 'ρg', unit: 'g/cm3', values: Float64Array.of(2.64, 2.65, 2.66, 2.65, 2.67, 2.63, 2.65, 2.66) },
      ...(opts.ff ? { ff: { label: 'F', unit: 'unitless', values: Float64Array.from(phi, (p) => 0.8 / p ** 2.05) } } : {}),
      run: { label: 'Corona', values: ['1', '1', '1', '1', '1', '1', '1', '1'] },
      description: { label: 'Descripción', values: ['', '', '', '', '', '', '', ''] },
    },
  });
}

function project(set: PointSet, shift?: number) {
  let p = addWell(createProject(), createWell({ id: W, name: 'P', depth: LOG_DEPTH, curves: [] }), [zone('z1', 1000, 1019.95), zone('z2', 1020, 1040)]);
  p = { ...p, wells: p.wells.map((e) => ({ ...e, well: { ...e.well, pointSets: [set] } })) };
  if (shift !== undefined) p = setPointSetDepthShift(p, W, set.id, shift);
  return p;
}
const decOf = (p: ReturnType<typeof project>) => getWellEntry(p, W).interpretation.pointSets['c1'];

describe('panel: ajustes y plugs en profundidad corregida', () => {
  it('curva por defecto = la de la puesta en profundidad; ventana por defecto 0,15 m', () => {
    let p = project(plugSet());
    expect(calibCurveKey(decOf(p))).toBe('PHIE');
    expect(calibWindow(decOf(p))).toBe(DEFAULT_WINDOW);
    p = setPointSetSetting(p, W, 'c1', MATCH_CURVE_SETTING, 'PHIT');
    expect(calibCurveKey(decOf(p))).toBe('PHIT');
    p = setPointSetSetting(p, W, 'c1', CALIB_CURVE_SETTING, 'm:NPHI');
    p = setPointSetSetting(p, W, 'c1', CALIB_WINDOW_SETTING, 0.3);
    expect(calibCurveKey(decOf(p))).toBe('m:NPHI');
    expect(calibWindow(decOf(p))).toBe(0.3);
  });

  it('usa shiftedDepth del núcleo (no recalcula): con +2 m los plugs caen en la profundidad verdadera', () => {
    const set = plugSet();
    expect(depthMatchState(set, decOf(project(set))).state).toBe('none');
    const p = project(set, 2);
    expect(depthMatchState(set, decOf(p))).toMatchObject({ state: 'applied', shifts: [{ shift: 2 }] });
    expect([...includedPlugs(set, decOf(p)).depth]).toEqual([1005, 1008, 1011, 1014, 1017, 1020, 1023, 1026].map((z) => expect.closeTo(z, 9)));
  });

  it('solo plugs incluidos: descartar uno lo saca de la calibración', () => {
    let p = project(plugSet(), 2);
    p = setPointDecision(p, W, 'c1', 'p3', { status: 'exclude' });
    const inc = includedPlugs(plugSet(), decOf(p));
    expect(inc.idx).toEqual([0, 1, 3, 4, 5, 6, 7]);
  });
});

describe('panel: φ perfil vs. φ corona', () => {
  it('en profundidad y sin ventana: sesgo 0, RMSE 0, R² 1, RMA = OLS = 1:1', () => {
    const set = plugSet();
    const c = porosityCalibration(set, decOf(project(set, 2)), LOG_DEPTH, LOG_PHI, 0)!;
    expect(c.stats.n).toBe(8);
    expect(c.stats.bias).toBeCloseTo(0, 12);
    expect(c.stats.rmse).toBeCloseTo(0, 12);
    expect(c.stats.r2).toBeCloseTo(1, 12);
    expect(c.stats.rma!.slope).toBeCloseTo(1, 10);
    expect(c.stats.ols!.intercept).toBeCloseTo(0, 10);
  });

  it('sin la puesta en profundidad la comparación empeora (la corona queda 2 m corrida)', () => {
    const set = plugSet();
    const c = porosityCalibration(set, decOf(project(set)), LOG_DEPTH, LOG_PHI, 0)!;
    expect(c.stats.rmse).toBeGreaterThan(0.01);
  });

  it('la ventana ±h promedia el perfil (con h > 0 cambia el valor del perfil en el plug)', () => {
    const set = plugSet();
    const dec = decOf(project(set, 2));
    const a = porosityCalibration(set, dec, LOG_DEPTH, LOG_PHI, 0)!;
    const b = porosityCalibration(set, dec, LOG_DEPTH, LOG_PHI, 0.5)!;
    expect(b.log[0]).not.toBeCloseTo(a.log[0]!, 6);
    // Promedio de las 11 muestras de 1004,5 a 1005,5 m.
    let s = 0;
    for (let i = 45; i <= 55; i++) s += LOG_PHI[i]!;
    expect(b.log[0]).toBeCloseTo(s / 11, 12);
  });

  it('sin columna de porosidad: null', () => {
    const base = plugSet();
    const { phi: _phi, ...cols } = base.columns;
    const set = createPointSet({ id: 'c1', kind: 'core', name: 'x', depth: base.depth, pointIds: [...base.pointIds], columns: cols });
    expect(porosityCalibration(set, undefined, LOG_DEPTH, LOG_PHI, 0)).toBeNull();
  });
});

describe('panel: densidad de matriz', () => {
  it('grano de los plugs (mediana) y ρma que iguala φD con φ corona (recupera la matriz de diseño 2,68)', () => {
    const set = plugSet();
    const e = matrixDensityEstimates(set, decOf(project(set, 2)), LOG_DEPTH, LOG_RHOB, 1, 0);
    expect(e.grain!.n).toBe(8);
    expect(e.grain!.median).toBeCloseTo(2.65, 12);
    expect(e.fit!.rhoMa).toBeCloseTo(RHOMA_TRUE, 10);
    expect(e.fit!.rmse).toBeCloseTo(0, 10);
    expect(e.fit!.clamped).toBe(false);
  });

  it('sin densidad del perfil: solo el grano', () => {
    const set = plugSet();
    const e = matrixDensityEstimates(set, decOf(project(set, 2)), LOG_DEPTH, null, 1, 0);
    expect(e.fit).toBeNull();
    expect(e.grain).not.toBeNull();
  });

  it('filas de la tabla del motor tipadas (null → NaN)', () => {
    const rows = rhomaaZoneRows([
      { zoneId: 'z1', zone: 'A', n: 3, median: 2.65, p10: 2.6, p90: 2.7, mean: 2.65, sd: 0.01 },
      { zoneId: '', zone: 'Pozo completo', n: 0, median: null, p10: null, p90: null, mean: null, sd: null },
    ]);
    expect(rows[0]).toEqual({ zoneId: 'z1', zone: 'A', n: 3, median: 2.65, p10: 2.6, p90: 2.7 });
    expect(rows[1]!.median).toBeNaN();
    expect(rhomaaZoneRows(undefined)).toEqual([]);
  });
});

describe('panel: exponente de cementación m', () => {
  it('desde F de los plugs: a fija = la de diseño recupera m; a libre recupera a y m', () => {
    const set = plugSet({ ff: true });
    const c = plugCementation(set, decOf(project(set, 2)), 0.8)!;
    expect(c.fixedA!.m).toBeCloseTo(2.05, 10);
    expect(c.freeA!.m).toBeCloseTo(2.05, 10);
    expect(c.freeA!.a).toBeCloseTo(0.8, 10);
    expect(plugCementation(plugSet(), undefined, 1)).toBeNull();
  });

  it('desde el perfil en zona acuífera: mediana de m = ln(a·Rw/Rt)/ln φ, solo en las zonas elegidas y limpias', () => {
    const depth = LOG_DEPTH;
    const zones = [zone('z1', 1000, 1019.95), zone('z2', 1020, 1040)];
    const rw = new Float64Array(depth.length).fill(0.05);
    // Zona 1 acuífera con m = 2,1 (a = 1); zona 2 con hidrocarburo (Rt ×10).
    const rt = Float64Array.from(depth, (z, i) => (z < 1020 ? 0.05 / LOG_PHI[i]! ** 2.1 : (10 * 0.05) / LOG_PHI[i]! ** 2.1));
    const vsh = Float64Array.from(depth, (_, i) => (i % 10 === 0 ? 0.6 : 0.1));
    const c = logCementation({ depth, zones, waterZones: ['z1'], phi: LOG_PHI, rt, rw, vsh, vshMax: 0.3, a: 1 })!;
    expect(c.perSample.median).toBeCloseTo(2.1, 10);
    expect(c.perSample.n).toBe(180); // 200 muestras de la zona 1 menos las 20 arcillosas
    expect(c.fit.fixedA!.m).toBeCloseTo(2.1, 10);
    expect(logCementation({ depth, zones, waterZones: [], phi: LOG_PHI, rt, rw, vsh, vshMax: 0.3, a: 1 })).toBeNull();
    // Con la zona con hidrocarburo, m aparente más alto (no es acuífera).
    const both = logCementation({ depth, zones, waterZones: ['z1', 'z2'], phi: LOG_PHI, rt, rw, vsh: null, vshMax: 0.3, a: 1 })!;
    expect(both.perSample.p90).toBeGreaterThan(2.5);
  });

  it('recta de Archie F = a/φ^m en dos puntos', () => {
    const l = archieLine(1, 2, 0.1, 0.4);
    expect([...l.y]).toEqual([expect.closeTo(100, 9), expect.closeTo(6.25, 9)]);
  });
});

describe('panel: recetas «Aplicar» y valores vigentes', () => {
  it('redondeo idéntico al de los parámetros elegidos sobre los gráficos (normalizeParam)', () => {
    for (const v of [2.6789, 2.6649, 1.8543, 3.9, 0.2, 2.005]) {
      expect(roundedParam(CALIB_PARAMS.rhoMa, v)).toBe(normalizeParam(PLOT_PARAMS.rhoMa.spec, v));
      expect(roundedParam(CALIB_PARAMS.m, v)).toBe(normalizeParam(PLOT_PARAMS.m.spec, v));
      expect(roundedParam(CALIB_PARAMS.a, v)).toBe(normalizeParam(PLOT_PARAMS.a.spec, v));
    }
    expect(CALIB_PARAMS.rhoMa.storage).toBe(PLOT_PARAMS.rhoMa.storage);
    expect(CALIB_PARAMS.m.storage).toBe('m');
  });

  it('ρma global o de una zona, redondeada; el valor vigente y «aplicada» lo reflejan', () => {
    const p0 = project(plugSet());
    const g = applyMatrixDensity(p0, W, 2.6789, null);
    const i = getWellEntry(g, W).interpretation;
    expect(i.params.global['phi-density.rhoMa']).toBe(2.68);
    expect(paramValue(i.params, CALIB_PARAMS.rhoMa, 'z1')).toBe(2.68);
    expect(isApplied(i.params, CALIB_PARAMS.rhoMa, null, 2.6801)).toBe(true);
    const z = applyMatrixDensity(g, W, 2.71, 'z2');
    const iz = getWellEntry(z, W).interpretation;
    expect(iz.params.zones['z2']!['phi-density.rhoMa']).toBe(2.71);
    expect(paramValue(iz.params, CALIB_PARAMS.rhoMa, 'z1')).toBe(2.68);
    expect(zonesWithOwnValue(iz, CALIB_PARAMS.rhoMa).map((x) => x.id)).toEqual(['z2']);
    expect(applyMatrixDensity(p0, W, NaN, null)).toBe(p0);
  });

  it('m (y a) de Archie compartidos, en una sola receta', () => {
    const p0 = project(plugSet());
    const p1 = applyCementation(p0, W, { m: 1.8543, a: 0.812 }, 'z1');
    const zv = getWellEntry(p1, W).interpretation.params.zones['z1']!;
    expect(zv).toEqual({ m: 1.85, a: 0.81 });
    const p2 = applyCementation(p0, W, { m: 2.2 }, null);
    expect(getWellEntry(p2, W).interpretation.params.global).toEqual({ m: 2.2 });
    expect(paramValue(getWellEntry(p0, W).interpretation.params, CALIB_PARAMS.m, null)).toBe(2);
  });

  it('el valor vigente respeta los valores de fábrica y los propios de la zona', () => {
    let p = project(plugSet());
    p = setParam(p, W, 'm', 1.9, 'z1');
    const params = getWellEntry(p, W).interpretation.params;
    expect(paramValue(params, CALIB_PARAMS.m, 'z1')).toBe(1.9);
    expect(paramValue(params, CALIB_PARAMS.m, 'z2')).toBe(2);
    expect(paramValue(params, CALIB_PARAMS.rhoFl, null)).toBe(1);
  });
});

describe('ejemplo sintético y lector: factor de formación', () => {
  const logDepth = Float64Array.from({ length: 1969 }, (_, i) => 7900 + i * 0.1524);
  const phie = Float64Array.from(logDepth, (z) => 0.12 + 0.06 * Math.sin(z / 2.9) + 0.035 * Math.sin(z / 1.15 + 1) + 0.02 * Math.sin(z / 7.1 + 2));
  const set = exampleCoreSet('ej', { depth: logDepth, phie })!;

  it('los plugs de ejemplo traen F con m de diseño 1,85 (a = 1) y el ajuste lo recupera', () => {
    expect(set.columns['ff']).toBeDefined();
    let p = addWell(createProject(), createWell({ id: W, name: 'P', depth: logDepth, curves: [] }));
    p = { ...p, wells: p.wells.map((e) => ({ ...e, well: { ...e.well, pointSets: [set] } })) };
    for (const [r, s] of Object.entries(EXAMPLE_SHIFTS)) p = setPointSetDepthShift(p, W, 'ej', s, r);
    const c = plugCementation(set, getWellEntry(p, W).interpretation.pointSets['ej'], 1)!;
    expect(c.fixedA!.m).toBeCloseTo(EXAMPLE_M, 1);
    expect(c.fixedA!.r2).toBeGreaterThan(0.95);
  });

  it('el lector reconoce la columna F (FF, Formation factor, Factor de formación) como adimensional', () => {
    for (const name of ['FF', 'Formation factor', 'Factor de formación', 'F']) {
      const t = parseTable(`DEPTH,PHI,${name}\n2500,0.2,20\n2501,0.1,90\n`, 'plugs.csv', { requireDepth: false });
      const map = suggestCoreMapping(t);
      expect(map.find((m) => m.name === name)?.field, name).toBe('ff');
      const { set: s } = buildCoreSet(t, map, { id: 'c' });
      expect([...(s.columns['ff']!.values as Float64Array)]).toEqual([20, 90]);
    }
  });
});
