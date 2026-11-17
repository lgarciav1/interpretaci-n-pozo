import { useMemo, useState } from 'react';
import { activeWellEntry, type WellEntry } from '../../core/state/project';
import { observationsFromEntry } from '../../core/tournament/observations';
import { applyTournament } from '../../core/tournament/recipe';
import { runModelTournament } from '../../app/tournament/client';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import type { TournamentResult, TournamentRow } from '../../petro/modelTournament';
import { Badge, Button, Callout, DataTable, EmptyState, Field, TextField, formatNumber, toast, type Column } from '../../ui';
import type { DockPanelDef } from '../../ui/dockPanel';
import { coreSets } from '../core/model';
import { MODEL_TOURNAMENT_ID } from './index';
import './tournament.css';

const vshNames: Record<string, string> = { linear: 'Lineal', larionovTertiary: 'Larionov terciario', larionovOlder: 'Larionov antiguo', clavier: 'Clavier', steiber: 'Steiber' };
const phiNames: Record<string, string> = { densityNeutron: 'Densidad–neutrón', densityNeutronGas: 'Densidad–neutrón (gas)', density: 'Densidad', neutron: 'Neutrón', sonic: 'Sónico' };
const swNames: Record<string, string> = { 'sw-archie': 'Archie', 'sw-simandoux': 'Simandoux', 'sw-indonesia': 'Indonesia' };
const f = (v: number | null) => v === null ? '—' : formatNumber(v, { digits: 4 });
const pct = (v: number) => `${formatNumber(100 * v, { digits: 0 })}%`;
const columns: Column<TournamentRow>[] = [
  { key: 'vsh', header: 'Vsh', render: r => vshNames[r.candidate.vshMethod] },
  { key: 'phi', header: 'Porosidad total', render: r => phiNames[r.candidate.porosityMethod] },
  { key: 'sw', header: 'Sw', render: r => swNames[r.candidate.swModuleId] },
  { key: 'rmse', header: 'RMSE φ común', align: 'num', render: r => f(r.commonPhi.rmse) },
  { key: 'n', header: 'Pares φ', align: 'num', render: r => `${r.phi.n}/${r.phi.total}` },
  { key: 'coverage', header: 'Cobertura φ', align: 'num', render: r => pct(r.phi.coverage) },
  { key: 'support', header: 'Soporte', render: r => <Badge tone={r.applicable ? 'info' : 'warn'}>{r.applicable ? 'Exploratorio' : 'No aplicable'}</Badge> },
];
interface Captured { entry: WellEntry; result: TournamentResult; adjustmentIds: string }

