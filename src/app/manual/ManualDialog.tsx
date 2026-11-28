import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, toast, useResolvedTheme } from '../../ui';
import { useUi } from '../store/ui';
import { closeManual, getThemedManualHtml, openManualInNewTab } from './open';
import './manual.css';

export function ManualDialog() {
  const state = useUi((s) => s.manual);
  const theme = useResolvedTheme();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const wasOpenRef = useRef(false);
  const prevAnchorRef = useRef<string | undefined>(undefined);

  const isOpen = !!state;
  const anchor = state?.anchor;

  const postToIframe = useCallback((payload: unknown) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(payload, '*');
    } catch {
      // Sin acceso al marco tras navegación externa
    }
  }, []);

  const syncThemeToIframe = useCallback(() => {
    postToIframe({ type: 'fiubalog:manual-theme', theme });
  }, [postToIframe, theme]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      prevAnchorRef.current = anchor;
      setSrcDoc(getThemedManualHtml(theme, anchor));
    } else if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      prevAnchorRef.current = undefined;
      setSrcDoc('');
    } else if (isOpen && anchor !== prevAnchorRef.current) {
      prevAnchorRef.current = anchor;
      if (anchor) postToIframe({ type: 'fiubalog:manual-anchor', anchor });
    }
  }, [isOpen, anchor, theme, postToIframe]);

  useEffect(() => {
    if (!isOpen || !srcDoc) return;
    syncThemeToIframe();
  }, [isOpen, srcDoc, syncThemeToIframe]);

  useEffect(() => {
    if (!isOpen) return;
    const onMessage = (ev: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || ev.source !== win) return;
      if (ev.data && typeof ev.data === 'object' && ev.data.type === 'fiubalog:manual-close') {
        closeManual();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isOpen]);

  function handleOpenNewTab() {
    if (!openManualInNewTab(theme, anchor)) {
      toast({ title: 'Si no se abrió una pestaña nueva, habilitá las ventanas emergentes', tone: 'warn' });
    }
  }

  function handlePrint() {
    try {
      const win = iframeRef.current?.contentWindow;
      if (win) {
        win.focus();
        win.print();
        return;
      }
    } catch {
      // Respaldo: abrir en pestaña nueva si el marco restringe print()
    }
    handleOpenNewTab();
  }

  return (
    <Dialog
      open={isOpen}
      onClose={closeManual}
      size="full"
      flush
      className="manual-dialog"
      title="Manual de uso"
      description="Guía visual completa de fiubaLog (disponible sin conexión)"
      headerExtra={
        <div className="manual-dialog__actions">
          <Button size="sm" variant="ghost" icon="printer" onClick={handlePrint} data-testid="manual-print">
            Imprimir / PDF
          </Button>
          <Button size="sm" variant="secondary" icon="external-link" onClick={handleOpenNewTab} data-testid="manual-new-tab">
            Abrir en pestaña nueva
          </Button>
        </div>
      }
    >
      {isOpen && srcDoc && (
        <iframe
          ref={iframeRef}
          tabIndex={0}
          className="manual-dialog__frame"
          data-testid="manual-iframe"
          title="Manual de uso de fiubaLog"
          srcDoc={srcDoc}
          onLoad={syncThemeToIframe}
        />
      )}
    </Dialog>
  );
}
