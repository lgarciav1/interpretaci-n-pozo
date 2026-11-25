import { createNotesOverlay } from '../../viewer/overlays/notes';
import { preparationViewCurves } from '../preparation/view';
import { usePreparationUi } from '../preparation/store';
import { effectiveWell } from '../preparation/data';
import { entryContext } from '../preparation/data';
/**
 * Lo que la app le da a la exportación de figuras: el contexto del pozo activo (pistas, curvas calculadas, zonas, sumario,
 * superposiciones en modo figura) y el motor de raster del navegador (canvas fuera de pantalla). Conecta los stores con
 * `figureRender.ts`, que no los conoce. docs/decisiones/0012-exportacion-de-figuras.md.
 */
import { sameContext } from '../../core/engine/context';
import type { Well } from '../../core/well';
import { rgbaToRgb } from '../../io/export/figures/pdf';
import type { TextMeasure } from '../../io/export/figures/svg';
import { createTrendsOverlays } from '../../plots/trend/overlay';
import { listXYFigures } from '../../plots/xy/figures';
import type { ViewerFigureContext } from '../../viewer/figureInput';
import type { ViewerData, ViewerOverlay } from '../../viewer/overlay';
import { createQcOverlay } from '../../viewer/overlays/qc';
import { createZonesOverlay } from '../../viewer/overlays/zones';
import { resolveTracks } from '../../viewer/resolve';
import { layoutFor, STACK_ROLE_HINTS, withOverlayTracks } from '../../viewer/templates';
import { wellTvdss } from '../../viewer/depthColumns';
import { DEFAULT_LOOK, lookOf } from '../../viewer/look';
import { computedCurves, computedRoleCatalog, computedTables } from '../computed';
import { withUserFlagCatalog, withUserFlagCurves } from '../../plots/userFlags';
import { visibleCurves } from '../toolString/select';
import { visibleQc } from '../plots/context';
import { moduleOverlays } from '../viewerOverlays';
import { selectActiveEntry, useProject } from '../store/project';
import { computeQc, useQc } from '../store/qc';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { resolveSeries } from '../trends/providers';
import { exportSources } from './exportActions';
import type { FigureEnv, RasterBackend } from './figureRender';

/**
 * Superposiciones de la figura: zonas (sin edición), calidad, tendencias SIN manijas y las de los módulos (presiones
 * MDT, corona). Instancias propias: no comparten estado de arrastre ni selección con las del visor en pantalla.
 */
const FIGURE_BUILTIN: ViewerOverlay[] = [createNotesOverlay(), ...createZonesOverlay({}), createQcOverlay(), ...createTrendsOverlays({ resolve: resolveSeries, presentation: true })];
const FIGURE_OVERLAYS: ViewerOverlay[] = [...FIGURE_BUILTIN, ...moduleOverlays(FIGURE_BUILTIN.map((o) => o.id))];

/** Pistas del espacio de trabajo activo, resueltas como en pantalla (con los overrides del usuario). */
export function figureTracks(well: Well) {
  const { project } = useProject.getState();
  const display = project.display;
  const workspace = useUi.getState().workspace;
  const entry=project.wells.find(e=>e.well===well);
  const candidateResult=useResults.getState().result;
  const result = entry && candidateResult && sameContext(candidateResult.context, entryContext(entry)) ? candidateResult : null;
  well = effectiveWell(well, result);
  const interpretation = entry?.interpretation;
  const computed = withUserFlagCurves(well.depth.values, interpretation?.userFlags, computedCurves(entry && result && sameContext(result.context,entryContext(entry)) ? result : null, well));
  const roleCatalog = withUserFlagCatalog(computedRoleCatalog(computed), interpretation?.userFlags);
  // El mismo estilo que en pantalla (docs/decisiones/0067): plantilla de fábrica, paleta y columna TVDSS.
  const look = display.look ?? DEFAULT_LOOK;
  return resolveTracks(
    withOverlayTracks(layoutFor(workspace, display.layouts, look), FIGURE_OVERLAYS, workspace, {
      well,
      ...(interpretation ? { interpretation } : {}),
      ...(display.overlays ? { settings: display.overlays } : {}),
    }),
    { depth: well.depth.values, curves: preparationViewCurves(visibleCurves(well, interpretation), interpretation, result, usePreparationUi.getState().compareOriginals), computed, catalog: roleCatalog, sources: interpretation?.sources, tvdss: wellTvdss(well) },
    { roles: display.roles, ...(display.curves[well.id] ? { curves: display.curves[well.id] } : {}) },
    { look },
  );
}

