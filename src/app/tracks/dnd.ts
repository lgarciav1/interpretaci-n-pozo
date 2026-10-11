/**
 * Arrastre para armar pistas (docs/decisiones/0016, D1): eventos de puntero propios en vez de HTML5 drag and drop.
 *
 * - Empieza al pasar 4 px desde donde se apretó (un clic sigue siendo un clic: abre el menú o el editor).
 * - Fantasma propio que sigue al puntero (DOM directo, sin re-render por movimiento).
 * - Destino con `dropTargetAt` (atributos del visor); el store solo cambia cuando cambia el destino.
 * - Cerca de los bordes del visor desplaza en horizontal. Escape cancela. Después de un arrastre se descarta el clic
 *   que genera el navegador al soltar.
 */
import { create } from 'zustand';
import { dropTargetAt, sameDropTarget, type LayoutDragInfo, type LayoutDropTarget } from '../../viewer/layoutEdit';
import type { CatalogCurve, CatalogTrack } from '../../viewer/catalog';

/** Qué se arrastra. */
export type DragPayload =
  | { kind: 'catalog-curve'; item: CatalogCurve }
  | { kind: 'catalog-track'; item: CatalogTrack }
  | { kind: 'curve'; trackId: string; curveKey: string; name: string; flag: boolean }
  | { kind: 'track'; trackId: string; title: string };

export interface DragGhost {
  label: string;
  /** Color de la muestra (curvas). */
  color?: string;
  /** Descripción corta debajo del nombre. */
  detail?: string;
}

interface DragState {
  payload: DragPayload | null;
  target: LayoutDropTarget | null;
}

export const useLayoutDrag = create<DragState>()(() => ({ payload: null, target: null }));

/** Lo que el visor necesita saber del arrastre en curso. */
export function dragInfo(p: DragPayload | null): LayoutDragInfo | null {
  if (!p) return null;
  switch (p.kind) {
    case 'track':
      return { what: 'track', trackId: p.trackId };
    case 'catalog-track':
      return { what: 'track' };
    case 'curve':
      return { what: p.flag ? 'flag' : 'curve', trackId: p.trackId, curveKey: p.curveKey };
    case 'catalog-curve':
      return { what: p.item.flag ? 'flag' : 'curve' };
  }
}

const THRESHOLD = 4;
const EDGE = 48;

let drop: ((payload: DragPayload, target: LayoutDropTarget) => void) | null = null;
/** Quien conoce las pistas (ViewerSlot) registra qué hacer al soltar. */
export function setDropHandler(fn: typeof drop): void {
  drop = fn;
}

/**
 * Empieza a seguir un posible arrastre desde un `pointerdown` (botón principal). No hace nada hasta que el puntero
 * se mueve 4 px.
 */
export function beginDrag(e: { button: number; clientX: number; clientY: number; pointerId: number; pointerType: string }, payload: DragPayload, ghost: DragGhost): void {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let started = false;
  let el: HTMLDivElement | null = null;
  let scrollTimer = 0;
  let last = { x: x0, y: y0 };

  const place = (x: number, y: number) => {
    if (el) el.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 12)}px)`;
  };
  const update = (x: number, y: number) => {
    last = { x, y };
    place(x, y);
    const target = dropTargetAt(x, y, payload.kind === 'track' || payload.kind === 'catalog-track');
    if (!sameDropTarget(useLayoutDrag.getState().target, target)) useLayoutDrag.setState({ target });
    el?.toggleAttribute('data-over', !!target);
  };
  const autoScroll = () => {
    scrollTimer = 0;
    const scroller = document.querySelector<HTMLElement>('.shell-viewer .wv-scroll');
    if (!scroller || !started) return;
    const r = scroller.getBoundingClientRect();
    if (last.y < r.top || last.y > r.bottom) return;
    const dx = last.x < r.left + EDGE ? -1 : last.x > r.right - EDGE ? 1 : 0;
    if (!dx) return;
    const before = scroller.scrollLeft;
    scroller.scrollLeft += dx * 14;
    if (scroller.scrollLeft !== before) update(last.x, last.y);
    scrollTimer = window.setTimeout(autoScroll, 16);
  };
  const start = () => {
    started = true;
    el = document.createElement('div');
    el.className = 'tb-ghost';
    el.setAttribute('aria-hidden', 'true');
    if (ghost.color) {
      const sw = document.createElement('span');
      sw.className = 'tb-ghost__swatch';
      sw.style.background = ghost.color;
      el.append(sw);
    }
    const text = document.createElement('span');
    text.className = 'tb-ghost__text';
    const name = document.createElement('strong');
    name.textContent = ghost.label;
    text.append(name);
    if (ghost.detail) {
      const d = document.createElement('span');
      d.textContent = ghost.detail;
      text.append(d);
    }
    el.append(text);
    document.body.append(el);
    document.documentElement.classList.add('tb-dragging');
    useLayoutDrag.setState({ payload, target: null });
  };
  const finish = (commit: boolean) => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onCancel);
    document.removeEventListener('visibilitychange', onHidden);
    if (scrollTimer) clearTimeout(scrollTimer);
    if (!started) return;
    const target = useLayoutDrag.getState().target;
    el?.remove();
    document.documentElement.classList.remove('tb-dragging');
    useLayoutDrag.setState({ payload: null, target: null });
    // El clic que sigue a soltar no debe abrir el menú ni el editor de la curva.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    if (commit && target) drop?.(payload, target);
  };
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    // Botón suelto sin pointerup (se soltó fuera de la ventana o lo tragó otro elemento): se cancela.
    if (ev.buttons === 0 && ev.pointerType === 'mouse') {
      finish(false);
      return;
    }
    if (!started) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
      start();
    }
    ev.preventDefault();
    update(ev.clientX, ev.clientY);
    if (!scrollTimer) scrollTimer = window.setTimeout(autoScroll, 16);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    if (started) update(ev.clientX, ev.clientY);
    finish(true);
  };
  const onCancel = () => finish(false);
  const onHidden = () => {
    if (document.visibilityState === 'hidden') finish(false);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape' || !started) return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onCancel);
  document.addEventListener('visibilitychange', onHidden);
}
