/**
 * Herramienta «Normalizar» (docs/decisiones/0060; Clase 8, slides 9–10): lleva percentiles de la curva en un intervalo
 * de referencia a valores conocidos (de un pozo vecino o de arcilla y arena limpia). Dos puntos (escala y corrimiento)
 * o un punto (desplazamiento o escala). El histograma antes/después se calcula acá con la misma matemática del motor
 * (respuesta inmediata al arrastrar); la vista previa del motor actualiza el gráfico central. Sin ecuaciones.
 */
import { useEffect, useMemo, useState } from 'react';
import { percentileSorted } from '../../core/preparation/normalization';
import { normalizationKey, type CurveNormalization } from '../../core/preparation/state';
import { setNormalization } from '../../core/state/preparation';
import { makeId } from '../../core/state/project';
import type { Zone } from '../../core/well';
import { NumberField, SegmentedControl, Select, formatNumber } from '../../ui';
import { NormalizationHistogram, type HistogramMarkerLevel } from './NormalizationHistogram';
import { MIN_NORMALIZATION_SAMPLES, histogramModel, isIdentity, normalizationPreview, referenceIndices, type CurveView, type MarkerId } from './normalizationView';
import type { DepthRange, DraftReport } from './types';

type Method = CurveNormalization['method'];
const METHODS: readonly { value: Method; label: string; title: string }[] = [
  { value: 'two-point', label: 'Dos puntos', title: 'Lleva dos percentiles a dos valores de referencia: corrige escala y corrimiento.' },
  { value: 'shift', label: 'Desplazamiento', title: 'Suma una constante para llevar un percentil a su referencia.' },
  { value: 'scale', label: 'Escala', title: 'Multiplica por una constante para llevar un percentil a su referencia.' },
];

const m2 = (v: number) => formatNumber(v, { digits: 2 });

