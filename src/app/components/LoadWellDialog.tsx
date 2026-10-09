/**
 * Asistente de carga de pozo: archivo → columnas → control de calidad → pozo cargado.
 * La lectura y el QC son puros (src/io); acá solo se arma el flujo y se aplica `addWell` vía `commit`.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { addWell, setActiveWell, setStepMark } from '../../core/state/project';
import { getUnit, listUnits, unitLabel, type UnitId } from '../../core/units';
import type { Well } from '../../core/well';
import {
  buildWell,
  detectFormat,
  listXlsxSheets,
  parseTable,
  resolveUnit,
  suggestMapping,
  type BuildResult,
  type ColumnKind,
  type ColumnMapping,
  type Confidence,
  type FileInput,
  type QcReport,
  type RawTable,
} from '../../io';
import { registry } from '../../modules';
import { Badge, Button, Callout, DataTable, Dialog, Field, FileDrop, Section, Select, Spinner, TextField, Tooltip, WizardSteps, type Column, type SelectOption, type Tone } from '../../ui';
import { useProject } from '../store/project';
import { computeQc, setWellQc } from '../store/qc';
import { BoreholeSummary, QcCounts, QcCurveTable } from './Qc';
import './load-well.css';

type Step = 'source' | 'columns' | 'qc';

interface Source {
  name: string;
  input: FileInput;
  sheets: string[];
  sheet: string | null;
}

const ACCEPT = '.xlsx,.xlsm,.las,.csv,.tsv,.txt';
const PREVIEW_ROWS = 6;
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'source', label: 'Archivo' },
  { id: 'columns', label: 'Columnas' },
  { id: 'qc', label: 'Control de calidad' },
];
const KIND_LABEL: Record<ColumnKind, string> = { depth: 'Profundidad', curve: 'Curva', zone: 'Zona', ignore: 'Ignorar' };
const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'alta', medium: 'media', low: 'baja', none: '—' };
const CONFIDENCE_TONE: Record<Confidence, Tone> = { high: 'ok', medium: 'warn', low: 'error', none: 'neutral' };
const CONFIDENCE_HINT =
  'Qué tan seguro está el reconocimiento automático de la columna (por su nombre y unidad). «manual»: la cambiaste vos.';

/** Deja que el navegador pinte el estado "leyendo…" antes de un cálculo sincrónico. */
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function previewCell(table: RawTable, col: number, row: number): string {
  const c = table.columns[col]!;
  if (c.kind === 'text') return c.text?.[row] ?? '';
  const v = c.numbers?.[row];
  return v === undefined || Number.isNaN(v) ? '—' : v.toLocaleString('es-AR', { maximumFractionDigits: 4 });
}

/** Id y nombre que no choquen con los pozos ya cargados. */
function uniqueWell(well: Well, taken: readonly Well[]): Well {
  const ids = new Set(taken.map((w) => w.id));
  if (!ids.has(well.id)) return well;
  let k = 2;
  while (ids.has(`${well.id}-${k}`)) k++;
  return { ...well, id: `${well.id}-${k}`, name: `${well.name} (${k})` };
}

