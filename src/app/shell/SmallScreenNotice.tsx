/**
 * Aviso de pantalla chica (docs/decisiones/0069): el espacio de trabajo necesita al menos ~1024 px de ancho (perfil,
 * panel y barra). En un teléfono, en vez de mostrarlo recortado, se explica y se ofrece volver al Inicio o seguir igual
 * (la elección dura la sesión). El Inicio sí se adapta al teléfono (0065) y no muestra este aviso.
 */
import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { BrandMark, Button } from '../../ui';
import { openHome } from '../home/actions';
import { useHome } from '../home/store';

/** Ancho (px CSS de pantalla) por debajo del cual el espacio de trabajo no se puede usar. */
export const SMALL_SCREEN_MAX = 760;
const KEY = 'pozo.ui.smallScreenOk';

/** Puro: ¿la pantalla es demasiado angosta para el espacio de trabajo? */
export function isSmallScreen(innerWidth: number, screenWidth: number | undefined): boolean {
  // En el teléfono el armazón (min-width 1024) puede inflar el viewport de layout: manda el menor de los dos anchos.
  const w = Math.min(innerWidth, screenWidth && screenWidth > 0 ? screenWidth : Infinity);
  return w < SMALL_SCREEN_MAX;
}

const subscribe = (fn: () => void) => {
  window.addEventListener('resize', fn);
  return () => window.removeEventListener('resize', fn);
};
const snapshot = () => isSmallScreen(window.innerWidth, window.screen?.width);

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function SmallScreenNotice({ shellRef }: { shellRef: RefObject<HTMLDivElement | null> }) {
  const small = useSyncExternalStore(subscribe, snapshot, () => false);
  const homeClosed = useHome((s) => s.phase === 'closed');
  const [dismissed, setDismissed] = useState(readDismissed);
  const show = small && homeClosed && !dismissed;

  // Mientras se muestra, el armazón queda inerte y sin su ancho mínimo (si no, el aviso mediría 1024 px).
  useEffect(() => {
    const el = shellRef.current;
    if (!show || !el) return;
    el.classList.add('is-small-blocked');
    el.inert = true;
    return () => {
      el.classList.remove('is-small-blocked');
      const phase = useHome.getState().phase;
      el.inert = phase === 'open' || phase === 'entering';
    };
  }, [show, shellRef]);

  if (!show) return null;
  return (
    <div className="small-screen" role="alertdialog" aria-modal="true" aria-labelledby="small-screen-title" aria-describedby="small-screen-text" data-testid="small-screen-notice">
      <BrandMark />
      <h2 id="small-screen-title" className="small-screen__title">Mejor en una pantalla más grande</h2>
      <p id="small-screen-text" className="small-screen__text">
        El perfil, los gráficos y los parámetros necesitan al menos 1024 px de ancho. Abrí fiubaLog en una computadora o girá el dispositivo; el trabajo queda como está.
      </p>
      <div className="small-screen__actions">
        <Button variant="primary" icon="well" onClick={openHome}>
          Volver al Inicio
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            try {
              sessionStorage.setItem(KEY, '1');
            } catch {
              // sin almacenamiento: vale hasta recargar
            }
            setDismissed(true);
          }}
          data-testid="small-screen-continue"
        >
          Seguir igual
        </Button>
      </div>
    </div>
  );
}
