/**
 * Módulo `invasion-step` (fase 8b, decisión 0020): contrato, cadena con el motor, avisos por zona, pozo de
 * demostración y el pozo completo del TP (datos/pozo_tp_perfiles.csv).
 *
 * Las columnas del CSV se leen acá aparte (sin el lector de src/io) y el desajuste se recalcula con código propio
 * a partir del modelo directo, para no repetir la implementación del módulo.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { Engine, toEngineWell, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import { BUILTIN_ROLES } from '../src/core/roles';
import type { Zone } from '../src/core/well';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import invasionStep from '../src/modules/invasion-step';
import { forwardStepProfile, invertStepProfile } from '../src/petro/invasion';
import { curve, well, zone } from './helpers';

function run(w: ReturnType<typeof well>, partial: Partial<Interpretation> = {}, zones: Zone[] = []): EngineRunResult {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(w);
  return engine.run({ ...emptyInterpretation(zones), ...partial });
}
const out = (r: EngineRunResult, port: string): Float64Array => {
  const o = r.outputs.find((x) => x.key === `invasion-step:${port}`);
  if (!o) throw new Error(`Falta la salida invasion-step:${port}`);
  return o.value as Float64Array;
};
const warnings = (r: EngineRunResult): string[] => r.diagnostics.filter((d) => d.code === 'module-warning' && d.moduleId === 'invasion-step').map((d) => d.message);
const status = (r: EngineRunResult) => r.nodes.find((x) => x.moduleId === 'invasion-step')?.status;
const relErr = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

const R50 = { RA10: 10, RA20: 20, RA30: 30, RM: 60, RT: 90 } as const;
type Role = keyof typeof R50;

/** Pozo de N muestras con las curvas de arreglo generadas con el modelo directo para cada muestra (di, Rxo, Rt). */
function arrayWell(profiles: { di: number; rxo: number; rt: number }[], roles: Role[] = ['RA10', 'RA30', 'RM', 'RT'], ids: Partial<Record<Role, string>> = {}) {
  const cols = new Map<Role, number[]>(roles.map((r) => [r, []]));
  for (const p of profiles) {
    const v = forwardStepProfile(p.di, p.rxo, p.rt, roles.map((r) => R50[r]));
    roles.forEach((r, k) => cols.get(r)!.push(v[k]!));
  }
  return well(roles.map((r) => curve(ids[r] ?? r, r, cols.get(r)!)), profiles.length);
}

describe('contrato del módulo', () => {
  it('está registrado, en el espacio de petrofísica, con categoría nueva «Resistividad»', () => {
    const m = registry.get('invasion-step')!;
    expect(m).toBe(invasionStep);
    expect(m.category).toBe('resistivity');
    expect(m.categoryLabel).toBe('Resistividad');
    expect(m.workspace).toBe('petrophysics');
    expect(registry.warnings).toEqual([]);
  });

  it('entradas por rol: RA10/RA20/RA30/RM y el trépano BS opcionales, RT requerida; salidas RXO, RT, DI e INV_MISFIT', () => {
    const inputs = Object.values(invasionStep.inputs).map((i) => [i.kind === 'curve' ? i.role : '', !!i.optional]);
    expect(inputs).toEqual([['RA10', true], ['RA20', true], ['RA30', true], ['RM', true], ['RT', false], ['BS', true]]);
    expect(Object.values(invasionStep.outputs).map((o) => (o.kind === 'curve' ? o.role : ''))).toEqual(['RXO', 'RT', 'DI', 'INV_MISFIT']);
  });

  it('parámetros mínimos con tooltip y documentación con ecuaciones y referencias', () => {
    expect(Object.keys(invasionStep.params)).toEqual(['minSeparation', 'maxMisfit', 'bitSize']);
    for (const p of Object.values(invasionStep.params)) expect(p.tooltip?.length ?? 0).toBeGreaterThan(20);
    expect(invasionStep.docs.equations.length).toBeGreaterThanOrEqual(3);
    expect(invasionStep.docs.references.length).toBeGreaterThanOrEqual(3);
    expect(invasionStep.docs.notes).toContain('AT60');
  });

  it('los roles nuevos existen con la unidad canónica y escala esperadas', () => {
    const role = (id: string) => BUILTIN_ROLES.find((r) => r.id === id)!;
    for (const id of ['RA10', 'RA20', 'RA30']) {
      expect(role(id)).toMatchObject({ unit: 'ohm.m', family: 'resistivity', origin: 'measured', display: { scale: 'log' } });
    }
    expect(role('DI')).toMatchObject({ unit: 'in', origin: 'computed' });
    expect(role('INV_MISFIT')).toMatchObject({ unit: 'unitless', origin: 'computed' });
  });
});

