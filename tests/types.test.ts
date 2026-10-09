/**
 * Verificaciones de tipos del contrato de módulo (las comprueba `npm run typecheck`; en runtime solo corre el it).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineModule, input, output, type InputCurve } from '../src/core/module';
import { param } from '../src/core/params';

const docs = { summary: '', equations: [], references: [] };

describe('tipos del contrato de módulo', () => {
  it('compute recibe entradas, parámetros y salidas tipados', () => {
    const m = defineModule({
      id: 't',
      name: 'T',
      category: 'other',
      workspace: 'petrophysics',
      inputs: { gr: input.curve('GR'), cal: input.optionalCurve('CALI'), rw: input.optionalScalar('RW') },
      params: {
        k: param.number({ label: 'K', default: 1, min: 0, max: 2 }),
        method: param.enum({ label: 'Método', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' }),
        on: param.boolean({ label: 'On', default: true }),
      },
      outputs: { y: output.curve('IGR'), s: output.scalar('S', { label: 'S' }), t: output.table('T', { label: 'T', columns: [] }) },
      compute(ctx) {
        expectTypeOf(ctx.inputs.gr).toEqualTypeOf<InputCurve>();
        expectTypeOf(ctx.inputs.cal).toEqualTypeOf<InputCurve | undefined>();
        expectTypeOf(ctx.inputs.rw).toEqualTypeOf<number | undefined>();
        expectTypeOf(ctx.params.k).toEqualTypeOf<number>();
        expectTypeOf(ctx.params.method).toEqualTypeOf<'a' | 'b'>();
        expectTypeOf(ctx.segments[0]!.params.on).toEqualTypeOf<boolean>();
        // @ts-expect-error las entradas son de solo lectura
        ctx.inputs.gr[0] = 1;
        // @ts-expect-error no existe esa entrada
        void ctx.inputs.nphi;
        return { y: new Float64Array(ctx.n), s: 1, t: { rows: [] } };
      },
      docs,
    });
    expect(m.id).toBe('t');
  });

  it('compute debe devolver todas las salidas con su tipo', () => {
    defineModule({
      id: 'u',
      name: 'U',
      category: 'other',
      workspace: 'petrophysics',
      inputs: {},
      params: {},
      outputs: { y: output.curve('IGR'), s: output.scalar('S', { label: 'S' }) },
      // @ts-expect-error falta 's' y 'y' no es Float64Array
      compute: () => ({ y: [1, 2, 3] }),
      docs,
    });
  });
});
