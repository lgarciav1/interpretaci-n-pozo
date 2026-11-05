import { preparationViewCurves } from '../preparation/view';
import { usePreparationUi } from '../preparation/store';
import { effectiveWell } from '../preparation/data';
/**
 * Lugar del visor multipista: conecta los stores (proyecto, resultados del motor, calidad, interfaz) con el
 * componente `WellViewer` de src/viewer, que no conoce stores. Decisión: docs/decisiones/0005-visor-multipista.md.
 *
 * - Pistas: las propias del proyecto (`project.display.layouts[espacio]`) o las de fábrica (`BUILTIN_LAYOUTS`),
 *   resueltas con las curvas medidas y las calculadas del motor (activas y alternativas).
 * - Superposiciones: zonas (clic = editar la zona; arrastre de topes y modo «marcar zona», que guardan por
 *   `commit`), calidad del pozo y las que aporten los módulos.
 * - Tendencias (`src/app/trends/`): herramienta «elegir tramo» / «dibujar a mano» y sus avisos en la barra.
 * - Encabezado de pozo, editor de escalas (popover anclado a la curva) y modo «marcar zona».
 * - Publica el cursor y el tramo visible en `useViewer` para otros paneles.
 * - Cortina antes/después (docs/decisiones/0026): con `useUi.curtain`, las mismas pistas resueltas con las curvas
 *   calculadas del snapshot (corrida aislada, en caché) van al visor como lado «antes».
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { setCurveDisplay, setRoleDisplay } from '../../core/state/project';
import type { Well } from '../../core/well';
import { registry } from '../../modules';
import { Button, Chip, EmptyState, getResolvedTheme, Icon, Spinner } from '../../ui';
import { patchOverride } from '../../viewer/curveEdit';
import type { ViewerData, ViewerZone } from '../../viewer/overlay';
import { resolveTracks, type HiddenCurve, type ResolvedTrack } from '../../viewer/resolve';
import { layoutFor, STACK_ROLE_HINTS, withOverlayTracks } from '../../viewer/templates';
import { DEFAULT_LOOK, lookOf } from '../../viewer/look';
import { wellTvdss } from '../../viewer/depthColumns';
import { addTopAt, defaultZoneName } from '../../core/state/zones';
import { applyZoneEdit, makeId } from '../../core/state/project';
import { toast, zoneColor } from '../../ui';
import { defaultFigureOptions, exportFigure } from '../export/figureActions';
import { pxToCm } from '../../io/export/figures/sizing';
import { WellHeader } from '../../viewer/WellHeaderView';
import { WellViewer, type ViewerCurtain } from '../../viewer/WellViewer';
import { alignCurtainTracks } from '../../viewer/curtain';
import { closeCurtain } from '../snapshots/actions';
import { useSnapshotRun } from '../snapshots/snapshotEngine';
import { snapshotCurtainIssue } from '../snapshots/request';
import { selectActiveEntry, useProject } from '../store/project';
import { useWellQc } from '../store/qc';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { computedCurves, computedTables } from '../computed';
import { visibleCurves } from '../toolString/select';
import { visibleQc } from '../plots/context';
import { startTrendTool, stopTrendTool } from '../trends/actions';
import { useTrendsUi } from '../trends/store';
import { CurveEditor } from './CurveEditor';
import { OVERLAYS } from './viewerOverlayList';
import { acceptsPayload, createLayoutEditor } from '../tracks/actions';
import { beginDrag, dragInfo, setDropHandler, useLayoutDrag } from '../tracks/dnd';
import { useTrackUi } from '../tracks/store';
import { RenameDialogs, SaveTemplateDialog, TemplateMenu } from '../tracks/Templates';
import type { ViewerLayoutEditing } from '../../viewer/layoutEdit';
import { TRACK_WIDTH_STEP } from '../../core/state/tracks';
import { clearPlotSelection, getPlotLink, selectionTitle } from '../../plots/link';
import { usePlotSelection } from '../../plots/useLink';
import { formatNumber } from '../../ui';

/**
 * Devuelve el foco después de mover con el teclado: el elemento enfocado puede volver a montarse en otra pista (una
 * curva que cambia de pista) o desaparecer (una pista quitada). Se busca por sus atributos `data-` en el cuadro
 * siguiente, cuando React ya pintó.
 */
