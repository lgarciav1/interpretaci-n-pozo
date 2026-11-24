/**
 * Panel «Análisis MICP» del dock: usos de las curvas de inyección de mercurio del pozo (cualquier conjunto `capillary`;
 * en el TP, las 8 de la hoja SCAL). Cuatro pestañas:
 *
 *   Ajustes y permeabilidad   Thomeer y Brooks–Corey por muestra, k de Swanson y de Thomeer contra la de la tabla y la
 *                             del plug; Bv contra Pc con la hipérbola ajustada.
 *   Altura sobre el agua libre  sistema y densidades del reservorio, FWL SUPUESTO; Sw contra altura por muestra y el
 *                             perfil en las zonas con muestras; altura de entrada.
 *   Permeabilidad relativa    Swirr a la altura de la columna, Brooks–Corey–Burdine, flujo fraccional y cutoff de Sw
 *                             (con su banda por μw/μo); «Usar Sw cutoff» escribe el parámetro del módulo de cutoffs.
 *   CMR                       BVI/PHIE del perfil a la profundidad de cada muestra contra la Sw de la curva a la presión
 *                             de calibración del corte de T2.
 *
 * Lógica pura en `./model.ts`; ajustes en `interpretation.moduleState['micp']` (cada cambio, un `commit`). Las ecuaciones
 * no se muestran (módulo Ecuaciones). Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { useMemo, useRef, useState } from 'react';
import type { Interpretation } from '../../core/interpretation';
import { activeWellEntry } from '../../core/state/project';
import type { Well } from '../../core/well';
import type { SeriesContext } from '../../plots/trend/series';
import { niceRange, type XYAxis } from '../../plots/xy/axes';
import type { XYGuide, XYLineLayer, XYPointLayer } from '../../plots/xy/layers';
import { XYPlot } from '../../plots/xy/XYPlot';
import { Badge, Button, Callout, DataTable, EmptyState, NumberField, SegmentedControl, Select, TabPanel, Tabs, formatNumber, toast, useThemeTokens, type Column } from '../../ui';
import { ensureContrast } from '../../ui/color';
import { CATEGORICAL } from '../../ui/curves';
import type { DockPanelDef } from '../../ui/dockPanel';
import { usePlotContext } from '../../app/plots/connect';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { importMicpCsvFile, loadTpMicp } from '../rock-typing/dock';
import {
  applySwCutoff,
  cmrConclusion,
  cmrRows,
  cutoffSummary,
  entryHeights,
  fitRows,
  gradientDensities,
  heightContext,
  heightCurve,
  logHeightPoints,
  measuredBv,
  MICP_DOCK_ID,
  MICP_ID,
  micpSamples,
  readMicpSettings,
  relpermCurves,
  relpermRows,
  RESERVOIR_SYSTEMS,
  roundCutoff,
  SW_CUTOFF_KEY,
  tableVsSwanson,
  thomeerCurve,
  VISCOSITY_RATIO_BAND,
  writeMicpSettings,
  zonesWithSamples,
  CMR_WINDOW_M,
  type CmrRow,
  type FitRow,
  type MicpSample,
  type MicpSettings,
  type RelpermRow,
  type ReservoirSystem,
} from './model';
import './micp.css';

const fx = (v: number | null | undefined, d = 2) => (v !== null && v !== undefined && Number.isFinite(v) ? formatNumber(v, { digits: d }) : 'n/d');
const sig = (v: number | null | undefined, s = 3) => (v !== null && v !== undefined && Number.isFinite(v) ? formatNumber(v, { significant: s }) : 'n/d');
const activeWellId = () => activeWellEntry(useProject.getState().project)?.well.id ?? null;

type TabId = 'fits' | 'height' | 'relperm' | 'cmr';
const TAB_KEY = 'micp.tab';
const TABS: readonly TabId[] = ['fits', 'height', 'relperm', 'cmr'];
function readTab(): TabId {
  try {
    const v = localStorage.getItem(TAB_KEY) as TabId | null;
    return v && TABS.includes(v) ? v : 'fits';
  } catch {
    return 'fits';
  }
}

/** Color de cada muestra (paleta categórica, el mismo en todas las pestañas). */
function useSampleColors(samples: readonly MicpSample[]): (i: number) => string {
  const theme = useThemeTokens();
  return useMemo(() => {
    const pal = CATEGORICAL[theme.name];
    const cs = samples.map((_, i) => ensureContrast(pal[i % pal.length]!, theme.viewer.trackBg, 2.6));
    return (i: number) => cs[i] ?? theme.color.textMuted;
  }, [samples, theme]);
}

/** Curva del pozo por rol, en v/v y alineada con la profundidad; null si no hay. */
function wellRoleCurve(well: Readonly<Well>, roles: readonly string[]): Float64Array | null {
  const n = well.depth.values.length;
  for (const role of roles) {
    const c = well.curves.find((x) => x.role === role && x.data.length === n);
    if (c) return c.unit === '%' ? Float64Array.from(c.data, (v) => v / 100) : c.data;
  }
  return null;
}