export function NormalizationEditor({ wellId, curveId, problem, view, selection, zones, depth, prior, applied, color, log, unit, onReport }: {
  wellId: string;
  curveId: string;
  problem: string | null;
  view: DepthRange;
  selection: DepthRange | null;
  zones: readonly Zone[];
  depth: Float64Array;
  /** La curva tal como entra a la normalización (etapas previas aplicadas). */
  prior: CurveView;
  /** Normalización ya aplicada (para editarla). */
  applied: CurveNormalization | undefined;
  color: string;
  log: boolean;
  unit: string;
  onReport(r: DraftReport): void;
}) {
  const [method, setMethod] = useState<Method>(applied?.method ?? 'two-point');
  const [source, setSource] = useState<string>(applied ? 'applied' : selection ? 'selection' : 'view');
  const [levels, setLevels] = useState(() => ({
    low: applied?.method === 'two-point' ? applied.lowPercentile : 5,
    high: applied?.method === 'two-point' ? applied.highPercentile : 95,
    single: applied && applied.method !== 'two-point' ? applied.percentile : 50,
  }));
  // Referencias escritas por el usuario (o las de la normalización aplicada). Mientras no escriba ninguna, las
  // referencias siguen a los percentiles de origen: la curva no cambia y el pie pide escribirlas.
  const [userRefs, setUserRefs] = useState<{ low: number; high: number; single: number } | null>(() =>
    applied ? (applied.method === 'two-point' ? { low: applied.lowReference, high: applied.highReference, single: (applied.lowReference + applied.highReference) / 2 } : { low: applied.reference, high: applied.reference, single: applied.reference }) : null,
  );

  // Intervalo de referencia: la vista del panel, el tramo marcado, una zona o el ya aplicado.
  const options = useMemo(() => {
    const out: { value: string; label: string; range: DepthRange }[] = [];
    if (applied) out.push({ value: 'applied', label: `Intervalo aplicado · ${m2(applied.top)}–${m2(applied.base)} m`, range: { top: applied.top, base: applied.base } });
    out.push({ value: 'view', label: `Vista del panel · ${m2(view.top)}–${m2(view.base)} m`, range: view });
    if (selection) out.push({ value: 'selection', label: `Tramo marcado · ${m2(selection.top)}–${m2(selection.base)} m`, range: selection });
    for (const z of zones) out.push({ value: `zone:${z.id}`, label: `Zona ${z.name} · ${m2(z.top)}–${m2(z.base)} m`, range: { top: Math.max(z.top, depth[0] ?? z.top), base: Math.min(z.base, depth[depth.length - 1] ?? z.base) } });
    return out;
  }, [applied, view, selection, zones, depth]);
  // Marcar un tramo en el gráfico lo propone como intervalo.
  useEffect(() => {
    if (selection) setSource('selection');
    else setSource((s) => (s === 'selection' ? 'view' : s));
  }, [selection]);
  const interval = (options.find((o) => o.value === source) ?? options.find((o) => o.value === 'view')!).range;

  const indices = useMemo(() => referenceIndices(depth, prior, interval.top, interval.base), [depth, prior, interval.top, interval.base]);
  const sortedOnly = useMemo(() => normalizationPreview(prior, indices, null).sorted, [prior, indices]);
  const enough = sortedOnly.length >= MIN_NORMALIZATION_SAMPLES;

  const autoRefs = useMemo(
    () => (enough ? { low: percentileSorted(sortedOnly, levels.low), high: percentileSorted(sortedOnly, levels.high), single: percentileSorted(sortedOnly, levels.single) } : null),
    [enough, sortedOnly, levels],
  );
  const refs = userRefs ?? autoRefs;

  const config: CurveNormalization | null = !refs
    ? null
    : method === 'two-point'
      ? { method, top: interval.top, base: interval.base, lowPercentile: levels.low, highPercentile: levels.high, lowReference: refs.low, highReference: refs.high }
      : { method, top: interval.top, base: interval.base, percentile: levels.single, reference: refs.single };
  const local = useMemo(() => normalizationPreview(prior, indices, enough ? config : null), [prior, indices, enough, JSON.stringify(config)]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = JSON.stringify(['normalize', curveId, config, problem, sortedOnly.length, applied ?? null]);
  useEffect(() => {
    if (problem) return onReport({ draft: null, reason: problem });
    if (!(interval.base > interval.top)) return onReport({ draft: null, reason: 'Elegí un intervalo de referencia con tope menor que la base.' });
    if (!enough) return onReport({ draft: null, reason: `El intervalo de referencia tiene ${sortedOnly.length.toLocaleString('es-AR')} muestras válidas (sin excluidas ni estimadas); hacen falta al menos ${MIN_NORMALIZATION_SAMPLES}. Ampliá el intervalo o elegí una zona.` });
    if (!config) return onReport({ draft: null, reason: 'Calculando los percentiles de origen…' });
    if (config.method === 'two-point' && !(config.highReference > config.lowReference)) return onReport({ draft: null, reason: 'El valor de referencia alto tiene que ser mayor que el bajo: una normalización no invierte la curva.' });
    if (config.method === 'scale' && config.reference === 0) return onReport({ draft: null, reason: 'La escala necesita un valor de referencia distinto de cero.' });
    if (local.problem) return onReport({ draft: null, reason: local.problem });
    if (applied && JSON.stringify(normalizationKey(applied)) === JSON.stringify(normalizationKey(config))) return onReport({ draft: null, reason: 'Es la normalización aplicada: cambiá el intervalo, los percentiles o las referencias para previsualizar otra.' });
    if (local.stats && isIdentity(config, local.stats)) return onReport({ draft: null, reason: 'Las referencias coinciden con los percentiles de origen: la curva no cambia. Escribí los valores de referencia (de un pozo vecino o de arcilla y arena limpia conocidas).' });
    const c = config;
    onReport({ draft: { operation: 'normalize', key, build: (p) => setNormalization(p, wellId, curveId, c, makeId('norm')) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, local.problem]);

  const ids: MarkerId[] = method === 'two-point' ? ['low', 'high'] : ['single'];
  const markers: HistogramMarkerLevel[] = ids.map((id) => ({ id, level: levels[id], value: percentileSorted(sortedOnly, levels[id]) }));
  const references = refs ? ids.map((id) => refs[id]) : [];
  // Las referencias entran en el eje; mientras se arrastra un marcador el eje queda fijo (no se mueve bajo el puntero).
  const [axisLock, setAxisLock] = useState<{ lo: number; hi: number } | null>(null);
  const model = useMemo(() => histogramModel(local.sorted, local.after, log, references, axisLock), [local, log, references.join(','), axisLock]); // eslint-disable-line react-hooks/exhaustive-deps
  const setLevel = (id: MarkerId, level: number) => setLevels((l) => ({ ...l, [id]: level }));
  const setRef = (id: MarkerId, v: number) => setUserRefs((r) => {
    const base = r ?? autoRefs;
    return base ? { ...base, [id]: v } : r;
  });
  const names: Record<MarkerId, string> = { low: 'Percentil bajo', high: 'Percentil alto', single: 'Percentil' };

  return (
    <>
      <div className="prep-norm-controls">
        <SegmentedControl aria-label="Modo de normalización" size="sm" block value={method} onChange={(v) => setMethod(v as Method)} options={METHODS.map((m) => ({ value: m.value, label: m.label, title: m.title }))} />
        <label className="prep-norm-interval">
          <span className="prep-norm-interval__label">Intervalo de referencia</span>
          <Select aria-label="Intervalo de referencia" size="sm" value={source} onChange={setSource} options={options.map((o) => ({ value: o.value, label: o.label }))} />
        </label>
      </div>
      {model && enough ? (
        <>
          <p className="prep-norm-caption num">
            {sortedOnly.length.toLocaleString('es-AR')} muestras de origen en el intervalo <span>(sin excluidas ni estimadas)</span>
          </p>
          <NormalizationHistogram model={model} sorted={sortedOnly} color={color} unit={unit} markers={markers} references={references} hasAfter={!!local.after} onLevel={setLevel} onGesture={(on) => setAxisLock(on && model ? { lo: model.lo, hi: model.hi } : null)} />
        </>
      ) : (
        <p className="prep-note prep-norm-empty">
          {sortedOnly.length
            ? `El intervalo tiene ${sortedOnly.length.toLocaleString('es-AR')} muestras válidas; hacen falta ${MIN_NORMALIZATION_SAMPLES} para un histograma confiable. Elegí una zona o marcá un tramo más largo en el gráfico.`
            : 'El intervalo no tiene muestras válidas. Elegí una zona o marcá un tramo en el gráfico.'}
        </p>
      )}
      {refs && (
        <table className="prep-norm-table num">
          <thead>
            <tr>
              <th scope="col">Percentil</th>
              <th scope="col">Origen</th>
              <th scope="col">Referencia</th>
            </tr>
          </thead>
          <tbody>
            {markers.map((mk) => (
              <tr key={mk.id}>
                <td>
                  <NumberField aria-label={names[mk.id]} size="sm" width={64} value={mk.level} min={0} max={100} step={0.5} unit="%" format={(v) => formatNumber(v, { digits: 1 })} onChange={(v) => setLevel(mk.id, v)} />
                </td>
                <td className="prep-norm-table__source">{Number.isFinite(mk.value) ? formatNumber(mk.value, { significant: 4 }) : '—'}</td>
                <td>
                  <NumberField aria-label={`Referencia de ${names[mk.id].toLowerCase()}`} size="sm" width={92} value={refs[mk.id]} min={-1e6} max={1e6} clampToRange={false} step={Math.abs(refs[mk.id]) >= 10 ? 1 : 0.01} unit={unit} format={(v) => formatNumber(v, { significant: 5 })} onChange={(v) => setRef(mk.id, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="prep-help">
        Arrastrá los marcadores (o escribí el percentil) y escribí las referencias: las de un pozo vecino o las de arcilla y arena limpia conocidas. Corrige toda la curva, después de la alineación.
      </p>
    </>
  );
}
