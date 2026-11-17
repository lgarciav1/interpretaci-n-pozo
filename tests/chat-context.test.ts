import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { chatContextText, groupWarnings, isGenericWarning, prioritizeWarnings, warningSource, CHAT_CONTEXT_MAX_CHARS } from '../src/app/chatContext/chatContext';
import { buildReportModel, type ReportModel } from '../src/app/report/report';
import type { ClientResult } from '../src/core/engine/client';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { engineContext } from '../src/core/engine/context';
import { emptyInterpretation } from '../src/core/interpretation';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import { syntheticWell } from '../src/app/demo/syntheticWell';

function tp() {
  const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const interpretation = { ...emptyInterpretation(), zones };
  const engine = new Engine(registry);
  engine.setWell(toEngineWell(well));
  const result: ClientResult = { ...engine.run(interpretation), context: engineContext(toEngineWell(well), interpretation), wellId: well.id, seq: 1, gen: 1, roundTripMs: 0, coalesced: 0 };
  return { well, interpretation, result, zones };
}

describe('contexto para un chat', () => {
  it('arma el texto del pozo del TP dentro del tope y sin restos de formato', () => {
    const { well, interpretation, result, zones } = tp();
    const model = buildReportModel(well, interpretation, result);
    const out = chatContextText(model);
    expect(out.length).toBe(out.text.length);
    expect(out.length).toBeLessThanOrEqual(CHAT_CONTEXT_MAX_CHARS);
    expect(zones.map((z) => z.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
    for (const z of zones) expect(out.text).toContain(`Zona ${z.name}:`);
    expect(out.text).toContain('## Sumario por zona');
    expect(out.text).toContain('## Métodos');
    expect(out.text).toContain('## Parámetros efectivos');
    expect(out.text).toContain(model.parameters[0]!.module);
    expect(out.text).toContain(model.methods[0]!.port);
    expect(out.text).toContain(well.name);
    expect(out.text).not.toMatch(/<\/?[a-z][^>]*>/i); // sin etiquetas HTML (un «>» de un aviso de calidad es texto)
    expect(out.text).not.toContain('undefined');
    expect(out.text).not.toContain('NaN');
  });

  it('recorta por prioridad sin cortar líneas cuando hay demasiados avisos', () => {
    const { well, interpretation, result } = tp();
    const base = buildReportModel(well, interpretation, result);
    const model: ReportModel = { ...base, warnings: Array.from({ length: 500 }, (_, i) => `Aviso ${i} ${'texto muy largo '.repeat(40)}`) };
    const out = chatContextText(model);
    expect(out.truncated).toBe(true);
    expect(out.length).toBeLessThanOrEqual(CHAT_CONTEXT_MAX_CHARS);
    const lines = out.text.split('\n');
    expect(lines[lines.length - 1]).toMatch(/^\[Recortado: se omitieron .*\d+ avisos/);
    for (const z of base.zones) expect(out.text).toContain(`Zona ${z.name}:`);
    expect(out.text).toContain('## Sumario por zona');
    expect(out.text).toContain('## Parámetros efectivos');
    expect(out.text.split('\n').filter((l) => l.startsWith('- Aviso ')).every((l) => l.endsWith('…'))).toBe(true);
  });

  it('con tope muy chico conserva líneas enteras y marca el recorte', () => {
    const { well, interpretation, result } = tp();
    const out = chatContextText(buildReportModel(well, interpretation, result), { maxChars: 1500 });
    expect(out.truncated).toBe(true);
    expect(out.length).toBeLessThanOrEqual(1500);
    expect(out.text).toContain('[Recortado:');
  });

  it('sin resultado vigente lo dice y sigue siendo un texto válido', () => {
    const { well, interpretation } = tp();
    const out = chatContextText(buildReportModel(well, interpretation, null));
    expect(out.text).toContain('No hay resultados vigentes');
    expect(out.text).toContain('Zona A');
    expect(out.text).not.toContain('undefined');
    expect(out.text).not.toContain('NaN');
    expect(out.length).toBeLessThanOrEqual(CHAT_CONTEXT_MAX_CHARS);
  });

  it('muestra el valor global y solo las zonas que difieren', () => {
    const { well, zones } = syntheticWell(300);
    const interpretation = { ...emptyInterpretation(), zones };
    interpretation.params.global.m = 2.1;
    interpretation.params.zones[zones[0]!.id] = { m: 2.6 };
    const engine = new Engine(registry);
    engine.setWell(toEngineWell(well));
    const result: ClientResult = { ...engine.run(interpretation), context: engineContext(toEngineWell(well), interpretation), wellId: well.id, seq: 1, gen: 1, roundTripMs: 0, coalesced: 0 };
    const out = chatContextText(buildReportModel(well, interpretation, result), { maxChars: 100000 });
    expect(out.text).toContain(`Exponente de cementación (m) 2,1 (zona ${zones[0]!.name}: 2,6)`);
    expect(out.text).not.toContain(`zona ${zones[1]!.name}: 2,1`);
  });

  it('agrupa avisos iguales salvo la zona y deja individuales los que difieren', () => {
    const out = groupWarnings([
      'Advertencia · Rw desde el SP: Rw desde el SP: en la zona A, el SP no tiene datos: revisá las lecturas.',
      'Advertencia · Rw desde el SP: Rw desde el SP: en la zona C, el SP no tiene datos: revisá las lecturas.',
      'Advertencia · Rw desde el SP: Rw desde el SP: en la zona E, el SP no tiene datos: revisá las lecturas.',
      'Advertencia · Swi: En la zona B 2 muestras se recortan.',
      'Advertencia · Swi: En la zona D 1 muestras se recortan.',
      'Información · Otro: sin mención de zona.',
    ], ['A', 'B', 'C', 'D', 'E']);
    const long = groupWarnings([`Advertencia · M: en la zona A, ${'texto '.repeat(100)}fin`, `Advertencia · M: en la zona B, ${'texto '.repeat(100)}fin`], ['A', 'B'], 100);
    expect(long).toHaveLength(1);
    expect(long[0]!.length).toBeLessThan(130);
    expect(long[0]).toMatch(/… — zonas A, B$/);
    expect(out).toEqual([
      'Advertencia · Rw desde el SP: el SP no tiene datos: revisá las lecturas — zonas A, C, E',
      'Advertencia · Swi: En la zona B 2 muestras se recortan.',
      'Advertencia · Swi: En la zona D 1 muestras se recortan.',
      'Información · Otro: sin mención de zona.',
    ]);
  });

  it('el pozo del TP: curvas medidas en una línea, avisos genéricos solo en la introducción y orden por gravedad', () => {
    const { well, interpretation, result } = tp();
    const model = buildReportModel(well, interpretation, result);
    const out = chatContextText(model);
    expect(model.warnings.some(isGenericWarning)).toBe(true);
    const avisos = out.text.slice(out.text.indexOf('## Avisos'));
    expect(avisos.split('\n').some((l) => isGenericWarning(l.replace(/^- /, '')))).toBe(false);
    expect(out.text.match(/^- Curvas medidas usadas/gm)?.length).toBe(1);
    expect(out.text).toMatch(/Curvas medidas usadas \(curva→puerto\): .*ZDEN→RHOB/);
    expect(out.text).toMatch(/Rw desde el SP: el SP no tiene datos.*— zonas A, C, E/);
    expect(out.text).not.toMatch(/- ZDEN → RHOB/);
  });

  it('recorta avisos solo después de reducir los parámetros y deja los errores para el final', () => {
    const { well, interpretation, result } = tp();
    const base = buildReportModel(well, interpretation, result);
    const model: ReportModel = { ...base, warnings: ['Error · X: falla grave', ...Array.from({ length: 80 }, (_, i) => `Información · M${i}: dato ${i} ${'largo '.repeat(30)}`)] };
    const out = chatContextText(model, { maxChars: 10500 });
    expect(out.truncated).toBe(true);
    expect(out.text).toContain('Error · X: falla grave');
    expect(out.text).toContain('parámetros');
    expect(out.length).toBeLessThanOrEqual(10500);
  });
  it('sin resultado vigente no se marca como recortado ni dice que omitió parámetros', () => {
    const { well, interpretation } = tp();
    const out = chatContextText(buildReportModel(well, interpretation, null));
    expect(out.truncated).toBe(false);
    expect(out.text).not.toContain('[Recortado');
  });

  it('con un tope menor que el texto mínimo nunca lo pasa ni vuelve a meter líneas', () => {
    const { well, interpretation, result } = tp();
    const model = buildReportModel(well, interpretation, result);
    for (const max of [700, 300, 120, 40]) {
      const out = chatContextText(model, { maxChars: max });
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out.truncated).toBe(true);
    }
    const out = chatContextText(model, { maxChars: 700 });
    expect(out.text).toMatch(/\[Recortado: .*los \d+ avisos.*líneas finales/);
  });

  it('agrupa por zona con nombres con caracteres de regex y no confunde palabras que terminan en «la»', () => {
    const names = ['B (sup)', 'C.1', 'A', 'A+'];
    const out = groupWarnings([
      'Advertencia · M: en la zona B (sup), falta el SP.',
      'Advertencia · M: en la zona C.1, falta el SP.',
      'Advertencia · M: en la zona A+, falta el SP.',
      'Información · N: escala zona A, nada.',
      'Información · N: escala zona C.1, nada.',
    ], names);
    expect(out).toEqual([
      'Advertencia · M: falta el SP — zonas B (sup), C.1, A+',
      'Información · N: escala zona A, nada.',
      'Información · N: escala zona C.1, nada.',
    ]);
    expect(groupWarnings(['X: en la zona A, uno.', 'X: en la zona B, uno.'], ['', 'A'])).toEqual(['X: en la zona A, uno.', 'X: en la zona B, uno.']);
  });
  it('prioriza la calidad de registros y alterna entre módulos para que uno solo no ocupe el cupo', () => {
    const inv = (z: string) => `Advertencia · Invasión: en la zona ${z}, ${z.length * 7} % sin diámetro.`;
    const order = prioritizeWarnings([inv('A'), inv('BB'), inv('CCC'), 'Información · Lectura: nota.', 'Calidad · ZDEN: fuera de rango.', 'Advertencia · Swi: recorte.', 'Control de calidad de registros: hay advertencias.']);
    expect(order.slice(0, 4)).toEqual([inv('A'), 'Calidad · ZDEN: fuera de rango.', 'Advertencia · Swi: recorte.', 'Control de calidad de registros: hay advertencias.']);
    expect(order.at(-1)).toBe('Información · Lectura: nota.');
    expect(warningSource(inv('A'))).toBe('Invasión');
    const { well, interpretation, result } = tp();
    const text = chatContextText(buildReportModel(well, interpretation, result)).text;
    expect(text).toContain('Control de calidad de registros');
  });
});
