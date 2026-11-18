/** Calco de una curva resuelta. Las copias pertenecen exclusivamente a esta instancia del visor. */
import { sourceRefEquals, type SourceRef } from '../../core/interpretation';
import { formatNumber } from '../../ui/format';
import { visibleRange } from '../decimate';
import type { OverlayHit, OverlayHitFrame, OverlayTrack, ViewerOverlay } from '../overlay';
import type { ResolvedCurve } from '../resolve';
import { fractionArray, scaleKey, wrapFractionArray } from '../scale';
import { nearestIndex } from '../readout';

export const GHOST_OVERLAY_ID = 'viewer-ghost';
const KEY = 'ghost';

export function ghostOffset(offset: number): string {
  const rounded = Math.round(offset * 100) / 100;
  return `${rounded >= 0 ? '+' : '−'}${formatNumber(Math.abs(rounded), { digits: 2, grouping: false })} m`;
}

interface Source {
  wellId: string;
  depth: Float64Array;
  trackId: string;
  curve: ResolvedCurve;
  roleSource: SourceRef | undefined;
}

interface Ghost {
  depths: Float64Array;
  values: Float64Array;
  offset: number;
  center: number;
}

export interface GhostStatus {
  name: string;
  offset: number | null;
}

export function createGhostTool(changed: (status: GhostStatus | null) => void, empty: () => void) {
  let source: Source | null = null;
  let ghost: Ghost | null = null;
  let draft: { top: number; base: number } | null = null;
  let invalidate: (() => void) | undefined;

  const publish = () => {
    changed(source ? { name: source.curve.name, offset: ghost?.offset ?? null } : null);
    invalidate?.();
  };

  const clear = () => {
    if (!source) return false;
    source = ghost = draft = null;
    publish();
    return true;
  };

  const resolve = (frame: OverlayHitFrame) => {
    const s = source;
    if (!s || frame.purpose === 'export' || frame.data.wellId !== s.wellId || frame.data.depth !== s.depth) return null;
    const track = frame.tracks.find((t) => t.id === s.trackId && t.kind === 'curves');
    const c = s.curve;
    if (c.role && !sourceRefEquals(s.roleSource, frame.data.interpretation.sources[c.role])) return null;
    const curve = track?.curves.find((next) => next.key === c.key && next.kind === 'line' &&
      next.data === c.data && next.role === c.role && next.unit === c.unit && next.alternative === c.alternative && next.wrap === c.wrap && scaleKey(next.axis) === scaleKey(c.axis));
    return track && curve ? { track, curve } : null;
  };

  const arm = (next: Source) => {
    source = next;
    ghost = draft = null;
    publish();
  };

  const clampOffset = (g: Ghost, s: Source, offset: number) =>
    Math.max(s.depth[0]! - g.center, Math.min(s.depth[s.depth.length - 1]! - g.center, offset));

  const grip = (frame: OverlayHitFrame, track: OverlayTrack, g: Ghost) => {
    const { viewport: vp } = frame;
    const top = Math.max(0, vp.yOf(g.depths[0]! + g.offset));
    const base = Math.min(vp.height, vp.yOf(g.depths[g.depths.length - 1]! + g.offset));
    const radius = 8 * (frame.uiScale ?? 1);
    if (base < top) return null;
    return {
      x: track.x + Math.min(track.width / 2, radius + 4),
      y: Math.max(radius, Math.min(vp.height - radius, (top + base) / 2)),
      radius,
    };
  };

  const moveHit = (s: Source, g: Ghost): OverlayHit & { key: string } => {
    const before = g.offset;
    const moveTo = (offset: number) => {
      if (source !== s || ghost !== g || !Number.isFinite(offset)) return;
      const next = clampOffset(g, s, offset);
      if (next === g.offset) return;
      g.offset = next;
      publish();
    };
    return {
      key: KEY,
      label: `Calco de ${s.curve.name} · ${ghostOffset(g.offset)}`,
      cursor: 'grab',
      nudge: (delta) => moveTo(g.offset + delta),
      drag: {
        move: (p, start) => moveTo(before + p.depth - start.depth),
        end: (p, start) => moveTo(before + p.depth - start.depth),
        cancel: () => moveTo(before),
      },
    };
  };

  const overlay: ViewerOverlay = {
    id: GHOST_OVERLAY_ID,
    label: 'Curva fantasma',
    layer: 'over',
    order: 40,
    draw(frame) {
      const target = resolve(frame);
      if (!target) return;
      invalidate = frame.invalidate;
      const { track, curve } = target;
      const { ctx, viewport: vp, theme } = frame;
      ctx.save();
      ctx.beginPath();
      ctx.rect(track.x, 0, track.width, vp.height);
      ctx.clip();
      if (draft) {
        const top = vp.yOf(draft.top);
        const base = vp.yOf(draft.base);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = theme.color.accent;
        ctx.fillRect(track.x, top, track.width, base - top);
      }
      if (ghost) {
        const { depths, values, offset } = ghost;
        const fractions = fractionArray(values, curve.axis);
        const wrap = curve.wrap ? wrapFractionArray(fractions) : null;
        const [i0, i1] = visibleRange(depths, vp.top - offset, vp.base - offset);
        const focused = frame.active?.overlayId === GHOST_OVERLAY_ID && frame.active.key === KEY;
        const style = curve.styles[theme.name];
        ctx.strokeStyle = style.color;
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2, style.width + 1);
        for (const values of wrap ? [fractions, wrap] : [fractions]) {
          ctx.globalAlpha = values === wrap ? 0.4 : focused ? 0.75 : 0.55;
          ctx.beginPath();
          let connected = false;
          for (let i = i0; i < i1; i++) {
            const f = values[i]!;
            if (!Number.isFinite(f)) {
              connected = false;
              continue;
            }
            const x = track.x + f * track.width;
            const y = vp.yOf(depths[i]! + offset);
            if (connected) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
            connected = true;
          }
          ctx.stroke();
        }
        const handle = grip(frame, track, ghost);
        if (handle) {
          const { x, y, radius: r } = handle;
          ctx.globalAlpha = 1;
          ctx.fillStyle = focused ? theme.color.accent : style.color;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = theme.color.textOnAccent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - r * 0.4, y - r * 0.2);
          ctx.lineTo(x, y - r * 0.55);
          ctx.lineTo(x + r * 0.4, y - r * 0.2);
          ctx.moveTo(x - r * 0.4, y + r * 0.2);
          ctx.lineTo(x, y + r * 0.55);
          ctx.lineTo(x + r * 0.4, y + r * 0.2);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
    hit(frame, p) {
      const s = source;
      const target = resolve(frame);
      if (!s || !target || p.track?.id !== target.track.id) return null;
      invalidate = frame.invalidate;
      const g = ghost;
      if (g) {
        const handle = grip(frame, target.track, g);
        return handle && Math.hypot(p.x - handle.x, p.y - handle.y) <= handle.radius + 3 ? moveHit(s, g) : null;
      }
      const interval = (a: number, b: number) => {
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        const clamp = (d: number) => Math.min(s.depth[s.depth.length - 1]!, Math.max(s.depth[0]!, d));
        const i = nearestIndex(s.depth, clamp(Math.min(a, b)));
        const j = nearestIndex(s.depth, clamp(Math.max(a, b)));
        return { i, j };
      };
      return {
        label: `Arrastrá para calcar un tramo de ${s.curve.name}`,
        cursor: 'crosshair',
        drag: {
          cursor: 'crosshair',
          move(p, start) {
            if (source !== s) return;
            const range = interval(start.depth, p.depth);
            if (!range) return;
            const { i, j } = range;
            draft = { top: s.depth[i]!, base: s.depth[j]! };
            invalidate?.();
          },
          end(p, start) {
            if (source !== s) return;
            draft = null;
            const range = interval(start.depth, p.depth);
            if (!range) return;
            const { i, j } = range;
            const depths = s.depth.slice(i, j + 1);
            const values = s.curve.data.slice(i, j + 1);
            const fractions = fractionArray(values, s.curve.axis);
            if (!fractions.some((f, k) => k > 0 && Number.isFinite(f) && Number.isFinite(fractions[k - 1]))) {
              empty();
              invalidate?.();
              return;
            }
            ghost = {
              depths, values,
              offset: 0, center: (depths[0]! + depths[depths.length - 1]!) / 2,
            };
            publish();
          },
          cancel: () => { if (source === s) clear(); },
        },
      };
    },
    targets(frame) {
      return source && ghost && resolve(frame)
        ? [{ depth: ghost.center + ghost.offset, hit: moveHit(source, ghost) }]
        : [];
    },
  };

  return {
    overlay, arm, clear,
    cancelSelection: () => !ghost && clear(),
    reconcile(frame: OverlayHitFrame) {
      return source && !resolve(frame) ? clear() : false;
    },
  };
}