function activeCurve(ctx: SeriesContext | null, port: string): Float64Array | null {
  const n = ctx?.well.depth.values.length ?? 0;
  const c = ctx?.computed.find((x) => x.active && x.port === port);
  return c && c.data.length === n ? c.data : null;
}

function Legend({ samples, color, extra }: { samples: readonly MicpSample[]; color(i: number): string; extra?: { label: string; dash?: boolean; dot?: boolean }[] }) {
  const theme = useThemeTokens();
  return (
    <div className="micp-legend">
      {samples.map((s, i) => (
        <span key={s.id} className="micp-legend__item">
          <span className="micp-legend__mark" style={{ ['--mark' as string]: color(i) }} aria-hidden="true" />
          <span className="num">{s.label}</span>
        </span>
      ))}
      {extra?.map((e) => (
        <span key={e.label} className="micp-legend__item">
          <span className={`micp-legend__mark${e.dash ? ' is-dash' : ''}${e.dot ? ' is-dot' : ''}`} style={{ ['--mark' as string]: theme.color.textMuted }} aria-hidden="true" />
          {e.label}
        </span>
      ))}
    </div>
  );
}

const Swatch = ({ color }: { color: string }) => <span className="micp-swatch" style={{ ['--mark' as string]: color }} aria-hidden="true" />;

function setSettings(current: MicpSettings, patch: Partial<MicpSettings>, what: string) {
  const w = activeWellId();
  if (w) useProject.getState().commit(what, (p) => writeMicpSettings(p, w, current, patch));
}

// ── panel ──────────────────────────────────────────────────────────────────────────────────────────────────

export function MicpPanel() {
  const entry = useProject(selectActiveEntry);
  const ctx = usePlotContext();
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
  const samples = useMemo(() => (well ? micpSamples(well.pointSets) : []), [well]);
  const color = useSampleColors(samples);
  const csvInput = useRef<HTMLInputElement>(null);
  const onCsvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    void importMicpCsvFile(file, { show: false });
  };
  if (!entry || !well || !ctx) return <EmptyState size="sm" icon="activity" title="Sin pozo" description="Cargá un pozo y sus curvas de inyección de mercurio para analizarlas." />;
  if (samples.length === 0) {
    return (
      <>
        <input ref={csvInput} type="file" accept=".csv,.tsv,.txt" hidden onChange={onCsvChange} />
        <EmptyState
          size="sm"
          icon="activity"
          title="Sin curvas de inyección de mercurio"
          description="Este panel ajusta Thomeer y Brooks–Corey a cada curva, estima la permeabilidad, lleva la presión a altura sobre el agua libre, arma permeabilidades relativas con un cutoff de Sw y controla el agua ligada del CMR. El Excel del TP trae las curvas de 8 muestras en la hoja SCAL, o podés importar un CSV propio."
          actions={
            <>
              <Button variant="primary" icon="download" data-testid="micp-load" onClick={() => loadTpMicp({ show: false })}>
                Cargar curvas MICP del TP
              </Button>
              <Button variant="secondary" icon="upload" data-testid="micp-import-csv" onClick={() => csvInput.current?.click()} title="CSV o TSV con columnas pc y sw/shg (opcionales sample, k, phi y depth)">
                Importar CSV
              </Button>
            </>
          }
        />
      </>
    );
  }
  const interp = entry.interpretation;
  const settings = readMicpSettings(interp.moduleState?.[MICP_ID]);
  const tp = samples.some((s) => s.tp);
  const idBase = 'micp';
  return (
    <div className="micp" data-testid="micp-panel">
      <div className="micp-bar">
        <span className="micp-bar__name">{samples.length} curvas de inyección de mercurio</span>
        {tp && (
          <Badge tone="ok" icon="check-circle" title="Curvas medidas de la hoja SCAL del Excel de la cátedra">
            Datos del TP · hoja SCAL
          </Badge>
        )}
        <span className="shell-spacer" />
        <span className="micp-bar__hint">Mercurio–aire de laboratorio (σ 480 dyn/cm, θ 140°); presiones en psi</span>
      </div>
      <div className="micp-tabs">
        <Tabs
          size="sm"
          aria-label="Usos de las curvas MICP"
          idBase={idBase}
          value={tab}
          onChange={setTab}
          items={[
            { id: 'fits', label: 'Ajustes y permeabilidad' },
            { id: 'height', label: 'Altura sobre el agua libre' },
            { id: 'relperm', label: 'Permeabilidad relativa y cutoff' },
            { id: 'cmr', label: 'CMR' },
          ]}
        />
      </div>
      <TabPanel id="fits" idBase={idBase} active={tab === 'fits'} className="micp-panel">
        {tab === 'fits' && <FitsTab samples={samples} color={color} />}
      </TabPanel>
      <TabPanel id="height" idBase={idBase} active={tab === 'height'} className="micp-panel">
        {tab === 'height' && <HeightTab samples={samples} color={color} settings={settings} ctx={ctx} interp={interp} tp={tp} />}
      </TabPanel>
      <TabPanel id="relperm" idBase={idBase} active={tab === 'relperm'} className="micp-panel">
        {tab === 'relperm' && <RelpermTab samples={samples} color={color} settings={settings} interp={interp} />}
      </TabPanel>
      <TabPanel id="cmr" idBase={idBase} active={tab === 'cmr'} className="micp-panel">
        {tab === 'cmr' && <CmrTab samples={samples} color={color} settings={settings} ctx={ctx} />}
      </TabPanel>
    </div>
  );
}

