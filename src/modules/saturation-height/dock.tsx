import { useMemo, useRef, useState } from 'react';
import { entryContext } from '../../app/preparation/data';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { useUi } from '../../app/store/ui';
import { useTrendsUi } from '../../app/trends/store';
import { sameContext } from '../../core/engine/context';
import { canonicalJson } from '../../core/state/tracks';
import type { SourceRef } from '../../core/interpretation';
import { pointTexts } from '../../core/pointSets';
import { enableProjectInputRevisions } from '../../core/state/inputRevisions';
import { addPointSet } from '../../core/state/pointSets';
import { activeWellEntry, makeId, type WellEntry } from '../../core/state/project';
import { niceRange } from '../../plots/xy/axes';
import { XYPlot } from '../../plots/xy/XYPlot';
import { Badge, Button, Callout, DataTable, EmptyState, Field, Select, TextArea, formatNumber, toast, useThemeTokens } from '../../ui';
import { ensureContrast } from '../../ui/color';
import type { DockPanelDef } from '../../ui/dockPanel';
import { classColor } from '../rock-typing/draw';
import { CAPILLARY_KIND, classCount, classLabel, rockModuleParams } from '../rock-typing/model';
import { SATURATION_HEIGHT_ID } from './index';
import { HEIGHT_LAB_KIND, readHeightLab } from './lab';
import { applyHeightScenario, heightDecisionKey, heightPreview, mdtSelections } from '../../app/saturationHeight/model';
import { readHeightScenario, scenarioTemplate, type HeightScenario } from './scenario';
import './height.css';

const format = (value: number, digits = 2) => formatNumber(value, { digits });
const all = '*';
const sourceName = (source: SourceRef | null) => source ? source.kind === 'curve' ? source.curveId : source.moduleId : 'no disponible';

function savedState(entry: WellEntry) {
  const state = entry.interpretation.moduleState?.[SATURATION_HEIGHT_ID];
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  if (!('version' in state) || state.version !== 1 || !('scenario' in state) || !('filters' in state)) return null;
  const filters = state.filters;
  if (!filters || typeof filters !== 'object' || !('zone' in filters) || !('rock' in filters) ||
    typeof filters.zone !== 'string' || typeof filters.rock !== 'string') return null;
  try {
    return {
      scenario: readHeightScenario(state.scenario), filters: { zone: filters.zone, rock: filters.rock },
      revision: 'inputRevisionId' in state ? state.inputRevisionId : null,
      key: 'decisionKey' in state ? state.decisionKey : null,
      sources: 'engineSources' in state ? state.engineSources : null,
    };
  } catch { return null; }
}

