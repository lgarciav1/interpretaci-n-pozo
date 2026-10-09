import { describe, expect, it } from 'vitest';
import { decodeArray, deserializeProject, encodeArray, serializeProject } from '../src/core/state/serialize';
import { addWell, createProject, setParam, setStepMark } from '../src/core/state/project';
import { createSnapshot } from '../src/core/state/snapshots';
import { createWell } from '../src/core/well';
import { zone } from './helpers';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import tpCsv from '../datos/pozo_tp_perfiles.csv?raw';

function bitsEqual(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return ua.every((x, i) => x === ub[i]);
}

describe('codificación de arrays', () => {
  const values = Float64Array.from([0, -0, 1.5, NaN, Infinity, -Infinity, 7633.2588, 1e-300, Number.MAX_VALUE]);
  for (const codec of ['f64le-b64', 'f64le-deflate-b64', 'f64le-shuffle-deflate-b64', 'auto'] as const) {
    it(`roundtrip exacto bit a bit (${codec})`, async () => {
      const enc = await encodeArray(values, codec);
      if (codec !== 'auto') expect(enc.codec).toBe(codec);
      expect(bitsEqual(await decodeArray(enc), values)).toBe(true);
    });
  }

  it('comprime los perfiles reales del TP (todas las columnas) a menos de la mitad', async () => {
    const lines = tpCsv.trim().split(/\r?\n/);
    const header = lines[0]!.split(',');
    let plain = 0;
    let packed = 0;
    for (let j = 0; j < header.length; j++) {
      if (header[j] === 'ZONA') continue;
      const col = Float64Array.from(lines.slice(1), (l) => {
        const v = l.split(',')[j];
        return v === '' || v === undefined ? NaN : Number(v);
      });
      plain += (await encodeArray(col, 'f64le-b64')).data.length;
      const enc = await encodeArray(col, 'auto');
      expect(bitsEqual(await decodeArray(enc), col)).toBe(true);
      packed += enc.data.length;
    }
    expect(lines.length - 1).toBe(5810);
    expect(packed / plain).toBeLessThan(0.5);
  });

  it('roundtrip de arrays vacíos', async () => {
    expect((await decodeArray(await encodeArray(new Float64Array(0)))).length).toBe(0);
  });
});

describe('guardar / abrir proyecto', () => {
  it('roundtrip completo: pozo, curvas, zonas, parámetros y snapshots', async () => {
    const demo = syntheticWell();
    let p = addWell(createProject('TP'), demo.well, demo.zones);
    p = setParam(p, demo.well.id, 'grClean', 25);
    p = setParam(p, demo.well.id, 'grShale', 140, demo.zones[1]!.id);
    p = createSnapshot(p, demo.well.id, 'Caso base', { createdAt: '2026-10-09T00:00:00.000Z', id: 'snap-1' }).project;
    p = setStepMark(setStepMark(p, demo.well.id, 'qc', 'done'), demo.well.id, 'porosity', 'skipped');

    const text = await serializeProject(p, { savedAt: '2026-10-09T00:00:00.000Z' });
    const back = await deserializeProject(text);

    expect(back.name).toBe('TP');
    expect(back.activeWellId).toBe(p.activeWellId);
    expect(back.snapshots).toEqual(p.snapshots);
    const [a, b] = [p.wells[0]!, back.wells[0]!];
    expect(b.interpretation).toEqual(a.interpretation);
    expect(b.progress).toEqual({ marks: { qc: 'done', porosity: 'skipped' } });
    expect(b.well.header).toEqual(a.well.header);
    expect(b.well.depth.step).toBeCloseTo(a.well.depth.step!, 12);
    expect(bitsEqual(b.well.depth.values, a.well.depth.values)).toBe(true);
    expect(b.well.curves.map((c) => [c.id, c.role, c.unit, c.origin])).toEqual(a.well.curves.map((c) => [c.id, c.role, c.unit, c.origin]));
    for (let i = 0; i < a.well.curves.length; i++) expect(bitsEqual(b.well.curves[i]!.data, a.well.curves[i]!.data)).toBe(true);
    // re-serializar da exactamente el mismo texto
    expect(await serializeProject(back, { savedAt: '2026-10-09T00:00:00.000Z' })).toBe(text);
  });

  it('roundtrip con el codec sin compresión', async () => {
    const w = createWell({ id: 'w', name: 'W', depth: Float64Array.from([1, 2, 3]), curves: [{ id: 'X', mnemonic: 'X', role: null, unit: 'unitless', data: Float64Array.from([1, NaN, 3]), origin: { kind: 'measured', source: 'a.las' } }] });
    const p = addWell(createProject(), w, [zone('a', 1, 2)]);
    const back = await deserializeProject(await serializeProject(p, { codec: 'f64le-b64' }));
    expect(bitsEqual(back.wells[0]!.well.curves[0]!.data, w.curves[0]!.data)).toBe(true);
    expect(back.wells[0]!.well.curves[0]!.origin).toEqual({ kind: 'measured', source: 'a.las' });
  });

  it('migra un archivo v1 (sin progreso del flujo guiado) a la versión actual', async () => {
    const demo = syntheticWell();
    const p = setStepMark(addWell(createProject('Viejo'), demo.well, demo.zones), demo.well.id, 'qc', 'done');
    const file = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    expect(file.version).toBe(2);
    // Así eran los archivos de la fase 1–2.
    file.version = 1;
    for (const w of file.project.wells) delete w.progress;
    const back = await deserializeProject(JSON.stringify(file));
    expect(back.wells[0]!.progress).toEqual({ marks: {} });
    expect(back.wells[0]!.interpretation).toEqual(p.wells[0]!.interpretation);
  });

  it('rechaza archivos que no son proyectos o de una versión futura', async () => {
    await expect(deserializeProject('hola')).rejects.toThrow(/no es JSON/);
    await expect(deserializeProject('{"format":"otro"}')).rejects.toThrow(/no es un proyecto/);
    await expect(deserializeProject(JSON.stringify({ format: 'pozo-proyecto', version: 99, project: { wells: [] } }))).rejects.toThrow(/versión más nueva/);
  });
});
