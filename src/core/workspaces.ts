/** Espacios de trabajo y categorías de módulos (ids en inglés, etiquetas en español). */

export const WORKSPACES = [
  { id: 'petrophysics', label: 'Petrofísica' },
  { id: 'geology', label: 'Geología' },
] as const;

export type WorkspaceId = (typeof WORKSPACES)[number]['id'];

/** Orden de las categorías = orden en que se muestran (sigue el flujo de interpretación). */
export const CATEGORIES = [
  { id: 'qc', label: 'Control de calidad' },
  { id: 'lithology', label: 'Litología' },
  { id: 'shale', label: 'Arcillosidad' },
  { id: 'porosity', label: 'Porosidad' },
  { id: 'saturation', label: 'Saturación' },
  { id: 'permeability', label: 'Permeabilidad' },
  { id: 'cutoffs', label: 'Cutoffs' },
  { id: 'summary', label: 'Sumario' },
  { id: 'geology', label: 'Geología' },
  { id: 'other', label: 'Otros' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export function isWorkspaceId(id: string): id is WorkspaceId {
  return WORKSPACES.some((w) => w.id === id);
}

export function isCategoryId(id: string): id is CategoryId {
  return CATEGORIES.some((c) => c.id === id);
}
