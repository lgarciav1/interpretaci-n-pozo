/**
 * REGISTRO DE ACCIONES, BÚSQUEDA DIFUSA Y ATAJOS (docs/decisiones/0018). Puro: sin React ni stores.
 *
 * Una acción (`Command`) se registra desde donde vive, sin tocar el núcleo:
 *
 *     // src/modules/<id>/commands.ts  (se descubre solo, igual que dock.tsx)
 *     export const commands: CommandSource = () => [
 *       { id: 'mi-modulo:hacer', title: 'Hacer algo', group: 'Mi módulo', keywords: ['otra palabra'], run: () => hacer() },
 *     ];
 *
 * o, desde cualquier archivo o componente, `registerCommandSource('id', () => [...])` (devuelve la baja; el hook
 * `useCommandSource` de `components/CommandPalette.tsx` lo hace al montar y desmontar). Una fuente es una FUNCIÓN: se
 * evalúa cada vez que se abre la paleta o se pulsa una tecla, así los títulos, el `enabled` y las acciones que
 * dependen del estado (los pasos del flujo, las pestañas del dock, las plantillas propias) están siempre al día.
 *
 * La paleta (Ctrl/Cmd+K) busca sobre `listCommands()`; la hoja de atajos («?») lista lo que tenga atajo o `keys`.
 */
import type { IconName } from './components/Icon';

/** Combinación de teclas. `mod` = Ctrl en Windows y Linux, Cmd en Mac. */
export interface Shortcut {
  /** `KeyboardEvent.key` ('k', '?', 'Escape', 'ArrowUp'…); las letras sin importar mayúsculas. */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface Command {
  /** Único en toda la app ('step:saturation', 'dock:crossplot'). */
  id: string;
  /** Lo que se busca y se lee: con verbo, en español («Ir al paso Saturación»). */
  title: string;
  /** Grupo en la paleta y en la hoja de atajos («Flujo», «Paneles», «Edición»…). */
  group: string;
  /** Otras palabras con las que se la busca (se comparan sin acentos). */
  keywords?: readonly string[];
  icon?: IconName;
  /** Detalle corto a la derecha del título («activo», «sin cambios»). */
  detail?: string;
  /** Atajo propio de la acción: la capa global lo captura y la ejecuta (salvo `bind: false`). */
  shortcut?: Shortcut;
  /** false: el atajo ya lo maneja otro código (Ctrl+Z, flechas del visor); acá solo se muestra. */
  bind?: boolean;
  /** Texto del atajo cuando no es una sola combinación («↑ ↓», «Alt+←/→»): reemplaza al de `shortcut`. */
  keys?: string;
  /** El atajo también vale con el foco en un campo de texto (Ctrl+K). Por defecto, no. */
  inInput?: boolean;
  /** El atajo también vale con un diálogo abierto (Ctrl+K lo cierra). Por defecto, no. */
  inDialog?: boolean;
  /** Ejecuta la acción. Sin `run` la entrada es solo documentación (aparece en la hoja de atajos, no en la paleta). */
  run?(): void;
  /** false: se ve deshabilitada y no se ejecuta («Nada para deshacer»). */
  enabled?(): boolean;
}

export type CommandSource = () => readonly Command[];

// ── registro ─────────────────────────────────────────────────────────────────────────────────────────────────────

const sources = new Map<string, CommandSource>();
const registryListeners = new Set<() => void>();
let registryVersion = 0;

/** Registra una fuente de acciones. Devuelve la baja. Registrar el mismo id reemplaza la fuente anterior. */
export function registerCommandSource(sourceId: string, source: CommandSource): () => void {
  sources.set(sourceId, source);
  registryVersion++;
  registryListeners.forEach((l) => l());
  return () => {
    if (sources.get(sourceId) === source) {
      sources.delete(sourceId);
      registryVersion++;
      registryListeners.forEach((l) => l());
    }
  };
}

export function subscribeCommandRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

/** Cambia cada vez que se suma o se quita una fuente (para `useSyncExternalStore`). */
export const commandRegistryVersion = (): number => registryVersion;

/** Acción válida: con id, título y grupo (una mal armada se ignora con aviso, no rompe la paleta). */
const isCommand = (c: unknown): c is Command => !!c && typeof c === 'object' && typeof (c as Command).id === 'string' && !!(c as Command).id && typeof (c as Command).title === 'string' && typeof (c as Command).group === 'string';

/**
 * Todas las acciones, en el orden en que se registraron las fuentes. Los ids repetidos se ignoran (gana la primera)
 * con un aviso en la consola; una fuente que falla se saltea.
 */
export function listCommands(): Command[] {
  const out: Command[] = [];
  const ids = new Set<string>();
  for (const [sourceId, source] of sources) {
    let list: readonly Command[];
    try {
      list = source();
    } catch (err) {
      console.error(`Fuente de acciones '${sourceId}':`, err);
      continue;
    }
    for (const c of list) {
      if (!isCommand(c)) {
        console.warn(`Fuente de acciones '${sourceId}': acción inválida (falta id, título o grupo); se ignora.`);
        continue;
      }
      if (ids.has(c.id)) {
        console.warn(`Fuente de acciones '${sourceId}': la acción '${c.id}' está repetida; se ignora.`);
        continue;
      }
      ids.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/** Quita todo (pruebas). */
export function clearCommandSources(): void {
  sources.clear();
  registryVersion++;
  registryListeners.forEach((l) => l());
}

/** Una fuente descubierta por archivo (`commands.ts`): la función o una lista fija. */
export function sourceOf(exported: unknown): CommandSource | null {
  if (typeof exported === 'function') return exported as CommandSource;
  if (Array.isArray(exported)) return () => exported as Command[];
  return null;
}

// ── búsqueda difusa sin acentos ──────────────────────────────────────────────────────────────────────────────────

/**
 * Texto sin acentos y en minúsculas, carácter a carácter: el resultado tiene EL MISMO LARGO que el original, así los
 * índices de una coincidencia sirven para resaltar el texto original («Ñ» → «n», «á» → «a»).
 */
export function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch.length !== 1) {
      out += ch; // fuera del BMP (dos unidades): se deja igual para mantener el largo
      continue;
    }
    const base = (ch.normalize('NFD')[0] ?? ch).toLowerCase();
    out += base.length === 1 ? base : ch;
  }
  return out;
}

const WORD_BREAK = /[\s\-–—_/.·:()«»,;]/;

/**
 * Puntaje de un término contra un texto ya plegado (`fold`), o null si no aparece:
 * 100 al comienzo del texto · 90 al comienzo de una palabra · 60 dentro de una palabra · 25 subsecuencia (las letras
 * en orden, no pegadas: «cmpm» → «comparar modelos»). Menor posición y subsecuencias más compactas puntúan más.
 */
export function termScore(term: string, text: string): number | null {
  if (!term) return 0;
  let wordStart = -1;
  let anywhere = -1;
  for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + 1)) {
    if (i === 0) return 100;
    if (wordStart < 0 && WORD_BREAK.test(text[i - 1]!)) wordStart = i;
    if (anywhere < 0) anywhere = i;
  }
  if (wordStart >= 0) return 90 - Math.min(20, wordStart / 4);
  if (anywhere >= 0) return 60 - Math.min(20, anywhere / 4);
  if (term.length < 3) return null; // subsecuencias de 1–2 letras coinciden con todo
  let ti = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < text.length && ti < term.length; i++) {
    if (text[i] === term[ti]) {
      if (first < 0) first = i;
      last = i;
      ti++;
    }
  }
  if (ti < term.length) return null;
  return Math.max(5, 25 - Math.min(20, last - first + 1 - term.length));
}

