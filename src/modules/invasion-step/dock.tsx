/**
 * Pestaña «Perfil radial» del dock (docs/decisiones/0020, sección 8; función V del plan): a la profundidad del cursor
 * del visor, las resistividades de la inducción de arreglo en función de la distancia al pozo, sobre un corte con
 * pozo, zona lavada y formación virgen, con la sensibilidad radial de cada curva. Usa las mismas curvas y los mismos
 * parámetros (por zona) que el módulo `invasion-step`, y ajusta UNA muestra en el hilo principal: no recalcula la
 * cadena. Lo puro está en `radial.ts`, el dibujo en `draw.ts`. Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { canonicalCurveData } from '../../core/canonical';
import { computedCurves } from '../../app/computed';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { useUi } from '../../app/store/ui';
import { useViewer } from '../../app/store/viewer';
import { useTrendsUi } from '../../app/trends/store';
import { XY_FIGURE_THEME } from '../../plots/xy/figure';
import { registerXYFigure } from '../../plots/xy/figures';
import { Chip, EmptyState, IconButton, NumberField, StatusDot, Tooltip, curveStyle, formatNumber, useThemeTokens, type ThemeTokens, type Tone } from '../../ui';
import { useCanvas } from '../../ui/canvas';
import type { DockPanelDef } from '../../ui/dockPanel';
import { registry } from '../index';
import { RADIAL_X_AXIS, drawRadialProfile, fmtIn, fmtRes, readableColors, resistivityAxis } from './draw';
import { getRadialPin, noteCursorDepth, pinRadialDepth, subscribeRadialPin } from './pin';
import {
  INVASION_MODULE_ID,
  RADIAL_ROLES,
  invasionParamsAt,
  nearestSampleIndex,
  radialViewAt,
  resolveBitSizeCurve,
  resolveInvasionInputs,
  statusText,
  stepPolyline,
  zoneLookup,
  type RadialView,
} from './radial';
import './radial.css';
import { visibleWell } from '../../app/plots/context';

export const RADIAL_DOCK_ID = 'invasion-radial';

const roleColors = (theme: ThemeTokens): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of RADIAL_ROLES) out[r] = curveStyle(r, theme.name, registry.roles).color;
  return readableColors(out, theme);
};
const rxoColor = (theme: ThemeTokens) => curveStyle('RXO', theme.name, registry.roles).color;

const fmtDepth = (d: number) => formatNumber(d, { digits: 2 });
const fmtPct = (x: number) => (Number.isFinite(x) ? `${formatNumber(x * 100, { digits: Math.abs(x) < 0.1 ? 1 : 0 })} %` : '—');
const fmtSigned = (x: number) => (Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${formatNumber(Math.abs(x) * 100, { digits: 1 })} %` : '—');

/** Figura exportable mientras el panel está a la vista (Exportar → Figuras → gráficos). */
function useRadialFigure(view: RadialView | null, wellName: string): void {
  useEffect(() => {
    if (!view) return;
    const th = XY_FIGURE_THEME;
    const colors = roleColors(th);
    const step = stepPolyline(view);
    return registerXYFigure({
      id: 'perfil-radial',
      title: `Perfil radial de invasión · ${wellName} · ${fmtDepth(view.depth)} m`,
      x: RADIAL_X_AXIS,
      y: resistivityAxis(view),
      points: view.readings
        .filter((r) => Number.isFinite(r.observed))
        .map((r) => ({ id: r.role, name: `${r.label} (lee a ${r.r50} in)`, x: [r.r50], y: [r.observed], color: colors[r.role]! })),
      lines: step.x.length ? [{ id: 'step', name: 'Perfil escalonado ajustado', x: step.x, y: step.y, color: th.color.text, width: 2 }] : [],
      trends: [],
      guides: [],
      plot: (ctx, width, height) => drawRadialProfile(ctx, { width, height }, { view, colors, rxoColor: rxoColor(th) }, th, 1),
    });
  }, [view, wellName]);
}

