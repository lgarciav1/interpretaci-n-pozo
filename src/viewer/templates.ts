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
import type { StackSpec, TrackSpec } from '../core/display';
import type { WorkspaceId } from '../core/workspaces';
import { guard, type OverlayTrackContext, type ViewerOverlay } from './overlay';

const RESISTIVITY_SCALE = { kind: 'log', min: 0.2, max: 2000 } as const;

/**
 * Columna volumétrica (de izquierda a derecha, como ELAN/Techlog): arcilla = VSH, matriz = 1 − VSH − PHIE y la
 * porosidad PHIE partida en agua = PHIE·SW e hidrocarburo = PHIE·(1 − SW). Nunca usa IGR como VSH.
 */
export const VOLUMETRIC_STACK: StackSpec = {
  components: [
    { id: 'shale', label: 'Arcilla', fill: 'shale', factors: [{ role: 'VSH' }] },
    { id: 'matrix', label: 'Matriz', fill: 'sand', rest: true, partialLabel: 'Resto sin partir', partialShort: 'Resto', partialFill: 'undivided' },
    {
      id: 'pore',
      label: 'Porosidad',
      fill: 'pore',
      factors: [{ role: 'PHIE' }],
      children: [
        { id: 'water', label: 'Agua', fill: 'water', factors: [{ role: 'SW' }] },
        { id: 'hydrocarbon', label: 'Hidrocarburo', short: 'Hidroc.', fill: 'hydrocarbon', factors: [{ role: 'SW', complement: true }] },
      ],
    },
  ],
};

/** Dónde se calcula cada entrada de la pila volumétrica (para el estado vacío). */
export const STACK_ROLE_HINTS: Readonly<Record<string, string>> = { VSH: 'paso Arcilla', PHIE: 'paso Porosidad', SW: 'paso Saturación' };

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
      curves: [{ select: { role: 'RXO' } }, { select: { unassigned: 'resistivity' } }, { select: { role: 'RA10' } }, { select: { role: 'RA20' } }, { select: { role: 'RA30' } }, { select: { role: 'RS' } }, { select: { role: 'RM' } }, { select: { role: 'RT' } }],
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
    { id: 'volumetric', title: 'Litología', kind: 'stack', width: 0.85, stack: VOLUMETRIC_STACK },
    { id: 'permeability', title: 'Permeabilidad', kind: 'curves', width: 0.8, scale: { kind: 'log', min: 0.01, max: 10000 }, curves: [{ select: { role: 'PERM' } }], hideWhenEmpty: true },
    { id: 'flags', title: 'Banderas', kind: 'flags', collect: 'flags', hideWhenEmpty: true },
    {
      id: 'indicators',
      title: 'Indicadores',
      kind: 'flags',
      // Banderas de los indicadores automáticos (fase 7c, 0017): gas, arcilla, carbón y derrumbe. Van por rol, así
      // el recolector de «Banderas» no las duplica.
      curves: [{ select: { role: 'IND_GAS' } }, { select: { role: 'IND_SHALE' } }, { select: { role: 'IND_COAL' } }, { select: { role: 'IND_WASHOUT' } }],
      hideWhenEmpty: true,
    },
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

/** Contexto para resolver las pistas propias dinámicas: pozo activo y ajustes por superposición. */
export interface OverlayTracksContext {
  well: OverlayTrackContext['well'] | null;
  settings?: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;
}

const scaleSpec = (sc: { kind: 'linear' | 'log'; min: number; max: number; reversed?: boolean }): NonNullable<TrackSpec['scale']> => ({
  kind: sc.kind,
  min: sc.min,
  max: sc.max,
  ...(sc.reversed !== undefined ? { reversed: sc.reversed } : {}),
});

/**
 * Suma a un juego de pistas las pistas propias de las superposiciones (`overlay.track`) que no estén ya, en el lugar
 * que piden (`after`), y quita las pistas 'overlay' cuya superposición no existe (un proyecto guardado con un módulo
 * que esta versión no tiene). Con `ctx`, las pistas con `track.resolve` toman su escala, unidad y título del pozo
 * (si `resolve` devuelve null, la pista no se muestra). Puro.
 */
export function withOverlayTracks(layout: readonly TrackSpec[], overlays: readonly ViewerOverlay[], workspace: string, ctx?: OverlayTracksContext): TrackSpec[] {
  const ids = new Set(overlays.map((o) => o.id));
  /** Estado dinámico por superposición (undefined = sin `resolve` o sin contexto; null = ocultar la pista). */
  const states = new Map<string, ReturnType<NonNullable<NonNullable<ViewerOverlay['track']>['resolve']>> | undefined>();
  for (const o of overlays) {
    const r = o.track?.resolve;
    if (!r || !ctx) continue;
    const well = ctx.well;
    const st = well ? guard(o.id, 'track.resolve', () => r({ well, settings: ctx.settings?.[o.id] ?? {} })) : null;
    const ok = st === null || (st !== undefined && st.scale && st.scale.max > st.scale.min && (st.scale.kind !== 'log' || st.scale.min > 0));
    states.set(o.id, ok ? st : undefined);
  }
  const out: TrackSpec[] = [];
  for (const t of layout) {
    if (t.kind !== 'overlay') {
      out.push(t);
      continue;
    }
    if (t.overlayId === undefined || !ids.has(t.overlayId)) continue;
    const st = states.get(t.overlayId);
    if (st === null) continue;
    out.push(st ? { ...t, scale: scaleSpec(st.scale), ...(st.unit !== undefined ? { unit: st.unit } : {}), ...(st.title ? { title: st.title } : {}) } : t);
  }
  for (const o of overlays) {
    const d = o.track;
    if (!d || (d.workspaces && !d.workspaces.includes(workspace))) continue;
    if (layout.some((t) => t.kind === 'overlay' && t.overlayId === o.id)) continue;
    const st = states.get(o.id);
    if (st === null) continue;
    const unit = st?.unit ?? d.unit;
    const spec: TrackSpec = {
      id: overlayTrackId(o.id),
      title: st?.title ?? d.title,
      kind: 'overlay',
      overlayId: o.id,
      width: d.width ?? 1,
      scale: scaleSpec(st?.scale ?? d.scale),
      ...(unit !== undefined ? { unit } : {}),
    };
    const at = d.after ? out.findIndex((t) => t.id === d.after) : -1;
    if (at >= 0) out.splice(at + 1, 0, spec);
    else out.push(spec);
  }
  return out;
}
