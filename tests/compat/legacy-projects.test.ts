/** Corpus fijo independiente: no fabricar archivos viejos con el serializer que estamos probando. */
import { describe, expect, it } from 'vitest';
import manifest from '../fixtures/projects/manifest.json';
import { computeOnce, toEngineWell } from '../../src/core/engine/engine';
import { isNumericColumn } from '../../src/core/pointSets';
import { emptyHistory, recordChange, redo, undo } from '../../src/core/state/history';
import { removePointSet } from '../../src/core/state/pointSets';
import { getWellEntry, setParam, updateCurveMeta, type Project } from '../../src/core/state/project';
import { deserializeProject, serializeProject } from '../../src/core/state/serialize';
import { restoreSnapshot } from '../../src/core/state/snapshots';
import { registry } from '../../src/modules';

const files = import.meta.glob<string>('../fixtures/projects/v*.pozo.json', { query: '?raw', import: 'default', eager: true });
const savedAt = '2026-10-01T00:00:00.000Z';
const hex = (data: Float64Array) => Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), (b) => b.toString(16).padStart(2, '0')).join('');
const load = (file: string, warnings: string[] = []) => deserializeProject(files[`../fixtures/projects/${file}`]!, { onWarning: (s) => warnings.push(s) });

function arraysOf(project: Project): Record<string, string> {
  const arrays: Record<string, string> = {};
  for (const { well } of project.wells) {
    arrays[`${well.id}/depth`] = hex(well.depth.values);
    for (const c of well.curves) arrays[`${well.id}/curve/${c.id}`] = hex(c.data);
    for (const ps of well.pointSets) {
      arrays[`${well.id}/points/${ps.id}/depth`] = hex(ps.depth);
      for (const [key, col] of Object.entries(ps.columns)) if (isNumericColumn(col)) arrays[`${well.id}/points/${ps.id}/${key}`] = hex(col.values);
    }
  }
  return arrays;
}
const outputsOf = (project: Project) => project.wells.map(({ well, interpretation }) => {
  const run = computeOnce(registry, toEngineWell(well), interpretation);
  return { sources: run.sources, candidates: run.candidates, diagnostics: run.diagnostics, outputs: run.outputs.map(({ key, kind, port, active, value }) => ({ key, kind, port, active, value })) };
});

describe.each(manifest.fixtures)('proyecto fijo v$version', (fixture) => {
  it('conserva bytes originales, NaN, ceros con signo, unidades, roles y procedencia sin avisos', async () => {
    const warnings: string[] = [];
    const p = await load(fixture.file, warnings);
    expect(warnings).toEqual([]);
    expect(arraysOf(p)).toEqual(fixture.arraysHex);
    expect(p.activeWellId).toBe('w1');
    expect(p.wells[0]!.well.depth.sourceUnit).toBe('ft');
    expect(p.wells[0]!.well.curves.map((c) => [c.id, c.role, c.unit, c.origin])).toEqual([
      ['GR', 'GR', 'gAPI', { kind: 'measured', source: 'compatibilidad.las' }],
      ['VSH_imported', 'VSH', 'v/v', { kind: 'measured', source: 'compatibilidad.las' }],
      ['AUX', null, 'unitless', { kind: 'measured', source: 'compatibilidad.las' }],
    ]);
  });

  it('migra solo los campos que faltaban en esa versión, incluida la interpretación del snapshot', async () => {
    const p = await load(fixture.file);
    const entry = p.wells[0]!;
    expect(entry.progress.marks).toEqual(fixture.version >= 2 ? { qc: 'done', porosity: 'skipped' } : {});
    expect(Object.keys(p.display.layouts)).toEqual(fixture.version >= 3 ? ['petrophysics'] : []);
    expect(entry.interpretation.trends.map((t) => t.id)).toEqual(fixture.version >= 4 ? ['trend-gr'] : []);
    expect(entry.well.pointSets.map((ps) => ps.id)).toEqual(fixture.version === 6 ? ['mdt', 'core'] : fixture.version === 5 ? ['mdt'] : []);
    expect(p.snapshots[0]!.interpretation.trends).toEqual(entry.interpretation.trends);
    expect(p.snapshots[0]!.interpretation.pointSets).toEqual(entry.interpretation.pointSets);
    expect(entry.interpretation.sources).toEqual({ VSH: { kind: 'curve', curveId: 'VSH_imported' } });
    expect(entry.interpretation.params.zones).toEqual({ a: { grShale: 110 } });
    expect(p.snapshots[0]!.interpretation.params.global['grClean']).toBe(10);
  });

  it('guardar y reabrir conserva el proyecto normalizado completo y el cálculo, con los tres codecs', async () => {
    const p = await load(fixture.file);
    const outputs = outputsOf(p);
    expect(outputs[0]!.sources['VSH']).toEqual({ kind: 'curve', curveId: 'VSH_imported' });
    const igr = outputs[0]!.outputs.find((o) => o.key === 'igr:IGR')!.value as Float64Array;
    expect(igr[0]).toBe(0);
    expect(igr[1]).toBeNaN();
    expect(igr[2]).toBeCloseTo(2 / 9, 12);
    expect(igr[3]).toBe(1);
    for (const codec of ['f64le-b64', 'f64le-deflate-b64', 'f64le-shuffle-deflate-b64'] as const) {
      const warnings: string[] = [];
      const text = await serializeProject(p, { codec, savedAt });
      const back = await deserializeProject(text, { onWarning: (s) => warnings.push(s) });
      expect(warnings).toEqual([]);
      expect(back).toEqual(p);
      expect(arraysOf(back)).toEqual(fixture.arraysHex);
      expect(outputsOf(back)).toEqual(outputs);
      // El formato vigente sigue siendo v6; P1 tendrá que actualizar esta expectativa explícitamente.
      expect(JSON.parse(text).version).toBe(6);
      expect(await serializeProject(back, { codec, savedAt })).toBe(text);
    }
  });

  it('restaurar decisiones conserva datos, visualización y progreso; editar tiene undo/redo exacto', async () => {
    const p = await load(fixture.file);
    const edited = setParam(p, 'w1', 'grClean', 35);
    const h = recordChange(emptyHistory(), p, 'Editar GR', 1000);
    const back = undo(h, edited)!;
    expect(back.project).toBe(p);
    expect(redo(back.history, back.project)!.project).toBe(edited);
    const restored = restoreSnapshot(edited, 'snap-base');
    expect(restored.wells[0]!.interpretation.params.global['grClean']).toBe(10);
    expect(restored.wells[0]!.well).toBe(p.wells[0]!.well);
    expect(restored.wells[0]!.progress).toBe(p.wells[0]!.progress);
    expect(restored.display).toBe(p.display);
    expect(arraysOf(restored)).toEqual(fixture.arraysHex);
    expect(p.wells[0]!.interpretation.params.global['grClean']).toBe(20);
  });
});

