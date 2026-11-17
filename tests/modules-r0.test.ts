/**
 * Módulo R0 (F16): corre solo con PHIE y RW, comparte a y m con Archie, y en las arenas limpias acuíferas del pozo
 * sintético R0 se superpone con Rt (el generador del demo usa Archie con a = 1, m = DEMO_M y la Rw por defecto).
 */
import { describe, expect, it } from 'vitest';
import { DEMO_M, syntheticWell } from '../src/app/demo/syntheticWell';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import { suggestRole } from '../src/io';
import { registry } from '../src/modules';
import { curve, well, zone } from './helpers';

const out = (r: ReturnType<Engine['run']>, key: string) => r.outputs.find((o) => o.key === key)?.value as Float64Array | undefined;

describe('módulo r0: contrato y registro', () => {
  const mod = registry.get('r0')!;

  it('está registrado en Saturación, pide PHIE y RW, comparte a y m con Archie y produce R0', () => {
    expect(mod.category).toBe('saturation');
    expect(Object.values(mod.inputs).map((i) => (i.kind === 'curve' ? i.role : i.kind)).sort()).toEqual(['PHIE', 'RW']);
    expect(Object.keys(mod.params).sort()).toEqual(['a', 'm']);
    expect(mod.params.a.shared).toBe(true);
    expect(mod.params.m.shared).toBe(true);
    expect(mod.params.m).toBe(registry.get('sw-archie')!.params.m);
    expect(Object.values(mod.outputs).map((o) => (o.kind === 'curve' ? o.role : o.kind))).toEqual(['R0']);
    expect(registry.roles.get('R0')!.origin).toBe('computed');
    expect(registry.roles.get('R0')!.display).toMatchObject({ scale: 'log', min: 0.2, max: 2000 });
  });

  it('documenta la ecuación y sus referencias (alimenta el módulo Ecuaciones)', () => {
    expect(mod.docs.equations.length).toBeGreaterThanOrEqual(1);
    expect(mod.docs.equations[0]!.latex).toContain('R_0');
    expect(mod.docs.references.length).toBeGreaterThanOrEqual(1);
  });

  it('R0 no es un mnemónico de entrada medido (la R0 de los plugs de corona va por otro camino)', () => {
    expect(suggestRole('R0').role).toBeNull();
  });
});

describe('módulo r0: valores contra la fórmula escrita en el test', () => {
  const N = 6;
  const PHIE = [0.2, 0.1, 0.3, NaN, 0, 0.25];
  const RW = [0.05, 0.05, 0.02, 0.05, 0.05, NaN];
  const w = well([curve('PHIE', 'PHIE', PHIE), curve('RW', 'RW', RW)], N);
  const zones = [{ ...zone('z1', 1000, 1001), kind: 'reservoir' as const }, zone('z2', 1001.5, 1002.5)];
  const run = (params: Interpretation['params']) => {
    const e = new Engine(registry);
    e.setWell(w);
    return e.run({ ...emptyInterpretation(zones), params });
  };

  it('por defecto (a = 1, m = 2): a·Rw/φ^m, NaN donde falta un dato o φ = 0', () => {
    const r0 = out(run({ global: {}, zones: {} }), 'r0:R0')!;
    expect(r0[0]).toBeCloseTo(0.05 / 0.04, 12);
    expect(r0[1]).toBeCloseTo(0.05 / 0.01, 12);
    expect(r0[2]).toBeCloseTo(0.02 / 0.09, 12);
    expect([r0[3], r0[4], r0[5]].every(Number.isNaN)).toBe(true);
  });

  it('a y m compartidos: un valor global mueve R0 y la Sw de Archie a la vez; un override por zona solo esa zona', () => {
    const rt = curve('RT', 'RT', [10, 10, 10, 10, 10, 10]);
    const e = new Engine(registry);
    e.setWell(well([rt, curve('PHIE', 'PHIE', PHIE), curve('RW', 'RW', RW)], N));
    const r = e.run({ ...emptyInterpretation(zones), params: { global: { a: 0.81, m: 2.2 }, zones: {} } });
    const r0 = out(r, 'r0:R0')!;
    expect(r0[0]).toBeCloseTo((0.81 * 0.05) / Math.pow(0.2, 2.2), 10);
    // La Sw de Archie con los mismos a y m es (R0/Rt)^(1/n), n = 2 por defecto.
    expect(out(r, 'sw-archie:SW')![0]).toBeCloseTo(Math.sqrt(r0[0]! / 10), 10);
  });
});