// ── 1. ajustes y permeabilidad ────────────────────────────────────────────────────────────────────────────

function FitsTab({ samples, color }: { samples: MicpSample[]; color(i: number): string }) {
  const rows = useMemo(() => fitRows(samples), [samples]);
  const cmp = tableVsSwanson(rows);
  const tp = samples.some((s) => s.tp);
  const idx = (r: FitRow) => samples.indexOf(r.sample);
  const pts: XYPointLayer[] = samples.map((s, i) => ({
    id: `m-${s.id}`,
    name: `${s.label} medido`,
    x: s.pcPsi,
    y: measuredBv(s),
    color: color(i),
    radius: 2.75,
    interactive: true,
    label: (j) => `${s.label} · Pc ${sig(s.pcPsi[j])} psi · Bv ${fx(measuredBv(s)[j], 1)} %`,
  }));
  const lines: XYLineLayer[] = rows.flatMap((r) => {
    if (!r.thomeer) return [];
    const c = thomeerCurve(r.thomeer, r.sample.pcPsi.at(-1) ?? r.thomeer.pd * 100);
    return [{ id: `t-${r.sample.id}`, name: `${r.sample.label} Thomeer`, x: c.pc, y: c.bv, color: color(idx(r)), width: 1.75 }];
  });
  const pcR = niceRange(samples.map((s) => s.pcPsi), 'log');
  const bvMax = Math.max(10, ...samples.map((s) => s.phi * 100));
  const x: XYAxis = { kind: 'log', min: Math.max(0.1, pcR?.min ?? 0.1), max: Math.min(100000, pcR?.max ?? 10000), label: 'Pc mercurio–aire', unit: 'psi' };
  const y: XYAxis = { kind: 'linear', min: 0, max: Math.ceil(bvMax / 5) * 5, label: 'Bv', unit: '% del volumen total' };
  const columns: Column<FitRow>[] = [
    {
      key: 's',
      header: 'Muestra',
      render: (r) => (
        <span className="micp-cell">
          <Swatch color={color(idx(r))} />
          <span className="mono">{r.sample.label}</span>
        </span>
      ),
    },
    { key: 'pd', header: 'Pd (psi)', title: 'Presión de desplazamiento de Thomeer', align: 'num', render: (r) => sig(r.thomeer?.pd) },
    { key: 'g', header: 'G', title: 'Factor geométrico de poro de Thomeer', align: 'num', render: (r) => fx(r.thomeer?.g, 3) },
    { key: 'bv', header: 'Bv∞ (%)', title: 'Volumen de mercurio a presión infinita, % del volumen total', align: 'num', render: (r) => fx(r.thomeer?.bvInfPct, 1) },
    { key: 'r2', header: 'R²', title: 'Bondad del ajuste de Thomeer', align: 'num', render: (r) => fx(r.thomeer?.r2, 3) },
    { key: 'bcpd', header: 'Pd BC (psi)', title: 'Presión de desplazamiento de Brooks–Corey', align: 'num', render: (r) => sig(r.brooksCorey?.pd) },
    { key: 'l', header: 'λ', title: 'Índice de distribución de poros de Brooks–Corey', align: 'num', render: (r) => fx(r.brooksCorey?.lambda, 2) },
    { key: 'ksw', header: 'k Swanson', title: 'Permeabilidad al aire de Swanson (mD)', align: 'num', render: (r) => sig(r.kSwanson) },
    { key: 'kth', header: 'k Thomeer', title: 'Permeabilidad al aire de Thomeer (mD)', align: 'num', render: (r) => sig(r.kThomeer) },
    { key: 'kt', header: tp ? 'k SCAL' : 'k tabla', title: tp ? 'k de gas de la tabla de la hoja SCAL (mD)' : 'k del conjunto de curvas (mD)', align: 'num', render: (r) => sig(r.sample.kTable) },
    ...(tp ? [{ key: 'kp', header: 'k plug', title: 'k medida del plug del mismo número (hoja PB, mD)', align: 'num' as const, render: (r: FitRow) => <span title={r.sample.plugId ?? undefined}>{sig(r.sample.kPlug)}</span> }] : []),
  ];
  return (
    <div className="micp-body">
      {tp && cmp.within >= cmp.n / 2 && (
        <Callout tone="info" title="La k de la tabla SCAL no es una medición">
          Coincide con la de Swanson dentro del 0,7 % en {cmp.within} de {cmp.n} muestras: casi seguro se calculó con Swanson desde estas mismas curvas. La k medida es la de los plugs (hoja PB).
        </Callout>
      )}
      <DataTable dense columns={columns} rows={rows} rowKey={(r) => r.sample.id} caption="Ajustes de Thomeer y Brooks–Corey y permeabilidad por muestra" data-testid="micp-fits" />
      <div className="micp-split">
        <figure className="micp-fig">
          <figcaption>Volumen de mercurio contra presión · Thomeer</figcaption>
          <XYPlot height={260} figureId="micp-thomeer" figureTitle="Bv contra Pc con la hipérbola de Thomeer ajustada" ariaLabel={`Volumen de mercurio en % del volumen total contra presión capilar en escala log de ${samples.length} muestras, con la hipérbola de Thomeer ajustada a cada una`} x={x} y={y} points={pts} lines={lines} />
          <Legend samples={samples} color={color} extra={[{ label: 'medido', dot: true }, { label: 'Thomeer' }]} />
        </figure>
        <div className="micp-side">
          <p className="micp-note">Thomeer describe la curva con tres números: la presión de entrada (Pd), la forma de la distribución de gargantas (G: chico es una distribución angosta) y el volumen invadible a presión infinita (Bv∞). Brooks–Corey da la misma curva con Pd y λ.</p>
          <p className="micp-note">Swanson y Thomeer estiman la permeabilidad al aire desde la curva; las dos dispersan un factor 2 respecto de una medición. {tp ? 'La comparación honesta es contra la k del plug, medida en el laboratorio.' : ''}</p>
        </div>
      </div>
    </div>
  );
}

