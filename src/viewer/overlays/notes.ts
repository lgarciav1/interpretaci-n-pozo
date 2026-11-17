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
      const items: { note: DepthNote; x: number; anchorY: number; y: number; width: number; height: number; lines: string[] }[] = [];
      ctx.save();
      ctx.font = `${11 * scale}px ${BASE_TOKENS.font.sans}`;
      for (const original of notes(f)) {
        const d = f.data.depth;
        const delta = preview?.id === original.id && f.purpose !== 'export' ? Math.min(d[d.length - 1]! - (original.base ?? original.top), Math.max(d[0]! - original.top, preview.delta)) : 0;
        const n = { ...original, top: original.top + delta, ...(original.base !== undefined ? { base: original.base + delta } : {}) };
        if (n.top > viewport.base || (n.base ?? n.top) < viewport.top) continue;
        const { x, y } = position(f, n);
        const maxWidth = Math.max(40, Math.min(270 * scale, (f.tracks.at(-1)?.x ?? x + 280) + (f.tracks.at(-1)?.width ?? 0) - x - 12));
        const lines: string[] = [];
        const header = `${n.top.toFixed(2)}${n.base !== undefined ? `–${n.base.toFixed(2)}` : ''} m MD`;
        // Encabezado y cuerpo comparten medición y ajuste: ninguno desborda el fondo interactivo.
        for (const paragraph of [header, ...n.text.split('\n')]) {
          let current = '';
          for (const char of paragraph) { if (current && ctx.measureText(current + char).width > maxWidth) { lines.push(current); current = ''; } current += char; }
          lines.push(current);
        }
        const width = Math.max(30, ...lines.map(t => ctx.measureText(t).width)) + 12;
        items.push({ note: n, x, anchorY: y, y: Math.max(2, y), width, height: lines.length * line + 6, lines });
      }
      items.sort((a, b) => a.note.top - b.note.top);
      const gap = 4 * scale;
      const needed = items.reduce((sum, item) => sum + item.height, 0) + Math.max(0, items.length - 1) * gap;
      if (needed <= viewport.height - 4) {
        // Separar hacia abajo y luego redistribuir hacia arriba al alcanzar el borde inferior.
        let bottom = 2 - gap;
        for (const item of items) { item.y = Math.max(item.y, bottom + gap); bottom = item.y + item.height; }
        let nextY = viewport.height - 2 + gap;
        for (const item of [...items].reverse()) { item.y = Math.min(item.y, nextY - gap - item.height); nextY = item.y; }
      } else {
        // Densidad mayor que el espacio disponible: conservar anclajes y acceso al listado/teclado.
        for (const item of items) item.y = Math.max(2, Math.min(item.y, viewport.height - item.height - 2));
      }
      for (const { note: n, x, y: labelY, anchorY, width, height, lines } of items) {
        boxes.push({ id: n.id, x, y: labelY, width, height });
        ctx.fillStyle = theme.color.surface; ctx.strokeStyle = theme.color.text;
        ctx.lineWidth = 1; ctx.setLineDash([]); ctx.textAlign = 'left';
        ctx.fillRect(x, labelY, width, height); ctx.strokeRect(x, labelY, width, height);
        ctx.fillStyle = theme.color.text; ctx.textBaseline = 'top';
        lines.forEach((t, i) => ctx.fillText(t, x + 6, labelY + 3 + i * line));
        if (labelY !== anchorY) { ctx.beginPath(); ctx.moveTo(x - 4, Math.max(0, anchorY)); ctx.lineTo(x, labelY); ctx.stroke(); }
        if (n.base !== undefined) {
          const bottom = viewport.yOf(n.base);
          ctx.beginPath(); ctx.moveTo(x - 4, anchorY); ctx.lineTo(x - 4, bottom); ctx.lineTo(x + 3, bottom); ctx.stroke();
        }
      }
      ctx.restore();
    },
    hit(f, p) {
      // El último rectángulo pintado es el visible cuando no alcanza el espacio para separarlos.
      for (const box of [...boxes].reverse()) {
        if (p.x < box.x - 6 || p.x > box.x + box.width || p.y < box.y || p.y > box.y + box.height) continue;
        const n = notes(f).find(n => n.id === box.id);
        if (n) return hit(f, n);
      }
      return null;
    },
    targets: f => notes(f).map(n => ({ depth: n.top, hit: { ...hit(f, n), key: n.id } })),
  };
}
