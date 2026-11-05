/**
 * Menú desplegable (role="menu"): flechas, Inicio/Fin, letra inicial, Enter/Espacio, Escape devuelve el foco al
 * botón, clic afuera cierra. El disparador se arma con una función que recibe sus props.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react';
import './overlay.css';
import { Icon, type IconName } from './Icon';
import { Portal, useAnchoredPosition, useOutsidePointerDown, type Align } from './layer';

export type MenuEntry =
  | { type?: 'item'; id: string; label: ReactNode; icon?: IconName; hint?: ReactNode; description?: ReactNode; disabled?: boolean; danger?: boolean; onSelect(): void }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: ReactNode };

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string;
  onClick(): void;
  onKeyDown(e: KeyboardEvent): void;
}

export interface MenuProps {
  trigger(props: MenuTriggerProps): ReactNode;
  items: readonly MenuEntry[];
  align?: Align;
  /** Ancho mínimo del menú en px. */
  minWidth?: number;
  'aria-label'?: string;
}

export function Menu({ trigger, items, align = 'end', minWidth = 220, ...aria }: MenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(triggerRef, menuRef, open, 'bottom', align, 6);
  const enabled = enabledIndexes(items);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setActive(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);
  useOutsidePointerDown([triggerRef, menuRef], () => close(false), open);

  const openWith = (index: number) => {
    setOpen(true);
    setActive(index);
  };

  const triggerProps: MenuTriggerProps = {
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': id,
    onClick: () => (open ? close(false) : openWith(enabled[0] ?? -1)),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openWith(enabled[0] ?? -1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        openWith(enabled[enabled.length - 1] ?? -1);
      }
    },
  };

  return (
    <>
      {trigger(triggerProps)}
      {open && <MenuPanel id={id} menuRef={menuRef} items={items} active={active} setActive={setActive} close={close} ready={pos.ready} top={pos.top} left={pos.left} minWidth={minWidth} label={aria['aria-label']} />}
    </>
  );
}

const enabledIndexes = (items: readonly MenuEntry[]) => items.map((it, i) => ((it.type ?? 'item') === 'item' && !(it as { disabled?: boolean }).disabled ? i : -1)).filter((i) => i >= 0);

interface MenuPanelProps {
  id?: string;
  menuRef: RefObject<HTMLDivElement | null>;
  items: readonly MenuEntry[];
  active: number;
  setActive(i: number): void;
  /** Cierra; `refocus` = devolver el foco a quien abrió el menú. */
  close(refocus?: boolean): void;
  ready: boolean;
  top: number;
  left: number;
  minWidth: number;
  label?: string | undefined;
  /** Encabezado no interactivo arriba de las opciones (menú contextual: profundidad y lecturas). */
  header?: ReactNode;
}

