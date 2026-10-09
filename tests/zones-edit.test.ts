/**
 * Recetas de edición de zonas (fase 4b): mover tope o base con ajuste a la muestra, contacto compartido, frenar en
 * la vecina, espesor mínimo, crear (en un hueco o partiendo una zona), renombrar, borrar y que pase por el motor.
 */
import { describe, expect, it } from 'vitest';
import { computeOnce } from '../src/core/engine/engine';
import { createRegistry } from '../src/core/registry';
import { addWell, applyZoneEdit, createProject, getWellEntry, setParam } from '../src/core/state/project';
import {
  contactGap,
  createZone,
  defaultZoneName,
  deleteZone,
  moveZoneEdge,
  nudgeZoneEdge,
  snapToSample,
  updateZone,
  validateZoneName,
} from '../src/core/state/zones';
import { createWell, type Zone } from '../src/core/well';
import igr from '../src/modules/igr';
import { depthRange, interp } from './helpers';

// 1000–1050 m cada 0,5 m (101 muestras). A y B contiguas (separadas por una muestra, como en el TP); C con hueco.
const depth = depthRange(101, 1000, 0.5);
const z = (id: string, top: number, base: number): Zone => ({ id, name: id.toUpperCase(), top, base, color: '#888888', kind: 'formation' });
const zones = [z('a', 1000, 1010), z('b', 1010.5, 1020), z('c', 1030, 1040)];
const opts = { depth, minThickness: 1 };
const get = (list: Zone[], id: string) => list.find((x) => x.id === id)!;

describe('mover topes y bases', () => {
  it('ajusta a la muestra más cercana', () => {
    expect(snapToSample(depth, 1003.3)).toBe(1003.5);
    const out = moveZoneEdge(zones, 'c', 'base', 1043.2, opts);
    expect(get(out, 'c').base).toBe(1043);
  });

  it('el contacto compartido mueve a las dos zonas y conserva la separación de una muestra', () => {
    expect(contactGap(zones[0]!, zones[1]!, depth)).toBe(1);
    expect(contactGap(zones[1]!, zones[2]!, depth)).toBeNull();
    const out = moveZoneEdge(zones, 'b', 'top', 1006.2, opts);
    expect(get(out, 'b').top).toBe(1006);
    expect(get(out, 'a').base).toBe(1005.5);
    const back = moveZoneEdge(out, 'a', 'base', 1012, opts);
    expect(get(back, 'a').base).toBe(1012);
    expect(get(back, 'b').top).toBe(1012.5);
  });

  it('frena en la vecina sin contacto (no se superponen ni se empujan)', () => {
    const out = moveZoneEdge(zones, 'b', 'base', 1035, opts);
    expect(get(out, 'b').base).toBe(1029.5); // una muestra antes del tope de C
    expect(get(out, 'c')).toBe(get(zones, 'c')); // C no se tocó
    const up = moveZoneEdge(zones, 'c', 'top', 1015, opts);
    expect(get(up, 'c').top).toBe(1020.5);
  });

  it('respeta el espesor mínimo de la zona y de la vecina con contacto', () => {
    expect(get(moveZoneEdge(zones, 'c', 'top', 1045, opts), 'c').top).toBe(1039); // C queda de 1 m
    const out = moveZoneEdge(zones, 'b', 'top', 990, opts);
    expect(get(out, 'a').base - get(out, 'a').top).toBeGreaterThanOrEqual(1);
    expect(get(out, 'a').base).toBe(1001);
    expect(get(out, 'b').top).toBe(1001.5);
  });

  it('no sale del pozo y devuelve la misma lista si no hay cambio', () => {
    expect(get(moveZoneEdge(zones, 'a', 'top', 900, opts), 'a').top).toBe(1000);
    expect(moveZoneEdge(zones, 'a', 'top', 1000.1, opts)).toBe(zones);
    expect(moveZoneEdge(zones, 'nada', 'top', 1001, opts)).toBe(zones);
  });

  it('↑/↓ mueven al menos una muestra', () => {
    expect(get(nudgeZoneEdge(zones, 'c', 'top', 0.1, opts), 'c').top).toBe(1030.5);
    expect(get(nudgeZoneEdge(zones, 'c', 'top', -1.5, opts), 'c').top).toBe(1028.5);
  });
});

