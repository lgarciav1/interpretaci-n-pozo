/**
 * Estado de interfaz: no se guarda en el proyecto.
 * Las medidas del armazón (laterales, dock) se recuerdan en localStorage: son comodidad de cada usuario.
 */
import { create } from 'zustand';
import type { WorkspaceId } from '../../core/workspaces';
import { BASE_TOKENS } from '../../ui/tokens';

/**
 * Medidas del armazón en px del nivel Compacto: se muestran × el factor del tamaño de interfaz
 * (docs/decisiones/0013-tamano-de-interfaz.md).
 */
export interface ShellLayout {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  dockHeight: number;
  /**
   * Medida automática (hasta que el usuario arrastra ese separador): la guardada × factor, pero sin pasar de una
   * fracción de la ventana (`AUTO_CAP`). Así, con letra Normal o Grande en una notebook, los laterales y el dock no
   * se comen el perfil. Al arrastrar, pasa a ser exactamente la elegida.
   */
  leftAuto: boolean;
  rightAuto: boolean;
  dockAuto: boolean;
  dockCollapsed: boolean;
  /** Franja de encabezado de pozo en el visor. */
  wellHeader: boolean;
}

export const LAYOUT_LIMITS = {
  left: { min: 220, max: 480 },
  right: { min: 300, max: 560 },
  dock: { min: 120, max: 640 },
} as const;

/** Tope de las medidas automáticas, en % del ancho (laterales) o del alto (dock) de la ventana. */
export const AUTO_CAP = { left: 24, right: 26, dock: 28 } as const;

export type ShellPart = keyof typeof AUTO_CAP;

const PART_KEYS = {
  left: { size: 'leftWidth', auto: 'leftAuto' },
  right: { size: 'rightWidth', auto: 'rightAuto' },
  dock: { size: 'dockHeight', auto: 'dockAuto' },
} as const;

/** Puro: medida en px de pantalla de una parte del armazón para un factor de interfaz y una ventana. */
export function shellSize(part: ShellPart, layout: ShellLayout, factor: number, viewport: { width: number; height: number }): number {
  const k = PART_KEYS[part];
  const px = layout[k.size] * factor;
  if (!layout[k.auto]) return px;
  const cap = ((part === 'dock' ? viewport.height : viewport.width) * AUTO_CAP[part]) / 100;
  return Math.min(px, cap);
}

/** La misma medida como valor CSS (sigue a `--ui-scale` y a la ventana sin JavaScript). */
export function shellSizeCss(part: ShellPart, layout: ShellLayout): string {
  const k = PART_KEYS[part];
  const px = `calc(${layout[k.size]}px * var(--ui-scale, 1))`;
  return layout[k.auto] ? `min(${px}, ${AUTO_CAP[part]}${part === 'dock' ? 'vh' : 'vw'})` : px;
}

const LAYOUT_KEY = 'pozo.ui.layout';

const DEFAULT_LAYOUT: ShellLayout = {
  leftWidth: BASE_TOKENS.size.sidebarLeft,
  rightWidth: BASE_TOKENS.size.sidebarRight,
  leftCollapsed: false,
  rightCollapsed: false,
  dockHeight: BASE_TOKENS.size.dock,
  leftAuto: true,
  rightAuto: true,
  dockAuto: true,
  dockCollapsed: false,
  wellHeader: true,
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
      // Medidas guardadas antes de existir estos campos: automática si es la de fábrica.
      leftAuto: typeof raw.leftAuto === 'boolean' ? raw.leftAuto : raw.leftWidth === undefined || raw.leftWidth === DEFAULT_LAYOUT.leftWidth,
      rightAuto: typeof raw.rightAuto === 'boolean' ? raw.rightAuto : raw.rightWidth === undefined || raw.rightWidth === DEFAULT_LAYOUT.rightWidth,
      dockAuto: typeof raw.dockAuto === 'boolean' ? raw.dockAuto : raw.dockHeight === undefined || raw.dockHeight === DEFAULT_LAYOUT.dockHeight,
      leftCollapsed: raw.leftCollapsed === true,
      rightCollapsed: raw.rightCollapsed === true,
      dockCollapsed: raw.dockCollapsed === true,
      wellHeader: raw.wellHeader !== false,
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
  /** Modo «marcar zona» del visor: arrastrar sobre el perfil crea una zona. */
  zoneMarking: boolean;
  /** Asistente de carga abierto (con `tp` arranca leyendo los datos del TP). */
  loadDialog: null | { source?: 'tp' };
  snapshotsOpen: boolean;
  /** Diálogo «Exportar» abierto. */
  exportOpen: boolean;
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
  zoneMarking: false,
  loadDialog: null,
  snapshotsOpen: false,
  exportOpen: false,
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
