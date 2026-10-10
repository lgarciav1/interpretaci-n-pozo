/**
 * Armazón de la app (docs/decisiones/0004-sistema-de-diseno.md, D6):
 * barra superior · flujo guiado · [pozo/curvas/zonas | visor + dock | inspector del paso].
 * Laterales redimensionables y colapsables; el dock se redimensiona en alto.
 *
 * Rendimiento: arrastrar un separador NO re-renderiza el armazón. Las medidas se aplican como variables CSS por
 * suscripción al store (useShellVars) y cada separador lee solo su propio valor. El visor (fase 4) se entera del
 * cambio de tamaño por su ResizeObserver.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { IconButton, ResizeHandle, Toaster } from '../ui';
import { LoadWellDialog } from './components/LoadWellDialog';
import { WellPanel } from './components/WellPanel';
import { QcReportDialog, SnapshotsDialog } from './shell/Dialogs';
import { Dock } from './shell/Dock';
import { FlowBar } from './shell/FlowBar';
import { ExportDialog } from './export/ExportDialog';
import { Inspector } from './shell/Inspector';
import { TopBar } from './shell/TopBar';
import { ViewerSlot } from './shell/ViewerSlot';
import { LAYOUT_LIMITS, useUi, type ShellLayout } from './store/ui';
import './shell/shell.css';

function useShellVars(ref: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const apply = (l: ShellLayout) => {
      const el = ref.current;
      if (!el) return;
      el.style.setProperty('--shell-left', `${l.leftWidth}px`);
      el.style.setProperty('--shell-right', `${l.rightWidth}px`);
      el.style.setProperty('--shell-dock', `${l.dockHeight}px`);
    };
    apply(useUi.getState().layout);
    return useUi.subscribe((s, prev) => {
      if (s.layout !== prev.layout) apply(s.layout);
    });
  }, [ref]);
}

type HandleKind = 'left' | 'right' | 'dock';

const HANDLES: Record<HandleKind, { key: 'leftWidth' | 'rightWidth' | 'dockHeight'; collapse: 'leftCollapsed' | 'rightCollapsed' | 'dockCollapsed'; label: string; invert: boolean }> = {
  left: { key: 'leftWidth', collapse: 'leftCollapsed', label: 'Ancho de la columna del pozo', invert: false },
  right: { key: 'rightWidth', collapse: 'rightCollapsed', label: 'Ancho del panel del paso', invert: true },
  dock: { key: 'dockHeight', collapse: 'dockCollapsed', label: 'Alto de los paneles', invert: true },
};

/** Separador que solo se re-renderiza a sí mismo al arrastrar. */
function ShellHandle({ kind }: { kind: HandleKind }) {
  const h = HANDLES[kind];
  const value = useUi((s) => s.layout[h.key]);
  const setLayout = useUi((s) => s.setLayout);
  return (
    <ResizeHandle
      orientation={kind === 'dock' ? 'horizontal' : 'vertical'}
      label={h.label}
      value={value}
      min={LAYOUT_LIMITS[kind].min}
      max={LAYOUT_LIMITS[kind].max}
      invert={h.invert}
      onChange={(v) => setLayout({ [h.key]: v })}
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

  return (
    <div className="shell" ref={ref}>
      <TopBar />
      <FlowBar />
      <div className="shell-main">
        {leftCollapsed ? (
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
          <ViewerSlot />
          {!dockCollapsed && <ShellHandle kind="dock" />}
          <Dock />
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
      <Toaster />
    </div>
  );
}