function refocusTrack(trackId: string): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`.wv-head[data-drop-track="${CSS.escape(trackId)}"] .wv-head__grip`)?.focus());
}
/** Ídem para una curva; `notIn` = pista de origen (si la curva está en varias pistas, la que no es esa). */
function refocusCurve(key: string, notIn: string | null): void {
  requestAnimationFrame(() => {
    const rows = [...document.querySelectorAll<HTMLElement>(`[data-drop-row="${CSS.escape(key)}"]`)];
    const row = rows.find((r) => notIn === null || r.closest('[data-drop-track]')?.getAttribute('data-drop-track') !== notIn) ?? rows[0];
    row?.querySelector<HTMLElement>('.wv-legend')?.focus();
  });
}

const onCursorChange = (cursorDepth: number | null) => useViewer.setState({ cursorDepth });
const onViewportChange = (visible: { top: number; base: number }) => useViewer.setState({ visible });
const onDragChange = (dragging: boolean) => useViewer.setState({ dragging });

/** Id estable por array de profundidad (un pozo re-importado con otra profundidad vuelve a "ver todo"). */
const depthIds = new WeakMap<Float64Array, number>();
let nextDepthId = 1;
function depthKey(well: Well): string {
  let id = depthIds.get(well.depth.values);
  if (!id) depthIds.set(well.depth.values, (id = nextDepthId++));
  return `${well.id}#${id}`;
}

