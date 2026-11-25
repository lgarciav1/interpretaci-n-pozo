/**
 * Panel a medida de la capacidad de flujo y zonación hidráulica SMLP (función S, Lorenz estratigráfico de Gunter
 * et al., 1997): zona elegida (o total), coeficiente de Lorenz y capacidades como datos destacados, gráfico de Lorenz
 * interactivo (clic para marcar/quitar quiebres SMLP), sugerencia automática con sensibilidad y cantidad máxima de
 * unidades, tabla de sub-unidades hidráulicas S1..Sk con carácter operativo, botón «Partir zona en este quiebre»
 * (Ctrl+Z atómico), superposición opcional en el visor, resumen por zona y tramos en páginas («Ver más»).
 */
import { useEffect, useMemo, useState } from 'react';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import { useTrendsUi } from '../../app/trends/store';
import type { TableCell, TableValue } from '../../core/module';
import { activeWellEntry, makeId } from '../../core/state/project';
import { defaultZoneName } from '../../core/state/zones';
import { suggestSmlpBreaks, type SmlpSubUnit } from '../../petro/flowCapacity';
import { XYPlot, type XYLineLayer, type XYPointLayer } from '../../plots/xy/XYPlot';
import type { XYAxis } from '../../plots/xy/axes';
import {
  Badge,
  Button,
  CurveSwatch,
  DataTable,
  EmptyState,
  IconButton,
  SegmentedControl,
  Select,
  Switch,
  curveStyle,
  ensureContrast,
  formatNumber,
  toast,
  useThemeTokens,
  zoneColor,
  type Column,
} from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import {
  LORENZ_PORT,
  SMLP_CHARACTER_LABEL,
  SMLP_CHARACTER_SHORT,
  SMLP_CHARACTER_TONE,
  SMLP_SENSITIVITY_TOLERANCE,
  SUMMARY_PORT,
  TOTAL_KEY,
  UNITS_PORT,
  applySplitZoneAtBreak,
  breakDepthKey,
  cleanOrphanBreaksRecipe,
  findSplittableHostZone,
  lorenzSeries,
  planSplitZoneAtBreak,
  readFlowState,
  resolveSmlp,
  setSmlpOverlayRecipe,
  setZoneBreaksRecipe,
  staleZoneBreakKeys,
  toggleDepthKey,
  unitsFor,
  viewRangeFor,
  zoneKey,
  type ResolvedSmlpBreak,
  type Row,
  type SmlpSensitivity,
  type UnitRow,
} from './model';
import { smlpCharacterColor } from './overlay';
import { setSmlpPreviewZone } from './overlaySync';
import './panel.css';

const PAGE = 100;
const MAX_POINTS = 1000;
const DIAGONAL = { x: [0, 100], y: [0, 100] };

const MAX_SEGMENT_OPTIONS = [2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: String(n), label: `Máx. ${n}` }));
const SENSITIVITY_OPTIONS: { value: SmlpSensitivity; label: string }[] = [
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Media' },
  { value: 'low', label: 'Baja' },
];

const fmt = (c: TableCell | number | undefined, digits: number) => formatNumber(typeof c === 'number' && Number.isFinite(c) ? c : null, { digits });
const depthNum = (v: number) => formatNumber(Number.isFinite(v) ? v : null, { digits: 2, grouping: false });
const isTotal = (r: Row) => zoneKey(r.zoneId) === TOTAL_KEY;

const X_AXIS: XYAxis = { kind: 'linear', min: 0, max: 100, label: 'Capacidad de almacenaje acumulada Fφh', unit: '%' };
const Y_AXIS: XYAxis = { kind: 'linear', min: 0, max: 100, label: 'Capacidad de flujo acumulada Fkh', unit: '%' };

const numCol = (key: string, header: string, digits: number): Column<Row> => ({ key, header, align: 'num', render: (r) => fmt(r[key], digits) });
const unitCol = (key: keyof UnitRow, header: string, digits: number): Column<UnitRow> => ({ key, header, align: 'num', render: (u) => fmt(u[key] as number, digits) });

