/**
 * Panel «SCAL» del dock (tarea 8 de la consigna: «Analizar los datos de SCAL, para ajustar Swi y k»;
 * docs/decisiones/0057-mdt-y-scal-del-tp-embebidos.md). Muestra los datos de la hoja SCAL del TP, embebidos (funciona
 * sin cargar nada), y los relaciona con el módulo `swi-pc`:
 *
 * - Tabla de las 8 muestras (k de gas, φ, √(k/φ), presión de desplazamiento).
 * - Presión de desplazamiento contra √(k/φ) en log–log con el ajuste potencial del motor (R² y n).
 * - Las seis curvas Swi–√(k/φ) de la cátedra con la banda del rango respaldado por datos y las muestras sobre el eje.
 * - Resumen: % del pozo con √(k/φ) fuera del rango SCAL (de la tabla `SWI_ZONES` del último cálculo).
 * - «Usar nivel N»: escribe el nivel global de `swi-pc` (un `commit`, Ctrl+Z). Cada nivel lleva su presión capilar.
 * - Niveles desde las curvas MICP: presión de cada nivel reconstruida con las curvas de inyección de mercurio de las
 *   muestras, con los coeficientes de la cátedra y los reconstruidos; «Cargar curvas MICP del TP» (la receta del panel
 *   «Tipos de roca»).
 *
 * Las ecuaciones no se muestran (están en la documentación del módulo, pantalla Ecuaciones). Se descubre solo
 * (`src/modules/<id>/dock.tsx`).
 */
import { useMemo, useState } from 'react';
import type { TableValue } from '../../core/module';
import { activeWellEntry } from '../../core/state/project';
import type { XYAxis } from '../../plots/xy/axes';
import type { XYLineLayer, XYPointLayer, XYPolygonLayer, XYTrendLayer } from '../../plots/xy/layers';
import { XYPlot } from '../../plots/xy/XYPlot';
import { formatR2 } from '../../plots/trend/format';
import { Badge, Button, DataTable, Section, SEQUENTIAL_PALETTE, formatNumber, rampColor, toast, useThemeTokens, type Column } from '../../ui';
import { ensureContrast } from '../../ui/color';
import type { DockPanelDef } from '../../ui/dockPanel';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { loadTpMicp, showCapillaryTab } from '../rock-typing/dock';
import { isTpMicpSet } from '../rock-typing/tp';
import { SWI_MANUAL_LEVEL, SWI_PC_ID, SWI_ZONES } from './index';
import {
  globalLevel,
  joinScalTables,
  LEVELS,
  levelWrite,
  micpLevelRows,
  MICP_GRID_SAMPLE,
  outOfRangeSummary,
  SCAL_DOCK_ID,
  SCAL_RANGE,
  scalDisplacementFit,
  swiLevelCurve,
  TP_SCAL_SOURCE,
  zonesWithOwnLevel,
  type MicpLevelRow,
  type ScalSample,
} from './scal';
import './scal.css';

const X_MIN = 0.1;
const X_MAX = 10;
const X_AXIS: XYAxis = { kind: 'log', min: X_MIN, max: X_MAX, label: '√(k/φ)', unit: 'k en mD, φ en %' };
const SWI_MAX = 0.7;

const f2 = (v: number) => formatNumber(v, { digits: 2 });
const f3 = (v: number) => formatNumber(v, { digits: 3 });
/** Id del nivel → número: «level1» → «1». */
const levelNumber = (id: string) => id.replace(/^level/, '');
/** Presión del nivel en texto: «28 kg/cm²» (vacío si el preset no la trae). */
const levelPc = (id: string) => {
  const pc = LEVELS.find((l) => l.id === id)?.pcKgCm2;
  return pc ? `${formatNumber(pc, { digits: 0 })} kg/cm²` : '';
};

/** Datos fijos (embebidos): se calculan una vez. */
const JOIN = joinScalTables();
const FIT = scalDisplacementFit(JOIN.samples);
const MICP_ROWS = micpLevelRows();

function useLevelColors(): string[] {
  const theme = useThemeTokens();
  return useMemo(() => LEVELS.map((_, i) => ensureContrast(rampColor(0.12 + (0.78 * i) / (LEVELS.length - 1), SEQUENTIAL_PALETTE[theme.name]), theme.color.surface, 3)), [theme]);
}

function useLevelTable(): TableValue | null {
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  if (!entry || !result || result.wellId !== entry.well.id) return null;
  return (result.outputs.find((o) => o.key === `${SWI_PC_ID}:${SWI_ZONES}` && o.kind === 'table')?.value as TableValue | undefined) ?? null;
}

