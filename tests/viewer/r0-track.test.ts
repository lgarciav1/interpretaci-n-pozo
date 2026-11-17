/**
 * R0 en la pista de resistividad (F16): R0 antes de Rt (Rt queda encima), relleno de hidrocarburo solo donde Rt > R0
 * (por valor), en el perfil clásico (el de fábrica) y en «Moderno», y R0 disponible como curva suelta con su relleno.
 */
import { describe, expect, it } from 'vitest';
import { createWell } from '../../src/core/well';
import { registry } from '../../src/modules';
import { contrastRatio } from '../../src/ui/color';
import { curveStyle, fillColor } from '../../src/ui/curves';
import { THEMES } from '../../src/ui/tokens';
import { buildTrackCatalog, OWN_FILLS } from '../../src/viewer/catalog';
import { AreaSink, fillBetween } from '../../src/viewer/fills';
import { resolveTracks, type ComputedCurve, type ResolvedFill } from '../../src/viewer/resolve';
import { valueToFraction } from '../../src/viewer/scale';
import { BUILTIN_LAYOUTS, MODERN_LAYOUTS, R0_FILL } from '../../src/viewer/templates';

const N = 11;
const depth = Float64Array.from({ length: N }, (_, i) => 1000 + i);
const series = (f: (i: number) => number) => Float64Array.from({ length: N }, (_, i) => f(i));
const measured = (id: string, role: string, data: Float64Array) => ({ id, mnemonic: id, role, unit: 'ohm.m', data, origin: { kind: 'measured' as const } });
const computed = (data: Float64Array): ComputedCurve => ({ port: 'R0', moduleId: 'r0', label: 'R0', data, active: true });

function resistivityTrack(layout: typeof BUILTIN_LAYOUTS.petrophysics, rt: Float64Array, r0: Float64Array | null) {
  const w = createWell({ id: 'w', name: 'W', depth, curves: [measured('AT90', 'RT', rt)] });
  const tracks = resolveTracks(layout, { depth, curves: w.curves, computed: r0 ? [computed(r0)] : [], catalog: registry.roles });
  return tracks.find((t) => t.id === 'resistivity')!;
}

/** Geometría del relleno como la dibuja render.ts: lado por VALOR (a − b) y solo los destinos que el spec define. */
function paint(t: ReturnType<typeof resistivityTrack>, fill: ResolvedFill, W = 200) {
  const y = series((i) => i);
  const grid = t.grid!;
  const x = (c: ResolvedFill['a']) => Float64Array.from(c.data, (v) => valueToFraction(v, grid) * W);
  const diff = Float64Array.from(fill.a.data, (v, i) => v - fill.b!.data[i]!);
  const aSink = new AreaSink();
  const bSink = new AreaSink();
  fillBetween(N, y, x(fill.a), x(fill.b!), fill.aLeft ? aSink : null, fill.bLeft ? bSink : null, 0, W, diff);
  return { a: aSink, b: bSink };
}

