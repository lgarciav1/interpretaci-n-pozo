/**
 * Lista de la sarta (docs/decisiones/0033, D1 y D6): ocupa la columna izquierda mientras la pantalla de la sarta está
 * abierta, como el catálogo de «Armar pistas» (0016). Es la fuente de verdad para armar: modo datos / planificación,
 * prender y apagar, reordenar (arrastre por la manija o Alt+↑/↓), agregar y quitar en planificación. Cada gesto es un
 * `commit` (Ctrl+Z lo deshace) y se anuncia en una región `aria-live`. La vista 3D solo mira.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { activeWellEntry } from '../../core/state/project';
import { addPlannedTool, moveTool, removePlannedTool, resetToolString, setToolOn, setToolStringMode, startPlanning } from '../../core/state/toolString';
import { isDefaultToolString, toolStringOf, type ToolStringEntry } from '../../core/toolString';
import { TOOL_FAMILY_LABEL } from '../../core/tools';
import { registry } from '../../modules';
import { Button, Icon, IconButton, Menu, SegmentedControl, Switch, useThemeTokens, type MenuEntry } from '../../ui';
import { UNDO_SHORTCUT } from '../shell/historyActions';
import { selectActiveEntry, useProject } from '../store/project';
import { useUi } from '../store/ui';
import { familyColor } from './scene';
import { useToolStringView } from './select';
import { useToolStringUi } from './store';
import './toolString.css';

const announce = (text: string) => {
  const el = document.getElementById('ts-live');
  if (el) el.textContent = text;
};

/** Texto de las curvas de una herramienta en este pozo. */
function curvesText(e: ToolStringEntry, mnemonics: ReadonlyMap<string, string>): string {
  if (!e.hasData) return e.on ? 'sin datos en este pozo' : 'apagada · sin datos en este pozo';
  const list = e.curveIds.map((id) => mnemonics.get(id) ?? id);
  const text = list.length > 4 ? `${list.slice(0, 4).join(' · ')} +${list.length - 4}` : list.join(' · ');
  return e.on ? text : `apagada · ${text}`;
}

