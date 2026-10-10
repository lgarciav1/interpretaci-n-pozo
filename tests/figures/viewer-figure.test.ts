/**
 * Figura del perfil (src/viewer/figure.ts y figureInput.ts) con el pozo del TP (datos/pozo_tp_perfiles.csv): el mismo
 * dibujo de la pantalla sobre el grabador de SVG, con el marco de publicación.
 */
import { describe, expect, it } from 'vitest';
import { SvgContext2D, formatScale, pxPerMeterForScale, scaleDenominatorFor, templateById, withSvgPath2D } from '../../src/io/export/figures';
import type { ExportSummary } from '../../src/io/export/types';
import { drawViewerFigure, layoutViewerFigure, trackHeaderRows, type ViewerFigureInput } from '../../src/viewer/figure';
import { buildViewerFigure, fitViewerFigure, isEmptyTrack, resolveRange, selectTracks } from '../../src/viewer/figureInput';
import { checkXml } from './xml';
import { tpFigureContext, tpRequest } from './support';

const ctx = tpFigureContext();

function toSvg(input: ViewerFigureInput) {
  const layout = layoutViewerFigure(input);
  const c = new SvgContext2D({ width: layout.width, height: layout.height, measure: input.measure, title: input.title });
  withSvgPath2D(() => drawViewerFigure(c.asCanvas(), input, layout));
  return { svg: c.toSvg('#ffffff'), layout };
}

