/**
 * Pestaña «Zonas» del dock (docs/decisiones/0018): una ficha por zona con espesores, φ y Sw del pay, volumen in situ,
 * semáforo de pay y minigráficos de φ y Sw en profundidad. Lee las tablas que ya calculan el sumario por zona y el
 * volumétrico (y las curvas PHIE y SW activas): no recalcula petrofísica. Clic en la ficha lleva el visor a la zona.
 * Se descubre solo (`src/modules/<id>/dock.tsx`).
 */
import { useMemo } from 'react';
import type { TableValue } from '../../core/module';
import type { ZoneKind } from '../../core/well';
import { EmptyState, StatusDot, Tooltip, curveStyle, formatNumber, useResolvedTheme, type Tone } from '../../ui';
import type { DockPanelDef } from '../../ui/dockPanel';
import { computedCurves } from '../../app/computed';
import { registry } from '../index';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { useTrendsUi } from '../../app/trends/store';
import {
  buildZoneCards,
  PAY_CRITERION,
  PAY_LIGHT_LABEL,
  porosityScaleMax,
  sparkPaths,
  sparkSeries,
  type CardVolume,
  type PayLight,
  type Row,
  type SparkScale,
  type ZoneCard,
} from './model';
import './zone-cards.css';

export const ZONE_CARDS_DOCK_ID = 'zone-cards';

const KIND_LABEL: Record<ZoneKind, string> = { formation: 'Formación', reservoir: 'Reservorio', seal: 'Sello', other: 'Otro' };
const LIGHT_TONE: Record<PayLight, Tone> = { pay: 'ok', marginal: 'warn', none: 'neutral', nodata: 'neutral' };

const m = (v: number | null, digits = 1) => formatNumber(v, { digits });
const pct = (v: number | null, digits = 1) => (v === null ? '—' : formatNumber(v * 100, { digits }));

// ── minigráfico ──────────────────────────────────────────────────────────────────────────────────────────────────

const SPARK_W = 40;
const SPARK_H = 96;

