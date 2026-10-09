/**
 * Deshacer/rehacer desde la interfaz: acciones con aviso breve y atajos de teclado globales.
 * - Ctrl/Cmd+Z deshace; Ctrl/Cmd+Mayús+Z y Ctrl+Y rehacen.
 * - Con el foco en un campo de texto editable se deja el deshacer nativo del navegador.
 * - Con un arrastre en curso en el visor no se hace nada (Escape lo cancela).
 */
import { dismissToast, toast } from '../../ui';
import { useProject } from '../store/project';
import { useViewer } from '../store/viewer';

const TOAST_MS = 2200;
/** Un solo aviso a la vez: deshacer varias veces seguidas reemplaza el anterior en vez de apilarlos. */
let lastToast: number | null = null;
function notify(title: string): void {
  if (lastToast !== null) dismissToast(lastToast);
  lastToast = toast({ title, duration: TOAST_MS });
}

export function undoChange(): void {
  const label = useProject.getState().undo();
  if (label) notify(`Se deshizo: ${label}`);
}

export function redoChange(): void {
  const label = useProject.getState().redo();
  if (label) notify(`Se rehízo: ${label}`);
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const UNDO_SHORTCUT = IS_MAC ? '⌘Z' : 'Ctrl+Z';
export const REDO_SHORTCUT = IS_MAC ? '⌘⇧Z' : 'Ctrl+Mayús+Z';

const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password']);

/** ¿El elemento tiene su propio deshacer (campo de texto editable)? */
export function hasNativeUndo(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return TEXT_INPUTS.has(el.type) && !el.readOnly && !el.disabled;
  return false;
}

/** Qué hace la combinación: 'undo', 'redo' o null. */
export function historyShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): 'undo' | 'redo' | null {
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey && !IS_MAC) return 'redo';
  return null;
}

let installed = false;
export function installHistoryShortcuts(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const action = historyShortcut(e);
    if (!action) return;
    if (hasNativeUndo(document.activeElement)) return;
    e.preventDefault();
    if (useViewer.getState().dragging) return;
    if (action === 'undo') undoChange();
    else redoChange();
  });
}
