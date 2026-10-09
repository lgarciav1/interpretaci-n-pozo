/** Barra superior: espacio de trabajo, snapshots y guardar/abrir proyecto. */
import { useRef, useState } from 'react';
import { deserializeProject, serializeProject } from '../../core/state/serialize';
import { createSnapshot, describeDiff, diffInterpretations, restoreSnapshot } from '../../core/state/snapshots';
import { WORKSPACES } from '../../core/workspaces';
import { registry } from '../../modules';
import { selectActiveEntry, useProject } from '../store/project';
import { useUi } from '../store/ui';

export function TopBar() {
  const workspace = useUi((s) => s.workspace);
  const setUi = useUi((s) => s.set);
  const project = useProject((s) => s.project);
  const entry = useProject(selectActiveEntry);
  const commit = useProject((s) => s.commit);
  const replace = useProject((s) => s.replace);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [diff, setDiff] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const snapshots = project.snapshots.filter((s) => s.wellId === entry?.well.id);

  const save = async () => {
    const text = await serializeProject(project);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name || 'proyecto'}.pozo.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`Proyecto guardado (${(text.length / 1024).toFixed(0)} kB).`);
  };

  const open = async (file: File) => {
    try {
      replace(await deserializeProject(await file.text()));
      setMessage(`Proyecto "${file.name}" abierto.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <header className="topbar">
      <h1>Interpretación de pozo</h1>
      <div className="tabs" role="group" aria-label="Espacio de trabajo">
        {WORKSPACES.map((w) => (
          <button type="button" key={w.id} aria-pressed={workspace === w.id} onClick={() => setUi({ workspace: w.id, activeModuleId: null })}>
            {w.label}
          </button>
        ))}
      </div>
      <span className="spacer" />
      {entry && (
        <>
          <input type="text" placeholder="Nombre del snapshot" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ width: 150 }} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              commit('Crear snapshot', (p) => createSnapshot(p, entry.well.id, name).project);
              setName('');
            }}
          >
            Guardar snapshot
          </button>
          <select value={selected} onChange={(e) => setSelected(e.currentTarget.value)} aria-label="Snapshots">
            <option value="">Snapshots ({snapshots.length})</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={!selected} onClick={() => commit('Restaurar snapshot', (p) => restoreSnapshot(p, selected))}>
            Restaurar
          </button>
          <button
            type="button"
            className="btn"
            disabled={!selected}
            onClick={() => {
              const snap = snapshots.find((s) => s.id === selected)!;
              const d = diffInterpretations(snap.interpretation, entry.interpretation, registry);
              setDiff(d.map((x) => describeDiff(x, { registry, zones: entry.interpretation.zones })));
            }}
          >
            Diferencias
          </button>
        </>
      )}
      <button type="button" className="btn" onClick={save}>
        Guardar proyecto
      </button>
      <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
        Abrir…
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.currentTarget.files?.[0] && open(e.currentTarget.files[0])} />
      {message && <span className="muted">{message}</span>}
      {diff && (
        <div style={{ flexBasis: '100%' }}>
          <strong>Diferencias con el snapshot:</strong> {diff.length === 0 ? 'ninguna' : diff.join(' · ')}{' '}
          <button type="button" className="linkish" onClick={() => setDiff(null)}>
            cerrar
          </button>
        </div>
      )}
    </header>
  );
}
