/** Componentes de estado: Badge, Chip, StatusDot, Callout, EmptyState. */
import type { CSSProperties, ReactNode } from 'react';
import './feedback.css';
import { Icon, type IconName } from './Icon';

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'error' | 'info';

export interface BadgeProps {
  tone?: Tone;
  /** soft (fondo suave), outline (solo borde) o solid. */
  variant?: 'soft' | 'outline' | 'solid';
  icon?: IconName;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ tone = 'neutral', variant = 'soft', icon, children, className, title }: BadgeProps) {
  return (
    <span className={['ui-badge', `ui-badge--${tone}`, `ui-badge--${variant}`, className].filter(Boolean).join(' ')} title={title}>
      {icon && <Icon name={icon} size={12} strokeWidth={2} />}
      {children}
    </span>
  );
}

export interface ChipProps {
  children: ReactNode;
  /** Muestra para el color (zona, curva). */
  color?: string;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  title?: string;
}

/** Ficha con muestra de color: zonas, curvas, filtros. Clic para seleccionar, × para quitar. */
export function Chip({ children, color, selected, onClick, onRemove, removeLabel = 'Quitar', title }: ChipProps) {
  const swatch = color ? <span className="ui-chip__swatch" style={{ background: color }} aria-hidden="true" /> : null;
  return (
    <span className={`ui-chip${selected ? ' is-selected' : ''}${onClick ? ' is-interactive' : ''}`} title={title}>
      {onClick ? (
        <button type="button" className="ui-chip__main" aria-pressed={selected} onClick={onClick}>
          {swatch}
          {children}
        </button>
      ) : (
        <span className="ui-chip__main">
          {swatch}
          {children}
        </span>
      )}
      {onRemove && (
        <button type="button" className="ui-chip__remove" aria-label={`${removeLabel} ${typeof children === 'string' ? children : ''}`.trim()} onClick={onRemove}>
          <Icon name="x" size={12} strokeWidth={2} />
        </button>
      )}
    </span>
  );
}

/**
 * Punto de estado (semáforo). `label` es el nombre accesible y, por defecto, el `title` nativo; con
 * `nativeTitle={false}` no lo lleva (cuando el punto va dentro de un `<Tooltip>`, para no mostrar dos ayudas).
 */
export function StatusDot({ tone, label, pulse = false, nativeTitle = true }: { tone: Tone; label: string; pulse?: boolean; nativeTitle?: boolean }) {
  return <span className={`ui-dot ui-dot--${tone}${pulse ? ' is-pulsing' : ''}`} role="img" aria-label={label} title={nativeTitle ? label : undefined} />;
}

const CALLOUT_ICON: Record<Tone, IconName> = { neutral: 'info', accent: 'info', info: 'info', ok: 'check-circle', warn: 'warning', error: 'error' };

export interface CalloutProps {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: IconName | null;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Mensaje destacado dentro de un panel. Los errores se anuncian (role="alert"). */
export function Callout({ tone = 'info', title, children, icon, actions, className, style }: CalloutProps) {
  const ic = icon === null ? null : (icon ?? CALLOUT_ICON[tone]);
  return (
    <div className={['ui-callout', `ui-callout--${tone}`, className].filter(Boolean).join(' ')} role={tone === 'error' ? 'alert' : 'status'} style={style}>
      {ic && <Icon name={ic} size={16} className="ui-callout__icon" />}
      <div className="ui-callout__body">
        {title && <div className="ui-callout__title">{title}</div>}
        {children && <div className="ui-callout__text">{children}</div>}
        {actions && <div className="ui-callout__actions">{actions}</div>}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Estado vacío que dice qué hacer: ícono, título, explicación y acciones. */
export function EmptyState({ icon, title, description, actions, size = 'md', className }: EmptyStateProps) {
  return (
    <div className={['ui-empty', `ui-empty--${size}`, className].filter(Boolean).join(' ')}>
      {icon && (
        <div className="ui-empty__icon">
          <Icon name={icon} size={size === 'sm' ? 18 : size === 'lg' ? 26 : 22} />
        </div>
      )}
      <div className="ui-empty__title">{title}</div>
      {description && <div className="ui-empty__text">{description}</div>}
      {actions && <div className="ui-empty__actions">{actions}</div>}
    </div>
  );
}