describe('cadena con el motor', () => {
  const profiles = [
    { di: 40, rxo: 20, rt: 2 },
    { di: 60, rxo: 0.5, rt: 5 },
    { di: 50, rxo: 6, rt: 1.2 },
    { di: 90, rxo: 15, rt: 3 },
    { di: 35, rxo: 0.8, rt: 8 },
  ];

  it('recupera Rxo, di y Rt de cada muestra (invasión resistiva y conductiva) y no toca la RT medida', () => {
    const w = arrayWell(profiles);
    const r = run(w);
    expect(status(r)).toBe('ok');
    const rxo = out(r, 'RXO');
    const rt = out(r, 'RT');
    const di = out(r, 'DI');
    const mf = out(r, 'INV_MISFIT');
    profiles.forEach((p, i) => {
      expect(relErr(rxo[i]!, p.rxo), `Rxo ${i}`).toBeLessThan(2e-3);
      expect(relErr(rt[i]!, p.rt), `Rt ${i}`).toBeLessThan(2e-3);
      expect(relErr(di[i]!, p.di), `di ${i}`).toBeLessThan(2e-3);
      expect(mf[i]!).toBeLessThan(1e-4);
    });
    // la curva medida sigue siendo la fuente de RT; Rxo, DI y el desajuste vienen del módulo
    expect(r.sources['RT']).toEqual({ kind: 'curve', curveId: 'RT' });
    expect(r.sources['RXO']).toEqual({ kind: 'module', moduleId: 'invasion-step' });
    expect(r.sources['DI']).toEqual({ kind: 'module', moduleId: 'invasion-step' });
    expect(r.outputs.find((o) => o.key === 'invasion-step:RT')!.active).toBe(false);
    expect(r.outputs.find((o) => o.key === 'invasion-step:DI')!.unit).toBe('in');
  });

  it('usa las curvas con el rol correcto sin importar el mnemónico (AT10/AT30/AT60/AT90) y con 5 curvas también', () => {
    const w = arrayWell(profiles, ['RA10', 'RA20', 'RA30', 'RM', 'RT'], { RA10: 'AT10', RA20: 'AT20', RA30: 'AT30', RM: 'AT60', RT: 'AT90' });
    const r = run(w);
    expect(status(r)).toBe('ok');
    profiles.forEach((p, i) => {
      expect(relErr(out(r, 'DI')[i]!, p.di)).toBeLessThan(2e-3);
      expect(relErr(out(r, 'RXO')[i]!, p.rxo)).toBeLessThan(2e-3);
    });
    expect(warnings(r)).toEqual([]);
  });

  it('menos de 3 curvas (RT + RM): todo sin dato y un aviso', () => {
    const r = run(arrayWell(profiles, ['RM', 'RT']));
    expect(status(r)).toBe('ok');
    for (const port of ['RXO', 'RT', 'DI', 'INV_MISFIT']) expect(Array.from(out(r, port)).every(Number.isNaN), port).toBe(true);
    expect(warnings(r).some((m) => m.includes('solo 2 curvas') && m.includes('se usan RM y RT') && m.includes('al menos 3'))).toBe(true);
  });

  it('sin invasión visible: Rt = lectura más profunda, Rxo, DI y desajuste sin dato', () => {
    const w = well([
      curve('RA10', 'RA10', [2.05, 2.1]),
      curve('RA30', 'RA30', [2.03, 2.04]),
      curve('RM', 'RM', [2.01, 2.02]),
      curve('RT', 'RT', [2.0, 2.0]),
    ]);
    const r = run(w);
    expect(Array.from(out(r, 'RT'))).toEqual([2.0, 2.0]);
    for (const port of ['RXO', 'DI', 'INV_MISFIT']) expect(Array.from(out(r, port)).every(Number.isNaN), port).toBe(true);
  });

  it('NaN y valores ≤ 0 en una curva: la muestra se ajusta con las 3 restantes; con 2 válidas queda sin dato', () => {
    const base = arrayWell(profiles.slice(0, 3));
    const patched = base.curves.map((c) => {
      const d = Float64Array.from(c.data);
      if (c.id === 'RA10') d[0] = NaN;
      if (c.id === 'RA10') d[1] = -5;
      if (c.id === 'RA30') d[1] = 0;
      return { ...c, data: d };
    });
    const r = run({ ...base, curves: patched });
    expect(relErr(out(r, 'RT')[0]!, profiles[0]!.rt)).toBeLessThan(2e-3); // 3 curvas válidas
    expect(out(r, 'RT')[1]).toBeNaN(); // 2 válidas
    expect(out(r, 'DI')[1]).toBeNaN();
    expect(warnings(r).some((m) => m.includes('menos de 3 curvas válidas'))).toBe(true);
  });

  it('parámetros por zona: el umbral de separación decide dónde hay invasión', () => {
    // 10 muestras: A (0-4) y B (5-9) con la misma invasión débil (separación ≈ 0,2)
    const prof = Array.from({ length: 10 }, () => ({ di: 30, rxo: 1.6, rt: 1 }));
    const w = arrayWell(prof);
    const zones = [zone('a', 1000, 1002), zone('b', 1002.5, 1004.5)];
    const r = run(w, { params: { global: {}, zones: { b: { 'invasion-step.minSeparation': 0.5 } } } }, zones);
    const mf = out(r, 'INV_MISFIT');
    for (let i = 0; i < 5; i++) expect(Number.isFinite(mf[i]!), `A ${i}`).toBe(true); // hay ajuste
    for (let i = 5; i < 10; i++) expect(mf[i]!, `B ${i}`).toBeNaN(); // sin invasión visible
  });

  it('el trépano fija la cota inferior de di: parámetro bitSize como respaldo y curva BS por muestra cuando existe', () => {
    const prof = [{ di: 40, rxo: 20, rt: 2 }, { di: 40, rxo: 20, rt: 2 }, { di: 40, rxo: 20, rt: 2 }];
    const base = arrayWell(prof);
    // sin BS: bitSize = 50 deja a la invasión de 40 in por debajo de la cota → sin resolver; con el defecto se resuelve
    const noBs50 = run(base, { params: { global: { 'invasion-step.bitSize': 50 }, zones: {} } });
    expect(Array.from(out(noBs50, 'DI')).every(Number.isNaN)).toBe(true);
    expect(relErr(out(run(base), 'DI')[0]!, 40)).toBeLessThan(2e-3);
    // con BS por muestra [8,5 / 50 / sin dato]: el respaldo (8,5) rige en la tercera
    const withBs = { ...base, curves: [...base.curves, curve('BS', 'BS', [8.5, 50, NaN])] };
    const r = run(withBs);
    const di = out(r, 'DI');
    expect(relErr(di[0]!, 40)).toBeLessThan(2e-3);
    expect(di[1]).toBeNaN();
    expect(relErr(di[2]!, 40)).toBeLessThan(2e-3);
  });

  it('avisos: más del 10 % de ajustes con desajuste alto, y zonas casi sin invasión', () => {
    const N = 10;
    const prof = Array.from({ length: N }, () => ({ di: 40, rxo: 5, rt: 1 }));
    const w = arrayWell(prof);
    const patched = w.curves.map((c) => {
      const d = Float64Array.from(c.data);
      if (c.id === 'RA10') for (let i = 0; i < 4; i++) d[i] = 150; // picos en AT10
      return { ...c, data: d };
    });
    const zones = [zone('a', 1000, 1004.5)];
    const r = run({ ...w, curves: patched }, {}, zones);
    expect(warnings(r).some((m) => m.includes('En la zona A') && m.includes('desajuste alto'))).toBe(true);
    for (let i = 0; i < 4; i++) expect(out(r, 'INV_MISFIT')[i]!).toBeGreaterThan(0.15);
    for (let i = 4; i < N; i++) expect(out(r, 'INV_MISFIT')[i]!).toBeLessThan(1e-4);

    const f6 = (v: number) => Array.from({ length: 6 }, () => v);
    const flat = well([curve('RA10', 'RA10', f6(1.03)), curve('RA30', 'RA30', f6(1.02)), curve('RM', 'RM', f6(1.01)), curve('RT', 'RT', f6(1.0))]);
    const r2 = run(flat, {}, [zone('a', 1000, 1002.5)]);
    expect(warnings(r2).some((m) => m.includes('no muestra invasión'))).toBe(true);
  });
});

