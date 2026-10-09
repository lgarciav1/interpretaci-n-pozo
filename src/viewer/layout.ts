/**
 * Anchos de pista en píxeles. Se calculan una vez por tamaño y se usan igual para la grilla HTML de encabezados y
 * para el canvas (docs/decisiones/0005-visor-multipista.md, D1). Puro.
 */

export interface TrackBox {
  x: number;
  width: number;
}

export interface TrackSizing {
  /** Ancho relativo (pistas flexibles). */
  width?: number;
  /** Ancho fijo en px (profundidad, banderas). */
  fixed?: number;
}

export interface TrackLayout {
  boxes: TrackBox[];
  /** Ancho total (puede superar el disponible: el visor se desplaza en horizontal). */
  total: number;
}

export const MIN_TRACK_WIDTH = 104;

/**
 * Reparte `available` px: primero los anchos fijos, el resto proporcional a `width` (por defecto 1), con un mínimo
 * de `minWidth` por pista flexible. Los bordes se redondean a px enteros (líneas nítidas).
 */
export function layoutTracks(tracks: readonly TrackSizing[], available: number, minWidth = MIN_TRACK_WIDTH): TrackLayout {
  const fixedSum = tracks.reduce((s, t) => s + (t.fixed ?? 0), 0);
  const weight = (t: TrackSizing) => t.width ?? 1;
  // Las pistas que quedarían por debajo del mínimo se fijan en el mínimo y el resto se reparte entre las demás.
  const widths = new Map<TrackSizing, number>();
  let pending = tracks.filter((t) => t.fixed === undefined);
  let room = Math.max(0, available - fixedSum);
  while (pending.length) {
    const w = pending.reduce((s, t) => s + weight(t), 0) || 1;
    const small = pending.filter((t) => (room * weight(t)) / w < minWidth);
    if (small.length === 0) {
      for (const t of pending) widths.set(t, (room * weight(t)) / w);
      break;
    }
    for (const t of small) widths.set(t, minWidth);
    room -= minWidth * small.length;
    pending = pending.filter((t) => !small.includes(t));
  }
  const boxes: TrackBox[] = [];
  let acc = 0;
  let x = 0;
  for (const t of tracks) {
    acc += t.fixed ?? widths.get(t) ?? minWidth;
    const right = Math.round(acc);
    boxes.push({ x, width: right - x });
    x = right;
  }
  return { boxes, total: x };
}

/** Índice de la pista bajo la x dada (-1 si ninguna). */
export function trackAt(boxes: readonly TrackBox[], x: number): number {
  for (let i = 0; i < boxes.length; i++) if (x >= boxes[i]!.x && x < boxes[i]!.x + boxes[i]!.width) return i;
  return -1;
}
