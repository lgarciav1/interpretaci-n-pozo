/**
 * Crossplot libre (docs/decisiones/0014): líneas de plantilla contra valores conocidos, muestras graficables, filtro
 * por zona, rampa de color cuantizada, cutoffs (rol → parámetro, alcance, valor efectivo), proveedor de series para
 * tendencias y tramos de profundidad para el visor.
 */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation } from '../../src/core/interpretation';
import { emptyParamState } from '../../src/core/params';
import { defaultRoleCatalog } from '../../src/core/roles';
import { createWell, type Zone } from '../../src/core/well';
import { fitTrend } from '../../src/petro/regression';
import { colorLevel, medianAt, plottableIndices, robustRange } from '../../src/plots/crossplot/crossplot';
import { crossplotSeries, crossplotSeriesKey, parseCrossplotSeriesKey } from '../../src/plots/crossplot/series';
import { archieRt, bvwLine, CROSSPLOT_TEMPLATE_DEFS, densityNeutronLine, DN_LITHOLOGIES, pickettLine } from '../../src/plots/crossplot/templates';
import { clampCutoff, cutoffParamFor, cutoffScope, normalizeCutoff, paramStep, resolveCutoffLine, sharedParamValue } from '../../src/plots/cutoffs';
import { depthRuns, keyForRole, nearestSample, resolvePlotCurve, roleOfKey, zoneFilter } from '../../src/plots/data';
import { evaluateTrend } from '../../src/plots/trend/compute';
import type { SeriesContext } from '../../src/plots/trend/series';

const lith = (id: string) => DN_LITHOLOGIES.find((l) => l.id === id)!;

describe('plantilla densidad–neutrón', () => {
  it('caliza: φN = φD (neutrón calibrado en caliza) y ρb = 2,71 − 1,71·φ', () => {
    const l = densityNeutronLine(lith('limestone'));
    l.phi.forEach((p, k) => {
      expect(l.nphi[k]).toBeCloseTo(p, 12);
      expect(l.rhob[k]).toBeCloseTo(2.71 - 1.71 * p, 12);
    });
  });
  it('punto de matriz en φ = 0 y valores de libro a 20 % de porosidad', () => {
    const s = densityNeutronLine(lith('sandstone'));
    expect([s.nphi[0], s.rhob[0]]).toEqual([-0.02, 2.65]);
    // Arenisca, φ = 0,2: ρb = 2,65·0,8 + 0,2 = 2,32; φN = −0,02·0,8 + 0,2 = 0,184.
    const k = s.phi.findIndex((p) => Math.abs(p - 0.2) < 1e-9);
    expect(s.rhob[k]).toBeCloseTo(2.32, 12);
    expect(s.nphi[k]).toBeCloseTo(0.184, 12);
    // Dolomía, φ = 0,2: ρb = 2,87·0,8 + 0,2 = 2,496.
    const d = densityNeutronLine(lith('dolomite'));
    expect(d.rhob[k]).toBeCloseTo(2.496, 12);
  });
  it('orden de las litologías en el gráfico: a igual densidad, arenisca < caliza < dolomía en neutrón', () => {
    // ρb = 2,40 → φ de cada litología y su φN.
    const at = (id: string) => {
      const L = lith(id);
      const phi = (L.rhoMa - 2.4) / (L.rhoMa - 1);
      return L.phiNMa * (1 - phi) + phi;
    };
    expect(at('sandstone')).toBeLessThan(at('limestone'));
    expect(at('limestone')).toBeLessThan(at('dolomite'));
  });
});

