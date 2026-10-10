/**
 * Panel «Corona» del dock (docs/decisiones/0010-datos-de-corona.md, D7): plugs (incluir o descartar), puesta en
 * profundidad corona–perfil (desplazamiento por corona, sugerido por correlación con su curva r y «Usar sugerido") y
 * crossplot k–φ (gráfico x–y base de `src/plots/xy/`) con el modelo k–φ (una tendencia exponencial), su ecuación, R²
 * y «Aplicar al pozo» hacia el módulo del motor `perm-core`. Estado vacío con «Cargar plugs» y «Usar plugs de
 * ejemplo». Todo cambio va por `commit` (Ctrl+Z). Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { Interpretation } from '../../core/interpretation';
import { pointNumbers, pointTexts, shiftedDepth, shiftOf, type PointSet } from '../../core/pointSets';
import { removePointSet, setPointDecision, setPointSetDepthShift, setPointSetSetting } from '../../core/state/pointSets';
import { activeWellEntry, makeId } from '../../core/state/project';
import { addTrend, removeTrend, setTrendZone, updateTrend } from '../../core/state/trends';
import type { Well } from '../../core/well';
import { suggestDepthShift, type DepthShiftResult } from '../../petro/depthMatch';
import { pointsInRect, niceRange, type DataRect, type XYAxis } from '../../plots/xy/axes';
import { XYPlot, type XYPointLayer, type XYTrendLayer } from '../../plots/xy/XYPlot';
import { formatR2, trendEquation } from '../../plots/trend/format';
import { trendColor } from '../../plots/trend/overlay';
import type { ResolvedSeries } from '../../plots/trend/series';
import { Badge, Button, Callout, Checkbox, DataTable, EmptyState, IconButton, NumberField, Select, formatNumber, toast, useFlash, useThemeTokens, type Column } from '../../ui';
import { ensureContrast } from '../../ui/color';
import type { DockPanelDef } from '../../ui/dockPanel';
import { computedCurves } from '../../app/computed';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { useUi } from '../../app/store/ui';
import { resolveSeries } from '../../app/trends/providers';
import { useTrendsUi } from '../../app/trends/store';
import { addCoreExample, exampleCoreSet, kphiTrendSpec } from './example';
import { LoadCoreDialog } from './LoadCoreDialog';
import {
  applyKPhiModel,
  COL,
  CORE_DOCK_ID,
  CORE_REASON_LABEL,
  coreGroups,
  coreSets,
  DEFAULT_MATCH_CURVE,
  kphiSync,
  MATCH_CURVE_SETTING,
  permCoreIsSource,
  plugDecisionFor,
  plugStatuses,
  runColor,
  runLabel,
  type CoreGroup,
} from './model';
import { kphiSeries, kphiTrends, type KPhiTrend } from './series';
import '../../app/components/load-well.css';
import './core.css';

const m2 = (d: number) => formatNumber(d, { digits: 2 });
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${m2(Math.abs(v))}`;
const activeWellId = () => activeWellEntry(useProject.getState().project)?.well.id ?? null;

function Flash({ value, children }: { value: unknown; children: ReactNode }) {
  const flash = useFlash(value);
  return (
    <span className="ui-flash core-flash" data-flash={flash}>
      {children}
    </span>
  );
}

/** Curva del perfil para la correlación (rol `PHIE`/`PHIT` o `m:<curva>`), como serie del proveedor de curvas. */
function useLogSeries(well: Well | null, interp: Interpretation | null, key: string): ResolvedSeries | null {
  const result = useResults((s) => s.result);
  return useMemo(() => {
    if (!well || !interp) return null;
    const computed = computedCurves(result, well);
    const ref = { provider: 'curve', key: key.startsWith('m:') ? key : `r:${key}` };
    return resolveSeries({ well, interpretation: interp, computed }, ref);
  }, [well, interp, result, key]);
}

