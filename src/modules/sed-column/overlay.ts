/** Columna sedimentológica aportada por el módulo: lee tablas del motor, sin reclasificar curvas en el visor. */
import type { ReadonlyTableValue } from '../../core/module';
import type { SedLayer } from '../../petro/sedColumn';
import { canvasFont } from '../../ui/tokens';
import { formatNumber } from '../../ui/format';
import { withAlpha } from '../../ui/color';
import type { OverlayHit, OverlayHitFrame, ViewerOverlay } from '../../viewer/overlay';
import { drawShapeIcon } from '../electrosequences/draw';
import { CONFIDENCE_LABEL, sequencesFrom, shapeOutline, SHAPE_LABEL } from '../electrosequences/model';
import { decodeSedLayers } from './model';
import { drawLayer, layerRight, LITHOLOGY_LABEL } from './draw';
import { getSelectedLayer, selectLayer, subscribeSelectedLayer } from './selection';

export const SED_COLUMN_OVERLAY_ID = 'sed-column';
export const GRAIN_AXIS = ['arc', 'lim', 'mf', 'f', 'm', 'g', 'gr'].map((label, i) => ({ position: .09 + .11 * i, label }));
const GRAIN_LABEL = { clay: 'Arcilla', silt: 'Limo', veryFine: 'Arena muy fina', fine: 'Arena fina', medium: 'Arena media', coarse: 'Arena gruesa', gravel: 'Grava', unknown: 'Sin estimación' };
const SOURCE_LABEL = { minerals: 'Inversión mineral', vsh: 'Vsh', gr: 'GR normalizado', coal: 'Bandera de carbón', shale: 'Bandera de lutita', mixed: 'Entradas combinadas', unknown: 'Sin entradas válidas' };
const fmt = (value: number, digits = 2) => formatNumber(value, { digits });

function tableFor(frame: OverlayHitFrame, port: string): ReadonlyTableValue | undefined {
  return frame.data.tables?.find(table => table.port === port && table.active)?.value;
}

/** Caché por identidad de la tabla calculada: no se decodifica cada capa en cada movimiento del cursor. */
const decoded = new WeakMap<ReadonlyTableValue, readonly SedLayer[]>();
export function layersForFrame(frame: OverlayHitFrame): readonly SedLayer[] {
  const table = tableFor(frame, 'SED_COLUMN_LAYERS');
  if (!table) return [];
  const cached = decoded.get(table);
  if (cached) return cached;
  const layers = decodeSedLayers(table);
  decoded.set(table, layers);
  return layers;
}

/** Contactos con convención [tope, base), salvo la base final. */
export function layerAt(layers: readonly SedLayer[], depth: number): SedLayer | null {
  let lo = 0;
  let hi = layers.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const layer = layers[mid]!;
    if (depth < layer.top) hi = mid - 1;
    else if (depth >= layer.base && !(mid === layers.length - 1 && depth === layer.base)) lo = mid + 1;
    else return layer;
  }
  return null;
}

export function layerTooltip(layer: SedLayer): string {
  const volumes = ([['Cuarzo', layer.quartz], ['Calcita', layer.calcite], ['Dolomita', layer.dolomite], ['Arcilla', layer.clay], ['Porosidad', layer.phi]] as const)
    .filter((entry): entry is readonly [typeof entry[0], number] => entry[1] !== null && Number.isFinite(entry[1]))
    .map(([label, value]) => `${label} ${fmt(value * 100, 1)} %`);
  return [
    `${LITHOLOGY_LABEL[layer.lithology]} · ${GRAIN_LABEL[layer.grain]}`,
    `${fmt(layer.top)}–${fmt(layer.base)} m · espesor ${fmt(layer.thickness)} m`,
    `Origen: ${SOURCE_LABEL[layer.source]}`,
    ...(volumes.length ? [`Volúmenes medios bulk: ${volumes.join(' · ')}`] : []),
    ...(layer.vsh !== null ? [`Vsh media ${fmt(layer.vsh * 100, 1)} %`] : []),
    'Grano estimado desde perfiles; no es una descripción de testigo.',
    ...(layer.lithology === 'coal' ? ['Las capas subpíxel se muestran con un mínimo gráfico de 1,5 px.'] : []),
    ...(layer.belowMinimum && layer.lithology !== 'coal' ? ['Capa bajo el mínimo: límite de zona, hueco o tramo sin vecino compatible.'] : []),
  ].join('\n');
}

function hitFor(frame: OverlayHitFrame, layer: SedLayer): OverlayHit & { key: string } {
  return { key: `sed:${layer.top}`, label: layerTooltip(layer), cursor: 'pointer',
    activate: () => selectLayer(frame.data.wellId, layer.top), range: { top: layer.top, base: layer.base } };
}

