/**
 * Vista «Perfil radial» del módulo `invasion-step` (fase 8b, decisión 0020, sección 8): entradas iguales a las del
 * motor, profundidad → muestra, zona y parámetros, ajuste de una muestra y sus estados, geometría del corte y del
 * dibujo, estado de «fijar profundidad» y dibujo completo sobre el contexto SVG de las figuras.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { emptyParamState, paramStorageKey } from '../src/core/params';
import { defaultRoleCatalog } from '../src/core/roles';
import { SvgContext2D, withSvgPath2D } from '../src/io/export/figures';
import { registry } from '../src/modules';
import invasionStep from '../src/modules/invasion-step';
import { RADIAL_X_AXIS, drawRadialProfile, radialLayout, readableColors, resistivityAxis } from '../src/modules/invasion-step/draw';
import { getRadialPin, noteCursorDepth, pinRadialDepth, resetRadialPin } from '../src/modules/invasion-step/pin';
import {
  apparentCurve,
  corteBands,
  invasionParamsAt,
  nearestSampleIndex,
  radialSensitivity,
  radialViewAt,
  resolveBitSizeCurve,
  resolveInvasionInputs,
  statusText,
  stepPolyline,
  zoneLookup,
  type RadialInput,
  type RadialView,
} from '../src/modules/invasion-step/radial';
import { forwardStepProfile } from '../src/petro/invasion';
import { THEMES } from '../src/ui/tokens';
import { curve, well, zone } from './helpers';

const R50 = [10, 20, 30, 60, 90];
const ROLES = ['RA10', 'RA20', 'RA30', 'RM', 'RT'] as const;
const MNEM = ['AT10', 'AT20', 'AT30', 'AT60', 'AT90'];

/** Entradas de una sola muestra (índice 0) con las lecturas dadas, de somera a profunda. */
function inputs(values: number[], roles: readonly (typeof ROLES)[number][] = ROLES): RadialInput[] {
  return roles.map((role, k) => ({ role, label: MNEM[ROLES.indexOf(role)]!, r50: R50[ROLES.indexOf(role)]!, data: [values[k]!] }));
}
const PARAMS = { minSeparation: 0.1, maxMisfit: 0.15, bitSize: 8.5 };
const view = (values: number[], extra: Parameters<typeof radialViewAt>[4] = {}, params = PARAMS) => radialViewAt(inputs(values), 0, 2000, params, extra);

describe('entradas: las mismas curvas que el motor le pasa al módulo', () => {
  const w = well([curve('AT10', 'RA10', [5]), curve('AT30', 'RA30', [3]), curve('AT60', 'RM', [2]), curve('AT90', 'RT', [1.5]), curve('ILD', null, [1.4], 'ohm.m')], 1);

  it('sin resultado del motor: la curva medida con cada rol, en orden de somera a profunda', () => {
    const r = resolveInvasionInputs(w.curves, [], null, defaultRoleCatalog);
    expect(r.map((x) => [x.role, x.label, x.r50])).toEqual([
      ['RA10', 'AT10', 10],
      ['RA30', 'AT30', 30],
      ['RM', 'AT60', 60],
      ['RT', 'AT90', 90],
    ]);
  });

  it('si la fuente de RT es el propio módulo (su Rt corregida), usa la curva medida, como el grafo', () => {
    const computed = [{ port: 'RT', moduleId: 'invasion-step', label: 'Rt corregida', data: new Float64Array([9]), active: true }];
    const r = resolveInvasionInputs(w.curves, computed, { RT: { kind: 'module', moduleId: 'invasion-step' } }, defaultRoleCatalog);
    expect(r.find((x) => x.role === 'RT')!.data[0]).toBe(1.5);
  });

  it('una curva sin rol elegida a propósito como RT, y otro módulo como fuente, se respetan', () => {
    const computed = [{ port: 'RM', moduleId: 'otro', label: 'RM de otro', data: new Float64Array([7]), active: true }];
    const r = resolveInvasionInputs(w.curves, computed, { RT: { kind: 'curve', curveId: 'ILD' }, RM: { kind: 'module', moduleId: 'otro' } }, defaultRoleCatalog);
    expect(r.find((x) => x.role === 'RT')).toMatchObject({ label: 'ILD' });
    expect(r.find((x) => x.role === 'RT')!.data[0]).toBe(1.4);
    expect(r.find((x) => x.role === 'RM')!.data[0]).toBe(7);
  });

  it('coincide con lo que el motor le entrega al módulo (mismo ajuste que sus curvas de salida)', () => {
    const n = 40;
    const profiles = Array.from({ length: n }, (_, i) => ({ di: 16 + i * 2, rxo: 8 - i * 0.1, rt: 1 + i * 0.02 }));
    const cols = ROLES.map(() => [] as number[]);
    for (const p of profiles) forwardStepProfile(p.di, p.rxo, p.rt, R50).forEach((v, k) => cols[k]!.push(v));
    const ew = well(ROLES.map((r, k) => curve(MNEM[k]!, r, cols[k]!)), n);
    const engine = new Engine(registry);
    engine.setWell(ew);
    const res = engine.run(emptyInterpretation());
    const di = res.outputs.find((o) => o.key === 'invasion-step:DI')!.value as Float64Array;
    const ins = resolveInvasionInputs(ew.curves, [], res.sources, defaultRoleCatalog);
    let compared = 0;
    for (let i = 0; i < n; i++) {
      const v = radialViewAt(ins, i, ew.depth[i]!, invasionParamsAt(emptyParamState(), null));
      if (Number.isFinite(di[i]!)) {
        expect(2 * v.invasionRadius).toBeCloseTo(di[i]!, 6);
        compared++;
      } else expect(v.status === 'ok' || v.status === 'doubtful').toBe(false);
    }
    expect(compared).toBeGreaterThan(n / 2);
  });

  it('curva de trépano (BS) por rol; null si no hay', () => {
    const wb = well([curve('BS', 'BS', [12.25]), curve('AT90', 'RT', [1])], 1);
    expect(resolveBitSizeCurve(wb.curves, null, defaultRoleCatalog)![0]).toBe(12.25);
    expect(resolveBitSizeCurve(w.curves, null, defaultRoleCatalog)).toBeNull();
  });
});