/** Carga el ejemplo sintético (con la PHIE calculada del pozo activo) y su modelo k–φ. */
function loadExample(): void {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) return;
  const computed = computedCurves(useResults.getState().result, entry.well);
  const phie = computed.find((c) => c.active && c.port === 'PHIE');
  const set = phie ? exampleCoreSet(makeId('corona'), { depth: entry.well.depth.values, phie: phie.data }) : null;
  if (!set) {
    toast({
      tone: 'warn',
      title: 'No se pudo armar el ejemplo',
      description: phie
        ? 'El ejemplo está pensado para el pozo del TP (7.633–8.518 m): en este pozo no hay porosidad efectiva en los tramos de las coronas.'
        : 'Hace falta la porosidad efectiva (PHIE) calculada: esperá a que termine el cálculo o revisá los pasos de porosidad.',
    });
    return;
  }
  useProject.getState().commit('Usar plugs de ejemplo', (p) => addCoreExample(p, entry.well.id, set, makeId('tend')));
  toast({
    tone: 'ok',
    title: 'Plugs de ejemplo cargados (sintéticos)',
    description: `No son mediciones del pozo: ${set.pointIds.length} plugs inventados en dos coronas, corridas en profundidad respecto del perfil. Ponelas en profundidad con «Usar sugerido» o arrastrándolas en el visor.`,
  });
  useTrendsUi.getState().requestRange(7978, 8016);
  useUi.getState().set({ dockTab: CORE_DOCK_ID });
}

export function CorePanel() {
  const entry = useProject(selectActiveEntry);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const well = entry?.well ?? null;
  const interp = entry?.interpretation ?? null;
  const dialog = loading && <LoadCoreDialog onClose={() => setLoading(false)} onExample={loadExample} />;
  if (!entry || !well || !interp) {
    return <EmptyState size="sm" icon="layers" title="Sin pozo" description="Cargá un pozo para sumarle los datos de corona." />;
  }
  const sets = coreSets(well.pointSets);
  if (sets.length === 0) {
    return (
      <>
        <EmptyState
          size="sm"
          icon="layers"
          title="Sin datos de corona"
          description="Cargá la tabla de plugs (profundidad, porosidad, permeabilidad y densidad de grano; Excel, CSV o LAS) para ponerlos en profundidad contra el perfil, verlos sobre las pistas y ajustar el modelo k–φ que se aplica a todo el pozo."
          actions={
            <>
              <Button variant="primary" icon="upload" onClick={() => setLoading(true)}>
                Cargar plugs
              </Button>
              <Button icon="play" onClick={loadExample} title="Plugs inventados para practicar sobre el pozo del TP: no son mediciones del pozo">
                Usar plugs de ejemplo
              </Button>
            </>
          }
        />
        {dialog}
      </>
    );
  }
  const set = sets.find((s) => s.id === picked) ?? sets[0]!;
  return (
    <div className="core">
      <CoreBar set={set} sets={sets} onPick={setPicked} onLoad={() => setLoading(true)} />
      <div className="core-body">
        <PlugsTable set={set} interp={interp} selected={selected} onSelect={setSelected} />
        <DepthMatch set={set} well={well} interp={interp} />
        <KPhiSection set={set} well={well} interp={interp} />
      </div>
      {dialog}
    </div>
  );
}

// ── barra ──────────────────────────────────────────────────────────────────────────────────────────────────

function CoreBar({ set, sets, onPick, onLoad }: { set: PointSet; sets: PointSet[]; onPick(id: string): void; onLoad(): void }) {
  return (
    <div className="core-bar">
      <div className="core-bar__set">
        {sets.length > 1 ? (
          <Select size="sm" aria-label="Conjunto de plugs" value={set.id} options={sets.map((s) => ({ value: s.id, label: s.name }))} onChange={onPick} />
        ) : (
          <span className="core-bar__name" title={set.source ? `Archivo: ${set.source}` : undefined}>
            {set.name}
          </span>
        )}
        {set.synthetic && (
          <Badge tone="warn" icon="warning" title="Plugs inventados para practicar: no son mediciones del pozo">
            Ejemplo sintético
          </Badge>
        )}
      </div>
      <span className="core-bar__hint">En el visor: clic en un plug lo descarta o lo incluye · arrastrarlo arriba o abajo mueve su corona</span>
      <span className="shell-spacer" />
      <IconButton size="sm" icon="upload" label="Cargar otra tabla de plugs" onClick={onLoad} />
      <IconButton
        size="sm"
        icon="trash"
        label={`Borrar «${set.name}» y su modelo k–φ`}
        onClick={() => {
          const w = activeWellId();
          // La receta del núcleo borra también las tendencias de la serie `<conjunto>:kphi`.
          if (w) useProject.getState().commit('Borrar plugs', (p) => removePointSet(p, w, set.id));
        }}
      />
    </div>
  );
}

