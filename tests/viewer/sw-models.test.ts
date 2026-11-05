/**
 * Pista «Modelos de Sw» (docs/decisiones/0018): qué curvas entran, cómo se resuelve la banda entre la mínima y la
 * máxima, selector por módulo y receta de «Mostrar modelos de Sw».
 */
import { describe, expect, it } from 'vitest';
import { sanitizeDisplay, type TrackSpec } from '../../src/core/display';
import { defaultRoleCatalog } from '../../src/core/roles';
import { addWell, createProject } from '../../src/core/state/project';
import { entryIndexFor, selectorKey } from '../../src/core/state/tracks';
import { createWell, type Curve } from '../../src/core/well';
import { buildTrackCatalog } from '../../src/viewer/catalog';
import { curveEnvelope, resolveTracks, type ComputedCurve } from '../../src/viewer/resolve';
import { isSwModelsTrack, SW_MODEL_IDS, SW_MODELS, SW_MODELS_TRACK, showSwModelsRecipe, swModelCurves, swModelsToCompare } from '../../src/viewer/swModels';
import { BUILTIN_LAYOUTS, MODERN_LAYOUTS } from '../../src/viewer/templates';

const depth = Float64Array.from({ length: 5 }, (_, i) => 1000 + i);
const LABELS: Record<string, string> = { 'sw-archie': 'Sw — Archie', 'sw-simandoux': 'Sw — Simandoux', 'sw-indonesia': 'Sw — Indonesia' };
const sw = (moduleId: string, values: number[], active = false): ComputedCurve => ({ port: 'SW', moduleId, label: LABELS[moduleId] ?? moduleId, data: Float64Array.from(values), active });
const resolve = (computed: ComputedCurve[], layout: readonly TrackSpec[] = [SW_MODELS_TRACK], curves: Curve[] = []) =>
  resolveTracks(layout, { depth, curves, computed, catalog: defaultRoleCatalog });

describe('curveEnvelope', () => {
  it('mínima y máxima muestra a muestra', () => {
    const e = curveEnvelope([[0.2, 0.5, 0.9], [0.4, 0.3, 0.9], [0.3, 0.8, 0.6]]);
    expect([...e.min]).toEqual([0.2, 0.3, 0.6]);
    expect([...e.max]).toEqual([0.4, 0.8, 0.9]);
  });
  it('ignora NaN; con menos de dos valores no hay banda', () => {
    const e = curveEnvelope([[NaN, 0.5, 0.2, NaN], [0.4, NaN, 0.6, NaN], [NaN, 0.7, NaN, NaN]]);
    expect(e.min[0]).toBeNaN();
    expect(e.max[0]).toBeNaN();
    expect([e.min[1], e.max[1]]).toEqual([0.5, 0.7]);
    expect([e.min[2], e.max[2]]).toEqual([0.2, 0.6]);
    expect(e.min[3]).toBeNaN();
  });
  it('series de distinto largo: usa el más largo y lo que falta cuenta como sin dato', () => {
    const e = curveEnvelope([[0.1, 0.2], [0.3]]);
    expect(e.min.length).toBe(2);
    expect([e.min[0], e.max[0]]).toEqual([0.1, 0.3]);
    expect(e.min[1]).toBeNaN();
  });
});

