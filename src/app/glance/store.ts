/**
 * Zona elegida en el Resumen (docs/decisiones/0068). Estado de interfaz (no entra en el proyecto ni en deshacer).
 * Sigue a la zona en edición (elegir una zona en el visor o en el paso Zonas la muestra en el resumen); elegir un chip
 * no cambia la zona en edición: así no se mueven sin querer los parámetros que se están editando.
 */
import { create } from 'zustand';
import { useUi } from '../store/ui';

interface GlanceStore {
  /** null = todas las zonas. */
  zoneId: string | null;
  set(zoneId: string | null): void;
}

export const useGlance = create<GlanceStore>()((set) => ({
  zoneId: null,
  set: (zoneId) => set({ zoneId }),
}));

useUi.subscribe((s, prev) => {
  if (s.editingZoneId !== prev.editingZoneId) useGlance.setState({ zoneId: s.editingZoneId });
});
