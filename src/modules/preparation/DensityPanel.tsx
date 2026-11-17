/** F20: borrador aislado; guardar y elegir fuente son decisiones distintas. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Project, WellEntry } from '../../core/state/project';
import { makeId, setSource } from '../../core/state/project';
import { createSnapshot } from '../../core/state/snapshots';
import { activateDensityReconstruction, setDensityReconstruction, restoreMaskInterval } from '../../core/state/preparation';
import type { DensityReconstructionConfig } from '../../core/preparation/density';
import { preparedCurveId } from '../../core/preparation/source';
import { sameContext } from '../../core/engine/context';
import { registry } from '../../modules';
import { useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { useUi } from '../../app/store/ui';
import { snapshotRunner } from '../../app/snapshots/snapshotEngine';
import { Button, Callout, Checkbox, Field, NumberField, Select, Spinner, curveStyle, formatNumber, useResolvedTheme } from '../../ui';
import { BeforeAfterChart } from './BeforeAfterChart';
import { calibrationPreviewRequest } from './calibrationPreview';
import { indexRange, qualityOf } from './flags';
import type { DepthRange } from './types';

const subscribe = (cb: () => void) => snapshotRunner.subscribe(cb);
const show = (n: number | null | undefined, digits = 3) => n != null && Number.isFinite(n) ? formatNumber(n, { digits }) : 'Sin dato';
const roleOf = (role: string | null | undefined): 'gr' | 'sonic' | 'resistivity' | 'neutron' | null => role === 'GR' ? 'gr' : role === 'DT' ? 'sonic' : role === 'NPHI' ? 'neutron' : ['RT', 'RM', 'RS', 'RXO'].includes(role ?? '') ? 'resistivity' : null;

function IntervalEditor({ title, label, ranges, onChange, view }: { title: string; label: string; ranges: DepthRange[]; onChange(r: DepthRange[]): void; view: DepthRange }) {
  const [top, setTop] = useState(view.top), [base, setBase] = useState(view.base);
  return <section className="prep-card-box">
    <h4>{title}</h4>
    <div className="prep-density__row">
      <NumberField aria-label={`Tope ${label} (m MD)`} value={top} onChange={setTop} min={-100000} max={100000} step={.01} width={110} />
      <span>–</span>
      <NumberField aria-label={`Base ${label} (m MD)`} value={base} onChange={setBase} min={-100000} max={100000} step={.01} unit="m" width={110} />
      <Button size="sm" disabled={!Number.isFinite(top) || !Number.isFinite(base) || top >= base || ranges.length >= 32} onClick={() => onChange([...ranges, { top, base }])}>Agregar {label === 'del derrumbe' ? 'derrumbe' : label === 'de buen pozo' ? 'buen pozo' : 'tramo confiable'}</Button>
      <Button size="sm" variant="ghost" onClick={() => { setTop(view.top); setBase(view.base); }}>Tomar vista actual</Button>
    </div>
    {ranges.length ? <ul>{ranges.map((r, i) => <li key={i}>{show(r.top, 2)} – {show(r.base, 2)} m MD <Button size="sm" variant="ghost" aria-label={`Quitar ${label} ${i + 1}`} onClick={() => onChange(ranges.filter((_, j) => i !== j))}>Quitar</Button></li>)}</ul> : <p className="prep-muted">Sin intervalos declarados.</p>}
  </section>;
}

export function DensityPanel({ project, entry, view }: { project: Project; entry: WellEntry; view: DepthRange }) {
  const theme = useResolvedTheme();
  const originals = entry.well.curves.filter(c => c.origin.kind === 'measured');
  const [curveId, setCurveId] = useState(originals.find(c => c.role === 'RHOB')?.id ?? '');
  const curve = originals.find(c => c.id === curveId);
  const existing = entry.interpretation.preparation?.nodes.find(n => n.input.curveId === curveId);
  const saved = existing?.kind === 'density-reconstruction' ? existing : null;
  const depth = entry.well.depth.values;
  const whole = useMemo(() => ({ top: depth[0] ?? 0, base: depth.at(-1) ?? 1 }), [depth]);
  const [good, setGood] = useState<DepthRange[]>(saved?.density.goodIntervals ?? []), [washouts, setWashouts] = useState<DepthRange[]>(saved?.density.washoutIntervals ?? []);
  const [trusted, setTrusted] = useState<string[]>(saved?.density.predictors.map(p => p.curveId) ?? []), [neutronRanges, setNeutronRanges] = useState<DepthRange[]>(saved?.density.predictors.find(p => p.role === 'neutron')?.reliableIntervals ?? []);
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState<{ base: Project; project: Project; key: string; controls: string; nodeId: string; request: ReturnType<typeof calibrationPreviewRequest> } | null>(null);
  const controls = JSON.stringify([curveId, good, washouts, trusted, neutronRanges, confirmed]);
  const current = draft?.base === project && draft.controls === controls ? draft : null;
  const result = useResults(s => s.result);
  const commit = useProject(s => s.commit);
  useEffect(() => {
    if (!current) return;
    const r = current.request;
    return snapshotRunner.acquire(current.key, r.engineWell, r.entry.interpretation, r.context, r.preparation);
  }, [current]);
  const run = useSyncExternalStore(subscribe, () => current ? snapshotRunner.get(current.key) ?? null : null);
  const preview = run?.status === 'ready' && current && sameContext(run.result.context, current.request.context) ? run.result : null;
  const id = current ? preparedCurveId(current.nodeId, 'masked') : saved ? preparedCurveId(saved.id, 'masked') : '';
  const savedContext = useMemo(() => calibrationPreviewRequest(project, entry.well.id, registry).context, [project, entry.well.id]);
  const savedResult = result && sameContext(result.context, savedContext) ? result : null;
  const payload = (current ? preview : savedResult)?.preparation?.artifacts.find(a => a.id === id);
  const report = payload?.density?.report;
  const active = entry.interpretation.sources.RHOB;
  const inUse = saved && active?.kind === 'curve' && active.curveId === preparedCurveId(saved.id, 'masked');
  const candidates = originals.filter(c => roleOf(c.role));
  const ready = !!current && !!payload?.density && report?.accepted && report.estimatedCount > 0;
  const [selection, setSelection] = useState<DepthRange | null>(null);
  const win = indexRange(depth, view.top, view.base);
  const lastSnapshot = project.snapshots.filter(s => s.wellId === entry.well.id).at(-1);
  const act = (label: string, action: (p: Project) => Project) => {
    try { commit(label, action, { group: makeId('density-action') }); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const train = () => {
    try {
      const predictors: DensityReconstructionConfig['predictors'] = candidates.filter(c => trusted.includes(c.id)).map(c => ({ curveId: c.id, role: roleOf(c.role)!, trusted: true, reliableIntervals: c.role === 'NPHI' ? neutronRanges : [whole] }));
      const config: DensityReconstructionConfig = { goodIntervals: good, washoutIntervals: washouts, predictors };
      const nodeId = saved?.id ?? makeId('density');
      const next = setDensityReconstruction(project, entry.well.id, curveId, config, nodeId);
      setDraft({ base: project, project: next, controls, nodeId, key: makeId('density-preview'), request: calibrationPreviewRequest(next, entry.well.id, registry) });
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  if (!curve) return <Callout tone="warn">Se necesita una curva medida de densidad (RHOB/ZDEN).</Callout>;
  return <section className="prep-density" aria-label="Reconstrucción de densidad">
    <header><h3>Reconstruir densidad en derrumbes</h3><p>Estimación estadística del mismo pozo. Conserva el original; guardarla no cambia la fuente de porosidad.</p></header>
    <Field label="Densidad original"><Select aria-label="Densidad original" value={curveId} onChange={id => {
      setCurveId(id); setConfirmed(false); setDraft(null);
      const n = entry.interpretation.preparation?.nodes.find(n => n.kind === 'density-reconstruction' && n.input.curveId === id);
      const c = n?.kind === 'density-reconstruction' ? n.density : null;
      setGood(c?.goodIntervals ?? []); setWashouts(c?.washoutIntervals ?? []); setTrusted(c?.predictors.map(p => p.curveId) ?? []); setNeutronRanges(c?.predictors.find(p => p.role === 'neutron')?.reliableIntervals ?? []);
    }} options={originals.filter(c => c.role === 'RHOB').map(c => ({ value: c.id, label: c.mnemonic }))} /></Field>
    <Callout tone="warn">Marcá buen pozo y derrumbes por separado. Caliper inválido no demuestra derrumbe. La existencia de GR, neutrón, sónico o resistividad no garantiza su fiabilidad. No es una corrección ambiental de herramienta.</Callout>
    {existing && !saved && <Callout tone="warn">Esta densidad ya tiene otra preparación. Retirala explícitamente en Guardadas antes de reconstruir.</Callout>}
    <div className="prep-density__columns">
      <IntervalEditor title="Tramos de buen pozo para validar y entrenar" label="de buen pozo" ranges={good} onChange={setGood} view={selection ?? view} />
      <IntervalEditor title="Tramos marcados como derrumbe" label="del derrumbe" ranges={washouts} onChange={setWashouts} view={selection ?? view} />
    </div>
    <section className="prep-card-box"><h4>Predictores revisados</h4><p className="prep-muted">Cada selección declara que revisaste su fiabilidad en todo el pozo, incluidos los derrumbes. Seleccioná entre dos y cuatro predictores de familias distintas. Los faltantes y valores fuera de dominio quedan sin estimar.</p>
      <div className="prep-density__predictors">{candidates.map(c => <Checkbox key={c.id} checked={trusted.includes(c.id)} onChange={v => setTrusted(v ? [...trusted, c.id] : trusted.filter(x => x !== c.id))} label={`${c.mnemonic} confiable en todo el pozo, incluidos derrumbes`} />)}</div>
      {candidates.some(c => c.role === 'NPHI' && trusted.includes(c.id)) && <><Callout tone="warn">El neutrón también se altera con el derrumbe. Declarar confianza global no basta: delimitá los intervalos donde hay evidencia independiente de fiabilidad.</Callout><IntervalEditor title="Intervalos de neutrón confiable" label="de neutrón confiable" ranges={neutronRanges} onChange={setNeutronRanges} view={selection ?? view} /></>}
      <Checkbox checked={confirmed} onChange={setConfirmed} label="Confirmo la fiabilidad de los predictores seleccionados" />
    </section>
    <div className="prep-density__row"><Button variant="primary" disabled={!confirmed || trusted.length < 2 || !good.length || !washouts.length || !!existing && !saved || candidates.some(c => c.role === 'NPHI' && trusted.includes(c.id)) && !neutronRanges.length} onClick={train}>Entrenar y validar</Button>
      {current && !preview && run?.status !== 'error' && <span role="status"><Spinner size={14} /> Validando por bloques de profundidad…</span>}
      <Button disabled={!ready} onClick={() => { if (current && ready && useProject.getState().project === current.base) act('Guardar densidad preparada', p => p === current.base ? current.project : p); }}>Guardar densidad preparada</Button>
    </div>
    {error && <Callout tone="error">{error}</Callout>}
    {run?.status === 'error' && <Callout tone="error">{run.message}</Callout>}
    {report && <section className="prep-card-box" aria-label="Validación de densidad"><h4>Validación en buen pozo · bloques ocultos {current ? '· vista previa' : '· receta guardada'}</h4>
      <div className="prep-density__metrics"><span>RMSE <strong>{show(report.rmse)} g/cm³</strong></span><span>R² <strong>{show(report.r2)}</strong></span><span>Cobertura de validación <strong>{show(report.validationCoverage * 100, 1)} %</strong></span><span>Cobertura de banda <strong>{report.bandCoverage == null ? 'Sin dato' : `${show(report.bandCoverage * 100, 1)} %`}</strong></span><span>Banda nominal <strong>90 % · ±{show(report.halfWidth)} g/cm³</strong></span><span>Reconstruidas <strong>{report.estimatedCount} / {report.targetCount}</strong></span></div>
      <p className="prep-muted">Puerta fija: RMSE ≤ 0,08 g/cm³; R² ≥ 0,50; cobertura de validación ≥ 60 %; cobertura observada de banda ≥ 85 %; semiancho ≤ 0,15 g/cm³. La cobertura global en buen pozo no garantiza cobertura en cada derrumbe; no hay densidad verdadera de referencia allí.</p>
      {!report.accepted && <Callout tone="warn">Reconstrucción no disponible: {report.reasons.join(' ')}</Callout>}
      <p className="prep-muted">Entrenamiento: {report.trainingCount} muestras · validación: {report.validationCount} · calibración de banda: {report.calibrationCount}. Los umbrales se fijan antes de entrenar y no se ajustan desde este panel.</p>
      {report.accepted && <Callout tone="info">Error medido únicamente sobre densidad observada de buen pozo. En derrumbes la densidad verdadera es desconocida. Extrapolación, huecos o soporte insuficiente quedan sin dato.</Callout>}
    </section>}
    <BeforeAfterChart height={340} mnemonic={curve.mnemonic} afterLabel={payload ? current ? 'Vista previa estimada' : 'Preparada estimada' : null} depth={depth} start={win.start} end={win.end} original={curve.data} after={payload?.data ?? null} lower={payload?.density?.lower} upper={payload?.density?.upper} quality={payload?.quality.subarray(win.start, win.end) ?? qualityOf(curve.data).subarray(win.start, win.end)} color={curveStyle('RHOB', theme).color} log={false} unit={curve.unit} zones={entry.interpretation.zones} selection={selection} viewerDepth={null} stale={false} onSelect={setSelection} />
    <div className="prep-density__row">
      <Button onClick={() => act('Guardar snapshot antes de reconstruir', p => createSnapshot(p, entry.well.id, 'Antes de densidad reconstruida').project)}>Guardar snapshot antes</Button>
      {saved && <><Button disabled={!!inUse || !report?.accepted || !report.estimatedCount} onClick={() => act('Usar densidad preparada', p => activateDensityReconstruction(p, entry.well.id, saved.id))}>Usar densidad preparada</Button><Button disabled={!inUse} onClick={() => act('Usar densidad original', p => setSource(p, entry.well.id, 'RHOB', { kind: 'curve', curveId }))}>Usar densidad original</Button><Button variant="ghost" onClick={() => act('Quitar reconstrucción de densidad', p => restoreMaskInterval(p, entry.well.id, saved.id))}>Quitar reconstrucción</Button></>}
      <Button icon="curtain" disabled={!lastSnapshot} onClick={() => { if (lastSnapshot) useUi.getState().set({ curtain: { snapshotId: lastSnapshot.id } }); }}>Comparar porosidad con cortina</Button>
      <Button variant="ghost" onClick={() => useUi.getState().set({ snapshotsOpen: true })}>Snapshots</Button>
    </div>
    <p className="prep-muted">Guardá un snapshot antes de cambiar la fuente. Después elegí la preparada para RHOB y compará la porosidad con la cortina del visor. Ecuaciones y referencias: módulo Preparar datos en Ecuaciones.</p>
  </section>;
}
