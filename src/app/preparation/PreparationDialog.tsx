import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { addMaskInterval, addMaskIntervals, entryPreparationPlan, restoreMaskInterval } from '../../core/state/preparation';
import { makeId, setSource, type Project } from '../../core/state/project';
import { toEngineWell } from '../../core/engine/engine';
import { sameContext } from '../../core/engine/context';
import { preparedCurveId } from '../../core/preparation/source';
import { maskQualityCounts } from '../../core/preparation/quality';
import { registry } from '../../modules';
import { Button, Callout, Checkbox, Dialog, Field, Select, TextField, formatNumber } from '../../ui';
import { useProject } from '../store/project';
import { useResults } from '../store/results';
import { useViewer } from '../store/viewer';
import { snapshotRunner } from '../snapshots/snapshotEngine';
import { usePreparationUi } from './store';
import './preparation.css';
import { SuspectReview } from './SuspectReview';

const subscribe = (cb: () => void) => snapshotRunner.subscribe(cb);
const number = (s: string) => s.trim() ? Number(s.trim().replace(',', '.')) : NaN;
const show = (n: number) => Number.isNaN(n) ? '—' : formatNumber(n, { digits: 4 });
interface Proposal { base: Project; project: Project; key: string; draftKey: string; nodeId: string; focus: number }
export function PreparationDialog() {
  const wellId = usePreparationUi(s => s.wellId);
  return wellId ? <MaskEditor key={wellId} wellId={wellId} /> : null;
}
function MaskEditor({ wellId }: { wellId: string }) {
  const project = useProject(s => s.project), commit = useProject(s => s.commit);
  const currentResult = useResults(s => s.result);
  const entry = project.wells.find(e => e.well.id === wellId);
  const [curveId, setCurveId] = useState(() => entry?.well.curves.find(c => c.role === 'GR')?.id ?? entry?.well.curves[0]?.id ?? '');
  const [top, setTop] = useState(''), [base, setBase] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null), [error, setError] = useState<string | null>(null);
  const invalidatePreview = useCallback(() => setProposal(null), []);
  const visible = useViewer(s => s.visible);
  const compare = usePreparationUi(s => s.compareOriginals);
  const draftKey = JSON.stringify([curveId, top, base]);
  const activeTarget = project.activeWellId === wellId;
  const selected = entry?.well.curves.find(c => c.id === curveId);
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
  const counts = payload ? maskQualityCounts(payload.quality) : null;
  const close = () => usePreparationUi.setState({ wellId: null });
  const previewNow = () => {
    try {
      if (!activeTarget) throw new Error('El pozo activo cambió. Abrí esta herramienta desde el pozo que querés preparar.');
      const id = makeId('mask'), intervalId = makeId('excluded');
      const next = addMaskInterval(project, wellId, curveId, { id: intervalId, top: number(top), base: number(base) }, id);
      const e = next.wells.find(e => e.well.id === wellId)!;
      entryPreparationPlan(next, e, registry);
      const nodeId = e.interpretation.preparation!.nodes.find(n => n.input.curveId === curveId)!.id;
      setError(null); setProposal({ base: project, project: next, key: `preparation-preview:${makeId('job')}`, draftKey, nodeId, focus: number(top) });
    } catch (err) { setProposal(null); setError(err instanceof Error ? err.message : String(err)); }
  };
  const previewSamples = (depths: number[]) => {
    try {
      if (!activeTarget) throw new Error('El pozo activo cambió.');
      const next = addMaskIntervals(project, wellId, curveId, depths.map(d => ({ id: makeId('excluded'), top: d, base: d })), makeId('mask'));
      const e = next.wells.find(e => e.well.id === wellId)!;
      entryPreparationPlan(next, e, registry);
      const nodeId = e.interpretation.preparation!.nodes.find(n => n.input.curveId === curveId)!.id;
      setError(null); setProposal({ base: project, project: next, key: `preparation-preview:${makeId('job')}`, draftKey, nodeId, focus: depths[0]! });
    } catch (err) { setProposal(null); setError(err instanceof Error ? err.message : String(err)); }
  };
  const apply = () => {
    try {
      if (!currentProposal || !ready || useProject.getState().project !== currentProposal.base) throw new Error('Cambió el proyecto o el tramo. Generá una nueva vista previa.');
      commit(`Excluir mediciones de ${selected?.mnemonic ?? curveId}`, p => p === currentProposal.base ? currentProposal.project : p, { group: currentProposal.key });
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
    let lo = 0, hi = w.depth.values.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (w.depth.values[mid]! < (currentProposal?.focus ?? number(top))) lo = mid + 1; else hi = mid; }
    const start = Math.max(0, lo - 2);
    return Array.from({ length: Math.min(14, w.depth.values.length - start) }, (_, k) => { const i = start + k; return { depth: w.depth.values[i]!, original: original.data[i]!, prepared: payload.data[i]!, excluded: !!(payload.quality[i]! & 2) }; });
  }, [payload, request, curveId, top, currentProposal]);
  return <Dialog open onClose={close} title="Preparar datos" size="xl" description="Excluí mediciones por intervalo y conservá los originales. Las muestras excluidas se muestran como sin dato."
    footer={<><Button onClick={close}>Cerrar</Button><Button onClick={previewNow} disabled={!entry || !selected || !activeTarget}>Previsualizar exclusión</Button><Button variant="primary" onClick={apply} disabled={!ready}>{selected?.role ? `Aplicar y usar para ${selected.role}` : 'Aplicar exclusión'}</Button></>}>
    {!entry ? <Callout tone="warn">El pozo ya no está disponible.</Callout> : <div className="prep-editor">
      <strong>{entry.well.name}</strong>
      {!activeTarget && <Callout tone="warn">El pozo activo cambió. Cerrá esta herramienta y abrila desde el pozo que querés preparar.</Callout>}
      <div className="prep-editor__fields">
        <Field label="Curva original"><Select aria-label="Curva original" value={curveId} onChange={v => { setCurveId(v); setProposal(null); }} options={entry.well.curves.map(c => ({ value: c.id, label: `${c.mnemonic}${c.role ? ` · ${registry.roles.get(c.role)?.label ?? c.role}` : ''}` }))} block /></Field>
        <Field label="Tope (m MD)"><TextField aria-label="Tope (m MD)" value={top} onChange={setTop} inputMode="decimal" block /></Field>
        <Field label="Base (m MD)"><TextField aria-label="Base (m MD)" value={base} onChange={setBase} inputMode="decimal" block /></Field>
      </div>
      <div className="prep-editor__actions"><Button size="sm" onClick={() => { const d = entry.well.depth.values; setTop(String(Math.max(d[0]!, visible?.top ?? d[0]!))); setBase(String(Math.min(d.at(-1)!, visible?.base ?? d.at(-1)!))); }}>Usar tramo visible</Button><span>Se incluyen las muestras en ambos extremos. Las filas y la profundidad se conservan.</span></div>
      <SuspectReview project={project} entry={entry} curveId={curveId} top={number(top)} base={number(base)} disabled={!activeTarget} onPreview={previewSamples} onInvalidate={invalidatePreview} />
      {error && <Callout tone="error">{error}</Callout>}
      {proposal && !currentProposal && <Callout tone="warn">Cambió el proyecto o el tramo. Generá una nueva vista previa antes de aplicar.</Callout>}
      {currentProposal && (!preview || preview.status === 'pending') && <p role="status">Calculando vista previa…</p>}
      {preview?.status === 'error' && <Callout tone="error">{preview.message}</Callout>}
      {ready && counts && <section aria-label="Vista previa de exclusión">
        <p className="prep-editor__summary" role="status">{counts.newlyExcluded.toLocaleString('es-AR')} mediciones pasan a sin dato. {counts.originallyMissing.toLocaleString('es-AR')} muestras ya estaban sin dato en la curva.</p>
        <p>{selected?.role ? `Al aplicar, ${selected.role} usará «${selected.mnemonic} preparada». Se conservarán el original y el historial para deshacer.` : 'Se guardará una curva preparada para comparar y exportar, sin asignarla a un rol.'}</p>
        <table className="prep-editor__table"><caption>Comparación local · hasta 14 muestras</caption><thead><tr><th>MD (m)</th><th>Original</th><th>Preparada</th><th>Estado</th></tr></thead><tbody>{rows.map(r => <tr key={r.depth}><td>{show(r.depth)}</td><td>{show(r.original)}</td><td>{show(r.prepared)}</td><td>{r.excluded ? 'Excluida' : Number.isNaN(r.original) ? 'Sin dato original' : 'Conservada'}</td></tr>)}</tbody></table>
      </section>}
      <section aria-label="Exclusiones guardadas"><h3>Exclusiones guardadas</h3>
        {!entry.interpretation.preparation?.nodes.length && <p>Todavía no hay exclusiones guardadas.</p>}
        {entry.interpretation.preparation?.nodes.map(node => {
          const c = entry.well.curves.find(c => c.id === node.input.curveId), preparedId = preparedCurveId(node.id, 'masked');
          const source = c?.role ? entry.interpretation.sources[c.role] : undefined;
          const active = source?.kind === 'curve' && source.curveId === preparedId;
          return <div className="prep-editor__saved" key={node.id}><strong>{c?.mnemonic ?? node.input.curveId}</strong>
            {currentResult?.preparation?.plan.diagnostics.filter(d => d.nodeId === node.id && d.status === 'needs-input').map(d => <Callout key={d.nodeId} tone="warn">{d.message}</Callout>)}
            <div className="prep-editor__actions">{c?.role && <Button size="sm" onClick={() => commit(`Usar ${active ? 'original' : 'preparada'} de ${c.mnemonic}`, p => setSource(p, wellId, c.role!, { kind: 'curve', curveId: active ? c.id : preparedId }), { group: makeId('source') })}>{active ? 'Usar original' : 'Usar preparada'}</Button>}<Button size="sm" onClick={() => restore(node.id)}>Restaurar original de {c?.mnemonic ?? node.input.curveId}</Button></div>
            {node.intervals.map(r => <div className="prep-editor__range" key={r.id}><span>{show(r.top)}–{show(r.base)} m MD</span><Button size="sm" onClick={() => restore(node.id, r.id)} aria-label={`Restaurar exclusión ${r.id}`}>Restaurar exclusión</Button></div>)}
          </div>;
        })}
      </section>
      <Checkbox checked={compare} onChange={value => usePreparationUi.setState({ compareOriginals: value })} label="Comparar originales y preparadas en el visor" description="Sólo cambia la vista. Los gráficos y exportaciones conservan el acceso explícito a ambas curvas." />
    </div>}
  </Dialog>;
}
