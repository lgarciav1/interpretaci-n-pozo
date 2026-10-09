/** Utilidades compartidas por los tests: pozos sintéticos y módulos de prueba con contador de cálculos. */
import { defineModule, input, output, type AnyModule } from '../src/core/module';
import { param } from '../src/core/params';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import type { EngineCurve, EngineWell } from '../src/core/engine/engine';
import type { Zone } from '../src/core/well';
import { defaultRoleCatalog } from '../src/core/roles';

export function depthRange(n: number, top = 1000, step = 0.5): Float64Array {
  return Float64Array.from({ length: n }, (_, i) => top + i * step);
}

/** Curva medida; por defecto en la unidad canónica de su rol. */
export function curve(id: string, role: string | null, data: ArrayLike<number>, unit?: string): EngineCurve {
  const u = unit ?? (role && defaultRoleCatalog.has(role) ? defaultRoleCatalog.unitOf(role) : 'unitless');
  return { id, mnemonic: id, role, unit: u, data: Float64Array.from(data) };
}

export function well(curves: EngineCurve[], n = curves[0]?.data.length ?? 10, top = 1000, step = 0.5): EngineWell {
  return { id: 'w1', depth: depthRange(n, top, step), curves };
}

export function zone(id: string, top: number, base: number): Zone {
  return { id, name: id.toUpperCase(), top, base, color: '#888', kind: 'formation' };
}

export function interp(partial: Partial<Interpretation> = {}): Interpretation {
  return { ...emptyInterpretation(), ...partial };
}

/** Contador de llamadas a compute por módulo. */
export const calls = new Map<string, number>();
export function resetCalls() {
  calls.clear();
}
function count(id: string) {
  calls.set(id, (calls.get(id) ?? 0) + 1);
}

/**
 * Módulo de prueba genérico: out = in * factor + offset (por zona). Produce `outRole` a partir de `inRole`.
 */
export function linearModule(id: string, inRole: string, outRole: string, opts: { factor?: number } = {}): AnyModule {
  return defineModule({
    id,
    name: `Prueba ${id}`,
    category: 'other',
    workspace: 'petrophysics',
    inputs: { x: input.curve(inRole) },
    params: {
      offset: param.number({ label: 'Desplazamiento', default: 0, min: -1000, max: 1000, scope: 'zone' }),
    },
    outputs: { y: output.curve(outRole) },
    compute({ n, inputs, segments }) {
      count(id);
      const out = new Float64Array(n);
      const f = opts.factor ?? 1;
      for (const s of segments) for (let i = s.start; i < s.end; i++) out[i] = inputs.x[i]! * f + s.params.offset;
      return { y: out };
    },
    docs: { summary: 'prueba', equations: [], references: [] },
  });
}
