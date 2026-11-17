import { describe, expect, it } from 'vitest';
import { evaluateFlow, flowProgress, FLOWS, GEOLOGY_FLOW, PETROPHYSICS_FLOW, stepModules, stepsOfModule, suggestedStep, type FlowContext, type FlowModule } from '../src/app/flow/flow';
import { toFlowModule, workspaceModules } from '../src/app/flow/useFlow';
import { emptyParamState, type ParamState } from '../src/core/params';
import { registry } from '../src/modules';

const IGR: FlowModule = { id: 'igr', category: 'shale', outputPorts: ['IGR'] };
const VSH: FlowModule = { id: 'vsh-larionov', category: 'shale', outputPorts: ['VSH'] };
const PICKETT: FlowModule = { id: 'pickett', category: 'saturation', outputPorts: ['RW', 'SW'] };
const RW_SP: FlowModule = { id: 'rw-sp', category: 'water', outputPorts: ['RW'] };
const FLAG: FlowModule = { id: 'shale-flag', category: 'cutoffs', outputPorts: ['SHALE_FLAG', 'CLEAN_FRACTION', 'IGR_BY_ZONE'] };

function ctx(partial: Partial<FlowContext> = {}): FlowContext {
  return { hasWell: true, zoneCount: 5, modules: [IGR, FLAG], producedPorts: new Set(), okModules: new Set(), marks: {}, ...partial };
}
const statusOf = (c: FlowContext) => Object.fromEntries(evaluateFlow(PETROPHYSICS_FLOW, c).map((s) => [s.def.id, s.status]));

describe('flujo guiado', () => {
  it('tiene los pasos del plan en orden', () => {
    expect(PETROPHYSICS_FLOW.map((s) => s.label)).toEqual(['Cargar', 'Calidad', 'Zonas', 'Arcilla', 'Porosidad', 'Rw', 'Saturación', 'Permeabilidad', 'Cutoffs', 'Sumario', 'Volumen']);
    expect(Object.keys(FLOWS)).toEqual(['petrophysics', 'geology']);
    expect(GEOLOGY_FLOW.slice(0, 3).map((s) => s.id)).toEqual(['load', 'qc', 'zones']);
  });

  it('sin pozo: Cargar pendiente y el resto bloqueado', () => {
    const s = statusOf(ctx({ hasWell: false, zoneCount: 0 }));
    expect(s['load']).toBe('todo');
    expect(Object.entries(s).filter(([id]) => id !== 'load').every(([, st]) => st === 'locked')).toBe(true);
  });

  it('con el pozo de demostración (IGR y bandera calculados): estados derivados', () => {
    const s = statusOf(ctx({ okModules: new Set(['igr', 'shale-flag']), producedPorts: new Set(['GR', 'IGR', 'SHALE_FLAG', 'CLEAN_FRACTION', 'IGR_BY_ZONE']) }));
    expect(s).toEqual({
      load: 'done',
      qc: 'todo', // revisar es un acto humano
      zones: 'done',
      shale: 'partial', // hay IGR pero falta VSH
      porosity: 'empty',
      rw: 'empty',
      saturation: 'empty',
      permeability: 'empty',
      cutoffs: 'partial', // la bandera de ejemplo no produce NET_PAY
      summary: 'empty',
      volumetrics: 'empty',
    });
  });

  it('el puerto objetivo completa el paso (también si viene de una curva medida)', () => {
    expect(statusOf(ctx({ modules: [IGR, VSH], okModules: new Set(['igr', 'vsh-larionov']), producedPorts: new Set(['VSH']) }))['shale']).toBe('done');
    expect(statusOf(ctx({ modules: [IGR], producedPorts: new Set(['VSH']) }))['shale']).toBe('done');
  });

  it('las marcas del usuario: completo y saltado; lo derivado gana sobre la marca', () => {
    const marks = { qc: 'done', porosity: 'skipped', zones: 'skipped' } as const;
    const states = evaluateFlow(PETROPHYSICS_FLOW, ctx({ marks }));
    const by = Object.fromEntries(states.map((s) => [s.def.id, s]));
    expect(by['qc']!.status).toBe('done');
    expect(by['qc']!.derived).toBe(false);
    expect(by['porosity']!.status).toBe('skipped');
    expect(by['zones']!.status).toBe('done'); // hay zonas
    expect(by['zones']!.derived).toBe(true);
    expect(statusOf(ctx({ hasWell: false, marks }))['qc']).toBe('locked');
  });

  it('Rw: toma módulos de la categoría water y a cualquier productor de RW; un módulo puede estar en dos pasos', () => {
    const mods = [IGR, PICKETT, RW_SP];
    const rw = PETROPHYSICS_FLOW.find((s) => s.id === 'rw')!;
    expect(stepModules(rw, mods).map((m) => m.id)).toEqual(['pickett', 'rw-sp']);
    expect(stepsOfModule(PETROPHYSICS_FLOW, PICKETT).map((s) => s.id)).toEqual(['rw', 'saturation']);
    expect(stepsOfModule(PETROPHYSICS_FLOW, { id: 'k', category: 'permeability', outputPorts: ['PERM'] }).map((s) => s.id)).toEqual(['permeability']);
    expect(stepsOfModule(PETROPHYSICS_FLOW, { id: 'temp', category: 'other', outputPorts: ['TEMP'] }).map((s) => s.id)).toEqual(['rw']);
  });

  it('paso sugerido y progreso', () => {
    const states = evaluateFlow(PETROPHYSICS_FLOW, ctx({ okModules: new Set(['igr']) }));
    expect(suggestedStep(states)?.def.id).toBe('qc');
    expect(flowProgress(states)).toEqual({ resolved: 2, total: 11, computed: 2, reviewed: 1 });
    const all = evaluateFlow(PETROPHYSICS_FLOW, ctx({ marks: Object.fromEntries(PETROPHYSICS_FLOW.map((s) => [s.id, 'skipped'])) }));
    expect(suggestedStep(all)).toBeNull();
  });

  it('los módulos reales del registro caen en sus pasos', () => {
    const mods = registry.modules.map(toFlowModule);
    const byStep = Object.fromEntries(PETROPHYSICS_FLOW.map((s) => [s.id, stepModules(s, mods).map((m) => m.id)]));
    // Thomas–Stieber (0061) es de la categoría arcilla: orienta el modelo de Sw según la distribución de la arcilla.
    expect(byStep['shale']).toEqual(['igr', 'vsh', 'clay-distribution']);
    expect(byStep['porosity']).toEqual(expect.arrayContaining(['phi-density', 'phi-neutron', 'phi-sonic-raymer', 'phit', 'phie-vsh', 'phie-shale-corrected']));
    expect(byStep['rw']).toEqual(expect.arrayContaining(['temp-gradient', 'rw-manual']));
    expect(byStep['saturation']).toEqual(expect.arrayContaining(['sw-archie', 'r0', 'sw-simandoux', 'sw-indonesia', 'bvw-sh']));
    expect(byStep['permeability']).toEqual(expect.arrayContaining(['perm-timur', 'perm-coates']));
    expect(Object.values(byStep).flat()).not.toContain('shale-flag');
  });
});

