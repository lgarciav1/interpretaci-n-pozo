/**
 * Control generado a partir del esquema de un parámetro: slider (lineal o log) + campo numérico, selector o
 * casilla. En modo zona muestra el valor efectivo y si es un override de esa zona.
 */
import { useId } from 'react';
import type { ParamSpec, ParamValue } from '../../core/params';
import { unitLabel } from '../../core/units';

export interface ParamControlProps {
  name: string;
  spec: ParamSpec;
  /** Valor efectivo (lo que usa el cálculo). */
  value: ParamValue;
  /** true si el valor viene de un override de la zona en edición. */
  overridden: boolean;
  /** false si se está editando una zona y el parámetro es solo global. */
  editable: boolean;
  onChange(value: ParamValue): void;
  onReset?(): void;
  resetLabel?: string;
}

/** Posiciones del slider en escala log (en lineal el slider trabaja directo en unidades del parámetro). */
const LOG_STEPS = 1000;

type NumberSpec = Extract<ParamSpec, { type: 'number' }>;

function sliderProps(spec: NumberSpec, v: number) {
  if (spec.scale === 'log') {
    const [a, b] = [Math.log(spec.min), Math.log(spec.max)];
    const pos = ((Math.log(Math.min(Math.max(v, spec.min), spec.max)) - a) / (b - a)) * LOG_STEPS;
    return { min: 0, max: LOG_STEPS, step: 1, value: pos };
  }
  return { min: spec.min, max: spec.max, step: spec.step ?? (spec.max - spec.min) / 1000, value: v };
}

function fromSlider(spec: NumberSpec, raw: number): number {
  if (spec.scale === 'log') {
    const t = raw / LOG_STEPS;
    return +Math.exp(Math.log(spec.min) + t * (Math.log(spec.max) - Math.log(spec.min))).toPrecision(3);
  }
  // Limpia el ruido de punto flotante del paso (0.1 + 0.2…).
  return +raw.toPrecision(12);
}

export function ParamControl({ name, spec, value, overridden, editable, onChange, onReset, resetLabel }: ParamControlProps) {
  const id = useId();
  const head = (
    <div className="param-head">
      <label htmlFor={id} title={spec.tooltip}>
        {spec.label}
      </label>
      {overridden && <span className="override">valor de la zona</span>}
      {onReset && (
        <button type="button" className="linkish" onClick={onReset}>
          {resetLabel ?? 'restablecer'}
        </button>
      )}
    </div>
  );

  let body;
  switch (spec.type) {
    case 'number': {
      const v = value as number;
      body = (
        <div className="param-row">
          <input
            id={id}
            type="range"
            name={name}
            {...sliderProps(spec, v)}
            disabled={!editable}
            aria-label={spec.label}
            onChange={(e) => onChange(fromSlider(spec, Number(e.currentTarget.value)))}
          />
          <input
            type="number"
            value={v}
            step={spec.step ?? 'any'}
            disabled={!editable}
            aria-label={`${spec.label} (valor)`}
            onChange={(e) => {
              const n = Number(e.currentTarget.value);
              if (e.currentTarget.value !== '' && Number.isFinite(n)) onChange(n);
            }}
          />
          <span className="muted">{spec.unit ? unitLabel(spec.unit) : ''}</span>
        </div>
      );
      break;
    }
    case 'enum':
      body = (
        <select id={id} name={name} value={value as string} disabled={!editable} onChange={(e) => onChange(e.currentTarget.value)}>
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'boolean':
      body = <input id={id} name={name} type="checkbox" checked={value as boolean} disabled={!editable} onChange={(e) => onChange(e.currentTarget.checked)} />;
      break;
  }

  return (
    <div className={`param${editable ? '' : ' disabled'}`} title={editable ? spec.tooltip : 'Este parámetro es único para todo el pozo.'}>
      {head}
      {body}
    </div>
  );
}
