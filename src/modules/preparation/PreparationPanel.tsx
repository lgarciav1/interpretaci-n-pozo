/**
 * Panel «Preparar datos» del dock (docs/decisiones/0058; antes, un diálogo modal). Flujo principal:
 *
 *   curva (tarjetas) → herramienta (tarjeta con sliders) → vista previa viva (gráfico antes/después) → Aplicar
 *
 * Las herramientas arman un BORRADOR (receta pura de `src/core/state/preparation.ts`); el panel lo calcula con el motor
 * aislado de snapshots (`snapshotRunner`, la misma vista previa que usaba el diálogo) y recién «Aplicar» hace un
 * `commit` (un paso de deshacer, `group` = la vista previa). La «tubería» muestra las etapas en el orden fijo del motor.
 * Las secciones avanzadas (DRX, ambiente, MGT, corridas, guardadas) son pestañas con su contenido de siempre.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toEngineWell } from '../../core/engine/engine';
import { sameContext } from '../../core/engine/context';
import { interpolationSourceProblem } from '../../core/preparation/interpolation';
import { alignmentQualityCounts, stageQualityCounts } from '../../core/preparation/quality';
import { preparedCurveId } from '../../core/preparation/source';
import { entryPreparationPlan } from '../../core/state/preparation';
import { makeId, type Project, type WellEntry } from '../../core/state/project';
import type { Zone } from '../../core/well';
import { registry } from '../../modules';
import { Button, Callout, EmptyState, Icon, NumberField, Select, Spinner, Switch, TabPanel, Tabs, curveStyle, formatNumber, useResolvedTheme, type IconName } from '../../ui';
import { usePreparationUi } from '../../app/preparation/store';
import { snapshotRunner } from '../../app/snapshots/snapshotEngine';
import { undoChange } from '../../app/shell/historyActions';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useWellQc } from '../../app/store/qc';
import { useResults } from '../../app/store/results';
import { useUi } from '../../app/store/ui';
import { useViewer } from '../../app/store/viewer';
import { BeforeAfterChart } from './BeforeAfterChart';
import { CurveCards, type CardInfo } from './CurveCards';
import { EnvironmentDiagnosticPanel } from './EnvironmentDiagnosticPanel';
import { EnvironmentPanel } from './EnvironmentPanel';
import { ExclusionEditor } from './ExclusionEditor';
import { FilterEditor } from './FilterEditor';
import { indexRange, qualityOf, withSuspects } from './flags';
import { InterpolationEditor } from './InterpolationEditor';
import { Pipeline } from './Pipeline';
import { pipelineStages, type PipelineStage, type PreparedView, type ToolId } from './pipeline';
import { CorrelationReview, RunEditor } from './RunEditor';
import { SavedPreparations } from './SavedPreparations';
import { ShiftEditor } from './ShiftEditor';
import { SuspectReview } from './SuspectReview';
import { ToolShell, ToolTile } from './ToolCard';
import type { DepthRange, DraftReport, Operation } from './types';
import { XrdPanel } from './XrdPanel';
import { PREPARATION_DOCK_ID } from './index';
import './preparation.css';

const subscribe = (cb: () => void) => snapshotRunner.subscribe(cb);
const f2 = (v: number) => formatNumber(v, { digits: 2 });
const count = (v: number) => v.toLocaleString('es-AR');

interface Proposal {
  base: Project;
  project: Project;
  key: string;
  draftKey: string;
  curveId: string;
  nodeId: string;
  batchNodeIds?: string[];
  operation: Operation;
}

interface ToolDef {
  id: ToolId;
  title: string;
  icon: IconName;
  description: string;
}

export const TOOLS: readonly ToolDef[] = [
  { id: 'exclude', title: 'Excluir tramo', icon: 'eye-off', description: 'Quitá las mediciones de un tramo; el original se conserva.' },
  { id: 'suspects', title: 'Buscar espurios', icon: 'search', description: 'Señala picos frente a sus vecinos para excluirlos de a uno.' },
  { id: 'interpolate', title: 'Interpolar huecos', icon: 'activity', description: 'Estima faltantes cortos entre dos mediciones.' },
  { id: 'filter', title: 'Mediana móvil', icon: 'filter', description: 'Suaviza el ruido con una ventana en metros.' },
  { id: 'shift', title: 'Alinear en profundidad', icon: 'swap', description: 'Corre toda la curva una distancia constante en MD.' },
];

const STAGE_OF_TOOL: Record<ToolId, PipelineStage['id']> = { exclude: 'exclusion', suspects: 'exclusion', interpolate: 'interpolation', filter: 'median', shift: 'alignment' };

const APPLY_VERB: Record<Operation, string> = { exclude: 'Excluir mediciones de', interpolate: 'Interpolar faltantes de', filter: 'Filtrar con mediana', shift: 'Alinear curva' };

function medianStep(depth: Float64Array): number {
  const n = Math.min(depth.length - 1, 512);
  if (n < 1) return 0.1524;
  const d: number[] = [];
  for (let i = 1; i <= n; i++) d.push(depth[i]! - depth[i - 1]!);
  d.sort((a, b) => a - b);
  return d[d.length >> 1]! || 0.1524;
}

const clampRange = (r: DepthRange, w: DepthRange): DepthRange => {
  const top = Math.max(w.top, Math.min(r.top, r.base));
  const base = Math.min(w.base, Math.max(r.top, r.base));
  return base > top ? { top, base } : w;
};

/**
 * Lo que el panel recuerda entre montajes (curva, vista, pestaña y tramo marcado, por pozo). El panel se monta solo con
 * su pestaña a la vista —oculto no recalcula vistas previas ni redibuja—; las herramientas abiertas se descartan.
 */
