/**
 * Panel «Armar pistas» (docs/decisiones/0016, D1–D2 y D6): plantillas, búsqueda y catálogo de herramientas, curvas y
 * pistas especiales. Se arrastra a una pista del visor (agregar) o a un espacio entre pistas (pista nueva); sin
 * mouse, cada elemento tiene «Agregar a pista…».
 */
import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { TrackSpec } from '../../core/display';
import type { Well } from '../../core/well';
import type { WorkspaceId } from '../../core/workspaces';
import { registry } from '../../modules';
import { Button, curveStyle, dashPattern, FILL_PALETTE, formatNumber, Icon, IconButton, Menu, TextField, useResolvedTheme, type MenuEntry, type ThemeName } from '../../ui';
import { buildTrackCatalog, filterCatalog, type CatalogCurve, type CatalogGroup, type CatalogOverlayTrack, type CatalogTrack } from '../../viewer/catalog';
import { guard, type ViewerOverlay } from '../../viewer/overlay';
import type { ComputedCurve } from '../../viewer/resolve';
import { overlayTrackId } from '../../viewer/templates';
import { computedCurves } from '../computed';
import { UNDO_SHORTCUT } from '../shell/historyActions';
import { OVERLAYS } from '../shell/viewerOverlayList';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { selectorKey } from '../../core/state/tracks';
import { deleteTemplate, materializedLayout, resetToFactory, type LayoutEditor } from './actions';
import { beginDrag, useLayoutDrag } from './dnd';
import { useTrackUi } from './store';
import { templateMenuItems, templateName, useCurrentTemplate } from './Templates';
import './tracks.css';

export interface TrackBuilderProps {
  workspace: WorkspaceId;
  well: Well;
  computed: readonly ComputedCurve[];
  overlays: readonly ViewerOverlay[];
  editor: LayoutEditor;
}

/** Puertos de curva que produce algún módulo (calculables). */
const PRODUCIBLE: ReadonlySet<string> = new Set([...registry.ports.values()].filter((p) => p.kind === 'curve' && p.producers.length > 0).map((p) => p.id));

function overlayCatalog(overlays: readonly ViewerOverlay[], workspace: string, well: Well, settings: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>> | undefined): CatalogOverlayTrack[] {
  const out: CatalogOverlayTrack[] = [];
  for (const o of overlays) {
    const d = o.track;
    if (!d || (d.workspaces && !d.workspaces.includes(workspace))) continue;
    const st = d.resolve ? guard(o.id, 'track.resolve', () => d.resolve!({ well, settings: settings?.[o.id] ?? {} })) : undefined;
    const available = st !== null;
    out.push({
      overlayId: o.id,
      title: d.title,
      description: `${o.label}${d.unit ? ` · ${d.unit}` : ''}`,
      track: { id: overlayTrackId(o.id), title: d.title, kind: 'overlay', overlayId: o.id, width: d.width ?? 1, scale: { ...d.scale }, ...(d.unit !== undefined ? { unit: d.unit } : {}) },
      available,
      ...(available ? {} : { reason: 'El pozo no tiene estos datos.' }),
    });
  }
  return out;
}

/** «0,2 – 2000» en el sentido en que se dibuja (invertida: máximo a la izquierda). */
function scaleText(kind: 'linear' | 'log', min: number | undefined, max: number | undefined, reversed: boolean): string {
  if (min === undefined || max === undefined) return 'auto';
  const f = (v: number) => formatNumber(v, { significant: 3, grouping: false });
  const [l, r] = reversed ? [max, min] : [min, max];
  return `${f(l)} – ${f(r)}${kind === 'log' ? ' · log' : ''}`;
}

function curveLook(c: CatalogCurve, theme: ThemeName) {
  const s = curveStyle(c.role, theme, registry.roles, c.name);
  const sc = c.trackScale ? { kind: c.trackScale.kind, min: c.trackScale.min, max: c.trackScale.max, reversed: false } : { kind: s.scale, min: s.min, max: s.max, reversed: s.reversed };
  return { color: s.color, dash: s.dash, width: c.style?.width ?? s.width, band: s.kind === 'band', scale: scaleText(sc.kind, sc.min, sc.max, sc.reversed), log: sc.kind === 'log' };
}

