/**
 * Vista opcional de Petrofísica: selección explícita de curvas, sin recolectores.
 * Se guarda como cualquier plantilla de pistas (display), sin alterar fuentes ni cálculo.
 * La plantilla de fábrica de templates.ts permanece intacta.
 */
import type { TrackSpec } from '../core/display';

export const ESSENTIAL_NAME = 'Petrofísica esencial';

const ESSENTIAL_TRACKS: readonly TrackSpec[] = [
  {
    id: 'correlation', title: 'GR', kind: 'curves',
    curves: [{ select: { role: 'GR' }, style: { wrap: true } }],
    fills: [
      { kind: 'edge', curve: 'GR', side: 'left', fill: 'shale', opacity: 0.16 },
      { kind: 'edge', curve: 'GR', side: 'right', fill: 'sand', opacity: 0.22 },
    ],
    emptyHint: 'Asigná GR a una curva del pozo.',
  },
  { id: 'depth', title: 'Prof.', kind: 'depth' },
  {
    id: 'resistivity', title: 'Resistividad', kind: 'curves', width: 1.25,
    scale: { kind: 'log', min: 0.2, max: 2000 },
    curves: [{ select: { role: 'RXO' } }, { select: { role: 'RM' } }, { select: { role: 'RT' } }],
    emptyHint: 'Asigná las resistividades del pozo.',
  },
  {
    id: 'porosity', title: 'Dens. · neutrón', kind: 'curves', width: 1.5,
    curves: [{ select: { role: 'NPHI' } }, { select: { role: 'RHOB' } }],
    fills: [{ kind: 'between', a: 'RHOB', b: 'NPHI', aLeft: 'gasCrossover', bLeft: 'shaleCrossover', opacity: 0.3 }],
    emptyHint: 'Asigná densidad y neutrón.',
  },
  {
    id: 'clay', title: 'Arcilla', kind: 'curves',
    curves: [{ select: { role: 'VSH' } }],
    fills: [{ kind: 'edge', curve: 'VSH', side: 'left', fill: 'shale', opacity: 0.22 }],
    hideWhenEmpty: true,
  },
  {
    id: 'effective-porosity', title: 'Porosidad', kind: 'curves',
    curves: [{ select: { role: 'PHIE' } }], hideWhenEmpty: true,
  },
  {
    id: 'saturation', title: 'Sw', kind: 'curves',
    curves: [{ select: { role: 'SW' } }], hideWhenEmpty: true,
  },
  {
    id: 'permeability', title: 'Permeabilidad', kind: 'curves',
    scale: { kind: 'log', min: 0.01, max: 10000 },
    curves: [{ select: { role: 'PERM' } }], hideWhenEmpty: true,
  },
  {
    id: 'indicators', title: 'Indicadores', kind: 'flags',
    curves: [{ select: { role: 'IND_GAS' } }, { select: { role: 'IND_WASHOUT' } }, { select: { role: 'NET_PAY' } }],
    hideWhenEmpty: true,
  },
];

/** Copia independiente: editar/guardar una vista nunca modifica la definición del preset. */
export function essentialPetrophysicsLayout(): TrackSpec[] {
  return structuredClone(ESSENTIAL_TRACKS) as TrackSpec[];
}
