/**
 * Panel «Vistas» del dock (docs/decisiones/0075, punto 7): guardar la vista actual, la lista de vistas del pozo activo
 * en el orden del recorrido (tramo, zona, plantilla y panel) y, por fila, «Ir», «Presentar desde acá», renombrar,
 * subir, bajar y borrar. Las vistas de pozos que ya no están se cuentan aparte y se pueden borrar.
 * También los diálogos «Guardar la vista actual» y «Renombrar vista» (montados en el armazón: la paleta los abre aunque
 * el panel no esté a la vista).
 */
import { useEffect, useMemo, useState } from 'react';
import type { SavedView } from '../../core/display';
import { activeWellEntry } from '../../core/state/project';
import { activeWellViews, findView, orphanViews, resolveView } from '../../core/state/views';
import { WORKSPACES } from '../../core/workspaces';
import { Button, Dialog, EmptyState, Field, Icon, IconButton, Menu, TextField, type MenuEntry } from '../../ui';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { currentViewDraft, deleteSavedView, enterDefense, goToView, moveSavedView, panelExists, panelTitle, presentFrom, rangeLabel, renameSavedView, saveCurrentView } from './actions';
import { useViewsUi } from './store';
import './views.css';

const workspaceLabel = (id: string) => WORKSPACES.find((w) => w.id === id)?.label ?? id;

function ViewRow({ view, n, count, zones }: { view: SavedView; n: number; count: number; zones: readonly { id: string; name: string; color: string }[] }) {
  const project = useProject((s) => s.project);
  const r = resolveView(project, view, panelExists);
  const zone = r.zoneId ? zones.find((z) => z.id === r.zoneId) : undefined;
  const menu: MenuEntry[] = [
    { type: 'label', id: 'l', label: view.name },
    { id: 'rename', label: 'Renombrar…', icon: 'pen', onSelect: () => useViewsUi.getState().set({ renaming: { id: view.id, name: view.name } }) },
    { id: 'up', label: 'Subir', icon: 'chevron-up', disabled: n <= 1, onSelect: () => moveSavedView(view.id, -1) },
    { id: 'down', label: 'Bajar', icon: 'chevron-down', disabled: n >= count, onSelect: () => moveSavedView(view.id, 1) },
    { type: 'separator', id: 's' },
    { id: 'delete', label: 'Borrar', icon: 'trash', danger: true, onSelect: () => deleteSavedView(view.id) },
  ];
  return (
    <li className="views-row" data-testid={`view-row-${n}`} data-view-id={view.id}>
      <span className="views-row__n num" aria-hidden="true">
        {n}
      </span>
      <button type="button" className="views-row__main" onClick={() => goToView(view.id)} title={`Ir a la vista «${view.name}»`}>
        <span className="views-row__name">{view.name}</span>
        <span className="views-row__meta">
          <span className="num">{rangeLabel(view.top, view.base)}</span>
          {zone ? (
            <span className="views-row__zone">
              <span className="views-row__swatch" style={{ background: zone.color }} aria-hidden="true" />
              Zona {zone.name}
            </span>
          ) : null}
          <span>{view.templateName ?? 'Pistas propias'}</span>
          {r.panel ? <span>{panelTitle(r.panel)}</span> : null}
          {view.workspace !== 'petrophysics' ? <span>{workspaceLabel(view.workspace)}</span> : null}
        </span>
        {r.issues.length > 0 && (
          <span className="views-row__issue">
            <Icon name="warning" size={12} />
            {r.issues.map((x) => x.message).join(' · ')}
          </span>
        )}
      </button>
      <span className="views-row__actions">
        <IconButton icon="chevron-up" label="Subir" size="sm" disabled={n <= 1} onClick={() => moveSavedView(view.id, -1)} data-testid={`view-up-${n}`} />
        <IconButton icon="chevron-down" label="Bajar" size="sm" disabled={n >= count} onClick={() => moveSavedView(view.id, 1)} data-testid={`view-down-${n}`} />
        <IconButton icon="play" label="Presentar desde esta vista" size="sm" onClick={() => presentFrom(view.id)} data-testid={`view-present-${n}`} />
        <Menu aria-label={`Acciones de la vista ${view.name}`} items={menu} align="end" trigger={(p) => <IconButton {...p} icon="more" label="Más acciones" size="sm" data-testid={`view-menu-${n}`} />} />
      </span>
    </li>
  );
}