function Swatch({ color, dash, width, band }: { color: string; dash: readonly number[]; width: number; band: boolean }) {
  if (band) return <span className="tb-swatch tb-swatch--band" style={{ background: color }} aria-hidden="true" />;
  return (
    <svg className="tb-swatch" viewBox="0 0 24 10" aria-hidden="true">
      <line x1="1" y1="5" x2="23" y2="5" stroke={color} strokeWidth={Math.max(1.4, width)} strokeDasharray={dash.length ? dash.join(' ') : undefined} strokeLinecap="round" />
    </svg>
  );
}

/** Miniatura de una herramienta: el trazo de cada curva, como un encabezado de pista en chico. */
function ToolPreview({ track, theme }: { track: TrackSpec | CatalogTrack['track']; theme: ThemeName }) {
  if (track.kind === 'depth') return <span className="tb-preview tb-preview--depth" aria-hidden="true">m</span>;
  if (track.kind === 'stack') {
    // Colores de la columna volumétrica (paleta de rellenos del tema).
    const parts = [['shale', 0.8], ['sand', 1.4], ['water', 0.6], ['hydrocarbon', 0.6]] as const;
    return (
      <span className="tb-preview tb-preview--stack" aria-hidden="true">
        {parts.map(([id, flex]) => (
          <i key={id} style={{ flex, background: FILL_PALETTE[id][theme] }} />
        ))}
      </span>
    );
  }
  if (track.kind === 'overlay') return <span className="tb-preview tb-preview--overlay" aria-hidden="true"><Icon name="scatter" size={14} /></span>;
  // Cada entrada con su estilo de plantilla (los modelos de Sw comparten el rol pero no el color ni el trazo).
  const strokes = (track.curves ?? [])
    .flatMap((c) => ('role' in c.select ? [{ role: c.select.role, color: c.style?.color, line: c.style?.line }] : []))
    .slice(-4)
    .reverse();
  if (!strokes.length) return <span className="tb-preview tb-preview--collect" aria-hidden="true"><Icon name={track.kind === 'flags' ? 'filter' : 'sigma'} size={14} /></span>;
  return (
    <span className="tb-preview" aria-hidden="true">
      {strokes.map((st, k) => {
        const s = curveStyle(st.role, theme, registry.roles);
        const dash = st.line ? dashPattern(st.line, Math.max(1.4, s.width)) : s.dash;
        return (
          <svg key={`${st.role}:${k}`} viewBox="0 0 24 4">
            <line x1="1" y1="2" x2="23" y2="2" stroke={st.color ?? s.color} strokeWidth={Math.max(1.4, s.width)} strokeDasharray={dash.length ? dash.join(' ') : undefined} />
          </svg>
        );
      })}
    </span>
  );
}

/** Columna izquierda mientras se arman pistas: el panel con el pozo activo y las acciones que publica el visor. */
export function TrackBuilderSlot() {
  const workspace = useUi((s) => s.workspace);
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  const editor = useTrackUi((s) => s.editor);
  const well = entry?.well ?? null;
  const computed = useMemo(() => (well ? computedCurves(result, well) : []), [result, well]);
  if (!well || !editor) {
    return (
      <div className="tb tb--empty">
        <p className="tb__empty">Cargá un pozo para armar pistas.</p>
      </div>
    );
  }
  return <TrackBuilder workspace={workspace} well={well} computed={computed} overlays={OVERLAYS} editor={editor} />;
}

