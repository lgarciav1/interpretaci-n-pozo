import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import type { ClientResult } from '../src/core/engine/client';
import { engineContext } from '../src/core/engine/context';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { ReadonlyTableValue } from '../src/core/module';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { addWell, createProject } from '../src/core/state/project';
import { convert } from '../src/core/units';
import { layoutZones, sampleThickness, type Zone } from '../src/core/well';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import {
  buildCutoffSurfaceView,
  setCutoffPairRecipe,
} from '../src/modules/cutoff-sensitivity/surfaceModel';
import { netFlagsInto, type Cutoffs } from '../src/petro/cutoffs';
import {
  SURFACE_PAIRS,
  assessStability2D,
  classifyStability2D,
  contourLevelsForRange,
  cutoffSurface2D,
  cutoffSweep,
  extractContours2D,
  sampleSurface2D,
  type SurfacePairId,
  type SweepGrid,
  type SweepVariable,
} from '../src/petro/sensitivity';

function expectCloseOrNaN(actual: number, expected: number, tol = 1e-12, label = '') {
  if (Number.isNaN(expected)) {
    expect(actual, label).toBeNaN();
  } else {
    expect(Number.isFinite(actual), `${label}: expected finite, got ${actual}`).toBe(true);
    expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol);
  }
}

function bruteForceCell(
  vsh: Float64Array,
  phi: Float64Array,
  sw: Float64Array,
  thickness: Float64Array,
  cutoffs: Cutoffs,
  ranges: readonly { start: number; end: number }[],
  perm?: Float64Array,
) {
  const n = vsh.length;
  const outRes = new Float64Array(n);
  const outPay = new Float64Array(n);
  netFlagsInto(vsh, phi, sw, outRes, outPay, cutoffs, 0, n, perm ? { perm } : {});

  let netRes = 0;
  let netPay = 0;
  let hphiShPay = 0;
  let noDataPay = 0;
  let resN = 0;
  let knownN = 0;

  for (const r of ranges) {
    for (let i = r.start; i < r.end; i++) {
      const h = thickness[i]!;
      if (!(h > 0) || !Number.isFinite(h)) continue;
      if (outRes[i] === 1) {
        netRes += h;
        resN++;
        const p = outPay[i]!;
        if (Number.isNaN(p)) {
          noDataPay += h;
        } else {
          knownN++;
          if (p === 1) {
            netPay += h;
            hphiShPay += h * phi[i]! * (1 - sw[i]!);
          }
        }
      }
    }
  }
  const unknown = resN > 0 && knownN === 0;
  return {
    netRes,
    netPay: unknown ? NaN : netPay,
    hphiShPay: unknown ? NaN : hphiShPay,
    noDataPay,
  };
}

