/**
 * Recetas puras sobre las banderas de usuario del pozo (`Interpretation.userFlags?`, 0088).
 * Todas devuelven un `Project` nuevo compartiendo estructura: compatibles con `commit` y `Ctrl+Z`, sin mutar
 * `Well.curves` ni crear nuevas revisiones de entrada.
 */
import {
  countIntervalSamples,
  MAX_USER_FLAG_INTERVALS,
  MAX_USER_FLAGS,
  normalizeFlagIntervals,
  normalizeUserFlagName,
  USER_FLAG_NAME_MAX,
  USER_FLAG_SOURCE_MAX,
  userFlagColor,
  type UserFlagDef,
} from '../userFlags';
import { updateInterpretation, type Project } from './project';

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Agrega una bandera de usuario al pozo (valida nombre único, intervalos en rango y al menos una muestra). */
export function addUserFlag(project: Project, wellId: string, flag: UserFlagDef): Project {
  const entry = project.wells.find((w) => w.well.id === wellId);
  if (!entry) throw new Error('El pozo activo ya no existe.');
  if (!ID_RE.test(flag.id)) throw new Error('Identificador de bandera inválido.');
  const name = flag.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Ingresá un nombre para la bandera.');
  if (name.length > USER_FLAG_NAME_MAX) throw new Error(`El nombre de la bandera admite hasta ${USER_FLAG_NAME_MAX} caracteres.`);
  if (flag.color !== undefined && !HEX_RE.test(flag.color)) throw new Error('Color de bandera inválido.');
  const source = flag.source?.trim();
  if (source !== undefined && source.length > USER_FLAG_SOURCE_MAX) throw new Error(`El origen admite hasta ${USER_FLAG_SOURCE_MAX} caracteres.`);

  const existing = entry.interpretation.userFlags ?? [];
  if (existing.length >= MAX_USER_FLAGS) throw new Error(`Se alcanzó el máximo de ${MAX_USER_FLAGS} banderas de usuario en este pozo.`);
  if (existing.some((f) => f.id === flag.id)) throw new Error('Ya existe una bandera con ese identificador.');
  const normName = normalizeUserFlagName(name);
  if (existing.some((f) => normalizeUserFlagName(f.name) === normName)) {
    throw new Error(`Ya existe una bandera llamada «${name}» en este pozo.`);
  }

  if (!Array.isArray(flag.intervals) || flag.intervals.length === 0 || flag.intervals.length > MAX_USER_FLAG_INTERVALS) {
    throw new Error('La selección no tiene tramos válidos para guardar como bandera.');
  }
  for (const r of flag.intervals) {
    if (!Number.isFinite(r.top) || !Number.isFinite(r.base) || r.top > r.base) {
      throw new Error('Todos los intervalos de la bandera deben ser finitos con tope menor o igual que la base.');
    }
  }
  const intervals = normalizeFlagIntervals(flag.intervals);
  const depth = entry.well.depth.values;
  if (depth.length === 0) throw new Error('El pozo no tiene muestras de profundidad.');
  const minD = depth[0]!;
  const maxD = depth[depth.length - 1]!;
  if (intervals[0]!.top < minD || intervals[intervals.length - 1]!.base > maxD) {
    throw new Error('Los intervalos de la bandera deben quedar dentro de la profundidad del pozo.');
  }
  if (countIntervalSamples(depth, intervals) === 0) {
    throw new Error('Los intervalos elegidos no contienen ninguna muestra del pozo.');
  }

  const clean: UserFlagDef = {
    id: flag.id,
    name,
    color: flag.color ?? userFlagColor(existing.length),
    intervals,
    ...(source ? { source } : {}),
  };
  return updateInterpretation(project, wellId, (i) => ({
    ...i,
    userFlags: [...(i.userFlags ?? []), clean],
  }));
}

/** Elimina una bandera de usuario por id; si no quedan banderas, omite `userFlags` para mantener JSON limpio. */
export function removeUserFlag(project: Project, wellId: string, flagId: string): Project {
  const entry = project.wells.find((w) => w.well.id === wellId);
  const current = entry?.interpretation.userFlags;
  if (!entry || !current?.some((f) => f.id === flagId)) return project;
  const next = current.filter((f) => f.id !== flagId);
  return updateInterpretation(project, wellId, (i) => {
    const { userFlags: _old, ...rest } = i;
    return next.length > 0 ? { ...rest, userFlags: next } : rest;
  });
}

/** Renombra una bandera de usuario preservando unicidad de nombre dentro del pozo. */
export function renameUserFlag(project: Project, wellId: string, flagId: string, newName: string): Project {
  const entry = project.wells.find((w) => w.well.id === wellId);
  const current = entry?.interpretation.userFlags;
  if (!entry || !current) return project;
  const target = current.find((f) => f.id === flagId);
  if (!target) return project;
  const name = newName.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Ingresá un nombre para la bandera.');
  if (name.length > USER_FLAG_NAME_MAX) throw new Error(`El nombre de la bandera admite hasta ${USER_FLAG_NAME_MAX} caracteres.`);
  const normName = normalizeUserFlagName(name);
  if (current.some((f) => f.id !== flagId && normalizeUserFlagName(f.name) === normName)) {
    throw new Error(`Ya existe una bandera llamada «${name}» en este pozo.`);
  }
  if (target.name === name) return project;
  return updateInterpretation(project, wellId, (i) => ({
    ...i,
    userFlags: (i.userFlags ?? []).map((f) => (f.id === flagId ? { ...f, name } : f)),
  }));
}