describe('profundidad, zona y parámetros', () => {
  const depth = Float64Array.from([100, 100.5, 101, 101.5, 102]);

  it('muestra más cercana (con bordes y empates hacia arriba)', () => {
    expect(nearestSampleIndex(depth, 99)).toBe(0);
    expect(nearestSampleIndex(depth, 100.24)).toBe(0);
    expect(nearestSampleIndex(depth, 100.26)).toBe(1);
    expect(nearestSampleIndex(depth, 100.25)).toBe(0);
    expect(nearestSampleIndex(depth, 1e6)).toBe(4);
    expect(nearestSampleIndex(depth, NaN)).toBe(-1);
    expect(nearestSampleIndex(new Float64Array(0), 1)).toBe(-1);
  });

  it('zona de una muestra con la regla del motor (la de tope más somero gana; fuera de zonas = null)', () => {
    const z = zoneLookup(depth, [zone('b', 101, 102), zone('a', 100, 101)]);
    expect(z(0)!.id).toBe('a');
    expect(z(2)!.id).toBe('a'); // 101 está en las dos: gana la de tope más somero
    expect(z(3)!.id).toBe('b');
    expect(zoneLookup(depth, [zone('a', 100.6, 101.2)])(0)).toBeNull();
  });

  it('parámetros vigentes: los de la zona si los tiene, si no los globales, si no los de fábrica', () => {
    const st = emptyParamState();
    const key = (k: keyof typeof invasionStep.params) => paramStorageKey('invasion-step', k, invasionStep.params[k]);
    expect(invasionParamsAt(st, null)).toEqual({ minSeparation: 0.1, maxMisfit: 0.15, bitSize: 8.5 });
    st.global[key('bitSize')] = 12.25;
    st.zones.c = { [key('minSeparation')]: 0.2 };
    expect(invasionParamsAt(st, 'c')).toEqual({ minSeparation: 0.2, maxMisfit: 0.15, bitSize: 12.25 });
    expect(invasionParamsAt(st, 'd')).toEqual({ minSeparation: 0.1, maxMisfit: 0.15, bitSize: 12.25 });
  });
});

