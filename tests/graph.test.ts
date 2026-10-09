import { describe, expect, it } from 'vitest';
import { planGraph } from '../src/core/engine/graph';
import { createRegistry } from '../src/core/registry';
import { interp, linearModule } from './helpers';

const curves = [{ id: 'GR1', mnemonic: 'GR', role: 'GR' }];

describe('grafo de cálculo', () => {
  it('ordena topológicamente sin importar el orden de registro', () => {
    const r = createRegistry([linearModule('sw', 'PHIE', 'SW'), linearModule('phie', 'VSH', 'PHIE'), linearModule('vsh', 'IGR', 'VSH'), linearModule('igr', 'GR', 'IGR')]);
    const plan = planGraph(r, curves, interp());
    expect(plan.order).toEqual(['igr', 'vsh', 'phie', 'sw']);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.nodes.get('vsh')!.deps).toEqual(['igr']);
  });

  it('detecta insumos faltantes y bloquea aguas abajo con mensajes claros', () => {
    const r = createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh', 'IGR', 'VSH')]);
    const plan = planGraph(r, [], interp());
    expect(plan.nodes.get('igr')!.status).toBe('missing-input');
    expect(plan.nodes.get('vsh')!.status).toBe('blocked');
    const msgs = plan.diagnostics.map((d) => d.message).join('\n');
    expect(msgs).toMatch(/necesita una curva con rol GR \(Rayos gamma\)/);
    expect(msgs).toMatch(/'Prueba vsh' no se puede calcular porque 'Prueba igr' no se pudo calcular/);
  });

  it('detecta ciclos y los informa con el camino', () => {
    const r = createRegistry([linearModule('a', 'VSH', 'IGR'), linearModule('b', 'IGR', 'VSH'), linearModule('c', 'VSH', 'PHIE')]);
    const plan = planGraph(r, curves, interp());
    expect(plan.nodes.get('a')!.status).toBe('cycle');
    expect(plan.nodes.get('b')!.status).toBe('cycle');
    expect(plan.nodes.get('c')!.status).toBe('blocked');
    const cycle = plan.diagnostics.find((d) => d.code === 'cycle')!;
    expect(cycle.message).toMatch(/ciclo de dependencias: 'Prueba (a|b)' → 'Prueba (a|b)' → 'Prueba (a|b)'/);
    expect(plan.diagnostics.filter((d) => d.code === 'cycle')).toHaveLength(1);
  });

  it('con varios métodos para un rol: el primero registrado por defecto, o el elegido', () => {
    const r = createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh-lin', 'IGR', 'VSH'), linearModule('vsh-lar', 'IGR', 'VSH'), linearModule('phie', 'VSH', 'PHIE')]);
    let plan = planGraph(r, curves, interp());
    expect(plan.sources.get('VSH')).toEqual({ kind: 'module', moduleId: 'vsh-lin' });
    expect(plan.nodes.has('vsh-lar')).toBe(false); // la alternativa no corre si no se pide
    expect(plan.nodes.get('phie')!.deps).toEqual(['vsh-lin']);
    expect(plan.candidates.get('VSH')).toHaveLength(2);

    plan = planGraph(r, curves, interp({ sources: { VSH: { kind: 'module', moduleId: 'vsh-lar' } } }));
    expect(plan.nodes.get('phie')!.deps).toEqual(['vsh-lar']);
    expect(plan.nodes.has('vsh-lin')).toBe(false);
  });

  it('las alternativas en comparación corren pero no alimentan la cadena', () => {
    const r = createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh-lin', 'IGR', 'VSH'), linearModule('vsh-lar', 'IGR', 'VSH'), linearModule('phie', 'VSH', 'PHIE')]);
    const plan = planGraph(r, curves, interp({ compare: ['vsh-lar'] }));
    expect(plan.nodes.get('vsh-lar')!.reason).toBe('compare');
    expect(plan.nodes.get('vsh-lin')!.reason).toBe('chain');
    expect(plan.nodes.get('phie')!.deps).toEqual(['vsh-lin']);
  });

  it('una curva medida con el rol tiene prioridad por defecto; se puede elegir el módulo', () => {
    const r = createRegistry([linearModule('igr', 'GR', 'IGR')]);
    const withMeasured = [...curves, { id: 'IGR_FILE', mnemonic: 'IGR', role: 'IGR' }];
    expect(planGraph(r, withMeasured, interp()).sources.get('IGR')).toEqual({ kind: 'curve', curveId: 'IGR_FILE' });
    const plan = planGraph(r, withMeasured, interp({ sources: { IGR: { kind: 'module', moduleId: 'igr' } } }));
    expect(plan.sources.get('IGR')).toEqual({ kind: 'module', moduleId: 'igr' });
  });

  it('un módulo de corrección (consume y produce el mismo rol) toma la fuente siguiente, no a sí mismo', () => {
    const r = createRegistry([linearModule('rt-corr', 'RT', 'RT'), linearModule('sw', 'RT', 'SW')]);
    const rt = [{ id: 'AT90', mnemonic: 'AT90', role: 'RT' }];
    const plan = planGraph(r, rt, interp({ sources: { RT: { kind: 'module', moduleId: 'rt-corr' } } }));
    expect(plan.nodes.get('rt-corr')!.inputs['x']).toEqual({ kind: 'curve', curveId: 'AT90' });
    expect(plan.nodes.get('sw')!.deps).toEqual(['rt-corr']);
    expect(plan.diagnostics).toEqual([]);
  });

  it('una fuente elegida inválida cae a la regla por defecto con advertencia', () => {
    const r = createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh', 'IGR', 'VSH')]);
    const plan = planGraph(r, curves, interp({ sources: { VSH: { kind: 'module', moduleId: 'no-existe' } } }));
    expect(plan.sources.get('VSH')).toEqual({ kind: 'module', moduleId: 'vsh' });
    expect(plan.diagnostics[0]!.code).toBe('invalid-source');
  });

  it('los módulos desactivados no corren ni son fuente', () => {
    const r = createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh', 'IGR', 'VSH')]);
    const plan = planGraph(r, curves, interp({ disabled: ['igr'] }));
    expect(plan.nodes.has('igr')).toBe(false);
    expect(plan.nodes.get('vsh')!.status).toBe('missing-input');
  });

  it('activa como dependencia a un productor no elegido cuando hace falta', () => {
    // rt-corr elegido para RT, sin curva medida: su entrada RT cae al otro productor (rt-synth), que se activa.
    const r = createRegistry([linearModule('rt-synth', 'GR', 'RT'), linearModule('rt-corr', 'RT', 'RT')]);
    const plan = planGraph(r, curves, interp({ sources: { RT: { kind: 'module', moduleId: 'rt-corr' } } }));
    expect(plan.nodes.get('rt-synth')!.reason).toBe('dependency');
    expect(plan.order).toEqual(['rt-synth', 'rt-corr']);
  });
});