describe('plantilla de Pickett', () => {
  const p = { a: 1, m: 2, n: 2, rw: 0.05 };
  it('Rt de Archie con valores conocidos', () => {
    // Sw = 1, φ = 0,1: Rt = 0,05 / 0,01 = 5 ohm·m. Sw = 0,5: ×4 = 20.
    expect(archieRt(0.1, 1, p)).toBeCloseTo(5, 12);
    expect(archieRt(0.1, 0.5, p)).toBeCloseTo(20, 12);
    // Asquith y Krygowski: a = 0,62, m = 2,15, n = 2, Rw = 0,05, φ = 0,2, Sw = 1 → Rt = 0,031/0,2^2,15 ≈ 0,986.
    expect(archieRt(0.2, 1, { a: 0.62, m: 2.15, n: 2, rw: 0.05 })).toBeCloseTo((0.62 * 0.05) / 0.2 ** 2.15, 12);
  });
  it('recta de pendiente −1/m en log–log', () => {
    const l = pickettLine(1, p, [0.01, 1]);
    const slope = (Math.log10(l.phi[1]!) - Math.log10(l.phi[0]!)) / (Math.log10(l.rt[1]!) - Math.log10(l.rt[0]!));
    expect(slope).toBeCloseTo(-1 / p.m, 12);
    // En φ = 1, Rt = a·Rw (la recta de agua corta φ = 1 en Rw).
    expect(l.rt[1]).toBeCloseTo(0.05, 12);
  });
  it('orientación (φ en y, Rt en x): Sw 100 % es la línea más a la izquierda y cada punto devuelve su Sw por Archie', () => {
    // Revisión numérica 7a, cuenta a mano con a = 1, m = 2, n = 2, Rw = 0,05: en φ = 0,1 la recta de agua pasa por
    // Rt = 5; Sw = 50 % por 20; Sw = 30 % por 5/0,09 = 55,56; Sw = 20 % por 5/0,04 = 125 ohm·m.
    const rtAt = (sw: number) => pickettLine(sw, p, [0.1, 1]).rt[0]!;
    expect([rtAt(1), rtAt(0.5), rtAt(0.3), rtAt(0.2)].map((v) => +v.toFixed(2))).toEqual([5, 20, 55.56, 125]);
    // Menos agua → más a la derecha: la zona «imposible» (Sw > 100 %) queda abajo a la izquierda de la recta de agua.
    expect(rtAt(0.2)).toBeGreaterThan(rtAt(0.3));
    expect(rtAt(0.3)).toBeGreaterThan(rtAt(0.5));
    expect(rtAt(0.5)).toBeGreaterThan(rtAt(1));
    // Ida y vuelta: Sw = sqrt(a·Rw / (φ^m·Rt)) en cualquier punto de cualquier línea.
    for (const sw of [1, 0.5, 0.3, 0.2]) {
      const l = pickettLine(sw, p, [0.02, 0.35]);
      l.phi.forEach((f, k) => expect(Math.sqrt((p.a * p.rw) / (f ** p.m * l.rt[k]!))).toBeCloseTo(sw, 12));
    }
    // Con m = 2,5 la pendiente cambia a −1/2,5 = −0,4 y la intersección sigue en φ = 1 → Rt = a·Rw.
    const l25 = pickettLine(1, { ...p, m: 2.5 }, [0.01, 1]);
    expect((Math.log10(l25.phi[1]!) - Math.log10(l25.phi[0]!)) / (Math.log10(l25.rt[1]!) - Math.log10(l25.rt[0]!))).toBeCloseTo(-0.4, 12);
  });
});

describe('plantilla φ–Sw (BVW constante)', () => {
  it('Sw = BVW/φ', () => {
    const l = bvwLine(0.05, 0.4);
    l.phi.forEach((f, k) => expect(l.sw[k]! * f).toBeCloseTo(0.05, 12));
    expect(l.sw[0]).toBeCloseTo(1, 12); // empieza en Sw = 1 (φ = BVW)
    expect(l.phi[l.phi.length - 1]).toBeCloseTo(0.4, 12);
    expect(l.sw[l.sw.length - 1]).toBeCloseTo(0.125, 12);
  });
});

describe('definición de plantillas', () => {
  it('las quince con sus roles y escalas (las siete de litología de 0059 + G04 y Thomas–Stieber de 0061 al final)', () => {
    expect(CROSSPLOT_TEMPLATE_DEFS.map((t) => t.id)).toEqual(['density-neutron', 'pickett', 'phi-sw', 'gr-rt', 'nmr-dn', 'th-k', 'pe-density', 'sonic-neutron', 'density-sonic', 'm-n', 'rhomaa-umaa', 'mid', 'pe-k', 'pe-thk', 'thomas-stieber']);
    const dn = CROSSPLOT_TEMPLATE_DEFS[0]!;
    expect([dn.x.role, dn.y.role, dn.y.reversed]).toEqual(['NPHI', 'RHOB', true]);
    const pk = CROSSPLOT_TEMPLATE_DEFS[1]!;
    expect([pk.x.scale, pk.y.scale]).toEqual(['log', 'log']);
  });
});

// ── datos ────────────────────────────────────────────────────────────────────────────────────────────────────

const n = 100;
const depth = Float64Array.from({ length: n }, (_, i) => 1000 + i);
const zones: Zone[] = [
  { id: 'za', name: 'A', top: 1000, base: 1029.5, color: '#ff0000', kind: 'formation' },
  { id: 'zb', name: 'B', top: 1030, base: 1059.5, color: '#00ff00', kind: 'reservoir' },
];
const curve = (id: string, role: string | null, unit: string, f: (i: number) => number) => ({ id, mnemonic: id, role, unit, data: Float64Array.from({ length: n }, (_, i) => f(i)), origin: { kind: 'measured' as const } });
const well = createWell({
  id: 'w',
  name: 'W',
  depth,
  curves: [curve('NPHI', 'NPHI', '%', (i) => 10 + i * 0.2), curve('RHOB', 'RHOB', 'g/cm3', (i) => (i === 5 ? NaN : 2.6 - i * 0.003)), curve('ILD', 'RT', 'ohm.m', (i) => (i < 3 ? 0 : 1 + i))],
});
const phie = Float64Array.from({ length: n }, (_, i) => 0.05 + i * 0.002);
const ctx: SeriesContext = { well, interpretation: { ...emptyInterpretation(zones) }, computed: [{ port: 'PHIE', moduleId: 'phie-vsh', label: 'x', data: phie, active: true }], catalog: defaultRoleCatalog };

