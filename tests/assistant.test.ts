import { beforeAll, describe, expect, it } from 'vitest';
import tp from '../datos/pozo_tp_perfiles.csv?raw';
import { buildEquationEntries } from '../src/app/ecuaciones/model';
import { activeOutput, computeOnce } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { ReadonlyTableValue } from '../src/core/module';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import { answerQuestion, type AssistantContext } from '../src/app/assistant/model';
import { formatNumber } from '../src/ui/format';

let context: AssistantContext;
beforeAll(() => {
  const { well, zones } = readWellFile(tp, 'pozo_tp_perfiles.csv');
  const result = computeOnce(registry, { id: well.id, depth: well.depth.values, curves: well.curves }, emptyInterpretation(zones));
  context = {
    zones,
    result,
    equations: buildEquationEntries(registry),
    commands: [
      { id: 'dock:crossplot', title: 'Abrir la pestaña Crossplot', group: 'Paneles', run() {} },
      { id: 'file:save', title: 'Guardar el proyecto', group: 'Proyecto', run() {} },
    ],
    nextStep: { id: 'quality', title: 'Control de calidad' },
  };
});

describe('guion de 20 preguntas de defensa sobre el TP', () => {
  it.each([
    ['Mostrame Sw en la zona D', /localizar SW/, undefined, 'Mostrar SW en la zona D'],
    ['Quiero ver Rt en zona B', /localizar RT/, undefined, 'Mostrar RT en la zona B'],
    ['Ver porosidad efectiva en la zona A', /localizar PHIE/, undefined, 'Mostrar PHIE en la zona A'],
    ['¿Por qué la zona C tiene poco pay?', /Reservorio sin dato para clasificar pay/, 'ZONE_SUMMARY', 'Revisar cutoffs'],
    ['¿Cuánto pay hay en la zona D?', /Pay neto: [\d.,]+ m/, 'ZONE_SUMMARY', 'Abrir Sumario'],
    ['¿Cuál es el espesor bruto de la zona A?', /Espesor bruto: [\d.,]+ m/, 'ZONE_SUMMARY', 'Abrir Sumario'],
    ['Reservorio neto de la zona B', /Reservorio neto: [\d.,]+ m/, 'ZONE_SUMMARY', 'Abrir Sumario'],
    ['Arena neta del pozo', /Arena neta: [\d.,]+ m/, 'ZONE_SUMMARY', 'Abrir Sumario'],
    ['N/G de pay total', /N\/G de pay: [\d.,]+ v\/v/, 'ZONE_SUMMARY', 'Abrir Sumario'],
    ['Porosidad del pay total', /φ media del pay: [\d.,]+ v\/v/, 'ZONE_SUMMARY', 'Abrir Sumario'],
    ['Sw del pay total', /Sw media del pay: [\d.,]+ v\/v/, 'ZONE_SUMMARY', 'Abrir Sumario'],
    ['¿Qué pasa si muevo el cutoff de Sw a 65 % en la zona D?', /punto evaluado más próximo.*0,650 v\/v/, 'CUTOFF_SWEEP', 'Revisar cutoffs'],
    ['Sensibilidad del cutoff de φ a 0,15 en zona E', /punto evaluado más próximo/, 'CUTOFF_SWEEP', 'Revisar cutoffs'],
    ['¿Qué pasa si pongo el cutoff de Vsh a 0,35?', /aplicado a todas las zonas/, 'CUTOFF_SWEEP', 'Revisar cutoffs'],
    ['¿Dónde hay hidrocarburos?', /Fluido probable.*confianza/, 'WELL_READING', 'Revisar el paso Sumario'],
    ['Lectura automática del pozo', /\S+/, 'WELL_READING_GENERAL', 'Revisar el paso Sumario'],
    ['¿Cómo funciona Archie?', /arenas limpias/, 'Ecuaciones', /Archie/],
    ['¿Qué es Simandoux?', /arcillos/i, 'Ecuaciones', /Simandoux/],
    ['¿Qué avisos hay?', /\S+/, 'Diagnósticos del motor', 'Abrir Avisos'],
    ['¿Qué sigue?', /Control de calidad/, undefined, 'Abrir Control de calidad'],
  ] as const)('%s', (question, expected, source, action) => {
    const answer = answerQuestion(question, context);
    expect(answer.text).toMatch(expected);
    expect(answer.actions.some(item => typeof action === 'string' ? item.label === action : action.test(item.label))).toBe(true);
    if (source) expect(answer.sources.join(' ')).toContain(source);
    else expect(answer.sources).toEqual([]);
  });
});

