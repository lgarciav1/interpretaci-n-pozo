/**
 * Modo «Armar pistas» del visor (docs/decisiones/0016-pistas-armables.md, D1): destinos de arrastre, bordes para
 * cambiar el ancho y lectura del destino bajo el puntero. El visor solo pinta y avisa; qué significa soltar (agregar,
 * mover, crear) lo decide la app (src/app/tracks/), que también maneja el arrastre.
 *
 * Destinos (atributos `data-drop-*`, leídos con `dropTargetAt`):
 * - `data-drop-gap`: espacio entre pistas (valor = id de la pista de la derecha; vacío = al final) → pista nueva.
 * - `data-drop-row`: fila de una curva en el encabezado (insertar arriba o abajo de esa curva).
 * - `data-drop-track`: encabezado o columna de una pista → agregar a esa pista.
 */
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { MenuEntry } from '../ui';
import type { TrackBox } from './layout';
import type { ResolvedCurve, ResolvedTrack } from './resolve';
import './layoutEdit.css';

export type LayoutDropTarget =
  | { kind: 'track'; trackId: string; row?: { curveKey: string; side: 'above' | 'below' } }
  | { kind: 'gap'; beforeId: string | null };

/** Qué se está arrastrando (para pintar destinos): una curva, una bandera o una pista. */
export interface LayoutDragInfo {
  what: 'curve' | 'flag' | 'track';
  /** Pista de origen (arrastre de una pista o de una curva del visor). */
  trackId?: string;
  curveKey?: string;
}

export interface ViewerLayoutEditing {
  /** Arrastre en curso (desde el catálogo o el visor), o null. */
  drag: LayoutDragInfo | null;
  /** Destino bajo el puntero. */
  target: LayoutDropTarget | null;
  /** ¿La pista acepta lo que se arrastra? */
  accepts(track: ResolvedTrack): boolean;
  onTrackPointerDown(e: ReactPointerEvent<HTMLElement>, track: ResolvedTrack): void;
  onCurvePointerDown(e: ReactPointerEvent<HTMLElement>, track: ResolvedTrack, curve: ResolvedCurve): void;
  /** Acciones de la pista (menú de la manija; también accesible con el teclado). */
  trackMenu(track: ResolvedTrack): MenuEntry[];
  curveMenu(track: ResolvedTrack, curve: ResolvedCurve): MenuEntry[];
  onTrackKeyDown(e: KeyboardEvent<HTMLElement>, track: ResolvedTrack): void;
  onCurveKeyDown(e: KeyboardEvent<HTMLElement>, track: ResolvedTrack, curve: ResolvedCurve): void;
  /** Ancho relativo nuevo (al soltar el borde o con las flechas). */
  onResize(track: ResolvedTrack, width: number): void;
}

/**
 * Destino bajo un punto de la pantalla (coordenadas de cliente). Con `gapsOnly` (se arrastra una pista), una pista
 * bajo el puntero se traduce al espacio más cercano: su mitad izquierda = antes de ella; la derecha = después.
 */
export function dropTargetAt(x: number, y: number, gapsOnly = false): LayoutDropTarget | null {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const gap = el.closest<HTMLElement>('[data-drop-gap]');
    if (gap) return { kind: 'gap', beforeId: gap.dataset['dropGap'] || null };
  }
  if (gapsOnly) {
    for (const el of els) {
      const track = el.closest<HTMLElement>('[data-drop-track]');
      if (!track) continue;
      const id = track.dataset['dropTrack']!;
      const r = track.getBoundingClientRect();
      if (x < r.left + r.width / 2) return { kind: 'gap', beforeId: id };
      const order = [...(track.closest('.wv-inner')?.querySelectorAll<HTMLElement>('.wv-head[data-drop-track]') ?? [])].map((h) => h.dataset['dropTrack']!);
      const i = order.indexOf(id);
      return { kind: 'gap', beforeId: i >= 0 && i + 1 < order.length ? order[i + 1]! : null };
    }
    return null;
  }
  for (const el of els) {
    const row = el.closest<HTMLElement>('[data-drop-row]');
    const track = row?.closest<HTMLElement>('[data-drop-track]');
    if (row && track) {
      const r = row.getBoundingClientRect();
      return { kind: 'track', trackId: track.dataset['dropTrack']!, row: { curveKey: row.dataset['dropRow']!, side: y < r.top + r.height / 2 ? 'above' : 'below' } };
    }
  }
  for (const el of els) {
    const track = el.closest<HTMLElement>('[data-drop-track]');
    if (track) return { kind: 'track', trackId: track.dataset['dropTrack']! };
  }
  return null;
}

export const sameDropTarget = (a: LayoutDropTarget | null, b: LayoutDropTarget | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    (a.kind === 'gap' ? b.kind === 'gap' && a.beforeId === b.beforeId : b.kind === 'track' && a.trackId === b.trackId && a.row?.curveKey === b.row?.curveKey && a.row?.side === b.row?.side));

