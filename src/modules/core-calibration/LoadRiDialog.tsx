/**
 * Asistente de carga del ensayo de índice de resistividad (RI–Sw) de corona: archivo → columnas → conjunto `core-ri`
 * en el pozo activo (docs/decisiones/0053). Mismas piezas que el de plugs (`../core/LoadCoreDialog.tsx`); la lectura
 * es pura (`src/io/coreRi.ts`) y acá solo se arma el flujo y se aplica `addPointSet` por `commit`.
 */
import { useId, useMemo, useState } from 'react';
import { addPointSet } from '../../core/state/pointSets';
import { activeWellEntry, makeId } from '../../core/state/project';
import { getUnit, listUnits, unitLabel } from '../../core/units';
import {
  buildRiSet,
  detectFormat,
  listXlsxSheets,
  parseTable,
  RI_FIELD_DIMENSION,
  RI_FIELD_LABEL,
  riFieldUnit,
  suggestRiMapping,
  type Confidence,
  type FileInput,
  type RawTable,
  type RiColumnMapping,
  type RiField,
} from '../../io';
import { Badge, Button, Callout, DataTable, Dialog, Field, FileDrop, Section, Select, Spinner, TextField, WizardSteps, formatNumber, toast, type Column, type Tone } from '../../ui';
import { useProject } from '../../app/store/project';
import { pointNumbers } from '../../core/pointSets';
import { RI_COL, riPlugGroups, riPlugOf } from './saturation';
import '../../app/components/load-well.css';

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
const NUMERIC_FIELDS: RiField[] = ['sw', 'ri', 'rt', 'ro', 'depth', 'nlab'];
const TEXT_FIELDS: RiField[] = ['plug'];
const PREVIEW_ROWS = 8;

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function LoadRiDialog({ onClose, onExample }: { onClose: () => void; onExample?: () => void }) {
  const commit = useProject((s) => s.commit);
  const [step, setStep] = useState<Step>('source');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [table, setTable] = useState<RawTable | null>(null);
  const [mapping, setMapping] = useState<RiColumnMapping[]>([]);
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
      setMapping(suggestRiMapping(t));
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

  const preview = useMemo(() => {
    if (!table) return null;
    try {
      return { ...buildRiSet(table, mapping, { id: 'vista-previa', name }), error: null as string | null };
    } catch (err) {
      return { set: null, warnings: [], dropped: 0, error: errorText(err) };
    }
  }, [table, mapping, name]);

  const patch = (column: number, p: Partial<RiColumnMapping>) => {
    setMapping((list) => list.map((m) => (m.column === column ? { ...m, ...p } : m)));
    setEdited((s) => new Set(s).add(column));
  };

  const setField = (m: RiColumnMapping, field: RiField) => {
    const dim = RI_FIELD_DIMENSION[field];
    const keep = m.unit && dim && getUnit(m.unit)?.dimension === dim;
    patch(m.column, { field, unit: dim ? (keep ? m.unit : table ? riFieldUnit(field, table, m.column) : null) : null });
  };

  const load = () => {
    if (!table) return;
    const entry = activeWellEntry(useProject.getState().project);
    if (!entry) return;
    try {
      const r = buildRiSet(table, mapping, { id: makeId('ri'), name });
      commit(`Cargar índice de resistividad ${r.set.name}`, (p) => addPointSet(p, entry.well.id, r.set));
      const plugs = riPlugGroups(r.set).length;
      toast({
        tone: 'ok',
        title: `Índice de resistividad cargado: ${plugs} ${plugs === 1 ? 'plug' : 'plugs'}`,
        description: 'El exponente de saturación n se ajusta en la sección «Exponente de saturación n» del panel Calibración.',
      });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const fieldOptions = (m: RiColumnMapping) =>
    (m.kind === 'numeric' ? [...NUMERIC_FIELDS, ...TEXT_FIELDS] : TEXT_FIELDS).concat('ignore').map((f) => ({ value: f, label: RI_FIELD_LABEL[f] }));
  const unitOptions = (m: RiColumnMapping) => {
    const dim = RI_FIELD_DIMENSION[m.field];
    return dim ? listUnits(dim).map((u) => ({ value: u.id, label: unitLabel(u.id) })) : [];
  };
  const none = <span className="lw-none">—</span>;

  const mappingColumns: Column<RiColumnMapping>[] = [
    { key: 'name', header: 'Columna', render: (m) => <span className="mono lw-colname">{m.name}</span> },
    { key: 'raw', header: 'Unidad en el archivo', render: (m) => <span className="mono ui-text-muted">{m.rawUnit || '—'}</span> },
    {
      key: 'field',
      header: 'Es',
      title: 'Qué representa la columna',
      render: (m) => <Select size="sm" block aria-label={`Qué es ${m.name}`} value={m.field} options={fieldOptions(m)} onChange={(v) => setField(m, v as RiField)} />,
    },
    {
      key: 'unit',
      header: 'Unidad',
      title: 'Unidad de los valores; Sw se convierte a fracción (v/v)',
      render: (m) =>
        RI_FIELD_DIMENSION[m.field] ? (
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
  const sw = set ? pointNumbers(set, RI_COL.sw) : null;
  const ri = set ? pointNumbers(set, RI_COL.ri) : null;
  const md = set ? pointNumbers(set, RI_COL.md) : null;
  const nLab = set ? pointNumbers(set, RI_COL.nLab) : null;
  const plugs = set ? riPlugOf(set) : [];
  const plugCount = set ? riPlugGroups(set).length : 0;
  const previewRows = set ? Array.from({ length: Math.min(PREVIEW_ROWS, set.pointIds.length) }, (_, i) => i) : [];
  const previewColumns: Column<number>[] = [
    { key: 'plug', header: 'Plug', render: (i) => <span className="mono">{plugs[i]}</span> },
    ...(md ? [{ key: 'md', header: 'Prof. (m)', align: 'num' as const, render: (i: number) => formatNumber(md[i], { digits: 2 }) }] : []),
    { key: 'sw', header: 'Sw (v/v)', align: 'num', render: (i) => formatNumber(sw?.[i], { digits: 3 }) },
    { key: 'ri', header: 'RI', title: 'Índice de resistividad Rt/Ro', align: 'num', render: (i) => formatNumber(ri?.[i], { significant: 4 }) },
    ...(nLab ? [{ key: 'nlab', header: 'n lab', title: 'n informado por el laboratorio (valor absoluto)', align: 'num' as const, render: (i: number) => formatNumber(nLab[i], { digits: 2 }) }] : []),
  ];

  const footer =
    step === 'columns' ? (
      <>
        <Button icon="chevron-left" onClick={() => setStep('source')} disabled={!!busy}>
          Elegir otro archivo
        </Button>
        <span className="shell-spacer" />
        <Button variant="primary" icon="check" onClick={load} disabled={!!busy || !set}>
          {set ? `Cargar ${set.pointIds.length} pasos de ${plugCount} ${plugCount === 1 ? 'plug' : 'plugs'}` : 'Cargar'}
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
    <Dialog open onClose={onClose} dismissible={!busy} size="xl" title="Cargar índice de resistividad de corona" footer={footer} headerExtra={<WizardSteps steps={STEPS} current={step} aria-label="Pasos del asistente" />}>
      {busy && (
        <div className="lw-busy" role="status">
          <Spinner size={14} /> {busy}
        </div>
      )}
      {error && (
        <Callout tone="error" title={step === 'source' ? 'No se pudo leer el archivo' : 'No se pudo cargar el ensayo'}>
          {error}
        </Callout>
      )}

      {step === 'source' && (
        <>
          <FileDrop
            accept={ACCEPT}
            inputTestId="ri-file-input"
            disabled={!!busy}
            onFile={(f) => void openFile(f)}
            title="Arrastrá la tabla del ensayo acá o hacé clic para elegirla"
            description="Excel (.xlsx), CSV o LAS: una fila por paso de desaturación con la saturación de agua (fracción o %) y el índice de resistividad (o Rt y Ro), y si los hay el id del plug y su profundidad. Las columnas se reconocen por su nombre; en el paso siguiente podés corregirlas."
          />
          {onExample && (
            <>
              <div className="lw-or" aria-hidden="true">
                <span>o</span>
              </div>
              <div className="lw-tp">
                <div className="lw-tp__text">
                  <div className="lw-tp__title">Índice de resistividad de ejemplo · sintético</div>
                  <div className="ui-text-muted">Cuatro plugs inventados, con los ids de los plugs de ejemplo, desaturados en nueve pasos. No son mediciones del pozo.</div>
                </div>
                <Button
                  icon="play"
                  onClick={() => {
                    onExample();
                    onClose();
                  }}
                  disabled={!!busy}
                >
                  Usar ensayo de ejemplo
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
            <DataTable dense className="lw-mapping" data-testid="ri-mapping" caption="Qué es cada columna" maxHeight={260} rows={mapping} rowKey={(m) => String(m.column)} rowProps={(m) => ({ 'data-ignored': m.field === 'ignore' ? '' : undefined })} columns={mappingColumns} />
          </Section>

          {preview?.error ? (
            <Callout tone="warn" title="Todavía no se puede cargar">
              {preview.error}
            </Callout>
          ) : (
            set && (
              <Section title="Pasos de desaturación" meta={`${set.pointIds.length} pasos · ${plugCount} ${plugCount === 1 ? 'plug' : 'plugs'}`} className="lw-section">
                {preview!.warnings.length > 0 && (
                  <Callout tone="info" title="Avisos de la lectura">
                    <ul>
                      {preview!.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </Callout>
                )}
                <DataTable dense data-testid="ri-preview" caption="Primeros pasos" rows={previewRows} rowKey={(i) => String(i)} columns={previewColumns} />
              </Section>
            )
          )}
        </>
      )}
    </Dialog>
  );
}
