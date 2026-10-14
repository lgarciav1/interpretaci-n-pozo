/**
 * Sarta de perfilaje (fase 11a, docs/decisiones/0032): catálogo de herramientas y fichas, derivación desde las curvas,
 * filtro del motor y del visor, disponibilidad de módulos (clausura sobre el registro real), modo planificación,
 * recetas con deshacer, snapshots y guardar/abrir (proyectos viejos sin sarta).
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { computeOnce, Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation, sameEngineInputs, type Interpretation } from '../src/core/interpretation';
import { defineModule, input, output } from '../src/core/module';
import { createRegistry } from '../src/core/registry';
import { defaultRoleCatalog } from '../src/core/roles';
import { emptyHistory, recordChange, undo, redo } from '../src/core/state/history';
import { addWell, createProject, getWellEntry, setSource, type Project } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createSnapshot, describeDiff, diffInterpretations } from '../src/core/state/snapshots';
import { addPlannedTool, moveTool, removePlannedTool, resetToolString, setToolOn, setToolStringMode, startPlanning } from '../src/core/state/toolString';
import {
  availabilityReason,
  derivedToolIds,
  excludedCurveIds,
  filterCurvesByToolString,
  modulesEnabledBy,
  moduleAvailability,
  offToolsFor,
  resolveToolString,
  sanitizeToolString,
  toolStringOf,
  type ToolStringState,
} from '../src/core/toolString';
import { BUILTIN_TOOLS, defaultToolCatalog, sheetOf, validateToolDef } from '../src/core/tools';
import { TOOL_SHEETS, validateToolSheet } from '../src/core/toolSheets';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import { buildTrackCatalog } from '../src/viewer/catalog';

const demo = syntheticWell();
const W = demo.well.id;
const tp = readWellFile(csvText, 'pozo_tp_perfiles.csv');

function demoProject(): Project {
  return addWell(createProject('Sarta'), demo.well, demo.zones);
}
const interpOf = (p: Project): Interpretation => getWellEntry(p, W).interpretation;
const state = (partial: Partial<ToolStringState>): ToolStringState => ({ mode: 'data', off: [], order: [], plan: [], planOff: [], ...partial });
const avail = (s: ToolStringState | undefined, curves = demo.well.curves, disabled: string[] = []) =>
  moduleAvailability(registry, curves, resolveToolString(curves, s, registry.tools), { disabled });
const statusOf = (s: ToolStringState | undefined, id: string, curves = demo.well.curves) => avail(s, curves).modules.get(id)!;

// ── catálogo y fichas ───────────────────────────────────────────────────────────────────────────────────────────

describe('catálogo de herramientas', () => {
  it('las incorporadas son válidas, tienen ids únicos y su ficha está separada (vacía, sin números inventados)', () => {
    for (const t of BUILTIN_TOOLS) expect(validateToolDef(t, (r) => defaultRoleCatalog.has(r))).toEqual([]);
    expect(new Set(BUILTIN_TOOLS.map((t) => t.id)).size).toBe(BUILTIN_TOOLS.length);
    expect(Object.keys(TOOL_SHEETS).sort()).toEqual(BUILTIN_TOOLS.map((t) => t.id).sort());
    for (const [id, s] of Object.entries(TOOL_SHEETS)) expect(validateToolSheet(id, s)).toEqual([]);
    expect(sheetOf(defaultToolCatalog.get('density')!)).toEqual({});
  });

  it('la validación de fichas exige fuentes, rangos coherentes y unidades de longitud (también por curva)', () => {
    const ok = { investigation: { typical: 90, min: 10, max: 90, unit: 'in' as const }, investigationByRole: { RA10: { typical: 10, unit: 'in' as const } }, sources: ['ref'] };
    expect(validateToolSheet('induction', ok)).toEqual([]);
    expect(validateToolSheet('x', { length: { typical: 7, unit: 'm' } })).toEqual(["Ficha 'x': tiene valores numéricos pero ninguna fuente."]);
    expect(validateToolSheet('x', { ...ok, investigationByRole: { RT: { min: 9, max: 3, unit: 'ohm.m' } } })).toHaveLength(2);
  });

  it('todo rol medido incorporado (salvo el trépano) lo registra alguna herramienta', () => {
    const measured = defaultRoleCatalog.all().filter((r) => r.origin === 'measured' && r.id !== 'BS');
    expect(measured.filter((r) => !defaultToolCatalog.toolsForRole(r.id).length).map((r) => r.id)).toEqual([]);
  });

  it('atribuye cada curva a su herramienta por rol y, si el rol es compartido, por mnemónico', () => {
    const owner = (mnemonic: string, role: string | null) => defaultToolCatalog.ownerOf({ mnemonic, role })?.id;
    expect(owner('AT90', 'RT')).toBe('induction');
    expect(owner('ILD', 'RT')).toBe('induction');
    expect(owner('LLD', 'RT')).toBe('laterolog');
    expect(owner('RLA5', 'RT')).toBe('laterolog');
    expect(owner('LLS', 'RS')).toBe('laterolog');
    expect(owner('RD', 'RT')).toBe('induction'); // sin pista: la primera del catálogo
    expect(owner('GR', 'GR')).toBe('gr');
    expect(owner('SGR', 'GR')).toBe('spectral-gr');
    expect(owner('ZDEN', 'RHOB')).toBe('density');
    expect(owner('MSFL', 'RXO')).toBe('microresistivity');
    expect(owner('BS', 'BS')).toBeUndefined();
    expect(owner('X', null)).toBeUndefined();
  });

  it('el registro suma las herramientas de los módulos y rechaza las inválidas', () => {
    const base = { category: 'other', workspace: 'petrophysics', params: {}, docs: { summary: 's', equations: [], references: [] } } as const;
    const withTool = defineModule({
      ...base,
      id: 'dielectric',
      name: 'Dieléctrico',
      roles: [{ id: 'EPS', label: 'Permitividad', unit: 'unitless', family: 'other', origin: 'measured' }],
      tools: [{ id: 'dielectric', name: 'Dieléctrica', short: 'DIE', family: 'other', description: 'Permitividad.', roles: ['EPS'], typicalOrder: 70 }],
      inputs: { eps: input.curve('EPS') },
      outputs: { y: output.curve('SW') },
      compute: ({ n }) => ({ y: new Float64Array(n) }),
    });
    const r = createRegistry([withTool]);
    expect(r.tools.get('dielectric')?.roles).toEqual(['EPS']);
    expect(r.tools.has('density')).toBe(true);
    const bad = defineModule({ ...withTool, tools: [{ ...withTool.tools![0]!, id: 'density', roles: ['NOPE'] }] });
    expect(() => createRegistry([bad])).toThrow(/ya la define el núcleo[\s\S]*rol desconocido 'NOPE'|rol desconocido 'NOPE'[\s\S]*ya la define el núcleo/);
  });

  it('el catálogo de pistas agrupa las curvas medidas por herramienta (una sola tabla rol → herramienta)', () => {
    const groups = buildTrackCatalog({ roles: defaultRoleCatalog, curves: demo.well.curves, producible: new Set(), computed: new Set() });
    const groupOf = (id: string) => groups.find((g) => g.curves.some((c) => c.id === id))?.id;
    expect(groupOf('r:RHOB')).toBe('density-neutron');
    expect(groupOf('r:NPHI')).toBe('density-neutron');
    expect(groupOf('r:GR')).toBe('gr-sp');
    expect(groupOf('r:SP')).toBe('gr-sp');
    expect(groupOf('r:CALI')).toBe('caliper');
    expect(groupOf('r:BS')).toBe('caliper');
    expect(groupOf('r:RXO')).toBe('resistivity');
    expect(groupOf('r:URAN')).toBe('spectral');
    expect(groupOf('r:BVI_NMR')).toBe('nmr');
    const caliper = groups.find((g) => g.id === 'caliper')!.curves.map((c) => c.id);
    expect(caliper).toEqual(['r:CALI', 'r:BS']);
  });
});

// ── derivación y filtro ─────────────────────────────────────────────────────────────────────────────────────────

describe('sarta derivada de los datos', () => {
  it('el pozo de demo da sus herramientas en el orden típico de la sarta, con sus curvas', () => {
    expect(derivedToolIds(demo.well.curves, registry.tools)).toEqual(['gr', 'density', 'caliper', 'neutron', 'sonic', 'induction', 'sp']);
    const r = resolveToolString(demo.well.curves, undefined, registry.tools);
    expect(r.mode).toBe('data');
    const ind = r.entries.find((e) => e.tool.id === 'induction')!;
    expect(ind.curveIds).toEqual(['AT10', 'AT30', 'AT60', 'AT90']);
    expect(ind.roles).toEqual(['RT', 'RM', 'RA10', 'RA30']);
    expect(r.entries.every((e) => e.on && e.hasData)).toBe(true);
    expect(r.uncontrolled).toEqual(['BS']);
    expect(r.excluded.size).toBe(0);
  });

  it('el pozo del TP suma GR espectral y RMN', () => {
    const ids = derivedToolIds(tp.well.curves, registry.tools);
    expect(ids).toContain('spectral-gr');
    expect(ids).toContain('nmr');
    expect(ids.indexOf('gr')).toBeLessThan(ids.indexOf('spectral-gr'));
  });

  it('apagar una herramienta excluye solo sus curvas; el filtro devuelve el mismo array si no hay nada apagado', () => {
    expect(filterCurvesByToolString(demo.well.curves, undefined, registry.tools)).toBe(demo.well.curves);
    expect(filterCurvesByToolString(demo.well.curves, state({}), registry.tools)).toBe(demo.well.curves);
    const off = state({ off: ['density'] });
    expect([...excludedCurveIds(demo.well.curves, off, registry.tools)].sort()).toEqual(['PE', 'ZDEN']);
    expect(filterCurvesByToolString(demo.well.curves, off, registry.tools).map((c) => c.id)).not.toContain('ZDEN');
    // una herramienta apagada sigue en la sarta (la vista la muestra apagada)
    const r = resolveToolString(demo.well.curves, off, registry.tools);
    expect(r.entries.find((e) => e.tool.id === 'density')?.on).toBe(false);
  });

  it('un orden propio pone esas herramientas arriba y el resto sigue por orden típico', () => {
    const r = resolveToolString(demo.well.curves, state({ order: ['induction', 'gr'] }), registry.tools);
    expect(r.entries.map((e) => e.tool.id)).toEqual(['induction', 'gr', 'density', 'caliper', 'neutron', 'sonic', 'sp']);
  });

  it('en planificación el motor y el visor ven solo los datos de las herramientas planificadas (más las curvas sin herramienta)', () => {
    const r = resolveToolString(demo.well.curves, state({ mode: 'planning', plan: ['gr', 'nmr'] }), registry.tools);
    expect(r.entries.map((e) => [e.tool.id, e.hasData])).toEqual([
      ['gr', true],
      ['nmr', false],
    ]);
    expect(filterCurvesByToolString(demo.well.curves, state({ mode: 'planning', plan: ['gr', 'nmr'] }), registry.tools).map((c) => c.id)).toEqual(['BS', 'GR']);
    expect(r.outsidePlan.sort()).toEqual(['caliper', 'density', 'induction', 'neutron', 'sonic', 'sp']);
    // ids desconocidos (módulo quitado) se ignoran sin romper
    expect(resolveToolString(demo.well.curves, state({ mode: 'planning', plan: ['gr', 'no-existe'] }), registry.tools).entries.map((e) => e.tool.id)).toEqual(['gr']);
  });
});

// ── disponibilidad ──────────────────────────────────────────────────────────────────────────────────────────────

describe('disponibilidad de módulos (clausura sobre el registro)', () => {
  it('modo datos: lo que se calcula con las curvas está disponible, también por la salida de otros módulos (PHIE)', () => {
    const r = avail(undefined);
    for (const id of ['igr', 'vsh', 'phi-density', 'phie-vsh', 'sw-archie', 'perm-timur']) expect(r.modules.get(id)?.status).toBe('available');
    expect(r.covered.has('PHIE')).toBe(true);
    const nmr = r.modules.get('nmr-fluids')!;
    expect(nmr.status).toBe('unavailable');
    expect(nmr.needs.map((n) => n.port).sort()).toEqual(['BVI_NMR', 'PHIE_NMR']);
    expect(nmr.needs[0]!.tools).toEqual(['nmr']);
  });

  it('apagar el GR deshabilita la cadena de arcillosidad hasta Sw, con el motivo en la raíz', () => {
    const s = state({ off: ['gr'] });
    expect(statusOf(s, 'igr').status).toBe('unavailable');
    expect(statusOf(s, 'vsh').status).toBe('unavailable');
    const sw = statusOf(s, 'sw-archie');
    expect(sw.missingInputs).toContain('PHIE');
    expect(sw.needs).toEqual([{ port: 'GR', tools: ['gr', 'spectral-gr'] }]);
    const resolved = resolveToolString(demo.well.curves, s, registry.tools);
    expect(offToolsFor(sw, resolved).map((t) => t.id)).toEqual(['gr']);
    expect(availabilityReason(sw, { tools: registry.tools, roles: registry.roles, resolved })).toBe('Falta GR (rayos gamma): prendé Rayos gamma en la sarta.');
    // volver a prender restituye todo
    expect(statusOf(state({}), 'sw-archie').status).toBe('available');
  });

  // La comparación exhaustiva con el motor (todos los módulos, varias sartas, fuentes elegidas a mano) está en
  // tests/tool-string-engine.test.ts.

  it('los módulos desactivados no cuentan como productores', () => {
    const r = avail(undefined, demo.well.curves, ['igr']);
    expect(r.modules.get('igr')!.status).toBe('disabled');
    expect(r.modules.get('vsh')!.status).toBe('unavailable');
  });

  it('modo planificación: qué correría con la sarta aunque el pozo no tenga los datos', () => {
    const s = state({ mode: 'planning', plan: ['gr', 'nmr'] });
    expect(statusOf(s, 'igr').status).toBe('available');
    const nmr = statusOf(s, 'nmr-fluids');
    expect(nmr.status).toBe('needs-data');
    expect(nmr.toolsWithoutData).toEqual(['nmr']);
    const resolved = resolveToolString(demo.well.curves, s, registry.tools);
    expect(availabilityReason(nmr, { tools: registry.tools, roles: registry.roles, resolved })).toMatch(/^Correría con la sarta planificada, pero el pozo no tiene .* de Resonancia magnética\.$/);
    const pd = statusOf(s, 'phi-density');
    expect(pd.status).toBe('unavailable');
    expect(availabilityReason(pd, { tools: registry.tools, roles: registry.roles, resolved })).toBe('Falta RHOB (densidad volumétrica): agregá Densidad a la sarta.');
    // con el TP (que tiene RMN) el mismo plan sí corre
    expect(statusOf(s, 'nmr-fluids', tp.well.curves).status).toBe('available');
  });

  it('dice qué módulos habilita una herramienta (para su ficha)', () => {
    const enabled = modulesEnabledBy(registry, demo.well.curves, undefined, 'density');
    expect(enabled).toContain('phi-density');
    expect(enabled).not.toContain('igr');
    expect(modulesEnabledBy(registry, demo.well.curves, undefined, 'gr')).toEqual(expect.arrayContaining(['igr', 'vsh', 'sw-archie']));
    // en planificación mira la sarta planificada (sus apagadas son otras)
    const plan = state({ mode: 'planning', plan: ['gr', 'density'], off: ['gr'] });
    expect(modulesEnabledBy(registry, demo.well.curves, plan, 'gr')).toEqual(expect.arrayContaining(['igr', 'vsh']));
  });

  it('un módulo con herramienta propia entra en la sarta, el filtro y la disponibilidad sin tocar el núcleo', () => {
    const dielectric = defineModule({
      id: 'dielectric-sw',
      name: 'Sw dieléctrica',
      category: 'saturation',
      workspace: 'petrophysics',
      roles: [{ id: 'EPS', label: 'Permitividad', unit: 'unitless', family: 'other', origin: 'measured' }],
      tools: [{ id: 'dielectric', name: 'Dieléctrica', short: 'DIE', family: 'other', description: 'Permitividad.', roles: ['EPS'], typicalOrder: 70 }],
      inputs: { eps: input.curve('EPS') },
      params: {},
      outputs: { sw: output.curve('SW') },
      compute: ({ n }) => ({ sw: new Float64Array(n) }),
      docs: { summary: 's', equations: [], references: [] },
    });
    const r = createRegistry([...registry.modules, dielectric]);
    const eps = { ...demo.well.curves.find((c) => c.id === 'GR')!, id: 'EPS1', mnemonic: 'EPS1', role: 'EPS', unit: 'unitless' as const };
    const curves = [...demo.well.curves, eps];
    expect(derivedToolIds(curves, r.tools)).toContain('dielectric');
    const off = state({ off: ['dielectric'] });
    expect([...excludedCurveIds(curves, off, r.tools)]).toEqual(['EPS1']);
    const resolved = resolveToolString(curves, off, r.tools);
    const av = moduleAvailability(r, curves, resolved).modules.get('dielectric-sw')!;
    expect(av.status).toBe('unavailable');
    expect(availabilityReason(av, { tools: r.tools, roles: r.roles, resolved })).toBe('Falta EPS (permitividad): prendé Dieléctrica en la sarta.');
    expect(moduleAvailability(r, curves, resolveToolString(curves, undefined, r.tools)).modules.get('dielectric-sw')!.status).toBe('available');
    const run = computeOnce(r, toEngineWell({ ...demo.well, curves }), { ...emptyInterpretation(demo.zones), compare: ['dielectric-sw'], toolString: off });
    expect(run.nodes.find((n) => n.moduleId === 'dielectric-sw')?.status).toBe('missing-input');
  });
});

// ── motor ───────────────────────────────────────────────────────────────────────────────────────────────────────

describe('efecto en el motor', () => {
  it('las curvas de una herramienta apagada no son candidatas; al prenderla vuelve el mismo resultado', () => {
    const engine = new Engine(registry);
    engine.setWell(toEngineWell(demo.well));
    const base = emptyInterpretation(demo.zones);
    const on = engine.run(base);
    const phidOn = on.outputs.find((o) => o.port === 'PHID')!;
    expect(on.candidates['RHOB']).toEqual([{ kind: 'curve', curveId: 'ZDEN' }]);
    const off = engine.run({ ...base, toolString: state({ off: ['density'] }) });
    expect(off.candidates['RHOB']).toBeUndefined();
    expect(off.outputs.some((o) => o.port === 'PHID')).toBe(false);
    expect(off.nodes.find((n) => n.moduleId === 'phi-density')?.status).toBe('missing-input');
    const back = engine.run(base);
    const phidBack = back.outputs.find((o) => o.port === 'PHID')!;
    expect(Array.from(phidBack.value as Float64Array)).toEqual(Array.from(phidOn.value as Float64Array));
  });

  it('una fuente elegida a mano con una curva apagada queda en suspenso (aviso info) y vuelve al prender', () => {
    const p = setSource(demoProject(), W, 'RM', { kind: 'curve', curveId: 'AT30' });
    const i = interpOf(p);
    const off = computeOnce(registry, toEngineWell(demo.well), { ...i, toolString: state({ off: ['induction'] }) });
    const d = off.diagnostics.find((x) => x.port === 'RM' && x.code === 'invalid-source')!;
    expect(d.level).toBe('info');
    expect(d.message).toMatch(/«Inducción», que no está activa en la sarta/);
    expect(computeOnce(registry, toEngineWell(demo.well), i).sources['RM']).toEqual({ kind: 'curve', curveId: 'AT30' });
  });

  it('cambiar la sarta cambia las entradas del motor (el puente recalcula)', () => {
    const a = emptyInterpretation();
    expect(sameEngineInputs(a, { ...a })).toBe(true);
    expect(sameEngineInputs(a, { ...a, toolString: state({ off: ['gr'] }) })).toBe(false);
  });
});

// ── recetas, deshacer, snapshots ───────────────────────────────────────────────────────────────────────────────

describe('recetas de la sarta', () => {
  it('apagar y prender; el estado por defecto no se guarda y una receta sin cambios devuelve el mismo proyecto', () => {
    const p0 = demoProject();
    const p1 = setToolOn(p0, W, 'density', false);
    expect(interpOf(p1).toolString).toEqual(state({ off: ['density'] }));
    expect(setToolOn(p1, W, 'density', false)).toBe(p1);
    const p2 = setToolOn(p1, W, 'density', true);
    expect('toolString' in interpOf(p2)).toBe(false);
    expect(setToolOn(p0, W, 'density', true)).toBe(p0);
  });

  it('se deshace y rehace con el historial', () => {
    const p0 = demoProject();
    const p1 = setToolOn(p0, W, 'gr', false);
    const h = recordChange(emptyHistory(), p0, 'Apagar Rayos gamma', 0);
    const u = undo(h, p1)!;
    expect(u.label).toBe('Apagar Rayos gamma');
    expect(toolStringOf(interpOf(u.project)).off).toEqual([]);
    expect(toolStringOf(interpOf(redo(u.history, u.project)!.project)).off).toEqual(['gr']);
  });

  it('modo datos: mover guarda el orden; agregar o quitar solo en planificación', () => {
    const p = moveTool(demoProject(), W, 'induction', 0, registry.tools);
    expect(resolveToolString(demo.well.curves, interpOf(p).toolString, registry.tools).entries[0]!.tool.id).toBe('induction');
    expect(() => addPlannedTool(p, W, 'nmr')).toThrow(/planificación/);
    expect(() => removePlannedTool(p, W, 'gr')).toThrow(/planificación/);
    expect(() => moveTool(p, W, 'nmr', 0, registry.tools)).toThrow(/no está en la sarta/);
  });

  it('planificar desde los datos o desde cero, agregar, quitar, mover y volver al modo datos sin perder el plan', () => {
    const fromData = startPlanning(setToolOn(demoProject(), W, 'sp', false), W, 'data', registry.tools);
    expect(toolStringOf(interpOf(fromData))).toEqual(
      state({ mode: 'planning', off: ['sp'], plan: ['gr', 'density', 'caliper', 'neutron', 'sonic', 'induction', 'sp'], planOff: ['sp'] }),
    );
    let p = startPlanning(demoProject(), W, 'empty', registry.tools);
    expect(toolStringOf(interpOf(p))).toEqual(state({ mode: 'planning' }));
    p = addPlannedTool(p, W, 'gr');
    p = addPlannedTool(p, W, 'nmr');
    p = addPlannedTool(p, W, 'density', 0);
    expect(toolStringOf(interpOf(p)).plan).toEqual(['density', 'gr', 'nmr']);
    p = moveTool(p, W, 'nmr', 0, registry.tools);
    expect(toolStringOf(interpOf(p)).plan).toEqual(['nmr', 'density', 'gr']);
    p = removePlannedTool(p, W, 'density');
    expect(toolStringOf(interpOf(p)).plan).toEqual(['nmr', 'gr']);
    p = setToolStringMode(p, W, 'data');
    expect(toolStringOf(interpOf(p))).toEqual(state({ mode: 'data', plan: ['nmr', 'gr'] }));
    expect(filterCurvesByToolString(demo.well.curves, interpOf(p).toolString, registry.tools)).toBe(demo.well.curves);
    expect('toolString' in interpOf(resetToolString(p, W))).toBe(false);
  });

  it('agregar una herramienta apagada a la sarta planificada la prende en el plan, no en los datos', () => {
    let p = startPlanning(setToolOn(demoProject(), W, 'gr', false), W, 'data', registry.tools);
    p = addPlannedTool(p, W, 'gr');
    expect(toolStringOf(interpOf(p)).planOff).toEqual([]);
    expect(toolStringOf(interpOf(p)).off).toEqual(['gr']);
  });

  it('planificar no contamina el modo datos al volver (lo que se apaga o agrega en el plan no cambia el cálculo)', () => {
    // Datos: densidad apagada (p. ej. por datos malos). Se planifica de cero, se agrega densidad, se apaga el GR.
    const p0 = setToolOn(demoProject(), W, 'density', false);
    let p = startPlanning(p0, W, 'empty', registry.tools);
    p = addPlannedTool(p, W, 'density');
    p = addPlannedTool(p, W, 'gr');
    p = setToolOn(p, W, 'gr', false);
    const planned = resolveToolString(demo.well.curves, interpOf(p).toolString, registry.tools);
    expect(planned.entries.map((e) => [e.tool.id, e.on])).toEqual([
      ['density', true],
      ['gr', false],
    ]);
    // Al volver, el cálculo ve exactamente lo mismo que antes de planificar.
    const back = setToolStringMode(p, W, 'data');
    const before = excludedCurveIds(demo.well.curves, interpOf(p0).toolString, registry.tools);
    const after = excludedCurveIds(demo.well.curves, interpOf(back).toolString, registry.tools);
    expect([...after].sort()).toEqual([...before].sort());
    expect(toolStringOf(interpOf(back)).off).toEqual(['density']);
  });

  it('los snapshots guardan la sarta y la comparación la describe', () => {
    const p0 = demoProject();
    const { project: p1, snapshot } = createSnapshot(p0, W, 'antes');
    const p2 = startPlanning(setToolOn(p1, W, 'density', false), W, 'empty', registry.tools);
    const diff = diffInterpretations(snapshot.interpretation, interpOf(addPlannedTool(p2, W, 'gr')), registry);
    expect(diff.map((d) => describeDiff(d, { registry }))).toEqual([
      'Sarta: modo datos → planificación',
      'Se apaga Densidad en la sarta',
      'Rayos gamma se agrega a la sarta planificada',
    ]);
    const p3 = setToolOn(addPlannedTool(p2, W, 'gr'), W, 'gr', false);
    expect(diffInterpretations(interpOf(addPlannedTool(p2, W, 'gr')), interpOf(p3), registry).map((d) => describeDiff(d, { registry }))).toEqual([
      'Se apaga Rayos gamma en la sarta planificada',
    ]);
  });
});

// ── guardar / abrir ─────────────────────────────────────────────────────────────────────────────────────────────

describe('guardar y abrir', () => {
  it('la sarta viaja en el proyecto y en los snapshots', async () => {
    let p = setToolOn(demoProject(), W, 'induction', false);
    p = createSnapshot(p, W, 'sin inducción', { id: 's1', createdAt: '2026-10-14T00:00:00Z' }).project;
    const back = await deserializeProject(await serializeProject(p), { onWarning: () => {} });
    expect(getWellEntry(back, W).interpretation.toolString).toEqual(state({ off: ['induction'] }));
    expect(back.snapshots[0]!.interpretation.toolString).toEqual(state({ off: ['induction'] }));
  });

  it('un proyecto viejo sin sarta abre en modo datos sin avisos', async () => {
    const text = await serializeProject(demoProject());
    expect(text).not.toContain('toolString');
    const warnings: string[] = [];
    const back = await deserializeProject(text, { onWarning: (m) => warnings.push(m) });
    expect(getWellEntry(back, W).interpretation.toolString).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('una sarta inválida se sanea con avisos', () => {
    const warnings: string[] = [];
    const w = (m: string) => warnings.push(m);
    expect(sanitizeToolString({ mode: 'raro', off: ['gr', 'gr', 3, 'Mal Id'], plan: 'x', order: ['nmr'] }, 'Pozo X', w)).toEqual(state({ off: ['gr'], order: ['nmr'] }));
    expect(warnings).toHaveLength(4);
    expect(sanitizeToolString('nada', 'Pozo X', w)).toBeUndefined();
    expect(sanitizeToolString({ mode: 'data', off: [] }, 'Pozo X', w)).toBeUndefined();
    // ids bien formados que la app no conoce se conservan (un módulo quitado y vuelto a agregar)
    expect(sanitizeToolString({ mode: 'planning', plan: ['dielectric'] }, 'Pozo X', w)).toEqual(state({ mode: 'planning', plan: ['dielectric'] }));
    // las apagadas del plan se validan igual y sobreviven a guardar y abrir
    expect(sanitizeToolString({ mode: 'planning', plan: ['gr'], planOff: ['gr', 7] }, 'Pozo X', w)).toEqual(state({ mode: 'planning', plan: ['gr'], planOff: ['gr'] }));
  });
});