function applyLevel(level: string) {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) return;
  const preset = LEVELS.find((l) => l.id === level);
  if (!preset) return;
  useProject.getState().commit(`Usar el nivel ${levelNumber(level)} de presión capilar`, (p) => levelWrite(p, entry.well.id, level));
  const own = zonesWithOwnLevel(entry.interpretation);
  const names = own.map((id) => entry.interpretation.zones.find((z) => z.id === id)?.name ?? id);
  toast({
    tone: own.length ? 'warn' : 'ok',
    title: `Swi con el nivel ${levelNumber(level)} de presión capilar (${levelPc(level)})`,
    description: own.length
      ? `Nivel global actualizado. ${names.length === 1 ? 'La zona' : 'Las zonas'} ${names.join(', ')} ${names.length === 1 ? 'tiene' : 'tienen'} un nivel propio y no cambia${names.length === 1 ? '' : 'n'}: revisalo en el inspector del módulo.`
      : 'Nivel global del módulo Swi actualizado en todo el pozo. Ctrl+Z lo deshace.',
  });
}

export function ScalPanel() {
  const entry = useProject(selectActiveEntry);
  const theme = useThemeTokens();
  const colors = useLevelColors();
  const table = useLevelTable();
  const [selected, setSelected] = useState<string | null>(null);
  const current = entry ? globalLevel(entry.interpretation) : null;
  const ownZones = entry ? zonesWithOwnLevel(entry.interpretation) : [];
  const samples = JOIN.samples;
  const selIndex = selected ? samples.findIndex((s) => s.sample === selected) : -1;
  const pointColor = ensureContrast(theme.color.accent, theme.color.surface, 3);
  const summary = outOfRangeSummary(table);
  const micpLoaded = !!entry?.well.pointSets.some(isTpMicpSet);

  const columns: Column<ScalSample>[] = [
    { key: 'sample', header: 'Muestra', render: (r) => <span className="mono">{r.sample}</span> },
    { key: 'k', header: 'k gas (mD)', title: 'Permeabilidad al gas', align: 'num', render: (r) => formatNumber(r.kGasMd, { significant: 3 }) },
    { key: 'phi', header: 'φ (%)', title: 'Porosidad', align: 'num', render: (r) => formatNumber(r.phiPct, { digits: 1 }) },
    { key: 'root', header: '√(k/φ)', title: 'Raíz de k sobre φ, con k en mD y φ en %', align: 'num', render: (r) => f3(r.rootKPhi) },
    { key: 'pd', header: 'Pd (kg/cm²)', title: 'Presión de desplazamiento', align: 'num', render: (r) => f2(r.displacementKgCm2) },
  ];

  const label = (i: number) => {
    const s = samples[i]!;
    return `${s.sample} · √(k/φ) ${f3(s.rootKPhi)} · Pd ${f2(s.displacementKgCm2)} kg/cm²`;
  };
  const pick = (_: string, i: number) => setSelected((cur) => (cur === samples[i]!.sample ? null : samples[i]!.sample));

  // (b) presión de desplazamiento
  const pdPoints: XYPointLayer[] = [
    { id: 'pd', name: 'Muestras SCAL', x: samples.map((s) => s.rootKPhi), y: samples.map((s) => s.displacementKgCm2), color: pointColor, radius: 4, interactive: true, label },
  ];
  const pdTrends: XYTrendLayer[] = FIT
    ? [{ id: 'pd-fit', name: 'Ajuste potencial', coeffs: { model: 'power', a: FIT.c, b: -FIT.d }, span: [Math.min(...samples.map((s) => s.rootKPhi)), Math.max(...samples.map((s) => s.rootKPhi))], color: theme.color.text, extend: true, label: ['Ajuste potencial', `R² ${formatR2(FIT.r2)} · n ${FIT.n}`] }]
    : [];

  // (c) curvas Swi de la cátedra
  const band: XYPolygonLayer[] = [
    {
      id: 'scal-range',
      name: 'Rango de las muestras SCAL',
      vertices: [
        [SCAL_RANGE.min, 0],
        [SCAL_RANGE.max, 0],
        [SCAL_RANGE.max, SWI_MAX],
        [SCAL_RANGE.min, SWI_MAX],
      ],
      color: theme.color.accent,
      fillAlpha: 0.08,
      width: 0,
    },
  ];
  const swiLines: XYLineLayer[] = LEVELS.map((l, i) => {
    const c = swiLevelCurve(l, X_MIN, X_MAX);
    const on = l.id === current;
    return { id: l.id, name: `Nivel ${levelNumber(l.id)}`, x: c.x, y: c.y, color: colors[i]!, width: on ? 2.75 : 1.25, label: `${levelNumber(l.id)}`, labelAt: 'start' as const, ...(on || !current || current === SWI_MANUAL_LEVEL ? {} : { dash: [4, 3] }) };
  });
  const marks: XYPointLayer[] = [
    { id: 'marks', name: 'Muestras SCAL', x: samples.map((s) => s.rootKPhi), y: samples.map(() => 0.012), color: pointColor, radius: 3.5, interactive: true, label: (i) => `${samples[i]!.sample} · √(k/φ) ${f3(samples[i]!.rootKPhi)}` },
  ];

  return (
    <div className="scal" data-testid="scal-panel">
      <div className="scal-bar">
        <span className="scal-bar__name">Hoja SCAL · {samples.length} muestras</span>
        <Badge tone="ok" icon="check-circle" title={`Mediciones reales de laboratorio: ${TP_SCAL_SOURCE}. Vienen incluidas en la app.`}>
          Datos del TP (hoja SCAL)
        </Badge>
        <span className="shell-spacer" />
        <span className="scal-bar__summary" data-testid="scal-out-of-range">
          {summary ? (
            <>
              <span className="num scal-strong">{formatNumber(summary.pct, { digits: 1 })} %</span> de las muestras del pozo con Swi tiene √(k/φ) fuera del rango SCAL ({f2(SCAL_RANGE.min)}–{f2(SCAL_RANGE.max)}): ahí la Swi es extrapolada
              {summary.manualZones.length > 0 && ` (sin contar ${summary.manualZones.join(', ')}, con coeficientes manuales)`}.
            </>
          ) : (
            <span className="ui-text-muted">{entry ? 'El módulo Swi todavía no tiene resultado en este pozo (necesita k y φ efectiva calculadas, y un nivel de la cátedra).' : 'Cargá un pozo para comparar su √(k/φ) con el rango SCAL.'}</span>
          )}
        </span>
      </div>
      {JOIN.unmatched.length > 0 && <p className="scal-note">Muestras sin pareja entre las dos tablas de la hoja: {JOIN.unmatched.join(', ')}.</p>}
      <div className="scal-body">
        <div className="scal-grid">
          <Section title="Muestras" meta="k de gas y φ de la tabla de gargantas">
            <DataTable
              dense
              data-testid="scal-samples"
              caption="Muestras SCAL del TP"
              rows={samples}
              rowKey={(r) => r.sample}
              selectedKey={selected}
              onRowClick={(r) => setSelected((cur) => (cur === r.sample ? null : r.sample))}
              columns={columns}
            />
          </Section>

          <Section title="Presión de desplazamiento" meta={FIT ? <span className="num">R² {formatR2(FIT.r2)} · n {FIT.n}</span> : 'sin ajuste'}>
            <XYPlot
              height={230}
              data-testid="scal-pd-plot"
              figureId="scal-displacement"
              figureTitle="Presión de desplazamiento contra √(k/φ) — datos SCAL del TP"
              ariaLabel="Presión de desplazamiento contra raíz de k sobre φ, en escala log–log, con su ajuste potencial: baja al mejorar la roca"
              x={X_AXIS}
              y={{ kind: 'log', min: 0.1, max: 10, label: 'Pd', unit: 'kg/cm²' }}
              points={pdPoints}
              trends={pdTrends}
              highlight={selIndex >= 0 ? { layerId: 'pd', index: selIndex } : null}
              onPointClick={pick}
            />
            {FIT && FIT.r2 < 0.6 && <p className="scal-note">Ajuste débil: con 8 muestras y pares de igual Pd, la presión de desplazamiento explica poco de la calidad de roca. Usalo como tendencia, no para predecir.</p>}
          </Section>

          <Section title="Swi por nivel de presión capilar" meta="curvas de la cátedra">
            <XYPlot
              height={230}
              data-testid="scal-swi-plot"
              figureId="scal-swi-levels"
              figureTitle="Swi contra √(k/φ) por nivel de presión capilar — cátedra"
              ariaLabel="Swi contra raíz de k sobre φ para los seis niveles de presión capilar de la cátedra, con el rango de las muestras SCAL sombreado y las muestras marcadas sobre el eje"
              x={X_AXIS}
              y={{ kind: 'linear', min: 0, max: SWI_MAX, label: 'Swi', unit: 'v/v' }}
              polygons={band}
              lines={swiLines}
              points={marks}
              highlight={selIndex >= 0 ? { layerId: 'marks', index: selIndex } : null}
              onPointClick={pick}
            />
            <p className="scal-note">
              Sombreado: rango de √(k/φ) de las muestras ({f3(SCAL_RANGE.min)}–{f3(SCAL_RANGE.max)}), donde las curvas están respaldadas por datos. Nivel 1: menor presión capilar ({levelPc('level1')}, más Swi); nivel 6: mayor ({levelPc('level6')}). Presiones mercurio–aire, reconstruidas con las curvas MICP de las muestras.
            </p>
            <div className="scal-levels" role="group" aria-label="Nivel de presión capilar del módulo Swi">
              {LEVELS.map((l, i) => {
                const on = l.id === current;
                return (
                  <Button
                    key={l.id}
                    size="sm"
                    variant={on ? 'primary' : 'secondary'}
                    aria-pressed={on}
                    disabled={!entry}
                    data-testid={`scal-use-${l.id}`}
                    title={on ? `El módulo Swi ya usa el nivel ${levelNumber(l.id)} (${levelPc(l.id)}) en todo el pozo` : `Usar el nivel ${levelNumber(l.id)} (${levelPc(l.id)}) en el módulo Swi (global)`}
                    onClick={() => !on && applyLevel(l.id)}
                  >
                    <span className="scal-swatch" style={{ background: colors[i] }} aria-hidden="true" />
                    <span className="num">{`${on ? `Nivel ${levelNumber(l.id)} en uso` : `Usar nivel ${levelNumber(l.id)}`} · ${levelPc(l.id)}`}</span>
                  </Button>
                );
              })}
            </div>
            {current === SWI_MANUAL_LEVEL && <p className="scal-note">El módulo Swi usa coeficientes manuales: elegí un nivel para volver a las curvas de la cátedra.</p>}
            {ownZones.length > 0 && (
              <p className="scal-note">
                {ownZones.length === 1 ? 'Una zona tiene' : `${ownZones.length} zonas tienen`} un nivel propio: «Usar nivel» cambia el global y no las toca.
              </p>
            )}
          </Section>
        </div>

        <Section
          className="scal-wide"
          title="Niveles desde las curvas MICP"
          meta={<span className="num">8 curvas de inyección de mercurio · {MICP_ROWS.length} niveles</span>}
          actions={
            <Button size="sm" icon={micpLoaded ? 'arrow-right' : 'download'} disabled={!entry} data-testid="scal-micp" onClick={micpLoaded ? showCapillaryTab : () => loadTpMicp()} title="Curvas Pc–Sw, J de Leverett y gargantas de las 8 muestras, en el panel Tipos de roca">
              {micpLoaded ? 'Ver curvas MICP en Tipos de roca' : 'Cargar curvas MICP del TP'}
            </Button>
          }
        >
          <DataTable dense data-testid="scal-micp-levels" caption="Presión de cada nivel de la cátedra reconstruida con las curvas MICP" rows={MICP_ROWS} rowKey={(r) => r.id} selectedKey={current} columns={micpColumns(colors)} />
          <p className="scal-note">
            Las curvas de inyección de mercurio de las muestras, guardadas en los gráficos de la hoja, dan la Swi de cada roca a cada presión del ensayo. Ajustando esas Swi contra √(k/φ) en cada escalón, cada nivel de la cátedra coincide con uno: esa es su presión mercurio–aire. La diferencia RMS compara las dos curvas de Swi en el rango de las muestras (presiones de la grilla de la muestra {MICP_GRID_SAMPLE}).
          </p>
        </Section>
      </div>
    </div>
  );
}