const zoneCol: Column<Row> = { key: 'zone', header: 'Zona', render: (r) => <span className="fcap-zone">{String(r.zone ?? '')}</span> };
const CAPACITY_COLUMNS: readonly Column<Row>[] = [zoneCol, numCol('units', 'Tramos', 0), numCol('h', 'h (m)', 1), numCol('phiH', 'φ·h (m)', 2), numCol('kH', 'k·h (mD·m)', 0)];
const MEAN_COLUMNS: readonly Column<Row>[] = [
  zoneCol,
  numCol('phiMean', 'φ (v/v)', 3),
  numCol('kMean', 'k (mD)', 1),
  { key: 'lc', header: 'Lc', align: 'num', title: 'Coeficiente de Lorenz', render: (r) => <span className="fcap-lc">{fmt(r.lc, 2)}</span> },
];

/** Profundidad del tramo: una sola cifra si es una muestra (tope = base), si no tope–base. */
const depthText = (u: UnitRow) => (u.base - u.top > 1e-6 ? `${fmt(u.top, 2)}–${fmt(u.base, 2)}` : fmt(u.top, 2));

function slopeDisplay(slope: number): string {
  if (slope === Infinity) return '∞';
  return fmt(slope, 2);
}

function unitColumns(withZone: boolean): Column<UnitRow>[] {
  return [
    ...(withZone ? [{ key: 'zone', header: 'Zona', render: (u: UnitRow) => <span className="fcap-zone">{u.zone}</span> }] : []),
    { key: 'depth', header: 'Prof. (m)', align: 'num', render: (u) => <span className="fcap-depth">{depthText(u)}</span> },
    unitCol('h', 'h (m)', 2),
    unitCol('phi', 'φ', 3),
    unitCol('k', 'k (mD)', 1),
    unitCol('phiHPct', 'φ·h %', 2),
    unitCol('kHPct', 'k·h %', 2),
    unitCol('cumPhiHPct', 'Σφ·h %', 1),
    unitCol('cumKHPct', 'Σk·h %', 1),
  ];
}

const goToRange = (top: number, base: number) => {
  const r = viewRangeFor(top, base);
  useTrendsUi.getState().requestRange(r.top, r.base);
};

const goToUnit = (u: UnitRow) => goToRange(u.top, u.base);

type PlotHover = { layerId: 'strat-pts' | 'smlp-breaks'; index: number } | null;

