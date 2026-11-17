/** Anotaciones en metros MD. No son entradas del motor. */
export interface DepthNote { id: string; text: string; top: number; base?: number }
export const NOTE_MAX_LENGTH = 500;
export function validNote(raw: unknown): raw is DepthNote {
  if (!raw || typeof raw !== 'object') return false;
  const n = raw as DepthNote;
  return typeof n.id === 'string' && !!n.id.trim() && typeof n.text === 'string' && !!n.text.trim() && n.text.length <= NOTE_MAX_LENGTH && Number.isFinite(n.top) && (n.base === undefined || (Number.isFinite(n.base) && n.base >= n.top));
}
export function sanitizeNotes(raw: unknown, where: string, warn: (m: string) => void): DepthNote[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) { warn(`${where}: notas inválidas.`); return undefined; }
  const ids = new Set<string>();
  return raw.filter(n => { if (!validNote(n) || ids.has(n.id)) { warn(`${where}: nota inválida o repetida.`); return false; } ids.add(n.id); return true; }).map(n => ({ id: n.id, text: n.text, top: n.top, ...(n.base !== undefined ? { base: n.base } : {}) }));
}