describe('qué curvas entran en la pista', () => {
  const all = [sw('sw-indonesia', [0.3, 0.3, 0.3, 0.3, 0.3]), sw('sw-archie', [0.5, 0.5, 0.5, 0.5, 0.5], true), sw('sw-simandoux', [0.4, 0.4, 0.4, 0.4, 0.4]), sw('sw-otro', [0.9, 0.9, 0.9, 0.9, 0.9])];

  it('swModelCurves: solo los tres modelos, en el orden de SW_MODELS', () => {
    expect(swModelCurves(all).map((c) => c.moduleId)).toEqual(['sw-archie', 'sw-simandoux', 'sw-indonesia']);
    expect(swModelCurves([sw('sw-simandoux', [0.4])]).map((c) => c.moduleId)).toEqual(['sw-simandoux']);
    expect(swModelCurves([])).toEqual([]);
  });

  it('la pista toma la salida de cada módulo nombrado, activa o alternativa, y no una curva medida ni otro módulo', () => {
    const measuredSw: Curve = { id: 'SWT', mnemonic: 'SWT', role: 'SW', unit: 'v/v', data: Float64Array.from([0.1, 0.1, 0.1, 0.1, 0.1]), origin: { kind: 'measured' } };
    const t = resolve(all, [SW_MODELS_TRACK], [measuredSw])[0]!;
    expect(t.curves.map((c) => c.moduleId)).toEqual(['sw-archie', 'sw-simandoux', 'sw-indonesia']);
    // Ninguna se marca «alternativa»: en esta pista son tres curvas de primera.
    expect(t.curves.every((c) => !c.alternative)).toBe(true);
    expect(t.curves.every((c) => c.origin === 'computed')).toBe(true);
  });

  it('cada encabezado dice qué modelo es, no tres veces «SW»', () => {
    const t = resolve(all)[0]!;
    expect(t.curves.map((c) => c.name)).toEqual(['Archie', 'Simandoux', 'Indonesia']);
    expect(t.curves.every((c) => c.role === 'SW')).toBe(true);
    expect(t.curves[0]!.title).toMatch(/Archie.*alimenta la cadena/);
    expect(t.curves[1]!.title).toMatch(/Simandoux.*para comparar/);
  });

  it('colores y trazos distinguibles, y escala 1 → 0 como la pista de Sw', () => {
    const t = resolve(all)[0]!;
    const colors = t.curves.map((c) => c.styles.light.color.toLowerCase());
    expect(new Set(colors).size).toBe(3);
    expect(new Set(t.curves.map((c) => c.styles.light.line)).size).toBe(3);
    for (const c of t.curves) expect(c.axis).toEqual({ kind: 'linear', min: 0, max: 1, reversed: true });
    expect(t.grid).toEqual({ kind: 'linear', min: 0, max: 1, reversed: true });
  });

  it('con un solo modelo calculado la pista muestra la curva y no hay banda', () => {
    const t = resolve([sw('sw-archie', [0.5, 0.5, 0.5, 0.5, 0.5], true)])[0]!;
    expect(t.curves).toHaveLength(1);
    expect(t.fills).toHaveLength(0);
  });

  it('sin ningún modelo la pista queda vacía (con su aviso)', () => {
    const t = resolve([])[0]!;
    expect(t.curves).toHaveLength(0);
    expect(t.emptyHint).toMatch(/Sin modelos/);
  });
});

describe('sombreado entre la mínima y la máxima', () => {
  const archie = sw('sw-archie', [0.5, 0.5, NaN, 0.2, 0.9], true);
  const simandoux = sw('sw-simandoux', [0.3, 0.6, 0.4, 0.2, 0.7]);
  const indonesia = sw('sw-indonesia', [0.4, 0.8, NaN, 0.25, 0.8]);

  it('un relleno entre dos curvas sintéticas: la mínima y la máxima de los tres', () => {
    const t = resolve([archie, simandoux, indonesia])[0]!;
    expect(t.fills).toHaveLength(1);
    const f = t.fills[0]!;
    expect(f.kind).toBe('between');
    expect(f.aLeft).toBe('modelSpread');
    expect(f.bLeft).toBe('modelSpread');
    expect([...f.a.data]).toEqual([0.3, 0.5, NaN, 0.2, 0.7]);
    expect([...f.b!.data]).toEqual([0.5, 0.8, NaN, 0.25, 0.9]);
    // Las curvas de la banda no se agregan a la pista: ni encabezado ni lectura.
    expect(t.curves).toHaveLength(3);
  });

  it('dos modelos alcanzan; donde solo hay uno (NaN en los otros) no hay banda', () => {
    const t = resolve([archie, simandoux])[0]!;
    const f = t.fills[0]!;
    expect([...f.a.data]).toEqual([0.3, 0.5, NaN, 0.2, 0.7]);
    expect([...f.b!.data]).toEqual([0.5, 0.6, NaN, 0.2, 0.9]);
  });

  it('las curvas de la banda se reusan mientras los datos sean los mismos (no se recalcula en cada resolución)', () => {
    const a = resolve([archie, simandoux, indonesia])[0]!.fills[0]!;
    const b = resolve([archie, simandoux, indonesia])[0]!.fills[0]!;
    expect(b.a.data).toBe(a.a.data);
    expect(b.b!.data).toBe(a.b!.data);
    const c = resolve([archie, simandoux, sw('sw-indonesia', [0.1, 0.1, 0.1, 0.1, 0.1])])[0]!.fills[0]!;
    expect(c.a.data).not.toBe(a.a.data);
  });

  it('la banda usa la misma escala que las curvas (1 → 0)', () => {
    const f = resolve([archie, simandoux, indonesia])[0]!.fills[0]!;
    expect(f.a.axis.reversed).toBe(true);
    expect(f.a.axis).toEqual(f.b!.axis);
  });
});

