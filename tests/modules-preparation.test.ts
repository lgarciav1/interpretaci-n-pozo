/** «Preparar datos» como módulo de panel (docs/decisiones/0058): registro, docs para Ecuaciones y aislamiento del motor. */
import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { definePanelModule, type PanelModuleDefinition } from '../src/core/module';
import { createRegistry, RegistryError } from '../src/core/registry';
import { EQUATION_EXTRAS } from '../src/app/ecuaciones/extras';
import { buildEquationEntries, filterEntries, groupEntries } from '../src/app/ecuaciones/model';
import { MODULES, PANEL_MODULES, registry } from '../src/modules';
import preparation, { PREPARATION_DOCK_ID, PREPARATION_ID } from '../src/modules/preparation';
import { syntheticWell } from '../src/app/demo/syntheticWell';

const MODULE_ENTRIES = Object.keys(import.meta.glob('../src/modules/*/index.ts'));
const problems = (fn: () => unknown): string => {
  try {
    fn();
    return '';
  } catch (e) {
    return (e as RegistryError).problems.join('\n');
  }
};

describe('registro del módulo de panel «Preparar datos»', () => {
  it('está en PANEL_MODULES con id, nombre, categoría y espacios de trabajo coherentes', () => {
    expect(PANEL_MODULES).toContain(preparation);
    expect(registry.getPanel(PREPARATION_ID)).toBe(preparation);
    expect(preparation.name).toBe('Preparar datos');
    expect(preparation.category).toBe('qc');
    expect(registry.categoryLabel(preparation.category)).toBe('Control de calidad');
    expect(preparation.workspace).toEqual(['petrophysics', 'geology']);
    expect(PREPARATION_DOCK_ID).toBe(PREPARATION_ID);
  });

  it('vive en una carpeta con su mismo id y no es un nodo del motor', () => {
    for (const p of registry.panels) expect(MODULE_ENTRIES).toContain(`../src/modules/${p.id}/index.ts`);
    expect(registry.get(PREPARATION_ID)).toBeUndefined();
    expect(registry.modules.map((m) => m.id)).not.toContain(PREPARATION_ID);
    expect(registry.modules).toHaveLength(MODULES.length);
    const demo = syntheticWell();
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(toEngineWell(demo.well));
    const r = engine.run(emptyInterpretation(demo.zones));
    expect(r.stats.recomputed).not.toContain(PREPARATION_ID);
    expect(r.nodes.map((n) => n.moduleId)).not.toContain(PREPARATION_ID);
  });

  it('su categoría entra en las categorías en uso del registro', () => {
    expect(registry.categories.map((c) => c.id)).toContain('qc');
  });
});

describe('docs para el módulo Ecuaciones', () => {
  const entries = buildEquationEntries(registry, EQUATION_EXTRAS);
  const entry = entries.find((e) => e.id === PREPARATION_ID)!;

  it('aparece como entrada propia, agrupada en Control de calidad, sin parámetros', () => {
    expect(entry).toBeDefined();
    expect(entry.categoryId).toBe('qc');
    expect(entry.params).toEqual([]);
    const group = groupEntries(entries).find((g) => g.categoryId === 'qc')!;
    expect(group.entries.map((e) => e.id)).toContain(PREPARATION_ID);
  });

  it('documenta cada método que usa la preparación', () => {
    const text = [entry.docs.summary, ...entry.docs.equations.map((e) => `${e.latex} ${e.description ?? ''}`)].join('\n');
    for (const word of ['Exclusión', 'espurio', 'Interpolación lineal acotada', 'Mediana móvil', 'Corrimiento constante', 'MGT', 'DRX', 'Larionov', 'Clavier', 'Steiber', 'lineal']) {
      expect(text, word).toContain(word);
    }
    expect(entry.docs.references.some((r) => r.includes('Goldberg'))).toBe(true);
    expect(entry.docs.references.some((r) => r.includes('Larionov'))).toBe(true);
  });

  it('el buscador de Ecuaciones la encuentra sin tildes', () => {
    expect(filterEntries(entries, 'mediana movil').map((e) => e.id)).toContain(PREPARATION_ID);
    expect(filterEntries(entries, 'preparar datos').map((e) => e.id)).toContain(PREPARATION_ID);
  });
});

describe('contrato de módulo de panel', () => {
  const ok: PanelModuleDefinition = definePanelModule({
    id: 'panel-de-prueba',
    name: 'Panel de prueba',
    category: 'qc',
    workspace: 'petrophysics',
    docs: { summary: 'Prueba.', equations: [{ latex: 'x = 1' }], references: ['Ref.'] },
  });

  it('acepta un panel válido y lo expone sin tocar los módulos', () => {
    const r = createRegistry(MODULES, { panels: [ok] });
    expect(r.getPanel(ok.id)).toBe(ok);
    expect(r.modules).toHaveLength(MODULES.length);
  });

  it('rechaza ids repetidos con un módulo, categoría desconocida, puertos y docs incompletas', () => {
    expect(problems(() => createRegistry(MODULES, { panels: [{ ...ok, id: 'vsh' }] }))).toMatch(/dos módulos con el id 'vsh'/);
    expect(problems(() => createRegistry(MODULES, { panels: [{ ...ok, category: 'no-existe' }] }))).toMatch(/categoría desconocida/);
    expect(problems(() => createRegistry(MODULES, { panels: [{ ...ok, outputs: {} } as PanelModuleDefinition] }))).toMatch(/no declara entradas, salidas ni compute/);
    expect(problems(() => createRegistry(MODULES, { panels: [{ ...ok, docs: { summary: 'x' } } as unknown as PanelModuleDefinition] }))).toMatch(/docs debe tener/);
    expect(problems(() => createRegistry(MODULES, { panels: [{ ...ok, workspace: 'otro' } as unknown as PanelModuleDefinition] }))).toMatch(/espacio de trabajo desconocido/);
  });

  it('una categoría nueva de un panel se declara con categoryLabel y queda en uso', () => {
    const r = createRegistry(MODULES, { panels: [{ ...ok, category: 'herramientas-de-prueba', categoryLabel: 'Herramientas de prueba' }] });
    expect(r.categories.at(-1)).toEqual({ id: 'herramientas-de-prueba', label: 'Herramientas de prueba' });
  });
});
