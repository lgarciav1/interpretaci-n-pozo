import { useState } from 'react';
import { Button, Field, TextField } from '../../ui';

export function FilterEditor({ disabled, problem, onPreview, onInvalidate }: {
  disabled: boolean; problem: string | null; onPreview: (radiusM: number, maxStepM: number) => void; onInvalidate: () => void;
}) {
  const [radius, setRadius] = useState(''), [step, setStep] = useState('');
  const number = (value: string) => value.trim() ? Number(value.replace(',', '.')) : NaN;
  return <section aria-label="Filtrar con mediana móvil">
    <h3>Filtrar con mediana móvil</h3>
    <p>Suavizá con una ventana simétrica en metros MD, en los valores lineales de la curva. Requiere al menos tres muestras y vecinos a ambos lados; conserva bordes sin ventana completa. No rellena faltantes ni cruza exclusiones, zonas o separaciones mayores que la indicada. Admite hasta 255 muestras por ventana.</p>
    <p>Se aplica después de la interpolación si ya está aceptada en esta curva. Se identifica el filtrado y la influencia de esas estimaciones en la calidad. Puede borrar señales geológicas reales: revisá el preview antes de aplicarlo.</p>
    {problem && <p role="status">{problem}</p>}
    <div className="prep-editor__fields">
      <Field label="Radio de mediana (m MD)"><TextField aria-label="Radio de mediana (m MD)" value={radius} onChange={value => { onInvalidate(); setRadius(value); }} inputMode="decimal" block /></Field>
      <Field label="Separación máxima para filtrar (m MD)"><TextField aria-label="Separación máxima para filtrar (m MD)" value={step} onChange={value => { onInvalidate(); setStep(value); }} inputMode="decimal" block /></Field>
    </div>
    <Button size="sm" disabled={disabled || !!problem} onClick={() => onPreview(number(radius), number(step))}>Previsualizar filtro</Button>
  </section>;
}
