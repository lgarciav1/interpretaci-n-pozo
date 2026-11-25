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
import { conversionCoefficients, convert, unitLabel } from '../../core/units';
import { PRESSURE_COLUMNS } from '../../io/pressures';
import {
  APPARENT_DENSITY_COMPARTMENT_LIMIT,
  BRINE_REFERENCE_DENSITY,
  EMW_UNITS,
  HYDROSTATIC_NORMAL_DENSITY,
  equivalentMudWeight,
  type EmwUnit,
} from '../../petro/pressure';
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
  contactPressurePsi,
  decisionFor,
  DISPLAY_UNITS,
  EXCESS_RHO_MAX,
  EXCESS_RHO_MIN,
  FLUID_COLOR,
  FLUID_LABEL,
  FLUIDS,
  MDT_OVERLAY_ID,
  MDT_PROVIDER_ID,
  mdtAxisValue,
  minMobilityOf,
  MIN_MOBILITY_SETTING,
  mdtSeriesKey,
  parseMdtAxisSettings,
  pointStatuses,
  pressureSets,
  QUALITY_REASON_LABEL,
  resolveExcessRef,
  summarizeMdtZones,
  type DisplayUnit,
  type ExcessAnchor,
  type Fluid,
  type FluidContact,
  type MdtAxisMode,
  type MdtAxisSettings,
  type MdtZonesReport,
  type ResolvedExcessReference,
} from './model';
import { formatDrawdown, pointColorOf, type MdtPointColor } from './draw';
import { activeWaterDensity, mdtAnalysis, pointRef, type MdtAnalysis, type MdtGradient } from './series';
import '../../app/components/load-well.css';
import './mdt.css';

const UNIT_DIGITS: Record<DisplayUnit, number> = { psi: 1, bar: 2, kPa: 0, 'kgf/cm2': 2 };
const m1 = (d: number) => formatNumber(d, { digits: 1 });

function pressurePsiOf(set: PointSet, raw: number): number {
  const c = set.columns['pressure'];
  const u = c && 'unit' in c && typeof c.unit === 'string' ? c.unit : 'psi';
  if (u === 'psi' || !Number.isFinite(raw)) return raw;
  try {
    return convert(raw, u, 'psi');
  } catch {
    return raw;
  }
}