describe('superficie 2D de sensibilidad a cutoffs (motor puro)', () => {
  const vsh = new Float64Array([0.1, 0.25, 0.4, 0.55, NaN, 0.2, 0.15, 0.35]);
  const phi = new Float64Array([0.24, 0.12, 0.08, 0.2, 0.22, NaN, 0.18, 0.05]);
  const sw = new Float64Array([0.3, 0.5, 0.7, 0.25, 0.35, 0.4, NaN, 0.8]);
  const perm = new Float64Array([15, 3, 0.8, 25, 10, 12, 5, NaN]);
  const h = new Float64Array([1, 1.5, 2, 1.2, 0.8, 1.1, 0.9, 1.3]);
  const ranges = [
    { start: 0, end: 4 },
    { start: 5, end: 8 },
  ];

  const grids: Record<SweepVariable, SweepGrid> = {
    vsh: { min: 0, max: 1, steps: 6 },
    phi: { min: 0, max: 0.4, steps: 5 },
    sw: { min: 0, max: 1, steps: 6 },
  };

  for (const permOn of [false, true]) {
    for (const pair of SURFACE_PAIRS) {
      it(`paridad 1e-12 vs netFlagsInto y cutoffSweep para ${pair.id} (perm=${permOn})`, () => {
        const base: Cutoffs = {
          vshMax: 0.35,
          phiMin: 0.1,
          swMax: 0.55,
          ...(permOn ? { permMin: 1.0 } : {}),
        };
        const xg = grids[pair.xVar];
        const yg = grids[pair.yVar];
        const surf = cutoffSurface2D(vsh, phi, sw, h, base, pair.id, xg, yg, ranges, permOn ? perm : undefined);

        for (let jy = 0; jy < surf.ny; jy++) {
          for (let ix = 0; ix < surf.nx; ix++) {
            const k = jy * surf.nx + ix;
            const cCell: Cutoffs = { ...base };
            const setVar = (vr: SweepVariable, val: number) => {
              if (vr === 'vsh') cCell.vshMax = val;
              else if (vr === 'phi') cCell.phiMin = val;
              else cCell.swMax = val;
            };
            setVar(pair.xVar, surf.xThresholds[ix]!);
            setVar(pair.yVar, surf.yThresholds[jy]!);

            const ref = bruteForceCell(vsh, phi, sw, h, cCell, ranges, permOn ? perm : undefined);
            expectCloseOrNaN(surf.netRes[k]!, ref.netRes, 1e-12, `${pair.id} netRes (${ix},${jy})`);
            expectCloseOrNaN(surf.netPay[k]!, ref.netPay, 1e-12, `${pair.id} netPay (${ix},${jy})`);
            expectCloseOrNaN(surf.hphiShPay[k]!, ref.hphiShPay, 1e-12, `${pair.id} hphiSh (${ix},${jy})`);
            expectCloseOrNaN(surf.noDataPay[k]!, ref.noDataPay, 1e-12, `${pair.id} noData (${ix},${jy})`);
          }
        }

        // Verificar paridad directa fila y columna contra barrido 1D `cutoffSweep`.
        const fixedValOf = (vr: SweepVariable) => (vr === 'vsh' ? base.vshMax : vr === 'phi' ? base.phiMin : base.swMax);
        const yIdxMatch = Array.from(surf.yThresholds).findIndex((t) => Math.abs(t - fixedValOf(pair.yVar)) < 1e-9);
        if (yIdxMatch >= 0) {
          const s1x = cutoffSweep(vsh, phi, sw, h, base, pair.xVar, xg, ranges, permOn ? perm : undefined);
          for (let ix = 0; ix < surf.nx; ix++) {
            const k = yIdxMatch * surf.nx + ix;
            expectCloseOrNaN(surf.netPay[k]!, s1x.netPay[ix]!, 1e-12, `${pair.id} 1D X row`);
          }
        }
      });
    }
  }

  it('devuelve NaN en netPay/hphiShPay cuando todas las muestras reservorio carecen de Sw', () => {
    const v = new Float64Array([0.1, 0.15]);
    const p = new Float64Array([0.2, 0.18]);
    const s = new Float64Array([NaN, NaN]);
    const th = new Float64Array([2, 3]);
    const surf = cutoffSurface2D(
      v,
      p,
      s,
      th,
      { vshMax: 0.4, phiMin: 0.1, swMax: 0.6 },
      'phi-sw',
      { min: 0, max: 0.4, steps: 5 },
      { min: 0, max: 1, steps: 5 },
      [{ start: 0, end: 2 }],
    );
    // Para phi <= 0.18 hay reservorio sin Sw -> netPay = NaN, noDataPay = netRes.
    const k0 = 0 * surf.nx + 1; // phi = 0.1
    expect(surf.netRes[k0]).toBeCloseTo(5, 12);
    expect(surf.noDataPay[k0]).toBeCloseTo(5, 12);
    expect(surf.netPay[k0]).toBeNaN();
    expect(surf.hphiShPay[k0]).toBeNaN();

    // Para phi = 0.3 nadie pasa reservorio -> netRes = 0, netPay = 0.
    const kHigh = 0 * surf.nx + 3; // phi = 0.3
    expect(surf.netRes[kHigh]).toBe(0);
    expect(surf.netPay[kHigh]).toBe(0);
  });
});