function RadialPanel() {
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  const pin = useSyncExternalStore(subscribeRadialPin, getRadialPin);
  const cursorOn = useViewer((s) => s.cursorDepth !== null);
  const theme = useThemeTokens();
  const swatches = useMemo(() => roleColors(theme), [theme]);
  // Pozo según la sarta (0032): las curvas de herramientas apagadas no entran en el perfil radial.
  const well = entry ? visibleWell(entry.well, entry.interpretation) : null;
  const interp = entry?.interpretation ?? null;
  const depth = well?.depth.values ?? null;

  const inputs = useMemo(() => {
    if (!well) return [];
    const sources = result && result.wellId === well.id ? result.sources : null;
    return resolveInvasionInputs(well.curves, computedCurves(result, well), sources, registry.roles);
  }, [well, result]);
  const caliper = useMemo(() => {
    const c = well?.curves.find((x) => x.role === 'CALI');
    return c ? canonicalCurveData(c, registry.roles).data : null;
  }, [well]);
  const bitCurve = useMemo(() => (well ? resolveBitSizeCurve(well.curves, result && result.wellId === well.id ? result.sources : null, registry.roles) : null), [well, result]);
  const zoneOf = useMemo(() => (depth && interp ? zoneLookup(depth, interp.zones) : () => null), [depth, interp?.zones]);

  // Profundidad mostrada: la fijada, si no la última del cursor, si no la mitad del tramo visible.
  const samePin = pin.wellId === well?.id;
  const wanted = (samePin ? (pin.pinnedDepth ?? pin.lastDepth) : null) ?? (() => {
    const vis = useViewer.getState().visible;
    if (vis) return (vis.top + vis.base) / 2;
    return depth && depth.length ? (depth[0]! + depth[depth.length - 1]!) / 2 : NaN;
  })();
  const index = depth ? nearestSampleIndex(depth, wanted) : -1;
  const zone = index >= 0 ? zoneOf(index) : null;
  const params = useMemo(() => (interp ? invasionParamsAt(interp.params, zone?.id ?? null) : null), [interp, zone?.id]);
  const view = useMemo(
    () => (depth && params && index >= 0 && inputs.length > 0 ? radialViewAt(inputs, index, depth[index]!, params, { caliperIn: caliper ? caliper[index]! : NaN, bitIn: bitCurve ? bitCurve[index]! : NaN }) : null),
    [depth, params, index, inputs, caliper, bitCurve],
  );
  useRadialFigure(view, well?.name ?? '');

  const canvasRef = useCanvas(
    (ctx, size, theme, ui) => {
      drawRadialProfile(ctx, size, { view, colors: roleColors(theme), rxoColor: rxoColor(theme), emptyText: 'Sin curvas de inducción de arreglo' }, theme, ui);
    },
    [view],
  );

  if (!entry || !well || !depth || !interp) {
    return <EmptyState size="sm" icon="radial" title="Todavía no hay un pozo" description="Cargá un pozo con inducción de arreglo (AT10 a AT90) para ver el perfil radial de invasión." />;
  }
  if (inputs.length < 3) {
    const have = inputs.map((i) => i.label).join(', ') || 'ninguna';
    return (
      <EmptyState
        size="sm"
        icon="radial"
        title="Faltan curvas de inducción de arreglo"
        description={`El perfil radial necesita al menos 3 de AT10, AT20, AT30, AT60 y AT90 (roles RA10, RA20, RA30, RM y RT). El pozo tiene: ${have}. Asignalas en la lista de curvas.`}
      />
    );
  }

  const pinned = samePin && pin.pinnedDepth !== null;
  const status = view ? statusText(view) : null;
  const fit = view?.fit;
  const step = well.depth.step ?? (depth.length > 1 ? (depth[depth.length - 1]! - depth[0]!) / (depth.length - 1) : 0.1);
  const disabled = interp.disabled.includes(INVASION_MODULE_ID);
  const source = pinned ? 'Profundidad fijada' : cursorOn ? 'Sigue al cursor del visor' : samePin && pin.lastDepth !== null ? 'Última posición del cursor' : 'Mitad del tramo visible';
  const togglePin = () => pinRadialDepth(well.id, pinned ? null : view ? view.depth : null);
  const ariaLabel = view
    ? `Perfil radial a ${fmtDepth(view.depth)} m: ${status?.title}. ${view.readings
        .filter((r) => Number.isFinite(r.observed))
        .map((r) => `${r.label} ${fmtRes(r.observed)} ohm·m`)
        .join(', ')}.`
    : 'Perfil radial sin datos';

  return (
    <div className="rp" data-testid="radial-profile">
      <div className="rp-main">
        <canvas ref={canvasRef} className="rp-canvas" role="img" aria-label={ariaLabel} />
        <p className="rp-legend" aria-hidden="true">
          <span className="rp-legend__item">
            <span className="rp-key rp-key--dot" />
            <span className="rp-key rp-key--ring" /> medida y modelo
          </span>
          <span className="rp-legend__item">
            <span className="rp-key rp-key--step" /> perfil ajustado
          </span>
          <span className="rp-legend__item" title="Sensibilidad radial: de qué distancia al pozo viene la señal de cada curva">
            <span className="rp-key rp-key--bell" /> de dónde lee cada curva
          </span>
          {view && Number.isFinite(view.invasionRadiusLow) && (
            <span className="rp-legend__item" title="Intervalo de diámetros de invasión que reproducen las lecturas casi igual">
              <span className="rp-key rp-key--band" /> di plausible
            </span>
          )}
          <span className="rp-legend__item" title="Lectura que daría una curva según su profundidad de investigación, sobre el perfil ajustado">
            <span className="rp-key rp-key--guide" /> lectura según profundidad
          </span>
        </p>
      </div>
      <aside className="rp-side" aria-label="Resumen del ajuste">
        <div className="rp-head">
          <span className="rp-depth num" data-testid="radial-depth">
            {view ? fmtDepth(view.depth) : '—'} <span className="rp-unit">m</span>
          </span>
          {zone && <Chip color={zone.color}>{zone.name}</Chip>}
          <span className="rp-spacer" />
          <IconButton icon="eye" size="sm" label="Ver esta profundidad en el visor" onClick={() => view && useTrendsUi.getState().requestRange(view.depth - 15, view.depth + 15)} />
          <IconButton icon="pin" size="sm" variant={pinned ? 'secondary' : 'ghost'} pressed={pinned} label={pinned ? 'Soltar: volver a seguir al cursor' : 'Fijar esta profundidad'} onClick={togglePin} data-testid="radial-pin" />
        </div>
        <div className="rp-source">
          {pinned ? (
            <NumberField
              size="sm"
              aria-label="Profundidad fijada"
              value={view?.depth ?? depth[0]!}
              min={depth[0]!}
              max={depth[depth.length - 1]!}
              step={step}
              unit="m"
              format={fmtDepth}
              onChange={(d) => pinRadialDepth(well.id, depth[nearestSampleIndex(depth, d)]!)}
              width={112}
            />
          ) : null}
          <span className="rp-muted">{source}</span>
        </div>
        {status && view && (
          <div className={`rp-status rp-status--${status.tone}`} data-testid="radial-status" data-status={view.status}>
            <span className="rp-status__title">
              <StatusDot tone={status.tone as Tone} label={status.title} nativeTitle={false} />
              {status.title}
            </span>
            <span className="rp-status__detail" title={status.detail}>
              {status.detail}
            </span>
          </div>
        )}
        {fit && (
          <>
            <div className="rp-tiles num" data-testid="radial-stats">
              <div className="rp-tile">
                <span className="rp-tile__label">Rxo</span>
                <span className="rp-tile__value">{fmtRes(fit.rxo)}</span>
                <span className="rp-unit">ohm·m</span>
              </div>
              <div className="rp-tile">
                <span className="rp-tile__label">Rt</span>
                <span className="rp-tile__value">{fmtRes(fit.rt)}</span>
                <span className="rp-unit">ohm·m</span>
              </div>
              <div className="rp-tile">
                <span className="rp-tile__label">di</span>
                <span className="rp-tile__value">{view && Number.isFinite(view.invasionRadius) ? fmtIn(2 * view.invasionRadius) : '—'}</span>
                <span className="rp-unit">in</span>
              </div>
            </div>
            <dl className="rp-meta num">
              {view && Number.isFinite(view.invasionRadiusLow) && (
                <div className="rp-meta__wide" data-testid="radial-di-range">
                  <dt>
                    <Tooltip content="Diámetros de invasión que reproducen las lecturas casi igual de bien: la banda rayada del corte.">
                      <span className="rp-help">di plausible</span>
                    </Tooltip>
                  </dt>
                  <dd>
                    {fmtIn(2 * view.invasionRadiusLow)}–{fmtIn(2 * view.invasionRadiusHigh)} in
                  </dd>
                </div>
              )}
              <div>
                <dt>Rxo/Rt</dt>
                <dd>{Number.isFinite(fit.rxo / fit.rt) ? formatNumber(fit.rxo / fit.rt, { digits: 2 }) : '—'}</dd>
              </div>
              <div>
                <dt>
                  <Tooltip content="Error relativo medio entre las lecturas y las del perfil ajustado.">
                    <span className="rp-help">Desajuste</span>
                  </Tooltip>
                </dt>
                <dd>{fmtPct(fit.misfit)}</dd>
              </div>
              <div>
                <dt>
                  <Tooltip content="Diferencia entre la curva más resistiva y la menos resistiva.">
                    <span className="rp-help">Separación</span>
                  </Tooltip>
                </dt>
                <dd>{fmtPct(fit.separation)}</dd>
              </div>
            </dl>
          </>
        )}
        {view && (
          <table className="rp-readings num" data-testid="radial-readings">
            <thead>
              <tr>
                <th scope="col">Curva</th>
                <th scope="col">Lee a</th>
                <th scope="col">Medida</th>
                <th scope="col">Modelo</th>
                <th scope="col">Dif.</th>
              </tr>
            </thead>
            <tbody>
              {view.readings.map((r) => (
                <tr key={r.role}>
                  <th scope="row">
                    <span className="rp-swatch" style={{ background: swatches[r.role] }} />
                    {r.label}
                  </th>
                  <td>{r.r50} in</td>
                  <td>{fmtRes(r.observed)}</td>
                  <td>{fmtRes(r.modelled)}</td>
                  <td>{fmtSigned(r.relativeError)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view && (
          <p className="rp-note">
            Trépano {fmtIn(view.bitSize)} in{view.bitFrom === 'curve' ? ' (curva BS)' : ''} · separación mínima {fmtPct(view.params.minSeparation)} · desajuste máximo {fmtPct(view.params.maxMisfit)}
            {zone ? ` (zona ${zone.name})` : ' (fuera de zonas)'}
            {view.holeFrom === 'caliper' ? ` · pozo dibujado con el caliper (${fmtIn(2 * view.holeRadius)} in)` : ''}
            {disabled ? ' · el módulo está desactivado: el perfil se calcula igual con sus parámetros.' : ''}
          </p>
        )}
      </aside>
    </div>
  );
}

/**
 * Pestaña: recuerda la profundidad del cursor aunque esté oculta (redondeada a la muestra: cambia una vez por muestra,
 * no por píxel) y monta el panel solo a la vista: oculto no ajusta ni dibuja.
 */
function RadialDock() {
  const active = useUi((s) => s.dockTab === RADIAL_DOCK_ID && !s.layout.dockCollapsed);
  const well = useProject((s) => selectActiveEntry(s)?.well ?? null);
  const note = useCallback(
    (d: number | null) => {
      if (d === null || !well) return;
      const depth = well.depth.values;
      const i = nearestSampleIndex(depth, d);
      if (i >= 0) noteCursorDepth(well.id, depth[i]!);
    },
    [well],
  );
  useEffect(() => {
    note(useViewer.getState().cursorDepth);
    return useViewer.subscribe((s, prev) => {
      if (s.cursorDepth !== prev.cursorDepth) note(s.cursorDepth);
    });
  }, [note]);
  return active ? <RadialPanel /> : null;
}

export const dockPanels: DockPanelDef[] = [{ id: RADIAL_DOCK_ID, title: 'Perfil radial', icon: 'radial', component: RadialDock }];
