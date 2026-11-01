/**
 * Asistente de carga de presiones de formación (MDT, RFT…): archivo → columnas → puntos en el pozo activo.
 * Mismo flujo y piezas que el de pozos (`LoadWellDialog`), pero el mapeo es por CAMPO (profundidad, presión,
 * movilidad, lodo, calidad…) y no por rol de curva. La lectura es pura (`src/io/pressures.ts`); acá solo se arma el
 * flujo y se aplica `addPointSet` por `commit`.
 */
import { useId, useMemo, useState } from 'react';
import { addPointSet } from '../../core/state/pointSets';
import { activeWellEntry, makeId } from '../../core/state/project';
import { getUnit, listUnits, unitLabel } from '../../core/units';
import {
  buildPressureSet,
  detectFormat,
  listXlsxSheets,
  parseTable,
  PRESSURE_FIELD_DIMENSION,
  PRESSURE_FIELD_LABEL,
  suggestPressureMapping,
  type Confidence,
  type FileInput,
  type PressureColumnMapping,
  type PressureField,
  type RawTable,
} from '../../io';
import { Badge, Button, Callout, DataTable, Dialog, Field, FileDrop, Section, Select, Spinner, TextField, WizardSteps, formatNumber, toast, type Column, type Tone } from '../../ui';
import { useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import { assessQuality } from './model';

type Step = 'source' | 'columns';

interface Source {
  name: string;
  input: FileInput;
  sheets: string[];
  sheet: string | null;
}

const ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt,.las';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'source', label: 'Archivo' },
  { id: 'columns', label: 'Columnas' },
];
const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'alta', medium: 'media', low: 'baja', none: '—' };
const CONFIDENCE_TONE: Record<Confidence, Tone> = { high: 'ok', medium: 'warn', low: 'error', none: 'neutral' };
const NUMERIC_FIELDS: PressureField[] = ['depth', 'tvd', 'pressure', 'mobility', 'mudBefore', 'mudAfter'];
const TEXT_FIELDS: PressureField[] = ['quality', 'testType', 'comment', 'test'];
const PREVIEW_ROWS = 8;

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function LoadPressuresDialog({ onClose, onExample, onTp }: { onClose: () => void; onExample?: () => void; onTp?: () => void }) {
  const commit = useProject((s) => s.commit);
  const [step, setStep] = useState<Step>('source');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [table, setTable] = useState<RawTable | null>(null);
  const [mapping, setMapping] = useState<PressureColumnMapping[]>([]);
  const [edited, setEdited] = useState<ReadonlySet<number>>(new Set());
  const [name, setName] = useState('');
  const nameId = useId();
  const sheetId = useId();

  const parse = async (src: Source) => {
    setError(null);
    setBusy(`Leyendo ${src.name}…`);
    await nextPaint();
    try {
      const t = parseTable(src.input, src.name, { requireDepth: false, ...(src.sheet !== null ? { sheet: src.sheet } : {}) });
      setSource(src);
      setTable(t);
      setMapping(suggestPressureMapping(t));
      setEdited(new Set());
      setName((n) => (src.sheet !== null && n ? n : src.name.replace(/\.[^.]+$/, '')));
      setStep('columns');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const openFile = async (file: File) => {
    setError(null);
    setBusy(`Leyendo ${file.name}…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sheets = detectFormat(bytes, file.name) === 'xlsx' ? listXlsxSheets(bytes) : [];
      await parse({ name: file.name, input: bytes, sheets, sheet: null });
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  // Vista previa en vivo con el mapeo actual (los mismos puntos que se van a cargar).
  const preview = useMemo(() => {
    if (!table) return null;
    try {
      const r = buildPressureSet(table, mapping, { id: 'vista-previa', name });
      const q = assessQuality(r.set);
      return { ...r, proposed: q.filter((x) => x.proposeExclude).length, error: null as string | null };
    } catch (err) {
      return { set: null, warnings: [], dropped: 0, proposed: 0, error: errorText(err) };
    }
  }, [table, mapping, name]);

  const patch = (column: number, p: Partial<PressureColumnMapping>) => {
    setMapping((list) => list.map((m) => (m.column === column ? { ...m, ...p } : m)));
    setEdited((s) => new Set(s).add(column));
  };

  const setField = (m: PressureColumnMapping, field: PressureField) => {
    const dim = PRESSURE_FIELD_DIMENSION[field];
    const keep = m.unit && dim && getUnit(m.unit)?.dimension === dim;
    const canonical = dim === 'length' ? 'm' : dim === 'pressure' ? 'psi' : dim === 'mobility' ? 'mD/cP' : null;
    patch(m.column, { field, unit: dim ? (keep ? m.unit : canonical) : null });
  };

  const load = () => {
    if (!table) return;
    const entry = activeWellEntry(useProject.getState().project);
    if (!entry) return;
    try {
      const r = buildPressureSet(table, mapping, { id: makeId('mdt'), name });
      commit(`Cargar presiones ${r.set.name}`, (p) => addPointSet(p, entry.well.id, r.set));
      toast({
        tone: 'ok',
        title: `Presiones cargadas: ${r.set.pointIds.length} pruebas`,
        description: 'Trazá un gradiente por fluido desde el panel Presiones MDT: arrastrá sobre la pista Presión para elegir los puntos.',
      });
      useUi.getState().set({ dockTab: 'mdt' });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const fieldOptions = (m: PressureColumnMapping) =>
    (m.kind === 'numeric' ? [...NUMERIC_FIELDS, ...TEXT_FIELDS] : TEXT_FIELDS).concat('ignore').map((f) => ({ value: f, label: PRESSURE_FIELD_LABEL[f] }));
  const unitOptions = (m: PressureColumnMapping) => {
    const dim = PRESSURE_FIELD_DIMENSION[m.field];
    return dim ? listUnits(dim).map((u) => ({ value: u.id, label: unitLabel(u.id) })) : [];
  };
  const none = <span className="lw-none">—</span>;

  const mappingColumns: Column<PressureColumnMapping>[] = [
    { key: 'name', header: 'Columna', render: (m) => <span className="mono lw-colname">{m.name}</span> },
    { key: 'raw', header: 'Unidad en el archivo', render: (m) => <span className="mono ui-text-muted">{m.rawUnit || '—'}</span> },
    {
      key: 'field',
      header: 'Es',
      title: 'Qué representa la columna',
      render: (m) => <Select size="sm" block aria-label={`Qué es ${m.name}`} value={m.field} options={fieldOptions(m)} onChange={(v) => setField(m, v as PressureField)} />,
    },
    {
      key: 'unit',
      header: 'Unidad',
      title: 'Unidad de los valores; se convierten a m, psi y mD/cP',
      render: (m) =>
        PRESSURE_FIELD_DIMENSION[m.field] ? (
          <Select size="sm" block aria-label={`Unidad de ${m.name}`} value={m.unit ?? ''} options={unitOptions(m)} onChange={(v) => patch(m.column, { unit: v || null })} />
        ) : (
          none
        ),
    },
    {
      key: 'conf',
      header: 'Confianza',
      title: 'Qué tan seguro está el reconocimiento automático (por nombre y unidad). «manual»: la cambiaste vos.',
      render: (m) => (edited.has(m.column) ? <Badge tone="accent">manual</Badge> : m.confidence === 'none' ? none : <Badge tone={CONFIDENCE_TONE[m.confidence]}>{CONFIDENCE_LABEL[m.confidence]}</Badge>),
    },
  ];

  const set = preview?.set ?? null;
  const pressure = set ? (set.columns['pressure']?.values as Float64Array | undefined) : undefined;
  const mobility = set ? (set.columns['mobility']?.values as Float64Array | undefined) : undefined;
  const quality = set ? (set.columns['quality']?.values as readonly string[] | undefined) : undefined;
  const previewRows = set ? Array.from({ length: Math.min(PREVIEW_ROWS, set.pointIds.length) }, (_, i) => i) : [];
  const previewColumns: Column<number>[] = [
    { key: 'id', header: 'Prueba', render: (i) => <span className="mono">{set!.pointIds[i]}</span> },
    { key: 'md', header: 'MD (m)', align: 'num', render: (i) => formatNumber(set!.depth[i]!, { digits: 2 }) },
    { key: 'p', header: 'Presión (psi)', align: 'num', render: (i) => formatNumber(pressure?.[i], { digits: 1 }) },
    { key: 'mob', header: 'Movilidad (mD/cP)', align: 'num', render: (i) => formatNumber(mobility?.[i], { significant: 3 }) },
    { key: 'q', header: 'Calidad', render: (i) => quality?.[i] || '—' },
  ];

  const footer =
    step === 'columns' ? (
      <>
        <Button icon="chevron-left" onClick={() => setStep('source')} disabled={!!busy}>
          Elegir otro archivo
        </Button>
        <span className="shell-spacer" />
        <Button variant="primary" icon="check" onClick={load} disabled={!!busy || !set}>
          {set ? `Cargar ${set.pointIds.length} pruebas` : 'Cargar'}
        </Button>
      </>
    ) : (
      <>
        <span className="shell-spacer" />
        <Button onClick={onClose} disabled={!!busy}>
          Cancelar
        </Button>
      </>
    );

  return (
    <Dialog open onClose={onClose} dismissible={!busy} size="xl" title="Cargar presiones de formación" footer={footer} headerExtra={<WizardSteps steps={STEPS} current={step} aria-label="Pasos del asistente" />}>
      {busy && (
        <div className="lw-busy" role="status">
          <Spinner size={14} /> {busy}
        </div>
      )}
      {error && (
        <Callout tone="error" title={step === 'source' ? 'No se pudo leer el archivo' : 'No se pudieron cargar las presiones'}>
          {error}
        </Callout>
      )}

      {step === 'source' && (
        <>
          <FileDrop
            accept={ACCEPT}
            inputTestId="pressure-file-input"
            disabled={!!busy}
            onFile={(f) => void openFile(f)}
            title="Arrastrá la tabla de presiones acá o hacé clic para elegirla"
            description="Excel (.xlsx), CSV o LAS: una fila por prueba con profundidad, presión de formación y, si las hay, movilidad, presión del lodo antes y después, calidad y comentario. Las columnas se reconocen por su nombre; en el paso siguiente podés corregirlas."
          />
          {(onTp || onExample) && (
            <div className="lw-or" aria-hidden="true">
              <span>o</span>
            </div>
          )}
          {onTp && (
            <div className="lw-tp">
              <div className="lw-tp__text">
                <div className="lw-tp__title">Presiones del TP · hoja MDT</div>
                <div className="ui-text-muted">Las 58 pruebas MDT reales del pozo del TP (zonas B, C y D), con su profundidad en metros tal cual la hoja. Vienen incluidas en la app: no hace falta el Excel.</div>
              </div>
              <Button
                icon="table"
                onClick={() => {
                  onTp();
                  onClose();
                }}
                disabled={!!busy}
              >
                Cargar presiones del TP
              </Button>
            </div>
          )}
          {onExample && (
            <>
              <div className="lw-tp">
                <div className="lw-tp__text">
                  <div className="lw-tp__title">Presiones de ejemplo · sintéticas</div>
                  <div className="ui-text-muted">21 pruebas MDT inventadas para practicar sobre el pozo del TP (gas, petróleo y agua, con tres pruebas malas). No son mediciones del pozo.</div>
                </div>
                <Button
                  icon="play"
                  onClick={() => {
                    onExample();
                    onClose();
                  }}
                  disabled={!!busy}
                >
                  Usar presiones de ejemplo
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {step === 'columns' && table && source && (
        <>
          <div className="lw-form">
            <Field label="Nombre del conjunto" htmlFor={nameId}>
              <TextField id={nameId} value={name} onChange={setName} className="lw-name" />
            </Field>
            {source.sheets.length > 1 && (
              <Field label="Hoja" htmlFor={sheetId}>
                <Select id={sheetId} value={table.sheet ?? ''} onChange={(v) => void parse({ ...source, sheet: v })} disabled={!!busy} options={source.sheets.map((s) => ({ value: s, label: s }))} />
              </Field>
            )}
            <p className="lw-file">
              <span className="mono">{source.name}</span>
              <Badge>{table.format.toUpperCase()}</Badge>
              <span className="num">{table.rowCount.toLocaleString('es-AR')} filas</span>·<span className="num">{table.columns.length} columnas</span>
            </p>
          </div>

          <Section title="Columnas" className="lw-section">
            <DataTable dense className="lw-mapping" data-testid="pressure-mapping" caption="Qué es cada columna" maxHeight={260} rows={mapping} rowKey={(m) => String(m.column)} rowProps={(m) => ({ 'data-ignored': m.field === 'ignore' ? '' : undefined })} columns={mappingColumns} />
          </Section>

          {preview?.error ? (
            <Callout tone="warn" title="Todavía no se puede cargar">
              {preview.error}
            </Callout>
          ) : (
            set && (
              <Section
                title="Pruebas"
                meta={`${set.pointIds.length} pruebas · ${preview!.proposed} propuestas para descartar (se pueden volver a incluir)`}
                className="lw-section"
              >
                {preview!.warnings.length > 0 && (
                  <Callout tone="info" title="Avisos de la lectura">
                    <ul>
                      {preview!.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </Callout>
                )}
                <DataTable dense data-testid="pressure-preview" caption="Primeras pruebas, ordenadas por profundidad" rows={previewRows} rowKey={(i) => String(i)} columns={previewColumns} />
              </Section>
            )
          )}
        </>
      )}
    </Dialog>
  );
}