// ── tabla de plugs ─────────────────────────────────────────────────────────────────────────────────────────

function togglePlug(set: PointSet, pid: string, include: boolean): void {
  const w = activeWellId();
  if (!w) return;
  useProject.getState().commit(include ? 'Incluir plug' : 'Descartar plug', (proj) => {
    const e = proj.wells.find((x) => x.well.id === w);
    const cur = e?.well.pointSets.find((s) => s.id === set.id);
    if (!e || !cur) return proj;
    const q = plugStatuses(cur, e.interpretation.pointSets[cur.id])[cur.pointIds.indexOf(pid)];
    if (!q || q.included === include) return proj;
    return setPointDecision(proj, w, cur.id, pid, plugDecisionFor(q.quality, include));
  });
}

function PlugsTable({ set, interp, selected, onSelect }: { set: PointSet; interp: Interpretation; selected: string | null; onSelect(id: string | null): void }) {
  const theme = useThemeTokens();
  const dec = interp.pointSets[set.id];
  const st = plugStatuses(set, dec);
  const z = shiftedDepth(set, dec);
  const phi = pointNumbers(set, COL.phi);
  const k = pointNumbers(set, COL.k);
  const rhog = pointNumbers(set, COL.rhog);
  const runs = pointTexts(set, COL.run);
  const desc = pointTexts(set, COL.description);
  const rows = set.pointIds.map((id, i) => ({ id, i }));
  const columns: Column<{ id: string; i: number }>[] = [
    {
      key: 'inc',
      header: <span className="ui-visually-hidden">Incluido</span>,
      width: 34,
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()} className="core-check">
          <Checkbox checked={st[r.i]!.included} aria-label={st[r.i]!.included ? `Descartar ${r.id}` : `Incluir ${r.id}`} onChange={(on) => togglePlug(set, r.id, on)} />
        </span>
      ),
    },
    {
      key: 'id',
      header: 'Plug',
      render: (r) => (
        <span className="core-id">
          <span className="core-dot" style={{ background: ensureContrast(runColor(set, runs?.[r.i], theme.name), theme.color.surface, 3) }} aria-hidden="true" />
          <span className="mono">{r.id}</span>
          {st[r.i]!.decided && <span className="core-manual">a mano</span>}
        </span>
      ),
    },
    { key: 'z', header: 'Prof. (m)', title: 'Profundidad corregida (archivo + puesta en profundidad)', align: 'num', render: (r) => m2(z[r.i]!) },
    { key: 'phi', header: 'φ', title: 'Porosidad (v/v)', align: 'num', render: (r) => formatNumber(phi?.[r.i], { digits: 3 }) },
    { key: 'k', header: 'k (mD)', title: 'Permeabilidad', align: 'num', render: (r) => formatNumber(k?.[r.i], { significant: 3 }) },
    ...(rhog ? [{ key: 'g', header: 'ρg', title: 'Densidad de grano (g/cm³)', align: 'num' as const, render: (r: { i: number }) => formatNumber(rhog[r.i], { digits: 2 }) }] : []),
    {
      key: 'q',
      header: 'Calidad',
      render: (r) => {
        const s = st[r.i]!;
        const reasons = s.quality.reasons;
        const title = [desc?.[r.i], reasons.length ? `Regla automática: ${reasons.map((x) => CORE_REASON_LABEL[x]).join(', ')}. ${s.included ? 'Lo incluiste a mano.' : 'Por eso se propone descartarlo.'}` : null].filter(Boolean).join('\n');
        return reasons.length === 0 ? (
          <span className="ui-text-muted core-desc" title={title || undefined}>
            {desc?.[r.i] || '—'}
          </span>
        ) : (
          <span title={title}>
            <Badge tone={s.included ? 'warn' : 'neutral'} variant="outline">
              {CORE_REASON_LABEL[reasons[0]!]}
            </Badge>
          </span>
        );
      },
    },
  ];
  const included = st.filter((x) => x.included).length;
  return (
    <section className="core-col core-plugs" aria-label="Plugs">
      <header className="core-col__head">
        <h3>Plugs</h3>
        <span className="num">
          {set.pointIds.length} · <span className="core-strong">{included} incluidos</span> · {set.pointIds.length - included} descartados
        </span>
      </header>
      <DataTable
        dense
        data-testid="core-plugs"
        caption="Plugs de corona"
        rows={rows}
        rowKey={(r) => r.id}
        selectedKey={selected}
        onRowClick={(r) => {
          onSelect(r.id === selected ? null : r.id);
          useTrendsUi.getState().requestRange(z[r.i]! - 12, z[r.i]! + 12);
        }}
        rowProps={(r) => ({ 'data-excluded': st[r.i]!.included ? undefined : '' })}
        columns={columns}
      />
    </section>
  );
}

