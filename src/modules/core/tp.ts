/**
 * Plugs de corona REALES del TP (laboratorio de la cátedra), embebidos en la app: se cargan con un clic, sin el Excel
 * (docs/decisiones/0056-datos-reales-del-tp-embebidos.md). Los datos vienen de `./tpData.ts`, que genera
 * scripts/qa/tp-lab-data.py desde las hojas PB y FF Summary.
 *
 * - 151 plugs en dos coronas (90 en la corona 1, zona B; 61 en la corona 2, zona D) con φ, k y densidad de grano; 12
 *   de ellos con factor de formación F (llevan el código del laboratorio, p. ej. «1-6R2»; el resto «C1-07»…).
 * - Profundidad: la columna «Sample Depth, m» del Excel, que YA está puesta en profundidad contra el perfil (la original
 *   del laboratorio ×0,3048 menos 4,2 a 4,9 m). Por eso el desplazamiento inicial de cada corona es 0 y el conjunto se
 *   marca «ya en profundidad del perfil» (`DEPTH_ON_LOG_SETTING`); el usuario igual puede probar «Usar sugerido».
 * - Es dato real: NO lleva `synthetic`. El origen va en `source` (`TP_CORE_SOURCE`), que también identifica el conjunto
 *   para no cargarlo dos veces.
 */
import type { PointSet } from '../../core/pointSets';
import { createPointSet } from '../../core/pointSets';
import { setPointSetSetting } from '../../core/state/pointSets';
import type { Project } from '../../core/state/project';
import { addCoreExample } from './example';
import { COL, CORE_KIND, DEPTH_ON_LOG_SETTING } from './model';
import { TP_CORE_PLUGS } from './tpData';

/** Origen del conjunto (y su marca: no se carga dos veces en el mismo pozo). */
export const TP_CORE_SOURCE = 'TP_interpretacion_de_Pozo.xlsx · hojas PB y FF Summary';
export const TP_CORE_NAME = 'Corona del TP (datos de laboratorio)';

/** «25.664,55» (separadores del español, dos decimales): determinista, sin depender del ICU del entorno. */
function ft(v: number): string {
  const [int, dec] = v.toFixed(2).split('.');
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

/** Conjunto de plugs del TP (151 plugs, dos coronas). Puro y determinista. */
export function tpCoreSet(id: string): PointSet {
  const p = TP_CORE_PLUGS;
  return createPointSet({
    id,
    kind: CORE_KIND,
    name: TP_CORE_NAME,
    source: TP_CORE_SOURCE,
    depth: Float64Array.from(p, (q) => q.depthM),
    pointIds: p.map((q) => q.id),
    columns: {
      [COL.phi]: { label: 'Porosidad', unit: 'v/v', values: Float64Array.from(p, (q) => q.phi) },
      [COL.k]: { label: 'Permeabilidad', unit: 'mD', values: Float64Array.from(p, (q) => q.kMd) },
      [COL.rhog]: { label: 'Densidad de grano', unit: 'g/cm3', values: Float64Array.from(p, (q) => q.rhog) },
      [COL.ff]: { label: 'Factor de formación', unit: 'unitless', values: Float64Array.from(p, (q) => q.ff ?? NaN) },
      [COL.run]: { label: 'Corona', values: p.map((q) => q.run) },
      [COL.description]: {
        label: 'Descripción',
        values: p.map((q) => `${q.ff !== null ? 'Plug de laboratorio con ensayo eléctrico' : 'Plug de laboratorio'}, profundidad original ${ft(q.depthFt)} ft`),
      },
    },
  });
}

/** ¿Es el conjunto de plugs del TP? */
export const isTpCoreSet = (set: PointSet) => set.kind === CORE_KIND && set.source === TP_CORE_SOURCE;

/** Tramo del visor que muestra la corona 1 (la más somera) al cargar. */
export const TP_CORE_VIEW: readonly [number, number] = [7806, 7848];

/**
 * Agrega los plugs del TP con su modelo k–φ ya ajustado (una receta) y los marca como ya puestos en profundidad del
 * perfil (desplazamiento 0 en las dos coronas).
 */
export function addTpCore(project: Project, wellId: string, set: PointSet, trendId: string): Project {
  return setPointSetSetting(addCoreExample(project, wellId, set, trendId), wellId, set.id, DEPTH_ON_LOG_SETTING, true);
}
