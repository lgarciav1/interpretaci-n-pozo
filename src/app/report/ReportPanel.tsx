import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Callout, Checkbox, Field, Select, TextField, toast } from '../../ui';
import manualHtml from '../../../docs/manual-entrega.html?raw';
import { downloadFile } from '../export/exportActions';
import { listXYFigures, subscribeXYFigures } from '../../plots/xy/figures';
import { isEmptyTrack } from '../../viewer/figureInput';
import { figureTracks } from '../export/figureSources';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { defaultReportOptions, type ReportOptions } from './report';
import { generateReport } from './reportActions';
import './report.css';

export function useReportForm(active: boolean) {
  const [options, setOptions] = useState(defaultReportOptions);
  const [preview, setPreview] = useState<{ html: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!active) setPreview(null); }, [active]);
  const entry = useProject(selectActiveEntry);
  useEffect(() => { setPreview(null); }, [entry?.well.id]);
  const result = useResults((s) => s.result);
  const calculating = useResults((s) => s.busy);
  const error = useResults((s) => s.error);
  const display = useProject((s) => s.project.display);
  const workspace = useUi((s) => s.workspace);
  const xy = useSyncExternalStore(subscribeXYFigures, listXYFigures);
  const tracks = useMemo(() => active && entry ? figureTracks(entry.well).filter((t) => t.kind !== 'depth' && !isEmptyTrack(t)) : [], [active, entry, result, display, workspace]);
  const set = (patch: Partial<ReportOptions>) => { setOptions((o) => ({ ...o, ...patch })); setPreview(null); };
  const unavailable = options.xyIds.filter((id) => !xy.some((f) => f.id === id));
  const canGenerate = !!entry && !calculating && !error && result?.wellId === entry.well.id && !busy && unavailable.length === 0 && (options.profile !== 'zones' || entry.interpretation.zones.length > 0) && (options.profile === 'none' || options.trackIds === null || options.trackIds.some((id) => tracks.some((t) => t.id === id)));
  const generate = async () => {
    setBusy(true);
    try { setPreview(await generateReport(options)); }
    catch (err) { toast({ title: 'No se pudo generar el informe', description: err instanceof Error ? err.message : String(err), tone: 'error' }); }
    finally { setBusy(false); }
  };
  return { options, set, preview, setPreview, busy, canGenerate, generate, tracks, xy, unavailable, calculating, error };
}
export type ReportForm = ReturnType<typeof useReportForm>;
export function ReportPanel({ form }: { form: ReportForm }) {
  const { options: o, set, tracks, xy } = form;
  if (form.preview) return <div className="exp"><Callout tone="info">Copia del estado al generarla. Usá el botón de impresión del informe y elegí «Guardar como PDF».</Callout><iframe className="report-preview" title="Vista previa del informe" srcDoc={form.preview.html} sandbox="allow-scripts allow-same-origin allow-modals" /></div>;
  const selected = new Set(o.trackIds ?? tracks.map((t) => t.id));
  return <div className="exp">
    <div className="exp-row exp-row--2"><Field label="Título (opcional)"><TextField aria-label="Título del informe" value={o.title} onChange={(title) => set({ title })} placeholder="Informe de interpretación" /></Field><Field label="Autor (opcional)"><TextField aria-label="Autor del informe" value={o.author} onChange={(author) => set({ author })} placeholder="Nombre y apellido" /></Field></div>
    <Field label="Contenido"><div className="exp-curves"><Checkbox label="Métodos y parámetros" checked={o.includeParameters} onChange={(includeParameters) => set({ includeParameters })} /><Checkbox label="Sumario por zona" checked={o.includeSummary} onChange={(includeSummary) => set({ includeSummary })} /><Checkbox label="Volumen in situ" checked={o.includeVolumes} onChange={(includeVolumes) => set({ includeVolumes })} /><Checkbox label="Coherencia cruzada" checked={o.includeCrossCheck !== false} onChange={(includeCrossCheck) => set({ includeCrossCheck })} /><Checkbox label="Preparación, laboratorio y alcance" checked={o.includePreparation !== false} onChange={(includePreparation) => set({ includePreparation })} /><Checkbox label="Advertencias y limitaciones" checked={o.includeWarnings} onChange={(includeWarnings) => set({ includeWarnings })} /><Checkbox label="Tiempo de interpretación" checked={o.includeWalkthrough !== false} onChange={(includeWalkthrough) => set({ includeWalkthrough })} /></div></Field>
    <Field label="Figuras del perfil" hint="Las pistas densas se distribuyen en varias páginas, repitiendo profundidad y extremos de relleno cuando hace falta. El sumario incluye todas las zonas."><Select aria-label="Figuras del perfil del informe" block value={o.profile} onChange={(v) => set({ profile: v as ReportOptions['profile'] })} options={[{ value: 'well', label: 'Perfil completo, paginado por pistas' }, { value: 'zones', label: 'Perfiles por zona, paginados por pistas' }, { value: 'none', label: 'Sin figuras del perfil' }]} /></Field>
    {o.profile !== 'none' && <Field label="Pistas a incluir"><div className="exp-curves">{tracks.map((t) => <Checkbox key={t.id} label={t.title} checked={selected.has(t.id)} onChange={(on) => { const next = new Set(selected); if (on) next.add(t.id); else next.delete(t.id); set({ trackIds: [...next] }); }} />)}</div></Field>}
    <Field label="Gráficos a la vista (opcional)" hint="Abrí un panel de gráficos para incluir su figura actual.">{xy.length ? <div className="exp-curves">{xy.map((f) => <Checkbox key={f.id} label={f.title} checked={o.xyIds.includes(f.id)} onChange={(on) => set({ xyIds: on ? [...o.xyIds, f.id] : o.xyIds.filter((id) => id !== f.id) })} />)}</div> : <p className="exp-empty">No hay gráficos publicados a la vista.</p>}</Field>
    {form.unavailable.length > 0 && <Field label="Gráficos que dejaron de estar disponibles" hint="Quitá estos gráficos de la selección o volvé a abrir su panel para generar el informe.">{form.unavailable.map((id) => <Checkbox key={id} label={`${id} · no disponible`} checked onChange={() => set({ xyIds: o.xyIds.filter((chosen) => chosen !== id) })} />)}</Field>}
    {(form.calculating || form.error) && <Callout tone="warn">{form.error || 'El motor está calculando. El informe estará disponible cuando termine.'}</Callout>}
    <Callout tone="info">Se genera una hoja de impresión autónoma. Podés guardarla como HTML para reabrirla sin conexión o imprimirla como PDF desde el navegador.</Callout>
    <Button onClick={() => downloadFile({ name: 'Manual-interpretacion.html', mime: 'text/html', bytes: new TextEncoder().encode(manualHtml) })}>Descargar manual de entrega</Button>
  </div>;
}
