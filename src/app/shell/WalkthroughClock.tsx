/**
 * Chip del cronómetro del recorrido (F19) en la barra del flujo: tiempo desde que se cargó el pozo hasta abrir el
 * Sumario, con un aro que se llena hacia la meta de 5 minutos. Tiene su propio intervalo (solo mientras corre), así
 * no re-renderiza el resto de la barra. Clic: reiniciar u ocultar (también desde la paleta).
 */
import { useEffect, useState } from 'react';
import { Menu, Tooltip } from '../../ui';
import { elapsedMs, formatElapsed, formatElapsedLong, goalFraction, goalStatus, isRunning, WALKTHROUGH_GOAL_MS } from '../flow/stopwatch';
import { stopwatchClock, useStopwatch } from '../flow/stopwatchStore';
import { useProject } from '../store/project';

/** Ms hasta el próximo segundo entero del cronómetro (el número cambia justo al cumplirse cada segundo). */
const untilNextSecond = (elapsed: number) => 1000 - (elapsed % 1000) + 15;

export function WalkthroughClock() {
  const watch = useStopwatch((s) => s.watch);
  const visible = useStopwatch((s) => s.visible);
  const activeWellId = useProject((s) => s.project.activeWellId);
  const running = isRunning(watch);
  const [now, setNow] = useState(() => stopwatchClock.now());

  useEffect(() => {
    if (!running || !visible) return;
    let timer: number;
    const tick = () => {
      const t = stopwatchClock.now();
      setNow(t);
      timer = window.setTimeout(tick, untilNextSecond(elapsedMs(watch, t)));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [running, visible, watch]);

  if (!visible || watch.startedAt === null || watch.wellId !== activeWellId) return null;

  const elapsed = elapsedMs(watch, now);
  const goal = goalStatus(elapsed);
  const fraction = goalFraction(elapsed);
  const tone = goal === 'over' ? 'over' : running ? 'running' : 'done';
  const goalText = goal === 'within' ? 'dentro de la meta' : 'fuera de la meta';
  const stateText = running ? `Corriendo · ${goalText}` : `Frenado al abrir el sumario · ${goalText}`;
  const label = `Cronómetro del recorrido: ${formatElapsedLong(elapsed)}, ${running ? 'corriendo' : 'frenado'}, ${goalText}`;
  const minutes = WALKTHROUGH_GOAL_MS / 60_000;

  return (
    <Menu
      aria-label="Cronómetro del recorrido"
      minWidth={240}
      items={[
        { id: 'restart', label: 'Reiniciar desde ahora', description: 'Vuelve a medir el recorrido de este pozo', icon: 'refresh', onSelect: () => useStopwatch.getState().restart() },
        { id: 'hide', label: 'Ocultar el cronómetro', description: 'Se vuelve a mostrar desde la paleta (Ctrl+K)', icon: 'eye-off', onSelect: () => useStopwatch.getState().setVisible(false) },
      ]}
      trigger={(p) => (
        <Tooltip
          placement="bottom"
          align="end"
          content={
            <>
              <strong>Cronómetro del recorrido</strong>
              <br />
              Desde que cargaste el pozo hasta abrir el sumario. Meta: menos de {minutes} minutos.
              <br />
              {stateText}.
            </>
          }
        >
          <button {...p} type="button" className={`shell-clock shell-clock--${tone}`} aria-label={label} data-testid="walkthrough-clock" data-state={running ? 'running' : 'stopped'} data-goal={goal}>
            <svg className="shell-clock__dial" viewBox="0 0 16 16" aria-hidden="true">
              <circle className="shell-clock__track" cx="8" cy="8" r="6.25" />
              <circle className="shell-clock__arc" cx="8" cy="8" r="6.25" pathLength={1} strokeDasharray={`${fraction} 1`} transform="rotate(-90 8 8)" />
              <line className="shell-clock__hand" x1="8" y1="8" x2="8" y2="4.25" transform={`rotate(${fraction * 360} 8 8)`} />
            </svg>
            <span className="shell-clock__time num" aria-hidden="true">
              {formatElapsed(elapsed)}
            </span>
          </button>
        </Tooltip>
      )}
    />
  );
}
