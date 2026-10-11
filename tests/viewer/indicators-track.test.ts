/**
 * Pista «Indicadores» (fase 7c, docs/decisiones/0017): plantilla de fábrica de Petrofísica, catálogo de pistas y
 * resolución a franjas de color con leyenda; sin duplicar las banderas en «Banderas».
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../src/modules';
import { buildTrackCatalog } from '../../src/viewer/catalog';
import { resolveTracks, type ComputedCurve } from '../../src/viewer/resolve';
import { BUILTIN_LAYOUTS } from '../../src/viewer/templates';
import { curveStyle } from '../../src/ui/curves';

const N = 8;
const depth = Float64Array.from({ length: N }, (_, i) => 1000 + i);
const flag = (...v: number[]) => Float64Array.from(v);
const computed = (port: string, moduleId: string, data: Float64Array, active = true): ComputedCurve => ({ port, moduleId, label: moduleId, data, active });

const IND: ComputedCurve[] = [
  computed('IND_GAS', 'ind-gas-crossover', flag(0, 1, 1, 0, 0, 0, 0, 0)),
  computed('IND_SHALE', 'ind-shale', flag(1, 0, 0, 0, 1, 1, 0, NaN)),
  computed('IND_COAL', 'ind-coal', flag(0, 0, 0, 0, 0, 0, 0, 0)),
  computed('IND_WASHOUT', 'ind-washout', flag(0, 0, 0, 1, 1, 0, 0, 0)),
];
const NET = computed('NET_RES', 'cutoffs', flag(1, 1, 0, 0, 1, 1, 1, 0));

const src = (list: ComputedCurve[]) => ({ depth, curves: [], computed: list, catalog: registry.roles });
const PETRO = BUILTIN_LAYOUTS.petrophysics;

describe('pista «Indicadores»', () => {
  it('está en la plantilla de fábrica de Petrofísica, después de «Banderas», y no en Geología', () => {
    const ids = PETRO.map((t) => t.id);
    expect(ids.indexOf('indicators')).toBe(ids.indexOf('flags') + 1);
    expect(BUILTIN_LAYOUTS.geology.some((t) => t.id === 'indicators')).toBe(false);
    const t = PETRO.find((x) => x.id === 'indicators')!;
    expect(t).toMatchObject({ kind: 'flags', title: 'Indicadores', hideWhenEmpty: true });
  });

  it('una franja por indicador, en el orden gas, arcilla, carbón y derrumbe, con su nombre en la leyenda', () => {
    const tracks = resolveTracks(PETRO, src([...IND, NET]), {}, {});
    const t = tracks.find((x) => x.id === 'indicators')!;
    expect(t.kind).toBe('flags');
    expect(t.curves.map((c) => c.role)).toEqual(['IND_GAS', 'IND_SHALE', 'IND_COAL', 'IND_WASHOUT']);
    expect(t.curves.map((c) => c.short)).toEqual(['Gas', 'Arcilla', 'Carbón', 'Derrumbe']);
    expect(t.curves.every((c) => c.kind === 'band')).toBe(true);
    // colores distintos entre sí en cada tema (la leyenda y las franjas usan el mismo)
    for (const theme of ['light', 'dark'] as const) expect(new Set(t.curves.map((c) => c.styles[theme].color)).size).toBe(4);
  });

  it('«Banderas» solo recolecta las de reservorio y pay: las de indicadores no se duplican', () => {
    const tracks = resolveTracks(PETRO, src([...IND, NET]), {}, {});
    expect(tracks.find((x) => x.id === 'flags')!.curves.map((c) => c.role)).toEqual(['NET_RES']);
  });

  it('sin indicadores calculados la pista no se muestra; con uno solo, muestra una franja', () => {
    expect(resolveTracks(PETRO, src([NET]), {}, {}).some((x) => x.id === 'indicators')).toBe(false);
    const one = resolveTracks(PETRO, src([IND[3]!]), {}, {}).find((x) => x.id === 'indicators')!;
    expect(one.curves.map((c) => c.role)).toEqual(['IND_WASHOUT']);
  });

  it('el catálogo ofrece la herramienta «Indicadores» y las cuatro curvas como banderas', () => {
    const cat = buildTrackCatalog({
      curves: [],
      roles: registry.roles,
      computed: new Set(['IND_GAS', 'IND_SHALE', 'IND_COAL', 'IND_WASHOUT']),
      producible: new Set(['IND_GAS', 'IND_SHALE', 'IND_COAL', 'IND_WASHOUT']),
    } as never);
    const flags = cat.find((g) => g.id === 'flags')!;
    expect(flags.tools.map((t) => t.id)).toEqual(['tool:flags', 'tool:indicators']);
    const names = flags.curves.map((c) => c.role);
    for (const r of ['IND_GAS', 'IND_SHALE', 'IND_COAL', 'IND_WASHOUT']) expect(names).toContain(r);
    expect(flags.curves.filter((c) => c.role?.startsWith('IND_')).every((c) => c.flag)).toBe(true);
  });

  it('paleta curada para las cuatro franjas', () => {
    for (const r of ['IND_GAS', 'IND_SHALE', 'IND_COAL', 'IND_WASHOUT']) {
      expect(curveStyle(r, 'light', registry.roles).kind).toBe('band');
      expect(curveStyle(r, 'dark', registry.roles).kind).toBe('band');
    }
  });
});
