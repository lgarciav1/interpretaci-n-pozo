/**
 * Herramienta «Buscar espurios» (0058): candidatos frente a los tres vecinos de cada lado, que se recalculan solos al
 * mover los sliders. Elegir candidatos arma una exclusión por muestra con vista previa. La búsqueda no cambia el
 * proyecto; los candidatos se muestran como «sospechosos» en el gráfico (solo vista).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WellEntry } from '../../core/state/project';
import { makeId } from '../../core/state/project';
import { addMaskIntervals } from '../../core/state/preparation';
import { maskRanges } from '../../core/preparation/state';
import { scanSuspects, type SuspectScan } from '../../core/preparation/suspects';
import { Button, Callout, Checkbox, Spinner, formatNumber } from '../../ui';
import { DraftSlider, RangeNote } from './ToolCard';
import type { DepthRange, DraftReport } from './types';

/** Escala robusta de la curva (P95 − P5) para proponer la desviación mínima. */
export function robustSpread(data: ArrayLike<number>): number {
  const v: number[] = [];
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i]!)) v.push(data[i]!);
  if (v.length < 2) return 1;
  v.sort((a, b) => a - b);
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))]!;
  const s = q(0.95) - q(0.05);
  return s > 0 ? s : Math.abs(q(0.5)) || 1;
}

interface Review {
  key: string;
  scan: SuspectScan;
}

export function SuspectReview({ entry, curveId, range, fromSelection, step, onReport, onCandidates, onClear }: {
  entry: WellEntry;
  curveId: string;
  range: DepthRange | null;
  fromSelection: boolean;
  step: number;
  onReport(r: DraftReport): void;
  onCandidates(indices: readonly number[]): void;
  onClear(): void;
}) {
  const curve = entry.well.curves.find((c) => c.id === curveId);
  const spread = useMemo(() => (curve ? robustSpread(curve.data) : 1), [curve]);
  const [deviation, setDeviation] = useState(() => +(spread * 0.15).toPrecision(2));
  const [gap, setGap] = useState(() => +(step * 2).toFixed(4));
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const nodes = entry.interpretation.preparation?.nodes;
  const key = JSON.stringify([curveId, range?.top, range?.base, deviation, gap]);

  // Búsqueda viva (con pausa corta): cancela la anterior si los parámetros cambian.
  useEffect(() => {
    const job = ++generation.current;
    setSelected(new Set());
    if (!curve || !range) {
      setReview(null);
      return;
    }
    setBusy(true);
    setError(null);
    const t = setTimeout(() => {
      const excluded = maskRanges((nodes ?? []).filter((n) => n.enabled && n.input.curveId === curveId).flatMap((n) => n.intervals));
      scanSuspects(entry.well.depth.values, curve.data, { top: range.top, base: range.base, minDeviation: deviation, maxGapM: gap }, excluded, () => generation.current !== job)
        .then((scan) => {
          if (generation.current === job) setReview({ key, scan });
        })
        .catch((err: unknown) => {
          if (generation.current === job) {
            setReview(null);
            setError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (generation.current === job) setBusy(false);
        });
    }, 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nodes, curve]);
  useEffect(() => () => void generation.current++, []);

  const current = review?.key === key ? review.scan : null;
  useEffect(() => onCandidates(current?.candidates.map((c) => c.index) ?? []), [current, onCandidates]);

  const chosen = current ? current.candidates.filter((c) => selected.has(c.index)) : [];
  const draftKey = JSON.stringify(['suspects', curveId, chosen.map((c) => c.index)]);
  useEffect(() => {
    if (!range) return onReport({ draft: null, reason: 'Elegí un tramo para buscar candidatos.' });
    if (current?.truncated) return onReport({ draft: null, reason: 'Hay más de 256 candidatos: acotá el tramo o subí la desviación mínima.' });
    if (!chosen.length) return onReport({ draft: null, reason: current?.candidates.length ? 'Elegí los candidatos que querés excluir.' : 'Sin candidatos para excluir con estos límites.' });
    const depths = chosen.map((c) => c.depth);
    onReport({ draft: { operation: 'exclude', key: draftKey, build: (p) => addMaskIntervals(p, entry.well.id, curveId, depths.map((d) => ({ id: makeId('excluded'), top: d, base: d })), makeId('mask')) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, !!range, current?.truncated]);

  const show = (v: number) => formatNumber(v, { digits: 4 });
  const unit = curve?.unit ?? '';
  return (
    <>
      <RangeNote range={range} fromSelection={fromSelection} onClear={onClear} />
      <DraftSlider
        label="Desviación mínima"
        tooltip="Diferencia mínima frente a la mediana de los vecinos para señalar una muestra. También se exige superar tres dispersiones robustas locales."
        value={deviation}
        onChange={setDeviation}
        min={+(spread * 0.005).toPrecision(2)}
        max={+(spread * 2).toPrecision(2)}
        scale="log"
        unit={unit}
        format={(v) => formatNumber(v, { digits: 3 })}
      />
      <DraftSlider
        label="Separación máxima entre muestras"
        tooltip="Un salto de profundidad mayor corta la comparación con vecinos."
        value={gap}
        onChange={setGap}
        min={+step.toFixed(4)}
        max={5}
        scale="log"
        unit="m"
        format={(v) => formatNumber(v, { digits: 3 })}
      />
      <div className="prep-status" role="status">
        {busy ? (
          <>
            <Spinner size={12} /> Buscando candidatos…
          </>
        ) : current ? (
          <span>
            <strong className="num">{current.candidates.length.toLocaleString('es-AR')}</strong> candidatos en <span className="num">{current.evaluated.toLocaleString('es-AR')}</span> muestras evaluadas. La búsqueda no cambia el proyecto.
          </span>
        ) : null}
      </div>
      {error && <Callout tone="error">{error}</Callout>}
      {current?.truncated && <Callout tone="warn">Hay más de 256 candidatos. Acotá el tramo o subí la desviación mínima.</Callout>}
      {current && current.candidates.length > 0 && (
        <>
          <div className="prep-actions">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(current.candidates.map((c) => c.index)))}>
              Elegir todos
            </Button>
            <Button size="sm" variant="ghost" disabled={!selected.size} onClick={() => setSelected(new Set())}>
              Ninguno
            </Button>
            <span className="prep-muted num">{selected.size} elegidos</span>
          </div>
          <div className="prep-candidates" role="group" aria-label="Candidatos a espurio">
            <table className="prep-table">
              <thead>
                <tr>
                  <th scope="col">Excluir</th>
                  <th scope="col">MD (m)</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Mediana local</th>
                </tr>
              </thead>
              <tbody>
                {current.candidates.map((c) => (
                  <tr key={c.index} className={selected.has(c.index) ? 'is-selected' : undefined}>
                    <td>
                      <Checkbox
                        label={<span className="ui-visually-hidden">{`Excluir muestra a ${show(c.depth)} m MD`}</span>}
                        checked={selected.has(c.index)}
                        onChange={(checked) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(c.index);
                            else next.delete(c.index);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="num">{show(c.depth)}</td>
                    <td className="num">{show(c.value)}</td>
                    <td className="num">{show(c.median)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="prep-help">Un candidato puede ser una transición geológica real: revisalo en el gráfico antes de excluirlo. Al aplicar se guardan exclusiones por muestra; los límites de la búsqueda no se guardan.</p>
    </>
  );
}
