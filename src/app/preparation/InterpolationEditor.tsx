import { useState } from 'react';
import { Button, Field, TextField } from '../../ui';

export function InterpolationEditor({ disabled, problem, onPreview, onInvalidate }: {
  disabled: boolean; problem: string | null; onPreview: (maxGapM: number) => void; onInvalidate: () => void;
}) {
  const [maxGap, setMaxGap] = useState('');
  return <section aria-label="Interpolar faltantes originales">
    <h3>Interpolar faltantes originales</h3>
    <p>Estimá huecos cortos entre dos mediciones dentro del tramo elegido, linealmente en profundidad MD y en los valores de la curva. El máximo es la distancia entre esas dos mediciones, no sólo la longitud de las muestras faltantes.</p>
    <p>No extrapola, no cruza fronteras de zona, no cambia mediciones finitas ni rellena exclusiones. Las estimaciones pueden ocultar variaciones reales: revisá el preview antes de usarlas. Se guardan el método, tramo y límite; las muestras estimadas se distinguen en la comparación, el informe y la exportación QC.</p>
    {problem && <p role="status">{problem}</p>}
    <Field label="Distancia máxima entre anclajes (m MD)"><TextField aria-label="Distancia máxima entre anclajes (m MD)" value={maxGap} onChange={value => { onInvalidate(); setMaxGap(value); }} inputMode="decimal" block /></Field>
    <Button size="sm" disabled={disabled || !!problem} onClick={() => onPreview(maxGap.trim() ? Number(maxGap.replace(',', '.')) : NaN)}>Previsualizar interpolación</Button>
  </section>;
}
