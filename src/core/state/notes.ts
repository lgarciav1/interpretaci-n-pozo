import { validNote, type DepthNote } from '../notes';
import { getWellEntry, updateInterpretation, type Project } from './project';
export function saveNote(project: Project, wellId: string, note: DepthNote): Project {
  if (!validNote(note)) throw new Error('La nota necesita texto y profundidades válidas.');
  const depth = getWellEntry(project, wellId).well.depth.values;
  if (!depth.length || note.top < depth[0]! || (note.base ?? note.top) > depth[depth.length - 1]!) throw new Error('La nota debe quedar dentro del pozo.');
  return updateInterpretation(project, wellId, i => {
    const notes = i.notes ?? [];
    const prev = notes.find(n => n.id === note.id);
    if (prev && JSON.stringify(prev) === JSON.stringify(note)) return i;
    return { ...i, notes: prev ? notes.map(n => n.id === note.id ? { ...note } : n) : [...notes, { ...note }] };
  });
}
export function removeNote(project: Project, wellId: string, id: string): Project {
  return updateInterpretation(project, wellId, i => i.notes?.some(n => n.id === id) ? { ...i, notes: i.notes.filter(n => n.id !== id) } : i);
}
/** Traslada todo el intervalo, sin cambiar espesor; se detiene en los extremos del pozo. */
export function moveNote(project: Project, wellId: string, id: string, delta: number): Project {
  const e = getWellEntry(project, wellId), n = e.interpretation.notes?.find(n => n.id === id);
  if (!n || !Number.isFinite(delta)) return project;
  const d = e.well.depth.values;
  const shift = Math.min(d[d.length - 1]! - (n.base ?? n.top), Math.max(d[0]! - n.top, delta));
  return saveNote(project, wellId, { ...n, top: n.top + shift, ...(n.base !== undefined ? { base: n.base + shift } : {}) });
}
