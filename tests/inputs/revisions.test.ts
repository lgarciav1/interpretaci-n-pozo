import { describe, expect, it } from 'vitest';
import { unknownAcquisition, validateAcquisition, type AcquisitionMetadata } from '../../src/core/inputs/acquisition';
import { addInitialInputRevision, copyInputWellForEdit, emptyInputRevisions, getActiveInputRevision, inputRevisionIdFromBytes, reviseInputRevision, validateInputRevisionState, type InputRevisionState } from '../../src/core/inputs/revisions';
import { createPointSet } from '../../src/core/pointSets';
import { createWell, makeDepthIndex, type Well } from '../../src/core/well';
import { deserializeProject, serializeProject } from '../../src/core/state/serialize';
import { computeOnce, toEngineWell } from '../../src/core/engine/engine';
import { registry } from '../../src/modules';
import tpCsv from '../../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../../src/io';
import { syntheticWell } from '../../src/app/demo/syntheticWell';

const stamp = (n: number) => ({ id: inputRevisionIdFromBytes(Uint8Array.from({ length: 16 }, (_, i) => i === 15 ? n : 0)), createdAt: '2026-10-29T00:00:00.000Z' });
const hex = (a: Float64Array) => Array.from(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), (v) => v.toString(16).padStart(2, '0')).join('');
function well(id = 'w'): Well {
  return createWell({ id, name: 'Pozo', depth: Float64Array.from([1000, 1000.5, 1001]), curves: [
    { id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: Float64Array.from([10, 20, 30]), origin: { kind: 'measured', source: 'original.las' } },
    { id: 'AUX', mnemonic: 'AUX', role: null, unit: 'unitless', data: Float64Array.from([-0, NaN, Infinity]), origin: { kind: 'measured' } },
  ], pointSets: [createPointSet({ id: 'core', name: 'Corona', kind: 'core', depth: Float64Array.from([1000.25, 1000.75]), pointIds: ['plug-a', 'plug-b'], columns: {
    phi: { label: 'Porosidad', unit: 'v/v', values: Float64Array.from([0.2, NaN]) }, run: { label: 'Corona', values: ['C1', 'C2'] },
  } })] });
}
const initial = (w = well()) => addInitialInputRevision(emptyInputRevisions(), w, stamp(1));
const active = (s: InputRevisionState, id = 'w') => getActiveInputRevision(s, id);
function acquisition(): AcquisitionMetadata {
  return { schemaVersion: 1, depth: { kind: 'MD', datum: 'KB' }, runs: [{ id: 'run-a', curveIds: ['GR'], tool: { catalogId: 'gr', vendor: null, model: null }, corrections: { status: 'unknown', effects: [] }, mud: { salinityPpmNaClEquivalent: null, resistivityOhmM: null, temperatureC: null } }] };
}

