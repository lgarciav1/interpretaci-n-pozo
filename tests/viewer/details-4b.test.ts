/** Piezas puras de la fase 4b: animación de carga, minimapa y encabezado de pozo. */
import { describe, expect, it } from 'vitest';
import { defaultRoleCatalog } from '../../src/core/roles';
import type { Curve } from '../../src/core/well';
import { cubicBezier, easingFromToken, LOAD_ANIMATION_MS, revealAt } from '../../src/viewer/animation';
import { minimapRows, minimapY, pickMinimapCurve, topForCenter, windowRect } from '../../src/viewer/minimap';
import { resolveTracks } from '../../src/viewer/resolve';
import { BUILTIN_LAYOUTS } from '../../src/viewer/templates';
import { wellHeaderFields } from '../../src/viewer/wellHeader';

describe('animación de carga', () => {
  it('cubic-bezier como en CSS', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.3)).toBeCloseTo(0.3, 5);
    const ease = cubicBezier(0.25, 0.1, 0.25, 1); // `ease` de CSS: 0,5 → ≈ 0,8024
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it('usa la curva de los tokens y dura ~1 s', () => {
    expect(LOAD_ANIMATION_MS).toBe(1000);
    expect(revealAt(0)).toBe(0);
    expect(revealAt(LOAD_ANIMATION_MS)).toBe(1);
    expect(revealAt(500)).toBeGreaterThan(0.5); // `ease-enter` frena al final
    expect(easingFromToken('linear')(0.4)).toBeCloseTo(0.4, 6);
  });
});

describe('minimapa', () => {
  const n = 100;
  const depth = Float64Array.from({ length: n }, (_, i) => 1000 + i);

  it('elige GR o la primera curva de línea', () => {
    const gr: Curve = { id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: new Float64Array(n), origin: { kind: 'measured' } };
    const dt: Curve = { id: 'DT', mnemonic: 'DT', role: 'DT', unit: 'us/ft', data: new Float64Array(n), origin: { kind: 'measured' } };
    const tracks = resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth, curves: [dt, gr], computed: [], catalog: defaultRoleCatalog });
    expect(pickMinimapCurve(tracks)?.name).toBe('GR');
    const onlyDt = resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth, curves: [dt], computed: [], catalog: defaultRoleCatalog });
    expect(pickMinimapCurve(onlyDt)?.name).toBe('DT');
    expect(pickMinimapCurve([])).toBeNull();
  });

  it('mínimo y máximo por fila, acotados y con huecos', () => {
    const frac = Float64Array.from({ length: n }, (_, i) => (i < 10 ? NaN : i / 50 - 0.5));
    const r = minimapRows(depth, frac, 10);
    expect(r.min[0]).toBeNaN();
    expect(r.min[1]).toBeCloseTo(0, 5); // −0,3 acotado a 0
    expect(r.max[9]).toBe(1); // 1,48 acotado a 1
  });

  it('ventana visible con alto mínimo y centrado al hacer clic', () => {
    const s = { min: 1000, max: 1100, height: 200 };
    expect(minimapY(s, 1050)).toBe(100);
    expect(windowRect(s, 1010, 1030)).toEqual({ y: 20, h: 40 });
    expect(windowRect(s, 1050, 1050.5).h).toBe(8);
    expect(windowRect(s, 1099.9, 1100).y).toBe(192); // dentro del minimapa
    expect(topForCenter(s, 100, 20)).toBe(1040);
  });
});

describe('encabezado de pozo', () => {
  it('campos conocidos de un LAS en orden y el resto aparte', () => {
    const f = wellHeaderFields({
      header: {
        WELL: { value: 'YPF.Nq.LLL-1' },
        COMP: { value: 'YPF S.A.' },
        FLD: { value: 'Loma La Lata' },
        EKB: { value: 812.4, unit: 'm' },
        KB: { value: 812.4, unit: 'm' },
        STRT: { value: 7633.3, unit: 'm' },
        SRVC: { value: '' },
        RMF: { value: 0.35, unit: 'ohm.m', description: 'Resistividad del filtrado' },
      },
    });
    expect(f.primary.map((x) => `${x.label}: ${x.value}`)).toEqual(['Yacimiento: Loma La Lata', 'Compañía: YPF S.A.', 'KB: 812,4 m']);
    expect(f.others.map((x) => x.label)).toEqual(['Resistividad del filtrado (RMF)']);
  });

  it('un LAS o CSV sin metadatos no tiene campos', () => {
    expect(wellHeaderFields({ header: {} })).toEqual({ primary: [], others: [] });
  });

  it('claves en español con acentos', () => {
    expect(wellHeaderFields({ header: { 'Compañía': { value: 'Pan American' }, Yacimiento: { value: 'Cerro Dragón' } } }).primary.map((x) => x.label)).toEqual(['Yacimiento', 'Compañía']);
  });
});
