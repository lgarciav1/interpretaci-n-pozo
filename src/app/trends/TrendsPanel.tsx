import { effectiveWell } from '../preparation/data';
/**
 * Panel «Tendencias» del dock (docs/decisiones/0008-tendencias-y-gradientes.md, D7): lista de las tendencias del
 * pozo activo y detalle de la seleccionada (curva, modelo, ecuación, R², n, puntos fuera del ajuste y gradientes en
 * unidades de campo). Todo cambio va por `commit` (se deshace con Ctrl+Z).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { duplicateTrend, removeTrend, setTrendZone, updateTrend } from '../../core/state/trends';
import { makeId } from '../../core/state/project';
import { TREND_MODELS, type TrendSpec } from '../../core/trends';
import { evaluateTrend, type TrendResult } from '../../plots/trend/compute';
import { formatGradient, formatR2, gradientCaption, MODEL_LABEL, trendEquation } from '../../plots/trend/format';
import { TREND_PALETTE, trendColor } from '../../plots/trend/overlay';
import type { ResolvedSeries } from '../../plots/trend/series';
import { Button, ColorPicker, EmptyState, IconButton, Popover, SegmentedControl, Select, Switch, TextField, formatNumber, useFlash, useThemeTokens } from '../../ui';
import { computedCurves } from '../computed';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { commitTrends, patchTrend, startTrendTool } from './actions';
import { contextOf, resolveSeries, seriesRegistry } from './providers';
import { useTrendsUi } from './store';
import './trends.css';

const m1 = (d: number) => formatNumber(d, { digits: 1 });

interface Row {
  spec: TrendSpec;
  index: number;
  series: ResolvedSeries | null;
  result: TrendResult | null;
}

function Flash({ value, children }: { value: unknown; children: ReactNode }) {
  const flash = useFlash(value);
  return (
    <span className="ui-flash trend-flash" data-flash={flash}>
      {children}
    </span>
  );
}

export function TrendsPanel() {
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  const selectedId = useTrendsUi((s) => s.selectedId);
  const tool = useTrendsUi((s) => s.tool);
  const setUi = useTrendsUi((s) => s.set);
  const theme = useThemeTokens();
  const well = entry ? effectiveWell(entry.well, result) : null;
  const interp = entry?.interpretation ?? null;
  const computed = computedCurves(result, well);

  const rows = useMemo<Row[]>(() => {
    if (!well || !interp) return [];
    const data = { well, interpretation: interp, computed };
    return interp.trends.map((spec, index) => {
      const series = resolveSeries(data, spec.series);
      return { spec, index, series, result: series ? evaluateTrend(spec, series, interp.zones) : null };
    });
  }, [well, interp, computed]);

  const options = useMemo(() => {
    if (!well || !interp) return [];
    return seriesRegistry.list(contextOf({ well, interpretation: interp, computed }));
  }, [well, interp, computed]);

  if (!entry || !interp) {
    return <EmptyState size="sm" icon="trend" title="Sin pozo" description="Cargá un pozo para trazar líneas de tendencia sobre sus curvas." />;
  }

  const newButtons = (
    <>
      <Button size="sm" variant={tool?.kind === 'fit' && !tool.trendId ? 'primary' : 'secondary'} icon="trend" onClick={() => startTrendTool({ kind: 'fit' })} title="Arrastrá sobre una curva del visor para elegir el tramo del ajuste">
        Nueva tendencia
      </Button>
      <Button size="sm" variant={tool?.kind === 'manual' && !tool.trendId ? 'primary' : 'ghost'} icon="pen" onClick={() => startTrendTool({ kind: 'manual' })} title="Dibujar a mano: arrastrá sobre una curva del visor de un punto a otro" aria-label="Dibujar a mano">
        A mano
      </Button>
    </>
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon="trend"
        title={tool ? 'Arrastrá sobre una curva del visor' : 'Todavía no hay tendencias'}
        description={
          tool
            ? tool.kind === 'manual'
              ? 'Apretá en un punto de la curva y soltá en otro: la recta queda dibujada y los dos puntos se pueden mover. Esc para salir.'
              : 'Elegí el tramo arrastrando de arriba hacia abajo: la ecuación, R² y el gradiente se ven mientras arrastrás. Esc para salir.'
            : 'Una tendencia ajusta una recta (o una curva logarítmica, exponencial o potencial) sobre un tramo de cualquier curva y da su gradiente en unidades de campo: °C/100 m, psi/ft, µs/ft por metro.'
        }
        actions={newButtons}
      />
    );
  }

  const current = rows.find((r) => r.spec.id === selectedId) ?? rows[0]!;

  return (
    <div className="trends">
      <div className="trends-list">
        <div className="trends-list__bar">{newButtons}</div>
        <ul className="trends-list__items" aria-label="Tendencias del pozo">
          {rows.map((r) => {
            const color = trendColor(r.spec, r.index, theme);
            const active = r === current;
            return (
              <li key={r.spec.id} className={`trends-item${active ? ' is-active' : ''}${r.spec.visible ? '' : ' is-hidden'}`}>
                <button
                  type="button"
                  className="trends-item__main"
                  aria-current={active || undefined}
                  onClick={() => setUi({ selectedId: r.spec.id === selectedId ? null : r.spec.id })}
                  onDoubleClick={() => r.result?.span && useTrendsUi.getState().requestRange(r.result.span[0], r.result.span[1])}
                  title="Clic: seleccionar (en el visor, clic en una muestra la excluye) · doble clic: ver el tramo"
                >
                  <span className="trends-item__swatch" style={{ background: color }} aria-hidden="true" />
                  <span className="trends-item__text">
                    <span className="trends-item__name">{r.spec.name}</span>
                    <span className="trends-item__meta">
                      {r.series?.label ?? 'sin datos'} · {MODEL_LABEL[r.spec.model]}
                      {r.spec.mode === 'manual' ? ' · a mano' : ''}
                    </span>
                  </span>
                  <span className="trends-item__r2 num" title={r.spec.mode === 'manual' ? 'Dibujada a mano: sin R²' : 'Coeficiente de determinación'}>
                    {r.spec.mode === 'manual' ? '—' : `R² ${formatR2(r.result?.r2 ?? null)}`}
                  </span>
                </button>
                <IconButton
                  size="sm"
                  icon={r.spec.visible ? 'eye' : 'eye-off'}
                  label={r.spec.visible ? `Ocultar «${r.spec.name}» en el visor` : `Mostrar «${r.spec.name}» en el visor`}
                  pressed={r.spec.visible}
                  onClick={() => patchTrend(r.spec.id, { visible: !r.spec.visible }, r.spec.visible ? 'Ocultar tendencia' : 'Mostrar tendencia')}
                />
              </li>
            );
          })}
        </ul>
      </div>
      <TrendDetail key={current.spec.id} row={current} color={trendColor(current.spec, current.index, theme)} options={options} zones={interp.zones} paletteTheme={theme.name} />
    </div>
  );
}

interface DetailProps {
  row: Row;
  color: string;
  options: ReturnType<typeof seriesRegistry.list>;
  zones: readonly { id: string; name: string; top: number; base: number }[];
  paletteTheme: 'light' | 'dark';
}

function TrendDetail({ row, color, options, zones, paletteTheme }: DetailProps) {
  const { spec, series, result } = row;
  const [name, setName] = useState(spec.name);
  useEffect(() => setName(spec.name), [spec.name]); // renombrada desde afuera (deshacer, cambio de curva)
  const [colorOpen, setColorOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tool = useTrendsUi((s) => s.tool);
  const id = spec.id;

  const commitName = () => {
    const v = name.trim();
    if (v && v !== spec.name) patchTrend(id, { name: v }, 'Renombrar tendencia');
    else setName(spec.name);
  };

  const groups = useMemo(() => {
    const by = new Map<string, { value: string; label: string }[]>();
    for (const o of options) {
      const g = o.group ?? seriesRegistry.get(o.ref.provider)?.label ?? 'Series';
      if (!by.has(g)) by.set(g, []);
      by.get(g)!.push({ value: `${o.ref.provider}\u0001${o.ref.key}`, label: o.unit ? `${o.label} (${o.unit})` : o.label });
    }
    return [...by.entries()].map(([label, opts]) => ({ label, options: opts }));
  }, [options]);
  const seriesValue = `${spec.series.provider}\u0001${spec.series.key}`;
  const known = options.some((o) => o.ref.provider === spec.series.provider && o.ref.key === spec.series.key);

  const zone = spec.selection.zoneId ? zones.find((z) => z.id === spec.selection.zoneId) : undefined;
  const span = result?.span;
  const rangeText = span ? `${m1(span[0])}–${m1(span[1])} m` : '—';
  const primary = result?.gradients.find((g) => g.primary) ?? null;
  const secondary = result?.gradients.filter((g) => !g.primary) ?? [];
  const pickingThis = tool?.trendId === id;

  return (
    <section className="trend-detail" aria-label={`Tendencia ${spec.name}`} style={{ ['--trend-color' as string]: color }}>
      <header className="trend-detail__head">
        <button
          ref={anchorRef}
          type="button"
          className="trend-detail__swatch"
          style={{ background: color }}
          aria-label="Cambiar el color de la tendencia"
          aria-expanded={colorOpen}
          onClick={() => setColorOpen((o) => !o)}
        />
        {colorOpen && (
          <Popover open anchorRef={anchorRef} width={232} label="Color de la tendencia" onClose={() => setColorOpen(false)}>
            <div className="trend-color-pop">
              <ColorPicker
                aria-label="Color de la tendencia"
                value={spec.color ?? color}
                swatches={TREND_PALETTE[paletteTheme]}
                onChange={(hex) => patchTrend(id, { color: hex }, 'Cambiar color de la tendencia')}
              />
              {spec.color && (
                <Button size="sm" variant="ghost" onClick={() => patchTrend(id, { color: undefined }, 'Cambiar color de la tendencia')}>
                  Color automático
                </Button>
              )}
            </div>
          </Popover>
        )}
        <TextField
          size="sm"
          className="trend-detail__name"
          aria-label="Nombre de la tendencia"
          value={name}
          onChange={setName}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') setName(spec.name);
          }}
        />
        <SegmentedControl
          size="sm"
          aria-label="Modelo de la tendencia"
          value={spec.model}
          onChange={(model) => patchTrend(id, { model }, 'Cambiar modelo de la tendencia')}
          options={TREND_MODELS.map((m) => ({ value: m, label: m === 'linear' ? 'Lineal' : m === 'log' ? 'Log' : m === 'exp' ? 'Exp' : 'Potencial', title: MODEL_LABEL[m] }))}
        />
        <span className="shell-spacer" />
        <IconButton size="sm" icon="fit-height" label="Ver el tramo en el visor" disabled={!span} onClick={() => span && useTrendsUi.getState().requestRange(span[0], span[1])} />
        <IconButton
          size="sm"
          icon="copy"
          label="Duplicar tendencia"
          onClick={() => {
            const newId = makeId('tend');
            commitTrends('Duplicar tendencia', (p, w) => duplicateTrend(p, w, id, newId));
            useTrendsUi.getState().set({ selectedId: newId });
          }}
        />
        <IconButton
          size="sm"
          icon="trash"
          label="Borrar tendencia"
          onClick={() => {
            commitTrends('Borrar tendencia', (p, w) => removeTrend(p, w, id));
            const ui = useTrendsUi.getState();
            ui.set({ selectedId: null, ...(ui.tool?.trendId === id ? { tool: null } : {}) });
          }}
        />
      </header>

      <div className="trend-detail__body">
        <div className="trend-detail__main">
          <div className="trend-eq" aria-label="Ecuación de la tendencia">
            <Flash value={result?.coeffs ? `${result.coeffs.a}|${result.coeffs.b}` : null}>
              <span className="trend-eq__text">{result ? trendEquation(result, series) : '—'}</span>
            </Flash>
          </div>
          {!series ? (
            <p className="trend-note trend-note--warn">La curva de esta tendencia ya no está en el pozo. Elegí otra.</p>
          ) : result?.problem ? (
            <p className="trend-note trend-note--warn">{result.problem}</p>
          ) : null}
          <dl className="trend-kpis">
            <div className="trend-kpi">
              <dt>R²</dt>
              <dd className="num">{spec.mode === 'manual' ? <span title="Dibujada a mano: no es un ajuste">—</span> : <Flash value={result?.r2}>{formatR2(result?.r2 ?? null)}</Flash>}</dd>
            </div>
            <div className="trend-kpi">
              <dt>n</dt>
              <dd className="num">
                <Flash value={result?.n}>{formatNumber(result?.n ?? NaN, { digits: 0 })}</Flash>
              </dd>
            </div>
            <div className="trend-kpi" title="Excluidos a mano · sin dato o fuera del dominio del modelo">
              <dt>Fuera del ajuste</dt>
              <dd className="num">
                {formatNumber(result?.excluded ?? 0, { digits: 0 })}
                <span className="trend-kpi__sub"> · {formatNumber(result?.skipped ?? 0, { digits: 0 })} sin dato</span>
              </dd>
            </div>
          </dl>
          {result && result.gradients.length > 0 && (
            <div className="trend-grad">
              <div className="trend-grad__caption">{gradientCaption(result, series)}</div>
              <div className="trend-grad__values">
                {primary && (
                  <span className="trend-grad__primary num">
                    <Flash value={primary.value}>{formatGradient(primary)}</Flash>
                  </span>
                )}
                {secondary.map((g) => (
                  <span key={g.unit} className="trend-grad__other num">
                    {formatGradient(g)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {result && result.excluded > 0 && (
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => patchTrend(id, { selection: { ...spec.selection, excluded: [] } }, 'Incluir todos los puntos en la tendencia')}>
              Volver a incluir los {formatNumber(result.excluded, { digits: 0 })} puntos excluidos
            </Button>
          )}
        </div>

        <div className="trend-detail__side">
          <label className="trend-field">
            <span className="trend-field__label">Curva</span>
            <Select
              size="sm"
              block
              value={known ? seriesValue : ''}
              placeholder={known ? undefined : 'Elegí una curva'}
              groups={groups}
              aria-label="Curva de la tendencia"
              onChange={(v) => {
                const [provider, key] = v.split('\u0001');
                if (!provider || key === undefined) return;
                // El nombre automático («DT · tendencia») sigue a la curva; uno puesto por el usuario no se toca.
                const label = options.find((o) => o.ref.provider === provider && o.ref.key === key)?.label.split(' · ')[0];
                const prefix = series ? `${series.label} · ` : null;
                const auto = !!prefix && spec.name.startsWith(prefix) && /^(tendencia|a mano)( \d+)?$/.test(spec.name.slice(prefix.length));
                patchTrend(
                  id,
                  { series: { provider, key }, selection: { ...spec.selection, excluded: [] }, ...(auto && label ? { name: `${label} · ${spec.mode === 'manual' ? 'a mano' : 'tendencia'}` } : {}) },
                  'Cambiar curva de la tendencia',
                );
              }}
            />
          </label>
          <div className="trend-field">
            <span className="trend-field__label">{spec.mode === 'manual' ? 'Entre los dos puntos' : zone ? `Tramo · zona ${zone.name}` : 'Tramo del ajuste'}</span>
            <span className="trend-range num">{rangeText}</span>
          </div>
          <div className="trend-actions">
            <Button size="sm" variant={pickingThis && tool?.kind === 'fit' ? 'primary' : 'secondary'} icon="trend" onClick={() => startTrendTool({ kind: 'fit', trendId: id })} title="Arrastrá sobre el visor para elegir el tramo del ajuste">
              {spec.mode === 'manual' ? 'Ajustar a un tramo' : 'Elegir tramo'}
            </Button>
            <Button size="sm" variant={pickingThis && tool?.kind === 'manual' ? 'primary' : 'ghost'} icon="pen" onClick={() => startTrendTool({ kind: 'manual', trendId: id })} title="Arrastrá sobre la curva de un punto a otro">
              {spec.mode === 'manual' ? 'Redibujar' : 'A mano'}
            </Button>
            <Select
              size="sm"
              value=""
              placeholder={zones.length ? 'Usar zona como tramo…' : 'Sin zonas'}
              disabled={zones.length === 0}
              aria-label="Usar una zona como tramo del ajuste"
              options={zones.map((z) => ({ value: z.id, label: `Zona ${z.name} (${m1(z.top)}–${m1(z.base)} m)` }))}
              onChange={(zoneId) => {
                if (!zoneId) return;
                commitTrends('Usar zona como tramo de la tendencia', (p, w) => {
                  const next = setTrendZone(p, w, id, zoneId);
                  return spec.mode === 'manual' ? updateTrend(next, w, id, { mode: 'fit', manual: undefined }) : next;
                });
              }}
            />
          </div>
          <Switch
            checked={spec.extend}
            onChange={(on) => patchTrend(id, { extend: on }, on ? 'Extender la tendencia' : 'No extender la tendencia')}
            label="Extender fuera del tramo (punteada)"
          />
        </div>
      </div>
    </section>
  );
}

