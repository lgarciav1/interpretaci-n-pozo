import { useState } from 'react';
import { Button, Checkbox, Field, TextField } from '../../ui';

export function ShiftEditor({ knownDatum, disabled, problem, onPreview, onInvalidate }: {
  knownDatum: string | null; disabled: boolean; problem: string | null;
  onPreview: (offsetM: number, maxGapM: number, datum: string) => void; onInvalidate: () => void;
}) {
  const [offset, setOffset] = useState(''), [gap, setGap] = useState(''), [datum, setDatum] = useState(knownDatum ?? ''), [confirmed, setConfirmed] = useState(false);
  const number = (value: string) => value.trim() ? Number(value.replace(',', '.')) : NaN;
  return <section aria-label="Alinear curva en MD">
    <h3>Alinear curva en MD</h3>
    <p>Desplaza toda esta curva después de las otras etapas. Un valor positivo mueve sus eventos más profundo. El tope/base de arriba no limita esta operación. No mueve el índice maestro, otras curvas ni muestras de laboratorio; no infiere una corrida completa.</p>
    <p>Remuestrea en valores lineales al índice MD de este mismo pozo, sin extrapolar. El máximo es la distancia entre anclajes desplazados. Huecos, exclusiones y fronteras zonales bloquean la estimación entre muestras; las coincidencias exactas conservan el dato y su calidad de origen.</p>
    <p>{knownDatum ? `Datum conocido del pozo: ${knownDatum}.` : 'El datum de adquisición no está registrado. La declaración siguiente queda en esta receta; no confirma datos de adquisición.'} No convierte datums ni MD a TVD.</p>
    {problem && <p role="status">{problem}</p>}
    <div className="prep-editor__fields">
      <Field label="Desplazamiento constante (m)"><TextField aria-label="Desplazamiento constante (m)" value={offset} onChange={v => { onInvalidate(); setOffset(v); }} inputMode="decimal" block /></Field>
      <Field label="Hueco máximo de remuestreo (m MD)"><TextField aria-label="Hueco máximo de remuestreo (m MD)" value={gap} onChange={v => { onInvalidate(); setGap(v); }} inputMode="decimal" block /></Field>
      <Field label="Datum declarado de origen y destino"><TextField aria-label="Datum declarado de origen y destino" value={datum} onChange={v => { onInvalidate(); setDatum(v); setConfirmed(false); }} block /></Field>
    </div>
    <Checkbox checked={confirmed} onChange={v => { onInvalidate(); setConfirmed(v); }} label="Declaro que la curva y el índice del pozo comparten referencia MD y el datum indicado" />
    <Button size="sm" disabled={disabled || !!problem || !confirmed} onClick={() => onPreview(number(offset), number(gap), datum.trim())}>Previsualizar alineación</Button>
    <p>Para volver a desplazamiento cero usá Quitar alineación. Revisá cobertura y eventos antes de aplicar: este desplazamiento es manual, sin correlación ni validación geológica automática.</p>
  </section>;
}
