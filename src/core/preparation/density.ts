/** F20: decisiones JSON; los datos y las bandas son derivados del evaluador. ADR 0077. */
import { requireShape, requireArray, requireText } from '../inputs/validation';
import { convert, getUnit } from '../units';
import type { EngineCurve } from '../engine/engine';
export interface DensityInterval { top: number; base: number }
export type DensityPredictorRole = 'gr' | 'sonic' | 'resistivity' | 'neutron';
export interface DensityReconstructionConfig {
  goodIntervals: DensityInterval[];
  washoutIntervals: DensityInterval[];
  predictors: { curveId: string; role: DensityPredictorRole; trusted: true; reliableIntervals: DensityInterval[] }[];
}
export function validateDensityConfig(value: unknown): asserts value is DensityReconstructionConfig {
  const c = requireShape(value, 'Reconstrucción', ['goodIntervals', 'washoutIntervals', 'predictors']);
  const intervals = (v: unknown) => {
    requireArray(v, 'Intervalos de densidad');
    if (!v.length || v.length > 256) throw new Error('Declarar entre 1 y 256 intervalos.');
    for (const r of v) {
      const x = requireShape(r, 'Intervalo', ['top', 'base']);
      if (typeof x.top !== 'number' || typeof x.base !== 'number' || !Number.isFinite(x.top) || !Number.isFinite(x.base) || x.top > x.base) throw new Error('Intervalo MD inválido.');
    }
  };
  intervals(c.goodIntervals); intervals(c.washoutIntervals);
  const config = value as DensityReconstructionConfig;
  if (config.goodIntervals.some(g => config.washoutIntervals.some(w => g.top <= w.base && w.top <= g.base))) throw new Error('Buen pozo y derrumbe no pueden solaparse.');
  requireArray(c.predictors, 'Predictores');
  if (c.predictors.length < 2 || c.predictors.length > 4) throw new Error('Seleccionar entre dos y cuatro predictores.');
  const ids = new Set<string>(), roles = new Set<string>();
  for (const p of c.predictors) {
    const x = requireShape(p, 'Predictor', ['curveId', 'role', 'trusted', 'reliableIntervals']);
    requireText(x.curveId, 'Curva predictora');
    if (!['gr', 'sonic', 'resistivity', 'neutron'].includes(x.role as string) || x.trusted !== true || ids.has(x.curveId) || roles.has(x.role as string)) throw new Error('Predictor desconocido, repetido o sin confianza explícita.');
    ids.add(x.curveId); roles.add(x.role as string); intervals(x.reliableIntervals);
  }
}
export function densityIntervalMask(depth: ArrayLike<number>, intervals: readonly DensityInterval[]): Uint8Array {
  return Uint8Array.from({ length: depth.length }, (_, k) => intervals.some(r => depth[k]! >= r.top && depth[k]! <= r.base) ? 1 : 0);
}
const specs = { gr: ['GR', 'gAPI'], sonic: ['DT', 'us/ft'], resistivity: ['RT', 'ohm.m'], neutron: ['NPHI', 'v/v'] } as const;
export function densityPredictorUnit(curve: Pick<EngineCurve, 'role' | 'unit'>, role: DensityPredictorRole): string {
  const [expected, unit] = specs[role];
  // Resistividad medida admite roles de las herramientas somera/media/profunda del registro.
  if ((role === 'resistivity' ? !['RT', 'RS', 'RM', 'RXO'].includes(curve.role ?? '') : curve.role !== expected) || getUnit(curve.unit)?.dimension !== getUnit(unit)?.dimension) throw new Error('Rol o unidad del predictor incompatible.');
  convert(1, curve.unit, unit);
  return unit;
}
