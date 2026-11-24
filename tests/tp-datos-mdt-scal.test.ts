/**
 * Presiones MDT y datos SCAL reales del TP embebidos (docs/decisiones/0057): conjunto MDT (`tpMdtSet`) con sus
 * gradientes calculados con la regresión de la app, comparados con numpy (fuera del código TS: `numpy.polyfit` sobre
 * profundidad en pies = m / 0,3048 y presión en psi, ver la decisión), y el panel SCAL (unión de tablas, ajuste de la
 * presión de desplazamiento, nivel de `swi-pc`, registro en el dock). Guardar/abrir (v7) y snapshots.
 */
import { describe, expect, it } from 'vitest';
import { pointNumbers, pointTexts } from '../src/core/pointSets';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { enableProjectInputRevisions } from '../src/core/state/inputRevisions';
import { addPointSet, setPointDecision } from '../src/core/state/pointSets';
import { addWell, createProject, getWellEntry, setOverlaySetting, setParam, type Project } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { addTrend } from '../src/core/state/trends';
import type { TrendSpec } from '../src/core/trends';
import { createWell } from '../src/core/well';
import { collectDockPanels } from '../src/app/shell/dockPanels';
import { examplePressureSet } from '../src/modules/mdt/example';
import { assessQuality, MDT_PROVIDER_ID, mdtSeriesKey, pointStatuses, pressureSets } from '../src/modules/mdt/model';
import { mdtAnalysis } from '../src/modules/mdt/series';
import { isTpMdtSet, TP_MDT_SOURCE, TP_MDT_ZONE_COLUMN, tpMdtSet } from '../src/modules/mdt/tp';
import { TP_MDT_POINTS } from '../src/modules/mdt/tpData';
import { SWI_ZONES } from '../src/modules/swi-pc';
import { DEFAULT_LEVEL, globalLevel, joinScalTables, LEVEL_STORAGE, levelWrite, micpLevelRows, outOfRangeSummary, scalDisplacementFit, swiLevelCurve, zonesWithOwnLevel } from '../src/modules/swi-pc/scal';
import { TP_SCAL_DISPLACEMENT, TP_SCAL_THROAT } from '../src/modules/swi-pc/tpScal';
import { SWI_CATEDRA_LEVELS, SWI_SCAL_ROOT_RANGE, swiPowerLaw } from '../src/petro/swiPc';
import { zone } from './helpers';

const W = 'w';
const TOL = 5e-4;

/** Pozo con la profundidad y las zonas A–E del TP (datos/README.md). */
function project(): Project {
  const depth = Float64Array.from({ length: 5810 }, (_, i) => 7633.26 + i * 0.1524);
  const w = createWell({ id: W, name: 'Pozo TP', depth, curves: [], pointSets: [] });
  return addWell(createProject(), w, [zone('A', 7633.26, 7724.39), zone('B', 7724.55, 7906.05), zone('C', 7906.21, 7969.91), zone('D', 7970.06, 8246.97), zone('E', 8247.13, 8518.55)]);
}

/** Gradiente lineal sobre todos los puntos incluidos del conjunto, opcionalmente limitado a una zona. */
const gradient = (id: string, setId: string, zoneId?: string): TrendSpec => ({
  id,
  name: `Gradiente ${zoneId ?? 'todos'}`,
  visible: true,
  series: { provider: MDT_PROVIDER_ID, key: mdtSeriesKey(setId) },
  model: 'linear',
  mode: 'fit',
  selection: { ...(zoneId ? { zoneId } : {}), excluded: [] },
  extend: true,
});

function loaded(): Project {
  let p = addPointSet(project(), W, tpMdtSet('mdt'));
  for (const [id, z] of [['g-all', undefined], ['g-b', 'B'], ['g-c', 'C'], ['g-d', 'D']] as const) p = addTrend(p, W, gradient(id, 'mdt', z));
  return p;
}

function psiFt(p: Project, trendId: string) {
  const e = getWellEntry(p, W);
  const g = mdtAnalysis(e.well, e.interpretation).gradients.find((x) => x.spec.id === trendId)!;
  return { value: g.result!.gradients.find((x) => x.unit === 'psi/ft')!.value, r2: g.result!.r2!, n: g.result!.n };
}