function micpColumns(colors: string[]): Column<MicpLevelRow>[] {
  const fmt = (v: number, d: number) => (Number.isFinite(v) ? formatNumber(v, { digits: d }) : '—');
  return [
    {
      key: 'level',
      header: 'Nivel',
      render: (r) => (
        <span className="scal-cell">
          <span className="scal-swatch" style={{ background: colors[LEVELS.findIndex((l) => l.id === r.id)] }} aria-hidden="true" />
          {r.number}
        </span>
      ),
    },
    { key: 'pc', header: 'Pc (kg/cm²)', title: 'Presión capilar mercurio–aire del escalón que reproduce el nivel', align: 'num', render: (r) => fmt(r.pcKgCm2, 1) },
    { key: 'a', header: 'A cátedra', align: 'num', render: (r) => fmt(r.A, 2) },
    { key: 'b', header: 'B cátedra', align: 'num', render: (r) => fmt(r.B, 3) },
    { key: 'fa', header: 'A MICP', title: 'Coeficiente A reconstruido con las curvas', align: 'num', render: (r) => fmt(r.fitA, 2) },
    { key: 'fb', header: 'B MICP', title: 'Exponente B reconstruido con las curvas', align: 'num', render: (r) => fmt(r.fitB, 3) },
    { key: 'r2', header: 'R²', title: 'R² del ajuste en log–log', align: 'num', render: (r) => (Number.isFinite(r.r2) ? formatR2(r.r2) : '—') },
    { key: 'n', header: 'n', title: 'Muestras ya invadidas a esa presión', align: 'num', render: (r) => r.n || '—' },
    { key: 'rms', header: 'RMS Swi', title: 'Diferencia RMS de Swi (v/v) entre la curva de la cátedra y la reconstruida', align: 'num', render: (r) => fmt(r.rmsSwi, 4) },
  ];
}

export const dockPanels: DockPanelDef[] = [{ id: SCAL_DOCK_ID, title: 'SCAL', icon: 'activity', component: ScalPanel }];