describe('contornos Marching Squares e interpolación bilineal', () => {
  it('reproduce exactamente la recta de contorno sobre un plano lineal f(x,y) = 2x + 3y', () => {
    const tx = new Float64Array([0, 1, 2, 3, 4]);
    const ty = new Float64Array([0, 1, 2, 3]);
    const nx = tx.length;
    const ny = ty.length;
    const vals = new Float64Array(nx * ny);
    for (let jy = 0; jy < ny; jy++) {
      for (let ix = 0; ix < nx; ix++) {
        vals[jy * nx + ix] = 2 * tx[ix]! + 3 * ty[jy]!;
      }
    }
    const levels = contourLevelsForRange(0, 17, 5);
    expect(levels.length).toBeGreaterThanOrEqual(3);
    expect(levels.length).toBeLessThanOrEqual(6);

    const grid = { xThresholds: tx, yThresholds: ty, nx, ny };
    const contours = extractContours2D(grid, vals, levels);
    for (const c of contours) {
      expect(c.lines.length).toBeGreaterThanOrEqual(1);
      for (const line of c.lines) {
        for (const pt of line.points) {
          expect(2 * pt.x + 3 * pt.y).toBeCloseTo(c.level, 10);
        }
      }
    }

    expect(sampleSurface2D(grid, vals, 1.5, 2.25)).toBeCloseTo(2 * 1.5 + 3 * 2.25, 12);
    expect(sampleSurface2D(grid, vals, -0.1, 1)).toBeNaN();
    expect(sampleSurface2D(grid, vals, 1, 3.1)).toBeNaN();
  });

  it('desambigua silla (casos 5 y 10), lazos cerrados, vértices en el nivel y omite celdas con NaN', () => {
    const tx = new Float64Array([0, 1, 2]);
    const ty = new Float64Array([0, 1]);
    const nx = 3;
    const ny = 2;
    const grid = { xThresholds: tx, yThresholds: ty, nx, ny };

    // Celda 0 (izquierda): BL=10, BR=0, TR=10, TL=0 -> caso 5, avg = 5. Celda 1: incluye NaN -> omitida.
    const vals5 = new Float64Array([10, 0, NaN, 0, 10, 5]);
    const high5 = extractContours2D(grid, vals5, [4]); // avg 5 >= 4 → conecta BL y TR
    const low5 = extractContours2D(grid, vals5, [6]); // avg 5 < 6 → conecta BR y TL
    expect(high5[0]!.lines).toHaveLength(2);
    expect(low5[0]!.lines).toHaveLength(2);
    const sig = (l: typeof high5) => l[0]!.lines.map((p) => p.points.map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join('->')).sort().join('|');
    expect(sig(high5)).not.toBe(sig(low5));

    // Caso silla 10 (BR=10, TL=10, BL=0, TR=0, avg = 5) + vértice coincidente exacto con nivel = 5 en meseta sin colapsar.
    const vals10 = new Float64Array([0, 10, NaN, 10, 0, 5]);
    const c10Low = extractContours2D(grid, vals10, [4]);
    const c10High = extractContours2D(grid, vals10, [6]);
    expect(c10Low[0]!.lines).toHaveLength(2);
    expect(c10High[0]!.lines).toHaveLength(2);
    expect(sig(c10Low)).not.toBe(sig(c10High));

    // Contorno cerrado alrededor de un máximo interior y vértices exactamente iguales al nivel.
    const pGrid = { xThresholds: new Float64Array([0, 1, 2]), yThresholds: new Float64Array([0, 1, 2]), nx: 3, ny: 3 };
    const peak = new Float64Array([0, 0, 0, 0, 10, 0, 0, 0, 0]);
    const closed = extractContours2D(pGrid, peak, [5]);
    expect(closed[0]!.lines).toHaveLength(1);
    expect(closed[0]!.lines[0]!.closed).toBe(true);

    const exact = extractContours2D(pGrid, new Float64Array([0, 5, 10, 0, 5, 10, 0, 5, 10]), [5]);
    expect(exact[0]!.lines.length).toBeGreaterThanOrEqual(1);
    for (const line of exact[0]!.lines) {
      expect(line.points.length).toBeGreaterThanOrEqual(2);
      for (const pt of line.points) expect(pt.x).toBeCloseTo(1, 10);
    }

    expect(sampleSurface2D(grid, vals5, 1.5, 0.5)).toBeNaN();
    expect(sampleSurface2D(grid, vals5, 0.5, 0.5)).toBeCloseTo(5, 12);
  });

  it('cubre sw > ty[max] sin NaN y descarte por curva conocida cuando otra es NaN', () => {
    const v = new Float64Array([0.1, 0.9]);
    const p = new Float64Array([0.2, NaN]);
    const s = new Float64Array([0.95, 0.3]);
    const th = new Float64Array([3, 4]);
    const surf = cutoffSurface2D(
      v,
      p,
      s,
      th,
      { vshMax: 0.4, phiMin: 0.1, swMax: 0.6 },
      'phi-sw',
      { min: 0, max: 0.4, steps: 5 },
      { min: 0, max: 0.8, steps: 5 }, // sw=0.95 > 0.8, pero sw es conocido → knownN=1, netPay=0 (no NaN)
      [{ start: 0, end: 2 }],
    );
    const k0 = 0 * surf.nx + 1;
    expect(surf.netRes[k0]).toBeCloseTo(3, 12);
    expect(surf.netPay[k0]).toBe(0);
    expect(surf.noDataPay[k0]).toBe(0);
  });
});

