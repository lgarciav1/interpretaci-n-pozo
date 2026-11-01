/**
 * Datos reales de corona del TP embebidos (docs/decisiones/0056): plugs de las dos coronas (`tpCoreSet`) y ensayo de
 * índice de resistividad (`tpRiSet`), con los valores de cálculo contra el fixture de la cátedra calculado fuera del
 * código TS (tests/fixtures/tp-corona-electrica-scal.json), y que viajen en guardar/abrir (v7) y snapshots.
 */
import { describe, expect, it } from 'vitest';
import { listRuns, pointNumbers, pointTexts, shiftedDepth } from '../src/core/pointSets';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { enableProjectInputRevisions } from '../src/core/state/inputRevisions';
import { addWell, createProject, getWellEntry, type Project } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { createWell } from '../src/core/well';
import { CORE_RI_SET_KIND } from '../src/io';
import { applyArchie, depthMatchState, dominantPlugZone, plugCementation } from '../src/modules/core-calibration/model';
import { riSaturation, riSets, setRiPlugIncluded } from '../src/modules/core-calibration/saturation';
import { addTpRi, isTpRiSet, TP_RI_COMPOSITE_PLUG, TP_RI_DEFAULT_EXCLUDED, tpRiSet } from '../src/modules/core-calibration/tpRi';
import { exampleCoreSet } from '../src/modules/core/example';
import { assessCoreQuality, COL, CORE_KIND, coreGroups, coreSets, DEPTH_ON_LOG_SETTING, plugStatuses } from '../src/modules/core/model';
import { kphiTrends } from '../src/modules/core/series';
import { addTpCore, isTpCoreSet, TP_CORE_SOURCE, tpCoreSet } from '../src/modules/core/tp';
import { TP_CORE_PLUGS, TP_RI_COMPOSITE } from '../src/modules/core/tpData';
import scal from './fixtures/tp-corona-electrica-scal.json';
import { zone } from './helpers';

const W = 'w';
const e = scal.expected;
const LAB_CODES = scal.formationFactor.map((f) => f.id);

/** Pozo con la profundidad y las zonas A–E del TP (datos/README.md). */
function project(): Project {
  const depth = Float64Array.from({ length: 5810 }, (_, i) => 7633.26 + i * 0.1524);
  const w = createWell({ id: W, name: 'Pozo TP', depth, curves: [], pointSets: [] });
  return addWell(createProject(), w, [zone('A', 7633.26, 7724.39), zone('B', 7724.55, 7906.05), zone('C', 7906.21, 7969.91), zone('D', 7970.06, 8246.97), zone('E', 8247.13, 8518.55)]);
}
const loaded = () => addTpRi(addTpCore(project(), W, tpCoreSet('corona'), 'tend'), W, tpRiSet('ri'));