describe('creación y propiedad de datos', () => {
  it('captura un original sin modificarlo; conserva también objetos/listas vacíos', () => {
    const w = well();
    const s = initial(w);
    expect(active(s).well).toEqual(w);
    expect(active(s).well).not.toBe(w);
    expect(active(s).well.header).toEqual({});
    expect(active(s).acquisition).toEqual(unknownAcquisition());
    expect(active(s).parentRevisionId).toBeUndefined();
    expect(active(s).well.curves[0]!.data).not.toBe(w.curves[0]!.data);
    expect(active(s).well.depth.values.buffer).not.toBe(w.depth.values.buffer);
    expect(() => validateInputRevisionState(s)).not.toThrow();
  });

  it('mutar entradas externas después de importarlas no altera la revisión', () => {
    const w = well();
    const a = acquisition();
    const s = addInitialInputRevision(emptyInputRevisions(), w, stamp(1), a);
    w.curves[0]!.data[0] = 999;
    w.depth.values[0] = 1;
    w.curves[0]!.origin = { kind: 'measured', source: 'otro' };
    w.pointSets[0]!.depth[0] = 1;
    (w.pointSets[0]!.columns['phi']!.values as Float64Array)[0] = 9;
    (w.pointSets[0]!.columns['run']!.values as string[])[0] = 'otra';
    a.runs[0]!.curveIds.push('AUX');
    expect(active(s).well.curves[0]!.data[0]).toBe(10);
    expect(active(s).well.depth.values[0]).toBe(1000);
    expect(active(s).well.curves[0]!.origin).toEqual({ kind: 'measured', source: 'original.las' });
    expect(active(s).well.pointSets[0]!.depth[0]).toBe(1000.25);
    expect(active(s).well.pointSets[0]!.columns['phi']!.values[0]).toBe(0.2);
    expect(active(s).well.pointSets[0]!.columns['run']!.values[0]).toBe('C1');
    expect(active(s).acquisition.runs[0]!.curveIds).toEqual(['GR']);
  });

  it('una hija cambia solo los datos editados y mantiene el padre y los arrays sin cambios', () => {
    const s = initial();
    const before = active(s);
    const draft = copyInputWellForEdit(s, 'w');
    draft.curves[0]!.data[1] = 35;
    const next = reviseInputRevision(s, 'w', { well: draft }, stamp(2));
    const child = active(next);
    expect(child.parentRevisionId).toBe(before.id);
    expect(child.reason).toBe('edit-input');
    expect(child.well.curves[0]!.data).not.toBe(before.well.curves[0]!.data);
    expect(Array.from(before.well.curves[0]!.data)).toEqual([10, 20, 30]);
    expect(Array.from(child.well.curves[0]!.data)).toEqual([10, 35, 30]);
    expect(child.well.curves[1]!.data).toBe(before.well.curves[1]!.data);
    expect(child.well.depth).toBe(before.well.depth);
    expect(child.well.pointSets).toBe(before.well.pointSets);
    expect(child.acquisition).toBe(before.acquisition);
    expect(next.revisions[before.id]).toBe(before);
    expect(active(s)).toBe(before);
    draft.curves[0]!.data[1] = 999;
    expect(child.well.curves[0]!.data[1]).toBe(35);
  });

  it('cambiar roles, nombres, unidades o procedencia crea revisión sin copiar datos', () => {
    const s = initial();
    const draft = copyInputWellForEdit(s, 'w');
    draft.curves[0] = { ...draft.curves[0]!, role: null, unit: 'unidad-desconocida', description: 'Nueva', mnemonic: 'GR2', origin: { kind: 'measured', source: 'otra.las' } };
    const next = reviseInputRevision(s, 'w', { well: draft }, stamp(2));
    expect(active(next).well.curves[0]!.data).toBe(active(s).well.curves[0]!.data);
    expect(active(next).well.curves[0]!.unit).toBe('unidad-desconocida');
    expect(active(s).well.curves[0]!.role).toBe('GR');
  });

  it('reordenar curvas conserva sus buffers por id, aunque el editor haya copiado todo', () => {
    const s = initial();
    const draft = copyInputWellForEdit(s, 'w');
    draft.curves.reverse();
    const next = reviseInputRevision(s, 'w', { well: draft }, stamp(2));
    expect(active(next).well.curves[0]!.data).toBe(active(s).well.curves[1]!.data);
    expect(active(next).well.curves[1]!.data).toBe(active(s).well.curves[0]!.data);
  });

  it('importar o quitar laboratorio no muta los conjuntos de revisiones anteriores', () => {
    const s = initial();
    const draft = copyInputWellForEdit(s, 'w');
    draft.pointSets = [];
    const removed = reviseInputRevision(s, 'w', { well: draft }, stamp(2));
    expect(active(removed).well.pointSets).toEqual([]);
    expect(active(s).well.pointSets).toHaveLength(1);
    const added = reviseInputRevision(removed, 'w', { well: copyInputWellForEdit(s, 'w') }, stamp(3));
    expect(active(added).well.pointSets).toEqual(active(s).well.pointSets);
    expect(added.revisions[stamp(1).id]).toBe(s.revisions[stamp(1).id]);
    expect(Object.keys(added.revisions)).toHaveLength(3);
  });

  it('cambiar adquisición conserva el Well completo y copia los metadatos externos', () => {
    const s = initial();
    const a = acquisition();
    const next = reviseInputRevision(s, 'w', { acquisition: a }, stamp(2));
    expect(active(next).well).toBe(active(s).well);
    expect(active(next).acquisition.depth.datum).toBe('KB');
    a.runs[0]!.mud.temperatureC = 80;
    expect(active(next).acquisition.runs[0]!.mud.temperatureC).toBeNull();
    expect(active(s).acquisition.depth.datum).toBeNull();
  });

  it('congela contenedores y metadatos; el editor recibe una copia modificable', () => {
    const s = initial();
    expect(() => { active(s).well.name = 'No'; }).toThrow();
    expect(() => { active(s).well.curves.push(active(s).well.curves[0]!); }).toThrow();
    expect(() => { active(s).acquisition.runs.push(acquisition().runs[0]!); }).toThrow();
    const draft = copyInputWellForEdit(s, 'w');
    draft.name = 'Sí'; draft.curves[0]!.data[0] = 9;
    expect(active(s).well.name).toBe('Pozo');
    expect(active(s).well.curves[0]!.data[0]).toBe(10);
  });

  it('copia bytes de subarrays sin incluir el resto del buffer; conserva NaN y cero con signo', () => {
    const w = well();
    const backing = Float64Array.from([999, -0, NaN, Infinity, 888]);
    w.curves[1]!.data = backing.subarray(1, 4);
    const s = initial(w);
    const data = active(s).well.curves[1]!.data;
    expect(hex(data)).toBe(hex(w.curves[1]!.data));
    expect(data.byteOffset).toBe(0);
    expect(data.buffer.byteLength).toBe(24);
    backing[1] = 12;
    expect(Object.is(data[0], -0)).toBe(true);
  });

  it('conserva el payload de NaN y detecta cambios de bytes aunque ambos sean NaN', () => {
    const w = well();
    const raw = new DataView(w.curves[1]!.data.buffer);
    raw.setBigUint64(8, 0x7ff8000000000001n, true);
    const s = initial(w);
    expect(hex(active(s).well.curves[1]!.data)).toBe(hex(w.curves[1]!.data));
    const draft = copyInputWellForEdit(s, 'w');
    new DataView(draft.curves[1]!.data.buffer).setBigUint64(8, 0x7ff8000000000002n, true);
    const next = reviseInputRevision(s, 'w', { well: draft }, stamp(2));
    expect(next).not.toBe(s);
    expect(hex(active(next).well.curves[1]!.data)).not.toBe(hex(active(s).well.curves[1]!.data));
  });

  it('un no-op por contenido conserva estado y revisión, también con objetos nuevos', () => {
    const s = initial();
    expect(reviseInputRevision(s, 'w', {}, stamp(2))).toBe(s);
    expect(reviseInputRevision(s, 'w', { well: copyInputWellForEdit(s, 'w'), acquisition: structuredClone(active(s).acquisition) }, stamp(2))).toBe(s);
    // El sello no se usa si no se publica nada; no se rechaza por colisión con un id sin utilizar.
    expect(reviseInputRevision(s, 'w', { well: copyInputWellForEdit(s, 'w') }, stamp(1))).toBe(s);
  });

  it('dos pozos con ids de curva iguales permanecen aislados, incluso con claves especiales', () => {
    const a = initial();
    const s = addInitialInputRevision(a, well('__proto__'), stamp(2));
    const other = active(s, '__proto__');
    const draft = copyInputWellForEdit(s, 'w'); draft.name = 'Editado';
    const next = reviseInputRevision(s, 'w', { well: draft }, stamp(3));
    expect(active(next, '__proto__')).toBe(other);
    expect(active(next).well.name).toBe('Editado');
    expect(active(next, '__proto__').well.name).toBe('Pozo');
  });
});

