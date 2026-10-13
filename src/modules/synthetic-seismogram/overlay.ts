/** Pistas acústicas nativas y cuatro repeticiones del sintético, con área variable positiva y huecos explícitos. */
import type { ViewerOverlay } from '../../viewer/overlay';
import type { TrackSpec } from '../../core/display';
import { drawWiggle } from './draw';

const available = (well: { curves: readonly { role: string | null }[] }) => ['DT', 'RHOB'].every(role => well.curves.some(curve => curve.role === role));
const acousticTrack = (id: string, title: string, role: string, min: number, max: number, unit: string, after: string): ViewerOverlay => {
  const spec: TrackSpec = { id, title, kind: 'curves', width: 0.7, curves: [{ select: { role } }], scale: { kind: 'linear', min, max }, hideWhenEmpty: true };
  return { id, label: title, layer: 'under', track: { spec, title, width: 0.7, after, workspaces: ['geology'], scale: { kind: 'linear', min, max }, unit, resolve: ({ well }) => available(well) ? { scale: { kind: 'linear', min, max }, unit } : null }, draw() {} };
};
export const SYNTHETIC_OVERLAY = 'synthetic-wiggle';
export const overlays: ViewerOverlay[] = [
  acousticTrack('acoustic-impedance', 'Impedancia acústica', 'AI', 0, 30, 'MRayl', 'mineral-volumetric'),
  acousticTrack('acoustic-reflectivity', 'Reflectividad', 'RC', -0.5, 0.5, 'unitless', 'acoustic-impedance'),
  {
    id: SYNTHETIC_OVERLAY, label: 'Sismograma sintético', layer: 'over',
    track: { title: 'Sintético · 4 repeticiones', width: 1.2, after: 'acoustic-reflectivity', workspaces: ['geology'], scale: { kind: 'linear', min: -1, max: 1 }, unit: 'unitless', resolve: ({ well }) => available(well) ? { scale: { kind: 'linear', min: -1, max: 1 }, unit: 'unitless' } : null },
    draw({ ctx, tracks, data, viewport, theme }) {
      const track = tracks.find(track => track.overlayId === SYNTHETIC_OVERLAY);
      const curve = data.computed.find(curve => curve.port === 'SYNTHETIC' && curve.active);
      if (!track || !curve) return;
      drawWiggle(ctx, data.depth, curve.data, { x: track.x, width: track.width, top: viewport.top, base: viewport.base, height: viewport.height, yOf: viewport.yOf }, theme.color.text);
    },
    hit({ data }, pointer) {
      if (pointer.track?.overlayId !== SYNTHETIC_OVERLAY) return null;
      const curve = data.computed.find(curve => curve.port === 'SYNTHETIC' && curve.active);
      let nearest = 0;
      for (let index = 1; index < data.depth.length; index++) if (Math.abs(data.depth[index] - pointer.depth) < Math.abs(data.depth[nearest] - pointer.depth)) nearest = index;
      const value = curve?.data[nearest];
      return { cursor: 'default', label: typeof value === 'number' && Number.isFinite(value) ? `Sintético: ${value.toFixed(4)} · misma traza repetida cuatro veces, amplitud normalizada para dibujo.` : 'Sin amplitud válida: hueco o tiempo acumulado desconocido.' };
    },
  },
];
