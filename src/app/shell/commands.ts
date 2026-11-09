/**
 * Acciones del armazón para la paleta de comandos (Ctrl/Cmd+K, docs/decisiones/0018): ir a cada paso del flujo, abrir
 * cada pestaña del dock, deshacer y rehacer, guardar, exportar, snapshots, cargar pozo y demo, tema, tamaño de
 * interfaz, espacio de trabajo, zonas y paneles. Se descubre solo (`src/app/<carpeta>/commands.ts`): una fuente es una
 * función, así los títulos y el estado se leen al abrir la paleta. También documenta los atajos que manejan otros
 * archivos (visor, deshacer) para la hoja «?».
 */
import { activeWellEntry, setActiveWell } from '../../core/state/project';
import { createSnapshot } from '../../core/state/snapshots';
import { WORKSPACES } from '../../core/workspaces';
import { getThemePreference, setThemePreference, UI_SCALES, getUiScale, setUiScale, toast, type Command, type CommandSource } from '../../ui';
import { DEMO_WELL_ID, loadDemoWell } from '../demo/loadDemo';
import { STEP_STATUS_LABEL } from '../flow/flow';
import { currentFlow, openStep } from '../flow/useFlow';
import { useTrendsUi } from '../trends/store';
import { useProject } from '../store/project';
import { panelVisible, useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { DOCK_PANELS } from './dockPanels';
import { IS_MAC, REDO_SHORTCUT, redoChange, undoChange } from './historyActions';
import { pickProjectFile, saveProject } from './projectActions';

const hasWell = () => !!activeWellEntry(useProject.getState().project);

function flowCommands(): Command[] {
  const { states, active } = currentFlow();
  return states.map((s) => ({
    id: `step:${s.def.id}`,
    title: `Ir al paso ${s.def.title}`,
    group: 'Flujo',
    keywords: [s.def.label, s.def.id, 'paso', 'flujo', ...(s.def.categories ?? []), ...(s.def.targets ?? [])],
    icon: 'arrow-right',
    detail: s.def.id === active.def.id ? 'abierto' : STEP_STATUS_LABEL[s.status].toLowerCase(),
    run: () => openStep(s),
  }));
}

function dockCommands(): Command[] {
  const open = (id: string) => useUi.getState().openPanel(id);
  const ui = useUi.getState();
  const { layout } = ui;
  const side = layout.panels === 'side';
  return [
    ...DOCK_PANELS.map(
      (p): Command => ({
        id: `dock:${p.id}`,
        title: `Abrir la pestaña ${p.title}`,
        group: 'Paneles',
        keywords: ['pestana', 'panel', 'dock', p.id],
        icon: p.icon,
        ...(panelVisible(ui, p.id) ? { detail: 'abierta' } : {}),
        run: () => open(p.id),
      }),
    ),
    {
      id: 'layout:reading',
      title: useUi.getState().readingMode ? 'Volver a la disposición anterior' : 'Activar lectura amplia del perfil',
      group: 'Vista',
      keywords: ['lectura', 'amplia', 'ampliar', 'perfil', 'paneles', 'espacio'],
      icon: 'expand-view',
      enabled: () => hasWell() && !useUi.getState().trackBuilder && !useUi.getState().toolStringOpen && !useViewer.getState().dragging,
      run: () => useUi.getState().toggleReadingMode(),
    },
    {
      id: 'layout:placement',
      title: side ? 'Mover los paneles abajo del perfil' : 'Mover los paneles al costado del perfil',
      group: 'Paneles',
      keywords: ['dock', 'pestanas', 'disposicion', 'lateral', 'abajo', 'costado', 'graficos'],
      icon: side ? 'panel-bottom' : 'panel-right',
      run: () => useUi.getState().placePanels(side ? 'bottom' : 'side'),
    },
    ...(side
      ? []
      : [
          {
            id: 'layout:dock',
            title: layout.dockCollapsed ? 'Mostrar los paneles de abajo' : 'Ocultar los paneles de abajo',
            group: 'Paneles',
            keywords: ['dock', 'pestanas'],
            icon: 'panel-bottom' as const,
            run: () => useUi.getState().setLayout({ dockCollapsed: !useUi.getState().layout.dockCollapsed }),
          },
        ]),
    {
      id: 'layout:left',
      title: layout.leftCollapsed ? 'Mostrar la columna del pozo' : 'Ocultar la columna del pozo',
      group: 'Paneles',
      keywords: ['izquierda', 'curvas', 'lateral'],
      icon: 'panel-left',
      run: () => useUi.getState().setLayout({ leftCollapsed: !useUi.getState().layout.leftCollapsed }),
    },
    {
      id: 'layout:right',
      title: side ? (layout.rightCollapsed ? 'Mostrar el panel lateral' : 'Plegar el panel lateral') : layout.rightCollapsed ? 'Mostrar el panel del paso' : 'Ocultar el panel del paso',
      group: 'Paneles',
      keywords: ['derecha', 'inspector', 'lateral', 'parametros'],
      icon: 'panel-right',
      run: () => useUi.getState().setLayout({ rightCollapsed: !useUi.getState().layout.rightCollapsed }),
    },
    {
      id: 'layout:header',
      title: layout.wellHeader ? 'Ocultar el encabezado del pozo' : 'Mostrar el encabezado del pozo',
      group: 'Paneles',
      keywords: ['cabecera', 'visor'],
      icon: 'well',
      run: () => useUi.getState().setLayout({ wellHeader: !useUi.getState().layout.wellHeader }),
    },
    {
      id: 'layout:compact-heads',
      title: layout.compactHeads ? 'Mostrar escalas en los encabezados de pista' : 'Encabezados de pista compactos',
      group: 'Paneles',
      keywords: ['cabecera', 'visor', 'escala', 'alto', 'leyenda'],
      icon: 'tracks',
      run: () => useUi.getState().setLayout({ compactHeads: !useUi.getState().layout.compactHeads }),
    },
  ];
}

function historyCommands(): Command[] {
  const s = useProject.getState();
  return [
    {
      id: 'edit:undo',
      title: 'Deshacer',
      group: 'Edición',
      keywords: ['atras', 'revertir', 'ctrl z'],
      icon: 'undo',
      shortcut: { key: 'z', mod: true },
      bind: false,
      ...(s.undoLabel ? { detail: s.undoLabel } : {}),
      enabled: () => !!useProject.getState().undoLabel,
      run: undoChange,
    },
    {
      id: 'edit:redo',
      title: 'Rehacer',
      group: 'Edición',
      keywords: ['adelante', 'repetir', 'ctrl y'],
      icon: 'redo',
      keys: IS_MAC ? REDO_SHORTCUT : `${REDO_SHORTCUT} o Ctrl+Y`,
      bind: false,
      ...(s.redoLabel ? { detail: s.redoLabel } : {}),
      enabled: () => !!useProject.getState().redoLabel,
      run: redoChange,
    },
  ];
}

function projectCommands(): Command[] {
  const s = useProject.getState();
  const wells = s.project.wells;
  const demoLoaded = wells.some((w) => w.well.id === DEMO_WELL_ID);
  return [
    { id: 'project:save', title: 'Guardar el proyecto', group: 'Proyecto', keywords: ['descargar', 'archivo', 'pozo.json'], icon: 'download', shortcut: { key: 's', mod: true }, run: () => void saveProject() },
    { id: 'project:open', title: 'Abrir un proyecto guardado…', group: 'Proyecto', keywords: ['cargar', 'archivo'], icon: 'folder', shortcut: { key: 'o', mod: true }, run: pickProjectFile },
    { id: 'project:export', title: 'Exportar datos y figuras…', group: 'Proyecto', keywords: ['las', 'csv', 'excel', 'xlsx', 'figura', 'imagen', 'descargar'], icon: 'download', shortcut: { key: 'e', mod: true }, enabled: hasWell, run: () => useUi.getState().set({ exportOpen: true }) },
    { id: 'project:snapshots', title: 'Abrir los snapshots', group: 'Proyecto', keywords: ['versiones', 'restaurar', 'comparar'], icon: 'bookmark', enabled: hasWell, run: () => useUi.getState().set({ snapshotsOpen: true }) },
    {
      id: 'project:snapshot-now',
      title: 'Guardar un snapshot ahora',
      group: 'Proyecto',
      keywords: ['version', 'respaldo'],
      icon: 'bookmark',
      enabled: hasWell,
      run: () => {
        const entry = activeWellEntry(useProject.getState().project);
        if (!entry) return;
        useProject.getState().commit('Crear snapshot', (p) => createSnapshot(p, entry.well.id, '').project);
        toast({ title: 'Snapshot guardado', tone: 'ok' });
      },
    },
    { id: 'well:load', title: 'Cargar un pozo…', group: 'Pozo', keywords: ['importar', 'excel', 'las', 'csv', 'xlsx', 'abrir'], icon: 'upload', run: () => useUi.getState().set({ loadDialog: {} }) },
    { id: 'well:tp', title: 'Usar los datos del TP', group: 'Pozo', keywords: ['cargar', 'pozo', 'csv', 'perfiles'], icon: 'table', run: () => useUi.getState().set({ loadDialog: { source: 'tp' } }) },
    {
      id: 'well:demo',
      title: demoLoaded ? 'Ir al pozo de demostración' : 'Cargar el pozo de demostración',
      group: 'Pozo',
      keywords: ['demo', 'ejemplo', 'sintetico', 'prueba'],
      icon: 'well',
      run: loadDemoWell,
    },
    // Otro pozo del proyecto.
    ...wells
      .filter((w) => w.well.id !== s.project.activeWellId)
      .map(
        (w): Command => ({
          id: `well:go:${w.well.id}`,
          title: `Cambiar al pozo ${w.well.name}`,
          group: 'Pozo',
          keywords: ['activar', 'pozo'],
          icon: 'well',
          run: () => {
            useProject.getState().commit('Cambiar de pozo', (p) => setActiveWell(p, w.well.id));
            useUi.getState().set({ activeStepId: null, activeModuleId: null, editingZoneId: null });
          },
        }),
      ),
  ];
}

function viewCommands(): Command[] {
  const theme = getThemePreference();
  const scale = getUiScale();
  const workspace = useUi.getState().workspace;
  const themes = [
    { id: 'system', label: 'del sistema', keywords: ['automatico', 'sistema'] },
    { id: 'light', label: 'claro', keywords: ['dia', 'blanco'] },
    { id: 'dark', label: 'oscuro', keywords: ['noche', 'negro'] },
  ] as const;
  return [
    ...themes.map(
      (t): Command => ({
        id: `theme:${t.id}`,
        title: `Usar el tema ${t.label}`,
        group: 'Vista',
        keywords: ['tema', 'apariencia', 'modo', ...t.keywords],
        icon: t.id === 'dark' ? 'moon' : t.id === 'light' ? 'sun' : 'monitor',
        ...(theme === t.id ? { detail: 'activo' } : {}),
        run: () => setThemePreference(t.id),
      }),
    ),
    ...UI_SCALES.map(
      (s): Command => ({
        id: `scale:${s.id}`,
        title: `Usar el tamaño de interfaz ${s.label.toLowerCase()}`,
        group: 'Vista',
        keywords: ['tamano', 'letra', 'texto', 'zoom', 'interfaz', s.id],
        icon: s.id === 'compact' ? 'text-size-sm' : s.id === 'large' ? 'text-size-lg' : 'text-size-md',
        ...(scale === s.id ? { detail: 'activo' } : {}),
        run: () => setUiScale(s.id),
      }),
    ),
    ...WORKSPACES.map(
      (w): Command => ({
        id: `workspace:${w.id}`,
        title: `Ir al espacio de trabajo ${w.label}`,
        group: 'Vista',
        keywords: ['espacio', 'trabajo', w.id],
        icon: w.id === 'geology' ? 'mountain' : 'sliders',
        ...(workspace === w.id ? { detail: 'activo' } : {}),
        run: () => useUi.getState().set({ workspace: w.id, activeModuleId: null, activeStepId: null }),
      }),
    ),
  ];
}

function zoneCommands(): Command[] {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) return [];
  const marking = useUi.getState().zoneMarking;
  return [
    ...[...entry.interpretation.zones]
      .sort((a, b) => a.top - b.top)
      .map(
        (z): Command => ({
          id: `zone:${z.id}`,
          title: `Ir a la zona ${z.name} en el visor`,
          group: 'Zonas',
          keywords: ['tope', 'base', 'capa', 'mostrar', 'zona'],
          icon: 'layers',
          run: () => useTrendsUi.getState().requestRange(z.top, z.base),
        }),
      ),
    { id: 'zone:mark', title: marking ? 'Dejar de marcar una zona nueva' : 'Marcar una zona nueva en el visor', group: 'Zonas', keywords: ['crear', 'tope', 'arrastrar', 'nueva'], icon: 'zone-add', run: () => useUi.getState().set({ zoneMarking: !useUi.getState().zoneMarking }) },
  ];
}

