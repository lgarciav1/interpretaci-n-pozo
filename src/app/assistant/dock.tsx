import { useEffect, useMemo, useRef, useState } from 'react';
import { sameContext } from '../../core/engine/context';
import { toEngineWell } from '../../core/engine/engine';
import { formulaRegistry } from '../../core/engine/formulas';
import { projectedEngineCurves } from '../../core/preparation/plan';
import type { Well } from '../../core/well';
import { registry } from '../../modules';
import { setCutoffPairRecipe } from '../../modules/cutoff-sensitivity/surfaceModel';
import { makeSelection, setPlotSelection } from '../../plots/link';
import {
  Badge,
  Button,
  copyText,
  EmptyState,
  SegmentedControl,
  TextField,
  toast,
} from '../../ui';
import { listCommands } from '../../ui/commands';
import type { DockPanelDef } from '../../ui/dockPanel';
import { buildEquationEntries } from '../ecuaciones/model';
import { EQUATION_EXTRAS } from '../ecuaciones/extras';
import { openEquations } from '../ecuaciones/open';
import { useFlow } from '../flow/useFlow';
import { effectiveWell, entryContext } from '../preparation/data';
import { openProvenance } from '../provenance/store';
import { useSelectionActionsUi } from '../selectionActions/store';
import { openCurtain } from '../snapshots/actions';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { panelVisible, useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { useTrendsUi } from '../trends/store';
import {
  answerQuestion,
  buildAutocomplete,
  buildDefensePrep,
  buildDynamicChips,
  formatDefenseForCopy,
  type Action,
  type AssistantContext,
  type DefenseCard,
  type Intent,
} from './model';
import './assistant.css';

const EQUATIONS = buildEquationEntries(registry, EQUATION_EXTRAS);

interface HistoryEntry {
  question: string;
  previousIntent: Intent | null;
}

const SEV_BADGE: Readonly<Record<DefenseCard['severity'], { label: string; tone: 'error' | 'warn' | 'info' }>> = {
  error: { label: 'Crítico', tone: 'error' },
  warn: { label: 'Atención', tone: 'warn' },
  info: { label: 'Revisar', tone: 'info' },
};

function runAction(
  action: Action,
  wellId: string,
  effectiveWellRef: Readonly<Well> | null | undefined,
  onAsk: (question: string) => void,
): void {
  const entry = selectActiveEntry(useProject.getState());
  const ui = useUi.getState();
  if (entry?.well.id !== wellId || ui.presenting) return;

  switch (action.kind) {
    case 'equation':
      openEquations(action.id);
      return;
    case 'command': {
      if (ui.workspace !== 'petrophysics' && action.id.startsWith('step:') && action.id !== 'step:lithology' && action.id !== 'step:geology') {
        ui.set({ workspace: 'petrophysics', activeModuleId: null, activeStepId: null });
      }
      const command = listCommands().find((c) => c.id === action.id);
      if (command?.enabled?.() !== false) command?.run?.();
      return;
    }
    case 'curve': {
      const zone = entry.interpretation.zones.find((z) => z.id === action.zoneId);
      if (!zone) return;
      if (ui.workspace !== 'petrophysics') ui.set({ workspace: 'petrophysics', activeModuleId: null, activeStepId: null });
      if (ui.toolStringOpen) ui.set({ toolStringOpen: false });
      useTrendsUi.getState().requestRange(zone.top, zone.base);
      useViewer.setState({ locateCurve: { wellId, role: action.role } });
      return;
    }
    case 'depth': {
      if (ui.workspace !== 'petrophysics') ui.set({ workspace: 'petrophysics', activeModuleId: null, activeStepId: null });
      if (ui.toolStringOpen) ui.set({ toolStringOpen: false });
      useTrendsUi.getState().requestRange(action.top ?? action.depth - 5, action.base ?? action.depth + 5);
      return;
    }
    case 'provenance':
      openProvenance({ outputKey: action.outputKey, depth: action.depth });
      return;
    case 'apply-cutoffs':
      useProject.getState().commit(
        'Aplicar cutoffs simulados',
        (project) => setCutoffPairRecipe(project, wellId, action.zoneId, action.updates),
      );
      toast({ title: 'Cutoffs aplicados', description: 'Podés deshacerlo con Ctrl+Z.', tone: 'ok' });
      return;
    case 'apply-selection': {
      const depth = (effectiveWellRef ?? entry.well).depth.values;
      const sel = makeSelection('assistant', depth, action.mask, { kind: 'filter', label: action.detailLabel });
      if (!sel) {
        toast({ title: 'Sin muestras seleccionadas', tone: 'info' });
        return;
      }
      setPlotSelection(sel);
      if (ui.workspace !== 'petrophysics') ui.set({ workspace: 'petrophysics', activeModuleId: null, activeStepId: null });
      if (ui.toolStringOpen) ui.set({ toolStringOpen: false });
      useTrendsUi.getState().requestRange(action.top, action.base);
      toast({ title: `${sel.count} muestras resaltadas`, description: action.detailLabel, tone: 'ok' });
      return;
    }
    case 'save-selection-flag': {
      const depth = (effectiveWellRef ?? entry.well).depth.values;
      const sel = makeSelection('assistant', depth, action.mask, { kind: 'filter', label: action.detailLabel });
      if (!sel) return;
      setPlotSelection(sel);
      useSelectionActionsUi.getState().openFlag(action.defaultName);
      return;
    }
    case 'curtain':
      openCurtain(action.snapshotId);
      return;
    case 'snapshots':
      ui.set({ snapshotsOpen: true });
      return;
    case 'panel':
      ui.openPanel(action.panelId);
      return;
    case 'ask':
      onAsk(action.question);
      return;
  }
}

function QuestionBox({ wellId }: { wellId: string }) {
  const entry = useProject(selectActiveEntry);
  const snapshots = useProject((s) => s.project.snapshots);
  const result = useResults((s) => s.result);
  const presenting = useUi((s) => s.presenting);
  const visible = useUi((s) => panelVisible(s, 'assistant'));
  const { suggested } = useFlow();

  const [mode, setMode] = useState<'ask' | 'defense'>('ask');
  const [draft, setDraft] = useState('');
  const [question, setQuestion] = useState('');
  const [previousIntent, setPreviousIntent] = useState<Intent | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [commands, setCommands] = useState<ReturnType<typeof listCommands>>([]);
  const [acOpen, setAcOpen] = useState(false);
  const [acIdx, setAcIdx] = useState(-1);
  const blurTimer = useRef<number | null>(null);
  const acListRef = useRef<HTMLUListElement | null>(null);

  useEffect(
    () => () => {
      if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
    },
    [],
  );

  const freshResult = result?.wellId === wellId ? result : null;
  const wellSnapshots = useMemo(() => snapshots.filter((s) => s.wellId === wellId), [snapshots, wellId]);
  const effWell = useMemo(
    () => (entry ? effectiveWell(entry.well, freshResult) : null),
    [entry, freshResult],
  );
  const traceCurves = useMemo(() => {
    if (!entry) return undefined;
    if (freshResult?.preparation) {
      return projectedEngineCurves(toEngineWell(entry.well), freshResult.preparation.plan, freshResult.preparation.artifacts);
    }
    return entry.well.curves;
  }, [entry, freshResult]);
  const activeReg = useMemo(() => {
    if (!entry || !freshResult || !traceCurves) return registry;
    const formulas = entry.interpretation.formulas;
    if (!formulas?.length || !sameContext(freshResult.context, entryContext(entry))) return registry;
    return formulaRegistry(registry, traceCurves, entry.interpretation, []).registry;
  }, [entry, freshResult, traceCurves]);

  const zones = entry?.interpretation.zones;
  const next = suggested?.def;

  const coreContext = useMemo<AssistantContext>(
    () => ({
      zones: zones ?? [],
      result: freshResult,
      equations: EQUATIONS,
      commands: [],
      ...(next ? { nextStep: { id: next.id, title: next.title } } : {}),
      well: effWell,
      rawWell: entry?.well ?? null,
      interpretation: entry?.interpretation ?? null,
      clientResult: freshResult,
      snapshots: wellSnapshots,
      registry: activeReg,
      ...(traceCurves ? { traceCurves } : {}),
    }),
    [zones, freshResult, next, effWell, entry, wellSnapshots, activeReg, traceCurves],
  );

  const baseContext = useMemo<AssistantContext>(
    () => ({ ...coreContext, commands }),
    [coreContext, commands],
  );

  const answer = useMemo(() => {
    if (!visible || !question) return null;
    return answerQuestion(question, { ...baseContext, previousIntent });
  }, [visible, question, baseContext, previousIntent]);

  const dynamicChips = useMemo(() => buildDynamicChips(coreContext), [coreContext]);
  const suggestions = useMemo(
    () => (acOpen && draft.trim() ? buildAutocomplete(draft, baseContext) : []),
    [acOpen, draft, baseContext],
  );
  const defenseCards = useMemo(
    () => (visible ? buildDefensePrep(coreContext) : []),
    [visible, coreContext],
  );

  useEffect(() => {
    if (acIdx < 0 || !acListRef.current) return;
    const activeItem = acListRef.current.children[acIdx] as HTMLElement | undefined;
    activeItem?.scrollIntoView?.({ block: 'nearest' });
  }, [acIdx, suggestions.length]);

  function ask(text: string, prevOverride?: Intent | null) {
    const query = text.trim();
    if (!query) return;
    const computedPrev = prevOverride !== undefined ? prevOverride : answer?.intent ?? previousIntent;

    setMode('ask');
    setDraft(query);
    setAcOpen(false);
    setAcIdx(-1);
    setCommands(listCommands().filter((c) => c.enabled?.() !== false));
    setPreviousIntent(computedPrev);
    setQuestion(query);
    setHistory((prev) => {
      const filtered = prev.filter((item) => item.question !== query);
      return [{ question: query, previousIntent: computedPrev }, ...filtered].slice(0, 8);
    });
  }

  function clearAnswer() {
    setDraft('');
    setQuestion('');
    setPreviousIntent(null);
    setAcOpen(false);
    setAcIdx(-1);
  }

  async function handleCopy(text: string | undefined, label: string) {
    if (!text) return;
    const ok = await copyText(text);
    toast({
      title: ok ? label : 'No se pudo copiar al portapapeles',
      tone: ok ? 'ok' : 'warn',
    });
  }

  const defErrors = defenseCards.filter((c) => c.severity === 'error').length;
  const defWarns = defenseCards.filter((c) => c.severity === 'warn').length;

  return (
    <section className="assistant" aria-label="Asistente del pozo">
      <div className="assistant__header">
        <SegmentedControl<'ask' | 'defense'>
          size="sm"
          block
          aria-label="Modo del asistente"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ask', label: 'Preguntar', icon: 'help' },
            {
              value: 'defense',
              label: defenseCards.length > 0 ? `Preparar defensa (${defenseCards.length})` : 'Preparar defensa',
              icon: 'check-circle',
            },
          ]}
        />
      </div>

      {mode === 'ask' ? (
        <>
          <form
            className="assistant__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (acIdx >= 0 && suggestions[acIdx]) {
                ask(suggestions[acIdx]!.text);
              } else {
                ask(draft);
              }
            }}
          >
            <div className="assistant__input-wrap">
              <TextField
                aria-label="Pregunta sobre el pozo"
                placeholder="Preguntá sobre el pozo, cutoffs, MD o método"
                value={draft}
                block
                maxLength={200}
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestions.length > 0}
                aria-controls={suggestions.length > 0 ? 'assistant-autocomplete' : undefined}
                aria-activedescendant={
                  suggestions.length > 0 && acIdx >= 0 && suggestions[acIdx] ? `ac-${suggestions[acIdx]!.id}` : undefined
                }
                onFocus={() => {
                  if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
                  if (draft.trim()) setAcOpen(true);
                }}
                onBlur={() => {
                  blurTimer.current = window.setTimeout(() => setAcOpen(false), 120);
                }}
                onChange={(val) => {
                  setDraft(val);
                  setAcOpen(val.trim().length > 0);
                  setAcIdx(-1);
                }}
                onKeyDown={(e) => {
                  if (!suggestions.length) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setAcIdx((i) => (i + 1) % suggestions.length);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setAcIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setAcOpen(false);
                    setAcIdx(-1);
                  }
                }}
              />
              {suggestions.length > 0 && (
                <ul
                  id="assistant-autocomplete"
                  ref={acListRef}
                  className="assistant__autocomplete"
                  role="listbox"
                  aria-label="Sugerencias"
                >
                  {suggestions.map((item, idx) => (
                    <li
                      key={item.id}
                      id={`ac-${item.id}`}
                      role="option"
                      aria-selected={idx === acIdx}
                      className={`assistant__ac-item${idx === acIdx ? ' is-active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                      }}
                      onClick={() => ask(item.text)}
                    >
                      <span className="assistant__ac-text">{item.text}</span>
                      <span className="assistant__ac-cat">{item.category}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button variant="primary" disabled={!draft.trim()} type="submit">
              Preguntar
            </Button>
          </form>

          {history.length > 0 && (
            <div className="assistant__history" aria-label="Historial de preguntas">
              {history.map((h) => (
                <button
                  key={h.question}
                  type="button"
                  className={`assistant__hist-chip${h.question === question ? ' is-current' : ''}`}
                  title={`Repetir: ${h.question}`}
                  onClick={() => ask(h.question, h.previousIntent)}
                >
                  {h.question}
                </button>
              ))}
            </div>
          )}

          {answer ? (
            <div className="assistant__answer" data-testid="assistant-answer">
              <div role="status">
                <p>{answer.text}</p>
              </div>

              {answer.table && answer.table.rows.length > 0 && (
                <div className="assistant__table-wrap">
                  <table className="assistant__table">
                    {answer.table.caption && <caption className="assistant__table-caption">{answer.table.caption}</caption>}
                    <thead>
                      <tr>
                        {answer.table.columns.map((col) => (
                          <th key={col.label} scope="col" className={col.numeric ? 'is-num' : undefined}>
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {answer.table.rows.map((row) => {
                        const clickable = Boolean(row.action && !presenting);
                        const activate = () => {
                          if (row.action && !presenting) runAction(row.action, wellId, effWell, (q) => ask(q));
                        };
                        return (
                          <tr
                            key={row.id}
                            className={clickable ? 'is-clickable' : undefined}
                            tabIndex={clickable ? 0 : undefined}
                            aria-label={clickable ? row.action?.label : undefined}
                            onClick={clickable ? activate : undefined}
                            onKeyDown={
                              clickable
                                ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      activate();
                                    }
                                  }
                                : undefined
                            }
                            title={row.action?.label}
                          >
                            {row.cells.map((cell, ci) => (
                              <td key={ci} className={cell.numeric ? 'is-num num' : undefined}>
                                {cell.tone ? <Badge tone={cell.tone}>{cell.text}</Badge> : cell.text}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="assistant__answer-foot">
                {answer.sources.length > 0 ? <small>Fuente · {answer.sources.join(' · ')}</small> : <span />}
                <div className="assistant__foot-btns">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="copy"
                    onClick={() => void handleCopy(answer.copyText ?? answer.text, 'Respuesta copiada con fuentes')}
                  >
                    Copiar con fuentes
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearAnswer}>
                    Limpiar
                  </Button>
                </div>
              </div>

              {answer.actions.length > 0 && (
                <div className="assistant__actions">
                  {answer.actions.map((action, i) => (
                    <Button
                      key={`${action.kind}-${action.label}-${i}`}
                      size="sm"
                      variant={action.kind === 'apply-cutoffs' || action.kind === 'apply-selection' ? 'primary' : 'secondary'}
                      disabled={presenting}
                      onClick={() => runAction(action, wellId, effWell, (q) => ask(q))}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="assistant__actions" aria-label="Ejemplos de preguntas">
              {dynamicChips.map((example) => (
                <Button variant="secondary" size="sm" key={example} onClick={() => ask(example)}>
                  {example}
                </Button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="assistant__defense" data-testid="assistant-defense">
          <div className="assistant__defense-bar">
            <div className="assistant__defense-badges">
              {defErrors > 0 && <Badge tone="error">{defErrors} crítico(s)</Badge>}
              {defWarns > 0 && <Badge tone="warn">{defWarns} atención</Badge>}
              {defenseCards.length > 0 && defErrors === 0 && defWarns === 0 && <Badge tone="ok">Sin alertas críticas</Badge>}
            </div>
            {defenseCards.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon="copy"
                onClick={() => void handleCopy(formatDefenseForCopy(defenseCards, entry?.well.name), 'Guía de defensa copiada')}
              >
                Copiar guía
              </Button>
            )}
          </div>

          {defenseCards.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check-circle"
              title="Sin puntos críticos detectados"
              description="Calculá el pozo o cargá MDT, MICP o corona para generar preguntas específicas de defensa oral."
            />
          ) : (
            <div className="assistant__defense-list">
              {defenseCards.map((card, idx) => {
                const badge = SEV_BADGE[card.severity];
                return (
                  <details key={card.id} className={`assistant__card is-${card.severity}`} open={idx === 0}>
                    <summary className="assistant__card-sum">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      <span className="assistant__card-topic">{card.topic}</span>
                      <span className="assistant__card-q">{card.question}</span>
                    </summary>
                    <div className="assistant__card-body">
                      <p className="assistant__card-ans">{card.summary}</p>
                      {card.evidence.length > 0 && <p className="assistant__card-ev">{card.evidence.join(' · ')}</p>}
                      <small className="assistant__card-src">Fuente · {card.sources.join(' · ')}</small>
                      {card.actions.length > 0 && (
                        <div className="assistant__actions">
                          {card.actions.map((action, ai) => (
                            <Button
                              key={`${card.id}-act-${ai}`}
                              size="sm"
                              variant="secondary"
                              disabled={presenting}
                              onClick={() => runAction(action, wellId, effWell, (q) => ask(q))}
                            >
                              {action.label}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AssistantPanel() {
  const wellId = useProject((s) => selectActiveEntry(s)?.well.id);
  return wellId ? (
    <QuestionBox key={wellId} wellId={wellId} />
  ) : (
    <EmptyState size="sm" icon="help" title="Cargá un pozo para consultar sus resultados" />
  );
}

export const ASSISTANT_PANEL: DockPanelDef = {
  id: 'assistant',
  title: 'Asistente',
  icon: 'help',
  component: AssistantPanel,
};
