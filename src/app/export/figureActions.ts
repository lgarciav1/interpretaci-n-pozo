/**
 * Exportar figuras desde el diálogo «Exportar»: valores por defecto de cada plantilla, el pedido completo y la descarga.
 * Sin React. docs/decisiones/0012-exportacion-de-figuras.md.
 */
import { FIGURE_TEMPLATES, templateById, type FigureTemplate, type FigureTemplateId } from '../../io/export/figures/templates';
import { toast } from '../../ui';
import { useViewer } from '../store/viewer';
import { downloadFile } from './exportActions';
import { renderFigure, type FigureFormat, type FigureOptions } from './figureRender';
import { figureEnv } from './figureSources';

export { FIGURE_TEMPLATES };

/** Pedido inicial de una plantilla (conserva lo elegido que no depende de ella). */
export function defaultFigureOptions(templateId: FigureTemplateId, prev?: Partial<FigureOptions>): FigureOptions {
  const t: FigureTemplate = templateById(templateId);
  const visible = useViewer.getState().visible;
  const format: FigureFormat = prev?.format ?? 'png';
  return {
    templateId,
    format,
    range: prev?.range ?? (visible ? { kind: 'visible', top: visible.top, base: visible.base } : { kind: 'well' }),
    verticalScale: t.verticalScale || prev?.verticalScale || 500,
    widthCm: t.widthCm,
    heightCm: t.heightCm,
    marginCm: t.marginCm,
    dpi: prev?.dpi ?? 300,
    trackIds: null,
    title: prev?.title ?? '',
    orientation: t.orientation,
    xyId: prev?.xyId ?? '',
  };
}

/** Genera y descarga la figura. Devuelve true si salió bien (el diálogo se cierra). */
export async function exportFigure(options: FigureOptions): Promise<boolean> {
  try {
    const { file, detail } = await renderFigure(options, figureEnv());
    downloadFile(file);
    toast({ title: 'Figura exportada', description: `${file.name} · ${detail}`, tone: 'ok' });
    return true;
  } catch (err) {
    toast({ title: 'No se pudo exportar la figura', description: err instanceof Error ? err.message : String(err), tone: 'error' });
    return false;
  }
}
