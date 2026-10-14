/**
 * Armazón de la app (docs/decisiones/0004-sistema-de-diseno.md, D6):
 * barra superior · flujo guiado · [pozo/curvas/zonas | visor + dock | inspector del paso].
 * Laterales redimensionables y colapsables; el dock se redimensiona en alto.
 *
 * Rendimiento: arrastrar un separador NO re-renderiza el armazón. Las medidas se aplican como variables CSS por
 * suscripción al store (useShellVars) y cada separador lee solo su propio valor. El visor (fase 4) se entera del
 * cambio de tamaño por su ResizeObserver.
 */
import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { CommandLayer, IconButton, ResizeHandle, Toaster, useUiScaleFactor } from '../ui';
import './commands';
import { LoadWellDialog } from './components/LoadWellDialog';
import { WellPanel } from './components/WellPanel';
import { QcReportDialog, SnapshotsDialog } from './shell/Dialogs';
import { Dock } from './shell/Dock';
import { FlowBar } from './shell/FlowBar';
import { EquationsDialog } from './ecuaciones/EquationsDialog';
import { ExportDialog } from './export/ExportDialog';
import { Inspector } from './shell/Inspector';
import { TopBar } from './shell/TopBar';
import { ViewerSlot } from './shell/ViewerSlot';
import { TrackBuilderSlot } from './tracks/TrackBuilder';
import { ToolStringPanel } from './toolString/ToolStringPanel';
import { ToolStringView } from './toolString/ToolStringView';
import { LAYOUT_LIMITS, shellSize, shellSizeCss, useUi, type ShellLayout, type ShellPart } from './store/ui';
import './shell/shell.css';

function useShellVars(ref: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const apply = (l: ShellLayout) => {
      const el = ref.current;
      if (!el) return;
      // Las medidas se guardan en px de Compacto: el CSS las lleva al tamaño de interfaz actual (y a la ventana).
      el.style.setProperty('--shell-left', shellSizeCss('left', l));
      el.style.setProperty('--shell-right', shellSizeCss('right', l));
      el.style.setProperty('--shell-dock', shellSizeCss('dock', l));
    };
    apply(useUi.getState().layout);
    return useUi.subscribe((s, prev) => {
      if (s.layout !== prev.layout) apply(s.layout);
    });
  }, [ref]);
}

const subscribeResize = (fn: () => void) => {
  window.addEventListener('resize', fn);
  return () => window.removeEventListener('resize', fn);
};
/** Ventana como texto estable (useSyncExternalStore compara por identidad). */
const windowKey = () => `${window.innerWidth}x${window.innerHeight}`;

type HandleKind = ShellPart;

const HANDLES: Record<HandleKind, { key: 'leftWidth' | 'rightWidth' | 'dockHeight'; auto: 'leftAuto' | 'rightAuto' | 'dockAuto'; collapse: 'leftCollapsed' | 'rightCollapsed' | 'dockCollapsed'; label: string; invert: boolean }> = {
  left: { key: 'leftWidth', auto: 'leftAuto', collapse: 'leftCollapsed', label: 'Ancho de la columna del pozo', invert: false },
  right: { key: 'rightWidth', auto: 'rightAuto', collapse: 'rightCollapsed', label: 'Ancho del panel del paso', invert: true },
  dock: { key: 'dockHeight', auto: 'dockAuto', collapse: 'dockCollapsed', label: 'Alto de los paneles', invert: true },
};

/**
 * Separador que solo se re-renderiza a sí mismo al arrastrar. El store guarda px de Compacto; el separador trabaja en
 * px de pantalla (× factor del tamaño de interfaz), así cambiar el tamaño agranda los paneles en proporción.
 */
function ShellHandle({ kind }: { kind: HandleKind }) {
  const h = HANDLES[kind];
  const value = useUi((s) => s.layout[h.key]);
  const auto = useUi((s) => s.layout[h.auto]);
  const setLayout = useUi((s) => s.setLayout);
  const f = useUiScaleFactor();
  // Medida automática: el separador parte de lo que se ve (con el tope por ventana).
  const [vw, vh] = useSyncExternalStore(subscribeResize, windowKey, windowKey).split('x').map(Number) as [number, number];
  const shown = shellSize(kind, { ...useUi.getState().layout, [h.key]: value, [h.auto]: auto }, f, { width: vw, height: vh });
  return (
    <ResizeHandle
      orientation={kind === 'dock' ? 'horizontal' : 'vertical'}
      label={h.label}
      value={Math.round(shown)}
      min={Math.round(LAYOUT_LIMITS[kind].min * f)}
      max={Math.round(LAYOUT_LIMITS[kind].max * f)}
      invert={h.invert}
      onChange={(v) => setLayout({ [h.key]: Math.round((v / f) * 10) / 10, [h.auto]: false })}
      onToggle={() => setLayout({ [h.collapse]: true })}
    />
  );
}

