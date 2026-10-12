/**
 * Pista «RMN» (fase 8a, docs/decisiones/0019): escala 0,5 → 0 compartida, partición CBW / BVI / FFI por valores, PHIE
 * de densidad–neutrón encima, la misma pista en Geología y en el catálogo, y la bandera de déficit en «Indicadores».
 */
import { describe, expect, it } from 'vitest';
import { createWell } from '../../src/core/well';
import { registry } from '../../src/modules';
import { contrastRatio } from '../../src/ui/color';
import { curveStyle, fillColor } from '../../src/ui/curves';
import { THEMES } from '../../src/ui/tokens';
import { buildTrackCatalog, OWN_FILLS } from '../../src/viewer/catalog';
import { AreaSink, fillBetween } from '../../src/viewer/fills';
import { resolveTracks, type ComputedCurve } from '../../src/viewer/resolve';
import { valueToFraction } from '../../src/viewer/scale';
import { BUILTIN_LAYOUTS, NMR_TRACK } from '../../src/viewer/templates';

/** Distancia de tono (grados) entre dos colores hex. */
function hueDistance(a: string, b: string): number {
  const hue = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const max = Math.max(r, g, bl);
    const min = Math.min(r, g, bl);
    if (max === min) return NaN; // gris: sin tono
    const d = max - min;
    const h = max === r ? ((g - bl) / d) % 6 : max === g ? (bl - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const ha = hue(a);
  const hb = hue(b);
  if (Number.isNaN(ha) || Number.isNaN(hb)) return 180;
  const d = Math.abs(ha - hb) % 360;
  return Math.min(d, 360 - d);
}

const N = 11;
const depth = Float64Array.from({ length: N }, (_, i) => 1000 + i);
const constant = (v: number) => Float64Array.from({ length: N }, () => v);
const measured = (id: string, role: string, data: Float64Array) => ({ id, mnemonic: id, role, unit: 'v/v', data, origin: { kind: 'measured' as const } });
const well = createWell({
  id: 'w',
  name: 'W',
  depth,
  curves: [measured('PHIT_CMR', 'PHIT_NMR', constant(0.3)), measured('PHIE_CMR', 'PHIE_NMR', constant(0.2)), measured('PHI_BVI', 'BVI_NMR', constant(0.05))],
});
const phie: ComputedCurve = { port: 'PHIE', moduleId: 'phie-vsh', label: 'PHIE', data: constant(0.25), active: true };
const src = (computed: ComputedCurve[] = [phie]) => ({ depth, curves: well.curves, computed, catalog: registry.roles });

describe('pista «RMN»', () => {
  const [t] = resolveTracks([NMR_TRACK], src());

  it('cuatro curvas en 0,5 → 0 (más porosidad a la izquierda, como PHIE y NPHI), PHIE de densidad–neutrón encima', () => {
    expect(t!.curves.map((c) => c.role)).toEqual(['BVI_NMR', 'PHIT_NMR', 'PHIE_NMR', 'PHIE']);
    for (const c of t!.curves) expect(c.axis).toEqual({ kind: 'linear', min: 0, max: 0.5, reversed: true });
    expect(t!.grid).toEqual({ kind: 'linear', min: 0, max: 0.5, reversed: true });
    // PHIE gruesa: es la línea de comparación.
    const top = t!.curves[3]!;
    expect(top.styles.light.width).toBeGreaterThan(t!.curves[2]!.styles.light.width);
  });

  it('rellenos: agua irreducible desde el borde derecho, fluido libre y agua ligada a la arcilla por valores', () => {
    expect(t!.fills.map((f) => [f.kind, f.a.role, f.b?.role ?? f.side, f.aLeft ?? f.bLeft, f.compare])).toEqual([
      ['edge', 'BVI_NMR', 'right', 'capillaryWater', 'screen'],
      ['between', 'BVI_NMR', 'PHIE_NMR', 'freeFluid', 'value'],
      ['between', 'PHIE_NMR', 'PHIT_NMR', 'clayBoundWater', 'value'],
    ]);
  });

  it('las áreas de los rellenos son los volúmenes BVI, FFI y CBW en la escala de la pista', () => {
    const W = 200;
    const y = Float64Array.from({ length: N }, (_, i) => i);
    const x = (data: Float64Array) => Float64Array.from(data, (v) => valueToFraction(v, t!.grid!) * W);
    const [bvi, phit, phieNmr] = t!.curves.map((c) => c.data);
    const diff = (a: Float64Array, b: Float64Array) => Float64Array.from(a, (v, i) => v - b[i]!);
    const area = (xa: Float64Array, xb: Float64Array | number, d?: Float64Array) => {
      const s = new AreaSink();
      fillBetween(N, y, xa, xb, s, s, 0, W, d);
      return s.area;
    };
    const perVolume = (W / 0.5) * (N - 1); // área de 1 v/v en toda la altura
    expect(area(x(bvi!), W) / perVolume).toBeCloseTo(0.05, 9);
    expect(area(x(bvi!), x(phieNmr!), diff(bvi!, phieNmr!)) / perVolume).toBeCloseTo(0.15, 9);
    expect(area(x(phieNmr!), x(phit!), diff(phieNmr!, phit!)) / perVolume).toBeCloseTo(0.1, 9);
    // PHIE (0,25) a la izquierda de PHIE_NMR (0,20): el déficit se ve como separación hacia la izquierda.
    expect(valueToFraction(0.25, t!.grid!)).toBeLessThan(valueToFraction(0.2, t!.grid!));
  });

  it('PHIE se distingue de PHIE_NMR y los tres rellenos se distinguen entre sí, en claro y en oscuro', () => {
    for (const theme of ['light', 'dark'] as const) {
      const phieLine = t!.curves[3]!.styles[theme].color;
      expect(phieLine).not.toBe(t!.curves[2]!.styles[theme].color);
      // la PHIE roja se lee sobre los tres rellenos
      for (const f of ['capillaryWater', 'freeFluid', 'clayBoundWater'] as const) expect(hueDistance(phieLine, fillColor(f, theme).color)).toBeGreaterThan(40);
      const fills = (['capillaryWater', 'freeFluid', 'clayBoundWater'] as const).map((f) => fillColor(f, theme).color);
      expect(new Set(fills).size).toBe(3);
      // las líneas se leen sobre el fondo de pista
      for (const c of t!.curves) expect(contrastRatio(c.styles[theme].color, THEMES[theme].viewer.trackBg)).toBeGreaterThanOrEqual(2.95);
    }
  });

  it('sin PHIE calculada muestra la partición igual (la comparación aparece cuando hay porosidad efectiva)', () => {
    const [u] = resolveTracks([NMR_TRACK], src([]));
    expect(u!.curves.map((c) => c.role)).toEqual(['BVI_NMR', 'PHIT_NMR', 'PHIE_NMR']);
    expect(u!.fills).toHaveLength(3);
  });

  it('es la misma pista en Geología y en el catálogo; Petrofísica la ofrece como herramienta armable', () => {
    expect(BUILTIN_LAYOUTS.geology.find((x) => x.id === 'nmr')).toBe(NMR_TRACK);
    expect(BUILTIN_LAYOUTS.petrophysics.some((x) => x.id === 'nmr')).toBe(false);
    const cat = buildTrackCatalog({ curves: well.curves, roles: registry.roles, computed: new Set(), producible: new Set() } as never);
    const tool = cat.find((g) => g.id === 'nmr')!.tools.find((x) => x.id === 'tool:nmr')!;
    expect(tool.available).toBe(true);
    const { id: _id, ...rest } = NMR_TRACK;
    expect(tool.track).toEqual(rest);
    // Una curva de RMN suelta lleva los rellenos que limita.
    expect(OWN_FILLS['PHIE_NMR']).toEqual([NMR_TRACK.fills![1], NMR_TRACK.fills![2]]);
  });
});

describe('déficit de RMN en «Indicadores»', () => {
  const flag = (...v: number[]) => Float64Array.from({ length: N }, (_, i) => v[i % v.length]!);
  const IND: ComputedCurve[] = [
    { port: 'IND_GAS', moduleId: 'ind-gas-crossover', label: 'g', data: flag(0, 1), active: true },
    { port: 'IND_NMR_DEFICIT', moduleId: 'nmr-fluids', label: 'd', data: flag(1, 0), active: true },
  ];

  it('franja al final de «Indicadores», con nombre corto, y no se duplica en «Banderas»', () => {
    const tracks = resolveTracks(BUILTIN_LAYOUTS.petrophysics, src(IND));
    const ind = tracks.find((x) => x.id === 'indicators')!;
    expect(ind.curves.map((c) => c.role)).toEqual(['IND_GAS', 'IND_NMR_DEFICIT']);
    expect(ind.curves[1]!.kind).toBe('band');
    expect(ind.curves[1]!.short).toBe('Déficit de RMN');
    expect(tracks.some((x) => x.id === 'flags')).toBe(false);
  });

  it('color propio, distinto de los otros cuatro indicadores', () => {
    for (const theme of ['light', 'dark'] as const) {
      const others = ['IND_GAS', 'IND_SHALE', 'IND_COAL', 'IND_WASHOUT'].map((r) => curveStyle(r, theme, registry.roles).color);
      expect(others).not.toContain(curveStyle('IND_NMR_DEFICIT', theme, registry.roles).color);
    }
  });
});
