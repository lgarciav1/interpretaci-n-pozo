/**
 * Panel «Tipos de roca» del dock (docs/decisiones/0024-rock-typing.md): familias de roca con los plugs de corona ya
 * puestos en profundidad (panel «Corona»; acá se usa `shiftedDepth` y nunca se recalcula un desplazamiento).
 *
 *   Winland · Pittman   k (log) contra φ con isolíneas de radio de garganta (0,1 · 0,5 · 2 · 10 µm) y plugs por clase
 *                       de garganta; R35 de Winland o R25/R35/R50 de Pittman. «Llevar al pozo» las clases de Winland.
 *   FZI · RQI           log RQI contra log φz con una recta de pendiente 1 por unidad de flujo; 2–6 unidades
 *                       automáticas (Fisher–Jenks) o límites manuales; tabla de clases; «Llevar al pozo» los límites.
 *   Presión capilar     Pc–Sw, J de Leverett y distribución de gargantas (Washburn) del EJEMPLO DE LIBRO, coloreadas
 *                       por la unidad de flujo en que caerían.
 *
 * Gráficos del x–y base (`src/plots/xy/`), temas por tokens, colores de clase de `classColor` (los de la pista). Todo
 * cambio va por `commit`. Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { useMemo, useState } from 'react';
import type { Interpretation } from '../../core/interpretation';
import type { PointSet } from '../../core/pointSets';
import { setPointSetSetting } from '../../core/state/pointSets';
import { activeWellEntry, setSource } from '../../core/state/project';
import type { Well } from '../../core/well';
import { EXAMPLE_PC_SOURCE, normalizedPorosity, PORT_CLASSES, reservoirQualityIndex } from '../../petro/rockTyping';
import { niceRange, type XYAxis } from '../../plots/xy/axes';
import type { XYGuide, XYLineLayer, XYPointLayer } from '../../plots/xy/layers';
import { XYPlot } from '../../plots/xy/XYPlot';
import type { SeriesContext } from '../../plots/trend/series';
import { Badge, Button, Callout, DataTable, EmptyState, NumberField, SegmentedControl, Select, TabPanel, Tabs, formatNumber, toast, useThemeTokens, type Column } from '../../ui';
import { ensureContrast } from '../../ui/color';
import type { DockPanelDef } from '../../ui/dockPanel';
import { usePlotContext } from '../../app/plots/connect';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import { useTrendsUi } from '../../app/trends/store';
import { loadExample } from '../core/dock';
import { CORE_DOCK_ID, coreSets, permCoreParams } from '../core/model';
import { PERM_CORE_ID } from '../perm-core';
import { MAX_FLOW_UNITS, MIN_FLOW_UNITS } from './index';
import {
  applyFlowUnits,
  applyWinland,
  boundsToApply,
  capillaryCurves,
  clampUnits,
  curveFzi,
  curveFlowUnit,
  curveThroats,
  encodeBounds,
  flowUnitRows,
  flowUnitsApplied,
  ISO_RADII,
  leverettCurve,
  permFromCore,
  plugFlowUnits,
  plugThroatRadii,
  portClassCounts,
  portClasses,
  ROCK_DOCK_ID,
  rockModuleParams,
  rockPlugs,
  rockSettings,
  roundBound,
  rqiLine,
  RT_BOUNDS_SETTING,
  RT_MODE_SETTING,
  RT_THROAT_SETTING,
  RT_UNITS_SETTING,
  THROAT_METHODS,
  throatIsoline,
  throatMethod,
  type FlowUnitRow,
  type RockPlugs,
  type ThroatMethod,
} from './model';
import { classColor } from './draw';
import './rock-typing.css';

const f2 = (v: number | null | undefined) => formatNumber(v, { digits: 2 });
const f3 = (v: number | null | undefined) => formatNumber(v, { digits: 3 });
const sig = (v: number | null | undefined, s = 3) => formatNumber(v, { significant: s });
const activeWellId = () => activeWellEntry(useProject.getState().project)?.well.id ?? null;

type TabId = 'winland' | 'fzi' | 'pc';
const TAB_KEY = 'rtyp.tab';
const readTab = (): TabId => {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return v === 'winland' || v === 'fzi' || v === 'pc' ? v : 'fzi';
  } catch {
    return 'fzi';
  }
};

/** Curva activa del pozo (rol) alineada con la profundidad, o null. */
function activeCurve(ctx: SeriesContext | null, port: string): Float64Array | null {
  const n = ctx?.well.depth.values.length ?? 0;
  const c = ctx?.computed.find((x) => x.active && x.port === port);
  return c && c.data.length === n ? c.data : null;
}

