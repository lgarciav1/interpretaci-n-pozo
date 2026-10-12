/**
 * Diálogo de snapshots: guardar el estado de la interpretación, restaurarlo, comparar el sumario por zona entre dos
 * estados (A y B) y abrir la cortina antes/después en el visor. Ver docs/decisiones/0026.
 */
import { useEffect, useState } from 'react';
import { createSnapshot, restoreSnapshot } from '../../core/state/snapshots';
import { Button, DataTable, Dialog, EmptyState, TextField, toast } from '../../ui';
import { selectActiveEntry, useProject } from '../store/project';
import { useUi } from '../store/ui';
import { openCurtain } from './actions';
import { SummaryCompare } from './SummaryCompare';
import { CURRENT } from './useSource';
import './snapshots.css';

const dateFmt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

export function SnapshotsDialog() {
  const open = useUi((s) => s.snapshotsOpen);
  const setUi = useUi((s) => s.set);
  const allSnapshots = useProject((s) => s.project.snapshots);
  const entry = useProject(selectActiveEntry);
  const commit = useProject((s) => s.commit);
  const [name, setName] = useState('');
  /** Fuentes comparadas (null = por defecto: el snapshot más reciente contra la actual). */
  const [pair, setPair] = useState<{ a: string; b: string } | null>(null);
  const wellId = entry?.well.id;
  const snapshots = allSnapshots.filter((s) => s.wellId === wellId);
  const latest = snapshots.at(-1)?.id ?? null;

  // Una fuente que ya no existe (otro pozo, deshacer) vuelve al valor por defecto.
  const valid = (id: string) => id === CURRENT || snapshots.some((s) => s.id === id);
  const current = pair && valid(pair.a) && valid(pair.b) ? pair : latest ? { a: latest, b: CURRENT } : null;
  useEffect(() => setPair(null), [wellId]);

  const close = () => setUi({ snapshotsOpen: false });
  if (!entry) return null;

  const save = () => {
    commit('Crear snapshot', (p) => createSnapshot(p, entry.well.id, name).project);
    toast({ title: 'Snapshot guardado', description: name.trim() || undefined, tone: 'ok' });
    setName('');
    setPair(null);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="xl"
      title="Snapshots"
      description="Guardá el estado de la interpretación (zonas, parámetros y métodos) para volver a él o comparar qué cambió."
    >
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
        <EmptyState size="sm" icon="bookmark" title="Todavía no hay snapshots de este pozo" description="Guardá uno antes de probar otros parámetros: vas a poder volver, comparar el sumario o ver el antes y el después en el visor." />
      ) : (
        <>
          <DataTable
            rows={[...snapshots].reverse()}
            rowKey={(s) => s.id}
            maxHeight={168}
            dense
            selectedKey={current?.a !== CURRENT ? current?.a : current?.b !== CURRENT ? current.b : null}
            columns={[
              { key: 'name', header: 'Nombre', render: (s) => <strong>{s.name}</strong> },
              { key: 'createdAt', header: 'Creado', align: 'num', render: (s) => dateFmt.format(new Date(s.createdAt)) },
              {
                key: 'actions',
                header: <span className="ui-visually-hidden">Acciones</span>,
                align: 'right',
                render: (s) => (
                  <span className="snap-actions">
                    <Button size="sm" variant="ghost" icon="compare" title="Comparar el sumario de este snapshot (A) con la interpretación actual (B)" onClick={() => setPair({ a: s.id, b: CURRENT })}>
                      Comparar
                    </Button>
                    <Button size="sm" variant="ghost" icon="curtain" title="Ver en el visor el antes (este snapshot) y el después (la interpretación actual) con una cortina arrastrable" onClick={() => openCurtain(s.id)}>
                      Cortina
                    </Button>
                    <Button
                      size="sm"
                      icon="history"
                      onClick={() => {
                        commit(`Restaurar snapshot «${s.name}»`, (p) => restoreSnapshot(p, s.id));
                        toast({ title: `Snapshot «${s.name}» restaurado`, tone: 'ok' });
                      }}
                    >
                      Restaurar
                    </Button>
                  </span>
                ),
              },
            ]}
          />
          {current && <SummaryCompare entry={entry} snapshots={snapshots} a={current.a} b={current.b} onChange={(a, b) => setPair({ a, b })} />}
        </>
      )}
    </Dialog>
  );
}