describe('presiones MDT del TP (tpMdtSet)', () => {
  const set = tpMdtSet('m');

  it('58 pruebas: 25 en la zona B, 2 en la C y 31 en la D; ids únicos; dato real (sin «sintético») con su origen', () => {
    expect(set.kind).toBe('pressure');
    expect(set.pointIds).toHaveLength(58);
    expect(new Set(set.pointIds).size).toBe(58);
    const zones = pointTexts(set, TP_MDT_ZONE_COLUMN)!;
    expect(['B', 'C', 'D'].map((z) => zones.filter((x) => x === z).length)).toEqual([25, 2, 31]);
    expect(set.synthetic).toBeUndefined();
    expect(set.source).toBe(TP_MDT_SOURCE);
    expect(isTpMdtSet(set)).toBe(true);
    expect(isTpMdtSet(examplePressureSet('x'))).toBe(false);
  });

  it('profundidad en metros tal cual la hoja, dentro del pozo del TP (7633–8518 m) y en la zona que dice la hoja', () => {
    set.pointIds.forEach((_, i) => expect(set.depth[i]).toBe(TP_MDT_POINTS[i]!.depthM));
    expect(Math.min(...set.depth)).toBeGreaterThan(7633);
    expect(Math.max(...set.depth)).toBeLessThan(8518);
    const p = project();
    const zs = getWellEntry(p, W).interpretation.zones;
    const zones = pointTexts(set, TP_MDT_ZONE_COLUMN)!;
    set.depth.forEach((d, i) => {
      const z = zs.find((q) => d >= q.top && d <= q.base);
      expect(z?.id, `${set.pointIds[i]} a ${d} m`).toBe(zones[i]);
    });
    expect([...pointNumbers(set, 'pressure')!]).toEqual(TP_MDT_POINTS.map((q) => q.pressurePsi));
  });

  it('rango de drawdown y prueba de control de B', () => {
    const drawdown = pointNumbers(set, 'drawdown')!;
    const control = set.depth.findIndex((md) => md === 7748.0831);
    expect([Math.min(...drawdown), Math.max(...drawdown)]).toEqual([0.18, 66.59]);
    expect(control).toBeGreaterThanOrEqual(0);
    expect(pointNumbers(set, 'pressure')?.[control]).toBe(19149.09);
    expect(drawdown[control]).toBe(66.59);
    expect(pointTexts(set, TP_MDT_ZONE_COLUMN)?.[control]).toBe('B');
  });

  it('sin movilidad ni calidad en la hoja: las reglas no proponen descartar ninguna prueba', () => {
    expect(assessQuality(set).filter((q) => q.proposeExclude)).toHaveLength(0);
    expect(pointStatuses(set, undefined).every((s) => s.included)).toBe(true);
  });

  it('la carga es un paso: sin gradientes ni decisiones, y deshacer la quita', () => {
    const p0 = project();
    const p1 = addPointSet(p0, W, tpMdtSet('mdt'));
    const e = getWellEntry(p1, W);
    expect(pressureSets(e.well.pointSets)).toHaveLength(1);
    expect(e.interpretation.trends).toEqual([]);
    expect(e.interpretation.pointSets['mdt']).toBeUndefined();
    const back = undo(recordChange(emptyHistory(), p0, 'Cargar presiones del TP', 0), p1)!;
    expect(getWellEntry(back.project, W).well.pointSets).toEqual([]);
  });
});

describe('gradientes de las presiones del TP con la regresión de la app (contra numpy)', () => {
  const p = loaded();

  it('todos los puntos: 0,5362 psi/ft (n 58)', () => {
    const g = psiFt(p, 'g-all');
    expect(g.n).toBe(58);
    expect(Math.abs(g.value - 0.5362)).toBeLessThan(TOL);
  });

  it('zona B: 0,4121 psi/ft con R² 0,9977 (n 25)', () => {
    const g = psiFt(p, 'g-b');
    expect(g.n).toBe(25);
    expect(Math.abs(g.value - 0.4121)).toBeLessThan(TOL);
    expect(Math.abs(g.r2 - 0.9977)).toBeLessThan(TOL);
  });

  it('zona D: 0,7313 psi/ft (n 31); la zona C tiene solo 2 puntos', () => {
    const d = psiFt(p, 'g-d');
    expect(d.n).toBe(31);
    expect(Math.abs(d.value - 0.7313)).toBeLessThan(TOL);
    expect(psiFt(p, 'g-c').n).toBe(2);
  });
});

