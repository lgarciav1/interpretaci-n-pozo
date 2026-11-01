/**
 * Paleta de comandos (docs/decisiones/0018): búsqueda difusa sin acentos, registro de acciones y fuentes, atajos y
 * las acciones reales de la app.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  clearCommandSources,
  commandForKey,
  commandKeys,
  commandScore,
  fold,
  formatShortcut,
  highlightRanges,
  isTypingTarget,
  listCommands,
  registerCommandSource,
  searchCommands,
  shortcutGroups,
  shortcutMatches,
  sourceOf,
  termScore,
  type Command,
  type KeyEventLike,
} from '../src/ui/commands';

const cmd = (id: string, title: string, extra: Partial<Command> = {}): Command => ({ id, title, group: 'Prueba', run: () => {}, ...extra });
const key = (k: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
const ids = (list: { command: Command }[]) => list.map((m) => m.command.id);

describe('fold: sin acentos y en minúsculas, con el mismo largo', () => {
  it('quita tildes, diéresis y eñes', () => {
    expect(fold('Saturación de AGUA')).toBe('saturacion de agua');
    expect(fold('Camión ÑANDÚ güe')).toBe('camion nandu gue');
    expect(fold('φ pay · Sw')).toBe('φ pay · sw');
  });
  it('conserva el largo (los índices valen para el texto original)', () => {
    for (const s of ['Interpretación', 'Mayús', 'a😀b', 'Ñu']) expect(fold(s)).toHaveLength(s.length);
  });
});

describe('termScore', () => {
  it('prefijo > comienzo de palabra > dentro de una palabra > subsecuencia > nada', () => {
    const t = fold('ir al paso saturacion');
    expect(termScore('ir', t)).toBe(100);
    expect(termScore('sat', t)!).toBeGreaterThan(termScore('turac', t)!);
    expect(termScore('turac', t)!).toBeGreaterThan(termScore('sturcn', t)!);
    expect(termScore('sturcn', t)).not.toBeNull();
    expect(termScore('zzz', t)).toBeNull();
  });
  it('una o dos letras sueltas no coinciden como subsecuencia (evita ruido)', () => {
    expect(termScore('zq', 'a z b q')).toBeNull();
    expect(termScore('xyz', 'x y z')).not.toBeNull();
  });
});

describe('searchCommands', () => {
  const list = [
    cmd('step:saturation', 'Ir al paso Saturación de agua', { group: 'Flujo', keywords: ['sw'] }),
    cmd('theme:dark', 'Usar el tema oscuro', { group: 'Vista', keywords: ['noche'] }),
    cmd('project:export', 'Exportar datos y figuras…', { group: 'Proyecto', keywords: ['las', 'csv', 'excel'] }),
    cmd('edit:undo', 'Deshacer', { group: 'Edición' }),
    cmd('tracks:sw', 'Mostrar los modelos de Sw lado a lado', { group: 'Pistas', keywords: ['archie', 'simandoux'] }),
    cmd('doc:viewer', 'Mover el cursor del visor', { group: 'Visor', keys: '↑ ↓', run: undefined as unknown as () => void }),
  ];

  it('sin consulta devuelve todas las ejecutables en su orden (las de solo documentación no)', () => {
    expect(ids(searchCommands(list, ''))).toEqual(['step:saturation', 'theme:dark', 'project:export', 'edit:undo', 'tracks:sw']);
    expect(ids(searchCommands(list, '   '))).toHaveLength(5);
  });

  it('busca sin acentos ni mayúsculas, en ambos sentidos', () => {
    expect(ids(searchCommands(list, 'saturacion'))[0]).toBe('step:saturation');
    expect(ids(searchCommands(list, 'SATURACIÓN'))[0]).toBe('step:saturation');
    expect(ids(searchCommands(list, 'edicion'))).toEqual(['edit:undo']); // por el grupo «Edición»
    expect(ids(searchCommands(list, 'deshacér'))).toEqual(['edit:undo']);
  });

  it('todos los términos tienen que aparecer, en el orden que sea', () => {
    expect(ids(searchCommands(list, 'oscuro tema'))).toEqual(['theme:dark']);
    expect(ids(searchCommands(list, 'modelos sw'))).toEqual(['tracks:sw']);
    expect(searchCommands(list, 'tema inexistente')).toEqual([]);
  });

  it('también busca en las palabras clave', () => {
    expect(ids(searchCommands(list, 'noche'))).toEqual(['theme:dark']);
    expect(ids(searchCommands(list, 'simandoux'))).toEqual(['tracks:sw']);
    expect(ids(searchCommands(list, 'excel'))).toEqual(['project:export']);
  });

  it('el título pesa más que las palabras clave y el grupo', () => {
    const l = [cmd('a', 'Algo', { keywords: ['saturacion'] }), cmd('b', 'Saturación', {})];
    expect(ids(searchCommands(l, 'saturacion'))).toEqual(['b', 'a']);
  });

  it('tolera letras salteadas (subsecuencia) con tres o más letras', () => {
    expect(ids(searchCommands(list, 'expdat'))[0]).toBe('project:export');
    expect(ids(searchCommands(list, 'mdlsw'))).toEqual(['tracks:sw']); // m·d·l·s·w aparecen en ese orden en el título
    expect(searchCommands(list, 'swmod')).toEqual([]); // después de «Sw» no queda ninguna «m»
  });

  it('el comienzo del título gana a una coincidencia más adentro; empates por orden de registro', () => {
    const l = [cmd('1', 'Abrir el visor'), cmd('2', 'Visor del pozo'), cmd('3', 'Otro visor')];
    expect(ids(searchCommands(l, 'visor'))).toEqual(['2', '3', '1']);
    const tie = [cmd('x', 'Zona uno'), cmd('y', 'Zona dos')];
    expect(ids(searchCommands(tie, 'zona'))).toEqual(['x', 'y']);
  });

  it('el puntaje de una consulta vacía es 0 y el de una que no coincide es null', () => {
    expect(commandScore('', { title: 'a', group: 'b' })).toBe(0);
    expect(commandScore('qqq', { title: 'a', group: 'b' })).toBeNull();
  });
});

describe('highlightRanges', () => {
  it('marca los términos sobre el texto original, sin acentos', () => {
    expect(highlightRanges('Ir al paso Saturación', 'saturacion')).toEqual([[11, 21]]);
    expect(highlightRanges('Ir al paso Saturación', 'ir paso')).toEqual([[0, 2], [6, 10]]);
  });
  it('une los tramos que se tocan o se pisan y no marca lo que no está pegado', () => {
    expect(highlightRanges('abcdef', 'abc bcd')).toEqual([[0, 4]]);
    expect(highlightRanges('abcdef', 'ace')).toEqual([]);
  });
});

describe('atajos', () => {
  it('shortcutMatches: Ctrl en Windows y Linux, Cmd en Mac', () => {
    const k = { key: 'k', mod: true };
    expect(shortcutMatches(key('k', { ctrlKey: true }), k, false)).toBe(true);
    expect(shortcutMatches(key('K', { ctrlKey: true }), k, false)).toBe(true);
    expect(shortcutMatches(key('k', { metaKey: true }), k, false)).toBe(false);
    expect(shortcutMatches(key('k', { metaKey: true }), k, true)).toBe(true);
    expect(shortcutMatches(key('k', { ctrlKey: true }), k, true)).toBe(false);
    expect(shortcutMatches(key('k'), k, false)).toBe(false);
    expect(shortcutMatches(key('k', { ctrlKey: true, shiftKey: true }), k, false)).toBe(false);
    expect(shortcutMatches(key('k', { ctrlKey: true, altKey: true }), k, false)).toBe(false);
  });
  it('«?» vale con el Mayús que lo produce, pero no con Ctrl', () => {
    const q = { key: '?' };
    expect(shortcutMatches(key('?', { shiftKey: true }), q, false)).toBe(true);
    expect(shortcutMatches(key('?'), q, false)).toBe(true);
    expect(shortcutMatches(key('?', { shiftKey: true, ctrlKey: true }), q, false)).toBe(false);
  });
  it('formatShortcut', () => {
    expect(formatShortcut({ key: 'k', mod: true }, false)).toBe('Ctrl+K');
    expect(formatShortcut({ key: 'k', mod: true }, true)).toBe('⌘K');
    expect(formatShortcut({ key: 'z', mod: true, shift: true }, false)).toBe('Ctrl+Mayús+Z');
    expect(formatShortcut({ key: 'z', mod: true, shift: true }, true)).toBe('⇧⌘Z');
    expect(formatShortcut({ key: '?' }, false)).toBe('?');
    expect(formatShortcut({ key: 'Escape' }, false)).toBe('Esc');
    expect(formatShortcut({ key: 'ArrowUp', alt: true }, false)).toBe('Alt+↑');
  });
  it('commandKeys: `keys` manda sobre `shortcut`', () => {
    expect(commandKeys({ shortcut: { key: 's', mod: true } }, false)).toBe('Ctrl+S');
    expect(commandKeys({ shortcut: { key: 's', mod: true }, keys: 'otro' }, false)).toBe('otro');
    expect(commandKeys({}, false)).toBeNull();
  });
});

describe('isTypingTarget: no se captura una tecla mientras se escribe', () => {
  it('campos de texto, áreas y selectores sí; botones, casillas y deshabilitados no', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text', readOnly: true })).toBe(false);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text', disabled: true })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('commandForKey: qué acción dispara una tecla', () => {
  const run = vi.fn();
  const list: Command[] = [
    cmd('palette', 'Paleta', { shortcut: { key: 'k', mod: true }, inInput: true, inDialog: true, run }),
    cmd('help', 'Atajos', { shortcut: { key: '?' }, run }),
    cmd('save', 'Guardar', { shortcut: { key: 's', mod: true }, run }),
    cmd('undo', 'Deshacer', { shortcut: { key: 'z', mod: true }, bind: false, run }),
    cmd('off', 'Deshabilitada', { shortcut: { key: 'e', mod: true }, enabled: () => false, run }),
    cmd('doc', 'Solo documentación', { shortcut: { key: 'd', mod: true }, run: undefined as unknown as () => void }),
  ];
  const idle = { mac: false, typing: false, dialogOpen: false };
  const find = (e: KeyEventLike, state = idle) => commandForKey(list, e, state)?.id ?? null;

  it('encuentra la acción por su combinación', () => {
    expect(find(key('k', { ctrlKey: true }))).toBe('palette');
    expect(find(key('?', { shiftKey: true }))).toBe('help');
    expect(find(key('s', { ctrlKey: true }))).toBe('save');
    expect(find(key('s', { metaKey: true }), { ...idle, mac: true })).toBe('save');
  });
  it('mientras se escribe en un campo solo vale lo que lo pide (Ctrl+K), nunca «?» ni Ctrl+S', () => {
    const typing = { ...idle, typing: true };
    expect(find(key('k', { ctrlKey: true }), typing)).toBe('palette');
    expect(find(key('?', { shiftKey: true }), typing)).toBeNull();
    expect(find(key('s', { ctrlKey: true }), typing)).toBeNull();
  });
  it('con un diálogo abierto solo vale lo que lo pide (Ctrl+K cierra la paleta)', () => {
    const dialog = { ...idle, dialogOpen: true };
    expect(find(key('k', { ctrlKey: true }), dialog)).toBe('palette');
    expect(find(key('?', { shiftKey: true }), dialog)).toBeNull();
    expect(find(key('s', { ctrlKey: true }), dialog)).toBeNull();
  });
  it('respeta los atajos que maneja otro código: Ctrl+Z (`bind: false`) no se captura', () => {
    expect(find(key('z', { ctrlKey: true }))).toBeNull();
  });
  it('ignora las deshabilitadas y las que no tienen `run`', () => {
    expect(find(key('e', { ctrlKey: true }))).toBeNull();
    expect(find(key('d', { ctrlKey: true }))).toBeNull();
  });
  it('una combinación sin acción no dispara nada', () => {
    expect(find(key('q', { ctrlKey: true }))).toBeNull();
    expect(find(key('k'))).toBeNull();
  });
});

describe('registro de acciones', () => {
  afterEach(() => {
    clearCommandSources();
    vi.restoreAllMocks();
  });

  it('suma las acciones de cada fuente en el orden en que se registraron', () => {
    registerCommandSource('a', () => [cmd('a1', 'Uno')]);
    registerCommandSource('b', () => [cmd('b1', 'Dos'), cmd('b2', 'Tres')]);
    expect(listCommands().map((c) => c.id)).toEqual(['a1', 'b1', 'b2']);
  });

  it('una fuente es una función: ve el estado de ahora cada vez que se lista', () => {
    let on = false;
    registerCommandSource('s', () => [cmd('t', on ? 'Ocultar panel' : 'Mostrar panel')]);
    expect(listCommands()[0]!.title).toBe('Mostrar panel');
    on = true;
    expect(listCommands()[0]!.title).toBe('Ocultar panel');
  });

  it('la baja quita la fuente; una baja vieja no quita la que la reemplazó', () => {
    const off1 = registerCommandSource('s', () => [cmd('x', 'Primera')]);
    const off2 = registerCommandSource('s', () => [cmd('x', 'Segunda')]);
    off1();
    expect(listCommands().map((c) => c.title)).toEqual(['Segunda']);
    off2();
    expect(listCommands()).toEqual([]);
  });

  it('un módulo nuevo aporta sus acciones sin tocar el núcleo', () => {
    registerCommandSource('nucleo', () => [cmd('core:one', 'Del núcleo')]);
    registerCommandSource('src/modules/mi-modulo/commands.ts', () => [cmd('mi-modulo:hacer', 'Hacer lo del módulo', { keywords: ['especial'] })]);
    expect(ids(searchCommands(listCommands(), 'especial'))).toEqual(['mi-modulo:hacer']);
  });

  it('ids repetidos: gana el primero, con aviso', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerCommandSource('a', () => [cmd('dup', 'Primero')]);
    registerCommandSource('b', () => [cmd('dup', 'Segundo'), cmd('ok', 'Otro')]);
    expect(listCommands().map((c) => c.title)).toEqual(['Primero', 'Otro']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('acciones mal armadas y fuentes que fallan se ignoran sin romper la paleta', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerCommandSource('rota', () => {
      throw new Error('falla');
    });
    registerCommandSource('mala', () => [{ id: 'sin-titulo', group: 'x' } as unknown as Command, cmd('buena', 'Buena')]);
    expect(listCommands().map((c) => c.id)).toEqual(['buena']);
    expect(warn).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('sourceOf acepta una función o una lista fija', () => {
    expect(sourceOf(() => [cmd('f', 'F')])!()).toHaveLength(1);
    expect(sourceOf([cmd('l', 'L')])!()).toHaveLength(1);
    expect(sourceOf(undefined)).toBeNull();
    expect(sourceOf(42)).toBeNull();
  });

  it('la hoja de atajos agrupa lo que tiene atajo o `keys`, incluida la documentación sin `run`', () => {
    const list = [
      cmd('a', 'Guardar', { group: 'Proyecto', shortcut: { key: 's', mod: true } }),
      cmd('b', 'Sin atajo', { group: 'Proyecto' }),
      cmd('c', 'Mover el cursor', { group: 'Visor', keys: '↑ ↓', run: undefined as unknown as () => void }),
      cmd('d', 'Exportar', { group: 'Proyecto', shortcut: { key: 'e', mod: true } }),
    ];
    expect(shortcutGroups(list, false)).toEqual([
      { group: 'Proyecto', items: [{ id: 'a', title: 'Guardar', keys: 'Ctrl+S' }, { id: 'd', title: 'Exportar', keys: 'Ctrl+E' }] },
      { group: 'Visor', items: [{ id: 'c', title: 'Mover el cursor', keys: '↑ ↓' }] },
    ]);
  });
});

describe('las acciones reales de la app', () => {
  // Registra las fuentes de los `commands.ts` de la app y de los módulos (importa casi toda la app: tarda).
  beforeAll(async () => {
    clearCommandSources();
    await import('../src/app/commands');
    await import('../src/ui/components/CommandPalette');
  }, 120_000);

  it('cubren lo que pide la paleta: pasos, pestañas, historial, exportar, snapshots, pozo y demo, tema, tamaño, pistas y crossplot', () => {
    const all = listCommands();
    const have = (id: string) => expect(all.map((c) => c.id), id).toContain(id);

    // ir a cada paso del flujo
    for (const s of ['load', 'qc', 'zones', 'shale', 'porosity', 'rw', 'saturation', 'cutoffs', 'summary']) have(`step:${s}`);
    // abrir cada pestaña del dock (también las que aportan los módulos)
    for (const d of ['results', 'diagnostics', 'trends', 'zone-cards', 'crossplot', 'histogram', 'engine']) have(`dock:${d}`);
    for (const id of ['edit:undo', 'edit:redo', 'project:export', 'project:save', 'project:open', 'project:snapshots', 'project:snapshot-now', 'well:load', 'well:tp', 'well:demo']) have(id);
    for (const id of ['theme:light', 'theme:dark', 'theme:system', 'scale:compact', 'scale:normal', 'scale:large', 'workspace:petrophysics', 'workspace:geology']) have(id);
    for (const id of ['tracks:builder', 'tracks:template-factory', 'tracks:template-save', 'tracks:sw-models']) have(id);
    for (const t of ['density-neutron', 'pickett', 'phi-sw', 'gr-rt']) have(`crossplot:template:${t}`);
    // Plantillas de determinación de litologías (0059)
    for (const t of ['sonic-neutron', 'density-sonic', 'm-n', 'rhomaa-umaa', 'pe-k', 'pe-thk']) have(`crossplot:template:${t}`);
    have('ui:palette');
    have('ui:shortcuts');

    // ids únicos y todo con título y grupo
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    expect(all.every((c) => c.title && c.group)).toBe(true);
  });

  it('cada acción con atajo propio tiene su combinación, y los atajos que se capturan no se pisan entre sí', () => {
    const all = listCommands();
    const bound = all.filter((c) => c.shortcut && c.bind !== false);
    const seen = new Map<string, string>();
    for (const c of bound) {
      const k = formatShortcut(c.shortcut!, false);
      expect(seen.get(k), `${c.id} repite ${k}`).toBeUndefined();
      seen.set(k, c.id);
    }
    expect([...seen.keys()]).toEqual(expect.arrayContaining(['Ctrl+K', '?', 'Ctrl+S', 'Ctrl+O', 'Ctrl+E']));
  });

  it('buscar «saturacion» o «tema oscuro» encuentra las acciones esperadas', () => {
    const all = listCommands();
    expect(searchCommands(all, 'saturacion')[0]!.command.id).toBe('step:saturation');
    expect(ids(searchCommands(all, 'tema oscuro'))[0]).toBe('theme:dark');
    expect(ids(searchCommands(all, 'pickett'))[0]).toBe('crossplot:template:pickett');
    expect(ids(searchCommands(all, 'umaa'))[0]).toBe('crossplot:template:rhomaa-umaa');
    expect(ids(searchCommands(all, 'modelos de sw'))[0]).toBe('tracks:sw-models');
    expect(ids(searchCommands(all, 'exportar'))).toContain('project:export');
    expect(ids(searchCommands(all, 'snapshot'))).toEqual(expect.arrayContaining(['project:snapshots', 'project:snapshot-now']));
  });

  it('deshacer y rehacer muestran sus atajos (los maneja historyActions)', () => {
    const undo = listCommands().find((c) => c.id === 'edit:undo')!;
    expect(undo.bind).toBe(false);
    expect(commandKeys(undo, false)).toBe('Ctrl+Z');
  });
});
