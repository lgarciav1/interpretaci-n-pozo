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
  /**
   * Dónde viven los paneles (Resumen, Resultados, gráficos de los módulos; docs/decisiones/0068): `side` (de fábrica) en
   * el panel derecho, junto al paso del flujo, con el perfil a toda la altura; `bottom`, en el dock debajo del visor.
   */
  panels: PanelPlacement;
}

export type PanelPlacement = 'side' | 'bottom';

export const LAYOUT_LIMITS = {
  left: { min: 220, max: 480 },
  right: { min: 300, max: 760 },
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
  panels: 'side',
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
      panels: raw.panels === 'bottom' ? 'bottom' : 'side',
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Pestaña de fábrica de los paneles: el resumen de un vistazo (`src/app/glance/`). */
export const GLANCE_PANEL_ID = 'glance';

export type SideView = 'step' | 'panels';

/**
 * Efecto de navegar (puro): elegir una pestaña de panel la muestra (despliega el dock o el panel lateral y, al costado,
 * pasa a la vista de paneles); abrir un paso o un módulo del flujo pasa el panel lateral a la vista del paso. Así cada
 * `set({ dockTab })` de los módulos (abrir Corona, Crossplot, Tendencias…) funciona con las dos disposiciones.
 */
export function navigationPatch(s: Pick<UiStore, 'layout' | 'sideView' | 'panelExpanded'>, patch: Partial<Pick<UiStore, 'dockTab' | 'activeStepId' | 'activeModuleId' | 'sideView'>>): Partial<UiStore> {
  if (patch.sideView !== undefined) return {};
  if (patch.dockTab !== undefined) {
    const side = s.layout.panels === 'side';
    const reveal = side ? s.layout.rightCollapsed : s.layout.dockCollapsed;
    return {
      readingMode: false,
      ...(side && s.sideView !== 'panels' ? { sideView: 'panels' as const } : {}),
      ...(reveal ? { layout: { ...s.layout, ...(side ? { rightCollapsed: false } : { dockCollapsed: false }) } } : {}),
    };
  }
  if ((patch.activeStepId != null || patch.activeModuleId != null) && s.sideView !== 'step') return { sideView: 'step', ...(s.panelExpanded ? { panelExpanded: false } : {}) };
  return {};
}

/**
 * true si la pestaña `id` está a la vista (los paneles pesados se montan solo entonces: un gráfico oculto no recalcula
 * ni redibuja). Con los paneles al costado: panel derecho abierto, en la vista de paneles y con esa pestaña; abajo:
 * dock desplegado y esa pestaña. Nunca durante la lectura amplia.
 */
export function panelVisible(s: Pick<UiStore, 'layout' | 'sideView' | 'dockTab' | 'readingMode'>, id: string): boolean {
  if (s.readingMode || s.dockTab !== id) return false;
  return s.layout.panels === 'side' ? !s.layout.rightCollapsed && s.sideView === 'panels' : !s.layout.dockCollapsed;
}

/** true si el grupo de paneles (dock o panel lateral en su vista de paneles) está desplegado, sea cual sea la pestaña. */
export function panelsOpen(s: Pick<UiStore, 'layout' | 'sideView' | 'readingMode'>): boolean {
  if (s.readingMode) return false;
  return s.layout.panels === 'side' ? !s.layout.rightCollapsed && s.sideView === 'panels' : !s.layout.dockCollapsed;
}

export interface UiStore {
  workspace: WorkspaceId;
  activeModuleId: string | null;
  /** Paso del flujo guiado abierto en el inspector (null = el sugerido). */
  activeStepId: string | null;
  /** Zona cuyos parámetros se están editando (null = valores globales). */
  editingZoneId: string | null;
  /** Pestaña activa del dock (o del grupo de paneles del panel lateral). */
  dockTab: string;
  /**
   * Con los paneles al costado (`layout.panels === 'side'`): qué muestra el panel derecho, el paso del flujo
   * (`step`, el inspector) o la pestaña `dockTab`. Abrir un paso pasa a `step`; elegir una pestaña, a `panels`.
   */
  sideView: SideView;
  /** Panel del dock agrandado en un diálogo sobre el área de trabajo (⤢). No se guarda. */
  panelExpanded: boolean;
  /** Modo «marcar zona» del visor: arrastrar sobre el perfil crea una zona. */
  zoneMarking: boolean;
  /** Modo «Armar pistas»: catálogo al costado del visor y encabezados editables (docs/decisiones/0016). */
  trackBuilder: boolean;
  /**
   * Pantalla de la sarta (docs/decisiones/0033): lista en la columna izquierda y vista 3D en lugar del visor. Se
   * excluye con `trackBuilder` (las dos usan la columna izquierda).
   */
  toolStringOpen: boolean;
  /** Asistente de carga abierto (con `tp` arranca leyendo los datos del TP). */
  loadDialog: null | { source?: 'tp' };
  snapshotsOpen: boolean;
  /**
   * Cortina antes/después en el visor (docs/decisiones/0026): snapshot que se dibuja del lado «antes». Estado de
   * interfaz: no entra en el proyecto, en deshacer/rehacer ni en el archivo.
   */
  curtain: null | { snapshotId: string };
  /** Diálogo «Exportar» abierto. */
  exportOpen: boolean;
  qcReportOpen: boolean;
  /** Pantalla «Ecuaciones» abierta, con el módulo elegido al abrir (null = el primero). Ver app/ecuaciones/open.ts. */
  equations: null | { moduleId: string | null };
  /** Vista amplia temporal: no modifica ni persiste la disposición elegida por el usuario. */
  readingMode: boolean;
  layout: ShellLayout;
  set(patch: Partial<Omit<UiStore, 'set' | 'setLayout' | 'toggleReadingMode' | 'layout' | 'openPanel' | 'placePanels'>>): void;
  /** Muestra la pestaña `id` (despliega su contenedor y sale de la lectura amplia). */
  openPanel(id: string): void;
  /** Mueve los paneles al costado o abajo (se recuerda) y los deja a la vista. */
  placePanels(where: PanelPlacement): void;
  setLayout(patch: Partial<ShellLayout>): void;
  toggleReadingMode(): void;
}

export const useUi = create<UiStore>()((set) => ({
  workspace: 'petrophysics',
  activeModuleId: null,
  activeStepId: null,
  editingZoneId: null,
  dockTab: GLANCE_PANEL_ID,
  sideView: 'step',
  panelExpanded: false,
  zoneMarking: false,
  trackBuilder: false,
  toolStringOpen: false,
  loadDialog: null,
  snapshotsOpen: false,
  curtain: null,
  exportOpen: false,
  qcReportOpen: false,
  equations: null,
  readingMode: false,
  layout: loadLayout(),
  set: (patch) => set((s) => ({
    ...patch,
    // Abrir un editor o un paso debe recuperar sus paneles antes de trabajar.
    ...((patch.trackBuilder ?? s.trackBuilder) || (patch.toolStringOpen ?? s.toolStringOpen)
      || patch.activeStepId != null || patch.activeModuleId != null || patch.editingZoneId != null
      ? { readingMode: false } : {}),
    ...navigationPatch(s, patch),
  })),
  // Una acción explícita de panel/tamaño sale de lectura y aplica el cambio a la disposición original.
  setLayout: (patch) => set((s) => ({ readingMode: false, layout: { ...s.layout, ...patch } })),
  toggleReadingMode: () => set((s) => s.trackBuilder || s.toolStringOpen ? s : { readingMode: !s.readingMode, panelExpanded: false }),
  openPanel: (id) => set((s) => {
    const side = s.layout.panels === 'side';
    return { dockTab: id, readingMode: false, ...(side ? { sideView: 'panels' as const } : {}), layout: { ...s.layout, ...(side ? { rightCollapsed: false } : { dockCollapsed: false }) } };
  }),
  placePanels: (where) => set((s) => ({
    readingMode: false,
    panelExpanded: false,
    sideView: where === 'side' ? 'panels' : 'step',
    layout: { ...s.layout, panels: where, ...(where === 'side' ? { rightCollapsed: false } : { dockCollapsed: false }) },
  })),
}));

// Cambiar de disposición, plegar el contenedor o salir de la vista de paneles cierra el panel agrandado.
useUi.subscribe((s, prev) => {
  if (!s.panelExpanded) return;
  if (s.layout.panels !== prev.layout.panels || !panelsOpen(s)) useUi.setState({ panelExpanded: false });
});

// «Armar pistas» y la sarta usan la columna izquierda: abrir uno cierra el otro.
useUi.subscribe((s, prev) => {
  if (s.toolStringOpen && !prev.toolStringOpen && s.trackBuilder) useUi.setState({ trackBuilder: false });
  else if (s.trackBuilder && !prev.trackBuilder && s.toolStringOpen) useUi.setState({ toolStringOpen: false });
});

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