export function ViewerSlot() {
  const entry = useProject(selectActiveEntry);
  const display = useProject((s) => s.project.display);
  const commit = useProject((s) => s.commit);
  const workspace = useUi((s) => s.workspace);
  const editingZoneId = useUi((s) => s.editingZoneId);
  const marking = useUi((s) => s.zoneMarking);
  const showHeader = useUi((s) => !s.readingMode && s.layout.wellHeader);
  const setUi = useUi((s) => s.set);
  const setLayout = useUi((s) => s.setLayout);
  const trendTool = useTrendsUi((s) => s.tool);
  const trendRange = useTrendsUi((s) => s.showRange);
  const result = useResults((s) => s.result);
  const building = useUi((s) => s.trackBuilder);
  const dragPayload = useLayoutDrag((s) => s.payload);
  const dragTarget = useLayoutDrag((s) => s.target);
  const well = entry ? effectiveWell(entry.well, result) : null;
  const qc = useWellQc(entry?.well ?? null);
  // Selección compartida con los gráficos (0021): ficha en la barra con «Limpiar».
  const plotSelection = usePlotSelection(well?.depth.values);
  const interpretation = entry?.interpretation;

  const computed = useMemo(() => (well ? computedCurves(result, well) : []), [result, well]);
  // Sarta (docs/decisiones/0032): las curvas de herramientas apagadas no se ven (filtro; las pistas no cambian).
  const toolString = interpretation?.toolString;
  const compareOriginals = usePreparationUi(s => s.compareOriginals);
  const curves = useMemo(() => (well ? preparationViewCurves(visibleCurves(well, { toolString }), interpretation, result, compareOriginals) : []), [well, toolString, interpretation, result, compareOriginals]);
  // Pistas propias con escala según los datos (presiones MDT) y los ajustes guardados (unidad).
  // Estilo del visor (docs/decisiones/0067): perfil clásico de fábrica o «Moderno»; elige también la plantilla de fábrica.
  const lookId = display.look ?? DEFAULT_LOOK;
  const look = lookOf(lookId);
  const layoutSpec = useMemo(
    () => (well ? withOverlayTracks(layoutFor(workspace, display.layouts, lookId), OVERLAYS, workspace, { well, ...(display.overlays ? { settings: display.overlays } : {}) }) : []),
    [well, workspace, display.layouts, display.overlays, lookId],
  );
  // TVDSS para la segunda columna de profundidad: solo si el pozo tiene elevación de referencia (en caché por pozo).
  const tvdss = useMemo(() => (well ? wellTvdss(well) : null), [well]);
  const overrides = useMemo(() => (well ? { roles: display.roles, ...(display.curves[well.id] ? { curves: display.curves[well.id] } : {}) } : {}), [well, display.roles, display.curves]);
  const tracks = useMemo(() => {
    if (!well) return [];
    return resolveTracks(
      layoutSpec,
      { depth: well.depth.values, curves, computed, catalog: registry.roles, sources: interpretation?.sources, tvdss },
      overrides,
      // Armando pistas se ven también las que se ocultan vacías (para moverlas o quitarlas).
      { keepEmpty: building, look: lookId },
    );
  }, [well, curves, computed, layoutSpec, overrides, building, interpretation?.sources, tvdss, lookId]);

  // Cortina antes/después: el snapshot se calcula una vez al elegirlo (caché compartida con el diálogo); arrastrar la
  // línea solo redibuja. Cada lado usa sus datos; una grilla/laboratorio incompatibles bloquean la cortina.
  const curtainId = useUi((s) => s.curtain?.snapshotId ?? null);
  const curtainSnap = useProject((s) => (curtainId ? (s.project.snapshots.find((x) => x.id === curtainId) ?? null) : null));
  const snapshotProject = useProject((s) => s.project);
  const curtainRun = useSnapshotRun(curtainSnap, well, snapshotProject);
  const curtainResult = curtainRun?.status === 'ready' ? curtainRun.result : null;
  const curtainWell = curtainRun?.status === 'ready' ? curtainRun.well : null;
  const curtainIssue = useMemo(() => well && curtainWell ? snapshotCurtainIssue(well, curtainWell) : null, [well, curtainWell]);
  const curtain = useMemo<ViewerCurtain | null>(() => {
    if (!well || !curtainSnap || !curtainResult || !curtainWell || curtainIssue) return null;
    // El lado «antes» con la sarta del snapshot (sus curvas medidas son las que veía ese cálculo).
    const beforeCurves = preparationViewCurves(visibleCurves(curtainWell, curtainSnap.interpretation), curtainSnap.interpretation, curtainResult, compareOriginals);
    const before = resolveTracks(layoutSpec, { depth: curtainWell.depth.values, curves: beforeCurves, computed: computedCurves(curtainResult, curtainWell), catalog: registry.roles, sources: curtainSnap.interpretation.sources, tvdss }, overrides, { keepEmpty: true, look: lookId });
    return { before: alignCurtainTracks(tracks, before), beforeLabel: `Antes: ${curtainSnap.name}`, afterLabel: 'Después: actual' };
  }, [well, curtainSnap, curtainResult, curtainWell, curtainIssue, layoutSpec, overrides, tracks, compareOriginals, tvdss, lookId]);

  // «Armar pistas» (docs/decisiones/0016): acciones sobre las pistas que se ven, publicadas para el panel.
  const editor = useMemo(() => (well ? createLayoutEditor({ workspace, overlays: OVERLAYS, displayed: tracks, curves }) : null), [well, workspace, tracks, curves]);
  useEffect(() => {
    useTrackUi.getState().set({ editor });
    setDropHandler(editor ? (payload, target) => editor.drop(payload, target) : null);
  }, [editor]);
  useEffect(
    () => () => {
      useTrackUi.getState().set({ editor: null });
      setDropHandler(null);
    },
    [],
  );
  const layoutEdit = useMemo<ViewerLayoutEditing | null>(() => {
    if (!building || !editor) return null;
    const ghostColor = (c: { styles: Readonly<Record<"light" | "dark", { color: string }>> }) => c.styles[getResolvedTheme()].color;
    return {
      drag: dragInfo(dragPayload),
      target: dragTarget,
      accepts: (t) => acceptsPayload(dragPayload, t),
      onTrackPointerDown: (e, t) => beginDrag(e, { kind: 'track', trackId: t.id, title: t.title }, { label: t.title, detail: 'Mover pista' }),
      onCurvePointerDown: (e, t, c) => beginDrag(e, { kind: 'curve', trackId: t.id, curveKey: c.key, name: c.name, flag: c.kind === 'band' }, { label: c.name, color: ghostColor(c), detail: `desde ${t.title}` }),
      trackMenu: (t) => editor.trackMenu(t, (tt) => useTrackUi.getState().set({ renaming: { trackId: tt.id, title: tt.title } })),
      curveMenu: (t, c) => editor.curveMenu(t, c),
      onTrackKeyDown: (e, t) => {
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          const dir = e.key === 'ArrowLeft' ? -1 : 1;
          if (e.shiftKey) {
            if (t.fixed === undefined) editor.resize(t, dir > 0 ? t.width * TRACK_WIDTH_STEP : t.width / TRACK_WIDTH_STEP);
          } else editor.moveTrackBy(t, dir);
          refocusTrack(t.id);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          // El foco pasa a la pista vecina (la de la derecha, o la de la izquierda si era la última).
          const i = tracks.findIndex((x) => x.id === t.id);
          const next = tracks[i + 1] ?? tracks[i - 1];
          editor.removeTrack(t);
          if (next) refocusTrack(next.id);
        }
      },
      onCurveKeyDown: (e, t, c) => {
        if (!e.altKey) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          editor.moveCurveBy(t, c, e.key === 'ArrowUp' ? 1 : -1);
          refocusCurve(c.key, null);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          editor.moveCurveSideways(t, c, e.key === 'ArrowLeft' ? -1 : 1);
          refocusCurve(c.key, t.id);
        }
      },
      onResize: (t, w) => editor.resize(t, w),
    };
  }, [building, editor, dragPayload, dragTarget]);
  // Sin pozo no hay nada que armar.
  useEffect(() => {
    if (!well && building) setUi({ trackBuilder: false });
  }, [well, building, setUi]);

  const data = useMemo<ViewerData | null>(() => {
    if (!well || !interpretation) return null;
    return {
      wellId: well.id,
      depth: well.depth.values,
      zones: interpretation.zones.map((z) => ({ id: z.id, name: z.name, top: z.top, base: z.base, color: z.color })),
      selectedZoneId: editingZoneId,
      // Calidad según la sarta (0032): sin derrumbes de un caliper apagado ni curvas ocultas.
      qc: visibleQc(qc, well, interpretation),
      well,
      interpretation,
      computed,
      tables: computedTables(result, well),
      commit,
    };
  }, [well, interpretation, editingZoneId, qc, computed, result, commit]);

  // Editor de escala: qué curva y dónde anclarlo (la curva se vuelve a buscar en cada render: llega al día).
  const [editing, setEditing] = useState<{ trackId: string; key: string } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const editingCurve = editing ? tracks.find((t) => t.id === editing.trackId)?.curves.find((c) => c.key === editing.key) : undefined;
  useEffect(() => {
    if (editing && !editingCurve) setEditing(null);
  }, [editing, editingCurve]);
  useEffect(() => setEditing(null), [well?.id, workspace]);

  // Pedido de mostrar un tramo (zona elegida en el encabezado).
  const [rangeRequest, setRangeRequest] = useState<{ top: number; base: number; seq: number } | null>(null);
  useEffect(() => {
    if (trendRange) setRangeRequest((r) => ({ top: trendRange.top, base: trendRange.base, seq: (r?.seq ?? 0) + 1 }));
  }, [trendRange]);
  const showZone = (z: ViewerZone) => {
    setUi({ editingZoneId: z.id });
    setRangeRequest((r) => ({ top: z.top, base: z.base, seq: (r?.seq ?? 0) + 1 }));
  };

  // Escape sale del modo «marcar zona» aunque el foco no esté en el visor.
  useEffect(() => {
    if (!marking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        useUi.getState().set({ zoneMarking: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [marking]);
  // Escape cierra la cortina (si no lo usó antes otro modo, un menú o un diálogo).
  useEffect(() => {
    if (!curtainId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || useViewer.getState().dragging) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      closeCurtain();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [curtainId]);
  // Lo mismo para la herramienta de tendencias (elegir tramo o dibujar a mano).
  useEffect(() => {
    if (!trendTool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !useViewer.getState().dragging) {
        e.preventDefault();
        stopTrendTool();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [trendTool]);
  useEffect(() => {
    if (!well) {
      setUi({ zoneMarking: false });
      stopTrendTool();
    }
  }, [well, setUi]);
  // «Marcar zona» y la herramienta de tendencias se excluyen.
  useEffect(() => {
    if (marking) stopTrendTool();
  }, [marking]);
  // Escape termina de armar pistas (si no hay un arrastre, un menú o un diálogo que lo usen antes).
  useEffect(() => {
    if (!building) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || useLayoutDrag.getState().payload) return;
      if (document.querySelector('[role="dialog"]') || (e.target instanceof HTMLInputElement && e.target.value)) return;
      e.preventDefault();
      useUi.getState().set({ trackBuilder: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [building]);

  // Escape limpia la selección de los gráficos aunque el foco no esté en el visor ni en un gráfico (estos la limpian
  // solos). Lo último: no si otro lo usó (modos del visor, menús, diálogos) ni con el foco en un campo de texto.
  useEffect(() => {
    if (!plotSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !getPlotLink().selection) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('[role="dialog"], [role="menu"], [role="listbox"]'))) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const ui = useUi.getState();
      if (ui.zoneMarking || ui.trackBuilder || useTrendsUi.getState().tool || useViewer.getState().dragging) return;
      e.preventDefault();
      clearPlotSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plotSelection]);

  if (!entry || !well || !data) {
    return (
      <div className="shell-viewer shell-viewer--empty">
        <EmptyState
          size="lg"
          icon="tracks"
          title="Cargá un pozo para ver sus perfiles"
          description="Excel, LAS o CSV. También podés empezar con los datos del TP, que vienen incluidos en la app."
          actions={
            <>
              <Button variant="primary" icon="upload" onClick={() => setUi({ loadDialog: {} })}>
                Cargar pozo
              </Button>
              <Button icon="table" onClick={() => setUi({ loadDialog: { source: 'tp' } })}>
                Usar datos del TP
              </Button>
            </>
          }
        />
      </div>
    );
  }

  const showCurve = (_t: ResolvedTrack, h: HiddenCurve) => {
    commit(`Mostrar ${h.name}`, (p) => {
      let next = p;
      if (h.curveId) {
        const ov = p.display.curves[well.id]?.[h.curveId];
        if (ov?.hidden) next = setCurveDisplay(next, well.id, h.curveId, patchOverride(ov, { hidden: undefined }));
      }
      const rov = h.role ? next.display.roles[h.role] : undefined;
      if (h.role && rov?.hidden) next = setRoleDisplay(next, h.role, patchOverride(rov, { hidden: undefined }));
      return next;
    });
  };

  // Menú contextual del perfil (docs/decisiones/0067): crear un tope y exportar lo visible.
  const createTop = (d: number) => {
    const zones = interpretation?.zones ?? [];
    const input = { id: makeId('zona'), lowerId: makeId('zona'), name: defaultZoneName(zones), color: zoneColor(zones.length) };
    const r = addTopAt(zones, d, input, { depth: well.depth.values });
    if ('error' in r) {
      toast({ tone: 'warn', title: 'No se creó el tope', description: r.error });
      return;
    }
    commit(`Crear tope de ${r.created.name}`, (p) => applyZoneEdit(p, well.id, r.zones, r.clone));
    setUi({ editingZoneId: r.created.id });
    toast({ tone: 'ok', title: `Tope de «${r.created.name}» a ${formatNumber(r.created.top, { digits: 2, grouping: false })} m`, description: 'Arrastrá la línea para ajustarlo; el nombre y el color se cambian en el panel Zonas.' });
  };
  const exportVisible = (req: { top: number; base: number; scale: number; widthPx: number }) => {
    const base = defaultFigureOptions('profile-tracks');
    void exportFigure({ ...base, format: 'png', range: { kind: 'visible', top: req.top, base: req.base }, verticalScale: req.scale, widthCm: Math.max(base.widthCm, +(pxToCm(req.widthPx) + 2 * base.marginCm).toFixed(1)), dpi: 150 });
  };

  const editingZone = data.zones.find((z) => z.id === editingZoneId);
  const toolbarStart = (
    <>
      <button
        type="button"
        className="wv-well-toggle"
        aria-expanded={showHeader}
        title={showHeader ? 'Ocultar el encabezado del pozo' : 'Mostrar el encabezado del pozo'}
        onClick={() => setLayout({ wellHeader: !showHeader })}
      >
        <Icon name="chevron-down" size={14} />
        <span className="wv-well-name" title={well.name}>
          {well.name}
        </span>
      </button>
      {/* La selección antes que las zonas: si la barra no alcanza, se recorta lo otro. */}
      {plotSelection ? (
        <Chip
          selected
          onRemove={clearPlotSelection}
          removeLabel="Limpiar la selección (Esc)"
          title={`${selectionTitle(plotSelection, (d) => formatNumber(d, { digits: 1 }))}: ${formatNumber(plotSelection.count, { digits: 0 })} muestras en ${plotSelection.runs.length} tramos, resaltadas en el crossplot y el histograma. Mayús + arrastre marca otro tramo.`}
        >
          {`Sel. ${formatNumber(plotSelection.count, { digits: 0 })}`}
        </Chip>
      ) : null}
      {data.zones.length === 0 ? (
        <span className="wv-chip" title="Definí zonas con «Marcar zona» o cargando un archivo con columna de zona">
          Sin zonas
        </span>
      ) : editingZone ? (
        <Chip color={editingZone.color} selected onRemove={() => setUi({ editingZoneId: null })} removeLabel="Dejar de editar la zona" title="Los parámetros que cambies se aplican solo a esta zona">
          {`Zona ${editingZone.name}`}
        </Chip>
      ) : (
        <span className="wv-chip" title="Clic en la franja de zonas (junto a la profundidad) para editar los parámetros de una zona; doble clic para verla entera; arrastrá un tope para moverlo">
          {`${data.zones.length} ${data.zones.length === 1 ? 'zona' : 'zonas'}`}
        </span>
      )}
    </>
  );

  const toolbarEnd = (
    <>
      {curtainId && (
        <Button size="sm" variant="primary" icon="curtain" aria-pressed title="Cerrar la cortina antes/después (Esc)" onClick={closeCurtain} data-testid="curtain-close">
          Cortina
        </Button>
      )}
      <TemplateMenu workspace={workspace} overlays={OVERLAYS} />
      <Button
        size="sm"
        variant="ghost"
        icon="tool-string"
        title="Sarta de perfilaje: qué herramientas corrieron, prenderlas y apagarlas, planificar otra y ver su profundidad de investigación en 3D"
        onClick={() => setUi({ toolStringOpen: true })}
        data-testid="open-tool-string"
      >
        Sarta
      </Button>
      <Button
        size="sm"
        variant={building ? 'primary' : 'ghost'}
        icon="tracks"
        aria-pressed={building}
        title={building ? 'Terminar de armar pistas (Esc)' : 'Armar pistas: agregar curvas y herramientas desde un catálogo, mover, quitar y cambiar anchos'}
        onClick={() => setUi({ trackBuilder: !building })}
      >
        Pistas
      </Button>
      <Button
        size="sm"
        variant={trendTool ? 'primary' : 'ghost'}
        icon="trend"
        aria-pressed={!!trendTool}
        title={trendTool ? 'Salir de la herramienta de tendencias (Esc)' : 'Trazar una línea de tendencia: arrastrá sobre una curva para elegir el tramo del ajuste'}
        onClick={() => (trendTool ? stopTrendTool() : startTrendTool({ kind: 'fit' }))}
      >
        Tendencia
      </Button>
      <Button
        size="sm"
        variant={marking ? 'primary' : 'ghost'}
        icon="zone-add"
        aria-pressed={marking}
        title={marking ? 'Salir del modo marcar zona (Esc)' : 'Marcar una zona nueva arrastrando sobre el perfil'}
        onClick={() => setUi({ zoneMarking: !marking })}
      >
        Marcar zona
      </Button>
    </>
  );

  return (
    <div className={`shell-viewer${marking || trendTool ? ' is-marking' : ''}${building ? ' is-building' : ''}`} aria-label="Visor multipista">
      <WellViewer
        wellKey={depthKey(well)}
        depth={well.depth.values}
        depthStep={well.depth.step}
        tracks={tracks}
        data={data}
        overlays={OVERLAYS}
        label={`Perfiles del pozo ${well.name}`}
        toolbarStart={toolbarStart}
        toolbarEnd={toolbarEnd}
        header={showHeader ? <WellHeader well={well} zones={data.zones} computedCount={computed.filter((c) => c.active).length} onZone={showZone} /> : undefined}
        notice={
          marking ? (
            <>
              <Icon name="zone-add" size={14} />
              Arrastrá sobre el perfil para marcar una zona · <kbd>Esc</kbd> para salir
            </>
          ) : curtainId && !curtain ? (
            curtainRun?.status === 'error' || curtainIssue ? (
              <>
                <Icon name="warning" size={14} />
                {`No se pudo comparar «${curtainSnap?.name ?? 'el snapshot'}»: ${curtainRun?.status === 'error' ? curtainRun.message : curtainIssue}`} · <kbd>Esc</kbd> para salir
              </>
            ) : (
              <>
                <Spinner size={12} />
                {`Calculando «${curtainSnap?.name ?? 'el snapshot'}» para la cortina…`}
              </>
            )
          ) : trendTool ? (
            <>
              <Icon name={trendTool.kind === 'manual' ? 'pen' : 'trend'} size={14} />
              {trendTool.series?.hint
                ? trendTool.series.hint
                : trendTool.kind === 'manual'
                ? 'Arrastrá sobre una curva de un punto a otro para dibujar la tendencia'
                : trendTool.trendId
                  ? 'Arrastrá sobre el perfil para elegir el nuevo tramo del ajuste'
                  : 'Arrastrá sobre una curva para elegir el tramo del ajuste'}{' '}
              · <kbd>Esc</kbd> para salir
            </>
          ) : undefined
        }
        stackHints={STACK_ROLE_HINTS}
        rangeRequest={rangeRequest}
        onEditCurve={({ track, curve }, anchor) => {
          anchorRef.current = anchor;
          setEditing((e) => (e && e.trackId === track.id && e.key === curve.key ? null : { trackId: track.id, key: curve.key }));
        }}
        onShowCurve={showCurve}
        onEscape={() => {
          if (useUi.getState().curtain) {
            closeCurtain();
            return true;
          }
          if (useTrendsUi.getState().tool) {
            stopTrendTool();
            return true;
          }
          if (useUi.getState().zoneMarking) {
            setUi({ zoneMarking: false });
            return true;
          }
          if (useTrendsUi.getState().selectedId) {
            useTrendsUi.getState().set({ selectedId: null });
            return true;
          }
          if (useUi.getState().trackBuilder) {
            setUi({ trackBuilder: false });
            return true;
          }
          if (getPlotLink().selection) {
            clearPlotSelection();
            return true;
          }
          return false;
        }}
        onCursorChange={onCursorChange}
        onViewportChange={onViewportChange}
        onDragChange={onDragChange}
        layoutEdit={layoutEdit}
        curtain={curtain}
        look={look}
        onCreateTop={createTop}
        onExportVisible={exportVisible}
      />
      {editing && editingCurve && <CurveEditor key={`${editing.trackId}|${editing.key}`} wellId={well.id} curve={editingCurve} anchorRef={anchorRef} onClose={() => setEditing(null)} />}
      <SaveTemplateDialog workspace={workspace} overlays={OVERLAYS} />
      <RenameDialogs editor={editor} />
      <div id="tb-live" className="ui-visually-hidden" aria-live="polite" />
    </div>

  );
}

