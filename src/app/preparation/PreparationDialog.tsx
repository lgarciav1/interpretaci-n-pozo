import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { addMaskInterval, addMaskIntervals, entryPreparationPlan, removeGapFill, removeMedianFilter, setMedianFilter, setDepthShift, removeDepthShift, restoreMaskInterval, setGapFill } from '../../core/state/preparation';
import { makeId, setSource, type Project } from '../../core/state/project';
import { toEngineWell } from '../../core/engine/engine';
import { sameContext } from '../../core/engine/context';
import { interpolationSourceProblem } from '../../core/preparation/interpolation';
import { preparedCurveId } from '../../core/preparation/source';
import { stageQualityCounts, alignmentQualityCounts } from '../../core/preparation/quality';
import { registry } from '../../modules';
import { Button, Callout, Checkbox, Dialog, Field, Select, TextField, formatNumber } from '../../ui';
import { useProject } from '../store/project';
import { useResults } from '../store/results';
import { useViewer } from '../store/viewer';
import { snapshotRunner } from '../snapshots/snapshotEngine';
import { usePreparationUi } from './store';
import './preparation.css';
import { SuspectReview } from './SuspectReview';
import { XrdPanel } from './XrdPanel';
import { RunEditor, CorrelationReview } from './RunEditor';
import { setRunDepthShift } from '../../core/state/runs';
import { ShiftEditor } from './ShiftEditor';
import { FilterEditor } from './FilterEditor';
import { nodeGapFill, nodeFilter, nodeShift } from '../../core/preparation/state';
import { InterpolationEditor } from './InterpolationEditor';

