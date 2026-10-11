/**
 * Pestaña «Agua de formación» del dock (docs/decisiones/0017): salinidad de NaCl equivalente, temperatura y Rw —
 * completados dos, se calcula el tercero—; temperatura del perfil del pozo (curva TEMP o gradiente del proyecto) o
 * escrita a mano; Rw en el tope de cada zona y a lo largo del pozo; «Usar como Rw manual» (una sola entrada de
 * deshacer). La cuenta está en `src/petro/brine.ts`; la lógica sin interfaz, en `model.ts`. Las ecuaciones no se
 * muestran acá: están en `docs.ts` para el módulo Ecuaciones. Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { canonicalCurveData } from '../../core/canonical';
import { chooseModuleSource, commitPlotParams, useEngineSources } from '../../app/plots/connect';
import { computedCurves } from '../../app/computed';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { registry } from '../../modules';
import { naclResistivityC, naclSalinityFromResistivityC, naclTemperatureC, SALINITY_RANGE_PPM, TEMPERATURE_EXTRAPOLATION_C, waterWarnings, type WaterWarning } from '../../petro/brine';
import { inactiveDriver, PLOT_PARAMS, plotParamValue, storedParamValue } from '../../plots/params';
import { niceRange } from '../../plots/xy/axes';
import { XYPlot } from '../../plots/xy/XYPlot';
import { paramStorageKey } from '../../core/params';
import { Badge, Button, Callout, DataTable, EmptyState, formatNumber, NumberField, SegmentedControl, Section, toast, useThemeTokens, type Column } from '../../ui';
import type { DockPanelDef } from '../../ui/dockPanel';
import tempGradient from '../temp-gradient';
import { chooseTempProfile, manualRwWrite, rwDepthSeries, temperatureAt, TEMP_SOURCE_LABEL, zoneTopRows, type GradientParams, type ZoneRwRow } from './model';
import './formation-water.css';

export const FORMATION_WATER_DOCK_ID = 'formation-water';

type Unknown = 'rw' | 'salinity' | 'temperature';
type TempFrom = 'profile' | 'manual';

interface CalcState {
  /** Cuál de los tres valores se calcula. */
  solve: Unknown;
  salinity: number;
  rw: number;
  /** Temperatura escrita a mano (°C). */
  tempManual: number;
  tempFrom: TempFrom;
  /** Profundidad (m) de la temperatura del perfil; null = la mitad del pozo. */
  depth: number | null;
  set(patch: Partial<Omit<CalcState, 'set'>>): void;
}

/** Estado de la calculadora: de interfaz, no se guarda en el proyecto (lo que sí se guarda es el Rw que se usa). */
export const useWaterCalc = create<CalcState>((set) => ({
  solve: 'rw',
  salinity: 20_000,
  rw: 0.1,
  tempManual: 75,
  tempFrom: 'profile',
  depth: null,
  set: (patch) => set(patch),
}));

const WARNING_TEXT: Readonly<Record<WaterWarning, string>> = {
  'salinity-low': `Salinidad por debajo de ${formatNumber(SALINITY_RANGE_PPM.min, { digits: 0 })} ppm: la correlación pierde exactitud (≈ 8 % a 100 ppm).`,
  'salinity-high': `Salinidad por encima de ${formatNumber(SALINITY_RANGE_PPM.max, { digits: 0 })} ppm: fuera del rango de la correlación (cerca de la saturación del NaCl, ≈ 264.000 ppm).`,
  'salinity-accuracy': `Entre ${formatNumber(SALINITY_RANGE_PPM.accurateMax, { digits: 0 })} y ${formatNumber(SALINITY_RANGE_PPM.max, { digits: 0 })} ppm la correlación es menos exacta (error no verificado contra la carta).`,
  'temperature-high': `Temperatura por encima de ${TEMPERATURE_EXTRAPOLATION_C} °C: la Rw está extrapolada más allá de la carta Gen-9.`,
  'temperature-low': 'Temperatura bajo 0 °C: fuera del rango de la carta.',
};

const fmtRw = (v: number) => (Number.isFinite(v) ? formatNumber(v, { digits: v < 0.1 ? 4 : v < 1 ? 3 : 2 }) : '—');
const fmtPpm = (v: number) => formatNumber(v, { digits: 0 });
const fmtTemp = (v: number) => formatNumber(v, { digits: 1 });

