/**
 * Panel «Calibración» del dock (docs/decisiones/0023-calibracion-con-corona.md): el perfil contra los plugs de corona
 * ya puestos en profundidad (panel «Corona»; acá se usa `shiftedDepth` y nunca se recalcula un desplazamiento).
 *
 *   Porosidad      crossplot φ perfil vs. φ corona con 1:1, RMA y OLS; n, sesgo, RMSE y R²; curva y ventana ±h.
 *   Matriz         densidad de grano de los plugs, ρma que iguala φD con φ corona y ρmaa del perfil por zona, con su
 *                  histograma; «Aplicar ρma» a la porosidad por densidad (global o de una zona; un Ctrl+Z).
 *   Exponente m    desde F de los plugs (a fija y libre) y desde Rt en zonas acuíferas (mediana de m por muestra), con
 *                  el gráfico log–log F–φ; «Aplicar m» a los modelos de Sw.
 *   Exponente n    desde el ensayo de índice de resistividad (RI–Sw) de los plugs, con el gráfico log–log RI–Sw, n por
 *                  plug y «Aplicar n»; resumen «Archie desde corona» con «Aplicar a, m y n» (una receta). Ver
 *                  `saturationSection.tsx` y docs/decisiones/0053.
 *
 * Gráficos del x–y base (`src/plots/xy/`), temas claro y oscuro por tokens. Todo cambio va por `commit`. Se descubre
 * solo (`src/modules/<id>/dock.tsx`).
 */
import { useMemo, useState } from 'react';
import type { Interpretation } from '../../core/interpretation';
import type { TableValue } from '../../core/module';
import { pointTexts, type PointSet } from '../../core/pointSets';
import { updatePlotConfig } from '../../core/state/plots';
import { setPointSetSetting } from '../../core/state/pointSets';
import { activeWellEntry, makeId } from '../../core/state/project';
import { layoutZones, type Well, type Zone } from '../../core/well';
import { autoRange, binEdges, countBins } from '../../plots/histogram/histogram';
import { niceRange, type XYAxis } from '../../plots/xy/axes';
import type { XYBarLayer, XYGuide, XYLineLayer, XYPointLayer } from '../../plots/xy/layers';
import { XYPlot } from '../../plots/xy/XYPlot';
import type { SeriesContext } from '../../plots/trend/series';
import { Badge, Button, Callout, Checkbox, EmptyState, Select, SegmentedControl, formatNumber, toast, useThemeTokens } from '../../ui';
import { ensureContrast } from '../../ui/color';
import type { DockPanelDef } from '../../ui/dockPanel';
import { usePlotContext } from '../../app/plots/connect';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { useUi } from '../../app/store/ui';
import { resolveSeries } from '../../app/trends/providers';
import { useTrendsUi } from '../../app/trends/store';
import { loadExample } from '../core/dock';
import { addTpCore, isTpCoreSet, TP_CORE_VIEW, tpCoreSet } from '../core/tp';
import { COL, CORE_DOCK_ID, coreSets, runColor, runLabel } from '../core/model';
import { CORE_CALIBRATION_ID, RHOMAA_ZONES, WHOLE_WELL_ROW } from './index';
import {
  applyCementation,
  applyMatrixDensity,
  archieLine,
  CALIB_CURVE_SETTING,
  CALIB_PARAMS,
  CALIB_WINDOW_SETTING,
  CALIBRATION_DOCK_ID,
  calibCurveKey,
  calibWindow,
  DEFAULT_WINDOW,
  depthMatchState,
  dominantPlugZone,
  includedPlugs,
  fitsParam,
  isApplied,
  lineOver,
  logCementation,
  matrixDensityEstimates,
  paramValue,
  plugCementation,
  plugScopeCount,
  porosityCalibration,
  type PlugScope,
  rhomaaZoneRows,
  roundedParam,
  WINDOW_OPTIONS,
  zonesWithOwnValue,
} from './model';
import { KPI, Legend } from './parts';
import { riSets } from './saturation';
import { loadRiExample, SaturationSection } from './saturationSection';
import { addTpRi, tpRiSet } from './tpRi';
import './calibration.css';