/** Nube del perfil (φ, k) diezmada a ≤ 2500 puntos válidos, para dar contexto a los plugs. */
function logCloud(phi: Float64Array | null, k: Float64Array | null): { phi: Float64Array; k: Float64Array } | null {
  if (!phi || !k) return null;
  const step = Math.max(1, Math.floor(phi.length / 2500));
  const ps: number[] = [];
  const ks: number[] = [];
  for (let i = 0; i < phi.length; i += step) {
    const p = phi[i]!;
    const v = k[i]!;
    if (p > 0 && p < 1 && v > 0 && Number.isFinite(v)) {
      ps.push(p);
      ks.push(v);
    }
  }
  return ps.length ? { phi: Float64Array.from(ps), k: Float64Array.from(ks) } : null;
}

function Legend({ items }: { items: { color: string; label: string; dash?: boolean; dot?: boolean }[] }) {
  return (
    <div className="rtyp-legend">
      {items.map((it) => (
        <span key={it.label} className="rtyp-legend__item">
          <span className={`rtyp-legend__mark${it.dot ? ' is-dot' : ''}${it.dash ? ' is-dash' : ''}`} style={{ ['--mark' as string]: it.color }} aria-hidden="true" />
          {it.label}
        </span>
      ))}
    </div>
  );
}

const Swatch = ({ color }: { color: string }) => <span className="rtyp-swatch" style={{ ['--mark' as string]: color }} aria-hidden="true" />;

const showInViewer = (z: number | undefined) => {
  if (z !== undefined && Number.isFinite(z)) useTrendsUi.getState().requestRange(z - 10, z + 10);
};

// ── panel ──────────────────────────────────────────────────────────────────────────────────────────────────

export function RockTypingPanel() {
  const entry = useProject(selectActiveEntry);
  const ctx = usePlotContext();
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTabState] = useState<TabId>(readTab);
  const setTab = (t: string) => {
    setTabState(t as TabId);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* sin almacenamiento: la pestaña no se recuerda */
    }
  };
  const well = entry?.well ?? null;
  const interp = entry?.interpretation ?? null;
  if (!entry || !well || !interp || !ctx) {
    return <EmptyState size="sm" icon="layers" title="Sin pozo" description="Cargá un pozo y sus plugs de corona para armar los tipos de roca." />;
  }
  const sets = coreSets(well.pointSets);
  if (sets.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon="mountain"
        title="Sin plugs de corona"
        description="Los tipos de roca salen de la porosidad y la permeabilidad de los plugs: clases de garganta de Winland y Pittman y unidades de flujo por FZI, que después se llevan al pozo como una pista de colores. Cargá los plugs en el panel Corona o usá los de ejemplo."
        actions={
          <>
            <Button variant="primary" icon="layers" onClick={() => useUi.getState().set({ dockTab: CORE_DOCK_ID })}>
              Ir a Corona
            </Button>
            <Button icon="play" onClick={loadExample} title="Plugs inventados para practicar sobre el pozo del TP: no son mediciones del pozo">
              Usar plugs de ejemplo
            </Button>
          </>
        }
      />
    );
  }
  const set = sets.find((s) => s.id === picked) ?? sets[0]!;
  const idBase = 'rtyp';
  return (
    <div className="rtyp">
      <RockBar set={set} sets={sets} onPick={setPicked} interp={interp} ctx={ctx} />
      <div className="rtyp-tabs">
        <Tabs
          size="sm"
          aria-label="Métodos de tipos de roca"
          idBase={idBase}
          value={tab}
          onChange={setTab}
          items={[
            { id: 'winland', label: 'Winland · Pittman' },
            { id: 'fzi', label: 'Unidades de flujo · FZI' },
            { id: 'pc', label: 'Presión capilar', badge: <Badge tone="warn">Ejemplo de libro</Badge> },
          ]}
        />
      </div>
      <TabPanel id="winland" idBase={idBase} active={tab === 'winland'} className="rtyp-panel">
        {tab === 'winland' && <WinlandTab set={set} interp={interp} ctx={ctx} />}
      </TabPanel>
      <TabPanel id="fzi" idBase={idBase} active={tab === 'fzi'} className="rtyp-panel">
        {tab === 'fzi' && <FziTab set={set} interp={interp} ctx={ctx} />}
      </TabPanel>
      <TabPanel id="pc" idBase={idBase} active={tab === 'pc'} className="rtyp-panel">
        {tab === 'pc' && <CapillaryTab set={set} well={well} interp={interp} />}
      </TabPanel>
    </div>
  );
}

