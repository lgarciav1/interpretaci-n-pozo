import { engineContext } from '../src/core/engine/context';
import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import type { ClientResult } from '../src/core/engine/client';
import type { TableValue } from '../src/core/module';
import { emptyInterpretation } from '../src/core/interpretation';
import { registry } from '../src/modules';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { buildReportModel, defaultReportOptions, reportHtml } from '../src/app/report/report';
import { paginateReportTracks, renderReport } from '../src/app/report/reportActions';
import { approximateMeasure } from '../src/io/export/figures/svg';
import { tpFigureContext } from './figures/support';

function example() {
  const { well, zones } = syntheticWell(300);
  const interpretation = { ...emptyInterpretation(), zones };
  interpretation.params.global.m = 2.1;
  interpretation.params.zones[zones[0]!.id] = { m: 2.6 };
  const engine = new Engine(registry);
  engine.setWell(toEngineWell(well));
  const result: ClientResult = { ...engine.run(interpretation), context:engineContext(toEngineWell(well),interpretation), wellId: well.id, seq: 1, gen: 1, roundTripMs: 0, coalesced: 0 };
  return { well, interpretation, result };
}

describe('informe automático', () => {
  it('pagina pistas densas conservando curvas, profundidad y rellenos entre partes', async () => {
    const { well, interpretation, result } = example();
    const context = tpFigureContext();
    const base = context.tracks.find((t) => t.kind === 'curves' && t.curves.length > 0)!;
    const curve = base.curves[0]!;
    const curves = Array.from({ length: 42 }, (_, i) => ({ ...curve, key: `dense:${i}`, name: `CALCULADA_${i}`, axis: { ...curve.axis, max: curve.axis.max + i } }));
    const fill = { ...base.fills[0], kind: 'between' as const, a: curves[0]!, b: curves[41]!, compare: 'screen' as const, opacity: 0.2 };
    const dense = { ...base, id: 'dense', title: 'Calculadas', curves, fills: [fill] };
    const tracks = [...context.tracks.filter((t) => t.kind === 'depth'), dense];
    const pages = paginateReportTracks(tracks);
    const fragments = pages.flat().filter((t) => t.kind !== 'depth');
    expect(new Set(fragments.flatMap((t) => t.curves.map((c) => c.key))).size).toBe(42);
    expect(pages.length).toBe(2);
    expect(fragments.every((t) => t.curves.length <= 6)).toBe(true);
    expect(pages.every((p) => p.some((t) => t.kind === 'depth'))).toBe(true);
    const preserved = fragments.find((t) => t.fills.includes(fill))!;
    expect(preserved.curves).toContain(fill.a);
    expect(preserved.curves).toContain(fill.b);
    const raster = { measure: approximateMeasure, png: async () => { throw new Error('raster'); }, rgb: async () => { throw new Error('raster'); } };
    const html = await renderReport(defaultReportOptions(), buildReportModel(well, interpretation, result), { viewer: { ...context, tracks }, xy: [], raster, date: new Date() });
    const images = [...html.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)].map((m) => atob(m[1]!));
    expect(images.length).toBe(2);
    expect(images.join('')).toContain('CALCULADA_41');
    expect(html).toContain('data:image/svg+xml;base64,');
  });
  it('usa fuentes resueltas y parámetros efectivos de la corrida, incluidos los valores heredados por zona', () => {
    const { well, interpretation, result } = example();
    const model = buildReportModel(well, interpretation, result);
    expect(interpretation.sources.SW).toBeUndefined();
    expect(model.methods.find((m) => m.port === 'SW')?.source).toBe('Sw — Archie');
    const archie = model.parameters.find((p) => p.module === 'Sw — Archie')!;
    const exponent = archie.rows.find((r) => r.global === '2,1' && r.zones[0] === '2,6');
    expect(exponent).toBeDefined();
    expect(exponent!.zones.slice(1).every((v) => v === '2,1')).toBe(true);
    expect(model.summary?.rows.length).toBeGreaterThan(0);
    expect(model.volumes?.rows.length).toBeGreaterThan(0);
  });

  it('copia tablas y parámetros para que cambios posteriores no alteren el informe generado', () => {
    const { well, interpretation, result } = example();
    const model = buildReportModel(well, interpretation, result);
    const before = reportHtml(model);
    interpretation.params.global.m = 9;
    interpretation.zones[0]!.name = 'Zona cambiada';
    const table = result.outputs.find((o) => o.port === 'ZONE_SUMMARY')!;
    if (typeof table.value === 'object' && 'rows' in table.value) {
      // El motor congela sus tablas; la copia del informe no comparte sus filas.
      expect(model.summary!.rows[0]).not.toBe((table.value as TableValue).rows[0]);
    }
    expect(reportHtml(model)).toBe(before);
  });

  it('no incorpora resultados de otro pozo ni convierte datos faltantes en cero', () => {
    const { well, interpretation, result } = example();
    const model = buildReportModel(well, interpretation, { ...result, wellId: 'otro-pozo' });
    expect(model.summary).toBeNull();
    expect(model.volumes).toBeNull();
    expect(model.methods).toEqual([]);
    expect(model.parameters).toEqual([]);
    const html = reportHtml(model);
    expect(html).toContain('Sin resultados disponibles');
    expect(html).toContain('no representan cero');
  });

  it('escapa datos del pozo y texto del usuario, permite solo imágenes incrustadas', () => {
    const { well, interpretation, result } = example();
    const model = buildReportModel({ ...well, name: '<script>alert(1)</script>' }, interpretation, result);
    const options = { ...defaultReportOptions(), title: 'Informe <img src=x onerror=alert(1)>', author: 'Lucas & equipo' };
    const html = reportHtml(model, [], options);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Lucas &amp; equipo');
    expect(html).not.toContain('<script>');
    expect(() => reportHtml(model, [{ title: 'externa', caption: '', dataUrl: 'https://example.com/image.png' }])).toThrow(/incrustada/);
  });

  it('respeta las secciones elegidas y genera una hoja imprimible autónoma', () => {
    const { well, interpretation, result } = example();
    const model = buildReportModel(well, interpretation, result);
    const options = { ...defaultReportOptions(), includeParameters: false, includeSummary: false, includeVolumes: false, includeWarnings: false };
    const html = reportHtml(model, [], options);
    expect(html).not.toContain('Métodos y parámetros efectivos');
    expect(html).not.toContain('Sumario por zona');
    expect(html).not.toContain('Advertencias y limitaciones');
    expect(html).toContain('@media print');
    expect(html).toContain('window.print()');
    expect(html).not.toMatch(/(?:src|href)="https?:/);
  });

  it('genera el perfil de publicación incrustado sin servicios ni rasterizadores', async () => {
    const { well, interpretation, result } = example();
    const model = buildReportModel(well, interpretation, result);
    const raster = {
      measure: approximateMeasure,
      png: async () => { throw new Error('No debería rasterizar'); },
      rgb: async () => { throw new Error('No debería rasterizar'); },
    };
    const html = await renderReport(defaultReportOptions(), model, { viewer: tpFigureContext(), xy: [], raster, date: new Date(2026, 9, 12) });
    expect(html).toContain('data:image/svg+xml;base64,');
    expect(html).toContain('Perfil completo');
    expect(html).toContain('ajustado a página');
    await expect(renderReport({ ...defaultReportOptions(), xyIds: ['inexistente'] }, model, { viewer: tpFigureContext(), xy: [], raster, date: new Date() })).rejects.toThrow(/ya no está disponible/);
  });
});

