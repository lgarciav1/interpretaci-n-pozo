import { describe, expect, it } from 'vitest';
import { evaluateFlow, flowProgress, FLOWS, GEOLOGY_FLOW, PETROPHYSICS_FLOW, stepModules, stepsOfModule, suggestedStep, type FlowContext, type FlowModule } from '../src/app/flow/flow';
import { toFlowModule } from '../src/app/flow/useFlow';
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
    expect(PETROPHYSICS_FLOW.map((s) => s.label)).toEqual(['Cargar', 'Calidad', 'Zonas', 'Arcilla', 'Porosidad', 'Rw', 'Saturación', 'Cutoffs', 'Sumario']);
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
      cutoffs: 'partial', // la bandera de ejemplo no produce NET_PAY
      summary: 'empty',
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
    expect(stepsOfModule(PETROPHYSICS_FLOW, { id: 'k', category: 'permeability', outputPorts: ['PERM'] })).toEqual([]);
  });

  it('paso sugerido y progreso', () => {
    const states = evaluateFlow(PETROPHYSICS_FLOW, ctx({ okModules: new Set(['igr']) }));
    expect(suggestedStep(states)?.def.id).toBe('qc');
    expect(flowProgress(states)).toEqual({ resolved: 2, total: 9 });
    const all = evaluateFlow(PETROPHYSICS_FLOW, ctx({ marks: Object.fromEntries(PETROPHYSICS_FLOW.map((s) => [s.id, 'skipped'])) }));
    expect(suggestedStep(all)).toBeNull();
  });

  it('los módulos reales del registro caen en sus pasos', () => {
    const mods = registry.modules.map(toFlowModule);
    const byStep = Object.fromEntries(PETROPHYSICS_FLOW.map((s) => [s.id, stepModules(s, mods).map((m) => m.id)]));
    expect(byStep['shale']).toEqual(['igr']);
    expect(byStep['cutoffs']).toEqual(['shale-flag']);
  });
});
