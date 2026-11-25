/**
 * Superposición opcional «Unidades hidráulicas SMLP» (G03): pinta sobre el visor las sub-unidades hidráulicas (S1, S2…)
 * definidas en el gráfico de Lorenz estratigráfico de `flow-capacity`.
 *
 * - Capa `under` (`flow-capacity-smlp-bands`, orden 15): bandas translúcidas suaves según el carácter hidráulico
 *   (Conducto, Homogéneo, Subordinado, Barrera / Sello parcial) sobre las pistas de curvas, detrás de las curvas y
 *   rellenos para no tapar nunca una traza.
 * - Capa `over` (`flow-capacity-smlp`, orden 28): líneas discontinuas en cada quiebre SMLP a lo ancho de las pistas,
 *   barra vertical de color y pastilla compacta «S1 · …» alineadas al borde derecho de la primera pista de curvas
 *   (dejando libre todo el borde izquierdo para `zones-tops` y `depth-notes`, y la pista de profundidad para
 *   `pay-intervals`).
 *
 * Lee la tabla `FLOW_UNITS` de la misma corrida (`frame.data.tables`) y los quiebres guardados en
 * `interpretation.moduleState['flow-capacity']`: funciona en pantalla, al recargar proyectos y en figuras exportadas.
 */
import type { ReadonlyTableValue } from '../../core/module';
import type { SmlpCharacter, SmlpSubUnit } from '../../petro/flowCapacity';
import { contrastRatio, ensureContrast, withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { BASE_TOKENS, scalePx, type ThemeTokens } from '../../ui/tokens';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayTarget, OverlayTrack, ViewerOverlay } from '../../viewer/overlay';
import {
  MODULE_ID,
  SMLP_BANDS_OVERLAY_ID,
  SMLP_CHARACTER_LABEL,
  SMLP_CHARACTER_SHORT,
  SMLP_OVERLAY_ID,
  TOTAL_KEY,
  UNITS_PORT,
  readFlowState,
  resolveSmlp,
  unitsFor,
  viewRangeFor,
  type ResolvedSmlp,
  type Row,
} from './model';
import { getSmlpPreviewZone, subscribeSmlpOverlay } from './overlaySync';

const fmt = (v: number, digits: number) => formatNumber(Number.isFinite(v) ? v : null, { digits });
const depthText = (v: number) => formatNumber(v, { digits: 2, grouping: false });

/** Color semántico de cada carácter SMLP tomado directamente de los tokens del tema. */
export function smlpCharacterColor(character: SmlpCharacter | null, theme: ThemeTokens): string {
  switch (character) {
    case 'conduit':
      return theme.color.ok;
    case 'homogeneous':
      return theme.color.info;
    case 'subordinate':
      return theme.color.warn;
    case 'barrier':
      return theme.color.error;
    default:
      return theme.color.textMuted;
  }
}

interface ResolvedOverlayState {
  zoneKey: string;
  zoneName: string;
  resolved: ResolvedSmlp;
}

const tableUnitsCache = new WeakMap<ReadonlyTableValue, Map<string, ReturnType<typeof unitsFor>>>();
const resolvedSmlpCache = new WeakMap<ReadonlyTableValue, Map<string, ResolvedSmlp>>();

function cachedUnitsFor(table: ReadonlyTableValue, zKey: string) {
  let byZone = tableUnitsCache.get(table);
  if (!byZone) {
    byZone = new Map();
    tableUnitsCache.set(table, byZone);
  }
  let units = byZone.get(zKey);
  if (!units) {
    units = unitsFor(table.rows as readonly Row[], zKey);
    byZone.set(zKey, units);
  }
  return units;
}

function cachedResolveSmlp(table: ReadonlyTableValue, zKey: string, savedKeys: readonly string[]): ResolvedSmlp {
  let byKey = resolvedSmlpCache.get(table);
  if (!byKey) {
    byKey = new Map();
    resolvedSmlpCache.set(table, byKey);
  }
  const cacheKey = `${zKey}\0${savedKeys.join('|')}`;
  let resolved = byKey.get(cacheKey);
  if (!resolved) {
    resolved = resolveSmlp(cachedUnitsFor(table, zKey), savedKeys);
    byKey.set(cacheKey, resolved);
  }
  return resolved;
}