describe('ajuste de una muestra y estados', () => {
  it('invasión resistiva limpia: recupera Rxo, di y Rt; lecturas modeladas = medidas; estado «Ajuste bueno»', () => {
    const v = view(Array.from(forwardStepProfile(40, 10, 1, R50)));
    expect(v.status).toBe('ok');
    expect(v.fit.rxo).toBeCloseTo(10, 3);
    expect(v.fit.rt).toBeCloseTo(1, 4);
    expect(2 * v.invasionRadius).toBeCloseTo(40, 2);
    for (const r of v.readings) expect(Math.abs(r.relativeError)).toBeLessThan(1e-4);
    expect(v.readings.map((r) => r.label)).toEqual(MNEM);
    expect(statusText(v).title).toBe('Ajuste bueno');
    expect(statusText(v).tone).toBe('ok');
  });

  it('sin invasión visible: Rt = lectura más profunda, sin frente, línea rayada desde la pared', () => {
    const v = view([1.02, 1.0, 1.01, 1.0, 1.03]);
    expect(v.status).toBe('no-invasion');
    expect(v.fit.rt).toBe(1.03);
    expect(Number.isNaN(v.invasionRadius)).toBe(true);
    const s = stepPolyline(v);
    expect(s).toEqual({ x: [4.25, RADIAL_X_AXIS.max], y: [1.03, 1.03], dashed: true });
    expect(statusText(v).title).toBe('Sin invasión visible');
    expect(corteBands(v).map((b) => b.kind)).toEqual(['borehole', 'virgin']);
  });

  it('datos insuficientes: menos de 3 lecturas válidas (NaN, ≤ 0)', () => {
    const v = view([NaN, 3, -1, NaN, 1]);
    expect(v.status).toBe('insufficient');
    expect(v.readings.filter((r) => Number.isFinite(r.observed))).toHaveLength(2);
    expect(stepPolyline(v).x).toHaveLength(0);
    expect(statusText(v).detail).toContain('2 lecturas válidas');
  });

  it('pico aislado: desajuste mayor que el máximo del módulo → «Ajuste dudoso»', () => {
    const vals = Array.from(forwardStepProfile(40, 4, 1, R50));
    vals[0] = 110;
    const v = view(vals);
    expect(['doubtful', 'poorly-resolved', 'unresolved']).toContain(v.status);
    if (v.status === 'doubtful') expect(statusText(v).title).toBe('Ajuste dudoso');
  });

  it('el umbral de desajuste es el del módulo en la zona', () => {
    const vals = Array.from(forwardStepProfile(40, 10, 1, R50));
    vals[1] *= 1.25;
    const loose = view(vals, {}, { ...PARAMS, maxMisfit: 1 });
    const strict = view(vals, {}, { ...PARAMS, maxMisfit: 0.001 });
    if (loose.status === 'ok') expect(strict.status).toBe('doubtful');
  });

  it('pozo dibujado con el caliper si tiene dato; trépano = curva BS si tiene dato, si no el parámetro', () => {
    const vals = Array.from(forwardStepProfile(40, 10, 1, R50));
    const a = view(vals, { caliperIn: 10 });
    expect(a.holeRadius).toBe(5);
    expect(a.holeFrom).toBe('caliper');
    expect(a.bitFrom).toBe('param');
    const b = view(vals, { caliperIn: NaN, bitIn: 12.25 });
    expect(b.holeRadius).toBeCloseTo(6.125, 9);
    expect(b.bitSize).toBe(12.25);
    expect(b.bitFrom).toBe('curve');
  });

  it('contraste débil (poorly-resolved): frente con su intervalo plausible de di, y el aviso de que el módulo deja Rxo y di sin dato', () => {
    const v = view(Array.from(forwardStepProfile(40, 1.3, 1, R50)));
    expect(v.status).toBe('poorly-resolved');
    expect(2 * v.invasionRadius).toBeCloseTo(40, 1);
    expect(v.invasionRadiusLow).toBeLessThan(v.invasionRadius);
    expect(v.invasionRadiusHigh).toBeGreaterThan(v.invasionRadius);
    expect(v.invasionRadiusLow).toBeGreaterThanOrEqual(v.holeRadius - 1e-9);
    expect(corteBands(v).map((b) => b.kind)).toEqual(['borehole', 'flushed', 'virgin']);
    expect(stepPolyline(v).dashed).toBe(false);
    expect(statusText(v)).toMatchObject({ tone: 'warn', title: 'di mal determinado' });
  });

  it('también un ajuste bueno trae su intervalo de di (la banda se dibuja siempre que exista)', () => {
    const v = view(Array.from(forwardStepProfile(40, 10, 1, R50)));
    expect(2 * v.invasionRadiusLow).toBeLessThan(40);
    expect(2 * v.invasionRadiusHigh).toBeGreaterThan(40);
  });

  it('no resuelto (σ en la cota por un pico): sin frente, Rt = lectura más profunda, línea rayada y motivo en el texto', () => {
    const vals = Array.from(forwardStepProfile(40, 4, 1, R50));
    vals[4] = 500;
    const v = view(vals);
    expect(v.status).toBe('unresolved');
    expect(v.fit.reason).toBe('sigma');
    expect(Number.isNaN(v.invasionRadius)).toBe(true);
    expect(Number.isNaN(v.invasionRadiusLow)).toBe(true);
    expect(v.fit.rt).toBe(500);
    expect(stepPolyline(v).dashed).toBe(true);
    expect(corteBands(v).map((b) => b.kind)).toEqual(['borehole', 'virgin']);
    expect(statusText(v).title).toBe('Invasión no resuelta');
    expect(statusText(v).detail).toContain('límite de la búsqueda');
    expect(statusText({ ...v, fit: { ...v.fit, reason: 'deep' } }).detail).toContain('máximo buscado');
    expect(statusText({ ...v, fit: { ...v.fit, reason: 'shallow' } }).detail).toContain('pared del pozo');
  });

  it('Rxo en la cota: Rxo sin dato, di y Rt válidos; el perfil empieza en el frente', () => {
    const base = view(Array.from(forwardStepProfile(40, 10, 1, R50)));
    const rxo = { ...base, fit: { ...base.fit, rxoAtBound: true, rxo: NaN } };
    expect(statusText(rxo).title).toBe('Rxo fuera de rango');
    expect(stepPolyline(rxo)).toEqual({ x: [base.invasionRadius, RADIAL_X_AXIS.max], y: [base.fit.rt, base.fit.rt], dashed: false });
  });
});