const GRADIENT_KEYS = {
  tSurface: paramStorageKey('temp-gradient', 'tSurface', tempGradient.params.tSurface),
  gradient: paramStorageKey('temp-gradient', 'gradient', tempGradient.params.gradient),
  datum: paramStorageKey('temp-gradient', 'datum', tempGradient.params.datum),
};

function FormationWaterDock() {
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  const sources = useEngineSources();
  const theme = useThemeTokens();
  const st = useWaterCalc();

  const well = entry?.well ?? null;
  const params = entry?.interpretation.params;
  const zones = entry?.interpretation.zones;

  const profile = useMemo(() => {
    if (!well || !params) return null;
    const computed = computedCurves(result, well).find((c) => c.port === 'TEMP' && c.active)?.data;
    const measuredCurve = well.curves.find((c) => c.role === 'TEMP');
    const measured = measuredCurve ? canonicalCurveData(measuredCurve, registry.roles).data : undefined;
    const g = (key: keyof typeof GRADIENT_KEYS, spec: (typeof tempGradient.params)[keyof typeof tempGradient.params]) => storedParamValue(params, GRADIENT_KEYS[key], spec, null) as number;
    const gradient: GradientParams = {
      tSurface: g('tSurface', tempGradient.params.tSurface),
      gradientPer100m: g('gradient', tempGradient.params.gradient),
      datum: g('datum', tempGradient.params.datum),
    };
    return chooseTempProfile(well.depth.values, { ...(computed ? { computed } : {}), ...(measured ? { measured } : {}) }, gradient);
  }, [well, params, result]);

  if (!entry || !well || !profile || !zones) {
    return <EmptyState size="sm" icon="droplet" title="Sin pozo" description="Cargá un pozo para calcular el agua de formación a su temperatura." />;
  }

  const top = well.depth.values[0]!;
  const base = well.depth.values[well.depth.values.length - 1]!;
  const depth = st.depth ?? Math.round((top + base) / 2);
  const profileTemp = temperatureAt(profile, depth);
  const tempInput = st.tempFrom === 'profile' ? profileTemp : st.tempManual;

  // Los tres valores: el que se calcula sale de los otros dos.
  const salinity = st.solve === 'salinity' ? naclSalinityFromResistivityC(st.rw, tempInput) : st.salinity;
  const rw = st.solve === 'rw' ? naclResistivityC(st.salinity, tempInput) : st.rw;
  const temp = st.solve === 'temperature' ? naclTemperatureC(st.salinity, st.rw) : tempInput;
  const complete = [salinity, rw, temp].every(Number.isFinite);
  const warnings = complete ? waterWarnings(salinity, temp) : [];
  const write = manualRwWrite(rw, temp);
  const inactive = inactiveDriver(sources, 'RW', 'rw-manual');
  const rwNow = plotParamValue(params!, PLOT_PARAMS.rwRef, null);
  const tNow = plotParamValue(params!, PLOT_PARAMS.tRef, null);

  const rows = complete ? zoneTopRows(zones, profile, rw, temp) : [];
  const series = complete ? rwDepthSeries(profile, rw, temp) : { depth: [], rw: [] };
  /** El punto «ahora» solo tiene profundidad si la temperatura sale del perfil. */
  const atDepth = st.tempFrom === 'profile' && st.solve !== 'temperature';
  const hotZones = rows.filter((r) => r.tempC > TEMPERATURE_EXTRAPOLATION_C);
  const xRange = niceRange([series.rw], 'linear', { pad: 0.15 });

  const useAsManual = () => {
    if (!write.ok) return;
    commitPlotParams(
      'Usar como Rw manual',
      [
        { storage: PLOT_PARAMS.rwRef.storage, value: write.rwRef, zoneId: null },
        { storage: PLOT_PARAMS.tRef.storage, value: write.tRef, zoneId: null },
      ],
      'commit',
    );
    toast({
      tone: 'ok',
      title: 'Rw manual actualizada',
      description: `Rw ${formatNumber(write.rwRef, { digits: 4 })} ohm·m a ${formatNumber(write.tRef, { digits: 1 })} °C (global). Se corrige por temperatura a cada profundidad.${write.converted ? ` La misma agua, expresada a ${formatNumber(write.tRef, { digits: 1 })} °C porque ${formatNumber(temp, { digits: 1 })} °C no entra en el control.` : ''}`,
    });
  };

  const columns: Column<ZoneRwRow>[] = [
    { key: 'zone', header: 'Zona', align: 'left', render: (r) => r.name },
    { key: 'top', header: 'Tope (m)', align: 'num', render: (r) => formatNumber(r.top, { digits: 1 }) },
    { key: 'temp', header: 'T (°C)', align: 'num', render: (r) => (r.tempC > TEMPERATURE_EXTRAPOLATION_C ? <span className="fw-hot">{fmtTemp(r.tempC)}</span> : fmtTemp(r.tempC)) },
    { key: 'rw', header: 'Rw (ohm·m)', align: 'num', render: (r) => fmtRw(r.rw) },
  ];

  const solveOptions = [
    { value: 'rw' as const, label: 'Rw' },
    { value: 'salinity' as const, label: 'Salinidad' },
    { value: 'temperature' as const, label: 'Temperatura' },
  ];

  const result_ = (text: string, unit: string, label: string) => (
    <div className="fw-result" data-testid={`fw-result-${label}`} aria-live="polite">
      <span className="fw-result__value num">{text}</span>
      <span className="fw-result__unit">{unit}</span>
      <Badge tone="accent" variant="soft">
        calculada
      </Badge>
    </div>
  );

  return (
    <div className="fw" data-testid="formation-water">
      <div className="fw-calc">
        <Section title="Calculadora" meta="NaCl equivalente">
          <div className="fw-grid">
            <span className="fw-grid__label">
              Calcular
            </span>
            <SegmentedControl aria-label="Valor a calcular" size="sm" wrap value={st.solve} onChange={(solve) => st.set({ solve })} options={solveOptions} />

            <label className="fw-grid__label" htmlFor="fw-salinity">
              Salinidad
            </label>
            {st.solve === 'salinity' ? (
              result_(fmtPpm(salinity), 'ppm', 'salinity')
            ) : (
              <NumberField id="fw-salinity" value={st.salinity} min={10} max={500_000} step={100} scale="log" unit="ppm" size="sm" format={fmtPpm} onChange={(v) => st.set({ salinity: v })} />
            )}

            <label className="fw-grid__label" htmlFor="fw-temp">
              Temperatura
            </label>
            {st.solve === 'temperature' ? (
              result_(fmtTemp(temp), '°C', 'temperature')
            ) : (
              <div className="fw-temp">
                <SegmentedControl
                  aria-label="Origen de la temperatura"
                  size="sm"
                  value={st.tempFrom}
                  onChange={(tempFrom) => st.set({ tempFrom })}
                  options={[
                    { value: 'profile', label: 'Del pozo' },
                    { value: 'manual', label: 'A mano' },
                  ]}
                />
                {st.tempFrom === 'manual' ? (
                  <NumberField id="fw-temp" value={st.tempManual} min={-10} max={400} step={0.5} unit="°C" size="sm" format={fmtTemp} onChange={(v) => st.set({ tempManual: v })} />
                ) : (
                  <>
                    <NumberField id="fw-depth" aria-label="Profundidad de la temperatura" value={depth} min={Math.ceil(top)} max={Math.floor(base)} step={1} unit="m" size="sm" format={(v) => formatNumber(v, { digits: 0, grouping: false })} onChange={(v) => st.set({ depth: v })} />
                    <span className="fw-temp__value" id="fw-temp" data-testid="fw-temp-profile">
                      <span className="num">{fmtTemp(profileTemp)}</span> °C
                    </span>
                  </>
                )}
              </div>
            )}
            {st.solve !== 'temperature' && st.tempFrom === 'profile' && <span className="fw-grid__note fw-muted">Fuente: {TEMP_SOURCE_LABEL[profile.source]}</span>}

            <label className="fw-grid__label" htmlFor="fw-rw">
              Rw
            </label>
            {st.solve === 'rw' ? (
              result_(fmtRw(rw), 'ohm·m', 'rw')
            ) : (
              <NumberField id="fw-rw" value={st.rw} min={0.001} max={100} step={0.001} scale="log" unit="ohm·m" size="sm" format={fmtRw} onChange={(v) => st.set({ rw: v })} />
            )}
          </div>

          {!complete && (
            <Callout tone="warn" title="Sin solución">
              {st.solve === 'salinity'
                ? 'Con esa Rw y esa temperatura la salinidad queda fuera del rango de la correlación: revisá los valores.'
                : st.solve === 'temperature'
                  ? 'No hay una temperatura con esa salinidad y esa Rw: revisá los valores.'
                  : 'Falta la temperatura: elegí una profundidad dentro del pozo o escribila a mano.'}
            </Callout>
          )}
          {warnings.map((w) => (
            <Callout key={w} tone="warn" icon="warning">
              {WARNING_TEXT[w]}
            </Callout>
          ))}

          <div className="fw-actions">
            <Button size="sm" variant="primary" icon="droplet" disabled={!write.ok} onClick={useAsManual} data-testid="fw-use-manual">
              Usar como Rw manual
            </Button>
            <span className="fw-muted fw-actions__now">
              Ahora: {fmtRw(rwNow)} ohm·m a {fmtTemp(tNow)} °C
            </span>
          </div>
          {!write.ok && complete && <p className="fw-note">{write.reason}</p>}
          {write.ok && write.converted && (
            <p className="fw-note" data-testid="fw-converted-note">
              {formatNumber(temp, { digits: 1 })} °C no entra en el control de Rw manual (0–200 °C): se guarda la misma agua a {formatNumber(write.tRef, { digits: 1 })} °C ({fmtRw(write.rwRef)} ohm·m).
            </p>
          )}
          {write.ok && inactive && (
            <Callout
              tone="info"
              actions={
                <Button size="sm" variant="secondary" onClick={() => chooseModuleSource('RW', 'rw-manual', 'Usar Rw manual')}>
                  Usar Rw manual
                </Button>
              }
            >
              La Rw manual no es la fuente de Rw de este pozo: el cambio no alimenta la saturación hasta que la elijas.
            </Callout>
          )}
        </Section>
      </div>

      <div className="fw-well">
        <Section title="Rw a lo largo del pozo" meta="la misma agua a la T de cada profundidad">
          {complete && xRange ? (
            <div className="fw-well__body">
              <div className="fw-well__table">
                <DataTable<ZoneRwRow> dense rows={rows} rowKey={(r) => r.id} columns={columns} empty="No hay zonas definidas." data-testid="fw-zone-table" />
                {hotZones.length > 0 && (
                  <p className="fw-note">
                    {hotZones.length === 1 ? 'En la zona' : 'En las zonas'} {hotZones.map((r) => r.name).join(', ')} la temperatura pasa de {TEMPERATURE_EXTRAPOLATION_C} °C: Rw extrapolada.
                  </p>
                )}
              </div>
              <XYPlot
                compact
                height={190}
                data-testid="fw-profile-plot"
                ariaLabel="Rw contra profundidad: la resistividad del agua baja al aumentar la temperatura"
                x={{ kind: 'linear', min: xRange.min, max: xRange.max, label: 'Rw', unit: 'ohm·m' }}
                y={{ kind: 'linear', min: top, max: base, label: 'Profundidad', unit: 'm', reversed: true }}
                lines={[{ id: 'rw-profile', x: series.rw, y: series.depth, color: theme.color.accent, width: 2 }]}
                points={atDepth ? [{ id: 'now', x: [rw], y: [depth], color: theme.color.text, radius: 4 }] : []}
                guides={rows.map((r) => ({ axis: 'y' as const, value: r.top, color: theme.color.borderStrong, label: r.name, dash: [3, 3] }))}
              />
            </div>
          ) : (
            <EmptyState size="sm" icon="droplet" title="Completá la calculadora" description="Con salinidad, temperatura y Rw válidas se ve cómo cambia Rw con la profundidad." />
          )}
        </Section>
      </div>
    </div>
  );
}

export const dockPanels: DockPanelDef[] = [{ id: FORMATION_WATER_DOCK_ID, title: 'Agua de formación', icon: 'droplet', component: FormationWaterDock }];