export function TournamentPanel() {
  const entry = useProject(selectActiveEntry);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adjustmentIds, setAdjustmentIds] = useState('');
  const observations = useMemo(() => entry ? observationsFromEntry(entry) : [], [entry]);
  const ids = useMemo(() => new Set(adjustmentIds.split(/[\s,;]+/).filter(Boolean)), [adjustmentIds]);
  const unknownIds = [...ids].filter(id => !observations.some(o => o.id === id));
  const fresh = !!captured && !!entry && captured.entry.well === entry.well && captured.entry.interpretation === entry.interpretation && captured.entry.inputRevisionId === entry.inputRevisionId && captured.adjustmentIds === adjustmentIds;
  const selected = captured?.result.rows.find(r => r.candidate.id === selectedId);
  const sets = entry ? coreSets(entry.well.pointSets) : [];
  async function run() {
    const project = useProject.getState().project;
    const source = activeWellEntry(project);
    if (!source || running || unknownIds.length) return;
    setRunning(true); setError(null); setSelectedId(null);
    try {
      const refs = observationsFromEntry(source).map(o => ({ ...o, usage: ids.has(o.id) ? 'calibration' as const : 'evaluation' as const }));
      const result = await runModelTournament(project, source.well.id, refs);
      setCaptured({ entry: source, result, adjustmentIds });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  }
  function apply() {
    if (!captured || !selected || !fresh || !selected.applicable) return;
    try {
      useProject.getState().commit('Aplicar combinación del torneo', p => applyTournament(p, captured.entry.well.id, captured.entry, selected.candidate, captured.result));
      toast({ tone: 'ok', title: 'Combinación aplicada', description: 'Snapshot guardado con entradas fijadas. Podés deshacer toda la operación con Ctrl+Z.' });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  if (!entry) return <EmptyState title="Cargá un pozo para comparar modelos" description="El torneo necesita perfiles y plugs de corona puestos en profundidad." />;
  return <div className="tournament" data-testid="model-tournament">
    <div className="tournament-bar">
      <h2>Torneo contra corona</h2><Badge tone="warn">Exploratorio</Badge>
      <span className="tournament-note">{observations.length} referencias alineadas · 75 combinaciones</span>
      <Button size="sm" variant="primary" loading={running} disabled={!observations.length || unknownIds.length > 0} onClick={run}>Calcular combinaciones</Button>
      <Button size="sm" variant="ghost" onClick={() => useUi.setState({ dockTab: 'core' })}>Revisar corona</Button>
    </div>
    <div className="tournament-body">
      <main className="tournament-main">
        {error && <Callout tone="error" title="No se pudo completar el torneo">{error}</Callout>}
        {captured && !fresh && <Callout tone="warn">El contexto cambió. Volvé a calcular antes de aplicar.</Callout>}
        {!observations.length && <EmptyState size="sm" title="Faltan plugs de porosidad alineados" description="Cargá la corona del TP desde Corona o confirmá la puesta en profundidad de tus plugs. No se crean referencias a partir de curvas calculadas." />}
        {sets.some(s => s.synthetic) && <Callout tone="warn">Hay plugs de ejemplo sintético. Sus errores no validan datos reales del pozo.</Callout>}
        {captured ? <>
          <p className="tournament-note">Orden por RMSE de φ sobre {captured.result.commonSupport} pares comunes. {captured.result.evaluationCount} referencias elegibles; {captured.result.calibrationCount} declaradas de ajuste excluidas; {captured.result.invalidCount} inválidas. Los empates no identifican Vsh ni Sw.</p>
          <DataTable columns={columns} rows={captured.result.rows} rowKey={r => r.candidate.id} onRowClick={r => setSelectedId(r.candidate.id)} selectedKey={selectedId} dense caption="Comparación exploratoria de combinaciones; seleccioná una fila para ver sus métricas y límites" data-testid="tournament-table" />
        </> : observations.length > 0 && <Callout tone="info" title="Compará antes de aplicar">Se conservan los parámetros y las fuentes preparadas. El torneo cambia solo los métodos de Vsh, PHIT y Sw de cada candidato; no ajusta parámetros.</Callout>}
      </main>
      <aside className="tournament-detail" aria-label="Soporte y aplicación de la combinación">
        <h3>{selected ? 'Combinación seleccionada' : 'Alcance de la comparación'}</h3>
        {selected && <>
          <p className="tournament-note">{vshNames[selected.candidate.vshMethod]} · {phiNames[selected.candidate.porosityMethod]} · {swNames[selected.candidate.swModuleId]}</p>
          <dl className="tournament-metrics">
            <div><dt>RMSE φ común · v/v</dt><dd>{f(selected.commonPhi.rmse)}</dd></div>
            <div><dt>MAE φ común · v/v</dt><dd>{f(selected.commonPhi.mae)}</dd></div>
            <div><dt>Sesgo φ común · v/v</dt><dd>{f(selected.commonPhi.bias)}</dd></div>
            <div><dt>Cobertura propia φ</dt><dd>{selected.phi.n}/{selected.phi.total} · {pct(selected.phi.coverage)}</dd></div>
          </dl>
          <p className="tournament-note">RMSE propio φ: {f(selected.phi.rmse)} v/v. Pares comunes: {selected.commonPhi.n}. Soporte mínimo: 5 pares y 80% de cobertura.</p>
        </>}
        {selected && <>
          <p className="tournament-note">Cobertura calculada en el perfil (no es validación): PHIT {pct(selected.calculatedCoverage.phi.coverage)} ({selected.calculatedCoverage.phi.n}/{selected.calculatedCoverage.phi.total}); VSH {pct(selected.calculatedCoverage.vsh.coverage)} ({selected.calculatedCoverage.vsh.n}/{selected.calculatedCoverage.vsh.total}); SW {pct(selected.calculatedCoverage.sw.coverage)} ({selected.calculatedCoverage.sw.n}/{selected.calculatedCoverage.sw.total}).</p>
          {!selected.applicable && <Callout tone="warn">Combinación no aplicable: falta soporte común o alguna salida válida de PHIT, VSH o SW.</Callout>}
          {selected.diagnostics.length > 0 && <details><summary className="tournament-note">Avisos del cálculo ({selected.diagnostics.length})</summary><ul className="tournament-limits">{selected.diagnostics.map((d, i) => <li key={i}>{d}</li>)}</ul></details>}
        </>}
        <Callout tone="warn" title="Vsh y Sw: no evaluables">{selected ? `${selected.vsh.reason} ${selected.sw.reason}` : 'El TP no aporta referencias volumétricas Vsh ni Sw in situ compatibles. El ensayo Sw–RI permite ajustar n; no valida la saturación del perfil.'}</Callout>
        <p className="tournament-note">PHIT se compara con φ de laboratorio. Ajustes previos y confinamiento pueden ser desconocidos. Seleccionar con los mismos plugs introduce optimismo: no es validación independiente ni hay ganadora integral.</p>
        <Field label="IDs utilizados para ajustar parámetros" htmlFor="tournament-adjustment-ids" hint="Opcional: IDs completos separados por coma; quedan excluidos de evaluación. Si no los conocés, la comparación sigue siendo exploratoria." error={unknownIds.length ? `IDs desconocidos: ${unknownIds.join(', ')}` : undefined}>
          <TextField id="tournament-adjustment-ids" value={adjustmentIds} onChange={setAdjustmentIds} placeholder="conjunto:plug" block disabled={running} />
        </Field>
        <details><summary className="tournament-note">Referencias y límites</summary>
          <ul className="tournament-limits">{sets.map(s => <li key={s.id}>{s.name}: {s.source ?? 'Origen no documentado'}{s.synthetic ? ' · ejemplo sintético' : ''}</li>)}{captured?.result.limits.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p className="tournament-note">IDs disponibles: {observations.map(o => o.id).join(', ') || 'ninguno'}.</p>
        </details>
        <Button variant="primary" disabled={!fresh || !selected?.applicable || running} onClick={apply}>Aplicar combinación y guardar snapshot</Button>
        <p className="tournament-note">Requiere seleccionar una fila con soporte. Aplica al pozo y a sus zonas en una operación; Ctrl+Z la deshace. Ecuaciones y referencias científicas en Ecuaciones.</p>
      </aside>
    </div>
  </div>;
}
export const dockPanels: DockPanelDef[] = [{ id: MODEL_TOURNAMENT_ID, title: 'Torneo', icon: 'table', component: TournamentPanel }];