describe('clasificación y evaluación exacta de estabilidad 2D', () => {
  it('distingue meseta estable, zona sensible, barranco crítico, base cero y sin datos conservando centro', () => {
    const box = { xLow: 0.09, xHigh: 0.11, yLow: 0.55, yHigh: 0.65 };
    expect(classifyStability2D(10, [9.5, 10.2, 9.8, 10.1], box).status).toBe('stable');
    expect(classifyStability2D(10, [10, 8.2, 9.5, 10], box).status).toBe('sensitive');
    expect(classifyStability2D(10, [10, 6.0, 9.5, 10], box).status).toBe('critical');

    const zeroGain = classifyStability2D(0, [0, 0, 2.5, 0], box);
    expect(zeroGain.status).toBe('critical');
    expect(zeroGain.zeroCenterWithGain).toBe(true);
    expect(zeroGain.maxRelDelta).toBeNull();

    expect(classifyStability2D(0, [0, 0, 0, 0], box).status).toBe('empty');
    expect(classifyStability2D(NaN, [1, 2, 3, 4], box).status).toBe('no-data');

    const noCornerData = classifyStability2D(10, [NaN, NaN, NaN, NaN], box);
    expect(noCornerData.status).toBe('no-data');
    expect(noCornerData.centerValue).toBe(10);
  });

  it('evalúa esquinas exactas fuera de nodos de grilla (no discretizado)', () => {
    const vsh = new Float64Array([0.1, 0.1]);
    const phi = new Float64Array([0.2, 0.115]);
    const sw = new Float64Array([0.3, 0.52]);
    const h = new Float64Array([10, 2]);
    const stab = assessStability2D(
      vsh,
      phi,
      sw,
      h,
      { vshMax: 0.4, phiMin: 0.12, swMax: 0.5 }, // centro: solo muestra 0 (10 m); en esquina relajada (0.11, 0.55): ambos (12 m) = +20%
      'phi-sw',
      [{ start: 0, end: 2 }],
      { min: 0, max: 0.4 },
      { min: 0, max: 1 },
      'netPay',
    );
    expect(stab.centerValue).toBeCloseTo(10, 12);
    expect(stab.maxValue).toBeCloseTo(12, 12);
    expect(stab.status).toBe('sensitive');
    expect(stab.maxRelDelta).toBeCloseTo(0.2, 12);
  });
});

