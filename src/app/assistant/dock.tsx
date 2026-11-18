import { useMemo, useState } from 'react';
import { useFlow } from '../flow/useFlow';
import { buildEquationEntries } from '../ecuaciones/model';
import { EQUATION_EXTRAS } from '../ecuaciones/extras';
import { openEquations } from '../ecuaciones/open';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { panelVisible, useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { useTrendsUi } from '../trends/store';
import { Button, EmptyState, TextField } from '../../ui';
import { listCommands } from '../../ui/commands';
import type { DockPanelDef } from '../../ui/dockPanel';
import { registry } from '../../modules';
import { answerQuestion, type Answer } from './model';
import './assistant.css';

const EQUATIONS = buildEquationEntries(registry, EQUATION_EXTRAS);
const EXAMPLES = ['Mostrame Sw en la zona D', '¿Por qué la zona C tiene poco pay?', '¿Cómo funciona Archie?'] as const;

function runAction(action: Answer['actions'][number], wellId: string): void {
  const entry = selectActiveEntry(useProject.getState());
  const ui = useUi.getState();
  if (entry?.well.id !== wellId || ui.presenting) return;
  if (action.kind === 'equation') {
    openEquations(action.id);
  } else if (action.kind === 'command') {
    if (ui.workspace !== 'petrophysics' && ['step:summary', 'step:cutoffs'].includes(action.id)) {
      ui.set({ workspace: 'petrophysics', activeModuleId: null, activeStepId: null });
    }
    const command = listCommands().find(c => c.id === action.id);
    if (command?.enabled?.() !== false) command?.run?.();
  } else {
    const zone = entry.interpretation.zones.find(z => z.id === action.zoneId);
    if (!zone) return;
    if (ui.workspace !== 'petrophysics') ui.set({ workspace: 'petrophysics', activeModuleId: null, activeStepId: null });
    if (ui.toolStringOpen) ui.set({ toolStringOpen: false });
    useTrendsUi.getState().requestRange(zone.top, zone.base);
    useViewer.setState({ locateCurve: { wellId, role: action.role } });
  }
}

function QuestionBox({ wellId }: { wellId: string }) {
  const entry = useProject(selectActiveEntry);
  const result = useResults(s => s.result);
  const presenting = useUi(s => s.presenting);
  const visible = useUi(s => panelVisible(s, 'assistant'));
  const { suggested } = useFlow();
  const [draft, setDraft] = useState('');
  const [question, setQuestion] = useState('');
  const [commands, setCommands] = useState<ReturnType<typeof listCommands>>([]);

  function ask(text: string) {
    const query = text.trim();
    if (!query) return;
    setDraft(query);
    setCommands(listCommands().filter(c => c.enabled?.() !== false));
    setQuestion(query);
  }

  const zones = entry?.interpretation.zones;
  const next = suggested?.def;
  const answer = useMemo(() => visible && question && answerQuestion(question, {
    zones: zones ?? [],
    result: result?.wellId === wellId ? result : null,
    equations: EQUATIONS,
    commands,
    ...(next ? { nextStep: { id: next.id, title: next.title } } : {}),
  }), [visible, question, zones, wellId, result, commands, next]);
  return (
    <section className="assistant" aria-label="Asistente del pozo">
      <form className="assistant__form" onSubmit={event => { event.preventDefault(); ask(draft); }}>
        <TextField aria-label="Pregunta sobre el pozo" placeholder="Preguntá sobre el pozo o un método" value={draft}
          block maxLength={200} onChange={setDraft} />
        <Button variant="primary" disabled={!draft.trim()} type="submit">Preguntar</Button>
      </form>
      {answer ? (
        <div className="assistant__answer">
          <div role="status">
            <p>{answer.text}</p>
            {answer.sources.length > 0 && <small>Fuente · {answer.sources.join(' · ')}</small>}
          </div>
          {answer.actions.length > 0 && (
            <div className="assistant__actions">
              {answer.actions.map(action => (
                <Button key={action.label} size="sm" variant="secondary" disabled={presenting}
                  onClick={() => runAction(action, wellId)}>{action.label}</Button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="assistant__actions" aria-label="Ejemplos de preguntas">
          {EXAMPLES.map(example => <Button variant="secondary" size="sm" key={example} onClick={() => ask(example)}>{example}</Button>)}
        </div>
      )}
    </section>
  );
}

function AssistantPanel() {
  const wellId = useProject(s => selectActiveEntry(s)?.well.id);
  return wellId
    ? <QuestionBox key={wellId} wellId={wellId} />
    : <EmptyState size="sm" icon="help" title="Cargá un pozo para consultar sus resultados" />;
}

export const ASSISTANT_PANEL: DockPanelDef = { id: 'assistant', title: 'Asistente', icon: 'help', component: AssistantPanel };
