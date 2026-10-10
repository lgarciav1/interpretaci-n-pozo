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
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { activeWellEntry, applyZoneEdit, makeId, setCurveDisplay, setRoleDisplay } from '../../core/state/project';
import { defaultZoneName } from '../../core/state/zones';
import type { Well } from '../../core/well';
import { registry } from '../../modules';
import { Button, Chip, EmptyState, Icon, toast, zoneColor } from '../../ui';
import { patchOverride } from '../../viewer/curveEdit';
import type { ViewerData, ViewerZone } from '../../viewer/overlay';
import { createQcOverlay } from '../../viewer/overlays/qc';
import { createZonesOverlay } from '../../viewer/overlays/zones';
import { resolveTracks, type HiddenCurve, type ResolvedTrack } from '../../viewer/resolve';
import { layoutFor, STACK_ROLE_HINTS, withOverlayTracks } from '../../viewer/templates';
import { WellHeader } from '../../viewer/WellHeader';
import { WellViewer } from '../../viewer/WellViewer';
import { selectActiveEntry, useProject } from '../store/project';
import { useWellQc } from '../store/qc';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { computedCurves } from '../computed';
import { moduleOverlays } from '../viewerOverlays';
import { startTrendTool, stopTrendTool, TREND_OVERLAYS } from '../trends/actions';
import { useTrendsUi } from '../trends/store';
import { CurveEditor } from './CurveEditor';

const activeWell = () => activeWellEntry(useProject.getState().project);

const BUILTIN_OVERLAYS = [
  ...createZonesOverlay({
    onSelect: (id) => useUi.getState().set({ editingZoneId: id }),
    edit: {
      current: () => {
        const e = activeWell();
        return e ? { zones: e.interpretation.zones, depth: e.well.depth.values } : null;
      },
      marking: () => useUi.getState().zoneMarking,
      commit: (zones, label, clone) => {
        const e = activeWell();
        if (e) useProject.getState().commit(label, (p) => applyZoneEdit(p, e.well.id, zones, clone ?? null));
      },
      newZone: (zones) => ({ id: makeId('zona'), lowerId: makeId('zona'), name: defaultZoneName(zones), color: zoneColor(zones.length) }),
      created: (z) => {
        useUi.getState().set({ zoneMarking: false, editingZoneId: z.id });
        toast({ tone: 'ok', title: `Zona «${z.name}» creada`, description: 'Cambiale el nombre, el color o el tipo en el panel Zonas.' });
      },
      error: (message) => toast({ tone: 'warn', title: 'No se marcó la zona', description: message }),
    },
  }),
  createQcOverlay(),
  // Tendencias y gradientes (docs/decisiones/0008): bandas del tramo debajo de las curvas, líneas encima.
  ...TREND_OVERLAYS,
];
/** Incorporadas + las de los módulos (con ids que no choquen con las incorporadas). */
const OVERLAYS = [...BUILTIN_OVERLAYS, ...moduleOverlays(BUILTIN_OVERLAYS.map((o) => o.id))];

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
  const showHeader = useUi((s) => s.layout.wellHeader);
  const setUi = useUi((s) => s.set);
  const setLayout = useUi((s) => s.setLayout);
  const trendTool = useTrendsUi((s) => s.tool);
  const trendRange = useTrendsUi((s) => s.showRange);
  const result = useResults((s) => s.result);
  const well = entry?.well ?? null;
  const qc = useWellQc(well);
  const interpretation = entry?.interpretation;

  const computed = useMemo(() => (well ? computedCurves(result, well) : []), [result, well]);
  const tracks = useMemo(() => {
    if (!well) return [];
    return resolveTracks(
      // Pistas propias con escala según los datos (presiones MDT) y los ajustes guardados (unidad).
      withOverlayTracks(layoutFor(workspace, display.layouts), OVERLAYS, workspace, { well, ...(display.overlays ? { settings: display.overlays } : {}) }),
      { depth: well.depth.values, curves: well.curves, computed, catalog: registry.roles },
      { roles: display.roles, ...(display.curves[well.id] ? { curves: display.curves[well.id] } : {}) },
    );
  }, [well, computed, workspace, display]);

  const data = useMemo<ViewerData | null>(() => {
    if (!well || !interpretation) return null;
    return {
      wellId: well.id,
      depth: well.depth.values,
      zones: interpretation.zones.map((z) => ({ id: z.id, name: z.name, top: z.top, base: z.base, color: z.color })),
      selectedZoneId: editingZoneId,
      qc,
      well,
      interpretation,
      computed,
      commit,
    };
  }, [well, interpretation, editingZoneId, qc, computed, commit]);

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
      if (e.key === 'Escape' && !e.defaultPrevented) useUi.getState().set({ zoneMarking: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [marking]);
  // Lo mismo para la herramienta de tendencias (elegir tramo o dibujar a mano).
  useEffect(() => {
    if (!trendTool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !useViewer.getState().dragging) stopTrendTool();
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
    <div className={`shell-viewer${marking || trendTool ? ' is-marking' : ''}`} aria-label="Visor multipista">
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
          return false;
        }}
        onCursorChange={onCursorChange}
        onViewportChange={onViewportChange}
        onDragChange={onDragChange}
      />
      {editing && editingCurve && <CurveEditor key={`${editing.trackId}|${editing.key}`} wellId={well.id} curve={editingCurve} anchorRef={anchorRef} onClose={() => setEditing(null)} />}
    </div>
  );
}