export function ToolStringPanel() {
  const entry = useProject(selectActiveEntry);
  const commit = useProject((s) => s.commit);
  const view = useToolStringView();
  const selectedId = useToolStringUi((s) => s.selectedId);
  const setTs = useToolStringUi((s) => s.set);
  const setUi = useUi((s) => s.set);
  const theme = useThemeTokens();
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<null | { id: string; dy: number; to: number }>(null);

  const mnemonics = useMemo(() => new Map((entry?.well.curves ?? []).map((c) => [c.id, c.mnemonic])), [entry?.well.curves]);
  if (!entry || !view) return null;
  const wellId = entry.well.id;
  const { resolved, availability } = view;
  const planning = resolved.mode === 'planning';
  const entries = resolved.entries;
  const state = toolStringOf(entry.interpretation);

  const setMode = (mode: 'data' | 'planning') => {
    if (mode === resolved.mode) return;
    if (mode === 'planning' && state.plan.length === 0) commit('Planificar la sarta', (p) => startPlanning(p, wellId, 'data', registry.tools));
    else commit(mode === 'planning' ? 'Pasar a planificación' : 'Volver a la sarta de los datos', (p) => setToolStringMode(p, wellId, mode));
    announce(mode === 'planning' ? 'Modo planificación' : 'Modo datos');
  };
  const toggle = (e: ToolStringEntry, on: boolean) => {
    commit(`${on ? 'Prender' : 'Apagar'} ${e.tool.name}`, (p) => setToolOn(p, wellId, e.tool.id, on));
    announce(`${e.tool.name} ${on ? 'prendida' : 'apagada'}`);
  };
  const move = (id: string, to: number) => {
    const t = registry.tools.get(id);
    const from = entries.findIndex((x) => x.tool.id === id);
    if (!t || from < 0 || to < 0 || to >= entries.length || to === from) return;
    commit(`Mover ${t.name} en la sarta`, (p) => moveTool(p, wellId, id, to, registry.tools));
    announce(`${t.name} en la posición ${to + 1} de ${entries.length}`);
  };
  const remove = (e: ToolStringEntry) => {
    commit(`Quitar ${e.tool.name} de la sarta`, (p) => removePlannedTool(p, wellId, e.tool.id));
    if (selectedId === e.tool.id) setTs({ selectedId: null });
    announce(`${e.tool.name} quitada de la sarta`);
  };
  const add = (id: string) => {
    const t = registry.tools.get(id)!;
    commit(`Agregar ${t.name} a la sarta`, (p) => addPlannedTool(p, wellId, id));
    setTs({ selectedId: id });
    announce(`${t.name} agregada al final de la sarta`);
  };

  const inPlan = new Set(entries.map((e) => e.tool.id));
  const addItems: MenuEntry[] = registry.tools
    .all()
    .filter((t) => !inPlan.has(t.id))
    .map((t) => ({ id: t.id, label: t.name, hint: t.short, description: TOOL_FAMILY_LABEL[t.family], onSelect: () => add(t.id) }));
  const startItems: MenuEntry[] = [
    { id: 'from-data', label: 'Copiar la sarta de los datos', icon: 'copy', onSelect: () => commit('Planificar la sarta', (p) => startPlanning(p, wellId, 'data', registry.tools)) },
    { id: 'empty', label: 'Empezar de cero', icon: 'trash', onSelect: () => commit('Planificar una sarta desde cero', (p) => startPlanning(p, wellId, 'empty', registry.tools)) },
  ];

  // Arrastre por la manija: eventos de puntero (sin drag and drop nativo, 0016 D1).
  const onGripDown = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-ts-row]') ?? [])];
    const mids = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return { id: r.dataset.tsRow!, mid: b.top + b.height / 2 };
    });
    const startY = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const from = mids.findIndex((m) => m.id === id);
    let to = from;
    const onMove = (ev: PointerEvent) => {
      const y = ev.clientY;
      to = mids.filter((m) => m.id !== id && m.mid < y).length;
      setDrag({ id, dy: y - startY, to });
    };
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
      setDrag(null);
      if (Math.abs(ev.clientY - startY) > 3) move(id, to);
    };
    const onCancel = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
      setDrag(null);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
  };

  const focusRow = (i: number) => listRef.current?.querySelectorAll<HTMLElement>('.ts-row__main')[i]?.focus();
  const onRowKey = (ev: KeyboardEvent, e: ToolStringEntry, i: number) => {
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault();
      const to = i + (ev.key === 'ArrowUp' ? -1 : 1);
      move(e.tool.id, to);
      requestAnimationFrame(() => focusRow(Math.max(0, Math.min(entries.length - 1, to))));
    } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      focusRow(Math.max(0, Math.min(entries.length - 1, i + (ev.key === 'ArrowUp' ? -1 : 1))));
    } else if (planning && (ev.key === 'Delete' || ev.key === 'Backspace')) {
      ev.preventDefault();
      remove(e);
      requestAnimationFrame(() => focusRow(Math.max(0, i - 1)));
    }
  };

  const counts = { available: 0, needs: 0, total: 0 };
  for (const m of availability.modules.values()) {
    counts.total++;
    if (m.status === 'available') counts.available++;
    else if (m.status === 'needs-data') counts.needs++;
  }

  return (
    <aside className="ts-panel" aria-label="Sarta de perfilaje">
      <header className="ts-panel__head">
        <div className="ts-panel__titles">
          <span className="ts-panel__overline">{`Pozo ${entry.well.name}`}</span>
          <h2 className="ts-panel__title">Sarta de perfilaje</h2>
        </div>
        <IconButton icon="x" size="sm" label="Cerrar la sarta y volver al perfil" onClick={() => setUi({ toolStringOpen: false })} />
      </header>
      <div className="ts-panel__mode">
        <SegmentedControl
          aria-label="Modo de la sarta"
          size="sm"
          block
          value={resolved.mode}
          onChange={setMode}
          options={[
            { value: 'data', label: 'Datos', title: 'La sarta que corrió: sale de las curvas del pozo' },
            { value: 'planning', label: 'Planificación', title: 'La sarta que pedirías: qué módulos podrías correr' },
          ]}
        />
        <p className="ts-panel__hint">
          {planning
            ? 'Armá la sarta que pedirías. Las herramientas sin datos en este pozo se ven con contorno; los módulos dicen qué correría.'
            : 'La sarta sale de las curvas del pozo. Apagá una herramienta para ver el pozo y los módulos sin ella.'}
        </p>
        {planning && (
          <div className="ts-panel__actions">
            <Menu
              aria-label="Agregar herramienta"
              align="start"
              minWidth={260}
              items={addItems.length ? addItems : [{ type: 'label', id: 'none', label: 'Ya están todas' }]}
              trigger={(tp) => (
                <Button {...tp} size="sm" variant="primary" icon="plus">
                  Agregar herramienta
                </Button>
              )}
            />
            <Menu
              aria-label="Empezar la planificación"
              align="start"
              items={startItems}
              trigger={(tp) => (
                <Button {...tp} size="sm" variant="ghost" icon="refresh">
                  Empezar de…
                </Button>
              )}
            />
          </div>
        )}
      </div>

      <div className="ts-panel__list-head" aria-hidden="true">
        <span>Arriba</span>
        <span className="ts-panel__list-rule" />
      </div>
      {entries.length ? (
        <ol ref={listRef} className={`ts-list${drag ? ' is-dragging' : ''}`} aria-label="Herramientas de la sarta, de arriba a abajo">
          {entries.map((e, i) => {
            const selected = selectedId === e.tool.id;
            const dragging = drag?.id === e.tool.id;
            const showLine = drag && !dragging && drag.to === i - (entries.findIndex((x) => x.tool.id === drag.id) < i ? 1 : 0);
            return (
              <li
                key={e.tool.id}
                data-ts-row={e.tool.id}
                className={['ts-row', selected && 'is-selected', !e.on && 'is-off', planning && !e.hasData && 'is-ghost', dragging && 'is-dragged', showLine && 'is-drop-before'].filter(Boolean).join(' ')}
                style={dragging ? { transform: `translateY(${drag.dy}px)` } : undefined}
                onPointerEnter={() => setTs({ hoverId: e.tool.id })}
                onPointerLeave={() => setTs({ hoverId: null })}
              >
                <button type="button" className="ts-row__grip" aria-label={`Mover ${e.tool.name} (Alt+↑ o Alt+↓ con la fila enfocada)`} tabIndex={-1} onPointerDown={(ev) => onGripDown(ev, e.tool.id)}>
                  <Icon name="grip" size={14} />
                </button>
                <button
                  type="button"
                  className="ts-row__main"
                  aria-pressed={selected}
                  aria-describedby="ts-keys"
                  onClick={() => setTs({ selectedId: selected ? null : e.tool.id })}
                  onKeyDown={(ev) => onRowKey(ev, e, i)}
                >
                  <span className="ts-row__swatch" style={{ background: familyColor(e.tool.family, theme.scene) }} aria-hidden="true" />
                  <span className="ts-row__short">{e.tool.short}</span>
                  <span className="ts-row__text">
                    <span className="ts-row__name">{e.tool.name}</span>
                    <span className="ts-row__curves">{curvesText(e, mnemonics)}</span>
                  </span>
                </button>
                <span className="ts-row__switch">
                  <Switch checked={e.on} onChange={(on) => toggle(e, on)} aria-label={`${e.tool.name}: ${e.on ? 'prendida' : 'apagada'}`} />
                </span>
                {planning && <IconButton icon="x" size="sm" label={`Quitar ${e.tool.name} de la sarta`} onClick={() => remove(e)} />}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="ts-panel__empty">{planning ? 'La sarta planificada está vacía: agregá herramientas.' : 'El pozo no tiene curvas de herramientas conocidas.'}</p>
      )}
      <div className="ts-panel__list-head ts-panel__list-head--bottom" aria-hidden="true">
        <span className="ts-panel__list-rule" />
        <span>Abajo</span>
      </div>

      {planning && resolved.outsidePlan.length > 0 && (
        <p className="ts-panel__note">
          <Icon name="info" size={13} />
          {`Fuera del plan (sus curvas no se ven): ${resolved.outsidePlan.map((id) => registry.tools.get(id)?.name ?? id).join(', ')}.`}
        </p>
      )}

      <footer className="ts-panel__foot">
        <div className="ts-panel__foot-row">
          <span className="ts-panel__summary" title="Módulos que pueden correr con esta sarta">
            <span className="num">{counts.available}</span>
            {` de ${counts.total} módulos disponibles`}
            {counts.needs > 0 && <span className="ts-panel__needs">{` · ${counts.needs} sin datos`}</span>}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            disabled={isDefaultToolString(activeWellEntry(useProject.getState().project)?.interpretation.toolString)}
            onClick={() => {
              commit('Restablecer la sarta', (p) => resetToolString(p, wellId));
              announce('Sarta restablecida');
            }}
          >
            Restablecer
          </Button>
        </div>
        <span id="ts-keys" className="ts-panel__keys">
          <kbd className="ui-kbd">Alt</kbd>+<kbd className="ui-kbd">↑</kbd>/<kbd className="ui-kbd">↓</kbd> mueve la fila · <kbd className="ui-kbd">{UNDO_SHORTCUT}</kbd> deshace
        </span>
      </footer>
      <div id="ts-live" className="ui-visually-hidden" aria-live="polite" />
    </aside>
  );
}
