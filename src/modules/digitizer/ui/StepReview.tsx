/** Paso 5 — Revisión: calidad de cada curva (mensajes del motor), métricas y vista previa como pistas. */
import { useEffect, useMemo } from 'react';
import { Badge, Button, Callout, EmptyState, StatusDot } from '../../../ui';
import { formatNumber } from '../../../ui/format';
import { selectActiveEntry, useProject } from '../../../app/store/project';
import { calibrationOf } from '../model/form';
import { QUALITY_LABEL, QUALITY_TONE, qualityOf, seriesOf } from '../model/outputs';
import { traceExtent } from '../model/traceEdit';
import { useDigitizer } from '../store';
import { deskViewActions } from './DeskCanvas';
import { CurveSwatchDot } from './StepCurves';
import { Kv, StepIntro } from './common';
import { PreviewTracks, type PreviewItem } from './PreviewTracks';

const pct = (v: number) => `${formatNumber(v * 100, { digits: 0 })} %`;

export function useDigitized() {
  const work = useDigitizer((s) => s.work);
  return useMemo(() => {
    const cal = calibrationOf(work).calibration;
    return work.curves
      .filter((c) => c.trace)
      .map((c) => ({ curve: c, series: seriesOf(c, cal), quality: qualityOf(c, cal) }));
  }, [work]);
}

export function StepReview() {
  const rows = useDigitized();
  const well = useProject((s) => selectActiveEntry(s)?.well ?? null);
  const set = useDigitizer((s) => s.set);
  useEffect(() => {
    if (rows.length) set({ reviewed: true });
  }, [rows.length, set]);
  const items: PreviewItem[] = rows.filter((r) => r.series).map((r) => ({ curve: r.curve, series: r.series! }));
  if (!rows.length) return <EmptyState size="sm" icon="curve" title="Nada que revisar todavía" description="Trazá al menos una curva en el paso Curvas." />;
  return (
    <>
      <StepIntro>Revisá cada curva sobre la imagen (la traza va en el color complementario de la tinta) y en la vista previa. Corregí a mano lo que haga falta en el paso Curvas.</StepIntro>
      {rows.map(({ curve: c, quality: q, series }) => {
        const ext = traceExtent(c.trace);
        return (
          <article key={c.id} className="dz-review" data-testid={`digitizer-review-${c.mnemonic}`}>
            <header className="dz-review__head">
              <CurveSwatchDot c={c} />
              <strong>{c.mnemonic}</strong>
              {q && <StatusDot tone={QUALITY_TONE[q.level]} label={`Calidad ${QUALITY_LABEL[q.level].toLowerCase()}`} />}
              {q && <Badge tone={QUALITY_TONE[q.level]}>{QUALITY_LABEL[q.level]}</Badge>}
              <span className="dz-spacer" />
              <Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => (set({ selectedCurveId: c.id, step: 'curves', view: 'corrected' }), ext && deskViewActions.centerRow((ext[0] + ext[1]) / 2))}>
                Editar
              </Button>
            </header>
            {q && (
              <Kv
                items={[
                  ['Cobertura', pct(q.metrics.coverage)],
                  ['Observada (sin interpolar)', pct(q.metrics.observedFraction)],
                  ['Saltos', `${q.metrics.jumps} (${formatNumber(q.metrics.jumpsPer1000Rows, { digits: 1 })} cada 1000 filas)`],
                  ['Temblor estimado', `${formatNumber(q.metrics.roughnessPx, { digits: 2 })} px`],
                  ['Confianza media', formatNumber(q.metrics.meanConfidence, { digits: 2 })],
                  ['Puntos', series ? series.depthM.length.toLocaleString('es-AR') : '—'],
                  ['Tramo', series && series.depthM.length ? `${formatNumber(series.depthM[0]!, { digits: 1 })}–${formatNumber(series.depthM[series.depthM.length - 1]!, { digits: 1 })} m` : '—'],
                ]}
              />
            )}
            {q && q.flags.length > 0 ? (
              <ul className="dz-flags">
                {q.flags.map((f) => (
                  <li key={f.code} className={`dz-flag dz-flag--${f.level}`}>
                    {f.message}
                  </li>
                ))}
              </ul>
            ) : (
              q && <p className="dz-ok-line">Sin avisos de calidad.</p>
            )}
          </article>
        );
      })}
      <PreviewTracks items={items} well={well} />
      <Callout tone="info">Una calidad «Buena» mide la coherencia del trazo, no que se haya seguido la curva correcta: compará siempre con la imagen.</Callout>
    </>
  );
}
