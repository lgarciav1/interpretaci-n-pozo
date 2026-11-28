/** Abrir, preparar tema y abrir en pestaña nueva el manual HTML visual embebido (sin React). */
import { MANUAL_HTML } from 'virtual:manual-html';
import { useUi } from '../store/ui';
import { patchManualDocumentAttrs, type ManualTheme } from './inlineManual';

export function openManual(anchor?: string): void {
  useUi.getState().set({ manual: anchor ? { anchor } : {} });
}

export function closeManual(): void {
  useUi.getState().set({ manual: null });
}

/** Devuelve el HTML autocontenido con tema inicial y ancla opcional ya aplicados. */
export function getThemedManualHtml(theme: ManualTheme, anchor?: string): string {
  return patchManualDocumentAttrs(MANUAL_HTML, { theme, ...(anchor ? { anchor } : {}) });
}

const blobUrlCache = new Map<string, string>();

/**
 * Abre el manual autocontenido en una pestaña nueva mediante Blob URL (funciona también con `file://` sin conexión).
 */
export function openManualInNewTab(theme: 'light' | 'dark', anchor?: string): boolean {
  if (typeof window === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return false;
  const cacheKey = `${theme}:${anchor ?? ''}`;
  let url = blobUrlCache.get(cacheKey);
  if (!url) {
    const html = getThemedManualHtml(theme, anchor);
    url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    blobUrlCache.set(cacheKey, url);
  }
  const win = window.open(url, '_blank');
  if (win) return true;
  if (typeof document === 'undefined') return false;
  try {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return false;
  } catch {
    return false;
  }
}