describe('selector por módulo', () => {
  it('selectorKey distingue el módulo; entryIndexFor lo busca primero', () => {
    expect(selectorKey({ role: 'SW' })).toBe('r:SW');
    expect(selectorKey({ role: 'SW', module: 'sw-archie' })).toBe('r:SW@sw-archie');
    expect(entryIndexFor(SW_MODELS_TRACK, { role: 'SW', origin: 'computed', moduleId: 'sw-indonesia' })).toBe(2);
    expect(entryIndexFor(SW_MODELS_TRACK, { role: 'SW', origin: 'computed', moduleId: 'sw-otro' })).toBe(-1);
  });

  it('el módulo y el relleno sobreviven al guardar y abrir el proyecto', () => {
    const warnings: string[] = [];
    const display = sanitizeDisplay({ layouts: { petrophysics: [SW_MODELS_TRACK] }, roles: {}, curves: {} }, (m) => warnings.push(m));
    expect(warnings).toEqual([]);
    expect(display.layouts['petrophysics']![0]).toEqual(SW_MODELS_TRACK);
  });

  it('isSwModelsTrack reconoce la pista; la de Sw de fábrica no lo es', () => {
    expect(isSwModelsTrack(SW_MODELS_TRACK)).toBe(true);
    expect(isSwModelsTrack(BUILTIN_LAYOUTS.petrophysics.find((t) => t.id === 'saturation')!)).toBe(false);
  });

  it('la pista de fábrica de Sw sigue mostrando la activa y las alternativas como antes', () => {
    const curves = [sw('sw-archie', [0.5, 0.5, 0.5, 0.5, 0.5], true), sw('sw-simandoux', [0.4, 0.4, 0.4, 0.4, 0.4])];
    // Perfil clásico (0067) y «Moderno»: SW en «Porosidad · Sw».
    const t = resolve(curves, BUILTIN_LAYOUTS.petrophysics).find((x) => x.id === 'saturation')!;
    expect(t.curves.map((c) => [c.moduleId, c.alternative])).toEqual([['sw-simandoux', true], ['sw-archie', false]]);
    const m = resolve(curves, MODERN_LAYOUTS.petrophysics).find((x) => x.id === 'saturation')!;
    expect(m.curves.map((c) => [c.moduleId, c.alternative])).toEqual([['sw-simandoux', true], ['sw-archie', false]]);
  });
});

describe('catálogo', () => {
  it('«Modelos de Sw» aparece como herramienta del grupo de curvas calculadas, no en la plantilla de fábrica', () => {
    const groups = buildTrackCatalog({ roles: defaultRoleCatalog, curves: [], producible: new Set(['SW']), computed: new Set() });
    const tool = groups.find((g) => g.id === 'computed')!.tools.find((t) => t.id === 'tool:sw-models')!;
    expect(tool.available).toBe(true);
    expect(tool.track.title).toBe('Modelos de Sw');
    expect(BUILTIN_LAYOUTS.petrophysics.some(isSwModelsTrack)).toBe(false);
    expect(BUILTIN_LAYOUTS.geology.some(isSwModelsTrack)).toBe(false);
  });
});

describe('receta «Mostrar modelos de Sw»', () => {
  const well = createWell({ id: 'w', name: 'W', depth, curves: [] });
  const project = addWell(createProject(), well);
  const factory = BUILTIN_LAYOUTS.petrophysics;

  it('swModelsToCompare: los que faltan, sin la fuente activa', () => {
    expect(swModelsToCompare([], 'sw-archie')).toEqual(['sw-simandoux', 'sw-indonesia']);
    expect(swModelsToCompare(['sw-simandoux'], 'sw-archie')).toEqual(['sw-indonesia']);
    expect(swModelsToCompare([], null)).toEqual(SW_MODEL_IDS);
    expect(swModelsToCompare([...SW_MODEL_IDS], null)).toEqual([]);
  });

  it('activa la comparación y agrega la pista después de Porosidad · Sw, en un solo proyecto nuevo', () => {
    const out = showSwModelsRecipe(project, 'w', 'petrophysics', factory, 'sw-archie');
    expect(out.wells[0]!.interpretation.compare).toEqual(['sw-simandoux', 'sw-indonesia']);
    const ids = out.display.layouts['petrophysics']!.map((t) => t.id);
    expect(ids.indexOf('sw-models')).toBe(ids.indexOf('saturation') + 1);
    expect(ids).toHaveLength(factory.length + 1);
  });

  it('si la pista ya está solo activa la comparación; si todo estaba, no cambia nada', () => {
    const once = showSwModelsRecipe(project, 'w', 'petrophysics', factory, 'sw-archie');
    const again = showSwModelsRecipe(once, 'w', 'petrophysics', once.display.layouts['petrophysics']!, 'sw-archie');
    expect(again).toBe(once);
    const partial = showSwModelsRecipe(project, 'w', 'petrophysics', once.display.layouts['petrophysics']!, 'sw-simandoux');
    expect(partial.wells[0]!.interpretation.compare).toEqual(['sw-archie', 'sw-indonesia']);
    expect(partial.display.layouts['petrophysics']).toBeUndefined();
  });

  it('SW_MODELS tiene los tres módulos del motor', () => {
    expect(SW_MODELS.map((m) => m.moduleId)).toEqual(['sw-archie', 'sw-simandoux', 'sw-indonesia']);
  });
});
