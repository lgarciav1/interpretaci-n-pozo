import { describe, expect, it } from 'vitest';
import { defineModule, input, output, type AnyModule } from '../src/core/module';
import { param } from '../src/core/params';
import { createRegistry, RegistryError } from '../src/core/registry';
import { linearModule } from './helpers';

function problemsOf(modules: AnyModule[]): string[] {
  try {
    createRegistry(modules);
  } catch (e) {
    if (e instanceof RegistryError) return e.problems;
    throw e;
  }
  return [];
}

const base = {
  name: 'Módulo',
  category: 'other' as const,
  workspace: 'petrophysics' as const,
  docs: { summary: 's', equations: [], references: [] },
  compute: () => ({}) as never,
};

describe('registro de módulos', () => {
  it('acepta un registro válido y arma los puertos en orden', () => {
    const r = createRegistry([linearModule('a', 'GR', 'IGR'), linearModule('b', 'GR', 'IGR'), linearModule('c', 'IGR', 'VSH')]);
    expect(r.ports.get('IGR')).toEqual({ id: 'IGR', kind: 'curve', producers: ['a', 'b'] });
    expect(r.indexOf('c')).toBe(2);
    expect(r.paramSpecs.has('a.offset')).toBe(true);
  });

  it('rechaza ids duplicados y mal formados', () => {
    const p = problemsOf([linearModule('a', 'GR', 'IGR'), linearModule('a', 'GR', 'VSH'), linearModule('Mal_Id', 'GR', 'PHIE')]);
    expect(p.some((x) => /dos módulos con el id 'a'/.test(x))).toBe(true);
    expect(p.some((x) => /kebab-case/.test(x))).toBe(true);
  });

  it('rechaza roles desconocidos en entradas y salidas', () => {
    const p = problemsOf([linearModule('a', 'GAMMA', 'IGR'), linearModule('b', 'GR', 'XYZ')]);
    expect(p).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/entrada 'x' pide el rol desconocido 'GAMMA'/),
        expect.stringMatching(/salida 'y' usa el rol desconocido 'XYZ'/),
      ]),
    );
  });

  it('acepta roles nuevos declarados por un módulo y rechaza redefinir uno existente', () => {
    const withRole: AnyModule = { ...linearModule('a', 'GR', 'MY_ROLE'), roles: [{ id: 'MY_ROLE', label: 'Mío', unit: 'v/v', family: 'other', origin: 'computed' }] };
    expect(() => createRegistry([withRole, linearModule('b', 'MY_ROLE', 'VSH')])).not.toThrow();
    const redefine: AnyModule = { ...linearModule('c', 'GR', 'IGR'), roles: [{ id: 'GR', label: 'otro', unit: 'gAPI', family: 'other', origin: 'measured' }] };
    expect(problemsOf([redefine]).join()).toMatch(/ya lo define el núcleo/);
  });

  it('valida el esquema de parámetros', () => {
    const bad = defineModule({
      ...base,
      id: 'bad',
      inputs: {},
      params: {
        a: param.number({ label: 'A', default: 5, min: 10, max: 0 }),
        b: param.number({ label: 'B', default: 1, min: 0, max: 10, scale: 'log' }),
        c: param.enum({ label: 'C', options: [{ value: 'x', label: 'X' }], default: 'y' as 'x' }),
        d: param.number({ label: '', default: 0, min: 0, max: 1, unit: 'furlong' }),
      },
      outputs: { y: output.scalar('Y', { label: 'Y' }) },
    });
    const p = problemsOf([bad]).join('\n');
    expect(p).toMatch(/'a': min \(10\) debe ser menor que max/);
    expect(p).toMatch(/'b': con escala logarítmica min debe ser > 0/);
    expect(p).toMatch(/'c': el default 'y' no está entre las opciones/);
    expect(p).toMatch(/'d': falta la etiqueta/);
    expect(p).toMatch(/'d': unidad desconocida 'furlong'/);
  });

  it('exige que los parámetros compartidos sean compatibles', () => {
    const mk = (id: string, def: number) =>
      defineModule({
        ...base,
        id,
        inputs: {},
        params: { rw: param.number({ label: 'Rw', default: def, min: 0.01, max: 10, unit: 'ohm.m', shared: true }) },
        outputs: { y: output.scalar(`Y_${id.toUpperCase()}`, { label: 'Y' }) },
      });
    expect(() => createRegistry([mk('a', 0.05), mk('b', 0.05)])).not.toThrow();
    expect(problemsOf([mk('a', 0.05), mk('b', 0.1)]).join()).toMatch(/compartido 'rw' no coincide con el de 'a' en default \(0.05 \/ 0.1\)/);
  });

  it('rechaza puertos con tipos inconsistentes y escalares requeridos que nadie produce', () => {
    const scalarY = defineModule({ ...base, id: 's', inputs: {}, params: {}, outputs: { y: output.scalar('PORT', { label: 'y' }) } });
    const tableY = defineModule({ ...base, id: 't', inputs: {}, params: {}, outputs: { y: output.table('PORT', { label: 'y', columns: [] }) } });
    const needs = defineModule({ ...base, id: 'n', inputs: { rw: input.scalar('RW_REF') }, params: {}, outputs: { y: output.scalar('Z', { label: 'z' }) } });
    const clash = defineModule({ ...base, id: 'c', inputs: {}, params: {}, outputs: { y: output.scalar('GR', { label: 'y' }) } });
    const p = problemsOf([scalarY, tableY, needs, clash]).join('\n');
    expect(p).toMatch(/puerto 'PORT' es 'scalar' en otro módulo y 'table' acá/);
    expect(p).toMatch(/ningún módulo produce el escalar requerido 'RW_REF'/);
    expect(p).toMatch(/coincide con un rol de curva/);
  });

  it('rechaza módulos sin salidas, categoría o espacio de trabajo desconocidos y sin docs', () => {
    const m = { ...base, id: 'x', category: 'magia', workspace: 'cocina', inputs: {}, params: {}, outputs: {}, docs: undefined } as unknown as AnyModule;
    const p = problemsOf([m]).join('\n');
    expect(p).toMatch(/no declara ninguna salida/);
    expect(p).toMatch(/categoría desconocida 'magia'/);
    expect(p).toMatch(/espacio de trabajo desconocido 'cocina'/);
    expect(p).toMatch(/docs debe tener/);
  });

  it('el error junta todos los problemas en un mensaje legible', () => {
    try {
      createRegistry([linearModule('a', 'NOPE', 'IGR'), linearModule('a', 'GR', 'IGR')]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryError);
      expect((e as Error).message).toMatch(/2 problema\(s\)/);
    }
  });
});

