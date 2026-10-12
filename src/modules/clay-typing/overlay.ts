/** Pista de banderas U alto, descubierta automáticamente; usa la salida del motor y distingue ausencia de dato. */
import type { ViewerOverlay } from '../../viewer/overlay';

export const overlays: ViewerOverlay[] = [{
  id: 'clay-high-u', label: 'Uranio alto', layer: 'under', order: 56,
  track: {
    title: 'U alto', width: 0.3, after: 'spectral', workspaces: ['geology'],
    scale: { kind: 'linear', min: 0, max: 1 }, unit: 'unitless',
    resolve({ well }) { return well.curves.some(c => c.role === 'URAN') ? { title: 'U alto', scale: { kind: 'linear', min: 0, max: 1 }, unit: 'unitless' } : null; },
  },
  draw({ ctx, tracks, data, viewport, theme }) {
    const t = tracks.find(t => t.overlayId === 'clay-high-u');
    const c = data.computed.find(c => c.port === 'IND_HIGH_U' && c.active);
    if (!t || !c) return;
    ctx.save(); ctx.beginPath(); ctx.rect(t.x, 0, t.width, viewport.height); ctx.clip();
    for (let i = 0; i < data.depth.length; i++) {
      const top = i ? (data.depth[i-1]+data.depth[i])/2 : data.depth[i];
      const base = i+1 < data.depth.length ? (data.depth[i]+data.depth[i+1])/2 : data.depth[i];
      if (base < viewport.top || top > viewport.base) continue;
      if (c.data[i] === 1) { ctx.fillStyle = '#ad44a2'; ctx.fillRect(t.x+2, viewport.yOf(top), t.width-4, Math.max(1, viewport.yOf(base)-viewport.yOf(top))); }
      else if (!Number.isFinite(c.data[i])) { ctx.fillStyle = theme.viewer.gridMajor; ctx.fillRect(t.x+2, viewport.yOf(top), t.width-4, Math.max(1, viewport.yOf(base)-viewport.yOf(top))); }
    }
    ctx.restore();
  },
  hit({ data }, p) {
    if (p.track?.overlayId !== 'clay-high-u') return null;
    const c = data.computed.find(c => c.port === 'IND_HIGH_U' && c.active);
    let best = 0, dist = Infinity;
    for (let i = 0; i < data.depth.length; i++) { const d = Math.abs(data.depth[i]-p.depth); if (d < dist) { dist = d; best = i; } }
    const value = c?.data[best];
    return { label: value === 1 ? 'Uranio alto: confirmar contexto orgánico o inundación máxima con otros datos.' : value === 0 ? 'Uranio por debajo del umbral configurado.' : 'Sin dato de uranio o sin cálculo.', cursor: 'default' };
  },
}];