// ── puesta en profundidad ──────────────────────────────────────────────────────────────────────────────────

function setGroupShift(set: PointSet, g: CoreGroup, value: number | undefined): void {
  const w = activeWellId();
  if (!w) return;
  const what = g.run ? runLabel(g.run).toLowerCase() : 'corona';
  useProject.getState().commit(`Poner en profundidad la ${what}`, (p) => setPointSetDepthShift(p, w, set.id, value === undefined ? undefined : Math.round(value * 100) / 100, g.run ?? undefined));
}

function matchOptions(well: Well): { value: string; label: string }[] {
  const out = [
    { value: 'PHIE', label: 'PHIE · porosidad efectiva' },
    { value: 'PHIT', label: 'PHIT · porosidad total' },
  ];
  for (const c of well.curves) if (c.role === 'PHIE_NMR' || c.role === 'PHIT_NMR' || c.role === 'NPHI') out.push({ value: `m:${c.id}`, label: `${c.mnemonic} · medida` });
  return out;
}

function DepthMatch({ set, well, interp }: { set: PointSet; well: Well; interp: Interpretation }) {
  const dec = interp.pointSets[set.id];
  const curveKey = typeof dec?.settings?.[MATCH_CURVE_SETTING] === 'string' ? (dec.settings[MATCH_CURVE_SETTING] as string) : DEFAULT_MATCH_CURVE;
  const log = useLogSeries(well, interp, curveKey);
  const groups = useMemo(() => coreGroups(set), [set]);
  const st = plugStatuses(set, dec);
  const phi = pointNumbers(set, COL.phi);
  // Sugerencia por corona: φ de los plugs incluidos (profundidad del ARCHIVO) contra la curva del perfil.
  const suggestions = useMemo(
    () =>
      groups.map((g) => {
        if (!log || !phi) return null;
        const idx = g.indices.filter((i) => st[i]!.included);
        return suggestDepthShift(
          idx.map((i) => set.depth[i]!),
          idx.map((i) => phi[i]!),
          log.x,
          log.y,
          { maxShift: 6, step: 0.05 },
        );
      }),
    [groups, log, phi, st, set],
  );
  return (
    <section className="core-col core-match" aria-label="Puesta en profundidad">
      <header className="core-col__head">
        <h3>Puesta en profundidad</h3>
        <label className="core-field">
          <span>Correlacionar φ con</span>
          <Select
            size="sm"
            aria-label="Curva del perfil para correlacionar la porosidad de los plugs"
            value={curveKey}
            options={matchOptions(well)}
            onChange={(v) => {
              const w = activeWellId();
              if (w) useProject.getState().commit('Cambiar la curva de correlación', (p) => setPointSetSetting(p, w, set.id, MATCH_CURVE_SETTING, v === DEFAULT_MATCH_CURVE ? undefined : v));
            }}
          />
        </label>
      </header>
      {!phi ? (
        <p className="core-empty">Los plugs no tienen porosidad: la puesta en profundidad se hace solo arrastrándolos en el visor.</p>
      ) : !log ? (
        <p className="core-empty">Todavía no hay {curveKey} en el pozo (se está calculando o falta algún paso): elegí otra curva o arrastrá los plugs en el visor.</p>
      ) : null}
      <ul className="core-groups">
        {groups.map((g, k) => (
          <GroupCard key={g.run ?? ''} set={set} group={g} shift={shiftOf(dec, g.run)} s={suggestions[k] ?? null} />
        ))}
      </ul>
    </section>
  );
}

