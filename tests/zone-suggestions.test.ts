/**
 * Fase 9b: módulos «Zonas sugeridas» (L) y «Electrosecuencias» (Geo-1) sobre la arquitectura existente. El motor
 * (`src/petro/segmentation.ts`) tiene sus propios tests; acá se prueba el registro, el cálculo en el motor real y la
 * acción «aceptar límite» sobre el store del proyecto (parte la zona correcta y deshacer la restaura).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { addWell, createProject, getWellEntry, setParam, type Project } from '../src/core/state/project';
import { createWell, type Zone } from '../src/core/well';
import { useProject } from '../src/app/store/project';
import { registry } from '../src/modules';
import { acceptBoundaries, nearestZoneEdge, nextZoneName, splitZonesAt, suggestionsFrom, visibleSuggestions, type NewZoneFactory } from '../src/modules/zone-suggestions/model';
import { sequencesForWell } from '../src/modules/electrosequences/model';
import { depthRange, zone } from './helpers';

let seq = 0;
const FACTORY: NewZoneFactory = { id: () => `nueva-${++seq}`, color: () => '#123456' };

/** GR escalonado: 40 gAPI hasta 1010 m, 100 gAPI debajo (escalón neto), muestreo de 0,1524 m. */
function stepWell() {
  const n = 200;
  const depth = depthRange(n, 1000, 0.1524);
  const gr = Float64Array.from(depth, (d, i) => (d < 1015 ? 40 : 100) + ((i * 7919) % 5) - 2);
  return createWell({ id: 'w1', name: 'Pozo 1', depth, curves: [{ id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: gr, origin: { kind: 'measured' } }] });
}

function project(zones: Zone[]): Project {
  return addWell(createProject('Demo'), stepWell(), zones);
}

const zonesOf = (p: Project) => getWellEntry(p, 'w1').interpretation.zones;

describe('registro de los módulos 9b', () => {
  it('están registrados con su espacio y categoría', () => {
    const zs = registry.get('zone-suggestions')!;
    const es = registry.get('electrosequences')!;
    expect(zs.workspace).toEqual(['petrophysics', 'geology']);
    expect(es.workspace).toBe('geology');
    expect(zs.category).toBe('geology');
    expect(es.category).toBe('geology');
    expect(zs.docs.equations.length).toBeGreaterThan(0);
    expect(es.docs.references.length).toBeGreaterThan(0);
  });

  it('el motor calcula las tablas: un límite en el escalón y la forma de cada zona', () => {
    const w = stepWell();
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(toEngineWell(w));
    const r = engine.run(emptyInterpretation([zone('a', 1000, 1014.9), zone('b', 1015, 1030.3)]));
    const table = (key: string) => (r.outputs.find((o) => o.key === key)!.value as { rows: Record<string, unknown>[] }).rows;
    const sugg = suggestionsFrom(table('zone-suggestions:ZONE_SUGGESTIONS') as never);
    expect(sugg.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(sugg[0]!.depth - 1015)).toBeLessThan(0.5);
    expect(sugg[0]!.contrast).toBeGreaterThan(40);
    const seqs = table('electrosequences:ELECTROSEQUENCES');
    expect(seqs.length).toBeGreaterThanOrEqual(2);
    const byZone = table('electrosequences:ZONE_ELECTROSEQUENCES');
    expect(byZone.map((z) => z.zoneId)).toEqual(['a', 'b']);
    expect(byZone.every((z) => typeof z.interpretation === 'string' && (z.interpretation as string).length > 0)).toBe(true);
  });

  it('la pista usa los mismos tramos que el módulo y sigue sus parámetros', () => {
    const p = project([]);
    const e = getWellEntry(p, 'w1');
    const a = sequencesForWell(e.well, e.interpretation)!;
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(sequencesForWell(e.well, e.interpretation)).toBe(a); // caché
    const p2 = setParam(p, 'w1', 'electrosequences.minThickness', 12);
    const e2 = getWellEntry(p2, 'w1');
    expect(sequencesForWell(e2.well, e2.interpretation)).not.toBe(a);
  });
});

