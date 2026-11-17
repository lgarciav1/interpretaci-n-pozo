/**
 * Indicador del modo defensa (docs/decisiones/0075, punto 6): abajo al centro del visor, «3 / 5 · Nombre de la vista»
 * con ‹ › y «Salir». Se atenúa a los pocos segundos sin movimiento y vuelve con el mouse o una tecla. Publica el tramo
 * visible del visor en `data-top` / `data-base` (sin volver a pintarse) para las pruebas de punta a punta.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Icon, IconButton } from '../../ui';
import { useViewer } from '../store/viewer';
import { exitDefense, nextDefenseView, prevDefenseView } from './actions';
import { useViewsUi } from './store';
import './views.css';

/** Sin movimiento durante este tiempo, el indicador se atenúa. */
const IDLE_MS = 2600;

/** Escribe el tramo visible del visor en atributos `data-` del elemento (por suscripción, sin render). */
export function useVisibleRangeAttrs(ref: React.RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const apply = (v: { top: number; base: number } | null) => {
      const el = ref.current;
      if (!el) return;
      if (v) {
        el.dataset['top'] = v.top.toFixed(2);
        el.dataset['base'] = v.base.toFixed(2);
      } else {
        delete el.dataset['top'];
        delete el.dataset['base'];
      }
    };
    apply(useViewer.getState().visible);
    return useViewer.subscribe((s, prev) => {
      if (s.visible !== prev.visible) apply(s.visible);
    });
  }, [ref]);
}

/** Atenuado por inactividad: vuelve con el mouse, el teclado o al cambiar de vista. */
function useIdle(resetKey: unknown): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [resetKey]);
  return idle;
}

export function DefenseHud() {
  const defense = useViewsUi((s) => s.defense);
  const ref = useRef<HTMLDivElement>(null);
  useVisibleRangeAttrs(ref);
  const idle = useIdle(defense?.index);
  if (!defense) return null;
  const total = defense.viewIds.length;
  const index = defense.index;
  const issue = defense.issues.map((x) => x.message).join(' · ');
  return (
    <div
      ref={ref}
      className={`defense-hud${idle ? ' is-idle' : ''}`}
      role="toolbar"
      aria-label="Modo defensa: vistas guardadas"
      data-testid="defense-hud"
      data-index={index + 1}
      data-total={total}
    >
      <IconButton icon="chevron-left" label="Vista anterior" hint="←" size="sm" disabled={index <= 0} onClick={prevDefenseView} data-testid="defense-prev" />
      <div className="defense-hud__text" aria-live="polite">
        <span className="defense-hud__index num" data-testid="defense-index">{`${index + 1} / ${total}`}</span>
        <span className="defense-hud__sep" aria-hidden="true">·</span>
        <span className="defense-hud__name" data-testid="defense-name" title={defense.name}>
          {defense.name}
        </span>
        {issue && (
          <span className="defense-hud__issue" data-testid="defense-issue" title={issue}>
            <Icon name="warning" size={13} />
            {issue}
          </span>
        )}
      </div>
      <IconButton icon="chevron-right" label="Vista siguiente" hint="→" size="sm" disabled={index >= total - 1} onClick={nextDefenseView} data-testid="defense-next" />
      <span className="defense-hud__divider" aria-hidden="true" />
      <Button size="sm" variant="ghost" className="defense-hud__exit" onClick={() => exitDefense()} data-testid="defense-exit" title="Salir del modo defensa y volver a la disposición anterior">
        Salir <kbd className="ui-kbd">Esc</kbd>
      </Button>
      <span className="defense-hud__progress" aria-hidden="true">
        <span style={{ width: `${((index + 1) / Math.max(1, total)) * 100}%` }} />
      </span>
    </div>
  );
}

/**
 * Tramo visible del visor publicado en el DOM (`data-testid="viewer-visible"`, oculto) para las pruebas de punta a punta
 * (el store no es accesible desde afuera). No vuelve a pintarse al desplazar el perfil.
 */
export function VisibleRangeProbe() {
  const ref = useRef<HTMLSpanElement>(null);
  useVisibleRangeAttrs(ref);
  return <span ref={ref} hidden data-testid="viewer-visible" />;
}
