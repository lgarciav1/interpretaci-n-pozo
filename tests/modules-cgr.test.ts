import { describe, expect, it } from 'vitest';
import csv from '../datos/pozo_tp_perfiles.csv?raw';
import { activeOutput, computeOnce } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import { addWell, createProject } from '../src/core/state/project';
import { createWell, type Curve } from '../src/core/well';
import { readWellFile } from '../src/io';
import { MODULES, registry } from '../src/modules';
import { CGR_CALIBRATION } from '../src/modules/cgr';
import { buildTrackCatalog } from '../src/viewer/catalog';
import { CGR_COMPARISON_TRACK_ID, isCgrComparisonTrack, showCgrComparisonRecipe } from '../src/viewer/cgrComparison';
import { BUILTIN_LAYOUTS } from '../src/viewer/templates';

function curve(id: string, role: string, unit: string, values: number[]): Curve {
  return { id, mnemonic: id, role, unit, data: Float64Array.from(values), origin: { kind: 'measured' } };
}

describe('G06 — módulos cgr e igr-cgr: registro, paridad TP, comparación y visor', () => {
  it('mantiene igr primero en MODULES y declara CGR con origin any + docs en Ecuaciones', () => {
    const ids = MODULES.map((m) => m.id);
    expect(ids[0]).toBe('igr');
    expect(ids.indexOf('cgr')).toBeGreaterThan(ids.indexOf('igr'));
    expect(ids.indexOf('igr-cgr')).toBeGreaterThan(ids.indexOf('igr'));
    expect(registry.roles.get('CGR')?.origin).toBe('any');
    expect(registry.roles.get('U_GR_FRAC')?.origin).toBe('computed');
    for (const id of ['cgr', 'igr-cgr']) {
      const m = registry.get(id)!;
      expect(m.docs.equations.length).toBeGreaterThan(0);
      expect(m.docs.references.length).toBeGreaterThan(0);
    }
  });

  it('no cambia ni un decimal del recorrido por defecto del TP y reporta CGR_CALIBRATION sobre las 5810 muestras', () => {
    const { well, zones } = readWellFile(csv, 'pozo_tp_perfiles.csv');
    const wellData = { id: well.id, depth: well.depth.values, curves: well.curves };
    const baseInterp = emptyInterpretation(zones);

    const withG06 = computeOnce(registry, wellData, baseInterp);
    const withoutG06 = computeOnce(registry, wellData, { ...baseInterp, disabled: ['cgr', 'igr-cgr'] });

    expect(withG06.sources['IGR']).toEqual({ kind: 'module', moduleId: 'igr' });
    expect(withG06.sources['CGR']).toEqual({ kind: 'module', moduleId: 'cgr' });

    for (const port of ['IGR', 'VSH', 'PHIE', 'SW', 'NET_RES', 'NET_PAY']) {
      const a = activeOutput(withG06.outputs, port)?.value as Float64Array;
      const b = activeOutput(withoutG06.outputs, port)?.value as Float64Array;
      expect(a).toBeInstanceOf(Float64Array);
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) {
        if (Number.isNaN(b[i]!)) expect(Number.isNaN(a[i]!)).toBe(true);
        else expect(a[i]).toBe(b[i]);
      }
    }
    expect(activeOutput(withG06.outputs, 'ZONE_SUMMARY')?.value).toEqual(activeOutput(withoutG06.outputs, 'ZONE_SUMMARY')?.value);

    // Calibración sobre las 5810 muestras del TP + 5 zonas (A–E)
    const cal = activeOutput(withG06.outputs, CGR_CALIBRATION)?.value as TableValue;
    expect(cal.rows).toHaveLength(1 + zones.length);
    const pozo = cal.rows[0]!;
    expect(pozo.scope).toBe('Pozo');
    expect(pozo.source).toBe('Ajustados en el pozo');
    expect(pozo.samples).toBe(5810);
    expect(pozo.a as number).toBeCloseTo(3.13873957, 6);
    expect(pozo.b as number).toBeCloseTo(19.0672241, 6);
    expect(pozo.c as number).toBeCloseTo(0.01173166, 6);
    expect(pozo.r2 as number).toBeCloseTo(0.99914087, 6);
    expect(pozo.rmse as number).toBeCloseTo(0.55990155, 6);
    expect(pozo.status).toBe('Coherente');

    // Sin avisos en el modo por defecto del TP
    expect(withG06.diagnostics.filter((d) => d.moduleId === 'cgr')).toHaveLength(0);
  });

  it('al elegir igr-cgr en una arena con uranio alto, bajan IGR y VSH, sube PHIE y recupera NET_PAY; compare conserva la cadena principal', () => {
    const n = 60;
    const depth = Array.from({ length: n }, (_, i) => 2000 + i * 0.5);
    // 20 muestras arena limpia sin U, 20 arena limpia con U alto (15 ppm), 20 arcilla
    const th: number[] = [];
    const k: number[] = [];
    const u: number[] = [];
    const gr: number[] = [];
    const rhob: number[] = [];
    const nphi: number[] = [];
    const rt: number[] = [];
    for (let i = 0; i < n; i++) {
      const shale = i >= 40;
      const highU = i >= 20 && i < 40;
      const t = shale ? 18 + (i % 5) * 0.3 : 3 + (i % 5) * 0.2;
      const p = shale ? 3.0 + (i % 4) * 0.1 : 0.5 + (i % 4) * 0.05;
      const ur = highU ? 15 + (i % 3) * 0.5 : shale ? 3 + (i % 3) * 0.2 : 1 + (i % 3) * 0.1;
      th.push(t);
      k.push(p);
      u.push(ur);
      // Herramienta exacta 4·Th + 16·K + 8·U: en arena con U alto, GR ≈ 140 gAPI pero CGR ≈ 20 gAPI
      gr.push(4 * t + 16 * p + 8 * ur);
      rhob.push(shale ? 2.55 : 2.3);
      nphi.push(shale ? 0.34 : 0.2);
      rt.push(shale ? 2 : 50);
    }
    const well = createWell({
      id: 'w-u',
      name: 'Pozo con uranio',
      depth: Float64Array.from(depth),
      curves: [
        curve('GR', 'GR', 'gAPI', gr),
        curve('THOR', 'THOR', 'ppm', th),
        curve('POTA', 'POTA', 'wt%', k),
        curve('URAN', 'URAN', 'ppm', u),
        curve('RHOB', 'RHOB', 'g/cm3', rhob),
        curve('NPHI', 'NPHI', 'v/v', nphi),
        curve('RT', 'RT', 'ohm.m', rt),
      ],
    });
    const wellData = { id: well.id, depth: well.depth.values, curves: well.curves };
    const base = emptyInterpretation([{ id: 'z1', name: 'Arena U', top: 2000, base: 2030, kind: 'reservoir', color: '#4a9' }]);
    const params = {
      global: {
        grClean: 25,
        grShale: 145,
        'igr-cgr.cgrClean': 20,
        'igr-cgr.cgrShale': 120,
        'rw-manual.rw': 0.05,
        'temp-gradient.surfaceTemp': 20,
        'temp-gradient.gradient': 0.03,
      },
      zones: {},
    };

    const byGr = computeOnce(registry, wellData, { ...base, params });
    const byCgr = computeOnce(registry, wellData, { ...base, params, sources: { IGR: { kind: 'module', moduleId: 'igr-cgr' } } });
    const compared = computeOnce(registry, wellData, { ...base, params, compare: ['igr-cgr'] });

    const vshGr = activeOutput(byGr.outputs, 'VSH')!.value as Float64Array;
    const vshCgr = activeOutput(byCgr.outputs, 'VSH')!.value as Float64Array;
    const phieGr = activeOutput(byGr.outputs, 'PHIE')!.value as Float64Array;
    const phieCgr = activeOutput(byCgr.outputs, 'PHIE')!.value as Float64Array;
    const payGr = activeOutput(byGr.outputs, 'NET_PAY')!.value as Float64Array;
    const payCgr = activeOutput(byCgr.outputs, 'NET_PAY')!.value as Float64Array;
    const uFrac = activeOutput(byGr.outputs, 'U_GR_FRAC')!.value as Float64Array;

    // En la arena con uranio alto (muestra 25): U aporta > 80% del GR
    expect(uFrac[25]!).toBeGreaterThan(0.8);
    expect(vshGr[25]!).toBeGreaterThan(0.85);
    expect(vshCgr[25]!).toBeLessThan(0.1);
    expect(phieCgr[25]!).toBeGreaterThan(phieGr[25]! + 0.05);
    expect(payGr[25]).toBe(0);
    expect(payCgr[25]).toBe(1);

    // En compare: IGR activo sigue siendo el de `igr`, pero `igr-cgr` corre como alternativa
    expect(compared.sources['IGR']).toEqual({ kind: 'module', moduleId: 'igr' });
    const altIgr = compared.outputs.find((o) => o.port === 'IGR' && o.moduleId === 'igr-cgr');
    expect(altIgr?.active).toBe(false);
    expect((altIgr?.value as Float64Array)[25]!).toBeLessThan(0.1);
    expect((activeOutput(compared.outputs, 'VSH')!.value as Float64Array)[25]).toBe(vshGr[25]);
  });

  it('respeta modo estándar orientativo, fórmula residual, guardas de dominio y precedencia de CGR medido', () => {
    const n = 40;
    const depth = Array.from({ length: n }, (_, i) => 1000 + i);
    const th = Array.from({ length: n }, (_, i) => 5 + (i % 10));
    const k = Array.from({ length: n }, (_, i) => 1 + (i % 5) * 0.4);
    const u = Array.from({ length: n }, (_, i) => 2 + (i % 4));
    const gr = th.map((t, i) => 4 * t + 16 * k[i]! + 8 * u[i]!);

    // 1. Modo estándar con GR y URAN presentes → evalúa R²/RMSE y NO dice «Sin GR o uranio»
    const wFull = createWell({
      id: 'w-std',
      name: 'W',
      depth: Float64Array.from(depth),
      curves: [curve('GR', 'GR', 'gAPI', gr), curve('THOR', 'THOR', 'ppm', th), curve('POTA', 'POTA', 'wt%', k), curve('URAN', 'URAN', 'ppm', u)],
    });
    const rStd = computeOnce(
      registry,
      { id: wFull.id, depth: wFull.depth.values, curves: wFull.curves },
      {
        ...emptyInterpretation([]),
        params: { global: { 'cgr.mode': 'standard', 'cgr.formula': 'residual' }, zones: {} },
      },
    );
    const rowStd = (activeOutput(rStd.outputs, CGR_CALIBRATION)!.value as TableValue).rows[0]!;
    expect(rowStd.source).toBe('Estándar orientativos');
    expect(rowStd.status).toBe('Estándar orientativo');
    expect(rowStd.r2 as number).toBeCloseTo(1, 9);
    const cgrRes = activeOutput(rStd.outputs, 'CGR')!.value as Float64Array;
    expect(cgrRes[0]).toBeCloseTo(4 * th[0]! + 16 * k[0]!, 9);
    expect(rStd.diagnostics.some((d) => d.moduleId === 'cgr' && d.message.includes('orientativos'))).toBe(true);

    // 2. Sin GR ni URAN → modo auto cae a estándar con aviso; residual avisa y da NaN
    const wNoGrU = createWell({
      id: 'w-nogru',
      name: 'Sin GR/U',
      depth: Float64Array.from(depth),
      curves: [curve('THOR', 'THOR', 'ppm', th), curve('POTA', 'POTA', 'wt%', k)],
    });
    const rNoGrU = computeOnce(registry, { id: wNoGrU.id, depth: wNoGrU.depth.values, curves: wNoGrU.curves }, emptyInterpretation([]));
    expect((activeOutput(rNoGrU.outputs, 'CGR')!.value as Float64Array)[0]).toBeCloseTo(4 * th[0]! + 16 * k[0]!, 9);
    expect((activeOutput(rNoGrU.outputs, CGR_CALIBRATION)!.value as TableValue).rows[0]!.status).toBe('Sin GR o uranio para evaluar');

    const rNoGrURes = computeOnce(
      registry,
      { id: wNoGrU.id, depth: wNoGrU.depth.values, curves: wNoGrU.curves },
      {
        ...emptyInterpretation([]),
        params: { global: { 'cgr.formula': 'residual' }, zones: {} },
      },
    );
    expect(Number.isNaN((activeOutput(rNoGrURes.outputs, 'CGR')!.value as Float64Array)[0]!)).toBe(true);

    // 3. CGR medido en el pozo gana por defecto sobre el módulo cgr
    const cgrMeas = Array.from({ length: n }, () => 55);
    const wMeas = createWell({
      id: 'w-meas',
      name: 'Con CGR medido',
      depth: Float64Array.from(depth),
      curves: [
        curve('GR', 'GR', 'gAPI', gr),
        curve('THOR', 'THOR', 'ppm', th),
        curve('POTA', 'POTA', 'wt%', k),
        curve('URAN', 'URAN', 'ppm', u),
        curve('CGR', 'CGR', 'gAPI', cgrMeas),
      ],
    });
    const rMeas = computeOnce(
      registry,
      { id: wMeas.id, depth: wMeas.depth.values, curves: wMeas.curves },
      {
        ...emptyInterpretation([]),
        sources: { IGR: { kind: 'module', moduleId: 'igr-cgr' } },
      },
    );
    expect(rMeas.sources['CGR']).toEqual({ kind: 'curve', curveId: 'CGR' });
    // Con cgrClean=20, cgrShale=100, CGR medido 55 → IGR = (55-20)/80 = 0.4375
    expect((activeOutput(rMeas.outputs, 'IGR')!.value as Float64Array)[0]).toBeCloseTo(0.4375, 9);

    // 4. igr-cgr con cgrShale <= cgrClean avisa y da NaN
    const rBadBounds = computeOnce(
      registry,
      { id: wFull.id, depth: wFull.depth.values, curves: wFull.curves },
      {
        ...emptyInterpretation([]),
        sources: { IGR: { kind: 'module', moduleId: 'igr-cgr' } },
        params: { global: { 'igr-cgr.cgrClean': 90, 'igr-cgr.cgrShale': 80 }, zones: {} },
      },
    );
    expect(Number.isNaN((activeOutput(rBadBounds.outputs, 'IGR')!.value as Float64Array)[0]!)).toBe(true);
    expect(rBadBounds.diagnostics.some((d) => d.moduleId === 'igr-cgr')).toBe(true);
  });

  it('receta de pista GR · CGR y catálogo incluyen CGR calculado', () => {
    const { well } = readWellFile(csv, 'pozo_tp_perfiles.csv');
    const p0 = addWell(createProject(), well);
    const baseTracks = BUILTIN_LAYOUTS.petrophysics;
    const p1 = showCgrComparisonRecipe(p0, 'petrophysics', baseTracks);
    const layout = p1.display.layouts!['petrophysics']!;
    const idx = layout.findIndex(isCgrComparisonTrack);
    expect(idx).toBe(1); // justo después de correlation (índice 0)
    expect(layout[idx]!.title).toBe('GR · CGR');
    expect(layout[idx]!.fills?.[0]).toMatchObject({ kind: 'between', a: 'CGR', b: 'GR', aLeft: 'uraniumExcess', compare: 'value' });
    // Idempotente
    const p2 = showCgrComparisonRecipe(p1, 'petrophysics', layout);
    expect(p2).toBe(p1);

    // Catálogo expone CGR calculado (sin curva CGR medida en el TP) y herramienta GR · CGR
    const groups = buildTrackCatalog({
      roles: registry.roles,
      curves: well.curves,
      producible: new Set(registry.ports.keys()),
      computed: new Set(['CGR']),
    });
    const spectral = groups.find((g) => g.id === 'spectral')!;
    expect(spectral.tools.some((t) => t.id === `tool:${CGR_COMPARISON_TRACK_ID}`)).toBe(true);
    const cgrItem = spectral.curves.find((c) => c.id === 'r:CGR');
    expect(cgrItem).toBeDefined();
    expect(cgrItem?.status).toBe('computed');
    expect(cgrItem?.origin).toBe('computed');

    // GR constante positivo -> diagnóstico 'Sin varianza' en fila Pozo
    const n = 35;
    const wConst = createWell({
      id: 'w-const',
      name: 'GR constante',
      depth: Float64Array.from({ length: n }, (_, i) => 1000 + i),
      curves: [
        curve('GR', 'GR', 'gAPI', Array.from({ length: n }, () => 50)),
        curve('THOR', 'THOR', 'ppm', Array.from({ length: n }, (_, i) => 2 + (i % 7))),
        curve('POTA', 'POTA', 'wt%', Array.from({ length: n }, (_, i) => 1 + (i % 5) * 0.4)),
        curve('URAN', 'URAN', 'ppm', Array.from({ length: n }, (_, i) => 1 + (i % 3) * 0.5)),
      ],
    });
    const rConst = computeOnce(registry, { id: wConst.id, depth: wConst.depth.values, curves: wConst.curves }, emptyInterpretation([]));
    const calConst = activeOutput(rConst.outputs, CGR_CALIBRATION)!.value as TableValue;
    expect(calConst.rows[0]!.status).toBe('Sin varianza');
  });
});