/** Determina qué zona SMLP debe pintarse en el visor y resuelve sus sub-unidades. null si está apagada o sin quiebres. */
export function resolveOverlaySmlp(frame: OverlayHitFrame): ResolvedOverlayState | null {
  const flowState = readFlowState(frame.data.interpretation);
  if (!flowState.overlayEnabled) return null;

  const validZones = new Map(frame.data.zones.map((z) => [z.id, z.name]));
  const hasBreaksFor = (zKey: string | null | undefined): zKey is string =>
    !!zKey && (flowState.breaksByZone[zKey]?.length ?? 0) > 0 && (zKey === TOTAL_KEY || validZones.has(zKey));

  let targetKey: string | null = null;
  if (frame.purpose !== 'export') {
    const preview = getSmlpPreviewZone();
    if (preview && preview.wellId === frame.data.wellId && hasBreaksFor(preview.zoneKey)) {
      targetKey = preview.zoneKey;
    }
  }
  if (!targetKey && hasBreaksFor(flowState.overlayZoneKey)) {
    targetKey = flowState.overlayZoneKey;
  }
  if (!targetKey) {
    for (const k of Object.keys(flowState.breaksByZone)) {
      if (hasBreaksFor(k)) {
        targetKey = k;
        break;
      }
    }
  }
  if (!targetKey) return null;

  const table = frame.data.tables?.find((t) => t.moduleId === MODULE_ID && t.port === UNITS_PORT && t.active)?.value;
  if (!table) return null;

  const savedKeys = flowState.breaksByZone[targetKey] ?? [];
  const resolved = cachedResolveSmlp(table, targetKey, savedKeys);
  if (resolved.breaks.length === 0 || resolved.subUnits.length <= 1) return null;

  const zoneName = targetKey === TOTAL_KEY ? (frame.data.zones.length > 0 ? 'Total' : 'Pozo completo') : (validZones.get(targetKey) ?? '');
  return { zoneKey: targetKey, zoneName, resolved };
}

const curveTracksOf = (tracks: readonly OverlayTrack[]) => tracks.filter((t) => t.kind !== 'depth');

function unitKey(zoneKey: string, u: SmlpSubUnit): string {
  return `smlp:${zoneKey}:${u.index}:${u.top.toFixed(2)}-${u.base.toFixed(2)}`;
}

function slopeText(slope: number): string {
  if (slope === Infinity) return '∞';
  return Number.isFinite(slope) ? fmt(slope, 2) : '—';
}

function labelOf(zoneName: string, u: SmlpSubUnit): string {
  const charLabel = u.character ? SMLP_CHARACTER_LABEL[u.character] : 'Sin aporte';
  return [
    `Unidad SMLP ${u.label} · ${charLabel}${zoneName ? ` (${zoneName})` : ''}`,
    `${depthText(u.top)}–${depthText(u.base)} m (Δh ${fmt(u.h, 2)} m)`,
    `φ·h ${fmt(100 * u.phiHFrac, 1)} % · k·h ${fmt(100 * u.kHFrac, 1)} % · pend. ${slopeText(u.slope)}`,
    'Doble clic para encuadrar la unidad',
  ].join('\n');
}

function hitOf(zoneKey: string, zoneName: string, u: SmlpSubUnit): OverlayHit & { key: string } {
  return {
    key: unitKey(zoneKey, u),
    label: labelOf(zoneName, u),
    cursor: 'pointer',
    range: viewRangeFor(u.top, u.base),
  };
}

/** Caja estimada de la barra lateral y la pastilla alineadas al borde derecho de la primera pista de curvas. */
function pillGeometry(frame: OverlayHitFrame, track: OverlayTrack, u: SmlpSubUnit): { barX: number; barW: number; y0: number; y1: number; pillY: number; pillH: number; pillRight: number; pillMaxW: number } | null {
  const vp = frame.viewport;
  const y0 = vp.yOf(u.top);
  const y1 = vp.yOf(u.base);
  if (y1 < -20 || y0 > vp.height + 20) return null;
  const sc = frame.uiScale ?? 1;
  const visTop = Math.max(0, y0);
  const visBot = Math.min(vp.height, y1);
  const pillH = scalePx(15, sc);
  const barW = scalePx(4, sc);
  const barX = track.x + track.width - barW;
  const pillRight = barX - scalePx(3, sc);
  return {
    barX,
    barW,
    y0,
    y1,
    pillY: (visTop + visBot) / 2,
    pillH,
    pillRight,
    pillMaxW: Math.max(0, track.width - barW - scalePx(16, sc)),
  };
}

