/** Franja de la «tubería» (0058): las etapas en el orden del motor, cada una con estado y conteo; clic abre su herramienta. */
import { Fragment } from 'react';
import { Icon, type IconName } from '../../ui';
import { pipelineSummary, type PipelineStage, type StageState, type ToolId } from './pipeline';

const STATE_LABEL: Record<StageState, string> = { done: 'aplicada', preview: 'en vista previa', idle: 'sin aplicar', blocked: 'no combinable' };
const STAGE_ICON: Record<PipelineStage['id'], IconName> = {
  original: 'curve',
  exclusion: 'eye-off',
  interpolation: 'activity',
  median: 'filter',
  alignment: 'swap',
  prepared: 'check-circle',
};

export function Pipeline({ stages, activeTool, onOpen }: { stages: readonly PipelineStage[]; activeTool: ToolId | null; onOpen(tool: ToolId | 'saved'): void }) {
  return (
    <nav className="prep-pipe" aria-label="Etapas de preparación">
      <ol className="prep-pipe__list">
        {stages.map((s, i) => {
          const open = s.tool ?? (s.id === 'prepared' ? 'saved' : null);
          const active = !!s.tool && (activeTool === s.tool || (s.tool === 'exclude' && activeTool === 'suspects'));
          const body = (
            <>
              <span className="prep-pipe__mark" aria-hidden="true">
                <Icon name={s.state === 'done' && s.id !== 'original' ? 'check' : STAGE_ICON[s.id]} size={13} />
              </span>
              <span className="prep-pipe__text">
                <span className="prep-pipe__label">{s.label}</span>
                <span className="prep-pipe__detail num">{s.detail}</span>
              </span>
            </>
          );
          return (
            <Fragment key={s.id}>
              {i > 0 && (
                <li className={`prep-pipe__arrow${s.state === 'preview' ? ' is-preview' : ''}`} aria-hidden="true">
                  <Icon name="arrow-right" size={12} />
                </li>
              )}
              <li className="prep-pipe__item">
                {open ? (
                  <button
                    type="button"
                    className={`prep-pipe__node is-${s.state}${active ? ' is-active' : ''}`}
                    aria-current={active ? 'step' : undefined}
                    aria-label={`${s.label}: ${s.detail} (${STATE_LABEL[s.state]}). ${open === 'saved' ? 'Ver preparaciones guardadas' : 'Abrir la herramienta'}`}
                    onClick={() => onOpen(open)}
                  >
                    {body}
                  </button>
                ) : (
                  <span className={`prep-pipe__node is-${s.state}`} aria-label={`${s.label}: ${s.detail}`}>
                    {body}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
      <p className="prep-pipe__summary">{pipelineSummary(stages)}</p>
    </nav>
  );
}