/** Contexto del pozo activo para dibujar su perfil; null sin pozo. */
export function viewerFigureContext(measure: TextMeasure): ViewerFigureContext | null {
  const entry = selectActiveEntry(useProject.getState());
  if (!entry) return null;
  const { well: originalWell, interpretation } = entry;
  const display = useProject.getState().project.display;
  const candidate = useResults.getState().result;
  const result = candidate && sameContext(candidate.context,entryContext(entry)) ? candidate : null;
  const well = effectiveWell(originalWell, result);
  const computed = withUserFlagCurves(well.depth.values, interpretation.userFlags, computedCurves(result, well));
  const zones = interpretation.zones.map((z) => ({ id: z.id, name: z.name, top: z.top, base: z.base, color: z.color }));
  const stored = useQc.getState().entries[well.id];
  const qc = stored && stored.well.depth === originalWell.depth && stored.well.curves === originalWell.curves ? stored.report : computeQc(originalWell);
  const data: ViewerData = {
    wellId: well.id,
    depth: well.depth.values,
    zones,
    selectedZoneId: null,
    qc: visibleQc(qc, well, interpretation),
    well,
    interpretation,
    computed,
    tables: computedTables(result, well),
    ...(display.overlays ? { overlaySettings: display.overlays } : {}),
  };
  return {
    well,
    tracks: figureTracks(originalWell),
    depth: well.depth.values,
    data,
    overlays: FIGURE_OVERLAYS,
    zones,
    summary: exportSources(well, result, false).summary,
    stackHints: STACK_ROLE_HINTS,
    date: new Date(),
    measure,
    look: lookOf(display.look),
  };
}

// ── motor de raster del navegador ──────────────────────────────────────────────────────────────────────────────

/** Lienzo fuera de pantalla: nunca el de la pantalla. */
function paint(width: number, height: number, scale: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no pudo crear la imagen (poca memoria): bajá la resolución o exportá SVG.');
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  draw(ctx);
  return canvas;
}

export function createCanvasBackend(): RasterBackend {
  let scratch: CanvasRenderingContext2D | null = null;
  const measure: TextMeasure = (font, text) => {
    scratch ??= document.createElement('canvas').getContext('2d');
    if (!scratch) return text.length * 6;
    scratch.font = font;
    return scratch.measureText(text).width;
  };
  return {
    measure,
    async png(width, height, scale, draw) {
      const canvas = paint(width, height, scale, draw);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error('El navegador no pudo codificar el PNG (imagen demasiado grande): bajá la resolución o exportá SVG.');
      return new Uint8Array(await blob.arrayBuffer());
    },
    async rgb(width, height, scale, draw) {
      const canvas = paint(width, height, scale, draw);
      const ctx = canvas.getContext('2d')!;
      const w = canvas.width;
      const h = canvas.height;
      const rgb = rgbaToRgb(ctx.getImageData(0, 0, w, h).data, w, h);
      canvas.width = canvas.height = 0;
      return { width: w, height: h, rgb };
    },
  };
}

/** Entorno de exportación con el estado actual de la app. */
export function figureEnv(raster: RasterBackend = createCanvasBackend()): FigureEnv {
  return { viewer: viewerFigureContext(raster.measure), xy: listXYFigures(), raster, date: new Date() };
}

