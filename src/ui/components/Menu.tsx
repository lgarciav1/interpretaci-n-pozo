/**
 * Menú desplegable (role="menu"): flechas, Inicio/Fin, letra inicial, Enter/Espacio, Escape devuelve el foco al
 * botón, clic afuera cierra. El disparador se arma con una función que recibe sus props.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
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
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pos = useAnchoredPosition(triggerRef, menuRef, open, 'bottom', align, 6);
  const enabled = items.map((it, i) => ((it.type ?? 'item') === 'item' && !(it as { disabled?: boolean }).disabled ? i : -1)).filter((i) => i >= 0);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setActive(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);
  useOutsidePointerDown([triggerRef, menuRef], () => close(false), open);

  useEffect(() => {
    if (open && active >= 0 && pos.ready) refs.current[active]?.focus();
  }, [open, active, pos.ready, refs]);

  const openWith = (index: number) => {
    setOpen(true);
    setActive(index);
  };

  const move = (dir: 1 | -1) => {
    if (enabled.length === 0) return;
    const at = enabled.indexOf(active);
    const next = at < 0 ? (dir > 0 ? 0 : enabled.length - 1) : (at + dir + enabled.length) % enabled.length;
    setActive(enabled[next]!);
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
      {open && (
        <Portal>
          <div
            ref={menuRef}
            id={id}
            role="menu"
            aria-label={aria['aria-label']}
            className="ui-menu"
            data-open={pos.ready ? '' : undefined}
            style={{ top: pos.top, left: pos.left, minWidth }}
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
      )}
    </>
  );
}
