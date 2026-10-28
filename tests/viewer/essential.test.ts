/** Vista esencial opcional: compatibilidad de proyectos, cálculo, catálogo y figura. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { applyEssentialTemplate, currentTemplate, resetToFactory } from '../../src/app/tracks/actions';
import { templateMenuItems, templateName } from '../../src/app/tracks/Templates';
import { useProject } from '../../src/app/store/project';
import { Engine, toEngineWell, type EngineRunResult } from '../../src/core/engine/engine';
import type { TrackSpec } from '../../src/core/display';
import { addWell, createProject, setTrackLayout } from '../../src/core/state/project';
import { saveTrackTemplate } from '../../src/core/state/tracks';
import { deserializeProject, PROJECT_VERSION, serializeProject } from '../../src/core/state/serialize';
import { readWellFile } from '../../src/io';
import { buildExportColumns } from '../../src/io/export/columns';
import { SvgContext2D, withSvgPath2D } from '../../src/io/export/figures';
import { registry } from '../../src/modules';
import { buildTrackCatalog } from '../../src/viewer/catalog';
import { essentialPetrophysicsLayout, ESSENTIAL_NAME } from '../../src/viewer/essential';
import { drawViewerFigure, layoutViewerFigure } from '../../src/viewer/figure';
import { buildViewerFigure } from '../../src/viewer/figureInput';
import type { ViewerOverlay } from '../../src/viewer/overlay';
import { resolveTracks, type ComputedCurve } from '../../src/viewer/resolve';
import { BUILTIN_LAYOUTS, layoutFor, withOverlayTracks } from '../../src/viewer/templates';
import { tpFigureContext, tpRequest } from '../figures/support';

const tp = readWellFile(csvText, 'pozo_tp_perfiles.csv');
const base = () => addWell(createProject('Prueba'), tp.well, tp.zones);
const computedOf = (r: EngineRunResult): ComputedCurve[] => r.outputs.flatMap((o) =>
  o.kind === 'curve' && o.value instanceof Float64Array
    ? [{ port: o.port, moduleId: o.moduleId, label: o.label, active: o.active, data: o.value }]
    : []);

beforeEach(() => {
  // announce() no necesita DOM si la región aria-live no está montada.
  vi.stubGlobal('document', { getElementById: () => null });
  useProject.getState().replace(base());
});
afterEach(() => vi.unstubAllGlobals());

describe('selección explícita de una vista sin cambiar la aplicación existente', () => {
  it('la fábrica sigue siendo la predeterminada y la nueva opción solo se ofrece en Petrofísica', () => {
    const p = useProject.getState().project;
    expect(layoutFor('petrophysics', p.display.layouts)).toBe(BUILTIN_LAYOUTS.petrophysics);
    expect(currentTemplate(p, 'petrophysics', [])).toEqual({ kind: 'factory' });
    expect(templateMenuItems('petrophysics', { kind: 'factory' }).map((i) => i.id)).toContain('essential');
    expect(templateMenuItems('geology', { kind: 'factory' }).map((i) => i.id)).not.toContain('essential');
    expect(p.display.layouts).toEqual({});
  });

  it('aplicar cambia solo las pistas de Petrofísica; undo/redo recupera exactamente el proyecto anterior', () => {
    const custom: TrackSpec[] = [{ id: 'mi-caliper', title: 'Mi caliper', kind: 'curves', width: 2, curves: [{ select: { role: 'CALI' } }] }];
    const p = setTrackLayout(setTrackLayout(base(), 'petrophysics', custom), 'geology', custom);
    useProject.getState().replace(p);
    applyEssentialTemplate();
    const next = useProject.getState().project;
    expect(next.wells).toBe(p.wells);
    expect(next.snapshots).toBe(p.snapshots);
    expect(next.display.layouts.geology).toBe(custom);
    expect(next.display.curves).toBe(p.display.curves);
    expect(next.display.roles).toBe(p.display.roles);
    expect(templateName(currentTemplate(next, 'petrophysics', []))).toBe(ESSENTIAL_NAME);
    expect(useProject.getState().history.past).toHaveLength(1);
    useProject.getState().undo();
    expect(useProject.getState().project).toBe(p);
    useProject.getState().redo();
    expect(useProject.getState().project).toBe(next);
  });

  it('una segunda aplicación no agrega una entrada de historial y volver a fábrica conserva el preset para rehacer', () => {
    applyEssentialTemplate();
    const p = useProject.getState().project;
    const history = useProject.getState().history;
    applyEssentialTemplate();
    expect(useProject.getState().project).toBe(p);
    expect(useProject.getState().history).toBe(history);
    resetToFactory('petrophysics');
    expect(layoutFor('petrophysics', useProject.getState().project.display.layouts)).toBe(BUILTIN_LAYOUTS.petrophysics);
    useProject.getState().undo();
    expect(useProject.getState().project).toBe(p);
  });

  it('conserva las plantillas propias y estas mantienen su nombre aunque coincidan con la vista esencial', () => {
    const p = saveTrackTemplate(base(), { id: 'mia', workspace: 'petrophysics', name: 'Mi interpretación', tracks: essentialPetrophysicsLayout(), savedAt: '2026-10-28T00:00:00Z' });
    useProject.getState().replace(p);
    applyEssentialTemplate();
    expect(useProject.getState().project.display.trackTemplates).toBe(p.display.trackTemplates);
    expect(currentTemplate(useProject.getState().project, 'petrophysics', [])).toMatchObject({ kind: 'template', id: 'mia', name: 'Mi interpretación' });
  });

  it('guardar y abrir conserva el preset y los datos en formato v6, sin una migración nueva', async () => {
    applyEssentialTemplate();
    const p = useProject.getState().project;
    const text = await serializeProject(p, { codec: 'f64le-b64' });
    expect(JSON.parse(text).version).toBe(6);
    expect(PROJECT_VERSION).toBe(6);
    const back = await deserializeProject(text);
    expect(back.display).toEqual(p.display);
    expect(back.wells[0]!.interpretation).toEqual(p.wells[0]!.interpretation);
    expect(back.wells[0]!.well).toEqual(p.wells[0]!.well);
    expect(currentTemplate(back, 'petrophysics', [])).toEqual({ kind: 'essential' });
  });

  it.each([2, 3, 4, 5, 6])('un proyecto v%i sin selección explícita conserva la fábrica al abrirse', async (version) => {
    const file = JSON.parse(await serializeProject(base(), { codec: 'f64le-b64' }));
    file.version = version;
    if (version === 2) delete file.project.display;
    const back = await deserializeProject(JSON.stringify(file));
    expect(back.display.layouts).toEqual({});
    expect(layoutFor('petrophysics', back.display.layouts)).toBe(BUILTIN_LAYOUTS.petrophysics);
  });

  it('editar una copia o recibir una pista de MDT no cambia el preset ni elimina las pistas aportadas por módulos', () => {
    const edited = essentialPetrophysicsLayout();
    edited[0]!.curves!.push({ select: { role: 'PEF' } });
    expect(essentialPetrophysicsLayout()[0]!.curves).toHaveLength(1);
    const mdt: ViewerOverlay = { id: 'mdt', label: 'Presiones', layer: 'over', draw: () => {}, track: { title: 'Presión', after: 'saturation', workspaces: ['petrophysics'], scale: { kind: 'linear', min: 0, max: 3000 } } };
    const tracks = withOverlayTracks(essentialPetrophysicsLayout(), [mdt], 'petrophysics');
    expect(tracks.some((t) => t.overlayId === 'mdt' && !t.hidden)).toBe(true);
  });
});

describe('regresión del pozo TP completo', () => {
  it('los resultados, las fuentes, las columnas de exportación y el catálogo se conservan al cambiar la vista', () => {
    const p = useProject.getState().project;
    const entry = p.wells[0]!;
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(toEngineWell(entry.well));
    const before = engine.run(entry.interpretation);
    const oldColumns = buildExportColumns(entry.well, before.outputs, { includeAlternatives: true });
    const measured = entry.well.curves.map((c) => c.data.slice());
    applyEssentialTemplate();
    const next = useProject.getState().project.wells[0]!;
    expect(next).toBe(entry);
    const after = engine.run(next.interpretation);
    expect(after.stats.recomputed).toEqual([]);
    expect(after.sources).toEqual(before.sources);
    for (const o of after.outputs) expect(o.value, o.key).toBe(before.outputs.find((b) => b.key === o.key)!.value);
    expect(buildExportColumns(next.well, after.outputs, { includeAlternatives: true })).toEqual(oldColumns);
    next.well.curves.forEach((c, i) => expect(c.data).toEqual(measured[i]));

    const computed = computedOf(after);
    const source = { depth: tp.well.depth.values, curves: tp.well.curves, computed, catalog: registry.roles };
    const classic = resolveTracks(BUILTIN_LAYOUTS.petrophysics, source);
    const essential = resolveTracks(essentialPetrophysicsLayout(), source);
    const collected = classic.find((t) => t.id === 'computed')!;
    expect(collected.curves.length).toBeGreaterThan(40);
    expect(essential.some((t) => t.id === 'computed')).toBe(false);
    expect(essential.flatMap((t) => t.curves).length).toBeLessThan(25);
    for (const t of essential) for (const c of t.curves) {
      const same = classic.flatMap((x) => x.curves).find((x) => x.key === c.key)!;
      expect(c.data, c.key).toBe(same.data);
      expect(c.axis, c.key).toEqual(same.axis);
    }
    const available = new Set(computed.map((c) => c.port));
    const catalog = buildTrackCatalog({ roles: registry.roles, curves: tp.well.curves, computed: available, producible: available }).flatMap((g) => g.curves);
    for (const role of ['PEF', 'DT', 'CALI', 'TOC', 'V_QUARTZ']) expect(catalog.some((c) => c.role === role && c.available), role).toBe(true);
  });

  it('la figura SVG usa las pistas elegidas sin el recolector y preserva los valores originales', () => {
    const ctx = tpFigureContext();
    const tracks = resolveTracks(essentialPetrophysicsLayout(), { depth: tp.well.depth.values, curves: tp.well.curves, computed: [], catalog: registry.roles });
    const input = buildViewerFigure(tpRequest(), { ...ctx, tracks });
    const layout = layoutViewerFigure(input);
    const svg = new SvgContext2D({ width: layout.width, height: layout.height, measure: input.measure });
    withSvgPath2D(() => drawViewerFigure(svg.asCanvas(), input, layout));
    const text = svg.toSvg('#ffffff');
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(text).toContain('Dens. · neutrón');
    expect(input.tracks.some((t) => t.id === 'computed')).toBe(false);
    expect(input.tracks.find((t) => t.id === 'porosity')!.curves.map((c) => c.role)).toEqual(['NPHI', 'RHOB']);
    expect(input.depth).toBe(ctx.depth);
    expect(input.depth).toEqual(tp.well.depth.values);
  });
});