export const overlays: ViewerOverlay[] = [{
  id: SED_COLUMN_OVERLAY_ID, label: 'Columna sedimentológica', layer: 'over', order: 60,
  subscribe: subscribeSelectedLayer,
  track: {
    title: 'Columna', scale: { kind: 'linear', min: 0, max: 1 }, width: 1.8,
    after: 'mineral-volumetric', workspaces: ['geology'], axisLabels: GRAIN_AXIS, headerLabel: 'Grano estimado',
  },
  draw(frame) {
    const track = frame.tracks.find(t => t.overlayId === SED_COLUMN_OVERLAY_ID);
    if (!track) return;
    const { ctx, theme, viewport: vp } = frame;
    const list = layersForFrame(frame);
    const x = track.x + track.width * .025;
    const separator = track.x + track.width * .8;
    ctx.save();
    ctx.beginPath(); ctx.rect(track.x, 0, track.width, vp.height); ctx.clip();
    // Fondo opaco: la columna se lee como descripción estimada, sin confundir las bandas de zona con las tramas.
    ctx.fillStyle = theme.viewer.trackBg; ctx.fillRect(track.x, 0, track.width, vp.height);
    ctx.fillStyle = theme.viewer.trackBgAlt; ctx.fillRect(separator, 0, track.width * .2, vp.height);
    ctx.strokeStyle = theme.viewer.gridMinor; ctx.lineWidth = .7;
    for (const axis of GRAIN_AXIS) {
      ctx.beginPath(); ctx.moveTo(track.x + track.width * axis.position, 0); ctx.lineTo(track.x + track.width * axis.position, vp.height); ctx.stroke();
    }
    ctx.strokeStyle = theme.viewer.trackBorder; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(separator, 0); ctx.lineTo(separator, vp.height); ctx.stroke();
    if (!list.length) {
      ctx.fillStyle = theme.viewer.axisText; ctx.font = canvasFont(11, 400, frame.uiScale ?? 1); ctx.textAlign = 'center';
      ctx.fillText('Sin capas calculadas', track.x + track.width * .4, vp.height / 2);
      ctx.restore(); return;
    }
    const selected = getSelectedLayer();
    let previous: SedLayer | null = null;
    for (const layer of list) {
      if (layer.base < vp.top) { previous = layer; continue; }
      if (layer.top > vp.base) break;
      const top = vp.yOf(layer.top);
      const bottom = vp.yOf(layer.base);
      const height = bottom - top;
      const right = layerRight(track.x, track.width, layer.width);
      drawLayer(ctx, layer, { x, y: Math.max(0, top), width: right - x, height: Math.max(0, Math.min(vp.height, bottom) - Math.max(0, top)) }, theme);
      ctx.strokeStyle = theme.color.textMuted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(right, top); ctx.lineTo(right, bottom);
      // Conecta sólo contactos reales: los huecos de datos no se completan.
      if (previous && Math.abs(previous.base - layer.top) < 1e-6) {
        ctx.moveTo(layerRight(track.x, track.width, previous.width), top); ctx.lineTo(right, top);
      }
      ctx.moveTo(x, top); ctx.lineTo(right, top); ctx.stroke();
      if (layer.lithology === 'coal' && height < 1.5) {
        ctx.fillStyle = '#08090b'; ctx.fillRect(x, Math.max(0, (top + bottom) / 2 - .75), right - x, 1.5);
      }
      if (frame.purpose === 'interactive' && ((selected?.wellId === frame.data.wellId && selected.top === layer.top) || (frame.active?.overlayId === SED_COLUMN_OVERLAY_ID && frame.active.key === `sed:${layer.top}`))) {
        ctx.fillStyle = withAlpha(theme.color.accent, .15); ctx.fillRect(x, top, right - x, Math.max(2, height));
        ctx.strokeStyle = theme.color.accent; ctx.lineWidth = 2;
        ctx.strokeRect(x, top, right - x, Math.max(2, height));
      }
      previous = layer;
    }
    // Íconos de las mismas electrosecuencias publicadas por el motor, sin segunda segmentación.
    const sequenceTable = tableFor(frame, 'ELECTROSEQUENCES');
    for (const sequence of sequencesFrom(sequenceTable?.rows ?? [])) {
      if (sequence.base < vp.top || sequence.top > vp.base) continue;
      const top = vp.yOf(sequence.top);
      const bottom = vp.yOf(sequence.base);
      if (bottom - top < 6) continue;
      const glyphHeight = Math.min(26, bottom - top - 3);
      const center = Math.max(glyphHeight / 2 + 2, Math.min(vp.height - glyphHeight / 2 - 2, vp.yOf((sequence.top + sequence.base) / 2)));
      const glyphWidth = Math.min(21, track.width * .13);
      const points = shapeOutline(sequence.shape).map(([px, py]) => [separator + (track.width * .2 - glyphWidth) / 2 + px * glyphWidth, center - glyphHeight / 2 + py * glyphHeight] as const);
      drawShapeIcon(ctx, sequence.shape, sequence.confidence, points, theme.name);
      ctx.strokeStyle = withAlpha(theme.viewer.axisText, .35); ctx.lineWidth = .75;
      ctx.beginPath(); ctx.moveTo(separator + 2, top); ctx.lineTo(separator + 2, bottom); ctx.stroke();
    }
    ctx.restore();
  },
  hit(frame, pointer) {
    if (pointer.track?.overlayId !== SED_COLUMN_OVERLAY_ID) return null;
    if (pointer.x > pointer.track.x + pointer.track.width * .8) {
      const sequence = sequencesFrom(tableFor(frame, 'ELECTROSEQUENCES')?.rows ?? []).find(s => pointer.depth >= s.top && pointer.depth < s.base);
      if (sequence) return { label: `${SHAPE_LABEL[sequence.shape]} · confianza ${CONFIDENCE_LABEL[sequence.confidence].toLowerCase()}\n${fmt(sequence.top)}–${fmt(sequence.base)} m\n${sequence.interpretation}`, range: { top: sequence.top, base: sequence.base } };
    }
    const layer = layerAt(layersForFrame(frame), pointer.depth);
    return layer ? hitFor(frame, layer) : null;
  },
  targets(frame) {
    return layersForFrame(frame).map(layer => ({ depth: (layer.top + layer.base) / 2, hit: hitFor(frame, layer) }));
  },
}];