/** Pesos de cada campo: lo que está en el título pesa más que el grupo o las palabras clave. */
const FIELD_WEIGHT = { title: 1, keywords: 0.75, group: 0.5 } as const;

export function commandScore(query: string, c: Pick<Command, 'title' | 'group' | 'keywords'>): number | null {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const title = fold(c.title);
  const group = fold(c.group);
  const keywords = fold((c.keywords ?? []).join(' '));
  let total = 0;
  const weighted = (score: number | null, w: number) => (score === null ? null : score * w);
  for (const t of terms) {
    const best = [weighted(termScore(t, title), FIELD_WEIGHT.title), keywords ? weighted(termScore(t, keywords), FIELD_WEIGHT.keywords) : null, weighted(termScore(t, group), FIELD_WEIGHT.group)].reduce<number | null>(
      (m, x) => (x !== null && (m === null || x > m) ? x : m),
      null,
    );
    if (best === null) return null;
    total += best;
  }
  // Prefiere los títulos más cortos y los que empiezan con la consulta completa.
  if (terms.length > 1 && title.startsWith(terms.join(' '))) total += 30;
  return total - title.length * 0.05;
}

export interface CommandMatch {
  command: Command;
  score: number;
}

/**
 * Filtra y ordena por relevancia. Sin consulta devuelve todas en su orden. Solo las que se pueden ejecutar (`run`).
 * Empates: orden de registro. Pura (recibe la lista).
 */
export function searchCommands(commands: readonly Command[], query: string): CommandMatch[] {
  const runnable = commands.filter((c) => typeof c.run === 'function');
  if (!query.trim()) return runnable.map((command) => ({ command, score: 0 }));
  const out: (CommandMatch & { i: number })[] = [];
  runnable.forEach((command, i) => {
    const score = commandScore(query, command);
    if (score !== null) out.push({ command, score, i });
  });
  return out.sort((a, b) => b.score - a.score || a.i - b.i).map(({ command, score }) => ({ command, score }));
}

/**
 * Tramos [desde, hasta) del título donde aparecen los términos de la consulta (solo coincidencias pegadas; las
 * subsecuencias no se resaltan). Para resaltar sin acentos.
 */
