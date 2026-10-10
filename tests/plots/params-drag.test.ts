/**
 * Parámetros elegidos sobre los gráficos (fase 7b, docs/decisiones/0015): conversión px ↔ parámetro de cada elemento
 * arrastrable (líneas de GR, punto de matriz, recta de agua del Pickett), offset del neutrón ↔ NPHI de la matriz,
 * recta de Pickett ↔ (Rw, m) ida y vuelta, Rw entre temperaturas consistente con el motor (escribir y releer da la
 * misma recta), alcance, claves de almacenamiento, acotado al rango y agrupado de deshacer por gesto.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/core/engine/engine';
import { emptyInterpretation } from '../../src/core/interpretation';
import { emptyParamState } from '../../src/core/params';
import { cancelGroup, emptyHistory, GROUP_MS, recordChange } from '../../src/core/state/history';
import { createProject } from '../../src/core/state/project';
import { registry } from '../../src/modules';
import { densityPorosity, neutronPorosity } from '../../src/petro/porosity';
import { arpsResistivityC } from '../../src/petro/temperature';
import {
  matrixParamsOf,
  matrixPointOf,
  mFromRotate,
  projectMatrixLine,
  representativeTemperature,
  rwAtFormation,
  rwAtReference,
  rwFromTranslate,
  snapMatrixToLithology,
  waterLineHandles,
  waterLineRt,
} from '../../src/plots/crossplot/drag';
import { archieRt, pickettLine } from '../../src/plots/crossplot/templates';
import { grGuides, grWrite, inactiveDriver, normalizeGr, normalizeParam, nudgeParam, paramOfGuide, paramWrite, plotParamValue, plotScope, PLOT_PARAMS, RW_CORRECT_STORAGE, storedParamValue } from '../../src/plots/params';
import { distanceToPolylinePx, movePointPx, xyMapping, type XYAxis } from '../../src/plots/xy/axes';
import { curve, well, zone } from '../helpers';

const RECT = { x: 50, y: 20, width: 400, height: 300 };
const ZONES = [zone('za', 1000, 1004.5), zone('zb', 1005, 1009.5)];

describe('claves de almacenamiento y alcance', () => {
  it('los parámetros no compartidos se guardan como módulo.clave; los compartidos, con su clave', () => {
    expect(PLOT_PARAMS.rwRef.storage).toBe('rw-manual.rwRef');
    expect(PLOT_PARAMS.tRef.storage).toBe('rw-manual.tRef');
    expect(PLOT_PARAMS.rhoMa.storage).toBe('phi-density.rhoMa');
    expect(PLOT_PARAMS.rhoFl.storage).toBe('phi-density.rhoFl');
    expect(PLOT_PARAMS.matrixOffset.storage).toBe('phi-neutron.matrixOffset');
    expect(RW_CORRECT_STORAGE).toBe('rw-manual.correct');
    expect(PLOT_PARAMS.grClean.storage).toBe('grClean');
    expect(PLOT_PARAMS.m.storage).toBe('m');
  });

  it('una sola zona filtrada → esa zona; ninguna o varias → global (la regla de los cutoffs)', () => {
    expect(plotScope(['za'], ZONES)).toEqual({ zoneId: 'za', text: 'zona ZA' });
    expect(plotScope([], ZONES)).toEqual({ zoneId: null, text: 'global' });
    expect(plotScope(['za', 'zb'], ZONES)).toEqual({ zoneId: null, text: 'global' });
    expect(plotScope(['borrada'], ZONES)).toEqual({ zoneId: null, text: 'global' });
    // Un parámetro sin alcance por zona es siempre global.
    expect(plotScope(['za'], ZONES, { ...PLOT_PARAMS.rwRef.spec, scope: 'global' })).toEqual({ zoneId: null, text: 'global' });
  });

  it('lee el valor efectivo como el motor: zona > global > fábrica, con la clave de almacenamiento', () => {
    const params = { global: { 'rw-manual.rwRef': 0.08 }, zones: { za: { 'rw-manual.rwRef': 0.03, rwRef: 9 } } };
    expect(plotParamValue(params, PLOT_PARAMS.rwRef, 'za')).toBe(0.03);
    expect(plotParamValue(params, PLOT_PARAMS.rwRef, 'zb')).toBe(0.08);
    expect(plotParamValue(params, PLOT_PARAMS.rwRef, null)).toBe(0.08);
    expect(plotParamValue(emptyParamState(), PLOT_PARAMS.rhoMa, null)).toBe(2.65);
    expect(storedParamValue({ global: { 'rw-manual.correct': 'sí' }, zones: {} }, RW_CORRECT_STORAGE, PLOT_PARAMS.tRef.spec, null)).toBe(24);
    // La escritura lleva la clave de almacenamiento y la zona del alcance.
    expect(paramWrite(PLOT_PARAMS.matrixOffset, 0.02, { zoneId: 'zb', text: 'zona ZB' })).toEqual({ storage: 'phi-neutron.matrixOffset', value: 0.02, zoneId: 'zb' });
  });
});

describe('acotar y redondear como el slider', () => {
  it('lineal: paso contado desde min; fuera de rango se acota', () => {
    expect(normalizeParam(PLOT_PARAMS.rhoMa.spec, 2.6549)).toBe(2.65);
    expect(normalizeParam(PLOT_PARAMS.rhoMa.spec, 9)).toBe(3.2);
    expect(normalizeParam(PLOT_PARAMS.rhoMa.spec, 0)).toBe(2);
    expect(normalizeParam(PLOT_PARAMS.matrixOffset.spec, 0.0262)).toBe(0.025);
    expect(normalizeParam(PLOT_PARAMS.matrixOffset.spec, -0.5)).toBe(-0.1);
    expect(normalizeParam(PLOT_PARAMS.m.spec, 0.4)).toBe(1);
    expect(normalizeParam(PLOT_PARAMS.m.spec, 7)).toBe(3.5);
    expect(normalizeParam(PLOT_PARAMS.m.spec, NaN)).toBeNaN();
  });

  it('log (Rw): paso de 0,001 y rango 0,005–5', () => {
    expect(normalizeParam(PLOT_PARAMS.rwRef.spec, 0.04449)).toBe(0.044);
    expect(normalizeParam(PLOT_PARAMS.rwRef.spec, 0.0001)).toBe(0.005);
    expect(normalizeParam(PLOT_PARAMS.rwRef.spec, 80)).toBe(5);
  });

  it('flechas: un paso del parámetro (Mayús ×10), sin salir del rango', () => {
    expect(nudgeParam(PLOT_PARAMS.m.spec, 2, 1)).toBe(2.01);
    expect(nudgeParam(PLOT_PARAMS.m.spec, 2, -1, true)).toBe(1.9);
    expect(nudgeParam(PLOT_PARAMS.matrixOffset.spec, 0.1, 1)).toBe(0.1);
    expect(nudgeParam(PLOT_PARAMS.rwRef.spec, 0.05, 1)).toBeGreaterThan(0.05);
    expect(nudgeParam(PLOT_PARAMS.rwRef.spec, 0.005, -1)).toBe(0.005);
  });
});

describe('líneas de GR limpio y GR de arcilla', () => {
  const X: XYAxis = { kind: 'linear', min: 0, max: 150, label: 'GR' };
  const m = xyMapping(X, { kind: 'linear', min: 0, max: 50, label: 'n' }, RECT);
  const scope = { zoneId: null, text: 'global' };

  it('px → valor del parámetro (paso 0,5) y valor → px', () => {
    const px = m.x(45);
    expect(px).toBeCloseTo(50 + (45 / 150) * 400, 9);
    // 3 px a la derecha = 1,125 gAPI → 46,125 → paso 0,5.
    expect(grWrite('grClean', m.xInv(px + 3), emptyParamState(), scope)).toEqual({ storage: 'grClean', value: 46, zoneId: null });
    expect(grWrite('grShale', m.xInv(m.x(118.8)), emptyParamState(), { zoneId: 'za', text: 'zona ZA' })).toEqual({ storage: 'grShale', value: 119, zoneId: 'za' });
  });

  it('se acota al rango y el limpio no cruza al de arcilla', () => {
    expect(normalizeGr('grClean', -20, 120)).toBe(0);
    expect(normalizeGr('grClean', 140, 120)).toBe(119.5);
    expect(normalizeGr('grShale', 10, 30)).toBe(30.5);
    expect(normalizeGr('grShale', 900, 30)).toBe(300);
  });

  it('las guías llevan el valor, el alcance y no se quitan con Supr', () => {
    const g = grGuides({ global: { grClean: 25 }, zones: {} }, scope, { clean: '#a', shale: '#b' }, true);
    expect(g.map((q) => q.id)).toEqual(['param:grClean', 'param:grShale']);
    expect(g[0]!.label).toBe('GR limpio global · 25,0 gAPI');
    expect(g[0]).toMatchObject({ draggable: true, step: 0.5, removable: false, value: 25 });
    expect(paramOfGuide('param:grShale')).toBe('grShale');
    expect(paramOfGuide('cut:r:VSH')).toBeNull();
    expect(grGuides(emptyParamState(), scope, { clean: '#a', shale: '#b' }, false)[0]!.draggable).toBeUndefined();
  });
});

describe('punto de matriz (densidad–neutrón)', () => {
  it('offset ↔ NPHI de la matriz: φN corregido = NPHI + offset vale 0 en la matriz (motor)', () => {
    for (const offset of [-0.1, -0.02, 0, 0.035, 0.1]) {
      const p = matrixPointOf(2.65, offset);
      expect(p.nphi).toBeCloseTo(-offset, 12);
      expect(neutronPorosity(p.nphi, offset)).toBeCloseTo(0, 12);
      expect(matrixParamsOf(p).matrixOffset).toBeCloseTo(offset, 12);
      expect(matrixParamsOf(p).rhoMa).toBe(2.65);
    }
    expect(Object.is(matrixPointOf(2.65, 0).nphi, -0)).toBe(false);
  });

  it('la línea de la matriz del proyecto lee la porosidad del motor (φD = φN = φ en cada marca)', () => {
    const l = projectMatrixLine(2.71, 0.03, 1.1);
    expect(l.nphi[0]).toBeCloseTo(-0.03, 12);
    expect(l.rhob[0]).toBe(2.71);
    l.phi.forEach((f, k) => {
      expect(densityPorosity(l.rhob[k]!, 2.71, 1.1)).toBeCloseTo(f, 12);
      expect(neutronPorosity(l.nphi[k]!, 0.03)).toBeCloseTo(f, 12);
    });
  });

  it('px → (ρma, offset) con el eje de densidad invertido, y vuelta', () => {
    const X: XYAxis = { kind: 'linear', min: -0.05, max: 0.45, label: 'NPHI' };
    const Y: XYAxis = { kind: 'linear', min: 1.9, max: 2.9, label: 'RHOB', reversed: true };
    const m = xyMapping(X, Y, RECT);
    const start = matrixPointOf(2.65, 0);
    const p0 = { x: m.x(start.nphi), y: m.y(start.rhob) };
    // 16 px a la derecha (= 0,02 de NPHI) y 12 px abajo (= +0,04 g/cm³ en el eje invertido).
    const pos = movePointPx(m, { x: start.nphi, y: start.rhob }, p0, { x: p0.x + 16, y: p0.y + 12 });
    expect(pos.x).toBeCloseTo(0.02, 9);
    expect(pos.y).toBeCloseTo(2.69, 9);
    const v = matrixParamsOf({ nphi: pos.x, rhob: pos.y });
    expect(normalizeParam(PLOT_PARAMS.matrixOffset.spec, v.matrixOffset)).toBe(-0.02);
    expect(normalizeParam(PLOT_PARAMS.rhoMa.spec, v.rhoMa)).toBe(2.69);
    // Ida y vuelta: los parámetros vuelven a poner la manija en el mismo px.
    const back = matrixPointOf(2.69, -0.02);
    expect(m.x(back.nphi)).toBeCloseTo(p0.x + 16, 9);
    expect(m.y(back.rhob)).toBeCloseTo(p0.y + 12, 9);
  });

  it('agarrar la línea lejos de la manija la traslada sin saltos; la manija no sale del área', () => {
    const m = xyMapping({ kind: 'linear', min: 0, max: 1, label: 'x' }, { kind: 'linear', min: 0, max: 1, label: 'y' }, RECT);
    const pos = movePointPx(m, { x: 0.5, y: 0.5 }, { x: 400, y: 100 }, { x: 440, y: 100 });
    expect(pos.x).toBeCloseTo(0.6, 9);
    expect(pos.y).toBeCloseTo(0.5, 9);
    const out = movePointPx(m, { x: 0.5, y: 0.5 }, { x: 250, y: 170 }, { x: 9000, y: -50 });
    expect(out).toEqual({ x: 1, y: 1 });
    // Diagonal de 400 × 300 px: 10 px hacia arriba desde su medio quedan a 10·400/500 = 8 px de la recta.
    expect(distanceToPolylinePx(m, [0, 1], [0, 1], m.x(0.5), m.y(0.5) - 10)).toBeCloseTo(8, 9);
    expect(distanceToPolylinePx(m, [0, NaN, 1], [0, NaN, 1], m.x(0.5), m.y(0.5))).toBeGreaterThan(100);
  });

  it('imán: cerca de arenisca, caliza o dolomía toma sus valores exactos', () => {
    const span = { x: 0.5, y: 1 };
    expect(snapMatrixToLithology({ nphi: -0.017, rhob: 2.655 }, span)).toMatchObject({ point: { nphi: -0.02, rhob: 2.65 }, lith: { id: 'sandstone' } });
    expect(snapMatrixToLithology({ nphi: 0.004, rhob: 2.70 }, span).lith?.id).toBe('limestone');
    const far = snapMatrixToLithology({ nphi: 0.05, rhob: 2.5 }, span);
    expect(far.lith).toBeNull();
    expect(far.point).toEqual({ nphi: 0.05, rhob: 2.5 });
  });
});

describe('recta de agua del Pickett ↔ (Rw, m)', () => {
  const X: XYAxis = { kind: 'log', min: 0.1, max: 100, label: 'Rt' };
  const Y: XYAxis = { kind: 'log', min: 0.01, max: 1, label: 'φ' };
  const m = xyMapping(X, Y, RECT);
  const p = { a: 0.81, m: 2, n: 2, rw: 0.04 };

  it('la recta de agua es la línea Sw = 100 % de Archie y corta φ = 1 en a·Rw', () => {
    expect(waterLineRt(1, p)).toBeCloseTo(0.81 * 0.04, 12);
    expect(waterLineRt(0.1, p)).toBeCloseTo(archieRt(0.1, 1, p), 12);
    const l = pickettLine(1, p, [0.01, 1]);
    expect(l.rt[1]).toBeCloseTo(0.0324, 12);
  });

  it('trasladar: (Rt, φ) de un punto de la recta da la misma Rw; rotar: da la misma m (ida y vuelta)', () => {
    for (const phi of [0.03, 0.1, 0.25]) {
      const rt = waterLineRt(phi, p);
      expect(rwFromTranslate({ rt, phi }, p.a, p.m)).toBeCloseTo(p.rw, 12);
      expect(mFromRotate({ rt, phi }, p.a, p.rw)).toBeCloseTo(p.m, 12);
    }
    expect(mFromRotate({ rt: 3, phi: 1 }, p.a, p.rw)).toBeNaN();
    expect(rwFromTranslate({ rt: -1, phi: 0.1 }, p.a, p.m)).toBeNaN();
  });

  it('px: arrastrar la manija de trasladar mueve la recta en paralelo y la deja bajo el puntero', () => {
    const h = waterLineHandles(p, [X.min, X.max], [Y.min, Y.max]);
    expect(h.visible).toBe(true);
    expect(waterLineRt(h.translate.phi, p)).toBeCloseTo(h.translate.rt, 9);
    const p0 = { x: m.x(h.translate.rt), y: m.y(h.translate.phi) };
    const pos = movePointPx(m, { x: h.translate.rt, y: h.translate.phi }, p0, { x: p0.x + 40, y: p0.y - 15 });
    const rw2 = rwFromTranslate({ rt: pos.x, phi: pos.y }, p.a, p.m);
    // 40 px a la derecha en 3 décadas de 400 px = ×10^0,3; 15 px arriba en 2 décadas de 300 px = φ ×10^0,1 → Rw ×10^(0,3+0,2).
    expect(rw2 / p.rw).toBeCloseTo(10 ** (0.3 + 0.1 * p.m), 9);
    const q = { ...p, rw: rw2 };
    expect(m.x(waterLineRt(pos.y, q))).toBeCloseTo(p0.x + 40, 6);
  });

  it('px: arrastrar la manija de rotar cambia m alrededor del corte en φ = 1 (a·Rw no cambia)', () => {
    const h = waterLineHandles(p, [X.min, X.max], [Y.min, Y.max]);
    const r = h.rotate!;
    expect(r.phi).toBeLessThan(h.translate.phi);
    const p0 = { x: m.x(r.rt), y: m.y(r.phi) };
    const pos = movePointPx(m, { x: r.rt, y: r.phi }, p0, { x: p0.x + 30, y: p0.y });
    const m2 = mFromRotate({ rt: pos.x, phi: pos.y }, p.a, p.rw);
    expect(m2).toBeGreaterThan(p.m);
    const q = { ...p, m: m2 };
    expect(waterLineRt(1, q)).toBeCloseTo(waterLineRt(1, p), 12);
    expect(waterLineRt(pos.y, q)).toBeCloseTo(pos.x, 9);
    // Fuera de rango se acota: m ≤ 3,5.
    expect(normalizeParam(PLOT_PARAMS.m.spec, mFromRotate({ rt: 1e9, phi: 0.02 }, p.a, p.rw))).toBe(3.5);
  });

  it('si la recta queda fuera del gráfico, la manija de trasladar va al centro y no hay de rotar', () => {
    const h = waterLineHandles({ a: 1, m: 2, rw: 1e6 }, [X.min, X.max], [Y.min, Y.max]);
    expect(h.visible).toBe(false);
    expect(h.rotate).toBeNull();
    expect(h.translate.rt).toBeCloseTo(Math.sqrt(10), 9);
    expect(h.translate.phi).toBeCloseTo(0.1, 9);
  });
});

describe('Rw entre la temperatura de referencia y la de formación', () => {
  it('es la fórmula del motor (Arps) y su inversa exacta', () => {
    expect(rwAtFormation(0.05, 24, 90, true)).toBe(arpsResistivityC(0.05, 24, 90));
    expect(rwAtReference(rwAtFormation(0.05, 24, 90, true), 24, 90, true)).toBeCloseTo(0.05, 14);
    expect(rwAtFormation(0.05, 24, 90, false)).toBe(0.05);
    expect(rwAtReference(0.03, 24, 90, false)).toBe(0.03);
  });

  it('escribir rwRef y releer con el motor da la misma recta (mediana de RW de los puntos visibles)', () => {
    const N = 41;
    const temp = Array.from({ length: N }, (_, i) => 60 + 1.5 * i);
    const w = well([curve('TEMP', 'TEMP', temp)], N);
    const idx = Int32Array.from({ length: 21 }, (_, k) => 10 + k);
    const tRep = representativeTemperature(Float64Array.from(temp), idx);
    expect(tRep).toBeCloseTo(60 + 1.5 * 20, 12);
    // La recta pide Rw de formación 0,021 a la temperatura representativa → Rw a 24 °C.
    const target = 0.021;
    const rwRef = rwAtReference(target, 24, tRep, true);
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(w);
    const r = engine.run({ ...emptyInterpretation([]), params: { global: { 'rw-manual.rwRef': rwRef, 'rw-manual.tRef': 24 }, zones: {} } });
    const rw = r.outputs.find((o) => o.key === 'rw-manual:RW')!.value as Float64Array;
    const median = [...idx].map((i) => rw[i]!).sort((a, b) => a - b)[10]!;
    expect(median).toBeCloseTo(target, 12);
    // Y la recta que dibuja el gráfico con lo guardado es la pedida.
    expect(rwAtFormation(rwRef, 24, tRep, true)).toBeCloseTo(target, 14);
  });
});

describe('fuente activa', () => {
  it('avisa solo si el módulo del parámetro no alimenta su puerto', () => {
    expect(inactiveDriver(null, 'RW', 'rw-manual')).toBeNull();
    expect(inactiveDriver({ RW: { kind: 'module', moduleId: 'rw-manual' } }, 'RW', 'rw-manual')).toBeNull();
    expect(inactiveDriver({ RW: { kind: 'module', moduleId: 'rw-sp' } }, 'RW', 'rw-manual')).toEqual({ active: { kind: 'module', moduleId: 'rw-sp' } });
    expect(inactiveDriver({ RW: { kind: 'curve', curveId: 'RWA' } }, 'RW', 'rw-manual')).toEqual({ active: { kind: 'curve', curveId: 'RWA' } });
    expect(inactiveDriver({}, 'RW', 'rw-manual')).toEqual({ active: null });
  });
});

describe('deshacer por gesto (un Ctrl+Z por arrastre)', () => {
  const p0 = createProject('p0');
  const p1 = createProject('p1');
  const p2 = createProject('p2');

  it('los cambios del mismo gesto se funden aunque haya pausas largas', () => {
    let h = recordChange(emptyHistory(), p0, 'Cambiar Rw', 0, undefined, 'g1');
    h = recordChange(h, p1, 'Cambiar Rw', 5 * GROUP_MS, undefined, 'g1');
    expect(h.past).toHaveLength(1);
    expect(h.past[0]!.project).toBe(p0);
  });

  it('un gesto nuevo abre su propia entrada aunque esté dentro de la ventana; sin gesto vale la ventana', () => {
    let h = recordChange(emptyHistory(), p0, 'Cambiar Rw', 0);
    h = recordChange(h, p1, 'Cambiar Rw', 100, undefined, 'g2');
    expect(h.past).toHaveLength(2);
    h = recordChange(h, p2, 'Cambiar Rw', 200);
    expect(h.past).toHaveLength(2);
  });

  it('cancelar el gesto vuelve al proyecto de antes y quita su entrada', () => {
    let h = recordChange(emptyHistory(), p0, 'Mover zona', 0);
    h = recordChange(h, p1, 'Mover el punto de matriz', 2000, undefined, 'g3');
    h = recordChange(h, p2, 'Mover el punto de matriz', 9000, undefined, 'g3');
    const c = cancelGroup(h, 'g3')!;
    expect(c.project).toBe(p1);
    expect(c.history.past).toHaveLength(1);
    expect(c.history.past[0]!.label).toBe('Mover zona');
    expect(cancelGroup(h, 'otro')).toBeNull();
    expect(cancelGroup(c.history, 'g3')).toBeNull();
  });
});