function HeightPanel({ entry }: { entry: WellEntry }) {
  const project = useProject(s => s.project);
  const results = useResults();
  const activeResult = useMemo(() => !results.busy && !results.error && results.result &&
    sameContext(results.result.context, entryContext(entry, project)) ? results.result : null,
  [results, entry, project]);
  const tokens = useThemeTokens();
  const theme = tokens.name;
  const params = rockModuleParams(entry.interpretation.params);
  const nClasses = classCount(params);
  const className = (value: number | null) => value === null ? 'Sin tipo' : classLabel(params.method, value);
  const palette = Array.from({ length: nClasses }, (_, i) => ensureContrast(classColor(i, nClasses, theme), tokens.color.surface));
  const color = (value: number | null) => value === null ? tokens.color.textMuted : palette[value] ?? tokens.color.textMuted;
  const labInput = useRef<HTMLInputElement>(null);
  const saved = savedState(entry);
  const [draft, setDraft] = useState<{ text: string; receipt: unknown } | null>(null);
  const receipt = entry.interpretation.moduleState?.[SATURATION_HEIGHT_ID];
  const template = () => JSON.stringify({ ...scenarioTemplate,
    domainM: [entry.well.depth.values[0], entry.well.depth.values.at(-1)],
    classification: { method: params.method, bounds: params.method === 'fzi' ? params.bounds : [] },
  }, null, 2);
  const stale = !!saved && (saved.revision !== entry.inputRevisionId || saved.key !== heightDecisionKey(entry) ||
    (!!activeResult && canonicalJson(saved.sources) !== canonicalJson({ sw: activeResult.sources.SW ?? null, rock: activeResult.sources.ROCK_TYPE ?? null })));
  const currentDraft = draft?.receipt === receipt && draft;
  const text = currentDraft ? currentDraft.text : saved && !stale ? JSON.stringify(saved.scenario, null, 2) : '';
  const [demo, setDemo] = useState(false);
  const [filterSelection, setFilterSelection] = useState<{ receipt: unknown; zone: string; rock: string } | null>(null);
  const filters = filterSelection?.receipt === receipt && filterSelection ? filterSelection : saved && !stale ? saved.filters : { zone: all, rock: all };
  const { zone, rock } = filters;
  const setZone = (value: string) => setFilterSelection({ receipt, zone: value, rock });
  const setRock = (value: string) => setFilterSelection({ receipt, zone, rock: value });
  const [error, setError] = useState('');
  const zones = new Map(entry.interpretation.zones.map(z => [z.id, z.name]));
  const zoneName = (id: string | null) => id === null ? 'Sin zona' : zones.get(id) ?? id;
  const evaluated = useMemo(() => {
    if (!activeResult || (!demo && !text.trim())) return null;
    try {
      const scenario: HeightScenario | 'demo' = demo ? 'demo' : readHeightScenario(JSON.parse(text));
      return { preview: heightPreview(entry, activeResult, scenario), scenario: scenario as HeightScenario | 'demo', problem: null };
    } catch (cause) {
      return { preview: null, scenario: null, problem: (cause as Error).message };
    }
  }, [activeResult, demo, text, entry]);
  const preview = evaluated?.preview;
  const points = (preview?.points ?? []).filter(p => (zone === all || zone === (p.zoneId ?? '')) && (rock === all || rock === String(p.rockType ?? '')));
  const support = (preview?.support ?? []).filter(p => (zone === all || zone === (p.zoneId ?? '')) && (rock === all || rock === String(p.rockType ?? '')));
  const shownTypes = new Set(points.map(p => p.rockType));
  const unmodeled = [...shownTypes].filter((type): type is number => type !== null && !preview?.lines.some(line => line.rockType === type));
  const lines = (preview?.lines ?? []).filter(line => (rock === all || rock === String(line.rockType)) && (zone === all || shownTypes.has(line.rockType)));
  let minH = 0, maxH = 0;
  for (const point of points) { minH = Math.min(minH, point.h); maxH = Math.max(maxH, point.h); }
  if (zone === all || !points.length) for (const line of lines) { minH = Math.min(minH, line.h[0]!); maxH = Math.max(maxH, line.h.at(-1)!); }
  const range = niceRange([[minH, maxH]], 'linear') ?? { min: -1, max: 1 };
  const apply = () => {
    if (!activeResult || !evaluated?.scenario || evaluated.scenario === 'demo') return;
    const scenario = evaluated.scenario;
    try {
      useProject.getState().commit('Guardar escenario de saturación por altura', p => applyHeightScenario(p, entry, activeResult, scenario, { zone, rock }));
      setError('');
      toast({ tone: 'ok', title: 'Escenario guardado con snapshot' });
    } catch (cause) { setError((cause as Error).message); }
  };
  const importLab = async (file: File | undefined) => {
    if (!file) return;
    try {
      const set = readHeightLab(await file.text(), file.name, makeId('capillary'));
      useProject.getState().commit('Cargar ensayo capilar', p => {
        if (activeWellEntry(p) !== entry) throw new Error('El pozo cambió durante la carga.');
        return addPointSet(enableProjectInputRevisions(p), entry.well.id, set);
      });
      setError('');
    } catch (cause) { setError((cause as Error).message); }
  };
  const goMdt = () => useUi.setState({ dockTab: 'mdt' });
  return <div data-testid="saturation-height" className="height-panel">
    <section className="height-chart" aria-label="Comparación de saturación">
      <div className="height-toolbar">
        <h2>Saturación por altura</h2><Badge tone="warn">{demo ? 'Demostración híbrida' : 'Exploratorio'}</Badge>
      </div>
      <div className="height-toolbar">
        <Field label="Zona" htmlFor="height-zone"><Select id="height-zone" value={zone} onChange={setZone} options={[{ value: all, label: 'Todas' }, ...entry.interpretation.zones.map(z => ({ value: z.id, label: z.name })), { value: '', label: 'Sin zona' }]} /></Field>
        <Field label="Tipo de roca" htmlFor="height-rock"><Select id="height-rock" value={rock} onChange={setRock} options={[{ value: all, label: 'Todos' }, ...Array.from({ length: nClasses }, (_, i) => ({ value: String(i), label: className(i) })), { value: '', label: 'Sin tipo' }]} /></Field>
      </div>
      {demo && <Callout tone="warn">Sw y clases del perfil seleccionado. Referencia MD, FWL, gradientes y curvas capilares ilustrativos. Este escenario no se puede aplicar.</Callout>}
      {evaluated?.problem && <Callout tone="warn">{evaluated.problem}</Callout>}
      {!activeResult && <Callout tone="info">Esperando resultados vigentes del pozo.</Callout>}
      {preview && preview.fwlM !== null ? <>
        <p>FWL {format(preview.fwlM)} m · {demo ? 'referencia ilustrativa' : `${(evaluated.scenario as HeightScenario).datum} · ${(evaluated.scenario as HeightScenario).geometry.kind === 'vertical-md' ? 'MD como aproximación vertical' : 'TVD'}`} · Sw {sourceName(preview.sources.sw)} · tipos {sourceName(preview.sources.rock)}</p>
        <XYPlot
          x={{ label: 'Sw (v/v)', kind: 'linear', min: 0, max: 1 }}
          y={{ label: 'Altura sobre el nivel de agua libre (m)', kind: 'linear', ...range }}
          height={278} ariaLabel="Saturación de agua frente a altura sobre el nivel de agua libre"
          points={points.length ? [{ id: 'profile', name: 'Sw del perfil', x: points.map(p => p.sw), y: points.map(p => p.h), color: i => color(points[i]!.rockType),
            dense: true, interactive: true, alpha: 0.55, label: i => { const p = points[i]!; return `MD ${format(p.md)} m · ${zoneName(p.zoneId)} · ${className(p.rockType)} · Sw ${format(p.sw, 3)}`; } }] : []}
          onPointClick={(_, i) => { const md = points[i]?.md; if (md !== undefined) useTrendsUi.getState().requestRange(md - 10, md + 10); }}
          lines={lines.map(l => ({ id: String(l.rockType), name: `${className(l.rockType)} · ${l.reference}`, x: l.sw, y: l.h, width: 2, color: color(l.rockType) }))}
          guides={[{ axis: 'y', value: 0, color: tokens.color.textMuted, label: 'Agua libre', dash: [4, 4] }]}
          figureId={SATURATION_HEIGHT_ID} figureTitle={demo ? 'Saturación por altura · demostración híbrida' : 'Saturación por altura · exploratorio'}
        />
        <div className="height-legend">{[...shownTypes].sort((a, b) => (a ?? -1) - (b ?? -1)).map(type =>
          <span key={type ?? 'none'}><i style={{ backgroundColor: color(type) }} />{className(type)}</span>)}</div>
        {(lines.length > 0 || unmodeled.length > 0) && <details><summary>Procedencia y soporte de las curvas por clase</summary>
          <ul>{lines.map(line => <li key={line.rockType}>{className(line.rockType)} · {line.reference} · factor de presión {format(line.factor, 5)}</li>)}
          {unmodeled.map(type => <li key={type}>{className(type)} · {preview.pair ? 'Falta Pc–Sw compatible o soporte en el intervalo' : 'Faltan gradientes MDT admitidos y curva compatible'}</li>)}</ul>
        </details>}
        <p data-testid="height-count">{points.length} {points.length === 1 ? 'punto visible' : 'puntos visibles'} · {lines.length} {lines.length === 1 ? 'curva capilar' : 'curvas capilares'}</p>
        <details><summary>Soporte por zona y clase ({support.length})</summary>
          <DataTable
            dense
            rowKey={s => JSON.stringify([s.zoneId, s.rockType])}
            rows={support}
            columns={[
              { key: 'zone', header: 'Zona', render: s => zoneName(s.zoneId) },
              { key: 'rock', header: 'Tipo', render: s => className(s.rockType) },
              { key: 'points', header: 'Puntos', align: 'num', render: s => s.points },
              { key: 'missingSw', header: 'Sin Sw', align: 'num', render: s => s.missingSw },
              { key: 'missingGeometry', header: 'Sin geometría', align: 'num', render: s => s.missingGeometry },
              { key: 'outside', header: 'Fuera de intervalo', align: 'num', render: s => s.outside },
              { key: 'compared', header: 'Pares exploratorios', align: 'num', render: s => s.compared },
              { key: 'mae', header: 'MAE exploratorio', align: 'num', render: s => s.compared ? format(s.absoluteError / s.compared, 3) : '—' },
            ]}
          />
        </details>
      </> : <EmptyState size="sm" title="Falta un nivel de agua libre admisible" description="Revisá la geometría, el datum y el FWL antes de graficar la altura." />}
      {preview?.issues.map((issue, index) => <Callout key={index} tone="warn">{issue}</Callout>)}
      {preview?.pair && <details><summary>Ajustes de presiones MDT</summary>
        <p>Agua · n {preview.pair.water.n}, densidad {format(preview.pair.water.densityKgPerM3)} kg/m³, RMSE {format(preview.pair.water.rmsePa)} Pa.</p>
        <p>Hidrocarburo · n {preview.pair.hydrocarbon.n}, densidad {format(preview.pair.hydrocarbon.densityKgPerM3)} kg/m³, RMSE {format(preview.pair.hydrocarbon.rmsePa)} Pa.</p>
        <p>FWL al retirar pruebas · {preview.pair.fwlSensitivityM.map(z => format(z)).join(' a ')} m.</p>
        {preview.residualPa !== null && <p>Diferencia de presión residual en FWL externo · {format(preview.residualPa)} Pa.</p>}
      </details>}
    </section>
    <aside className="height-controls" aria-label="Entradas del escenario">
      <h3>Entradas</h3>
      <div className="height-toolbar">
        <Button size="sm" onClick={goMdt}>Revisar MDT</Button>
        <Button size="sm" onClick={() => setDemo(!demo)}>{demo ? 'Volver al escenario' : 'Ver demostración'}</Button>
      </div>
      <Callout tone="info">El SCAL del TP contiene Pd y seis niveles Swi sin presión por nivel. Para la línea por clase se requieren ensayos Pc–Sw compatibles o parámetros de reservorio trazados.</Callout>
      <details><summary>Tendencias MDT, geometría y ensayos disponibles</summary>
        <p>Gradientes revisables</p>
        <ul>{mdtSelections(entry).map(({ trend, fluid, set }) => <li key={trend.id}>{trend.name} · {fluid} · {set.name} · <code>{trend.id}</code></li>)}</ul>
        <p>Curvas de longitud</p>
        <ul>{entry.well.curves.filter(c => ['m', 'ft'].includes(c.unit)).map(c => <li key={c.id}><code>{c.id}</code> · {c.mnemonic}</li>)}</ul>
        <p>Ensayos capilares</p>
        <ul>{entry.well.pointSets.filter(s => s.kind === HEIGHT_LAB_KIND || s.kind === CAPILLARY_KIND).map(s => <li key={s.id}>{s.name} · <code>{s.id}</code> · {[...new Set(pointTexts(s, 'sample') ?? [])].join(', ')}</li>)}</ul>
      </details>
      <div>
        <Button size="sm" onClick={() => labInput.current?.click()}>Cargar tabla capilar (JSON)</Button>
        <input ref={labInput} hidden aria-label="Archivo de tabla capilar" type="file" accept=".json,application/json" onChange={e => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          void importLab(file);
        }} />
      </div>
      <details><summary>Formato de tabla y configuración</summary>
        <p>Tabla versión 1 con <code>reference</code>, <code>pressureUnit</code>, <code>saturationUnit</code> y <code>rows</code>. Cada fila contiene <code>sample</code>, <code>mdM</code>, <code>pc</code> y <code>sw</code>.</p>
        <p>En el escenario, elegí <code>fwl.kind</code> como <code>mdt</code> o <code>external</code>. El par MDT contiene <code>waterId</code>, <code>hydrocarbonId</code>, <code>review</code> y <code>pressureBasis</code>. Para TVD, indicá <code>curveId</code>, <code>direction</code>, <code>offsetM</code> y <code>maxGapM</code>.</p>
        <p>Por clase declarada se requiere <code>rockType</code> (índice desde cero), <code>reference</code>, <code>conditions</code>, <code>assignment</code>, <code>saturationBasis</code> <code>basis</code> y <code>model</code>. La base declara drenaje primario, fase de destino y presión de laboratorio o reservorio. Las condiciones consignadas en el escenario son declaraciones revisadas. Usá <code>point-set</code> con <code>setId</code> y <code>sample</code>, o <code>brooks-corey</code> con <code>entryPressurePa</code>, <code>lambda</code>, <code>irreducibleSw</code>, <code>rangePa</code> y <code>entryPlateau</code>.</p>
      </details>
      <div className="height-toolbar">
        {(!text || demo) && <Button size="sm" onClick={() => { setDraft({ text: template(), receipt }); setDemo(false); }}>Editar plantilla</Button>}
        {text && <Button size="sm" onClick={() => { setDraft(null); setDemo(false); }}>{saved ? 'Restaurar escenario guardado' : 'Descartar borrador'}</Button>}
      </div>
      {(text || currentDraft) && !demo && <Field label="Escenario revisado (JSON)" htmlFor="height-scenario">
        <TextArea id="height-scenario" mono block rows={8} spellCheck={false} value={text} onChange={val => setDraft({ text: val, receipt })} />
      </Field>}
      {error && <Callout tone="error">{error}</Callout>}
      {stale && <Callout tone="warn">La evidencia guardada corresponde a otras entradas o decisiones. Restaurá su snapshot o volvé a revisar las entradas actuales.</Callout>}
      {stale && saved && <Button size="sm" onClick={() => {
        setDraft({ text: JSON.stringify(saved.scenario, null, 2), receipt });
        setFilterSelection({ receipt, ...saved.filters });
        setDemo(false);
      }}>Revisar guardado con entradas actuales</Button>}
      {saved && !stale && !currentDraft && <p>Escenario guardado en la interpretación.</p>}
      <Button variant="primary" disabled={!preview?.admissible}
        onClick={apply}>Guardar escenario y snapshot</Button>
    </aside>
  </div>;
}

export function SaturationHeightPanel() {
  const entry = useProject(selectActiveEntry);
  return entry ? <HeightPanel key={entry.well.id} entry={entry} /> : <EmptyState title="Cargá un pozo para comparar Sw por altura" />;
}

export const dockPanels: DockPanelDef[] = [{ id: SATURATION_HEIGHT_ID, title: 'Saturación por altura', icon: 'scatter', component: SaturationHeightPanel }];