it('v6 conserva decisiones MDT/corona, profundidad desplazada, textos, plantillas y gráficos', async () => {
  const p = await load('v6.pozo.json');
  const entry = p.wells[0]!;
  expect(entry.interpretation.pointSets['core']).toEqual({ points: { 'plug-2': { status: 'exclude' } }, depthShift: 1.25, runShifts: { C1: -0.5 } });
  expect(entry.well.pointSets[0]!.pointIds).toEqual(['test-1', 'test-2']);
  expect(entry.well.pointSets[0]!.columns['fluid']!.values).toEqual(['water', 'oil']);
  expect(entry.interpretation.toolString?.off).toEqual(['sonic']);
  expect(p.display.trackTemplates?.[0]?.tracks).toEqual(p.display.layouts['petrophysics']);
  expect(p.display.plots?.['w1']?.histogram?.cutoffs).toEqual({ 'r:VSH': true, 'm:GR': 75 });
});

it('dos pozos con los mismos ids de curvas no mezclan datos o metadatos al editar uno', async () => {
  const p = await load('v6.pozo.json');
  const other = getWellEntry(p, 'w2');
  const changed = updateCurveMeta(p, 'w1', 'GR', { description: 'Descripción nueva' });
  expect(getWellEntry(changed, 'w2')).toBe(other);
  expect(Array.from(other.well.curves[0]!.data)).toEqual([30, 40, 50, 60, 70]);
  expect(getWellEntry(changed, 'w1').well.curves[0]!.data).toBe(p.wells[0]!.well.curves[0]!.data);
});

it('un archivo futuro se rechaza sin modificar el proyecto abierto', async () => {
  const p = await load('v6.pozo.json');
  const raw = JSON.parse(files['../fixtures/projects/v6.pozo.json']!);
  raw.version = 8; // v7 ya es un formato admitido.
  await expect(deserializeProject(JSON.stringify(raw))).rejects.toThrow(/versión más nueva/);
  expect(arraysOf(p)).toEqual(manifest.fixtures[5]!.arraysHex);
});

it('una edición sin cambios devuelve el mismo proyecto', async () => {
  const p = await load('v6.pozo.json');
  expect(setParam(p, 'w1', 'grClean', 20)).toBe(p);
});

it('quitar laboratorio es reversible sin mutar el original ni las decisiones guardadas del snapshot', async () => {
  const p = await load('v6.pozo.json');
  const removed = removePointSet(p, 'w1', 'core');
  expect(removed.wells[0]!.well.pointSets.map((s) => s.id)).toEqual(['mdt']);
  expect(removed.wells[0]!.interpretation.pointSets['core']).toBeUndefined();
  expect(p.wells[0]!.well.pointSets.map((s) => s.id)).toEqual(['mdt', 'core']);
  expect(removed.snapshots).toBe(p.snapshots);
  expect(p.snapshots[0]!.interpretation.pointSets['core']?.depthShift).toBe(1.25);
  const h = recordChange(emptyHistory(), p, 'Quitar corona', 1000);
  const back = undo(h, removed)!;
  expect(back.project).toBe(p);
  expect(redo(back.history, back.project)!.project).toBe(removed);
});

it.each(['length', 'codec', 'depth'])('rechaza corrupción de %s sin modificar otro proyecto cargado', async (fault) => {
  const p = await load('v6.pozo.json');
  const raw = JSON.parse(files['../fixtures/projects/v6.pozo.json']!);
  const well = raw.project.wells[0].well;
  if (fault === 'length') well.curves[0].data.length = 4;
  else if (fault === 'codec') well.curves[0].data.codec = 'unknown';
  else well.depth.values = well.curves[0].data; // GR incluye un hueco: no es un índice finito creciente.
  await expect(deserializeProject(JSON.stringify(raw))).rejects.toThrow();
  expect(arraysOf(p)).toEqual(manifest.fixtures[5]!.arraysHex);
});

it('los fixtures permanecen fijos: su SHA-256 coincide con el manifiesto independiente', async () => {
  for (const f of manifest.fixtures) {
    const data = new TextEncoder().encode(files[`../fixtures/projects/${f.file}`]!);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    expect(Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')).toBe(f.sha256);
  }
});
