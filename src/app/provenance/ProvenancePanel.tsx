/**
 * PANEL ORIGEN — «¿De dónde sale este número?» (docs/decisiones/0074). Muestra la cadena completa de una salida en una
 * muestra: cada eslabón con el valor de sus salidas, sus entradas (fuente y valor) y los parámetros de la zona, con el
 * enlace a su entrada de Ecuaciones. No recalcula nada: lee la última corrida del motor (`useResults`) con
 * `traceSample` (puro, src/core/engine/provenance.ts), así que mover un parámetro actualiza el panel solo.
 * Las ecuaciones no se muestran acá (regla del proyecto).
 */
import { useMemo } from 'react';
import { toEngineWell } from '../../core/engine/engine';
import { traceSample, type TraceCurve, type TraceInput, type TraceLink, type TraceOutcome, type TraceOutput, type TraceParam } from '../../core/engine/provenance';
import { projectedEngineCurves } from '../../core/preparation/plan';
import { unitLabel, type UnitId } from '../../core/units';
import type { Zone } from '../../core/well';
import { registry } from '../../modules';
import { Badge, Button, Callout, Chip, EmptyState, IconButton, Select, curveStyle, formatNumber, prefersReducedMotion, useFlash, useResolvedTheme, type ThemeName } from '../../ui';
import { nearestIndex } from '../../viewer/readout';
import { openEquations } from '../ecuaciones/open';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useTrendsUi } from '../trends/store';
import { useProvenanceUi } from './store';
import './provenance.css';

/** Valor corto (4 cifras significativas); el completo va en el título. */
function fmt(v: number | null): string {
  if (v === null) return '';
  if (!Number.isFinite(v)) return '—';
  return formatNumber(v, { significant: 4, grouping: Math.abs(v) >= 10000 });
}
const full = (v: number | null) => (v !== null && Number.isFinite(v) ? v.toLocaleString('es-AR', { maximumSignificantDigits: 15, useGrouping: false }) : undefined);
const unitText = (u: UnitId | undefined) => (u && u !== 'unitless' ? unitLabel(u) : '');
const fmtDepth = (m: number) => `${formatNumber(m, { digits: 2, grouping: true })} m`;

function Value({ value, unit, rows, strong }: { value: number | null; unit?: UnitId; rows?: number; strong?: boolean }) {
  const flash = useFlash(value);
  if (rows !== undefined) return <span className="prov-val is-muted">tabla de {rows} {rows === 1 ? 'fila' : 'filas'}</span>;
  if (value === null) return <span className="prov-val is-muted">—</span>;
  const missing = !Number.isFinite(value);
  return (
    <span className={`prov-val num ui-flash${strong ? ' is-strong' : ''}${missing ? ' is-missing' : ''}`} data-flash={flash} title={full(value)}>
      {fmt(value)}
      {!missing && unitText(unit) && <span className="prov-val__unit">{unitText(unit)}</span>}
    </span>
  );
}

function Swatch({ role, theme }: { role: string | null; theme: ThemeName }) {
  if (!role || !registry.roles.get(role)) return <span className="prov-swatch is-empty" aria-hidden="true" />;
  return <span className="prov-swatch" style={{ background: curveStyle(role, theme, registry.roles).color }} aria-hidden="true" />;
}

const scrollToLink = (moduleId: string) => {
  const el = document.getElementById(`prov-link-${moduleId}`);
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  el.classList.remove('is-pinged');
  void el.offsetWidth;
  el.classList.add('is-pinged');
};

/** Fuente de una entrada, en palabras. */
function SourceText({ input, links }: { input: TraceInput; links: readonly TraceLink[] }) {
  const s = input.source;
  if (s.kind === 'module') {
    const n = s.link + 1;
    return (
      <button type="button" className="prov-src prov-src--ref" onClick={() => scrollToLink(s.moduleId)} title={`Ir al eslabón ${n}: ${s.name}`}>
        <span className="prov-src__step num" aria-hidden="true">{n > 0 && n <= links.length ? n : '·'}</span>
        {s.name}
      </button>
    );
  }
  if (s.kind === 'curve') {
    const what = s.prepared ? 'preparada' : 'medida';
    return (
      <span className="prov-src">
        {what} · <strong>{s.mnemonic}</strong>
        {s.crossRole && <> · elegida para {input.port}</>}
        {s.unknownUnit && <span className="prov-src__warn"> · unidad desconocida, valor sin convertir</span>}
      </span>
    );
  }
  return <span className="prov-src is-muted">{s.failed ? `sin dato (opcional): «${s.failed.name}» no se pudo calcular` : 'sin dato (opcional)'}</span>;
}

