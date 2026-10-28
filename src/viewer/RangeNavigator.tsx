/** Selección explícita de detalle; el minimapa conserva el panorama del pozo. Estado efímero. */
import { useId, useRef, useState, type Ref } from 'react';
import { Button, Field, formatNumber, IconButton, Popover, TextField } from '../ui';
import { adjacentDepthRange, centeredDepthRange, validateDepthRange, type DepthBounds, type DepthRange } from './rangeNavigation';

interface WindowSnapshot extends DepthRange, DepthBounds { minimumSpan: number }
interface Props {
  rangeRef: Ref<HTMLSpanElement>;
  getWindow(): WindowSnapshot | null;
  show(range: DepthRange): DepthRange | null;
  fit(): void;
}
const draftNumber = (v: number) => String(v).replace('.', ',');

export function RangeNavigator({ rangeRef, getWindow, show, fit }: Props) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<{ top: string; base: string; min: number; max: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const close = () => { setDraft(null); setError(null); };
  const restoreFocus = () => { close(); anchor.current?.focus(); };
  const open = () => {
    const w = getWindow();
    if (!w) return;
    setDraft({ top: draftNumber(w.top), base: draftNumber(w.base), min: w.min, max: w.max });
    setError(null);
  };
  const navigate = (range: DepthRange) => {
    const actual = show(range);
    if (actual) restoreFocus();
  };
  const shortcut = (length: number) => {
    const w = getWindow();
    if (w) navigate(centeredDepthRange(w, Math.max(length, w.minimumSpan), w));
  };
  const page = (direction: -1 | 1) => {
    const w = getWindow();
    if (w) navigate(adjacentDepthRange(w, direction, w));
  };
  return (
    <>
      <button type="button" className="wv-range-trigger" ref={anchor} onClick={open}
        aria-label="Elegir intervalo de profundidad" aria-haspopup="dialog" aria-expanded={draft !== null}
        aria-describedby={`${id}-visible`}
        title="Elegir intervalo de profundidad">
        <span id={`${id}-visible`} className="wv-toolbar__range num" ref={rangeRef} aria-label="Tramo visible" />
      </button>
      {draft && (
        <Popover open anchorRef={anchor} onClose={close} label="Intervalo de profundidad" align="end" width={330} className="wv-range">
          <div className="wv-range__head">
            <strong>Intervalo de profundidad</strong>
            <IconButton icon="x" size="sm" label="Cerrar intervalo" onClick={restoreFocus} />
          </div>
          <p className="wv-range__hint">Pozo: {formatNumber(draft.min, { digits: 2, grouping: false })}–{formatNumber(draft.max, { digits: 2, grouping: false })} m. El minimapa conserva la vista completa.</p>
          <form onSubmit={(e) => {
            e.preventDefault();
            const w = getWindow();
            if (!w) return;
            const result = validateDepthRange(draft.top, draft.base, w, w.minimumSpan);
            if (result.error !== undefined) setError(result.error);
            else navigate(result.range);
          }}>
            <div className="wv-range__fields">
              <Field label="Tope" htmlFor={`${id}-top`}>
                <TextField id={`${id}-top`} data-autofocus inputMode="decimal" suffix="m" size="sm" block
                  value={draft.top} onChange={(top) => { setDraft({ ...draft, top }); setError(null); }}
                  invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
              </Field>
              <Field label="Base" htmlFor={`${id}-base`}>
                <TextField id={`${id}-base`} inputMode="decimal" suffix="m" size="sm" block
                  value={draft.base} onChange={(base) => { setDraft({ ...draft, base }); setError(null); }}
                  invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
              </Field>
            </div>
            {error && <p id={`${id}-error`} className="wv-range__error" role="alert">{error}</p>}
            <Button type="submit" variant="primary" size="sm" block>Mostrar tramo</Button>
          </form>
          <div className="wv-range__actions" role="group" aria-label="Ventanas de detalle">
            <Button size="sm" onClick={() => shortcut(50)}>Ver 50 m</Button>
            <Button size="sm" onClick={() => shortcut(100)}>Ver 100 m</Button>
            <Button size="sm" variant="ghost" onClick={() => { fit(); restoreFocus(); }}>Todo el pozo</Button>
          </div>
          <div className="wv-range__actions" role="group" aria-label="Recorrer intervalos">
            <Button size="sm" onClick={() => page(-1)}>Tramo anterior</Button>
            <Button size="sm" onClick={() => page(1)}>Tramo siguiente</Button>
          </div>
          <p className="wv-range__hint">Anterior y siguiente conservan un 10 % de solapamiento. Solo cambia la vista.</p>
        </Popover>
      )}
    </>
  );
}