export function LoadWellDialog({ onClose, initialSource }: { onClose: () => void; initialSource?: 'tp' }) {
  const commit = useProject((s) => s.commit);
  const [step, setStep] = useState<Step>('source');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [table, setTable] = useState<RawTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [edited, setEdited] = useState<ReadonlySet<number>>(new Set());
  const [wellName, setWellName] = useState('');
  const [built, setBuilt] = useState<{ result: BuildResult; well: Well; report: QcReport } | null>(null);
  const nameId = useId();
  const sheetId = useId();
  const roles = useMemo(() => registry.roles.all(), []);

  const parse = async (src: Source) => {
    setError(null);
    setBusy(`Leyendo ${src.name}…`);
    await nextPaint();
    try {
      const t = parseTable(src.input, src.name, src.sheet !== null ? { sheet: src.sheet } : {});
      setSource(src);
      setTable(t);
      setMapping(suggestMapping(t));
      setEdited(new Set());
      setWellName((n) => (src.sheet !== null && n ? n : String(t.header['WELL']?.value ?? '').trim() || src.name.replace(/\.[^.]+$/, '')));
      setBuilt(null);
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
      // xlsx: se lee la primera hoja con datos; si hay varias, el paso Columnas deja elegir otra.
      const sheets = detectFormat(bytes, file.name) === 'xlsx' ? listXlsxSheets(bytes) : [];
      await parse({ name: file.name, input: bytes, sheets, sheet: null });
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  const openTpData = async () => {
    setError(null);
    setBusy('Leyendo los datos del TP…');
    try {
      const { default: text } = await import('../../../datos/pozo_tp_perfiles.csv?raw');
      await parse({ name: 'pozo_tp_perfiles.csv', input: text, sheets: [], sheet: null });
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  // "Usar datos del TP" desde fuera del asistente: arranca leyendo el CSV incluido.
  const started = useRef(false);
  useEffect(() => {
    if (initialSource !== 'tp' || started.current) return;
    started.current = true;
    void openTpData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSource]);

  const patch = (column: number, p: Partial<ColumnMapping>) => {
    setMapping((list) => list.map((m) => (m.column === column ? { ...m, ...p } : m)));
    setEdited((s) => new Set(s).add(column));
  };

  const setRole = (m: ColumnMapping, role: string | null) => {
    const unit = role === null ? m.unit : (resolveUnit(m.rawUnit, role) ?? registry.roles.unitOf(role));
    patch(m.column, { role, unit });
  };

  const toQc = async () => {
    if (!table) return;
    setError(null);
    setBusy('Construyendo el pozo y controlando la calidad…');
    await nextPaint();
    try {
      const name = wellName.trim();
      const result = buildWell(table, mapping, name ? { wellName: name } : {});
      const well = uniqueWell(
        result.well,
        useProject.getState().project.wells.map((w) => w.well),
      );
      setBuilt({ result, well, report: computeQc(well) });
      setStep('qc');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const load = () => {
    if (!built) return;
    const { well, result, report } = built;
    setWellQc(well, report);
    // El último paso del asistente es el control de calidad: el paso "Revisar calidad" queda revisado.
    commit('Cargar pozo', (p) => setStepMark(setActiveWell(addWell(p, well, result.zones), well.id), well.id, 'qc', 'done'));
    onClose();
  };

  const unitOptions = (m: ColumnMapping): UnitId[] => {
    const ref = m.kind === 'depth' ? 'm' : m.role !== null ? registry.roles.unitOf(m.role) : m.unit;
    const dim = ref ? getUnit(ref)?.dimension : undefined;
    const ids = dim ? listUnits(dim).map((u) => u.id) : [];
    if (m.unit && !ids.includes(m.unit)) ids.unshift(m.unit);
    return ids;
  };

  const kindOptions = (m: ColumnMapping): SelectOption[] =>
    (Object.keys(KIND_LABEL) as ColumnKind[])
      .filter((k) => table?.columns[m.column]!.kind === 'numeric' || k === 'zone' || k === 'ignore')
      .map((k) => ({ value: k, label: KIND_LABEL[k] }));
  const roleOptions: SelectOption[] = roles.map((r) => ({ value: r.id, label: `${r.id} · ${r.label}` }));
  const none = <span className="lw-none">—</span>;

  const mappingColumns: Column<ColumnMapping>[] = [
    {
      key: 'name',
      header: 'Columna',
      render: (m) => {
        const desc = table?.columns[m.column]?.description;
        return (
          <span className="mono lw-colname" title={desc || undefined}>
            {m.name}
          </span>
        );
      },
    },
    { key: 'raw', header: 'Unidad en el archivo', render: (m) => <span className="mono ui-text-muted">{m.rawUnit || '—'}</span> },
    {
      key: 'kind',
      header: 'Tipo',
      render: (m) => <Select size="sm" aria-label={`Tipo de ${m.name}`} value={m.kind} options={kindOptions(m)} onChange={(v) => patch(m.column, { kind: v as ColumnKind })} />,
    },
    {
      key: 'role',
      header: 'Rol',
      title: 'Qué representa la curva: define qué módulos la usan',
      render: (m) =>
        m.kind === 'curve' ? (
          <Select size="sm" block aria-label={`Rol de ${m.name}`} value={m.role ?? ''} placeholder="sin rol" options={roleOptions} onChange={(v) => setRole(m, v || null)} />
        ) : (
          none
        ),
    },
    {
      key: 'unit',
      header: 'Unidad',
      title: 'Unidad de los valores; se convierten a la del rol',
      render: (m) =>
        m.kind === 'curve' || m.kind === 'depth' ? (
          <Select
            size="sm"
            block
            aria-label={`Unidad de ${m.name}`}
            value={m.unit ?? ''}
            placeholder={m.kind === 'depth' ? 'm (por defecto)' : 'sin unidad'}
            options={unitOptions(m).map((u) => ({ value: u, label: unitLabel(u) }))}
            onChange={(v) => patch(m.column, { unit: v || null })}
          />
        ) : (
          none
        ),
    },
    {
      key: 'id',
      header: 'Id en el pozo',
      render: (m) =>
        m.kind === 'curve' ? <TextField size="sm" aria-label={`Id de ${m.name}`} value={m.id} onChange={(v) => patch(m.column, { id: v })} className="lw-id" /> : none,
    },
    {
      key: 'conf',
      header: (
        <Tooltip content={CONFIDENCE_HINT} placement="bottom">
          <span className="lw-help-head" tabIndex={0}>
            Confianza
          </span>
        </Tooltip>
      ),
      render: (m) =>
        edited.has(m.column) ? (
          <Badge tone="accent">manual</Badge>
        ) : m.confidence === 'none' ? (
          none
        ) : (
          <Badge tone={CONFIDENCE_TONE[m.confidence]}>{CONFIDENCE_LABEL[m.confidence]}</Badge>
        ),
    },
  ];

  const previewColumns: Column<number>[] = (table?.columns ?? []).map((c, i) => ({
    key: String(i),
    header: <span className="mono">{c.name}</span>,
    align: c.kind === 'numeric' ? 'num' : 'left',
    render: (r) => (table ? previewCell(table, i, r) : ''),
  }));

  const footer =
    step === 'columns' ? (
      <>
        <Button icon="chevron-left" onClick={() => setStep('source')} disabled={!!busy}>
          Elegir otro archivo
        </Button>
        <span className="shell-spacer" />
        <Button variant="primary" iconRight="arrow-right" onClick={toQc} disabled={!!busy}>
          Siguiente: control de calidad
        </Button>
      </>
    ) : step === 'qc' ? (
      <>
        <Button icon="chevron-left" onClick={() => setStep('columns')}>
          Atrás
        </Button>
        <span className="shell-spacer" />
        <span className="ui-text-muted">Las observaciones no impiden cargar el pozo.</span>
        <Button variant="primary" icon="check" onClick={load}>
          Cargar
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

  const ignored = mapping.filter((m) => m.kind === 'ignore').length;

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="xl"
      title="Cargar pozo"
      footer={footer}
      headerExtra={<WizardSteps steps={STEPS} current={step} aria-label="Pasos del asistente" />}
    >
      {busy && (
        <div className="lw-busy" role="status">
          <Spinner size={14} /> {busy}
        </div>
      )}
      {error && (
        <Callout tone="error" title={step === 'source' ? 'No se pudo leer el archivo' : 'No se pudo construir el pozo'}>
          {error}
        </Callout>
      )}

      {step === 'source' && (
        <>
          <FileDrop
            accept={ACCEPT}
            inputTestId="well-file-input"
            disabled={!!busy}
            onFile={(f) => void openFile(f)}
            title="Arrastrá un archivo acá o hacé clic para elegirlo"
            description="Excel (.xlsx), LAS 2.0 (.las) o texto delimitado (.csv, .txt). Las columnas se reconocen por su nombre y unidad; en el paso siguiente podés corregirlas."
          />
          <div className="lw-or" aria-hidden="true">
            <span>o</span>
          </div>
          <div className="lw-tp">
            <div className="lw-tp__text">
              <div className="lw-tp__title">Datos del TP</div>
              <div className="ui-text-muted">Perfiles medidos del pozo del TP: 5.810 muestras entre 7.633 y 8.518 m, zonas A–E. Incluidos en la app.</div>
            </div>
            <Button icon="table" onClick={openTpData} disabled={!!busy}>
              Cargar datos del TP
            </Button>
          </div>
        </>
      )}

      {step === 'columns' && table && source && (
        <>
          <div className="lw-form">
            <Field label="Nombre del pozo" htmlFor={nameId}>
              <TextField id={nameId} value={wellName} onChange={setWellName} className="lw-name" />
            </Field>
            {source.sheets.length > 1 && (
              <Field label="Hoja" htmlFor={sheetId}>
                <Select
                  id={sheetId}
                  value={table.sheet ?? ''}
                  onChange={(v) => void parse({ ...source, sheet: v })}
                  disabled={!!busy}
                  options={source.sheets.map((s) => ({ value: s, label: s }))}
                />
              </Field>
            )}
            <p className="lw-file">
              <span className="mono">{source.name}</span>
              <Badge>{table.format.toUpperCase()}</Badge>
              <span className="num">{table.rowCount.toLocaleString('es-AR')} filas</span>·<span className="num">{table.columns.length} columnas</span>
            </p>
          </div>

          <Section title="Mapeo de columnas" meta={ignored > 0 ? `${ignored} ${ignored === 1 ? 'ignorada' : 'ignoradas'}` : undefined} className="lw-section">
            <DataTable
              dense
              className="lw-mapping"
              data-testid="mapping-table"
              caption="Mapeo de columnas"
              maxHeight={300}
              rows={mapping}
              rowKey={(m) => String(m.column)}
              rowProps={(m) => ({ 'data-ignored': m.kind === 'ignore' ? '' : undefined })}
              columns={mappingColumns}
            />
          </Section>

          <Section title="Primeras filas" className="lw-section">
            <DataTable
              dense
              className="lw-preview"
              data-testid="preview-table"
              caption="Primeras filas del archivo"
              rows={Array.from({ length: Math.min(PREVIEW_ROWS, table.rowCount) }, (_, r) => r)}
              rowKey={(r) => String(r)}
              columns={previewColumns}
            />
          </Section>
        </>
      )}

      {step === 'qc' && built && (
        <>
          <div className="lw-summary">
            <div className="lw-summary__well">
              <div className="lw-summary__name">{built.well.name}</div>
              <div className="ui-text-muted num">
                {built.well.depth.values.length.toLocaleString('es-AR')} muestras · {built.well.curves.length} curvas · {built.result.zones.length} zonas
              </div>
            </div>
            <QcCounts report={built.report} />
          </div>
          {built.result.warnings.length > 0 && (
            <Callout tone="warn" title="Avisos de la lectura">
              <ul>
                {built.result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Callout>
          )}
          <Section title="Estado del pozo" className="lw-section">
            <BoreholeSummary report={built.report} />
          </Section>
          <Section title="Curvas" meta={built.report.curves.length} className="lw-section">
            <QcCurveTable report={built.report} />
          </Section>
        </>
      )}
    </Dialog>
  );
}
