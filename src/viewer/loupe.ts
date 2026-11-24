/**
 * Lupa sobre el perfil (F17, docs/decisiones/0085-lupa-del-visor.md). Geometría pura: tamaño del recuadro, viewport de
 * detalle, pistas que entran, posición dentro del visor y marca del tramo en la vista general.
 *
 * La lupa es otro viewport del mismo pozo: la profundidad central es la del cursor y la escala es de impresión (1:200
 * a 96 ppp, la misma cuenta que el selector de escalas y las figuras: `pxPerMeterForScale`). En horizontal no se
 * deforma nada: las pistas conservan su ancho del visor y la lupa muestra las que rodean al puntero, con la columna de
 * profundidad fija a la izquierda.
 */
import { pxPerMeterForScale } from '../io/export/figures/sizing';
import type { TrackBox } from './layout';
import type { Viewport } from './viewport';

/** Aumentos que recorre la rueda con la lupa abierta (denominador de 1:N). */
export const LOUPE_SCALES = [50, 100, 200, 500, 1000] as const;
export const DEFAULT_LOUPE_SCALE = 200;
/** Ancho del recuadro como fracción del ancho visible del visor, y sus topes (px CSS a tamaño de interfaz 1). */
export const LOUPE_WIDTH_FRACTION = 0.4;
const LOUPE_MIN_WIDTH = 240;
const LOUPE_MAX_WIDTH = 640;
/** Alto fijo del recuadro (px CSS a tamaño de interfaz 1), encabezado incluido. */
export const LOUPE_HEIGHT = 320;
/** Separación entre el puntero y el recuadro, y margen contra los bordes del visor. */
export const LOUPE_GAP = 28;
export const LOUPE_MARGIN = 8;
/** Alto mínimo de la marca del tramo en el visor general (px CSS). */
export const MARK_MIN_PX = 4;

export interface LoupeSize {
  width: number;
  height: number;
}

/** Tamaño del recuadro para un visor de `visibleWidth` × `height` px (nunca más grande que el visor). */
export function loupeSize(visibleWidth: number, height: number, ui = 1): LoupeSize {
  const room = Math.max(1, visibleWidth - 2 * LOUPE_MARGIN);
  const width = Math.min(room, Math.max(LOUPE_MIN_WIDTH * ui, Math.min(LOUPE_MAX_WIDTH * ui, visibleWidth * LOUPE_WIDTH_FRACTION)));
  const h = Math.min(LOUPE_HEIGHT * ui, Math.max(1, height - 2 * LOUPE_MARGIN));
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(h)) };
}

/** Viewport de la lupa: `center` en la mitad de un área de `height` px, a escala 1:`scale`. */
export function loupeViewport(center: number, scale: number, height: number): Viewport {
  const pxPerM = pxPerMeterForScale(scale);
  return { top: center - height / 2 / pxPerM, pxPerM, height };
}

/** Escrito sobre `out` (sin asignar): para el redibujo por cuadro. */
export function setLoupeViewport(out: Viewport, center: number, scale: number, height: number): Viewport {
  out.pxPerM = pxPerMeterForScale(scale);
  out.height = height;
  out.top = center - height / 2 / out.pxPerM;
  return out;
}

/** Metros de pozo que muestra la lupa (alto del área de dibujo a esa escala). */
export const loupeSpan = (scale: number, height: number): number => height / pxPerMeterForScale(scale);

/** Aumento siguiente (`dir` = 1 acerca: denominador menor) o el mismo si está en el extremo. */
export function stepLoupeScale(scale: number, dir: 1 | -1): number {
  const list = LOUPE_SCALES as readonly number[];
  let i = list.indexOf(scale);
  if (i < 0) i = list.findIndex((s) => s >= scale);
  if (i < 0) i = list.length - 1;
  return list[Math.min(list.length - 1, Math.max(0, i - dir))]!;
}

/**
 * Primera pista (índice en `boxes`) de la ventana horizontal de la lupa, sin asignar memoria. La ventana mide `budget`
 * px (el ancho de la lupa menos la columna de profundidad), arranca en un borde de pista (nada queda cortado contra la
 * profundidad) y contiene entera la pista bajo el puntero cuando entra. -1 si no hay pistas fuera de la profundidad.
 */
export function loupeStart(boxes: readonly TrackBox[], depthIndex: number, pointerX: number, budget: number): number {
  let first = -1;
  let last = -1;
  let under = -1;
  let nearest = -1;
  let nearestDist = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    if (i === depthIndex) continue;
    const b = boxes[i]!;
    if (first < 0) first = i;
    last = i;
    if (pointerX >= b.x && pointerX < b.x + b.width) under = i;
    const d = pointerX < b.x ? b.x - pointerX : pointerX - (b.x + b.width);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = i;
    }
  }
  if (first < 0) return -1;
  const p = under >= 0 ? under : nearest;
  const lo = boxes[first]!.x;
  const hi = boxes[last]!.x + boxes[last]!.width;
  // Borde izquierdo deseado: el puntero en el medio, sin pasarse de los extremos.
  const want = hi - lo <= budget ? lo : Math.min(hi - budget, Math.max(lo, pointerX - budget / 2));
  // El borde de pista más cercano al deseado, sin pasar de la pista bajo el puntero.
  let s = first;
  let best = Infinity;
  for (let i = first; i <= p; i++) {
    if (i === depthIndex) continue;
    const d = Math.abs(boxes[i]!.x - want);
    if (d < best) {
      best = d;
      s = i;
    }
  }
  // Que la pista bajo el puntero entre entera (si entra sola).
  const pRight = boxes[p]!.x + boxes[p]!.width;
  while (s < p && pRight - boxes[s]!.x > budget) {
    s++;
    if (s === depthIndex) s++;
  }
  return s;
}

