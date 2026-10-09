/**
 * Plantillas de fábrica de pistas por espacio de trabajo. Puro.
 * Las del usuario (fase 7) se guardan en `Project.display.layouts[espacio]` y reemplazan a estas.
 *
 * Convenciones de lectura (docs/decisiones/0004 D4 y 0005):
 * - Correlación: GR con relleno arcilla (del borde izquierdo a la curva: crece con GR, como IGR y VSH) y arena (de la
 *   curva al borde derecho), y curva de respaldo; caliper vs. trépano con relleno de derrumbe comparando VALORES
 *   (CALI > BS), que sigue bien aunque el usuario cambie la escala de una de las dos.
 * - Resistividad en log 0,2–2000 por décadas; profunda roja y más gruesa (encima de las demás).
 * - Densidad–neutrón en escalas compatibles (RHOB 1,95–2,95; NPHI 0,45 → −0,15): cruce de gas en amarillo donde la
 *   densidad queda a la izquierda del neutrón; separación de arcilla donde el neutrón queda a la izquierda.
 * - Las curvas se dibujan en el orden listado: la última queda encima.
 */
import type { TrackSpec } from '../core/display';
import type { WorkspaceId } from '../core/workspaces';
import type { ViewerOverlay } from './overlay';

const RESISTIVITY_SCALE = { kind: 'log', min: 0.2, max: 2000 } as const;

export const BUILTIN_LAYOUTS: Readonly<Record<WorkspaceId, readonly TrackSpec[]>> = {
  petrophysics: [
    {
      id: 'correlation',
      title: 'Correlación',
      kind: 'curves',
      curves: [{ select: { role: 'BS' } }, { select: { role: 'CALI' } }, { select: { role: 'SP' } }, { select: { role: 'GR' }, style: { wrap: true } }],
      fills: [
        { kind: 'edge', curve: 'GR', side: 'left', fill: 'shale', opacity: 0.32 },
        { kind: 'edge', curve: 'GR', side: 'right', fill: 'sand', opacity: 0.45 },
        { kind: 'between', a: 'BS', b: 'CALI', aLeft: 'washout', compare: 'value', opacity: 1 },
      ],
      emptyHint: 'Asigná GR, SP o caliper a alguna curva del pozo.',
    },
    { id: 'depth', title: 'Prof.', kind: 'depth' },
    {
      id: 'resistivity',
      title: 'Resistividad',
      kind: 'curves',
      scale: RESISTIVITY_SCALE,
      curves: [{ select: { role: 'RXO' } }, { select: { unassigned: 'resistivity' } }, { select: { role: 'RS' } }, { select: { role: 'RM' } }, { select: { role: 'RT' } }],
      emptyHint: 'Sin resistividades: asigná Rt (AT90, ILD…) en la lista de curvas.',
    },
    {
      id: 'porosity',
      title: 'Densidad · neutrón',
      kind: 'curves',
      width: 1.1,
      // PE y DRHO más finos: acompañan, no compiten con el par densidad–neutrón.
      curves: [{ select: { role: 'DRHO' }, style: { width: 1 } }, { select: { role: 'PEF' }, style: { width: 1 } }, { select: { role: 'NPHI' } }, { select: { role: 'RHOB' } }],
      fills: [{ kind: 'between', a: 'RHOB', b: 'NPHI', aLeft: 'gasCrossover', bLeft: 'shaleCrossover', opacity: 1 }],
      emptyHint: 'Sin densidad ni neutrón en este pozo.',
    },
    { id: 'sonic', title: 'Sónico', kind: 'curves', width: 0.8, curves: [{ select: { role: 'DT' } }, { select: { role: 'DTS' } }], emptyHint: 'Sin sónico en este pozo.' },
    {
      id: 'computed',
      title: 'Interpretación',
      kind: 'curves',
      // IGR continua en su propia pista (la paleta la raya para distinguirla de GR cuando comparten pista).
      curves: [{ select: { role: 'VSH' } }, { select: { role: 'IGR' }, style: { line: 'solid' } }],
      fills: [
        { kind: 'edge', curve: 'IGR', side: 'left', fill: 'shale', opacity: 0.35 },
        { kind: 'edge', curve: 'VSH', side: 'left', fill: 'shale', opacity: 0.6 },
      ],
      collect: 'computed',
      emptyHint: 'Las curvas calculadas aparecen acá. Empezá por el paso Arcilla.',
    },
    {
      id: 'saturation',
      title: 'Porosidad · Sw',
      kind: 'curves',
      curves: [{ select: { role: 'BVW' } }, { select: { role: 'SW' } }, { select: { role: 'PHIE' } }],
      fills: [{ kind: 'edge', curve: 'SW', side: 'left', fill: 'hydrocarbon', opacity: 0.6 }],
      hideWhenEmpty: true,
    },
    { id: 'permeability', title: 'Permeabilidad', kind: 'curves', width: 0.8, scale: { kind: 'log', min: 0.01, max: 10000 }, curves: [{ select: { role: 'PERM' } }], hideWhenEmpty: true },
    { id: 'flags', title: 'Banderas', kind: 'flags', collect: 'flags', hideWhenEmpty: true },
  ],
  geology: [
    {
      id: 'spectral',
      title: 'GR espectral',
      kind: 'curves',
      curves: [{ select: { role: 'POTA' } }, { select: { role: 'THOR' } }, { select: { role: 'URAN' } }, { select: { role: 'CGR' } }, { select: { role: 'GR' }, style: { wrap: true } }],
      fills: [{ kind: 'edge', curve: 'GR', side: 'left', fill: 'shale', opacity: 0.3 }],
      emptyHint: 'Sin rayos gamma en este pozo.',
    },
    { id: 'depth', title: 'Prof.', kind: 'depth' },
    {
      id: 'lithology',
      title: 'Litología',
      kind: 'curves',
      width: 1.1,
      curves: [{ select: { role: 'PEF' } }, { select: { role: 'NPHI' } }, { select: { role: 'RHOB' } }],
      fills: [{ kind: 'between', a: 'RHOB', b: 'NPHI', aLeft: 'gasCrossover', bLeft: 'shaleCrossover', opacity: 1 }],
      emptyHint: 'Sin densidad, neutrón ni PE en este pozo.',
    },
    { id: 'sonic', title: 'Sónico', kind: 'curves', width: 0.8, curves: [{ select: { role: 'DT' } }, { select: { role: 'DTS' } }], emptyHint: 'Sin sónico en este pozo.' },
    {
      id: 'nmr',
      title: 'RMN',
      kind: 'curves',
      curves: [{ select: { role: 'BVI_NMR' } }, { select: { role: 'PHIE_NMR' } }, { select: { role: 'PHIT_NMR' } }],
      fills: [
        { kind: 'edge', curve: 'BVI_NMR', side: 'left', fill: 'boundWater', opacity: 0.8 },
        { kind: 'between', a: 'BVI_NMR', b: 'PHIE_NMR', aLeft: 'water', opacity: 0.6 },
      ],
      emptyHint: 'Sin resonancia magnética en este pozo.',
    },
    { id: 'computed', title: 'Interpretación', kind: 'curves', curves: [{ select: { role: 'IGR' }, style: { line: 'solid' } }], collect: 'computed', hideWhenEmpty: true },
    { id: 'flags', title: 'Banderas', kind: 'flags', collect: 'flags', hideWhenEmpty: true },
  ],
};