describe('plugs del TP (tpCoreSet)', () => {
  const set = tpCoreSet('c');

  it('151 plugs, 90 en la corona 1 y 61 en la corona 2; ids únicos; dato real (sin «sintético») con su origen', () => {
    expect(set.kind).toBe(CORE_KIND);
    expect(set.pointIds).toHaveLength(151);
    expect(new Set(set.pointIds).size).toBe(151);
    expect(listRuns(set)).toEqual(['1', '2']);
    expect(coreGroups(set).map((g) => g.indices.length)).toEqual([90, 61]);
    expect(set.synthetic).toBeUndefined();
    expect(set.source).toBe(TP_CORE_SOURCE);
    expect(set.name).toMatch(/TP/);
    expect(isTpCoreSet(set)).toBe(true);
    expect(isTpCoreSet(exampleCoreSet('x', { depth: Float64Array.of(7900, 8200), phie: Float64Array.of(0.15, 0.15) })!)).toBe(false);
  });

  it('12 plugs con F, con los 12 códigos del laboratorio como id; el resto F = NaN', () => {
    const ff = pointNumbers(set, COL.ff)!;
    const withF = set.pointIds.filter((_, i) => Number.isFinite(ff[i]!));
    expect(withF).toHaveLength(12);
    expect([...withF].sort()).toEqual([...LAB_CODES].sort());
    for (const f of scal.formationFactor) expect(ff[set.pointIds.indexOf(f.id)]!).toBeCloseTo(f.F, 3);
    expect(set.pointIds.filter((id) => /^C[12]-\d\d$/.test(id))).toHaveLength(139);
  });

  it('rangos físicos: φ 0,12–0,25 v/v, k en mD (0,04–330), ρg 2,64–2,76 g/cm³; profundidad = «Sample Depth, m» del Excel', () => {
    const phi = [...pointNumbers(set, COL.phi)!];
    const k = [...pointNumbers(set, COL.k)!];
    const g = [...pointNumbers(set, COL.rhog)!];
    expect(Math.min(...phi)).toBeGreaterThan(0.12);
    expect(Math.max(...phi)).toBeLessThan(0.25);
    expect(Math.min(...k)).toBeCloseTo(0.04, 6);
    expect(Math.max(...k)).toBe(330);
    expect(Math.min(...g)).toBeGreaterThan(2.64);
    expect(Math.max(...g)).toBeLessThan(2.76);
    const byId = new Map(TP_CORE_PLUGS.map((q) => [q.id, q]));
    set.pointIds.forEach((id, i) => expect(set.depth[i]).toBe(byId.get(id)!.depthM));
    // Corona 1 en la zona B y corona 2 en la zona D del pozo; corridas entre 4,2 y 4,9 m de la original del laboratorio.
    for (const q of TP_CORE_PLUGS) {
      const d = q.depthFt * 0.3048 - q.depthM;
      expect(d).toBeGreaterThan(4.1);
      expect(d).toBeLessThan(5.0);
    }
  });

  it('columnas de texto: corona y descripción con la profundidad original del laboratorio', () => {
    const desc = pointTexts(set, COL.description)!;
    expect(desc[set.pointIds.indexOf('1-6R2')]).toBe('Plug de laboratorio con ensayo eléctrico, profundidad original 25.664,55 ft');
    expect(desc[set.pointIds.indexOf('C1-01')]).toBe('Plug de laboratorio, profundidad original 25.647,90 ft');
  });

  it('las reglas de calidad no proponen descartar ninguno de los 151 plugs reales', () => {
    expect(assessCoreQuality(set).filter((q) => q.proposeExclude)).toHaveLength(0);
    expect(plugStatuses(set, undefined).every((s) => s.included)).toBe(true);
  });
});

describe('carga en el proyecto (addTpCore)', () => {
  it('una receta: conjunto + modelo k–φ, desplazamiento 0 en las dos coronas y marcado «ya en profundidad del perfil»', () => {
    const p0 = project();
    const p1 = addTpCore(p0, W, tpCoreSet('corona'), 'tend');
    const entry = getWellEntry(p1, W);
    const set = coreSets(entry.well.pointSets)[0]!;
    const dec = entry.interpretation.pointSets['corona'];
    expect(dec?.settings?.[DEPTH_ON_LOG_SETTING]).toBe(true);
    expect(dec?.runShifts).toBeUndefined();
    expect([...shiftedDepth(set, dec)]).toEqual([...set.depth]);
    expect(depthMatchState(set, dec).state).toBe('applied');
    expect(depthMatchState(set, undefined).state).toBe('none');
    expect(kphiTrends(set, entry.interpretation)).toHaveLength(1);
    expect(dominantPlugZone(set, dec, entry.interpretation.zones)).toBe('B');
    const back = undo(recordChange(emptyHistory(), p0, 'Cargar corona del TP', 0), p1)!;
    expect(getWellEntry(back.project, W).well.pointSets).toEqual([]);
  });
});