describe('estado revisado (0073)', () => {
  const real = workspaceModules('petrophysics').map(toFlowModule);
  const allPorts = new Set(PETROPHYSICS_FLOW.flatMap((s) => s.targets ?? []));
  /** El pozo del TP recién cargado: todo calculado, nada tocado (el diálogo de carga solo marca Calidad). */
  const loaded = (partial: Partial<FlowContext> = {}): FlowContext => ({
    hasWell: true,
    zoneCount: 5,
    modules: real,
    producedPorts: allPorts,
    okModules: new Set(real.map((m) => m.id)),
    marks: { qc: 'done' },
    params: emptyParamState(),
    sources: {},
    ...partial,
  });
  const byId = (c: FlowContext) => Object.fromEntries(evaluateFlow(PETROPHYSICS_FLOW, c).map((s) => [s.def.id, s]));
  const withGlobal = (global: ParamState['global']): ParamState => ({ global, zones: {} });

  it('recién cargado: todos los pasos de módulos calculados y ninguno revisado', () => {
    const by = byId(loaded());
    const moduleSteps = PETROPHYSICS_FLOW.filter((s) => s.kind === 'modules');
    for (const s of moduleSteps) {
      expect(by[s.id]!.status, s.id).toBe('done');
      expect(by[s.id]!.reviewed, s.id).toBe(false);
      expect(by[s.id]!.reviewReason, s.id).toBeNull();
    }
    expect(by['load']!.reviewed).toBe(true); // elegir el pozo es el acto de la usuaria
    expect(by['qc']!.reviewed).toBe(true); // marcado por el diálogo de carga
    expect(by['zones']!.reviewed).toBe(false); // las zonas vienen en el archivo
  });

  it('un cutoff distinto del de fábrica revisa Cutoffs; volverlo al valor exacto lo desrevisa', () => {
    // vshCutoff es compartido: se guarda sin prefijo de módulo.
    const changed = byId(loaded({ params: withGlobal({ vshCutoff: 0.3 }) }));
    expect(changed['cutoffs']!.reviewed).toBe(true);
    expect(changed['cutoffs']!.reviewReason).toBe('Revisado: cambiaste Vsh máxima.');
    expect(changed['shale']!.reviewed).toBe(false);
    expect(byId(loaded({ params: withGlobal({ vshCutoff: 0.4 }) }))['cutoffs']!.reviewed).toBe(false);
    // Dentro de la tolerancia relativa (1e-9) cuenta como el de fábrica.
    expect(byId(loaded({ params: withGlobal({ vshCutoff: 0.4 * (1 + 1e-12) }) }))['cutoffs']!.reviewed).toBe(false);
    // Con prefijo de módulo la clave no es la del parámetro compartido: no cuenta.
    expect(byId(loaded({ params: withGlobal({ 'cutoffs.vshCutoff': 0.3 }) }))['cutoffs']!.reviewed).toBe(false);
    const two = byId(loaded({ params: withGlobal({ vshCutoff: 0.3, phiCutoff: 0.1 }) }));
    expect(two['cutoffs']!.reviewReason).toBe('Revisado: cambiaste 2 parámetros (Vsh máxima, Porosidad mínima).');
  });

  it('un override por zona distinto del de fábrica también revisa el paso', () => {
    expect(byId(loaded({ params: { global: {}, zones: { zB: { phiCutoff: 0.12 } } } }))['cutoffs']!.reviewed).toBe(true);
    expect(byId(loaded({ params: { global: {}, zones: { zB: { phiCutoff: 0.08 } } } }))['cutoffs']!.reviewed).toBe(false);
    // Override de una zona que ya no existe: no cuenta.
    expect(byId(loaded({ zoneIds: ['zA'], params: { global: {}, zones: { zB: { phiCutoff: 0.12 } } } }))['cutoffs']!.reviewed).toBe(false);
  });

  it('elegir la fuente de VSH revisa Arcilla', () => {
    const by = byId(loaded({ sources: { VSH: { kind: 'module', moduleId: 'vsh' } } }));
    expect(by['shale']!.reviewed).toBe(true);
    expect(by['shale']!.reviewReason).toMatch(/^Revisado: elegiste la fuente de VSH/);
    expect(by['porosity']!.reviewed).toBe(false);
    expect(byId(loaded({ sources: { VSH: { kind: 'curve', curveId: 'c1' } } }))['shale']!.reviewReason).toBe('Revisado: elegiste la fuente de VSH (curva medida).');
  });

  it('una marca manual (completo o saltado) revisa el paso; bloqueado nunca está revisado', () => {
    const by = byId(loaded({ marks: { qc: 'done', porosity: 'done', zones: 'skipped' } }));
    expect(by['porosity']!.reviewed).toBe(true);
    expect(by['porosity']!.reviewReason).toBe('Revisado: marcado a mano.');
    expect(by['zones']!.reviewed).toBe(true);
    const none = byId(loaded({ hasWell: false, marks: { porosity: 'done' }, params: withGlobal({ vshCutoff: 0.3 }) }));
    expect(Object.values(none).filter((s) => s.status === 'locked').every((s) => !s.reviewed)).toBe(true);
    expect(none['load']!.reviewed).toBe(false);
  });

  it('un valor guardado inválido no cuenta como decisión', () => {
    expect(byId(loaded({ params: withGlobal({ vshCutoff: 'mucho' }) }))['cutoffs']!.reviewed).toBe(false);
    expect(byId(loaded({ params: withGlobal({ vshCutoff: Number.NaN }) }))['cutoffs']!.reviewed).toBe(false);
    expect(byId(loaded({ params: withGlobal({ permCutoffOn: 1 }) }))['cutoffs']!.reviewed).toBe(false);
  });

  it('flowProgress cuenta calculados y revisados', () => {
    const states = evaluateFlow(PETROPHYSICS_FLOW, loaded({ params: withGlobal({ vshCutoff: 0.3 }) }));
    // Cargar, Calidad, Cutoffs y Volumen: la incertidumbre del volumen lee el mismo cutoff compartido (0073, punto 3).
    expect(states.filter((s) => s.reviewed).map((s) => s.def.id)).toEqual(['load', 'qc', 'cutoffs', 'volumetrics']);
    expect(flowProgress(states)).toEqual({ resolved: 11, total: 11, computed: 11, reviewed: 4 });
  });

  it('quitar la fuente elegida vuelve el paso a valores de fábrica', () => {
    expect(byId(loaded({ sources: { VSH: { kind: 'curve', curveId: 'x' } } }))['shale']!.reviewed).toBe(true);
    expect(byId(loaded({ sources: {} }))['shale']!.reviewed).toBe(false);
  });
});
