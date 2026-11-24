/**
 * Panel «Presiones MDT» del dock (docs/decisiones/0009, D6): tabla de pruebas con su calidad y la decisión de
 * incluir o descartar cada una, gradientes por fluido (psi/ft, bar/m, densidad y fluido sugerido) y contactos.
 * Estado vacío con «Cargar presiones», «Cargar presiones del TP» (datos reales embebidos, 0057) y «Usar presiones de
 * ejemplo». Todo cambio va por `commit` (Ctrl+Z).
 *
 * Es un panel del dock y no un panel de módulo del motor: MDT no calcula curvas ni puertos (las presiones no pasan
 * por el worker), y el dock es donde vive «Tendencias», la herramienta que usa. Se descubre solo
 * (`src/modules/<id>/dock.tsx`).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { pointNumbers, pointTexts, shiftedDepth, type PointSet } from '../../core/pointSets';
import { addPointSet, removePointSet, setPointDecision, setPointSetSetting } from '../../core/state/pointSets';
import { activeWellEntry, applyZoneEdit, makeId, setOverlaySetting } from '../../core/state/project';
import { removeTrend } from '../../core/state/trends';
import { defaultZoneName, splitZoneAt } from '../../core/state/zones';
import { conversionCoefficients, unitLabel } from '../../core/units';
import { PRESSURE_COLUMNS } from '../../io/pressures';
import { formatGradientValue, formatR2 } from '../../plots/trend/format';
import { Badge, Button, Callout, Checkbox, DataTable, EmptyState, IconButton, NumberField, SegmentedControl, Select, formatNumber, toast, useFlash, useThemeTokens, zoneColor, type Column } from '../../ui';
import type { DockPanelDef } from '../../ui/dockPanel';
import { ensureContrast } from '../../ui/color';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import { commitTrends, patchTrend, startTrendTool, stopTrendTool } from '../../app/trends/actions';
import { useTrendsUi } from '../../app/trends/store';
import { addExample } from './example';
import { LoadPressuresDialog } from './LoadPressuresDialog';
import { isTpMdtSet, TP_MDT_VIEW, TP_MDT_ZONE_COLUMN, tpMdtSet } from './tp';
import {
  CONTACT_LABEL,
  decisionFor,
  DISPLAY_UNITS,
  FLUID_COLOR,
  FLUID_LABEL,
  FLUIDS,
  MDT_OVERLAY_ID,
  MDT_PROVIDER_ID,
  minMobilityOf,
  MIN_MOBILITY_SETTING,
  mdtSeriesKey,
  pointStatuses,
  pressureSets,
  QUALITY_REASON_LABEL,
  type DisplayUnit,
  type Fluid,
  type FluidContact,
} from './model';
import { formatDrawdown, pointColorOf, type MdtPointColor } from './drawdown';
import { displayUnitOf } from './overlay';
import { mdtAnalysis, pointRef, type MdtAnalysis, type MdtGradient } from './series';
import '../../app/components/load-well.css';
import './mdt.css';

const UNIT_DIGITS: Record<DisplayUnit, number> = { psi: 1, bar: 2, kPa: 0, 'kgf/cm2': 2 };
const m1 = (d: number) => formatNumber(d, { digits: 1 });

function Flash({ value, children }: { value: unknown; children: ReactNode }) {
  const flash = useFlash(value);
  return (
    <span className="ui-flash mdt-flash" data-flash={flash}>
      {children}
    </span>
  );
}

const activeWellId = () => activeWellEntry(useProject.getState().project)?.well.id ?? null;

/** Carga el ejemplo sintético con sus tres gradientes y lo muestra en el visor. */
function loadExample(): void {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) return;
  const ids = { set: makeId('mdt'), trends: { gas: makeId('tend'), oil: makeId('tend'), water: makeId('tend') } };
  useProject.getState().commit('Usar presiones de ejemplo', (p) => addExample(p, entry.well.id, ids));
  const d = entry.well.depth.values;
  const outside = d.length === 0 || d[0]! > 7970 || d[d.length - 1]! < 8230;
  toast({
    tone: outside ? 'warn' : 'ok',
    title: 'Presiones de ejemplo cargadas (sintéticas)',
    description: outside
      ? 'El ejemplo está pensado para el pozo del TP (7.633–8.518 m): en este pozo puede quedar fuera de los perfiles.'
      : 'No son mediciones del pozo: 21 pruebas inventadas, con tres gradientes ya trazados y sus contactos. Mové los tramos, descartá puntos o borralos.',
  });
  useTrendsUi.getState().requestRange(7950, 8250);
  useUi.getState().set({ dockTab: 'mdt' });
}

