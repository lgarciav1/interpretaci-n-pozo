import { useEffect, useRef, useState } from 'react';
import type { Project, WellEntry } from '../../core/state/project';
import { maskRanges } from '../../core/preparation/state';
import { scanSuspects, type SuspectScan } from '../../core/preparation/suspects';
import { Button, Callout, Checkbox, Field, TextField, formatNumber } from '../../ui';

const number = (s: string) => s.trim() ? Number(s.replace(',', '.')) : NaN;
interface Review { project: Project; key: string; scan: SuspectScan }
export function SuspectReview({ project, entry, curveId, top, base, disabled, onPreview, onInvalidate }: {
  project: Project; entry: WellEntry; curveId: string; top: number; base: number; disabled: boolean;
  onPreview: (depths: number[]) => void; onInvalidate: () => void;
}) {
  const [deviation, setDeviation] = useState(''), [gap, setGap] = useState('');
  const [review, setReview] = useState<Review | null>(null), [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const key = JSON.stringify([curveId, top, base, deviation, gap]);
  useEffect(() => { generation.current++; setBusy(false); }, [project, key, disabled]);
  useEffect(() => () => { generation.current++; }, []);
  const current = review?.project === project && review.key === key && !disabled ? review.scan : null;
  const curve = entry.well.curves.find(c => c.id === curveId);
  const detect = async () => {
    onInvalidate();
    const job = ++generation.current;
    setBusy(true); setError(null); setReview(null); setSelected(new Set());
    try {
      if (!curve) throw new Error('La curva ya no existe.');
      const nodes = entry.interpretation.preparation?.nodes.filter(n => n.enabled && n.input.curveId === curveId) ?? [];
      const excluded = maskRanges(nodes.flatMap(n => n.intervals));
      const scan = await scanSuspects(entry.well.depth.values, curve.data,
        { top, base, minDeviation: number(deviation), maxGapM: number(gap) }, excluded, () => generation.current !== job);
      if (generation.current === job) setReview({ project, key, scan });
    } catch (err) { if (generation.current === job) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (generation.current === job) setBusy(false); }
  };
  const show = (n: number) => formatNumber(n, { digits: 4 });
  return <section aria-label="Revisar posibles espurios">
    <h3>Revisar posibles espurios</h3>
    <p>Buscá diferencias frente a los tres vecinos de cada lado dentro del tramo elegido. No cruza faltantes, exclusiones ni separaciones mayores que la indicada. Los extremos sin seis vecinos no se evalúan. Un candidato puede ser una transición geológica real: revisalo antes de excluir.</p>
    <div className="prep-editor__fields">
      <Field label={`Desviación mínima (${curve?.unit ?? 'unidad de la curva'})`}><TextField aria-label="Desviación mínima" value={deviation} onChange={value => { onInvalidate(); setDeviation(value); }} inputMode="decimal" block /></Field>
      <Field label="Separación máxima entre muestras (m MD)"><TextField aria-label="Separación máxima entre muestras" value={gap} onChange={value => { onInvalidate(); setGap(value); }} inputMode="decimal" block /></Field>
    </div>
    <p>Se señalan diferencias mayores que la desviación mínima y que tres dispersiones robustas locales. Indicá ambos límites positivos según la curva y su muestreo.</p>
    <Button size="sm" disabled={disabled || busy || !curve} onClick={() => void detect()}>Buscar candidatos</Button>
    {busy && <span role="status"> Buscando… <Button size="sm" onClick={() => { generation.current++; setBusy(false); }}>Cancelar búsqueda</Button></span>}
    {error && <Callout tone="error">{error}</Callout>}
    {current && <>
      <p role="status">{current.candidates.length} candidatos; {current.evaluated} muestras evaluadas. La búsqueda no cambia el proyecto.</p>
      {current.truncated && <Callout tone="warn">Hay más de 256 candidatos. Acotá el tramo o ajustá los límites y repetí la búsqueda antes de previsualizar.</Callout>}
      {!!current.candidates.length && <div className="prep-editor__candidates"><table className="prep-editor__table"><caption>Elegí muestras individuales; ninguna está seleccionada por defecto.</caption><thead><tr><th>Excluir</th><th>MD (m)</th><th>Original</th><th>Mediana local</th><th>Umbral</th></tr></thead><tbody>
        {current.candidates.map(c => <tr key={c.index}><td><Checkbox label={`Excluir muestra a ${show(c.depth)} m MD`} checked={selected.has(c.index)} onChange={checked => { onInvalidate(); setSelected(previous => { const next = new Set(previous); if (checked) next.add(c.index); else next.delete(c.index); return next; }); }} /></td><td>{show(c.depth)}</td><td>{show(c.value)}</td><td>{show(c.median)}</td><td>{show(c.threshold)}</td></tr>)}
      </tbody></table></div>}
      <Button size="sm" disabled={!selected.size || current.truncated} onClick={() => onPreview(current.candidates.filter(c => selected.has(c.index)).map(c => c.depth))}>Previsualizar exclusión de {selected.size} muestras elegidas</Button>
      <p>Al aplicar se guardan exclusiones manuales por muestra. El diagnóstico y sus límites son temporales; no se guardan como un método de corrección ni certifican que el dato sea erróneo.</p>
    </>}
  </section>;
}