interface Remembered {
  wellId: string;
  curveId: string;
  view: DepthRange;
  follow: boolean;
  tab: string;
  selection: DepthRange | null;
}
let remembered: Remembered | null = null;

export function PreparationPanel() {
  const entry = useProject(selectActiveEntry);
  const active = useUi((s) => s.dockTab === PREPARATION_DOCK_ID && !s.layout.dockCollapsed && !s.readingMode);
  if (!active) return null;
  if (!entry) {
    return (
      <div className="prep prep--empty">
        <EmptyState
          size="sm"
          icon="filter"
          title="Cargá un pozo para preparar sus datos"
          description="Acá se excluyen tramos y espurios, se interpolan huecos, se filtra con mediana y se alinean curvas, con vista previa y el original siempre guardado."
          actions={
            <Button variant="primary" icon="upload" onClick={() => useUi.getState().set({ loadDialog: {} })}>
              Cargar pozo
            </Button>
          }
        />
      </div>
    );
  }
  return <Workspace key={entry.well.id} wellId={entry.well.id} />;
}

function Workspace({ wellId }: { wellId: string }) {
  const project = useProject((s) => s.project);
  const commit = useProject((s) => s.commit);
  const lastChange = useProject((s) => s.lastChange);
  const canUndo = useProject((s) => s.canUndo);
  const entry = project.wells.find((e) => e.well.id === wellId) as WellEntry;
  const result = useResults((s) => s.result);
  const qc = useWellQc(entry.well);
  const visible = useViewer((s) => s.visible);
  const viewerDepth = useViewer((s) => s.cursorDepth);
  const compare = usePreparationUi((s) => s.compareOriginals);
  const request = usePreparationUi((s) => s.request);
  const theme = useResolvedTheme();

  const depth = entry.well.depth.values;
  const step = entry.well.depth.step ?? medianStep(depth);
  const wellRange = useMemo<DepthRange>(() => ({ top: depth[0] ?? 0, base: depth[depth.length - 1] ?? 1 }), [depth]);
  const measured = useMemo(() => entry.well.curves.filter((c) => c.origin.kind === 'measured'), [entry.well.curves]);

  const memory = remembered?.wellId === wellId ? remembered : null;
  const [curveId, setCurveId] = useState(() => {
    const asked = request?.curveId && measured.some((c) => c.id === request.curveId) ? request.curveId : null;
    const kept = memory && measured.some((c) => c.id === memory.curveId) ? memory.curveId : null;
    return asked ?? kept ?? measured.find((c) => c.role === 'GR')?.id ?? measured[0]?.id ?? '';
  });
  const [view, setView] = useState<DepthRange>(() => (memory ? clampRange(memory.view, wellRange) : visible ? clampRange(visible, wellRange) : wellRange));
  const [follow, setFollow] = useState(memory?.follow ?? false);
  const [selection, setSelection] = useState<DepthRange | null>(memory?.selection ?? null);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [tab, setTab] = useState(memory?.tab ?? 'clean');
  useEffect(() => {
    remembered = { wellId, curveId, view, follow, tab, selection };
  }, [wellId, curveId, view, follow, tab, selection]);
  const [runId, setRunId] = useState('');
  const [report, setReport] = useState<DraftReport | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suspects, setSuspects] = useState<readonly number[]>([]);
  const [applied, setApplied] = useState<string | null>(null);

  const selectCurve = useCallback((id: string) => {
    setCurveId(id);
    setRunId('');
    setReport(null);
    setProposal(null);
    setSuspects([]);
    setError(null);
  }, []);

  // Pedido de otra parte de la app (columna izquierda, paleta): toma la curva y lo limpia.
  useEffect(() => {
    if (!request) return;
    if (request.curveId && measured.some((c) => c.id === request.curveId)) selectCurve(request.curveId);
    setTab('clean');
    usePreparationUi.setState({ request: null });
  }, [request, measured, selectCurve]);

  useEffect(() => {
    if (follow && visible) setView(clampRange(visible, wellRange));
  }, [follow, visible, wellRange]);

  const curve = entry.well.curves.find((c) => c.id === curveId);
  const nodes = entry.interpretation.preparation?.nodes;
  const appliedNode = nodes?.find((n) => n.input.curveId === curveId);
  const appliedId = appliedNode ? preparedCurveId(appliedNode.id, 'masked') : '';
  const appliedPayload = appliedNode ? result?.preparation?.artifacts.find((a) => a.id === appliedId) : undefined;
  const inUse = !!curve?.role && entry.interpretation.sources[curve.role]?.kind === 'curve' && (entry.interpretation.sources[curve.role] as { curveId: string }).curveId === appliedId;

  const onReport = useCallback((r: DraftReport) => {
    setReport((prev) => (prev && prev.draft?.key === r.draft?.key && prev.reason === r.reason ? prev : r));
  }, []);
  const openTool = (id: ToolId | 'saved') => {
    if (id === 'saved') {
      setTab('saved');
      return;
    }
    setTab('clean');
    setTool(id);
    setReport(null);
    setApplied(null);
    if (id !== 'suspects') setSuspects([]);
  };
  const closeTool = () => {
    setTool(null);
    setReport(null);
    setProposal(null);
    setSuspects([]);
  };

  // Vista previa viva: el borrador se convierte en propuesta (con pausa corta) cada vez que cambia o cambia el proyecto.
  const draft = tool ? (report?.draft ?? null) : null;
  useEffect(() => {
    if (!draft) {
      setProposal(null);
      setBuildError(null);
      return;
    }
    const t = setTimeout(() => {
      try {
        const next = draft.build(project);
        const e = next.wells.find((x) => x.well.id === wellId)!;
        entryPreparationPlan(next, e, registry);
        const all = e.interpretation.preparation!.nodes;
        const nodeId = all.find((n) => n.input.curveId === curveId)!.id;
        const batch = draft.batchCurveIds ? all.filter((n) => draft.batchCurveIds!.includes(n.input.curveId)).map((n) => n.id) : undefined;
        setProposal({ base: project, project: next, key: `preparation-preview:${makeId('job')}`, draftKey: draft.key, curveId, nodeId, operation: draft.operation, ...(batch ? { batchNodeIds: batch } : {}) });
        setBuildError(null);
      } catch (err) {
        setProposal(null);
        setBuildError(err instanceof Error ? err.message : String(err));
      }
    }, 160);
    return () => clearTimeout(t);
  }, [draft, project, wellId, curveId]);

  const current = proposal && proposal.base === project && proposal.draftKey === draft?.key && proposal.curveId === curveId ? proposal : null;
  const previewRequest = useMemo(() => {
    if (!current) return null;
    const e = current.project.wells.find((x) => x.well.id === wellId)!;
    return { entry: e, plan: entryPreparationPlan(current.project, e, registry) };
  }, [current, wellId]);
  useEffect(() => {
    if (!current || !previewRequest) return;
    return snapshotRunner.acquire(current.key, toEngineWell(previewRequest.entry.well), previewRequest.entry.interpretation, previewRequest.plan.context, previewRequest.plan);
  }, [current, previewRequest]);
  const preview = useSyncExternalStore(subscribe, () => (current ? (snapshotRunner.get(current.key) ?? null) : null));
  const previewResult = preview?.status === 'ready' ? preview.result : null;
  const previewId = current ? preparedCurveId(current.nodeId, 'masked') : '';
  const previewPayload = previewResult?.preparation?.artifacts.find((a) => a.id === previewId);
  const ready = !!previewPayload && !!previewRequest && sameContext(previewResult?.context, previewRequest.plan.context);
  const previewNode = previewRequest?.entry.interpretation.preparation?.nodes.find((n) => n.input.curveId === curveId);

  // Última vista previa lista (para no parpadear mientras se recalcula la siguiente).
  const last = useRef<{ curveId: string; tool: ToolId; view: PreparedView } | null>(null);
  if (ready && previewPayload && tool) last.current = { curveId, tool, view: previewPayload };
  if (!tool || last.current?.curveId !== curveId || last.current?.tool !== tool) last.current = null;
  const shownPreview: PreparedView | null = ready && previewPayload ? previewPayload : draft ? (last.current?.view ?? null) : null;
  const stale = !!draft && !ready && !!shownPreview;

  // Conteos de la vista previa (los mismos que usaba el diálogo).
  const counts = ready && previewPayload ? stageQualityCounts(previewPayload.quality) : null;
  // Exclusiones que agrega la vista previa (las ya aplicadas no cuentan).
  const appliedExcluded = useMemo(() => (appliedPayload ? stageQualityCounts(appliedPayload.quality).newlyExcluded : 0), [appliedPayload]);
  const addedExcluded = counts ? Math.max(0, counts.newlyExcluded - appliedExcluded) : 0;
  const aligned = ready && previewPayload ? alignmentQualityCounts(previewPayload.data, previewPayload.quality) : null;
  const batchReady = !current?.batchNodeIds || current.batchNodeIds.every((id) => previewResult?.preparation?.artifacts.some((a) => a.id === preparedCurveId(id, 'masked') && a.data.some(Number.isFinite)));
  const zeroReason =
    !ready || !current
      ? null
      : current.operation === 'interpolate' && !(previewPayload?.sourceCounts?.interpolated ?? counts?.interpolated ?? 0)
        ? 'No hay huecos que cumplan los límites: ajustá el tramo o la distancia máxima.'
        : current.operation === 'filter' && !(previewPayload?.sourceCounts?.filtered ?? counts?.filtered ?? 0)
          ? 'No hay ventanas con soporte completo: revisá radio, separación y tramo.'
          : current.operation === 'shift' && !(aligned?.finite ?? 0)
            ? 'No queda cobertura: ajustá el desplazamiento o el hueco máximo.'
            : current.operation === 'exclude' && !addedExcluded
              ? 'El tramo no agrega mediciones para excluir: ya están excluidas o sin dato.'
              : !batchReady
                ? 'Alguna curva de la corrida queda sin cobertura: ajustá el desplazamiento.'
                : null;
  const canApply = ready && !zeroReason && useProject.getState().project === current?.base;
  const motive = !tool
    ? null
    : (report?.reason ?? buildError ?? (preview?.status === 'error' ? preview.message : zeroReason));
  const calculating = !!tool && !motive && !ready;

  const apply = () => {
    try {
      if (!current || !canApply || useProject.getState().project !== current.base) throw new Error('Cambió el proyecto o el tramo. Esperá la nueva vista previa.');
      const label = `${current.operation === 'shift' && runId ? 'Alinear corrida' : APPLY_VERB[current.operation]} ${curve?.mnemonic ?? curveId}`;
      commit(label, (p) => (p === current.base ? current.project : p), { group: current.key });
      setApplied(label);
      setTool(null);
      setReport(null);
      setProposal(null);
      setSelection(null);
      setSuspects([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Tarjetas de curva: banderas del resultado vigente (o faltantes del original) + picos del control de calidad.
  const cards = useMemo<CardInfo[]>(
    () =>
      measured.map((c) => {
        const node = nodes?.find((n) => n.input.curveId === c.id);
        const id = node ? preparedCurveId(node.id, 'masked') : '';
        const payload = node ? result?.preparation?.artifacts.find((a) => a.id === id) : undefined;
        const cqc = qc?.curves.find((x) => x.curveId === c.id);
        const base = payload?.quality.length === c.data.length ? payload.quality : qualityOf(c.data);
        const source = c.role ? entry.interpretation.sources[c.role] : undefined;
        return { curve: c, quality: cqc?.spikeIndices.length ? withSuspects(base, cqc.spikeIndices) : base, qc: cqc, prepared: !!node, inUse: source?.kind === 'curve' && source.curveId === id };
      }),
    [measured, nodes, result, qc, entry.interpretation.sources],
  );

  const stages = useMemo(
    () =>
      curve
        ? pipelineStages({ original: curve.data, applied: appliedNode, appliedView: appliedPayload ?? null, preview: draft ? (previewNode ?? appliedNode) : undefined, previewView: draft ? shownPreview : null, inUse, role: curve.role })
        : [],
    [curve, appliedNode, appliedPayload, draft, previewNode, shownPreview, inUse],
  );

  // Ventana del gráfico y sus banderas (con los sospechosos de vista).
  const win = useMemo(() => indexRange(depth, view.top, view.base), [depth, view]);
  const afterData = shownPreview?.data ?? appliedPayload?.data ?? null;
  const chartQuality = useMemo(() => {
    if (!curve) return new Uint16Array(0);
    const base = shownPreview?.quality ?? appliedPayload?.quality ?? qualityOf(curve.data);
    const spikes = qc?.curves.find((x) => x.curveId === curve.id)?.spikeIndices ?? [];
    const q = spikes.length || suspects.length ? withSuspects(base, [...spikes, ...suspects]) : base;
    return q.slice(win.start, win.end);
  }, [curve, shownPreview, appliedPayload, qc, suspects, win]);

  const zones = entry.interpretation.zones;
  const zoneValue = sameRange(view, wellRange) ? 'well' : (zones.find((z) => sameRange(view, z))?.id ?? 'custom');
  const toolRange = selection ?? view;
  const problem = curve ? interpolationSourceProblem(curve) : 'Elegí una curva.';
  const mgtBlocked = appliedNode?.kind === 'mgt-borehole' ? 'Retirá la corrección MGT (pestaña Correcciones / MGT) para usar las etapas de limpieza.' : null;
  const acquisition = project.inputRevisions?.[entry.inputRevisionId ?? '']?.acquisition;
  const runCurveIds = acquisition?.runs.find((r) => r.id === runId)?.curveIds ?? [];
  const style = curve ? curveStyle(curve.role, theme, registry.roles, curve.id) : null;
  const toolDef = TOOLS.find((t) => t.id === tool);
  const stageOf = (t: ToolId) => stages.find((s) => s.id === STAGE_OF_TOOL[t]);
  const statusOf = (t: ToolId) => {
    if (t === 'suspects') return undefined; // comparte la etapa Exclusión: su estado lo dice «Excluir tramo»
    const s = stageOf(t);
    return s?.state === 'done' ? { tone: 'ok' as const, label: 'Aplicada' } : s?.state === 'blocked' ? { tone: 'warn' as const, label: 'No combinable' } : undefined;
  };

  const xrdSets = entry.well.pointSets.filter((s) => s.kind === 'xrd').length;
  const borehole = qc?.borehole ? qc.borehole.washouts.length + qc.borehole.invalidCaliper.length : 0;
  const tabs = [
    { id: 'clean', label: 'Limpieza', icon: 'filter' as const, badge: null },
    { id: 'xrd', label: 'DRX y GR', icon: 'layers' as const, badge: xrdSets || null },
    { id: 'env', label: 'Ambiente', icon: 'activity' as const, badge: borehole || null },
    { id: 'mgt', label: 'Correcciones', icon: 'sliders' as const, badge: nodes?.some((n) => n.kind === 'mgt-borehole') ? 'activa' : null },
    { id: 'runs', label: 'Corridas', icon: 'swap' as const, badge: acquisition?.runs.length || null },
    { id: 'saved', label: 'Guardadas', icon: 'save' as const, badge: nodes?.length || null },
  ];

  const toolBody = (() => {
    if (!tool || !curve) return null;
    const common = { wellId, curveId, onReport };
    if (mgtBlocked) return <Callout tone="warn">{mgtBlocked}</Callout>;
    switch (tool) {
      case 'exclude':
        return <ExclusionEditor key={curveId} {...common} selection={selection} view={view} onSelect={setSelection} onClear={() => setSelection(null)} />;
      case 'suspects':
        return <SuspectReview key={curveId} entry={entry} curveId={curveId} range={toolRange} fromSelection={!!selection} step={step} onReport={onReport} onCandidates={setSuspects} onClear={() => setSelection(null)} />;
      case 'interpolate':
        return <InterpolationEditor key={curveId} {...common} problem={problem} range={toolRange} fromSelection={!!selection} step={step} onClear={() => setSelection(null)} />;
      case 'filter':
        return <FilterEditor key={curveId} {...common} problem={problem ? problem.replace('La interpolación', 'El filtro') : null} range={toolRange} fromSelection={!!selection} step={step} onClear={() => setSelection(null)} />;
      case 'shift':
        return (
          <ShiftEditor
            key={`${curveId}:${runId}`}
            {...common}
            runId={runId}
            runCurveIds={runCurveIds}
            knownDatum={acquisition?.depth.datum ?? null}
            problem={problem ? problem.replace('La interpolación', 'La alineación') : null}
            step={step}
          />
        );
    }
  })();

  const summary = (() => {
    if (!ready || !counts || !current) return null;
    switch (current.operation) {
      case 'exclude':
        return appliedExcluded
          ? `${count(addedExcluded)} mediciones más pasan a sin dato (${count(counts.newlyExcluded)} excluidas en total) · ${count(counts.originallyMissing)} ya faltaban.`
          : `${count(counts.newlyExcluded)} mediciones pasan a sin dato · ${count(counts.originallyMissing)} ya faltaban.`;
      case 'interpolate':
        return `${count(previewPayload?.sourceCounts?.interpolated ?? counts.interpolated)} muestras estimadas por interpolación. Son estimaciones, no mediciones.`;
      case 'filter':
        return `${count(previewPayload?.sourceCounts?.filtered ?? counts.filtered)} muestras filtradas · ${count(counts.estimatedInfluence)} con influencia de estimaciones.`;
      case 'shift':
        return aligned ? `${count(aligned.finite)} salidas con dato · ${count(aligned.unsupported)} sin soporte · ${count(aligned.estimatedSupport)} con soporte estimado.` : null;
    }
  })();

  const footer = tool ? (
    <>
      <div className="prep-apply__status" role="status">
        {calculating ? (
          <>
            <Spinner size={12} /> Calculando la vista previa…
          </>
        ) : motive ? (
          <span className="prep-motive">
            <Icon name="info" size={13} /> {motive}
          </span>
        ) : summary ? (
          <span>{summary}</span>
        ) : null}
      </div>
      {current?.batchNodeIds && ready && (
        <ul className="prep-batch" aria-label="Cobertura de la corrida">
          {current.batchNodeIds.map((id) => {
            const n = previewRequest?.entry.interpretation.preparation?.nodes.find((x) => x.id === id);
            const a = previewResult?.preparation?.artifacts.find((x) => x.id === preparedCurveId(id, 'masked'));
            return (
              <li key={id}>
                <span>{entry.well.curves.find((c) => c.id === n?.input.curveId)?.mnemonic}</span>
                <span className="num">{a ? `${count(alignmentQualityCounts(a.data, a.quality).finite)} con dato` : 'sin resultado'}</span>
              </li>
            );
          })}
        </ul>
      )}
      {ready && !motive && <p className="prep-help">{curve?.role ? `Al aplicar, ${curve.role} usará «${curve.mnemonic} preparada». El original y el historial se conservan.` : 'Se guarda una curva preparada para comparar y exportar, sin asignarla a un rol.'}</p>}
      <div className="prep-apply__buttons">
        <Button size="sm" variant="ghost" onClick={closeTool}>
          Descartar
        </Button>
        <Button size="sm" variant="primary" icon="check" disabled={!canApply} onClick={apply}>
          {curve?.role ? `Aplicar y usar para ${curve.role}` : 'Aplicar'}
        </Button>
      </div>
    </>
  ) : null;

  return (
    <div className="prep">
      <div className="prep-top">
        <Tabs aria-label="Secciones de Preparar datos" idBase="prep" size="sm" value={tab} onChange={setTab} items={tabs} />
        <div className="prep-range" role="group" aria-label="Tramo de la vista">
          <span className="prep-range__label">Vista</span>
          <Select
            aria-label="Zona de la vista"
            size="sm"
            value={zoneValue}
            onChange={(v) => {
              if (v === 'well') setView(wellRange);
              const z = zones.find((x) => x.id === v);
              if (z) setView(clampRange(z, wellRange));
              setFollow(false);
              setSelection(null);
            }}
            options={[{ value: 'well', label: 'Pozo completo' }, ...zones.map((z: Zone) => ({ value: z.id, label: `Zona ${z.name}` })), ...(zoneValue === 'custom' ? [{ value: 'custom', label: 'Tramo libre' }] : [])]}
          />
          <NumberField aria-label="Tope de la vista (m MD)" size="sm" width={84} value={view.top} min={wellRange.top} max={wellRange.base} step={0.01} onChange={(v) => { setFollow(false); setView(clampRange({ top: v, base: view.base }, wellRange)); }} />
          <span className="prep-range__dash" aria-hidden="true">–</span>
          <NumberField aria-label="Base de la vista (m MD)" size="sm" width={84} value={view.base} min={wellRange.top} max={wellRange.base} step={0.01} unit="m" onChange={(v) => { setFollow(false); setView(clampRange({ top: view.top, base: v }, wellRange)); }} />
          <Button size="sm" icon="fit-height" disabled={!visible} onClick={() => { if (visible) { setView(clampRange(visible, wellRange)); setSelection(null); } }} title={visible ? 'Tomar el tramo que muestra el visor' : 'El visor todavía no informó su tramo.'}>
            Usar tramo visible
          </Button>
          <Switch checked={follow} onChange={setFollow} label="Seguir el visor" disabled={!visible} />
        </div>
      </div>
      <CurveCards cards={cards} value={curveId} onChange={selectCurve} />

      <TabPanel id="clean" idBase="prep" active={tab === 'clean'} className="prep-tab">
        {tab === 'clean' &&
          (!curve ? (
            <EmptyState size="sm" icon="curve" title="El pozo no tiene curvas medidas" description="Cargá un archivo con perfiles para prepararlos." />
          ) : (
            <>
              <Pipeline stages={stages} activeTool={tool} onOpen={openTool} />
              {applied && lastChange === applied && canUndo && (
                <div className="prep-applied" role="status">
                  <Icon name="check-circle" size={15} />
                  <span className="prep-applied__text">
                    Aplicado: <strong>{applied}</strong> <span>· el original se conserva (pestaña Guardadas).</span>
                  </span>
                  <Button size="sm" variant="ghost" icon="undo" onClick={undoChange}>
                    Deshacer
                  </Button>
                </div>
              )}
              {error && <Callout tone="error">{error}</Callout>}
              {appliedNode?.kind === 'constant-shift' && tool && tool !== 'shift' && (
                <Callout tone="warn">Curva alineada: el tramo de esta herramienta usa la MD de origen, antes del corrimiento.</Callout>
              )}
              <div className={`prep-main${tool ? ' has-tool' : ''}`}>
                <section className="prep-card-box prep-chart-box" aria-label={`Antes y después de ${curve.mnemonic}`}>
                  <header className="prep-box__head">
                    <h3 className="prep-box__title">
                      <span style={{ color: style?.color }}>{curve.mnemonic}</span> · antes y después
                    </h3>
                    <span className="prep-muted num">
                      {f2(view.top)} – {f2(view.base)} m · {count(Math.max(0, win.end - win.start))} muestras
                    </span>
                    {stale && (
                      <span className="prep-muted">
                        <Spinner size={11} /> actualizando
                      </span>
                    )}
                    <span className="prep-spacer" />
                    <Switch checked={compare} onChange={(v) => usePreparationUi.setState({ compareOriginals: v })} label="Comparar en el visor" />
                  </header>
                  {win.end - win.start < 2 ? (
                    <EmptyState size="sm" icon="fit-height" title="El tramo no tiene muestras" description="Elegí una zona, «Pozo completo» o «Usar tramo visible»." />
                  ) : (
                    <BeforeAfterChart
                      height={290}
                      mnemonic={curve.mnemonic}
                      afterLabel={shownPreview ? 'Vista previa' : appliedPayload ? 'Preparada' : null}
                      depth={depth}
                      start={win.start}
                      end={win.end}
                      original={curve.data}
                      after={afterData}
                      quality={chartQuality}
                      color={style?.color ?? 'currentColor'}
                      log={style?.scale === 'log'}
                      unit={curve.unit}
                      zones={zones}
                      selection={selection}
                      viewerDepth={viewerDepth}
                      stale={stale}
                      onSelect={(r) => setSelection(r)}
                    />
                  )}
                </section>
                <div className="prep-tools" aria-label="Herramientas">
                  {tool && toolDef ? (
                    <ToolShell title={toolDef.title} icon={toolDef.icon} description={toolDef.description} status={statusOf(tool)} onClose={closeTool} footer={mgtBlocked ? null : footer}>
                      {toolBody}
                    </ToolShell>
                  ) : (
                    <>
                      <p className="prep-tools__hint">Elegí una herramienta. La vista previa se dibuja en el gráfico; nada cambia hasta «Aplicar».</p>
                      {TOOLS.map((t) => (
                        <ToolTile
                          key={t.id}
                          title={t.title}
                          icon={t.icon}
                          description={t.description}
                          status={statusOf(t.id)}
                          disabledReason={mgtBlocked ?? (t.id === 'exclude' || t.id === 'suspects' ? null : problem)}
                          onOpen={() => openTool(t.id)}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            </>
          ))}
      </TabPanel>
      <TabPanel id="xrd" idBase="prep" active={tab === 'xrd'} className="prep-tab prep-tab--legacy">
        {tab === 'xrd' && <XrdPanel project={project} entry={entry} />}
      </TabPanel>
      <TabPanel id="env" idBase="prep" active={tab === 'env'} className="prep-tab prep-tab--legacy">
        {tab === 'env' && <EnvironmentDiagnosticPanel project={project} entry={entry} top={view.top} base={view.base} />}
      </TabPanel>
      <TabPanel id="mgt" idBase="prep" active={tab === 'mgt'} className="prep-tab prep-tab--legacy">
        {tab === 'mgt' && (curve ? <EnvironmentPanel project={project} entry={entry} curveId={curveId} /> : null)}
      </TabPanel>
      <TabPanel id="runs" idBase="prep" active={tab === 'runs'} className="prep-tab prep-tab--legacy">
        {tab === 'runs' && curve && (
          <>
            <RunEditor runId={runId} project={project} entry={entry} curveId={curveId} onChange={(id) => { setRunId(id); setProposal(null); }} />
            {runId && (
              <Callout tone="info" actions={<Button size="sm" onClick={() => openTool('shift')}>Abrir Alinear en profundidad</Button>}>
                Corrida {runId} elegida: «Alinear en profundidad» la va a correr entera.
              </Callout>
            )}
            <CorrelationReview key={`${curveId}:${entry.inputRevisionId}`} entry={entry} curveId={curveId} top={view.top} base={view.base} />
          </>
        )}
      </TabPanel>
      <TabPanel id="saved" idBase="prep" active={tab === 'saved'} className="prep-tab">
        {tab === 'saved' && (
          <>
            {error && <Callout tone="error">{error}</Callout>}
            <SavedPreparations entry={entry} result={result} onError={setError} onOpenCurve={(id) => { selectCurve(id); setTab('clean'); }} />
          </>
        )}
      </TabPanel>
    </div>
  );
}

function sameRange(a: DepthRange, b: { top: number; base: number }): boolean {
  return Math.abs(a.top - b.top) < 1e-6 && Math.abs(a.base - b.base) < 1e-6;
}