/**
 * Carga las presiones reales del TP (embebidas, 0057) sin gradientes ni descartes: el usuario traza los gradientes con
 * las herramientas del panel. Si el pozo ya las tiene, no las duplica: avisa y muestra el panel.
 */
export function loadTpPressures(): void {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) return;
  const show = () => {
    useTrendsUi.getState().requestRange(TP_MDT_VIEW[0], TP_MDT_VIEW[1]);
    useUi.getState().set({ dockTab: 'mdt' });
  };
  if (entry.well.pointSets.some(isTpMdtSet)) {
    toast({ tone: 'info', title: 'Las presiones del TP ya están cargadas', description: 'Para volver a cargarlas desde cero, borrá primero el conjunto con el botón de la papelera.' });
    show();
    return;
  }
  const set = tpMdtSet(makeId('mdt'));
  const zones = pointTexts(set, TP_MDT_ZONE_COLUMN) ?? [];
  const count = (z: string) => zones.filter((x) => x === z).length;
  useProject.getState().commit('Cargar presiones del TP', (p) => addPointSet(p, entry.well.id, set));
  const d = entry.well.depth.values;
  const outside = d.length === 0 || d[0]! > set.depth[0]! || d[d.length - 1]! < set.depth[set.depth.length - 1]!;
  toast({
    tone: outside ? 'warn' : 'ok',
    title: 'Presiones del TP cargadas (datos reales de la hoja MDT)',
    description: outside
      ? 'Son las presiones del pozo del TP (7.729–8.121 m): en este pozo quedan fuera de los perfiles.'
      : `${set.pointIds.length} pruebas medidas (${count('B')} en la zona B, ${count('C')} en la C y ${count('D')} en la D), sin gradientes trazados. Elegí un fluido en «Gradientes» y arrastrá sobre el visor el tramo de sus puntos.`,
  });
  show();
}

/** Empieza un gradiente nuevo: tendencia lineal sobre la serie MDT de ese fluido, eligiendo el tramo en el visor. */
function startGradient(setId: string, fluid: Fluid): void {
  const name = `Gradiente de ${FLUID_LABEL[fluid].toLowerCase()}`;
  startTrendTool({
    kind: 'fit',
    model: 'linear',
    series: {
      ref: { provider: MDT_PROVIDER_ID, key: mdtSeriesKey(setId, fluid) },
      label: 'P',
      name,
      color: FLUID_COLOR.light[fluid],
      extend: true,
      hint: `Arrastrá sobre el visor para elegir el tramo de los puntos de ${FLUID_LABEL[fluid].toLowerCase()}`,
    },
  });
}