describe('rechazo atómico de entradas inválidas', () => {
  const invalidWell: [string, (w: Well) => void][] = [
    ['id de pozo', (w) => { w.id = 'otro'; }],
    ['profundidad repetida', (w) => { w.depth.values[1] = w.depth.values[0]!; }],
    ['profundidad no finita', (w) => { w.depth.values[0] = NaN; }],
    ['curva desalineada', (w) => { w.curves[0]!.data = new Float64Array(2); }],
    ['curva duplicada', (w) => { w.curves.push(w.curves[0]!); }],
    ['unidad vacía', (w) => { w.curves[0]!.unit = ''; }],
    ['paso inconsistente', (w) => { w.depth.step = 1; }],
    ['conjunto duplicado', (w) => { w.pointSets.push(w.pointSets[0]!); }],
    ['puntos desordenados', (w) => { w.pointSets[0]!.depth.reverse(); }],
    ['puntos con ids duplicados', (w) => { w.pointSets[0]!.pointIds = ['same', 'same']; }],
    ['columna desalineada', (w) => { w.pointSets[0]!.columns = { bad: { label: 'Mal', unit: 'm', values: new Float64Array(1) } }; }],
    ['encabezado no finito', (w) => { w.header['KB'] = { value: Infinity }; }],
    ['metadato no admitido', (w) => { Object.assign(w, { extra: 1 }); }],
    ['hueco en curvas', (w) => { delete w.curves[0]; }],
    ['buffer compartido', (w) => { w.curves[0]!.data = new Float64Array(new SharedArrayBuffer(24)); }],
  ];
  it.each(invalidWell)('%s no publica ni muta revisiones', (_, mutate) => {
    const s = initial();
    const draft = copyInputWellForEdit(s, 'w'); mutate(draft);
    expect(() => reviseInputRevision(s, 'w', { well: draft }, stamp(2))).toThrow();
    expect(Object.keys(s.revisions)).toEqual([stamp(1).id]);
    expect(Array.from(active(s).well.curves[0]!.data)).toEqual([10, 20, 30]);
  });

  it('acepta un nuevo índice válido y conserva el anterior', () => {
    const s = initial(); const draft = copyInputWellForEdit(s, 'w');
    draft.depth = makeDepthIndex(Float64Array.from([1002, 1002.5, 1003]));
    const next = reviseInputRevision(s, 'w', { well: draft }, stamp(2));
    expect(Array.from(active(next).well.depth.values)).toEqual([1002, 1002.5, 1003]);
    expect(Array.from(active(s).well.depth.values)).toEqual([1000, 1000.5, 1001]);
  });

  it('rechaza id repetido, inicial duplicada, sello inválido y pozo ausente', () => {
    const s = initial(); const draft = copyInputWellForEdit(s, 'w'); draft.name = 'Nuevo';
    expect(() => reviseInputRevision(s, 'w', { well: draft }, stamp(1))).toThrow(/ya existe/);
    expect(() => addInitialInputRevision(s, well(), stamp(2))).toThrow(/inicial/);
    expect(() => reviseInputRevision(s, 'w', { well: draft }, { ...stamp(2), id: 'fecha-123' })).toThrow(/128 bits/);
    expect(() => reviseInputRevision(s, 'w', { well: draft }, { ...stamp(2), createdAt: '2026-02-30T00:00:00.000Z' })).toThrow(/Fecha/);
    expect(() => getActiveInputRevision(s, 'ausente')).toThrow(/no tiene/);
  });

  it('rechaza undefined explícito o cambios no reconocidos, en lugar de ignorarlos', () => {
    const s = initial();
    expect(() => reviseInputRevision(s, 'w', { well: undefined }, stamp(2))).toThrow();
    expect(() => reviseInputRevision(s, 'w', { acquisition: undefined }, stamp(2))).toThrow();
    expect(() => reviseInputRevision(s, 'w', { other: true } as never, stamp(2))).toThrow(/no admitido/);
  });

  it('no ejecuta getters de metadatos y rechaza buffers detached', () => {
    const s = initial(); const draft = copyInputWellForEdit(s, 'w');
    let called = false;
    Object.defineProperty(draft.header, 'KB', { enumerable: true, get: () => { called = true; return { value: 1 }; } });
    expect(() => reviseInputRevision(s, 'w', { well: draft }, stamp(2))).toThrow(/getter/);
    expect(called).toBe(false);
    const w = copyInputWellForEdit(s, 'w');
    structuredClone(w.curves[0]!.data, { transfer: [w.curves[0]!.data.buffer] });
    expect(() => reviseInputRevision(s, 'w', { well: w }, stamp(2))).toThrow(/desconectado/);
  });
});

