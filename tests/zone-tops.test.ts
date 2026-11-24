/**
 * Pegar topes (F09): la receta `zonesFromTops` (reemplazar conserva los parámetros de las zonas con el mismo nombre;
 * agregar no toca las actuales) y que aplicarla sea UN paso de deshacer del historial del proyecto.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useProject } from '../src/app/store/project';
import { addWell, applyZoneEdit, createProject, getWellEntry, setParam } from '../src/core/state/project';
import { zonesFromTops } from '../src/core/state/zones';
import { createWell, type Zone } from '../src/core/well';
import { parseZoneTopsText } from '../src/io';
import { depthRange } from './helpers';

const depth = depthRange(101, 1000, 0.5);
const z = (id: string, name: string, top: number, base: number, color = '#112233'): Zone => ({ id, name, top, base, color, kind: 'reservoir' });
let n = 0;
const newZone = (i: number) => ({ id: `nuevo-${++n}`, color: `#00000${i}` });

beforeEach(() => {
  n = 0;
});

describe('zonesFromTops', () => {
  const drafts = [
    { name: 'B', top: 1010, base: 1020 },
    { name: 'A', top: 1000, base: 1009.5 },
  ];

  it('reemplazar: ordena por tope y conserva id, color y tipo de la zona con el mismo nombre', () => {
    const out = zonesFromTops([z('old-a', 'a', 1000, 1030)], drafts, 'replace', newZone);
    expect(out.map((x) => x.name)).toEqual(['A', 'B']);
    expect(out[0]).toMatchObject({ id: 'old-a', color: '#112233', kind: 'reservoir', top: 1000, base: 1009.5 });
    expect(out[1]).toMatchObject({ id: 'nuevo-1', kind: 'formation', top: 1010 });
  });

  it('agregar: deja las actuales como están y suma las nuevas en orden', () => {
    const current = [z('k', 'K', 1030, 1040)];
    const out = zonesFromTops(current, drafts, 'append', newZone);
    expect(out.map((x) => x.id)).toEqual(['nuevo-1', 'nuevo-2', 'k']);
    expect(out[2]).toBe(current[0]);
  });
});

describe('aplicar topes pegados', () => {
  it('un solo Ctrl+Z vuelve a las zonas previas, y rehacer las recupera', () => {
    const well = createWell({ id: 'w1', name: 'P-1', depth, curves: [] });
    const project = setParam(addWell(createProject('t'), well, [z('old', 'Vieja', 1000, 1050)]), 'w1', 'grClean', 50, 'old');
    useProject.getState().replace(project);
    const before = getWellEntry(useProject.getState().project, 'w1').interpretation.zones;

    const text = 'Zona\tTope\nA\t1000\nB\t1010,5\nC\t1030';
    const parsed = parseZoneTopsText(text, { depth });
    expect(parsed.errors).toBe(0);
    const next = zonesFromTops(before, parsed.drafts, 'replace', newZone);
    useProject.getState().commit('Pegar topes (3 zonas)', (p) => applyZoneEdit(p, 'w1', next));

    expect(getWellEntry(useProject.getState().project, 'w1').interpretation.zones.map((x) => x.name)).toEqual(['A', 'B', 'C']);
    expect(useProject.getState().undoLabel).toBe('Pegar topes (3 zonas)');
    useProject.getState().undo();
    expect(getWellEntry(useProject.getState().project, 'w1').interpretation.zones).toEqual(before);
    expect(getWellEntry(useProject.getState().project, 'w1').interpretation.params.zones['old']).toMatchObject({ grClean: 50 });
    expect(useProject.getState().undoLabel).toBeNull();
    useProject.getState().redo();
    expect(getWellEntry(useProject.getState().project, 'w1').interpretation.zones.map((x) => x.name)).toEqual(['A', 'B', 'C']);
  });
});