export function TrackBuilder({ workspace, well, computed, overlays, editor }: TrackBuilderProps) {
  const theme = useResolvedTheme();
  const display = useProject((s) => s.project.display);
  const setUi = useUi((s) => s.set);
  const current = useCurrentTemplate(workspace, overlays);
  const dragging = useLayoutDrag((s) => s.payload);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(['spectral', 'nmr', 'other']));

  const computedPorts = useMemo(() => new Set(computed.filter((c) => c.active).map((c) => c.port)), [computed]);
  const groups = useMemo(
    () =>
      buildTrackCatalog({
        roles: registry.roles,
        curves: well.curves,
        producible: PRODUCIBLE,
        computed: computedPorts,
        overlayTracks: overlayCatalog(overlays, workspace, well, display.overlays),
      }),
    [well, computedPorts, overlays, workspace, display.overlays],
  );
  const shown = useMemo(() => filterCatalog(groups, query), [groups, query]);

  // Dónde está ya cada curva y cada pista especial (para «en Resistividad»).
  const placed = useMemo(() => {
    const tracks = materializedLayout(useProject.getState().project, workspace, overlays);
    const curves = new Map<string, string[]>();
    for (const t of tracks) {
      if (t.hidden) continue;
      for (const e of t.curves ?? []) {
        const k = selectorKey(e.select);
        curves.set(k, [...(curves.get(k) ?? []), t.title]);
      }
    }
    const overlaysShown = new Set(tracks.filter((t) => t.kind === 'overlay' && !t.hidden).map((t) => t.overlayId));
    return { curves, overlaysShown };
    // display: cambia cuando cambian las pistas guardadas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, workspace, overlays]);

  const toggle = (id: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const startCurve = (e: ReactPointerEvent, c: CatalogCurve, color: string) => {
    if (!c.available || (e.target as HTMLElement).closest('button')) return;
    beginDrag(e, { kind: 'catalog-curve', item: c }, { label: c.name, color, detail: c.label });
  };
  const startTool = (e: ReactPointerEvent, t: CatalogTrack) => {
    if (!t.available || (e.target as HTMLElement).closest('button')) return;
    beginDrag(e, { kind: 'catalog-track', item: t }, { label: t.name, detail: 'Pista nueva' });
  };

  const curveAddMenu = (c: CatalogCurve): MenuEntry[] =>
    editor.addMenu(
      c.flag ? 'flag' : 'curve',
      (trackId) => editor.addCurve(c, trackId),
      () => editor.drop({ kind: 'catalog-curve', item: c }, { kind: 'gap', beforeId: null }),
    );
  const toolAddMenu = (t: CatalogTrack): MenuEntry[] =>
    editor.addMenu(
      'track',
      (beforeId) => editor.addTool(t.track, t.name, beforeId, t.overlayId),
      () => editor.addTool(t.track, t.name, null, t.overlayId),
    );

  const templateExtra: MenuEntry[] =
    current.kind === 'template'
      ? [
          { type: 'separator', id: 's-own' },
          { id: 'rename', label: `Renombrar «${current.name}»…`, icon: 'pen', onSelect: () => useTrackUi.getState().set({ renamingTemplate: { id: current.id, name: current.name } }) },
          { id: 'delete', label: `Borrar «${current.name}»`, icon: 'trash', danger: true, onSelect: () => deleteTemplate(current.id, current.name) },
        ]
      : [];

  const renderTool = (t: CatalogTrack, special: boolean) => {
    const shownAlready = t.overlayId ? placed.overlaysShown.has(t.overlayId) : false;
    return (
      <div
        key={t.id}
        role="listitem"
        className={`tb-tool${t.available ? '' : ' is-disabled'}${special ? ' tb-tool--special' : ''}`}
        title={t.available ? `Arrastrá «${t.name}» a un espacio entre pistas` : t.reason}
        onPointerDown={(e) => startTool(e, t)}
      >
        <Icon name="grip" size={12} className="tb-grip" />
        <ToolPreview track={t.track} theme={theme} />
        <span className="tb-tool__text">
          <span className="tb-tool__name">{t.name}</span>
          <span className="tb-tool__desc">{t.available ? (shownAlready ? 'Ya está en el visor' : t.description) : t.reason}</span>
        </span>
        <Menu
          aria-label={`Agregar ${t.name}`}
          minWidth={220}
          items={toolAddMenu(t)}
          trigger={(tp) => <IconButton {...tp} icon="plus" size="sm" label={`Agregar la pista ${t.name}…`} disabled={!t.available} />}
        />
      </div>
    );
  };

  const renderCurve = (c: CatalogCurve) => {
    const look = curveLook(c, theme);
    const where = c.available ? placed.curves.get(c.id) : undefined;
    const status = c.status === 'missing' ? 'Falta' : c.status === 'computable' ? 'Sin calcular' : c.status === 'computed' ? 'Calculada' : null;
    return (
      <div
        key={c.id}
        role="listitem"
        className={`tb-curve${c.available ? '' : ' is-disabled'}`}
        aria-disabled={!c.available || undefined}
        title={c.available ? `${c.name} — ${c.label}${c.mnemonics.length && c.mnemonics[0] !== c.name ? ` (${c.mnemonics.join(', ')})` : ''}. Arrastrala a una pista` : `${c.name}: el pozo no tiene esta curva`}
        onPointerDown={(e) => startCurve(e, c, look.color)}
      >
        <Icon name="grip" size={12} className="tb-grip" />
        <Swatch color={look.color} dash={look.dash} width={look.width} band={look.band} />
        <span className="tb-curve__text">
          <span className="tb-curve__line">
            <span className="tb-curve__name mono">{c.mnemonics.length && c.role ? c.mnemonics.join(' · ') : c.name}</span>
            {c.role && c.mnemonics.length > 0 && c.mnemonics[0] !== c.role && <span className="tb-curve__role mono">{c.role}</span>}
            {status && <span className={`tb-tag tb-tag--${c.status}`}>{status}</span>}
          </span>
          <span className="tb-curve__label">{c.label}</span>
        </span>
        <span className="tb-curve__aside">
          <span className={`tb-curve__scale num${look.log ? ' is-log' : ''}`}>{look.band ? 'franja' : look.scale}</span>
          {where && <span className="tb-curve__where" title={`En ${where.join(', ')}`}>{`en ${where[0]}${where.length > 1 ? ` +${where.length - 1}` : ''}`}</span>}
        </span>
        <Menu
          aria-label={`Agregar ${c.name}`}
          minWidth={220}
          items={curveAddMenu(c)}
          trigger={(tp) => <IconButton {...tp} icon="plus" size="sm" label={`Agregar ${c.name} a una pista…`} disabled={!c.available} />}
        />
      </div>
    );
  };

  const renderGroup = (g: CatalogGroup) => {
    const open = query.trim() !== '' || !closed.has(g.id);
    const count = g.curves.filter((c) => c.available).length;
    return (
      <section key={g.id} className={`tb-group${open ? ' is-open' : ''}`}>
        <button type="button" className="tb-group__head" aria-expanded={open} onClick={() => toggle(g.id)}>
          <Icon name="chevron-right" size={13} className="tb-group__chevron" />
          <span className="tb-group__label">{g.label}</span>
          {g.curves.length > 0 && <span className="tb-group__count num">{`${count}/${g.curves.length}`}</span>}
        </button>
        {open && (
          <div className="tb-group__body" role="list" aria-label={g.label}>
            {g.tools.map((t) => renderTool(t, g.id === 'special'))}
            {g.curves.map(renderCurve)}
          </div>
        )}
      </section>
    );
  };

  return (
    <aside className={`tb${dragging ? ' is-dragging' : ''}`} aria-label="Armar pistas">
      <header className="tb__head">
        <div className="tb__titles">
          <span className="tb__overline">Visor</span>
          <h2 className="tb__title">Armar pistas</h2>
        </div>
        <IconButton icon="x" size="sm" label="Terminar de armar pistas" onClick={() => setUi({ trackBuilder: false })} />
      </header>
      <div className="tb__templates">
        <Menu
          aria-label="Plantillas de pistas"
          align="start"
          minWidth={250}
          items={templateMenuItems(workspace, current, templateExtra)}
          trigger={(tp) => (
            <button {...tp} type="button" className="tb__template">
              <span className="tb__template-k">Plantilla</span>
              <span className={`tb__template-v${current.kind === 'custom' ? ' is-custom' : ''}`}>{templateName(current)}</span>
              <Icon name="chevron-down" size={13} />
            </button>
          )}
        />
        <div className="tb__template-actions">
          <Button size="sm" icon="save" onClick={() => useTrackUi.getState().set({ saving: true })}>
            Guardar como…
          </Button>
          <Button size="sm" variant="ghost" icon="refresh" disabled={current.kind === 'factory'} onClick={() => resetToFactory(workspace)}>
            Restablecer
          </Button>
        </div>
      </div>
      <div className="tb__search">
        <TextField icon="search" size="sm" value={query} onChange={setQuery} placeholder="Buscar curva o herramienta" aria-label="Buscar en el catálogo" block />
      </div>
      <p className="tb__hint">
        Arrastrá a una pista para agregar, o <b>entre dos pistas</b> para crear una nueva. En el visor, arrastrá encabezados y curvas para reordenar.
      </p>
      <div className="tb__list">
        {shown.length ? shown.map(renderGroup) : <p className="tb__empty">Nada coincide con «{query}».</p>}
      </div>
      <footer className="tb__foot">
        <Icon name="undo" size={13} />
        <span>
          <kbd className="ui-kbd">{UNDO_SHORTCUT}</kbd> deshace cada cambio
        </span>
      </footer>
    </aside>
  );
}