describe('datos SCAL del TP', () => {
  const join = joinScalTables();

  it('las dos tablas tienen las mismas 8 muestras; «RAIZ» de desplazamiento = 10 × √(k/φ%) de la de gargantas', () => {
    expect(TP_SCAL_DISPLACEMENT).toHaveLength(8);
    expect(TP_SCAL_THROAT).toHaveLength(8);
    expect([...TP_SCAL_DISPLACEMENT.map((d) => d.sample)].sort()).toEqual([...TP_SCAL_THROAT.map((t) => t.sample)].sort());
    expect(join.samples).toHaveLength(8);
    expect(join.unmatched).toEqual([]);
    expect(join.maxRootMismatch).toBeLessThan(1e-4);
    // √(k/φ%) se reproduce con k de gas y φ en %
    for (const s of join.samples) expect(Math.sqrt(s.kGasMd / s.phiPct)).toBeCloseTo(s.rootKPhi, 4);
    // el rango declarado del módulo es el de estas muestras
    const r = join.samples.map((s) => s.rootKPhi);
    expect(Math.min(...r) - SWI_SCAL_ROOT_RANGE.min).toBeLessThan(0.001);
    expect(SWI_SCAL_ROOT_RANGE.max - Math.max(...r)).toBeLessThan(0.001);
  });

  it('una muestra sin pareja se informa y no entra', () => {
    const j = joinScalTables([...TP_SCAL_THROAT, { sample: 'X-1', kGasMd: 1, phiPct: 10, rootKPhi: 0.316 }], TP_SCAL_DISPLACEMENT);
    expect(j.samples).toHaveLength(8);
    expect(j.unmatched).toEqual(['X-1']);
  });

  it('ajuste Pd–√(k/φ%): mismo d y R² que el test de fitDisplacementPressure (numpy); c = 27,9646 · 10^−d', () => {
    const f = scalDisplacementFit(join.samples)!;
    expect(f.n).toBe(8);
    // tests/petro-swi-pc.test.ts (x = «RAIZ», 10 veces más grande): c 27,96458906, d 1,18915250, R² 0,43103434
    expect(f.d).toBeCloseTo(1.189152502919038, 4);
    expect(f.r2).toBeCloseTo(0.43103434445451716, 4);
    expect(f.c).toBeCloseTo(27.96458906410524 * 10 ** -1.189152502919038, 3);
  });

  it('curvas de nivel: la ley de potencia de la cátedra; nivel 1 > … > 6 en todo el rango', () => {
    const curves = SWI_CATEDRA_LEVELS.map((l) => swiLevelCurve(l, 0.1, 10, 16));
    curves.forEach((c, k) => {
      expect(c.x[0]).toBeCloseTo(0.1, 12);
      expect(c.x[15]).toBeCloseTo(10, 12);
      c.x.forEach((x, i) => expect(c.y[i]).toBe(swiPowerLaw(x, SWI_CATEDRA_LEVELS[k]!.A, SWI_CATEDRA_LEVELS[k]!.B)));
    });
    for (let i = 0; i < 16; i++) for (let k = 1; k < 6; k++) expect(curves[k - 1]!.y[i]!).toBeGreaterThan(curves[k]!.y[i]!);
  });

  it('resumen fuera de rango: promedio ponderado por muestras de SWI_ZONES; zonas manuales aparte', () => {
    expect(outOfRangeSummary(null)).toBeNull();
    const rows = [
      { zone: 'A', nSwi: 100, pctOutRange: 10 },
      { zone: 'B', nSwi: 300, pctOutRange: 50 },
      { zone: 'C', nSwi: 50, pctOutRange: null },
      { zone: 'D', nSwi: 0, pctOutRange: null },
    ];
    const s = outOfRangeSummary({ rows })!;
    expect(s.n).toBe(400);
    expect(s.pct).toBeCloseTo(40, 12);
    expect(s.manualZones).toEqual(['C']);
    expect(outOfRangeSummary({ rows: [{ zone: 'C', nSwi: 50, pctOutRange: null }] })).toBeNull();
    expect(SWI_ZONES).toBe('SWI_ZONES');
  });

  it('«Usar nivel N»: escribe el nivel global de swi-pc; deshacer lo revierte; avisa las zonas con nivel propio', () => {
    const p0 = project();
    expect(globalLevel(getWellEntry(p0, W).interpretation)).toBe(DEFAULT_LEVEL);
    expect(LEVEL_STORAGE).toBe('swi-pc.level');
    const p1 = levelWrite(p0, W, 'level3');
    expect(getWellEntry(p1, W).interpretation.params.global).toEqual({ 'swi-pc.level': 'level3' });
    expect(globalLevel(getWellEntry(p1, W).interpretation)).toBe('level3');
    const back = undo(recordChange(emptyHistory(), p0, 'Usar el nivel 3 de presión capilar', 0), p1)!;
    expect(getWellEntry(back.project, W).interpretation.params.global).toEqual({});
    const pz = setParam(p1, W, LEVEL_STORAGE, 'level1', 'D');
    expect(zonesWithOwnLevel(getWellEntry(pz, W).interpretation)).toEqual(['D']);
  });

  it('el dock descubre la pestaña «SCAL» sin tocar la app', async () => {
    const mod = await import('../src/modules/swi-pc/dock');
    const panels = collectDockPanels({ 'swi-pc/dock.tsx': mod }, []);
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({ id: 'scal', title: 'SCAL' });
  });
});

