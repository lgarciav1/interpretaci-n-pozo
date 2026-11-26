/**
 * G07 — Módulo `movable-hc`, plantilla de crossplot «Movilidad Rt–Rxo» (arrastre + un solo commit deshacible)
 * y paridad exacta en el pozo del TP (docs/decisiones/0091).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import csv from '../datos/pozo_tp_perfiles.csv?raw';
import { commitPlotParams } from '../src/app/plots/connect';
import { historyClock, useProject } from '../src/app/store/project';
import { activeOutput, computeOnce } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import { CROSSPLOT_TEMPLATES, sanitizeCrossplot } from '../src/core/plots';
import { addWell, createProject, getWellEntry } from '../src/core/state/project';
import { createWell, type Curve } from '../src/core/well';
import { readWellFile } from '../src/io';
import { MODULES, registry } from '../src/modules';
import movableHc, { MOVABLE_SUMMARY } from '../src/modules/movable-hc';
import { DEFAULT_RMF_OVER_RW } from '../src/petro/movability';
import { crossplotTemplatePatch } from '../src/plots/crossplot/applyTemplate';
import { rmfOverRwFromPoint, rtRxoWaterHandle } from '../src/plots/crossplot/drag';
import { CROSSPLOT_TEMPLATE_DEFS, RT_RXO_MHI_LINES, rtRxoLine, templateDef } from '../src/plots/crossplot/templates';
import { normalizeParam, nudgeParam, paramChangeLabel, paramWrite, plotParamValue, PLOT_PARAMS } from '../src/plots/params';
import type { SeriesContext } from '../src/plots/trend/series';
import { computeStack } from '../src/viewer/stack';
import { VOLUMETRIC_STACK } from '../src/viewer/templates';

function curve(id: string, role: string, unit: string, values: number[]): Curve {
  return { id, mnemonic: id, role, unit, data: Float64Array.from(values), origin: { kind: 'measured' } };
}

describe('G07 — módulo movable-hc: contrato, cadena con el motor y paridad TP', () => {
  it('está registrado en saturation, declara roles MOS/SHR/MHI, comparte a/m/n/rmf/tRmf y documenta ecuaciones', () => {
    const ids = MODULES.map((m) => m.id);
    expect(ids).toContain('movable-hc');
    expect(registry.get('movable-hc')).toBe(movableHc);
    expect(registry.warnings).toEqual([]);
    expect(movableHc.category).toBe('saturation');
    expect(movableHc.workspace).toBe('petrophysics');
    expect(registry.roles.get('SXO')?.origin).toBe('computed');
    expect(registry.roles.get('MOS')?.unit).toBe('v/v');
    expect(registry.roles.get('SHR')?.unit).toBe('v/v');
    expect(registry.roles.get('MHI')?.unit).toBe('unitless');
    expect(movableHc.docs.equations.length).toBeGreaterThanOrEqual(3);
    expect(movableHc.docs.references.length).toBeGreaterThanOrEqual(3);
  });

  it('no altera ningún decimal de VSH, PHIE, SW, NET_RES, NET_PAY ni ZONE_SUMMARY en el pozo del TP', () => {
    const { well, zones } = readWellFile(csv, 'pozo_tp_perfiles.csv');
    const wellData = { id: well.id, depth: well.depth.values, curves: well.curves };
    const base = emptyInterpretation(zones);

    const withG07 = computeOnce(registry, wellData, base);
    const withoutG07 = computeOnce(registry, wellData, { ...base, disabled: ['movable-hc'] });

    expect(withG07.sources['RXO']).toEqual({ kind: 'module', moduleId: 'invasion-step' });
    expect(withG07.sources['SXO']).toEqual({ kind: 'module', moduleId: 'movable-hc' });
    expect(withG07.sources['MOS']).toEqual({ kind: 'module', moduleId: 'movable-hc' });
    expect(withG07.sources['SHR']).toEqual({ kind: 'module', moduleId: 'movable-hc' });
    expect(withG07.sources['MHI']).toEqual({ kind: 'module', moduleId: 'movable-hc' });

    for (const port of ['VSH', 'PHIE', 'SW', 'NET_RES', 'NET_PAY']) {
      const a = activeOutput(withG07.outputs, port)?.value as Float64Array;
      const b = activeOutput(withoutG07.outputs, port)?.value as Float64Array;
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) {
        if (Number.isNaN(b[i]!)) expect(Number.isNaN(a[i]!)).toBe(true);
        else expect(a[i]).toBe(b[i]);
      }
    }
    expect(activeOutput(withG07.outputs, 'ZONE_SUMMARY')?.value).toEqual(activeOutput(withoutG07.outputs, 'ZONE_SUMMARY')?.value);

    // MOVABLE_SUMMARY tiene 1 fila Pozo + 5 zonas del TP (A–E), con invasión resuelta parcial > 0 y conservación MOS + Shr = 1 − Sw.
    const summary = activeOutput(withG07.outputs, MOVABLE_SUMMARY)?.value as TableValue;
    expect(summary.rows).toHaveLength(1 + zones.length);
    const pozo = summary.rows[0]!;
    expect(pozo.zone).toBe('Pozo');
    expect(pozo.resolvedSamples as number).toBeGreaterThan(300);
    expect(pozo.resolvedPct as number).toBeGreaterThan(5);
    expect(pozo.resolvedPct as number).toBeLessThan(30);
    expect((pozo.mosMean as number) + (pozo.shrMean as number)).toBeCloseTo(1 - (pozo.swMean as number), 10);

    // En la columna volumétrica del TP: donde RXO = NaN se conserva hidrocarburo entero, y donde MOS/SHR existen cierran a 1.
    const vsh = activeOutput(withG07.outputs, 'VSH')!.value as Float64Array;
    const phie = activeOutput(withG07.outputs, 'PHIE')!.value as Float64Array;
    const sw = activeOutput(withG07.outputs, 'SW')!.value as Float64Array;
    const mos = activeOutput(withG07.outputs, 'MOS')!.value as Float64Array;
    const shr = activeOutput(withG07.outputs, 'SHR')!.value as Float64Array;
    const stack = computeStack(VOLUMETRIC_STACK, well.depth.values.length, (r) =>
      r === 'VSH' ? vsh : r === 'PHIE' ? phie : r === 'SW' ? sw : r === 'MOS' ? mos : r === 'SHR' ? shr : undefined,
    );
    expect(stack.empty).toBe(false);
    expect(stack.missing).toEqual([]);
    expect(stack.legend.map((l) => l.id)).toEqual(['shale', 'matrix', 'water', 'hydrocarbon', 'movable-hc', 'residual-hc']);
    const hcL = stack.layers.find((l) => l.id === 'hydrocarbon')!;
    const movL = stack.layers.find((l) => l.id === 'movable-hc')!;
    const resL = stack.layers.find((l) => l.id === 'residual-hc')!;
    let checkedResolved = 0;
    let checkedFallback = 0;
    for (let i = 0; i < well.depth.values.length; i++) {
      if (!Number.isFinite(vsh[i]!) || !Number.isFinite(phie[i]!) || !Number.isFinite(sw[i]!)) continue;
      if (Number.isFinite(mos[i]!) && Number.isFinite(shr[i]!)) {
        const wHc = hcL.right[i]! - hcL.left[i]!;
        const wParts = (movL.right[i]! - movL.left[i]!) + (resL.right[i]! - resL.left[i]!);
        expect(wParts).toBeCloseTo(wHc, 5);
        checkedResolved++;
      } else {
        expect(movL.left[i]).toBeNaN();
        expect(resL.left[i]).toBeNaN();
        expect(Number.isFinite(hcL.right[i]! - hcL.left[i]!)).toBe(true);
        checkedFallback++;
      }
    }
    expect(checkedResolved).toBeGreaterThan(300);
    expect(checkedFallback).toBeGreaterThan(3000);
  });

  it('funciona con ambos métodos (ratio y archie), con Rxo medida y avisa si Sxo sin recortar < Sw', () => {
    const depth = Float64Array.from([1000, 1001, 1002, 1003]);
    // Muestra 0: móvil clásico (Sw=0.2, Rt=20, Rxo=40, Rmf/Rw=10 → r=√0.2, Sxo=0.4472, MOS=0.2472)
    // Muestra 1: anómala (Rxo/Rt = 20 > Rmf/Rw = 10 → r > 1 → Sxo_raw < Sw → recorta Sxo=Sw y avisa)
    // Muestra 2: agua (Sw=1, Rt=0.8, Rxo=8 → Sxo=1, MOS=0, SHR=0)
    // Muestra 3: Rxo=NaN → todas las salidas NaN
    const w = createWell({
      id: 'w-mob',
      name: 'Test Movilidad',
      depth,
      curves: [
        curve('SW', 'SW', 'v/v', [0.2, 0.4, 1.0, 0.25]),
        curve('PHIE', 'PHIE', 'v/v', [0.25, 0.25, 0.25, 0.25]),
        curve('RT', 'RT', 'ohm.m', [20, 10, 0.8, 15]),
        curve('RXO', 'RXO', 'ohm.m', [40, 200, 8, NaN]),
      ],
    });
    const wellData = { id: w.id, depth: w.depth.values, curves: w.curves };

    const resRatio = computeOnce(registry, wellData, emptyInterpretation([]));
    const sxo = activeOutput(resRatio.outputs, 'SXO')!.value as Float64Array;
    const mos = activeOutput(resRatio.outputs, 'MOS')!.value as Float64Array;
    const shr = activeOutput(resRatio.outputs, 'SHR')!.value as Float64Array;
    const mhi = activeOutput(resRatio.outputs, 'MHI')!.value as Float64Array;

    expect(sxo[0]).toBeCloseTo(Math.SQRT1_2 * Math.sqrt(0.4), 6); // 0.2 / sqrt(0.2) = sqrt(0.2) = 0.4472136
    expect(sxo[0]).toBeCloseTo(0.4472136, 5);
    expect(mos[0]).toBeCloseTo(0.2472136, 5);
    expect(shr[0]).toBeCloseTo(0.5527864, 5);
    expect(mhi[0]).toBeCloseTo(0.4472136, 5);

    // Muestra 1: anómala recortada a Sw = 0.4 y aviso emitido
    expect(sxo[1]).toBeCloseTo(0.4, 9);
    expect(mos[1]).toBeCloseTo(0, 9);
    expect(shr[1]).toBeCloseTo(0.6, 9);
    expect(mhi[1]).toBeCloseTo(1, 9);
    const warns = resRatio.diagnostics.filter((d) => d.moduleId === 'movable-hc' && d.code === 'module-warning').map((d) => d.message);
    expect(warns.some((m) => m.includes('Sxo sin recortar menor que Sw'))).toBe(true);

    // Muestra 2: agua 100 %
    expect(sxo[2]).toBeCloseTo(1, 9);
    expect(mos[2]).toBeCloseTo(0, 9);
    expect(shr[2]).toBeCloseTo(0, 9);
    expect(mhi[2]).toBeCloseTo(1, 9);

    // Muestra 3: Rxo NaN → todo NaN
    expect(sxo[3]).toBeNaN();
    expect(mos[3]).toBeNaN();
    expect(shr[3]).toBeNaN();
    expect(mhi[3]).toBeNaN();

    // Modo Archie en zona lavada (sin TEMP, correctRmfTemp=false): Rmf = 0.5, a = 1, m = 2, n = 2 → Sxo[0] = sqrt(0.5 / (0.0625 * 40)) = sqrt(0.2) = 0.4472136
    const interpArchie = emptyInterpretation([]);
    interpArchie.params.global['movable-hc.method'] = 'archie';
    interpArchie.params.global['movable-hc.correctRmfTemp'] = false;
    interpArchie.params.global['rmf'] = 0.5;
    const resArchie = computeOnce(registry, wellData, interpArchie);
    const sxoA = activeOutput(resArchie.outputs, 'SXO')!.value as Float64Array;
    expect(sxoA[0]).toBeCloseTo(0.4472136, 6);
    expect(sxoA[3]).toBeNaN();
  });

  it('en un pozo sin RXO (ni inducción de arreglo) no altera VOLUMETRIC_STACK ni inventa datos', () => {
    const depth = Float64Array.from([1000, 1001, 1002]);
    // Caso 1: pozo sin RT ni RXO → movable-hc no corre
    const wNoRt = createWell({
      id: 'w-no-rt',
      name: 'Sin Rt ni Rxo',
      depth,
      curves: [
        curve('VSH', 'VSH', 'v/v', [0.1, 0.2, 0.3]),
        curve('SW', 'SW', 'v/v', [0.2, 0.3, 0.4]),
        curve('PHIE', 'PHIE', 'v/v', [0.2, 0.2, 0.2]),
      ],
    });
    const resNoRt = computeOnce(registry, { id: wNoRt.id, depth: wNoRt.depth.values, curves: wNoRt.curves }, emptyInterpretation([]));
    expect(resNoRt.nodes.find((nd) => nd.moduleId === 'movable-hc')?.status).toBe('blocked');
    expect(activeOutput(resNoRt.outputs, 'SXO')).toBeUndefined();
    expect(activeOutput(resNoRt.outputs, 'MOS')).toBeUndefined();
    expect(activeOutput(resNoRt.outputs, 'SHR')).toBeUndefined();

    // Caso 2: pozo con solo RT (1 curva resistiva, sin arreglo ni RXO medida) → RXO/MOS/SHR quedan todo NaN y VOLUMETRIC_STACK no cambia
    const wOnlyRt = createWell({
      id: 'w-only-rt',
      name: 'Solo Rt',
      depth,
      curves: [
        curve('VSH', 'VSH', 'v/v', [0.1, 0.2, 0.3]),
        curve('SW', 'SW', 'v/v', [0.2, 0.3, 0.4]),
        curve('PHIE', 'PHIE', 'v/v', [0.2, 0.2, 0.2]),
        curve('RT', 'RT', 'ohm.m', [20, 10, 5]),
      ],
    });
    const resOnlyRt = computeOnce(registry, { id: wOnlyRt.id, depth: wOnlyRt.depth.values, curves: wOnlyRt.curves }, emptyInterpretation([]));
    const mos = activeOutput(resOnlyRt.outputs, 'MOS')?.value as Float64Array | undefined;
    const shr = activeOutput(resOnlyRt.outputs, 'SHR')?.value as Float64Array | undefined;
    if (mos) expect([...mos].every(Number.isNaN)).toBe(true);
    const stack = computeStack(VOLUMETRIC_STACK, depth.length, (r) =>
      r === 'VSH' ? wOnlyRt.curves[0]!.data : r === 'SW' ? wOnlyRt.curves[1]!.data : r === 'PHIE' ? wOnlyRt.curves[2]!.data : r === 'MOS' ? mos : r === 'SHR' ? shr : undefined,
    );
    expect(stack.missing).toEqual([]);
    expect(stack.legend.map((l) => l.id)).toEqual(['shale', 'matrix', 'water', 'hydrocarbon']);
  });
});

describe('G07 — plantilla de crossplot «Movilidad Rt–Rxo» y arrastre deshacible', () => {
  beforeEach(() => {
    historyClock.now = () => 1000;
  });

  it('está registrada en CROSSPLOT_TEMPLATES, sobrevive al saneamiento y exige RT + RXO', () => {
    expect(CROSSPLOT_TEMPLATES).toContain('rt-rxo');
    const def = templateDef('rt-rxo')!;
    expect(def.group).toBe('fluids');
    expect(def.x).toEqual({ role: 'RT', scale: 'log' });
    expect(def.y).toEqual({ role: 'RXO', scale: 'log' });
    expect(def.colorRole).toBe('SW');
    expect(sanitizeCrossplot({ template: 'rt-rxo' }).template).toBe('rt-rxo');
    expect(CROSSPLOT_TEMPLATE_DEFS.filter((t) => t.id === 'rt-rxo')).toHaveLength(1);

    const depth = Float64Array.from([1000, 1001, 1002]);
    const wNoRxo = createWell({ id: 'w1', name: 'W1', depth, curves: [curve('RT', 'RT', 'ohm.m', [1, 2, 3])] });
    const ctxNoRxo: SeriesContext = { well: wNoRxo, interpretation: emptyInterpretation([]), computed: [], catalog: registry.roles };
    const fail = crossplotTemplatePatch(ctxNoRxo, 'rt-rxo');
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.reason).toBe('falta RXO');

    const wOk = createWell({
      id: 'w2',
      name: 'W2',
      depth,
      curves: [
        curve('RT', 'RT', 'ohm.m', [1, 2, 10]),
        curve('RXO', 'RXO', 'ohm.m', [10, 20, 25]),
        curve('SW', 'SW', 'v/v', [1, 1, 0.3]),
      ],
    });
    const ctxOk: SeriesContext = { well: wOk, interpretation: emptyInterpretation([]), computed: [], catalog: registry.roles };
    const ok = crossplotTemplatePatch(ctxOk, 'rt-rxo');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.patch).toMatchObject({ xScale: 'log', yScale: 'log', template: 'rt-rxo', color: { kind: 'curve', curve: 'm:SW' } });
    }
  });

  it('rectas guía (Sw/Sxo = 1, 0,7 y 0,5) y función inversa del arrastre son exactas', () => {
    expect(RT_RXO_MHI_LINES).toEqual([1, 0.7, 0.5]);
    const water = rtRxoLine(1, 12, 2, [1, 100]);
    expect(water.rxo).toEqual([12, 1200]);
    const m07 = rtRxoLine(0.7, 12, 2, [1, 100]);
    expect(m07.rxo[0]).toBeCloseTo(12 * 0.49, 10);
    expect(m07.rxo[1]).toBeCloseTo(1200 * 0.49, 10);
    const m05 = rtRxoLine(0.5, 12, 2, [1, 100]);
    expect(m05.rxo[0]).toBeCloseTo(12 * 0.25, 10);

    // Inversa del punto al parámetro Rmf/Rw y manija sobre la recta
    expect(rmfOverRwFromPoint({ rt: 2, rxo: 30 })).toBeCloseTo(15, 12);
    expect(rmfOverRwFromPoint({ rt: 0, rxo: 10 })).toBeNaN();
    expect(rmfOverRwFromPoint({ rt: 2, rxo: -5 })).toBeNaN();

    const h = rtRxoWaterHandle(10, [0.2, 200], [0.2, 2000]);
    expect(h.visible).toBe(true);
    expect(h.point.rxo / h.point.rt).toBeCloseTo(10, 10);

    const hOut = rtRxoWaterHandle(1000, [10, 100], [0.1, 1]);
    expect(hOut.visible).toBe(false);
    expect(hOut.point.rt).toBeCloseTo(Math.sqrt(1000), 6);

    // Regresión hallazgo 2: rangos < 1 década conservan la manija dentro del tramo visible real
    const hSub = rtRxoWaterHandle(10, [5, 15], [100, 300]);
    expect(hSub.visible).toBe(true);
    expect(hSub.point.rt).toBeGreaterThanOrEqual(10);
    expect(hSub.point.rt).toBeLessThanOrEqual(15);
    expect(hSub.point.rxo / hSub.point.rt).toBeCloseTo(10, 10);

    // Regresión hallazgo 1: flechas de teclado avanzan y retroceden de forma monótona en todo [0.1, 200]
    let cur = PLOT_PARAMS.rmfOverRw.spec.min;
    for (let k = 0; k < 40; k++) {
      const next = nudgeParam(PLOT_PARAMS.rmfOverRw.spec, cur, 1);
      expect(next).toBeGreaterThan(cur);
      cur = next;
    }
    for (let k = 0; k < 40; k++) {
      const prev = nudgeParam(PLOT_PARAMS.rmfOverRw.spec, cur, -1);
      expect(prev).toBeLessThan(cur);
      cur = prev;
    }
  });

  it('distingue en el aviso cuando hay Rxo válido pero faltan otras entradas válidas (regresión hallazgo 4)', () => {
    const depth = Float64Array.from([1000, 1001, 1002]);
    const w = createWell({
      id: 'w-rxo-bad-rt',
      name: 'Rxo con Rt NaN',
      depth,
      curves: [
        curve('SW', 'SW', 'v/v', [0.3, 0.3, 0.3]),
        curve('PHIE', 'PHIE', 'v/v', [0.2, 0.2, 0.2]),
        curve('RT', 'RT', 'ohm.m', [NaN, NaN, NaN]),
        curve('RXO', 'RXO', 'ohm.m', [10, 12, 14]),
      ],
    });
    const res = computeOnce(registry, { id: w.id, depth: w.depth.values, curves: w.curves }, emptyInterpretation([]));
    const warns = res.diagnostics.filter((d) => d.moduleId === 'movable-hc' && d.code === 'module-warning').map((d) => d.message);
    expect(warns.some((m) => m.includes('Hay lecturas válidas de Rxo'))).toBe(true);
    expect(warns.some((m) => m.includes('Ninguna muestra tiene Rxo válido'))).toBe(false);
  });

  it('arrastrar la recta de agua actualiza movable-hc.rmfOverRw en un solo commit deshacible', () => {
    const depth = Float64Array.from([1000, 1001, 1002]);
    const w = createWell({
      id: 'w-drag',
      name: 'W Drag',
      depth,
      curves: [curve('RT', 'RT', 'ohm.m', [1, 2, 3]), curve('RXO', 'RXO', 'ohm.m', [10, 20, 30])],
    });
    useProject.getState().replace(addWell(createProject('P'), w));

    const label = paramChangeLabel(PLOT_PARAMS.rmfOverRw);
    const scope = { zoneId: null, text: 'global' };
    const before = plotParamValue(getWellEntry(useProject.getState().project, w.id)!.interpretation.params, PLOT_PARAMS.rmfOverRw, null);
    expect(before).toBe(DEFAULT_RMF_OVER_RW);

    // Secuencia de arrastre: varios preview + commit final → se funden en 1 entrada de historial.
    const v1 = normalizeParam(PLOT_PARAMS.rmfOverRw.spec, rmfOverRwFromPoint({ rt: 2, rxo: 24 })); // 12
    const v2 = normalizeParam(PLOT_PARAMS.rmfOverRw.spec, rmfOverRwFromPoint({ rt: 2, rxo: 32 })); // 16
    commitPlotParams(label, [paramWrite(PLOT_PARAMS.rmfOverRw, v1, scope)], 'preview');
    historyClock.now = () => 5000; // incluso tras pausa larga, el gesto agrupa todo en un solo undo
    commitPlotParams(label, [paramWrite(PLOT_PARAMS.rmfOverRw, v2, scope)], 'preview');
    commitPlotParams(label, [paramWrite(PLOT_PARAMS.rmfOverRw, v2, scope)], 'commit');

    const after = plotParamValue(getWellEntry(useProject.getState().project, w.id)!.interpretation.params, PLOT_PARAMS.rmfOverRw, null);
    expect(after).toBeCloseTo(16, 6);
    expect(useProject.getState().canUndo).toBe(true);

    // Un único Ctrl+Z vuelve al valor previo exacto (10) y vacía el historial.
    expect(useProject.getState().undo()).toBe(label);
    const undone = plotParamValue(getWellEntry(useProject.getState().project, w.id)!.interpretation.params, PLOT_PARAMS.rmfOverRw, null);
    expect(undone).toBe(DEFAULT_RMF_OVER_RW);
    expect(useProject.getState().canUndo).toBe(false);
  });
});