describe.each([
  ['perfil clásico (de fábrica)', BUILTIN_LAYOUTS.petrophysics],
  ['Moderno', MODERN_LAYOUTS.petrophysics],
])('pista de resistividad con R0: %s', (_name, layout) => {
  const flat = (v: number) => series(() => v);

  it('R0 va antes de Rt (Rt queda encima) y la plantilla trae el relleno de hidrocarburo por valor', () => {
    const spec = layout.find((t) => t.id === 'resistivity')!;
    const roles = spec.curves!.map((c) => (c.select as { role?: string }).role);
    expect(roles.indexOf('R0')).toBeGreaterThan(-1);
    expect(roles.indexOf('R0')).toBeLessThan(roles.indexOf('RT'));
    expect(roles[roles.length - 1]).toBe('RT');
    expect(spec.fills).toEqual([R0_FILL]);
    expect(R0_FILL).toMatchObject({ kind: 'between', a: 'R0', b: 'RT', aLeft: 'hydrocarbon', compare: 'value' });
    expect(R0_FILL).not.toHaveProperty('bLeft'); // donde Rt < R0 no se pinta nada
    expect(R0_FILL.opacity).toBeLessThan(1);
  });

  it('el relleno solo aparece donde Rt > R0: acuífero (Rt = R0) sin relleno; zona con hidrocarburo, con área exacta', () => {
    // muestras 0–4: Rt = R0 = 1 (acuífero); 5–10: Rt = 10, R0 = 1 (una década de separación)
    const rt = series((i) => (i < 5 ? 1 : 10));
    const t = resistivityTrack(layout, rt, flat(1));
    expect(t.curves.map((c) => c.role)).toContain('R0');
    expect(t.curves[t.curves.length - 1]!.role).toBe('RT');
    expect(t.fills).toHaveLength(1);
    const f = t.fills[0]!;
    expect(f).toMatchObject({ kind: 'between', compare: 'value', aLeft: 'hydrocarbon' });
    expect(f.bLeft).toBeUndefined();
    const W = 200;
    const { a, b } = paint(t, f, W);
    expect(b.polygons).toBe(0);
    expect(a.polygons).toBe(1);
    // una década en 4 décadas de escala = W/4 de ancho; tramo 4→5 es un triángulo (ancho 0 → W/4) y 5→10 un rectángulo
    const w = W / 4;
    expect(a.area).toBeCloseTo(w * 0.5 + w * 5, 9);
    // y nada por encima del tramo 4→5: el polígono arranca en la muestra 4 (donde Rt = R0)
    const aquifer = paint(t, f, W);
    expect(aquifer.a.area).toBeLessThan(w * 6);
  });

  it('con Rt ≤ R0 en todo el pozo (agua, o arcilla con φ baja) no se pinta nada', () => {
    for (const rt of [flat(1), flat(0.5), series((i) => 1 + 0.1 * Math.sin(i) - 0.1)]) {
      const t = resistivityTrack(layout, rt, flat(1));
      const { a, b } = paint(t, t.fills[0]!);
      expect(a.area, 'hidrocarburo').toBe(0);
      expect(b.area).toBe(0);
    }
  });

  it('un hueco (NaN) en R0 corta el relleno; sin R0 la pista se dibuja igual, sin curva ni relleno', () => {
    const r0 = series((i) => (i === 5 ? NaN : 1));
    const t = resistivityTrack(layout, flat(10), r0);
    const { a } = paint(t, t.fills[0]!);
    expect(a.polygons).toBe(2); // muestras 0–4 y 6–10
    const sin = resistivityTrack(layout, flat(10), null);
    expect(sin.curves.map((c) => c.role)).toEqual(['RT']);
    expect(sin.fills).toEqual([]);
  });

  it('el relleno sigue a los valores aunque cambie la escala de la pista', () => {
    // Rt = 10, R0 = 1: separación en valores, lado a la izquierda de Rt en cualquier escala log.
    const t = resistivityTrack(layout, flat(10), flat(1));
    const f = t.fills[0]!;
    const x0 = valueToFraction(1, t.grid!);
    const x1 = valueToFraction(10, t.grid!);
    expect(x0).toBeLessThan(x1);
    expect(paint(t, f).a.area).toBeCloseTo(((x1 - x0) * 200) * (N - 1), 9);
  });
});

describe('R0 como curva: estilo, catálogo y rellenos propios', () => {
  it('es una resistividad calculada en log 0,2–2000, azul punteada, distinta de la Rt roja y legible en ambos temas', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const catalog of [registry.roles]) {
        const r0 = curveStyle('R0', theme, catalog);
        const rt = curveStyle('RT', theme, catalog);
        expect(r0.scale).toBe('log');
        expect([r0.min, r0.max]).toEqual([0.2, 2000]);
        expect(r0.line).toBe('dotted');
        expect(r0.color).not.toBe(rt.color);
        const [r, , b] = [1, 3, 5].map((i) => parseInt(r0.color.slice(i, i + 2), 16));
        expect(b!).toBeGreaterThan(r!); // azulada
        expect(contrastRatio(r0.color, THEMES[theme].viewer.trackBg)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('el relleno de hidrocarburo se distingue de las curvas R0 y Rt en ambos temas', () => {
    for (const theme of ['light', 'dark'] as const) {
      const f = fillColor('hydrocarbon', theme);
      expect(f.alpha * R0_FILL.opacity!).toBeLessThan(0.5);
    }
  });

  it('el catálogo ofrece R0 entre las curvas calculadas (como RW) con su relleno, y una R0 suelta lo trae consigo', () => {
    const cat = buildTrackCatalog({ curves: [], roles: registry.roles, computed: new Set(), producible: new Set(['R0']) } as never);
    const item = cat.find((g) => g.id === 'computed')!.curves.find((c) => c.role === 'R0')!;
    expect(item).toBeDefined();
    expect(item.origin).toBe('computed');
    expect(item.status).toBe('computable');
    expect(item.fills).toEqual([R0_FILL]);
    expect(OWN_FILLS['R0']).toEqual([R0_FILL]);
  });
});
