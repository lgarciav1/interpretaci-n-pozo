/**
 * Pickett interactivo (fase 8b, docs/decisiones/0021, G): ajuste de la recta de agua a la zona acuífera contra casos
 * sintéticos con m y Rw conocidos (con ruido, hidrocarburo residual y rango de φ angosto), valores propios por zona,
 * una recta por zona (arrastrar la de una zona escribe solo esa zona) y deshacer por gesto.
 */
import { describe, expect, it } from 'vitest';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import { emptyHistory, recordChange, undo } from '../../src/core/state/history';
import { addWell, createProject, setParam } from '../../src/core/state/project';
import { sanitizeCrossplot } from '../../src/core/plots';
import { archieRt } from '../../src/plots/crossplot/templates';
import { rwAtFormation, waterLineRt } from '../../src/plots/crossplot/drag';
import { archieSw, fitWaterLine, ownPickettParams, ownValuesNotice, parseWaterHandle, pickettByZone, waterLineDragWrites, waterLineNudgeWrites, type WaterFit, type WaterLineUnit } from '../../src/plots/crossplot/pickett';
import { nudgeParam, plotParamValue, PLOT_PARAMS } from '../../src/plots/params';
import { emptyParamState } from '../../src/core/params';
import { percentile } from '../../src/petro/stats';
import { fitTrend } from '../../src/petro/regression';