function FlowCapacityPanel({ module, interpretation, result, zoneId }: ModulePanelProps) {
  const theme = useThemeTokens();
  const wellId = useProject((s) => selectActiveEntry(s)?.well.id ?? null);

  const table = (port: string) => (result?.outputs.find((o) => o.moduleId === module.id && o.port === port)?.value as TableValue | undefined)?.rows ?? [];
  const summary = table(SUMMARY_PORT);
  const unitRows = table(UNITS_PORT);
  const lorenzRows = table(LORENZ_PORT);

  const keys = summary.map((r) => zoneKey(r.zoneId));
  const [picked, setPicked] = useState<string | null>(null);
  const preferred = zoneId && keys.includes(zoneId) ? zoneId : TOTAL_KEY;
  const key = picked && keys.includes(picked) ? picked : keys.includes(preferred) ? preferred : (keys[0] ?? TOTAL_KEY);
  const [limit, setLimit] = useState({ key, n: PAGE });
  const shown = limit.key === key ? limit.n : PAGE;
  const [hover, setHover] = useState<PlotHover>(null);
  const [maxSegments, setMaxSegments] = useState('5');
  const [sensitivity, setSensitivity] = useState<SmlpSensitivity>('medium');

  // Sincroniza la zona vista en el panel con la superposición del visor (sin agregar pasos a Ctrl+Z).
  useEffect(() => {
    setSmlpPreviewZone(wellId ? { wellId, zoneKey: key } : null);
    return () => setSmlpPreviewZone(null);
  }, [wellId, key]);

  const units = useMemo(() => unitsFor(unitRows, key), [unitRows, key]);
  const strat = useMemo(() => lorenzSeries(lorenzRows, key, 'strat', MAX_POINTS), [lorenzRows, key]);
  const ordered = useMemo(() => lorenzSeries(lorenzRows, key, 'ordered', MAX_POINTS), [lorenzRows, key]);

  const flowState = useMemo(() => readFlowState(interpretation), [interpretation]);
  const savedKeys = useMemo(() => flowState.breaksByZone[key] ?? [], [flowState.breaksByZone, key]);
  const resolved = useMemo(() => resolveSmlp(units, savedKeys), [units, savedKeys]);
  const activeBreakSet = useMemo(() => new Set(resolved.breaks.map((b) => b.key)), [resolved.breaks]);

  const validZoneKeys = useMemo(() => new Set(interpretation.zones.map((z) => z.id)), [interpretation.zones]);
  const staleZoneKeys = useMemo(() => staleZoneBreakKeys(flowState, validZoneKeys), [flowState, validZoneKeys]);

  const stratColor = theme.color.accent;
  const orderedColor = curveStyle('PERM', theme.name).color;
  const diagColor = theme.color.textMuted;

  const lines = useMemo<XYLineLayer[]>(() => {
    const out: XYLineLayer[] = [
      { id: 'diag', name: 'Homogéneo', ...DIAGONAL, color: diagColor, width: 1, dash: [4, 4] },
      { id: 'ordered', name: 'Lorenz ordenado', x: ordered.x, y: ordered.y, color: orderedColor, width: 1.5 },
      { id: 'strat', name: 'Lorenz estratigráfico', x: strat.x, y: strat.y, color: stratColor, width: resolved.breaks.length > 0 ? 1.5 : 2 },
    ];
    if (resolved.breaks.length > 0) {
      for (const su of resolved.subUnits) {
        if (!Number.isFinite(su.startPhiH) || !Number.isFinite(su.endPhiH) || !Number.isFinite(su.startKH) || !Number.isFinite(su.endKH)) continue;
        out.push({
          id: `smlp-seg-${su.index}`,
          name: `${su.label} · ${su.character ? SMLP_CHARACTER_SHORT[su.character] : 'SMLP'}`,
          x: [100 * su.startPhiH, 100 * su.endPhiH],
          y: [100 * su.startKH, 100 * su.endKH],
          color: ensureContrast(smlpCharacterColor(su.character, theme), theme.viewer.trackBg, 3),
          width: 2.5,
        });
      }
    }
    return out;
  }, [strat, ordered, stratColor, orderedColor, diagColor, resolved, theme]);

  // Vértices de la curva estratigráfica (clic = marcar/quitar quiebre) + marcadores visibles de los quiebres activos.
  const unitAtVertex = (j: number): UnitRow | undefined => {
    const idx = strat.src[j] ?? 0;
    return idx > 0 ? units[idx - 1] : undefined;
  };
  const breakTargetAtVertex = (j: number): UnitRow | undefined => {
    const idx = strat.src[j] ?? 0;
    return idx > 0 && idx < units.length ? units[idx] : undefined;
  };

  const points = useMemo<XYPointLayer[]>(() => {
    const layers: XYPointLayer[] = [
      {
        id: 'strat-pts',
        x: strat.x,
        y: strat.y,
        color: stratColor,
        dense: true,
        alpha: 0,
        radius: 2,
        interactive: true,
        label: (j) => {
          const idx = strat.src[j] ?? 0;
          if (idx <= 0) return 'Tope de la secuencia';
          if (idx >= units.length) {
            const last = units[units.length - 1];
            return last ? `Base de la secuencia (${depthNum(last.base)} m)` : 'Base de la secuencia';
          }
          const lower = units[idx]!;
          const mdKey = breakDepthKey(lower.top);
          const action = activeBreakSet.has(mdKey) ? 'clic para quitar quiebre' : 'clic para marcar quiebre';
          return `${lower.zone ? `${lower.zone} · ` : ''}${depthNum(lower.top)} m · ${action}`;
        },
      },
    ];
    if (resolved.breaks.length > 0) {
      layers.push({
        id: 'smlp-breaks',
        name: 'Quiebres SMLP',
        x: resolved.breaks.map((b) => b.xPct),
        y: resolved.breaks.map((b) => b.yPct),
        color: stratColor,
        radius: 4.5,
        interactive: true,
        label: (i) => {
          const b = resolved.breaks[i];
          return b ? `Quiebre ${b.upperLabel}/${b.lowerLabel} · ${depthNum(b.depth)} m · clic para quitar` : '';
        },
      });
    }
    return layers;
  }, [strat, units, stratColor, resolved.breaks, activeBreakSet]);

  if (summary.length === 0) {
    return <EmptyState size="sm" icon="table" title="Todavía no hay capacidad de flujo" description="El cálculo necesita porosidad efectiva y permeabilidad." />;
  }
  const row = summary.find((r) => zoneKey(r.zoneId) === key);
  const hasZones = !summary.every(isTotal);
  const canSegment = units.length > 1 && strat.n > 2;
  const pick = (k: string) => {
    setPicked(k);
    setHover(null);
  };

  const commitBreaks = (label: string, nextKeys: readonly string[]) => {
    if (!wellId) return;
    useProject.getState().commit(label, setZoneBreaksRecipe(wellId, key, nextKeys));
  };

  const toggleBreakAtDepth = (depth: number) => {
    const mdKey = breakDepthKey(depth);
    if (!mdKey) return;
    const baseKeys = resolved.breaks.map((b) => b.key);
    const removing = activeBreakSet.has(mdKey);
    const next = toggleDepthKey(baseKeys, mdKey);
    commitBreaks(
      removing ? `Quitar quiebre SMLP a ${depthNum(depth)} m` : `Marcar quiebre SMLP a ${depthNum(depth)} m`,
      next,
    );
  };

  const handlePlotClick = (layerId: string, idx: number) => {
    if (layerId === 'smlp-breaks') {
      const b = resolved.breaks[idx];
      if (b) toggleBreakAtDepth(b.depth);
      return;
    }
    if (layerId === 'strat-pts') {
      const target = breakTargetAtVertex(idx);
      if (target) {
        toggleBreakAtDepth(target.top);
      } else {
        const u = unitAtVertex(idx);
        if (u) goToUnit(u);
      }
    }
  };

  const handleSuggest = () => {
    if (!canSegment || !wellId) return;
    const maxSeg = Math.max(2, Number(maxSegments) || 5);
    const tol = SMLP_SENSITIVITY_TOLERANCE[sensitivity];
    const sug = suggestSmlpBreaks(units, { maxSegments: maxSeg, tolerance: tol });
    if (sug.breaks.length === 0) {
      commitBreaks('Limpiar quiebres SMLP (curva homogénea)', []);
      toast({
        tone: 'info',
        title: 'Curva prácticamente homogénea',
        description: 'No se detectaron quiebres de pendiente por encima de la tolerancia elegida.',
      });
      return;
    }
    const mdKeys = sug.breaks.map((i) => breakDepthKey(units[i]!.top)).filter(Boolean);
    commitBreaks(`Sugerir ${mdKeys.length} quiebre${mdKeys.length === 1 ? '' : 's'} SMLP`, mdKeys);
  };

  const handleClearBreaks = () => {
    if (!wellId) return;
    commitBreaks('Limpiar quiebres SMLP', []);
  };

  const handleCleanOrphans = () => {
    if (!wellId) return;
    useProject
      .getState()
      .commit(
        'Descartar quiebres SMLP que ya no coinciden',
        cleanOrphanBreaksRecipe(wellId, key, resolved.breaks.map((b) => b.key), validZoneKeys),
      );
  };

  const handleOverlayToggle = (enabled: boolean) => {
    if (!wellId) return;
    useProject.getState().commit(enabled ? 'Mostrar sub-unidades SMLP en el visor' : 'Ocultar sub-unidades SMLP del visor', setSmlpOverlayRecipe(wellId, enabled, key));
  };

  const handleSplitZone = (b: ResolvedSmlpBreak) => {
    if (!wellId) return;
    const { project, commit } = useProject.getState();
    const entry = activeWellEntry(project);
    if (!entry || entry.well.id !== wellId) return;
    const { zones } = entry.interpretation;
    const plan = planSplitZoneAtBreak(
      zones,
      entry.well.depth.values,
      b.depth,
      {
        id: makeId('zona'),
        name: defaultZoneName(zones),
        color: zoneColor(zones.length),
      },
      readFlowState(entry.interpretation),
    );
    if ('error' in plan) {
      toast({ tone: 'warn', title: 'No se pudo partir la zona', description: plan.error });
      return;
    }
    commit(`Partir zona ${plan.host.name} en quiebre SMLP (${depthNum(plan.created.top)} m)`, (p) => applySplitZoneAtBreak(p, wellId, plan));
    useUi.getState().set({ editingZoneId: plan.created.id });
    toast({
      tone: 'ok',
      title: `Zona «${plan.host.name}» partida en ${depthNum(plan.created.top)} m`,
      description: `Se creó «${plan.created.name}» con los parámetros heredados.`,
    });
  };

  const hoverBreak = hover?.layerId === 'smlp-breaks' ? resolved.breaks[hover.index] : undefined;
  const hoverStratUnit = hover?.layerId === 'strat-pts' ? unitAtVertex(hover.index) : undefined;
  const hoverBreakTarget = hover?.layerId === 'strat-pts' ? breakTargetAtVertex(hover.index) : undefined;

  const smlpColumns: Column<SmlpSubUnit>[] = [
    {
      key: 'label',
      header: 'Unid.',
      title: 'Sub-unidad hidráulica SMLP',
      render: (u) => (
        <span className="fcap-smlp-id">
          <span className="fcap-smlp-dot" style={{ background: ensureContrast(smlpCharacterColor(u.character, theme), theme.color.surface, 3) }} aria-hidden="true" />
          <span className="num">{u.label}</span>
        </span>
      ),
    },
    {
      key: 'depth',
      header: 'Tope–Base',
      title: 'Tope y base de la sub-unidad (m)',
      align: 'num',
      render: (u) => (
        <span className="fcap-stack">
          <span>{depthNum(u.top)}</span>
          <span className="fcap-sub">{depthNum(u.base)}</span>
        </span>
      ),
    },
    {
      key: 'h',
      header: 'Δh',
      title: 'Espesor acumulado de los tramos (m)',
      align: 'num',
      render: (u) => fmt(u.h, 1),
    },
    {
      key: 'phiHFrac',
      header: '%φ·h',
      title: 'Porcentaje de la capacidad de almacenaje total (% φ·h)',
      align: 'num',
      render: (u) => fmt(100 * u.phiHFrac, 1),
    },
    {
      key: 'kHFrac',
      header: '%k·h',
      title: 'Porcentaje de la capacidad de flujo total (% k·h)',
      align: 'num',
      render: (u) => fmt(100 * u.kHFrac, 1),
    },
    {
      key: 'slope',
      header: 'Pend.',
      title: 'Índice de flujo relativo (% k·h) / (% φ·h)',
      align: 'num',
      render: (u) => <span className="fcap-lc">{slopeDisplay(u.slope)}</span>,
    },
    {
      key: 'character',
      header: 'Carácter',
      title: 'Rótulo operativo según la pendiente SMLP',
      render: (u) =>
        u.character ? (
          <Badge tone={SMLP_CHARACTER_TONE[u.character]} title={`${SMLP_CHARACTER_LABEL[u.character]} (pendiente ${slopeDisplay(u.slope)})`}>
            {SMLP_CHARACTER_SHORT[u.character]}
          </Badge>
        ) : (
          <Badge tone="neutral">Sin aporte</Badge>
        ),
    },
  ];

  const sumPhiPct = resolved.subUnits.reduce((acc, s) => acc + (Number.isFinite(s.phiHFrac) ? 100 * s.phiHFrac : 0), 0);
  const sumKPct = resolved.subUnits.reduce((acc, s) => acc + (Number.isFinite(s.kHFrac) ? 100 * s.kHFrac : 0), 0);
  const hasNormalizedTotals = resolved.subUnits.some((s) => Number.isFinite(s.phiHFrac)) && resolved.subUnits.some((s) => Number.isFinite(s.kHFrac));

  const summaryProps = {
    dense: true,
    className: 'fcap-table',
    rows: summary,
    rowKey: (r: Row) => zoneKey(r.zoneId),
    selectedKey: key,
    onRowClick: (r: Row) => pick(zoneKey(r.zoneId)),
    rowProps: (r: Row) => ({ 'data-total': isTotal(r) && hasZones ? '' : undefined }),
  };
  const options = summary.map((r) => ({ value: zoneKey(r.zoneId), label: String(r.zone ?? '') }));
  const totalOrphans = resolved.orphanKeys.length;
  const anySavedBreaks = Object.values(flowState.breaksByZone).some((arr) => arr.length > 0);

  return (
    <div className="fcap" data-testid="flow-capacity-panel">
      {options.length > 1 && (
        <SegmentedControl
          aria-label="Zona"
          size="sm"
          wrap
          value={key}
          onChange={pick}
          options={options}
        />
      )}

      {row && (
        <div className="fcap-kpis">
          <div className="fcap-kpi">
            <div className="fcap-kpi__label" title="Coeficiente de Lorenz">Lorenz Lc</div>
            <div className="fcap-kpi__value num">{fmt(row.lc, 2)}</div>
            <div className="fcap-kpi__sub num">{fmt(row.units, 0)} tramos</div>
          </div>
          <div className="fcap-kpi">
            <div className="fcap-kpi__label" title="Capacidad de flujo">Flujo k·h</div>
            <div className="fcap-kpi__value num">
              {fmt(row.kH, 0)} <span className="fcap-kpi__unit">mD·m</span>
            </div>
            <div className="fcap-kpi__sub num">k {fmt(row.kMean, 1)} mD</div>
          </div>
          <div className="fcap-kpi">
            <div className="fcap-kpi__label" title="Capacidad de almacenaje">Almacenaje φ·h</div>
            <div className="fcap-kpi__value num">
              {fmt(row.phiH, 2)} <span className="fcap-kpi__unit">m</span>
            </div>
            <div className="fcap-kpi__sub num">
              en {fmt(row.h, 1)} m
            </div>
          </div>
        </div>
      )}

      <section className="fcap-block" aria-label="Curvas de Lorenz">
        <div className="fcap-legend">
          <span className="fcap-legend__item">
            <CurveSwatch style={{ color: stratColor, dash: [], width: 2, kind: 'line' }} width={18} />
            Estratigráfico (SMLP)
          </span>
          <span className="fcap-legend__item">
            <CurveSwatch style={{ color: orderedColor, dash: [], width: 1.5, kind: 'line' }} width={18} />
            Ordenado (k/φ)
          </span>
          <span className="fcap-legend__item">
            <CurveSwatch style={{ color: diagColor, dash: [4, 4], width: 1, kind: 'line' }} width={18} />
            Homogéneo
          </span>
        </div>
        <XYPlot
          x={X_AXIS}
          y={Y_AXIS}
          lines={lines}
          points={points}
          height={280}
          ariaLabel={`Curvas de Lorenz de ${String(row?.zone ?? 'la zona')}: capacidad de flujo acumulada contra capacidad de almacenaje acumulada`}
          emptyText="Sin tramos con φ y k para el filtro elegido."
          onPointHover={(layerId, j) => {
            if (layerId === 'strat-pts' || layerId === 'smlp-breaks') setHover({ layerId, index: j });
          }}
          onPointLeave={() => setHover(null)}
          onPointClick={handlePlotClick}
          figureId={`flow-capacity-lorenz-${key}`}
          figureTitle={`Lorenz SMLP · ${String(row?.zone ?? '')}`}
          data-testid="flow-capacity-lorenz"
        />
        <p className="fcap-readout num" aria-live="polite">
          {hoverBreak ? (
            <>
              Quiebre {hoverBreak.upperLabel}/{hoverBreak.lowerLabel} · {depthNum(hoverBreak.depth)} m · Fφh {fmt(hoverBreak.xPct, 1)} % · Fkh {fmt(hoverBreak.yPct, 1)} %
              <span className="fcap-readout__hint"> · clic para quitar</span>
            </>
          ) : hoverBreakTarget ? (
            <>
              {depthNum(hoverBreakTarget.top)} m
              {hoverBreakTarget.zone && hasZones && key === TOTAL_KEY ? ` (${hoverBreakTarget.zone})` : ''} · φ {fmt(hoverBreakTarget.phi, 3)} · k {fmt(hoverBreakTarget.k, 1)} mD
              <span className="fcap-readout__hint">
                {activeBreakSet.has(breakDepthKey(hoverBreakTarget.top)) ? ' · clic para quitar quiebre' : ' · clic para marcar quiebre'}
              </span>
            </>
          ) : hoverStratUnit ? (
            <>
              Base de la secuencia · {depthText(hoverStratUnit)} m
              <span className="fcap-readout__hint"> · elegí un punto intermedio para marcar un quiebre</span>
            </>
          ) : (
            <span className="fcap-readout__hint">
              Clic sobre la curva estratigráfica para marcar o quitar quiebres SMLP.
            </span>
          )}
        </p>
      </section>

      <section className="fcap-block fcap-smlp" aria-label="Unidades hidráulicas SMLP" data-testid="flow-capacity-smlp">
        <div className="fcap-smlp__head">
          <h4 className="fcap-block__title">
            Unidades hidráulicas <span className="fcap-block__unit">SMLP · {String(row?.zone ?? '')}</span>
          </h4>
          <Switch
            checked={anySavedBreaks && flowState.overlayEnabled}
            onChange={handleOverlayToggle}
            disabled={!anySavedBreaks}
            label="En el visor"
            aria-label="Mostrar sub-unidades SMLP en el visor"
          />
        </div>

        <div className="fcap-smlp__controls">
          <Select
            size="sm"
            aria-label="Cantidad máxima de unidades SMLP"
            value={maxSegments}
            onChange={setMaxSegments}
            options={MAX_SEGMENT_OPTIONS}
          />
          <Select
            size="sm"
            aria-label="Sensibilidad de detección de quiebres"
            value={sensitivity}
            onChange={(v) => setSensitivity(v as SmlpSensitivity)}
            options={SENSITIVITY_OPTIONS}
          />
          <Button
            size="sm"
            variant="secondary"
            icon="layers"
            onClick={handleSuggest}
            disabled={!canSegment}
            data-testid="smlp-suggest"
            title="Ajusta tramos lineales sobre la curva estratigráfica Fkh(Fφh) para sugerir quiebres hidráulicos"
          >
            Sugerir quiebres
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="x"
            onClick={handleClearBreaks}
            disabled={savedKeys.length === 0}
            className="fcap-smlp__clear"
            data-testid="smlp-clear"
          >
            Limpiar
          </Button>
        </div>

        {(totalOrphans > 0 || staleZoneKeys.length > 0) && (
          <p className="fcap-note fcap-note--warn" data-testid="smlp-orphans">
            {totalOrphans > 0
              ? totalOrphans === 1
                ? 'Un quiebre guardado ya no coincide con la zona o el filtro actuales.'
                : `${totalOrphans} quiebres guardados ya no coinciden con la zona o el filtro actuales.`
              : `${staleZoneKeys.length} zona${staleZoneKeys.length === 1 ? '' : 's'} borrada${staleZoneKeys.length === 1 ? '' : 's'} todavía tenía${staleZoneKeys.length === 1 ? '' : 'n'} quiebres guardados.`}{' '}
            <button type="button" className="fcap-link" onClick={handleCleanOrphans}>
              Descartar
            </button>
          </p>
        )}

        <DataTable<SmlpSubUnit>
          dense
          className="fcap-table fcap-smlp-table"
          data-testid="flow-capacity-smlp-table"
          rows={resolved.subUnits}
          rowKey={(u) => u.label}
          onRowClick={(u) => goToRange(u.top, u.base)}
          columns={smlpColumns}
          empty="Sin tramos suficientes para definir sub-unidades."
        />

        {hasNormalizedTotals && resolved.subUnits.length > 0 && (
          <div className="fcap-smlp__totals num" data-testid="smlp-totals">
            <span>
              {resolved.subUnits.length} {resolved.subUnits.length === 1 ? 'unidad' : 'unidades'}
              {resolved.breaks.length > 0 ? ` · ${resolved.breaks.length} quiebre${resolved.breaks.length === 1 ? '' : 's'}` : ''}
            </span>
            <span>
              Σ φ·h {fmt(sumPhiPct, 1)} % · Σ k·h {fmt(sumKPct, 1)} %
            </span>
          </div>
        )}

        {resolved.breaks.length > 0 && (
          <ul className="fcap-breaks" aria-label="Quiebres SMLP activos" data-testid="smlp-breaks-list">
            {resolved.breaks.map((b) => {
              const host = findSplittableHostZone(interpretation.zones, b.depth);
              return (
                <li key={b.key} className="fcap-break">
                  <button
                    type="button"
                    className="fcap-break__jump num"
                    onClick={() => goToRange(b.depth, b.depth)}
                    title={`Ir a ${depthNum(b.depth)} m en el visor`}
                  >
                    <span className="fcap-break__tag">{b.upperLabel}/{b.lowerLabel}</span>
                    <span>{depthNum(b.depth)} m</span>
                  </button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleSplitZone(b)}
                    disabled={!host}
                    data-testid={`smlp-split-${b.key}`}
                    title={
                      host
                        ? `Partir la zona «${host.name}» en ${depthNum(b.depth)} m (se deshace con Ctrl+Z)`
                        : 'El quiebre no cae en el interior de una zona definida.'
                    }
                  >
                    Partir zona
                  </Button>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    icon="x"
                    label={`Quitar quiebre a ${depthNum(b.depth)} m`}
                    onClick={() => toggleBreakAtDepth(b.depth)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <p className="fcap-note">
          Clic en una sub-unidad para encuadrarla en el visor. Umbrales operativos de carácter: Conducto &gt; 1,3 · Homogéneo 0,7–1,3 · Subordinado 0,3–0,7 · Barrera / Sello parcial &lt; 0,3.
        </p>
      </section>

      <section className="fcap-block" aria-label="Capacidades por zona">
        <h4 className="fcap-block__title">Capacidades por zona</h4>
        <DataTable<Row> {...summaryProps} data-testid="flow-capacity-summary" columns={CAPACITY_COLUMNS} />
      </section>

      <section className="fcap-block" aria-label="Promedios y heterogeneidad por zona">
        <h4 className="fcap-block__title">Promedios y heterogeneidad</h4>
        <DataTable<Row> {...summaryProps} data-testid="flow-capacity-means" columns={MEAN_COLUMNS} />
      </section>

      <section className="fcap-block" aria-label="Tramos">
        <h4 className="fcap-block__title">
          Tramos <span className="fcap-block__unit">{String(row?.zone ?? '')} · de arriba hacia abajo</span>
        </h4>
        <DataTable<UnitRow>
          dense
          className="fcap-table"
          data-testid="flow-capacity-units"
          maxHeight={320}
          rows={units.length > shown ? units.slice(0, shown) : units}
          rowKey={(u) => String(u.seq)}
          onRowClick={goToUnit}
          selectedKey={hoverBreakTarget ? String(hoverBreakTarget.seq) : hoverStratUnit ? String(hoverStratUnit.seq) : null}
          columns={unitColumns(key === TOTAL_KEY && hasZones)}
          empty="Sin tramos con φ y k para el filtro elegido."
        />
        {units.length > shown && (
          <div className="fcap-more">
            <span className="fcap-note num">
              {formatNumber(shown, { digits: 0 })} de {formatNumber(units.length, { digits: 0 })} tramos
            </span>
            <Button size="sm" variant="ghost" onClick={() => setLimit({ key, n: shown + PAGE * 5 })}>
              Ver {formatNumber(Math.min(PAGE * 5, units.length - shown), { digits: 0 })} más
            </Button>
          </div>
        )}
      </section>
      <p className="fcap-note">Clic en un tramo para verlo en el visor. Con «Muestras por tramo» se agrupan muestras consecutivas; el coeficiente de Lorenz depende de esa resolución.</p>
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'flow-capacity', component: FlowCapacityPanel };
