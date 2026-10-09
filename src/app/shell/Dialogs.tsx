/** Diálogos del armazón: snapshots e informe de calidad. El asistente de carga está en components/LoadWellDialog. */
import { useState } from 'react';
import { createSnapshot, describeDiff, diffInterpretations, restoreSnapshot } from '../../core/state/snapshots';
import { registry } from '../../modules';
import { Button, Callout, DataTable, Dialog, EmptyState, TextField, toast } from '../../ui';
import { BoreholeSummary, QcCounts, QcCurveTable } from '../components/Qc';
import { markStep } from '../flow/useFlow';
import { selectActiveEntry, useProject } from '../store/project';
import { useWellQc } from '../store/qc';
import { useUi } from '../store/ui';

const dateFmt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

export function SnapshotsDialog() {
  const open = useUi((s) => s.snapshotsOpen);
  const setUi = useUi((s) => s.set);
  const project = useProject((s) => s.project);
  const entry = useProject(selectActiveEntry);
  const commit = useProject((s) => s.commit);
  const [name, setName] = useState('');
  const [diff, setDiff] = useState<{ name: string; lines: string[] } | null>(null);
  const close = () => {
    setUi({ snapshotsOpen: false });
    setDiff(null);
  };
  if (!entry) return null;
  const snapshots = project.snapshots.filter((s) => s.wellId === entry.well.id);

  const save = () => {
    commit('Crear snapshot', (p) => createSnapshot(p, entry.well.id, name).project);
    toast({ title: 'Snapshot guardado', description: name.trim() || undefined, tone: 'ok' });
    setName('');
  };

  return (
    <Dialog open={open} onClose={close} size="lg" title="Snapshots" description="Guardá el estado de la interpretación (zonas, parámetros y métodos) para volver a él o compararlo.">
      <form
        className="snap-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField value={name} onChange={setName} placeholder="Nombre del snapshot (opcional)" block data-autofocus aria-label="Nombre del snapshot" />
        <Button type="submit" variant="primary" icon="bookmark">
          Guardar snapshot
        </Button>
      </form>
      {snapshots.length === 0 ? (
        <EmptyState size="sm" icon="bookmark" title="Todavía no hay snapshots de este pozo" description="Guardá uno antes de probar otros parámetros: vas a poder volver o ver qué cambió." />
      ) : (
        <DataTable
          rows={[...snapshots].reverse()}
          rowKey={(s) => s.id}
          maxHeight={280}
          columns={[
            { key: 'name', header: 'Nombre', render: (s) => <strong>{s.name}</strong> },
            { key: 'createdAt', header: 'Creado', align: 'num', render: (s) => dateFmt.format(new Date(s.createdAt)) },
            {
              key: 'actions',
              header: <span className="ui-visually-hidden">Acciones</span>,
              align: 'right',
              render: (s) => (
                <span className="snap-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="compare"
                    onClick={() => {
                      const d = diffInterpretations(s.interpretation, entry.interpretation, registry);
                      setDiff({ name: s.name, lines: d.map((x) => describeDiff(x, { registry, zones: entry.interpretation.zones })) });
                    }}
                  >
                    Diferencias
                  </Button>
                  <Button
                    size="sm"
                    icon="history"
                    onClick={() => {
                      commit('Restaurar snapshot', (p) => restoreSnapshot(p, s.id));
                      toast({ title: `Snapshot «${s.name}» restaurado`, tone: 'ok' });
                      setDiff(null);
                    }}
                  >
                    Restaurar
                  </Button>
                </span>
              ),
            },
          ]}
        />
      )}
      {diff && (
        <Callout tone={diff.lines.length ? 'info' : 'ok'} title={`Diferencias con «${diff.name}»`}>
          {diff.lines.length === 0 ? (
            'Ninguna: la interpretación actual es igual a la del snapshot.'
          ) : (
            <ul>
              {diff.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </Callout>
      )}
    </Dialog>
  );
}

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
          <div className="table-scroll tall">
            <QcCurveTable report={qc} />
          </div>
        </>
      )}
    </Dialog>
  );
}
