import type { DepthNote } from '../../core/notes';
import { moveNote } from '../../core/state/notes';
import { BASE_TOKENS } from '../../ui/tokens';
import type { OverlayHitFrame, OverlayHit, ViewerOverlay } from '../overlay';

/** Instancias separadas en pantalla/exportación: la vista previa nunca cambia el proyecto. */
export function createNotesOverlay(): ViewerOverlay {
  let boxes: { id: string; x: number; y: number; width: number; height: number }[] = [];
  let preview: { id: string; delta: number } | null = null;
  const notes = (f: OverlayHitFrame) => f.data.interpretation.notes ?? [];
  const position = (f: OverlayHitFrame, n: DepthNote) => {
    const first = f.tracks.find(t => t.kind !== 'depth') ?? f.tracks[0];
    return { x: (first?.x ?? 0) + 8, y: f.viewport.yOf(n.top) };
  };
  const hit = (f: OverlayHitFrame, n: DepthNote): OverlayHit => ({
    key: n.id, label: `Nota · ${n.top.toFixed(2)}${n.base !== undefined ? `–${n.base.toFixed(2)}` : ''} m MD · ${n.text}`,
    cursor: 'ns-resize',
    ...(f.data.commit ? {
      nudge: (delta: number) => f.data.commit!('Mover nota', p => moveNote(p, f.data.wellId, n.id, delta)),
      drag: {
        move(p, start) { preview = { id: n.id, delta: p.depth - start.depth }; f.invalidate(); },
        end(p, start) { preview = null; f.data.commit!('Mover nota', project => moveNote(project, f.data.wellId, n.id, p.depth - start.depth)); f.invalidate(); },
        cancel() { preview = null; f.invalidate(); },
      },
    } : {}),
  });
  return {
    id: 'depth-notes', label: 'Notas de profundidad', layer: 'over', order: 100,
    draw(f) {
      const { ctx, theme, viewport } = f;
      const scale = f.uiScale ?? 1, line = 15 * scale;
      boxes = [];
      let lastBottom = -4;
      for (const original of [...notes(f)].sort((a, b) => a.top - b.top)) {
        const d = f.data.depth;
        const delta = preview?.id === original.id && f.purpose !== 'export' ? Math.min(d[d.length - 1]! - (original.base ?? original.top), Math.max(d[0]! - original.top, preview.delta)) : 0;
        const n = { ...original, top: original.top + delta, ...(original.base !== undefined ? { base: original.base + delta } : {}) };
        if (n.top > viewport.base || (n.base ?? n.top) < viewport.top) continue;
        const { x, y } = position(f, n);
        let labelY = Math.max(2, y, lastBottom + 4);
        ctx.save();
        ctx.font = `${11 * scale}px ${BASE_TOKENS.font.sans}`;
        const maxWidth = Math.max(40, Math.min(270 * scale, (f.tracks.at(-1)?.x ?? x + 280) + (f.tracks.at(-1)?.width ?? 0) - x - 12));
        const lines: string[] = [];
        for (const paragraph of n.text.split('\n')) {
          let current = '';
          for (const char of paragraph) { if (current && ctx.measureText(current + char).width > maxWidth) { lines.push(current); current = ''; } current += char; }
          lines.push(current);
        }
        const width = Math.min(maxWidth, Math.max(30, ...lines.map(t => ctx.measureText(t).width))) + 12;
        const height = (lines.length + 1) * line + 6;
        labelY = Math.max(2, Math.min(labelY, viewport.height - height - 2));
        boxes.push({ id: n.id, x, y: labelY, width, height });
        lastBottom = labelY + height;
        ctx.fillStyle = theme.color.surface; ctx.strokeStyle = theme.color.text;
        ctx.lineWidth = 1; ctx.setLineDash([]); ctx.textAlign = 'left';
        ctx.fillRect(x, labelY, width, (lines.length + 1) * line + 6);
        ctx.strokeRect(x, labelY, width, (lines.length + 1) * line + 6);
        ctx.fillStyle = theme.color.text; ctx.textBaseline = 'top';
        ctx.fillText(`${n.top.toFixed(2)}${n.base !== undefined ? `–${n.base.toFixed(2)}` : ''} m MD`, x + 6, labelY + 3);
        lines.forEach((t, i) => ctx.fillText(t, x + 6, labelY + 3 + (i + 1) * line));
        if (labelY !== y) { ctx.beginPath(); ctx.moveTo(x - 4, Math.max(0, y)); ctx.lineTo(x, labelY); ctx.stroke(); }
        if (n.base !== undefined) {
          const bottom = viewport.yOf(n.base);
          ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x - 4, bottom); ctx.lineTo(x + 3, bottom); ctx.stroke();
        }
        ctx.restore();
      }
    },
    hit(f, p) {
      for (const n of [...notes(f)].reverse()) {
        const box = boxes.find(b => b.id === n.id);
        if (box && p.x >= box.x - 6 && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height) return hit(f, n);
      }
      return null;
    },
    targets: f => notes(f).map(n => ({ depth: n.top, hit: { ...hit(f, n), key: n.id } })),
  };
}
