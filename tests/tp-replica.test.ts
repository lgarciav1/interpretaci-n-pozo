import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { pointNumbers } from '../src/core/pointSets';
import { registry } from '../src/modules';
import { naclResistivityC } from '../src/petro/brine';
import { tpMdtSet } from '../src/modules/mdt/tp';
import { interpretation, well, zoneId } from './fixtures/tp-replica';

describe('controles de la réplica del TP sobre los datos embebidos', () => {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(toEngineWell(well));
  const result = engine.run(interpretation);

  function valueAt(moduleId: string, port: string, depth: number, zone: string): number {
    const i = well.depth.values.findIndex((md) => Math.abs(md - depth) < 1e-5);
    expect(i, `MD ${depth}`).toBeGreaterThanOrEqual(0);
    expect(result.segments.find((segment) => segment.start <= i && i < segment.end)?.zoneId).toBe(zoneId(zone));
    const output = result.outputs.find((item) => item.moduleId === moduleId && item.port === port);
    expect(output?.active, `${moduleId}:${port}`).toBe(true);
    return (output!.value as Float64Array)[i]!;
  }

  it('reproduce VCL, PHIE, Archie y las tres banderas de B608', () => {
    const depth = 7724.5464;
    expect(valueAt('vsh', 'VSH', depth, 'B')).toBeCloseTo(0.09112, 8);
    expect(valueAt('phie-shale-corrected', 'PHIE', depth, 'B')).toBeCloseTo(0.205168148, 8);
    expect(valueAt('sw-archie', 'SW', depth, 'B')).toBeCloseTo(0.255091027, 8);
    for (const port of ['NET_SAND', 'NET_RES', 'NET_PAY']) expect(valueAt('cutoffs', port, depth, 'B')).toBe(1);
  });

  it('reproduce PHIE y el recorte de Archie en A8', () => {
    const depth = 7633.2588;
    expect(valueAt('phie-shale-corrected', 'PHIE', depth, 'A')).toBeCloseTo(0.191435715, 8);
    expect(valueAt('sw-archie', 'SW', depth, 'A')).toBe(1);
  });

  it('marca el derrumbe a 7646,0604 m y conserva la muestra sana de A8', () => {
    expect(valueAt('ind-washout', 'IND_WASHOUT', 7646.0604, 'A')).toBe(1);
    expect(valueAt('ind-washout', 'IND_WASHOUT', 7633.2588, 'A')).toBe(0);
  });

  it('contrasta la Rw fija de Archie con el cálculo por salinidad', () => {
    expect(valueAt('rw-manual', 'RW', 7724.5464, 'B')).toBe(0.02);
    expect(naclResistivityC(140000, (240 - 32) * 5 / 9)).toBeCloseTo(0.01879, 5);
  });

  it('reproduce la presión y la caída de la prueba MDT 3 en B', () => {
    const mdt = tpMdtSet('mdt');
    const i = mdt.depth.findIndex((md) => Math.abs(md - 7748.0831) < 1e-5);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(mdt.pointIds[i]).toBe('MDT-03');
    expect(pointNumbers(mdt, 'pressure')![i]).toBeCloseTo(19149.09, 2);
    expect(pointNumbers(mdt, 'drawdown')![i]).toBeCloseTo(66.59, 2);
  });
});