describe('adquisición explícita', () => {
  it('no inventa lodo, herramienta ni correcciones; conserva declaraciones desconocidas como texto', () => {
    const a = acquisition();
    a.runs[0]!.corrections = { status: 'declared', effects: [{ effect: 'efecto-futuro', method: 'método-futuro', version: null, reference: 'Informe de adquisición' }] };
    const s = addInitialInputRevision(emptyInputRevisions(), well(), stamp(1), a, 'legacy-migration');
    expect(active(s).reason).toBe('legacy-migration');
    expect(active(s).acquisition).toEqual(a);
    expect(active(s).acquisition.runs[0]!.mud.resistivityOhmM).toBeNull();
  });
  const cases: [string, (a: AcquisitionMetadata) => void][] = [
    ['versión', (a) => { a.schemaVersion = 2 as 1; }],
    ['TVD', (a) => { a.depth.kind = 'TVD' as 'MD'; }],
    ['datum vacío', (a) => { a.depth.datum = ''; }],
    ['corrida duplicada', (a) => { a.runs.push(a.runs[0]!); }],
    ['curva ausente', (a) => { a.runs[0]!.curveIds = ['NO']; }],
    ['curva duplicada', (a) => { a.runs[0]!.curveIds = ['GR', 'GR']; }],
    ['salinidad negativa', (a) => { a.runs[0]!.mud.salinityPpmNaClEquivalent = -1; }],
    ['resistividad cero', (a) => { a.runs[0]!.mud.resistivityOhmM = 0; }],
    ['temperatura imposible', (a) => { a.runs[0]!.mud.temperatureC = -273.15; }],
    ['lodo NaN', (a) => { a.runs[0]!.mud.temperatureC = NaN; }],
    ['efecto sin referencia', (a) => { a.runs[0]!.corrections = { status: 'declared', effects: [{ effect: 'x', method: 'y', version: null, reference: '' }] }; }],
    ['estado contradictorio', (a) => { a.runs[0]!.corrections.effects = [{ effect: 'x', method: 'y', version: null, reference: 'ref' }]; }],
  ];
  it.each(cases)('rechaza %s antes de publicar', (_, mutate) => {
    const s = initial(); const a = acquisition(); mutate(a);
    expect(() => reviseInputRevision(s, 'w', { acquisition: a }, stamp(2))).toThrow();
    expect(active(s).acquisition).toEqual(unknownAcquisition());
  });
  it('admite salinidad cero explícita y temperatura/resistividad declaradas, sin conversiones', () => {
    const a = acquisition(); a.runs[0]!.mud = { salinityPpmNaClEquivalent: 0, temperatureC: 80, resistivityOhmM: 0.2 };
    expect(() => validateAcquisition(a, well())).not.toThrow();
    expect(a.runs[0]!.mud).toEqual({ salinityPpmNaClEquivalent: 0, temperatureC: 80, resistivityOhmM: 0.2 });
  });
});

