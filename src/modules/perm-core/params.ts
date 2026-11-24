import { param, resolveModuleParams, type ParamState, type ParamValue } from '../../core/params';
import { isPowerPermModel, type CorePermModel, type LogLinearPermModel, type PowerPermModel } from '../../petro/permeability';

export const PERM_CORE_ID = 'perm-core';

export const PERM_CORE_KEYS = {
  method: `${PERM_CORE_ID}.kphiMethod`,
  a: `${PERM_CORE_ID}.kphiA`,
  b: `${PERM_CORE_ID}.kphiB`,
  powerLogA: `${PERM_CORE_ID}.powerLogA`,
  powerB: `${PERM_CORE_ID}.powerB`,
  powerPhiMin: `${PERM_CORE_ID}.powerPhiMin`,
  powerPhiMax: `${PERM_CORE_ID}.powerPhiMax`,
} as const;

export const PERM_CORE_DEFAULTS: LogLinearPermModel = { a: -2, b: 20 };

const FIT_GROUP = 'Modelo k–φ';
export const permCoreModelSchema = {
  kphiMethod: param.enum({
    label: 'Método k–φ',
    default: 'exp',
    options: [{ value: 'exp', label: 'Exponencial' }, { value: 'power', label: 'Potencial' }],
    scope: 'zone',
    group: FIT_GROUP,
  }),
  kphiA: param.number({
    label: 'Coeficiente a (ordenada exponencial)',
    tooltip: 'Logaritmo decimal de la permeabilidad extrapolada a porosidad nula.',
    default: PERM_CORE_DEFAULTS.a, min: -10, max: 5, step: 0.01, scope: 'zone', group: FIT_GROUP,
  }),
  kphiB: param.number({
    label: 'Coeficiente b (pendiente exponencial)',
    tooltip: 'Cuántas décadas de permeabilidad sube por cada unidad de porosidad (v/v).',
    default: PERM_CORE_DEFAULTS.b, min: -50, max: 150, step: 0.1, scope: 'zone', group: FIT_GROUP,
  }),
  powerLogA: param.number({
    label: 'Logaritmo decimal del factor potencial',
    default: 0, min: -100, max: 100, step: 0.01, scope: 'zone', group: FIT_GROUP,
  }),
  powerB: param.number({
    label: 'Exponente potencial',
    default: 1, min: -100, max: 100, step: 0.01, scope: 'zone', group: FIT_GROUP,
  }),
  powerPhiMin: param.number({
    label: 'Porosidad mínima del ajuste potencial',
    default: 0, min: 0, max: 1, step: 0.001, unit: 'v/v', scope: 'zone', group: FIT_GROUP,
  }),
  powerPhiMax: param.number({
    label: 'Porosidad máxima del ajuste potencial',
    default: 0, min: 0, max: 1, step: 0.001, unit: 'v/v', scope: 'zone', group: FIT_GROUP,
  }),
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const within = (v: unknown, { min, max }: { min: number; max: number }): v is number => finite(v) && v >= min && v <= max;

export function isValidPowerModel(a: unknown, b: unknown): boolean {
  return within(a, permCoreModelSchema.powerLogA) && within(b, permCoreModelSchema.powerB);
}

function powerModel(values: Record<string, ParamValue>, a: number, b: number): PowerPermModel {
  const phiMin = values[PERM_CORE_KEYS.powerPhiMin];
  const phiMax = values[PERM_CORE_KEYS.powerPhiMax];
  return finite(phiMin) && finite(phiMax) && phiMin > 0 && phiMax >= phiMin
    ? { method: 'power', a, b, phiMin, phiMax }
    : { method: 'power', a, b };
}

interface ScopedModel {
  model: CorePermModel | null;
  invalid?: true;
}

function readScopedModel(values: Record<string, ParamValue>, expFallback: LogLinearPermModel): ScopedModel {
  const method = values[PERM_CORE_KEYS.method];
  const a = values[PERM_CORE_KEYS.a];
  const b = values[PERM_CORE_KEYS.b];
  if (method === 'power') {
    const logA = values[PERM_CORE_KEYS.powerLogA];
    const exponent = values[PERM_CORE_KEYS.powerB];
    if (finite(logA) && finite(exponent) && isValidPowerModel(logA, exponent)) return { model: powerModel(values, logA, exponent) };
    return { model: null, invalid: true };
  }
  if (method === 'exp') {
    if (finite(a) && finite(b)) return { model: { a, b } };
    return { model: null, invalid: true };
  }
  if (method !== undefined) return { model: null, invalid: true };
  // Los overrides legados podían guardar un único coeficiente, con la otra componente heredada.
  if (finite(a) || finite(b)) return { model: { a: finite(a) ? a : expFallback.a, b: finite(b) ? b : expFallback.b } };
  return { model: null };
}

export function effectivePermCoreModel(state: ParamState, zoneId: string | null) {
  const global = readScopedModel(state.global, PERM_CORE_DEFAULTS);
  const globalA = state.global[PERM_CORE_KEYS.a];
  const globalB = state.global[PERM_CORE_KEYS.b];
  const exponential = {
    a: finite(globalA) ? globalA : PERM_CORE_DEFAULTS.a,
    b: finite(globalB) ? globalB : PERM_CORE_DEFAULTS.b,
  };
  const local = zoneId ? readScopedModel(state.zones[zoneId] ?? {}, exponential) : undefined;
  return {
    model: local?.model ?? global.model ?? PERM_CORE_DEFAULTS,
    origin: local?.model ? 'local' as const : global.model ? 'global' as const : 'default' as const,
    invalid: zoneId ? local?.invalid : global.invalid,
  };
}

function setEffectiveModel(values: Record<string, ParamValue>, model: CorePermModel): void {
  if (isPowerPermModel(model)) {
    values.kphiMethod = 'power';
    values.powerLogA = model.a;
    values.powerB = model.b;
    values.powerPhiMin = model.phiMin ?? 0;
    values.powerPhiMax = model.phiMax ?? 0;
  } else {
    values.kphiMethod = 'exp';
    values.kphiA = model.a;
    values.kphiB = model.b;
  }
}

/** Preserva la resolución común del recorte y reemplaza los coeficientes activos por un modelo completo. */
export function resolvePermCoreParams(spec: Parameters<typeof resolveModuleParams>[1], state: ParamState, zoneIds: readonly string[]) {
  const resolved = resolveModuleParams(PERM_CORE_ID, spec, state, zoneIds);
  const update = (values: Record<string, ParamValue>, zoneId: string | null) => {
    const effective = effectivePermCoreModel(state, zoneId);
    setEffectiveModel(values, effective.model);
    if (effective.invalid) {
      resolved.problems.push(zoneId
        ? `Modelo k–φ incompleto o inválido en la zona '${zoneId}'; se usa el modelo global.`
        : 'Modelo k–φ global incompleto o inválido; se usa la exponencial predeterminada.');
    }
  };
  update(resolved.global, null);
  for (const [zoneId, values] of resolved.byZone) update(values, zoneId);
  // La firma normal contiene los overrides originales y distingue también un modelo legado de uno explícito.
  resolved.key = JSON.stringify([resolved.key, resolved.global, [...resolved.byZone]]);
  return resolved;
}
