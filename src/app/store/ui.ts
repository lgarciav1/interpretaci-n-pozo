/**
 * Estado de interfaz: no se guarda en el proyecto.
 * Las medidas del armazón (laterales, dock) se recuerdan en localStorage: son comodidad de cada usuario.
 */
import { create } from 'zustand';
import type { WorkspaceId } from '../../core/workspaces';
import { BASE_TOKENS } from '../../ui/tokens';

export interface ShellLayout {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  dockHeight: number;
  dockCollapsed: boolean;
}

export const LAYOUT_LIMITS = {
  left: { min: 220, max: 480 },
  right: { min: 300, max: 560 },
  dock: { min: 120, max: 640 },
} as const;

const LAYOUT_KEY = 'pozo.ui.layout';

const DEFAULT_LAYOUT: ShellLayout = {
  leftWidth: BASE_TOKENS.size.sidebarLeft,
  rightWidth: BASE_TOKENS.size.sidebarRight,
  leftCollapsed: false,
  rightCollapsed: false,
  dockHeight: BASE_TOKENS.size.dock,
  dockCollapsed: false,
};

function loadLayout(): ShellLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Partial<ShellLayout> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_LAYOUT;
    const num = (v: unknown, d: number, lim: { min: number; max: number }) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(lim.max, Math.max(lim.min, v)) : d);
    return {
      leftWidth: num(raw.leftWidth, DEFAULT_LAYOUT.leftWidth, LAYOUT_LIMITS.left),
      rightWidth: num(raw.rightWidth, DEFAULT_LAYOUT.rightWidth, LAYOUT_LIMITS.right),
      dockHeight: num(raw.dockHeight, DEFAULT_LAYOUT.dockHeight, LAYOUT_LIMITS.dock),
      leftCollapsed: raw.leftCollapsed === true,
      rightCollapsed: raw.rightCollapsed === true,
      dockCollapsed: raw.dockCollapsed === true,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export interface UiStore {
  workspace: WorkspaceId;
  activeModuleId: string | null;
  /** Paso del flujo guiado abierto en el inspector (null = el sugerido). */
  activeStepId: string | null;
  /** Zona cuyos parámetros se están editando (null = valores globales). */
  editingZoneId: string | null;
  /** Pestaña activa del dock. */
  dockTab: string;
  /** Asistente de carga abierto (con `tp` arranca leyendo los datos del TP). */
  loadDialog: null | { source?: 'tp' };
  snapshotsOpen: boolean;
  qcReportOpen: boolean;
  layout: ShellLayout;
  set(patch: Partial<Omit<UiStore, 'set' | 'setLayout' | 'layout'>>): void;
  setLayout(patch: Partial<ShellLayout>): void;
}

export const useUi = create<UiStore>()((set) => ({
  workspace: 'petrophysics',
  activeModuleId: null,
  activeStepId: null,
  editingZoneId: null,
  dockTab: 'results',
  loadDialog: null,
  snapshotsOpen: false,
  qcReportOpen: false,
  layout: loadLayout(),
  set: (patch) => set(patch),
  setLayout: (patch) => set((s) => ({ layout: { ...s.layout, ...patch } })),
}));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useUi.subscribe((s, prev) => {
  if (s.layout === prev.layout) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(useUi.getState().layout));
    } catch {
      // sin almacenamiento: las medidas duran la sesión
    }
  }, 200);
});
