/**
 * Herramienta «Alinear en profundidad» (0058): corre toda la curva (o la corrida elegida) una distancia constante en
 * MD, con vista previa viva. Exige declarar el datum: sin esa declaración no hay vista previa y se dice por qué.
 */
import { useEffect, useState } from 'react';
import { setDepthShift } from '../../core/state/preparation';
import { setRunDepthShift } from '../../core/state/runs';
import { makeId } from '../../core/state/project';
import { Callout, Checkbox, Field, TextField, formatNumber } from '../../ui';
import { formatOffset } from './pipeline';
import { DraftSlider } from './ToolCard';
import type { DraftReport } from './types';

export function ShiftEditor({ wellId, curveId, runId, runCurveIds, knownDatum, problem, step, onReport }: {
  wellId: string;
  curveId: string;
  runId: string;
  runCurveIds: readonly string[];
  knownDatum: string | null;
  problem: string | null;
  step: number;
  onReport(r: DraftReport): void;
}) {
  const [offset, setOffset] = useState(0);
  const [gap, setGap] = useState(() => +(step * 2).toFixed(4));
  const [datum, setDatum] = useState(knownDatum ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const d = datum.trim();
  const key = JSON.stringify(['shift', curveId, runId, offset, gap, d, confirmed, problem]);
  useEffect(() => {
    if (problem) return onReport({ draft: null, reason: problem });
    if (!d) return onReport({ draft: null, reason: 'Escribí el datum declarado de origen y destino para previsualizar la alineación.' });
    if (!confirmed) return onReport({ draft: null, reason: 'Tildá la declaración del datum para previsualizar la alineación.' });
    if (offset === 0) return onReport({ draft: null, reason: 'Elegí un desplazamiento distinto de cero.' });
    const config = { offsetM: offset, maxGapM: gap, datum: d, referenceId: wellId, depthKind: 'MD' as const };
    onReport({
      draft: {
        operation: 'shift',
        key,
        build: (p) => (runId ? setRunDepthShift(p, wellId, runId, config, () => makeId('shift')) : setDepthShift(p, wellId, curveId, config, makeId('shift'))),
        ...(runId ? { batchCurveIds: runCurveIds } : {}),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <>
      <DraftSlider
        label="Desplazamiento constante"
        hint="Positivo = los eventos de la curva bajan (más profundo)."
        value={offset}
        onChange={(v) => setOffset(Math.round(v * 100) / 100)}
        min={-10}
        max={10}
        step={0.01}
        unit="m"
        format={(v) => formatOffset(v).replace(/ m$/, '')}
      />
      <DraftSlider
        label="Hueco máximo de remuestreo"
        tooltip="Distancia máxima entre muestras corridas para estimar un valor entre ellas; si es mayor, queda fuera de dominio."
        value={gap}
        onChange={setGap}
        min={+step.toFixed(4)}
        max={5}
        scale="log"
        unit="m"
        format={(v) => formatNumber(v, { digits: 3 })}
      />
      <Field label="Datum declarado de origen y destino" hint={knownDatum ? `Datum conocido del pozo: ${knownDatum}.` : 'El datum de adquisición no está registrado: la declaración queda en esta receta.'}>
        <TextField
          aria-label="Datum declarado de origen y destino"
          value={datum}
          onChange={(v) => {
            setDatum(v);
            setConfirmed(false);
          }}
          block
        />
      </Field>
      <Checkbox checked={confirmed} onChange={setConfirmed} label="Declaro que la curva y el índice del pozo comparten referencia MD y el datum indicado" />
      {runId && <Callout tone="warn">Se alineará toda la corrida {runId} ({runCurveIds.length} curvas). Aplicar exige cobertura en cada una; todas sus fuentes se activan juntas.</Callout>}
      <p className="prep-help">Mueve toda la curva después de las otras etapas, sin mover el índice ni otras curvas; no convierte datums ni MD a TVD. Es manual: revisá la correlación (pestaña Corridas y correlación) antes de aplicar.</p>
    </>
  );
}
