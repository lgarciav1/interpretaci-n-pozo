/**
 * Gestos del puntero sobre el visor, sin React ni DOM (docs/decisiones/0005-visor-multipista.md, D7–D8).
 *
 * - Apretar sobre un elemento de una superposición cuyo `hit` trae `drag` → arrastre de ESE elemento (no se panea):
 *   pasado el umbral, cada movimiento llama a `drag.move`; cerca de los bordes la vista se desplaza sola y se
 *   vuelve a llamar a `move` con la profundidad nueva; soltar llama a `end`; Escape, a `cancel`.
 * - Apretar en cualquier otro lado → paneo.
 * - Un clic o un arrastre sobre un elemento con `nudge` lo deja activo para moverlo con ↑/↓.
 *
 * El componente (`WellViewer.tsx`) traduce eventos del DOM a estas llamadas; los tests las hacen directo.
 */
import { guard, type OverlayDrag, type OverlayHit, type OverlayPointer } from './overlay';
import { scrollBy, type Viewport, type ViewportLimits } from './viewport';

export interface Point {
  x: number;
  y: number;
}

/** Elemento bajo el puntero y la superposición que lo dio (para aislar sus errores). */
export interface HitResult {
  overlayId: string;
  hit: OverlayHit;
}

export interface GestureHost {
  viewport(): Viewport | null;
  limits(): ViewportLimits | null;
  setViewport(v: Viewport): void;
  /** Puntero de superposición en un punto local (con el viewport actual). */
  pointerAt(p: Point): OverlayPointer;
  hitAt(p: Point): HitResult | null;
  /** Pide una llamada a `tick()` en el próximo cuadro (desplazamiento automático). */
  requestTick(): void;
  /** Cursor CSS del cuerpo del visor ('' = el de siempre). */
  setCursor?(css: string): void;
  /** Cambió el elemento activo (para redibujar su resaltado). */
  activeChanged?(active: HitResult | null): void;
  /** Empezó (true) o terminó (false: soltado o cancelado) el arrastre de un elemento. */
  dragChanged?(dragging: boolean): void;
}

/** Píxeles de movimiento antes de que un apretón sea arrastre (y no clic). */
export const DRAG_SLOP = 4;
/** Banda (px) junto al borde superior e inferior donde un arrastre desplaza la vista. */
export const AUTOSCROLL_EDGE = 28;
/** Desplazamiento máximo por cuadro (px) en el borde. */
export const AUTOSCROLL_MAX = 18;

interface OverlayDragState {
  pointerId: number;
  overlayId: string;
  hit: OverlayHit;
  drag: OverlayDrag;
  start: OverlayPointer;
  startPoint: Point;
  last: Point;
  started: boolean;
}

export class PointerGestures {
  private pan: { pointerId: number; lastY: number; moved: number } | null = null;
  private overlay: OverlayDragState | null = null;
  /** Elemento activo para ↑/↓ (último clic o arrastre sobre un elemento con `nudge`). */
  private activeHit: HitResult | null = null;
  /** El último apretón se movió (o se canceló): el click que sigue no es un clic. */
  private suppressClick = false;

  constructor(private readonly host: GestureHost) {}

  get dragging(): 'overlay' | 'pan' | null {
    return this.overlay?.started ? 'overlay' : this.pan && this.pan.moved > DRAG_SLOP ? 'pan' : null;
  }

  get active(): HitResult | null {
    return this.activeHit;
  }

  /** Apretón. Devuelve qué se va a hacer, para que el componente capture el puntero. */
  down(pointerId: number, p: Point): 'overlay' | 'pan' {
    this.suppressClick = false;
    const h = this.host.hitAt(p);
    if (h?.hit.drag) {
      this.overlay = { pointerId, overlayId: h.overlayId, hit: h.hit, drag: h.hit.drag, start: this.host.pointerAt(p), startPoint: p, last: p, started: false };
      this.pan = null;
      return 'overlay';
    }
    // Apretar fuera del elemento activo lo suelta (el clic sobre otro lo reemplaza en `click`).
    this.setActive(null);
    this.pan = { pointerId, lastY: p.y, moved: 0 };
    return 'pan';
  }