export function highlightRanges(title: string, query: string): [number, number][] {
  const text = fold(title);
  const ranges: [number, number][] = [];
  for (const t of fold(query).split(/\s+/).filter(Boolean)) {
    const at = text.indexOf(t);
    if (at >= 0) ranges.push([at, at + t.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

// ── atajos ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Una tecla que es un símbolo ('?', '/', '+'): el Mayús que la produce no cuenta como modificador. */
const isSymbol = (key: string) => key.length === 1 && !/[a-z0-9]/i.test(key);

/** ¿El evento es esa combinación? `mac`: Cmd en lugar de Ctrl. Exacto en Alt, y en Mayús salvo para símbolos. */
export function shortcutMatches(e: KeyEventLike, s: Shortcut, mac: boolean): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  const mod = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (!!s.mod !== mod || otherMod) return false;
  if (!!s.alt !== e.altKey) return false;
  if (!isSymbol(s.key) && !!s.shift !== e.shiftKey) return false;
  return true;
}

const KEY_NAMES: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Intro', Delete: 'Supr', ' ': 'Espacio' };

/** Texto de un atajo: «Ctrl+K», «Ctrl+Mayús+Z», «⌘K», «?». */
export function formatShortcut(s: Shortcut, mac: boolean): string {
  const key = KEY_NAMES[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key);
  if (mac) return `${s.alt ? '⌥' : ''}${s.shift && !isSymbol(s.key) ? '⇧' : ''}${s.mod ? '⌘' : ''}${key}`;
  return [s.mod ? 'Ctrl' : '', s.alt ? 'Alt' : '', s.shift && !isSymbol(s.key) ? 'Mayús' : '', key].filter(Boolean).join('+');
}

/** Atajo a mostrar de una acción (`keys` manda sobre `shortcut`), o null. */
export function commandKeys(c: Pick<Command, 'shortcut' | 'keys'>, mac: boolean): string | null {
  if (c.keys) return c.keys;
  return c.shortcut ? formatShortcut(c.shortcut, mac) : null;
}

/** Lo mínimo que se mira de un elemento para saber si el usuario está escribiendo en él. */
export interface TypingTargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
}

const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password', '']);

/** ¿Escribir una tecla ahí inserta texto (campo editable, área de texto, selector con teclado)? */
export function isTypingTarget(el: TypingTargetLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA') return !el.readOnly && !el.disabled;
  if (tag === 'SELECT') return !el.disabled;
  if (tag === 'INPUT') return TEXT_INPUTS.has((el.type ?? 'text').toLowerCase()) && !el.readOnly && !el.disabled;
  return false;
}

/**
 * La acción con atajo propio que dispara un evento, o null. Reglas (puras, con el estado de la página como
 * parámetro): no se captura nada mientras se escribe en un campo (salvo `inInput`: Ctrl+K), ni con un diálogo abierto
 * (salvo `inDialog`), ni si la acción está deshabilitada o su atajo lo maneja otro código (`bind: false`).
 */
export function commandForKey(commands: readonly Command[], e: KeyEventLike, state: { mac: boolean; typing: boolean; dialogOpen: boolean }): Command | null {
  for (const c of commands) {
    if (!c.shortcut || c.bind === false || typeof c.run !== 'function') continue;
    if (!shortcutMatches(e, c.shortcut, state.mac)) continue;
    if (state.typing && !c.inInput) continue;
    // Sin modificador (p. ej. «?») ni siquiera con el foco en un botón dentro de un diálogo.
    if (state.dialogOpen && !c.inDialog) continue;
    if (c.enabled && !c.enabled()) continue;
    return c;
  }
  return null;
}

// ── estado de la capa (paleta y hoja de atajos abiertas) ─────────────────────────────────────────────────────────

export interface CommandLayerState {
  palette: boolean;
  shortcuts: boolean;
}

let layer: CommandLayerState = { palette: false, shortcuts: false };
const layerListeners = new Set<() => void>();
const setLayer = (next: Partial<CommandLayerState>) => {
  const merged = { ...layer, ...next };
  if (merged.palette === layer.palette && merged.shortcuts === layer.shortcuts) return;
  layer = merged;
  layerListeners.forEach((l) => l());
};

export const getCommandLayer = (): CommandLayerState => layer;
export function subscribeCommandLayer(listener: () => void): () => void {
  layerListeners.add(listener);
  return () => layerListeners.delete(listener);
}
export const openCommandPalette = (): void => setLayer({ palette: true, shortcuts: false });
export const closeCommandPalette = (): void => setLayer({ palette: false });
export const toggleCommandPalette = (): void => setLayer({ palette: !layer.palette, shortcuts: false });
export const openShortcutSheet = (): void => setLayer({ shortcuts: true, palette: false });
export const closeShortcutSheet = (): void => setLayer({ shortcuts: false });

/** Agrupa para la hoja de atajos: solo lo que tiene atajo, en el orden de aparición de los grupos. */
export function shortcutGroups(commands: readonly Command[], mac: boolean): { group: string; items: { id: string; title: string; keys: string }[] }[] {
  const groups = new Map<string, { id: string; title: string; keys: string }[]>();
  for (const c of commands) {
    const keys = commandKeys(c, mac);
    if (!keys) continue;
    const list = groups.get(c.group) ?? [];
    list.push({ id: c.id, title: c.title, keys });
    groups.set(c.group, list);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}