function InputRow({ input, links, theme }: { input: TraceInput; links: readonly TraceLink[]; theme: ThemeName }) {
  const s = input.source;
  const usedName = s.kind === 'module' ? s.name : s.kind === 'curve' ? s.mnemonic : '';
  return (
    <li className={`prov-row${input.gap ? ' is-gap' : ''}`}>
      <div className="prov-row__main">
        <span className="prov-row__name">
          <Swatch role={input.kind === 'curve' ? input.port : null} theme={theme} />
          <span className="prov-row__label">{input.label}</span>
          <span className="prov-row__port">{input.port}</span>
        </span>
        <SourceText input={input} links={links} />
        {input.chosenIsSelf && <span className="prov-row__note">usa {usedName} (la elegida para {input.port} es este mismo módulo)</span>}
        {input.others.length > 0 && (
          <span className="prov-row__others">
            Otras fuentes disponibles:{' '}
            {input.others.map((o, i) => (
              <span key={`${o.kind}:${o.id}`}>
                {i > 0 && ', '}
                {o.label}
                {o.alternative && <span className="prov-row__alt"> (alternativa)</span>}
              </span>
            ))}
          </span>
        )}
      </div>
      {s.kind === 'absent' ? <span className="prov-val is-muted">—</span> : <Value value={input.value} unit={input.unit} rows={input.rows} />}
    </li>
  );
}

function ParamRow({ p, zoneName }: { p: TraceParam; zoneName: string | null }) {
  const value = p.type === 'enum' ? p.optionLabel ?? String(p.value) : p.type === 'boolean' ? (p.value ? 'sí' : 'no') : null;
  return (
    <li className="prov-param">
      <span className="prov-param__label">{p.label}</span>
      <span className="prov-param__value">
        {value !== null ? <span className="prov-val">{value}</span> : <Value value={p.value as number} unit={p.unit} />}
        {p.fromZone ? (
          <Badge tone="accent" title={`Valor propio de la zona ${zoneName ?? ''}`}>
            zona {zoneName}
          </Badge>
        ) : (
          <span className="prov-param__scope" title={p.zoneScoped ? 'Ajustable por zona; esta zona usa el valor global' : 'Un único valor para todo el pozo'}>
            global
          </span>
        )}
      </span>
    </li>
  );
}

function OutputRow({ o, isTarget, theme }: { o: TraceOutput; isTarget: boolean; theme: ThemeName }) {
  return (
    <li className={`prov-out${o.inChain ? ' is-chain' : ''}${isTarget ? ' is-target' : ''}`}>
      <span className="prov-row__name">
        <Swatch role={o.kind === 'curve' ? o.port : null} theme={theme} />
        <span className="prov-row__label">{o.label}</span>
        <span className="prov-row__port">{o.port}</span>
        {!o.active && <span className="prov-row__alt">alternativa</span>}
      </span>
      <Value value={o.value} unit={o.unit} rows={o.rows} strong={o.inChain} />
    </li>
  );
}

function LinkCard({ link, n, isLast, targetKey, links, zoneName, theme }: { link: TraceLink; n: number; isLast: boolean; targetKey: string; links: readonly TraceLink[]; zoneName: string | null; theme: ThemeName }) {
  // Las salidas que no siguen la cadena se listan solo si son pocas (un módulo con muchas salidas no tapa la traza).
  const outputs = link.outputs.filter((o) => o.inChain || link.outputs.length <= 3);
  const hidden = link.outputs.length - outputs.length;
  return (
    <li className={`prov-link${isLast ? ' is-target' : ''}${link.gap ? ' is-gap' : ''}`} id={`prov-link-${link.moduleId}`} data-testid="prov-link" data-module={link.moduleId}>
      <div className="prov-link__rail" aria-hidden="true">
        <span className="prov-link__num num">{n}</span>
      </div>
      <article className="prov-link__card" aria-label={`Eslabón ${n}: ${link.name}`}>
        <header className="prov-link__head">
          <div className="prov-link__title">
            <span className="prov-link__name">{link.name}</span>
            <span className="prov-link__cat">{link.categoryLabel}</span>
          </div>
          <Button size="sm" variant="ghost" icon="sigma" className="prov-link__eq" onClick={() => openEquations(link.moduleId)} title={`Abrir «${link.name}» en Ecuaciones`}>
            Ecuaciones
          </Button>
        </header>
        {link.gap && <div className="prov-link__gap">Acá se corta la cadena: las entradas tienen valor y la salida no.</div>}
        <ul className="prov-outs">
          {outputs.map((o) => (
            <OutputRow key={o.key} o={o} isTarget={o.key === targetKey} theme={theme} />
          ))}
          {hidden > 0 && <li className="prov-out prov-out--more">y {hidden} {hidden === 1 ? 'salida más' : 'salidas más'} que no siguen esta cadena</li>}
        </ul>
        {link.inputs.length > 0 && (
          <div className="prov-block">
            <div className="prov-block__title">Entradas</div>
            <ul className="prov-rows">
              {link.inputs.map((i) => (
                <InputRow key={i.key} input={i} links={links} theme={theme} />
              ))}
            </ul>
          </div>
        )}
        {link.params.length > 0 && (
          <div className="prov-block">
            <div className="prov-block__title">Parámetros{zoneName ? ` · zona ${zoneName}` : ' · fuera de las zonas'}</div>
            <ul className="prov-params">
              {link.params.map((p) => (
                <ParamRow key={p.key} p={p} zoneName={zoneName} />
              ))}
            </ul>
          </div>
        )}
      </article>
    </li>
  );
}