function Rail({ side, onExpand }: { side: 'left' | 'right'; onExpand: () => void }) {
  return (
    <div className={`shell-rail shell-rail--${side}`}>
      <IconButton icon={side === 'left' ? 'panel-left' : 'panel-right'} label={side === 'left' ? 'Mostrar datos del pozo' : 'Mostrar el panel del paso'} onClick={onExpand} />
    </div>
  );
}

export function App() {
  const ref = useRef<HTMLDivElement>(null);
  useShellVars(ref);
  const leftCollapsed = useUi((s) => s.layout.leftCollapsed);
  const rightCollapsed = useUi((s) => s.layout.rightCollapsed);
  const dockCollapsed = useUi((s) => s.layout.dockCollapsed);
  const setLayout = useUi((s) => s.setLayout);
  const loadDialog = useUi((s) => s.loadDialog);
  const setUi = useUi((s) => s.set);
  // «Armar pistas»: el catálogo ocupa la columna izquierda (no le quita ancho al perfil). docs/decisiones/0016.
  const building = useUi((s) => s.trackBuilder);
  // Sarta (docs/decisiones/0033): la lista ocupa la columna izquierda y la vista 3D tapa el centro (visor y dock
  // siguen montados debajo, inertes, para no perder la profundidad, el zoom ni la pestaña del dock).
  const toolStringOpen = useUi((s) => s.toolStringOpen);

  return (
    <div className="shell" ref={ref}>
      <TopBar />
      <FlowBar />
      <div className="shell-main">
        {toolStringOpen ? (
          <>
            <aside className="shell-side shell-side--left shell-side--builder" aria-label="Sarta de perfilaje">
              <ToolStringPanel />
            </aside>
            <ShellHandle kind="left" />
          </>
        ) : building ? (
          <>
            <aside className="shell-side shell-side--left shell-side--builder" aria-label="Armar pistas">
              <TrackBuilderSlot />
            </aside>
            <ShellHandle kind="left" />
          </>
        ) : leftCollapsed ? (
          <Rail side="left" onExpand={() => setLayout({ leftCollapsed: false })} />
        ) : (
          <>
            <aside className="shell-side shell-side--left" aria-label="Pozo, curvas y zonas">
              <div className="shell-side__head">
                <span className="ui-overline">Datos del pozo</span>
                <IconButton icon="panel-left" label="Ocultar columna" size="sm" onClick={() => setLayout({ leftCollapsed: true })} />
              </div>
              <div className="shell-side__scroll">
                <WellPanel />
              </div>
            </aside>
            <ShellHandle kind="left" />
          </>
        )}

        <main className="shell-center">
          <div className={`shell-center__content${toolStringOpen ? ' is-covered' : ''}`} inert={toolStringOpen}>
            <ViewerSlot />
            {!dockCollapsed && <ShellHandle kind="dock" />}
            <Dock />
          </div>
          {toolStringOpen && (
            <div className="shell-stage__cover">
              <ToolStringView />
            </div>
          )}
        </main>

        {rightCollapsed ? (
          <Rail side="right" onExpand={() => setLayout({ rightCollapsed: false })} />
        ) : (
          <>
            <ShellHandle kind="right" />
            <aside className="shell-side shell-side--right" aria-label="Paso del flujo y módulo activo">
              <div className="shell-side__scroll">
                <Inspector />
              </div>
            </aside>
          </>
        )}
      </div>

      {loadDialog && <LoadWellDialog onClose={() => setUi({ loadDialog: null })} {...(loadDialog.source ? { initialSource: loadDialog.source } : {})} />}
      <SnapshotsDialog />
      <ExportDialog />
      <QcReportDialog />
      <EquationsDialog />
      <CommandLayer />
      <Toaster />
    </div>
  );
}