describe('geometría del dibujo', () => {
  it('sensibilidad radial: 1 en la mediana, simétrica en escala log, tiende a 0 lejos', () => {
    for (const r50 of R50) {
      expect(radialSensitivity(r50, r50)).toBeCloseTo(1, 12);
      expect(radialSensitivity(r50 * 3, r50)).toBeCloseTo(radialSensitivity(r50 / 3, r50), 12);
      expect(radialSensitivity(r50 * 1000, r50)).toBeLessThan(1e-3);
    }
  });

  it('corte: pozo, zona lavada y virgen contiguos, recortados al eje radial', () => {
    const b = corteBands({ holeRadius: 4.25, invasionRadius: 20 });
    expect(b).toEqual([
      { kind: 'borehole', from: 2, to: 4.25 },
      { kind: 'flushed', from: 4.25, to: 20 },
      { kind: 'virgin', from: 20, to: 200 },
    ]);
    expect(corteBands({ holeRadius: 4.25, invasionRadius: 500 }).at(-1)).toEqual({ kind: 'flushed', from: 4.25, to: 200 });
    expect(corteBands({ holeRadius: 4.25, invasionRadius: 4.25 }).map((x) => x.kind)).toEqual(['borehole', 'virgin']);
  });

  it('perfil escalonado: Rxo de la pared al frente, salto y Rt al borde', () => {
    const v = view(Array.from(forwardStepProfile(40, 10, 1, R50)));
    const s = stepPolyline(v);
    expect(s.x[0]).toBe(4.25);
    expect(s.x[1]).toBeCloseTo(20, 2);
    expect(s.x[3]).toBe(200);
    expect(s.y[0]).toBeCloseTo(10, 3);
    expect(s.y[3]).toBeCloseTo(1, 4);
    expect(s.dashed).toBe(false);
    // La curva de guía pasa por las lecturas modeladas.
    const app = apparentCurve(v, RADIAL_X_AXIS, 400);
    const at = (r: number) => app.y[nearestSampleIndex(app.x, r)]!;
    for (const r of v.readings) expect(Math.abs(at(r.r50) / r.modelled - 1)).toBeLessThan(0.02);
  });

  it('eje de resistividad en décadas enteras que contienen todo; sin datos, una década', () => {
    const v = view(Array.from(forwardStepProfile(40, 10, 1, R50)));
    const a = resistivityAxis(v);
    expect(a.kind).toBe('log');
    expect(a.min).toBeLessThanOrEqual(1);
    expect(a.max).toBeGreaterThanOrEqual(10);
    expect(resistivityAxis(null)).toMatchObject({ min: 1, max: 10 });
  });

  it('reparto: corte arriba y gráfico abajo, alineados en x, sin solaparse y dentro del lienzo', () => {
    for (const [w, h, ui] of [
      [640, 230, 1],
      [640, 160, 1],
      [900, 320, 1.25],
    ] as const) {
      const L = radialLayout(w, h, ui);
      expect(L.strip.x).toBe(L.plot.x);
      expect(L.strip.width).toBe(L.plot.width);
      expect(L.strip.y + L.strip.height).toBeLessThan(L.plot.y);
      expect(L.plot.y + L.plot.height).toBeLessThanOrEqual(h);
      expect(L.strip.height).toBeGreaterThanOrEqual(38 * ui - 1e-9);
    }
    expect(radialLayout(640, 160, 1).compact).toBe(true);
    expect(radialLayout(640, 230, 1).compact).toBe(false);
  });
});

