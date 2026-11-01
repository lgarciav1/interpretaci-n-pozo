import type { EngineWell } from '../engine/engine';
import type { PreparationPlan, PreparedPayload } from './plan';
import { PREPARATION_BUDGET } from './state';
import { Quality } from './quality';
import { shiftConstant } from './shift';
import { filterMedian } from './filter';
import { fillLinearGaps } from './interpolation';

export class PreparationCancelled extends Error {}
/** Caché LRU por bytes reales; no conserva arrays del proyecto como resultados editados. */
export class MaskEvaluator {
  private readonly cache = new Map<string, PreparedPayload>();
  private bytes = 0;
  constructor(private readonly budget = PREPARATION_BUDGET) {}
  get retainedBytes(): number { return this.bytes; }
  async evaluate(well: EngineWell, plan: PreparationPlan, cancelled: () => boolean = () => false, yieldTask: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0))): Promise<PreparedPayload[]> {
    if (well.depth.length * 10 * (plan.artifacts.length + (plan.artifacts.some(a => a.filter || a.shift) ? 1 : 0)) > this.budget) throw new Error('La preparación excede el presupuesto de memoria.');
    const pinned = new Set(plan.artifacts.map(a => a.provenance.contentVersion));
    const result: PreparedPayload[] = [];
    for (const a of plan.artifacts) {
      if (cancelled()) throw new PreparationCancelled();
      const version = a.provenance.contentVersion;
      const hit = this.cache.get(version);
      if (hit) { this.cache.delete(version); this.cache.set(version, hit); result.push({ ...hit, id: a.id }); continue; }
      const bytes = well.depth.length * 10, allocation = bytes * (a.filter || a.shift ? 2 : 1);
      for (const [key, old] of this.cache) {
        if (this.bytes + allocation <= this.budget) break;
        if (!pinned.has(key)) { this.cache.delete(key); this.bytes -= old.data.byteLength + old.quality.byteLength; }
      }
      if (this.bytes + allocation > this.budget) throw new Error('No hay memoria disponible para la preparación.');
      const source = well.curves.find(c => c.id === a.sourceCurveId);
      if (!source) throw new Error('La curva original de la máscara no está disponible.');
      const data = new Float64Array(well.depth.length), quality = new Uint16Array(well.depth.length);
      const scratch = a.filter || a.shift ? { data: new Float64Array(data.length), quality: new Uint16Array(data.length) } : undefined;
      let range = 0;
      for (let start = 0; start < data.length; start += 16384) {
        if (cancelled()) throw new PreparationCancelled();
        const end = Math.min(start + 16384, data.length);
        for (let k = start; k < end; k++) {
          const d = well.depth[k]!, value = source.data[k]!;
          if (!Number.isFinite(value) && !Number.isNaN(value)) throw new Error('La curva original contiene valores infinitos. Revisá los datos.');
          while (range < a.ranges.length && a.ranges[range]!.base < d) range++;
          const excluded = range < a.ranges.length && a.ranges[range]!.top <= d;
          data[k] = excluded ? NaN : value;
          quality[k] = (Number.isNaN(value) ? Quality.OriginallyMissing : 0) | (excluded ? Quality.Excluded : 0);
        }
        if (end < data.length) await yieldTask();
      }
      if (cancelled()) throw new PreparationCancelled();
      if (a.gapFill) await fillLinearGaps(well.depth, data, quality, a.gapFill, a.boundaries!, async () => {
        if (cancelled()) throw new PreparationCancelled();
        await yieldTask();
        if (cancelled()) throw new PreparationCancelled();
      });
      if (cancelled()) throw new PreparationCancelled();
      if (a.filter) await filterMedian(well.depth, data, quality, a.filter, a.boundaries!, async () => {
        if (cancelled()) throw new PreparationCancelled();
        await yieldTask();
        if (cancelled()) throw new PreparationCancelled();
      }, scratch!);
      if (cancelled()) throw new PreparationCancelled();
      const sourceCounts = a.shift ? await shiftConstant(well.depth, data, quality, a.shift, a.boundaries!, async () => {
        if (cancelled()) throw new PreparationCancelled();
        await yieldTask();
        if (cancelled()) throw new PreparationCancelled();
      }, scratch!) : undefined;
      if (cancelled()) throw new PreparationCancelled();
      const payload = { id: a.id, version, data, quality, ...(sourceCounts ? { sourceCounts } : {}) };
      this.cache.set(version, payload); this.bytes += bytes; result.push(payload);
    }
    return result;
  }
}