// ── 2. altura sobre el agua libre ─────────────────────────────────────────────────────────────────────────────

function FluidControls({ settings }: { settings: MicpSettings }) {
  const sys = RESERVOIR_SYSTEMS.find((r) => r.id === settings.system)!;
  const dRho = settings.rhoWater - settings.rhoHc;
  return (
    <>
      <label className="micp-field">
        <span>Sistema</span>
        <SegmentedControl<ReservoirSystem> size="sm" aria-label="Sistema del reservorio" value={settings.system} options={RESERVOIR_SYSTEMS.map((r) => ({ value: r.id, label: r.label, title: `${r.system.label}: σ ${r.system.sigmaDynPerCm} dyn/cm, θ ${r.system.thetaDeg}° (supuesto típico)` }))} onChange={(v) => setSettings(settings, { system: v }, 'Cambiar el sistema de fluidos del reservorio')} />
      </label>
      <label className="micp-field">
        <span>ρ agua</span>
        <NumberField size="sm" width={96} value={settings.rhoWater} min={0.9} max={1.3} step={0.01} unit="g/cm³" aria-label="Densidad del agua de formación" format={(v) => fx(v, 2)} onChange={(v) => setSettings(settings, { rhoWater: v }, 'Cambiar la densidad del agua')} />
      </label>
      <label className="micp-field">
        <span>ρ {sys.hcLabel}</span>
        <NumberField size="sm" width={96} value={settings.rhoHc} min={0.05} max={1.2} step={0.01} unit="g/cm³" aria-label={`Densidad del ${sys.hcLabel}`} format={(v) => fx(v, 2)} onChange={(v) => setSettings(settings, { rhoHc: v }, 'Cambiar la densidad del hidrocarburo')} />
      </label>
      <span className={`micp-field num${dRho > 0 ? '' : ' is-bad'}`} title="Contraste de densidades agua–hidrocarburo">
        Δρ {fx(dRho, 2)} g/cm³
      </span>
    </>
  );
}