describe('pozo de demostración', () => {
  const demo = syntheticWell();
  const r = run(toEngineWell(demo.well), {}, demo.zones);
  const curveOf = (id: string) => demo.well.curves.find((c) => c.id === id)!;

  it('trae AT10 (RA10), AT30 (RA30), AT60 (RM) y AT90 (RT) con resistividades positivas y ordenadas por la invasión', () => {
    expect(['AT10', 'AT30', 'AT60', 'AT90'].map((id) => curveOf(id).role)).toEqual(['RA10', 'RA30', 'RM', 'RT']);
    for (const id of ['AT10', 'AT30', 'AT60', 'AT90']) expect(curveOf(id).data.every((v) => v > 0 && Number.isFinite(v)), id).toBe(true);
    expect(demo.well.curves.some((c) => c.role === 'RS')).toBe(false);
  });

  it('el módulo corre y su ajuste reproduce las 4 curvas del demo (desajuste bajo) con cotas físicas', () => {
    expect(status(r)).toBe('ok');
    // las curvas salen de un perfil escalonado exacto: ningún aviso de desajuste (sí de di mal resuelto en las zonas con poca arena)
    expect(warnings(r).filter((m) => m.includes('desajuste'))).toEqual([]);
    const rxo = out(r, 'RXO');
    const rt = out(r, 'RT');
    const di = out(r, 'DI');
    const mf = out(r, 'INV_MISFIT');
    let ok = 0;
    for (let i = 0; i < di.length; i++) {
      if (Number.isNaN(di[i]!)) continue;
      ok++;
      expect(rxo[i]!).toBeGreaterThan(0);
      expect(rt[i]!).toBeGreaterThan(0);
      expect(di[i]!).toBeGreaterThanOrEqual(8.5 - 1e-9);
      expect(mf[i]!).toBeLessThan(1e-3); // las curvas salen de un perfil escalonado exacto
    }
    expect(ok).toBeGreaterThan(1000);
  });

  it('una muestra de arena de la zona C con hidrocarburo: Rxo < Rt (invasión conductiva) y Rt cerca de la RT del demo', () => {
    const rtCurve = curveOf('AT90').data;
    const zc = demo.zones[2]!;
    const di = out(r, 'DI');
    const rxo = out(r, 'RXO');
    const rt = out(r, 'RT');
    let found = 0;
    for (let i = 0; i < di.length; i++) {
      const d = demo.well.depth.values[i]!;
      if (d < zc.top || d > zc.base || Number.isNaN(di[i]!) || rt[i]! < 15) continue;
      found++;
      expect(rxo[i]!).toBeLessThan(rt[i]!);
      expect(rt[i]!).toBeGreaterThan(rtCurve[i]! * 0.9); // la Rt corregida es ≥ la AT90, que lee algo de zona lavada
    }
    expect(found).toBeGreaterThan(20);
  });
});

