import { useId, useState } from 'react';
import { NOTE_MAX_LENGTH, type DepthNote } from '../core/notes';
import { saveNote, removeNote } from '../core/state/notes';
import { makeId } from '../core/state/project';
import { Button, Callout, Dialog, Field, TextArea, TextField, parseDecimal } from '../ui';
import type { ViewerData } from './overlay';
import './notes.css';

export function NotesDialog({ data, depth, onClose }: { data: ViewerData; depth: number; onClose(): void }) {
  const textId = useId();
  const topId = useId();
  const baseId = useId();
  const fresh = (): DepthNote => ({ id: makeId('nota'), text: '', top: depth });
  const [draft, setDraft] = useState(fresh);
  const [top, setTop] = useState(String(depth));
  const [base, setBase] = useState('');
  const [error, setError] = useState('');
  const edit = (n: DepthNote) => { setDraft(n); setTop(String(n.top)); setBase(n.base === undefined ? '' : String(n.base)); setError(''); };
  const save = () => {
    try {
      const parsedTop = top.trim() ? (parseDecimal(top) ?? NaN) : NaN;
      const parsedBase = base.trim() ? (parseDecimal(base) ?? NaN) : undefined;
      const note = { id: draft.id, text: draft.text.trim(), top: parsedTop, ...(parsedBase !== undefined ? { base: parsedBase } : {}) };
      data.commit?.('Guardar nota', p => saveNote(p, data.wellId, note));
      edit(fresh());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <Dialog open onClose={onClose} title="Notas de profundidad" description="Metros MD. Arrastrá el encabezado de una nota en el perfil o usá Tab y ↑/↓ para moverla. Los cambios se deshacen con Ctrl+Z." footer={<><Button onClick={onClose}>Cerrar</Button><Button variant="primary" onClick={save} disabled={!data.commit}>Guardar nota</Button></>}>
    <div className="depth-notes">
      <div className="depth-notes__list"><Button size="sm" onClick={() => edit(fresh())}>Nueva nota</Button>
        {(data.interpretation.notes ?? []).map(n => <div key={n.id} className="depth-notes__row"><button type="button" onClick={() => edit(n)}><strong>{n.top.toFixed(2)}{n.base !== undefined ? `–${n.base.toFixed(2)}` : ''} m</strong><span>{n.text}</span></button><Button variant="danger" size="sm" onClick={() => { data.commit?.('Borrar nota', p => removeNote(p, data.wellId, n.id)); if (draft.id === n.id) edit(fresh()); }}>Borrar</Button></div>)}
      </div>
      <Field label="Texto" htmlFor={textId}>
        <TextArea id={textId} className="depth-notes__textarea" data-autofocus value={draft.text} maxLength={NOTE_MAX_LENGTH} rows={4} block onChange={text => setDraft({ ...draft, text })} />
      </Field>
      <div className="depth-notes__range">
        <Field label="Profundidad / tope (m MD)" htmlFor={topId}>
          <TextField id={topId} inputMode="decimal" value={top} onChange={setTop} block />
        </Field>
        <Field label="Base opcional (m MD)" htmlFor={baseId}>
          <TextField id={baseId} inputMode="decimal" value={base} onChange={setBase} block />
        </Field>
      </div>
      {error && <Callout tone="error">{error}</Callout>}
    </div>
  </Dialog>;
}

