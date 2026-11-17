import { entryContext } from '../preparation/data';
import { sameContext } from '../../core/engine/context';
import { sameEngineInputs } from '../../core/interpretation';
import { SvgContext2D } from '../../io/export/figures/svg';
import { withSvgPath2D } from '../../io/export/figures/path';
import { templateById } from '../../io/export/figures/templates';
import { safeFileName } from '../../io/export';
import { listXYFigures } from '../../plots/xy/figures';
import { drawViewerFigure, layoutViewerFigure } from '../../viewer/figure';
import { buildViewerFigure, fitViewerFigure, selectTracks } from '../../viewer/figureInput';
import type { ResolvedTrack } from '../../viewer/resolve';
import { defaultFigureOptions } from '../export/figureActions';
import { renderFigure, type FigureEnv } from '../export/figureRender';
import { figureEnv } from '../export/figureSources';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { walkthroughReport } from '../flow/stopwatch';
import { stopwatchClock, useStopwatch } from '../flow/stopwatchStore';
import { buildReportModel, reportHtml, type ReportFigure, type ReportModel, type ReportOptions } from './report';

function dataUrl(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:image/svg+xml;base64,${btoa(text)}`;
}
/** Paginación exclusiva del informe: limita los encabezados sin eliminar curvas ni rellenos. */
export function paginateReportTracks(tracks: readonly ResolvedTrack[]): ResolvedTrack[][] {
  const depth = tracks.filter((t) => t.kind === 'depth');
  const expanded: ResolvedTrack[] = [];
  for (const track of tracks.filter((t) => t.kind !== 'depth')) {
    if (track.curves.length <= 6) { expanded.push(track); continue; }
    const parts: ResolvedTrack[] = [];
    const count = Math.ceil(track.curves.length / 6);
    for (let i = 0; i < count; i++) {
      const curves = track.curves.slice(i * 6, (i + 1) * 6);
      parts.push({ ...track, id: i === 0 ? track.id : `${track.id}:report:${i}`, title: `${track.title} · ${i + 1}/${count}`, curves, fills: [], grid: curves.findLast((c) => c.kind === 'line')?.axis ?? track.grid });
    }
    for (const [i, fill] of track.fills.entries()) {
      const endpoints = fill.b && fill.b.key !== fill.a.key ? [fill.a, fill.b] : [fill.a];
      const existing = parts.find((p) => endpoints.every((c) => p.curves.some((v) => v.key === c.key)));
      if (existing) { existing.fills.push(fill); continue; }
      // Un relleno entre curvas de partes distintas conserva ambas escalas y sus extremos en una pista propia.
      parts.push({ ...track, id: `${track.id}:report:fill:${i}`, title: `${track.title} · relleno ${i + 1}`, curves: endpoints, fills: [fill], grid: endpoints[endpoints.length - 1]!.axis });
    }
    expanded.push(...parts);
  }
  const pages: ResolvedTrack[][] = [];
  for (let i = 0; i < expanded.length; i += 6) pages.push([...depth, ...expanded.slice(i, i + 6)]);
  return pages;
}
/** Usa los dibujos existentes; ajusta el perfil completo de cada tramo a una página. */
export async function renderReport(options: ReportOptions, model: ReportModel, env: FigureEnv): Promise<string> {
  const figures: ReportFigure[] = [];
  if (options.profile !== 'none') {
    if (!env.viewer) throw new Error('No hay un perfil disponible para este pozo.');
    if (options.profile === 'zones' && model.zones.length === 0) throw new Error('Definí zonas o elegí el perfil completo.');
    const ranges = options.profile === 'well' ? [{ kind: 'well' as const }] : model.zones.map((z) => ({ kind: 'zone' as const, zoneId: z.id }));
    const pages = paginateReportTracks(selectTracks(env.viewer.tracks, options.trackIds));
    if (pages.length === 0) throw new Error('Elegí al menos una pista para la figura.');
    for (const range of ranges) {
      for (const [pageIndex, tracks] of pages.entries()) {
      const baseTitle = range.kind === 'zone' ? `Perfil · ${model.zones.find((z) => z.id === range.zoneId)!.name}` : 'Perfil completo';
      const title = `${baseTitle}${pages.length > 1 ? ` · parte ${pageIndex + 1}/${pages.length}` : ''}`;
      const req = { template: templateById('profile-tracks'), range, verticalScale: 500, widthCm: 26, marginCm: 0.3, trackIds: null, title };
      const input = buildViewerFigure(req, { ...env.viewer, tracks });
      const first = layoutViewerFigure(input);
      const zoom = Math.min(1, 980 / first.width);
      const fitted = fitViewerFigure(input, 520 / zoom, zoom).input;
      const layout = layoutViewerFigure(fitted);
      const svg = new SvgContext2D({ width: layout.width, height: layout.height, measure: env.raster.measure, title });
      withSvgPath2D(() => drawViewerFigure(svg.asCanvas(), fitted, layout));
      figures.push({ title, dataUrl: dataUrl(new TextEncoder().encode(svg.toSvg('#ffffff'))), caption: `${fitted.subtitle ?? ''}. Perfil ajustado a página; la escala física final depende del tamaño de impresión. Consultar los ejes MD. Las pistas densas se distribuyen en partes; los extremos de rellenos pueden repetirse para conservarlos.` });
      }
    }
  }
  for (const xyId of options.xyIds) {
    const source = env.xy.find((f) => f.id === xyId);
    if (!source) throw new Error('Un gráfico elegido ya no está disponible. Volvé a elegir los gráficos.');
    const rendered = await renderFigure({ ...defaultFigureOptions('crossplot-legend'), format: 'svg', xyId }, env);
    figures.push({ title: source.title, dataUrl: dataUrl(rendered.file.bytes), caption: 'Gráfico publicado al generar el informe; conserva sus filtros, ejes y leyendas.' });
  }
  return reportHtml(model, figures, options);
}

export async function generateReport(options: ReportOptions): Promise<{ html: string; name: string }> {
  const project = useProject.getState().project;
  const entry = selectActiveEntry(useProject.getState());
  const state = useResults.getState();
  const workspace = useUi.getState().workspace;
  const xy = listXYFigures();
  if (!entry) throw new Error('Cargá un pozo para generar el informe.');
  if (state.busy || state.error || !state.result || !sameContext(state.result.context,entryContext(entry))) throw new Error('Esperá a que termine el cálculo del pozo activo antes de generar el informe.');
  const built = buildReportModel(entry.well, entry.interpretation, state.result, new Date(), undefined,
    project.inputRevisions?.[entry.inputRevisionId ?? '']?.acquisition);
  // Cronómetro del recorrido (F19): copia del tiempo al generar; si no arrancó para este pozo, no aparece.
  const walkthrough = walkthroughReport(useStopwatch.getState().watch, stopwatchClock.now(), entry.well.id);
  const model = walkthrough ? { ...built, walkthrough } : built;
  const env = figureEnv();
  const html = await renderReport(options, model, env);
  const latest = selectActiveEntry(useProject.getState());
  const results = useResults.getState();
  if (!latest || latest.inputRevisionId !== entry.inputRevisionId || latest.well !== entry.well || !sameEngineInputs(latest.interpretation, entry.interpretation) || latest.interpretation !== entry.interpretation || useProject.getState().project.display !== project.display || results.result !== state.result || results.busy || results.error || workspace !== useUi.getState().workspace || (options.xyIds.length > 0 && xy !== listXYFigures())) throw new Error('El estado cambió mientras se generaba el informe. Generá una nueva copia.');
  return { html, name: `${safeFileName(entry.well.name, 'pozo')}_informe.html` };
}

