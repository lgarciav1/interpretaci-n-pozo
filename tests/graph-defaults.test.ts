/**
 * Regla de fuente por defecto "primer candidato que puede correr" y entradas opcionales que no bloquean
 * (fase 6a, ver docs/decisiones/0007-modulos-fase-6a.md, D1).
 */
import { describe, expect, it } from 'vitest';
import { computeOnce } from '../src/core/engine/engine';
import { planGraph } from '../src/core/engine/graph';
import { defineModule, input, output, type InputSpec } from '../src/core/module';
import { param } from '../src/core/params';
import { createRegistry } from '../src/core/registry';
import { curve, interp, linearModule, well } from './helpers';

const docs = { summary: '', equations: [], references: [] };

/** Módulo de prueba con varias entradas: out = suma de las entradas presentes (las opcionales ausentes no suman). */
function sumModule(id: string, inputs: Record<string, InputSpec>, outRole: string, opts: { fail?: boolean } = {}) {
  return defineModule({
    id,
    name: `Prueba ${id}`,
    category: 'other',
    workspace: 'petrophysics',
    inputs,
    params: { fail: param.boolean({ label: 'Fallar', default: !!opts.fail }) },
    outputs: { y: output.curve(outRole) },
    compute({ n, inputs: ins, params }) {
      if (params.fail) throw new Error('falla a propósito');
      const out = new Float64Array(n);
      for (const v of Object.values(ins)) if (v && typeof v === 'object' && 'length' in v) for (let i = 0; i < n; i++) out[i] += (v as ArrayLike<number>)[i]!;
      return { y: out };
    },
    docs,
  });
}

const rhob = { id: 'ZDEN', mnemonic: 'ZDEN', role: 'RHOB' };
const nphi = { id: 'NPHI', mnemonic: 'NPHI', role: 'NPHI' };

// PHIT por densidad–neutrón (registrado primero) o solo densidad.
const registry = createRegistry([
  linearModule('phid', 'RHOB', 'PHID'),
  linearModule('phin', 'NPHI', 'PHIN'),
  sumModule('phit-dn', { d: input.curve('PHID'), n: input.curve('PHIN') }, 'PHIT'),
  sumModule('phit-d', { d: input.curve('PHID') }, 'PHIT'),
]);

describe('fuente por defecto: primer módulo que puede correr', () => {
  it('con densidad y neutrón gana el primero registrado', () => {
    const plan = planGraph(registry, [rhob, nphi], interp());
    expect(plan.sources.get('PHIT')).toEqual({ kind: 'module', moduleId: 'phit-dn' });
    expect(plan.diagnostics).toEqual([]);
  });

  it('sin neutrón salta al siguiente que puede correr', () => {
    const plan = planGraph(registry, [rhob], interp());
    expect(plan.sources.get('PHIT')).toEqual({ kind: 'module', moduleId: 'phit-d' });
    expect(plan.nodes.get('phit-d')!.status).toBe('ready');
    expect(plan.nodes.has('phit-dn')).toBe(false);
    // Lo único que se informa es que el neutrón (fuente de PHIN, que nadie consume) no tiene su curva.
    expect(plan.diagnostics.map((d) => d.moduleId)).toEqual(['phin']);
  });

  it('si ninguno puede correr, queda el primero (y se informa qué falta)', () => {
    const plan = planGraph(registry, [], interp());
    expect(plan.sources.get('PHIT')).toEqual({ kind: 'module', moduleId: 'phit-dn' });
    expect(plan.nodes.get('phit-dn')!.status).toBe('blocked');
    expect(plan.diagnostics.some((d) => d.code === 'missing-input' && d.level === 'error')).toBe(true);
  });

  it('una elección explícita se respeta aunque no pueda correr', () => {
    const plan = planGraph(registry, [rhob], interp({ sources: { PHIT: { kind: 'module', moduleId: 'phit-dn' } } }));
    expect(plan.sources.get('PHIT')).toEqual({ kind: 'module', moduleId: 'phit-dn' });
    expect(plan.nodes.get('phit-dn')!.status).toBe('blocked');
  });

  it('un módulo de corrección no se justifica a sí mismo', () => {
    // rt-corr (RT → RT) está primero, pero sin otra fuente de RT no puede correr: gana rt-synth.
    const r = createRegistry([linearModule('rt-corr', 'RT', 'RT'), linearModule('rt-synth', 'GR', 'RT'), linearModule('sw', 'RT', 'SW')]);
    const gr = [{ id: 'GR1', mnemonic: 'GR', role: 'GR' }];
    let plan = planGraph(r, gr, interp());
    // rt-corr sí puede correr (toma RT de rt-synth), así que es el primero viable y se encadena detrás de rt-synth.
    expect(plan.sources.get('RT')).toEqual({ kind: 'module', moduleId: 'rt-corr' });
    expect(plan.order).toEqual(['rt-synth', 'rt-corr', 'sw']);
    // con rt-synth desactivado ninguno puede correr: queda el primero y se informa
    plan = planGraph(r, gr, interp({ disabled: ['rt-synth'] }));
    expect(plan.nodes.get('rt-corr')!.status).toBe('missing-input');
  });
});