/** Lista de opciones con el teclado del menú (flechas, Inicio/Fin, letra inicial, Escape, Tab). */
function MenuPanel({ id, menuRef, items, active, setActive, close, ready, top, left, minWidth, label, header }: MenuPanelProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = enabledIndexes(items);
  useEffect(() => {
    if (active >= 0 && ready) refs.current[active]?.focus();
  }, [active, ready, refs]);
  const move = (dir: 1 | -1) => {
    if (enabled.length === 0) return;
    const at = enabled.indexOf(active);
    const next = at < 0 ? (dir > 0 ? 0 : enabled.length - 1) : (at + dir + enabled.length) % enabled.length;
    setActive(enabled[next]!);
  };
  return (
    <Portal>
      <div
        ref={menuRef}
        id={id}
        role="menu"
        aria-label={label}
        className="ui-menu"
        data-open={ready ? '' : undefined}
        style={{ top, left, minWidth }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          switch (e.key) {
            case 'ArrowDown':
              e.preventDefault();
              move(1);
              break;
            case 'ArrowUp':
              e.preventDefault();
              move(-1);
              break;
            case 'Home':
              e.preventDefault();
              setActive(enabled[0] ?? -1);
              break;
            case 'End':
              e.preventDefault();
              setActive(enabled[enabled.length - 1] ?? -1);
              break;
            case 'Escape':
              e.preventDefault();
              e.stopPropagation();
              close();
              break;
            case 'Tab':
              close(false);
              break;
            default:
              if (e.key.length === 1 && /\S/.test(e.key)) {
                const k = e.key.toLowerCase();
                const hit = enabled.find((i) => {
                  const label = (items[i] as { label: ReactNode }).label;
                  return typeof label === 'string' && label.toLowerCase().startsWith(k);
                });
                if (hit !== undefined) setActive(hit);
              }
          }
        }}
      >
        {header && <div className="ui-menu__header">{header}</div>}
        {items.map((it, i) => {
          if (it.type === 'separator') return <div key={it.id} role="separator" className="ui-menu__sep" />;
          if (it.type === 'label') return <div key={it.id} className="ui-menu__label">{it.label}</div>;
          return (
            <button
              key={it.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              disabled={it.disabled}
              className={`ui-menu__item${it.danger ? ' is-danger' : ''}`}
              onMouseEnter={() => !it.disabled && setActive(i)}
              onClick={() => {
                close();
                it.onSelect();
              }}
            >
              <span className="ui-menu__icon">{it.icon && <Icon name={it.icon} size={15} />}</span>
              <span className="ui-menu__text">
                <span>{it.label}</span>
                {it.description && <span className="ui-menu__desc">{it.description}</span>}
              </span>
              {it.hint && <span className="ui-menu__hint">{it.hint}</span>}
            </button>
          );
        })}
      </div>
    </Portal>
  );
}

export interface ContextMenuProps {
  /** Punto donde se abre (coordenadas de la ventana, `clientX/clientY`); null = cerrado. */
  at: { x: number; y: number } | null;
  items: readonly MenuEntry[];
  onClose(): void;
  /** Encabezado no interactivo (p. ej. la profundidad y las lecturas del punto). */
  header?: ReactNode;
  minWidth?: number;
  'aria-label'?: string;
  /** Al cerrar con Escape o al elegir, devolver el foco acá (por defecto, al elemento que lo tenía al abrir). */
  returnFocus?: RefObject<HTMLElement | null>;
}

/**
 * Menú contextual (clic derecho o tecla Menú / Mayús+F10): el mismo teclado que `Menu` (flechas, Inicio/Fin, letra
 * inicial, Escape devuelve el foco), abierto en un punto y acotado a la ventana. La primera opción toma el foco.
 */
export function ContextMenu({ at, items, onClose, header, minWidth = 240, returnFocus, ...aria }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number; ready: boolean }>({ top: -9999, left: -9999, ready: false });
  const opener = useRef<HTMLElement | null>(null);
  const open = at !== null;
  useLayoutEffect(() => {
    if (!at) {
      setPos((p) => (p.ready ? { top: -9999, left: -9999, ready: false } : p));
      return;
    }
    opener.current = (document.activeElement as HTMLElement | null) ?? null;
    const f = menuRef.current;
    const w = f?.offsetWidth ?? minWidth;
    const h = f?.offsetHeight ?? 200;
    const m = 8;
    const left = Math.min(Math.max(m, at.x), window.innerWidth - w - m);
    const top = at.y + h + m > window.innerHeight ? Math.max(m, at.y - h) : at.y;
    setPos({ top, left, ready: true });
    setActive(enabledIndexes(items)[0] ?? -1);
    // Solo al abrir en otro punto: las opciones pueden cambiar mientras está abierto sin moverlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at?.x, at?.y, open]);
  const close = useCallback(
    (refocus = true) => {
      onClose();
      if (refocus) (returnFocus?.current ?? opener.current)?.focus({ preventScroll: true });
    },
    [onClose, returnFocus],
  );
  useOutsidePointerDown([menuRef], () => close(false), open);
  useEffect(() => {
    if (!open) return;
    const off = () => close(false);
    window.addEventListener('resize', off);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('resize', off);
      window.removeEventListener('blur', off);
    };
  }, [open, close]);
  if (!at) return null;
  return <MenuPanel menuRef={menuRef} items={items} active={active} setActive={setActive} close={close} ready={pos.ready} top={pos.top} left={pos.left} minWidth={minWidth} label={aria['aria-label']} header={header} />;
}
