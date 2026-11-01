/** Herramienta «Excluir tramo» (0058): marca un tramo de mediciones como sin dato, con vista previa viva. */
import { useEffect } from 'react';
import { addMaskInterval } from '../../core/state/preparation';
import { makeId } from '../../core/state/project';
import { Button } from '../../ui';
import { RangeNote } from './ToolCard';
import type { DepthRange, DraftReport } from './types';

export function ExclusionEditor({ wellId, curveId, selection, view, onReport, onSelect, onClear }: {
  wellId: string;
  curveId: string;
  selection: DepthRange | null;
  view: DepthRange | null;
  onReport(r: DraftReport): void;
  onSelect(r: DepthRange): void;
  onClear(): void;
}) {
  const key = JSON.stringify(['exclude', curveId, selection?.top, selection?.base]);
  useEffect(() => {
    if (!selection) {
      onReport({ draft: null, reason: 'Marcá el tramo a excluir: arrastrá sobre el gráfico o usá «Excluir toda la vista».' });
      return;
    }
    const { top, base } = selection;
    onReport({ draft: { operation: 'exclude', key, build: (p) => addMaskInterval(p, wellId, curveId, { id: makeId('excluded'), top, base }, makeId('mask')) } });
    // La clave resume los parámetros.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <>
      <RangeNote range={selection} fromSelection onClear={onClear} />
      {!selection && view && (
        <Button size="sm" icon="fit-height" onClick={() => onSelect(view)}>
          Excluir toda la vista
        </Button>
      )}
      <p className="prep-help">Se incluyen las muestras de ambos extremos. Las filas y la profundidad se conservan; el original queda guardado y se puede restaurar.</p>
    </>
  );
}
