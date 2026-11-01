/**
 * Ensayo de índice de resistividad REAL del TP (hoja IRSummary del Excel de la cátedra), embebido en la app
 * (docs/decisiones/0056-datos-reales-del-tp-embebidos.md). Datos en `../core/tpData.ts`.
 *
 * Un conjunto 'core-ri' con dos tipos de «plug»:
 * - «Compuesto (hoja IRSummary)»: los 586 pares Sw–RI de todos los plugs juntos, sin identificar (así los entrega el
 *   laboratorio). Es el que da el «valor compuesto» de la cátedra (n por el origen ≈ 2,21). Incluido por defecto.
 * - Los 12 plugs del ensayo eléctrico, con su punto final de desaturación (un paso cada uno). Esos puntos ya están
 *   dentro del compuesto: por defecto quedan DESCARTADOS (decisión `exclude` del usuario, que puede revertir con la
 *   casilla por plug) para no contarlos dos veces.
 *
 * Profundidad: el compuesto no la tiene (0 m y `md` NaN, la convención de `src/io/coreRi.ts`); los 12 plugs llevan la
 * de su plug en `../core/tp.ts` (ya en profundidad del perfil). Ningún consumidor ubica estos puntos en el visor.
 */
import { createPointSet, type PointSet } from '../../core/pointSets';
import type { Project } from '../../core/state/project';
import { addPointSet } from '../../core/state/pointSets';
import { CORE_RI_COLUMNS, CORE_RI_SET_KIND } from '../../io/coreRi';
import { TP_CORE_PLUGS, TP_RI_COMPOSITE, TP_RI_PLUGS } from '../core/tpData';
import { setRiPlugIncluded } from './saturation';

export const TP_RI_SOURCE = 'TP_interpretacion_de_Pozo.xlsx · hoja IRSummary';
export const TP_RI_NAME = 'Índice de resistividad del TP (laboratorio)';
/** Nombre del grupo con los pares compuestos. */
export const TP_RI_COMPOSITE_PLUG = 'Compuesto (hoja IRSummary)';
/** Plugs que quedan descartados al cargar (sus puntos finales ya están en el compuesto). */
export const TP_RI_DEFAULT_EXCLUDED: readonly string[] = TP_RI_PLUGS.map((p) => p.id);

/** Conjunto RI–Sw del TP. Puro y determinista. */
export function tpRiSet(id: string): PointSet {
  const depthOf = new Map(TP_CORE_PLUGS.map((q) => [q.id, q.depthM]));
  const sw: number[] = [];
  const ri: number[] = [];
  const md: number[] = [];
  const depth: number[] = [];
  const plug: string[] = [];
  const ids: string[] = [];
  TP_RI_COMPOSITE.forEach(([s, r], i) => {
    sw.push(s);
    ri.push(r);
    md.push(NaN);
    depth.push(0);
    plug.push(TP_RI_COMPOSITE_PLUG);
    ids.push(`IRS·${String(i + 1).padStart(3, '0')}`);
  });
  for (const p of TP_RI_PLUGS) {
    const z = depthOf.get(p.id) ?? NaN;
    sw.push(p.sw);
    ri.push(p.ri);
    md.push(z);
    depth.push(Number.isFinite(z) ? z : 0);
    plug.push(p.id);
    ids.push(`${p.id}·final`);
  }
  return createPointSet({
    id,
    kind: CORE_RI_SET_KIND,
    name: TP_RI_NAME,
    source: TP_RI_SOURCE,
    depth: Float64Array.from(depth),
    pointIds: ids,
    columns: {
      [CORE_RI_COLUMNS.sw]: { label: 'Saturación de agua', unit: 'v/v', values: Float64Array.from(sw) },
      [CORE_RI_COLUMNS.ri]: { label: 'Índice de resistividad', unit: 'unitless', values: Float64Array.from(ri) },
      [CORE_RI_COLUMNS.md]: { label: 'Profundidad', unit: 'm', values: Float64Array.from(md) },
      [CORE_RI_COLUMNS.plug]: { label: 'Plug', values: plug },
    },
  });
}

/** ¿Es el ensayo RI del TP? */
export const isTpRiSet = (set: PointSet) => set.kind === CORE_RI_SET_KIND && set.source === TP_RI_SOURCE;

/** Agrega el ensayo con los 12 plugs individuales descartados (una receta: un Ctrl+Z). */
export function addTpRi(project: Project, wellId: string, set: PointSet): Project {
  let p = addPointSet(project, wellId, set);
  for (const id of TP_RI_DEFAULT_EXCLUDED) p = setRiPlugIncluded(p, wellId, set, id, false);
  return p;
}