export function MdtPanel() {
  const entry = useProject(selectActiveEntry);
  const settings = useProject((s) => s.project.display.overlays?.[MDT_OVERLAY_ID]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const well = entry?.well ?? null;
  const interp = entry?.interpretation ?? null;
  const analysis = useMemo(() => (well && interp ? mdtAnalysis(well, interp) : null), [well, interp]);

  const dialog = loading && <LoadPressuresDialog onClose={() => setLoading(false)} onExample={loadExample} onTp={loadTpPressures} />;
  if (!entry || !well || !interp || !analysis) {
    return <EmptyState size="sm" icon="droplet" title="Sin pozo" description="Cargá un pozo para sumarle presiones de formación (MDT, RFT)." />;
  }
  const sets = pressureSets(well.pointSets);
  if (sets.length === 0) {
    return (
      <>
        <EmptyState
          size="sm"
          icon="droplet"
          title="Sin presiones de formación"
          description="Cargá una tabla de presiones MDT o RFT (Excel, CSV o LAS) para ver la presión junto a la Sw, trazar el gradiente de cada fluido, leer su densidad y ubicar los contactos donde se cortan."
          actions={
            <>
              <Button variant="primary" icon="upload" onClick={() => setLoading(true)}>
                Cargar presiones
              </Button>
              <Button icon="table" onClick={loadTpPressures} title="58 pruebas MDT reales del pozo del TP (hoja MDT de la cátedra), embebidas en la app">
                Cargar presiones del TP
              </Button>
              <Button variant="ghost" icon="play" onClick={loadExample} title="21 pruebas inventadas para practicar sobre el pozo del TP: no son mediciones del pozo">
                Usar presiones de ejemplo
              </Button>
            </>
          }
        />
        {dialog}
      </>
    );
  }
  const set = sets.find((s) => s.id === picked) ?? sets[0]!;
  const unit = displayUnitOf(settings);
  return (
    <div className="mdt">
      <MdtBar set={set} sets={sets} unit={unit} pointColor={pointColorOf(settings)} onPick={setPicked} onLoad={() => setLoading(true)} />
      <div className="mdt-body">
        <PointsTable key={`${well.id}:${set.id}`} set={set} analysis={analysis} unit={unit} />
        <aside className="mdt-side">
          <Gradients set={set} analysis={analysis} />
          <Contacts contacts={analysis.contacts.filter((c) => analysis.gradients.some((g) => g.setId === set.id && g.spec.id === c.upper.id))} unit={unit} wellId={well.id} />
        </aside>
      </div>
      {dialog}
    </div>
  );
}

// ── barra superior ──────────────────────────────────────────────────────────────────────────────────────────

function MdtBar({ set, sets, unit, pointColor, onPick, onLoad }: { set: PointSet; sets: PointSet[]; unit: DisplayUnit; pointColor: MdtPointColor; onPick(id: string): void; onLoad(): void }) {
  const interp = useProject((s) => selectActiveEntry(s)?.interpretation);
  const dec = interp?.pointSets[set.id];
  const tvd = pointNumbers(set, 'tvd');
  let maxDev = 0;
  if (tvd) for (let i = 0; i < tvd.length; i++) if (Number.isFinite(tvd[i]!)) maxDev = Math.max(maxDev, Math.abs(set.depth[i]! - tvd[i]!));
  return (
    <>
      <div className="mdt-bar">
        <div className="mdt-bar__set">
          {sets.length > 1 ? (
            <Select size="sm" aria-label="Conjunto de presiones" value={set.id} options={sets.map((s) => ({ value: s.id, label: s.name }))} onChange={onPick} />
          ) : (
            <span className="mdt-bar__name" title={set.source ? `Archivo: ${set.source}` : undefined}>
              {set.name}
            </span>
          )}
          {set.synthetic && (
            <Badge tone="warn" icon="warning" title="Presiones inventadas para practicar: no son mediciones del pozo">
              Ejemplo sintético
            </Badge>
          )}
          {isTpMdtSet(set) && (
            <Badge tone="ok" icon="check-circle" title={`Mediciones reales: ${set.source}`}>
              Datos del TP
            </Badge>
          )}
        </div>
        <span className="shell-spacer" />
        <label className="mdt-bar__field">
          <span title="Por debajo de esta movilidad se propone descartar la prueba (la presión puede no estar estabilizada)">Movilidad mín.</span>
          <NumberField
            size="sm"
            width={78}
            aria-label="Movilidad mínima (mD/cP): por debajo se propone descartar la prueba"
            value={minMobilityOf(dec)}
            min={0}
            max={1000}
            step={0.1}
            unit="mD/cP"
            onChange={(v) => {
              const w = activeWellId();
              if (w) useProject.getState().commit('Cambiar la movilidad mínima', (p) => setPointSetSetting(p, w, set.id, MIN_MOBILITY_SETTING, v));
            }}
          />
        </label>
        <SegmentedControl
          size="sm"
          aria-label="Unidad de presión"
          value={unit}
          onChange={(u) => useProject.getState().commit('Cambiar la unidad de presión', (p) => setOverlaySetting(p, MDT_OVERLAY_ID, 'unit', u === 'psi' ? undefined : u))}
          options={DISPLAY_UNITS.map((u) => ({ value: u, label: unitLabel(u) }))}
        />
        <label className="mdt-bar__field">
          <span>Color de puntos</span>
          <Select
            size="sm"
            aria-label="Color de puntos"
            value={pointColor}
            options={[{ value: 'fluid', label: 'Fluido' }, { value: 'drawdown', label: 'Drawdown' }]}
            onChange={(mode) => useProject.getState().commit('Cambiar el color de puntos MDT', (p) => setOverlaySetting(p, MDT_OVERLAY_ID, 'pointColor', mode === 'drawdown' ? mode : undefined))}
          />
        </label>
        <IconButton size="sm" icon="upload" label="Cargar otra tabla de presiones" onClick={onLoad} />
        <IconButton
          size="sm"
          icon="trash"
          label={`Borrar «${set.name}» y sus gradientes`}
          onClick={() => {
            const w = activeWellId();
            if (!w) return;
            // La receta del núcleo borra también los gradientes (tendencias de la serie `<conjunto>[:fluido]`).
            useProject.getState().commit('Borrar presiones', (p) => removePointSet(p, w, set.id));
            stopTrendTool();
          }}
        />
      </div>
      {maxDev > 1 && (
        <Callout tone="warn" className="mdt-callout">
          El pozo es desviado (TVD difiere de MD hasta {m1(maxDev)} m): los gradientes se calculan contra MD y las densidades salen subestimadas. Usalas con cautela.
        </Callout>
      )}
    </>
  );
}

// ── tabla de pruebas ────────────────────────────────────────────────────────────────────────────────────────

interface PointRow {
  i: number;
  id: string;
}

interface ZoneFilter {
  value: string;
  label: string;
  matches(index: number): boolean;
  range?: { top: number; base: number };
}

const ALL_POINTS = '';

function PointsTable({ set, analysis, unit }: { set: PointSet; analysis: MdtAnalysis; unit: DisplayUnit }) {
  const [selected, onSelect] = useState<string | null>(null);
  const [filter, setFilter] = useState(ALL_POINTS);
  const interp = useProject((s) => selectActiveEntry(s)?.interpretation);
  const theme = useThemeTokens();
  const st = pointStatuses(set, interp?.pointSets[set.id]);
  const p = pointNumbers(set, 'pressure');
  const drawdown = pointNumbers(set, PRESSURE_COLUMNS.drawdown);
  const mob = pointNumbers(set, 'mobility');
  const qual = pointTexts(set, 'quality');
  const comment = pointTexts(set, 'comment');
  const zoneCol = pointTexts(set, TP_MDT_ZONE_COLUMN);
  const [a, b] = conversionCoefficients('psi', unit);
  const depth = shiftedDepth(set, interp?.pointSets[set.id]);
  const zones = interp?.zones ?? [];
  const origins = [...new Set(zoneCol?.filter(Boolean))];
  const sourceOptions = origins.map((zone) => ({ value: `origin:${zone}`, label: `${zone} · origen`, matches: (i: number) => zoneCol?.[i] === zone }));
  const interpretedOptions = zones.map((zone) => ({
    value: `interpreted:${zone.id}`,
    label: `${zone.name} · interpretada`,
    matches: (i: number) => depth[i]! >= zone.top && depth[i]! <= zone.base,
    range: { top: zone.top, base: zone.base },
  }));
  const filters: ZoneFilter[] = [...sourceOptions, ...interpretedOptions];
  const selectedFilter = filters.find((item) => item.value === filter);
  const rows: PointRow[] = set.pointIds.map((id, i) => ({ i, id })).filter(({ i }) => !selectedFilter || selectedFilter.matches(i));

  const changeFilter = (value: string) => {
    setFilter(value);
    onSelect(null);
    const option = filters.find((item) => item.value === value);
    if (!option) return;
    if (option.range) {
      useTrendsUi.getState().requestRange(option.range.top, option.range.base);
    } else {
      let top = Infinity;
      let base = -Infinity;
      for (let i = 0; i < depth.length; i++) {
        if (!option.matches(i)) continue;
        top = Math.min(top, depth[i]!);
        base = Math.max(base, depth[i]!);
      }
      if (top <= base) useTrendsUi.getState().requestRange(top - 10, base + 10);
    }
  };

  const toggle = (i: number, include: boolean) => {
    const w = activeWellId();
    if (!w) return;
    const pid = set.pointIds[i]!;
    useProject.getState().commit(include ? 'Incluir punto MDT' : 'Descartar punto MDT', (proj) => {
      const e = proj.wells.find((x) => x.well.id === w);
      const cur = e?.well.pointSets.find((s) => s.id === set.id);
      if (!e || !cur) return proj;
      const q = pointStatuses(cur, e.interpretation.pointSets[cur.id])[cur.pointIds.indexOf(pid)];
      if (!q || q.included === include) return proj;
      return setPointDecision(proj, w, cur.id, pid, decisionFor(q.quality, include));
    });
  };

  const columns: Column<PointRow>[] = [
    {
      key: 'inc',
      header: <span className="ui-visually-hidden">Incluida</span>,
      width: 34,
      render: (r) => {
        const s = st[r.i]!;
        const noP = s.quality.reasons.includes('noPressure');
        return (
          <span onClick={(e) => e.stopPropagation()} className="mdt-check">
            <Checkbox
              checked={s.included}
              disabled={noP}
              aria-label={noP ? `${r.id}: sin presión, no se puede incluir` : s.included ? `Descartar ${r.id}` : `Incluir ${r.id}`}
              onChange={(on) => toggle(r.i, on)}
            />
          </span>
        );
      },
    },
    {
      key: 'id',
      header: 'Prueba',
      render: (r) => (
        <span className="mdt-id">
          <span className="mono">{r.id}</span>
          {st[r.i]!.decided && (
            <span className="mdt-manual" title={st[r.i]!.decided === 'include' ? 'Incluida a mano (la regla proponía descartarla)' : 'Descartada a mano'}>
              a mano
            </span>
          )}
        </span>
      ),
    },
    ...(zoneCol ? [{ key: 'zone', header: 'Zona de origen', title: 'Zona de la hoja de datos', render: (r: PointRow) => zoneCol[r.i] || '—' } satisfies Column<PointRow>] : []),
    {
      key: 'md',
      header: 'MD (m)',
      title: 'Profundidad medida con el desplazamiento aplicado, si lo hay',
      align: 'num',
      render: ({ i }) => (
        <span title={`MD ${formatNumber(depth[i], { digits: 4 })} m${depth[i] !== set.depth[i] ? ` · origen ${formatNumber(set.depth[i], { digits: 4 })} m` : ''}`}>
          {m1(depth[i]!)}
        </span>
      ),
    },
    {
      key: 'p',
      header: `P (${unitLabel(unit)})`,
      title: 'Presión de formación',
      align: 'num',
      render: (r) => formatNumber(p ? p[r.i]! * a + b : NaN, { digits: UNIT_DIGITS[unit] }),
    },
    { key: 'drawdown', header: `Drawdown (${unitLabel(unit)})`, title: 'Caída de presión de la prueba', align: 'num', render: (r) => formatDrawdown(drawdown?.[r.i], unit) },
    { key: 'mob', header: 'Mov. (mD/cP)', title: 'Movilidad k/µ de la prueba', align: 'num', render: (r) => formatNumber(mob?.[r.i], { significant: 3 }) },
    {
      key: 'q',
      header: 'Calidad',
      render: (r) => {
        const x = st[r.i]!;
        const reasons = x.quality.reasons;
        const text = qual?.[r.i];
        const title = [text && `Archivo: ${text}`, comment?.[r.i], reasons.length ? `Regla automática: ${reasons.map((k) => QUALITY_REASON_LABEL[k]).join(', ')}. ${x.included ? 'La incluiste a mano.' : 'Por eso se propone descartarla.'}` : null]
          .filter(Boolean)
          .join('\n');
        return (
          <span className="mdt-quality" title={title || undefined}>
            {reasons.length === 0 ? (
              <span className={text ? undefined : 'ui-text-muted'}>{text || '—'}</span>
            ) : (
              <>
                <Badge tone={x.included ? 'warn' : 'neutral'} variant="outline">
                  {QUALITY_REASON_LABEL[reasons[0]!]}
                </Badge>
                {reasons.length > 1 && <span className="mdt-more">+{reasons.length - 1}</span>}
              </>
            )}
          </span>
        );
      },
    },
    {
      key: 'fluid',
      header: 'Fluido',
      render: (r) => {
        const f = st[r.i]!.included ? analysis.fluidOfPoint.get(pointRef(set.id, r.id)) : undefined;
        if (!f) return <span className="ui-text-muted">{st[r.i]!.included ? '—' : 'descartada'}</span>;
        return (
          <span className="mdt-fluid" title={`Usada por «${f.name}»`}>
            <span className="mdt-dot" style={{ background: ensureContrast(FLUID_COLOR[theme.name][f.fluid], theme.color.surface, 3) }} aria-hidden="true" />
            {FLUID_LABEL[f.fluid]}
          </span>
        );
      },
    },
  ];

  const included = rows.filter(({ i }) => st[i]!.included).length;
  return (
    <section className="mdt-points" aria-label="Pruebas de presión">
      <header className="mdt-points__head">
        <h3>Pruebas</h3>
        <span className="num">
          {rows.length} · <span className="mdt-ok">{included} incluidas</span> · {rows.length - included} descartadas
        </span>
        {filters.length > 0 && (
          <Select
            size="sm"
            aria-label="Filtrar pruebas por zona"
            value={selectedFilter?.value ?? ALL_POINTS}
            options={[{ value: ALL_POINTS, label: 'Todas las zonas' }, ...filters]}
            onChange={changeFilter}
          />
        )}
        <span className="mdt-points__help">Clic en una fila: verla en el visor · en el visor, clic en un punto: incluirlo o descartarlo</span>
      </header>
      <DataTable
        dense
        data-testid="mdt-points"
        caption="Pruebas de presión"
        rows={rows}
        rowKey={(r) => r.id}
        selectedKey={selected}
        onRowClick={(r) => {
          onSelect(r.id === selected ? null : r.id);
          const z = depth[r.i]!;
          useTrendsUi.getState().requestRange(z - 30, z + 30);
        }}
        rowProps={(r) => ({ 'data-excluded': st[r.i]!.included ? undefined : '' })}
        columns={columns}
      />
    </section>
  );
}

// ── gradientes ──────────────────────────────────────────────────────────────────────────────────────────────

function suggestionBadge(g: MdtGradient): ReactNode {
  const s = g.suggestion;
  if (!g.result?.coeffs) return null;
  if (!s || !s.fluid) return <Badge tone="error" icon="warning" title="Una columna de fluido continua no puede dar esta densidad: revisá los puntos o el tramo">Densidad no física</Badge>;
  if (g.fluid && s.fluid !== g.fluid) {
    return (
      <Badge tone="warn" icon="warning" title={`Elegiste ${FLUID_LABEL[g.fluid].toLowerCase()}, pero la densidad cae ${s.between ? 'entre' : 'en el rango de'} ${s.between ? `${FLUID_LABEL[s.between[0]].toLowerCase()} y ${FLUID_LABEL[s.between[1]].toLowerCase()}` : FLUID_LABEL[s.fluid].toLowerCase()}`}>
        Parece {FLUID_LABEL[s.fluid].toLowerCase()}
      </Badge>
    );
  }
  if (s.between) {
    return (
      <Badge tone="info" title="La densidad cae entre dos rangos típicos">
        Entre {FLUID_LABEL[s.between[0]].toLowerCase()} y {FLUID_LABEL[s.between[1]].toLowerCase()}
      </Badge>
    );
  }
  if (!g.fluid) return <Badge tone="info">Sugerido: {FLUID_LABEL[s.fluid].toLowerCase()}</Badge>;
  return (
    <Badge tone="ok" icon="check" title="La densidad cae en el rango típico del fluido elegido">
      Coincide con {FLUID_LABEL[s.fluid].toLowerCase()}
    </Badge>
  );
}

function Gradients({ set, analysis }: { set: PointSet; analysis: MdtAnalysis }) {
  const theme = useThemeTokens();
  const tool = useTrendsUi((s) => s.tool);
  const selectedId = useTrendsUi((s) => s.selectedId);
  const list = analysis.gradients.filter((g) => g.setId === set.id);
  const picking = tool?.series?.ref.provider === MDT_PROVIDER_ID ? tool.series.ref.key : null;
  const colorOf = (f: Fluid | null) => (f ? ensureContrast(FLUID_COLOR[theme.name][f], theme.color.surface, 3) : theme.color.textMuted);
  return (
    <section className="mdt-section" aria-label="Gradientes por fluido">
      <header className="mdt-section__head">
        <h3>Gradientes</h3>
        <span className="mdt-section__new">
          <span className="ui-text-muted">Nuevo:</span>
          {FLUIDS.map((f) => {
            const on = picking === mdtSeriesKey(set.id, f) && !tool?.trendId;
            return (
              <Button
                key={f}
                size="sm"
                variant={on ? 'primary' : 'secondary'}
                aria-pressed={on}
                onClick={() => (on ? stopTrendTool() : startGradient(set.id, f))}
                title={`Nuevo gradiente de ${FLUID_LABEL[f].toLowerCase()}: arrastrá sobre el visor para elegir el tramo de sus puntos`}
              >
                <span className="mdt-dot" style={{ background: colorOf(f) }} aria-hidden="true" />
                {FLUID_LABEL[f]}
              </Button>
            );
          })}
        </span>
      </header>
      {picking && (
        <p className="mdt-hint" role="status">
          Arrastrá sobre el visor (en cualquier pista) de arriba hacia abajo para elegir el tramo de los puntos · <kbd>Esc</kbd> para cancelar
        </p>
      )}
      {list.length > 0 && !pointNumbers(set, 'tvd')?.some(Number.isFinite) && (
        <p className="mdt-grad__meta">Ajuste sobre MD. Verificá la verticalidad del pozo para interpretar densidades y contactos.</p>
      )}
      {list.length === 0 ? (
        <p className="mdt-empty">Elegí un fluido y arrastrá sobre el visor el tramo de sus puntos: la recta, su gradiente y la densidad del fluido aparecen mientras arrastrás.</p>
      ) : (
        <ul className="mdt-grads">
          {list.map((g) => (
            <GradientCard key={g.spec.id} g={g} color={colorOf(g.fluid)} selected={selectedId === g.spec.id} pickingRange={tool?.trendId === g.spec.id} setId={set.id} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GradientCard({ g, color, selected, pickingRange, setId }: { g: MdtGradient; color: string; selected: boolean; pickingRange: boolean; setId: string }) {
  const r = g.result;
  const id = g.spec.id;
  const psiFt = r?.gradients.find((x) => x.unit === 'psi/ft')?.value ?? NaN;
  const barM = r?.gradients.find((x) => x.unit === 'bar/m')?.value ?? NaN;
  const span = r?.span;
  const autoName = /^Gradiente de (gas|petróleo|agua)( \d+)?$/.test(g.spec.name);
  return (
    <li className={`mdt-grad${selected ? ' is-selected' : ''}${g.spec.visible ? '' : ' is-hidden'}`} style={{ ['--fluid' as string]: color }}>
      <div className="mdt-grad__head">
        <button
          type="button"
          className="mdt-grad__name"
          aria-pressed={selected}
          title="Seleccionar (en el visor, clic en un punto del tramo lo excluye de este gradiente)"
          onClick={() => useTrendsUi.getState().set({ selectedId: selected ? null : id })}
        >
          {g.spec.name}
        </button>
        <span className="shell-spacer" />
        <IconButton size="sm" icon="trend" label="Elegir otro tramo en el visor" pressed={pickingRange} onClick={() => (pickingRange ? stopTrendTool() : startTrendTool({ kind: 'fit', trendId: id }))} />
        <IconButton size="sm" icon="fit-height" label="Ver el tramo en el visor" disabled={!span} onClick={() => span && useTrendsUi.getState().requestRange(span[0] - 20, span[1] + 20)} />
        <IconButton
          size="sm"
          icon={g.spec.visible ? 'eye' : 'eye-off'}
          label={g.spec.visible ? 'Ocultar (no cuenta para los contactos)' : 'Mostrar'}
          pressed={g.spec.visible}
          onClick={() => patchTrend(id, { visible: !g.spec.visible }, g.spec.visible ? 'Ocultar gradiente' : 'Mostrar gradiente')}
        />
        <IconButton
          size="sm"
          icon="trash"
          label="Borrar gradiente"
          onClick={() => {
            commitTrends('Borrar gradiente', (p, w) => removeTrend(p, w, id));
            const ui = useTrendsUi.getState();
            if (ui.selectedId === id || ui.tool?.trendId === id) ui.set({ selectedId: null, ...(ui.tool?.trendId === id ? { tool: null } : {}) });
          }}
        />
      </div>
      {!r?.coeffs ? (
        <p className="mdt-grad__problem">{g.series ? (r?.problem ?? 'Sin ajuste: elegí un tramo con al menos dos puntos.') : 'Las presiones de este gradiente ya no están en el pozo.'}</p>
      ) : (
        <>
          <div className="mdt-grad__values">
            <span className="mdt-grad__primary num">
              <Flash value={psiFt}>{formatGradientValue(psiFt)}</Flash> <span className="mdt-unit">psi/ft</span>
            </span>
            <span className="mdt-grad__other num">
              {formatGradientValue(barM)} <span className="mdt-unit">bar/m</span>
            </span>
            <span className="mdt-grad__density num" title="Densidad del fluido que da este gradiente">
              ρ <Flash value={g.density}>{formatNumber(g.density, { digits: 3 })}</Flash> <span className="mdt-unit">g/cm³</span>
            </span>
          </div>
          <div className="mdt-grad__meta">
            <span className="num">R² {formatR2(r.r2)}</span>
            <span className="num">n {r.n}</span>
            {span && <span className="num">{`${m1(span[0])}–${m1(span[1])} m`}</span>}
            {r.excluded > 0 && <span className="num">{r.excluded} excluidos</span>}
          </div>
        </>
      )}
      <div className="mdt-grad__fluid">
        <label>
          <span>Fluido</span>
          <Select
            size="sm"
            aria-label={`Fluido de «${g.spec.name}»`}
            value={g.fluid ?? ''}
            options={[...FLUIDS.map((f) => ({ value: f, label: FLUID_LABEL[f] })), { value: '', label: 'Sin fluido' }]}
            onChange={(v) => {
              const f = (v || null) as Fluid | null;
              patchTrend(
                id,
                {
                  series: { provider: MDT_PROVIDER_ID, key: mdtSeriesKey(setId, f) },
                  ...(f ? { color: FLUID_COLOR.light[f] } : { color: undefined }),
                  ...(autoName && f ? { name: `Gradiente de ${FLUID_LABEL[f].toLowerCase()}` } : {}),
                },
                'Cambiar el fluido del gradiente',
              );
            }}
          />
        </label>
        {suggestionBadge(g)}
      </div>
    </li>
  );
}

// ── contactos ───────────────────────────────────────────────────────────────────────────────────────────────

function createTopFromContact(wellId: string, depth: number) {
  const { project, commit } = useProject.getState();
  const entry = activeWellEntry(project);
  if (!entry || entry.well.id !== wellId) return;
  const { zones } = entry.interpretation;
  const result = splitZoneAt(zones, depth, {
    id: makeId('zona'),
    name: defaultZoneName(zones),
    color: zoneColor(zones.length),
  }, { depth: entry.well.depth.values });
  if ('error' in result) {
    toast({ tone: 'warn', title: 'No se creó el tope', description: result.error });
    return;
  }
  commit('Usar contacto MDT como tope', (p) => applyZoneEdit(p, wellId, result.zones, result.clone), { group: result.created.id });
  useUi.getState().set({ editingZoneId: result.created.id });
  toast({
    tone: 'ok',
    title: `Tope de «${result.created.name}» a ${formatNumber(result.created.top, { digits: 2, grouping: false })} m`,
    description: 'El tope se ajustó a la muestra más cercana.',
  });
}

function Contacts({ contacts, unit, wellId }: { contacts: FluidContact[]; unit: DisplayUnit; wellId: string }) {
  const theme = useThemeTokens();
  const [a, b] = conversionCoefficients('psi', unit);
  return (
    <section className="mdt-section" aria-label="Contactos">
      <header className="mdt-section__head">
        <h3>Contactos</h3>
      </header>
      {contacts.length === 0 ? (
        <p className="mdt-empty">Trazá los gradientes de dos fluidos contiguos (gas–petróleo, petróleo–agua o gas–agua): el contacto es la profundidad donde se cortan.</p>
      ) : (
        <ul className="mdt-contacts">
          {contacts.map((c) => {
            const depth = c.depth;
            const color = c.lower.fluid ? ensureContrast(FLUID_COLOR[theme.name][c.lower.fluid], theme.color.surface, 3) : theme.color.textMuted;
            return (
              <li key={`${c.upper.id}|${c.lower.id}`} className={`mdt-contact${c.depth === null ? ' is-missing' : ''}`} style={{ ['--fluid' as string]: color }}>
                <span className="mdt-contact__tag">{CONTACT_LABEL[c.kind].short}</span>
                <div className="mdt-contact__text">
                  <span className="mdt-contact__name">{CONTACT_LABEL[c.kind].long}</span>
                  {depth !== null ? (
                    <span className="mdt-contact__value num">
                      <button type="button" className="mdt-contact__go" title="Ver en el visor" onClick={() => useTrendsUi.getState().requestRange(depth - 40, depth + 40)}>
                        <Flash value={depth}>{m1(depth)} m MD</Flash>
                      </button>
                      <span className="ui-text-muted">
                        {' · '}
                        {formatNumber(c.pressure! * a + b, { digits: UNIT_DIGITS[unit] })} {unitLabel(unit)}
                      </span>
                    </span>
                  ) : null}
                  {c.problem && <span className="mdt-contact__note mdt-contact__note--error">{c.problem}</span>}
                  {c.warning && <span className="mdt-contact__note">{c.warning}</span>}
                  {depth !== null && (
                    <Button className="mdt-contact__top" size="sm" icon="zone-add" onClick={() => createTopFromContact(wellId, depth)}>
                      Usar como tope de zona
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export const dockPanels: DockPanelDef[] = [
  {
    id: 'mdt',
    title: 'Presiones MDT',
    icon: 'droplet',
    component: MdtPanel,
    useBadge: () => useProject((s) => pressureSets(selectActiveEntry(s)?.well.pointSets ?? []).reduce((n, x) => n + x.pointIds.length, 0) || null),
  },
];
