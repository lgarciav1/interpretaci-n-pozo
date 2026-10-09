/**
 * Control generado a partir del esquema de un parámetro: slider (lineal o log) + campo numérico, selector o
 * interruptor, con su ayuda en un tooltip. En modo zona muestra el valor efectivo y si es un override de esa zona.
 * Los parámetros compartidos llevan una insignia con los módulos que los usan.
 */
import { useId } from 'react';
import type { ParamSpec, ParamValue } from '../../core/params';
import { unitLabel } from '../../core/units';
import { Badge, Field, Select, SliderField, Switch, Tooltip, formatParamValue } from '../../ui';

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
  /** Nombres de los módulos que comparten el parámetro (si es compartido). */
  sharedWith?: readonly string[];
}

export function ParamControl({ name, spec, value, overridden, editable, onChange, onReset, resetLabel, sharedWith }: ParamControlProps) {
  const id = useId();
  const aside = (
    <>
      {spec.shared && (
        <Tooltip content={sharedWith && sharedWith.length > 1 ? `Compartido con: ${sharedWith.join(', ')}.` : 'Parámetro compartido: un solo valor para todos los métodos que lo usan.'}>
          <span tabIndex={0} className="param-badge">
            <Badge tone="info" variant="outline">
              compartido
            </Badge>
          </span>
        </Tooltip>
      )}
      {overridden && <Badge tone="warn">de la zona</Badge>}
      {onReset && editable && (
        <button type="button" className="param-reset" onClick={onReset}>
          {resetLabel ?? 'restablecer'}
        </button>
      )}
    </>
  );
  const tooltip = editable ? spec.tooltip : `${spec.tooltip ? `${spec.tooltip} ` : ''}Es único para todo el pozo: editalo en «Global».`;

  let body;
  switch (spec.type) {
    case 'number': {
      const unit = spec.unit && spec.unit !== 'unitless' ? unitLabel(spec.unit) : undefined;
      body = (
        <SliderField
          id={id}
          name={name}
          aria-label={spec.label}
          value={value as number}
          min={spec.min}
          max={spec.max}
          {...(spec.step !== undefined ? { step: spec.step } : {})}
          scale={spec.scale ?? 'linear'}
          disabled={!editable}
          unit={unit}
          mark={{ value: spec.default, label: `Por defecto: ${formatParamValue(spec.default, spec)}` }}
          formatValue={(v) => `${formatParamValue(v, spec)}${unit ? ` ${unit}` : ''}`}
          onChange={(v) => onChange(v)}
        />
      );
      break;
    }
    case 'enum':
      body = <Select id={id} name={name} block value={value as string} disabled={!editable} onChange={onChange} options={spec.options} />;
      break;
    case 'boolean':
      body = <Switch id={id} name={name} checked={value as boolean} disabled={!editable} onChange={onChange} label={value ? 'Sí' : 'No'} />;
      break;
  }

  return (
    <Field className="param" label={spec.label} htmlFor={id} tooltip={tooltip} aside={aside} disabled={!editable}>
      {body}
    </Field>
  );
}