function GroupCard({ set, group, shift, s }: { set: PointSet; group: CoreGroup; shift: number; s: DepthShiftResult | null }) {
  const theme = useThemeTokens();
  const color = ensureContrast(runColor(set, group.run, theme.name), theme.color.surface, 3);
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of group.indices) {
    lo = Math.min(lo, set.depth[i]!);
    hi = Math.max(hi, set.depth[i]!);
  }
  const best = s?.best ?? null;
  const same = best !== null && Math.abs(best - shift) < 0.005;
  const rCurve = useMemo(() => {
    if (!s) return null;
    const rs = Array.from(s.rs).filter(Number.isFinite);
    const rMin = rs.length ? Math.min(...rs) : -1;
    return {
      x: { kind: 'linear', min: s.shifts[0]!, max: s.shifts[s.shifts.length - 1]!, label: 'Desplazamiento', unit: 'm' } as XYAxis,
      y: { kind: 'linear', min: Math.max(-1, Math.floor(rMin * 5) / 5), max: 1, label: 'r' } as XYAxis,
    };
  }, [s]);
  return (
    <li className="core-group" style={{ ['--run' as string]: color }}>
      <div className="core-group__head">
        <span className="core-group__name">{group.label}</span>
        <span className="shell-spacer" />
        <IconButton size="sm" icon="fit-height" label="Ver en el visor" onClick={() => useTrendsUi.getState().requestRange(lo + shift - 8, hi + shift + 8)} />
      </div>
      <div className="ui-text-muted num core-group__meta">
        {group.indices.length} plugs · archivo {m2(lo)}–{m2(hi)} m
        {shift !== 0 && ` → ${m2(lo + shift)}–${m2(hi + shift)} m`}
      </div>
      <div className="core-group__row">
        <label className="core-field">
          <span>Desplazamiento</span>
          <NumberField
            size="sm"
            width={96}
            aria-label={`Puesta en profundidad de ${group.label} (m, se suma a la profundidad del archivo)`}
            value={shift}
            min={-50}
            max={50}
            step={0.05}
            unit="m"
            format={(v) => signed(v)}
            onChange={(v) => setGroupShift(set, group, v)}
          />
        </label>
        {best !== null && (
          <span className="core-suggest num" title={`Máxima correlación de Pearson entre la φ de los plugs y la curva del perfil (${s!.n} plugs)`}>
            Sugerido{' '}
            <strong>
              <Flash value={best}>{signed(best)} m</Flash>
            </strong>{' '}
            <span className="ui-text-muted">· r {formatNumber(s!.r, { digits: 2 })}</span>
          </span>
        )}
        <Button size="sm" variant={same ? 'secondary' : 'primary'} disabled={best === null || same} onClick={() => best !== null && setGroupShift(set, group, best)}>
          {same ? 'En el sugerido' : 'Usar sugerido'}
        </Button>
      </div>
      {s && rCurve && (
        <XYPlot
          compact
          height={88}
          className="core-rcurve"
          ariaLabel={`Correlación según el desplazamiento de ${group.label}: máximo en ${best !== null ? signed(best) : '—'} m`}
          x={rCurve.x}
          y={rCurve.y}
          lines={[{ id: 'r', x: s.shifts, y: s.rs, color: theme.color.textMuted, width: 1.5 }]}
          guides={[
            ...(best !== null ? [{ axis: 'x' as const, value: best, color: theme.color.accent, dash: [3, 3] }] : []),
            { axis: 'x' as const, value: shift, color, dash: [], width: 2 },
          ]}
        />
      )}
      {s?.warnings.map((w) => (
        <p key={w} className="core-warn">
          {w}
        </p>
      ))}
    </li>
  );
}

// ── crossplot k–φ y modelo ─────────────────────────────────────────────────────────────────────────────────