describe('entradas opcionales', () => {
  const vshOpt = createRegistry([
    linearModule('vsh', 'IGR', 'VSH'), // necesita IGR, que nadie produce sin GR
    sumModule('sw', { rt: input.curve('RT'), vsh: input.optionalCurve('VSH') }, 'SW'),
  ]);
  const rt = curve('AT90', 'RT', [1, 2, 3, 4]);

  it('una opcional cuya fuente no puede correr queda ausente: el módulo corre y se informa', () => {
    const plan = planGraph(vshOpt, [{ id: 'AT90', mnemonic: 'AT90', role: 'RT' }], interp());
    expect(plan.nodes.get('sw')!.status).toBe('ready');
    expect(plan.nodes.get('sw')!.inputs['vsh']).toBeNull();
    expect(plan.nodes.get('sw')!.deps).toEqual([]);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ level: 'info', code: 'missing-input', moduleId: 'sw', port: 'VSH' }));
    // vsh corre igual (es la fuente elegida de VSH) e informa su faltante, pero no arrastra a sw
    expect(plan.nodes.get('vsh')!.status).toBe('missing-input');
    const r = computeOnce(vshOpt, well([rt]), interp());
    expect([...(r.outputs.find((o) => o.key === 'sw:SW')!.value as Float64Array)]).toEqual([1, 2, 3, 4]);
  });

  it('una opcional cuya fuente falla al calcular queda ausente; una requerida bloquea', () => {
    const gr = curve('GR1', 'GR', [10, 10, 10, 10]);
    const reg = createRegistry([
      sumModule('vsh', { gr: input.curve('GR') }, 'VSH', { fail: true }),
      sumModule('sw', { rt: input.curve('RT'), vsh: input.optionalCurve('VSH') }, 'SW'),
      sumModule('k', { vsh: input.curve('VSH') }, 'PERM'),
    ]);
    const r = computeOnce(reg, well([gr, rt]), interp());
    const status = Object.fromEntries(r.nodes.map((n) => [n.moduleId, n.status]));
    expect(status).toEqual({ vsh: 'error', sw: 'ok', k: 'blocked' });
    expect(r.diagnostics.map((d) => d.message).join('\n')).toMatch(/'Prueba sw' se calcula sin VSH \(opcional\) porque 'Prueba vsh' falló/);
    expect([...(r.outputs.find((o) => o.key === 'sw:SW')!.value as Float64Array)]).toEqual([1, 2, 3, 4]);
    // cuando el productor se arregla, el consumidor se recalcula con la entrada
    const fixed = computeOnce(reg, well([gr, rt]), interp({ params: { global: { 'vsh.fail': false }, zones: {} } }));
    expect([...(fixed.outputs.find((o) => o.key === 'sw:SW')!.value as Float64Array)]).toEqual([11, 12, 13, 14]);
  });
});

describe('faltantes de módulos que nadie consume', () => {
  // 'extra' es la única fuente de PERM y nadie la consume: activa por defecto, sin curva GR.
  const reg = createRegistry([linearModule('extra', 'GR', 'PERM'), linearModule('sw', 'RT', 'SW')]);
  const metas = [{ id: 'AT90', mnemonic: 'AT90', role: 'RT' }];
  const missing = (plan: ReturnType<typeof planGraph>) => plan.diagnostics.filter((d) => d.code === 'missing-input' && d.moduleId === 'extra');

  it('por defecto se informa como info', () => {
    expect(missing(planGraph(reg, metas, interp())).map((d) => d.level)).toEqual(['info']);
  });

  it('si el usuario lo pidió para comparar, sigue siendo error (no se esconde)', () => {
    expect(missing(planGraph(reg, metas, interp({ compare: ['extra'] }))).map((d) => d.level)).toEqual(['error']);
  });

  it('si el usuario lo eligió como fuente, sigue siendo error', () => {
    const plan = planGraph(reg, metas, interp({ sources: { PERM: { kind: 'module', moduleId: 'extra' } } }));
    expect(missing(plan).map((d) => d.level)).toEqual(['error']);
  });
});
