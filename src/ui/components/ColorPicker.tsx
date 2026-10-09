/**
 * Selector de color: muestras de la paleta de curvas (radiogroup con flechas) + «otro color» con el selector
 * nativo del sistema (accesible y sin dependencias). Devuelve hex #rrggbb.
 */
import { useRef, type KeyboardEvent } from 'react';
import { CURVE_SWATCHES } from '../curves';
import './colorpicker.css';
import { Icon } from './Icon';

export interface ColorPickerProps {
  value: string;
  onChange(hex: string): void;
  'aria-label': string;
  /** Muestras (por defecto, los colores clásicos de perfiles de `CURVE_SWATCHES`). */
  swatches?: readonly string[];
  disabled?: boolean;
}

const norm = (c: string) => c.trim().toLowerCase();

export function ColorPicker({ value, onChange, swatches = CURVE_SWATCHES, disabled, ...aria }: ColorPickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = swatches.findIndex((s) => norm(s) === norm(value));
  const custom = current < 0;
  const focusIndex = current < 0 ? 0 : current;

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const n = swatches.length;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(swatches[next]!);
  };

  return (
    <div className={['ui-color', disabled && 'is-disabled'].filter(Boolean).join(' ')}>
      <div role="radiogroup" aria-label={aria['aria-label']} className="ui-color__swatches">
        {swatches.map((s, i) => {
          const checked = i === current;
          return (
            <button
              key={s}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={s}
              title={s}
              tabIndex={i === focusIndex ? 0 : -1}
              disabled={disabled}
              className="ui-color__swatch"
              style={{ background: s }}
              onClick={() => onChange(s)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {checked && <Icon name="check" size={12} strokeWidth={2.5} className="ui-color__check" />}
            </button>
          );
        })}
      </div>
      <label className={['ui-color__custom', custom && 'is-selected'].filter(Boolean).join(' ')} title="Otro color">
        <span className="ui-color__custom-chip" style={custom ? { background: value } : undefined} aria-hidden="true">
          {!custom && <Icon name="plus" size={12} strokeWidth={2.25} />}
        </span>
        <span className="ui-color__custom-text num">{custom ? value : 'Otro'}</span>
        <input type="color" className="ui-color__native" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} disabled={disabled} aria-label="Otro color" onChange={(e) => onChange(e.currentTarget.value)} />
      </label>
    </div>
  );
}