const subscribe = (cb: () => void) => snapshotRunner.subscribe(cb);
const number = (s: string) => s.trim() ? Number(s.trim().replace(',', '.')) : NaN;
const show = (n: number) => Number.isNaN(n) ? '—' : formatNumber(n, { digits: 4 });
interface Proposal { base: Project; project: Project; key: string; draftKey: string; nodeId: string; nodeIds?: string[]; focus: number; operation: 'exclude' | 'interpolate' | 'filter' | 'shift' }
export function PreparationDialog() {
  const wellId = usePreparationUi(s => s.wellId);
  return wellId ? <MaskEditor key={wellId} wellId={wellId} /> : null;
}
function MaskEditor({ wellId }: { wellId: string }) {
  const project = useProject(s => s.project), commit = useProject(s => s.commit);
  const currentResult = useResults(s => s.result);
  const entry = project.wells.find(e => e.well.id === wellId);
  const [curveId, setCurveId] = useState(() => entry?.well.curves.find(c => c.role === 'GR')?.id ?? entry?.well.curves[0]?.id ?? '');
  const [runId, setRunId] = useState('');
  const [top, setTop] = useState(''), [base, setBase] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null), [error, setError] = useState<string | null>(null);
  const invalidatePreview = useCallback(() => setProposal(null), []);
  const visible = useViewer(s => s.visible);
  const compare = usePreparationUi(s => s.compareOriginals);
  const draftKey = JSON.stringify([curveId, top, base, runId]);
  const activeTarget = project.activeWellId === wellId;
  const selected = entry?.well.curves.find(c => c.id === curveId);
  const selectedNode = entry?.interpretation.preparation?.nodes.find(n => n.input.curveId === curveId);
  const currentShift = selectedNode ? nodeShift(selectedNode) : undefined;
  const currentProposal = activeTarget && proposal?.base === project && proposal.draftKey === draftKey ? proposal : null;
  const request = useMemo(() => {
    if (!currentProposal) return null;
    const e = currentProposal.project.wells.find(e => e.well.id === wellId)!;
    return { entry: e, plan: entryPreparationPlan(currentProposal.project, e, registry) };
  }, [currentProposal, wellId]);
  useEffect(() => {
    if (!currentProposal || !request) return;
    return snapshotRunner.acquire(currentProposal.key, toEngineWell(request.entry.well), request.entry.interpretation, request.plan.context, request.plan);
  }, [currentProposal, request]);
  const preview = useSyncExternalStore(subscribe, () => currentProposal ? snapshotRunner.get(currentProposal.key) ?? null : null);
  const result = preview?.status === 'ready' ? preview.result : null;
  const artifactId = currentProposal ? preparedCurveId(currentProposal.nodeId, 'masked') : '';
  const payload = result?.preparation?.artifacts.find(a => a.id === artifactId);
  const ready = !!payload && !!request && sameContext(result?.context, request.plan.context);
  const counts = payload ? stageQualityCounts(payload.quality) : null;
  const alignedCounts = payload ? alignmentQualityCounts(payload.data, payload.quality) : null;
  const shiftedArtifact = request?.plan.artifacts.find(a => a.id === artifactId)?.shift;
  const close = () => usePreparationUi.setState({ wellId: null });
  const previewNow = () => {
    try {
      if (!activeTarget) throw new Error('El pozo activo cambió. Abrí esta herramienta desde el pozo que querés preparar.');
      const id = makeId('mask'), intervalId = makeId('excluded');
      const next = addMaskInterval(project, wellId, curveId, { id: intervalId, top: number(top), base: number(base) }, id);
      const e = next.wells.find(e => e.well.id === wellId)!;
      entryPreparationPlan(next, e, registry);
      const nodeId = e.interpretation.preparation!.nodes.find(n => n.input.curveId === curveId)!.id;
      setError(null); setProposal({ base: project, project: next, key: `preparation-preview:${makeId('job')}`, draftKey, nodeId, focus: number(top), operation: 'exclude' });
    } catch (err) { setProposal(null); setError(err instanceof Error ? err.message : String(err)); }
  };
  const previewSamples = (depths: number[]) => {
    try {
      if (!activeTarget) throw new Error('El pozo activo cambió.');
      const next = addMaskIntervals(project, wellId, curveId, depths.map(d => ({ id: makeId('excluded'), top: d, base: d })), makeId('mask'));
      const e = next.wells.find(e => e.well.id === wellId)!;
      entryPreparationPlan(next, e, registry);
      const nodeId = e.interpretation.preparation!.nodes.find(n => n.input.curveId === curveId)!.id;
      setError(null); setProposal({ base: project, project: next, key: `preparation-preview:${makeId('job')}`, draftKey, nodeId, focus: depths[0]!, operation: 'exclude' });
    } catch (err) { setProposal(null); setError(err instanceof Error ? err.message : String(err)); }
  };
  const previewInterpolation = (maxGapM: number) => {
    try {
      if (!activeTarget) throw new Error('El pozo activo cambió.');
      const next = setGapFill(project, wellId, curveId, { top: number(top), base: number(base), maxGapM }, makeId('fill'));
      const e = next.wells.find(e => e.well.id === wellId)!;
      entryPreparationPlan(next, e, registry);
      const nodeId = e.interpretation.preparation!.nodes.find(n => n.input.curveId === curveId)!.id;
      setError(null); setProposal({ base: project, project: next, key: `preparation-preview:${makeId('job')}`, draftKey, nodeId, focus: number(top), operation: 'interpolate' });
    } catch (err) { setProposal(null); setError(err instanceof Error ? err.message : String(err)); }
  };
  const previewFilter = (radiusM: number, maxStepM: number) => {
    try {
      if (!activeTarget) throw new Error('El pozo activo cambió.');
      const next = setMedianFilter(project, wellId, curveId, { top: number(top), base: number(base), radiusM, maxStepM }, makeId('filter'));
      const e = next.wells.find(e => e.well.id === wellId)!;
      entryPreparationPlan(next, e, registry);
      const nodeId = e.interpretation.preparation!.nodes.find(n => n.input.curveId === curveId)!.id;
      setError(null); setProposal({ base: project, project: next, key: `preparation-preview:${makeId('job')}`, draftKey, nodeId, focus: number(top), operation: 'filter' });
    } catch (err) { setProposal(null); setError(err instanceof Error ? err.message : String(err)); }
  };
  const previewShift = (offsetM: number, maxGapM: number, datum: string) => {
    try {
      if (!activeTarget || !entry) throw new Error('El pozo activo cambió.');
      const config = { offsetM, maxGapM, datum, referenceId: wellId, depthKind: 'MD' as const };
      const next = runId ? setRunDepthShift(project, wellId, runId, config, () => makeId('shift')) : setDepthShift(project, wellId, curveId, config, makeId('shift'));
      const e = next.wells.find(e => e.well.id === wellId)!;
      entryPreparationPlan(next, e, registry);
      const nodeId = e.interpretation.preparation!.nodes.find(n => n.input.curveId === curveId)!.id;
      const focus = Number.isFinite(number(top)) ? number(top) : e.well.depth.values[0]!;
      setError(null); setProposal({ base: project, project: next, key: `preparation-preview:${makeId('job')}`, draftKey, nodeId, nodeIds: runId ? e.interpretation.preparation!.nodes.filter(n => project.inputRevisions?.[entry.inputRevisionId ?? '']?.acquisition.runs.find(r => r.id === runId)?.curveIds.includes(n.input.curveId)).map(n => n.id) : [nodeId], focus, operation: 'shift' });
    } catch (err) { setProposal(null); setError(err instanceof Error ? err.message : String(err)); }
  };
  const batchReady = !currentProposal?.nodeIds || currentProposal.nodeIds.every(id => result?.preparation?.artifacts.some(a => a.id === preparedCurveId(id, 'masked') && a.data.some(Number.isFinite)));
  const canApply = ready && batchReady && (currentProposal?.operation !== 'interpolate' || (payload?.sourceCounts?.interpolated ?? counts?.interpolated ?? 0) > 0) && (currentProposal?.operation !== 'filter' || (payload?.sourceCounts?.filtered ?? counts?.filtered ?? 0) > 0) && (currentProposal?.operation !== 'shift' || (alignedCounts?.finite ?? 0) > 0);
  const apply = () => {
    try {
      if (!currentProposal || !canApply || useProject.getState().project !== currentProposal.base) throw new Error('Cambió el proyecto o el tramo. Generá una nueva vista previa.');
      commit(`${currentProposal.operation === 'shift' ? (runId ? 'Alinear corrida' : 'Alinear curva') : currentProposal.operation === 'filter' ? 'Filtrar con mediana' : currentProposal.operation === 'interpolate' ? 'Interpolar faltantes de' : 'Excluir mediciones de'} ${selected?.mnemonic ?? curveId}`, p => p === currentProposal.base ? currentProposal.project : p, { group: currentProposal.key });
      close();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const restore = (nodeId: string, intervalId?: string) => {
    try { commit('Restaurar datos originales', p => restoreMaskInterval(p, wellId, nodeId, intervalId), { group: makeId('restore') }); setProposal(null); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const rows = useMemo(() => {
    if (!payload || !request) return [];
    const w = request.entry.well, original = w.curves.find(c => c.id === curveId);
    if (!original) return [];
    const firstEstimated = currentProposal?.operation === 'interpolate' ? payload.quality.findIndex(q => !!(q & 1) && !!(q & 8)) : currentProposal?.operation === 'filter' ? payload.quality.findIndex(q => !!(q & 16)) : -1;
    const focus = firstEstimated >= 0 ? w.depth.values[firstEstimated]! : currentProposal?.focus ?? number(top);
    let lo = 0, hi = w.depth.values.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (w.depth.values[mid]! < focus) lo = mid + 1; else hi = mid; }
    const start = Math.max(0, lo - 2);
    return Array.from({ length: Math.min(14, w.depth.values.length - start) }, (_, k) => { const i = start + k; return { depth: w.depth.values[i]!, original: original.data[i]!, prepared: payload.data[i]!, excluded: !!(payload.quality[i]! & 2), interpolated: !!(payload.quality[i]! & 8), filtered: !!(payload.quality[i]! & 16), shifted: !!(payload.quality[i]! & 32), unsupported: !!(payload.quality[i]! & 128) }; });
  }, [payload, request, curveId, top, currentProposal]);
  return <Dialog open onClose={close} title="Preparar datos" size="xl" description="Excluí mediciones o estimá faltantes con preview, conservando los originales y sus decisiones."
    footer={<><Button onClick={close}>Cerrar</Button><Button onClick={previewNow} disabled={!entry || !selected || !activeTarget}>Previsualizar exclusión</Button><Button variant="primary" onClick={apply} disabled={!canApply}>{selected?.role ? `Aplicar y usar para ${selected.role}` : 'Aplicar preparación'}</Button></>}>
    {!entry ? <Callout tone="warn">El pozo ya no está disponible.</Callout> : <div className="prep-editor">
      <strong>{entry.well.name}</strong>
      {!activeTarget && <Callout tone="warn">El pozo activo cambió. Cerrá esta herramienta y abrila desde el pozo que querés preparar.</Callout>}
      {currentShift && <Callout tone="warn">Esta curva ya está alineada. Los tramos de exclusión, interpolación y filtro usan MD de origen, antes del desplazamiento. El tramo visible del visor usa el índice destino: no se convierte automáticamente.</Callout>}
      <div className="prep-editor__fields">
        <Field label="Curva original"><Select aria-label="Curva original" value={curveId} onChange={v => { setCurveId(v); setRunId(''); setProposal(null); }} options={entry.well.curves.map(c => ({ value: c.id, label: `${c.mnemonic}${c.role ? ` · ${registry.roles.get(c.role)?.label ?? c.role}` : ''}` }))} block /></Field>
        <Field label="Tope (m MD)"><TextField aria-label="Tope (m MD)" value={top} onChange={setTop} inputMode="decimal" block /></Field>
        <Field label="Base (m MD)"><TextField aria-label="Base (m MD)" value={base} onChange={setBase} inputMode="decimal" block /></Field>
      </div>
      <div className="prep-editor__actions"><Button size="sm" onClick={() => { const d = entry.well.depth.values; setTop(String(Math.max(d[0]!, visible?.top ?? d[0]!))); setBase(String(Math.min(d.at(-1)!, visible?.base ?? d.at(-1)!))); }}>Usar tramo visible</Button><span>Se incluyen las muestras en ambos extremos. Las filas y la profundidad se conservan.</span></div>
      <XrdPanel project={project} entry={entry} />
      <SuspectReview project={project} entry={entry} curveId={curveId} top={number(top)} base={number(base)} disabled={!activeTarget} onPreview={previewSamples} onInvalidate={invalidatePreview} />
      <InterpolationEditor problem={selected ? interpolationSourceProblem(selected) : null} disabled={!entry || !selected || !activeTarget} onPreview={previewInterpolation} onInvalidate={invalidatePreview} />
      <FilterEditor problem={selected ? interpolationSourceProblem(selected, 'El filtro') : null} disabled={!entry || !selected || !activeTarget} onPreview={previewFilter} onInvalidate={invalidatePreview} />
      <RunEditor runId={runId} project={project} entry={entry} curveId={curveId} onChange={id => {setRunId(id);setProposal(null);}} />
      {runId && <Callout tone="warn">Se alineará toda la corrida {runId}. Aplicar exige cobertura finita en cada curva; todas sus fuentes se activan juntas.</Callout>}
      <CorrelationReview key={`${curveId}:${entry.inputRevisionId}`} entry={entry} curveId={curveId} top={number(top)} base={number(base)} />
      <ShiftEditor knownDatum={project.inputRevisions?.[entry.inputRevisionId ?? '']?.acquisition.depth.datum ?? null} problem={selected ? interpolationSourceProblem(selected, 'La alineación') : null} disabled={!entry || !selected || !activeTarget} onPreview={previewShift} onInvalidate={invalidatePreview} />
      {error && <Callout tone="error">{error}</Callout>}
      {proposal && !currentProposal && <Callout tone="warn">Cambió el proyecto o el tramo. Generá una nueva vista previa antes de aplicar.</Callout>}
      {currentProposal && (!preview || preview.status === 'pending') && <p role="status">Calculando vista previa…</p>}
      {preview?.status === 'error' && <Callout tone="error">{preview.message}</Callout>}
      {ready && counts && <section aria-label={currentProposal?.operation === 'shift' ? 'Vista previa de alineación' : currentProposal?.operation === 'filter' ? 'Vista previa de filtro' : currentProposal?.operation === 'interpolate' ? 'Vista previa de interpolación' : 'Vista previa de exclusión'}>
        {!shiftedArtifact && <p className="prep-editor__summary" role="status">{counts.newlyExcluded.toLocaleString('es-AR')} mediciones pasan a sin dato. {counts.originallyMissing.toLocaleString('es-AR')} muestras ya estaban sin dato en la curva.</p>}
        {!!request?.plan.artifacts.find(a => a.id === artifactId)?.gapFill && <p role="status">{(payload?.sourceCounts?.interpolated ?? counts.interpolated).toLocaleString('es-AR')} muestras estimadas por interpolación lineal{shiftedArtifact ? ' antes de alinear' : ''}; QC 9 = faltante original + interpolada. Son estimaciones, no mediciones. {!counts.interpolated && 'No hay huecos que cumplan los límites. Ajustá el tramo o la distancia máxima.'}</p>}
        {!!request?.plan.artifacts.find(a => a.id === artifactId)?.filter && <p role="status">{(payload?.sourceCounts?.filtered ?? counts.filtered).toLocaleString('es-AR')} muestras filtradas con mediana móvil{shiftedArtifact ? ' antes de alinear' : ''}. {counts.estimatedInfluence.toLocaleString('es-AR')} centros medidos reciben influencia de interpolación. {!counts.filtered && 'No hay ventanas con soporte completo. Revisá radio, separación, tramo y barreras.'}</p>}
        {shiftedArtifact && alignedCounts && <p role="status">{alignedCounts.finite.toLocaleString('es-AR')} salidas alineadas finitas; {alignedCounts.unsupported.toLocaleString('es-AR')} sin soporte y {alignedCounts.missing.toLocaleString('es-AR')} faltantes trasladados. {alignedCounts.estimatedSupport.toLocaleString('es-AR')} salidas usan soporte estimado. Bits QC 32=alineada y 128=sin soporte. Los otros bits se heredan del origen, no del índice destino. {!alignedCounts.finite && 'No queda cobertura finita: ajustá el desplazamiento o el hueco máximo.'}</p>}
        {currentProposal?.nodeIds && <table className="prep-editor__table"><caption>Cobertura del lote completo</caption><thead><tr><th>Curva</th><th>Salidas finitas</th></tr></thead><tbody>{currentProposal.nodeIds.map(id => { const n = request?.entry.interpretation.preparation?.nodes.find(n => n.id === id); const a = result?.preparation?.artifacts.find(a => a.id === preparedCurveId(id, 'masked')); return <tr key={id}><td>{request?.entry.well.curves.find(c => c.id === n?.input.curveId)?.mnemonic}</td><td>{a ? alignmentQualityCounts(a.data,a.quality).finite : 'Sin resultado'}</td></tr>; })}</tbody></table>}
        <p>{selected?.role ? `Al aplicar, ${selected.role} usará «${selected.mnemonic} preparada». Se conservarán el original y el historial para deshacer.` : 'Se guardará una curva preparada para comparar y exportar, sin asignarla a un rol.'}</p>
        <table className="prep-editor__table"><caption>Comparación local · hasta 14 muestras</caption><thead><tr><th>MD (m)</th><th>Original</th><th>Preparada</th><th>Estado</th></tr></thead><tbody>{rows.map(r => <tr key={r.depth}><td>{show(r.depth)}</td><td>{show(r.original)}</td><td>{show(r.prepared)}</td><td>{r.shifted ? (r.unsupported ? 'Alineada · sin soporte' : Number.isNaN(r.prepared) ? 'Alineada · faltante de origen' : r.interpolated ? 'Alineada · soporte estimado' : 'Alineada · dato de origen') : r.excluded ? 'Excluida' : r.filtered ? (r.interpolated ? (Number.isNaN(r.original) ? 'Estimada · interpolada y filtrada' : 'Filtrada · con estimaciones') : 'Filtrada') : r.interpolated ? 'Estimada · interpolada' : Number.isNaN(r.original) ? 'Sin dato original' : 'Conservada'}</td></tr>)}</tbody></table>
      </section>}
      <section aria-label="Preparaciones guardadas"><h3>Preparaciones guardadas</h3>
        {!entry.interpretation.preparation?.nodes.length && <p>Todavía no hay preparaciones guardadas.</p>}
        {entry.interpretation.preparation?.nodes.map(node => {
          const c = entry.well.curves.find(c => c.id === node.input.curveId), preparedId = preparedCurveId(node.id, 'masked');
          const source = c?.role ? entry.interpretation.sources[c.role] : undefined;
          const gapFill = nodeGapFill(node), filter = nodeFilter(node), shift = nodeShift(node);
          const active = source?.kind === 'curve' && source.curveId === preparedId;
          return <div className="prep-editor__saved" key={node.id}><strong>{c?.mnemonic ?? node.input.curveId}</strong>
            {currentResult?.preparation?.plan.diagnostics.filter(d => d.nodeId === node.id && d.status === 'needs-input').map(d => <Callout key={d.nodeId} tone="warn">{d.message}</Callout>)}
            <div className="prep-editor__actions">{c?.role && <Button size="sm" onClick={() => commit(`Usar ${active ? 'original' : 'preparada'} de ${c.mnemonic}`, p => setSource(p, wellId, c.role!, { kind: 'curve', curveId: active ? c.id : preparedId }), { group: makeId('source') })}>{active ? 'Usar original' : 'Usar preparada'}</Button>}<Button size="sm" onClick={() => restore(node.id)}>Restaurar original de {c?.mnemonic ?? node.input.curveId}</Button></div>
            {gapFill && <div className="prep-editor__range"><span>Interpolación lineal: {show(gapFill.top)}–{show(gapFill.base)} m MD; máximo entre anclajes {show(gapFill.maxGapM)} m</span><Button size="sm" onClick={() => { try { commit('Quitar interpolación', p => removeGapFill(p, wellId, node.id), { group: makeId('remove-fill') }); setProposal(null); setError(null); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }}>Quitar interpolación</Button></div>}
            {filter && <div className="prep-editor__range"><span>Mediana: {show(filter.top)}–{show(filter.base)} m MD; radio {show(filter.radiusM)} m; separación máxima {show(filter.maxStepM)} m. Después de interpolar, si existe.</span><Button size="sm" onClick={() => { try { commit('Quitar filtro', p => removeMedianFilter(p, wellId, node.id), { group: makeId('remove-filter') }); setProposal(null); setError(null); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }}>Quitar filtro</Button></div>}
            {shift && <div className="prep-editor__range"><span>Alineación completa: {shift.offsetM > 0 ? '+' : ''}{show(shift.offsetM)} m; datum declarado {shift.datum}; hueco máximo {show(shift.maxGapM)} m. Última etapa.</span><Button size="sm" onClick={() => { try { commit('Quitar alineación', p => removeDepthShift(p, wellId, node.id), { group: makeId('remove-shift') }); setProposal(null); setError(null); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }}>Quitar alineación</Button></div>}
            {node.intervals.map(r => <div className="prep-editor__range" key={r.id}><span>{show(r.top)}–{show(r.base)} m MD</span><Button size="sm" onClick={() => restore(node.id, r.id)} aria-label={`Restaurar exclusión ${r.id}`}>Restaurar exclusión</Button></div>)}
          </div>;
        })}
      </section>
      <Checkbox checked={compare} onChange={value => usePreparationUi.setState({ compareOriginals: value })} label="Comparar originales y preparadas en el visor" description="Sólo cambia la vista. Los gráficos y exportaciones conservan el acceso explícito a ambas curvas." />
    </div>}
  </Dialog>;
}