it('reproduce la cifra del sumario de la zona y muestra el umbral efectivamente evaluado', () => {
  const table = activeOutput(context.result!.outputs, 'ZONE_SUMMARY')!.value as ReadonlyTableValue;
  const row = table.rows.find(r => r.zone === 'D')!;
  const measured = formatNumber(Number(row.netPay), { digits: 2 });
  expect(answerQuestion('Pay neto en zona D', context).text).toContain(`${measured} m`);
  const sweep = activeOutput(context.result!.outputs, 'CUTOFF_SWEEP')!.value as ReadonlyTableValue;
  const id = context.zones.find(zone => zone.name === 'D')!.id;
  const point = sweep.rows.find(r => r.zoneId === id && r.variable === 'sw' && Math.abs(Number(r.threshold) - 0.65) < 1e-12)!;
  const answer = answerQuestion('Qué pasa si pongo el cutoff de Sw a 64,9% en zona D', context);
  expect(answer.text).toContain(`0,650 v/v, da ${formatNumber(Number(point.netPay), { digits: 2 })} m`);
});

it('distingue resultados en espera, zonas ausentes o ambiguas y parámetros fuera de rango', () => {
  const pending = answerQuestion('Pay neto en zona D', { ...context, result: null });
  expect(pending.text).toContain('resultados vigentes');
  expect(pending.sources).toEqual([]);
  expect(answerQuestion('Mostrar SW en zona Z', context).text).toContain('No encontré');
  const zone = context.zones.find(z => z.name === 'D')!;
  const duplicate = { ...context, zones: [...context.zones, { ...zone, id: 'other' }] };
  expect(answerQuestion('Pay neto en zona D', duplicate).text).toContain('más de una zona');
  expect(answerQuestion('Qué pasa si pongo el cutoff de SW a 120 % en zona D', context).text).toContain('Indicá un umbral');
});

it('sugiere navegación al desconocer una consulta y no ofrece comandos de edición o guardado', () => {
  expect(answerQuestion('Quiero abrir el crossplot', context)).toMatchObject({
    text: expect.stringContaining('No reconocí'),
    actions: [{ kind: 'command', id: 'dock:crossplot' }],
  });
  expect(answerQuestion('Guardá el proyecto', context).actions).toEqual([]);
});

it('mantiene el renglón de una zona al reutilizarse el cálculo y rotula el total de zonas', () => {
  const zones = context.zones.map(z => z.name === 'D' ? { ...z, base: z.base - 0.001 } : z);
  expect(answerQuestion('Pay en zona D', { ...context, zones })).toEqual(answerQuestion('Pay en zona D', context));
  expect(answerQuestion('Pay total', context).text).toMatch(/^Total de las zonas\./);
  expect(answerQuestion('Qué pasa si pongo el cutoff de Sw a 65 %', context).text).toMatch(/^Total de las zonas\./);
});

it('resuelve un ID exacto antes de buscar menciones del método en otras fichas', () => {
  const answer = answerQuestion('Explicame sw-archie', context);
  expect(answer.actions).toEqual([expect.objectContaining({ kind: 'equation', id: 'sw-archie' })]);
  expect(answer.text).toMatch(/arenas limpias/);
});
