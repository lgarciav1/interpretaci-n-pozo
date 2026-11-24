/**
 * Pantalla «Ecuaciones»: modelo puro (sin React ni DOM). Arma las entradas a partir del registro de módulos (su
 * `docs` y su esquema de parámetros) más la documentación de paneles que no son módulos del motor, y filtra por
 * texto. docs/decisiones/0025-pantalla-ecuaciones.md.
 */
import type { ModuleDocs } from '../../core/module';
import type { ParamSpec } from '../../core/params';
import type { Registry } from '../../core/registry';
import { unitLabel } from '../../core/units';
import { fold } from '../../ui/commands';
import { formatParamValue } from '../../ui/format';

export interface EquationParamRow {
  key: string;
  label: string;
  unit: string;
  defaultText: string;
  rangeText: string;
  /** El parámetro admite un valor por zona. */
  perZone: boolean;
}

export interface EquationEntry {
  id: string;
  name: string;
  categoryId: string;
  categoryLabel: string;
  docs: ModuleDocs;
  params: readonly EquationParamRow[];
  /** Texto plegado (sin tildes, minúsculas) donde busca el filtro. */
  haystack: string;
}

export interface EquationGroup {
  categoryId: string;
  label: string;
  entries: EquationEntry[];
}

/** Documentación de un panel que no es módulo del motor (p. ej. la calculadora de agua de formación). */
export interface ExtraDocs {
  id: string;
  name: string;
  /** Categoría conocida del registro (para agruparla con los módulos). */
  category: string;
  docs: ModuleDocs;
}

const NONE = '—';

function paramRow(key: string, spec: ParamSpec): EquationParamRow {
  const base = { key, label: spec.label, perZone: spec.scope === 'zone' };
  switch (spec.type) {
    case 'number': {
      const unit = spec.unit && spec.unit !== 'unitless' ? unitLabel(spec.unit) : NONE;
      const f = (v: number) => formatParamValue(v, spec);
      return { ...base, unit, defaultText: f(spec.default), rangeText: `${f(spec.min)} – ${f(spec.max)}${spec.scale === 'log' ? ' (log)' : ''}` };
    }
    case 'enum':
      return {
        ...base,
        unit: NONE,
        defaultText: spec.options.find((o) => o.value === spec.default)?.label ?? spec.default,
        rangeText: spec.options.map((o) => o.label).join(' · '),
      };
    case 'boolean':
      return { ...base, unit: NONE, defaultText: spec.default ? 'Sí' : 'No', rangeText: 'Sí · No' };
  }
}

function haystackOf(name: string, categoryLabel: string, docs: ModuleDocs): string {
  return fold([name, categoryLabel, docs.summary, docs.notes ?? '', ...docs.equations.flatMap((e) => [e.latex, e.description ?? ''])].join('\n'));
}

/**
 * Entradas en el orden de presentación: por categoría (orden del registro) y, dentro, por orden del registro: módulos
 * del motor, módulos de panel (0058) y extras.
 */
export function buildEquationEntries(registry: Registry, extras: readonly ExtraDocs[] = []): EquationEntry[] {
  const out: EquationEntry[] = [];
  for (const m of registry.modules) {
    const categoryLabel = registry.categoryLabel(m.category);
    const params = Object.entries(m.params).map(([key, spec]) => paramRow(key, spec));
    out.push({
      id: m.id,
      name: m.name,
      categoryId: m.category,
      categoryLabel,
      docs: m.docs,
      params,
      haystack: [haystackOf(m.name, categoryLabel, m.docs), ...params.map((p) => fold(`${p.key} ${p.label}`))].join('\n'),
    });
  }
  for (const x of registry.panels) {
    const categoryLabel = registry.categoryLabel(x.category);
    out.push({ id: x.id, name: x.name, categoryId: x.category, categoryLabel, docs: x.docs, params: [], haystack: haystackOf(x.name, categoryLabel, x.docs) });
  }
  for (const x of extras) {
    const categoryLabel = registry.categoryLabel(x.category);
    out.push({ id: x.id, name: x.name, categoryId: x.category, categoryLabel, docs: x.docs, params: [], haystack: haystackOf(x.name, categoryLabel, x.docs) });
  }
  const order = new Map(registry.categories.map((c, i) => [c.id, i]));
  const rank = (e: EquationEntry) => order.get(e.categoryId) ?? Number.MAX_SAFE_INTEGER;
  // sort es estable: dentro de cada categoría se mantiene el orden del registro (y los extras al final).
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Filtra por texto: todas las palabras de la consulta deben aparecer (sin distinguir tildes ni mayúsculas). */
export function filterEntries(entries: readonly EquationEntry[], query: string): EquationEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => words.every((w) => e.haystack.includes(w)));
}

/** Agrupa entradas ya ordenadas por categoría. */
export function groupEntries(entries: readonly EquationEntry[]): EquationGroup[] {
  const groups: EquationGroup[] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.categoryId === e.categoryId) last.entries.push(e);
    else groups.push({ categoryId: e.categoryId, label: e.categoryLabel, entries: [e] });
  }
  return groups;
}
