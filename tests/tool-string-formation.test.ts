/**
 * Formación de la vista 3D de la sarta (docs/decisiones/0033, D9): columna litológica desde el GR o la litología
 * sugerida, recortada al tramo dibujado. Lo importante: los colores salen del pozo, las capas son contiguas y a la
 * profundidad real, y en planificación o sin datos la formación es neutra.
 */
import { describe, expect, it } from 'vitest';
import { resolveToolString } from '../src/core/toolString';
import { defaultToolCatalog } from '../src/core/tools';
import { THEMES } from '../src/ui/tokens';
import { FILL_PALETTE } from '../src/ui/curves';
import { clipLayers, depthWindow, formationFromFacies, formationFromGr, grClasses, layersFromClasses, GR_CLASSES } from '../src/app/toolString/formation';
import { AXIAL_SCENE_PER_M, buildToolStringScene } from '../src/app/toolString/scene';

const depthOf = (n: number, top = 1000, step = 0.5) => Float64Array.from({ length: n }, (_, i) => top + i * step);

describe('columna litológica', () => {
  it('clases del GR con P5–P95 del pozo entero; sin dato = −1', () => {
    const gr = Float64Array.from([...Array.from({ length: 100 }, (_, i) => i), NaN]);
    const c = grClasses(gr)!;
    expect(c[0]).toBe(0); // limpio
    expect(c[99]).toBe(4); // lutita
    expect(c[50]).toBe(2);
    expect(c[100]).toBe(-1);
    expect(grClasses(Float64Array.from([5, 5, 5]))).toBeNull();
  });

  it('capas contiguas, con las finas fundidas en la vecina y los huecos rellenos', () => {
    const depth = depthOf(12);
    // 4 de arena, 1 de lutita (fina: se funde), 3 de arena, 4 de lutita con un hueco.
    const cls = [0, 0, 0, 0, 4, 0, 0, 0, 4, -1, 4, 4];
    const layers = layersFromClasses(depth, cls, GR_CLASSES);
    expect(layers.map((l) => l.label)).toEqual(['Arena limpia', 'Lutita']);
    expect(layers[0]!.top).toBe(1000);
    expect(layers[0]!.base).toBeCloseTo(1003.75, 9); // a mitad de camino entre la muestra 7 y la 8
    expect(layers[1]!.top).toBe(layers[0]!.base);
    expect(layers[1]!.base).toBe(depth[11]);
    expect(layers[0]!.perm).toBeGreaterThan(layers[1]!.perm);
  });

  it('desde las facies: clases FORCE con su litología y permeabilidad sugerida', () => {
    const col = formationFromFacies(depthOf(9), [5, 5, 5, 10, 10, 10, 0, 0, 0])!;
    expect(col.source).toBe('facies');
    expect(col.layers.map((l) => [l.a, l.pattern])).toEqual([
      ['limestone', 'carbonate'],
      ['coal', 'coal'],
      ['sand', 'sand'],
    ]);
    expect(formationFromFacies(depthOf(3), [NaN, NaN, NaN])).toBeNull();
  });

  it('el tramo se centra en la profundidad pedida sin salir del pozo, y las capas se recortan a él', () => {
    const col = formationFromGr(depthOf(201), Float64Array.from({ length: 201 }, (_, i) => (i % 40 < 20 ? 20 : 120)))!;
    expect(depthWindow(col, 1050, 10)).toEqual({ top: 1045, base: 1055 });
    expect(depthWindow(col, 990, 10)).toEqual({ top: 1000, base: 1010 });
    expect(depthWindow(col, 2000, 10)).toEqual({ top: 1090, base: 1100 });
    const clipped = clipLayers(col, 1045, 1055);
    expect(clipped[0]!.top).toBe(1045);
    expect(clipped.at(-1)!.base).toBe(1055);
    for (let i = 1; i < clipped.length; i++) expect(clipped[i]!.top).toBe(clipped[i - 1]!.base);
  });
});

describe('formación en la escena', () => {
  const curves = [
    { id: 'GR', mnemonic: 'GR', role: 'GR' as const },
    { id: 'AT90', mnemonic: 'AT90', role: 'RT' as const },
  ];
  const base = (mode: 'data' | 'planning', withColumn = true) => {
    const resolved = resolveToolString(curves, mode === 'planning' ? { mode, off: [], order: [], plan: ['gr', 'induction'], planOff: [] } : undefined, defaultToolCatalog);
    // Arena de 1000 a 1004 m, lutita debajo.
    const depth = depthOf(400, 1000, 0.1);
    const gr = Float64Array.from(depth, (d) => (d < 1004 - 1e-9 ? 20 : 120));
    const column = formationFromGr(depth, gr)!;
    return buildToolStringScene({
      entries: resolved.entries,
      mode,
      borehole: { diameterIn: 8.5, schematic: false },
      colors: THEMES.light.scene,
      accent: '#000',
      curveColor: () => '#888',
      theme: 'light',
      formation: withColumn ? { column, center: 1000 } : null,
    });
  };

  it('modo datos: capas del pozo a su profundidad real (misma compresión que la sarta), cubriendo toda la formación', () => {
    const s = base('data');
    const env = s.environment;
    expect(env.source).toBe('gr');
    expect(env.depth!.top).toBe(1000);
    expect(env.strata[0]!.y1).toBe(env.y1);
    expect(env.strata.at(-1)!.y0).toBe(env.y0);
    for (let i = 1; i < env.strata.length; i++) expect(env.strata[i]!.y1).toBeCloseTo(env.strata[i - 1]!.y0, 9);
    // El contacto arena–lutita (a mitad de camino entre 1003,9 y 1004 m) queda 3,95 m × 20 unidades/m debajo del tope.
    const sand = env.strata[0]!;
    expect(sand.pattern).toBe('sand');
    expect(env.y1 - sand.y0).toBeCloseTo(3.95 * AXIAL_SCENE_PER_M, 6);
    expect(sand.perm).toBe(1);
    expect(env.strata[1]!.perm).toBe(0);
    // Color de la paleta de litología, mezclado con el fondo (contexto).
    expect(sand.color).not.toBe(FILL_PALETTE.sand.light);
  });

  it('planificación o sin columna: formación neutra, sin permeabilidad', () => {
    for (const s of [base('planning'), base('data', false)]) {
      expect(s.environment.source).toBe('neutral');
      expect(s.environment.depth).toBeUndefined();
      expect(s.environment.strata.every((x) => x.perm === 0 && x.pattern === 'plain')).toBe(true);
    }
  });
});