describe('parámetros compartidos y categorías', () => {
  const mkShared = (id: string, spec: ReturnType<typeof param.number>) =>
    defineModule({ ...base, id, inputs: {}, params: { rw: spec }, outputs: { y: output.scalar(`Y_${id.toUpperCase().replace(/-/g, '_')}`, { label: 'Y' }) } });
  const rw = param.number({ label: 'Rw', default: 0.05, min: 0.01, max: 10, step: 0.01, unit: 'ohm.m', scale: 'log', shared: true });

  it('compara todos los campos de un parámetro compartido', () => {
    const variants = [
      [{ ...rw, label: 'Resistividad del agua' }, /etiqueta \(Rw \/ Resistividad del agua\)/],
      [{ ...rw, min: 0.001 }, /min \(0.01 \/ 0.001\)/],
      [{ ...rw, max: 5 }, /max \(10 \/ 5\)/],
      [{ ...rw, step: 0.001 }, /step \(0.01 \/ 0.001\)/],
      [{ ...rw, scale: 'linear' as const }, /escala \(log \/ linear\)/],
      [{ ...rw, unit: 'mV' }, /unidad \(ohm.m \/ mV\)/],
      [{ ...rw, default: 0.1 }, /default \(0.05 \/ 0.1\)/],
      [{ ...rw, scope: 'zone' as const }, /alcance \(global \/ zone\)/],
    ] as const;
    for (const [spec, re] of variants) {
      const p = problemsOf([mkShared('a', rw), mkShared('b', spec as typeof rw)]).join('\n');
      expect(p, String(re)).toMatch(re);
    }
    // tooltip y group pueden variar
    expect(() => createRegistry([mkShared('a', rw), mkShared('b', { ...rw, tooltip: 'otro', group: 'g' })])).not.toThrow();
  });

  it('compara las opciones de un enum compartido', () => {
    const e1 = param.enum({ label: 'Litología', options: [{ value: 'ss', label: 'Arenisca' }, { value: 'ls', label: 'Caliza' }], default: 'ss', shared: true });
    const e2 = { ...e1, options: [{ value: 'ss' as const, label: 'Arenisca' }, { value: 'ls' as const, label: 'Calcáreo' }] };
    const mk = (id: string, spec: typeof e1) => defineModule({ ...base, id, inputs: {}, params: { lith: spec }, outputs: { y: output.scalar(`Y_${id.toUpperCase()}`, { label: 'Y' }) } });
    expect(problemsOf([mk('a', e1), mk('b', e2)]).join()).toMatch(/opciones/);
  });

  it('con catálogo canónico: el compartido tiene que estar en el catálogo y ser idéntico', () => {
    const catalog = { rw };
    expect(() => createRegistry([mkShared('a', rw)], { sharedParams: catalog })).not.toThrow();
    const notInCatalog = defineModule({ ...base, id: 'c', inputs: {}, params: { m: param.number({ label: 'm', default: 2, min: 1, max: 3, shared: true }) }, outputs: { y: output.scalar('Y_C', { label: 'Y' }) } });
    const fail = (mods: AnyModule[]) => {
      try {
        createRegistry(mods, { sharedParams: catalog });
      } catch (e) {
        return (e as RegistryError).problems.join('\n');
      }
      return '';
    };
    expect(fail([notInCatalog])).toMatch(/'m' no está en el catálogo/);
    expect(fail([mkShared('a', { ...rw, max: 1 })])).toMatch(/difiere del catálogo en max \(10 \/ 1\)/);
  });

  it('avisa si una clave es compartida en un módulo y propia en otro', () => {
    const local = defineModule({ ...base, id: 'b', inputs: {}, params: { rw: param.number({ label: 'Rw', default: 0.05, min: 0.01, max: 10 }) }, outputs: { y: output.scalar('Y_B', { label: 'Y' }) } });
    const r = createRegistry([mkShared('a', rw), local]);
    expect(r.warnings).toEqual([
      "El parámetro 'rw' es compartido en 'a' y propio en 'b': se guardan como valores distintos. Si es el mismo parámetro, declaralo compartido en todos.",
    ]);
  });

  it('un módulo puede declarar una categoría nueva con su etiqueta', () => {
    const geo = defineModule({ ...base, id: 'geo', category: 'sedimentology', categoryLabel: 'Sedimentología', inputs: {}, params: {}, outputs: { y: output.scalar('Y_GEO', { label: 'Y' }) } });
    const geo2 = defineModule({ ...base, id: 'geo-2', category: 'sedimentology', inputs: {}, params: {}, outputs: { y: output.scalar('Y_GEO2', { label: 'Y' }) } });
    const r = createRegistry([linearModule('x', 'GR', 'IGR'), geo, geo2]);
    expect(r.categories).toEqual([
      { id: 'other', label: 'Otros' },
      { id: 'sedimentology', label: 'Sedimentología' },
    ]);
    expect(r.categoryLabel('sedimentology')).toBe('Sedimentología');
    // sin etiqueta en ningún módulo → error claro
    const orphan = defineModule({ ...base, id: 'o', category: 'nueva', inputs: {}, params: {}, outputs: { y: output.scalar('Y_O', { label: 'Y' }) } });
    expect(problemsOf([orphan]).join()).toMatch(/categoría desconocida 'nueva'. Si es nueva, declarala con categoryLabel/);
    // etiquetas en conflicto
    const clash = { ...geo2, categoryLabel: 'Otra cosa' };
    expect(problemsOf([geo, clash]).join()).toMatch(/ya la declaró 'geo' como 'Sedimentología'/);
    // no se puede re-etiquetar una conocida
    const relabel = { ...geo2, category: 'shale', categoryLabel: 'Lutitas' };
    expect(problemsOf([relabel]).join()).toMatch(/ya existe con la etiqueta 'Arcillosidad'/);
  });
});