function KPhiSection({ set, well, interp }: { set: PointSet; well: Well; interp: Interpretation }) {
  const theme = useThemeTokens();
  const result = useResults((s) => s.result);
  const [showLog, setShowLog] = useState(true);
  const trends = kphiTrends(set, interp);
  const main = trends[0] ?? null;
  const dec = interp.pointSets[set.id];
  const st = plugStatuses(set, dec);
  const phi = pointNumbers(set, COL.phi);
  const k = pointNumbers(set, COL.k);
  const runs = pointTexts(set, COL.run);
  const series = kphiSeries(set, interp);
  const computed = computedCurves(result, well);
  const logPhi = computed.find((c) => c.active && c.port === 'PHIE')?.data;
  const logK = computed.find((c) => c.active && c.port === 'PERM')?.data;

  // Nube del perfil (PHIE vs PERM activa), reducida a ≤ 3000 puntos.
  const cloud = useMemo(() => {
    if (!logPhi || !logK) return null;
    const stepI = Math.max(1, Math.ceil(logPhi.length / 3000));
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < logPhi.length; i += stepI) {
      if (Number.isFinite(logPhi[i]!) && logK[i]! > 0) {
        xs.push(logPhi[i]!);
        ys.push(logK[i]!);
      }
    }
    return { x: Float64Array.from(xs), y: Float64Array.from(ys) };
  }, [logPhi, logK]);

  // Ejes según los plugs INCLUIDOS (un plug descartado con φ = 0,47 o k ×200 no estira la escala; queda afuera).
  const axes = useMemo(() => {
    const inc = (v: Float64Array | null) => (v ? v.filter((_, i) => st[i]!.included) : new Float64Array());
    const xr = niceRange([inc(phi).filter((v) => v >= 0 && v <= 0.45)], 'linear', { zero: true, pad: 0.1 }) ?? { min: 0, max: 0.3 };
    const yr = niceRange([inc(k)], 'log') ?? { min: 0.1, max: 1000 };
    // Al menos cuatro décadas, con una de aire abajo y arriba si hay pocas.
    let lo = yr.min;
    let hi = yr.max;
    if (Math.log10(hi / lo) < 4) {
      lo /= 10;
      hi *= 10;
    }
    return {
      x: { kind: 'linear', min: 0, max: Math.max(0.1, xr.max), label: 'Porosidad φ', unit: 'v/v' } as XYAxis,
      y: { kind: 'log', min: lo, max: hi, label: 'Permeabilidad k', unit: 'mD' } as XYAxis,
    };
  }, [phi, k, st]);

  const idsWithData = useMemo(() => (phi && k ? set.pointIds.map((_, i) => i).filter((i) => Number.isFinite(phi[i]!) && Number.isFinite(k[i]!)) : []), [set, phi, k]);
  const points: XYPointLayer[] = [];
  if (cloud && showLog) points.push({ id: 'log', x: cloud.x, y: cloud.y, color: theme.color.textMuted, cloud: true });
  if (phi && k) {
    const z = shiftedDepth(set, dec);
    points.push({
      id: 'plugs',
      x: Float64Array.from(idsWithData, (i) => phi[i]!),
      y: Float64Array.from(idsWithData, (i) => k[i]!),
      color: (j) => ensureContrast(runColor(set, runs?.[idsWithData[j]!], theme.name), theme.viewer.trackBg, 3),
      variant: (j) => {
        const i = idsWithData[j]!;
        if (!st[i]!.included) return 'crossed';
        return main?.spec.selection.excluded.includes(set.pointIds[i]!) ? 'hollow' : 'filled';
      },
      interactive: true,
      radius: 4.5,
      label: (j) => {
        const i = idsWithData[j]!;
        const s = st[i]!;
        const excludedFromFit = s.included && main?.spec.selection.excluded.includes(set.pointIds[i]!);
        return [
          `${set.pointIds[i]} · ${runLabel(runs?.[i] || null)} · ${m2(z[i]!)} m`,
          `φ ${formatNumber(phi[i], { digits: 3 })} · k ${formatNumber(k[i], { significant: 3 })} mD`,
          s.quality.reasons.length ? `Propuesta: descartar (${s.quality.reasons.map((r) => CORE_REASON_LABEL[r]).join(', ')})` : null,
          !s.included ? 'Descartado · clic para incluirlo' : excludedFromFit ? 'Fuera del ajuste (elegido por rectángulo) · clic para descartarlo' : 'Clic para descartarlo',
        ]
          .filter(Boolean)
          .join('\n');
      },
    });
  }
  const trendLayers: XYTrendLayer[] = trends
    .filter((t) => t.spec.visible && t.result?.coeffs && t.result.span)
    .map((t) => ({
      id: t.spec.id,
      coeffs: t.result!.coeffs!,
      span: t.result!.span!,
      color: trendColor(t.spec, t.index, theme),
      extend: t.spec.extend,
      emphasis: t === main,
      label: [trendEquation(t.result!, t.series), `R² ${formatR2(t.result!.r2)} · n ${t.result!.n}`] as const,
    }));

  const onRect = (r: DataRect) => {
    if (!series) return;
    const w = activeWellId();
    if (!w) return;
    const inside = new Set(pointsInRect(r, series.x, series.y));
    const excluded: string[] = [];
    for (let j = 0; j < series.x.length; j++) if (!inside.has(j)) excluded.push(series.pointKey(j));
    if (inside.size < 2) {
      toast({ tone: 'warn', title: 'Elegí al menos dos plugs', description: 'El rectángulo tiene que encerrar los plugs con los que querés ajustar el modelo.' });
      return;
    }
    useProject.getState().commit('Ajustar con los plugs del rectángulo', (p) => {
      const t = main?.spec;
      if (!t) return addTrend(p, w, { ...kphiTrendSpec(makeId('tend'), set.id), selection: { excluded } });
      return updateTrend(p, w, t.id, { selection: { ...t.selection, excluded } });
    });
  };

  return (
    <section className="core-col core-kphi" aria-label="Crossplot k–φ y modelo">
      <header className="core-col__head">
        <h3>Modelo k–φ</h3>
        {cloud && <Checkbox checked={showLog} onChange={setShowLog} label="Perfil (PHIE–PERM)" />}
      </header>
      <div className="core-kphi__body">
        {phi && k ? (
          <XYPlot
            height={250}
            className="core-xplot"
            data-testid="core-kphi-plot"
            ariaLabel="Crossplot de permeabilidad contra porosidad de los plugs, con el modelo k–φ"
            x={axes.x}
            y={axes.y}
            points={points}
            trends={trendLayers}
            onPointClick={(layer, j) => {
              if (layer !== 'plugs') return;
              const i = idsWithData[j]!;
              togglePlug(set, set.pointIds[i]!, !st[i]!.included);
            }}
            onSelectRect={onRect}
          />
        ) : (
          <p className="core-empty">Para el modelo k–φ hacen falta la porosidad y la permeabilidad de los plugs.</p>
        )}
        <ModelCard set={set} interp={interp} main={main} />
      </div>
    </section>
  );
}

