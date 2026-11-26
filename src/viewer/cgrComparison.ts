/**
 * Pista «GR · CGR» (docs/decisiones/0090): GR total y CGR sin uranio en la misma escala (0–150 gAPI),
 * sombreado donde el uranio aporta radiactividad (CGR < GR). Puro: sin React ni stores.
 */
import type { TrackSpec } from '../core/display';
import type { Project } from '../core/state/project';
import { addTrack, updateTrackLayout } from '../core/state/tracks';

export const CGR_COMPARISON_TRACK_ID = 'cgr-comparison';

export const CGR_COMPARISON_TRACK: TrackSpec = {
  id: CGR_COMPARISON_TRACK_ID,
  title: 'GR · CGR',
  kind: 'curves',
  width: 1,
  scale: { kind: 'linear', min: 0, max: 150 },
  curves: [
    { select: { role: 'CGR' }, style: { width: 1.5 } },
    { select: { role: 'GR' }, style: { wrap: true } },
  ],
  fills: [{ kind: 'between', a: 'CGR', b: 'GR', aLeft: 'uraniumExcess', compare: 'value', opacity: 1 }],
  emptyHint: 'Sin GR ni CGR: cargá rayos gamma y el espectral (Th, K, U).',
};

/** ¿La pista ya compara GR y CGR directamente (sin ser la pista espectral completa K/Th/U)? */
export const isCgrComparisonTrack = (t: Pick<TrackSpec, 'id' | 'curves'>): boolean =>
  t.id === CGR_COMPARISON_TRACK_ID ||
  ((t.curves ?? []).some((e) => 'role' in e.select && e.select.role === 'CGR') &&
    (t.curves ?? []).some((e) => 'role' in e.select && e.select.role === 'GR') &&
    !(t.curves ?? []).some((e) => 'role' in e.select && (e.select.role === 'THOR' || e.select.role === 'POTA' || e.select.role === 'URAN')));

/**
 * Receta de «Ver CGR frente a GR»: agrega la pista «GR · CGR» inmediatamente después de Correlación
 * (o antes de Profundidad si no está Correlación; si tampoco, al principio). Idempotente.
 */
export function showCgrComparisonRecipe(project: Project, workspace: string, current: readonly TrackSpec[]): Project {
  return updateTrackLayout(project, workspace, current, (tracks) => {
    if (tracks.some(isCgrComparisonTrack)) return tracks;
    const corr = tracks.findIndex((t) => t.id === 'correlation');
    const before = corr >= 0 ? (tracks[corr + 1]?.id ?? null) : (tracks.find((t) => t.id === 'depth')?.id ?? tracks[0]?.id ?? null);
    return addTrack(tracks, CGR_COMPARISON_TRACK, before);
  });
}
