/**
 * Presiones MDT sobre el visor (docs/decisiones/0009, D5). Contrato `ViewerOverlay`, descubierto solo.
 *
 * Dos superposiciones:
 * - `mdt` (capa 'over', orden 10, debajo de las tendencias): pista propia «Presión» (escala lineal automática según
 *   los datos, psi por defecto, bar/kPa/kg/cm² a elección y guardada en `project.display.overlays.mdt.unit`, junto a
 *   la pista de saturación), líneas de CONTACTO que cruzan todas las pistas (para contrastar con la Sw), y la
 *   interacción con los puntos: tooltip, clic para incluir o descartar, Tab/Enter desde el teclado.
 * - `mdt-points` (orden 30, encima de las líneas de tendencia): solo dibuja los puntos y los rótulos de contacto.
 *   Separadas para que los puntos se vean sobre los gradientes sin quitarle el puntero a la herramienta «elegir
 *   tramo» de las tendencias (que va primero en el `hit`).
 *
 * Puntos: el color indica el fluido del gradiente o el drawdown. Incluidos = círculo lleno; descartados =
 * círculo vacío con ×; incluidos a pesar de la propuesta de descartarlos = anillo de advertencia. Fuera de escala:
 * triángulo en el borde de la pista.
 * Escribe solo por `frame.data.commit` (recetas de `src/core/state/pointSets.ts`): no importa stores.
 */
import type { Interpretation } from '../../core/interpretation';
import { setPointDecision } from '../../core/state/pointSets';
import { pointNumbers, pointTexts, shiftedDepth, type PointSet } from '../../core/pointSets';
import { conversionCoefficients, convert, unitLabel } from '../../core/units';
import { PRESSURE_COLUMNS } from '../../io/pressures';
import { HYDROSTATIC_NORMAL_DENSITY, densityToLbPerGal, equivalentMudWeight, type ExcessPressureRef } from '../../petro/pressure';
import { contrastRatio, ensureContrast, withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { BASE_TOKENS, scalePx, type ThemeTokens } from '../../ui/tokens';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayTarget, OverlayTrack, OverlayTrackState, ViewerOverlay } from '../../viewer/overlay';
import {
  asDisplayUnit,
  CONTACT_LABEL,
  contactPressurePsi,
  decisionFor,
  DISPLAY_UNITS,
  FLUID_COLOR,
  FLUID_LABEL,
  MDT_OVERLAY_ID,
  MDT_POINTS_OVERLAY_ID,
  mdtAxisValue,
  parseMdtAxisSettings,
  pointStatuses,
  pressureSets,
  QUALITY_REASON_LABEL,
  resolveExcessRef,
  type DisplayUnit,
  type Fluid,
  type FluidContact,
  type MdtAxisSettings,
} from './model';
import { drawdownScale, formatDrawdown, pointColorOf } from './draw';
import { TP_MDT_ZONE_COLUMN } from './tp';
import { activeWaterDensity, mdtAnalysis, pointRef, type MdtAnalysis } from './series';

export const POINT_RADIUS = 4;
export const POINT_HIT_PX = 8;

/** Unidad elegida para la pista (ajuste guardado) o psi. */
export function displayUnitOf(settings: Readonly<Record<string, unknown>> | undefined): DisplayUnit {
  return asDisplayUnit(settings?.['unit']);
}

function pressureUnitOf(set: PointSet): string {
  const c = set.columns['pressure'];
  return c && 'unit' in c && typeof c.unit === 'string' ? c.unit : 'psi';
}

function toPsi(v: number, fromUnit: string): number {
  if (fromUnit === 'psi' || !Number.isFinite(v)) return v;
  try {
    return convert(v, fromUnit, 'psi');
  } catch {
    return v;
  }
}

