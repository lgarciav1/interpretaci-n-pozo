/**
 * Diálogos del armazón: snapshots (en src/app/snapshots/, se reexporta acá) e informe de calidad. El asistente de
 * carga está en components/LoadWellDialog.
 */
import { Button, Dialog } from '../../ui';
import { BoreholeSummary, QcCounts, QcCurveTable } from '../components/Qc';
import { markStep } from '../flow/useFlow';
import { selectActiveEntry, useProject } from '../store/project';
import { useWellQc } from '../store/qc';
import { useUi } from '../store/ui';

export { SnapshotsDialog } from '../snapshots/SnapshotsDialog';

export function QcReportDialog() {
  const open = useUi((s) => s.qcReportOpen);
  const setUi = useUi((s) => s.set);
  const entry = useProject(selectActiveEntry);
  const qc = useWellQc(open ? (entry?.well ?? null) : null);
  const reviewed = entry?.progress.marks['qc'] === 'done';
  const close = () => setUi({ qcReportOpen: false });
  return (
    <Dialog
      open={open && !!entry}
      onClose={close}
      size="xl"
      title={`Control de calidad · ${entry?.well.name ?? ''}`}
      headerExtra={qc ? <QcCounts report={qc} /> : undefined}
      footer={
        <>
          <span className="ui-text-muted">Las observaciones no impiden interpretar: marcan dónde desconfiar.</span>
          <span className="shell-spacer" />
          <Button onClick={close}>Cerrar</Button>
          {!reviewed && (
            <Button
              variant="primary"
              icon="check"
              onClick={() => {
                markStep('qc', 'done');
                close();
              }}
            >
              Marcar como revisada
            </Button>
          )}
        </>
      }
    >
      {qc && (
        <>
          <BoreholeSummary report={qc} />
          <QcCurveTable report={qc} />
        </>
      )}
    </Dialog>
  );
}
