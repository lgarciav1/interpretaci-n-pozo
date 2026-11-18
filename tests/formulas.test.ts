import { describe, expect, it } from 'vitest';
import tpCsv from '../datos/pozo_tp_perfiles.csv?raw';
import { Engine, activeOutput, computeOnce } from '../src/core/engine/engine';
import { withCurveFormula } from '../src/core/engine/validateFormula';
import { formulaModuleId } from '../src/core/formulas';
import { emptyInterpretation, sameEngineInputs } from '../src/core/interpretation';
import { createRegistry } from '../src/core/registry';
import { addWell, createProject, updateInterpretation } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createWell } from '../src/core/well';
import { createSnapshot } from '../src/core/state/snapshots';
import { enableProjectInputRevisions } from "../src/core/state/inputRevisions";
import { readWellFile } from '../src/io';
import { buildExportColumns, writeLas } from '../src/io/export';
import { registry } from '../src/modules';
import { parseFormula } from '../src/petro/formula';
import { curve, well } from './helpers';

describe('lenguaje de fórmulas', () => {
  it('respeta precedencia, asociación, signos, exponentes decimales y funciones', () => {
    const expression = parseFormula('max(-2, log(exp(3))) + min(2, +.2e1)*4 - 8/2/2');
    expect(expression.evaluate(() => undefined)).toBeCloseTo(9);
    const references = parseFormula('at90/@rt + AT90');
    expect(references.references).toEqual(['AT90', '@RT']);
    expect(references.evaluate(ref => ref === 'AT90' ? 6 : 2)).toBe(9);
  });

  it.each(['', '2(3)', 'log(1,2)', 'min(1)', 'foo(1)', 'a.b', '1e', '1e999', 'a[1]', '2 ** 3'])('rechaza %j con su posición', text => {
    expect(() => parseFormula(text)).toThrow(/Sintaxis, columna \d+/);
  });

  it.each(['X', '1/0', 'log(0)', '1/exp(999)', 'min(1, exp(999))'])('produce un nulo de muestra en %s', text => {
    expect(parseFormula(text).evaluate(() => undefined)).toBeNaN();
    expect(parseFormula(text).evaluate(() => Infinity)).toBeNaN();
  });
});

describe('fórmulas en el grafo', () => {
  const base = createRegistry([]);
  const w = well([curve('A', 'NPHI', [20, NaN, 40], '%'), curve('B', 'NPHI', [0.1, 0.2, 0.3])]);
  const add = (i: ReturnType<typeof emptyInterpretation>, mnemonic: string, expression: string) =>
    withCurveFormula(base, w.curves, i, { mnemonic, expression, unit: 'unitless' });

  it('conserva datos nativos por mnemónico y actualiza la cadena al cambiar una fórmula o una fuente', () => {
    const engine = new Engine(base);
    engine.setWell(w);
    const start = emptyInterpretation();
    const initial = add(add(start, 'F_1__', 'A + @NPHI'), 'F_2', 'F_1__*2');
    expect(sameEngineInputs(start, initial)).toBe(false);
    expect(activeOutput(engine.run(initial).outputs, 'F_2')?.value).toEqual(Float64Array.of(40.4, NaN, 80.8));
    expect(engine.run(initial).stats.reused).toContain(formulaModuleId('F_2'));
    const selected = { ...initial, sources: { NPHI: { kind: 'curve' as const, curveId: 'B' } } };
    expect(activeOutput(engine.run(selected).outputs, 'F_2')?.value).toEqual(Float64Array.of(40.2, NaN, 80.6));
    expect(activeOutput(engine.run(add(selected, 'F_1__', 'A - @NPHI')).outputs, 'F_2')?.value).toEqual(Float64Array.of(39.8, NaN, 79.4));
  });

  it('invalida la caché cuando renombrar un mnemónico cambia la unidad de una referencia', () => {
    const before = well([curve('NPHI', 'NPHI', [20], '%')]);
    const engine = new Engine(base);
    engine.setWell(before);
    const i = withCurveFormula(base, before.curves, emptyInterpretation(), { mnemonic: 'RESULTADO', expression: 'NPHI', unit: 'unitless' });
    expect(activeOutput(engine.run(i).outputs, 'RESULTADO')?.value).toEqual(Float64Array.of(20));
    engine.updateCurves([{ ...before.curves[0]!, mnemonic: 'OTRO' }]);
    expect(activeOutput(engine.run(i).outputs, 'RESULTADO')?.value).toEqual(Float64Array.of(0.2));
  });

  it('rechaza ciclos directos e indirectos, referencias ausentes y mnemónicos ambiguos', () => {
    const start = emptyInterpretation();
    const good = add(add(start, 'F1', 'A+1'), 'F2', '@F1+1');
    expect(() => add(good, 'F1', 'F2')).toThrow(/ciclo.*F1.*F2|ciclo.*F2.*F1/);
    expect(() => add(good, 'F3', 'F3')).toThrow(/ciclo/);
    expect(() => add(good, 'F3', 'NO_EXISTE')).toThrow(/No existe la referencia/);
    expect(() => withCurveFormula(base, [...w.curves, { ...w.curves[1]!, mnemonic: 'a' }], good,
      { mnemonic: 'F3', expression: 'A', unit: 'unitless' })).toThrow(/ambigua/);
    expect(good.formulas?.map(f => f.expression)).toEqual(['A+1', '@F1+1']);
  });
});