function HeightTab({ samples, color, settings, ctx, interp, tp }: { samples: MicpSample[]; color(i: number): string; settings: MicpSettings; ctx: SeriesContext; interp: Interpretation; tp: boolean }) {
  const theme = useThemeTokens();
  const hctx = heightContext(settings);
  const ok = hctx.deltaRhoGcc > 0;
  const rows = useMemo(() => fitRows(samples), [samples]);
  const entries = ok ? entryHeights(rows, hctx) : rows.map(() => NaN);
  const curves = ok ? samples.map((s) => heightCurve(s, hctx)) : [];
  const sw = activeCurve(ctx, 'SW');
  const zones = zonesWithSamples(interp.zones, samples);
  const logPts = sw && settings.fwlM !== null ? logHeightPoints(ctx.well.depth.values, sw, zones, settings.fwlM) : null;
  const hLog = logPts && logPts.h.length ? Math.max(...logPts.h) : 0;
  const yMax = Math.min(500, Math.max(150, Math.ceil(hLog / 50) * 50));
  const lines: XYLineLayer[] = curves.map((c, i) => ({ id: samples[i]!.id, name: samples[i]!.label, x: c.sw, y: c.h, color: color(i), width: 1.75 }));
  const pts: XYPointLayer[] = logPts && logPts.h.length ? [{ id: 'log', name: 'Sw del perfil', x: logPts.sw, y: logPts.h, color: theme.color.textMuted, cloud: true }] : [];
  const dens = gradientDensities();
  const sysDef = RESERVOIR_SYSTEMS.find((r) => r.id === settings.system)!;
  const columns: Column<MicpSample>[] = [
    {
      key: 's',
      header: 'Muestra',
      render: (s) => (
        <span className="micp-cell">
          <Swatch color={color(samples.indexOf(s))} />
          <span className="mono">{s.label}</span>
        </span>
      ),
    },
    { key: 'z', header: 'Prof. (m)', align: 'num', render: (s) => fx(s.depthM, 1) },
    { key: 'pd', header: 'Pd (psi)', title: 'Presión de desplazamiento de Thomeer (mercurio–aire)', align: 'num', render: (s) => sig(rows[samples.indexOf(s)]?.thomeer?.pd) },
    { key: 'he', header: 'Entrada (m)', title: 'Columna mínima de hidrocarburo para que entre en la roca', align: 'num', render: (s) => fx(entries[samples.indexOf(s)], 1) },
    ...(settings.fwlM !== null ? [{ key: 'hf', header: 'Sobre el FWL (m)', title: 'Altura de la muestra sobre el FWL supuesto', align: 'num' as const, render: (s: MicpSample) => fx(settings.fwlM! - s.depthM, 1) }] : []),
  ];
  return (
    <div className="micp-body">
      <div className="micp-controls" role="group" aria-label="Fluidos del reservorio y nivel de agua libre">
        <FluidControls settings={settings} />
        <label className="micp-field">
          <span>FWL</span>
          <NumberField size="sm" width={104} value={settings.fwlM ?? NaN} min={0} max={20000} step={1} unit="m" aria-label="Profundidad supuesta del nivel de agua libre" format={(v) => fx(v, 1)} onCommit={(v) => setSettings(settings, { fwlM: v }, v === null ? 'Quitar el FWL supuesto' : 'Cambiar el FWL supuesto')} />
          <Badge tone="warn" title="Ningún dato del pozo fija el nivel de agua libre: es un supuesto del intérprete">
            Supuesto
          </Badge>
        </label>
      </div>
      <div className="micp-split">
        <figure className="micp-fig">
          <figcaption>Sw contra altura sobre el nivel de agua libre</figcaption>
          {ok ? (
            <XYPlot height={280} figureId="micp-height" figureTitle="Sw contra altura sobre el agua libre" ariaLabel={`Saturación de agua contra altura sobre el nivel de agua libre de ${samples.length} muestras${pts.length ? ', con la Sw del perfil en las zonas de las muestras' : ''}`} x={{ kind: 'linear', min: 0, max: 1, label: 'Sw', unit: 'v/v' }} y={{ kind: 'linear', min: 0, max: yMax, label: 'Altura sobre el FWL', unit: 'm' }} points={pts} lines={lines} />
          ) : (
            <p className="micp-warn">El agua tiene que ser más densa que el hidrocarburo: revisá las densidades.</p>
          )}
          <Legend samples={samples} color={color} extra={pts.length ? [{ label: `Sw del perfil (${zones.map((z) => z.name).join(', ')})`, dot: true }] : []} />
          {settings.fwlM === null ? (
            <p className="micp-note">Elegí un FWL supuesto para ubicar la Sw del perfil sobre las curvas.</p>
          ) : !sw ? (
            <p className="micp-note">El pozo todavía no tiene Sw calculada: las curvas se ven sin el perfil.</p>
          ) : null}
        </figure>
        <div className="micp-side">
          <DataTable dense columns={columns} rows={samples} rowKey={(s) => s.id} caption="Altura de entrada por muestra" data-testid="micp-entry" />
          {tp && (
            <p className="micp-note">
              Con los MDT del TP no se puede fijar el FWL: el gradiente de la zona B ({fx(dens[0]!.psiPerFt, 3)} psi/ft ≈ {fx(dens[0]!.densityGcc, 2)} g/cm³) puede ser crudo pesado o agua dulce, el de la zona D ({fx(dens[1]!.psiPerFt, 3)} psi/ft ≈ {fx(dens[1]!.densityGcc, 2)} g/cm³) no corresponde a ningún fluido y hay sobrepresión.
            </p>
          )}
          <p className="micp-note">
            Presión de laboratorio llevada al reservorio {sysDef.label.toLowerCase()} con σ {sysDef.system.sigmaDynPerCm} dyn/cm y θ {sysDef.system.thetaDeg}°: valores típicos, no medidos. Las curvas no se extrapolan más allá del último escalón; una altura negativa sobre el FWL es una muestra por debajo del nivel supuesto.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── 3. permeabilidad relativa y cutoff ────────────────────────────────────────────────────────────────────────

function RelpermTab({ samples, color, settings, interp }: { samples: MicpSample[]; color(i: number): string; settings: MicpSettings; interp: Interpretation }) {
  const theme = useThemeTokens();
  const [pick, setPick] = useState<string>('all');
  const hctx = heightContext(settings);
  const rows = useMemo(() => (hctx.deltaRhoGcc > 0 ? relpermRows(samples, settings, hctx) : []), [samples, settings, hctx.deltaRhoGcc]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = cutoffSummary(rows);
  const shown = rows.filter((r) => r.fit && (pick === 'all' || r.sample.id === pick));
  const idx = (r: RelpermRow) => samples.indexOf(r.sample);
  const kr: XYLineLayer[] = [];
  const fw: XYLineLayer[] = [];
  for (const r of shown) {
    const c = relpermCurves(r.fit!, settings.muWater, settings.muHc);
    kr.push({ id: `w-${r.sample.id}`, name: `${r.sample.label} krw`, x: c.sw, y: c.krw, color: color(idx(r)), width: 1.75 });
    kr.push({ id: `o-${r.sample.id}`, name: `${r.sample.label} kro`, x: c.sw, y: c.kro, color: color(idx(r)), width: 1.5, dash: [5, 3] });
    fw.push({ id: `f-${r.sample.id}`, name: `${r.sample.label} fw`, x: c.sw, y: c.fw, color: color(idx(r)), width: 1.75 });
  }
  const cutPts: XYPointLayer[] = [{ id: 'cut', name: 'Cutoff (fw = 0,5)', x: shown.map((r) => r.cutoff), y: shown.map(() => 0.5), color: (j) => color(idx(shown[j]!)), radius: 4, interactive: true, label: (j) => `${shown[j]!.sample.label} · cutoff Sw ${fx(shown[j]!.cutoff, 3)}` }];
  const guides: XYGuide[] = [{ axis: 'y', value: 0.5, color: theme.color.textMuted, width: 1, dash: [3, 3] }];
  const current = interp.params.global[SW_CUTOFF_KEY];
  const curVal = typeof current === 'number' ? current : 0.6;
  const target = summary ? roundCutoff(summary.median) : NaN;
  const inUse = Number.isFinite(target) && Math.abs(curVal - target) < 1e-9;
  const zoneOverrides = interp.zones.filter((z) => typeof interp.params.zones[z.id]?.[SW_CUTOFF_KEY] === 'number').map((z) => z.name);
  const apply = () => {
    const w = activeWellId();
    if (!w || !Number.isFinite(target)) return;
    useProject.getState().commit(`Usar Sw cutoff = ${fx(target, 2)}`, (p) => applySwCutoff(p, w, target));
    toast({
      tone: zoneOverrides.length ? 'warn' : 'ok',
      title: `Cutoff de Sw = ${fx(target, 2)} en el pozo`,
      description: zoneOverrides.length ? `Valor global actualizado. ${zoneOverrides.join(', ')} ${zoneOverrides.length === 1 ? 'tiene' : 'tienen'} un cutoff propio y no cambia${zoneOverrides.length === 1 ? '' : 'n'}.` : 'Mediana de las muestras. Ctrl+Z lo deshace.',
    });
  };
  const columns: Column<RelpermRow>[] = [
    {
      key: 's',
      header: 'Muestra',
      render: (r) => (
        <span className="micp-cell">
          <Swatch color={color(idx(r))} />
          <span className="mono">{r.sample.label}</span>
        </span>
      ),
    },
    { key: 'swirr', header: 'Swirr', title: `Sw de la curva a ${fx(settings.columnM, 0)} m sobre el agua libre`, align: 'num', render: (r) => fx(r.swirr, 3) },
    { key: 'l', header: 'λ', title: 'Brooks–Corey con ese Swirr fijo, hasta la presión de la columna', align: 'num', render: (r) => fx(r.fit?.lambda, 2) },
    { key: 'r2', header: 'R²', align: 'num', render: (r) => fx(r.fit?.r2, 3) },
    { key: 'cut', header: 'Cutoff Sw', title: 'Sw a la que fluye la mitad de agua (fw = 0,5)', align: 'num', render: (r) => <span className="micp-strong">{fx(r.cutoff, 3)}</span> },
    { key: 'band', header: `μw/μo ${fx(VISCOSITY_RATIO_BAND[0], 2)}–${fx(VISCOSITY_RATIO_BAND[1], 0)}`, title: 'Cutoff con μw/μo = 0,25 y = 2', align: 'num', render: (r) => (Number.isFinite(r.band[0]) ? `${fx(r.band[0], 2)}–${fx(r.band[1], 2)}` : 'n/d') },
  ];
  const noReach = rows.filter((r) => !Number.isFinite(r.swirr)).map((r) => r.sample.label);
  return (
    <div className="micp-body">
      <div className="micp-controls">
        <label className="micp-field">
          <span>Columna</span>
          <NumberField size="sm" width={88} value={settings.columnM} min={1} max={2000} step={5} unit="m" aria-label="Altura de la columna de hidrocarburo" format={(v) => fx(v, 0)} onChange={(v) => setSettings(settings, { columnM: v }, 'Cambiar la altura de la columna')} />
        </label>
        <label className="micp-field">
          <span>μ agua</span>
          <NumberField size="sm" width={88} value={settings.muWater} min={0.05} max={10} step={0.05} unit="cP" aria-label="Viscosidad del agua" format={(v) => fx(v, 2)} onChange={(v) => setSettings(settings, { muWater: v }, 'Cambiar la viscosidad del agua')} />
        </label>
        <label className="micp-field">
          <span>μ {RESERVOIR_SYSTEMS.find((r) => r.id === settings.system)!.hcLabel}</span>
          <NumberField size="sm" width={88} value={settings.muHc} min={0.01} max={1000} step={0.1} unit="cP" aria-label="Viscosidad del hidrocarburo" format={(v) => fx(v, 2)} onChange={(v) => setSettings(settings, { muHc: v }, 'Cambiar la viscosidad del hidrocarburo')} />
        </label>
        <label className="micp-field">
          <span>Muestra</span>
          <Select size="sm" aria-label="Muestra de los gráficos" value={pick} options={[{ value: 'all', label: 'Todas' }, ...samples.map((s) => ({ value: s.id, label: s.label }))]} onChange={setPick} />
        </label>
      </div>
      <div className="micp-plots">
        <figure className="micp-fig">
          <figcaption>Permeabilidad relativa (Brooks–Corey–Burdine)</figcaption>
          <XYPlot height={230} figureId="micp-kr" figureTitle="Permeabilidades relativas de Brooks–Corey–Burdine" ariaLabel="Permeabilidad relativa al agua y al hidrocarburo contra Sw de cada muestra" x={{ kind: 'linear', min: 0, max: 1, label: 'Sw', unit: 'v/v' }} y={{ kind: 'linear', min: 0, max: 1, label: 'kr' }} lines={kr} />
        </figure>
        <figure className="micp-fig">
          <figcaption>Flujo fraccional de agua</figcaption>
          <XYPlot height={230} figureId="micp-fw" figureTitle="Flujo fraccional de agua y cutoff de Sw" ariaLabel="Flujo fraccional de agua contra Sw de cada muestra, con el cutoff a fw igual a 0,5" x={{ kind: 'linear', min: 0, max: 1, label: 'Sw', unit: 'v/v' }} y={{ kind: 'linear', min: 0, max: 1, label: 'fw' }} lines={fw} points={cutPts} guides={guides} />
        </figure>
      </div>
      <Legend samples={shown.map((r) => r.sample)} color={(i) => color(idx(shown[i]!))} extra={[{ label: 'krw · fw' }, { label: 'kro', dash: true }]} />
      <div className="micp-split">
        <DataTable dense columns={columns} rows={rows} rowKey={(r) => r.sample.id} caption="Swirr, λ y cutoff de Sw por muestra" data-testid="micp-cutoffs" />
        <div className="micp-side">
          {summary ? (
            <div className="micp-kpis">
              <div className="micp-kpi">
                <div className="micp-kpi__label">Cutoff de Sw (mediana)</div>
                <div className="micp-kpi__value num" data-testid="micp-cutoff-median">
                  {fx(summary.median, 2)}
                </div>
              </div>
              <div className="micp-kpi">
                <div className="micp-kpi__label">Rango ({summary.n} muestras)</div>
                <div className="micp-kpi__value num">
                  {fx(summary.min, 2)}–{fx(summary.max, 2)}
                </div>
              </div>
            </div>
          ) : (
            <p className="micp-warn">Ninguna curva llega a la presión de esa columna: bajá la altura.</p>
          )}
          <p className="micp-note">
            El cutoff es la Sw a la que agua e hidrocarburo fluyen en partes iguales con la permeabilidad relativa de cada roca. Depende sobre todo del cociente de viscosidades: con μw/μo entre {fx(VISCOSITY_RATIO_BAND[0], 2)} y {fx(VISCOSITY_RATIO_BAND[1], 0)} se mueve lo que muestra la última columna.
            {noReach.length > 0 && ` ${noReach.join(', ')} no llega${noReach.length === 1 ? '' : 'n'} a la presión de la columna (sin Swirr).`}
          </p>
          <div className="micp-apply">
            <Button size="sm" variant={inUse ? 'secondary' : 'primary'} icon="check" disabled={!summary || inUse} onClick={apply} data-testid="micp-use-cutoff" title={`Escribe el cutoff de Sw global del módulo de cutoffs (hoy ${fx(curVal, 2)}); un Ctrl+Z`}>
              {inUse ? `Sw cutoff = ${fx(target, 2)} en uso` : `Usar Sw cutoff = ${fx(target, 2)}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 4. CMR ────────────────────────────────────────────────────────────────────────────────────────────────

function CmrTab({ samples, color, settings, ctx }: { samples: MicpSample[]; color(i: number): string; settings: MicpSettings; ctx: SeriesContext }) {
  const theme = useThemeTokens();
  const bvi = wellRoleCurve(ctx.well, ['BVI_NMR']);
  const phie = wellRoleCurve(ctx.well, ['PHIE_NMR']);
  const hctx = heightContext(settings);
  const rows = useMemo(() => (bvi && phie ? cmrRows(ctx.well.depth.values, bvi, phie, samples, hctx) : []), [bvi, phie, ctx.well.depth.values, samples, hctx.deltaRhoGcc, hctx.reservoir]); // eslint-disable-line react-hooks/exhaustive-deps
  const concl = cmrConclusion(rows);
  if (!bvi || !phie) {
    return (
      <div className="micp-body">
        <p className="micp-empty">El pozo no tiene BVI y porosidad efectiva del CMR (roles «Volumen de fluido irreducible RMN» y «Porosidad efectiva RMN»): asignalos en la carga para comparar.</p>
      </div>
    );
  }
  const ok = rows.filter((r) => Number.isFinite(r.swCal) && Number.isFinite(r.bviOverPhie));
  const idx = (r: CmrRow) => samples.indexOf(r.sample);
  const pts: XYPointLayer[] = [{ id: 'cmr', name: 'Muestras', x: ok.map((r) => r.swCal), y: ok.map((r) => r.bviOverPhie), color: (j) => color(idx(ok[j]!)), radius: 5, interactive: true, label: (j) => `${ok[j]!.sample.label} · BVI/PHIE ${fx(ok[j]!.bviOverPhie, 2)} · Sw calibración ${fx(ok[j]!.swCal, 2)}` }];
  const lines: XYLineLayer[] = [{ id: 'one', name: '1:1', x: [0, 1], y: [0, 1], color: theme.color.textMuted, width: 1, dash: [4, 3], label: '1:1' }];
  const columns: Column<CmrRow>[] = [
    {
      key: 's',
      header: 'Muestra',
      render: (r) => (
        <span className="micp-cell">
          <Swatch color={color(idx(r))} />
          <span className="mono">{r.sample.label}</span>
        </span>
      ),
    },
    { key: 'z', header: 'Prof. (m)', align: 'num', render: (r) => fx(r.sample.depthM, 1) },
    { key: 'b', header: 'BVI/PHIE', title: `Agua ligada del CMR: suma de BVI sobre suma de PHIE en ±${CMR_WINDOW_M} m`, align: 'num', render: (r) => fx(r.bviOverPhie, 2) },
    { key: 'n', header: 'n', title: 'Muestras del perfil en la ventana', align: 'num', render: (r) => r.nWindow || 'n/d' },
    { key: 'c', header: 'Sw calibración', title: 'Sw de la curva a 100 psi aire–salmuera (calibración estándar del corte de T2)', align: 'num', render: (r) => fx(r.swCal, 2) },
    { key: 'r', header: 'Cociente', title: 'BVI/PHIE ÷ Sw de calibración', align: 'num', render: (r) => <span className={r.ratio > 1.5 ? 'micp-strong' : undefined}>{fx(r.ratio, 1)}</span> },
    { key: 'h', header: 'Altura eq. (m)', title: 'Altura sobre el FWL a la que la curva tendría Sw = BVI/PHIE, con los fluidos de la pestaña de altura', align: 'num', render: (r) => fx(r.heightM, 1) },
  ];
  return (
    <div className="micp-body">
      {concl && (
        <Callout tone={concl.ratio[0] > 1.5 ? 'warn' : 'info'} title={concl.ratio[0] > 1.5 ? 'El corte de T2 sobreestima el agua ligada' : 'CMR y curvas capilares comparables'}>
          El CMR da BVI/PHIE de {fx(concl.cmr[0], 2)}–{fx(concl.cmr[1], 2)} a la profundidad de las muestras, contra {fx(concl.lab[0], 2)}–{fx(concl.lab[1], 2)} de laboratorio a la presión de calibración: entre {fx(concl.ratio[0], 1)} y {fx(concl.ratio[1], 1)} veces más ({concl.n} muestras).
          {concl.ratio[0] > 1.5 && ' Parte de lo que el CMR llama agua ligada es agua móvil por capilaridad: conviene recalibrar el corte de T2 con estas curvas.'}
        </Callout>
      )}
      <div className="micp-split">
        <figure className="micp-fig">
          <figcaption>Agua ligada del CMR contra la de la curva</figcaption>
          <XYPlot height={260} figureId="micp-cmr" figureTitle="BVI/PHIE del CMR contra Sw de la curva a la presión de calibración" ariaLabel="BVI sobre PHIE del CMR contra Sw de la curva capilar a 100 psi aire–salmuera, con la recta 1 a 1" x={{ kind: 'linear', min: 0, max: 1, label: 'Sw a la calibración del CMR', unit: 'v/v' }} y={{ kind: 'linear', min: 0, max: 1, label: 'BVI/PHIE del CMR', unit: 'v/v' }} points={pts} lines={lines} />
          <Legend samples={ok.map((r) => r.sample)} color={(i) => color(idx(ok[i]!))} extra={[{ label: '1:1', dash: true }]} />
        </figure>
        <div className="micp-side">
          <DataTable dense columns={columns} rows={rows} rowKey={(r) => r.sample.id} caption="BVI/PHIE del CMR y Sw de la curva por muestra" data-testid="micp-cmr" />
          <p className="micp-note">
            Ventana de ±{CMR_WINDOW_M} m alrededor de cada muestra (su profundidad tiene ±1 m de incertidumbre). La Sw de calibración es la de la curva a 100 psi aire–salmuera, unos 511 psi de mercurio; las curvas que no llegan quedan sin dato.
          </p>
        </div>
      </div>
    </div>
  );
}

export const dockPanels: DockPanelDef[] = [{ id: MICP_DOCK_ID, title: 'Análisis MICP', icon: 'activity', component: MicpPanel }];