function NotTraced({ outcome }: { outcome: Exclude<TraceOutcome, { status: 'ok' }> }) {
  const [moduleId] = outcome.outputKey.split(':');
  const name = registry.get(moduleId ?? '')?.name ?? moduleId;
  if (outcome.status === 'out-of-range') return <EmptyState size="sm" icon="ruler" title="Fuera del pozo" description="La profundidad elegida no es una muestra de este pozo." />;
  if (outcome.status === 'not-run') return <EmptyState size="sm" icon="warning" title={`«${name}» no se calculó`} description="El último cálculo no pudo correr este módulo: mirá el panel Avisos." />;
  return <EmptyState size="sm" icon="info" title="Esa salida no está en el último cálculo" description="El módulo está apagado, falló o ya no forma parte de la cadena. Elegí otra salida arriba." />;
}

export function ProvenancePanel() {
  const selection = useProvenanceUi((s) => s.selection);
  const select = useProvenanceUi((s) => s.select);
  const result = useResults((s) => s.result);
  const busy = useResults((s) => s.busy);
  const entry = useProject(selectActiveEntry);
  const theme = useResolvedTheme();
  const well = entry?.well;
  const fresh = !!result && !!well && result.wellId === well.id && result.stats.samples === well.depth.values.length;

  // Curvas tal como las vio el motor en esa corrida: las del pozo y las preparadas.
  const curves = useMemo<readonly TraceCurve[]>(() => {
    if (!fresh || !well) return [];
    const prep = result!.preparation;
    return prep ? projectedEngineCurves(toEngineWell(well), prep.plan, prep.artifacts) : well.curves;
  }, [fresh, well, result]);

  const depth = well?.depth.values;
  const index = selection && depth ? nearestIndex(depth, selection.depth) : -1;
  const measured = selection?.outputKey.startsWith('m:') ? well?.curves.find((c) => c.id === selection.outputKey.slice(2)) : undefined;

  const outcome = useMemo<TraceOutcome | null>(() => {
    if (!fresh || !selection || measured || selection.outputKey.startsWith('m:')) return null;
    return traceSample(result!, registry, curves, index, selection.outputKey);
  }, [fresh, result, curves, index, selection, measured]);

  const options = useMemo(() => {
    const curvesOut = fresh ? result!.outputs.filter((o) => o.kind === 'curve') : [];
    const perModule = new Map<string, number>();
    for (const o of curvesOut) perModule.set(o.moduleId, (perModule.get(o.moduleId) ?? 0) + 1);
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const o of curvesOut) {
      const m = registry.get(o.moduleId);
      const g = m ? registry.categoryLabel(m.category) : 'Otros';
      const list = groups.get(g) ?? [];
      // El nombre del módulo ya dice qué es («Sw — Archie»); si da varias curvas, se agrega cuál.
      const name = m?.name ?? o.moduleId;
      list.push({ value: o.key, label: `${perModule.get(o.moduleId)! > 1 ? `${name} · ${o.label}` : name}${o.active ? '' : ' (alternativa)'}` });
      groups.set(g, list);
    }
    return [...groups].map(([label, opts]) => ({ label, options: opts }));
  }, [fresh, result]);

  if (!entry) return <EmptyState size="sm" icon="lineage" title="Sin pozo" description="Cargá un pozo para ver de dónde sale cada número." />;
  if (!selection) {
    return (
      <EmptyState
        size="sm"
        icon="lineage"
        title="¿De dónde sale este número?"
        description="Clic derecho sobre una curva calculada del perfil (Sw, φ, Vsh…) y elegí «¿De dónde sale este número?»: acá aparece la cadena completa en esa profundidad."
      />
    );
  }
  if (!fresh) return <EmptyState size="sm" icon="info" title={busy ? 'Calculando…' : 'Todavía no hay resultados'} description="La cadena aparece al terminar el cálculo del pozo." />;

  const d = index >= 0 ? depth![index]! : selection.depth;
  const zoneId = outcome?.status === 'ok' ? outcome.zoneId : null;
  const zones: readonly Zone[] = entry.interpretation.zones;
  const zone = zoneId ? zones.find((z) => z.id === zoneId) : (zones.find((z) => d >= z.top && d <= z.base) ?? undefined);
  const step = (delta: number) => {
    const i = Math.min(depth!.length - 1, Math.max(0, index + delta));
    select({ ...selection, depth: depth![i]! });
  };
  const trace = outcome?.status === 'ok' ? outcome : null;
  const gapLink = trace?.gap ? trace.links.find((l) => l.moduleId === trace.gap!.moduleId) : undefined;
  const gapInput = trace?.gap?.inputKey ? gapLink?.inputs.find((i) => i.key === trace.gap!.inputKey) : undefined;
  const targetModule = trace ? trace.links[trace.links.length - 1]! : null;

  return (
    <div className="prov-panel" data-testid="provenance-panel">
      <div className="prov-toolbar">
        <Select
          size="sm"
          block
          aria-label="Salida calculada"
          value={measured ? '' : selection.outputKey}
          onChange={(v) => v && select({ ...selection, outputKey: v })}
          groups={options}
          {...(measured ? { placeholder: `${measured.mnemonic} (medida)` } : {})}
        />
        <div className="prov-toolbar__depth">
          <IconButton icon="chevron-up" size="sm" label="Muestra de arriba" disabled={index <= 0} onClick={() => step(-1)} />
          <span className="prov-depth num" data-testid="prov-depth">
            MD {fmtDepth(d)}
          </span>
          <IconButton icon="chevron-down" size="sm" label="Muestra de abajo" disabled={index < 0 || index >= depth!.length - 1} onClick={() => step(1)} />
          {zone ? (
            <Chip color={zone.color} onClick={() => useTrendsUi.getState().requestRange(d - 5, d + 5)} title="Ver esta profundidad en el perfil">
              Zona {zone.name}
            </Chip>
          ) : (
            <Chip onClick={() => useTrendsUi.getState().requestRange(d - 5, d + 5)} title="Ver esta profundidad en el perfil">
              Fuera de las zonas
            </Chip>
          )}
          {busy && <span className="prov-toolbar__busy">recalculando…</span>}
        </div>
      </div>

      {measured ? (
        <EmptyState size="sm" icon="curve" title={`«${measured.mnemonic}» es un dato medido`} description="No sale de ningún cálculo: es una lectura del perfil. Elegí una curva calculada arriba para ver su cadena." />
      ) : !trace ? (
        outcome && outcome.status !== 'ok' && <NotTraced outcome={outcome} />
      ) : (
        <>
          <div className={`prov-summary${trace.alternative ? ' is-alternative' : ''}`} data-testid="prov-summary">
            <div className="prov-summary__what">
              <span className="prov-summary__label">
                <Swatch role={trace.target.kind === 'curve' ? trace.target.port : null} theme={theme} />
                {trace.target.label}
              </span>
              <span className="prov-summary__by">
                {targetModule!.name} · {trace.links.length} {trace.links.length === 1 ? 'eslabón' : 'eslabones'}
              </span>
            </div>
            <Value value={trace.target.value} unit={trace.target.unit} rows={trace.target.rows} strong />
            {trace.alternative && (
              <Badge tone="info" variant="outline" className="prov-summary__alt">
                alternativa: no alimenta la cadena
              </Badge>
            )}
          </div>

          {trace.gap && (
            <Callout tone="warn" className="prov-gap" title="Sin dato en esta muestra">
              {gapInput
                ? `Falta la lectura de «${gapInput.source.kind === 'curve' ? gapInput.source.mnemonic : gapInput.label}» (entrada de «${gapLink!.name}»): de ahí en adelante la cadena no tiene valor.`
                : `La cadena se corta en «${gapLink!.name}»: sus entradas tienen valor y su salida no (fuera del dominio del método o de sus parámetros).`}
            </Callout>
          )}

          <ol className="prov-chain" aria-label="Cadena de cálculo, de las curvas medidas a la salida">
            {trace.links.map((l, i) => (
              <LinkCard key={l.moduleId} link={l} n={i + 1} isLast={i === trace.links.length - 1} targetKey={trace.outputKey} links={trace.links} zoneName={zone?.name ?? null} theme={theme} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