function RockBar({ set, sets, onPick, interp, ctx }: { set: PointSet; sets: PointSet[]; onPick(id: string): void; interp: Interpretation; ctx: SeriesContext }) {
  const perm = ctx.computed.find((c) => c.active && c.port === 'PERM');
  const fromCore = permFromCore(interp);
  const kphiSet = permCoreParams(interp, null).set;
  const mp = rockModuleParams(interp.params);
  const useCore = () => {
    const w = activeWellId();
    if (w) useProject.getState().commit('Usar el modelo k–φ de corona como permeabilidad', (p) => setSource(p, w, 'PERM', { kind: 'module', moduleId: PERM_CORE_ID }));
  };
  return (
    <div className="rtyp-bar">
      <div className="rtyp-bar__set">
        {sets.length > 1 ? (
          <Select size="sm" aria-label="Conjunto de plugs" value={set.id} options={sets.map((s) => ({ value: s.id, label: s.name }))} onChange={onPick} />
        ) : (
          <span className="rtyp-bar__name">{set.name}</span>
        )}
        {set.synthetic && (
          <Badge tone="warn" icon="warning" title="Plugs inventados para practicar: no son mediciones del pozo">
            Ejemplo sintético
          </Badge>
        )}
      </div>
      <span className="rtyp-bar__item" title="Permeabilidad con la que se clasifica el perfil">
        {!perm ? (
          <Badge tone="warn" icon="warning">
            Sin permeabilidad en el pozo
          </Badge>
        ) : fromCore ? (
          <Badge tone="ok" icon="check">
            k del modelo k–φ de corona
          </Badge>
        ) : (
          <>
            <Badge tone="warn" icon="warning" title="Las clases del pozo usan esta permeabilidad: conviene la del modelo k–φ ajustado a los plugs">
              k de {perm.label.replace(/^Permeabilidad\s*[—–-]\s*/, '')}
            </Badge>{' '}
            {kphiSet ? (
              <button type="button" className="rtyp-link" onClick={useCore}>
                Usar el modelo k–φ de corona
              </button>
            ) : (
              <button type="button" className="rtyp-link" onClick={() => useUi.getState().set({ dockTab: CORE_DOCK_ID })}>
                Ajustar el k–φ en Corona
              </button>
            )}
          </>
        )}
      </span>
      <span className="shell-spacer" />
      <span className="rtyp-bar__hint num" title="Clasificación que usa la pista «Tipo de roca» del visor">
        En el pozo: {mp.method === 'winland' ? 'clases de garganta (Winland R35)' : `${mp.bounds.length + 1} unidades de flujo · FZI ${mp.bounds.map((b) => sig(b, 2)).join(' · ')} µm`}
      </span>
    </div>
  );
}

function NoPlugData({ plugs }: { plugs: RockPlugs }) {
  return (
    <p className="rtyp-empty">
      {!plugs.hasColumns
        ? 'Los plugs no tienen porosidad y permeabilidad: hacen falta las dos para clasificar la roca.'
        : 'Ningún plug incluido tiene porosidad entre 0 y 1 y permeabilidad positiva.'}
    </p>
  );
}

const setSetting = (set: PointSet, key: string, value: string | number | undefined, what: string) => {
  const w = activeWellId();
  if (w) useProject.getState().commit(what, (p) => setPointSetSetting(p, w, set.id, key, value));
};

// ── Winland / Pittman ──────────────────────────────────────────────────────────────────────────────────────

