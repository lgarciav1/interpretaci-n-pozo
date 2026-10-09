/** Espacios de trabajo y categorías de módulos (ids en inglés, etiquetas en español). */

export const WORKSPACES = [
  { id: 'petrophysics', label: 'Petrofísica' },
  { id: 'geology', label: 'Geología' },
] as const;

export type WorkspaceId = (typeof WORKSPACES)[number]['id'];

/**
 * Categorías conocidas: fijan el orden y la etiqueta de las habituales (siguen el flujo de interpretación).
 * Un módulo puede usar una categoría nueva sin tocar este archivo: `category: 'mi-categoria'` y
 * `categoryLabel: 'Mi categoría'`. Las nuevas se muestran después de las conocidas.
 */
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

export type KnownCategoryId = (typeof CATEGORIES)[number]['id'];
/** Id de categoría: una conocida o una nueva declarada por un módulo (kebab-case). */
export type CategoryId = KnownCategoryId | (string & {});

export function isWorkspaceId(id: string): id is WorkspaceId {
  return WORKSPACES.some((w) => w.id === id);
}

export function isKnownCategoryId(id: string): id is KnownCategoryId {
  return CATEGORIES.some((c) => c.id === id);
}