describe('fijar profundidad', () => {
  afterEach(() => resetRadialPin());

  it('recuerda la última profundidad del cursor, fija y suelta; cambiar de pozo suelta lo fijado', () => {
    noteCursorDepth('w1', 2001.5);
    expect(getRadialPin()).toEqual({ wellId: 'w1', lastDepth: 2001.5, pinnedDepth: null });
    pinRadialDepth('w1', 2001.5);
    noteCursorDepth('w1', 2100);
    expect(getRadialPin()).toEqual({ wellId: 'w1', lastDepth: 2100, pinnedDepth: 2001.5 });
    noteCursorDepth('w2', 50);
    expect(getRadialPin()).toEqual({ wellId: 'w2', lastDepth: 50, pinnedDepth: null });
    pinRadialDepth('w2', null);
    expect(getRadialPin().pinnedDepth).toBeNull();
  });
});

describe('dibujo', () => {
  const draw = (v: RadialView | null, theme = THEMES.light) => {
    const c = new SvgContext2D({ width: 640, height: 260 });
    const colors = readableColors(Object.fromEntries(ROLES.map((r) => [r, '#1d4ed8'])), theme);
    withSvgPath2D(() => drawRadialProfile(c.asCanvas(), { width: 640, height: 260 }, { view: v, colors, rxoColor: '#0f8b8d' }, theme, 1));
    return c.toSvg('#ffffff');
  };

  it('dibuja el corte, las curvas y los valores (también en SVG, sin strokeText)', () => {
    const svg = draw(view(Array.from(forwardStepProfile(40, 10, 1, R50))));
    for (const t of ['Pozo', 'Zona lavada', 'Formación virgen', 'Corte', 'AT10', 'AT90', 'Rxo 10', 'Rt 1', 'di 40 in', 'Distancia al eje del pozo (in)']) expect(svg).toContain(t);
  });

  it('sin vista: el aviso; sin invasión: sin frente ni zona lavada; tema oscuro también', () => {
    expect(draw(null)).toContain('Sin datos');
    const svg = draw(view([1.02, 1.0, 1.01, 1.0, 1.03]), THEMES.dark);
    expect(svg).not.toContain('Zona lavada');
    expect(svg).toContain('Rt 1,03');
  });
});

describe('figura exportada', () => {
  it('«Exportar → Figuras» dibuja el perfil radial con su propio dibujo, tema claro y leyenda de las curvas', async () => {
    const { renderFigure } = await import('../src/app/export/figureRender');
    const { approximateMeasure } = await import('../src/io/export/figures');
    const v = view(Array.from(forwardStepProfile(40, 10, 1, R50)));
    const th = THEMES.light;
    const colors = readableColors(Object.fromEntries(ROLES.map((r) => [r, '#b45309'])), th);
    const step = stepPolyline(v);
    const src = {
      id: 'perfil-radial',
      title: 'Perfil radial de invasión',
      x: RADIAL_X_AXIS,
      y: resistivityAxis(v),
      points: v.readings.map((r) => ({ id: r.role, name: `${r.label} (lee a ${r.r50} in)`, x: [r.r50], y: [r.observed], color: colors[r.role]! })),
      lines: [{ id: 'step', name: 'Perfil escalonado ajustado', x: step.x, y: step.y, color: th.color.text }],
      trends: [],
      guides: [],
      plot: (ctx: CanvasRenderingContext2D, width: number, height: number) => void drawRadialProfile(ctx, { width, height }, { view: v, colors, rxoColor: '#0f8b8d' }, th, 1),
    };
    const raster = { measure: approximateMeasure, png: async () => new Uint8Array(), rgb: async () => ({ width: 1, height: 1, rgb: new Uint8Array(3) }) };
    const { file } = await renderFigure(
      { templateId: 'crossplot-legend', format: 'svg', range: { kind: 'well' }, verticalScale: 1000, widthCm: 16, heightCm: 10, marginCm: 0.6, dpi: 150, trackIds: null, title: '', orientation: 'landscape', xyId: 'perfil-radial' },
      { viewer: null, xy: [src], raster, date: new Date(2026, 9, 11) },
    );
    const svg = new TextDecoder().decode(file.bytes);
    for (const t of ['Perfil radial de invasión', 'Zona lavada', 'AT10 (lee a 10 in)', 'Perfil escalonado ajustado', 'Rxo 10', 'di 40 in']) expect(svg).toContain(t);
  });
});
