/**
 * Plantillas de pistas (docs/decisiones/0016, D5): selector de la barra del visor, diálogo «Guardar como plantilla»
 * y diálogos para renombrar una pista o una plantilla propia.
 */
import { useEffect, useMemo, useState } from 'react';
import { findTrackTemplate, trackTemplatesFor } from '../../core/state/tracks';
import type { WorkspaceId } from '../../core/workspaces';
import { Button, Dialog, Field, Icon, Menu, TextField, type MenuEntry } from '../../ui';
import type { ViewerOverlay } from '../../viewer/overlay';
import { ESSENTIAL_NAME } from '../../viewer/essential';
import { DEFAULT_LOOK, VIEWER_LOOKS, type ViewerLookId } from '../../viewer/look';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { applyEssentialTemplate, applyTemplate, applyViewerLook, currentTemplate, renameTemplate, resetToFactory, saveTemplate, type CurrentTemplate, type LayoutEditor } from './actions';
import { useTrackUi } from './store';

export function templateName(c: CurrentTemplate): string {
  return c.kind === 'factory' ? 'De fábrica' : c.kind === 'essential' ? ESSENTIAL_NAME : c.kind === 'template' ? c.name : 'Personalizadas';
}

/** Plantilla aplicada ahora (se recalcula cuando cambian las pistas del proyecto). */
export function useCurrentTemplate(workspace: WorkspaceId, overlays: readonly ViewerOverlay[]): CurrentTemplate {
  const display = useProject((s) => s.project.display);
  return useMemo(() => currentTemplate(useProject.getState().project, workspace, overlays), [display, workspace, overlays]);
}

/** Entradas del selector de plantillas (barra del visor y panel). */
export function templateMenuItems(workspace: WorkspaceId, current: CurrentTemplate, extra: MenuEntry[] = []): MenuEntry[] {
  const project = useProject.getState().project;
  const mine = trackTemplatesFor(project, workspace);
  const check = (on: boolean) => (on ? { icon: 'check' as const } : {});
  const look: ViewerLookId = project.display.look ?? DEFAULT_LOOK;
  const lookEntry = (id: ViewerLookId): MenuEntry => ({
    id: `look:${id}`,
    label: id === DEFAULT_LOOK ? `${VIEWER_LOOKS[id].label} (de fábrica)` : VIEWER_LOOKS[id].label,
    ...check(look === id),
    description: VIEWER_LOOKS[id].description,
    onSelect: () => look !== id && applyViewerLook(id, VIEWER_LOOKS[id].label),
  });
  return [
    { type: 'label', id: 'l-look', label: 'Estilo' },
    lookEntry('classic'),
    lookEntry('modern'),
    { type: 'label', id: 'l-tracks', label: 'Pistas' },
    { id: 'factory', label: 'De fábrica', ...check(current.kind === 'factory'), description: look === 'modern' ? 'Las pistas que trae la app (estilo Moderno)' : 'Las pistas que trae la app', onSelect: () => current.kind !== 'factory' && resetToFactory(workspace) },
    ...(workspace === 'petrophysics' ? [{ id: 'essential', label: ESSENTIAL_NAME, ...check(current.kind === 'essential'), description: 'GR, resistividades, densidad–neutrón y resultados en pistas separadas. Las demás curvas siguen en Armar pistas.', onSelect: () => current.kind !== 'essential' && applyEssentialTemplate() } satisfies MenuEntry] : []),
    { type: 'label', id: 'l-m', label: mine.length ? 'Mis plantillas' : 'Mis plantillas · ninguna todavía' },
    ...mine.map((t): MenuEntry => ({ id: `t:${t.id}`, label: t.name, ...check(current.kind === 'template' && current.id === t.id), description: t.savedAt ? `Guardada el ${new Date(t.savedAt).toLocaleDateString('es-AR')}` : 'Plantilla propia', onSelect: () => applyTemplate(t.id, t.name) })),
    { type: 'separator', id: 's' },
    { id: 'save', label: 'Guardar como plantilla…', icon: 'save', onSelect: () => useTrackUi.getState().set({ saving: true }) },
    { id: 'reset', label: 'Restablecer la de fábrica', icon: 'refresh', disabled: current.kind === 'factory', onSelect: () => resetToFactory(workspace) },
    ...extra,
  ];
}