/** Paso «lindo» (1, 2, 2,5 o 5 × 10ⁿ) para unas `divisions` divisiones de `span`. */
function niceStep(span: number, divisions: number): number {
  const raw = span / divisions;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function roundedLinearScale(lo: number, hi: number, minSpan: number): OverlayTrackState['scale'] {
  let span = hi - lo;
  if (span < Math.max(1e-9, Math.abs(hi) * 1e-4)) span = Math.max(Math.abs(hi) * 0.02, minSpan);
  const pad = span * 0.1;
  const step = niceStep(span + 2 * pad, 4);
  const min = Math.floor((lo - pad) / step) * step;
  const max = Math.ceil((hi + pad) / step) * step;
  return { kind: 'linear', min, max: max > min ? max : min + step };
}

/**
 * Escala automática de la pista en presión absoluta: rango de las presiones que tienen sentido (sin pruebas secas,
 * sin sello o inestables, que no se estabilizaron y estirarían la escala), con margen y extremos redondeados. Depende
 * solo de los datos, no de lo que se descarte (la escala no salta al hacer clic en un punto).
 */
export function pressureTrackScale(sets: readonly PointSet[], unit: DisplayUnit): OverlayTrackState['scale'] | null {
  const [a, b] = conversionCoefficients('psi', unit);
  let lo = Infinity;
  let hi = -Infinity;
  let loAll = Infinity;
  let hiAll = -Infinity;
  for (const s of sets) {
    const p = pointNumbers(s, 'pressure');
    if (!p) continue;
    const pUnit = pressureUnitOf(s);
    const q = pointStatuses(s, undefined);
    for (let i = 0; i < p.length; i++) {
      const v = toPsi(p[i]!, pUnit);
      if (!Number.isFinite(v)) continue;
      const x = v * a + b;
      loAll = Math.min(loAll, x);
      hiAll = Math.max(hiAll, x);
      if (q[i]!.quality.reasons.some((r) => r === 'dry' || r === 'lostSeal' || r === 'unstable')) continue;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  if (!Number.isFinite(lo)) {
    lo = loAll;
    hi = hiAll;
  }
  if (!Number.isFinite(lo)) return null;
  return roundedLinearScale(lo, hi, 10 * a);
}

/**
 * Escala, unidad y título resueltos de la pista MDT según el modo del eje X (`pressure`, `excess` o `emw`).
 * Comparte la misma resolución entre la pista en pantalla, la lupa y la exportación de figuras PNG/SVG/PDF.
 */
export function mdtTrackState(
  sets: readonly PointSet[],
  interpretation: Readonly<Interpretation> | undefined,
  settings: Readonly<Record<string, unknown>> | undefined,
  activeWaterDens?: number | null,
): OverlayTrackState | null {
  if (sets.length === 0) return null;
  const axis = parseMdtAxisSettings(settings);
  if (axis.axisMode === 'pressure') {
    const scale = pressureTrackScale(sets, axis.unit);
    return scale ? { scale, unit: axis.unit, title: 'Presión' } : null;
  }
  const resolved = resolveExcessRef(sets, interpretation?.pointSets, axis, activeWaterDens);
  const [a] = conversionCoefficients('psi', axis.unit);
  let lo = Infinity;
  let hi = -Infinity;
  let loAll = Infinity;
  let hiAll = -Infinity;
  for (const s of sets) {
    const p = pointNumbers(s, 'pressure');
    if (!p) continue;
    const pUnit = pressureUnitOf(s);
    const dec = interpretation?.pointSets?.[s.id];
    const q = pointStatuses(s, undefined);
    const z = shiftedDepth(s, dec);
    for (let i = 0; i < p.length; i++) {
      const pPsi = toPsi(p[i]!, pUnit);
      const zi = z[i]!;
      if (!Number.isFinite(pPsi) || !Number.isFinite(zi)) continue;
      const x = mdtAxisValue(pPsi, zi, axis, resolved.ref);
      if (!Number.isFinite(x)) continue;
      loAll = Math.min(loAll, x);
      hiAll = Math.max(hiAll, x);
      if (q[i]!.quality.reasons.some((r) => r === 'dry' || r === 'lostSeal' || r === 'unstable')) continue;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  if (!Number.isFinite(lo)) {
    lo = loAll;
    hi = hiAll;
  }
  if (axis.axisMode === 'excess') {
    if (!Number.isFinite(lo)) return null;
    const scale = roundedLinearScale(lo, hi, Math.max(10 * a, 1e-3));
    const rhoText = formatNumber(resolved.ref.rhoRef, { digits: 2 });
    return { scale, unit: axis.unit, title: `Exceso P (${rhoText})` };
  }
  const scale = Number.isFinite(lo)
    ? roundedLinearScale(lo, hi, axis.emwUnit === 'lb/gal' ? 0.5 : 0.06)
    : { kind: 'linear' as const, min: 0, max: axis.emwUnit === 'lb/gal' ? 20 : 2.4 };
  return { scale, unit: axis.emwUnit, title: 'EMW (z = 0)' };
}

const fluidColor = (f: Fluid | null, theme: ThemeTokens) => (f ? ensureContrast(FLUID_COLOR[theme.name][f], theme.viewer.trackBg, 3) : theme.color.textMuted);

const m1 = (d: number) => `${formatNumber(d, { digits: 1 })} m`;

interface DrawnPoint {
  set: PointSet;
  i: number;
  key: string;
  x: number;
  y: number;
  /** Profundidad corregida (m). */
  depth: number;
  /** -1 / 1 si quedó fuera de escala a la izquierda / derecha. */
  clamp: -1 | 0 | 1;
  included: boolean;
  forced: boolean;
  fluid: Fluid | null;
}

/** Pista «Presión» del cuadro. */
const pressureTrack = (frame: OverlayHitFrame): OverlayTrack | undefined => frame.tracks.find((t) => t.overlayId === MDT_OVERLAY_ID);
/** Pista de profundidad (rótulos de contacto). */
const depthTrack = (frame: OverlayHitFrame): OverlayTrack | undefined => frame.tracks.find((t) => t.kind === 'depth');

/** Pastilla de un contacto: a la izquierda de la pista (de profundidad), centrada en la línea. */
/** `u`: factor del tamaño de interfaz (1 en las figuras exportadas). */
function contactPillBox(c: FluidContact, t: OverlayTrack, y: number, u = 1): { x: number; y: number; w: number; h: number } {
  const w = (8 + CONTACT_LABEL[c.kind].short.length * 7.5) * u;
  const h = scalePx(16, u);
  return { x: t.x + 3, y: Math.round(y) - h / 2, w, h };
}

function frameAxisAndRef(frame: OverlayHitFrame, an: MdtAnalysis, t: OverlayTrack | undefined): { axis: MdtAxisSettings; excessRef: ExcessPressureRef } {
  const parsed = parseMdtAxisSettings(frame.data.overlaySettings?.[MDT_OVERLAY_ID]);
  const axis: MdtAxisSettings =
    parsed.axisMode === 'emw'
      ? t?.unit === 'lb/gal' || t?.unit === 'g/cm3'
        ? { ...parsed, emwUnit: t.unit }
        : parsed
      : t?.unit && (DISPLAY_UNITS as readonly unknown[]).includes(t.unit)
        ? { ...parsed, unit: t.unit as DisplayUnit }
        : parsed;
  const waterDens =
    axis.axisMode === 'excess' && axis.excessRhoSource === 'water'
      ? activeWaterDensity(frame.data.well, frame.data.interpretation)
      : null;
  const excessRef = resolveExcessRef(an.sets, frame.data.interpretation.pointSets, axis, waterDens).ref;
  return { axis, excessRef };
}

/** Puntos ubicados en px para este cuadro (caché por pista, datos y viewport). */
let pointsCache: { tracks: readonly OverlayTrack[]; data: OverlayHitFrame['data']; top: number; px: number; out: DrawnPoint[] } | null = null;
function placePoints(frame: OverlayHitFrame, an: MdtAnalysis): DrawnPoint[] {
  const c = pointsCache;
  const vp = frame.viewport;
  if (c && c.tracks === frame.tracks && c.data === frame.data && c.top === vp.top && c.px === vp.pxPerM) return c.out;
  const t = pressureTrack(frame);
  const out: DrawnPoint[] = [];
  if (t) {
    const { axis, excessRef } = frameAxisAndRef(frame, an, t);
    for (const set of an.sets) {
      const p = pointNumbers(set, 'pressure');
      if (!p) continue;
      const pUnit = pressureUnitOf(set);
      const dec = frame.data.interpretation.pointSets?.[set.id];
      const st = pointStatuses(set, dec);
      const z = shiftedDepth(set, dec);
      for (let i = 0; i < p.length; i++) {
        const pPsi = toPsi(p[i]!, pUnit);
        const zi = z[i]!;
        if (!Number.isFinite(pPsi) || !Number.isFinite(zi)) continue;
        const axisVal = mdtAxisValue(pPsi, zi, axis, excessRef);
        if (!Number.isFinite(axisVal)) continue;
        const xr = t.xOf(null, axisVal);
        if (xr === null) continue;
        const clamp: DrawnPoint['clamp'] = xr < 0 ? -1 : xr > t.width ? 1 : 0;
        const key = pointRef(set.id, set.pointIds[i]!);
        const s = st[i]!;
        out.push({
          set,
          i,
          key,
          x: t.x + Math.max(5, Math.min(t.width - 5, xr)),
          y: vp.yOf(zi),
          depth: zi,
          clamp,
          included: s.included,
          forced: s.included && s.quality.proposeExclude,
          fluid: s.included ? (an.fluidOfPoint.get(key)?.fluid ?? null) : null,
        });
      }
    }
  }
  pointsCache = { tracks: frame.tracks, data: frame.data, top: vp.top, px: vp.pxPerM, out };
  return out;
}

const analysisOf = (frame: OverlayHitFrame) => mdtAnalysis(frame.data.well, frame.data.interpretation);

function formatPressure(pPsi: number, unit: DisplayUnit): string {
  const [a, b] = conversionCoefficients('psi', unit);
  return `${formatNumber(pPsi * a + b, { digits: unit === 'psi' || unit === 'kPa' ? 1 : 2 })} ${unitLabel(unit)}`;
}

function formatSignedExcess(exVal: number, unit: DisplayUnit): string {
  const digits = unit === 'psi' || unit === 'kPa' ? 1 : 2;
  const sign = exVal > 0 ? '+' : '';
  return `${sign}${formatNumber(exVal, { digits })} ${unitLabel(unit)}`;
}

/** Texto del tooltip de un punto. */
function pointLabel(frame: OverlayHitFrame, an: MdtAnalysis, d: DrawnPoint): string {
  const { set, i } = d;
  const t = pressureTrack(frame);
  const { axis, excessRef } = frameAxisAndRef(frame, an, t);
  const unit = axis.unit;
  const pPsi = toPsi(pointNumbers(set, 'pressure')![i]!, pressureUnitOf(set));
  const mob = pointNumbers(set, 'mobility')?.[i];
  const qText = pointTexts(set, 'quality')?.[i];
  const sourceZone = pointTexts(set, TP_MDT_ZONE_COLUMN)?.[i];
  const drawdown = pointNumbers(set, PRESSURE_COLUMNS.drawdown);
  const colorMode = pointColorOf(frame.data.overlaySettings?.[MDT_OVERLAY_ID]);
  const st = pointStatuses(set, frame.data.interpretation.pointSets?.[set.id])[i]!;
  const lines = [`${set.pointIds[i]} · ${m1(d.depth)}${set.synthetic ? ' · ejemplo sintético' : ''}`];
  const parts = [`Presión ${formatPressure(pPsi, unit)}`];
  if (mob !== undefined && Number.isFinite(mob)) parts.push(`movilidad ${formatNumber(mob, { significant: 3 })} mD/cP`);
  lines.push(parts.join(' · '));
  if (axis.axisMode === 'excess') {
    const ex = mdtAxisValue(pPsi, d.depth, axis, excessRef);
    if (Number.isFinite(ex)) {
      lines.push(`Exceso P: ${formatSignedExcess(ex, unit)} (ρ ref ${formatNumber(excessRef.rhoRef, { digits: 2 })} g/cm³)`);
    }
  }
  if (axis.axisMode === 'emw' || axis.axisMode === 'excess') {
    const emwLb = equivalentMudWeight(pPsi, d.depth, { pressureUnit: 'psi', densityUnit: 'lb/gal' });
    const emwG = equivalentMudWeight(pPsi, d.depth, { pressureUnit: 'psi', densityUnit: 'g/cm3' });
    if (Number.isFinite(emwLb) && Number.isFinite(emwG)) {
      lines.push(`EMW (z = 0): ${formatNumber(emwLb, { digits: 2 })} lb/gal (${formatNumber(emwG, { digits: 2 })} g/cm³)`);
    }
  }
  if (drawdown || colorMode === 'drawdown') {
    const value = drawdown?.[i];
    lines.push(`Drawdown: ${formatDrawdown(value, unit)}${Number.isFinite(value) ? ` ${unitLabel(unit)}` : ''}`);
  }
  if (sourceZone) lines.push(`Zona de origen: ${sourceZone}`);
  if (qText) lines.push(`Calidad: ${qText}`);
  if (st.quality.reasons.length) lines.push(`Propuesta: descartar (${st.quality.reasons.map((r) => QUALITY_REASON_LABEL[r]).join(', ')})`);
  const f = an.fluidOfPoint.get(d.key);
  if (st.included && f) lines.push(`Fluido: ${FLUID_LABEL[f.fluid].toLowerCase()} (gradiente «${f.name}»)`);
  lines.push(
    st.included
      ? `${st.decided === 'include' ? 'Incluido a mano' : 'Incluido en los ajustes'} · clic para descartarlo`
      : `${st.decided === 'exclude' ? 'Descartado a mano' : 'Descartado'} · clic para incluirlo`,
  );
  return lines.join('\n');
}

function pointHit(frame: OverlayHitFrame, an: MdtAnalysis, d: DrawnPoint): OverlayHit & { key: string } {
  const commit = frame.data.commit;
  const wellId = frame.data.wellId;
  const { set, i } = d;
  const pid = set.pointIds[i]!;
  return {
    key: d.key,
    label: pointLabel(frame, an, d),
    cursor: 'pointer',
    ...(commit
      ? {
          activate: () => {
            const st = pointStatuses(set, frame.data.interpretation.pointSets?.[set.id])[i]!;
            const include = !st.included;
            commit(include ? 'Incluir punto MDT' : 'Descartar punto MDT', (p) => {
              // Contra el estado al día (el cuadro puede tener un instante): el conjunto y su decisión actuales.
              const entry = p.wells.find((w) => w.well.id === wellId);
              const cur = entry?.well.pointSets.find((s) => s.id === set.id);
              if (!entry || !cur || !cur.pointIds.includes(pid)) return p;
              const k = cur.pointIds.indexOf(pid);
              const q = pointStatuses(cur, entry.interpretation.pointSets[cur.id])[k]!;
              if (q.included === include) return p;
              return setPointDecision(p, wellId, cur.id, pid, decisionFor(q.quality, include));
            });
          },
        }
      : {}),
  };
}

function contactTooltip(c: FluidContact, axis: MdtAxisSettings, excessRef: ExcessPressureRef): string {
  const pPsi = contactPressurePsi(c);
  const lines = [`${CONTACT_LABEL[c.kind].short} · ${CONTACT_LABEL[c.kind].long}`, `${m1(c.depth!)} · ${formatPressure(pPsi, axis.unit)}`];
  if (axis.axisMode === 'excess') {
    const ex = mdtAxisValue(pPsi, c.depth!, axis, excessRef);
    if (Number.isFinite(ex)) lines.push(`Exceso P: ${formatSignedExcess(ex, axis.unit)} (ρ ref ${formatNumber(excessRef.rhoRef, { digits: 2 })} g/cm³)`);
  } else if (axis.axisMode === 'emw') {
    const emwLb = equivalentMudWeight(pPsi, c.depth!, { pressureUnit: 'psi', densityUnit: 'lb/gal' });
    const emwG = equivalentMudWeight(pPsi, c.depth!, { pressureUnit: 'psi', densityUnit: 'g/cm3' });
    if (Number.isFinite(emwLb) && Number.isFinite(emwG)) {
      lines.push(`EMW (z = 0): ${formatNumber(emwLb, { digits: 2 })} lb/gal (${formatNumber(emwG, { digits: 2 })} g/cm³)`);
    }
  }
  lines.push(`Corte de «${c.upper.name}» y «${c.lower.name}»`);
  if (c.kind !== 'GOC') lines.push('Por presiones se obtiene el nivel de agua libre (FWL); el contacto que se ve en la Sw queda algo más arriba por la zona de transición capilar.');
  if (c.warning) lines.push(c.warning);
  return lines.join('\n');
}

const visibleContacts = (an: MdtAnalysis) => an.contacts.filter((c) => c.depth !== null);

/** Superposición principal: pista, referencias de eje, contactos y puntero. */
const main: ViewerOverlay = {
  id: MDT_OVERLAY_ID,
  label: 'Presiones MDT',
  layer: 'over',
  order: 10,
  track: {
    title: 'Presión',
    scale: { kind: 'linear', min: 0, max: 10000 },
    unit: 'psi',
    width: 1.35,
    after: 'saturation',
    colorLegend: (data, unit) =>
      drawdownScale(
        data,
        data.overlaySettings?.[MDT_OVERLAY_ID] ? displayUnitOf(data.overlaySettings[MDT_OVERLAY_ID]) : asDisplayUnit(unit),
      )?.legend ?? null,
    resolve({ well, interpretation, settings }) {
      const sets = pressureSets(well.pointSets);
      if (sets.length === 0) return null;
      const waterDens = interpretation ? activeWaterDensity(well, interpretation) : null;
      return mdtTrackState(sets, interpretation, settings, waterDens);
    },
  },
  draw(frame: OverlayFrame) {
    const an = analysisOf(frame);
    if (an.sets.length === 0) return;
    const { ctx, viewport: vp, theme } = frame;
    const right = frame.tracks.reduce((mx, t) => Math.max(mx, t.x + t.width), 0);
    const left = frame.tracks.reduce((mn, t) => Math.min(mn, t.x), Infinity);
    const pt = pressureTrack(frame);
    ctx.save();
    // Línea vertical de referencia: P_ex = 0 en modo Exceso; hidrostática normal (1,00 g/cm³) en modo EMW.
    if (pt) {
      const { axis } = frameAxisAndRef(frame, an, pt);
      const refVal =
        axis.axisMode === 'excess'
          ? 0
          : axis.axisMode === 'emw'
            ? axis.emwUnit === 'lb/gal'
              ? densityToLbPerGal(HYDROSTATIC_NORMAL_DENSITY)
              : HYDROSTATIC_NORMAL_DENSITY
            : null;
      if (refVal !== null) {
        const xr = pt.xOf(null, refVal);
        if (xr !== null && xr > 2 && xr < pt.width - 2) {
          const x = Math.round(pt.x + xr) + 0.5;
          ctx.save();
          ctx.strokeStyle = withAlpha(theme.color.textMuted, 0.55);
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, vp.height);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    for (const c of visibleContacts(an)) {
      const y = Math.round(vp.yOf(c.depth!)) + 0.5;
      if (y < -2 || y > vp.height + 2) continue;
      const color = fluidColor(c.lower.fluid, theme);
      // Banda tenue de 1 px a cada lado: se lee sobre rellenos y curvas sin taparlos.
      ctx.fillStyle = withAlpha(theme.viewer.trackBg, 0.55);
      ctx.fillRect(left, y - 2, right - left, 4);
      ctx.strokeStyle = withAlpha(color, 0.9);
      ctx.lineWidth = 1.25;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      if (pt) {
        ctx.setLineDash([]);
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.moveTo(pt.x, y);
        ctx.lineTo(pt.x + pt.width, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  },
  hit(frame, p) {
    const t = pressureTrack(frame);
    if (!t) return null;
    const an = analysisOf(frame);
    const { axis, excessRef } = frameAxisAndRef(frame, an, t);
    const dt = depthTrack(frame);
    if (dt && p.track?.id === dt.id) {
      for (const c of visibleContacts(an)) {
        const b = contactPillBox(c, dt, frame.viewport.yOf(c.depth!), frame.uiScale ?? 1);
        if (p.x >= b.x - 2 && p.x <= b.x + b.w + 2 && p.y >= b.y - 2 && p.y <= b.y + b.h + 2) {
          return { label: contactTooltip(c, axis, excessRef), cursor: 'default', range: { top: c.depth! - 25, base: c.depth! + 25 } };
        }
      }
      return null;
    }
    if (p.track?.id !== t.id) return null;
    let best: DrawnPoint | null = null;
    let bestD = POINT_HIT_PX * (frame.uiScale ?? 1);
    for (const d of placePoints(frame, an)) {
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist <= bestD) {
        bestD = dist;
        best = d;
      }
    }
    if (best) return pointHit(frame, an, best);
    // Línea de un contacto (solo en la pista de presión: en las demás manda la lectura de curvas).
    for (const c of visibleContacts(an)) {
      if (Math.abs(p.y - frame.viewport.yOf(c.depth!)) <= 5) return { label: contactTooltip(c, axis, excessRef), cursor: 'default', range: { top: c.depth! - 25, base: c.depth! + 25 } };
    }
    return null;
  },
  targets(frame): OverlayTarget[] {
    if (!pressureTrack(frame)) return [];
    const an = analysisOf(frame);
    return placePoints(frame, an).map((d) => ({ depth: d.depth, hit: pointHit(frame, an, d) }));
  },
};

/** Puntos y rótulos de contacto, encima de las líneas de tendencia. */
const points: ViewerOverlay = {
  id: MDT_POINTS_OVERLAY_ID,
  label: 'Presiones MDT (puntos)',
  layer: 'over',
  order: 30,
  draw(frame: OverlayFrame) {
    const t = pressureTrack(frame);
    if (!t) return;
    const an = analysisOf(frame);
    if (an.sets.length === 0) return;
    const { ctx, viewport: vp, theme } = frame;
    const active = frame.active?.overlayId === MDT_OVERLAY_ID ? frame.active.key : null;
    const halo = theme.viewer.trackBg;
    const muted = theme.color.textMuted;
    const { axis, excessRef } = frameAxisAndRef(frame, an, t);
    const drawdownUnit = frame.data.overlaySettings?.[MDT_OVERLAY_ID]
      ? displayUnitOf(frame.data.overlaySettings[MDT_OVERLAY_ID])
      : asDisplayUnit(t.unit);
    const drawdown = drawdownScale(frame.data, drawdownUnit);
    const warn = theme.color.warn;
    ctx.save();
    ctx.beginPath();
    ctx.rect(t.x, 0, t.width, vp.height);
    ctx.clip();
    const list = placePoints(frame, an);
    // Descartados primero (debajo), incluidos encima.
    for (const pass of [false, true]) {
      for (const d of list) {
        if (d.included !== pass || d.y < -8 || d.y > vp.height + 8) continue;
        const r = POINT_RADIUS;
        const color = drawdown
          ? drawdown.colorOf(pointNumbers(d.set, PRESSURE_COLUMNS.drawdown)?.[d.i])
          : d.included ? fluidColor(d.fluid, theme) : muted;
        if (d.clamp !== 0) {
          // Fuera de escala: triángulo apuntando hacia afuera.
          const dir = d.clamp;
          ctx.fillStyle = drawdown && !d.included ? halo : color;
          ctx.beginPath();
          ctx.moveTo(d.x + dir * 4, d.y);
          ctx.lineTo(d.x - dir * 3, d.y - 4);
          ctx.lineTo(d.x - dir * 3, d.y + 4);
          ctx.closePath();
          ctx.fill();
          if (drawdown && !d.included) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.25;
            ctx.stroke();
          }
          continue;
        }
        if (d.included) {
          ctx.fillStyle = color;
          ctx.strokeStyle = halo;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(d.x, d.y, r, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          if (d.forced) {
            ctx.strokeStyle = warn;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(d.x, d.y, r + 2.5, 0, 2 * Math.PI);
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = withAlpha(halo, 0.85);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(d.x, d.y, r, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(d.x - 2.2, d.y - 2.2);
          ctx.lineTo(d.x + 2.2, d.y + 2.2);
          ctx.moveTo(d.x + 2.2, d.y - 2.2);
          ctx.lineTo(d.x - 2.2, d.y + 2.2);
          ctx.stroke();
        }
        if (active === d.key) {
          ctx.strokeStyle = theme.color.accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(d.x, d.y, r + 4, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    // Contactos: rombo donde se cortan los gradientes (pista de presión) y pastilla con la sigla en la pista de
    // profundidad (donde se leen los topes; en la de presión chocaría con las etiquetas de los gradientes, que
    // nacen justo en los extremos de cada tramo).
    const dt = depthTrack(frame);
    ctx.save();
    const u = frame.uiScale ?? 1;
    ctx.font = `${BASE_TOKENS.weight.bold} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const c of visibleContacts(an)) {
      const y = vp.yOf(c.depth!);
      if (y < -12 || y > vp.height + 12) continue;
      const color = fluidColor(c.lower.fluid, theme);
      const xVal = mdtAxisValue(contactPressurePsi(c), c.depth!, axis, excessRef);
      const xr = Number.isFinite(xVal) ? t.xOf(null, xVal) : null;
      if (xr !== null && xr >= 0 && xr <= t.width) {
        const x = t.x + xr;
        ctx.fillStyle = color;
        ctx.strokeStyle = halo;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 6, y);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      }
      const box = contactPillBox(c, dt ?? t, y, u);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, box.h / 2);
      ctx.fill();
      if (c.warning) {
        ctx.strokeStyle = theme.color.warn;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // Texto claro u oscuro según el color de la pastilla (en el tema oscuro los fluidos son claros).
      ctx.fillStyle = contrastRatio(color, '#ffffff') >= 3 ? '#ffffff' : '#111418';
      ctx.fillText(CONTACT_LABEL[c.kind].short, box.x + box.w / 2, box.y + box.h / 2 + 0.5);
    }
    ctx.restore();
  },
};

export const overlays: ViewerOverlay[] = [main, points];
