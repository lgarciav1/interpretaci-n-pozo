/**
 * Paleta de comandos (Ctrl/Cmd+K) y hoja de atajos («?»). Docs/decisiones/0018.
 *
 * - `CommandLayer`: se monta una vez en la raíz. Captura los atajos de las acciones (reglas en `commandForKey`: nunca
 *   mientras se escribe en un campo ni con un diálogo abierto, salvo las que lo piden) y muestra la paleta y la hoja.
 * - La paleta usa el `Dialog` del sistema: foco atrapado, Escape cierra y el foco vuelve a donde estaba. Búsqueda
 *   difusa sin acentos sobre el registro de `../commands.ts`; ↑/↓ eligen, Enter ejecuta, Inicio/Fin saltan.
 * - `useCommandSource(fuente, deps)`: registra acciones mientras un componente está montado.
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  closeCommandPalette,
  closeShortcutSheet,
  commandForKey,
  commandKeys,
  commandRegistryVersion,
  getCommandLayer,
  highlightRanges,
  isTypingTarget,
  listCommands,
  openCommandPalette,
  openShortcutSheet,
  registerCommandSource,
  searchCommands,
  shortcutGroups,
  subscribeCommandLayer,
  subscribeCommandRegistry,
  toggleCommandPalette,
  type Command,
  type CommandSource,
} from '../commands';
import './command.css';
import { Dialog } from './Dialog';
import { TextField } from './Fields';
import { Icon } from './Icon';

export const IS_MAC_PLATFORM = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Registra una fuente de acciones mientras el componente está montado. `deps`: cuándo cambia lo que captura. */
export function useCommandSource(sourceId: string, source: CommandSource, deps: readonly unknown[]): void {
  useEffect(() => registerCommandSource(sourceId, source), deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Las acciones de la propia capa: abrir la paleta y la hoja de atajos. */
registerCommandSource('ui:commands', () => [
  { id: 'ui:palette', title: 'Abrir la paleta de comandos', group: 'General', keywords: ['buscar', 'accion', 'acciones', 'comando'], icon: 'search', shortcut: { key: 'k', mod: true }, inInput: true, inDialog: true, run: toggleCommandPalette },
  { id: 'ui:shortcuts', title: 'Ver los atajos de teclado', group: 'General', keywords: ['teclas', 'ayuda', 'teclado'], icon: 'help', shortcut: { key: '?' }, run: openShortcutSheet },
  { id: 'ui:escape', title: 'Cerrar un diálogo, cancelar un arrastre o salir del modo activo', group: 'General', keys: 'Esc' },
]);

function useLayer() {
  return useSyncExternalStore(subscribeCommandLayer, getCommandLayer);
}

/** Texto con los tramos de la consulta resaltados (sin acentos). */
function Highlighted({ text, query }: { text: string; query: string }) {
  const ranges = highlightRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([from, to], i) => {
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      <mark key={i} className="ui-cmd__mark">
        {text.slice(from, to)}
      </mark>,
    );
    at = to;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function Palette({ onClose }: { onClose(): void }) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const registryVersion = useSyncExternalStore(subscribeCommandRegistry, commandRegistryVersion);
  // Las acciones se leen al abrir (y si se registra alguna): el estado de `enabled` y los títulos quedan al día.
  const commands = useMemo(() => listCommands().filter((c) => !c.enabled || c.enabled()), [registryVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useMemo(() => searchCommands(commands, query).map((m) => m.command), [commands, query]);
  const searching = query.trim().length > 0;
  const index = Math.min(active, Math.max(0, results.length - 1));
  const activeId = results[index] ? `${listId}-${index}` : undefined;

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[id="${listId}-${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index, listId]);

  const run = (c: Command) => {
    onClose();
    // Después de cerrar: si la acción abre otro diálogo, el foco ya volvió a su lugar y el nuevo lo toma bien.
    setTimeout(() => {
      try {
        c.run?.();
      } catch (err) {
        console.error(`Acción '${c.id}':`, err);
      }
    }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    const last = results.length - 1;
    if (e.key === 'ArrowDown') setActive(index >= last ? 0 : index + 1);
    else if (e.key === 'ArrowUp') setActive(index <= 0 ? Math.max(0, last) : index - 1);
    else if (e.key === 'PageDown') setActive(Math.min(last, index + 6));
    else if (e.key === 'PageUp') setActive(Math.max(0, index - 6));
    else if (e.key === 'Home' && e.ctrlKey) setActive(0);
    else if (e.key === 'End' && e.ctrlKey) setActive(Math.max(0, last));
    else if (e.key === 'Enter') {
      const c = results[index];
      if (c) run(c);
    } else return;
    e.preventDefault();
  };

  let lastGroup = '';
  return (
    <>
      <div className="ui-cmd__search">
        <TextField
          icon="search"
          block
          value={query}
          onChange={setQuery}
          onKeyDown={onKeyDown}
          placeholder="Buscar una acción: «saturación», «tema oscuro», «exportar»…"
          aria-label="Buscar una acción"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          data-autofocus
        />
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label="Acciones" className="ui-cmd__list">
        {results.length === 0 ? (
          <p className="ui-cmd__empty">No hay acciones que coincidan con «{query.trim()}».</p>
        ) : (
          results.map((c, i) => {
            const header = !searching && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const keys = commandKeys(c, IS_MAC_PLATFORM);
            return (
              <div key={c.id} role="presentation">
                {header && (
                  <div className="ui-cmd__group" role="presentation">
                    {header}
                  </div>
                )}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === index}
                  className={`ui-cmd__item${i === index ? ' is-active' : ''}`}
                  data-testid={`cmd-${c.id}`}
                  onMouseMove={() => i !== index && setActive(i)}
                  onClick={() => run(c)}
                >
                  <span className="ui-cmd__icon" aria-hidden="true">
                    {c.icon && <Icon name={c.icon} size={14} />}
                  </span>
                  <span className="ui-cmd__title">
                    <Highlighted text={c.title} query={query} />
                  </span>
                  {c.detail && <span className="ui-cmd__detail">{c.detail}</span>}
                  {searching && <span className="ui-cmd__where">{c.group}</span>}
                  {keys && <kbd className="ui-kbd">{keys}</kbd>}
                </div>
              </div>
            );
          })
        )}
      </div>
      <p className="ui-visually-hidden" role="status" aria-live="polite">
        {results.length === 1 ? '1 acción' : `${results.length} acciones`}
      </p>
      <div className="ui-cmd__foot" aria-hidden="true">
        <span>
          <kbd className="ui-kbd">↑</kbd> <kbd className="ui-kbd">↓</kbd> elegir
        </span>
        <span>
          <kbd className="ui-kbd">Intro</kbd> ejecutar
        </span>
        <span>
          <kbd className="ui-kbd">Esc</kbd> cerrar
        </span>
      </div>
    </>
  );
}

function ShortcutSheet({ onClose }: { onClose(): void }) {
  const registryVersion = useSyncExternalStore(subscribeCommandRegistry, commandRegistryVersion);
  const groups = useMemo(() => shortcutGroups(listCommands(), IS_MAC_PLATFORM), [registryVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open onClose={onClose} size="lg" title="Atajos de teclado" description="Los atajos con letra no se activan mientras escribís en un campo.">
      <div className="ui-cmd__sheet" data-testid="shortcut-sheet" data-autofocus tabIndex={-1}>
        {groups.map((g) => (
          <section key={g.group} className="ui-cmd__sheet-group" aria-label={g.group}>
            <h3 className="ui-overline">{g.group}</h3>
            <dl>
              {g.items.map((it) => (
                <div key={it.id} className="ui-cmd__sheet-row">
                  <dt>{it.title}</dt>
                  <dd>
                    <kbd className="ui-kbd">{it.keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** Raíz de la paleta y de los atajos globales: se monta una sola vez (en `App`). */
export function CommandLayer() {
  const layer = useLayer();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const c = commandForKey(listCommands(), e, {
        mac: IS_MAC_PLATFORM,
        typing: isTypingTarget(e.target as HTMLElement | null),
        dialogOpen: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
      });
      if (!c) return;
      e.preventDefault();
      try {
        c.run?.();
      } catch (err) {
        console.error(`Acción '${c.id}':`, err);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Dialog open={layer.palette} onClose={closeCommandPalette} size="md" title="Paleta de comandos" flush className="ui-cmd">
        <Palette key="palette" onClose={closeCommandPalette} />
      </Dialog>
      {layer.shortcuts && <ShortcutSheet onClose={closeShortcutSheet} />}
    </>
  );
}

export { openCommandPalette };