const f2 = (v: number | null | undefined) => formatNumber(v, { digits: 2 });
const f3 = (v: number | null | undefined) => formatNumber(v, { digits: 3 });
/** R² con a fija puede ser negativo (la recta no tiene libre la ordenada): se muestra «< 0». */
const r2Text = (v: number | null | undefined) => (v !== null && v !== undefined && v < 0 ? '< 0' : f2(v));
/** Aviso de ajuste malo: con a fija, R² < 0 = la recta de Archie explica log F peor que su media (aunque m parezca razonable). */
const badFitText = (a: number) => `Ajuste malo (R² < 0): con a = ${f2(a)} la recta de Archie explica F peor que su promedio. Revisá a, la Rw vigente o los datos antes de aplicar m.`;
const signed3 = (v: number) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${f3(Math.abs(v))}` : '—');
const activeWellId = () => activeWellEntry(useProject.getState().project)?.well.id ?? null;

/** Datos de una curva del pozo activo alineados con la profundidad (rol `r:` o medida `m:`); null si no hay. */
function curveData(ctx: SeriesContext | null, key: string): Float64Array | null {
  if (!ctx) return null;
  const s = resolveSeries(ctx, { provider: 'curve', key: key.startsWith('m:') || key.startsWith('r:') ? key : `r:${key}` });
  return s && s.y.length === ctx.well.depth.values.length ? (s.y as Float64Array) : null;
}

const scopeText = (zones: readonly Zone[], zoneId: string | null) => {
  const z = zoneId ? zones.find((x) => x.id === zoneId) : undefined;
  return z ? `la zona ${z.name}` : 'todo el pozo';
};

/** Estado vacío: plugs y ensayo RI reales del TP en una sola receta (un Ctrl+Z). */
function loadTpAll(): void {
  const w = activeWellId();
  if (!w) return;
  const core = tpCoreSet(makeId('corona'));
  const ri = tpRiSet(makeId('ri'));
  useProject.getState().commit('Cargar datos de corona del TP', (p) => addTpRi(addTpCore(p, w, core, makeId('tend')), w, ri));
  toast({
    tone: 'ok',
    title: 'Datos de corona del TP cargados (reales, de laboratorio)',
    description: `${core.pointIds.length} plugs de las dos coronas, ya en profundidad del perfil, y el ensayo de índice de resistividad compuesto. Para a y m con los 12 plugs con factor de formación, elegí «Todo el pozo» en «Aplicar en».`,
  });
  useTrendsUi.getState().requestRange(TP_CORE_VIEW[0], TP_CORE_VIEW[1]);
}

// ── panel ──────────────────────────────────────────────────────────────────────────────────────────────────

export function CalibrationPanel() {
  const entry = useProject(selectActiveEntry);
  const ctx = usePlotContext();
  const [picked, setPicked] = useState<string | null>(null);
  const [scopePick, setScopePick] = useState<{ wellId: string; zoneId: string } | null>(null);
  const well = entry?.well ?? null;
  const interp = entry?.interpretation ?? null;
  if (!entry || !well || !interp || !ctx) {
    return <EmptyState size="sm" icon="layers" title="Sin pozo" description="Cargá un pozo y sus plugs de corona para calibrar el perfil." />;
  }
  const sets = coreSets(well.pointSets);
  const hasRi = riSets(well.pointSets).length > 0;
  if (sets.length === 0 && !hasRi) {
    return (
      <EmptyState
        size="sm"
        icon="layers"
        title="Sin plugs de corona"
        description="La calibración compara el perfil con los plugs ya puestos en profundidad: porosidad del perfil contra la de corona, densidad de matriz y exponentes de Archie (m desde el factor de formación, n desde el índice de resistividad). Cargá los plugs en el panel Corona, los datos reales del TP o los de ejemplo."
        actions={
          <>
            <Button variant="primary" icon="layers" onClick={() => useUi.getState().set({ dockTab: CORE_DOCK_ID })}>
              Ir a Corona
            </Button>
            <Button icon="table" onClick={loadTpAll} title="Plugs y ensayo de índice de resistividad reales del pozo del TP (laboratorio de la cátedra), embebidos en la app">
              Cargar datos del TP
            </Button>
            <Button variant="ghost" icon="play" onClick={loadExample} title="Plugs inventados para practicar sobre el pozo del TP: no son mediciones del pozo">
              Usar plugs de ejemplo
            </Button>
            <Button variant="ghost" icon="play" onClick={loadRiExample} title="Ensayo de índice de resistividad inventado para practicar: no son mediciones del pozo">
              Usar ensayo RI–Sw de ejemplo
            </Button>
          </>
        }
      />
    );
  }
  if (sets.length === 0) {
    // Solo el ensayo de índice de resistividad: n se calibra igual; a y m esperan los plugs con factor de formación.
    const validOnly = scopePick && scopePick.wellId === well.id && (scopePick.zoneId === '' || interp.zones.some((z) => z.id === scopePick.zoneId));
    const zoneOnly = validOnly ? scopePick!.zoneId || null : null;
    return (
      <div className="ccal">
        <div className="ccal-bar">
          <span className="ccal-bar__hint">Sin plugs de corona: solo el exponente de saturación desde el índice de resistividad.</span>
          <button type="button" className="ccal-link ccal-bar__hint" onClick={() => useUi.getState().set({ dockTab: CORE_DOCK_ID })}>
            Cargar plugs en Corona
          </button>
          <span className="shell-spacer" />
          <ScopeField interp={interp} zoneId={zoneOnly} onScope={(z) => setScopePick({ wellId: well.id, zoneId: z ?? '' })} />
        </div>
        <div className="ccal-body is-single">
          <SaturationSection wellSets={well.pointSets} interp={interp} zoneId={zoneOnly} coreSet={null} scope={{ zones: interp.zones, zoneId: zoneOnly }} />
        </div>
      </div>
    );
  }
  const set = sets.find((s) => s.id === picked) ?? sets[0]!;
  // Alcance de «Aplicar» (ρma y m): el elegido o, por defecto, la zona de los plugs.
  const validPick = scopePick && scopePick.wellId === well.id && (scopePick.zoneId === '' || interp.zones.some((z) => z.id === scopePick.zoneId));
  const zoneId = validPick ? scopePick!.zoneId || null : dominantPlugZone(set, interp.pointSets[set.id], interp.zones);
  // Las estimaciones desde plugs usan solo los del alcance: los de la zona elegida, o todos con «Todo el pozo».
  const scope: PlugScope = { zones: interp.zones, zoneId };
  const count = plugScopeCount(set, interp.pointSets[set.id], scope);
  const onScope = (z: string | null) => setScopePick({ wellId: well.id, zoneId: z ?? '' });
  const zoneName = zoneId ? (interp.zones.find((z) => z.id === zoneId)?.name ?? '') : '';
  return (
    <div className="ccal">
      <CalibrationBar set={set} sets={sets} onPick={setPicked} interp={interp} zoneId={zoneId} count={count} onScope={onScope} />
      {zoneId && count.inScope === 0 && (
        <Callout
          tone="info"
          className="ccal-scope-note"
          title={`Ningún plug cae en la zona ${zoneName}`}
          actions={
            count.included > 0 ? (
              <Button size="sm" variant="secondary" onClick={() => onScope(null)}>
                Usar todo el pozo
              </Button>
            ) : undefined
          }
        >
          Las estimaciones desde la corona (porosidad, grano, ρma y m desde F) usan solo los plugs cuya profundidad corregida cae en la zona elegida. Elegí otra zona en «Aplicar en» o todo el pozo.
        </Callout>
      )}
      <div className="ccal-body">
        <PorositySection set={set} well={well} interp={interp} ctx={ctx} scope={scope} />
        <DensitySection set={set} well={well} interp={interp} ctx={ctx} zoneId={zoneId} scope={scope} />
        <CementationSection set={set} well={well} interp={interp} ctx={ctx} zoneId={zoneId} scope={scope} />
        <SaturationSection wellSets={well.pointSets} interp={interp} zoneId={zoneId} coreSet={set} scope={scope} />
      </div>
    </div>
  );
}

/** «Aplicar en»: alcance de las recetas (todo el pozo o una zona). */
function ScopeField({ interp, zoneId, onScope }: { interp: Interpretation; zoneId: string | null; onScope(z: string | null): void }) {
  return (
    <label className="ccal-field">
      <span>Aplicar en</span>
      <Select
        size="sm"
        aria-label="Alcance de Aplicar: todo el pozo o una zona"
        value={zoneId ?? ''}
        options={[{ value: '', label: 'Todo el pozo' }, ...interp.zones.map((z) => ({ value: z.id, label: `Zona ${z.name}` }))]}
        onChange={(v) => onScope(v || null)}
      />
    </label>
  );
}

function CalibrationBar({
  set,
  sets,
  onPick,
  interp,
  zoneId,
  count,
  onScope,
}: {
  set: PointSet;
  sets: PointSet[];
  onPick(id: string): void;
  interp: Interpretation;
  zoneId: string | null;
  count: { included: number; inScope: number };
  onScope(z: string | null): void;
}) {
  const zone = zoneId ? interp.zones.find((z) => z.id === zoneId) : undefined;
  const countText = `${count.inScope} ${count.inScope === 1 ? 'plug' : 'plugs'} ${zone ? `en la zona ${zone.name}` : 'en todo el pozo'}`;
  const dm = depthMatchState(set, interp.pointSets[set.id]);
  const shiftText = dm.shifts.map((s) => `${s.label} ${s.shift > 0 ? '+' : s.shift < 0 ? '−' : ''}${f2(Math.abs(s.shift))} m`).join(' · ');
  return (
    <div className="ccal-bar">
      <div className="ccal-bar__set">
        {sets.length > 1 ? (
          <Select size="sm" aria-label="Conjunto de plugs" value={set.id} options={sets.map((s) => ({ value: s.id, label: s.name }))} onChange={onPick} />
        ) : (
          <span className="ccal-bar__name">{set.name}</span>
        )}
        {set.synthetic && (
          <Badge tone="warn" icon="warning" title="Plugs inventados para practicar: no son mediciones del pozo">
            Ejemplo sintético
          </Badge>
        )}
        {isTpCoreSet(set) && (
          <Badge tone="ok" icon="check-circle" title={`Mediciones reales del laboratorio: ${set.source}`}>
            Datos del TP
          </Badge>
        )}
      </div>
      {dm.state === 'applied' ? (
        <span className="ccal-bar__hint num" title="Puesta en profundidad del panel Corona: la calibración usa la profundidad corregida de cada plug">
          En profundidad: {shiftText}
        </span>
      ) : (
        <span className="ccal-bar__warn" role="status">
          <Badge tone="warn" icon="warning">
            Sin poner en profundidad
          </Badge>{' '}
          Se compara con la profundidad del archivo.{' '}
          <button type="button" className="ccal-link" onClick={() => useUi.getState().set({ dockTab: CORE_DOCK_ID })}>
            Ponerlos en profundidad en Corona
          </button>
        </span>
      )}
      <span className="shell-spacer" />
      <ScopeField interp={interp} zoneId={zoneId} onScope={onScope} />
      <span
        className={`ccal-bar__count num${zone && count.inScope === 0 ? ' is-empty' : ''}`}
        role="status"
        title={zone ? `Plugs incluidos cuya profundidad corregida cae en la zona ${zone.name} (de ${count.included} incluidos): las estimaciones desde la corona usan solo estos` : 'Todos los plugs incluidos'}
      >
        {countText}
      </span>
    </div>
  );
}

// ── porosidad: perfil vs. corona ───────────────────────────────────────────────────────────────────────────

function phiOptions(well: Well): { value: string; label: string }[] {
  const out = [
    { value: 'PHIE', label: 'PHIE · porosidad efectiva' },
    { value: 'PHIT', label: 'PHIT · porosidad total' },
    { value: 'PHID', label: 'PHID · porosidad por densidad' },
  ];
  for (const c of well.curves) if (c.role === 'PHIE_NMR' || c.role === 'PHIT_NMR' || c.role === 'NPHI') out.push({ value: `m:${c.id}`, label: `${c.mnemonic} · medida` });
  return out;
}

const windowLabel = (h: number) => (h === 0 ? 'Punto' : `±${formatNumber(h, { digits: 2 })} m`);

function PorositySection({ set, well, interp, ctx, scope }: { set: PointSet; well: Well; interp: Interpretation; ctx: SeriesContext; scope: PlugScope }) {
  const theme = useThemeTokens();
  const dec = interp.pointSets[set.id];
  const key = calibCurveKey(dec);
  const h = calibWindow(dec);
  const values = curveData(ctx, key);
  const depth = well.depth.values;
  const cal = useMemo(() => (values ? porosityCalibration(set, dec, depth, values, h, scope) : null), [set, dec, depth, values, h, scope.zones, scope.zoneId]);
  const options = phiOptions(ctx.well);
  const label = options.find((o) => o.value === key)?.label.split(' · ')[0] ?? key;
  const runs = pointTexts(set, COL.run);

  const axes = useMemo(() => {
    const r = cal ? niceRange([cal.core, cal.log], 'linear', { zero: true, pad: 0.08 }) : null;
    const max = Math.max(0.1, Math.min(0.5, r?.max ?? 0.3));
    return {
      x: { kind: 'linear', min: 0, max, label: `φ del perfil (${label})`, unit: 'v/v' } as XYAxis,
      y: { kind: 'linear', min: 0, max, label: 'φ de corona', unit: 'v/v' } as XYAxis,
    };
  }, [cal, label]);

  const setSetting = (k: string, v: string | number | undefined, what: string) => {
    const w = activeWellId();
    if (w) useProject.getState().commit(what, (p) => setPointSetSetting(p, w, set.id, k, v));
  };

  const st = cal?.stats ?? null;
  const rmaColor = theme.color.accent;
  const olsColor = ensureContrast(theme.color.warn, theme.viewer.trackBg, 3);
  const oneColor = theme.color.textMuted;
  const pts: XYPointLayer[] = [];
  const lines: XYLineLayer[] = [{ id: 'one', name: 'Recta 1:1', x: [0, axes.x.max], y: [0, axes.x.max], color: oneColor, width: 1, dash: [4, 4], label: '1:1' }];
  // Plugs comparables (φ de corona y del perfil con dato) y su profundidad corregida, para el gráfico y el clic.
  const pairs = useMemo(() => (cal ? cal.idx.map((_, j) => j).filter((j) => Number.isFinite(cal.core[j]!) && Number.isFinite(cal.log[j]!)) : []), [cal]);
  const plugDepths = useMemo(() => (cal ? includedPlugs(set, dec, scope).depth : null), [cal, set, dec, scope.zones, scope.zoneId]);
  const scopeEmpty = !!scope.zoneId && cal !== null && cal.idx.length === 0;
  if (cal) {
    pts.push({
      id: 'plugs',
      name: 'Plugs de corona',
      x: Float64Array.from(pairs, (j) => cal.log[j]!),
      y: Float64Array.from(pairs, (j) => cal.core[j]!),
      color: (k) => ensureContrast(runColor(set, runs?.[cal.idx[pairs[k]!]!], theme.name), theme.viewer.trackBg, 3),
      interactive: true,
      radius: 4.5,
      label: (k) => {
        const j = pairs[k]!;
        const i = cal.idx[j]!;
        return [
          `${set.pointIds[i]} · ${runLabel(runs?.[i] || null)}`,
          `φ corona ${f3(cal.core[j])} · φ perfil ${f3(cal.log[j])}`,
          `Diferencia perfil − corona ${signed3(cal.log[j]! - cal.core[j]!)}`,
          'Clic: ver en el visor',
        ].join('\n');
      },
    });
    const lo = 0;
    const hi = axes.x.max;
    if (st?.ols) lines.push({ id: 'ols', name: 'Recta OLS', ...lineOver(st.ols, lo, hi), color: olsColor, width: 1.5, dash: [6, 3], label: 'OLS' });
    if (st?.rma) lines.push({ id: 'rma', name: 'Recta RMA', ...lineOver(st.rma, lo, hi), color: rmaColor, width: 2, label: 'RMA' });
  }

  const verdict =
    st && st.n >= 3 && Number.isFinite(st.bias)
      ? Math.abs(st.bias) < 0.005
        ? 'Sin sesgo apreciable entre el perfil y la corona.'
        : `El perfil ${st.bias > 0 ? 'sobreestima' : 'subestima'} la porosidad en ${f3(Math.abs(st.bias))} v/v en promedio.`
      : null;

  return (
    <section className="ccal-col" aria-label="Porosidad del perfil contra la de corona">
      <header className="ccal-col__head">
        <h3>Porosidad · perfil vs. corona</h3>
      </header>
      <div className="ccal-controls">
        <label className="ccal-field">
          <span>Curva</span>
          <Select size="sm" aria-label="Curva del perfil para comparar con la porosidad de corona" value={key} options={options} onChange={(v) => setSetting(CALIB_CURVE_SETTING, v, 'Cambiar la curva de calibración')} />
        </label>
        <SegmentedControl<string>
          size="sm"
          aria-label="Ventana del perfil alrededor de cada plug"
          value={String(h)}
          options={WINDOW_OPTIONS.map((w) => ({ value: String(w), label: windowLabel(w), title: w === 0 ? 'Valor del perfil interpolado en la profundidad del plug' : `Promedio del perfil entre ${windowLabel(w)} alrededor del plug (resolución vertical de la herramienta)` }))}
          onChange={(v) => setSetting(CALIB_WINDOW_SETTING, Number(v) === DEFAULT_WINDOW ? undefined : Number(v), 'Cambiar la ventana de calibración')}
        />
      </div>
      {!values ? (
        <p className="ccal-empty">Todavía no hay {label} en el pozo (se está calculando o falta algún paso de porosidad): elegí otra curva.</p>
      ) : !cal ? (
        <p className="ccal-empty">Los plugs no tienen porosidad: no hay con qué calibrar la del perfil.</p>
      ) : scopeEmpty ? (
        <p className="ccal-empty">{`Ningún plug en ${scopeText(scope.zones, scope.zoneId)}: no hay con qué comparar la porosidad.`}</p>
      ) : (
        <>
          <div className="ccal-kpis">
            <KPI label="Plugs" value={String(st!.n)} title={`Plugs incluidos de ${scopeText(scope.zones, scope.zoneId)} con porosidad de corona y del perfil`} />
            <KPI label="Sesgo" value={signed3(st!.bias)} unit="v/v" title="Media de perfil − corona: positivo = el perfil sobreestima" />
            <KPI label="RMSE" value={f3(st!.rmse)} unit="v/v" title="Raíz del error cuadrático medio perfil − corona" />
            <KPI label="R²" value={f2(st!.r2)} title="Correlación lineal: no mide la cercanía a la recta 1:1 (para eso, el sesgo y el RMSE)" />
          </div>
          <XYPlot
            height={230}
            figureId="core-calibration-phi"
            figureTitle="Porosidad del perfil contra la de corona"
            className="ccal-plot"
            data-testid="ccal-phi-plot"
            ariaLabel={`Porosidad de corona contra ${label} en ${st!.n} plugs, con la recta 1:1 y las rectas de calibración`}
            x={axes.x}
            y={axes.y}
            points={pts}
            lines={lines}
            emptyText="Sin plugs comparables (fuera del perfil o sin dato)"
            onPointClick={(_layer, k) => {
              const j = pairs[k];
              const dz = j === undefined ? undefined : plugDepths?.[j];
              if (dz !== undefined && Number.isFinite(dz)) useTrendsUi.getState().requestRange(dz - 10, dz + 10);
            }}
          />
          <Legend
            items={[
              { color: oneColor, label: '1:1', dash: true },
              { color: rmaColor, label: 'RMA (eje mayor reducido)' },
              { color: olsColor, label: 'OLS (mínimos cuadrados)', dash: true },
            ]}
          />
          <dl className="ccal-facts num">
            {st!.rma && (
              <>
                <dt title="Corona = ordenada + pendiente × perfil, tratando a las dos con error">RMA</dt>
                <dd>
                  pendiente {f3(st!.rma.slope)} · ordenada {signed3(st!.rma.intercept)}
                </dd>
              </>
            )}
            {st!.ols && (
              <>
                <dt title="Mínimos cuadrados de la corona sobre el perfil: la de menor error para predecir">OLS</dt>
                <dd>
                  pendiente {f3(st!.ols.slope)} · ordenada {signed3(st!.ols.intercept)}
                </dd>
              </>
            )}
            <dt>MAE · r</dt>
            <dd>
              {f3(st!.mae)} v/v · {f2(st!.r)}
            </dd>
          </dl>
          {verdict && <p className="ccal-note">{verdict}</p>}
          {st!.n > 0 && st!.n < 5 && <p className="ccal-warn">Pocos plugs comparables: las rectas son poco confiables.</p>}
        </>
      )}
    </section>
  );
}

// ── densidad de matriz ─────────────────────────────────────────────────────────────────────────────────────

type MatrixChoice = 'grain' | 'fit' | 'rhomaa';

function DensitySection({ set, well, interp, ctx, zoneId, scope }: { set: PointSet; well: Well; interp: Interpretation; ctx: SeriesContext; zoneId: string | null; scope: PlugScope }) {
  const theme = useThemeTokens();
  const result = useResults((s) => s.result);
  const [choice, setChoice] = useState<MatrixChoice>('grain');
  const dec = interp.pointSets[set.id];
  const h = calibWindow(dec);
  const depth = well.depth.values;
  const rhob = curveData(ctx, 'RHOB');
  const rhomaa = curveData(ctx, 'RHOMAA');
  const vsh = curveData(ctx, 'VSH');
  const rhoFl = paramValue(interp.params, CALIB_PARAMS.rhoFl, zoneId);
  const rhomaaFl = paramValue(interp.params, CALIB_PARAMS.rhomaaFl, zoneId);
  const current = paramValue(interp.params, CALIB_PARAMS.rhoMa, zoneId);
  const est = useMemo(() => matrixDensityEstimates(set, dec, depth, rhob, rhoFl, h, scope), [set, dec, depth, rhob, rhoFl, h, scope.zones, scope.zoneId]);
  const noPlugs = !!zoneId && includedPlugs(set, dec, scope).idx.length === 0;
  const noPlugsText = `Ningún plug en ${scopeText(scope.zones, zoneId)}`;
  const rows = useMemo(() => {
    const t = result?.outputs.find((o) => o.moduleId === CORE_CALIBRATION_ID && o.port === RHOMAA_ZONES)?.value as TableValue | undefined;
    return rhomaaZoneRows(t?.rows);
  }, [result]);
  const row = rows.find((r) => r.zoneId === (zoneId ?? WHOLE_WELL_ROW)) ?? null;
  const zones = interp.zones;
  const target = scopeText(zones, zoneId);

  const candidates: Record<MatrixChoice, number> = {
    grain: est.grain?.median ?? NaN,
    fit: est.fit?.rhoMa ?? NaN,
    rhomaa: row?.median ?? NaN,
  };
  const firstAvailable = (['grain', 'fit', 'rhomaa'] as const).find((c) => Number.isFinite(candidates[c])) ?? 'grain';
  const pick: MatrixChoice = Number.isFinite(candidates[choice]) ? choice : firstAvailable;
  const value = candidates[pick];
  const rounded = roundedParam(CALIB_PARAMS.rhoMa, value);
  const fits = fitsParam(CALIB_PARAMS.rhoMa, value);
  const applied = isApplied(interp.params, CALIB_PARAMS.rhoMa, zoneId, value);

  // Histograma de ρmaa en el alcance (muestras limpias, como el valor por zona del módulo).
  const vshMax = paramValue(interp.params, CALIB_PARAMS.vshMax, zoneId);
  const hist = useMemo(() => {
    if (!rhomaa) return null;
    const layout = layoutZones(depth, zones);
    const zi = zoneId ? layout.spans.findIndex((s) => s.id === zoneId) : -1;
    // Vsh máxima de la zona de cada muestra (el parámetro es por zona), como el valor por zona del módulo.
    const limits = layout.spans.map((s) => paramValue(interp.params, CALIB_PARAMS.vshMax, s.id));
    const outside = paramValue(interp.params, CALIB_PARAMS.vshMax, null);
    const include = (i: number) => {
      const j = layout.zoneIndex[i]!;
      if (zoneId && j !== zi) return false;
      return !vsh || vsh[i]! <= (j >= 0 ? limits[j]! : outside);
    };
    const r = autoRange(rhomaa, 'linear', include, null);
    if (!r) return null;
    const edges = binEdges(Math.min(r.lo, 2.45), Math.max(r.hi, 2.95), Math.max(12, Math.min(40, r.bins)), 'linear');
    const c = countBins(rhomaa, edges, 'linear', include);
    const total = c.n + c.below + c.above;
    return { edges, values: Float64Array.from(c.counts, (v) => (total > 0 ? (100 * v) / total : 0)), n: c.n };
  }, [rhomaa, depth, zones, zoneId, vsh, interp.params]);

  const grainColor = ensureContrast('#0f766e', theme.viewer.trackBg, 3);
  const fitColor = theme.color.accent;
  const curColor = theme.color.textMuted;
  const barColor = theme.name === 'dark' ? '#f2c14e' : '#a16207';
  const guides: XYGuide[] = [];
  if (Number.isFinite(candidates.grain)) guides.push({ axis: 'x', value: candidates.grain, color: grainColor, width: 2 });
  if (Number.isFinite(candidates.fit)) guides.push({ axis: 'x', value: candidates.fit, color: fitColor, width: 2, dash: [5, 3] });
  guides.push({ axis: 'x', value: current, color: curColor, width: 1.25, dash: [2, 3] });
  const bars: XYBarLayer[] = hist ? [{ id: 'rhomaa', name: 'ρmaa del perfil', edges: hist.edges, values: hist.values, color: barColor, fillAlpha: 0.4 }] : [];
  const maxPct = hist ? Math.max(5, ...Array.from(hist.values)) : 10;
  const histAxes = hist ? { x: { kind: 'linear', min: hist.edges[0]!, max: hist.edges[hist.edges.length - 1]!, label: 'ρmaa', unit: 'g/cm³' } as XYAxis, y: { kind: 'linear', min: 0, max: Math.ceil(maxPct * 1.15), label: 'Frecuencia', unit: '%' } as XYAxis } : null;

  const own = !zoneId ? zonesWithOwnValue(interp, CALIB_PARAMS.rhoMa) : [];
  const apply = () => {
    const w = activeWellId();
    if (!w || !Number.isFinite(rounded)) return;
    useProject.getState().commit(zoneId ? `Aplicar ρma a la zona ${zones.find((z) => z.id === zoneId)?.name}` : 'Aplicar ρma al pozo', (p) => applyMatrixDensity(p, w, value, zoneId));
    toast({
      tone: 'ok',
      title: `Densidad de matriz ${f2(rounded)} g/cm³`,
      description: `La porosidad por densidad de ${target} usa ahora esta matriz.${own.length ? ` Las zonas ${own.map((z) => z.name).join(', ')} tienen un valor propio y no cambian.` : ''}`,
    });
  };
  const openHistogram = () => {
    const w = activeWellId();
    if (!w) return;
    useProject.getState().commit('Ver el histograma de ρmaa', (p) => updatePlotConfig(p, w, 'histogram', { curve: 'r:RHOMAA', byZone: true, zones: [], scale: 'auto' }));
    useUi.getState().set({ dockTab: 'histogram' });
  };

  const optionRow = (c: MatrixChoice, title: string, valueText: string, detail: string, color: string) => (
    <button type="button" role="radio" aria-checked={pick === c} disabled={!Number.isFinite(candidates[c])} className="ccal-choice" onClick={() => setChoice(c)}>
      <span className="ccal-choice__mark" style={{ ['--mark' as string]: color }} aria-hidden="true" />
      <span className="ccal-choice__title">{title}</span>
      <span className="ccal-choice__value num">{valueText}</span>
      <span className="ccal-choice__detail num">{detail}</span>
    </button>
  );

  return (
    <section className="ccal-col" aria-label="Densidad de matriz">
      <header className="ccal-col__head">
        <h3>Densidad de matriz</h3>
        <span className="num" title="Densidad del fluido de la porosidad por densidad en el alcance">
          ρf {f2(rhoFl)} g/cm³
        </span>
      </header>
      <div className="ccal-choices" role="radiogroup" aria-label="Densidad de matriz a aplicar">
        {optionRow('grain', 'Grano de los plugs', est.grain ? `${f3(est.grain.median)} g/cm³` : 'sin dato', est.grain ? `P10–P90 ${f2(est.grain.p10)}–${f2(est.grain.p90)} · n ${est.grain.n}` : noPlugs ? noPlugsText : 'Los plugs no tienen densidad de grano', grainColor)}
        {optionRow(
          'fit',
          'Iguala φ densidad con φ corona',
          est.fit ? `${f3(est.fit.rhoMa)} g/cm³` : 'sin dato',
          est.fit ? `RMSE φ ${f3(est.fit.rmse)} · n ${est.fit.n}${est.fit.clamped ? ' · acotada' : ''}` : noPlugs ? noPlugsText : rhob ? 'Faltan plugs con porosidad dentro del perfil' : 'Falta la densidad del perfil',
          fitColor,
        )}
        {optionRow('rhomaa', `ρmaa del perfil · ${zoneId ? `zona ${zones.find((z) => z.id === zoneId)?.name ?? ''}` : 'pozo'}`, row && Number.isFinite(row.median) ? `${f3(row.median)} g/cm³` : 'sin dato', row && Number.isFinite(row.median) ? `P10–P90 ${f2(row.p10)}–${f2(row.p90)} · n ${row.n}` : 'Sin ρmaa (falta densidad o porosidad total)', barColor)}
      </div>
      {est.fit?.clamped && <p className="ccal-warn">La densidad que iguala la corona cae fuera de 2,50–3,00 g/cm³: se acotó. Revisá la puesta en profundidad o la densidad del fluido.</p>}
      {Math.abs(rhomaaFl - rhoFl) > 1e-9 && <p className="ccal-warn">ρmaa usa ρf {f2(rhomaaFl)} y la porosidad por densidad {f2(rhoFl)} g/cm³: igualalas para compararlas.</p>}
      {Number.isFinite(value) && !fits && (
        <p className="ccal-warn">
          {f3(value)} g/cm³ queda fuera del rango del control ({f2(CALIB_PARAMS.rhoMa.spec.min)}–{f2(CALIB_PARAMS.rhoMa.spec.max)}): no se puede aplicar. Elegí otra estimación.
        </p>
      )}
      <div className="ccal-apply">
        <Button size="sm" variant={applied ? 'secondary' : 'primary'} icon="check" disabled={!Number.isFinite(rounded) || !fits || applied} onClick={apply} title={`Escribe la densidad de matriz de «Porosidad por densidad» en ${target}`}>
          {applied ? 'Aplicada' : `Aplicar ${Number.isFinite(rounded) ? f2(rounded) : '—'} g/cm³`}
        </Button>
        <span className="ccal-apply__now num">
          Vigente en {target}: <strong>{f2(current)}</strong> g/cm³
        </span>
      </div>
      {hist && histAxes ? (
        <>
          <XYPlot
            compact
            height={150}
            className="ccal-plot"
            figureId="core-calibration-rhomaa"
            figureTitle="Histograma de la densidad de matriz aparente"
            ariaLabel={`Histograma de ρmaa en ${target}: ${hist.n} muestras limpias`}
            x={histAxes.x}
            y={histAxes.y}
            bars={bars}
            guides={guides}
          />
          <div className="ccal-row">
            <Legend
              items={[
                { color: barColor, label: zoneId ? `ρmaa de la zona (Vsh ≤ ${f2(vshMax)})` : 'ρmaa del pozo (Vsh ≤ el máximo de cada zona)' },
                { color: grainColor, label: 'grano' },
                { color: fitColor, label: 'iguala corona', dash: true },
                { color: curColor, label: 'vigente', dash: true },
              ]}
            />
            <span className="shell-spacer" />
            <Button size="sm" variant="ghost" icon="histogram" onClick={openHistogram} title="Abre el histograma libre con ρmaa superpuesta por zona">
              Por zona
            </Button>
          </div>
        </>
      ) : (
        <p className="ccal-empty">Sin ρmaa en el alcance: hacen falta la densidad y la porosidad total del perfil.</p>
      )}
    </section>
  );
}

// ── exponente de cementación ────────────────────────────────────────────────────────────────────────────────

function CementationSection({ set, well, interp, ctx, zoneId, scope }: { set: PointSet; well: Well; interp: Interpretation; ctx: SeriesContext; zoneId: string | null; scope: PlugScope }) {
  const theme = useThemeTokens();
  const project = useProject((s) => s.project);
  const dec = interp.pointSets[set.id];
  const a = paramValue(interp.params, CALIB_PARAMS.a, zoneId);
  const mNow = paramValue(interp.params, CALIB_PARAMS.m, zoneId);
  const zones = interp.zones;
  const target = scopeText(zones, zoneId);
  const pickett = project.display.plots?.[well.id]?.crossplot?.pickettWaterZones ?? [];
  const [water, setWater] = useState<{ wellId: string; ids: string[] } | null>(null);
  const waterZones = (water && water.wellId === well.id ? water.ids : pickett).filter((id) => zones.some((z) => z.id === id));

  const phi = curveData(ctx, 'PHIE');
  const rt = curveData(ctx, 'RT');
  const rw = curveData(ctx, 'RW');
  const vsh = curveData(ctx, 'VSH');
  const vshMaxOf = (id: string) => paramValue(interp.params, CALIB_PARAMS.vshMax, id);
  const vshText = [...new Set(waterZones.map((id) => f2(vshMaxOf(id))))].join(' – ');
  const plugs = useMemo(() => plugCementation(set, dec, a, scope), [set, dec, a, scope.zones, scope.zoneId]);
  const fromLog = useMemo(
    () => (phi && rt && rw ? logCementation({ depth: well.depth.values, zones, waterZones, phi, rt, rw, vsh, vshMax: vshMaxOf, a }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phi, rt, rw, vsh, interp.params, a, well, zones, waterZones.join('|')],
  );
  const runs = pointTexts(set, COL.run);
  const idx = plugs?.idx ?? [];

  const plugColor = theme.color.accent;
  const logColor = ensureContrast('#0e7490', theme.viewer.trackBg, 3);
  const nowColor = theme.color.textMuted;
  const hasPlugF = !!plugs && plugs.n > 0;
  const fixed = plugs?.fixedA ?? null;
  const free = plugs?.freeA ?? null;
  const mLog = fromLog && fromLog.perSample.n > 0 ? fromLog.perSample.median : NaN;
  const mRange = `${f2(CALIB_PARAMS.m.spec.min)}–${f2(CALIB_PARAMS.m.spec.max)}`;
  const aRange = `${f2(CALIB_PARAMS.a.spec.min)}–${f2(CALIB_PARAMS.a.spec.max)}`;
  const fixedFits = !!fixed && fitsParam(CALIB_PARAMS.m, fixed.m);
  const freeFits = !!free && fitsParam(CALIB_PARAMS.m, free.m) && fitsParam(CALIB_PARAMS.a, free.a);
  const logFits = fitsParam(CALIB_PARAMS.m, mLog);

  const commitM = (fit: { m: number; a?: number }, what: string) => {
    const w = activeWellId();
    if (!w) return;
    const own = !zoneId ? zonesWithOwnValue(interp, CALIB_PARAMS.m) : [];
    useProject.getState().commit(`Aplicar ${what}${zoneId ? ` a la zona ${zones.find((z) => z.id === zoneId)?.name}` : ' al pozo'}`, (p) => applyCementation(p, w, fit, zoneId));
    toast({
      tone: 'ok',
      title: `m = ${f2(roundedParam(CALIB_PARAMS.m, fit.m))}${fit.a !== undefined ? ` · a = ${f2(roundedParam(CALIB_PARAMS.a, fit.a))}` : ''}`,
      description: `Los modelos de saturación de ${target} usan ahora este exponente.${own.length ? ` Las zonas ${own.map((z) => z.name).join(', ')} tienen un valor propio y no cambian.` : ''}`,
    });
  };

  // Gráfico log–log F contra φ.
  const pts: XYPointLayer[] = [];
  if (fromLog && fromLog.phi.length) {
    pts.push({ id: 'log', name: 'Perfil en zona acuífera (Rt/Rw)', x: fromLog.phi, y: fromLog.F, color: logColor, cloud: true });
  }
  if (plugs && hasPlugF) {
    const ok = plugs.phi.map((_, j) => j).filter((j) => plugs.phi[j]! > 0 && plugs.F[j]! > 0);
    pts.push({
      id: 'plugs',
      name: 'Plugs (F de laboratorio)',
      x: Float64Array.from(ok, (j) => plugs.phi[j]!),
      y: Float64Array.from(ok, (j) => plugs.F[j]!),
      color: (k) => ensureContrast(runColor(set, runs?.[idx[ok[k]!]!], theme.name), theme.viewer.trackBg, 3),
      interactive: true,
      radius: 4,
      label: (k) => {
        const j = ok[k]!;
        return `${set.pointIds[idx[j]!]} · φ ${f3(plugs.phi[j])} · F ${formatNumber(plugs.F[j], { significant: 3 })}`;
      },
    });
  }
  const allPhi = [...(fromLog ? [fromLog.phi] : []), ...(plugs ? [plugs.phi] : [])];
  const allF = [...(fromLog ? [fromLog.F] : []), ...(plugs ? [plugs.F] : [])];
  const xr = niceRange(allPhi, 'log') ?? { min: 0.03, max: 0.4 };
  const yr = niceRange(allF, 'log') ?? { min: 3, max: 1000 };
  const x: XYAxis = { kind: 'log', min: Math.max(0.01, Math.min(xr.min, 0.05)), max: Math.min(1, Math.max(xr.max, 0.4)), label: 'Porosidad φ', unit: 'v/v' };
  const y: XYAxis = { kind: 'log', min: Math.max(1, Math.min(yr.min, 5)), max: Math.max(yr.max, 100), label: 'Factor de formación F' };
  const lines: XYLineLayer[] = [{ id: 'now', name: `Vigente (a ${f2(a)}, m ${f2(mNow)})`, ...archieLine(a, mNow, x.min, x.max), color: nowColor, width: 1.25, dash: [3, 3], label: `vigente m ${f2(mNow)}` }];
  if (fixed) lines.push({ id: 'plug-fixed', name: 'Plugs, a fija', ...archieLine(fixed.a, fixed.m, x.min, x.max), color: plugColor, width: 2, label: `plugs m ${f2(fixed.m)}` });
  if (Number.isFinite(mLog)) lines.push({ id: 'log-median', name: 'Perfil, mediana', ...archieLine(a, mLog, x.min, x.max), color: logColor, width: 2, dash: [6, 3], label: `perfil m ${f2(mLog)}`, labelAt: 'start' });

  const toggleWater = (id: string, on: boolean) => {
    const next = on ? [...waterZones, id] : waterZones.filter((z) => z !== id);
    setWater({ wellId: well.id, ids: next });
  };
  const missing = [!phi && 'PHIE', !rt && 'Rt', !rw && 'Rw'].filter(Boolean) as string[];

  return (
    <section className="ccal-col" aria-label="Exponente de cementación m">
      <header className="ccal-col__head">
        <h3>Exponente de cementación m</h3>
        <span className="num" title={`Valores de Archie vigentes en ${target}`}>
          vigente a {f2(a)} · m {f2(mNow)}
        </span>
      </header>
      <div className="ccal-mgrid">
        <div className="ccal-mcard">
          <div className="ccal-mcard__title">Desde los plugs (F)</div>
          {!hasPlugF && plugs && plugs.idx.length === 0 && zoneId ? (
            <p className="ccal-empty is-tight">Ningún plug en {target}: elegí otra zona o todo el pozo en «Aplicar en».</p>
          ) : !hasPlugF ? (
            <p className="ccal-empty is-tight">Los plugs no tienen factor de formación. Cargá una columna F (ensayo eléctrico: F = Ro/Rw) para ajustar m con la corona.</p>
          ) : (
            <>
              <div className="ccal-mcard__row num">
                <span title={`Recta por el origen en log F – log φ con a = ${f2(a)} (la vigente)`}>
                  a fija {f2(a)}: <strong>m {f2(fixed?.m)}</strong> · R² {r2Text(fixed?.r2)} · n {fixed?.n ?? 0}
                </span>
              </div>
              {free ? (
                <div className="ccal-mcard__row num">
                  <span title="Recta con ordenada: a y m se ajustan juntos (poco robusta con pocos plugs o rango de φ estrecho)">
                    a libre: a {f2(free.a)} · <strong>m {f2(free.m)}</strong> · R² {r2Text(free.r2)}
                  </span>
                </div>
              ) : (
                <div className="ccal-mcard__row ui-text-muted">a libre: hacen falta al menos 3 plugs con F.</div>
              )}
              {fixed && !fixedFits && <p className="ccal-warn">m {f2(fixed.m)} queda fuera del rango del control ({mRange}): no se puede aplicar. Revisá F y la porosidad de los plugs.</p>}
              {free && !freeFits && <p className="ccal-warn">a {f2(free.a)} · m {f2(free.m)} quedan fuera del rango del control (a {aRange}, m {mRange}): no se pueden aplicar con a libre.</p>}
              {fixed && fixedFits && (fixed.m < 1.3 || fixed.m > 3) && <p className="ccal-warn">m fuera de 1,3–3: revisá F y la porosidad de los plugs (unidad, puesta en profundidad).</p>}
              {fixed && fixed.r2 < 0 && <p className="ccal-warn">{badFitText(a)}</p>}
              <div className="ccal-mcard__actions">
                <Button size="sm" variant={fixed && Math.abs(roundedParam(CALIB_PARAMS.m, fixed.m) - mNow) < 1e-9 ? 'secondary' : 'primary'} disabled={!fixedFits} onClick={() => fixed && commitM({ m: fixed.m }, 'm de la corona')}>
                  Aplicar m {fixed ? f2(roundedParam(CALIB_PARAMS.m, fixed.m)) : ''}
                </Button>
                <Button size="sm" variant="secondary" disabled={!freeFits} onClick={() => free && commitM({ m: free.m, a: free.a }, 'a y m de la corona')} title="Escribe a y m del ajuste con a libre">
                  Aplicar a y m
                </Button>
              </div>
            </>
          )}
        </div>
        <div className="ccal-mcard">
          <div className="ccal-mcard__title">Desde el perfil en zona acuífera</div>
          <div className="ccal-zones" role="group" aria-label="Zonas acuíferas (Sw = 1)">
            {zones.length === 0 ? <span className="ui-text-muted">El pozo no tiene zonas.</span> : zones.map((z) => <Checkbox key={z.id} checked={waterZones.includes(z.id)} onChange={(on) => toggleWater(z.id, on)} label={z.name} />)}
          </div>
          {missing.length > 0 ? (
            <p className="ccal-empty is-tight">Falta {missing.join(', ')} en el pozo: completá los pasos de porosidad y de Rw.</p>
          ) : waterZones.length === 0 ? (
            <p className="ccal-empty is-tight">Marcá las zonas 100 % acuíferas (Sw = 1). Se toman las del Pickett si las elegiste ahí.</p>
          ) : fromLog && fromLog.perSample.n > 0 ? (
            <>
              <div className="ccal-mcard__row num">
                <span title={`Mediana de m por muestra con la Rt y la Rw vigentes, en muestras con Vsh ≤ ${vshText} (máximo de cada zona)`}>
                  mediana <strong>m {f2(fromLog.perSample.median)}</strong> · P10–P90 {f2(fromLog.perSample.p10)}–{f2(fromLog.perSample.p90)} · n {fromLog.perSample.n}
                </span>
              </div>
              {fromLog.fit.fixedA && (
                <div className="ccal-mcard__row num ui-text-muted" title="Mínimos cuadrados de log(Rt/Rw) contra log φ con a fija">
                  ajuste con a {f2(a)}: m {f2(fromLog.fit.fixedA.m)} · R² {r2Text(fromLog.fit.fixedA.r2)}
                </div>
              )}
              {fromLog.fit.fixedA && fromLog.fit.fixedA.r2 < 0 && <p className="ccal-warn">{badFitText(a)}</p>}
              {(fromLog.perSample.median < 1.3 || fromLog.perSample.median > 3) && <p className="ccal-warn">m fuera de 1,3–3: la zona probablemente no es acuífera, tiene arcilla conductiva o la Rw vigente no corresponde.</p>}
              {!logFits && <p className="ccal-warn">m {f2(mLog)} queda fuera del rango del control ({mRange}): no se puede aplicar.</p>}
              <div className="ccal-mcard__actions">
                <Button size="sm" disabled={!logFits} variant={Math.abs(roundedParam(CALIB_PARAMS.m, mLog) - mNow) < 1e-9 ? 'secondary' : 'primary'} onClick={() => commitM({ m: mLog }, 'm del perfil')}>
                  Aplicar m {f2(roundedParam(CALIB_PARAMS.m, mLog))}
                </Button>
              </div>
            </>
          ) : (
            <p className="ccal-empty is-tight">Ninguna muestra válida en esas zonas (porosidad, Rt, Rw y Vsh ≤ {vshText}).</p>
          )}
        </div>
      </div>
      {pts.length > 0 && (
        <>
          <XYPlot
            height={200}
            className="ccal-plot"
            figureId="core-calibration-ff"
            figureTitle="Factor de formación contra porosidad"
            ariaLabel="Factor de formación contra porosidad en escala log–log, con la recta de Archie vigente y las ajustadas"
            x={x}
            y={y}
            points={pts}
            lines={lines}
          />
          <Legend
            items={[
              ...(hasPlugF ? [{ color: plugColor, label: 'plugs' }] : []),
              ...(fromLog && fromLog.phi.length ? [{ color: logColor, label: 'perfil (Rt/Rw)', dot: true }] : []),
              { color: nowColor, label: 'vigente', dash: true },
            ]}
          />
        </>
      )}
      {!hasPlugF && (!fromLog || fromLog.perSample.n === 0) && missing.length === 0 && waterZones.length > 0 && <Callout tone="info">Sin datos para m en este alcance.</Callout>}
    </section>
  );
}

export const dockPanels: DockPanelDef[] = [
  {
    id: CALIBRATION_DOCK_ID,
    title: 'Calibración',
    icon: 'sliders',
    component: CalibrationPanel,
  },
];