/** Pistas de un espacio de trabajo: las propias del proyecto o las de fábrica. */
export function layoutFor(workspace: WorkspaceId, custom: Readonly<Record<string, readonly TrackSpec[]>> | undefined): readonly TrackSpec[] {
  return custom?.[workspace] ?? BUILTIN_LAYOUTS[workspace];
}

/** Id de la pista propia de una superposición. */
export const overlayTrackId = (overlayId: string): string => `ov:${overlayId}`;

/**
 * Suma a un juego de pistas las pistas propias de las superposiciones (`overlay.track`) que no estén ya, en el lugar
 * que piden (`after`), y quita las pistas 'overlay' cuya superposición no existe (un proyecto guardado con un módulo
 * que esta versión no tiene). Puro.
 */
export function withOverlayTracks(layout: readonly TrackSpec[], overlays: readonly ViewerOverlay[], workspace: string): TrackSpec[] {
  const ids = new Set(overlays.map((o) => o.id));
  const out = layout.filter((t) => t.kind !== 'overlay' || (t.overlayId !== undefined && ids.has(t.overlayId)));
  for (const o of overlays) {
    const d = o.track;
    if (!d || (d.workspaces && !d.workspaces.includes(workspace))) continue;
    if (out.some((t) => t.kind === 'overlay' && t.overlayId === o.id)) continue;
    const spec: TrackSpec = {
      id: overlayTrackId(o.id),
      title: d.title,
      kind: 'overlay',
      overlayId: o.id,
      width: d.width ?? 1,
      scale: { kind: d.scale.kind, min: d.scale.min, max: d.scale.max, ...(d.scale.reversed !== undefined ? { reversed: d.scale.reversed } : {}) },
      ...(d.unit !== undefined ? { unit: d.unit } : {}),
    };
    const at = d.after ? out.findIndex((t) => t.id === d.after) : -1;
    if (at >= 0) out.splice(at + 1, 0, spec);
    else out.push(spec);
  }
  return out;
}