describe('curvas y zonas', () => {
  it('claves m:/r: → rol, datos en unidad canónica y escala del rol', () => {
    expect(roleOfKey(ctx, 'm:NPHI')).toBe('NPHI');
    expect(roleOfKey(ctx, 'r:PHIE')).toBe('PHIE');
    const nphi = resolvePlotCurve(ctx, 'm:NPHI')!;
    expect(nphi.data[0]).toBeCloseTo(0.1, 12); // % → v/v
    expect(resolvePlotCurve(ctx, 'm:ILD')!.scale).toBe('log');
    expect(resolvePlotCurve(ctx, 'r:PHIE')!.data).toBe(phie);
    expect(resolvePlotCurve(ctx, 'm:NOPE')).toBeNull();
    expect(keyForRole(ctx, 'RT')).toBe('m:ILD');
    expect(keyForRole(ctx, 'PHIE')).toBe('r:PHIE');
    expect(keyForRole(ctx, 'SW')).toBeNull();
  });
  it('filtro por zonas: vacío = todas las muestras; si no, solo las de esas zonas', () => {
    const all = zoneFilter(depth, zones, []);
    expect(all.include(80)).toBe(true); // fuera de toda zona también
    const b = zoneFilter(depth, zones, ['zb', 'borrada']);
    expect(b.selected).toEqual(['zb']);
    expect([b.include(10), b.include(40), b.include(80)]).toEqual([false, true, false]);
    expect(b.shown.map((z) => z.name)).toEqual(['B']);
  });
  it('muestras graficables: ambas válidas, en el filtro y > 0 en un eje log', () => {
    const x = resolvePlotCurve(ctx, 'm:ILD')!.data;
    const y = resolvePlotCurve(ctx, 'm:RHOB')!.data;
    const idx = plottableIndices(x, y, (i) => i < 10, true, false);
    expect(Array.from(idx)).toEqual([3, 4, 6, 7, 8, 9]);
  });
  it('tramos de profundidad contiguos (ensanchados medio paso) y muestra más cercana', () => {
    const runs = depthRuns(depth, (i) => (i >= 10 && i <= 12) || i === 20);
    expect(runs).toEqual([
      { top: 1009.5, base: 1012.5 },
      { top: 1019.5, base: 1020.5 },
    ]);
    // Con hueco de una muestra se unen.
    expect(depthRuns(depth, (i) => i === 10 || i === 12, 1)).toEqual([{ top: 1009.5, base: 1012.5 }]);
    expect(nearestSample(depth, 1010.4)).toBe(10);
    expect(nearestSample(depth, 1010.6)).toBe(11);
    expect(nearestSample(depth, 900)).toBe(-1);
  });
  it('rango robusto, nivel de color y mediana', () => {
    const v = Float64Array.from({ length: 101 }, (_, i) => i);
    expect(robustRange(v, false)).toEqual({ min: 1, max: 99 });
    expect(colorLevel(0, 0, 100, false, 10)).toBe(0);
    expect(colorLevel(55, 0, 100, false, 10)).toBe(5);
    expect(colorLevel(100, 0, 100, false, 10)).toBe(9);
    expect(colorLevel(1000, 1, 10000, true, 4)).toBe(3); // log10: 3 de 4 → nivel 3
    expect(colorLevel(NaN, 0, 1, false)).toBe(-1);
    expect(medianAt([5, 1, 3, 100], [0, 1, 2])).toBe(3);
  });
});