/** Atajos que manejan otros archivos (el visor, «Armar pistas»): solo documentación para la hoja «?». */
const documented = (): Command[] => [
  { id: 'doc:viewer-cursor', title: 'Mover el cursor del visor', group: 'Visor', keys: '↑ ↓' },
  { id: 'doc:viewer-page', title: 'Desplazar una pantalla', group: 'Visor', keys: 'Re Pág · Av Pág' },
  { id: 'doc:viewer-ends', title: 'Ir al tope o a la base del pozo', group: 'Visor', keys: 'Inicio · Fin' },
  { id: 'doc:viewer-zoom', title: 'Acercar o alejar', group: 'Visor', keys: '+ · −' },
  { id: 'doc:viewer-fit', title: 'Ver todo el pozo', group: 'Visor', keys: '0' },
  { id: 'doc:viewer-esc', title: 'Quitar el cursor o cancelar el arrastre', group: 'Visor', keys: 'Esc' },
  { id: 'doc:handle-nudge', title: 'Mover el elemento activo (tope, plug, punto de presión)', group: 'Visor', keys: '↑ ↓  ·  Mayús ×10' },
  { id: 'doc:tracks-move', title: 'Mover una pista o una curva al armar pistas', group: 'Armar pistas', keys: 'Alt+← → ↑ ↓' },
  { id: 'doc:tracks-width', title: 'Cambiar el ancho de una pista', group: 'Armar pistas', keys: 'Alt+Mayús+← →' },
  { id: 'doc:tracks-remove', title: 'Quitar una pista o una curva', group: 'Armar pistas', keys: 'Supr' },
  { id: 'doc:number-step', title: 'Cambiar un valor numérico (Mayús ×10)', group: 'Campos', keys: '↑ ↓' },
  { id: 'doc:number-esc', title: 'Confirmar o descartar el valor escrito', group: 'Campos', keys: 'Intro · Esc' },
];

export const commands: CommandSource = () => [...flowCommands(), ...dockCommands(), ...historyCommands(), ...projectCommands(), ...zoneCommands(), ...viewCommands(), ...documented()];

