/** Referencias de laboratorio compatibles: porosidad total, MD alineada, sin inventar Sw desde RI. */
import type { WellEntry } from '../state/project';
import { convert } from '../units';
import { pointNumbers, pointRuns } from '../pointSets';
import { coreSets, COL, DEPTH_ON_LOG_SETTING } from '../../modules/core/model';
import { includedPlugs } from '../../modules/core-calibration/model';
import type { TournamentObservation } from '../../petro/modelTournament';

export function observationsFromEntry(entry: WellEntry): TournamentObservation[] {
  const out: TournamentObservation[] = [];
  for (const set of coreSets(entry.well.pointSets ?? [])) {
    const dec = entry.interpretation.pointSets[set.id];
    const phi = pointNumbers(set, COL.phi), column = set.columns[COL.phi];
    if (!phi || !column || !('unit' in column)) continue;
    const plugs = includedPlugs(set, dec), runs = pointRuns(set);
    for (let p = 0; p < plugs.idx.length; p++) {
      const i = plugs.idx[p]!;
      const run = runs?.[i];
      const aligned = dec?.settings?.[DEPTH_ON_LOG_SETTING] === true || (run && dec?.runShifts?.[run] !== undefined) || dec?.depthShift !== undefined;
      if (!aligned) continue;
      let value: number;
      try { value = convert(phi[i]!, column.unit, 'v/v'); } catch { continue; }
      out.push({ id: `${set.id}:${set.pointIds[i]}`, depth: plugs.depth[p]!, value, usage: 'evaluation', source: set.source ?? set.name, synthetic: set.synthetic === true });
    }
  }
  return out;
}