export function ViewsPanel() {
  const project = useProject((s) => s.project);
  const entry = activeWellEntry(project);
  const views = useMemo(() => activeWellViews(project), [project]);
  const orphans = useMemo(() => orphanViews(project), [project]);
  const zones = entry?.interpretation.zones ?? [];
  const save = () => useViewsUi.getState().set({ saving: true });

  if (!entry) return <EmptyState size="sm" icon="well" title="Sin pozo" description="Cargá un pozo para guardar vistas de sus perfiles." />;

  return (
    <div className="views-panel" data-testid="views-panel">
      <div className="views-panel__bar">
        <Button size="sm" variant="primary" icon="save" onClick={save} data-testid="views-save">
          Guardar vista actual
        </Button>
        <span className="shell-spacer" />
        <Button size="sm" icon="play" disabled={!views.length} onClick={() => enterDefense(0)} data-testid="views-present" title="Recorrer las vistas en pantalla limpia: → y ← pasan de vista, Esc sale">
          Modo defensa
        </Button>
      </div>
      {views.length === 0 ? (
        <EmptyState
          size="sm"
          icon="bookmark"
          title="Todavía no hay vistas"
          description="Una vista recuerda el tramo, las pistas, la zona activa y el panel abierto. Armá cada encuadre de la presentación y guardalo; en el modo defensa se recorren en este orden."
        />
      ) : (
        <>
          <p className="views-panel__hint">
            <span className="num">{views.length}</span> {views.length === 1 ? 'vista' : 'vistas'} de {entry.well.name}, en el orden del recorrido.
          </p>
          <ol className="views-list" aria-label="Vistas guardadas">
            {views.map((v, i) => (
              <ViewRow key={v.id} view={v} n={i + 1} count={views.length} zones={zones} />
            ))}
          </ol>
        </>
      )}
      {orphans.length > 0 && (
        <div className="views-panel__orphans" data-testid="views-orphans">
          <Icon name="info" size={13} />
          <span>
            <span className="num">{orphans.length}</span> {orphans.length === 1 ? 'vista de otros pozos' : 'vistas de otros pozos'} que ya no están en el proyecto.
          </span>
          <Menu
            aria-label="Vistas de otros pozos"
            align="end"
            items={[{ type: 'label', id: 'l', label: 'Borrar una vista de otro pozo' }, ...orphans.map((v): MenuEntry => ({ id: v.id, label: v.name, icon: 'trash', danger: true, onSelect: () => deleteSavedView(v.id) }))]}
            trigger={(p) => (
              <Button {...p} size="sm" variant="ghost" iconRight="chevron-down">
                Borrar…
              </Button>
            )}
          />
        </div>
      )}
    </div>
  );
}

/** «Guardar la vista actual»: pide el nombre; con uno que ya existe en el pozo, avisa que la reemplaza. */
function SaveViewDialog() {
  const open = useViewsUi((s) => s.saving);
  const [name, setName] = useState('');
  const project = useProject((s) => s.project);
  useEffect(() => {
    if (!open) return;
    const n = activeWellViews(useProject.getState().project).length;
    setName(`Vista ${n + 1}`);
  }, [open]);
  const close = () => useViewsUi.getState().set({ saving: false });
  const clean = name.trim();
  const draft = open ? currentViewDraft() : null;
  const existing = clean && draft ? findView(project, draft.wellId, clean) : undefined;
  const submit = () => {
    if (!clean) return;
    if (saveCurrentView(clean)) close();
  };
  const summary = draft ? [rangeLabel(draft.top, draft.base), draft.zoneName ? `zona ${draft.zoneName}` : null, draft.templateName ?? 'pistas propias', draft.panel ? panelTitle(draft.panel) : null].filter(Boolean).join(' · ') : '';
  return (
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title="Guardar la vista actual"
      description="Recuerda el tramo, las pistas, la zona activa y el panel abierto, para volver a este encuadre o presentarlo en el modo defensa."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" icon="save" disabled={!clean || !draft} onClick={submit} data-testid="views-save-confirm">
            {existing ? 'Reemplazar' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Nombre" htmlFor="views-save-name" hint={existing ? `Ya existe «${existing.name}»: se reemplaza.` : summary}>
          <TextField id="views-save-name" data-autofocus data-testid="views-save-name" value={name} onChange={setName} onFocus={(e) => e.currentTarget.select()} maxLength={60} block />
        </Field>
      </form>
    </Dialog>
  );
}

function RenameViewDialog() {
  const renaming = useViewsUi((s) => s.renaming);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(renaming?.name ?? '');
    setError(null);
  }, [renaming]);
  const close = () => useViewsUi.getState().set({ renaming: null });
  const submit = () => {
    if (!renaming) return;
    try {
      renameSavedView(renaming.id, value);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Dialog
      open={!!renaming}
      onClose={close}
      size="sm"
      title="Renombrar vista"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!value.trim()} onClick={submit}>
            Renombrar
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Nombre" htmlFor="views-rename" {...(error ? { error } : {})}>
          <TextField id="views-rename" data-autofocus value={value} onChange={(v) => { setValue(v); setError(null); }} invalid={!!error} maxLength={60} block />
        </Field>
      </form>
    </Dialog>
  );
}

/** Diálogos de las vistas: van en el armazón (la paleta los abre aunque el panel no esté a la vista). */
export function ViewsDialogs() {
  // Sin pozo no hay vista que guardar: si el pozo se va con el diálogo abierto, se cierra.
  const hasWell = useProject((s) => !!activeWellEntry(s.project));
  const presenting = useUi((s) => s.presenting);
  useEffect(() => {
    if (!hasWell || presenting) useViewsUi.getState().set({ saving: false });
  }, [hasWell, presenting]);
  return (
    <>
      <SaveViewDialog />
      <RenameViewDialog />
    </>
  );
}
