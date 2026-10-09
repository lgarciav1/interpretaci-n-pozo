/**
 * Utilidades de capas flotantes: portal, posicionamiento anclado (con giro si no entra), foco y clic afuera.
 * Las usan Tooltip, Menu y Dialog.
 */
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export function Portal({ children }: { children: ReactNode }) {
  return typeof document === 'undefined' ? null : createPortal(children, document.body);
}

export type Placement = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';

export interface AnchoredPosition {
  top: number;
  left: number;
  placement: Placement;
  ready: boolean;
}

const MARGIN = 8;

/** Calcula la posición `fixed` de `floating` junto a `anchor`; gira al lado opuesto si no entra. */
export function computePosition(anchor: DOMRect, floating: { width: number; height: number }, placement: Placement, align: Align, offset: number, viewport: { width: number; height: number }): Omit<AnchoredPosition, 'ready'> {
  const fits = (p: Placement) => {
    switch (p) {
      case 'top':
        return anchor.top - offset - floating.height >= MARGIN;
      case 'bottom':
        return anchor.bottom + offset + floating.height <= viewport.height - MARGIN;
      case 'left':
        return anchor.left - offset - floating.width >= MARGIN;
      case 'right':
        return anchor.right + offset + floating.width <= viewport.width - MARGIN;
    }
  };
  const opposite: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const p = fits(placement) || !fits(opposite[placement]) ? placement : opposite[placement];
  let top: number;
  let left: number;
  if (p === 'top' || p === 'bottom') {
    top = p === 'top' ? anchor.top - offset - floating.height : anchor.bottom + offset;
    left = align === 'start' ? anchor.left : align === 'end' ? anchor.right - floating.width : anchor.left + anchor.width / 2 - floating.width / 2;
  } else {
    left = p === 'left' ? anchor.left - offset - floating.width : anchor.right + offset;
    top = align === 'start' ? anchor.top : align === 'end' ? anchor.bottom - floating.height : anchor.top + anchor.height / 2 - floating.height / 2;
  }
  left = Math.min(Math.max(MARGIN, left), viewport.width - floating.width - MARGIN);
  top = Math.min(Math.max(MARGIN, top), viewport.height - floating.height - MARGIN);
  return { top, left, placement: p };
}

/** Posición de una capa anclada; se recalcula al abrir, al hacer scroll y al cambiar el tamaño de la ventana. */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  open: boolean,
  placement: Placement = 'bottom',
  align: Align = 'center',
  offset = 6,
): AnchoredPosition {
  const [pos, setPos] = useState<AnchoredPosition>({ top: -9999, left: -9999, placement, ready: false });
  const update = useCallback(() => {
    const a = anchorRef.current;
    const f = floatingRef.current;
    if (!a || !f) return;
    const r = computePosition(a.getBoundingClientRect(), { width: f.offsetWidth, height: f.offsetHeight }, placement, align, offset, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    setPos((prev) => (prev.top === r.top && prev.left === r.left && prev.placement === r.placement && prev.ready ? prev : { ...r, ready: true }));
  }, [anchorRef, floatingRef, placement, align, offset]);

  useLayoutEffect(() => {
    if (!open) {
      setPos((p) => (p.ready ? { ...p, ready: false } : p));
      return;
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, update]);
  return pos;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden') && el.getClientRects().length > 0);
}

/** Llama a `handler` con un pointerdown fuera de todos los `refs` mientras `active`. */
export function useOutsidePointerDown(refs: readonly RefObject<HTMLElement | null>[], handler: () => void, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      handler();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [refs, handler, active]);
}
