/**
 * Superposición de zonas: bandas translúcidas sobre las pistas, franja de color con el nombre en la pista de
 * profundidad, líneas de tope y rótulo con el nombre (fijo arriba mientras la zona está a la vista).
 * Perfil clásico (`frame.look === 'classic'`, docs/decisiones/0067): sin teñir las pistas; cada tope es una línea fina
 * del color de la zona que cruza todo el perfil, con el nombre en texto chico junto a la línea, y una franja angosta
 * con el color de la formación junto a la columna de profundidad. La edición es la misma con los dos estilos.
 * Clic en la franja, en la pista de profundidad o en un rótulo → `onSelect` (otro clic sobre la seleccionada la
 * deselecciona); doble clic → muestra la zona entera. Usa el contrato de `../overlay.ts` como cualquier módulo.
 *
 * Edición (fase 4b, si se pasa `edit`; docs/decisiones/0005, D10):
 * - Arrastrar un tope, una base o un contacto entre zonas contiguas (a ±5 px de la línea): vista previa en vivo con
 *   la profundidad y el espesor, ajuste a la muestra, frena en la vecina; Escape cancela; al soltar, `commit`.
 * - Modo «marcar zona» (`edit.marking()`): arrastrar en cualquier punto crea una zona en ese tramo.
 * - Teclado: cada tope/base/contacto es un `target` (Tab lo alcanza, ↑/↓ lo mueven por `nudge`).
 * Las recetas son las puras de src/core/state/zones.ts; la superposición no guarda nada: llama a `edit.commit`.
 */
import { createZone, moveZoneEdge, nudgeZoneEdge, contactGap, type NewZoneInput, type ZoneEdge } from '../../core/state/zones';
import type { Zone } from '../../core/well';
import { contrastRatio, ensureContrast, withAlpha } from '../../ui/color';
import { formatNumber } from '../../ui/format';
import { BASE_TOKENS, scalePx, THEMES } from '../../ui/tokens';
import type { OverlayFrame, OverlayHit, OverlayHitFrame, OverlayPointer, OverlayTarget, OverlayTrack, ViewerOverlay, ViewerZone } from '../overlay';

/** Medidas en px de Compacto: se multiplican por `frame.uiScale` (tamaño de interfaz; 1 en las figuras). */
const STRIP = 14;
const LABEL_H = 16;
/** Perfil clásico: franja de formación junto a la profundidad y alto del rótulo de texto. */
const CLASSIC_STRIP = 6;
const CLASSIC_LABEL_H = 12;
const CLASSIC_LABEL_PX = 10;
const isClassic = (frame: Pick<OverlayHitFrame, 'look'>) => frame.look === 'classic';
/** Distancia (px) a una línea de tope para agarrarla. */
export const EDGE_HIT_PX = 5;

/** Borde editable: tope, base o contacto entre dos zonas contiguas (se mueven juntas). */
export interface ZoneBoundary {
  key: string;
  depth: number;
  /** Zona y borde que se mueven (en un contacto, el tope de la de abajo: la de arriba la acompaña). */
  zoneId: string;
  edge: ZoneEdge;
  label: string;
}

const m = (d: number) => `${formatNumber(d, { digits: 1, grouping: true })} m`;

/** Bordes editables de un juego de zonas (un contacto compartido es UN borde). Puro. */
export function zoneBoundaries(zones: readonly Zone[], depth: ArrayLike<number>): ZoneBoundary[] {
  const sorted = [...zones].sort((a, b) => a.top - b.top);
  const out: ZoneBoundary[] = [];
  sorted.forEach((z, k) => {
    const prev = sorted[k - 1];
    const next = sorted[k + 1];
    if (prev && contactGap(prev, z, depth) !== null) out.push({ key: `c:${z.id}`, depth: z.top, zoneId: z.id, edge: 'top', label: `Contacto ${prev.name}/${z.name} · ${m(z.top)}` });
    else out.push({ key: `t:${z.id}`, depth: z.top, zoneId: z.id, edge: 'top', label: `Tope de ${z.name} · ${m(z.top)}` });
    if (!next || contactGap(z, next, depth) === null) out.push({ key: `b:${z.id}`, depth: z.base, zoneId: z.id, edge: 'base', label: `Base de ${z.name} · ${m(z.base)}` });
  });
  return out;
}

