import { create } from 'zustand';
/**
 * Estado de interfaz de la preparación que lee la app (no se guarda en el proyecto):
 * - `compareOriginals`: el visor y las figuras muestran originales y preparadas juntas (solo vista).
 * - `request`: curva (y herramienta, p. ej. «normalize») pedida al abrir el panel «Preparar datos» (columna izquierda,
 *   paleta); el panel la toma y la limpia. `seq` distingue dos pedidos iguales seguidos.
 */
export const usePreparationUi = create<{ compareOriginals: boolean; request: { curveId: string | null; seq: number; tool?: string | null } | null }>(() => ({ compareOriginals: false, request: null }));