function WinlandTab({ set, interp, ctx }: { set: PointSet; interp: Interpretation; ctx: SeriesContext }) {
  const theme = useThemeTokens();
  const dec = interp.pointSets[set.id];
  const s = rockSettings(dec);
  const m = throatMethod(s.throat);
  const plugs = useMemo(() => rockPlugs(set, dec), [set, dec]);
  const radii = useMemo(() => plugThroatRadii(plugs, s.throat), [plugs, s.throat]);
  const cls = useMemo(() => portClasses(radii), [radii]);
  const counts = portClassCounts(cls);
  const phiLog = activeCurve(ctx, 'PHIE');
  const kLog = activeCurve(ctx, 'PERM');
  const cloud = useMemo(() => logCloud(phiLog, kLog), [phiLog, kLog]);
  const mp = rockModuleParams(interp.params);
  const nPort = PORT_CLASSES.length;
  const portColor = (c: number) => classColor(c, nPort, theme.name);

  const xr = niceRange([plugs.phi], 'linear', { zero: true, pad: 0.1 });
  const x: XYAxis = { kind: 'linear', min: 0, max: Math.min(0.5, Math.max(0.3, xr?.max ?? 0.3)), label: 'Porosidad φ', unit: 'v/v' };
  const yr = niceRange([plugs.k], 'log');
  const y: XYAxis = { kind: 'log', min: Math.min(0.01, yr?.min ?? 0.01), max: Math.max(10000, yr?.max ?? 10000), label: 'Permeabilidad k', unit: 'mD' };
  const isoColor = theme.color.textMuted;
  const lines: XYLineLayer[] = ISO_RADII.map((r) => ({
    id: `iso-${r}`,
    name: `${m.radius} ${sig(r)} µm`,
    ...throatIsoline(s.throat, r, 0.005, x.max),
    color: isoColor,
    width: 1,
    dash: [5, 4],
    label: `${sig(r)} µm`,
  }));
  const pts: XYPointLayer[] = [];
  if (cloud) pts.push({ id: 'log', name: 'Perfil (PHIE, PERM)', x: cloud.phi, y: cloud.k, color: theme.color.textMuted, cloud: true });
  if (plugs.idx.length) {
    pts.push({
      id: 'plugs',
      name: 'Plugs de corona',
      x: plugs.phi,
      y: plugs.k,
      color: (j) => ensureContrast(portColor(Math.max(0, cls[j]!)), theme.viewer.trackBg, 2.2),
      interactive: true,
      radius: 4.5,
      label: (j) =>
        [
          `${set.pointIds[plugs.idx[j]!]}`,
          `φ ${f3(plugs.phi[j])} · k ${sig(plugs.k[j])} mD`,
          `${m.radius} ${sig(radii[j])} µm · ${PORT_CLASSES[cls[j]!]?.label ?? 'sin clase'}`,
          'Clic: ver en el visor',
        ].join('\n'),
    });
  }
  const applied = mp.method === 'winland';
  const apply = () => {
    const w = activeWellId();
    if (!w) return;
    useProject.getState().commit('Llevar al pozo las clases de garganta', (p) => applyWinland(p, w));
    toast({ tone: 'ok', title: 'Clases de garganta en el pozo', description: 'La pista «Tipo de roca» clasifica cada muestra por su R35 de Winland con la porosidad y la permeabilidad del perfil.' });
  };

  return (
    <div className="rtyp-grid">
      <section className="rtyp-main" aria-label="Permeabilidad contra porosidad con isolíneas de radio de garganta">
        <div className="rtyp-controls">
          <SegmentedControl<ThroatMethod>
            size="sm"
            aria-label="Radio de garganta"
            value={s.throat}
            options={THROAT_METHODS.map((t) => ({ value: t.id, label: t.label }))}
            onChange={(v) => setSetting(set, RT_THROAT_SETTING, v === 'winland' ? undefined : v, 'Cambiar el radio de garganta')}
          />
        </div>
        {plugs.idx.length === 0 ? (
          <NoPlugData plugs={plugs} />
        ) : (
          <>
            <XYPlot
              height={250}
              className="rtyp-plot"
              figureId="rock-typing-winland"
              figureTitle={`Permeabilidad contra porosidad con isolíneas ${m.radius}`}
              data-testid="rtyp-winland-plot"
              ariaLabel={`Permeabilidad contra porosidad de ${plugs.idx.length} plugs, coloreados por clase de garganta ${m.radius}, con isolíneas de 0,1, 0,5, 2 y 10 micrones`}
              x={x}
              y={y}
              points={pts}
              lines={lines}
              onPointClick={(layer, j) => layer === 'plugs' && showInViewer(plugs.depth[j])}
            />
            <Legend items={[{ color: isoColor, label: `isolíneas ${m.radius} (µm)`, dash: true }, ...(cloud ? [{ color: theme.color.textMuted, label: 'perfil', dot: true }] : [])]} />
          </>
        )}
      </section>
      <aside className="rtyp-side" aria-label="Clases de garganta">
        <h3 className="rtyp-h">Clases de garganta · {m.radius}</h3>
        <ul className="rtyp-classes">
          {PORT_CLASSES.map((c, i) => (
            <li key={c.id} className="rtyp-class">
              <Swatch color={portColor(i)} />
              <span className="rtyp-class__name">{c.label}</span>
              <span className="rtyp-class__range num">{i === 0 ? `< ${sig(c.max)}` : i === nPort - 1 ? `> ${sig(c.min)}` : `${sig(c.min)}–${sig(c.max)}`} µm</span>
              <span className="rtyp-class__n num" title="Plugs en la clase">
                {counts[i]}
              </span>
            </li>
          ))}
        </ul>
        <p className="rtyp-note">
          El radio de garganta al {m.radius.slice(1)} % de saturación de mercurio separa rocas que fluyen distinto aunque tengan la misma porosidad.
          {s.throat !== 'winland' && ' En el pozo se clasifica siempre con el R35 de Winland.'}
        </p>
        {plugs.skipped > 0 && <p className="rtyp-warn">{plugs.skipped} plugs incluidos sin porosidad o permeabilidad válidas quedan afuera.</p>}
        <div className="rtyp-apply">
          <Button size="sm" variant={applied ? 'secondary' : 'primary'} icon="check" disabled={applied} onClick={apply} title="La pista «Tipo de roca» clasifica el perfil por clase de garganta (R35 de Winland)">
            {applied ? 'En el pozo' : 'Llevar al pozo'}
          </Button>
        </div>
      </aside>
    </div>
  );
}