describe('pozo del TP completo (datos/pozo_tp_perfiles.csv)', () => {
  // Columnas crudas leídas aparte (sin src/io)
  const lines = csvText.trim().split(/\r?\n/);
  const header = lines[0]!.split(',');
  const raw = (name: string): Float64Array => {
    const idx = header.indexOf(name);
    return Float64Array.from(lines.slice(1).map((l) => {
      const v = l.split(',')[idx]!;
      return v === '' ? NaN : Number(v);
    }));
  };
  const zonaCol = lines.slice(1).map((l) => l.split(',')[header.indexOf('ZONA')]!);
  const at = { AT10: raw('AT10'), AT30: raw('AT30'), AT60: raw('AT60'), AT90: raw('AT90') };
  const R50_TP = [10, 30, 60, 90];
  const readingsAt = (i: number) => [at.AT10[i]!, at.AT30[i]!, at.AT60[i]!, at.AT90[i]!].map((v, k) => ({ r50: R50_TP[k]!, resistivity: v }));
  const n = at.AT10.length;

  const { well: tpWell, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const r = run(toEngineWell(tpWell), {}, zones);
  const rxo = out(r, 'RXO');
  const rt = out(r, 'RT');
  const di = out(r, 'DI');
  const mf = out(r, 'INV_MISFIT');
  // Estado de cada muestra con el motor puro sobre las columnas crudas
  const fits = Array.from({ length: n }, (_, i) => invertStepProfile(readingsAt(i)));
  const count = (pred: (f: (typeof fits)[number]) => boolean): number => fits.filter(pred).length;

  it('el lector asigna los roles que el módulo necesita y el módulo corre sobre las 5810 muestras', () => {
    expect(n).toBe(5810);
    const roles = Object.fromEntries(tpWell.curves.map((c) => [c.id, c.role]));
    expect(roles).toMatchObject({ AT10: 'RA10', AT30: 'RA30', AT60: 'RM', AT90: 'RT' });
    expect(status(r)).toBe('ok');
    expect(rt).toHaveLength(n);
  });

  it('las salidas del módulo siguen el estado de cada muestra: ok emite todo; mal resuelto, Rt y desajuste; sin resolver y sin invasión, Rt = AT90', () => {
    for (let i = 0; i < n; i++) {
      const f = fits[i]!;
      const ctx = `muestra ${i} (${f.status})`;
      if (f.status === 'ok') {
        expect(di[i]!, ctx).toBeCloseTo(f.di, 9);
        if (f.rxoAtBound) expect(rxo[i]!, ctx).toBeNaN();
        else expect(rxo[i]!, ctx).toBeCloseTo(f.rxo, 9);
        expect(rt[i]!, ctx).toBeCloseTo(f.rt, 9);
        expect(mf[i]!, ctx).toBeCloseTo(f.misfit, 9);
      } else if (f.status === 'poorly-resolved') {
        expect(rxo[i]!, ctx).toBeNaN();
        expect(di[i]!, ctx).toBeNaN();
        expect(rt[i]!, ctx).toBeCloseTo(f.rt, 9);
        expect(mf[i]!, ctx).toBeCloseTo(f.misfit, 9);
      } else if (f.status === 'unresolved') {
        expect(rxo[i]!, ctx).toBeNaN();
        expect(di[i]!, ctx).toBeNaN();
        expect(rt[i]!, ctx).toBe(at.AT90[i]!);
        expect(Number.isFinite(mf[i]!), ctx).toBe(true);
      } else {
        expect(f.status, ctx).toBe('no-invasion');
        expect(rxo[i]!, ctx).toBeNaN();
        expect(di[i]!, ctx).toBeNaN();
        expect(mf[i]!, ctx).toBeNaN();
        expect(rt[i]!, ctx).toBe(at.AT90[i]!);
      }
    }
  });

  it('cotas físicas: Rt > 0 en todo el pozo; Rxo emitido en (0, 10⁴) ohm·m; di emitido en [8,5, 300] in; desajuste ≥ 0', () => {
    let emittedDi = 0;
    for (let i = 0; i < n; i++) {
      expect(rt[i]!, `Rt ${i}`).toBeGreaterThan(0);
      expect(Number.isFinite(rt[i]!)).toBe(true);
      if (Number.isFinite(rxo[i]!)) {
        expect(rxo[i]!, `Rxo ${i}`).toBeGreaterThan(0);
        expect(rxo[i]!, `Rxo ${i} (nunca en la cota de σ: antes salían 10⁵ ohm·m)`).toBeLessThan(1e4);
      }
      if (Number.isFinite(di[i]!)) {
        emittedDi++;
        expect(di[i]!, `di ${i}`).toBeGreaterThanOrEqual(8.5 - 1e-9);
        expect(di[i]!).toBeLessThanOrEqual(300 + 1e-9);
      }
      if (Number.isFinite(mf[i]!)) expect(mf[i]!).toBeGreaterThanOrEqual(0);
    }
    expect(emittedDi).toBeGreaterThan(500);
  });

  it('fracción de muestras por estado (medido en esta versión, umbral 0,10, δ = 0,02)', () => {
    const frac = (x: number): number => x / n;
    const noInv = count((f) => f.status === 'no-invasion');
    const ok = count((f) => f.status === 'ok');
    const poorly = count((f) => f.status === 'poorly-resolved');
    const unresolved = count((f) => f.status === 'unresolved');
    // 33 % sin invasión, 12 % ok, 42 % mal resuelto, 13 % sin resolver (6,5 % pegado al trépano, 5,7 % en el máximo)
    expect(noInv + ok + poorly + unresolved).toBe(n);
    expect(frac(noInv)).toBeGreaterThan(0.28);
    expect(frac(noInv)).toBeLessThan(0.38);
    expect(frac(ok)).toBeGreaterThan(0.08);
    expect(frac(ok)).toBeLessThan(0.17);
    expect(frac(poorly)).toBeGreaterThan(0.35);
    expect(frac(poorly)).toBeLessThan(0.5);
    expect(frac(unresolved)).toBeGreaterThan(0.08);
    expect(frac(unresolved)).toBeLessThan(0.18);
    expect(count((f) => f.reason === 'shallow')).toBeGreaterThan(300);
    expect(count((f) => f.reason === 'deep')).toBeGreaterThan(250);
    // σxo pegado a una cota: ~ 6 % de los ajustes interiores (antes salían Rxo = 10⁵ ohm·m en el 9,6 %)
    const interior = ok + poorly;
    const rxoBound = count((f) => (f.status === 'ok' || f.status === 'poorly-resolved') && f.rxoAtBound);
    expect(rxoBound / interior).toBeGreaterThan(0.04);
    expect(rxoBound / interior).toBeLessThan(0.18);
    // desajuste alto (> 0,15): una fracción chica de los ajustes, y están los picos de AT10
    const fitted = ok + poorly + unresolved;
    const high = Array.from(mf).filter((v) => v > 0.15).length;
    expect(high / fitted).toBeLessThan(0.02);
    expect(high).toBeGreaterThan(0);
  });

  describe('filas verificadas por una revisión independiente (índices desde 0; tolerancia 0,5 % y 10⁻⁴ en misfit)', () => {
    const table: [number, number[], number, number, number, number, 'ok' | 'poorly-resolved'][] = [
      [0, [0.76, 0.659, 0.636, 0.613], 32.1, 0.869, 0.605, 0.0077, 'poorly-resolved'],
      [1000, [2.121, 1.772, 1.548, 1.52], 59.3, 2.358, 1.409, 0.0097, 'poorly-resolved'],
      [3000, [1.244, 0.59, 0.473, 0.447], 36.6, 6.96, 0.411, 0.0025, 'ok'],
      [4000, [0.962, 0.571, 0.472, 0.446], 41.5, 1.742, 0.412, 0.0009, 'ok'],
      [5809, [5.277, 2.127, 1.092, 0.834], 168.7, 9.39, 0.452, 0.0128, 'ok'],
    ];
    for (const [i, vals, diRef, rxoRef, rtRef, mfRef, st] of table) {
      it(`fila ${i}: di ${diRef}, Rxo ${rxoRef}, Rt ${rtRef}, misfit ${mfRef} (${st})`, () => {
        expect([at.AT10[i], at.AT30[i], at.AT60[i], at.AT90[i]]).toEqual(vals);
        const f = fits[i]!;
        expect(f.status).toBe(st);
        expect(relErr(f.di, diRef)).toBeLessThan(5e-3);
        expect(relErr(f.rxo, rxoRef)).toBeLessThan(5e-3);
        expect(relErr(f.rt, rtRef)).toBeLessThan(5e-3);
        expect(Math.abs(f.misfit - mfRef)).toBeLessThan(1e-4);
        // y lo que sale en las curvas
        expect(relErr(rt[i]!, rtRef)).toBeLessThan(5e-3);
        expect(Math.abs(mf[i]!- mfRef)).toBeLessThan(1e-4);
        if (st === 'ok') {
          expect(relErr(di[i]!, diRef)).toBeLessThan(5e-3);
          expect(relErr(rxo[i]!, rxoRef)).toBeLessThan(5e-3);
        } else {
          expect(di[i]).toBeNaN(); // el intervalo de di es más ancho que un factor 2
          expect(rxo[i]).toBeNaN();
          expect(f.diHigh / f.diLow).toBeGreaterThan(2);
        }
      });
    }

    it('filas 400, 2500, 4500 y 5000: sin invasión, Rt = AT90', () => {
      for (const i of [400, 2500, 4500, 5000]) {
        expect(fits[i]!.status, `fila ${i}`).toBe('no-invasion');
        expect(rt[i]!).toBe(at.AT90[i]!);
        expect(di[i]).toBeNaN();
        expect(rxo[i]).toBeNaN();
        expect(mf[i]).toBeNaN();
      }
    });

    it('fila 3024 (AT10/30/60/90 = 2,106 / 0,913 / 0,782 / 0,846): el ajuste pedía Rxo = 10⁵ ohm·m; ahora Rxo queda sin dato y di y Rt se mantienen', () => {
      expect([at.AT10[3024], at.AT30[3024], at.AT60[3024], at.AT90[3024]]).toEqual([2.106, 0.913, 0.782, 0.846]);
      expect(fits[3024]!.rxoAtBound).toBe(true);
      expect(rxo[3024]).toBeNaN();
      expect(Number.isFinite(di[3024]!)).toBe(true);
      expect(rt[3024]!).toBeGreaterThan(0.6);
      expect(rt[3024]!).toBeLessThan(0.85);
    });
  });

  it('desajuste recalculado con código propio a partir del modelo directo: coincide con INV_MISFIT en los ajustes que emiten Rxo y di', () => {
    let checked = 0;
    for (let i = 0; i < n; i += 3) {
      if (!Number.isFinite(di[i]!) || !Number.isFinite(rxo[i]!)) continue;
      const obs = [at.AT10[i]!, at.AT30[i]!, at.AT60[i]!, at.AT90[i]!];
      const mod = forwardStepProfile(di[i]!, rxo[i]!, rt[i]!, R50_TP);
      const sigma = obs.map((v) => 1 / v);
      const sMax = Math.max(...sigma);
      let ss = 0;
      obs.forEach((_v, k) => {
        const res = (1 / mod[k]! - sigma[k]!) / Math.max(sigma[k]!, 0.05 * sMax);
        ss += res * res;
      });
      expect(Math.sqrt(ss / 4), `muestra ${i}`).toBeCloseTo(mf[i]!, 9);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('los picos de AT10 (> 50 ohm·m, README) quedan con desajuste alto, nunca como ajuste bueno', () => {
    let spikes = 0;
    for (let i = 0; i < n; i++) {
      if (at.AT10[i]! < 50 || at.AT10[i]! < 5 * at.AT90[i]!) continue;
      spikes++;
      expect(mf[i]!).toBeGreaterThan(0.15);
    }
    expect(spikes).toBeGreaterThan(0);
  });

  it('medianas por zona de los ajustes con Rxo y di emitidos: invasión resistiva (Rxo > Rt), Rt por debajo de AT90 y diámetros plausibles', () => {
    const median = (a: number[]): number => {
      const x = [...a].sort((u, v) => u - v);
      return x[Math.floor((x.length - 1) / 2)]!;
    };
    let zonesChecked = 0;
    for (const z of ['A', 'B', 'C', 'D', 'E']) {
      const idx = zonaCol.map((q, i) => (q === z && Number.isFinite(di[i]!) && Number.isFinite(rxo[i]!) ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 3) continue; // C casi no tiene ajustes resueltos
      zonesChecked++;
      const mRxo = median(idx.map((i) => rxo[i]!));
      const mRt = median(idx.map((i) => rt[i]!));
      const mDi = median(idx.map((i) => di[i]!));
      const ratio = median(idx.map((i) => rt[i]! / at.AT90[i]!));
      expect(mRxo, `Rxo > Rt en ${z}`).toBeGreaterThan(mRt);
      // la AT90 lee algo de zona lavada: la Rt corregida es menor (−5 % a −35 % en las medianas; en E, con di ≈ 100 in, 0,67)
      expect(ratio, `Rt/AT90 en ${z}`).toBeGreaterThan(0.6);
      expect(ratio, `Rt/AT90 en ${z}`).toBeLessThan(1.05);
      expect(mDi, `di de ${z}`).toBeGreaterThan(8.5);
      expect(mDi, `di de ${z}`).toBeLessThan(150);
      expect(Math.max(...idx.map((i) => rxo[i]!)), `Rxo máximo en ${z}`).toBeLessThan(1e4);
    }
    expect(zonesChecked).toBeGreaterThanOrEqual(3);
  });

  it('Rt de todos los ajustes (interiores, incluso los de di mal resuelto) cerca de AT90: el 95 % entre 0,6 y 1,1 veces', () => {
    const ratios: number[] = [];
    for (let i = 0; i < n; i++) {
      if (fits[i]!.status === 'ok' || fits[i]!.status === 'poorly-resolved') ratios.push(rt[i]! / at.AT90[i]!);
    }
    expect(ratios.length).toBeGreaterThan(3000);
    const inside = ratios.filter((x) => x >= 0.6 && x <= 1.1).length / ratios.length;
    expect(inside).toBeGreaterThan(0.95);
    const sorted = [...ratios].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]!).toBeGreaterThan(0.85);
    expect(sorted[Math.floor(sorted.length / 2)]!).toBeLessThan(1.02);
  });
});