describe('aceptar límites sugeridos (recetas puras)', () => {
  it('parte la zona que contiene el límite: arriba la original, abajo una nueva numerada que hereda el tipo', () => {
    const zones = [zone('a', 1000, 1010), zone('b', 1010.0584, 1030.3)];
    const depth = stepWell().depth.values;
    const r = splitZonesAt(zones, depth, 1015, FACTORY);
    if ('error' in r) throw new Error(r.error);
    expect(r.zones.map((z) => z.name)).toEqual(['A', 'B', 'B 2']);
    const [, b, b2] = r.zones;
    expect(b!.id).toBe('b');
    expect(b!.base).toBeLessThan(1015);
    expect(b2!.top).toBeGreaterThanOrEqual(1015);
    expect(b2!.top - b!.base).toBeCloseTo(0.1524, 6); // contiguas: comparten el contacto
    expect(b2!.base).toBe(1030.3);
    expect(r.clone).toEqual({ from: 'b', to: b2!.id });
  });

  it('sin zonas, el primer límite deja el pozo en dos zonas que lo cubren', () => {
    const depth = stepWell().depth.values;
    const r = splitZonesAt([], depth, 1015, FACTORY);
    if ('error' in r) throw new Error(r.error);
    expect(r.zones).toHaveLength(2);
    expect(r.zones[0]!.top).toBe(depth[0]);
    expect(r.zones[1]!.base).toBe(depth[depth.length - 1]);
    expect(r.zones.map((z) => z.name)).toEqual(['Z1', 'Z2']);
  });

  it('no acepta un límite pegado a un tope existente', () => {
    const depth = stepWell().depth.values;
    const r = splitZonesAt([zone('a', 1000, 1030.3)], depth, 1000.2, FACTORY);
    expect('error' in r).toBe(true);
  });

  it('nombres y cercanía a topes existentes', () => {
    expect(nextZoneName([zone('b', 0, 1)], 'B')).toBe('B 2');
    expect(nextZoneName([zone('b', 0, 1), { ...zone('b2', 1, 2), name: 'B 2' }], 'B 2')).toBe('B 3');
    const zs = [zone('a', 1000, 1010)];
    expect(nearestZoneEdge(zs, 1011.5)).toMatchObject({ zoneName: 'A', edge: 'base' });
    expect(nearestZoneEdge(zs, 1012.5)).toBeNull();
    const list = suggestionsFrom([
      { rank: 2, depth: 1011, strengthRel: 0.3, contrast: 10, valueAbove: 50, valueBelow: 60 },
      { rank: 1, depth: 1020, strengthRel: 0.9, contrast: 50, valueAbove: 40, valueBelow: 90 },
    ]);
    expect(list.map((s) => s.rank)).toEqual([1, 2]);
    const shown = visibleSuggestions(list, zs, { minStrength: 0, dismissed: new Set(), edits: new Map([[list[0]!.key, 1021]]) });
    expect(shown[0]!.effectiveDepth).toBe(1021);
    expect(shown[1]!.near).not.toBeNull();
    expect(visibleSuggestions(list, zs, { minStrength: 0.5, dismissed: new Set(), edits: new Map() })).toHaveLength(1);
  });
});

describe('aceptar límite sobre el store del proyecto', () => {
  beforeEach(() => {
    useProject.getState().replace(project([zone('a', 1000, 1010), zone('b', 1010.0584, 1030.3)]));
  });

  it('parte la zona correcta, hereda los parámetros por zona y deshacer la restaura', () => {
    const store = () => useProject.getState();
    store().commit('Parámetro de B', (p) => setParam(p, 'w1', 'vsh.method', 'larionov-old', 'b'));
    const before = zonesOf(store().project);
    store().commit('Aceptar límite sugerido', (p) => acceptBoundaries(p, 'w1', [1015], FACTORY).project);
    const after = zonesOf(store().project);
    expect(after).toHaveLength(3);
    const lower = after.find((z) => z.name === 'B 2')!;
    expect(lower.top).toBeGreaterThanOrEqual(1015);
    expect(after.find((z) => z.id === 'b')!.base).toBeLessThan(1015);
    expect(after.find((z) => z.id === 'a')).toEqual(before[0]);
    expect(getWellEntry(store().project, 'w1').interpretation.params.zones[lower.id]).toEqual({ 'vsh.method': 'larionov-old' });
    expect(store().undoLabel).toBe('Aceptar límite sugerido');

    store().undo();
    expect(zonesOf(store().project)).toEqual(before);
    store().redo();
    expect(zonesOf(store().project)).toHaveLength(3);
  });

  it('aceptar varios es una sola entrada de deshacer y salta los imposibles', () => {
    const store = () => useProject.getState();
    const before = zonesOf(store().project);
    let skipped = 0;
    store().commit('Aceptar 3 límites sugeridos', (p) => {
      const r = acceptBoundaries(p, 'w1', [1020, 1005, 1000.1], FACTORY);
      skipped = r.skipped.length;
      return r.project;
    });
    expect(skipped).toBe(1);
    expect(zonesOf(store().project).map((z) => z.name)).toEqual(['A', 'A 2', 'B', 'B 2']);
    store().undo();
    expect(zonesOf(store().project)).toEqual(before);
  });
});
