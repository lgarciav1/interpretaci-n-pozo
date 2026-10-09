/**
 * Lugar del visor multipista: conecta los stores (proyecto, resultados del motor, calidad, interfaz) con el
 * componente `WellViewer` de src/viewer, que no conoce stores. Decisión: docs/decisiones/0005-visor-multipista.md.
 *
 * - Pistas: las propias del proyecto (`project.display.layouts[espacio]`) o las de fábrica (`BUILTIN_LAYOUTS`),
 *   resueltas con las curvas medidas y las calculadas activas del motor.
 * - Superposiciones: zonas (clic = editar la zona), calidad del pozo y las que aporten los módulos.
 * - Publica el cursor y el tramo visible en `useViewer` para otros paneles.
 */
import { useMemo } from 'react';
import type { ClientResult } from '../../core/engine/client';
import type { Well } from '../../core/well';
import { registry } from '../../modules';
import { Button, Chip, EmptyState } from '../../ui';
import type { ViewerData } from '../../viewer/overlay';
import { createQcOverlay } from '../../viewer/overlays/qc';
import { createZonesOverlay } from '../../viewer/overlays/zones';
import { resolveTracks, type ComputedCurve } from '../../viewer/resolve';
import { layoutFor } from '../../viewer/templates';
import { WellViewer } from '../../viewer/WellViewer';
import { selectActiveEntry, useProject } from '../store/project';
import { useWellQc } from '../store/qc';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { MODULE_OVERLAYS } from '../viewerOverlays';

const OVERLAYS = [...createZonesOverlay({ onSelect: (id) => useUi.getState().set({ editingZoneId: id }) }), createQcOverlay(), ...MODULE_OVERLAYS];

const onCursorChange = (cursorDepth: number | null) => useViewer.setState({ cursorDepth });
const onViewportChange = (visible: { top: number; base: number }) => useViewer.setState({ visible });

/** Id estable por array de profundidad (un pozo re-importado con otra profundidad vuelve a "ver todo"). */
const depthIds = new WeakMap<Float64Array, number>();
let nextDepthId = 1;
function depthKey(well: Well): string {
  let id = depthIds.get(well.depth.values);
  if (!id) depthIds.set(well.depth.values, (id = nextDepthId++));
  return `${well.id}#${id}`;
}

function computedCurves(result: ClientResult | null, well: Well): ComputedCurve[] {
  if (!result || result.wellId !== well.id) return [];
  const out: ComputedCurve[] = [];
  for (const o of result.outputs) {
    if (o.kind !== 'curve' || !(o.value instanceof Float64Array)) continue;
    out.push({ port: o.port, moduleId: o.moduleId, label: o.label, data: o.value, active: o.active });
  }
  return out;
}

export function ViewerSlot() {
  const entry = useProject(selectActiveEntry);
  const display = useProject((s) => s.project.display);
  const workspace = useUi((s) => s.workspace);
  const editingZoneId = useUi((s) => s.editingZoneId);
  const setUi = useUi((s) => s.set);
  const result = useResults((s) => s.result);
  const well = entry?.well ?? null;
  const qc = useWellQc(well);
  const zones = entry?.interpretation.zones;

  const tracks = useMemo(() => {
    if (!well) return [];
    return resolveTracks(
      layoutFor(workspace, display.layouts),
      { depth: well.depth.values, curves: well.curves, computed: computedCurves(result, well), catalog: registry.roles },
      { roles: display.roles, ...(display.curves[well.id] ? { curves: display.curves[well.id] } : {}) },
    );
  }, [well, result, workspace, display]);

  const data = useMemo<ViewerData | null>(() => {
    if (!well) return null;
    return {
      wellId: well.id,
      depth: well.depth.values,
      zones: (zones ?? []).map((z) => ({ id: z.id, name: z.name, top: z.top, base: z.base, color: z.color })),
      selectedZoneId: editingZoneId,
      qc,
    };
  }, [well, zones, editingZoneId, qc]);

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

  const editing = data.zones.find((z) => z.id === editingZoneId);
  const toolbarStart = (
    <>
      <span className="wv-well-name" title={well.name}>
        {well.name}
      </span>
      {data.zones.length === 0 ? (
        <span className="wv-chip" title="Definí topes y bases en el paso Zonas del flujo guiado">
          Sin zonas · definilas en el paso Zonas
        </span>
      ) : editing ? (
        <Chip color={editing.color} selected onRemove={() => setUi({ editingZoneId: null })} removeLabel="Dejar de editar la zona" title="Los parámetros que cambies se aplican solo a esta zona">
          {`Zona ${editing.name}`}
        </Chip>
      ) : (
        <span className="wv-chip" title="Clic en la franja de zonas (junto a la profundidad) para editar los parámetros de una zona; doble clic para verla entera">
          {`${data.zones.length} ${data.zones.length === 1 ? 'zona' : 'zonas'}`}
        </span>
      )}
    </>
  );

  return (
    <div className="shell-viewer" aria-label="Visor multipista">
      <WellViewer
        wellKey={depthKey(well)}
        depth={well.depth.values}
        depthStep={well.depth.step}
        tracks={tracks}
        data={data}
        overlays={OVERLAYS}
        label={`Perfiles del pozo ${well.name}`}
        toolbarStart={toolbarStart}
        onCursorChange={onCursorChange}
        onViewportChange={onViewportChange}
      />
    </div>
  );
}