describe('ensayo RI del TP (tpRiSet)', () => {
  const set = tpRiSet('r');

  it('586 pares compuestos + 12 puntos finales; dato real con su origen', () => {
    expect(set.kind).toBe(CORE_RI_SET_KIND);
    expect(set.synthetic).toBeUndefined();
    expect(isTpRiSet(set)).toBe(true);
    const plug = pointTexts(set, 'plug')!;
    expect(plug.filter((p) => p === TP_RI_COMPOSITE_PLUG)).toHaveLength(586);
    expect(TP_RI_COMPOSITE).toHaveLength(scal.riSwPooled.length);
    expect(set.pointIds).toHaveLength(598);
    expect([...TP_RI_DEFAULT_EXCLUDED].sort()).toEqual([...LAB_CODES].sort());
    // Los 12 llevan la profundidad de su plug; el compuesto no tiene profundidad (md NaN).
    const md = pointNumbers(set, 'md')!;
    expect(set.pointIds.filter((_, i) => Number.isFinite(md[i]!))).toHaveLength(12);
  });

  it('por defecto: solo el compuesto incluido → n por el origen = 2,210858 (valor compuesto de la cátedra)', () => {
    const p = addTpRi(project(), W, set);
    const dec = getWellEntry(p, W).interpretation.pointSets['r'];
    const s = riSaturation(set, dec)!;
    expect(s.plugs.filter((r) => r.included).map((r) => r.plug)).toEqual([TP_RI_COMPOSITE_PLUG]);
    expect(s.plugs.filter((r) => !r.included)).toHaveLength(12);
    expect(s.pooled.origin!.n).toBeCloseTo(e.n_pooled_origin, 4);
    expect(Object.keys(dec!.points)).toHaveLength(12);
  });

  it('incluir un plug individual cambia el ajuste; sin decisiones (los 598 puntos) el n es otro', () => {
    let p = addTpRi(project(), W, set);
    p = setRiPlugIncluded(p, W, set, '1-6R2', true);
    const s = riSaturation(set, getWellEntry(p, W).interpretation.pointSets['r'])!;
    expect(s.plugs.filter((r) => r.included)).toHaveLength(2);
    expect(s.pooled.origin!.count).toBe(riSaturation(set, getWellEntry(addTpRi(project(), W, set), W).interpretation.pointSets['r'])!.pooled.origin!.count + 1);
    // Cada plug individual tiene un paso: su n puntual; la media de los 12 es la de la cátedra.
    const all = riSaturation(set, undefined)!;
    const twelve = all.plugs.filter((r) => r.plug !== TP_RI_COMPOSITE_PLUG);
    const mean = twelve.reduce((a, r) => a + r.fit.origin!.n, 0) / twelve.length;
    expect(mean).toBeCloseTo(e.n_meanPerSample, 3);
  });
});

describe('Archie desde corona con los datos del TP', () => {
  it('a y m de los 12 plugs con F (todo el pozo): m(a = 1) ≈ 1,897; a libre ≈ 0,594 y m libre ≈ 2,22', () => {
    const set = tpCoreSet('c');
    const c = plugCementation(set, undefined, 1, null)!;
    expect(c.n).toBe(12);
    expect(Math.abs(c.fixedA!.m - e.mFixedA1)).toBeLessThan(0.02);
    expect(Math.abs(c.freeA!.a - e.aFreeA)).toBeLessThan(0.05);
    expect(Math.abs(c.freeA!.m - e.mFreeA)).toBeLessThan(0.05);
  });

  it('con el alcance por defecto (zona B, la de la corona 1) entran 8 de los 12 plugs con F (y 4 en la zona D)', () => {
    const p = loaded();
    const i = getWellEntry(p, W).interpretation;
    const set = coreSets(getWellEntry(p, W).well.pointSets)[0]!;
    expect(plugCementation(set, i.pointSets['corona'], 1, { zones: i.zones, zoneId: 'B' })!.n).toBe(8);
    expect(plugCementation(set, i.pointSets['corona'], 1, { zones: i.zones, zoneId: 'D' })!.n).toBe(4);
  });

  it('«Aplicar a, m y n» con el trío del TP en una receta; deshacer lo revierte', () => {
    const p0 = loaded();
    const set = coreSets(getWellEntry(p0, W).well.pointSets)[0]!;
    const ri = riSets(getWellEntry(p0, W).well.pointSets)[0]!;
    const i0 = getWellEntry(p0, W).interpretation;
    const c = plugCementation(set, i0.pointSets['corona'], 1, null)!;
    const n = riSaturation(ri, i0.pointSets['ri'])!.pooled.origin!.n;
    const p1 = applyArchie(p0, W, { a: 1, m: c.fixedA!.m, n }, null);
    expect(getWellEntry(p1, W).interpretation.params.global).toEqual({ a: 1, m: 1.9, n: 2.21 });
    const back = undo(recordChange(emptyHistory(), p0, 'Aplicar a, m y n', 0), p1)!;
    expect(getWellEntry(back.project, W).interpretation.params.global).toEqual({});
  });
});