function ModelCard({ set, interp, main }: { set: PointSet; interp: Interpretation; main: KPhiTrend | null }) {
  const [useAsSource, setUseAsSource] = useState(true);
  const isSource = permCoreIsSource(interp);
  if (!main) {
    return (
      <div className="core-model">
        <p className="core-empty">Ajustá la recta de log k contra φ de los plugs incluidos (exponencial en k).</p>
        <Button
          size="sm"
          variant="primary"
          icon="trend"
          onClick={() => {
            const w = activeWellId();
            if (w) useProject.getState().commit('Ajustar modelo k–φ', (p) => addTrend(p, w, kphiTrendSpec(makeId('tend'), set.id)));
          }}
        >
          Ajustar modelo k–φ
        </Button>
      </div>
    );
  }
  const r = main.result;
  const zoneId = main.spec.selection.zoneId ?? null;
  const zone = zoneId ? interp.zones.find((z) => z.id === zoneId) : undefined;
  const sync = kphiSync(interp, main.model, zone ? zoneId : null);
  const target = zone ? `la zona ${zone.name}` : 'todo el pozo';
  const id = main.spec.id;
  const apply = () => {
    const w = activeWellId();
    if (!w || !main.model) return;
    const model = main.model;
    useProject.getState().commit(zone ? `Aplicar modelo k–φ a la zona ${zone.name}` : 'Aplicar modelo k–φ al pozo', (p) => applyKPhiModel(p, w, model, { zoneId: zone ? zoneId : null, useAsSource }));
    toast({
      tone: 'ok',
      title: 'Modelo k–φ aplicado',
      description: useAsSource || isSource ? `La permeabilidad (PERM) de ${target} ahora sale del modelo de la corona.` : `Se guardaron a y b en el módulo; PERM sigue saliendo de otro método.`,
    });
  };
  return (
    <div className="core-model">
      {!r?.coeffs ? (
        <p className="core-warn">{main.series ? (r?.problem ?? 'Sin ajuste.') : 'Los plugs de este modelo ya no están.'}</p>
      ) : (
        <>
          <div className="core-model__eq">
            <span className="core-model__k num">
              <Flash value={r.coeffs.b}>{trendEquation(r, main.series)}</Flash>
            </span>
            {main.model && (
              <span className="core-model__log num" title="La misma recta en logaritmo decimal: es lo que usa el módulo del motor">
                log k = {formatNumber(main.model.a, { digits: 3 }).replace('-', '−')} {main.model.b < 0 ? '−' : '+'} {formatNumber(Math.abs(main.model.b), { digits: 2 })}·φ
              </span>
            )}
          </div>
          <div className="core-model__meta num">
            <span>R² {formatR2(r.r2)}</span>
            <span>n {r.n}</span>
            {r.excluded > 0 && (
              <button type="button" className="core-link" title="Volver a ajustar con todos los plugs incluidos" onClick={() => useProject.getState().commit('Ajustar con todos los plugs', (p) => updateTrend(p, activeWellId()!, id, { selection: { ...main.spec.selection, excluded: [] } }))}>
                {r.excluded} fuera del ajuste · usar todos
              </button>
            )}
          </div>
        </>
      )}
      <div className="core-model__row">
        <label className="core-field">
          <span>Plugs de</span>
          <Select
            size="sm"
            aria-label="Tramo de los plugs del ajuste"
            value={zoneId ?? ''}
            options={[{ value: '', label: 'Todo el pozo' }, ...interp.zones.map((z) => ({ value: z.id, label: `Zona ${z.name}` }))]}
            onChange={(v) => {
              const w = activeWellId();
              if (!w) return;
              useProject.getState().commit('Cambiar el tramo del modelo k–φ', (p) => {
                if (v) return setTrendZone(p, w, id, v);
                const { zoneId: _z, top: _t, base: _b, ...rest } = main.spec.selection;
                return updateTrend(p, w, id, { selection: rest });
              });
            }}
          />
        </label>
        <IconButton size="sm" icon="trash" label="Borrar el modelo k–φ" onClick={() => useProject.getState().commit('Borrar modelo k–φ', (p) => removeTrend(p, activeWellId()!, id))} />
      </div>
      {main.spec.model !== 'exp' && <Callout tone="info">El modelo del motor es log k lineal en φ: elegí el modelo exponencial en el panel Tendencias para poder aplicarlo.</Callout>}
      <div className="core-model__apply">
        <Button size="sm" variant={sync.state === 'synced' ? 'secondary' : 'primary'} icon="check" disabled={!main.model} onClick={apply} title={`Escribe a y b en el módulo «Permeabilidad — modelo k–φ de corona» para ${target}`}>
          {zone ? `Aplicar a la zona ${zone.name}` : 'Aplicar al pozo'}
        </Button>
        {!isSource && <Checkbox checked={useAsSource} onChange={setUseAsSource} label="y usarlo para PERM" />}
      </div>
      <p className={`core-sync is-${sync.state}`} role="status">
        {sync.state === 'synced' ? (
          <>
            <Badge tone="ok" icon="check">
              Aplicado
            </Badge>{' '}
            {isSource ? `PERM de ${target} sale de este ajuste.` : 'El módulo tiene este ajuste, pero PERM sale de otro método.'}
          </>
        ) : sync.state === 'stale' ? (
          <>
            <Badge tone="warn" icon="warning">
              Desactualizado
            </Badge>{' '}
            El módulo usa a = {formatNumber(sync.params.a, { digits: 3 })} y b = {formatNumber(sync.params.b, { digits: 2 })}: aplicá de nuevo para usar el ajuste actual.
          </>
        ) : (
          <>
            <Badge>Sin aplicar</Badge> {isSource ? 'PERM sale del módulo con sus valores por defecto.' : 'PERM sale de otro método (Timur o Coates).'}
          </>
        )}
      </p>
    </div>
  );
}

export const dockPanels: DockPanelDef[] = [
  {
    id: CORE_DOCK_ID,
    title: 'Corona',
    icon: 'layers',
    component: CorePanel,
    useBadge: () => useProject((s) => coreSets(selectActiveEntry(s)?.well.pointSets ?? []).reduce((n, x) => n + x.pointIds.length, 0) || null),
  },
];
