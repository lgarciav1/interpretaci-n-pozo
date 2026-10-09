/** Campos: Field (etiqueta + ayuda), Select, TextField, NumberField y Slider (lineal y log). */
import { useEffect, useId, useRef, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react';
import { formatParamValue, parseDecimal } from '../format';
import { clamp, positionToValue, stepValue, valueToPosition, type NumericScale } from '../scale';
import './fields.css';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';
import { useFlash } from './useFlash';

// ---------------------------------------------------------------------------------------------------------------

export interface FieldProps {
  label: ReactNode;
  /** id del control (para `htmlFor`). */
  htmlFor?: string;
  /** Ayuda en un tooltip junto a la etiqueta (ícono ⓘ). */
  tooltip?: ReactNode;
  /** Texto chico debajo del control. */
  hint?: ReactNode;
  error?: ReactNode;
  /** Elementos a la derecha de la etiqueta (insignias, "restablecer"). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

/** Etiqueta + control + ayuda, con espaciado consistente. */
export function Field({ label, htmlFor, tooltip, hint, error, aside, children, className, disabled }: FieldProps) {
  return (
    <div className={['ui-field', disabled && 'is-disabled', className].filter(Boolean).join(' ')}>
      <div className="ui-field__head">
        <label className="ui-field__label" htmlFor={htmlFor}>
          {label}
        </label>
        {tooltip && (
          <Tooltip content={tooltip} placement="top">
            <button type="button" className="ui-field__help" aria-label="Ayuda">
              <Icon name="help" size={14} />
            </button>
          </Tooltip>
        )}
        {aside && <div className="ui-field__aside">{aside}</div>}
      </div>
      {children}
      {error ? <div className="ui-field__error">{error}</div> : hint ? <div className="ui-field__hint">{hint}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'size'> {
  value: string;
  onChange(value: string): void;
  options?: readonly SelectOption[];
  groups?: readonly { label: string; options: readonly SelectOption[] }[];
  /** Opción vacía inicial. */
  placeholder?: string;
  size?: 'sm' | 'md';
  block?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

/** Selector nativo estilizado (accesible y rápido con muchas opciones). */
export function Select({ value, onChange, options, groups, placeholder, size = 'md', block, className, children, ...rest }: SelectProps) {
  const opt = (o: SelectOption) => (
    <option key={o.value} value={o.value} disabled={o.disabled}>
      {o.label}
    </option>
  );
  return (
    <span className={['ui-select', `ui-select--${size}`, block && 'ui-select--block', className].filter(Boolean).join(' ')}>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map(opt)}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map(opt)}
          </optgroup>
        ))}
        {children}
      </select>
      <Icon name="chevron-down" size={14} className="ui-select__chevron" />
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange' | 'prefix'> {
  value: string;
  onChange(value: string): void;
  icon?: IconName;
  /** Texto fijo al final (unidad). */
  suffix?: ReactNode;
  size?: 'sm' | 'md';
  invalid?: boolean;
  block?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ value, onChange, icon, suffix, size = 'md', invalid, block, className, style, ...rest }: TextFieldProps) {
  return (
    <span
      className={['ui-input', `ui-input--${size}`, invalid && 'is-invalid', block && 'ui-input--block', rest.disabled && 'is-disabled', className].filter(Boolean).join(' ')}
      style={style}
    >
      {icon && <Icon name={icon} size={14} className="ui-input__icon" />}
      <input type="text" value={value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.currentTarget.value)} {...rest} />
      {suffix && <span className="ui-input__suffix">{suffix}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export interface NumberFieldProps extends NumericScale {
  value: number;
  onChange(value: number): void;
  /** Unidad que se muestra al final del campo. */
  unit?: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Ancho del campo (px o CSS). */
  width?: CSSProperties['width'];
  /** Formato del valor (por defecto según el paso, con coma decimal). */
  format?: (v: number) => string;
  /** Si es false, no recorta al rango min–max. */
  clampToRange?: boolean;
}

/**
 * Campo numérico con coma o punto decimal. Confirma con Enter o al salir; Escape descarta; flechas ↑/↓ cambian
 * por un paso (Mayús: ×10; en escala log, proporcional). Al cambiar desde afuera (slider) el valor destella.
 */
export function NumberField({ value, onChange, unit, disabled, size = 'md', width, format, clampToRange = true, min, max, step, scale, ...rest }: NumberFieldProps) {
  const s: NumericScale = { min, max, ...(step !== undefined ? { step } : {}), ...(scale ? { scale } : {}) };
  const fmt = format ?? ((v: number) => formatParamValue(v, s));
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // Destella solo cuando el valor cambia desde afuera (slider, otra zona), no mientras se escribe.
  const flash = useFlash(value);
  const parsed = draft === null ? value : parseDecimal(draft);
  const invalid = draft !== null && parsed === null;

  const commit = (v: number | null) => {
    setDraft(null);
    if (v === null || !Number.isFinite(v)) return;
    const next = clampToRange ? clamp(v, min, max) : v;
    if (next !== value) onChange(next);
  };

  return (
    <span
      className={['ui-input', 'ui-input--number', `ui-input--${size}`, invalid && 'is-invalid', disabled && 'is-disabled'].filter(Boolean).join(' ')}
      style={width !== undefined ? { width } : undefined}
    >
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className="ui-flash num"
        data-flash={focused ? undefined : flash}
        value={draft ?? fmt(value)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          setFocused(false);
          commit(parsed);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(parsed);
          } else if (e.key === 'Escape') {
            if (draft !== null) {
              e.stopPropagation();
              setDraft(null);
            }
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = parsed ?? value;
            commit(stepValue(base, e.key === 'ArrowUp' ? 1 : -1, s, e.shiftKey));
          }
        }}
        {...rest}
      />
      {unit && <span className="ui-input__suffix">{unit}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export interface SliderProps extends NumericScale {
  value: number;
  onChange(value: number): void;
  /** Se llama al soltar (fin de arrastre o tecla). */
  onCommit?(value: number): void;
  disabled?: boolean;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Texto que anuncia el lector de pantalla (por defecto, el valor formateado). */
  formatValue?: (v: number) => string;
  /** Marca de referencia en el riel (p. ej. el valor por defecto). */
  mark?: { value: number; label: string };
}

/**
 * Slider lineal o logarítmico sobre `<input type="range">` nativo (arrastre, clic y teclado accesibles).
 * Trabaja con la posición t ∈ [0, 1] (src/ui/scale.ts) y anuncia el valor real con aria-valuetext.
 * Teclado: flechas = un paso; Re Pág/Av Pág o Mayús+flecha = 10 pasos; Inicio/Fin = extremos.
 */
export function Slider({ value, onChange, onCommit, disabled, formatValue, mark, min, max, step, scale, ...rest }: SliderProps) {
  const s: NumericScale = { min, max, ...(step !== undefined ? { step } : {}), ...(scale ? { scale } : {}) };
  const t = valueToPosition(value, s);
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;
  const text = formatValue ? formatValue(value) : formatParamValue(value, s);

  // El valor del input nativo se controla a mano: React no reasigna `value` si no cambió el número.
  useEffect(() => {
    if (ref.current && Number(ref.current.value) !== t) ref.current.value = String(t);
  }, [t]);

  const emit = (v: number) => {
    if (v !== latest.current) onChange(v);
  };

  return (
    <span className={`ui-slider${disabled ? ' is-disabled' : ''}`} style={{ '--ui-slider-fill': `${t * 100}%` } as CSSProperties}>
      <input
        ref={ref}
        type="range"
        min={0}
        max={1}
        step="any"
        defaultValue={t}
        disabled={disabled}
        aria-valuetext={text}
        onChange={(e) => emit(positionToValue(Number(e.currentTarget.value), s))}
        onPointerUp={() => onCommit?.(latest.current)}
        onKeyDown={(e) => {
          let next: number | null = null;
          const big = e.shiftKey || e.key === 'PageUp' || e.key === 'PageDown';
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') next = stepValue(value, 1, s, big);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') next = stepValue(value, -1, s, big);
          else if (e.key === 'Home') next = min;
          else if (e.key === 'End') next = max;
          if (next === null) return;
          e.preventDefault();
          emit(next);
          onCommit?.(next);
        }}
        {...rest}
      />
      {mark && mark.value >= min && mark.value <= max && (
        <span
          className="ui-slider__mark"
          style={{ left: `${valueToPosition(mark.value, s) * 100}%`, '--mark-t': valueToPosition(mark.value, s) } as CSSProperties}
          title={mark.label}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

/** Slider + campo numérico + unidad, sincronizados (el control típico de un parámetro). */
export function SliderField(props: SliderProps & { unit?: ReactNode; fieldWidth?: number }) {
  const { unit, fieldWidth = 100, ...slider } = props;
  const id = useId();
  return (
    <div className="ui-slider-field">
      <Slider {...slider} id={slider.id ?? id} />
      <NumberField
        value={slider.value}
        onChange={(v) => {
          slider.onChange(v);
          slider.onCommit?.(v);
        }}
        min={slider.min}
        max={slider.max}
        {...(slider.step !== undefined ? { step: slider.step } : {})}
        {...(slider.scale ? { scale: slider.scale } : {})}
        unit={unit}
        disabled={slider.disabled}
        width={fieldWidth}
        size="sm"
        aria-label={`${slider['aria-label'] ?? 'Valor'} (número)`}
      />
    </div>
  );
}
