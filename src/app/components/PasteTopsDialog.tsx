/**
 * «Pegar topes» (F09): pegar o cargar una planilla nombre–tope(–base) y crear las zonas del pozo activo.
 * La lectura y la validación son puras (`src/io/zoneTops.ts`); acá solo hay el cuadro de pegado, la vista previa con
 * los problemas por fila y el aplicado, que es UN `commit` (un solo paso de deshacer).
 */
import { useId, useMemo, useRef, useState } from 'react';
import { applyZoneEdit, makeId } from '../../core/state/project';
import { zonesFromTops, type ZoneTopsMode } from '../../core/state/zones';
import type { Zone } from '../../core/well';
import { gridFromText, parseZoneTops, readZoneTopsFile, type ZoneTopsRow } from '../../io';
import { Badge, Button, Callout, DataTable, Dialog, Field, SegmentedControl, TextArea, formatNumber, toast, zoneColor, type Column } from '../../ui';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import './paste-tops.css';

const EXAMPLE = 'Nombre\tTope (m)\tBase (m)\nZona A\t7633\t7800\nZona B\t7800,5\t\nZona C\t8100\t';
const m = (v: number | null) => (v === null ? '—' : formatNumber(v, { digits: 2, grouping: false }));

export function PasteTopsDialog({ wellId, depth, zones, onClose }: { wellId: string; depth: ArrayLike<number>; zones: readonly Zone[]; onClose(): void }) {
  const commit = useProject((s) => s.commit);
  const setUi = useUi((s) => s.set);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ZoneTopsMode>('replace');
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textId = useId();

  const effectiveMode: ZoneTopsMode = zones.length === 0 ? 'replace' : mode;
  const result = useMemo(
    () => (text.trim() === '' ? null : parseZoneTops(gridFromText(text), { depth, keep: effectiveMode === 'append' ? zones : [] })),
    [text, depth, zones, effectiveMode],
  );

  const openFile = async (file: File) => {
    setFileError(null);
    try {
      setText(readZoneTopsFile(new Uint8Array(await file.arrayBuffer()), file.name));
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    }
  };

  const apply = () => {
    if (!result || result.errors > 0 || result.drafts.length === 0) return;
    const next = zonesFromTops(zones, result.drafts, effectiveMode, (i) => ({ id: makeId('zona'), color: zoneColor(i) }));
    const count = result.drafts.length;
    commit(`Pegar topes (${count} ${count === 1 ? 'zona' : 'zonas'})`, (p) => applyZoneEdit(p, wellId, next));
    setUi({ editingZoneId: null });
    toast({ tone: 'ok', title: `${count} ${count === 1 ? 'zona creada' : 'zonas creadas'}`, description: 'Ctrl+Z deshace todo el pegado de una vez.' });
    onClose();
  };

  const columns: Column<ZoneTopsRow>[] = [
    { key: 'row', header: 'Fila', align: 'num', width: '8%', render: (r) => r.row },
    { key: 'name', header: 'Zona', render: (r) => r.name || <span className="ui-text-muted">—</span> },
    { key: 'top', header: 'Tope (m)', align: 'num', render: (r) => m(r.top) },
    {
      key: 'base',
      header: 'Base (m)',
      align: 'num',
      title: 'Sin base propia, la zona llega hasta la muestra anterior al tope de la siguiente',
      render: (r) => (
        <>
          {m(r.base)}
          {r.base !== null && !r.explicitBase && <span className="paste-tops__derived" title="Calculada: llega hasta el tope de la zona siguiente"> *</span>}
        </>
      ),
    },
    {
      key: 'state',
      header: 'Estado',
      width: '44%',
      render: (r) =>
        r.problems.length === 0 ? (
          <Badge tone="ok">Lista</Badge>
        ) : (
          <ul className="paste-tops__problems">
            {r.problems.map((p, i) => (
              <li key={i} className={`paste-tops__problem is-${p.severity}`}>
                <Badge tone={p.severity === 'error' ? 'error' : 'warn'}>{p.severity === 'error' ? 'Error' : 'Aviso'}</Badge> {p.message.replace(/^Filas? [\d y]+: /, '')}
              </li>
            ))}
          </ul>
        ),
    },
  ];

  const general = result?.problems.filter((p) => p.row === null) ?? [];
  const count = result?.drafts.length ?? 0;
  const blocked = !result || result.errors > 0 || count === 0;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Pegar topes"
      description="Una fila por zona: nombre, tope y, si querés, base. Decimales con coma o punto."
      footer={
        <>
          <span className="ui-text-muted">{result ? `${result.rows.length} ${result.rows.length === 1 ? 'fila' : 'filas'} leídas` : 'Sin datos todavía'}</span>
          <span className="shell-spacer" />
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon="check" disabled={blocked} onClick={apply} data-testid="paste-tops-apply">
            {count > 0 && !blocked ? (effectiveMode === 'replace' && zones.length > 0 ? `Reemplazar por ${count} ${count === 1 ? 'zona' : 'zonas'}` : `Crear ${count} ${count === 1 ? 'zona' : 'zonas'}`) : 'Crear zonas'}
          </Button>
        </>
      }
    >
      <div className="paste-tops">
        <Field label="Tabla de topes" htmlFor={textId} hint="Copiá las celdas en Excel o Sheets y pegalas acá, o cargá un .csv o .xlsx. Ctrl+Enter aplica.">
          <TextArea
            id={textId}
            mono
            rows={6}
            value={text}
            onChange={setText}
            placeholder={EXAMPLE}
            spellCheck={false}
            data-autofocus
            onKeyDown={(e) => {
              // Enter es salto de línea en la tabla; Ctrl+Enter (⌘+Enter) aplica.
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                apply();
              }
            }}
            data-testid="paste-tops-text"
          />
        </Field>
        <div className="paste-tops__bar">
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm" hidden data-testid="paste-tops-file" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void openFile(f); }} />
          <Button size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
            Cargar archivo…
          </Button>
          {zones.length > 0 && (
            <SegmentedControl
              size="sm"
              aria-label="Qué hacer con las zonas actuales"
              value={effectiveMode}
              onChange={(v) => setMode(v as ZoneTopsMode)}
              options={[
                { value: 'replace', label: `Reemplazar las ${zones.length} actuales` },
                { value: 'append', label: 'Agregar a las actuales' },
              ]}
            />
          )}
        </div>
        {fileError && <Callout tone="error" title="No se pudo leer el archivo">{fileError}</Callout>}
        {general.map((p, i) => (
          <Callout key={i} tone="error">{p.message}</Callout>
        ))}
        {result && result.rows.length > 0 && (
          <>
            <Callout
              tone={result.errors > 0 ? 'error' : result.warnings > 0 ? 'warn' : 'ok'}
              title={result.errors > 0 ? `${result.errors} ${result.errors === 1 ? 'error impide' : 'errores impiden'} crear las zonas` : `${count} ${count === 1 ? 'zona lista' : 'zonas listas'} para crear`}
            >
              {result.errors > 0
                ? 'Corregí la tabla de arriba: la vista previa se actualiza al escribir.'
                : result.warnings > 0
                  ? `${result.warnings} ${result.warnings === 1 ? 'aviso' : 'avisos'}: no impiden crearlas.`
                  : effectiveMode === 'replace' && zones.length > 0
                    ? 'Las zonas con el mismo nombre conservan sus parámetros; el resto de las actuales se descarta.'
                    : 'Se agregan sin tocar las zonas actuales.'}
            </Callout>
            <DataTable dense caption="Vista previa de las zonas" data-testid="paste-tops-preview" rows={result.rows} rowKey={(r) => String(r.row)} columns={columns} rowProps={(r) => ({ 'data-state': r.problems.some((p) => p.severity === 'error') ? 'error' : r.problems.length ? 'warning' : 'ok' })} />
            <p className="paste-tops__note">* Base calculada: hasta la muestra anterior a la zona siguiente o al fondo del pozo. Todo se ajusta a la muestra más cercana.</p>
          </>
        )}
      </div>
    </Dialog>
  );
}