export interface LoupeColumns {
  /** Índice de la pista de profundidad (fija a la izquierda) o -1. */
  depthIndex: number;
  /** Índices de las pistas de la ventana, en orden. */
  indices: number[];
  /** Cajas en coordenadas de la lupa, alineadas con `[depthIndex?, ...indices]`. */
  boxes: TrackBox[];
  /** x del visor general donde empieza y termina la ventana (para marcarla). */
  from: number;
  to: number;
}

/** Columnas de la lupa: profundidad a la izquierda y, a continuación, las pistas desde `start` que entran en `width`. */
export function loupeColumns(boxes: readonly TrackBox[], depthIndex: number, start: number, width: number): LoupeColumns {
  const dw = depthIndex >= 0 ? boxes[depthIndex]!.width : 0;
  const out: LoupeColumns = { depthIndex, indices: [], boxes: [], from: 0, to: 0 };
  if (depthIndex >= 0) out.boxes.push({ x: 0, width: dw });
  if (start < 0) return out;
  const x0 = boxes[start]!.x;
  const end = x0 + Math.max(0, width - dw);
  for (let i = start; i < boxes.length; i++) {
    if (i === depthIndex) continue;
    const b = boxes[i]!;
    if (b.x >= end) break;
    out.indices.push(i);
    out.boxes.push({ x: dw + b.x - x0, width: b.width });
  }
  const lastBox = boxes[out.indices[out.indices.length - 1] ?? start]!;
  out.from = x0;
  out.to = Math.min(end, lastBox.x + lastBox.width);
  return out;
}

export interface LoupeArea {
  /** Borde izquierdo visible (px del contenido: el visor se desplaza en horizontal). */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LoupePlacement {
  x: number;
  y: number;
  /** Lado del puntero donde quedó. */
  side: 'right' | 'left';
}

/**
 * Posición del recuadro: a la derecha del puntero (a la izquierda si no entra), centrado en su altura, siempre dentro
 * del área visible del visor.
 */
export function placeLoupe(pointer: { x: number; y: number }, size: LoupeSize, area: LoupeArea, gap = LOUPE_GAP, margin = LOUPE_MARGIN): LoupePlacement {
  const minX = area.left + margin;
  const maxX = area.left + area.width - margin - size.width;
  let x: number;
  let side: LoupePlacement['side'];
  if (pointer.x + gap <= maxX) {
    x = pointer.x + gap;
    side = 'right';
  } else if (pointer.x - gap - size.width >= minX) {
    x = pointer.x - gap - size.width;
    side = 'left';
  } else {
    // No entra a ningún lado sin tapar el puntero: el lado con más lugar, acotado.
    side = area.left + area.width - pointer.x >= pointer.x - area.left ? 'right' : 'left';
    x = side === 'right' ? maxX : minX;
  }
  x = Math.max(minX, Math.min(maxX, x));
  if (maxX < minX) x = area.left + Math.max(0, (area.width - size.width) / 2);
  const minY = area.top + margin;
  const maxY = area.top + area.height - margin - size.height;
  const y = maxY < minY ? area.top + Math.max(0, (area.height - size.height) / 2) : Math.max(minY, Math.min(maxY, pointer.y - size.height / 2));
  return { x: Math.round(x), y: Math.round(y), side };
}

/**
 * Rectángulo del visor general que muestra la lupa (px CSS del canvas): de `from` a `to` en x y el tramo de profundidad
 * de la lupa en y, acotado al alto del visor y con `MARK_MIN_PX` de alto mínimo para que se vea a escala de pozo
 * completo (a 1:10.000, los 16 m de la lupa miden unos 6 px).
 * null si el tramo cae fuera de la vista.
 */
export function loupeMark(main: Viewport, top: number, base: number, from: number, to: number): { x: number; y: number; width: number; height: number } | null {
  const y0 = (top - main.top) * main.pxPerM;
  const y1 = (base - main.top) * main.pxPerM;
  if (y1 < 0 || y0 > main.height) return null;
  const a = Math.max(0, y0);
  const b = Math.min(main.height, y1);
  const height = Math.max(MARK_MIN_PX, b - a);
  return { x: from, y: b - a < MARK_MIN_PX ? (a + b) / 2 - MARK_MIN_PX / 2 : a, width: Math.max(1, to - from), height };
}

/**
 * Lupas abiertas en la página. Otras capas con su propio Esc en captura (modo defensa) lo consultan para cederle el
 * primer Esc a la lupa: los oyentes en captura sobre `window` corren en orden de registro, así que sin esto ganaría
 * el que se registró antes.
 */
const openLoupes = new Set<object>();
export function setLoupeOpen(owner: object, open: boolean): void {
  if (open) openLoupes.add(owner);
  else openLoupes.delete(owner);
}
export const isLoupeOpen = (): boolean => openLoupes.size > 0;
