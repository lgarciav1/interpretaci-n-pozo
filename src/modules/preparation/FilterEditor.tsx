/** Herramienta «Mediana móvil» (0058): suaviza con una ventana simétrica en metros MD, con vista previa viva. */
import { useEffect, useState } from 'react';
import { MAX_MEDIAN_SAMPLES } from '../../core/preparation/filter';
import { setMedianFilter } from '../../core/state/preparation';
import { makeId } from '../../core/state/project';
import { formatNumber } from '../../ui';
import { DraftSlider, RangeNote } from './ToolCard';
import type { DepthRange, DraftReport } from './types';

/** Muestras de una ventana de radio r con paso regular (para el rótulo). */
export function windowSamples(radiusM: number, step: number): number {
  return step > 0 ? 2 * Math.floor(radiusM / step + 1e-9) + 1 : 0;
}

export function FilterEditor({ wellId, curveId, problem, range, fromSelection, step, onReport, onClear }: {
  wellId: string;
  curveId: string;
  problem: string | null;
  range: DepthRange | null;
  fromSelection: boolean;
  step: number;
  onReport(r: DraftReport): void;
  onClear(): void;
}) {
  const [radius, setRadius] = useState(() => +(step * 2).toFixed(4));
  const [maxStep, setMaxStep] = useState(() => +(step * 2).toFixed(4));
  const key = JSON.stringify(['filter', curveId, range?.top, range?.base, radius, maxStep, problem]);
  useEffect(() => {
    if (problem) return onReport({ draft: null, reason: problem });
    if (!range) return onReport({ draft: null, reason: 'Elegí un tramo para filtrar.' });
    const { top, base } = range;
    onReport({ draft: { operation: 'filter', key, build: (p) => setMedianFilter(p, wellId, curveId, { top, base, radiusM: radius, maxStepM: maxStep }, makeId('filter')) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const samples = windowSamples(radius, step);
  const maxRadius = +((step * (MAX_MEDIAN_SAMPLES - 1)) / 2).toFixed(3);
  return (
    <>
      <RangeNote range={range} fromSelection={fromSelection} onClear={onClear} />
      <DraftSlider
        label="Radio de la ventana"
        hint={<span className="num">Ventana de ≈ {samples.toLocaleString('es-AR')} muestras</span>}
        value={radius}
        onChange={setRadius}
        min={+step.toFixed(4)}
        max={maxRadius}
        scale="log"
        unit="m"
        format={(v) => formatNumber(v, { digits: 3 })}
      />
      <DraftSlider
        label="Separación máxima para filtrar"
        tooltip="Un salto de profundidad mayor corta la ventana: no se filtra a través de huecos."
        value={maxStep}
        onChange={setMaxStep}
        min={+step.toFixed(4)}
        max={5}
        scale="log"
        unit="m"
        format={(v) => formatNumber(v, { digits: 3 })}
      />
      <p className="prep-help">Se aplica después de la interpolación. No rellena faltantes ni cruza exclusiones, zonas o saltos; conserva los bordes sin ventana completa. Puede borrar señales geológicas reales: mirá el gráfico antes de aplicar.</p>
    </>
  );
}
