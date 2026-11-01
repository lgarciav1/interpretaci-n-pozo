/**
 * Presiones MDT REALES del TP (hoja MDT del Excel de la cátedra), embebidas en la app: se cargan con un clic, sin el
 * Excel (docs/decisiones/0057-mdt-y-scal-del-tp-embebidos.md). Los datos vienen de `./tpData.ts`, que genera
 * scripts/qa/tp-mdt-scal-data.py.
 *
 * - 58 pruebas de las zonas B (25), C (2) y D (31): profundidad (m), presión de formación (psi), caída de presión de
 *   la prueba (drawdown) y zona de la hoja.
 * - Profundidad: la de la hoja, en metros, tal cual (MD; el pozo del TP es vertical y la hoja no trae TVD). Cae entre
 *   7729 y 8121 m, dentro del pozo (7633–8518 m).
 * - Es dato real: NO lleva `synthetic`. El origen va en `source` (`TP_MDT_SOURCE`), que también identifica el
 *   conjunto para no cargarlo dos veces.
 * - No se traza ningún gradiente ni se descarta ninguna prueba: el usuario usa las herramientas del panel MDT (la hoja
 *   no trae movilidad ni calidad, así que las reglas automáticas no proponen descartes).
 */
import { createPointSet, type PointSet } from '../../core/pointSets';
import { PRESSURE_KIND } from './model';
import { TP_MDT_POINTS } from './tpData';

/** Origen del conjunto (y su marca: no se carga dos veces en el mismo pozo). */
export const TP_MDT_SOURCE = 'TP_interpretacion_de_Pozo.xlsx · hoja MDT';
export const TP_MDT_NAME = 'MDT del TP (presiones de formación)';
/** Columna de texto con la zona de la hoja (B, C o D). */
export const TP_MDT_ZONE_COLUMN = 'zone';

/** Conjunto de presiones del TP (58 pruebas). Puro y determinista. Ids «MDT-01»… en el orden de la hoja. */
export function tpMdtSet(id: string): PointSet {
  const p = TP_MDT_POINTS;
  return createPointSet({
    id,
    kind: PRESSURE_KIND,
    name: TP_MDT_NAME,
    source: TP_MDT_SOURCE,
    depth: Float64Array.from(p, (q) => q.depthM),
    pointIds: p.map((_, i) => `MDT-${String(i + 1).padStart(2, '0')}`),
    columns: {
      pressure: { label: 'Presión de formación', unit: 'psi', values: Float64Array.from(p, (q) => q.pressurePsi) },
      drawdown: { label: 'Caída de presión (drawdown)', unit: 'psi', values: Float64Array.from(p, (q) => q.drawdown) },
      [TP_MDT_ZONE_COLUMN]: { label: 'Zona', values: p.map((q) => q.zone) },
    },
  });
}

/** ¿Es el conjunto de presiones del TP? */
export const isTpMdtSet = (set: PointSet) => set.kind === PRESSURE_KIND && set.source === TP_MDT_SOURCE;

/** Tramo del visor que muestra todas las pruebas del TP al cargar. */
export const TP_MDT_VIEW: readonly [number, number] = [7715, 8135];
