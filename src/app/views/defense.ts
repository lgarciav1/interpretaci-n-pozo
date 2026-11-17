/**
 * Partes puras del modo defensa (docs/decisiones/0075, punto 6): foto de la interfaz al entrar y su restauración al
 * salir, qué cambia en la interfaz para mostrar una vista y el paso de una vista a otra (sin vuelta circular).
 * Sin React ni stores: las usa `actions.ts` y se prueban en `tests/views.test.ts`.
 */
import type { UiStore } from '../store/ui';

/** Lo que el modo defensa cambia de la interfaz y devuelve tal cual al salir. */
export type UiPhotoFields = Pick<UiStore, 'workspace' | 'editingZoneId' | 'activeStepId' | 'activeModuleId' | 'dockTab' | 'sideView' | 'layout' | 'readingMode' | 'panelExpanded'>;

export interface UiPhoto extends UiPhotoFields {
  /** Tramo visible del visor al entrar (null si todavía no se había dibujado). */
  visible: { top: number; base: number } | null;
  /** Pozo activo al entrar: el tramo solo se restaura si es el mismo. */
  wellId: string | null;
}

/** Foto de la interfaz (copia superficial: `layout` es inmutable en el store). */
export function takePhoto(ui: UiPhotoFields, visible: { top: number; base: number } | null, wellId: string | null): UiPhoto {
  return {
    workspace: ui.workspace,
    editingZoneId: ui.editingZoneId,
    activeStepId: ui.activeStepId,
    activeModuleId: ui.activeModuleId,
    dockTab: ui.dockTab,
    sideView: ui.sideView,
    layout: ui.layout,
    readingMode: ui.readingMode,
    panelExpanded: ui.panelExpanded,
    visible: visible ? { top: visible.top, base: visible.base } : null,
    wellId,
  };
}

/** Parche que devuelve la interfaz a la foto (todo lo que el modo cambió). */
export function restorePatch(photo: UiPhoto): UiPhotoFields {
  return {
    workspace: photo.workspace,
    editingZoneId: photo.editingZoneId,
    activeStepId: photo.activeStepId,
    activeModuleId: photo.activeModuleId,
    dockTab: photo.dockTab,
    sideView: photo.sideView,
    layout: photo.layout,
    readingMode: photo.readingMode,
    panelExpanded: photo.panelExpanded,
  };
}

/** Lo que una vista pide a la interfaz (ya resuelta contra el proyecto). */
export interface DefenseTarget {
  workspace: UiStore['workspace'];
  zoneId: string | null;
  /** Panel a mostrar, o null para el visor solo. */
  panel: string | null;
}

/**
 * Parche de interfaz para mostrar una vista en el modo defensa. Parte de la disposición de la foto (no de la que dejó
 * la vista anterior): sin columna del pozo; el panel de la vista, si tiene, donde la usuaria tiene los paneles (costado
 * o abajo); si no, el visor solo.
 */
export function defensePatch(photo: UiPhoto, target: DefenseTarget): Partial<UiStore> {
  const side = photo.layout.panels === 'side';
  const panel = target.panel;
  return {
    workspace: target.workspace,
    editingZoneId: target.zoneId,
    ...(target.workspace !== photo.workspace ? { activeStepId: null, activeModuleId: null } : {}),
    readingMode: false,
    panelExpanded: false,
    ...(panel ? { dockTab: panel, ...(side ? { sideView: 'panels' as const } : {}) } : {}),
    layout: { ...photo.layout, leftCollapsed: true, ...(side ? { rightCollapsed: !panel } : { dockCollapsed: !panel }) },
  };
}

/** Índice siguiente del recorrido: en la última vista no avanza (sin vuelta circular). */
export const nextIndex = (i: number, count: number): number => (count <= 0 ? 0 : Math.min(count - 1, Math.max(0, i + 1)));

/** Índice anterior del recorrido: en la primera vista no retrocede. */
export const prevIndex = (i: number, count: number): number => (count <= 0 ? 0 : Math.max(0, Math.min(count - 1, i - 1)));

/**
 * ¿El tramo visible ya es el pedido? Tolera el redondeo a píxeles del visor (medio por ciento del tramo, al menos
 * 5 cm). Si el pedido cae fuera del pozo, el visor lo acota: con `limits`, se compara contra el tramo acotado.
 */
export function rangeMatches(visible: { top: number; base: number } | null, want: { top: number; base: number }, limits?: { min: number; max: number } | null): boolean {
  if (!visible) return false;
  const top = limits ? Math.max(limits.min, want.top) : want.top;
  const base = limits ? Math.min(limits.max, want.base) : want.base;
  if (!(base > top)) return true;
  const tol = Math.max(0.05, (base - top) * 0.005);
  return Math.abs(visible.top - top) <= tol && Math.abs(visible.base - base) <= tol;
}
