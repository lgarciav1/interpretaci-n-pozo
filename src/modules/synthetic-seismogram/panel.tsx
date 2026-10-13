/** Lectura del sintético en tiempo, ondícula y relación tiempo–profundidad; parámetros generados por el contrato. */
import { useMemo } from 'react';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { downloadFile } from '../../app/export/exportActions';
import type { TableValue } from '../../core/module';
import { XYPlot } from '../../plots/xy/XYPlot';
import { niceRange } from '../../plots/xy/axes';
import { Button, Callout, EmptyState, formatNumber, toast, useThemeTokens } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { syntheticCsv, syntheticLas } from './export';
import { SYNTHETIC_TIME, TIME_DEPTH, SYNTHETIC_SUMMARY, SYNTHETIC_WAVELET } from './index';
import './panel.css';
const rangeOf = (values: Float64Array) => niceRange([values], 'linear') ?? { min: 0, max: 1 };

function SyntheticPanel({ module, result }: ModulePanelProps) {
  const entry = useProject(selectActiveEntry);
  const theme = useThemeTokens();
  const table = (port: string) => result?.outputs.find(output => output.moduleId === module.id && output.port === port)?.value as TableValue | undefined;
  const temporal = table(SYNTHETIC_TIME), depthTime = table(TIME_DEPTH), wavelet = table(SYNTHETIC_WAVELET);
  const summary = table(SYNTHETIC_SUMMARY)?.rows[0];
  const timeSeries = useMemo(() => temporal ? { time: Float64Array.from(temporal.rows, row => typeof row.time === 'number' ? row.time : NaN), trace: Float64Array.from(temporal.rows, row => typeof row.trace === 'number' ? row.trace : NaN) } : null, [temporal]);
  const depthSeries = useMemo(() => depthTime ? { depth: Float64Array.from(depthTime.rows, row => typeof row.depth === 'number' ? row.depth : NaN), time: Float64Array.from(depthTime.rows, row => typeof row.twt === 'number' ? row.twt : NaN) } : null, [depthTime]);
  const waveletSeries = useMemo(() => wavelet ? { time: Float64Array.from(wavelet.rows, row => typeof row.time === 'number' ? row.time : NaN), amplitude: Float64Array.from(wavelet.rows, row => typeof row.amplitude === 'number' ? row.amplitude : NaN) } : null, [wavelet]);
  const curve = (port: string) => result?.outputs.find(output => output.moduleId === module.id && output.port === port)?.value as Float64Array | undefined;
  const save = (kind: 'time' | 'depth-time' | 'las') => {
    if (!entry || result?.wellId !== entry.well.id) return;
    try {
      if (kind === 'las') {
        const trace = curve('SYNTHETIC'), twt = curve('TWT'), ai = curve('AI'), rc = curve('RC');
        if (!trace || !twt || !ai || !rc) return;
        downloadFile(syntheticLas(entry.well, trace, twt, ai, rc));
      } else {
        const rows = kind === 'time' ? temporal : depthTime;
        if (rows) downloadFile(syntheticCsv(entry.well.name, kind, rows));
      }
      toast({ tone: 'ok', title: 'Sintético exportado' });
    } catch (error) { toast({ tone: 'error', title: 'No se pudo exportar', description: error instanceof Error ? error.message : String(error) }); }
  };
  if (!timeSeries || !depthSeries || !entry || result?.wellId !== entry.well.id) return <EmptyState size="sm" title="Sin sismograma" description="Cargá sónico compresional y densidad, y activá el cálculo." />;
  const valid = timeSeries.trace.some(Number.isFinite);
  const timeRange = rangeOf(timeSeries.time);
  const amplitudeRange = rangeOf(timeSeries.trace);
  const depthRange = rangeOf(depthSeries.depth);
  const twtRange = rangeOf(depthSeries.time);
  const fmt = (value: unknown) => typeof value === 'number' ? formatNumber(value, { digits: 1 }) : '—';
  return <div className="synthetic-panel">
    <Callout tone="info" title="Tiempo relativo al tope del registro">La referencia inicial se configura arriba. Sin check-shot o VSP, no representa un amarre sísmico absoluto. SEG-Y queda fuera de alcance.</Callout>
    <div className="synthetic-panel__metrics"><span>Intervalo cubierto <strong>{fmt(summary?.validTimeSpan)} ms</strong></span><span>Hasta profundidad <strong>{fmt(summary?.lastValidDepth)} m</strong></span><span>Huecos <strong>{fmt(summary?.gapCount)}</strong></span><span>Muestras temporales <strong>{summary?.samples ?? 0}</strong></span></div>
    <div className="synthetic-panel__exports"><Button size="sm" onClick={() => save('time')} disabled={!temporal?.rows.length}>CSV en tiempo</Button><Button size="sm" variant="secondary" onClick={() => save('depth-time')}>CSV tiempo–profundidad</Button><Button size="sm" variant="secondary" onClick={() => save('las')}>LAS en profundidad</Button></div>
    {!valid ? <EmptyState size="sm" title="Sin traza temporal válida" description="Revisá el sónico y los huecos. No se prolonga el tiempo integrado a través de un hueco no resuelto." /> : <XYPlot height={250} figureId="synthetic-time" figureTitle="Sismograma acústico sintético" ariaLabel="Amplitud sintética contra tiempo doble" x={{ kind: 'linear', ...timeRange, label: 'Tiempo doble', unit: 'ms' }} y={{ kind: 'linear', ...amplitudeRange, label: 'Amplitud', unit: '' }} lines={[{ id: 'synthetic', name: 'Sintético', x: timeSeries.time, y: timeSeries.trace, color: theme.color.accent }]} />}
    {waveletSeries && <XYPlot height={160} figureId="synthetic-wavelet" figureTitle="Ondícula Ricker" ariaLabel="Ondícula Ricker de fase cero" x={{ kind: 'linear', ...rangeOf(waveletSeries.time), label: 'Tiempo relativo', unit: 'ms' }} y={{ kind: 'linear', min: -0.5, max: 1.1, label: 'Amplitud' }} lines={[{ id: 'wavelet', name: 'Ricker', x: waveletSeries.time, y: waveletSeries.amplitude, color: theme.color.info }]} />}
    <XYPlot height={220} figureId="synthetic-depth-time" figureTitle="Relación tiempo–profundidad" ariaLabel="Tiempo doble contra profundidad" x={{ kind: 'linear', ...twtRange, label: 'Tiempo doble', unit: 'ms' }} y={{ kind: 'linear', ...depthRange, reversed: true, label: 'Profundidad', unit: 'm' }} lines={[{ id: 'depth-time', name: 'Relación integrada', x: depthSeries.time, y: depthSeries.depth, color: theme.color.info }]} />
    <p className="synthetic-panel__note">La pista del visor repite cuatro veces la misma traza y rellena los lóbulos positivos; no representa cuatro trazas sísmicas independientes. Una impedancia mayor hacia abajo tiene polaridad normal positiva.</p>
  </div>;
}
export const panel: ModulePanel = { moduleId: 'synthetic-seismogram', component: SyntheticPanel };
