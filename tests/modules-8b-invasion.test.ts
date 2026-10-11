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
import { forwardStepProfile } from '../src/petro/invasion';
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

  it('entradas por rol: RA10/RA20/RA30/RM opcionales y RT requerida; salidas RXO, RT, DI e INV_MISFIT', () => {
    const inputs = Object.values(invasionStep.inputs).map((i) => [i.kind === 'curve' ? i.role : '', !!i.optional]);
    expect(inputs).toEqual([['RA10', true], ['RA20', true], ['RA30', true], ['RM', true], ['RT', false]]);
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
    { di: 25, rxo: 6, rt: 1.2 },
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
    expect(warnings(r).some((m) => m.includes('solo 2 curvas') && m.includes('al menos 3'))).toBe(true);
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
    const di = out(r, 'DI');
    for (let i = 0; i < 5; i++) expect(di[i]!, `A ${i}`).toBeGreaterThan(0);
    for (let i = 5; i < 10; i++) expect(di[i]!, `B ${i}`).toBeNaN();
    // el trépano de la zona fija la cota inferior del diámetro
    const r2 = run(arrayWell([{ di: 9, rxo: 5, rt: 1 }, { di: 9, rxo: 5, rt: 1 }]), { params: { global: { 'invasion-step.bitSize': 12 }, zones: {} } });
    expect(out(r2, 'DI')[0]!).toBeGreaterThanOrEqual(12 - 1e-9);
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
    expect(warnings(r).some((m) => m.includes('en la zona A') && m.includes('desajuste alto'))).toBe(true);
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
    expect(warnings(r)).toEqual([]);
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
  const n = at.AT10.length;

  const { well: tpWell, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const r = run(toEngineWell(tpWell), {}, zones);
  const rxo = out(r, 'RXO');
  const rt = out(r, 'RT');
  const di = out(r, 'DI');
  const mf = out(r, 'INV_MISFIT');

  it('el lector asigna los roles que el módulo necesita y el módulo corre sobre las 5810 muestras', () => {
    expect(n).toBe(5810);
    const roles = Object.fromEntries(tpWell.curves.map((c) => [c.id, c.role]));
    expect(roles).toMatchObject({ AT10: 'RA10', AT30: 'RA30', AT60: 'RM', AT90: 'RT' });
    expect(status(r)).toBe('ok');
    expect(rt).toHaveLength(n);
  });

  it('cotas físicas: Rxo, Rt > 0 y finitos; di ≥ trépano (8,5 in) y ≤ 300 donde hay invasión; desajuste ≥ 0', () => {
    let withFit = 0;
    for (let i = 0; i < n; i++) {
      expect(rt[i]!, `Rt ${i}`).toBeGreaterThan(0);
      expect(Number.isFinite(rt[i]!)).toBe(true);
      if (Number.isNaN(di[i]!)) {
        expect(rxo[i]!).toBeNaN();
        expect(mf[i]!).toBeNaN();
        continue;
      }
      withFit++;
      expect(rxo[i]!, `Rxo ${i}`).toBeGreaterThan(0);
      expect(Number.isFinite(rxo[i]!)).toBe(true);
      expect(di[i]!, `di ${i}`).toBeGreaterThanOrEqual(8.5 - 1e-9);
      expect(di[i]!).toBeLessThanOrEqual(300 + 1e-9);
      expect(mf[i]!).toBeGreaterThanOrEqual(0);
    }
    expect(withFit).toBeGreaterThan(3000);
  });

  it('fracción de muestras sin invasión y con desajuste alto (informadas por el módulo)', () => {
    const noInv = Array.from(di).filter((v, i) => Number.isNaN(v) && Number.isFinite(rt[i]!)).length;
    const fitted = n - noInv;
    const high = Array.from(mf).filter((v) => v > 0.15).length;
    // medido en esta versión: 33 % sin invasión (umbral 0,10) y 0,4 % de los ajustes con desajuste > 0,15
    expect(noInv / n).toBeGreaterThan(0.25);
    expect(noInv / n).toBeLessThan(0.4);
    expect(high / fitted).toBeLessThan(0.02);
    expect(high).toBeGreaterThan(0); // los picos de AT10 del README se delatan
    // sin invasión: Rt es exactamente la AT90 cruda
    for (let i = 0; i < n; i++) if (Number.isNaN(di[i]!)) expect(rt[i]!).toBe(at.AT90[i]!);
  });

  it('desajuste recalculado con código propio a partir del modelo directo: coincide con INV_MISFIT', () => {
    const r50 = [10, 30, 60, 90];
    let checked = 0;
    for (let i = 0; i < n; i += 7) {
      if (Number.isNaN(di[i]!)) continue;
      const obs = [at.AT10[i]!, at.AT30[i]!, at.AT60[i]!, at.AT90[i]!];
      const mod = forwardStepProfile(di[i]!, rxo[i]!, rt[i]!, r50);
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
    expect(checked).toBeGreaterThan(300);
  });

  it('los picos de AT10 (> 50 ohm·m, README) quedan con desajuste alto o sin dato, nunca como ajuste bueno', () => {
    let spikes = 0;
    for (let i = 0; i < n; i++) {
      if (at.AT10[i]! < 50 || at.AT10[i]! < 5 * at.AT90[i]!) continue;
      spikes++;
      expect(mf[i]!).toBeGreaterThan(0.15);
    }
    expect(spikes).toBeGreaterThan(0);
  });

  it('medianas por zona: invasión resistiva (Rxo > Rt), Rt cerca de la AT90 y diámetros plausibles', () => {
    const median = (a: number[]): number => {
      const s = a.filter(Number.isFinite).sort((x, y) => x - y);
      return s[Math.floor((s.length - 1) / 2)]!;
    };
    for (const z of ['A', 'B', 'C', 'D', 'E']) {
      const idx = zonaCol.map((q, i) => (q === z ? i : -1)).filter((i) => i >= 0);
      const pick = (a: Float64Array): number[] => idx.map((i) => a[i]!);
      const mRxo = median(pick(rxo));
      const mRt = median(pick(rt));
      const mDi = median(pick(di));
      const mAt90 = median(pick(at.AT90));
      expect(mRxo, `Rxo > Rt en ${z}`).toBeGreaterThan(mRt);
      expect(relErr(mRt, mAt90), `Rt ≈ AT90 en ${z}`).toBeLessThan(0.1);
      expect(mDi, `di de ${z}`).toBeGreaterThan(8.5);
      expect(mDi, `di de ${z}`).toBeLessThan(150);
    }
  });
});