// ── unidades de flujo ──────────────────────────────────────────────────────────────────────────────────────

function FziTab({ set, interp, ctx }: { set: PointSet; interp: Interpretation; ctx: SeriesContext }) {
  const theme = useThemeTokens();
  const dec = interp.pointSets[set.id];
  const s = rockSettings(dec);
  const plugs = useMemo(() => rockPlugs(set, dec), [set, dec]);
  const auto = useMemo(() => plugFlowUnits(plugs, { mode: 'auto', nUnits: s.nUnits, manualBounds: null }), [plugs, s.nUnits]);
  const fu = useMemo(() => (s.mode === 'manual' && s.manualBounds ? plugFlowUnits(plugs, s) : auto), [plugs, s, auto]);
  const rows = useMemo(() => (fu ? flowUnitRows(plugs, fu) : []), [plugs, fu]);
  const phiLog = activeCurve(ctx, 'PHIE');
  const kLog = activeCurve(ctx, 'PERM');
  const cloud = useMemo(() => {
    const c = logCloud(phiLog, kLog);
    return c ? { x: Float64Array.from(c.phi, normalizedPorosity), y: Float64Array.from(c.phi, (p, i) => reservoirQualityIndex(p, c.k[i]!)) } : null;
  }, [phiLog, kLog]);
  const nc = fu?.classes.length ?? 0;
  const color = (c: number) => classColor(c, nc, theme.name);
  const bounds = fu?.bounds ?? [];
  const toApply = boundsToApply(bounds);
  const applied = fu ? flowUnitsApplied(interp.params, bounds) : false;
  const fewer = fu && s.mode === 'auto' && nc < s.nUnits;

  const xr = niceRange([plugs.phiZ], 'log');
  const yr = niceRange([plugs.rqi], 'log');
  const x: XYAxis = { kind: 'log', min: Math.min(0.03, xr?.min ?? 0.03), max: Math.max(1, xr?.max ?? 1), label: 'Porosidad normalizada φz', unit: 'v/v' };
  const y: XYAxis = { kind: 'log', min: Math.min(0.01, yr?.min ?? 0.01), max: Math.max(10, yr?.max ?? 10), label: 'Índice de calidad RQI', unit: 'µm' };
  const lines: XYLineLayer[] = [];
  for (const b of bounds) lines.push({ id: `b-${b}`, name: `Límite FZI ${sig(b)} µm`, ...rqiLine(b, x.min, x.max), color: theme.color.textMuted, width: 1, dash: [2, 3] });
  for (const r of rows) {
    if (!Number.isFinite(r.fziMean)) continue;
    lines.push({ id: `uf-${r.index}`, name: `${r.label} · FZI ${sig(r.fziMean)} µm`, ...rqiLine(r.fziMean, x.min, x.max), color: ensureContrast(color(r.index), theme.viewer.trackBg, 2.2), width: 1.75, label: r.label });
  }
  const pts: XYPointLayer[] = [];
  if (cloud) pts.push({ id: 'log', name: 'Perfil (PHIE, PERM)', x: cloud.x, y: cloud.y, color: theme.color.textMuted, cloud: true });
  if (fu && plugs.idx.length) {
    pts.push({
      id: 'plugs',
      name: 'Plugs de corona',
      x: plugs.phiZ,
      y: plugs.rqi,
      color: (j) => ensureContrast(color(Math.max(0, fu.labels[j]!)), theme.viewer.trackBg, 2.2),
      interactive: true,
      radius: 4.5,
      label: (j) =>
        [
          `${set.pointIds[plugs.idx[j]!]} · UF ${fu.labels[j]! + 1}`,
          `φ ${f3(plugs.phi[j])} · k ${sig(plugs.k[j])} mD`,
          `FZI ${sig(plugs.fzi[j])} µm · RQI ${sig(plugs.rqi[j])} µm`,
          'Clic: ver en el visor',
        ].join('\n'),
    });
  }

  const setUnits = (n: number) => {
    const w = activeWellId();
    if (!w) return;
    // En manual, cambiar el número de unidades arranca de los límites automáticos con ese número.
    const next = plugFlowUnits(plugs, { mode: 'auto', nUnits: n, manualBounds: null });
    useProject.getState().commit('Cambiar el número de unidades de flujo', (p) => {
      let q = setPointSetSetting(p, w, set.id, RT_UNITS_SETTING, n);
      if (s.mode === 'manual' && next) q = setPointSetSetting(q, w, set.id, RT_BOUNDS_SETTING, encodeBounds(boundsToApply(next.bounds)));
      return q;
    });
  };
  const setMode = (mode: 'auto' | 'manual') => {
    const w = activeWellId();
    if (!w) return;
    useProject.getState().commit(mode === 'manual' ? 'Elegir límites de FZI a mano' : 'Límites de FZI automáticos', (p) => {
      let q = setPointSetSetting(p, w, set.id, RT_MODE_SETTING, mode === 'manual' ? 'manual' : undefined);
      if (mode === 'manual' && !s.manualBounds && auto) q = setPointSetSetting(q, w, set.id, RT_BOUNDS_SETTING, encodeBounds(boundsToApply(auto.bounds)));
      return q;
    });
  };
  const editBound = (i: number, v: number) => {
    const cur = s.manualBounds ?? boundsToApply(bounds);
    const next = boundsToApply([...cur.slice(0, i), roundBound(v), ...cur.slice(i + 1)].sort((a, b) => a - b));
    if (next.length !== cur.length) {
      toast({ tone: 'warn', title: 'Límite repetido', description: 'Dos límites de FZI no pueden ser iguales: elegí otro valor.' });
      return;
    }
    setSetting(set, RT_BOUNDS_SETTING, encodeBounds(next), 'Cambiar un límite de FZI');
  };
  const apply = () => {
    const w = activeWellId();
    if (!w || !fu) return;
    useProject.getState().commit(`Llevar al pozo ${toApply.length + 1} unidades de flujo`, (p) => applyFlowUnits(p, w, bounds));
    toast({
      tone: 'ok',
      title: `${toApply.length + 1} unidades de flujo en el pozo`,
      description: `Límites de FZI ${toApply.map((b) => sig(b)).join(' · ')} µm. La pista «Tipo de roca» clasifica cada muestra con la porosidad y la permeabilidad del perfil.${permFromCore(interp) ? '' : ' Ojo: la permeabilidad del perfil no es la del modelo k–φ de corona.'}`,
    });
  };

  const columns: Column<FlowUnitRow>[] = [
    {
      key: 'label',
      header: 'Unidad',
      render: (r) => (
        <span className="rtyp-cell">
          <Swatch color={color(r.index)} />
          {r.label}
        </span>
      ),
    },
    { key: 'range', header: 'FZI (µm)', align: 'num', render: (r) => (r.index === 0 ? `< ${sig(r.upper)}` : r.index === nc - 1 ? `> ${sig(r.lower)}` : `${sig(r.lower)}–${sig(r.upper)}`) },
    { key: 'n', header: 'Plugs', align: 'num' },
    { key: 'fzi', header: 'FZI medio', align: 'num', title: 'Media geométrica del FZI de los plugs (µm)', render: (r) => sig(r.fziMean) },
    { key: 'phi', header: 'φ', align: 'num', title: 'Mediana de la porosidad de los plugs (v/v)', render: (r) => f3(r.phi) },
    { key: 'k', header: 'k (mD)', align: 'num', title: 'Media geométrica de la permeabilidad de los plugs', render: (r) => sig(r.k) },
  ];

  return (
    <div className="rtyp-grid">
      <section className="rtyp-main" aria-label="Índice de calidad de reservorio contra porosidad normalizada">
        <div className="rtyp-controls">
          <SegmentedControl<'auto' | 'manual'>
            size="sm"
            aria-label="Límites de las unidades de flujo"
            value={s.mode}
            options={[
              { value: 'auto', label: 'Automático', title: 'Agrupa el log FZI de los plugs minimizando la dispersión dentro de cada unidad (Fisher–Jenks)' },
              { value: 'manual', label: 'Manual', title: 'Límites de FZI escritos a mano' },
            ]}
            onChange={setMode}
          />
          <label className="rtyp-field">
            <span>Unidades</span>
            <SegmentedControl<string>
              size="sm"
              aria-label="Número de unidades de flujo"
              value={String(s.mode === 'manual' && s.manualBounds ? s.manualBounds.length + 1 : s.nUnits)}
              options={Array.from({ length: MAX_FLOW_UNITS - MIN_FLOW_UNITS + 1 }, (_, i) => String(i + MIN_FLOW_UNITS)).map((v) => ({ value: v, label: v }))}
              onChange={(v) => setUnits(clampUnits(Number(v)))}
            />
          </label>
        </div>
        {plugs.idx.length === 0 || !fu ? (
          <NoPlugData plugs={plugs} />
        ) : (
          <>
            <XYPlot
              height={250}
              className="rtyp-plot"
              figureId="rock-typing-fzi"
              figureTitle="Índice de calidad de reservorio contra porosidad normalizada"
              data-testid="rtyp-fzi-plot"
              ariaLabel={`RQI contra φz de ${plugs.idx.length} plugs en ${nc} unidades de flujo, con una recta de pendiente 1 por unidad`}
              x={x}
              y={y}
              points={pts}
              lines={lines}
              onPointClick={(layer, j) => layer === 'plugs' && showInViewer(plugs.depth[j])}
            />
            <Legend items={[{ color: theme.color.textMuted, label: 'límites de FZI', dash: true }, ...(cloud ? [{ color: theme.color.textMuted, label: 'perfil', dot: true }] : [])]} />
          </>
        )}
      </section>
      <aside className="rtyp-side" aria-label="Unidades de flujo">
        <div className="rtyp-kpis">
          <div className="rtyp-kpi" title="Plugs incluidos con porosidad y permeabilidad válidas">
            <div className="rtyp-kpi__label">Plugs</div>
            <div className="rtyp-kpi__value num">{plugs.idx.length}</div>
          </div>
          <div className="rtyp-kpi" title="Bondad de la clasificación en log FZI: 1 = unidades sin dispersión interna">
            <div className="rtyp-kpi__label">GVF</div>
            <div className="rtyp-kpi__value num">{fu ? f2(fu.gvf) : '—'}</div>
          </div>
          <div className="rtyp-kpi" title="Unidades de flujo">
            <div className="rtyp-kpi__label">Unidades</div>
            <div className="rtyp-kpi__value num">{nc || '—'}</div>
          </div>
        </div>
        {s.mode === 'manual' && fu && (
          <div className="rtyp-bounds" role="group" aria-label="Límites de FZI">
            {(s.manualBounds ?? toApply).map((b, i) => (
              <label key={i} className="rtyp-field">
                <span className="num">
                  UF {i + 1} | {i + 2}
                </span>
                <NumberField size="sm" width={84} value={b} min={0.01} max={100} scale="log" unit="µm" aria-label={`Límite de FZI entre la unidad ${i + 1} y la ${i + 2}`} format={(v) => sig(v)} onChange={(v) => editBound(i, v)} />
              </label>
            ))}
          </div>
        )}
        {fu && <DataTable dense columns={columns} rows={rows} rowKey={(r) => String(r.index)} caption="Unidades de flujo de los plugs" data-testid="rtyp-units" />}
        {fewer && <p className="rtyp-warn">Hay menos valores distintos de FZI que unidades pedidas: se usan {nc}.</p>}
        {fu && rows.some((r) => r.n > 0 && r.phi < 0.05) && (
          <p className="rtyp-warn">Hay unidades con porosidad mediana menor que 0,05: en rocas muy cerradas el FZI se infla y puede sumarlas a una unidad de buena calidad. Revisá esos plugs en Corona.</p>
        )}
        {fu && rows.some((r) => r.n > 0 && r.n < 3) && <p className="rtyp-warn">Alguna unidad tiene menos de 3 plugs: su recta k–φ es poco confiable.</p>}
        {plugs.skipped > 0 && <p className="rtyp-warn">{plugs.skipped} plugs incluidos sin porosidad o permeabilidad válidas quedan afuera.</p>}
        <div className="rtyp-apply">
          <Button size="sm" variant={applied ? 'secondary' : 'primary'} icon="check" disabled={!fu || applied} onClick={apply} title="Escribe el método, el número de unidades y los límites de FZI en el módulo Tipos de roca del motor (un Ctrl+Z)">
            {applied ? 'En el pozo' : 'Llevar al pozo'}
          </Button>
        </div>
      </aside>
    </div>
  );
}

