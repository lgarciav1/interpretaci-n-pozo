/** Caracterización de main 4f187f6: protege el comportamiento clásico durante el rediseño opcional. */
import { describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { computeOnce, toEngineWell } from '../../src/core/engine/engine';
import { addWell, createProject } from '../../src/core/state/project';
import { deserializeProject, serializeProject } from '../../src/core/state/serialize';
import { readWellFile } from '../../src/io';
import { registry } from '../../src/modules';
import { resolveTracks, type ComputedCurve } from '../../src/viewer/resolve';
import { BUILTIN_LAYOUTS, layoutFor } from '../../src/viewer/templates';

describe('línea base clásica del TP', () => {
  it('un proyecto guardado sin pistas propias conserva la fábrica y sus fuentes, parámetros y datos', async () => {
    const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
    expect(well.depth.values).toHaveLength(5810);
    expect(well.curves).toHaveLength(18);
    const p = addWell(createProject('Base TP'), well, zones);
    const saved = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    expect(saved.version).toBe(6);
    expect(saved.project.display.layouts).toEqual({});
    const opened = await deserializeProject(JSON.stringify(saved));
    expect(opened.wells).toEqual(p.wells);
    expect(layoutFor('petrophysics', opened.display.layouts)).toBe(BUILTIN_LAYOUTS.petrophysics);
    expect(layoutFor('geology', opened.display.layouts)).toBe(BUILTIN_LAYOUTS.geology);
  });

  it('conserva los once grupos clásicos y las 52 curvas del recolector para quien elige esa vista', () => {
    const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
    const p = addWell(createProject('Base TP'), well, zones);
    const result = computeOnce(registry, toEngineWell(well), p.wells[0]!.interpretation);
    const computed: ComputedCurve[] = result.outputs.flatMap((o) => o.kind === 'curve' && o.value instanceof Float64Array
      ? [{ port: o.port, moduleId: o.moduleId, label: o.label, active: o.active, data: o.value }]
      : []);
    const tracks = resolveTracks(layoutFor('petrophysics', p.display.layouts), { depth: well.depth.values, curves: well.curves, computed, catalog: registry.roles });
    expect(tracks.map((t) => t.id)).toEqual(['correlation', 'depth', 'resistivity', 'porosity', 'sonic', 'computed', 'saturation', 'volumetric', 'permeability', 'flags', 'indicators']);
    // 47 de la línea base + M, N, Umaa y Th/K de «Índices de litología» (0059) + la distribución de la arcilla de
    // Thomas–Stieber (0061): el recolector suma los módulos nuevos.
    expect(tracks.find((t) => t.id === 'computed')!.curves).toHaveLength(52);
    expect(tracks.find((t) => t.id === 'porosity')!.curves.map((c) => c.role)).toEqual(['PEF', 'NPHI', 'RHOB']);
  });
});