describe('integridad del grafo en memoria', () => {
  function chain() {
    const s = initial(); const draft = copyInputWellForEdit(s, 'w'); draft.name = 'Hija';
    return structuredClone(reviseInputRevision(s, 'w', { well: draft }, stamp(2)));
  }
  it.each(['parent', 'cycle', 'active', 'well', 'key', 'schema', 'root-parent', 'unbound'])('rechaza estado inconsistente: %s', (fault) => {
    const s = chain() as unknown as { revisions: Record<string, Record<string, unknown>>; activeByWell: Record<string, string> };
    if (fault === 'parent') s.revisions[stamp(2).id]!['parentRevisionId'] = stamp(3).id;
    if (fault === 'cycle') { s.revisions[stamp(1).id]!['parentRevisionId'] = stamp(2).id; s.revisions[stamp(1).id]!['reason'] = 'edit-input'; }
    if (fault === 'active') s.activeByWell['w'] = stamp(3).id;
    if (fault === 'well') s.revisions[stamp(2).id]!['wellId'] = 'otro';
    if (fault === 'key') s.revisions[stamp(2).id]!['id'] = stamp(3).id;
    if (fault === 'schema') s.revisions[stamp(2).id]!['schemaVersion'] = 2;
    if (fault === 'root-parent') s.revisions[stamp(1).id]!['parentRevisionId'] = stamp(2).id;
    if (fault === 'unbound') delete s.activeByWell['w'];
    expect(() => validateInputRevisionState(s)).toThrow();
  });
  it('rechaza un padre de otro pozo', () => {
    const s = addInitialInputRevision(initial(), well('w2'), stamp(2));
    const raw = structuredClone(s) as unknown as { revisions: Record<string, { reason: string; parentRevisionId?: string }> };
    raw.revisions[stamp(1).id]!.reason = 'edit-input'; raw.revisions[stamp(1).id]!.parentRevisionId = stamp(2).id;
    expect(() => validateInputRevisionState(raw)).toThrow(/otro pozo/);
  });
  it('rechaza dos raíces del mismo pozo aunque ambas sean válidas por separado', () => {
    const raw = chain() as unknown as { revisions: Record<string, { reason: string; parentRevisionId?: string }> };
    raw.revisions[stamp(2).id]!.reason = 'import';
    delete raw.revisions[stamp(2).id]!.parentRevisionId;
    expect(() => validateInputRevisionState(raw)).toThrow(/dos revisiones iniciales/);
  });
  it('el formato de id es determinístico; un tamaño incorrecto falla sin depender de crypto', () => {
    expect(stamp(1).id).toBe('input-00000000000000000000000000000001');
    expect(() => inputRevisionIdFromBytes(new Uint8Array(15))).toThrow(/16 bytes/);
  });
});

