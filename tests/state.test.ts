import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/core/registry';
import {
  addWell,
  clearParam,
  createProject,
  getWellEntry,
  setCompare,
  setModuleEnabled,
  setParam,
  setSource,
  setZones,
  updateCurveMeta,
  type Project,
} from '../src/core/state/project';
import { createSnapshot, deleteSnapshot, describeDiff, diffInterpretations, listSnapshots, restoreSnapshot } from '../src/core/state/snapshots';
import { createWell } from '../src/core/well';
import { depthRange, linearModule, zone } from './helpers';

function demoProject(): Project {
  const w = createWell({
    id: 'w1',
    name: 'Pozo 1',
    depth: depthRange(10),
    curves: [{ id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: new Float64Array(10), origin: { kind: 'measured' } }],
  });
  return addWell(createProject('Demo'), w, [zone('a', 1000, 1002), zone('b', 1002.5, 1004.5)]);
}

const interpOf = (p: Project) => getWellEntry(p, 'w1').interpretation;

describe('acciones del proyecto (puras)', () => {
  it('fijan y limpian parámetros globales y por zona sin mutar el original', () => {
    const p0 = demoProject();
    const p1 = setParam(p0, 'w1', 'igr.offset', 5);
    const p2 = setParam(p1, 'w1', 'igr.offset', 9, 'b');
    expect(interpOf(p0).params).toEqual({ global: {}, zones: {} });
    expect(interpOf(p2).params).toEqual({ global: { 'igr.offset': 5 }, zones: { b: { 'igr.offset': 9 } } });
    expect(interpOf(clearParam(p2, 'w1', 'igr.offset', 'b')).params.zones).toEqual({});
    expect(interpOf(clearParam(p2, 'w1', 'igr.offset')).params.global).toEqual({});
    expect(() => setParam(p0, 'w1', 'x', 1, 'nope')).toThrow(/No existe la zona/);
  });

  it('comparten estructura: lo que no cambia conserva su referencia (datos incluidos)', () => {
    const p0 = demoProject();
    const p1 = setParam(p0, 'w1', 'igr.offset', 5);
    expect(getWellEntry(p1, 'w1').well).toBe(getWellEntry(p0, 'w1').well);
    // fijar el mismo valor no crea una interpretación nueva
    expect(interpOf(setParam(p1, 'w1', 'igr.offset', 5))).toBe(interpOf(p1));
    const p2 = updateCurveMeta(p1, 'w1', 'GR', { role: 'SP' });
    expect(getWellEntry(p2, 'w1').well.curves[0]!.data).toBe(getWellEntry(p1, 'w1').well.curves[0]!.data);
    expect(getWellEntry(p2, 'w1').well.curves[0]!.role).toBe('SP');
  });

  it('al borrar una zona se descartan sus overrides', () => {
    let p = setParam(demoProject(), 'w1', 'k', 1, 'a');
    p = setParam(p, 'w1', 'k', 2, 'b');
    p = setZones(p, 'w1', [zone('b', 1002.5, 1004.5)]);
    expect(interpOf(p).params.zones).toEqual({ b: { k: 2 } });
  });

  it('elige fuentes, comparaciones y módulos desactivados', () => {
    let p = setSource(demoProject(), 'w1', 'VSH', { kind: 'module', moduleId: 'vsh-lar' });
    p = setCompare(p, 'w1', 'vsh-lin', true);
    p = setModuleEnabled(p, 'w1', 'igr', false);
    expect(interpOf(p)).toMatchObject({ sources: { VSH: { kind: 'module', moduleId: 'vsh-lar' } }, compare: ['vsh-lin'], disabled: ['igr'] });
    p = setSource(p, 'w1', 'VSH', null);
    expect(interpOf(p).sources).toEqual({});
  });
});

describe('snapshots', () => {
  it('crear, listar, restaurar y borrar', () => {
    let p = setParam(demoProject(), 'w1', 'igr.offset', 5);
    const { project, snapshot } = createSnapshot(p, 'w1', 'Caso base', { createdAt: '2026-10-09T00:00:00.000Z' });
    p = setParam(project, 'w1', 'igr.offset', 50);
    expect(listSnapshots(p, 'w1').map((s) => s.name)).toEqual(['Caso base']);
    // el snapshot es una copia: cambiar el estado no lo afecta
    expect(snapshot.interpretation.params.global['igr.offset']).toBe(5);
    p = restoreSnapshot(p, snapshot.id);
    expect(interpOf(p).params.global['igr.offset']).toBe(5);
    // restaurar no comparte objetos con el snapshot (editar después no lo corrompe)
    expect(interpOf(p)).not.toBe(snapshot.interpretation);
    expect(deleteSnapshot(p, snapshot.id).snapshots).toEqual([]);
  });

  it('la diferencia entre dos estados lista parámetros, fuentes, zonas y módulos', () => {
    const registry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
    let p = demoProject();
    const a = interpOf(p);
    p = setParam(p, 'w1', 'igr.offset', 3);
    p = setParam(p, 'w1', 'igr.offset', 7, 'a');
    p = setSource(p, 'w1', 'IGR', { kind: 'module', moduleId: 'igr' });
    p = setZones(p, 'w1', [{ ...zone('a', 1000, 1001), name: 'A' }, zone('c', 1003, 1004)]);
    p = setCompare(p, 'w1', 'igr', true);
    const b = interpOf(p);
    const diff = diffInterpretations(a, b, registry);
    const text = diff.map((d) => describeDiff(d, { registry, zones: b.zones }));
    expect(text).toEqual([
      'Desplazamiento (global): 0 → 3',
      'Desplazamiento (A): 0 → 7',
      'Fuente de IGR: por defecto → Prueba igr',
      'Zona A: cambió base',
      'Zona B eliminada',
      'Zona C agregada',
      'Se compara Prueba igr',
    ]);
    expect(diffInterpretations(b, b, registry)).toEqual([]);
  });

  it('un valor explícito igual al default no es una diferencia (con registro)', () => {
    const registry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
    const p = demoProject();
    const a = interpOf(p);
    const b = interpOf(setParam(p, 'w1', 'igr.offset', 0));
    expect(diffInterpretations(a, b, registry)).toEqual([]);
    expect(diffInterpretations(a, b)).toHaveLength(1); // sin registro no conoce el default
  });
});