describe('cutoffs arrastrables', () => {
  it('rol → parámetro del módulo de cutoffs', () => {
    expect(cutoffParamFor('VSH')).toBe('vshCutoff');
    expect(cutoffParamFor('PHIE')).toBe('phiCutoff');
    expect(cutoffParamFor('SW')).toBe('swCutoff');
    expect(cutoffParamFor('GR')).toBeNull();
    expect(cutoffParamFor(null)).toBeNull();
  });
  it('alcance: una sola zona filtrada → esa zona; si no, global', () => {
    expect(cutoffScope(['zb'], zones)).toEqual({ zoneId: 'zb', label: 'Cutoff zona B' });
    expect(cutoffScope(['za', 'zb'], zones)).toEqual({ zoneId: null, label: 'Cutoff global' });
    expect(cutoffScope([], zones)).toEqual({ zoneId: null, label: 'Cutoff global' });
    expect(cutoffScope(['borrada'], zones).zoneId).toBeNull();
  });
  it('valor efectivo: zona > global > de fábrica', () => {
    const p = emptyParamState();
    expect(sharedParamValue(p, 'phiCutoff', null)).toBe(0.08);
    p.global['phiCutoff'] = 0.1;
    expect(sharedParamValue(p, 'phiCutoff', 'zb')).toBe(0.1);
    p.zones['zb'] = { phiCutoff: 0.12 };
    expect(sharedParamValue(p, 'phiCutoff', 'zb')).toBe(0.12);
    expect(sharedParamValue(p, 'phiCutoff', null)).toBe(0.1);
  });
  it('acotado al rango del parámetro y redondeado a su paso', () => {
    expect(clampCutoff('phiCutoff', 0.9)).toBe(0.4);
    expect(normalizeCutoff('phiCutoff', 0.1013)).toBe(0.1);
    expect(normalizeCutoff('vshCutoff', 0.437)).toBe(0.44);
    expect(paramStep('phiCutoff')).toBe(0.005);
  });
  it('línea real (valor de los parámetros) o libre (valor guardado); sin entrada, no hay línea', () => {
    const p = emptyParamState();
    p.zones['zb'] = { phiCutoff: 0.12 };
    const scope = cutoffScope(['zb'], zones);
    const real = resolveCutoffLine('x', { key: 'r:PHIE', role: 'PHIE' }, { 'r:PHIE': true }, p, scope)!;
    expect([real.param, real.zoneId, real.value, real.title]).toEqual(['phiCutoff', 'zb', 0.12, 'Cutoff zona B']);
    const free = resolveCutoffLine('y', { key: 'm:GR', role: 'GR' }, { 'm:GR': 75 }, p, scope)!;
    expect([free.param, free.zoneId, free.value, free.title]).toEqual([null, null, 75, 'Cutoff libre']);
    expect(resolveCutoffLine('x', { key: 'm:GR', role: 'GR' }, {}, p, scope)).toBeNull();
    // Vista previa durante el arrastre.
    expect(resolveCutoffLine('x', { key: 'm:GR', role: 'GR' }, { 'm:GR': 75 }, p, scope, { id: 'cut:m:GR', value: 80 })!.value).toBe(80);
  });
});

describe('serie `crossplot` para tendencias', () => {
  it('clave ida y vuelta (zonas ordenadas)', () => {
    const k = crossplotSeriesKey({ x: 'm:NPHI', y: 'r:PHIE', zones: ['zb', 'za'] });
    expect(k).toBe('m:NPHI|r:PHIE|za,zb');
    expect(parseCrossplotSeriesKey(k)).toEqual({ x: 'm:NPHI', y: 'r:PHIE', zones: ['za', 'zb'] });
    expect(parseCrossplotSeriesKey('m:X|m:Y|')).toEqual({ x: 'm:X', y: 'm:Y', zones: [] });
    expect(parseCrossplotSeriesKey('roto')).toBeNull();
  });
  it('los puntos visibles de las zonas de la clave; la tendencia recupera la recta exacta', () => {
    const s = crossplotSeries(ctx, crossplotSeriesKey({ x: 'm:NPHI', y: 'r:PHIE', zones: ['zb'] }))!;
    expect(s.xIsDepth).toBe(false);
    expect(s.x.length).toBe(30); // muestras 30…59
    expect(s.depth![0]).toBe(1030);
    // PHIE = 0,05 + i·0,002 y NPHI = 0,1 + i·0,002 → PHIE = NPHI − 0,05.
    const fit = fitTrend(s.x, s.y, 'linear')!;
    expect(fit.b).toBeCloseTo(1, 9);
    expect(fit.a).toBeCloseTo(-0.05, 9);
    expect(crossplotSeries(ctx, crossplotSeriesKey({ x: 'm:NPHI', y: 'r:PHIE', zones: ['zb'] }))).toBe(s); // misma identidad
    const r = evaluateTrend({ id: 't', name: 't', visible: true, series: s.ref, model: 'linear', mode: 'fit', selection: { excluded: [] }, extend: false }, s, zones);
    expect(r.r2).toBeCloseTo(1, 9);
    expect(r.n).toBe(30);
    expect(s.indexOfKey!(s.pointKey(7))).toBe(7);
  });
  it('curva inexistente → null', () => {
    expect(crossplotSeries(ctx, 'm:NOPE|r:PHIE|')).toBeNull();
  });
});

