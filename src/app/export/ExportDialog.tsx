import { entryContext } from '../preparation/data';
/**
 * Diálogo «Exportar»: datos del pozo, figuras e informe automático imprimible.
 */
import { useMemo, useState } from 'react';
import { Button, Callout, Checkbox, Dialog, Field, SegmentedControl, Select } from '../../ui';
import { FORMAT_LABEL, type DepthUnit, type ExportFormat } from '../../io/export';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { downloadFile, exportData, exportSources, EXPORT_KINDS, type ExportKind } from './exportActions';
import { ReportPanel, useReportForm } from '../report/ReportPanel';
import { exportFigure } from './figureActions';
import { FiguresPanel, useFigureForm } from './FiguresPanel';
import './export.css';

const NULL_OPTIONS = [
  { value: 'default', label: 'Vacío (en LAS, −999,25)' },
  { value: '-999.25', label: '−999,25' },
  { value: '-9999', label: '−9999' },
];

const FORMAT_HINT: Record<ExportFormat, string> = {
  las: 'Estándar de la industria, se abre en cualquier programa de perfiles.',
  csv: 'Texto con comas y punto decimal; el sumario va en un segundo archivo dentro de un .zip.',
  xlsx: 'Libro con las hojas Curvas, Zonas, Sumario y Encabezado.',
};

