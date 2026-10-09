/**
 * Módulos de la fase 6a (parte petrofísica, C1–C3, C5–C10, C13–C18): cada uno entrega los mismos valores por muestra
 * que la función de `src/petro/` que envuelve, respeta los overrides por zona y la cadena
 * GR → IGR → VSH → PHIE → SW → PERM corre completa. Ver docs/decisiones/0007-modulos-fase-6a.md.
 */
import { describe, expect, it } from 'vitest';
import { Engine, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import { registry } from '../src/modules';
import { gammaRayIndexInto } from '../src/petro/igr';
import { bulkVolumeWater, hydrocarbonSaturation } from '../src/petro/saturation';
import { vshFromIgr } from '../src/petro/vsh';
import {
  densityNeutronGasPorosity,
  densityNeutronPorosity,
  densityPorosity,
  effectivePorosity,
  neutronPorosity,
  shaleCorrectedPorosity,
  sonicPorosityRaymer,
} from '../src/petro/porosity';
import { archieSw, indonesiaSw, simandouxSw } from '../src/petro/saturation';
import { timurCoatesPermeability, timurPermeability } from '../src/petro/permeability';
import { arpsResistivityC, formationTemperature } from '../src/petro/temperature';
import { curve, well, zone } from './helpers';

// --- pozo sintético: 90 muestras cada 0,5 m (1000–1044,5 m), tres zonas de 30 muestras ----------------------------
const N = 90;
const DEPTH0 = 1000;
const STEP = 0.5;
const ZONES = [zone('za', 1000, 1014.5), zone('zb', 1015, 1029.5), zone('zc', 1030, 1044.5)];
const [ZA, ZB, ZC] = ZONES.map((z) => z.id) as [string, string, string];
const inZone = (i: number) => (i < 30 ? 0 : i < 60 ? 1 : 2);
const wave = (i: number, period: number, phase = 0) => Math.sin((2 * Math.PI * i) / period + phase);
const series = (f: (i: number) => number) => Float64Array.from({ length: N }, (_, i) => f(i));

const GR = series((i) => 75 + 55 * wave(i, 17));
const RHOB = series((i) => 2.4 + 0.15 * wave(i, 13, 1));
const NPHI = series((i) => 0.2 + 0.08 * wave(i, 11, 2));
const DT = series((i) => 85 + 20 * wave(i, 19));
const RT = series((i) => 12 + 10 * wave(i, 23, 0.5));
const BVI = series((i) => 0.04 + 0.01 * wave(i, 7));
const PHIE_NMR = series((i) => 0.18 + 0.05 * wave(i, 9));

const WELL = well(
  [
    curve('GR', 'GR', GR),
    curve('RHOB', 'RHOB', RHOB),
    curve('NPHI', 'NPHI', NPHI),
    curve('DT', 'DT', DT),
    curve('RT', 'RT', RT),
    curve('BVI', 'BVI_NMR', BVI),
    curve('PHIE_NMR', 'PHIE_NMR', PHIE_NMR),
  ],
  N,
  DEPTH0,
  STEP,
);

/** Los quince módulos de este agente, para pedir sus salidas aunque no alimenten la cadena. */
const MINE = [
  'vsh', 'phi-density', 'phi-neutron', 'phi-sonic-raymer', 'phit', 'phie-vsh', 'phie-shale-corrected',
  'temp-gradient', 'rw-manual', 'sw-archie', 'sw-simandoux', 'sw-indonesia', 'bvw-sh', 'perm-timur', 'perm-coates',
];

function run(partial: Partial<Interpretation> = {}): EngineRunResult {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(WELL);
  return engine.run({ ...emptyInterpretation(ZONES), compare: MINE, ...partial });
}
const params = (global: Record<string, number | string | boolean>, zones: Record<string, Record<string, number | string | boolean>> = {}) => ({
  global,
  zones,
});
function curveOf(r: EngineRunResult, key: string): Float64Array {
  const o = r.outputs.find((x) => x.key === key);
  if (!o) throw new Error(`Falta la salida ${key}`);
  return o.value as Float64Array;
}
function expectSamples(actual: Float64Array, expected: (i: number) => number, digits = 12) {
  expect(actual.length).toBe(N);
  for (let i = 0; i < N; i++) {
    const e = expected(i);
    if (Number.isNaN(e)) expect(actual[i], `muestra ${i}`).toBeNaN();
    else expect(actual[i], `muestra ${i}`).toBeCloseTo(e, digits);
  }
}

// Defaults de los parámetros (los de las fichas del 0007).
const IGR = (() => {
  const out = new Float64Array(N);
  gammaRayIndexInto(GR, out, 30, 120);
  return out;
})();
const PHID = series((i) => densityPorosity(RHOB[i]!, 2.65, 1));
const PHIN = series((i) => neutronPorosity(NPHI[i]!, 0));
const PHIS = series((i) => sonicPorosityRaymer(DT[i]!, 55.5));
const PHIT = series((i) => densityNeutronPorosity(PHID[i]!, PHIN[i]!));
const VSH = series((i) => vshFromIgr(IGR[i]!, 'linear'));
const PHIE = series((i) => effectivePorosity(PHIT[i]!, VSH[i]!));
const TEMP = series((i) => formationTemperature(DEPTH0 + i * STEP, 20, 3 / 100));
const RW = series((i) => arpsResistivityC(0.05, 24, TEMP[i]!));

describe('módulos 6a de petrofísica: valores por muestra = función de petro', () => {
  const r = run();

  it('el registro quedó sin errores y todos los módulos corren en ok', () => {
    expect(r.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    for (const id of MINE) expect(r.nodes.find((x) => x.moduleId === id)?.status, id).toBe('ok');
  });

  it('C1 vsh: método por zona (lineal por defecto)', () => {
    expectSamples(curveOf(r, 'vsh:VSH'), (i) => VSH[i]!);
    const r2 = run({ params: params({}, { [ZB]: { 'vsh.method': 'clavier' }, [ZC]: { 'vsh.method': 'steiber' } }) });
    const v = curveOf(r2, 'vsh:VSH');
    expectSamples(v, (i) => vshFromIgr(IGR[i]!, ['linear', 'clavier', 'steiber'][inZone(i)] as 'linear' | 'clavier' | 'steiber'));
  });

  it('C2 phi-density', () => {
    expectSamples(curveOf(r, 'phi-density:PHID'), (i) => PHID[i]!);
  });

  it('C3 phi-neutron', () => {
    expectSamples(curveOf(r, 'phi-neutron:PHIN'), (i) => PHIN[i]!);
  });

  it('C5 phi-sonic-raymer', () => {
    expectSamples(curveOf(r, 'phi-sonic-raymer:PHIS'), (i) => PHIS[i]!);
  });

  it('C6 phit: automático = densidad–neutrón; métodos por zona', () => {
    expectSamples(curveOf(r, 'phit:PHIT'), (i) => PHIT[i]!);
    const r2 = run({
      params: params({}, { [ZB]: { 'phit.method': 'densityNeutronGas' }, [ZC]: { 'phit.method': 'sonic' } }),
      // Wyllie es la fuente por defecto de PHIS (va antes en el registro); acá se fija Raymer.
      sources: { PHIS: { kind: 'module', moduleId: 'phi-sonic-raymer' } },
    });
    expectSamples(curveOf(r2, 'phit:PHIT'), (i) => {
      const z = inZone(i);
      if (z === 0) return PHIT[i]!;
      if (z === 1) return densityNeutronGasPorosity(PHID[i]!, PHIN[i]!);
      return PHIS[i]!;
    });
  });

  it('C7 phie-vsh y C8 phie-shale-corrected', () => {
    expectSamples(curveOf(r, 'phie-vsh:PHIE'), (i) => PHIE[i]!);
    expectSamples(curveOf(r, 'phie-shale-corrected:PHIE'), (i) => shaleCorrectedPorosity(PHIT[i]!, VSH[i]!, 0.2));
  });

  it('C9 temp-gradient', () => {
    expectSamples(curveOf(r, 'temp-gradient:TEMP'), (i) => TEMP[i]!);
    // origen de la temperatura de superficie a otra profundidad
    const r2 = run({ params: params({ 'temp-gradient.datum': 500, 'temp-gradient.gradient': 2.5, 'temp-gradient.tSurface': 10 }) });
    expectSamples(curveOf(r2, 'temp-gradient:TEMP'), (i) => formationTemperature(DEPTH0 + i * STEP - 500, 10, 2.5 / 100));
  });

  it('C10 rw-manual: corrige por temperatura o usa el valor tal cual', () => {
    expectSamples(curveOf(r, 'rw-manual:RW'), (i) => RW[i]!);
    const r2 = run({ params: params({}, { [ZB]: { 'rw-manual.correct': false, 'rw-manual.rwRef': 0.08 } }) });
    expectSamples(curveOf(r2, 'rw-manual:RW'), (i) => (inZone(i) === 1 ? 0.08 : RW[i]!));
  });

  it('C13–C15 saturación de agua (a = 1, m = 2, n = 2, Rsh = 2)', () => {
    expectSamples(curveOf(r, 'sw-archie:SW'), (i) => archieSw(RT[i]!, PHIE[i]!, RW[i]!, 1, 2, 2));
    expectSamples(curveOf(r, 'sw-simandoux:SW'), (i) => simandouxSw(RT[i]!, PHIE[i]!, VSH[i]!, RW[i]!, 2, 1, 2));
    expectSamples(curveOf(r, 'sw-indonesia:SW'), (i) => indonesiaSw(RT[i]!, PHIE[i]!, VSH[i]!, RW[i]!, 2, 1, 2, 2));
  });

  it('C16 bvw-sh (sobre el Sw de Archie, la fuente por defecto de SW)', () => {
    const sw = series((i) => archieSw(RT[i]!, PHIE[i]!, RW[i]!, 1, 2, 2));
    expectSamples(curveOf(r, 'bvw-sh:BVW'), (i) => bulkVolumeWater(PHIE[i]!, sw[i]!));
    expectSamples(curveOf(r, 'bvw-sh:SH'), (i) => hydrocarbonSaturation(sw[i]!));
  });

  it('C17 perm-timur: Swirr fija o Sw calculada', () => {
    expectSamples(curveOf(r, 'perm-timur:PERM'), (i) => timurPermeability(PHIE[i]!, 0.25), 6);
    const sw = series((i) => archieSw(RT[i]!, PHIE[i]!, RW[i]!, 1, 2, 2));
    const r2 = run({ params: params({}, { [ZC]: { 'perm-timur.swirrFrom': 'sw' }, [ZA]: { 'perm-timur.swirr': 0.3 } }) });
    expectSamples(
      curveOf(r2, 'perm-timur:PERM'),
      (i) => timurPermeability(PHIE[i]!, inZone(i) === 2 ? sw[i]! : inZone(i) === 0 ? 0.3 : 0.25),
      6,
    );
  });

  it('C18 perm-coates: porosidad RMN (default) o efectiva de perfiles; constante C por zona', () => {
    expectSamples(curveOf(r, 'perm-coates:PERM'), (i) => timurCoatesPermeability(PHIE_NMR[i]!, BVI[i]!, 10), 6);
    const r2 = run({ params: params({}, { [ZB]: { 'perm-coates.porosity': 'phie', 'perm-coates.c': 8 } }) });
    expectSamples(
      curveOf(r2, 'perm-coates:PERM'),
      (i) => (inZone(i) === 1 ? timurCoatesPermeability(PHIE[i]!, BVI[i]!, 8) : timurCoatesPermeability(PHIE_NMR[i]!, BVI[i]!, 10)),
      6,
    );
  });
});

describe('módulos 6a de petrofísica: parámetros compartidos con override por zona', () => {
  it('m en la zona B cambia Archie, Simandoux e Indonesia solo en esa zona', () => {
    const base = run();
    const r = run({ params: params({}, { [ZB]: { m: 2.3 } }) });
    for (const key of ['sw-archie:SW', 'sw-simandoux:SW', 'sw-indonesia:SW']) {
      const a = curveOf(base, key);
      const b = curveOf(r, key);
      let changed = 0;
      for (let i = 0; i < N; i++) {
        if (inZone(i) === 1) {
          if (b[i] !== a[i]) changed++;
        } else expect(b[i], `${key} ${i}`).toBe(a[i]);
      }
      expect(changed, key).toBeGreaterThan(10);
    }
    expectSamples(curveOf(r, 'sw-archie:SW'), (i) => archieSw(RT[i]!, PHIE[i]!, RW[i]!, 1, inZone(i) === 1 ? 2.3 : 2, 2));
  });

  it('dtMa en la zona C cambia el sónico solo en esa zona', () => {
    const r = run({ params: params({}, { [ZC]: { dtMa: 47.5 } }) });
    expectSamples(curveOf(r, 'phi-sonic-raymer:PHIS'), (i) => sonicPorosityRaymer(DT[i]!, inZone(i) === 2 ? 47.5 : 55.5));
  });

  it('Rsh en la zona A recalcula Simandoux e Indonesia y no Archie', () => {
    const first = new Engine(registry, { checkInputs: true });
    first.setWell(WELL);
    const base = { ...emptyInterpretation(ZONES), compare: MINE };
    first.run(base);
    const r = first.run({ ...base, params: params({}, { [ZA]: { rsh: 5 } }) });
    expect(r.stats.recomputed).toEqual(expect.arrayContaining(['sw-simandoux', 'sw-indonesia']));
    expect(r.stats.recomputed).not.toContain('sw-archie');
  });
});

describe('módulos 6a de petrofísica: avisos', () => {
  const msgs = (r: EngineRunResult) => r.diagnostics.filter((d) => d.code === 'module-warning').map((d) => d.message);

  it('densidad: matriz que no supera al fluido, nombrando la zona', () => {
    const r = run({ params: params({}, { [ZB]: { 'phi-density.rhoMa': 0.9 } }) });
    expect(msgs(r).some((m) => m.includes('en la zona ZB') && m.includes('densidad de la matriz'))).toBe(true);
  });

  it('phit: método que necesita una curva ausente', () => {
    const noSonic = new Engine(registry, { checkInputs: true });
    // sin DT no hay PHIS
    noSonic.setWell(well(WELL.curves.filter((c) => c.role !== 'DT'), N, DEPTH0, STEP));
    const r = noSonic.run({ ...emptyInterpretation(ZONES), params: params({}, { [ZC]: { 'phit.method': 'sonic' } }) });
    const m = r.diagnostics.filter((d) => d.code === 'module-warning').map((d) => d.message);
    expect(m.some((x) => x.includes('zona ZC') && x.includes('PHIS'))).toBe(true);
    const phit = curveOf(r, 'phit:PHIT');
    expect(phit[75]).toBeNaN();
    expect(phit[5]).toBeCloseTo(PHIT[5]!, 12);
  });

  it('perm-timur con Sw calculada y sin curva de Sw usa Swirr fija y avisa', () => {
    const e = new Engine(registry, { checkInputs: true });
    e.setWell(WELL);
    // Sw nunca se pide a un módulo desactivado: la entrada opcional queda ausente
    const r = e.run({
      ...emptyInterpretation(ZONES),
      disabled: ['sw-archie', 'sw-simandoux', 'sw-indonesia'],
      params: params({}, { [ZB]: { 'perm-timur.swirrFrom': 'sw' } }),
    });
    expect(msgs(r).some((m) => m.includes('zona ZB') && m.includes('Sw'))).toBe(true);
    expectSamples(curveOf(r, 'perm-timur:PERM'), (i) => timurPermeability(PHIE[i]!, 0.25), 6);
  });

  it('perm-coates sin porosidad RMN usa la efectiva y avisa', () => {
    const e = new Engine(registry, { checkInputs: true });
    e.setWell(well(WELL.curves.filter((c) => c.role !== 'PHIE_NMR'), N, DEPTH0, STEP));
    const r = e.run({ ...emptyInterpretation(ZONES), compare: ['perm-coates'] });
    expect(msgs(r).some((m) => m.includes('porosidad RMN') && m.includes('efectiva'))).toBe(true);
    expectSamples(curveOf(r, 'perm-coates:PERM'), (i) => timurCoatesPermeability(PHIE[i]!, BVI[i]!, 10), 6);
  });
});

describe('cadena GR → IGR → VSH → PHIE → SW → PERM', () => {
  it('corre completa con las fuentes por defecto (sin elegir nada) y queda en ok', () => {
    const e = new Engine(registry, { checkInputs: true });
    e.setWell(WELL);
    const r = e.run(emptyInterpretation(ZONES));
    expect(r.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    const ok = new Set(r.nodes.filter((x) => x.status === 'ok').map((x) => x.moduleId));
    for (const id of ['igr', 'vsh', 'phi-density', 'phi-neutron', 'phit', 'phie-vsh', 'temp-gradient', 'rw-manual', 'sw-archie', 'bvw-sh', 'perm-timur']) {
      expect(ok.has(id), id).toBe(true);
    }
    // PERM sale de la porosidad efectiva de la cadena
    expectSamples(curveOf(r, 'perm-timur:PERM'), (i) => timurPermeability(PHIE[i]!, 0.25), 6);
    expect(r.outputs.find((o) => o.key === 'sw-archie:SW')!.active).toBe(true);
    expect(r.outputs.find((o) => o.key === 'rw-manual:RW')!.active).toBe(true);
  });
});
