import { resolveModuleParams, type NumberParamSpec, type ParamState, type ParamValues } from '../../core/params';
import uncertainty from '../../modules/uncertainty';

export function bandSettings(state: ParamState) {
  const { id, params } = uncertainty;
  const values = resolveModuleParams(id, params, state, []).global as ParamValues<typeof params>;
  // Los números de un proyecto guardado se validan por tipo, no por límites del slider.
  const withinRange = (value: number, spec: NumberParamSpec) =>
    value >= spec.min && value <= spec.max ? value : spec.default;
  return {
    distribution: values.distribution,
    phiLow: withinRange(values.phiLow, params.phiLow),
    phiHigh: withinRange(values.phiHigh, params.phiHigh),
    swLow: withinRange(values.swLow, params.swLow),
    swHigh: withinRange(values.swHigh, params.swHigh),
  };
}