describe('pozo de demostración: R0 corre sin pasos extra y se superpone con Rt en el acuífero limpio', () => {
  const demo = syntheticWell();
  const engine = new Engine(registry);
  engine.setWell(toEngineWell(demo.well));
  const rt = demo.well.curves.find((c) => c.role === 'RT')!.data;
  const depth = demo.well.depth.values;
  const AQUIFER = ['A', 'B', 'D', 'E'];

  /** log10(Rt/R0) en las arenas limpias (Vsh < 0,1, φ > 0,05) de las zonas indicadas, con m elegido. */
  function logRatio(zoneNames: string[], m?: number): number[] {
    const base = emptyInterpretation(demo.zones);
    const r = engine.run(m === undefined ? base : { ...base, params: { ...base.params, global: { ...base.params.global, m } } });
    const r0 = out(r, 'r0:R0')!;
    const vsh = out(r, 'vsh:VSH')!;
    const phi = out(r, 'phie-vsh:PHIE')!;
    const sel = demo.zones.filter((z) => zoneNames.includes(z.name));
    const v: number[] = [];
    for (let i = 0; i < rt.length; i++) {
      const d = depth[i]!;
      if (!sel.some((z) => d >= z.top && d <= z.base)) continue;
      if (vsh[i]! < 0.1 && phi[i]! > 0.05 && Number.isFinite(r0[i]!)) v.push(Math.log10(rt[i]! / r0[i]!));
    }
    return v;
  }
  const median = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)]!;

  it('el motor la calcula por defecto con la corrida completa (PHIE y RW existen)', () => {
    const r = engine.run(emptyInterpretation(demo.zones));
    const r0 = out(r, 'r0:R0')!;
    expect(r0).toBeDefined();
    expect(r0.length).toBe(rt.length);
    expect(r0.filter(Number.isFinite).length).toBeGreaterThan(0.85 * rt.length); // NaN solo donde la PHIE no tiene dato (arcillas y bordes)
  });

  // Criterio. El generador pone Rt = ruido / (φ^m/Rw + Vsh/Rsh), con ruido lognormal de σ = 0,08 (0,035 décadas) y la
  // φ de densidad–neutrón sin corregir; el módulo calcula R0 con la PHIE de la app, que no es idéntica. Con m = DEMO_M
  // (el de diseño), a = 1 y arena limpia (Vsh < 0,1) esperamos |log10(Rt/R0)| ≲ 3σ_total: se pide mediana dentro de
  // ±0,03 décadas (≈ ±7 %) y 95 % de las muestras dentro de ±0,10 décadas (±26 %, un ancho de ~2,5 % de la pista de 4
  // décadas). Se midió: mediana +0,00…+0,02 y p5–p95 en −0,06…+0,09.
  it('con m = DEMO_M las dos curvas se superponen en las arenas limpias acuíferas (mediana ±0,03 décadas, 95 % dentro de ±0,10)', () => {
    const lr = logRatio(AQUIFER, DEMO_M);
    expect(lr.length).toBeGreaterThan(1000);
    expect(Math.abs(median(lr))).toBeLessThan(0.03);
    const within = lr.filter((x) => Math.abs(x) <= 0.1).length / lr.length;
    expect(within).toBeGreaterThanOrEqual(0.95);
    // por zona también
    for (const name of AQUIFER) expect(Math.abs(median(logRatio([name], DEMO_M))), name).toBeLessThan(0.03);
  });

  // Con el m por defecto de la app (2, no 1,85) R0 queda ~0,1 décadas por encima de Rt: casi superpuestas, y por
  // debajo de Rt en ninguna muestra, así que el relleno de hidrocarburo no aparece en el acuífero.
  it('con los valores por defecto (m = 2) R0 queda apenas sobre Rt en el acuífero (≤ 0,2 décadas) y casi nunca por debajo', () => {
    const lr = logRatio(AQUIFER);
    expect(Math.abs(median(lr))).toBeLessThan(0.2);
    expect(lr.filter((x) => x > 0).length / lr.length).toBeLessThan(0.02);
  });

  it('en la arena con hidrocarburo (zona C) Rt supera a R0 por más de una década', () => {
    const lr = logRatio(['C'], DEMO_M);
    expect(lr.length).toBeGreaterThan(100);
    expect(median(lr)).toBeGreaterThan(1);
    expect(lr.filter((x) => x > 1).length / lr.length).toBeGreaterThan(0.95);
  });
});
