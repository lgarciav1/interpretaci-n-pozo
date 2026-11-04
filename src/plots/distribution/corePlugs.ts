/**
 * Plugs de corona del pozo activo para la serie «Corona» de las distribuciones por zona (docs/decisiones/0066, D15).
 * Puro: junta los plugs INCLUIDOS (decisión del usuario o propuesta de calidad, `plugStatuses`) de todos los conjuntos
 * de corona, con la profundidad CORREGIDA (`shiftedDepth`: la misma que dibuja el visor) y sus columnas φ, k y densidad
 * de grano en su unidad. La estadística la hace `plugs.ts`. Lee el modelo puro del módulo de corona
 * (`src/modules/core/model.ts`), como otros gráficos leen definiciones de módulos.
 */
import type { Interpretation } from '../../core/interpretation';
import { pointNumbers, shiftedDepth } from '../../core/pointSets';
import type { Well } from '../../core/well';
import type { CorePlugs, CoreProperty } from './plugs';
import { COL, coreSets, DEFAULT_MATCH_CURVE, MATCH_CURVE_SETTING, plugStatuses } from '../../modules/core/model';

const cache = new WeakMap<object, WeakMap<object, CorePlugs | null>>();
const NONE = {};

/** Nombre corto de la curva de correlación de un conjunto («PHIE», o el mnemónico de una `m:<curva>`). */
function matchName(well: Pick<Well, 'curves'>, key: string): string {
  if (key.startsWith('m:')) return well.curves.find((c) => c.id === key.slice(2))?.role ?? well.curves.find((c) => c.id === key.slice(2))?.mnemonic ?? key;
  return key.replace(/^r:/, '');
}

/** Plugs incluidos de todos los conjuntos de corona (null si no hay ninguno). Misma identidad mientras no cambien. */
export function wellCorePlugs(well: Pick<Well, 'pointSets' | 'curves'>, interpretation: Pick<Interpretation, 'pointSets'>): CorePlugs | null {
  const sets = coreSets(well.pointSets);
  if (sets.length === 0) return null;
  const decKey = interpretation.pointSets ?? NONE;
  let byDec = cache.get(well.pointSets);
  if (!byDec) cache.set(well.pointSets, (byDec = new WeakMap()));
  if (byDec.has(decKey)) return byDec.get(decKey)!;
  const ids: string[] = [];
  const depth: number[] = [];
  const cols: Record<CoreProperty, number[]> = { phi: [], k: [], rhog: [] };
  const units: Partial<Record<CoreProperty, string>> = {};
  const has: Partial<Record<CoreProperty, boolean>> = {};
  const names: string[] = [];
  let phiMatch: string | null = null;
  for (const set of sets) {
    const dec = interpretation.pointSets?.[set.id];
    const st = plugStatuses(set, dec);
    const z = shiftedDepth(set, dec);
    const data: Record<CoreProperty, Float64Array | null> = { phi: pointNumbers(set, COL.phi), k: pointNumbers(set, COL.k), rhog: pointNumbers(set, COL.rhog) };
    for (const p of ['phi', 'k', 'rhog'] as const) {
      const c = set.columns[COL[p]];
      if (data[p] && c && 'unit' in c) {
        // Dos conjuntos con unidades distintas: se queda la del primero (los lectores ya normalizan a la canónica).
        units[p] ??= c.unit;
        has[p] = true;
      }
    }
    let any = false;
    for (let i = 0; i < set.depth.length; i++) {
      if (!st[i]!.included) continue;
      any = true;
      ids.push(set.pointIds[i]!);
      depth.push(z[i]!);
      for (const p of ['phi', 'k', 'rhog'] as const) cols[p].push(data[p]?.[i] ?? NaN);
    }
    if (any) names.push(set.name);
    if (phiMatch === null) {
      const m = dec?.settings?.[MATCH_CURVE_SETTING];
      phiMatch = matchName(well, typeof m === 'string' && m ? m : DEFAULT_MATCH_CURVE);
    }
  }
  const out: CorePlugs | null =
    ids.length === 0
      ? null
      : {
          ids,
          depth: Float64Array.from(depth),
          columns: Object.fromEntries((['phi', 'k', 'rhog'] as const).filter((p) => has[p]).map((p) => [p, { values: Float64Array.from(cols[p]), unit: units[p]! }])) as CorePlugs['columns'],
          sets: names,
          phiMatch,
        };
  byDec.set(decKey, out);
  return out;
}