/**
 * Nombre del borde para la etiqueta del cambio («tope de C», «base de E», «contacto A/B»): se lee en
 * «Deshacer: Mover tope de C». El arrastre y ↑/↓ usan la misma etiqueta, así varios ↑/↓ seguidos se agrupan.
 */
export function boundaryName(b: ZoneBoundary): string {
  const head = b.label.split(' · ')[0]!;
  return head.charAt(0).toLowerCase() + head.slice(1);
}

export interface ZonesEditOptions {
  /** Zonas y profundidad ACTUALES (del store): las recetas siempre parten del estado al día. */
  current(): { zones: readonly Zone[]; depth: ArrayLike<number> } | null;
  /** Modo «marcar zona» activo. */
  marking(): boolean;
  /** Guarda una edición (receta ya aplicada). `clone`: la zona partida cuyo resto inferior hereda parámetros. */
  commit(zones: Zone[], label: string, clone?: { from: string; to: string } | null): void;
  /** Id, nombre y color para una zona nueva. */
  newZone(zones: readonly Zone[]): NewZoneInput;
  /** Se creó una zona (para seleccionarla y salir del modo). */
  created?(zone: Zone): void;
  /** Un tramo no se pudo marcar (mensaje en español). */
  error?(message: string): void;
}

export interface ZonesOverlayOptions {
  onSelect?: (zoneId: string | null) => void;
  edit?: ZonesEditOptions;
}

/** Caja del rótulo de una zona (en la primera pista de curvas). Estimación sin medir texto: sirve a draw y a hit. */
function labelBox(z: ViewerZone, frame: OverlayHitFrame, track: OverlayTrack): { x: number; y: number; w: number; h: number } | null {
  const vp = frame.viewport;
  const yTop = vp.yOf(z.top);
  const yBase = vp.yOf(z.base);
  if (yBase < 0 || yTop > vp.height) return null;
  const u = frame.uiScale ?? 1;
  if (isClassic(frame)) {
    const h = scalePx(CLASSIC_LABEL_H, u);
    const y = Math.max(yTop + 2, 2);
    if (y + h > yBase - 1) return null;
    return { x: track.x + 3, y, w: (6 + z.name.length * 6.2) * u, h };
  }
  const h = scalePx(LABEL_H, u);
  const y = Math.max(yTop + 3, 3);
  if (y + h > yBase - 2) return null;
  return { x: track.x + 4, y, w: (12 + z.name.length * 6.6) * u, h };
}

const firstCurveTrack = (tracks: readonly OverlayTrack[]) => tracks.find((t) => t.kind !== 'depth') ?? null;
/** Pista donde van las pastillas de edición: la primera después de la de profundidad (no tapan su rótulo). */
const pillTrack = (tracks: readonly OverlayTrack[]) => {
  const d = tracks.findIndex((t) => t.kind === 'depth');
  return tracks.slice(d + 1).find((t) => t.kind !== 'depth') ?? firstCurveTrack(tracks);
};

/** Tinta legible sobre el color de la zona: el texto del tema oscuro (claro) o el del claro (oscuro), el de más contraste. */
const INK_DARK = THEMES.light.color.text;
const INK_LIGHT = THEMES.dark.color.text;
function readableOn(bg: string): string {
  return contrastRatio(INK_LIGHT, bg) >= contrastRatio(INK_DARK, bg) ? INK_LIGHT : INK_DARK;
}

