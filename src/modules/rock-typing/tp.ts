/**
 * Curvas MICP REALES del TP (hoja SCAL del Excel de la cátedra), embebidas: se cargan con un clic como un conjunto de
 * puntos `capillary`, el que ya dibuja la pestaña «Presión capilar» (docs/decisiones/0087-micp-del-tp.md). Los datos
 * vienen de `./tpMicp.ts`, que genera scripts/qa/tp-micp-data.py.
 *
 * - 8 muestras, 22 a 37 escalones cada una. Columnas: `sample`, `pc` (psi, mercurio–aire, convertida de kg/cm²),
 *   `sw` (v/v, fase mojante), `k` (mD, de gas) y `phi` (v/v), las de `pcCurvesFromPointSet`.
 * - Profundidad: la del plug de corona del mismo número (aproximada, por nombre de muestra). Todos los puntos de una
 *   muestra comparten la cota.
 * - Es dato real: NO lleva `synthetic`. El origen va en `source` (`TP_MICP_SOURCE`), que también identifica el
 *   conjunto para no cargarlo dos veces.
 */
import { createPointSet, type PointSet } from '../../core/pointSets';
import { addPointSet } from '../../core/state/pointSets';
import { getWellEntry, type Project } from '../../core/state/project';
import { KGF_CM2_TO_PSI } from '../../petro/rockTyping';
import { CAPILLARY_KIND } from './model';
import { TP_MICP_SAMPLES, type TpMicpSample } from './tpMicp';

export const TP_MICP_SOURCE = 'TP_interpretacion_de_Pozo.xlsx · hoja SCAL (gráficos de inyección de mercurio)';
export const TP_MICP_NAME = 'MICP del TP (inyección de mercurio)';

/** Conjunto `capillary` con las curvas del TP. Puro y determinista; ids «1-32·01»… por muestra y escalón. */
export function tpMicpSet(id: string, samples: readonly TpMicpSample[] = TP_MICP_SAMPLES): PointSet {
  const rows = samples.flatMap((s) => s.pcKgCm2.map((pc, i) => ({ s, i, pc })));
  return createPointSet({
    id,
    kind: CAPILLARY_KIND,
    name: TP_MICP_NAME,
    source: TP_MICP_SOURCE,
    depth: Float64Array.from(rows, (r) => r.s.depthM),
    pointIds: rows.map((r) => `${r.s.sample}·${String(r.i + 1).padStart(2, '0')}`),
    columns: {
      sample: { label: 'Muestra', values: rows.map((r) => r.s.sample) },
      pc: { label: 'Presión capilar Hg–aire', unit: 'psi', values: Float64Array.from(rows, (r) => r.pc * KGF_CM2_TO_PSI) },
      sw: { label: 'Saturación mojante', unit: 'v/v', values: Float64Array.from(rows, (r) => r.s.swPct[r.i]! / 100) },
      k: { label: 'Permeabilidad al gas', unit: 'mD', values: Float64Array.from(rows, (r) => r.s.kGasMd) },
      phi: { label: 'Porosidad', unit: 'v/v', values: Float64Array.from(rows, (r) => r.s.phiPct / 100) },
    },
  });
}

/** ¿Es el conjunto MICP del TP? */
export const isTpMicpSet = (set: PointSet) => set.kind === CAPILLARY_KIND && set.source === TP_MICP_SOURCE;

/** ¿El pozo ya tiene las curvas MICP del TP? */
export const hasTpMicp = (project: Project, wellId: string) => getWellEntry(project, wellId).well.pointSets.some(isTpMicpSet);

/**
 * «Cargar curvas MICP del TP»: agrega el conjunto al pozo (una receta, un Ctrl+Z). Si ya está, devuelve el proyecto
 * sin cambios: nunca lo duplica.
 */
export function addTpMicp(project: Project, wellId: string, set: PointSet): Project {
  return hasTpMicp(project, wellId) ? project : addPointSet(project, wellId, set);
}
export const TP_MICP_SAMPLES_COUNT = TP_MICP_SAMPLES.length;
