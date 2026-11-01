/**
 * Asistente de carga de plugs de corona: archivo → columnas → plugs en el pozo activo. Mismas piezas que el de
 * presiones (`src/modules/mdt/LoadPressuresDialog.tsx`); el mapeo es por CAMPO (profundidad, φ, k, densidad de grano,
 * corona, plug, descripción). La lectura es pura (`src/io/core.ts`); acá solo se arma el flujo y se aplica
 * `addPointSet` por `commit`.
 */
import { useId, useMemo, useState } from 'react';
import { addPointSet } from '../../core/state/pointSets';
import { activeWellEntry, makeId } from '../../core/state/project';
import { getUnit, listUnits, unitLabel } from '../../core/units';
import {
  buildCoreSet,
  CORE_FIELD_DIMENSION,
  CORE_FIELD_LABEL,
  coreFieldUnit,
  detectFormat,
  listXlsxSheets,
  parseTable,
  suggestCoreMapping,
  type Confidence,
  type CoreColumnMapping,
  type CoreField,
  type FileInput,
  type RawTable,
} from '../../io';
import { Badge, Button, Callout, DataTable, Dialog, Field, FileDrop, Section, Select, Spinner, TextField, WizardSteps, formatNumber, toast, type Column, type Tone } from '../../ui';
import { useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import { assessCoreQuality, CORE_DOCK_ID } from './model';

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
const NUMERIC_FIELDS: CoreField[] = ['depth', 'phi', 'k', 'rhog', 'ff'];
const TEXT_FIELDS: CoreField[] = ['run', 'plug', 'description'];
const PREVIEW_ROWS = 8;

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function LoadCoreDialog({ onClose, onExample, onTp }: { onClose: () => void; onExample?: () => void; onTp?: () => void }) {
  const commit = useProject((s) => s.commit);
  const [step, setStep] = useState<Step>('source');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [table, setTable] = useState<RawTable | null>(null);
  const [mapping, setMapping] = useState<CoreColumnMapping[]>([]);
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
      setMapping(suggestCoreMapping(t));
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
      const r = buildCoreSet(table, mapping, { id: 'vista-previa', name });
      const q = assessCoreQuality(r.set);
      return { ...r, proposed: q.filter((x) => x.proposeExclude).length, error: null as string | null };
    } catch (err) {
      return { set: null, warnings: [], dropped: 0, proposed: 0, error: errorText(err) };
    }
  }, [table, mapping, name]);

  const patch = (column: number, p: Partial<CoreColumnMapping>) => {
    setMapping((list) => list.map((m) => (m.column === column ? { ...m, ...p } : m)));
    setEdited((s) => new Set(s).add(column));
  };

  const setField = (m: CoreColumnMapping, field: CoreField) => {
    const dim = CORE_FIELD_DIMENSION[field];
    const keep = m.unit && dim && getUnit(m.unit)?.dimension === dim;
    patch(m.column, { field, unit: dim ? (keep ? m.unit : table ? coreFieldUnit(field, table, m.column) : null) : null });
  };

  const load = () => {
    if (!table) return;
    const entry = activeWellEntry(useProject.getState().project);
    if (!entry) return;
    try {
      const r = buildCoreSet(table, mapping, { id: makeId('corona'), name });
      commit(`Cargar plugs ${r.set.name}`, (p) => addPointSet(p, entry.well.id, r.set));
      toast({
        tone: 'ok',
        title: `Plugs cargados: ${r.set.pointIds.length}`,
        description: 'Ponelos en profundidad desde el panel Corona (sugerido por correlación o arrastrándolos en el visor) y ajustá el modelo k–φ.',
      });
      useUi.getState().set({ dockTab: CORE_DOCK_ID });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const fieldOptions = (m: CoreColumnMapping) =>
    (m.kind === 'numeric' ? [...NUMERIC_FIELDS, ...TEXT_FIELDS] : TEXT_FIELDS).concat('ignore').map((f) => ({ value: f, label: CORE_FIELD_LABEL[f] }));
  const unitOptions = (m: CoreColumnMapping) => {
    const dim = CORE_FIELD_DIMENSION[m.field];
    return dim ? listUnits(dim).map((u) => ({ value: u.id, label: unitLabel(u.id) })) : [];
  };
  const none = <span className="lw-none">—</span>;

  const mappingColumns: Column<CoreColumnMapping>[] = [
    { key: 'name', header: 'Columna', render: (m) => <span className="mono lw-colname">{m.name}</span> },
    { key: 'raw', header: 'Unidad en el archivo', render: (m) => <span className="mono ui-text-muted">{m.rawUnit || '—'}</span> },
    {
      key: 'field',
      header: 'Es',
      title: 'Qué representa la columna',
      render: (m) => <Select size="sm" block aria-label={`Qué es ${m.name}`} value={m.field} options={fieldOptions(m)} onChange={(v) => setField(m, v as CoreField)} />,
    },
    {
      key: 'unit',
      header: 'Unidad',
      title: 'Unidad de los valores; se convierten a m, v/v, mD y g/cm³',
      render: (m) =>
        CORE_FIELD_DIMENSION[m.field] ? (
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
  const num = (key: string) => (set ? (set.columns[key]?.values as Float64Array | undefined) : undefined);
  const phi = num('phi');
  const perm = num('k');
  const rhog = num('rhog');
  const ff = num('ff');
  const runs = set ? (set.columns['run']?.values as readonly string[] | undefined) : undefined;
  const previewRows = set ? Array.from({ length: Math.min(PREVIEW_ROWS, set.pointIds.length) }, (_, i) => i) : [];
  const previewColumns: Column<number>[] = [
    { key: 'id', header: 'Plug', render: (i) => <span className="mono">{set!.pointIds[i]}</span> },
    { key: 'run', header: 'Corona', render: (i) => runs?.[i] || '—' },
    { key: 'md', header: 'Prof. (m)', align: 'num', render: (i) => formatNumber(set!.depth[i]!, { digits: 2 }) },
    { key: 'phi', header: 'φ (v/v)', align: 'num', render: (i) => formatNumber(phi?.[i], { digits: 3 }) },
    { key: 'k', header: 'k (mD)', align: 'num', render: (i) => formatNumber(perm?.[i], { significant: 3 }) },
    { key: 'rhog', header: 'ρg (g/cm³)', align: 'num', render: (i) => formatNumber(rhog?.[i], { digits: 2 }) },
    ...(ff ? [{ key: 'ff', header: 'F', title: 'Factor de formación', align: 'num' as const, render: (i: number) => formatNumber(ff[i], { significant: 3 }) }] : []),
  ];

  const footer =
    step === 'columns' ? (
      <>
        <Button icon="chevron-left" onClick={() => setStep('source')} disabled={!!busy}>
          Elegir otro archivo
        </Button>
        <span className="shell-spacer" />
        <Button variant="primary" icon="check" onClick={load} disabled={!!busy || !set}>
          {set ? `Cargar ${set.pointIds.length} plugs` : 'Cargar'}
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
    <Dialog open onClose={onClose} dismissible={!busy} size="xl" title="Cargar plugs de corona" footer={footer} headerExtra={<WizardSteps steps={STEPS} current={step} aria-label="Pasos del asistente" />}>
      {busy && (
        <div className="lw-busy" role="status">
          <Spinner size={14} /> {busy}
        </div>
      )}
      {error && (
        <Callout tone="error" title={step === 'source' ? 'No se pudo leer el archivo' : 'No se pudieron cargar los plugs'}>
          {error}
        </Callout>
      )}

      {step === 'source' && (
        <>
          <FileDrop
            accept={ACCEPT}
            inputTestId="core-file-input"
            disabled={!!busy}
            onFile={(f) => void openFile(f)}
            title="Arrastrá la tabla de plugs acá o hacé clic para elegirla"
            description="Excel (.xlsx), CSV o LAS: una fila por plug con profundidad, porosidad (% o v/v), permeabilidad (mD) y, si las hay, densidad de grano, número de corona, id del plug y descripción. Las columnas se reconocen por su nombre; en el paso siguiente podés corregirlas."
          />
          {(onTp || onExample) && (
            <div className="lw-or" aria-hidden="true">
              <span>o</span>
            </div>
          )}
          {onTp && (
            <div className="lw-tp">
              <div className="lw-tp__text">
                <div className="lw-tp__title">Corona del TP · datos de laboratorio</div>
                <div className="ui-text-muted">Los 151 plugs reales de las dos coronas del pozo del TP (φ, k, densidad de grano y factor de formación en 12), ya puestos en profundidad del perfil. Vienen incluidos en la app: no hace falta el Excel.</div>
              </div>
              <Button
                icon="table"
                onClick={() => {
                  onTp();
                  onClose();
                }}
                disabled={!!busy}
              >
                Cargar corona del TP
              </Button>
            </div>
          )}
          {onExample && (
            <>
              <div className="lw-tp">
                <div className="lw-tp__text">
                  <div className="lw-tp__title">Plugs de ejemplo · sintéticos</div>
                  <div className="ui-text-muted">Dos coronas inventadas para practicar sobre el pozo del TP, desplazadas en profundidad respecto del perfil, con dos plugs malos. No son mediciones del pozo.</div>
                </div>
                <Button
                  icon="play"
                  onClick={() => {
                    onExample();
                    onClose();
                  }}
                  disabled={!!busy}
                >
                  Usar plugs de ejemplo
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
            <DataTable dense className="lw-mapping" data-testid="core-mapping" caption="Qué es cada columna" maxHeight={260} rows={mapping} rowKey={(m) => String(m.column)} rowProps={(m) => ({ 'data-ignored': m.field === 'ignore' ? '' : undefined })} columns={mappingColumns} />
          </Section>

          {preview?.error ? (
            <Callout tone="warn" title="Todavía no se puede cargar">
              {preview.error}
            </Callout>
          ) : (
            set && (
              <Section
                title="Plugs"
                meta={`${set.pointIds.length} plugs · ${preview!.proposed} propuestos para descartar (se pueden volver a incluir)`}
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
                <DataTable dense data-testid="core-preview" caption="Primeros plugs, ordenados por profundidad" rows={previewRows} rowKey={(i) => String(i)} columns={previewColumns} />
              </Section>
            )
          )}
        </>
      )}
    </Dialog>
  );
}
