/** Pantalla «Ecuaciones» (fase 9a, K): documentación completa de cada módulo y LaTeX que KaTeX puede renderizar. */
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { EQUATION_EXTRAS } from '../src/app/ecuaciones/extras';
import { buildEquationEntries, filterEntries, groupEntries } from '../src/app/ecuaciones/model';
import { registry } from '../src/modules';

const entries = buildEquationEntries(registry, EQUATION_EXTRAS);

describe('documentación de los módulos', () => {
  it('cada módulo del registro y cada panel extra tiene summary, ecuaciones y referencias', () => {
    expect(entries.length).toBe(registry.modules.length + registry.panels.length + EQUATION_EXTRAS.length);
    for (const e of entries) {
      expect(e.docs.summary.trim(), e.id).not.toBe('');
      expect(e.docs.equations.length, e.id).toBeGreaterThanOrEqual(1);
      expect(e.docs.references.length, e.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('todas las ecuaciones renderizan con KaTeX sin errores', () => {
    const broken: string[] = [];
    for (const e of entries) {
      e.docs.equations.forEach((eq, i) => {
        try {
          katex.renderToString(eq.latex, { throwOnError: true, displayMode: true, strict: 'error' });
        } catch (err) {
          broken.push(`${e.id} #${i + 1}: ${(err as Error).message}`);
        }
      });
    }
    expect(broken).toEqual([]);
  });
});

describe('modelo de la pantalla', () => {
  it('agrupa por categoría en el orden del registro, sin repetir categorías', () => {
    const groups = groupEntries(entries);
    const ids = groups.map((g) => g.categoryId);
    expect(new Set(ids).size).toBe(ids.length);
    const order = registry.categories.map((c) => c.id);
    expect(ids).toEqual(order.filter((c) => ids.includes(c)));
    for (const g of groups) expect(g.label).toBe(registry.categoryLabel(g.categoryId));
  });

  it('lista los parámetros con unidad, valor por defecto y rango', () => {
    const archie = entries.find((e) => e.id === 'sw-archie')!;
    expect(archie.params.length).toBe(Object.keys(registry.get('sw-archie')!.params).length);
    for (const p of archie.params) {
      expect(p.label).not.toBe('');
      expect(p.defaultText).not.toBe('');
      expect(p.rangeText).not.toBe('');
    }
  });

  it('busca por nombre, summary y LaTeX sin distinguir tildes', () => {
    expect(filterEntries(entries, '').length).toBe(entries.length);
    expect(filterEntries(entries, 'ARCHIE').some((e) => e.id === 'sw-archie')).toBe(true);
    expect(filterEntries(entries, 'saturacion').length).toBeGreaterThan(0);
    expect(filterEntries(entries, 'frac').length).toBeGreaterThan(0);
    expect(filterEntries(entries, 'zzz-no-existe')).toEqual([]);
  });
});
