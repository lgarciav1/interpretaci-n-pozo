import { defineModule, input, output, type CurveInputSpec } from '../module';
import { createRegistry, type Registry } from '../registry';
import { formulaModuleId, sanitizeFormulas } from '../formulas';
import type { Interpretation } from '../interpretation';
import { selectDataCurves } from '../preparation/projection';
import { parseFormula } from '../../petro/formula';
import type { CurveMeta, Diagnostic } from './graph';

export function formulaRegistry(
  base: Registry, allCurves: readonly CurveMeta[], interpretation: Interpretation, diagnostics: Diagnostic[],
): { registry: Registry; expressions: ReadonlyMap<string, string> } {
  const expressions = new Map<string, string>();
  const formulas = sanitizeFormulas(interpretation.formulas, message => diagnostics.push({ level: 'error', code: 'formula', message }));
  if (!formulas?.length) return { registry: base, expressions };

  const byMnemonic = new Map<string, CurveMeta[]>();
  for (const curve of selectDataCurves(allCurves, interpretation, base.tools).eligible) {
    const key = curve.mnemonic.toUpperCase();
    const list = byMnemonic.get(key);
    if (list) list.push(curve);
    else byMnemonic.set(key, [curve]);
  }

  const usable = formulas.filter(({ mnemonic }) => {
    const moduleId = formulaModuleId(mnemonic);
    if (!base.roles.has(mnemonic) && !base.ports.has(mnemonic) && !base.get(moduleId) && !base.getPanel(moduleId) &&
        !allCurves.some(curve => curve.role === mnemonic || curve.mnemonic.toUpperCase() === mnemonic)) return true;
    diagnostics.push({ level: 'error', code: 'formula', moduleId, message: `El mnemónico ${mnemonic} ya está en uso.` });
    return false;
  });
  const registered = new Set(usable.map(f => f.mnemonic));
  const modules = usable.map(({ mnemonic, expression, unit }) => {
    const id = formulaModuleId(mnemonic);
    const parsed = parseFormula(expression);
    const inputs: Record<string, CurveInputSpec> = {};
    const keys = new Map<string, string>();
    for (const [i, ref] of parsed.references.entries()) {
      const key = `ref${i}`;
      const role = ref.replace(/^@/, '');
      const matches = ref.startsWith('@') ? [] : byMnemonic.get(ref) ?? [];
      const message = matches.length > 1 ? `La referencia ${ref} es ambigua. Usá @ROL para indicar un rol.`
        : !matches.length && !base.roles.has(role) && !registered.has(role) ? `No existe la referencia ${ref}.`
        : null;
      if (message) {
        diagnostics.push({ level: 'error', code: 'formula', moduleId: id, message: `${mnemonic}: ${message}` });
        continue;
      }
      inputs[key] = matches.length ? { ...input.curve(mnemonic, { label: ref }), curveId: matches[0]!.id } : input.curve(role);
      keys.set(ref, key);
    }
    if (keys.size !== parsed.references.length) return null;
    expressions.set(id, expression);
    return defineModule({
      id, name: mnemonic, category: 'formulas', categoryLabel: 'Curvas por fórmula',
      workspace: ['petrophysics', 'geology'],
      roles: [{ id: mnemonic, label: mnemonic, unit, family: 'other', origin: 'computed' }],
      inputs, params: {}, outputs: { curve: output.curve(mnemonic) },
      compute(ctx) {
        const data = new Float64Array(ctx.n);
        let index = 0;
        const sample = (ref: string) => ctx.inputs[keys.get(ref)!]?.[index];
        for (; index < ctx.n; index++) data[index] = parsed.evaluate(sample);
        return { curve: data };
      },
      docs: { summary: 'Curva calculada a partir de una fórmula de la interpretación.', equations: [], references: [] },
    });
  });
  const valid = modules.filter(m => m !== null);
  // Roles de fórmulas inválidas siguen declarados para diagnosticar dependencias faltantes.
  const invalidRoles = usable.filter(f => !expressions.has(formulaModuleId(f.mnemonic))).map(({ mnemonic, unit }) => ({
    id: mnemonic, label: mnemonic, unit, family: 'other' as const, origin: 'computed' as const,
  }));
  const registry = createRegistry([...base.modules, ...valid], {
    baseRoles: [...base.roles.all().filter(role => !base.modules.some(m => m.roles?.some(r => r.id === role.id))), ...invalidRoles],
    baseTools: base.tools.all().filter(tool => !base.modules.some(m => m.tools?.some(t => t.id === tool.id))),
    panels: base.panels,
  });
  return { registry, expressions };
}
