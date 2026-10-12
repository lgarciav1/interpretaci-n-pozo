/**
 * Estado de interfaz de «Zonas sugeridas» (no se guarda en el proyecto): qué propuestas se muestran sobre el visor,
 * cuáles descartó el usuario, las profundidades editadas antes de aceptar y la seleccionada. Pub/sub sin React ni
 * stores de la app (como `invasion-step/pin.ts`): lo escribe el panel y lo leen el panel y la superposición del
 * visor. Las líneas solo se ven mientras el panel está abierto (el panel publica al montarse y limpia al salir).
 */

export interface ShownLine {
  key: string;
  depth: number;
  rank: number;
  strengthRel: number;
  /** Texto corto del salto (tooltip). */
  label: string;
  /** Hay un tope o base existente a ≤ 2 m. */
  near: boolean;
}

export interface SuggestionUiState {
  wellId: string | null;
  /** Líneas a dibujar (vacío = nada sobre el visor). */
  lines: readonly ShownLine[];
  selectedKey: string | null;
  dismissed: ReadonlySet<string>;
  edits: ReadonlyMap<string, number>;
}

let state: SuggestionUiState = { wellId: null, lines: [], selectedKey: null, dismissed: new Set(), edits: new Map() };
const listeners = new Set<() => void>();

export const getSuggestionUi = (): SuggestionUiState => state;

export function subscribeSuggestionUi(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function set(patch: Partial<SuggestionUiState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

/** Cambiar de pozo olvida descartes, ediciones y selección. */
export function switchWell(wellId: string | null): void {
  if (wellId !== state.wellId) set({ wellId, lines: [], selectedKey: null, dismissed: new Set(), edits: new Map() });
}

export function publishLines(wellId: string, lines: readonly ShownLine[]): void {
  if (wellId !== state.wellId) switchWell(wellId);
  const same = lines.length === state.lines.length && lines.every((l, i) => {
    const o = state.lines[i]!;
    return o.key === l.key && o.depth === l.depth && o.near === l.near && o.label === l.label;
  });
  if (!same) set({ lines });
}

export const clearLines = (): void => {
  if (state.lines.length) set({ lines: [] });
};

export const selectSuggestion = (key: string | null): void => {
  if (key !== state.selectedKey) set({ selectedKey: key });
};

export function dismissSuggestions(keys: readonly string[]): void {
  const dismissed = new Set(state.dismissed);
  for (const k of keys) dismissed.add(k);
  set({ dismissed, selectedKey: keys.includes(state.selectedKey ?? '') ? null : state.selectedKey });
}

export const restoreDismissed = (): void => set({ dismissed: new Set() });

/** Edita (o con null, vuelve a la propuesta) la profundidad de una propuesta antes de aceptarla. */
export function editSuggestion(key: string, depth: number | null): void {
  const edits = new Map(state.edits);
  if (depth === null || !Number.isFinite(depth)) edits.delete(key);
  else edits.set(key, depth);
  set({ edits });
}

/** Solo para tests. */
export function resetSuggestionUi(): void {
  state = { wellId: null, lines: [], selectedKey: null, dismissed: new Set(), edits: new Map() };
  for (const l of listeners) l();
}