function zoneRange(z: ViewerZone): string {
  return `${formatNumber(z.top, { digits: 1, grouping: false })}–${formatNumber(z.base, { digits: 1, grouping: false })} m`;
}

const toViewer = (z: Zone): ViewerZone => ({ id: z.id, name: z.name, top: z.top, base: z.base, color: z.color });

/** Pastilla con texto (profundidad durante un arrastre, tramo nuevo). */
function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string, ink: string, maxX: number, u: number): void {
  ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, u)}px ${BASE_TOKENS.font.sans}`;
  const pad = scalePx(7, u);
  const w = ctx.measureText(text).width + 2 * pad;
  const h = scalePx(20, u);
  const bx = Math.min(x, maxX - w - 4);
  const by = y - h / 2;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + pad, by + h / 2 + 0.5);
}

export function createZonesOverlay(opts: ZonesOverlayOptions = {}): ViewerOverlay[] {
  const edit = opts.edit;
  /** Vista previa de un arrastre: zonas resultantes y el borde que se mueve. */
  let preview: { zones: ViewerZone[]; key: string | null; depth: number; text: string } | null = null;
  /** Tramo que se está marcando (modo marcar zona). */
  let draft: { top: number; base: number; created: ViewerZone | null; error: string | null } | null = null;

  const shown = (data: OverlayHitFrame['data']): readonly ViewerZone[] => preview?.zones ?? data.zones;

  const under: ViewerOverlay = {
    id: 'zones-bands',
    label: 'Zonas (bandas)',
    layer: 'under',
    order: -10,
    draw({ ctx, viewport: vp, tracks, data, theme, uiScale, look }) {
      const alpha = theme.viewer.zoneAlpha;
      const u = uiScale ?? 1;
      if (look === 'classic') {
        // Solo la franja de la formación, al lado de la columna de profundidad: las pistas quedan blancas.
        const depthTrack = tracks.find((t) => t.kind === 'depth');
        if (!depthTrack) return;
        const w = scalePx(CLASSIC_STRIP, u);
        for (const z of shown(data)) {
          const y0 = vp.yOf(z.top);
          const y1 = vp.yOf(z.base);
          if (y1 < 0 || y0 > vp.height) continue;
          ctx.fillStyle = withAlpha(z.color, z.id === data.selectedZoneId ? 1 : 0.85);
          ctx.fillRect(depthTrack.x, y0, w, y1 - y0);
        }
        return;
      }
      const strip = scalePx(STRIP, u);
      for (const z of shown(data)) {
        const y0 = vp.yOf(z.top);
        const y1 = vp.yOf(z.base);
        if (y1 < 0 || y0 > vp.height) continue;
        const selected = z.id === data.selectedZoneId;
        for (const t of tracks) {
          if (t.kind === 'depth') {
            ctx.fillStyle = withAlpha(z.color, selected ? 0.95 : 0.7);
            ctx.fillRect(t.x, y0, strip, y1 - y0);
            continue;
          }
          // Sutiles: la zona se lee por la franja y los topes; la banda solo da contexto.
          ctx.fillStyle = withAlpha(z.color, alpha * (selected ? 0.5 : data.selectedZoneId ? 0.25 : 0.5));
          ctx.fillRect(t.x, y0, t.width, y1 - y0);
        }
        // Nombre vertical en la franja, centrado en la parte visible.
        const depthTrack = tracks.find((t) => t.kind === 'depth');
        const vis0 = Math.max(0, y0);
        const vis1 = Math.min(vp.height, y1);
        if (depthTrack && vis1 - vis0 > (18 + z.name.length * 7) * u) {
          ctx.save();
          ctx.translate(depthTrack.x + strip / 2, (vis0 + vis1) / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillStyle = readableOn(z.color);
          ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(10, u)}px ${BASE_TOKENS.font.sans}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(z.name, 0, 0.5);
          ctx.restore();
        }
      }
    },
  };

  const boundaries = (_frame: OverlayHitFrame): ZoneBoundary[] => {
    const cur = edit?.current();
    return cur ? zoneBoundaries(cur.zones, cur.depth) : [];
  };

  /** Hit de un borde (arrastre + teclado). */
  const boundaryHit = (b: ZoneBoundary): OverlayHit & { key: string } => ({
    key: b.key,
    label: b.label,
    cursor: 'ns-resize',
    drag: {
      cursor: 'ns-resize',
      move(p, _start) {
        const cur = edit!.current();
        if (!cur || !Number.isFinite(p.depth)) return;
        const next = moveZoneEdge(cur.zones, b.zoneId, b.edge, p.depth, { depth: cur.depth });
        const z = next.find((x) => x.id === b.zoneId)!;
        const d = z[b.edge];
        // Espesores de las zonas que cambian (en un contacto, las dos).
        const sorted = [...next].sort((a, c) => a.top - c.top);
        const k = sorted.findIndex((x) => x.id === z.id);
        const other = b.key.startsWith('c:') ? sorted[k - 1] : undefined;
        const thick = (x: Zone) => `${x.name} ${formatNumber(x.base - x.top, { digits: 1 })} m`;
        preview = { zones: next.map(toViewer), key: b.key, depth: d, text: `${m(d)} · ${other ? `${thick(other)} · ` : ''}${thick(z)}` };
        frameRef?.invalidate();
      },
      end() {
        const cur = edit!.current();
        const p = preview;
        preview = null;
        if (!cur || !p) return;
        const next = moveZoneEdge(cur.zones, b.zoneId, b.edge, p.depth, { depth: cur.depth });
        if (next !== cur.zones) edit!.commit(next, `Mover ${boundaryName(b)}`);
        frameRef?.invalidate();
      },
      cancel() {
        preview = null;
        frameRef?.invalidate();
      },
    },
    nudge(deltaM) {
      const cur = edit!.current();
      if (!cur) return;
      // La zona puede haber cambiado de borde desde que se calculó el hit: se busca de nuevo por clave.
      const fresh = zoneBoundaries(cur.zones, cur.depth).find((x) => x.key === b.key) ?? b;
      const next = nudgeZoneEdge(cur.zones, fresh.zoneId, fresh.edge, deltaM, { depth: cur.depth });
      if (next !== cur.zones) edit!.commit(next, `Mover ${boundaryName(fresh)}`);
    },
  });

  /** El último frame visto (para pedir redibujo desde los callbacks del arrastre). */
  let frameRef: OverlayHitFrame | null = null;

  const markHit = (): OverlayHit => {
    let input: NewZoneInput | null = null;
    return {
      label: 'Arrastrá para marcar una zona nueva',
      cursor: 'crosshair',
      drag: {
        cursor: 'crosshair',
        move(p, start) {
          const cur = edit!.current();
          if (!cur || !Number.isFinite(p.depth) || !Number.isFinite(start.depth)) return;
          input ??= edit!.newZone(cur.zones);
          const r = createZone(cur.zones, start.depth, p.depth, input, { depth: cur.depth });
          const top = Math.min(start.depth, p.depth);
          const base = Math.max(start.depth, p.depth);
          if ('error' in r) {
            draft = { top, base, created: null, error: r.error };
            preview = null;
          } else {
            draft = { top: r.created.top, base: r.created.base, created: toViewer(r.created), error: null };
            preview = { zones: r.zones.map(toViewer), key: null, depth: r.created.base, text: '' };
          }
          frameRef?.invalidate();
        },
        end(p, start) {
          const cur = edit!.current();
          preview = null;
          draft = null;
          frameRef?.invalidate();
          if (!cur || !input) return;
          const r = createZone(cur.zones, start.depth, p.depth, input, { depth: cur.depth });
          input = null;
          if ('error' in r) {
            edit!.error?.(r.error);
            return;
          }
          edit!.commit(r.zones, `Marcar zona ${r.created.name}`, r.clone);
          edit!.created?.(r.created);
        },
        cancel() {
          preview = null;
          draft = null;
          input = null;
          frameRef?.invalidate();
        },
      },
    };
  };

  const over: ViewerOverlay = {
    id: 'zones-tops',
    label: 'Zonas (topes)',
    layer: 'over',
    order: 10,
    draw(frame: OverlayFrame) {
      frameRef = frame;
      const { ctx, viewport: vp, tracks, data, theme } = frame;
      const first = firstCurveTrack(tracks);
      const width = tracks.reduce((mx, t) => Math.max(mx, t.x + t.width), 0);
      const sorted = [...shown(data)].sort((a, b) => a.top - b.top);
      const classic = isClassic(frame);
      sorted.forEach((z, k) => {
        const selected = z.id === data.selectedZoneId;
        const y0 = vp.yOf(z.top);
        const y1 = vp.yOf(z.base);
        if (y1 < -2 || y0 > vp.height + 2) return;
        // Clásico: línea de 1 px del color de la zona, oscurecida lo justo para leerse sobre el fondo blanco.
        ctx.strokeStyle = classic ? ensureContrast(z.color, theme.viewer.trackBg, 2.2) : withAlpha(z.color, selected ? 1 : 0.85);
        ctx.lineWidth = selected ? 2 : 1;
        ctx.beginPath();
        const ty = Math.round(y0) + (selected ? 0 : 0.5);
        ctx.moveTo(0, ty);
        ctx.lineTo(width, ty);
        // Base solo si no la marca el tope de la zona siguiente (zonas contiguas).
        const next = sorted[k + 1];
        if (!next || next.top - z.base > 0.5) {
          const by = Math.round(y1) + (selected ? 0 : 0.5);
          ctx.moveTo(0, by);
          ctx.lineTo(width, by);
        }
        ctx.stroke();
        if (!first) return;
        const box = labelBox(z, frame, first);
        if (!box) return;
        if (classic) {
          // Nombre en texto chico junto a la línea, con un halo del fondo para leerse sobre las curvas.
          const fontPx = scalePx(CLASSIC_LABEL_PX, frame.uiScale ?? 1);
          ctx.font = `${selected ? BASE_TOKENS.weight.bold : BASE_TOKENS.weight.semibold} ${fontPx}px ${BASE_TOKENS.font.sans}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 3;
          ctx.strokeStyle = withAlpha(theme.viewer.trackBg, 0.9);
          const ty = box.y + box.h / 2 + 0.5;
          ctx.strokeText(z.name, box.x + 1, ty);
          ctx.fillStyle = ensureContrast(z.color, theme.viewer.trackBg, 4.5);
          ctx.fillText(z.name, box.x + 1, ty);
          return;
        }
        ctx.fillStyle = z.color;
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, 4);
        ctx.fill();
        if (selected) {
          ctx.strokeStyle = theme.viewer.depthText;
          ctx.lineWidth = 1.25;
          ctx.stroke();
        }
        ctx.fillStyle = readableOn(z.color);
        ctx.font = `${BASE_TOKENS.weight.semibold} ${scalePx(BASE_TOKENS.text.xs, frame.uiScale ?? 1)}px ${BASE_TOKENS.font.sans}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(z.name, box.x + box.w / 2, box.y + box.h / 2 + 0.5);
      });

      // Borde activo (teclado o último arrastre) o en arrastre: línea de acento con asas y su profundidad.
      const accent = theme.color.accent;
      const activeKey = preview?.key ?? (frame.active?.overlayId === 'zones-tops' ? frame.active.key : null);
      const pt = pillTrack(tracks);
      if (edit && activeKey) {
        // Con el teclado la etiqueta la muestra el botón enfocado; acá solo durante un arrastre.
        const b = preview?.key ? { depth: preview.depth, label: preview.text } : { ...boundaries(frame).find((x) => x.key === activeKey), label: '' };
        if (b && b.depth !== undefined) {
          const y = Math.round(vp.yOf(b.depth));
          if (y >= -2 && y <= vp.height + 2) {
            ctx.strokeStyle = accent;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            for (const t of tracks) {
              if (t.kind === 'depth') continue;
              ctx.fillStyle = theme.viewer.trackBg;
              ctx.strokeStyle = accent;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.roundRect(t.x + t.width / 2 - 9, y - 3, 18, 6, 3);
              ctx.fill();
              ctx.stroke();
            }
            const off = scalePx(16, frame.uiScale ?? 1);
            if (pt && b.label) pill(ctx, b.label, pt.x + 8, y - off < 10 ? y + off : y - off, accent, theme.color.textOnAccent, width, frame.uiScale ?? 1);
          }
        }
      }

      // Tramo que se está marcando.
      if (draft) {
        const y0 = vp.yOf(draft.top);
        const y1 = vp.yOf(draft.base);
        const color = draft.error ? theme.color.error : draft.created?.color ?? accent;
        ctx.fillStyle = withAlpha(color, draft.error ? 0.1 : 0.22);
        ctx.fillRect(0, y0, width, y1 - y0);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y0) + 0.5);
        ctx.lineTo(width, Math.round(y0) + 0.5);
        ctx.moveTo(0, Math.round(y1) + 0.5);
        ctx.lineTo(width, Math.round(y1) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        const text = draft.error ?? `${draft.created?.name ?? 'Zona nueva'} · ${zoneRange({ top: draft.top, base: draft.base } as ViewerZone)} · ${formatNumber(draft.base - draft.top, { digits: 1 })} m`;
        if (pt) pill(ctx, text, pt.x + 8, Math.min(vp.height - 14, Math.max(14, (y0 + y1) / 2)), draft.error ? theme.color.error : accent, theme.color.textOnAccent, width, frame.uiScale ?? 1);
      }
    },
    hit(frame, p: OverlayPointer) {
      frameRef = frame;
      if (edit?.marking()) return markHit();
      if (edit) {
        // Bordes primero: a ±EDGE_HIT_PX de la línea se agarra el borde (en cualquier pista).
        let best: ZoneBoundary | null = null;
        let bestD = EDGE_HIT_PX * (frame.uiScale ?? 1) + 0.01;
        for (const b of boundaries(frame)) {
          const d = Math.abs(frame.viewport.yOf(b.depth) - p.y);
          if (d < bestD) {
            best = b;
            bestD = d;
          }
        }
        if (best) {
          const h = boundaryHit(best);
          return { ...h, label: `${best.label} · arrastrá para moverlo` };
        }
      }
      const z = frame.data.zones.find((zz) => p.depth >= zz.top && p.depth <= zz.base);
      if (!z) return null;
      const first = firstCurveTrack(frame.tracks);
      const box = first ? labelBox(z, frame, first) : null;
      const onLabel = !!box && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
      const onDepth = p.track?.kind === 'depth';
      if (!onLabel && !onDepth) return null;
      const selected = z.id === frame.data.selectedZoneId;
      return {
        label: `Zona ${z.name} · ${zoneRange(z)}${opts.onSelect ? (selected ? ' · clic para volver a los parámetros globales' : ' · clic para editar sus parámetros') : ''}`,
        cursor: 'pointer',
        ...(opts.onSelect ? { activate: () => opts.onSelect!(selected ? null : z.id), doubleClick: () => opts.onSelect!(z.id) } : {}),
        range: { top: z.top, base: z.base },
      };
    },
    ...(edit
      ? {
          targets(frame: OverlayHitFrame): OverlayTarget[] {
            frameRef = frame;
            return boundaries(frame).map((b) => ({ depth: b.depth, hit: boundaryHit(b) }));
          },
        }
      : {}),
  };
  return [under, over];
}