/** Botón de la barra del visor: plantilla aplicada, cambio de plantilla y «Armar pistas». */
export function TemplateMenu({ workspace, overlays }: { workspace: WorkspaceId; overlays: readonly ViewerOverlay[] }) {
  const current = useCurrentTemplate(workspace, overlays);
  const look = useProject((s) => s.project.display.look ?? DEFAULT_LOOK);
  const building = useUi((s) => s.trackBuilder);
  const set = useUi((s) => s.set);
  return (
    <Menu
      aria-label="Plantillas de pistas"
      minWidth={250}
      items={templateMenuItems(workspace, current, [
        { type: 'separator', id: 's2' },
        { id: 'build', label: building ? 'Terminar de armar pistas' : 'Armar pistas…', icon: building ? 'check' : 'tracks', onSelect: () => set({ trackBuilder: !building }) },
      ])}
      trigger={(tp) => (
        <button {...tp} type="button" className={`tb-template-btn${current.kind === 'custom' ? ' is-custom' : ''}`} title="Estilo y plantilla de pistas: perfil clásico o moderno, cambiar las pistas, guardar las actuales o armar pistas">
          <Icon name="tracks" size={14} />
          <span className="tb-template-btn__label">{templateName(current)}{look !== DEFAULT_LOOK ? ` · ${VIEWER_LOOKS[look].label}` : ''}</span>
          <Icon name="chevron-down" size={12} />
        </button>
      )}
    />
  );
}

/** Diálogo «Guardar como plantilla»: nombre (si existe, se reemplazan sus pistas). */
export function SaveTemplateDialog({ workspace, overlays }: { workspace: WorkspaceId; overlays: readonly ViewerOverlay[] }) {
  const open = useTrackUi((s) => s.saving);
  const set = useTrackUi((s) => s.set);
  const current = useCurrentTemplate(workspace, overlays);
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) setName(current.kind === 'template' ? current.name : 'Mi plantilla');
    // Solo al abrir: después manda lo que escribe el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const clean = name.trim();
  const existing = clean ? findTrackTemplate(useProject.getState().project, workspace, clean) : undefined;
  const close = () => set({ saving: false });
  const save = () => {
    if (!clean) return;
    saveTemplate(workspace, overlays, clean);
    close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title="Guardar como plantilla"
      description="Guarda las pistas que se ven ahora (orden, anchos, curvas y rellenos) en el proyecto, para volver a aplicarlas cuando quieras."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" icon="save" disabled={!clean} onClick={save}>
            {existing ? 'Reemplazar' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Nombre" htmlFor="tb-template-name" hint={existing ? `Ya existe «${existing.name}»: se reemplazan sus pistas.` : 'Las plantillas se guardan con el proyecto.'}>
          <TextField id="tb-template-name" data-autofocus value={name} onChange={setName} maxLength={60} block />
        </Field>
      </form>
    </Dialog>
  );
}

/** Diálogo para renombrar una pista del visor o una plantilla propia. */
export function RenameDialogs({ editor }: { editor: LayoutEditor | null }) {
  const renaming = useTrackUi((s) => s.renaming);
  const renamingTemplate = useTrackUi((s) => s.renamingTemplate);
  const set = useTrackUi((s) => s.set);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(renaming?.title ?? renamingTemplate?.name ?? '');
    setError(null);
  }, [renaming, renamingTemplate]);
  const open = !!renaming || !!renamingTemplate;
  const close = () => set({ renaming: null, renamingTemplate: null });
  const ok = () => {
    const clean = value.trim();
    if (!clean) return;
    try {
      if (renaming && editor) {
        const t = editor.displayedTrack(renaming.trackId);
        if (t) editor.renameTrack(t, clean);
      } else if (renamingTemplate) renameTemplate(renamingTemplate.id, clean);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title={renaming ? 'Renombrar pista' : 'Renombrar plantilla'}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!value.trim()} onClick={ok}>
            Renombrar
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ok();
        }}
      >
        <Field label="Nombre" htmlFor="tb-rename" error={error}>
          <TextField id="tb-rename" data-autofocus value={value} onChange={setValue} maxLength={40} invalid={!!error} block />
        </Field>
      </form>
    </Dialog>
  );
}
