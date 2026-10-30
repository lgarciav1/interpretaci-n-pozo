import { engineContext } from '../../src/core/engine/context';
import { emptyInterpretation } from '../../src/core/interpretation';
import { toEngineWell } from '../../src/core/engine/engine';
import { describe, expect, it } from 'vitest';
import { SvgContext2D } from '../../src/io/export/figures/svg';
import { fillPatternRect, type TilePattern } from '../../src/viewer/fills';
import { computedTables } from '../../src/app/computed';
import type { ClientResult } from '../../src/core/engine/client';
import { syntheticWell } from '../../src/app/demo/syntheticWell';

const tile: TilePattern = { id: 'mosaico', width: 12, height: 8, lines: [[0, 4, 12, 4]], dots: [[3, 2, .6]] };
describe('tramas vectoriales compartidas con el visor', () => {
  it('reutiliza un mosaico sin deformarlo al cambiar el ancho de la capa y conserva recorte, escala y opacidad', () => {
    const svg = new SvgContext2D({ width: 300, height: 200 });
    const ctx = svg.asCanvas();
    ctx.save(); ctx.translate(12, 8); ctx.beginPath(); ctx.rect(0, 0, 200, 100); ctx.clip(); ctx.globalAlpha = .6;
    fillPatternRect(ctx, { x: 0, y: 0, width: 35, height: 25 }, tile, '#fff', '#123', 1.5);
    fillPatternRect(ctx, { x: 0, y: 25, width: 180, height: 50 }, tile, '#fff', '#123', 1.5);
    ctx.restore();
    const xml = svg.toSvg();
    expect(xml.match(/<pattern /g)).toHaveLength(1);
    expect(xml).toContain('patternUnits="userSpaceOnUse" width="18" height="12"');
    expect(xml.match(/fill="url\(#tile0\)"/g)).toHaveLength(2);
    expect(xml).toContain('opacity="0.6" transform="matrix(1 0 0 1 12 8)"');
    expect(xml).toContain('clip-path="url(#');
    expect(xml).not.toContain('<image');
  });
  it('no mezcla tablas de pozos distintos y preserva la identidad de los datos de una corrida', () => {
    const { well } = syntheticWell(100);
    const value = { rows: [{ top: 5, base: 6 }] };
    const result = { context:engineContext(toEngineWell(well),emptyInterpretation()), wellId: well.id, outputs: [{ kind: 'table', moduleId: 'example', port: 'LAYERS', active: true, value }] } as unknown as ClientResult;
    expect(computedTables(result, { ...well, id: 'otro' })).toEqual([]);
    const tables = computedTables(result, well);
    expect(tables[0]!.value).toBe(value);
    expect(computedTables(result, well)).toBe(tables);
  });
});

