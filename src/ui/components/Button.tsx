/** Botón y botón de ícono. Variantes: primaria, secundaria, fantasma, peligro. Tamaños: sm, md, lg. */
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import './button.css';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  /** Muestra un spinner y desactiva el botón. */
  loading?: boolean;
  /** Ocupa todo el ancho disponible. */
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, loading = false, block = false, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  const cls = ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, block && 'ui-btn--block', loading && 'is-loading', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner size={ICON_SIZE[size]} /> : icon ? <Icon name={icon} size={ICON_SIZE[size]} /> : null}
      {children !== undefined && children !== null && <span className="ui-btn__label">{children}</span>}
      {iconRight && <Icon name={iconRight} size={ICON_SIZE[size]} />}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Obligatorio: nombre accesible y texto del tooltip. */
  label: string;
  variant?: Exclude<ButtonVariant, 'primary'> | 'primary';
  size?: ButtonSize;
  /** Estado activado (botón de alternar): aria-pressed. */
  pressed?: boolean;
  /** Muestra el tooltip con `label` (por defecto sí). */
  tooltip?: boolean;
  /** Contenido extra en el tooltip (p. ej. atajo). */
  hint?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, variant = 'ghost', size = 'md', pressed, tooltip = true, hint, className, type = 'button', ...rest }: IconButtonProps) {
  const cls = ['ui-btn', 'ui-btn--icon', `ui-btn--${variant}`, `ui-btn--${size}`, className].filter(Boolean).join(' ');
  const button = (
    <button type={type} className={cls} aria-label={label} aria-pressed={pressed} {...rest}>
      <Icon name={icon} size={ICON_SIZE[size]} />
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip
      content={
        hint ? (
          <>
            {label} <span className="ui-tooltip__hint">{hint}</span>
          </>
        ) : (
          label
        )
      }
      describe={false}
    >
      {button}
    </Tooltip>
  );
}