export const overlays: ViewerOverlay[] = [
  {
    id: SMLP_BANDS_OVERLAY_ID,
    label: 'Bandas SMLP',
    layer: 'under',
    order: 15,
    subscribe: subscribeSmlpOverlay,
    draw(frame: OverlayFrame) {
      const state = resolveOverlaySmlp(frame);
      if (!state) return;
      const tracks = curveTracksOf(frame.tracks);
      if (tracks.length === 0) return;
      const { ctx, theme, viewport: vp } = frame;
      const bandAlpha = theme.name === 'dark' ? 0.14 : 0.09;
      const activeKey = frame.purpose !== 'export' && frame.active?.overlayId === SMLP_OVERLAY_ID ? frame.active.key : null;

      ctx.save();
      for (const u of state.resolved.subUnits) {
        const y0 = vp.yOf(u.top);
        const y1 = vp.yOf(u.base);
        if (y1 < 0 || y0 > vp.height) continue;
        const clampedY0 = Math.max(0, y0);
        const clampedY1 = Math.min(vp.height, y1);
        const h = Math.max(1, clampedY1 - clampedY0);
        const color = smlpCharacterColor(u.character, theme);
        const isActive = unitKey(state.zoneKey, u) === activeKey;
        ctx.fillStyle = withAlpha(color, isActive ? bandAlpha + 0.08 : bandAlpha);
        for (const t of tracks) {
          ctx.fillRect(t.x, clampedY0, t.width, h);
        }
      }
      ctx.restore();
    },
  },
  {
    id: SMLP_OVERLAY_ID,
    label: 'Unidades hidráulicas SMLP',
    layer: 'over',
    order: 28,
    subscribe: subscribeSmlpOverlay,
    draw(frame: OverlayFrame) {
      const state = resolveOverlaySmlp(frame);
      if (!state) return;
      const tracks = curveTracksOf(frame.tracks);
      if (tracks.length === 0) return;
      const first = tracks[0]!;
      const x0 = Math.min(...tracks.map((t) => t.x));
      const x1 = Math.max(...tracks.map((t) => t.x + t.width));
      const { ctx, theme, viewport: vp } = frame;
      const sc = frame.uiScale ?? 1;
      const activeKey = frame.purpose !== 'export' && frame.active?.overlayId === SMLP_OVERLAY_ID ? frame.active.key : null;

      ctx.save();
      // 1. Barra vertical de color y pastilla por sub-unidad en la primera pista de curvas.
      ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(10, sc)}px ${BASE_TOKENS.font.sans}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      for (const u of state.resolved.subUnits) {
        const g = pillGeometry(frame, first, u);
        if (!g) continue;
        const color = ensureContrast(smlpCharacterColor(u.character, theme), theme.viewer.trackBg, 3);
        const isActive = unitKey(state.zoneKey, u) === activeKey;
        const h = Math.max(2, g.y1 - g.y0);

        // Barra vertical en el borde derecho de la primera pista de curvas (sin colisionar con zonas ni notas).
        const bw = isActive ? g.barW + 1 : g.barW;
        ctx.fillStyle = withAlpha(color, isActive ? 1 : 0.88);
        ctx.fillRect(first.x + first.width - bw, g.y0, bw, h);

        // Pastilla «S1 · Conducto» (o solo «S1» si el tramo es angosto/corto) a la izquierda de la barra derecha.
        const visH = Math.min(vp.height, g.y1) - Math.max(0, g.y0);
        if (visH < g.pillH + 2 || g.pillMaxW < scalePx(26, sc)) continue;

        const fullText = u.character ? `${u.label} · ${SMLP_CHARACTER_SHORT[u.character]}` : u.label;
        const padX = scalePx(6, sc);
        const fullW = ctx.measureText(fullText).width + 2 * padX;
        const shortW = ctx.measureText(u.label).width + 2 * padX;
        const text = fullW <= g.pillMaxW ? fullText : u.label;
        const pw = fullW <= g.pillMaxW ? fullW : shortW;
        if (pw > g.pillMaxW) continue;

        const bx = g.pillRight - pw;
        const by = Math.max(g.pillH / 2 + 2, Math.min(vp.height - g.pillH / 2 - 2, g.pillY));
        ctx.beginPath();
        ctx.roundRect(bx, by - g.pillH / 2, pw, g.pillH, g.pillH / 2);
        if (isActive) {
          ctx.fillStyle = color;
          ctx.fill();
          // Elige siempre la tinta de mayor contraste (WCAG AA ≥ 4,5:1 en todos los caracteres y temas).
          ctx.fillStyle = contrastRatio(color, '#ffffff') >= contrastRatio(color, '#111418') ? '#ffffff' : '#111418';
        } else {
          ctx.fillStyle = withAlpha(theme.color.surface, 0.94);
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = color;
          ctx.stroke();
          ctx.fillStyle = ensureContrast(color, theme.color.surface, 4.5);
        }
        ctx.fillText(text, bx + pw / 2, by + 0.5);
      }

      // 2. Líneas discontinuas horizontales en cada quiebre SMLP a través de todas las pistas de curvas.
      const lineInk = ensureContrast(theme.color.accent, theme.viewer.trackBg, 3);
      for (const b of state.resolved.breaks) {
        if (b.depth < vp.top || b.depth > vp.base) continue;
        const y = Math.round(vp.yOf(b.depth)) + 0.5;
        ctx.setLineDash([]);
        ctx.strokeStyle = withAlpha(theme.viewer.trackBg, 0.75);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();

        ctx.setLineDash([6, 3]);
        ctx.strokeStyle = withAlpha(lineInk, 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      }
      ctx.restore();
    },
    hit(frame: OverlayHitFrame, p): OverlayHit | null {
      const state = resolveOverlaySmlp(frame);
      if (!state) return null;
      const tracks = curveTracksOf(frame.tracks);
      if (tracks.length === 0 || !p.track || p.track.kind === 'depth') return null;
      const first = tracks[0]!;
      const sc = frame.uiScale ?? 1;

      // 1. Quiebre horizontal (a ±4 px en cualquier pista de curvas).
      const lineTol = scalePx(4, sc);
      for (const b of state.resolved.breaks) {
        const dy = Math.abs(frame.viewport.yOf(b.depth) - p.y);
        if (dy <= lineTol) {
          return {
            key: `smlp-break:${state.zoneKey}:${b.key}`,
            label: `Quiebre SMLP ${b.upperLabel}/${b.lowerLabel} · ${depthText(b.depth)} m\nFφh ${fmt(b.xPct, 1)} % · Fkh ${fmt(b.yPct, 1)} %`,
            cursor: 'pointer',
            range: viewRangeFor(b.depth, b.depth),
          };
        }
      }

      // 2. Barra vertical o pastilla en el borde derecho de la primera pista de curvas (libre el borde izquierdo para zonas y notas).
      if (p.track.id !== first.id) return null;
      const barW = scalePx(4, sc);
      const onBar = p.x >= first.x + first.width - barW - scalePx(3, sc) && p.x <= first.x + first.width + scalePx(2, sc);
      const tol = scalePx(2, sc);
      for (const u of state.resolved.subUnits) {
        const g = pillGeometry(frame, first, u);
        if (!g) continue;
        if (onBar && p.y >= g.y0 - tol && p.y <= g.y1 + tol) {
          return hitOf(state.zoneKey, state.zoneName, u);
        }
        const visH = Math.min(frame.viewport.height, g.y1) - Math.max(0, g.y0);
        if (visH >= g.pillH + 2 && g.pillMaxW >= scalePx(26, sc)) {
          const by = Math.max(g.pillH / 2 + 2, Math.min(frame.viewport.height - g.pillH / 2 - 2, g.pillY));
          const fullText = u.character ? `${u.label} · ${SMLP_CHARACTER_SHORT[u.character]}` : u.label;
          const estFullW = scalePx(12 + fullText.length * 5.6, sc);
          const estShortW = scalePx(12 + u.label.length * 5.6, sc);
          const pillW = estFullW <= g.pillMaxW ? estFullW : estShortW;
          if (pillW <= g.pillMaxW && p.x >= g.pillRight - pillW - tol && p.x <= g.pillRight + tol && Math.abs(p.y - by) <= g.pillH / 2 + tol) {
            return hitOf(state.zoneKey, state.zoneName, u);
          }
        }
      }
      return null;
    },
    targets(frame: OverlayHitFrame): OverlayTarget[] {
      const state = resolveOverlaySmlp(frame);
      if (!state) return [];
      return state.resolved.subUnits.map((u) => ({
        depth: u.top,
        hit: hitOf(state.zoneKey, state.zoneName, u),
      }));
    },
  },
];