describe('niveles de Swi de la cátedra desde las curvas MICP (panel SCAL)', () => {
  const rows = micpLevelRows();

  it('una fila por nivel, del 1 al 6, con la presión del preset y presión creciente', () => {
    expect(rows.map((r) => r.number)).toEqual(['1', '2', '3', '4', '5', '6']);
    rows.forEach((r, i) => {
      expect(r.pcKgCm2).toBeCloseTo(SWI_CATEDRA_LEVELS[i]!.pcKgCm2!, 2);
      expect(r.A).toBe(SWI_CATEDRA_LEVELS[i]!.A);
      expect(r.B).toBe(SWI_CATEDRA_LEVELS[i]!.B);
      if (i > 0) expect(r.pcKgCm2).toBeGreaterThan(rows[i - 1]!.pcKgCm2);
    });
  });

  it('A y B reconstruidos cerca de los de la cátedra, RMS de Swi < 0,004 (numpy) y ajuste con 3 o más muestras', () => {
    const rms = [0.00307, 0.00184, 0.00061, 0.00097, 0.00125, 0.00128];
    rows.forEach((r, i) => {
      expect(Math.abs(r.fitA / r.A - 1)).toBeLessThan(0.05);
      expect(Math.abs(r.fitB - r.B)).toBeLessThan(0.015);
      expect(r.rmsSwi).toBeCloseTo(rms[i]!, 4);
      expect(r.n).toBeGreaterThanOrEqual(3);
      expect(r.r2).toBeGreaterThan(0.5);
      expect(r.r2).toBeLessThanOrEqual(1);
    });
    expect(rows[5]!.n).toBe(7); // a 700 kg/cm² la 2-15 ya no tiene dato
  });
});

describe('persistencia de las presiones del TP', () => {
  it('guardar y abrir (v7): conjunto, zona, gradientes y descartes se conservan exactos', async () => {
    let p = loaded();
    p = setPointDecision(p, W, 'mdt', 'MDT-03', { status: 'exclude' });
    p = setOverlaySetting(p, 'mdt', 'pointColor', 'drawdown');
    p = setOverlaySetting(p, 'mdt', 'unit', 'bar');
    p = enableProjectInputRevisions(p);
    const text = await serializeProject(p);
    expect(JSON.parse(text).version).toBe(7);
    const back = await deserializeProject(text);
    expect(back.display.overlays?.mdt).toEqual({ pointColor: 'drawdown', unit: 'bar' });
    const e0 = getWellEntry(p, W);
    const e1 = getWellEntry(back, W);
    const s0 = pressureSets(e0.well.pointSets)[0]!;
    const s1 = pressureSets(e1.well.pointSets)[0]!;
    expect(isTpMdtSet(s1)).toBe(true);
    expect(s1.synthetic).toBeUndefined();
    expect(s1.pointIds).toEqual(s0.pointIds);
    expect([...s1.depth]).toEqual([...s0.depth]);
    expect([...pointNumbers(s1, 'pressure')!]).toEqual([...pointNumbers(s0, 'pressure')!]);
    expect([...pointNumbers(s1, 'drawdown')!]).toEqual([...pointNumbers(s0, 'drawdown')!]);
    expect(pointTexts(s1, TP_MDT_ZONE_COLUMN)).toEqual(pointTexts(s0, TP_MDT_ZONE_COLUMN));
    expect(e1.interpretation.pointSets).toEqual(e0.interpretation.pointSets);
    expect(e1.interpretation.trends).toEqual(e0.interpretation.trends);
    expect(psiFt(back, 'g-b').n).toBe(24);
    expect(psiFt(back, 'g-b').value).toBeCloseTo(psiFt(p, 'g-b').value, 12);
  });

  it('snapshot: guarda y restaura gradientes y descartes; los datos no se copian', () => {
    const p0 = loaded();
    const { project: p1, snapshot } = createSnapshot(p0, W, 's');
    const p2 = setPointDecision(p1, W, 'mdt', 'MDT-01', { status: 'exclude' });
    expect(psiFt(p2, 'g-all').n).toBe(57);
    const p3 = restoreSnapshot(p2, snapshot.id);
    expect(getWellEntry(p3, W).interpretation.pointSets['mdt']?.points ?? {}).toEqual({});
    expect(psiFt(p3, 'g-all').n).toBe(58);
    expect(getWellEntry(p3, W).well).toBe(getWellEntry(p2, W).well);
  });
});
