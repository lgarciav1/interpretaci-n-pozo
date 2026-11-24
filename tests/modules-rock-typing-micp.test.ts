/**
 * Curvas MICP del TP en el panel «Tipos de roca» (docs/decisiones de MICP del TP): carga con una receta (sin
 * duplicar, un Ctrl+Z), curvas medidas en vez del ejemplo de libro y tabla R35 medido contra Winland.
 * Valores de referencia: tests/petro-micp.test.ts (numpy).
 */
import { describe, expect, it } from 'vitest';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { addWell, createProject, getWellEntry } from '../src/core/state/project';
import { createWell } from '../src/core/well';
import { capillaryCurves, examplePcCurves, measuredR35Rows } from '../src/modules/rock-typing/model';
import { addTpMicp, hasTpMicp, isTpMicpSet, TP_MICP_SAMPLES_COUNT, tpMicpSet } from '../src/modules/rock-typing/tp';
import { PORT_CLASSES } from '../src/petro/rockTyping';

const W = 'w';
const project = () => addWell(createProject(), createWell({ id: W, name: 'Pozo TP', depth: Float64Array.from({ length: 10 }, (_, i) => 7800 + i), curves: [], pointSets: [] }), []);

describe('cargar las curvas MICP del TP', () => {
  it('una receta agrega el conjunto; repetirla no lo duplica; Ctrl+Z vuelve al pozo sin curvas', () => {
    const p0 = project();
    expect(hasTpMicp(p0, W)).toBe(false);
    const p1 = addTpMicp(p0, W, tpMicpSet('micp-1'));
    expect(getWellEntry(p1, W).well.pointSets.filter(isTpMicpSet)).toHaveLength(1);
    expect(addTpMicp(p1, W, tpMicpSet('micp-2'))).toBe(p1);
    const back = undo(recordChange(emptyHistory(), p0, 'Cargar curvas MICP del TP', 0), p1)!;
    expect(hasTpMicp(back.project, W)).toBe(false);
  });

  it('con el conjunto del TP las curvas son medidas (8, no el ejemplo de libro)', () => {
    const { curves, book } = capillaryCurves([tpMicpSet('m')]);
    expect(book).toBe(false);
    expect(curves).toHaveLength(TP_MICP_SAMPLES_COUNT);
    expect(TP_MICP_SAMPLES_COUNT).toBe(8);
    expect(curves.every((c) => c.source === 'measured')).toBe(true);
  });
});

describe('R35 medido contra Winland por muestra', () => {
  const rows = measuredR35Rows(capillaryCurves([tpMicpSet('m')]).curves);
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));

  it('una fila por curva medida, con k (mD) y φ (v/v) de la muestra; las de libro no entran', () => {
    expect(rows.map((r) => r.label).sort()).toEqual(['1-2', '1-2L', '1-32', '1-33', '1-33CK', '2-15', '2-17', '2-6L']);
    expect(by['1-32']).toMatchObject({ k: 92.4 });
    expect(by['1-32']!.phi).toBeCloseTo(0.232053, 6);
    expect(measuredR35Rows(examplePcCurves())).toEqual([]);
  });

  it('R35 medido (numpy) y diferencia: 1-32 con Winland +35 %, el resto dentro del 10 %', () => {
    expect(by['1-32']!.measured).toBeCloseTo(3.7917, 3);
    expect(by['1-32']!.winland).toBeCloseTo(5.1044, 3);
    expect(by['1-32']!.diffPct).toBeCloseTo(100 * (5.1044 / 3.7917 - 1), 1);
    expect(by['2-6L']!.measured).toBeCloseTo(0.8248, 3);
    for (const r of rows) if (r.label !== '1-32') expect(Math.abs(r.diffPct)).toBeLessThan(10);
  });

  it('clases de garganta: medida y estimada; 1-32 es macro con las dos, 2-6L meso', () => {
    const name = (i: number) => PORT_CLASSES[i]!.id;
    expect(name(by['1-32']!.classMeasured)).toBe('macro');
    expect(name(by['1-32']!.classWinland)).toBe('macro');
    expect(name(by['2-6L']!.classMeasured)).toBe('meso');
    for (const r of rows) expect(r.classMeasured).toBeGreaterThanOrEqual(0);
  });
});