describe('persistencia de los datos del TP', () => {
  it('guardar y abrir (v7): plugs, ensayo, descartes por defecto y marca de profundidad se conservan exactos', async () => {
    const p = enableProjectInputRevisions(loaded());
    const text = await serializeProject(p);
    expect(JSON.parse(text).version).toBe(7);
    const back = await deserializeProject(text);
    const e0 = getWellEntry(p, W);
    const e1 = getWellEntry(back, W);
    const c0 = coreSets(e0.well.pointSets)[0]!;
    const c1 = coreSets(e1.well.pointSets)[0]!;
    expect(c1.source).toBe(TP_CORE_SOURCE);
    expect(c1.synthetic).toBeUndefined();
    expect(c1.pointIds).toEqual(c0.pointIds);
    expect([...c1.depth]).toEqual([...c0.depth]);
    for (const k of [COL.phi, COL.k, COL.rhog]) expect([...pointNumbers(c1, k)!]).toEqual([...pointNumbers(c0, k)!]);
    expect([...pointNumbers(c1, COL.ff)!].map((v) => (Number.isFinite(v) ? v : null))).toEqual([...pointNumbers(c0, COL.ff)!].map((v) => (Number.isFinite(v) ? v : null)));
    expect(pointTexts(c1, COL.description)).toEqual(pointTexts(c0, COL.description));
    const r1 = riSets(e1.well.pointSets)[0]!;
    expect(isTpRiSet(r1)).toBe(true);
    expect([...pointNumbers(r1, 'sw')!]).toEqual([...pointNumbers(riSets(e0.well.pointSets)[0]!, 'sw')!]);
    expect(e1.interpretation.pointSets).toEqual(e0.interpretation.pointSets);
    expect(riSaturation(r1, e1.interpretation.pointSets['ri'])!.pooled.origin!.n).toBeCloseTo(e.n_pooled_origin, 4);
    expect(depthMatchState(c1, e1.interpretation.pointSets['corona']).state).toBe('applied');
  });

  it('snapshot: guarda y restaura los descartes del ensayo; los datos no se copian', () => {
    const p0 = loaded();
    const { project: p1, snapshot } = createSnapshot(p0, W, 's');
    const ri = riSets(getWellEntry(p1, W).well.pointSets)[0]!;
    const p2 = setRiPlugIncluded(p1, W, ri, '1-62E', true);
    expect(Object.keys(getWellEntry(p2, W).interpretation.pointSets['ri']!.points)).toHaveLength(11);
    const p3 = restoreSnapshot(p2, snapshot.id);
    const i = getWellEntry(p3, W).interpretation;
    expect(Object.keys(i.pointSets['ri']!.points)).toHaveLength(12);
    expect(i.pointSets['corona']!.settings?.[DEPTH_ON_LOG_SETTING]).toBe(true);
    expect(getWellEntry(p3, W).well).toBe(getWellEntry(p2, W).well);
  });
});