function formatSignedUnit(value: number, unit: DisplayUnit): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value, { digits: UNIT_DIGITS[unit] })}`;
}

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
  const sets = useMemo(() => (well ? pressureSets(well.pointSets) : []), [well]);
  const set = sets.find((s) => s.id === picked) ?? sets[0] ?? null;
  const axis = useMemo(() => parseMdtAxisSettings(settings), [settings]);
  const waterDens = useMemo(() => (well && interp ? activeWaterDensity(well, interp) : null), [well, interp]);
  const excessResolved = useMemo(
    () => (sets.length > 0 && interp ? resolveExcessRef(sets, interp.pointSets, axis, waterDens) : null),
    [sets, interp, axis, waterDens],
  );
  const zoneReport = useMemo(
    () =>
      set && interp && excessResolved
        ? summarizeMdtZones(set, interp.pointSets[set.id], interp.zones, {
            rhoRef: axis.axisMode === 'excess' ? excessResolved.ref.rhoRef : HYDROSTATIC_NORMAL_DENSITY,
            originZoneColumn: TP_MDT_ZONE_COLUMN,
          })
        : null,
    [set, interp, axis.axisMode, excessResolved],
  );

  const dialog = loading && <LoadPressuresDialog onClose={() => setLoading(false)} onExample={loadExample} onTp={loadTpPressures} />;
  if (!entry || !well || !interp || !analysis) {
    return <EmptyState size="sm" icon="droplet" title="Sin pozo" description="Cargá un pozo para sumarle presiones de formación (MDT, RFT)." />;
  }
  if (!set || !excessResolved || !zoneReport) {
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
  return (
    <div className="mdt">
      <MdtBar
        set={set}
        sets={sets}
        axis={axis}
        excessResolved={excessResolved}
        pointColor={pointColorOf(settings)}
        onPick={setPicked}
        onLoad={() => setLoading(true)}
      />
      <div className="mdt-body">
        <PointsTable key={`${well.id}:${set.id}`} set={set} analysis={analysis} axis={axis} excessResolved={excessResolved} />
        <aside className="mdt-side">
          {axis.axisMode !== 'pressure' && <ZoneEmwSummary report={zoneReport} axis={axis} />}
          <Gradients set={set} analysis={analysis} />
          <Contacts
            contacts={analysis.contacts.filter((c) => analysis.gradients.some((g) => g.setId === set.id && g.spec.id === c.upper.id))}
            axis={axis}
            excessResolved={excessResolved}
            wellId={well.id}
          />
          {axis.axisMode === 'pressure' && <ZoneEmwSummary report={zoneReport} axis={axis} />}
        </aside>
      </div>
      {dialog}
    </div>
  );
}

// ── barra superior ──────────────────────────────────────────────────────────────────────────────────────────

const AXIS_MODE_OPTIONS: readonly { value: MdtAxisMode; label: string }[] = [
  { value: 'pressure', label: 'Presión' },
  { value: 'excess', label: 'Exceso' },
  { value: 'emw', label: 'EMW' },
];

const ANCHOR_OPTIONS: readonly { value: ExcessAnchor; label: string }[] = [
  { value: 'first', label: '1.ª' },
  { value: 'zero', label: '0' },
];

function MdtBar({
  set,
  sets,
  axis,
  excessResolved,
  pointColor,
  onPick,
  onLoad,
}: {
  set: PointSet;
  sets: PointSet[];
  axis: MdtAxisSettings;
  excessResolved: ResolvedExcessReference;
  pointColor: MdtPointColor;
  onPick(id: string): void;
  onLoad(): void;
}) {
  const interp = useProject((s) => selectActiveEntry(s)?.interpretation);
  const dec = interp?.pointSets[set.id];
  const tvd = pointNumbers(set, 'tvd');
  const hasTvd = !!tvd?.some(Number.isFinite);
  let maxDev = 0;
  if (tvd) for (let i = 0; i < tvd.length; i++) if (Number.isFinite(tvd[i]!)) maxDev = Math.max(maxDev, Math.abs(set.depth[i]! - tvd[i]!));

  const setRhoManual = (rho: number, label: string) => {
    useProject.getState().commit(label, (p) => {
      let next = setOverlaySetting(p, MDT_OVERLAY_ID, 'excessRhoSource', undefined);
      next = setOverlaySetting(next, MDT_OVERLAY_ID, 'excessRhoRef', Math.abs(rho - HYDROSTATIC_NORMAL_DENSITY) < 1e-9 ? undefined : rho);
      return next;
    });
  };

  const setWaterPreset = () => {
    useProject.getState().commit('Usar densidad del gradiente de agua en exceso de presión', (p) =>
      setOverlaySetting(p, MDT_OVERLAY_ID, 'excessRhoSource', 'water'),
    );
  };

  const resetToFirstTest = () => {
    useProject.getState().commit('Centrar exceso de presión en la primera prueba', (p) => {
      let next = setOverlaySetting(p, MDT_OVERLAY_ID, 'excessZ0', undefined);
      next = setOverlaySetting(next, MDT_OVERLAY_ID, 'excessAnchor', undefined);
      return next;
    });
  };

  const setSurfaceDatum = () => {
    useProject.getState().commit('Usar datum de superficie en exceso de presión', (p) => {
      let next = setOverlaySetting(p, MDT_OVERLAY_ID, 'excessZ0', 0);
      next = setOverlaySetting(next, MDT_OVERLAY_ID, 'excessAnchor', 'zero');
      return next;
    });
  };

  const isFresh = excessResolved.rhoSource === 'manual' && Math.abs(excessResolved.ref.rhoRef - HYDROSTATIC_NORMAL_DENSITY) < 1e-6;
  const isBrine = excessResolved.rhoSource === 'manual' && Math.abs(excessResolved.ref.rhoRef - BRINE_REFERENCE_DENSITY) < 1e-6;
  const isSurfaceDatum = Math.abs(excessResolved.ref.z0) < 1e-6;
  const isSurfaceRef = isSurfaceDatum && axis.excessAnchor === 'zero';
  const isAutoFirstRef = axis.excessZ0 === null && axis.excessAnchor === 'first';
  const [pA, pB] = conversionCoefficients('psi', axis.unit);
  const p0Display = excessResolved.ref.p0 * pA + pB;

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
        <SegmentedControl
          size="sm"
          aria-label="Modo de eje X"
          value={axis.axisMode}
          onChange={(mode) =>
            useProject.getState().commit('Cambiar modo de eje X de MDT', (p) => setOverlaySetting(p, MDT_OVERLAY_ID, 'axisMode', mode === 'pressure' ? undefined : mode))
          }
          options={AXIS_MODE_OPTIONS}
        />
        {axis.axisMode === 'emw' ? (
          <SegmentedControl
            size="sm"
            aria-label="Unidad de EMW"
            value={axis.emwUnit}
            onChange={(u: EmwUnit) =>
              useProject.getState().commit('Cambiar la unidad de EMW', (p) => setOverlaySetting(p, MDT_OVERLAY_ID, 'emwUnit', u === 'lb/gal' ? undefined : u))
            }
            options={EMW_UNITS.map((u) => ({ value: u, label: unitLabel(u) }))}
          />
        ) : (
          <SegmentedControl
            size="sm"
            aria-label="Unidad de presión"
            value={axis.unit}
            onChange={(u) => useProject.getState().commit('Cambiar la unidad de presión', (p) => setOverlaySetting(p, MDT_OVERLAY_ID, 'unit', u === 'psi' ? undefined : u))}
            options={DISPLAY_UNITS.map((u) => ({ value: u, label: unitLabel(u) }))}
          />
        )}
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
      {axis.axisMode === 'excess' && (
        <div className="mdt-subbar" role="region" aria-label="Referencia de exceso de presión">
          <label className="mdt-bar__field">
            <span title="Densidad de la columna hidrostática de referencia">ρ ref</span>
            <NumberField
              size="sm"
              width={86}
              aria-label="Densidad de referencia para exceso de presión (g/cm³)"
              value={Number(excessResolved.ref.rhoRef.toFixed(3))}
              min={EXCESS_RHO_MIN}
              max={EXCESS_RHO_MAX}
              step={0.01}
              unit="g/cm³"
              onChange={(v) => setRhoManual(v, 'Cambiar densidad de referencia de exceso')}
            />
          </label>
          <div className="mdt-subbar__presets" role="group" aria-label="Presets de densidad de referencia">
            <Button size="sm" variant={isFresh ? 'primary' : 'secondary'} aria-pressed={isFresh} onClick={() => setRhoManual(HYDROSTATIC_NORMAL_DENSITY, 'Usar agua dulce como referencia')}>
              Agua dulce (1,00)
            </Button>
            <Button size="sm" variant={isBrine ? 'primary' : 'secondary'} aria-pressed={isBrine} onClick={() => setRhoManual(BRINE_REFERENCE_DENSITY, 'Usar salmuera como referencia')}>
              Salmuera (1,07)
            </Button>
            <Button
              size="sm"
              variant={excessResolved.rhoSource === 'water' ? 'primary' : 'secondary'}
              aria-pressed={excessResolved.rhoSource === 'water'}
              disabled={excessResolved.waterDensity === null}
              title={
                excessResolved.waterDensity !== null
                  ? `Usar la densidad del gradiente de agua activo (${formatNumber(excessResolved.waterDensity, { digits: 3 })} g/cm³) para dibujar el acuífero vertical`
                  : 'Trazá primero un gradiente visible de agua para habilitar este preset'
              }
              onClick={setWaterPreset}
            >
              Gradiente agua
              {excessResolved.waterDensity !== null ? ` (${formatNumber(excessResolved.waterDensity, { digits: 2 })})` : ''}
            </Button>
          </div>
          <label className="mdt-bar__field">
            <span title="Profundidad de referencia z₀ (por defecto tope de las pruebas incluidas)">z₀</span>
            <NumberField
              size="sm"
              width={92}
              aria-label="Profundidad de referencia z0 (m)"
              value={Number(excessResolved.ref.z0.toFixed(1))}
              min={0}
              max={20000}
              step={1}
              unit="m"
              onChange={(v) =>
                useProject.getState().commit('Cambiar profundidad de referencia z0', (p) => {
                  let next = setOverlaySetting(p, MDT_OVERLAY_ID, 'excessZ0', v);
                  next = setOverlaySetting(next, MDT_OVERLAY_ID, 'excessAnchor', 'zero');
                  return next;
                })
              }
            />
          </label>
          <label className="mdt-bar__field">
            <span title="Presión de referencia en z₀: anclada a la primera prueba incluida para centrar en 0, o igual a 0">P₀</span>
            <SegmentedControl
              size="sm"
              aria-label="Presión de referencia P0"
              value={axis.excessAnchor}
              onChange={(a) =>
                useProject.getState().commit('Cambiar anclaje de exceso de presión', (p) => {
                  if (a === 'first') {
                    let next = setOverlaySetting(p, MDT_OVERLAY_ID, 'excessZ0', undefined);
                    next = setOverlaySetting(next, MDT_OVERLAY_ID, 'excessAnchor', undefined);
                    return next;
                  }
                  return setOverlaySetting(p, MDT_OVERLAY_ID, 'excessAnchor', 'zero');
                })
              }
              options={ANCHOR_OPTIONS}
            />
          </label>
          <div className="mdt-subbar__presets">
            {!isAutoFirstRef && (
              <Button size="sm" variant="ghost" onClick={resetToFirstTest} title="Restablecer z₀ y P₀ a la primera prueba incluida (centrado en 0)">
                Centrar en 1.ª
              </Button>
            )}
            <Button
              size="sm"
              variant={isSurfaceRef ? 'primary' : 'ghost'}
              aria-pressed={isSurfaceRef}
              onClick={setSurfaceDatum}
              title="Referir a columna hidrostática desde superficie (z₀ = 0 m, P₀ = 0)"
            >
              Superficie (0 m)
            </Button>
          </div>
          <span className="mdt-subbar__meta num">
            z₀ {m1(excessResolved.ref.z0)} m · P₀ {formatNumber(p0Display, { digits: UNIT_DIGITS[axis.unit] })} {unitLabel(axis.unit)}
          </span>
          {excessResolved.hasActiveWaterFallback && (
            <Badge tone="warn">Sin gradiente de agua activo: usando {formatNumber(excessResolved.ref.rhoRef, { digits: 2 })} g/cm³</Badge>
          )}
        </div>
      )}
      {maxDev > 1 && (
        <Callout tone="warn" className="mdt-callout">
          El pozo es desviado (TVD difiere de MD hasta {m1(maxDev)} m): gradientes, exceso de presión y EMW se calculan contra MD y las densidades salen subestimadas. Usalas con cautela.
        </Callout>
      )}
      {maxDev <= 1 && axis.axisMode === 'emw' && !hasTvd && (
        <Callout tone="warn" className="mdt-callout">
          EMW calculada sobre MD con datum en superficie (z = 0): este conjunto no trae columna TVD ni cota de referencia verificada. Asumí pozo vertical y datum en superficie al interpretar la sobrepresión.
        </Callout>
      )}
      {maxDev <= 1 && axis.axisMode === 'emw' && hasTvd && (
        <Callout tone="info" className="mdt-callout">
          EMW referida al datum de superficie (z = 0) sobre MD (pozo vertical, desvío ≤ 1 m). Verificá que el datum coincida con la referencia del lodo.
        </Callout>
      )}
      {maxDev <= 1 && axis.axisMode === 'excess' && !hasTvd && (
        <Callout tone={isSurfaceDatum ? 'warn' : 'info'} className="mdt-callout">
          {isSurfaceDatum
            ? 'Exceso de presión calculado sobre MD con datum en superficie (z₀ = 0): sin columna TVD ni cota de referencia verificada, asumí pozo vertical y datum en superficie.'
            : 'Exceso de presión calculado sobre MD (sin columna TVD): la proyección preserva exactamente los gradientes y contactos asumiendo pozo vertical.'}
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

function PointsTable({
  set,
  analysis,
  axis,
  excessResolved,
}: {
  set: PointSet;
  analysis: MdtAnalysis;
  axis: MdtAxisSettings;
  excessResolved: ResolvedExcessReference;
}) {
  const unit = axis.unit;
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
      render: (r) => {
        const pPsi = p ? pressurePsiOf(set, p[r.i]!) : NaN;
        return formatNumber(Number.isFinite(pPsi) ? pPsi * a + b : NaN, { digits: UNIT_DIGITS[unit] });
      },
    },
    ...(axis.axisMode === 'excess'
      ? [
          {
            key: 'excess',
            header: `Exceso P (${unitLabel(unit)})`,
            title: `Exceso de presión respecto de ${formatNumber(excessResolved.ref.rhoRef, { digits: 2 })} g/cm³`,
            align: 'num' as const,
            render: (r: PointRow) => {
              const pPsi = p ? pressurePsiOf(set, p[r.i]!) : NaN;
              const v = mdtAxisValue(pPsi, depth[r.i]!, axis, excessResolved.ref);
              return formatSignedUnit(v, unit);
            },
          } satisfies Column<PointRow>,
        ]
      : axis.axisMode === 'emw'
        ? [
            {
              key: 'emw',
              header: `EMW (${unitLabel(axis.emwUnit)})`,
              title: 'Densidad equivalente de lodo referida al datum de superficie (z = 0)',
              align: 'num' as const,
              render: (r: PointRow) => {
                const pPsi = p ? pressurePsiOf(set, p[r.i]!) : NaN;
                const emwPrimary = equivalentMudWeight(pPsi, depth[r.i]!, { pressureUnit: 'psi', densityUnit: axis.emwUnit });
                const otherUnit: EmwUnit = axis.emwUnit === 'lb/gal' ? 'g/cm3' : 'lb/gal';
                const emwOther = equivalentMudWeight(pPsi, depth[r.i]!, { pressureUnit: 'psi', densityUnit: otherUnit });
                return (
                  <span title={Number.isFinite(emwOther) ? `${formatNumber(emwOther, { digits: 2 })} ${unitLabel(otherUnit)}` : undefined}>
                    {formatNumber(emwPrimary, { digits: 2 })}
                  </span>
                );
              },
            } satisfies Column<PointRow>,
          ]
        : []),
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
  if (Number.isFinite(g.density) && g.density > APPARENT_DENSITY_COMPARTMENT_LIMIT) {
    return (
      <Badge
        tone="error"
        icon="warning"
        title={`Densidad aparente de ${formatNumber(g.density, { digits: 3 })} g/cm³ (> 1,25 g/cm³): excede una columna continua de salmuera y sugiere compartimentalización o sobrepresión escalonada`}
      >
        Posible compartimento
      </Badge>
    );
  }
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

function Contacts({
  contacts,
  axis,
  excessResolved,
  wellId,
}: {
  contacts: FluidContact[];
  axis: MdtAxisSettings;
  excessResolved: ResolvedExcessReference;
  wellId: string;
}) {
  const unit = axis.unit;
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
            const pPsi = contactPressurePsi(c);
            const color = c.lower.fluid ? ensureContrast(FLUID_COLOR[theme.name][c.lower.fluid], theme.color.surface, 3) : theme.color.textMuted;
            const extraReadout =
              depth !== null && Number.isFinite(pPsi)
                ? axis.axisMode === 'excess'
                  ? `Exceso ${formatSignedUnit(mdtAxisValue(pPsi, depth, axis, excessResolved.ref), unit)} ${unitLabel(unit)}`
                  : axis.axisMode === 'emw'
                    ? `EMW ${formatNumber(equivalentMudWeight(pPsi, depth, { pressureUnit: 'psi', densityUnit: axis.emwUnit }), { digits: 2 })} ${unitLabel(axis.emwUnit)}`
                    : null
                : null;
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
                        {formatNumber(pPsi * a + b, { digits: UNIT_DIGITS[unit] })} {unitLabel(unit)}
                        {extraReadout ? ` · ${extraReadout}` : ''}
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

// ── EMW y compartimentos por zona ───────────────────────────────────────────────────────────────────────────

function ZoneEmwSummary({ report, axis }: { report: MdtZonesReport; axis: MdtAxisSettings }) {
  const [uA] = conversionCoefficients('psi', axis.unit);
  const showLb = axis.emwUnit === 'lb/gal';
  const fmtEmw = (gCm3: number, lbGal: number) =>
    showLb
      ? `${formatNumber(lbGal, { digits: 2 })} lb/gal (${formatNumber(gCm3, { digits: 2 })} g/cm³)`
      : `${formatNumber(gCm3, { digits: 2 })} g/cm³ (${formatNumber(lbGal, { digits: 2 })} lb/gal)`;

  return (
    <section className="mdt-section" aria-label="EMW y compartimentos por zona" data-testid="mdt-zone-summary">
      <header className="mdt-section__head">
        <h3>EMW y zonas</h3>
        {report.overall.n > 0 && Number.isFinite(report.overall.emwMeanGCm3) && (
          <span className="mdt-zone__overall num" title="Densidad equivalente media de todas las pruebas incluidas (datum z = 0)">
            {showLb
              ? `${formatNumber(report.overall.emwMeanLbGal, { digits: 2 })} lb/gal`
              : `${formatNumber(report.overall.emwMeanGCm3, { digits: 2 })} g/cm³`}
            {report.overall.overpressured && (
              <Badge tone="warn" title="EMW media superior a 1,20 g/cm³ (10,0 lb/gal): formación sobrepresionada">
                Sobrepresión
              </Badge>
            )}
          </span>
        )}
      </header>
      {report.zones.length === 0 ? (
        <p className="mdt-empty">No hay pruebas incluidas con presión y profundidad válidas.</p>
      ) : (
        <ul className="mdt-zones">
          {report.zones.map((z) => {
            const jumpVal = z.maxJump ? z.maxJump.deltaExcessPsi * uA : NaN;
            const showJump = z.maxJump !== null && (z.compartmentAlert || Math.abs(z.maxJump.deltaExcessPsi) >= 10);
            const emwRangeTitle =
              Number.isFinite(z.emwMinLbGal) && Number.isFinite(z.emwMaxLbGal)
                ? `Rango EMW: ${formatNumber(z.emwMinLbGal, { digits: 2 })}–${formatNumber(z.emwMaxLbGal, { digits: 2 })} lb/gal (${formatNumber(z.emwMinGCm3, { digits: 2 })}–${formatNumber(z.emwMaxGCm3, { digits: 2 })} g/cm³)`
                : undefined;
            return (
              <li key={z.key} className={`mdt-zone${z.compartmentAlert ? ' is-alert' : ''}`}>
                <div className="mdt-zone__head">
                  <button
                    type="button"
                    className="mdt-zone__go"
                    title="Ver zona en el visor"
                    onClick={() => Number.isFinite(z.top) && Number.isFinite(z.base) && useTrendsUi.getState().requestRange(z.top - 10, z.base + 10)}
                  >
                    {z.source === 'interpreted' || z.source === 'origin' ? `Zona ${z.name}` : z.name}
                  </button>
                  <span className="mdt-zone__count num">n {z.n}</span>
                  <span className="shell-spacer" />
                  {z.compartmentAlert ? (
                    <Badge
                      tone="error"
                      icon="warning"
                      title={`Densidad aparente zonal de ${formatNumber(z.apparentDensityGCm3, { digits: 3 })} g/cm³ (> 1,25 g/cm³): sugiere compartimentalización o sobrepresión escalonada`}
                    >
                      Posible compartimentalización
                    </Badge>
                  ) : z.invertedAlert ? (
                    <Badge tone="warn" icon="warning" title="Pendiente nula o negativa: posible depleción o salto entre compartimentos">
                      Gradiente invertido
                    </Badge>
                  ) : z.n === 2 ? (
                    <Badge tone="neutral" title="Con solo 2 pruebas la recta pasa exactamente por ambos puntos (R² = 1)">
                      2 pruebas
                    </Badge>
                  ) : z.n === 1 ? (
                    <Badge tone="neutral">1 prueba</Badge>
                  ) : !Number.isFinite(z.apparentDensityGCm3) ? (
                    <Badge tone="neutral" title="Todas las pruebas están a la misma profundidad: no define gradiente">
                      Sin ajuste
                    </Badge>
                  ) : (
                    <Badge tone="ok" title="Densidad aparente compatible con una columna continua">
                      Continua
                    </Badge>
                  )}
                </div>
                <div className="mdt-zone__metrics num">
                  <span title={emwRangeTitle}>
                    EMW <strong>{Number.isFinite(z.emwMeanGCm3) ? fmtEmw(z.emwMeanGCm3, z.emwMeanLbGal) : '—'}</strong>
                  </span>
                  {Number.isFinite(z.apparentDensityGCm3) && (
                    <span
                      className={z.compartmentAlert ? 'mdt-zone__dens is-alert' : 'mdt-zone__dens'}
                      title={`Ajuste zonal: ${formatGradientValue(z.gradientPsiPerFt)} psi/ft · R² ${formatR2(z.r2)}`}
                    >
                      ρ ap. <strong>{formatNumber(z.apparentDensityGCm3, { digits: 2 })}</strong> g/cm³
                    </span>
                  )}
                </div>
                {showJump && z.maxJump && (
                  <div className="mdt-zone__jump num">
                    <span>
                      Salto máx.{' '}
                      <strong>
                        {formatSignedUnit(jumpVal, axis.unit)} {unitLabel(axis.unit)}
                      </strong>
                    </span>
                    <button
                      type="button"
                      className="mdt-zone__jump-go"
                      title="Acercar el visor al salto entre pruebas"
                      onClick={() => useTrendsUi.getState().requestRange(z.maxJump!.topDepth - 18, z.maxJump!.baseDepth + 18)}
                    >
                      {m1(z.maxJump.topDepth)}–{m1(z.maxJump.baseDepth)} m
                    </button>
                  </div>
                )}
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