it('contrasta ambas fórmulas del TP y exporta el comentario LAS', () => {
  const { well: tp, zones } = readWellFile(tpCsv, 'pozo_tp_perfiles.csv');
  const input = { id: tp.id, curves: tp.curves, depth: tp.depth.values };
  const initial = emptyInterpretation(zones);
  const base = computeOnce(registry, input, initial);
  const ratio = withCurveFormula(registry, input.curves, initial, { mnemonic: 'REL_RT', expression: 'AT90/AT10', unit: 'unitless' });
  const formulas = withCurveFormula(registry, input.curves, ratio, { mnemonic: 'PHI_HC', expression: 'PHIE*(1-SW)', unit: 'v/v' });
  const result = computeOnce(registry, input, formulas);
  const data = (outputs: typeof result.outputs, port: string) => activeOutput(outputs, port)!.value as Float64Array;
  const [phie, sw] = [data(base.outputs, 'PHIE'), data(base.outputs, 'SW')];
  const columns = tpCsv.trim().split(/\r?\n/);
  const header = columns[0]!.split(',');
  for (const i of [1, 598, 1080, 2000, 3271, 5154, 5809]) {
    const raw = columns[i + 1]!.split(',');
    const at90 = Number(raw[header.indexOf('AT90')]);
    const at10 = Number(raw[header.indexOf('AT10')]);
    expect(data(result.outputs, 'REL_RT')[i]).toBeCloseTo(at90 / at10, 12);
    expect(data(result.outputs, 'PHI_HC')[i]).toBeCloseTo(phie[i]! - sw[i]! * phie[i]!, 12);
  }
  const las = writeLas({ wellName: tp.name, depth: input.depth, columns: buildExportColumns(tp, result.outputs) });
  expect(las).toMatch(/^REL_RT\.\s+: Fórmula: AT90\/AT10$/m);
  expect(las).toMatch(/^PHI_HC\.v\/v\s+: Fórmula: PHIE\*\(1-SW\)$/m);
});

it('conserva la fórmula y su snapshot al reabrir v6 y v7', async () => {
  const base = createRegistry([]);
  const raw = well([curve('MEDIDA', null, [1, 3, 5])]);
  const input = createWell({
    id: raw.id, name: 'F06', depth: raw.depth,
    curves: raw.curves.map(c => ({ ...c, origin: { kind: 'measured' as const, source: 'prueba.csv' } })),
  });
  const project = addWell(createProject('F06'), input);
  const saved = updateInterpretation(project, input.id, i =>
    withCurveFormula(base, input.curves, i, { mnemonic: 'RESULTADO', expression: 'MEDIDA*2', unit: 'unitless' }));
  const snapshot = createSnapshot(saved, input.id, 'F06').project;
  const expected = saved.wells[0]!.interpretation.formulas;
  for (const version of [6, 7] as const) {
    const source = version === 7 ? enableProjectInputRevisions(snapshot) : snapshot;
    const reopened = await deserializeProject(await serializeProject(source, { version }));
    expect(reopened.wells[0]!.interpretation.formulas).toEqual(expected);
    expect(reopened.snapshots[0]!.interpretation.formulas).toEqual(expected);
    const active = reopened.wells[0]!;
    const result = computeOnce(base, { id: active.well.id, depth: active.well.depth.values, curves: active.well.curves }, active.interpretation);
    expect(activeOutput(result.outputs, 'RESULTADO')?.value).toEqual(Float64Array.of(2, 6, 10));
  }
});