// ── presión capilar (ejemplo de libro) ─────────────────────────────────────────────────────────────────────

const DASHES: readonly (number[] | undefined)[] = [undefined, [6, 3], [2, 3], [8, 3, 2, 3]];

function CapillaryTab({ set, well, interp }: { set: PointSet; well: Well; interp: Interpretation }) {
  const theme = useThemeTokens();
  const dec = interp.pointSets[set.id];
  const s = rockSettings(dec);
  const plugs = useMemo(() => rockPlugs(set, dec), [set, dec]);
  const fu = useMemo(() => plugFlowUnits(plugs, s), [plugs, s]);
  // Límites para colorear: los de los plugs; sin plugs válidos, los que usa el pozo.
  const bounds = fu?.bounds ?? rockModuleParams(interp.params).bounds;
  const nc = bounds.length + 1;
  const { curves, book } = useMemo(() => capillaryCurves(well.pointSets), [well.pointSets]);
  const styled = useMemo(() => {
    const seen = new Map<number, number>();
    return curves.map((c) => {
      const uf = curveFlowUnit(c, bounds);
      const k = seen.get(uf) ?? 0;
      seen.set(uf, k + 1);
      const color = uf >= 0 ? ensureContrast(classColor(uf, nc, theme.name), theme.viewer.trackBg, 2.2) : theme.color.textMuted;
      return { c, uf, color, dash: DASHES[k % DASHES.length] };
    });
  }, [curves, bounds, nc, theme]);

  const pcLines: XYLineLayer[] = styled.map(({ c, color, dash }) => ({ id: c.id, name: c.label, x: c.sw, y: c.pc, color, width: 1.75, ...(dash ? { dash } : {}) }));
  const jLines: XYLineLayer[] = styled.map(({ c, color, dash }) => ({ id: c.id, name: c.label, x: c.sw, y: leverettCurve(c), color, width: 1.75, ...(dash ? { dash } : {}) }));
  const dist = styled.map(({ c, color, dash }) => ({ c, color, dash, d: curveThroats(c) }));
  const dLines: XYLineLayer[] = dist.map(({ c, color, dash, d }) => ({ id: c.id, name: c.label, x: d.radius, y: d.dSdLogR, color, width: 1.75, ...(dash ? { dash } : {}) }));

  const pcR = niceRange(curves.map((c) => c.pc), 'log');
  const jR = niceRange(jLines.map((l) => l.y), 'log');
  const dMax = Math.max(0.5, ...dist.flatMap(({ d }) => Array.from(d.dSdLogR)));
  const sw: XYAxis = { kind: 'linear', min: 0, max: 1, label: 'Sw', unit: 'v/v' };
  const portGuides: XYGuide[] = ISO_RADII.map((r) => ({ axis: 'x', value: r, color: theme.color.textMuted, width: 1, dash: [3, 3] }));
  const portLabel = PORT_CLASSES.map((c) => c.label.toLowerCase()).join(' · ');

  return (
    <div className="rtyp-pc">
      <Callout tone="warn" title={book ? 'Ejemplo de libro: no son datos del pozo' : 'Curvas Pc–Sw digitalizadas del pozo'}>
        {book
          ? 'No hay ensayos de presión capilar (MICP) de este pozo. Las curvas ilustran la función J de Leverett y la distribución de gargantas con cinco rocas de libro; cada una se colorea con la unidad de flujo en la que caería según su FZI.'
          : 'Curvas mercurio–aire cargadas con el pozo; cada una se colorea con la unidad de flujo de su FZI.'}
      </Callout>
      <div className="rtyp-pc__plots">
        <figure className="rtyp-pc__fig">
          <figcaption>Presión capilar (mercurio–aire)</figcaption>
          <XYPlot height={210} className="rtyp-plot" figureId="rock-typing-pc" figureTitle="Presión capilar mercurio–aire — ejemplo de libro" ariaLabel="Presión capilar contra saturación de agua de las curvas de ejemplo" x={sw} y={{ kind: 'log', min: Math.min(1, pcR?.min ?? 1), max: Math.min(10000, Math.max(1000, pcR?.max ?? 1000)), label: 'Pc', unit: 'psi' }} lines={pcLines} />
        </figure>
        <figure className="rtyp-pc__fig">
          <figcaption>Función J de Leverett</figcaption>
          <XYPlot height={210} className="rtyp-plot" figureId="rock-typing-j" figureTitle="Función J de Leverett — ejemplo de libro" ariaLabel="Función J de Leverett contra saturación de agua: las curvas de las distintas rocas se acercan al normalizar por la raíz de k sobre φ" x={sw} y={{ kind: 'log', min: Math.min(0.1, jR?.min ?? 0.1), max: Math.max(10, jR?.max ?? 10), label: 'J' }} lines={jLines} />
        </figure>
        <figure className="rtyp-pc__fig">
          <figcaption>Distribución de gargantas (Washburn)</figcaption>
          <XYPlot height={210} className="rtyp-plot" figureId="rock-typing-throats" figureTitle="Distribución de tamaño de gargantas — ejemplo de libro" ariaLabel={`Distribución del volumen poral por radio de garganta, con los límites de las clases ${portLabel}`} x={{ kind: 'log', min: 0.01, max: 100, label: 'Radio de garganta', unit: 'µm' }} y={{ kind: 'linear', min: 0, max: Math.ceil(dMax * 1.1 * 10) / 10, label: 'ΔSHg / Δlog r' }} lines={dLines} guides={portGuides} />
        </figure>
      </div>
      <div className="rtyp-pc__legend">
        {styled.map(({ c, uf, color, dash }) => (
          <span key={c.id} className="rtyp-legend__item" title={`k ${sig(c.k)} mD · φ ${f2(c.phi)}`}>
            <span className={`rtyp-legend__mark${dash ? ' is-dash' : ''}`} style={{ ['--mark' as string]: color }} aria-hidden="true" />
            {c.label} · FZI {sig(curveFzi(c), 2)} µm{uf >= 0 ? ` → UF ${uf + 1}` : ''}
          </span>
        ))}
      </div>
      <p className="rtyp-source">{book ? EXAMPLE_PC_SOURCE : 'Mercurio–aire (σ = 480 dyn/cm, θ = 140°).'}</p>
    </div>
  );
}

export const dockPanels: DockPanelDef[] = [
  {
    id: ROCK_DOCK_ID,
    title: 'Tipos de roca',
    icon: 'mountain',
    component: RockTypingPanel,
  },
];