/** Generador reproducible (Park–Miller) y normal por Box–Muller. */
function rng(seed: number) {
  let s = seed;
  const u = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return { u, n: () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
}

/** Zona acuífera sintética: Rt = a·Rw/φ^m · e^(σ·ε), φ uniforme en [φ0, φ1]; una fracción con hidrocarburo (Rt × k). */
function waterZone(o: { n: number; a: number; m: number; rw: number; phi: [number, number]; sigma: number; hcFrac?: number; hcFactor?: number; seed?: number }) {
  const r = rng(o.seed ?? 11);
  const phi = new Float64Array(o.n);
  const rt = new Float64Array(o.n);
  for (let i = 0; i < o.n; i++) {
    phi[i] = o.phi[0] + (o.phi[1] - o.phi[0]) * r.u();
    rt[i] = archieRt(phi[i]!, 1, { a: o.a, m: o.m, n: 2, rw: o.rw }) * Math.exp(o.sigma * r.n());
    if (o.hcFrac && r.u() < o.hcFrac) rt[i]! *= o.hcFactor ?? 6;
  }
  return { phi, rt, idx: Int32Array.from({ length: o.n }, (_, i) => i) };
}

const OPTS = { a: 1, mCurrent: 2, mRange: [1, 3.5] as [number, number] };
const ok = (f: WaterFit | { problem: string }): WaterFit => {
  if ('problem' in f) throw new Error(f.problem);
  return f;
};

describe('ajuste de la recta de agua a la zona acuífera', () => {
  it('sin ruido recupera m y Rw exactos', () => {
    const z = waterZone({ n: 200, a: 1, m: 2.2, rw: 0.04, phi: [0.08, 0.3], sigma: 0 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, OPTS));
    expect(f.mode).toBe('m-rw');
    expect(f.m).toBeCloseTo(2.2, 10);
    expect(f.rw).toBeCloseTo(0.04, 10);
    expect(f.r2).toBeCloseTo(1, 10);
  });

  it('con ruido (σ ln Rt = 0,08) y 15 % de muestras con hidrocarburo residual: m ± 0,05 y Rw ± 4 %', () => {
    const z = waterZone({ n: 400, a: 0.81, m: 1.85, rw: 0.032, phi: [0.1, 0.32], sigma: 0.08, hcFrac: 0.15, hcFactor: 8, seed: 5 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, { ...OPTS, a: 0.81 }));
    expect(f.mode).toBe('m-rw');
    expect(Math.abs(f.m - 1.85)).toBeLessThan(0.05);
    expect(Math.abs(f.rw / 0.032 - 1)).toBeLessThan(0.04);
    // El recorte sacó las de hidrocarburo de la regresión de m.
    expect(f.used).toBeLessThan(f.n);
    expect(f.used / f.n).toBeGreaterThan(0.75);
    // Sin recorte (mínimos cuadrados con todos) el hidrocarburo tuerce más la pendiente: el recorte sirve.
    const ols = fitTrend(z.phi, z.rt, 'power')!;
    expect(Math.abs(-ols.b - 1.85)).toBeGreaterThan(Math.abs(f.m - 1.85));
  });

  it('criterio de Rw: con los parámetros ajustados, la mediana de Sw de Archie en la zona es exactamente 1', () => {
    const z = waterZone({ n: 301, a: 1, m: 2, rw: 0.05, phi: [0.12, 0.28], sigma: 0.1, hcFrac: 0.1, seed: 9 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, OPTS));
    const sw = Array.from(z.idx, (i) => archieSw(z.rt[i]!, z.phi[i]!, { a: 1, m: f.m, n: 2, rw: f.rw }));
    expect(percentile(sw, 0.5)).toBeCloseTo(1, 10);
  });

  it('con porosidades en un rango angosto conserva m y ajusta solo Rw (con el m vigente)', () => {
    const z = waterZone({ n: 200, a: 1, m: 2.2, rw: 0.04, phi: [0.19, 0.21], sigma: 0.05, seed: 3 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, { ...OPTS, mCurrent: 2.2 }));
    expect(f.mode).toBe('rw');
    expect(f.reason).toMatch(/angosto/);
    expect(f.m).toBe(2.2);
    expect(Math.abs(f.rw / 0.04 - 1)).toBeLessThan(0.02);
  });

  it('pocos puntos: conserva m; menos de 5: no ajusta', () => {
    const z = waterZone({ n: 12, a: 1, m: 2, rw: 0.04, phi: [0.08, 0.3], sigma: 0.02 });
    expect(ok(fitWaterLine(z.rt, z.phi, z.idx, OPTS)).mode).toBe('rw');
    expect('problem' in fitWaterLine(z.rt, z.phi, [0, 1, 2], OPTS)).toBe(true);
  });

  it('m fuera del rango del parámetro: se conserva m', () => {
    const z = waterZone({ n: 200, a: 1, m: 4.2, rw: 0.04, phi: [0.08, 0.3], sigma: 0 });
    const f = ok(fitWaterLine(z.rt, z.phi, z.idx, OPTS));
    expect(f.mode).toBe('rw');
    expect(f.reason).toMatch(/fuera del rango/);
  });
});

describe('valores propios por zona y una recta por zona', () => {
  const params = emptyParamState();
  params.global[PLOT_PARAMS.rwRef.storage] = 0.05;
  params.zones['zc'] = { [PLOT_PARAMS.rwRef.storage]: 0.03, [PLOT_PARAMS.m.storage]: 1.9 };
  params.zones['zd'] = {};

  it('qué parámetros de la recta tiene propios cada zona', () => {
    expect(ownPickettParams(params, 'zc')).toEqual(['Rw', 'm']);
    expect(ownPickettParams(params, 'zd')).toEqual([]);
    expect(ownPickettParams(params, 'zx')).toEqual([]);
  });

  it('una recta por zona solo con dos o más zonas filtradas y alguna con valores propios', () => {
    expect(pickettByZone(['zc', 'zd'], params)).toBe(true);
    expect(pickettByZone(['zd', 'ze'], params)).toBe(false);
    expect(pickettByZone(['zc'], params)).toBe(false);
    expect(pickettByZone([], params)).toBe(false);
  });

  it('aviso del rótulo con alcance global: cuántas zonas visibles tienen valor propio', () => {
    const vis = [
      { id: 'zc', name: 'C' },
      { id: 'zd', name: 'D' },
    ];
    expect(ownValuesNotice(params, vis, ['Rw'])).toBe('la zona C tiene Rw propio: no cambia');
    expect(ownValuesNotice(params, vis, ['a'])).toBe('');
    const p2 = { ...params, zones: { ...params.zones, zd: { [PLOT_PARAMS.rwRef.storage]: 0.07 } } };
    expect(ownValuesNotice(p2, vis, ['Rw'])).toBe('2 zonas visibles (C, D) tienen Rw propio: no cambian');
  });

  it('ids de manijas: una recta o una por zona', () => {
    expect(parseWaterHandle('water-move')).toEqual({ which: 'move', key: '' });
    expect(parseWaterHandle('water-rotate:zc')).toEqual({ which: 'rotate', key: 'zc' });
    expect(parseWaterHandle('matrix')).toBeNull();
  });

  it('arrastrar la recta de una zona escribe solo esa zona; las otras y el global no cambian; un Ctrl+Z por gesto', () => {
    const demo = syntheticWell();
    const W = demo.well.id;
    const zc = demo.zones[2]!.id;
    const zd = demo.zones[3]!.id;
    let p = addWell(createProject('P'), demo.well, demo.zones);
    p = setParam(p, W, PLOT_PARAMS.rwRef.storage, 0.03, zc);
    const read = (pp: typeof p, z: string | null) => plotParamValue(pp.wells[0]!.interpretation.params, PLOT_PARAMS.rwRef, z);
    const u: WaterLineUnit = { a: 1, m: 2, rw: rwAtFormation(0.03, 24, 80, true), rwRef: 0.03, tRef: 24, tRep: 80, correct: true, manual: true, scope: { zoneId: zc, text: `zona ${demo.zones[2]!.name}` } };
    const before = p;
    let h = emptyHistory();
    // Tres movimientos del mismo gesto: la recta pasa por puntos con el doble de Rt (Rw de formación × 2).
    for (const f of [1.3, 1.7, 2]) {
      const pt = { rt: waterLineRt(0.2, u) * f, phi: 0.2 };
      const writes = waterLineDragWrites(u, 'move', pt);
      expect(writes).toHaveLength(1);
      expect(writes[0]!.zoneId).toBe(zc);
      const prev = p;
      p = writes.reduce((acc, w) => setParam(acc, W, w.storage, w.value, w.zoneId), p);
      h = recordChange(h, prev, 'Cambiar Rw', f * 5000, undefined, 'gesto-1');
    }
    expect(read(p, zc)).toBeCloseTo(0.06, 3); // Arps es una razón: el doble de Rw de formación = el doble de Rw de referencia
    expect(read(p, zd)).toBe(read(before, zd)); // la otra zona no cambia
    expect(read(p, null)).toBe(read(before, null)); // el global tampoco
    expect(h.past).toHaveLength(1);
    const back = undo(h, p)!;
    expect(back.project).toBe(before);
    // Rotar y flechas, en la misma zona.
    expect(waterLineDragWrites(u, 'rotate', { rt: waterLineRt(0.1, { ...u, m: 2.3 }), phi: 0.1 })[0]).toMatchObject({ storage: PLOT_PARAMS.m.storage, zoneId: zc, value: 2.3 });
    // Un paso del slider de Rw (escala log), en la zona de la recta.
    expect(waterLineNudgeWrites(u, 'move', 1, false)[0]).toMatchObject({ storage: PLOT_PARAMS.rwRef.storage, zoneId: zc, value: nudgeParam(PLOT_PARAMS.rwRef.spec, 0.03, 1) });
    expect(waterLineDragWrites({ ...u, manual: false }, 'move', { rt: 10, phi: 0.2 })).toEqual([]);
  });
});

describe('configuración guardada', () => {
  it('la zona acuífera viaja en display.plots y se valida al abrir', () => {
    expect(sanitizeCrossplot({ pickettWaterZones: ['ze', 'ze', 3, ''] }).pickettWaterZones).toEqual(['ze']);
    expect(sanitizeCrossplot({}).pickettWaterZones).toBeUndefined();
    expect('pickettWaterZones' in sanitizeCrossplot({ pickettWaterZones: 'x' })).toBe(false);
  });
});
