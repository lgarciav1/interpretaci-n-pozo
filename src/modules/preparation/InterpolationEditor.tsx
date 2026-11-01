/** Herramienta «Interpolar huecos» (0058): estima faltantes originales cortos, con vista previa viva. */
import { useEffect, useState } from 'react';
import { setGapFill } from '../../core/state/preparation';
import { makeId } from '../../core/state/project';
import { formatNumber } from '../../ui';
import { DraftSlider, RangeNote } from './ToolCard';
import type { DepthRange, DraftReport } from './types';

export function InterpolationEditor({ wellId, curveId, problem, range, fromSelection, step, onReport, onClear }: {
  wellId: string;
  curveId: string;
  problem: string | null;
  range: DepthRange | null;
  fromSelection: boolean;
  step: number;
  onReport(r: DraftReport): void;
  onClear(): void;
}) {
  const [maxGap, setMaxGap] = useState(() => Math.max(+(step * 2).toFixed(4), 1));
  const key = JSON.stringify(['interpolate', curveId, range?.top, range?.base, maxGap, problem]);
  useEffect(() => {
    if (problem) return onReport({ draft: null, reason: problem });
    if (!range) return onReport({ draft: null, reason: 'Elegí un tramo para interpolar.' });
    const { top, base } = range;
    onReport({ draft: { operation: 'interpolate', key, build: (p) => setGapFill(p, wellId, curveId, { top, base, maxGapM: maxGap }, makeId('fill')) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <>
      <RangeNote range={range} fromSelection={fromSelection} onClear={onClear} />
      <DraftSlider
        label="Distancia máxima entre anclajes"
        hint="Distancia entre las dos mediciones que encierran el hueco, no solo su largo."
        value={maxGap}
        onChange={setMaxGap}
        min={+(step * 2).toFixed(4)}
        max={30}
        scale="log"
        unit="m"
        format={(v) => formatNumber(v, { digits: 2 })}
      />
      <p className="prep-help">Solo entre dos mediciones del tramo, en profundidad y en los valores de la curva. No extrapola, no cruza zonas ni rellena exclusiones. Son estimaciones: se marcan como interpoladas.</p>
    </>
  );
}
