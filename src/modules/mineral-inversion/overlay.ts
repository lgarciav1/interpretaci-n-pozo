/** Pista mineral autodescubierta mediante el contrato genérico de superposiciones. */
import type { ViewerOverlay } from '../../viewer/overlay';
import { MINERAL_TRACK } from './track';

export const MINERAL_OVERLAY_ID = 'mineral-volumetric';
export const overlays: ViewerOverlay[] = [{
  id: MINERAL_OVERLAY_ID, label: 'Columna mineral', layer: 'under',
  track: {
    title: MINERAL_TRACK.title, spec: MINERAL_TRACK,
    scale: { kind: 'linear', min: 0, max: 1 }, unit: 'v/v', width: 1.1,
    after: 'lithology', workspaces: ['geology'],
    resolve({ well }) {
      const roles = new Set(well.curves.map(c => c.role));
      return ['RHOB', 'PEF', 'NPHI', 'GR'].every(r => roles.has(r))
        ? { scale: { kind: 'linear', min: 0, max: 1 }, unit: 'v/v' } : null;
    },
  },
  // La pila, leyenda, cursor y exportación los dibuja el renderizador nativo.
  draw() {},
}];