/** Capa de destinos sobre el visor mientras se arrastra: espacios entre pistas y columnas. */
export function DropLayer({ tracks, boxes, heads, edit, ui }: { tracks: readonly ResolvedTrack[]; boxes: readonly TrackBox[]; heads: number; edit: ViewerLayoutEditing; ui: number }) {
  const drag = edit.drag!;
  const target = edit.target;
  const gapWidth = Math.round(22 * ui);
  const total = boxes.length ? boxes[boxes.length - 1]!.x + boxes[boxes.length - 1]!.width : 0;
  const from = drag.what === 'track' ? tracks.findIndex((t) => t.id === drag.trackId) : -1;
  const gaps: { x: number; beforeId: string | null }[] = [];
  for (let i = 0; i <= tracks.length; i++) {
    if (from >= 0 && (i === from || i === from + 1)) continue; // soltar la pista donde ya está no cambia nada
    gaps.push({ x: i < tracks.length ? boxes[i]!.x : total, beforeId: i < tracks.length ? tracks[i]!.id : null });
  }
  const gapLabel = drag.what === 'track' ? 'Mover acá' : 'Pista nueva';
  return (
    <div className="wv-drop" aria-hidden="true">
      {drag.what === 'track' &&
        // Arrastrando una pista, toda la columna lleva al espacio más cercano (`dropTargetAt` con `gapsOnly`).
        tracks.map((t, i) => <div key={t.id} className="wv-drop__col wv-drop__col--track" data-drop-track={t.id} style={{ left: boxes[i]!.x, width: boxes[i]!.width, top: heads }} />)}
      {drag.what !== 'track' &&
        tracks.map((t, i) => {
          const b = boxes[i]!;
          const ok = edit.accepts(t);
          const active = target?.kind === 'track' && target.trackId === t.id;
          return (
            <div
              key={t.id}
              className={`wv-drop__col${ok ? '' : ' is-blocked'}${active ? (ok ? ' is-active' : ' is-refused') : ''}`}
              data-drop-track={t.id}
              style={{ left: b.x, width: b.width, top: heads }}
            >
              {active && <span className="wv-drop__pill">{ok ? `Agregar a ${t.title}` : `${t.title} no acepta curvas`}</span>}
            </div>
          );
        })}
      {gaps.map((g) => {
        const active = target?.kind === 'gap' && target.beforeId === g.beforeId;
        const left = Math.max(0, Math.min(total - gapWidth, g.x - gapWidth / 2));
        return (
          <div key={g.beforeId ?? '|end'} className={`wv-drop__gap${active ? ' is-active' : ''}`} data-drop-gap={g.beforeId ?? ''} style={{ left, width: gapWidth }}>
            <span className="wv-drop__bar" style={{ left: g.x - left - 1.5 }} />
            {active && (
              <span className="wv-drop__pill wv-drop__pill--gap" style={{ left: g.x - left }}>
                {gapLabel}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Borde derecho de una pista para cambiar su ancho: arrastrar previsualiza (`onPreview`) y al soltar guarda
 * (`onCommit`); con el foco, ←/→ lo cambian de a 10 %. `role="separator"` con valor (ancho relativo × 100).
 */
export function ResizeEdge({
  track,
  px,
  room,
  weights,
  minPx,
  overflow,
  onPreview,
  onCommit,
}: {
  track: ResolvedTrack;
  /** Ancho actual en px. */
  px: number;
  /** Px que se reparten entre las pistas flexibles y suma de sus pesos. */
  room: number;
  weights: number;
  /** Mínimo de una pista de ancho 1 (px) y si las pistas no entran (el visor se desplaza en horizontal). */
  minPx: number;
  overflow: boolean;
  onPreview(width: number | null): void;
  onCommit(width: number): void;
}) {
  const start = useRef<{ x: number; px: number; weight: number; rest: number; last: number } | null>(null);
  /**
   * Peso que da `targetPx` a esta pista con los demás pesos fijos: k' = w·(S − k) / (R − w). Si las pistas no entran,
   * cada una mide su mínimo × su ancho (`layoutTracks` con `weightedMin`): k' = w / mínimo.
   */
  const weightFor = (targetPx: number, s: { weight: number; rest: number }) => {
    if (overflow) return Math.max(0.05, targetPx / minPx);
    const w = Math.max(24, Math.min(room - 24, targetPx));
    return Math.max(0.05, (w * s.rest) / Math.max(1, room - w));
  };
  return (
    <div
      className="wv-head__resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Ancho de ${track.title}`}
      aria-valuenow={Math.round(track.width * 100)}
      aria-valuetext={`${Math.round(track.width * 100)} %`}
      tabIndex={0}
      title="Arrastrá para cambiar el ancho de la pista (← → con el teclado)"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, px, weight: track.width, rest: Math.max(0.05, weights - track.width), last: track.width };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        s.last = weightFor(s.px + e.clientX - s.x, s);
        onPreview(s.last);
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onPreview(null);
        if (Math.abs(e.clientX - s.x) >= 2) onCommit(s.last);
      }}
      onPointerCancel={() => {
        start.current = null;
        onPreview(null);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        onCommit(track.width * (e.key === 'ArrowRight' ? 1.1 : 1 / 1.1));
      }}
    />
  );
}
