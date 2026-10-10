/**
 * Sección «Figuras» del diálogo «Exportar»: plantilla, formato (PNG, SVG, PDF), tramo, escala vertical, tamaño,
 * resolución y pistas. Todo el dibujo está en `figureRender.ts`; esto solo arma el pedido. docs/decisiones/0012.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { rasterSize, DPI_OPTIONS, formatScale, VERTICAL_SCALES, type Orientation } from '../../io/export/figures/sizing';
import { templatesFor, templateById, type FigureTemplateId } from '../../io/export/figures/templates';
import { listXYFigures, subscribeXYFigures } from '../../plots/xy/figures';
import { Callout, Checkbox, Field, NumberField, SegmentedControl, Select, TextField, formatNumber } from '../../ui';
import { isEmptyTrack } from '../../viewer/figureInput';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useViewer } from '../store/viewer';
import { defaultFigureOptions } from './figureActions';
import { figureSize, pngResolution, FIGURE_FORMAT_LABEL, type FigureFormat, type FigureOptions } from './figureRender';
import { figureEnv, figureTracks } from './figureSources';

const FORMAT_HINT: Record<FigureFormat, string> = {
  png: 'Imagen de alta resolución con la resolución declarada (se abre al tamaño correcto en Word o en un programa de maquetación).',
  svg: 'Vectorial: texto y curvas editables en Inkscape o Illustrator, sin límite de tamaño ni de zoom.',
  pdf: 'Una página A4 con título, datos del pozo, la figura y el pie con fecha y escala; la figura va como imagen.',
};

type RangeKind = FigureOptions['range']['kind'];

/** Estado del formulario de figuras. Vive en el diálogo para que el botón «Exportar» del pie lo use. */
export function useFigureForm(active: boolean) {
  const [options, setOptions] = useState<FigureOptions>(() => defaultFigureOptions('profile-full'));
  const set = (patch: Partial<FigureOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const entry = useProject(selectActiveEntry);
  const result = useResults((s) => s.result);
  const display = useProject((s) => s.project.display);
  const xyFigures = useSyncExternalStore(subscribeXYFigures, listXYFigures);
  const template = templateById(options.templateId);
  const isXY = template.subject === 'crossplot';
  const xyId = xyFigures.some((f) => f.id === options.xyId) ? options.xyId : (xyFigures[0]?.id ?? '');
  const effective: FigureOptions = { ...options, xyId };

  // Pistas del espacio de trabajo (para elegirlas) y tamaño que tendría la figura.
  const tracks = useMemo(() => (active && entry && !isXY ? figureTracks(entry.well).filter((t) => t.kind !== 'depth') : []), [active, entry, result, display, isXY]);
  const size = useMemo(() => {
    if (!active || !entry) return null;
    try {
      return { size: figureSize(effective, figureEnv()), error: null as string | null };
    } catch (err) {
      return { size: null, error: err instanceof Error ? err.message : String(err) };
    }
    // `effective` cambia con cada render: se listan los campos que cuentan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, entry, result, display, options, xyId, xyFigures]);

  const res = size?.size && effective.format === 'png' ? pngResolution(size.size.width, size.size.height, effective.dpi) : null;
  const raster = size?.size && res ? rasterSize(size.size.width, size.size.height, res.dpi) : null;
  const problem = size?.error ?? res?.problem ?? null;
  const canExport = !!entry && !problem && (!isXY || !!xyId) && (!template.pickTracks || effective.trackIds === null || effective.trackIds.length > 0);

  return { options: effective, set, setTemplate: (id: FigureTemplateId) => setOptions((o) => defaultFigureOptions(id, o)), template, isXY, xyFigures, tracks, size: size?.size ?? null, raster, dpi: res?.dpi ?? null, capped: res?.capped ?? false, problem, canExport };
}

export type FigureForm = ReturnType<typeof useFigureForm>;

export function FiguresPanel({ form }: { form: FigureForm }) {
  const { options: o, set, template, isXY, xyFigures, tracks, size, raster, dpi, capped, problem } = form;
  const entry = useProject(selectActiveEntry);
  const visible = useViewer((s) => s.visible);
  const zones = entry?.interpretation.zones ?? [];
  const pickable = tracks.filter((t) => !isEmptyTrack(t));
  const chosen = new Set(o.trackIds ?? pickable.map((t) => t.id));
  const rangeKind: RangeKind = o.range.kind;
  const m = (v: number) => formatNumber(v, { digits: 0, grouping: false });

  const setRange = (kind: RangeKind, zoneId?: string) => {
    if (kind === 'visible') set({ range: visible ? { kind, top: visible.top, base: visible.base } : { kind: 'well' } });
    else if (kind === 'zone') set({ range: { kind, zoneId: zoneId ?? zones[0]?.id ?? '' } });
    else set({ range: { kind: 'well' } });
  };
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    set({ trackIds: pickable.filter((t) => next.has(t.id)).map((t) => t.id) });
  };

  return (
    <div className="exp">
      <Field label="Plantilla" hint={template.description}>
        <Select
          aria-label="Plantilla de figura"
          block
          value={o.templateId}
          onChange={(v) => form.setTemplate(v as FigureTemplateId)}
          groups={[
            { label: 'Perfil', options: templatesFor('profile').map((t) => ({ value: t.id, label: t.label })) },
            { label: 'Gráficos', options: templatesFor('crossplot').map((t) => ({ value: t.id, label: t.label })) },
          ]}
        />
      </Field>

      <Field label="Formato" hint={FORMAT_HINT[o.format]}>
        <SegmentedControl<FigureFormat> aria-label="Formato de la figura" value={o.format} onChange={(format) => set({ format })} options={(['png', 'svg', 'pdf'] as const).map((f) => ({ value: f, label: FIGURE_FORMAT_LABEL[f] }))} />
      </Field>

      {isXY ? (
        <Field label="Gráfico" hint={xyFigures.length === 0 ? 'No hay ningún gráfico a la vista: abrí el panel que lo muestra (por ejemplo, Corona → modelo k–φ) y volvé a exportar.' : 'Se exporta tal como se ve: ejes, puntos, tendencias y ecuaciones.'}>
          <Select aria-label="Gráfico a exportar" block value={o.xyId} onChange={(xyId) => set({ xyId })} options={xyFigures.length ? xyFigures.map((f) => ({ value: f.id, label: f.title })) : [{ value: '', label: 'Sin gráficos a la vista', disabled: true }]} />
        </Field>
      ) : (
        <>
          <div className="exp-row exp-row--2">
            <Field label="Tramo">
              <Select
                aria-label="Tramo de la figura"
                block
                value={rangeKind === 'zone' ? `zone:${(o.range as { zoneId: string }).zoneId}` : rangeKind}
                onChange={(v) => (v.startsWith('zone:') ? setRange('zone', v.slice(5)) : setRange(v as RangeKind))}
                options={[
                  { value: 'visible', label: visible ? `Tramo visible (${m(visible.top)}–${m(visible.base)} m)` : 'Tramo visible', disabled: !visible },
                  { value: 'well', label: 'Todo el pozo' },
                  ...zones.map((z) => ({ value: `zone:${z.id}`, label: `Zona ${z.name} (${m(z.top)}–${m(z.base)} m)` })),
                ]}
              />
            </Field>
            <Field label="Escala vertical" hint={o.format === 'pdf' ? 'Si el tramo no entra en la página, se ajusta.' : '1:N a 96 ppp: coincide con el papel al imprimir al 100 %.'}>
              <Select aria-label="Escala vertical" block value={String(o.verticalScale)} onChange={(v) => set({ verticalScale: Number(v) })} options={VERTICAL_SCALES.map((n) => ({ value: String(n), label: formatScale(n) }))} />
            </Field>
          </div>
          {template.pickTracks && (
            <div className="exp-group">
              <div className="exp-group__head">
                <span className="ui-overline">Pistas</span>
              </div>
              <div className="exp-curves">
                {pickable.map((t) => (
                  <Checkbox key={t.id} checked={chosen.has(t.id)} onChange={(on) => toggle(t.id, on)} label={t.title} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="exp-row exp-row--4">
        {o.format !== 'pdf' && (
          <Field label="Ancho (cm)">
            <NumberField aria-label="Ancho de la figura en centímetros" value={o.widthCm} onChange={(widthCm) => set({ widthCm })} min={4} max={60} step={0.5} />
          </Field>
        )}
        {isXY && (
          <Field label="Alto (cm)">
            <NumberField aria-label="Alto del gráfico en centímetros" value={o.heightCm} onChange={(heightCm) => set({ heightCm })} min={4} max={40} step={0.5} />
          </Field>
        )}
        {o.format !== 'pdf' && (
          <Field label="Margen (cm)">
            <NumberField aria-label="Margen en centímetros" value={o.marginCm} onChange={(marginCm) => set({ marginCm })} min={0} max={3} step={0.1} />
          </Field>
        )}
        {o.format !== 'svg' && (
          <Field label="Resolución">
            <Select aria-label="Resolución en puntos por pulgada" block value={String(o.dpi)} onChange={(v) => set({ dpi: Number(v) })} options={DPI_OPTIONS.map((d) => ({ value: String(d), label: `${d} ppp` }))} />
          </Field>
        )}
        {o.format === 'pdf' && (
          <Field label="Orientación">
            <SegmentedControl<Orientation> aria-label="Orientación de la página" value={o.orientation} onChange={(orientation) => set({ orientation })} options={[{ value: 'portrait', label: 'Vertical' }, { value: 'landscape', label: 'Horizontal' }]} />
          </Field>
        )}
      </div>

      <Field label="Título" hint="Vacío: el que propone la plantilla.">
        <TextField aria-label="Título de la figura" block value={o.title} onChange={(title) => set({ title })} placeholder={isXY ? (xyFigures.find((f) => f.id === o.xyId)?.title ?? '') : `Registros del pozo ${(entry?.well.name ?? '').trim().replace(/^pozo\s+/i, '')}`} />
      </Field>

      {problem ? (
        <Callout tone="warn">{problem}</Callout>
      ) : (
        size && (
          <>
            {capped && dpi && (
              <Callout tone="info">{`A ${o.dpi} ppp la imagen sería más grande de lo que dibuja el navegador: se exporta a ${dpi} ppp. Para más resolución, elegí una escala menor, un tramo más corto o SVG.`}</Callout>
            )}
            <p className="exp-empty">
              {`${formatNumber(size.width, { digits: 0 })} × ${formatNumber(size.height, { digits: 0 })} px CSS`}
              {raster ? ` · PNG de ${formatNumber(raster.width, { digits: 0 })} × ${formatNumber(raster.height, { digits: 0 })} px` : ''}
            </p>
          </>
        )
      )}
    </div>
  );
}
