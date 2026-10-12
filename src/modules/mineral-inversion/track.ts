/** Columna de volúmenes bulk usando el contrato de pila volumétrica existente, sin sustituir VSH ni PHIE. */
import type { TrackSpec } from '../../core/display';
import { VOLUME_ROLES, VOLUME_LABELS } from './index';

// Rellenos convencionales del visor (ids del catálogo, no colores hexadecimales).
const MINERAL_FILLS = ['sand', 'limestone', 'dolomite', 'shale', 'pore'] as const;

export const MINERAL_TRACK: TrackSpec = {
  id: 'mineral-volumetric', title: 'Mineralogía', kind: 'stack', width: 1.1,
  stack: { components: VOLUME_ROLES.map((role,i) => ({ id: role.toLowerCase(), label: VOLUME_LABELS[i], fill: MINERAL_FILLS[i], factors: [{ role }] })) },
};