describe('el pozo del TP a SVG', () => {
  const input = buildViewerFigure(tpRequest(), ctx);
  const { svg, layout } = toSvg(input);
  const rep = checkXml(svg);

  it('es XML válido, con raíz svg del tamaño de la figura, y no está vacío', () => {
    expect(rep.root).toBe('svg');
    expect(rep.elements[0]!.attrs['width']).toBe(String(layout.width));
    expect(rep.elements[0]!.attrs['height']).toBe(String(layout.height));
    expect(svg.length).toBeGreaterThan(200_000);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('trae curvas, rellenos, recortes por pista y texto de las pistas, la profundidad y el marco', () => {
    expect(rep.counts.get('path')!).toBeGreaterThan(40);
    expect(rep.counts.get('clipPath')!).toBeGreaterThan(3);
    const texts = rep.elements.filter((e) => e.name === 'text').map((e) => e.text);
    for (const t of ['Registros del pozo pozo_tp_perfiles', 'Correlación', 'Resistividad', 'Densidad · neutrón', 'Sónico', 'Prof.', 'GR (gAPI)', 'ZDEN (g/cm³)']) expect(texts, t).toContain(t);
    expect(texts.some((t) => t.startsWith('Zona A · 7633–7724 m'))).toBe(true);
    expect(texts).toContain('Pozo pozo_tp_perfiles · 10/10/2026');
    expect(texts).toContain('Escala vertical 1:1.000');
    // rótulos de profundidad de la pista de profundidad (m): hay varios, con números
    expect(texts.filter((t) => /^7\d{3}$/.test(t)).length).toBeGreaterThan(10);
    // colores de las curvas del tema claro (GR verde, resistividad profunda roja…)
    expect(svg).toMatch(/stroke="#[0-9a-f]{6}"/);
  });

  it('usa SIEMPRE el tema claro (fondo blanco) y nada de la interacción: sin cursor ni etiqueta de cursor', () => {
    expect(svg).toContain('<rect width="' + layout.width + '" height="' + layout.height + '" fill="#ffffff"/>');
    // el color del cursor y el de su etiqueta (tema claro) no aparecen en ningún trazo ni relleno
    expect(svg).not.toContain('#4f55d8"/>'); // cursor
    expect(svg).not.toContain('fill="#15181d"/>'); // etiqueta del cursor
    // ni la tira de la animación de carga (degradado de acento)
    expect(rep.counts.get('linearGradient') ?? 0).toBe(0);
  });

  it('el cuerpo mide (tramo × zoom): 885,3 m a 1:1000 = 3 346 px', () => {
    expect(layout.bodyHeight).toBe(Math.round((8518.55 - 7633.2588) * pxPerMeterForScale(1000)));
    expect(layout.bodyHeight).toBe(3346);
    expect(layout.height).toBeGreaterThan(layout.bodyHeight + layout.headerHeight);
  });

  it('es determinista: dos exportaciones iguales dan el mismo archivo', () => {
    expect(toSvg(buildViewerFigure(tpRequest(), ctx)).svg).toBe(svg);
  });
});

describe('qué se dibuja', () => {
  it('sin elección se omiten las pistas sin nada que mostrar (Interpretación, Litología del pozo sin calcular) y queda la de profundidad', () => {
    const ids = buildViewerFigure(tpRequest(), ctx).tracks.map((t) => t.id);
    expect(ctx.tracks.some(isEmptyTrack)).toBe(true);
    expect(ids).toContain('depth');
    for (const t of ctx.tracks.filter(isEmptyTrack)) expect(ids).not.toContain(t.id);
  });

  it('«solo pistas seleccionadas»: la de profundidad siempre va; lo elegido y nada más; sin ninguna de curvas es un error', () => {
    const picked = selectTracks(ctx.tracks, ['sonic']);
    expect(picked.map((t) => t.id).sort()).toEqual(['depth', 'sonic']);
    const t = templateById('profile-tracks');
    const input = buildViewerFigure(tpRequest({ template: t, trackIds: ['sonic'], widthCm: 8 }), ctx);
    expect(input.parts.wellHeader).toBe(false);
    expect(input.parts.zoneLegend).toBe(false);
    const { svg, layout } = toSvg(input);
    const texts = checkXml(svg).elements.filter((e) => e.name === 'text').map((e) => e.text);
    expect(texts).toContain('Sónico');
    expect(texts).not.toContain('Resistividad');
    expect(layout.fieldLines).toEqual([]);
    expect(layout.zoneLines).toEqual([]);
    expect(() => buildViewerFigure(tpRequest({ trackIds: [] }), ctx)).toThrow(/al menos una pista/);
  });

  it('un tramo (zona) o el visible recorta el cuerpo y el subtítulo lo dice', () => {
    const zone = resolveRange({ kind: 'zone', zoneId: ctx.zones[2]!.id }, ctx.depth, ctx.zones);
    expect(zone).toEqual({ top: ctx.zones[2]!.top, base: ctx.zones[2]!.base });
    const input = buildViewerFigure(tpRequest({ range: { kind: 'zone', zoneId: ctx.zones[2]!.id }, verticalScale: 200 }), ctx);
    expect(input.subtitle).toBe('Zona C · 7906–7970 m · escala vertical 1:200');
    expect(layoutViewerFigure(input).bodyHeight).toBe(Math.round((zone.base - zone.top) * pxPerMeterForScale(200)));
    // el tramo visible se acota al pozo
    expect(resolveRange({ kind: 'visible', top: 7000, base: 7700 }, ctx.depth, ctx.zones)).toEqual({ top: ctx.depth[0], base: 7700 });
    expect(() => resolveRange({ kind: 'visible', top: 9000, base: 9100 }, ctx.depth, ctx.zones)).toThrow(/no tiene profundidad/);
    expect(() => resolveRange({ kind: 'zone', zoneId: 'nada' }, ctx.depth, ctx.zones)).toThrow(/ya no existe/);
    expect(() => resolveRange({ kind: 'well' }, new Float64Array(1), [])).toThrow(/no tiene muestras/);
  });

  it('«perfil + sumario»: la tabla va debajo con encabezados, unidades y valores', () => {
    const summary: ExportSummary = {
      columns: [
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'gross', label: 'Espesor bruto', unit: 'm' },
        { key: 'phi', label: 'φ prom.', unit: 'v/v' },
      ],
      rows: [
        { zone: 'A', gross: 91.1, phi: 0.1234 },
        { zone: 'B', gross: 181.5, phi: null },
      ],
    };
    const t = templateById('profile-summary');
    const input = buildViewerFigure(tpRequest({ template: t }), { ...ctx, summary });
    const base = layoutViewerFigure(buildViewerFigure(tpRequest(), ctx));
    const { svg, layout } = toSvg(input);
    expect(layout.summaryHeight).toBe(34 + 2 * 18);
    expect(layout.height).toBeGreaterThan(base.height + layout.summaryHeight - 5);
    const texts = checkXml(svg).elements.filter((e) => e.name === 'text').map((e) => e.text);
    for (const s of ['Zona', 'Espesor bruto', '(m)', 'φ prom.', '(v/v)', 'A', '91,1', '0,1234', 'B', '181,5', '—']) expect(texts, s).toContain(s);
  });

  it('el pie y el título se omiten si la plantilla no los pide', () => {
    const input = buildViewerFigure(tpRequest(), ctx, { margin: 0, parts: { title: false, wellHeader: false, credits: false } });
    const { svg } = toSvg(input);
    const texts = checkXml(svg).elements.filter((e) => e.name === 'text').map((e) => e.text);
    expect(texts).not.toContain('Registros del pozo pozo_tp_perfiles');
    expect(texts.some((t) => t.startsWith('Pozo pozo_tp_perfiles'))).toBe(false);
  });

  it('el título propio reemplaza al de la plantilla', () => {
    expect(buildViewerFigure(tpRequest({ title: '  Figura 3 — Perfil compuesto ' }), ctx).title).toBe('Figura 3 — Perfil compuesto');
  });
});

describe('encabezados de pista (curvas con unidad y escala)', () => {
  const rows = (id: string) => trackHeaderRows(ctx.tracks.find((t) => t.id === id)!);

  it('curvas con escalas distintas: nombre y unidad, y los dos extremos (el izquierdo es el que corresponde si la escala está invertida)', () => {
    const porosity = rows('porosity').filter((r) => r.kind === 'curve');
    const nphi = porosity.find((r) => r.kind === 'curve' && r.curve.name === 'NPHI');
    expect(nphi).toMatchObject({ left: '0,45', right: '-0,15' }); // NPHI 0,45 → −0,15
    const zden = porosity.find((r) => r.kind === 'curve' && r.curve.name === 'ZDEN');
    expect(zden).toMatchObject({ left: '1,95', right: '2,95' });
    expect(zden && zden.kind === 'curve' ? zden.name : '').toBe('ZDEN (g/cm³)');
  });

  it('resistividades con la misma escala log: extremos y unidad una sola vez', () => {
    const r = rows('resistivity');
    expect(r[1]).toMatchObject({ kind: 'scale', left: '0,2', right: '2000', center: 'ohm·m · log' });
    expect(r.filter((x) => x.kind === 'name').map((x) => (x.kind === 'name' ? x.name : ''))).toEqual(['AT10', 'AT30', 'AT60', 'AT90']);
  });

  it('la pista de profundidad dice la unidad', () => {
    expect(rows('depth')).toMatchObject([{ kind: 'title', text: 'Prof.' }, { kind: 'unit', text: 'm' }]);
  });
});

describe('ajuste a la página', () => {
  it('si el perfil no entra en el alto, se achica la escala y el subtítulo lo aclara; si entra, no se toca', () => {
    const input = buildViewerFigure(tpRequest({ verticalScale: 500 }), ctx, { margin: 0, parts: { title: false, wellHeader: false, credits: false } });
    const target = 1000;
    const { input: fitted, layout } = fitViewerFigure(input, target);
    expect(layout.height).toBeLessThanOrEqual(target);
    expect(layout.height).toBeGreaterThan(target - 5);
    expect(fitted.pxPerM).toBeLessThan(input.pxPerM);
    expect(fitted.subtitle).toContain('(ajustada a la página)');
    expect(fitViewerFigure(fitted, 5000).input).toBe(fitted);
    expect(() => fitViewerFigure(input, 100)).toThrow(/no tiene lugar/);
  });

  it('si toda la figura se achica a lo ancho (zoom < 1), la escala impresa es la de después del achique', () => {
    const input = buildViewerFigure(tpRequest({ verticalScale: 500 }), ctx, { margin: 0, parts: { title: false, wellHeader: false, credits: false } });
    // entra a lo alto, pero se imprime al 50 %: 1:500 pasa a 1:1.000
    const { input: half } = fitViewerFigure(input, 100_000, 0.5);
    expect(half.pxPerM).toBe(input.pxPerM);
    expect(half.subtitle).toContain('escala vertical 1:1.000 (ajustada a la página)');
    expect(half.scaleText).toBe('Escala vertical 1:1.000');
    // y si además no entra a lo alto: pxPerM · zoom manda
    const { input: both } = fitViewerFigure(input, 1500, 0.5);
    expect(both.pxPerM).toBeLessThan(input.pxPerM);
    expect(both.scaleText).toBe(`Escala vertical ${formatScale(Math.round(scaleDenominatorFor(both.pxPerM * 0.5)))}`);
  });
});