describe('crear zonas', () => {
  const input = { id: 'n', name: 'Zona 1', color: '#5b8def' };

  it('en un hueco: se acota al hueco y no pisa a las vecinas', () => {
    const r = createZone(zones, 1022, 1035, input, opts);
    if ('error' in r) throw new Error(r.error);
    expect(r.created).toMatchObject({ top: 1022, base: 1029.5 });
    expect(r.clone).toBeNull();
    expect(r.zones.map((x) => x.id)).toEqual(['a', 'b', 'n', 'c']);
  });

  it('dentro de una zona la parte en tres; el resto inferior hereda los parámetros', () => {
    const r = createZone(zones, 1013, 1016, { ...input, lowerId: 'b2' }, opts);
    if ('error' in r) throw new Error(r.error);
    expect(r.zones.map((x) => `${x.id}:${x.top}-${x.base}`)).toEqual(['a:1000-1010', 'b:1010.5-1012.5', 'n:1013-1016', 'b2:1016.5-1020', 'c:1030-1040']);
    expect(get(r.zones, 'b2').name).toBe('B inf.');
    expect(r.clone).toEqual({ from: 'b', to: 'b2' });
  });

  it('un resto más delgado que el mínimo se suma a la zona nueva', () => {
    const r = createZone(zones, 1011, 1016, input, opts);
    if ('error' in r) throw new Error(r.error);
    expect(r.created.top).toBe(1010.5);
    expect(get(r.zones, 'b')).toMatchObject({ top: 1016.5, base: 1020 }); // la original sigue siendo la de abajo
    expect(r.clone).toBeNull();
  });

  it('rechaza tramos muy cortos o que cubren toda la zona', () => {
    expect(createZone(zones, 1031, 1031.5, input, opts)).toEqual({ error: expect.stringContaining('muy corto') });
    expect(createZone(zones, 1030, 1040, input, opts)).toEqual({ error: expect.stringContaining('zona C') });
  });

  it('nombres por defecto, renombrar, validar y borrar', () => {
    expect(defaultZoneName(zones)).toBe('Z1');
    expect(defaultZoneName([...zones, { ...z('x', 0, 1), name: 'Z1' }])).toBe('Z2');
    expect(validateZoneName(zones, 'a', '  ')).toBe('El nombre no puede quedar vacío.');
    expect(validateZoneName(zones, 'a', 'b')).toBe('Ya hay una zona «b».');
    expect(validateZoneName(zones, 'a', 'A')).toBeNull();
    const renamed = updateZone(zones, 'a', { name: ' Arena 1 ', kind: 'reservoir' });
    expect(get(renamed, 'a')).toMatchObject({ name: 'Arena 1', kind: 'reservoir' });
    expect(updateZone(zones, 'a', { name: 'A' })).toBe(zones);
    expect(deleteZone(zones, 'b').map((x) => x.id)).toEqual(['a', 'c']);
  });
});

describe('las zonas pasan por el motor', () => {
  const n = 101;
  const gr = Float64Array.from({ length: n }, () => 75);
  const well = createWell({ id: 'w', name: 'W', depth, curves: [{ id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: gr, origin: { kind: 'measured' } }] });
  const registry = createRegistry([igr]);

  it('mover un tope cambia qué parámetros de zona usa cada muestra', () => {
    let p = addWell(createProject(), well, zones);
    p = setParam(p, 'w', 'grClean', 50, 'b'); // B: IGR = (75 − 50)/(120 − 50)
    const run = () => {
      const e = getWellEntry(p, 'w');
      const r = computeOnce(registry, { id: 'w', depth, curves: well.curves }, interp({ zones: e.interpretation.zones, params: e.interpretation.params }));
      return r.outputs.find((o) => o.port === 'IGR')!.value as Float64Array;
    };
    const at = (d: number) => Math.round((d - 1000) / 0.5);
    expect(run()[at(1008)]).toBeCloseTo((75 - 30) / 90, 6); // en A, parámetros globales
    p = applyZoneEdit(p, 'w', moveZoneEdge(getWellEntry(p, 'w').interpretation.zones, 'b', 'top', 1006, opts));
    expect(run()[at(1008)]).toBeCloseTo((75 - 50) / 70, 6); // ahora en B
  });

  it('al partir una zona, el resto inferior hereda sus parámetros', () => {
    let p = addWell(createProject(), well, zones);
    p = setParam(p, 'w', 'grClean', 50, 'b');
    const r = createZone(getWellEntry(p, 'w').interpretation.zones, 1013, 1016, { id: 'n', name: 'N', color: '#5b8def', lowerId: 'b2' }, opts);
    if ('error' in r) throw new Error(r.error);
    p = applyZoneEdit(p, 'w', r.zones, r.clone);
    expect(getWellEntry(p, 'w').interpretation.params.zones['b2']).toEqual({ grClean: 50 });
    expect(getWellEntry(p, 'w').interpretation.params.zones['n']).toBeUndefined();
  });
});
