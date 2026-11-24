/**
 * Pantalla «Ecuaciones»: qué método usa cada cálculo, con sus ecuaciones (KaTeX), parámetros y referencias.
 * Es el ÚNICO lugar de la interfaz que muestra ecuaciones y no forma parte del flujo guiado.
 * Izquierda: módulos por categoría y buscador. Derecha: el módulo elegido. ↑/↓ cambian de módulo, Esc cierra.
 * docs/decisiones/0025-pantalla-ecuaciones.md.
 */
import 'katex/dist/katex.min.css';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { registry } from '../../modules';
import { Badge, Button, DataTable, Dialog, EmptyState, Section, TextField } from '../../ui';
import { useUi } from '../store/ui';
import { EQUATION_EXTRAS } from './extras';
import { buildEquationEntries, filterEntries, groupEntries, type EquationEntry, type EquationParamRow } from './model';
import { closeEquations } from './open';
import { renderLatex } from './render';
import './ecuaciones.css';

let allEntries: EquationEntry[] | null = null;
const entries = () => (allEntries ??= buildEquationEntries(registry, EQUATION_EXTRAS));

function Equation({ latex, description, index }: { latex: string; description: string | undefined; index: number }) {
  const r = renderLatex(latex);
  return (
    <li className="eq-eqn">
      <div className="eq-eqn__row">
        {r.ok ? <div className="eq-eqn__math" dangerouslySetInnerHTML={{ __html: r.html }} /> : <code className="eq-eqn__raw">{r.latex}</code>}
        <span className="eq-eqn__num num" aria-hidden="true">
          ({index})
        </span>
      </div>
      {description && <p className="eq-eqn__desc">{description}</p>}
    </li>
  );
}

const PARAM_COLUMNS = [
  {
    key: 'label',
    header: 'Parámetro',
    render: (p: EquationParamRow) => (
      <span className="eq-param">
        {p.label}
        {p.perZone && (
          <Badge tone="neutral" variant="outline">
            por zona
          </Badge>
        )}
      </span>
    ),
  },
  { key: 'unit', header: 'Unidad', render: (p: EquationParamRow) => p.unit },
  { key: 'default', header: 'Por defecto', align: 'num' as const, render: (p: EquationParamRow) => p.defaultText },
  { key: 'range', header: 'Rango', align: 'num' as const, render: (p: EquationParamRow) => p.rangeText },
];

function EntryDetail({ entry }: { entry: EquationEntry }) {
  const { docs } = entry;
  return (
    <article className="eq-detail" aria-labelledby="eq-detail-title">
      <header className="eq-detail__head">
        <span className="ui-overline">{entry.categoryLabel}</span>
        <h3 id="eq-detail-title" className="eq-detail__title">
          {entry.name}
        </h3>
        <p className="eq-detail__summary">{docs.summary}</p>
      </header>
      <Section title="Ecuaciones" meta={<span className="num">{docs.equations.length}</span>}>
        <ol className="eq-eqns">
          {docs.equations.map((e, i) => (
            <Equation key={i} latex={e.latex} description={e.description} index={i + 1} />
          ))}
        </ol>
      </Section>
      <Section title="Parámetros" meta={entry.params.length > 0 ? <span className="num">{entry.params.length}</span> : undefined}>
        {entry.params.length > 0 ? (
          <DataTable dense rows={entry.params} rowKey={(p) => p.key} columns={PARAM_COLUMNS} caption={`Parámetros de ${entry.name}`} />
        ) : (
          <p className="eq-muted">Sin parámetros ajustables: toma todo de sus curvas de entrada o de su propio panel.</p>
        )}
      </Section>
      {docs.notes && (
        <Section title="Notas">
          <p className="eq-notes">{docs.notes}</p>
        </Section>
      )}
      <Section title="Referencias">
        <ol className="eq-refs">
          {docs.references.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
      </Section>
    </article>
  );
}

function EquationsBody({ initialId }: { initialId: string | null }) {
  const all = entries();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => (initialId && all.some((e) => e.id === initialId) ? initialId : (all[0]?.id ?? null)));
  const filtered = useMemo(() => filterEntries(all, query), [all, query]);
  const groups = useMemo(() => groupEntries(filtered), [filtered]);
  // Si el filtro deja afuera al elegido, se muestra el primero que quede.
  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0] ?? null;
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-entry="${CSS.escape(selected.id)}"]`)?.scrollIntoView({ block: 'nearest' });
    detailRef.current?.scrollTo({ top: 0 });
  }, [selected]);

  const move = (delta: number) => {
    if (filtered.length === 0) return;
    const i = selected ? filtered.indexOf(selected) : -1;
    const next = filtered[Math.min(filtered.length - 1, Math.max(0, i + delta))]!;
    setSelectedId(next.id);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    }
  };

  return (
    <div className="eq">
      <aside className="eq-side" aria-label="Módulos" onKeyDown={onKeyDown}>
        <div className="eq-side__search">
          <TextField
            value={query}
            onChange={setQuery}
            icon="search"
            placeholder="Buscar método, parámetro o ecuación"
            aria-label="Buscar en las ecuaciones"
            block
            data-autofocus
            suffix={query ? <span className="num">{filtered.length}</span> : undefined}
          />
        </div>
        <div className="eq-side__list" ref={listRef}>
          {groups.length === 0 ? (
            <EmptyState
              size="sm"
              icon="search"
              title="Sin resultados"
              description={`Ningún método menciona «${query.trim()}». Probá con otro nombre o un símbolo (p. ej. Rw, phi, Archie).`}
              actions={
                <Button size="sm" onClick={() => setQuery('')}>
                  Limpiar búsqueda
                </Button>
              }
            />
          ) : (
            groups.map((g) => (
              <section key={g.categoryId} className="eq-group" aria-label={g.label}>
                <h4 className="eq-group__label">{g.label}</h4>
                <ul className="eq-group__items">
                  {g.entries.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        className={`eq-item${e === selected ? ' is-active' : ''}`}
                        aria-current={e === selected ? 'true' : undefined}
                        data-entry={e.id}
                        onClick={() => setSelectedId(e.id)}
                      >
                        <span className="eq-item__name">{e.name}</span>
                        <span className="eq-item__count num" aria-label={`${e.docs.equations.length} ecuaciones`}>
                          {e.docs.equations.length}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </aside>
      <div className="eq-main" ref={detailRef} tabIndex={-1} onKeyDown={onKeyDown}>
        {selected ? (
          <EntryDetail entry={selected} />
        ) : all.length === 0 ? (
          <EmptyState icon="sigma" title="No hay módulos registrados" description="Cuando se registre un módulo, su documentación aparece acá." />
        ) : (
          <EmptyState icon="sigma" title="Elegí un método" description="Buscá a la izquierda para ver sus ecuaciones, parámetros y referencias." />
        )}
      </div>
    </div>
  );
}

export function EquationsDialog() {
  const state = useUi((s) => s.equations);
  const total = entries().length;
  return (
    <Dialog
      open={!!state}
      onClose={closeEquations}
      size="xl"
      flush
      className="eq-dialog"
      title="Ecuaciones"
      description={`Qué método usa cada cálculo: ecuaciones, parámetros y referencias (${total} métodos).`}
    >
      {/* key: al reabrir en otro módulo, arranca de cero con ese elegido. */}
      {state && <EquationsBody key={state.moduleId ?? '@first'} initialId={state.moduleId} />}
    </Dialog>
  );
}
