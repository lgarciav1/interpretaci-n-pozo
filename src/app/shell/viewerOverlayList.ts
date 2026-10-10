/**
 * Superposiciones del visor de la app: las incorporadas (zonas con edición, calidad, tendencias) y las de los módulos.
 * Lista única, compartida por el visor (`ViewerSlot`) y las acciones de «Armar pistas» (las pistas propias de las
 * superposiciones son parte de la lista de pistas que se edita).
 */
import { activeWellEntry, applyZoneEdit, makeId } from '../../core/state/project';
import { defaultZoneName } from '../../core/state/zones';
import { toast, zoneColor } from '../../ui';
import { createQcOverlay } from '../../viewer/overlays/qc';
import { createZonesOverlay } from '../../viewer/overlays/zones';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { moduleOverlays } from '../viewerOverlays';
import { TREND_OVERLAYS } from '../trends/actions';

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
export const OVERLAYS = [...BUILTIN_OVERLAYS, ...moduleOverlays(BUILTIN_OVERLAYS.map((o) => o.id))];