const fixtures = import.meta.glob<string>('../fixtures/projects/v*.pozo.json', { query: '?raw', import: 'default', eager: true });
it.each(['TP', 'demo'])('captura también el pozo completo %s producido por la aplicación', (kind) => {
  const input = kind === 'TP' ? readWellFile(tpCsv, 'pozo_tp_perfiles.csv').well : syntheticWell().well;
  const state = initial(input);
  const captured = active(state, input.id).well;
  expect(captured).toEqual(input);
  expect(captured.depth.values).not.toBe(input.depth.values);
  expect(captured.curves).toHaveLength(input.curves.length);
  for (let i = 0; i < input.curves.length; i++) expect(hex(captured.curves[i]!.data)).toBe(hex(input.curves[i]!.data));
});
describe.each(Object.entries(fixtures))('compatibilidad aislada: %s', (_, text) => {
  it('captura Well sin cambiar proyecto, fuentes, cálculo ni serialización v6', async () => {
    const p = await deserializeProject(text);
    const before = await serializeProject(p, { codec: 'f64le-b64', savedAt: stamp(1).createdAt });
    let state = emptyInputRevisions();
    for (const [i, entry] of p.wells.entries()) {
      state = addInitialInputRevision(state, entry.well, stamp(i + 1));
      const captured = active(state, entry.well.id).well;
      expect(captured).toEqual(entry.well);
      const output = (w: Well) => { const r = computeOnce(registry, toEngineWell(w), entry.interpretation); return { sources: r.sources, outputs: r.outputs }; };
      expect(output(captured)).toEqual(output(entry.well));
    }
    expect(await serializeProject(p, { codec: 'f64le-b64', savedAt: stamp(1).createdAt })).toBe(before);
    expect(JSON.parse(before).version).toBe(6);
    expect(p).not.toHaveProperty('inputRevisions');
  });
});
