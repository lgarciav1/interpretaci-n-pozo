/**
 * «Log Digitizer» como módulo de panel (docs/decisiones/0063): registro, docs para Ecuaciones, pestaña del dock
 * descubierta sola, acción de la paleta y aislamiento del motor petrofísico.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { EQUATION_EXTRAS } from '../src/app/ecuaciones/extras';
import { buildEquationEntries, filterEntries, groupEntries } from '../src/app/ecuaciones/model';
import { collectDockPanels, DOCK_PANELS } from '../src/app/shell/dockPanels';
import { useProject } from '../src/app/store/project';
import { createProject } from '../src/core/state/project';
import { listCommands, registerCommandSource, searchCommands } from '../src/ui/commands';
import { MODULES, PANEL_MODULES, registry } from '../src/modules';
import digitizer, { DIGITIZER_DOCK_ID, DIGITIZER_ID } from '../src/modules/digitizer';
import { commands, DIGITIZER_COMMAND_ID } from '../src/modules/digitizer/commands';
import { initialDigitizerState, useDigitizer } from '../src/modules/digitizer/store';
import { syntheticWell } from '../src/app/demo/syntheticWell';

afterEach(() => useDigitizer.setState(initialDigitizerState()));

describe('registro del módulo de panel «Log Digitizer»', () => {
  it('está en PANEL_MODULES, con categoría nueva «Adquisición de datos» y su carpeta', () => {
    expect(PANEL_MODULES).toContain(digitizer);
    expect(registry.getPanel(DIGITIZER_ID)).toBe(digitizer);
    expect(digitizer.name).toBe('Log Digitizer');
    expect(registry.categoryLabel(digitizer.category)).toBe('Adquisición de datos');
    expect(registry.categories.map((c) => c.id)).toContain('data-acquisition');
    expect(Object.keys(import.meta.glob('../src/modules/*/index.ts'))).toContain('../src/modules/digitizer/index.ts');
    expect(DIGITIZER_DOCK_ID).toBe(DIGITIZER_ID);
  });

  it('no es un nodo del motor petrofísico: no corre ni cambia resultados', () => {
    expect(registry.get(DIGITIZER_ID)).toBeUndefined();
    expect(registry.modules).toHaveLength(MODULES.length);
    const demo = syntheticWell();
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(toEngineWell(demo.well));
    const r = engine.run(emptyInterpretation(demo.zones));
    expect(r.nodes.map((n) => n.moduleId)).not.toContain(DIGITIZER_ID);
  });
});

describe('docs para el módulo Ecuaciones', () => {
  const entries = buildEquationEntries(registry, EQUATION_EXTRAS);
  const entry = entries.find((e) => e.id === DIGITIZER_ID)!;
  it('entrada propia en su categoría, con las ecuaciones de calibración, homografía, color y costo del trazado', () => {
    expect(entry).toBeDefined();
    expect(entry.categoryId).toBe('data-acquisition');
    expect(entry.params).toEqual([]);
    expect(entry.docs.equations.length).toBeGreaterThanOrEqual(8);
    const latex = entry.docs.equations.map((e) => e.latex).join('\n');
    expect(latex).toMatch(/z_\{i\+1\}/);
    expect(latex).toMatch(/\\log_\{10\}/);
    expect(latex).toMatch(/h_6/);
    expect(latex).toMatch(/\\Delta E/);
    expect(latex).toMatch(/n_\{cadenas\}/);
    expect(entry.docs.references.join(' ')).toMatch(/Hartley/);
    expect(entry.docs.references.join(' ')).toMatch(/Viterbi/);
    expect(groupEntries(entries).find((g) => g.categoryId === 'data-acquisition')!.entries.map((e) => e.id)).toEqual([DIGITIZER_ID]);
  });
  it('se encuentra buscando en Ecuaciones', () => {
    expect(filterEntries(entries, 'homografia').map((e) => e.id)).toContain(DIGITIZER_ID);
    expect(filterEntries(entries, 'escaneado').map((e) => e.id)).toContain(DIGITIZER_ID);
  });
});

describe('pestaña del dock y acción de la paleta', () => {
  it('el dock descubre la pestaña «Digitalizar» desde src/modules/digitizer/dock.tsx', async () => {
    const mod = await import('../src/modules/digitizer/dock');
    const panels = collectDockPanels({ 'digitizer/dock.tsx': mod }, []);
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({ id: DIGITIZER_DOCK_ID, title: 'Digitalizar', icon: 'pen' });
    expect(DOCK_PANELS.map((p) => p.id)).toContain(DIGITIZER_DOCK_ID);
  });

  it('«Abrir Log Digitizer» se encuentra por «digitalizar» o «escaneado», funciona sin pozo y no toca el proyecto', () => {
    const c = commands().find((k) => k.id === DIGITIZER_COMMAND_ID)!;
    expect(c.title).toBe('Abrir Log Digitizer');
    const off = registerCommandSource('test-digitizer', commands);
    try {
      expect(searchCommands(listCommands(), 'log digitizer')[0]?.command.id).toBe(DIGITIZER_COMMAND_ID);
      expect(searchCommands(listCommands(), 'escaneado').map((m) => m.command.id)).toContain(DIGITIZER_COMMAND_ID);
      expect(searchCommands(listCommands(), 'digitalizar').map((m) => m.command.id)).toContain(DIGITIZER_COMMAND_ID);
    } finally {
      off();
    }
    useProject.setState({ project: createProject() });
    const before = useProject.getState().project;
    expect(c.enabled?.() ?? true).toBe(true);
    expect(useDigitizer.getState().open).toBe(false);
    c.run?.();
    expect(useDigitizer.getState().open).toBe(true);
    expect(useProject.getState().project).toBe(before);
  });
});