describe('adaptador surfaceModel sobre pozo sintético (3 zonas, sello, overrides) y pozo del TP', () => {
  it('respeta zona sello, overrides, paridad con ZoneSummary/Volumetrics y Ctrl+Z atómico', () => {
    const demo = syntheticWell();
    const sorted = [...demo.zones].sort((a, b) => a.top - b.top);
    expect(sorted.length).toBeGreaterThanOrEqual(2);
    const zSeal: Zone = { ...sorted[1]!, kind: 'seal' };
    const zones = [sorted[0]!, zSeal, ...sorted.slice(2)];

    let interp = emptyInterpretation(zones);
    // Forzar overrides distintos en zona 0 y poner fluido 'oil' en el sello para verificar que no aporte volumen.
    interp = {
      ...interp,
      params: {
        global: { ...interp.params.global, fluid: 'oil', area: 2, bo: 1.2 },
        zones: {
          [zones[0]!.id]: { phiCutoff: 0.12, swCutoff: 0.55, fluid: 'oil', area: 3, bo: 1.15 },
          [zSeal.id]: { fluid: 'oil', area: 5, bo: 1.1 },
        },
      },
    };

    const engine = new Engine(registry);
    engine.setWell(toEngineWell(demo.well));
    const run = engine.run(interp);
    const clientRes: ClientResult = {
      ...run,
      context: engineContext(toEngineWell(demo.well), interp),
      wellId: demo.well.id,
      seq: 1,
      gen: 1,
      roundTripMs: 0,
      coalesced: 0,
    };

    const sealView = buildCutoffSurfaceView({
      well: demo.well,
      interpretation: interp,
      result: clientRes,
      zoneId: zSeal.id,
      pairId: 'phi-sw',
      metric: 'ooip',
    })!;
    expect(sealView).not.toBeNull();
    expect(sealView.hasOil).toBe(false); // sello nunca aporta OOIP
    expect(sealView.metric).toBe('netPay'); // fallback automático a netPay

    const z0View = buildCutoffSurfaceView({
      well: demo.well,
      interpretation: interp,
      result: clientRes,
      zoneId: zones[0]!.id,
      pairId: 'phi-sw',
      metric: 'netPay',
    })!;
    const summaryRows = (run.outputs.find((o) => o.port === 'ZONE_SUMMARY')?.value as ReadonlyTableValue).rows;
    const z0Summary = summaryRows.find((r) => r.zone === zones[0]!.name)!;
    const netPayByZone = run.outputs.find((o) => o.port === 'NET_PAY_H')?.value as Readonly<Record<string, number>>;
    expect(z0View.stability.centerValue).toBeCloseTo(Number(z0Summary['netPay']), 10);
    expect(z0View.stability.centerValue).toBeCloseTo(netPayByZone[zones[0]!.id]!, 10);

    const totView = buildCutoffSurfaceView({
      well: demo.well,
      interpretation: interp,
      result: clientRes,
      zoneId: null,
      pairId: 'phi-sw',
      metric: 'netPay',
    })!;
    const totSummary = summaryRows.find((r) => r.zone === 'Total')!;
    const netPayTotal = run.outputs.find((o) => o.port === 'NET_PAY_TOTAL')?.value as number;
    expect(totView.xOverrides).toEqual([zones[0]!.name]);
    expect(totView.yOverrides).toEqual([zones[0]!.name]);
    // Con overrides por zona en φ y Sw, Total DEBE coincidir exactamente con ZONE_SUMMARY / NET_PAY_TOTAL.
    expect(totView.stability.centerValue).toBeCloseTo(Number(totSummary['netPay']), 10);
    expect(totView.stability.centerValue).toBeCloseTo(netPayTotal, 10);

    // Fluido mixto: oil en zona 0 y gas en zona 2 → Total expone ambos volúmenes y coincide con OOIP_TOTAL / OGIP_TOTAL.
    const mixedZones = sorted.length >= 3 ? [sorted[0]!, zSeal, sorted[2]!] : [sorted[0]!, zSeal];
    const mixedInterp = {
      ...interp,
      zones: mixedZones,
      params: {
        ...interp.params,
        zones: {
          ...interp.params.zones,
          ...(mixedZones[2] ? { [mixedZones[2].id]: { fluid: 'gas', area: 2.5, bg: 0.005 } } : {}),
        },
      },
    };
    const mixedEngine = new Engine(registry);
    mixedEngine.setWell(toEngineWell(demo.well));
    const mixedRun = mixedEngine.run(mixedInterp);
    const mixedClient: ClientResult = {
      ...mixedRun,
      context: engineContext(toEngineWell(demo.well), mixedInterp),
      wellId: demo.well.id,
      seq: 2,
      gen: 1,
      roundTripMs: 0,
      coalesced: 0,
    };
    const totOoipView = buildCutoffSurfaceView({
      well: demo.well,
      interpretation: mixedInterp,
      result: mixedClient,
      zoneId: null,
      pairId: 'phi-sw',
      metric: 'ooip',
    })!;
    const ooipTotal = mixedRun.outputs.find((o) => o.port === 'OOIP_TOTAL')?.value as number;
    expect(totOoipView.stability.centerValue).toBeCloseTo(convert(ooipTotal, 'm3', totOoipView.unit), 6);
    if (mixedZones[2]) {
      expect(totOoipView.hasOil).toBe(true);
      expect(totOoipView.hasGas).toBe(true);
    }

    // Unidad desconocida no rompe resolveInputCurve, y PERM=null en csNode.inputs bloquea el respaldo de well.curves.
    const wellWithWeirdUnitAndPerm = {
      ...demo.well,
      curves: [
        ...demo.well.curves.map((c) => (c.role === 'SW' ? { ...c, unit: 'unidad_inventada' } : c)),
        {
          id: 'perm-raw-ignored',
          mnemonic: 'PERM_RAW',
          role: 'PERM' as const,
          unit: 'mD',
          origin: { kind: 'measured' as const },
          data: new Float64Array(demo.well.depth.values.length).fill(100),
        },
      ],
    };
    const noPermResult: ClientResult = {
      ...clientRes,
      nodes: clientRes.nodes.map((nd) =>
        nd.moduleId === 'cutoff-sensitivity' ? { ...nd, status: 'ok', inputs: { ...nd.inputs, perm: null } } : nd,
      ),
    };
    const weirdInterp = { ...interp, params: { ...interp.params, global: { ...interp.params.global, permCutoffOn: true, permCutoff: 5 } } };
    const safeView = buildCutoffSurfaceView({
      well: wellWithWeirdUnitAndPerm,
      interpretation: weirdInterp,
      result: noPermResult,
      zoneId: zones[0]!.id,
      pairId: 'phi-sw',
      metric: 'netPay',
    });
    expect(safeView).not.toBeNull();
    // Con perm=null en csNode.inputs y permCutoffOn=true, NO cae a PERM_RAW=100 → las muestras rechazadas por Vsh/φ dan netRes=0 (ok=true) y las restantes quedan NaN, resultando centerValue = 0.
    expect(safeView!.stability.centerValue).toBe(0);

    // Sin ClientResult (result=null), sí resuelve PERM_RAW=100 de well.curves y las curvas medidas VSH/PHIE/SW con unidad desconocida no lanzan excepción.
    const measuredWell = {
      ...demo.well,
      curves: [
        {
          id: 'm-vsh',
          mnemonic: 'VSH_M',
          role: 'VSH' as const,
          unit: 'v/v',
          origin: { kind: 'measured' as const },
          data: new Float64Array(demo.well.depth.values.length).fill(0.1),
        },
        {
          id: 'm-phi',
          mnemonic: 'PHIE_M',
          role: 'PHIE' as const,
          unit: 'v/v',
          origin: { kind: 'measured' as const },
          data: new Float64Array(demo.well.depth.values.length).fill(0.22),
        },
        {
          id: 'm-sw',
          mnemonic: 'SW_M',
          role: 'SW' as const,
          unit: 'unidad_inventada',
          origin: { kind: 'measured' as const },
          data: new Float64Array(demo.well.depth.values.length).fill(0.25),
        },
        {
          id: 'm-perm',
          mnemonic: 'PERM_M',
          role: 'PERM' as const,
          unit: 'mD',
          origin: { kind: 'measured' as const },
          data: new Float64Array(demo.well.depth.values.length).fill(100),
        },
      ],
    };
    const measuredView = buildCutoffSurfaceView({
      well: measuredWell,
      interpretation: weirdInterp,
      result: null,
      zoneId: zones[0]!.id,
      pairId: 'phi-sw',
      metric: 'netPay',
    });
    expect(measuredView).not.toBeNull();
    expect(measuredView!.stability.centerValue).toBeGreaterThan(0);

    const volView = buildCutoffSurfaceView({
      well: demo.well,
      interpretation: interp,
      result: clientRes,
      zoneId: zones[0]!.id,
      pairId: 'phi-sw',
      metric: 'ooip',
    })!;
    const ooipByZone = run.outputs.find((o) => o.port === 'OOIP')?.value as Readonly<Record<string, number>>;
    const volRows = (run.outputs.find((o) => o.port === 'VOLUMETRICS')?.value as ReadonlyTableValue).rows;
    const z0Vol = volRows.find((r) => r.zone === zones[0]!.name)!;
    expect(volView.stability.centerValue).toBeCloseTo(convert(ooipByZone[zones[0]!.id]!, 'm3', volView.unit), 6);
    expect(volView.stability.centerValue).toBeCloseTo(convert(Number(z0Vol['ooipSi']), 'Mm3', volView.unit), 6);

    // Verificar deshacer atómico (1 paso revierte ambos cutoffs simultáneamente).
    let project = addWell(createProject('Test G09'), demo.well, zones);
    let history = emptyHistory();
    const prev = project;
    project = setCutoffPairRecipe(project, demo.well.id, null, [
      { key: 'phiCutoff', value: 0.14 },
      { key: 'swCutoff', value: 0.45 },
    ]);
    history = recordChange(history, prev, 'Mover φ × Sw en superficie 2D', 1000);
    expect(history.past).toHaveLength(1);
    const afterChange = project.wells[0]!.interpretation.params.global;
    expect(afterChange['phiCutoff']).toBe(0.14);
    expect(afterChange['swCutoff']).toBe(0.45);

    const undone = undo(history, project)!;
    expect(undone).not.toBeNull();
    expect(undone.project.wells[0]!.interpretation.params.global['phiCutoff']).toBeUndefined();
    expect(undone.project.wells[0]!.interpretation.params.global['swCutoff']).toBeUndefined();
  });

  it('retorna null cuando falta VSH, PHIE o SW', () => {
    const demo = syntheticWell();
    const withoutSw = { ...demo.well, curves: demo.well.curves.filter((c) => c.role !== 'SW') };
    const interp = emptyInterpretation(demo.zones);
    const v = buildCutoffSurfaceView({
      well: withoutSw,
      interpretation: interp,
      result: null,
      zoneId: null,
      pairId: 'phi-sw',
      metric: 'netPay',
    });
    expect(v).toBeNull();
  });

  it('pozo del TP (5810 muestras): paridad exacta con resumen/sensibilidad y tiempo < 15 ms por superficie', () => {
    const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
    const interp = emptyInterpretation(zones);
    const engine = new Engine(registry);
    engine.setWell(toEngineWell(well));
    const run = engine.run(interp);
    const clientRes: ClientResult = {
      ...run,
      context: engineContext(toEngineWell(well), interp),
      wellId: well.id,
      seq: 1,
      gen: 1,
      roundTripMs: 0,
      coalesced: 0,
    };

    // Warm-up JIT antes de medir latencia de superficie 2D sobre Total.
    buildCutoffSurfaceView({
      well,
      interpretation: interp,
      result: clientRes,
      zoneId: null,
      pairId: 'phi-sw',
      metric: 'netPay',
    });

    const summaryRows = (run.outputs.find((o) => o.port === 'ZONE_SUMMARY')?.value as ReadonlyTableValue).rows;
    const totSummary = summaryRows.find((r) => r.zone === 'Total')!;
    const netPayTotal = run.outputs.find((o) => o.port === 'NET_PAY_TOTAL')?.value as number;
    expect(totSummary).toBeDefined();

    for (const pair of SURFACE_PAIRS) {
      const t0 = performance.now();
      const sv = buildCutoffSurfaceView({
        well,
        interpretation: interp,
        result: clientRes,
        zoneId: null,
        pairId: pair.id as SurfacePairId,
        metric: 'netPay',
      })!;
      const elapsed = performance.now() - t0;

      expect(sv).not.toBeNull();
      expect(elapsed).toBeLessThan(15);
      expect(sv.stability.centerValue).toBeCloseTo(Number(totSummary['netPay']), 10);
      expect(sv.stability.centerValue).toBeCloseTo(netPayTotal, 10);
      expect(sv.contours.length).toBeGreaterThanOrEqual(2);
    }

    // Verificar consistencia también para zona individual 'A'.
    const layout = layoutZones(well.depth.values, zones);
    expect(layout.spans.length).toBe(5);
    const za = layout.spans[0]!;
    const zSummary = summaryRows.find((r) => r.zone === za.name)!;
    const zView = buildCutoffSurfaceView({
      well,
      interpretation: interp,
      result: clientRes,
      zoneId: za.id,
      pairId: 'phi-sw',
      metric: 'netPay',
    })!;
    expect(zView.stability.centerValue).toBeCloseTo(Number(zSummary['netPay']), 10);
    expect(sampleThickness(well.depth.values).length).toBe(well.depth.values.length);
  });
});