  move(pointerId: number, p: Point): void {
    const o = this.overlay;
    if (o && o.pointerId === pointerId) {
      o.last = p;
      if (!o.started && Math.hypot(p.x - o.startPoint.x, p.y - o.startPoint.y) <= DRAG_SLOP) return;
      if (!o.started) {
        o.started = true;
        this.host.setCursor?.(o.drag.cursor ?? 'grabbing');
        this.host.dragChanged?.(true);
      }
      guard(o.overlayId, 'drag.move', () => o.drag.move(this.host.pointerAt(p), o.start));
      if (this.autoscrollSpeed(p) !== 0) this.host.requestTick();
      return;
    }
    const pan = this.pan;
    if (!pan || pan.pointerId !== pointerId) return;
    const dy = p.y - pan.lastY;
    pan.lastY = p.y;
    pan.moved += Math.abs(dy);
    if (pan.moved <= DRAG_SLOP) return;
    this.host.setCursor?.('grabbing');
    const vp = this.host.viewport();
    const lim = this.host.limits();
    if (vp && lim) this.host.setViewport(scrollBy(vp, -dy, lim));
  }

  up(pointerId: number, p: Point): void {
    const o = this.overlay;
    if (o && o.pointerId === pointerId) {
      this.overlay = null;
      this.host.setCursor?.('');
      if (o.started) {
        this.suppressClick = true;
        this.host.dragChanged?.(false);
        guard(o.overlayId, 'drag.end', () => o.drag.end(this.host.pointerAt(p), o.start));
        if (o.hit.nudge) this.setActive({ overlayId: o.overlayId, hit: o.hit });
      }
      return;
    }
    if (this.pan && this.pan.pointerId === pointerId) {
      this.suppressClick = this.pan.moved > DRAG_SLOP;
      this.pan = null;
      this.host.setCursor?.('');
    }
  }

  /** Escape: cancela el arrastre en curso o suelta el elemento activo. true si hizo algo. */
  cancel(overlayId?: string): boolean {
    const o = this.overlay;
    if (overlayId && (o?.overlayId ?? this.activeHit?.overlayId) !== overlayId) return false;
    if (o) {
      this.overlay = null;
      this.suppressClick = true;
      this.host.setCursor?.('');
      if (o.started) {
        this.host.dragChanged?.(false);
        guard(o.overlayId, 'drag.cancel', () => o.drag.cancel?.());
      }
      return true;
    }
    if (this.activeHit) {
      this.setActive(null);
      return true;
    }
    return false;
  }

  /** Un cuadro de desplazamiento automático. true si hay que seguir. */
  tick(): boolean {
    const o = this.overlay;
    if (!o?.started) return false;
    const speed = this.autoscrollSpeed(o.last);
    const vp = this.host.viewport();
    const lim = this.host.limits();
    if (!speed || !vp || !lim) return false;
    const next = scrollBy(vp, speed, lim);
    if (next.top === vp.top) return false; // tope o base del pozo
    this.host.setViewport(next);
    guard(o.overlayId, 'drag.move', () => o.drag.move(this.host.pointerAt(o.last), o.start));
    this.host.requestTick();
    return true;
  }

  /** ¿El click que llegó es un clic de verdad? (consume la marca de arrastre). */
  takeClick(): boolean {
    const ok = !this.suppressClick;
    this.suppressClick = false;
    return ok;
  }

  /** Después de un clic sobre un elemento: queda activo si se puede mover con el teclado. */
  clicked(h: HitResult | null): void {
    this.setActive(h?.hit.nudge ? h : null);
  }

  /** Activa un elemento llegado con el teclado (o null para soltarlo). */
  focus(h: HitResult | null): void {
    this.setActive(h);
  }

  /** Clave del elemento activo (si su `hit` la da), para el resaltado. */
  get activeKey(): { overlayId: string; key: string } | null {
    const a = this.activeHit;
    return a?.hit.key ? { overlayId: a.overlayId, key: a.hit.key } : null;
  }

  private setActive(h: HitResult | null): void {
    const prev = this.activeHit;
    this.activeHit = h;
    if (prev !== h && (prev?.hit.key !== h?.hit.key || prev?.overlayId !== h?.overlayId)) this.host.activeChanged?.(h);
  }

  /** ↑/↓ con un elemento activo: lo mueve. false si no hay elemento activo. */
  nudge(deltaM: number): boolean {
    const a = this.activeHit;
    if (!a?.hit.nudge) return false;
    guard(a.overlayId, 'nudge', () => a.hit.nudge!(deltaM));
    return true;
  }

  /** Velocidad del desplazamiento automático (px/cuadro; negativa = hacia arriba) para un punto. */
  private autoscrollSpeed(p: Point): number {
    const vp = this.host.viewport();
    if (!vp) return 0;
    if (p.y < AUTOSCROLL_EDGE) return -AUTOSCROLL_MAX * Math.min(1, (AUTOSCROLL_EDGE - p.y) / AUTOSCROLL_EDGE);
    if (p.y > vp.height - AUTOSCROLL_EDGE) return AUTOSCROLL_MAX * Math.min(1, (p.y - (vp.height - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE);
    return 0;
  }
}
