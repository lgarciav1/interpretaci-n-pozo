import { useEffect, useId, useState } from 'react';
import { Button, Field, NumberField } from '../../ui';
import { scaleEditStep, validateScale, type ScaleErrors } from '../../viewer/curveEdit';
import type { XYAxis } from '../xy/axes';

interface AxisRangeEditorProps {
  axis: XYAxis;
  name: 'X' | 'Y';
  stored?: [number, number];
  depth: Float64Array;
  onChange(range: [number, number] | undefined): void;
}

const formatLimit = (value: number) => String(value).replace('.', ',');

export function AxisRangeEditor({ axis, name, stored, depth, onChange }: AxisRangeEditorProps) {
  const id = useId();
  const fixed = stored?.[0] === axis.min && stored?.[1] === axis.max;
  const span = axis.max - axis.min;
  const log = axis.kind === 'log';
  const [errors, setErrors] = useState<ScaleErrors | null>(null);
  useEffect(() => setErrors(null), [depth, axis.min, axis.max, stored]);

  const change = (limit: 'min' | 'max', value: number | null) => {
    const next = { min: axis.min, max: axis.max, scale: axis.kind, [limit]: value ?? NaN };
    const invalid = validateScale(next);
    setErrors(invalid);
    if (!invalid && value !== axis[limit]) onChange([next.min, next.max]);
  };

  return (
    <div>
      <div className="plot-row">
        <span className="plot-row__label">Rango {name} · {fixed ? 'Fijo' : 'Automático'}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Volver a rango automático en ${name}`}
          disabled={!stored}
          onClick={() => {
            setErrors(null);
            onChange(undefined);
          }}
        >
          Restablecer
        </Button>
      </div>
      <div className="plot-axis-limits">
        {(['min', 'max'] as const).map((limit) => {
          const label = limit === 'min' ? 'Mínimo' : 'Máximo';
          const inputId = `${id}-${limit}`;
          const errorId = `${inputId}-error`;
          return (
            <Field key={limit} label={label} htmlFor={inputId} error={errors?.[limit] && <span id={errorId} role="alert">{errors[limit]}</span>}>
              <NumberField
                id={inputId}
                size="sm"
                aria-label={`${label} del eje ${name}`}
                aria-describedby={errors?.[limit] ? errorId : undefined}
                aria-invalid={Boolean(errors?.[limit])}
                value={axis[limit]}
                min={log ? Math.max(Number.MIN_VALUE, axis.min / 10) : Math.max(-Number.MAX_VALUE, axis.min - span)}
                max={log ? Math.min(Number.MAX_VALUE, axis.max * 10) : Math.min(Number.MAX_VALUE, axis.max + span)}
                step={log ? undefined : scaleEditStep(axis.min, axis.max)}
                scale={axis.kind}
                unit={axis.unit}
                clampToRange={false}
                format={formatLimit}
                onCommit={(value) => change(limit, value)}
              />
            </Field>
          );
        })}
      </div>
    </div>
  );
}
