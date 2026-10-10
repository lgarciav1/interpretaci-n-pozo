/**
 * Recetas puras sobre los conjuntos de puntos de un pozo y las decisiones del usuario sobre ellos
 * (docs/decisiones/0009-presiones-mdt-y-conjuntos-de-puntos.md). Se aplican con
 * `useProject.getState().commit(etiqueta, (p) => receta(p, …))`: todo se deshace con Ctrl+Z.
 * Si nada cambia, devuelven el mismo proyecto (no se registra en el historial).
 *
 * - Los DATOS (`Well.pointSets`) cambian solo al cargar o borrar un conjunto. Cambiar el pozo no recalcula el motor:
 *   el puente sincroniza el pozo solo si cambian sus curvas o su profundidad.
 * - Las DECISIONES (`Interpretation.pointSets`) son de la interpretación: entran en snapshots.
 */
import { isPointSetSeriesKey, type PointDecision, type PointSet, type PointSetDecisions } from '../pointSets';
import { getWellEntry, updateInterpretation, updateWell, type Project } from './project';

function requireSet(project: Project, wellId: string, setId: string): PointSet {
  const s = getWellEntry(project, wellId).well.pointSets.find((x) => x.id === setId);
  if (!s) throw new Error(`No existe el conjunto de puntos '${setId}'.`);
  return s;
}

/** Agrega un conjunto al pozo (ya validado con `createPointSet`). */
export function addPointSet(project: Project, wellId: string, set: PointSet): Project {
  if (getWellEntry(project, wellId).well.pointSets.some((s) => s.id === set.id)) throw new Error(`Ya hay un conjunto de puntos con el id '${set.id}'.`);
  return updateWell(project, wellId, (w) => ({ ...w, pointSets: [...w.pointSets, set] }));
}

/**
 * Quita un conjunto, las decisiones sobre él y SUS TENDENCIAS: las de una serie cuya clave es `<conjunto>` o
 * `<conjunto>:…` (convención de los proveedores de series sobre conjuntos de puntos: gradientes MDT, modelo k–φ de la
 * corona), de cualquier proveedor que no sea el de curvas (`curve`, cuyas claves son `m:…` / `r:…`).
 */
export function removePointSet(project: Project, wellId: string, setId: string): Project {
  requireSet(project, wellId, setId);
  const next = updateWell(project, wellId, (w) => ({ ...w, pointSets: w.pointSets.filter((s) => s.id !== setId) }));
  return updateInterpretation(next, wellId, (i) => {
    const trends = i.trends.filter((t) => t.series.provider === 'curve' || !isPointSetSeriesKey(t.series.key, setId));
    if (!(setId in i.pointSets) && trends.length === i.trends.length) return i;
    const { [setId]: _gone, ...rest } = i.pointSets;
    return { ...i, pointSets: rest, trends: trends.length === i.trends.length ? i.trends : trends };
  });
}

export function renamePointSet(project: Project, wellId: string, setId: string, name: string): Project {
  const s = requireSet(project, wellId, setId);
  const v = name.trim();
  if (!v || v === s.name) return project;
  return updateWell(project, wellId, (w) => ({ ...w, pointSets: w.pointSets.map((x) => (x.id === setId ? { ...x, name: v } : x)) }));
}

function mapDecisions(project: Project, wellId: string, setId: string, fn: (d: PointSetDecisions) => PointSetDecisions): Project {
  requireSet(project, wellId, setId);
  return updateInterpretation(project, wellId, (i) => {
    const prev = i.pointSets[setId] ?? { points: {} };
    const next = fn(prev);
    if (next === prev) return i;
    return { ...i, pointSets: { ...i.pointSets, [setId]: next } };
  });
}

const isEmptyDecision = (d: PointDecision | undefined) => !d || (!d.status && !d.tag);

/**
 * Cambia lo decidido sobre varios puntos de un conjunto. Por punto: un parche (`status`/`tag`; `undefined` quita
 * ese campo) o null para borrar la decisión (vuelve a mandar la propuesta automática).
 */
export function setPointDecisions(project: Project, wellId: string, setId: string, patches: Readonly<Record<string, Partial<PointDecision> | null>>): Project {
  const set = requireSet(project, wellId, setId);
  const ids = new Set(set.pointIds);
  for (const pid of Object.keys(patches)) if (!ids.has(pid)) throw new Error(`El conjunto '${set.name}' no tiene el punto '${pid}'.`);
  return mapDecisions(project, wellId, setId, (d) => {
    let points: Record<string, PointDecision> | null = null;
    for (const [pid, patch] of Object.entries(patches)) {
      const prev = d.points[pid];
      let next: PointDecision | undefined;
      if (patch === null) next = undefined;
      else {
        const merged: PointDecision & Record<string, unknown> = { ...prev };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete merged[k];
          else merged[k] = v;
        }
        next = isEmptyDecision(merged) ? undefined : merged;
      }
      if ((prev?.status ?? null) === (next?.status ?? null) && (prev?.tag ?? null) === (next?.tag ?? null)) continue;
      points ??= { ...d.points };
      if (next) points[pid] = next;
      else delete points[pid];
    }
    return points ? { ...d, points } : d;
  });
}

/** Una sola decisión (atajo de `setPointDecisions`). */
export function setPointDecision(project: Project, wellId: string, setId: string, pointId: string, patch: Partial<PointDecision> | null): Project {
  return setPointDecisions(project, wellId, setId, { [pointId]: patch });
}

/** Ajuste del módulo para un conjunto (umbral de movilidad…). `undefined` lo quita. */
export function setPointSetSetting(project: Project, wellId: string, setId: string, key: string, value: number | string | boolean | undefined): Project {
  return mapDecisions(project, wellId, setId, (d) => {
    if (d.settings?.[key] === value) return d;
    const settings = { ...d.settings };
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    const { settings: _old, ...rest } = d;
    return Object.keys(settings).length ? { ...rest, settings } : rest;
  });
}

/**
 * Puesta en profundidad (m, se suma a la profundidad del archivo).
 * - Sin `run`: la del conjunto (valor por defecto de todas las corridas); 0 o undefined la quita.
 * - Con `run`: la de esa corrida o corona (reemplaza a la del conjunto para sus puntos); undefined la quita y la
 *   corrida vuelve a usar la del conjunto; 0 es un valor explícito (si el conjunto tiene otro).
 */
export function setPointSetDepthShift(project: Project, wellId: string, setId: string, shift: number | undefined, run?: string): Project {
  if (shift !== undefined && !Number.isFinite(shift)) throw new Error('La puesta en profundidad debe ser un número.');
  if (run !== undefined) {
    if (!run) throw new Error('La corrida no tiene nombre.');
    return mapDecisions(project, wellId, setId, (d) => {
      const prev = d.runShifts?.[run];
      const v = shift === undefined ? undefined : shift === 0 && !d.depthShift ? undefined : shift;
      if (prev === v) return d;
      const runShifts = { ...d.runShifts };
      if (v === undefined) delete runShifts[run];
      else runShifts[run] = v;
      const { runShifts: _old, ...rest } = d;
      return Object.keys(runShifts).length ? { ...rest, runShifts } : rest;
    });
  }
  return mapDecisions(project, wellId, setId, (d) => {
    const v = shift === 0 ? undefined : shift;
    if (d.depthShift === v) return d;
    const { depthShift: _old, ...rest } = d;
    return v === undefined ? rest : { ...rest, depthShift: v };
  });
}