function Spark({ label, series, scale, edge, color, fill, description }: { label: string; series: { y: Float64Array; v: Float64Array }; scale: SparkScale; edge: 'left' | 'right'; color: string; fill: string; description: string }) {
  const { line, area } = useMemo(() => sparkPaths(series, scale, SPARK_W, SPARK_H, edge), [series, scale, edge]);
  return (
    <span className="zc-spark" title={description}>
      <svg className="zc-spark__svg" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" role="img" aria-label={description}>
        <line className="zc-spark__mid" x1={SPARK_W / 2} x2={SPARK_W / 2} y1="0" y2={SPARK_H} vectorEffect="non-scaling-stroke" />
        {area && <path d={area} fill={fill} stroke="none" />}
        {line ? <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <span className="zc-spark__label">{label}</span>
    </span>
  );
}

// ── ficha ────────────────────────────────────────────────────────────────────────────────────────────────────────

function VolumeLine({ card }: { card: ZoneCard }) {
  const v: CardVolume | null = card.volume;
  if (card.kind === 'seal') return <span className="zc-vol__none">Sello: no aporta volumen</span>;
  if (!v) return <span className="zc-vol__none">{card.fluid && card.fluid !== 'Sin fluido' ? 'Sin volumen calculado' : 'Sin fluido definido'}</span>;
  return (
    <span className="zc-vol__values num">
      {v.oil && (
        <span>
          <strong>{m(v.oil.field, 2)}</strong> <span className="zc-unit">MMbbl</span> <span className="zc-unit">({m(v.oil.si, 1)} Mm³)</span>
        </span>
      )}
      {v.gas && (
        <span>
          <strong>{m(v.gas.field, 2)}</strong> <span className="zc-unit">Bcf</span> <span className="zc-unit">({m(v.gas.si, 2)} MMm³)</span>
        </span>
      )}
    </span>
  );
}

function ZoneCardView({ card, phi, sw, phiScale, swScale, colors }: { card: ZoneCard; phi: { y: Float64Array; v: Float64Array } | null; sw: { y: Float64Array; v: Float64Array } | null; phiScale: SparkScale; swScale: SparkScale; colors: { phi: string; sw: string; hc: string; phiFill: string; hcFill: string } }) {
  const go = () => useTrendsUi.getState().requestRange(card.top, card.base);
  const light = card.light;
  return (
    <button type="button" className="zc-card" style={{ ['--zc' as string]: card.color }} onClick={go} data-testid={`zone-card-${card.name}`} data-light={light} title={`Ir a la zona ${card.name} en el visor`}>
      <span className="zc-head">
        <span className="zc-name">{card.name}</span>
        <span className="zc-kind">{KIND_LABEL[card.kind]}</span>
        <span className="zc-spacer" />
        <Tooltip content={PAY_CRITERION}>
          <span className={`zc-light zc-light--${light}`} data-testid="zone-card-light">
            <StatusDot tone={LIGHT_TONE[light]} label={PAY_LIGHT_LABEL[light]} nativeTitle={false} />
            {PAY_LIGHT_LABEL[light]}
          </span>
        </Tooltip>
      </span>
      <span className="zc-range num">
        {m(card.top)} – {m(card.base)} m · <strong>{m(card.gross)} m</strong> brutos
      </span>
      <span className="zc-body">
        <dl className="zc-stats">
          <dt>Neto reservorio</dt>
          <dd className="num">{m(card.netRes)} m</dd>
          <dt>Neto pay</dt>
          <dd className="num">{m(card.netPay)} m</dd>
          <dt>N/G pay</dt>
          <dd className="num">{pct(card.ntgPay, 0)} %</dd>
          <dt>φ pay</dt>
          <dd className="num">{pct(card.phiPay)} %</dd>
          <dt>Sw pay</dt>
          <dd className="num">{pct(card.swPay)} %</dd>
        </dl>
        <span className="zc-sparks">
          {phi ? (
            <Spark label="φ" series={phi} scale={phiScale} edge="left" color={colors.phi} fill={colors.phiFill} description={`Porosidad en ${card.name}: de 0 a ${pct(phiScale.max, 0)} %, de tope a base`} />
          ) : (
            <span className="zc-spark zc-spark--empty">sin φ</span>
          )}
          {sw ? (
            <Spark label="Sw" series={sw} scale={swScale} edge="right" color={colors.sw} fill={colors.hcFill} description={`Saturación de agua en ${card.name}: de 100 a 0 %, de tope a base`} />
          ) : (
            <span className="zc-spark zc-spark--empty">sin Sw</span>
          )}
        </span>
      </span>
      <span className="zc-vol">
        <span className="zc-vol__label">In situ</span>
        <VolumeLine card={card} />
      </span>
    </button>
  );
}

// ── panel ────────────────────────────────────────────────────────────────────────────────────────────────────────

function ZoneCardsPanel() {
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  const theme = useResolvedTheme();
  const well = entry?.well ?? null;
  const zones = entry?.interpretation.zones;

  const tables = useMemo(() => {
    const rowsOf = (port: string): Row[] | null => {
      const o = result?.outputs.find((x) => x.kind === 'table' && x.port === port && x.active);
      return o ? ((o.value as TableValue).rows as Row[]) : null;
    };
    return { summary: rowsOf('ZONE_SUMMARY'), volumetrics: rowsOf('VOLUMETRICS') };
  }, [result]);
  const cards = useMemo(() => (zones ? buildZoneCards(zones, tables.summary, tables.volumetrics) : []), [zones, tables]);

  const curves = useMemo(() => {
    const computed = computedCurves(result, well);
    const pick = (port: string) => computed.find((c) => c.port === port && c.active)?.data ?? null;
    return { phi: pick('PHIE'), sw: pick('SW') };
  }, [result, well]);
  const phiScale = useMemo<SparkScale>(() => ({ min: 0, max: curves.phi ? porosityScaleMax(curves.phi) : 0.4, reversed: false }), [curves.phi]);
  const swScale: SparkScale = { min: 0, max: 1, reversed: true };
  const series = useMemo(() => {
    const depth = well?.depth.values;
    return cards.map((c) => ({
      phi: depth && curves.phi ? sparkSeries(depth, curves.phi, c.top, c.base) : null,
      sw: depth && curves.sw ? sparkSeries(depth, curves.sw, c.top, c.base) : null,
    }));
  }, [cards, curves, well]);

  const colors = useMemo(() => {
    const phi = curveStyle('PHIE', theme, registry.roles).color;
    const sw = curveStyle('SW', theme, registry.roles).color;
    const hc = theme === 'dark' ? '#4fae58' : '#43a047';
    return { phi, sw, hc, phiFill: `${phi}33`, hcFill: `${hc}59` };
  }, [theme]);

  if (!entry) return <EmptyState size="sm" icon="layers" title="Todavía no hay un pozo" description="Cargá un pozo para ver una ficha por zona." />;
  if (!zones || zones.length === 0) return <EmptyState size="sm" icon="layers" title="El pozo no tiene zonas" description="Definí zonas en el paso Zonas: cada una tiene su ficha con espesores, φ, Sw y volumen." />;
  return (
    <div className="zc-wrap">
      {!tables.summary && <p className="zc-note">Los valores aparecen cuando el sumario por zona tiene resultado (pasos Arcilla a Cutoffs).</p>}
      <div className="zc-grid" data-testid="zone-cards">
        {cards.map((c, i) => (
          <ZoneCardView key={c.id} card={c} phi={series[i]?.phi ?? null} sw={series[i]?.sw ?? null} phiScale={phiScale} swScale={swScale} colors={colors} />
        ))}
      </div>
    </div>
  );
}

export const dockPanels: DockPanelDef[] = [
  {
    id: ZONE_CARDS_DOCK_ID,
    title: 'Zonas',
    icon: 'layers',
    component: ZoneCardsPanel,
    useBadge: () => useProject((s) => selectActiveEntry(s)?.interpretation.zones.length || null),
  },
];