export function ExportDialog() {
  const open = useUi((s) => s.exportOpen);
  const setUi = useUi((s) => s.set);
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  const [format, setFormat] = useState<ExportFormat>('las');
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [alternatives, setAlternatives] = useState(false);
  const [zoneId, setZoneId] = useState('');
  const [depthUnit, setDepthUnit] = useState<DepthUnit>('m');
  const [nulls, setNulls] = useState('default');
  const [summary, setSummary] = useState(true);
  const [kind, setKind] = useState<ExportKind>('data');
  const [busy, setBusy] = useState(false);
  const figure = useFigureForm(open && kind === 'figure');
  const report = useReportForm(open && kind === 'report');

  const sources = useMemo(() => (open && entry ? exportSources(entry.well, result, alternatives,entryContext(entry)) : null), [open, entry, result, alternatives]);
  if (!open || !entry || !sources) return null;

  const close = () => setUi({ exportOpen: false });
  const prepared = sources.columns.filter((c) => c.origin === 'prepared');
  const measured = sources.columns.filter((c) => c.origin === 'measured');
  const computed = sources.columns.filter((c) => c.origin === 'computed');
  const selected = sources.columns.filter((c) => !off.has(c.id));
  const zones = entry.interpretation.zones;
  const toggle = (ids: readonly string[], on: boolean) =>
    setOff((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const group = (title: string, list: typeof measured, empty: string) => (
    <div className="exp-group">
      <div className="exp-group__head">
        <span className="ui-overline">{title}</span>
        <span className="exp-group__actions">
          <Button size="sm" variant="ghost" disabled={list.length === 0} onClick={() => toggle(list.map((c) => c.id), true)}>
            Todas
          </Button>
          <Button size="sm" variant="ghost" disabled={list.length === 0} onClick={() => toggle(list.map((c) => c.id), false)}>
            Ninguna
          </Button>
        </span>
      </div>
      {list.length === 0 ? (
        <p className="exp-empty">{empty}</p>
      ) : (
        <div className="exp-curves">
          {list.map((c) => (
            <Checkbox key={c.id} checked={!off.has(c.id)} onChange={(on) => toggle([c.id], on)} label={<span className="num">{c.mnemonic}</span>} />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Dialog
      open
      onClose={close}
      size="lg"
      title="Exportar"
      description={kind === 'data' ? 'Curvas medidas y calculadas del pozo activo, y el sumario por zona.' : kind === 'report' ? 'Informe del pozo activo: métodos, parámetros, resultados y figuras para imprimir o guardar como PDF.' : 'Figuras listas para el informe: el perfil y los gráficos, siempre con el tema claro de impresión.'}
      footer={
        <>
          <span className="exp-count num">
            {kind === 'data' ? `${selected.length} ${selected.length === 1 ? 'curva' : 'curvas'}` : kind === 'report' ? report.busy ? 'Generando el informe…' : '' : busy ? 'Generando la figura…' : ''}
          </span>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          {kind === 'report' && report.preview && <Button variant="ghost" onClick={() => report.setPreview(null)}>Editar informe</Button>}
          <Button
            variant="primary"
            icon="download"
            disabled={kind === 'report' ? !report.preview && !report.canGenerate : kind === 'figure' && (busy || !figure.canExport)}
            onClick={async () => {
              if (kind === 'report') {
                if (report.preview) downloadFile({ name: report.preview.name, mime: 'text/html;charset=utf-8', bytes: new TextEncoder().encode(report.preview.html) });
                else await report.generate();
                return;
              }
              if (kind === 'figure') {
                setBusy(true);
                const ok = await exportFigure(figure.options);
                setBusy(false);
                if (ok) close();
                return;
              }
              const ok = exportData({
                format,
                selection: selected.map((c) => c.id),
                zoneId: zoneId || null,
                depthUnit,
                nullValue: nulls === 'default' ? null : Number(nulls),
                includeAlternatives: alternatives,
                includeSummary: summary,
              });
              if (ok) close();
            }}
          >
            {kind === 'report' ? report.preview ? 'Guardar HTML' : 'Generar informe' : 'Exportar'}
          </Button>
        </>
      }
    >
      <div className="exp-kind">
        <SegmentedControl<ExportKind> aria-label="Qué exportar" value={kind} onChange={setKind} options={EXPORT_KINDS.map((k) => ({ value: k.id, label: k.label }))} />
      </div>
      {kind === 'report' ? <ReportPanel form={report} /> : kind === 'figure' ? (
        <FiguresPanel form={figure} />
      ) : (
      <div className="exp">
        <Field label="Formato" hint={FORMAT_HINT[format]}>
          <SegmentedControl<ExportFormat>
            aria-label="Formato de exportación"
            value={format}
            onChange={setFormat}
            options={(['las', 'csv', 'xlsx'] as const).map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
          />
        </Field>

        <div className="exp-row">
          <Field label="Tramo">
            <Select
              aria-label="Tramo a exportar"
              value={zoneId}
              onChange={setZoneId}
              block
              options={[{ value: '', label: 'Todo el pozo' }, ...zones.map((z) => ({ value: z.id, label: `Zona ${z.name} (${Math.round(z.top)}–${Math.round(z.base)} m)` }))]}
            />
          </Field>
          <Field label="Profundidad en">
            <SegmentedControl<DepthUnit> aria-label="Unidad de profundidad" value={depthUnit} onChange={setDepthUnit} options={[{ value: 'm', label: 'Metros' }, { value: 'ft', label: 'Pies' }]} />
          </Field>
          <Field label="Sin dato">
            <Select aria-label="Valor para datos faltantes" value={nulls} onChange={setNulls} block options={NULL_OPTIONS} />
          </Field>
        </div>

        {group('Curvas medidas', measured, 'El pozo no tiene curvas medidas.')}
        {prepared.length > 0 && group('Curvas preparadas', prepared, '')}
        {prepared.some(c => c.id.startsWith('q:')) && <p className="ui-hint">Calidad (QC): 0 = conservada; 1 = faltante original; 2 = excluida; 3 = faltante original y excluida.</p>}
        {group('Curvas calculadas', computed, 'Todavía no hay curvas calculadas: se agregan cuando el motor termina de calcular.')}
        {sources.alternatives > 0 && (
          <Checkbox
            checked={alternatives}
            onChange={setAlternatives}
            label="Incluir también las alternativas"
            description={`${sources.alternatives} ${sources.alternatives === 1 ? 'curva calculada' : 'curvas calculadas'} de módulos que se calculan solo para comparar.`}
          />
        )}

        <Checkbox
          checked={summary && !!sources.summary}
          onChange={setSummary}
          disabled={!sources.summary}
          label="Incluir el sumario por zona"
          description={
            sources.summary
              ? 'Espesores, promedios y h·φ·Sh de todo el pozo, en las unidades del módulo (metros); no depende del tramo.'
              : 'El sumario todavía no se calculó: necesita cutoffs, porosidad efectiva y Sw.'
          }
        />
        {format !== 'xlsx' && summary && !!sources.summary && (
          <Callout tone="info">Se descarga un .zip con el archivo de curvas y el sumario en CSV.</Callout>
        )}
      </div>
      )}
    </Dialog>
  );
}

