/**
 * Asistente de carga de pozo: archivo → columnas → control de calidad → pozo cargado.
 * La lectura y el QC son puros (src/io); acá solo se arma el flujo y se aplica `addWell` vía `commit`.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
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
import { Button, Callout, Dialog, Spinner } from '../../ui';
import { useProject } from '../store/project';
import { computeQc, setWellQc } from '../store/qc';
import { BoreholeSummary, QcCounts, QcCurveTable } from './Qc';

type Step = 'source' | 'columns' | 'qc';

interface Source {
  name: string;
  input: FileInput;
  sheets: string[];
  sheet: string | null;
}

const ACCEPT = '.xlsx,.xlsm,.las,.csv,.tsv,.txt';
const PREVIEW_ROWS = 6;
const STEPS: Array<[Step, string]> = [
  ['source', 'Archivo'],
  ['columns', 'Columnas'],
  ['qc', 'Control de calidad'],
];
const KIND_LABEL: Record<ColumnKind, string> = { depth: 'Profundidad', curve: 'Curva', zone: 'Zona', ignore: 'Ignorar' };
const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'alta', medium: 'media', low: 'baja', none: '—' };

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
  const [over, setOver] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [table, setTable] = useState<RawTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [edited, setEdited] = useState<ReadonlySet<number>>(new Set());
  const [wellName, setWellName] = useState('');
  const [built, setBuilt] = useState<{ result: BuildResult; well: Well; report: QcReport } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void openFile(file);
  };

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

  const stepIndex = STEPS.findIndex(([s]) => s === step);

  const footer =
    step === 'columns' ? (
      <>
        <Button onClick={() => setStep('source')} disabled={!!busy}>
          Elegir otro archivo
        </Button>
        <span className="spacer" />
        <Button variant="primary" iconRight="arrow-right" onClick={toQc} disabled={!!busy}>
          Siguiente: control de calidad
        </Button>
      </>
    ) : step === 'qc' ? (
      <>
        <Button icon="chevron-left" onClick={() => setStep('columns')}>
          Atrás
        </Button>
        <span className="spacer" />
        <span className="muted">Las observaciones no impiden cargar el pozo.</span>
        <Button variant="primary" icon="check" onClick={load}>
          Cargar
        </Button>
      </>
    ) : (
      <>
        <span className="spacer" />
        <Button onClick={onClose} disabled={!!busy}>
          Cancelar
        </Button>
      </>
    );

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="xl"
      title="Cargar pozo"
      footer={footer}
      headerExtra={
        <ol className="steps" aria-label="Pasos">
          {STEPS.map(([s, label], i) => (
            <li key={s} className={i === stepIndex ? 'current' : i < stepIndex ? 'done' : ''} aria-current={i === stepIndex ? 'step' : undefined}>
              <span className="step-n">{i + 1}</span> {label}
            </li>
          ))}
        </ol>
      }
    >
          {busy && (
            <div className="busy" role="status">
              <Spinner size={14} /> {busy}
            </div>
          )}
          {error && <Callout tone="error">{error}</Callout>}

          {step === 'source' && (
            <>
              <div
                className={`dropzone${over ? ' over' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                <div className="dropzone-title">Arrastrá un archivo acá o hacé clic para elegirlo</div>
                <div className="muted">Excel (.xlsx), LAS 2.0 (.las) o texto delimitado (.csv, .txt)</div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                hidden
                data-testid="well-file-input"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  e.currentTarget.value = '';
                  if (f) void openFile(f);
                }}
              />
              <div className="or-row">
                <span className="muted">o</span>
                <Button icon="table" onClick={openTpData} disabled={!!busy}>
                  Cargar datos del TP
                </Button>
                <span className="muted">perfiles medidos del pozo del TP (5810 muestras, zonas A–E), incluidos en la app</span>
              </div>
            </>
          )}

          {step === 'columns' && table && source && (
            <>
              <div className="form-row">
                <label>
                  Nombre del pozo <input type="text" value={wellName} onChange={(e) => setWellName(e.currentTarget.value)} style={{ width: 240 }} />
                </label>
                {source.sheets.length > 1 && (
                  <label>
                    Hoja{' '}
                    <select value={table.sheet ?? ''} onChange={(e) => void parse({ ...source, sheet: e.currentTarget.value })} disabled={!!busy}>
                      {source.sheets.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <span className="muted">
                  {source.name} · {table.format.toUpperCase()} · {table.rowCount.toLocaleString('es-AR')} filas · {table.columns.length} columnas
                </span>
              </div>

              <h3 className="sub">Mapeo de columnas</h3>
              <div className="table-scroll">
                <table className="grid mapping" data-testid="mapping-table">
                  <thead>
                    <tr>
                      <th>Columna</th>
                      <th>Unidad en el archivo</th>
                      <th>Tipo</th>
                      <th>Rol</th>
                      <th>Unidad</th>
                      <th>Id en el pozo</th>
                      <th>Confianza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.map((m) => {
                      const col = table.columns[m.column]!;
                      return (
                        <tr key={m.column} className={m.kind === 'ignore' ? 'ignored' : undefined}>
                          <td className="mono" title={col.description}>
                            {m.name}
                          </td>
                          <td className="muted mono">{m.rawUnit || '—'}</td>
                          <td>
                            <select
                              aria-label={`Tipo de ${m.name}`}
                              value={m.kind}
                              onChange={(e) => patch(m.column, { kind: e.currentTarget.value as ColumnKind })}
                            >
                              {(Object.keys(KIND_LABEL) as ColumnKind[])
                                .filter((k) => col.kind === 'numeric' || k === 'zone' || k === 'ignore')
                                .map((k) => (
                                  <option key={k} value={k}>
                                    {KIND_LABEL[k]}
                                  </option>
                                ))}
                            </select>
                          </td>
                          <td>
                            {m.kind === 'curve' ? (
                              <select aria-label={`Rol de ${m.name}`} value={m.role ?? ''} onChange={(e) => setRole(m, e.currentTarget.value || null)}>
                                <option value="">sin rol</option>
                                {roles.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.id} · {r.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            {m.kind === 'curve' || m.kind === 'depth' ? (
                              <select
                                aria-label={`Unidad de ${m.name}`}
                                value={m.unit ?? ''}
                                onChange={(e) => patch(m.column, { unit: e.currentTarget.value || null })}
                              >
                                <option value="">{m.kind === 'depth' ? 'm (por defecto)' : 'sin unidad'}</option>
                                {unitOptions(m).map((u) => (
                                  <option key={u} value={u}>
                                    {unitLabel(u)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            {m.kind === 'curve' ? (
                              <input
                                type="text"
                                aria-label={`Id de ${m.name}`}
                                value={m.id}
                                onChange={(e) => patch(m.column, { id: e.currentTarget.value })}
                                style={{ width: 110 }}
                              />
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            {edited.has(m.column) ? (
                              <span className="conf manual">manual</span>
                            ) : (
                              <span className={`conf ${m.confidence}`}>{CONFIDENCE_LABEL[m.confidence]}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <h3 className="sub">Primeras filas</h3>
              <div className="table-scroll">
                <table className="grid preview" data-testid="preview-table">
                  <thead>
                    <tr>
                      {table.columns.map((c, i) => (
                        <th key={i} className={c.kind === 'numeric' ? 'num mono' : 'mono'}>
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.min(PREVIEW_ROWS, table.rowCount) }, (_, r) => (
                      <tr key={r}>
                        {table.columns.map((c, i) => (
                          <td key={i} className={c.kind === 'numeric' ? 'num' : undefined}>
                            {previewCell(table, i, r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {step === 'qc' && built && (
            <>
              <div className="form-row">
                <strong>{built.well.name}</strong>
                <span className="muted">
                  {built.well.depth.values.length.toLocaleString('es-AR')} muestras · {built.well.curves.length} curvas · {built.result.zones.length} zonas
                </span>
                <span className="spacer" />
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
              <h3 className="sub">Estado del pozo</h3>
              <BoreholeSummary report={built.report} />
              <h3 className="sub">Curvas</h3>
              <div className="table-scroll tall">
                <QcCurveTable report={built.report} />
              </div>
            </>
          )}
    </Dialog>
  );
}
